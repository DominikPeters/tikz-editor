import { describe, expect, it } from "vitest";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { createIncrementalSemanticSession } from "../../packages/core/src/semantic/incremental.js";
import type { ScenePath } from "../../packages/core/src/semantic/types.js";

const evaluate = (source: string) => evaluateTikzFigure(parseTikz(source).figure, source);
const crossing = String.raw`\path[name path=cut] (0,0) -- (0,3);
\path[name intersections={of=line and cut,by=hit}];`;
const hit = String.raw`\draw (hit) -- (1,1);`;

describe("named path state", () => {
  it.each(["name path", "name path local"])("expires %s at the surrounding scope boundary", key => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}
\path[${key}=line] (-1,1) -- (1,1);
\end{scope}
${crossing}
\end{tikzpicture}`;
    expect(evaluate(source).diagnostics.map(diagnostic => diagnostic.code)).toContain("unknown-named-path:line");
  });

  it("keeps globally named paths after nested scopes close", () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}\begin{scope}
\path[name path global=line] (-1,2) -- (1,2);
\end{scope}\end{scope}
${crossing}
${hit}
\end{tikzpicture}`;
    expect(evaluate(source).diagnostics).toEqual([]);
  });

  it("replaces earlier geometry when a separate path reuses a name", () => {
    const source = String.raw`\begin{tikzpicture}
\path[name path=line] (-1,1) -- (1,1);
\path[name path=line] (-1,2) -- (1,2);
${crossing}
${hit}
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.nodeAnchorTargets.some(target => target.nodeName === "intersection-2")).toBe(false);
    const paths = result.scene.elements.filter((element): element is ScenePath => element.kind === "Path" && element.style.stroke != null);
    const move = paths[0]?.commands[0];
    expect(move?.kind).toBe("M");
    if (move?.kind === "M") expect(move.to.y).toBeCloseTo(2 * 28.4527559055, 6);
  });

  it("restores an outer path after a local shadow closes", () => {
    const source = String.raw`\begin{tikzpicture}
\path[name path=line] (-1,1) -- (1,1);
\begin{scope}
\path[name path=line] (-1,2) -- (1,2);
\end{scope}
${crossing}
${hit}
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.nodeAnchorTargets.some(target => target.nodeName === "intersection-2")).toBe(false);
    const paths = result.scene.elements.filter((element): element is ScenePath => element.kind === "Path" && element.style.stroke != null);
    const move = paths[0]?.commands[0];
    expect(move?.kind).toBe("M");
    if (move?.kind === "M") expect(move.to.y).toBeCloseTo(28.4527559055, 6);
  });

  it.each([
    ["local scope", String.raw`\begin{scope}\path[name path=line] (-1,2) -- (1,2);\end{scope}`],
    ["global scope", String.raw`\begin{scope}\path[name path global=line] (-1,2) -- (1,2);\end{scope}`],
    ["pic with a global then local assignment", String.raw`\pic[pics/code={
      \path[name path global=line] (-1,2) -- (1,2);
      \path[name path=line] (-1,3) -- (1,3);
    }] {};`]
  ])("replays surviving path assignments in the reused suffix (%s)", (_, definition) => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\draw (A) -- (1,1);
${Array.from({ length: 12 }, (_, index) => `\\draw (${index},0) -- (${index},1);`).join("\n")}
\path[name path=line] (-1,1) -- (1,1);
${definition}
${crossing}
${hit}
\end{tikzpicture}`;
    const session = createIncrementalSemanticSession();
    const original = parseTikz(source).figure;
    session.evaluate({ figure: original, source });
    const next = source.replace("(A) at (0,0)", "(A) at (1,0)");
    const figure = parseTikz(next).figure;
    const result = session.evaluate({ figure, source: next, hints: { changedSourceIds: [original.body[0].id] } });
    expect(result.stats).toMatchObject({ strategy: "incremental", replayMode: "selective", suffixReplay: "replayed" });
    expect(result.semantic).toEqual(evaluateTikzFigure(figure, next));
  });

  it.each(["name path", "name path global"])("keeps scope state through checkpoints and replay (%s)", key => {
    const source = String.raw`% original

\begin{tikzpicture}
\path[name path=line] (-1,1) -- (1,1);
\begin{scope}
\path[${key}=line] (-1,2) -- (1,2);
${Array.from({ length: 20 }, (_, index) => `\\draw (${index},0) -- (${index},1);`).join("\n")}
\end{scope}
${crossing}
${hit}
\end{tikzpicture}`;
    const session = createIncrementalSemanticSession();
    const moved = source.replace("% original", "% a longer prefix");
    for (const [index, current] of [source, moved, moved.replace("(16,1)", "(16,2)"), moved, source].entries()) {
      const figure = parseTikz(current).figure;
      const scope = figure.body.find(statement => statement.kind === "Scope");
      const changed = scope?.body.find(statement => /\(16,[12]\)/.test(current.slice(statement.span.from, statement.span.to)));
      const result = session.evaluate({ figure, source: current, ...(index === 2 || index === 3 ? { hints: { changedSourceIds: [changed!.id] } } : {}) });
      expect(result.semantic).toEqual(evaluateTikzFigure(figure, current));
      if (index > 0) expect(result.stats.strategy, JSON.stringify({ index, ...result.stats })).toBe("incremental");
      if (index === 2 || index === 3) expect(result.stats.recomputeFromStatementIndex).toBeGreaterThan(0);
    }
  });
});
