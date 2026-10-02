import { describe, expect, it } from "vitest";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { createIncrementalSemanticSession } from "../../packages/core/src/semantic/incremental.js";
import { evaluateTikzFigure, evaluateTikzFigureAsync } from "../../packages/core/src/semantic/evaluate.js";
import { createTexNodeTextEngine } from "../../packages/core/src/text/tex-node-text-engine.js";
import { renderTikzToSvgAsync } from "../../packages/core/src/render/index.js";

const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\begin{scope}[shift={(1,0)}]
  \node[draw] (B) at (A) {Before};
  \draw (B) -- (2,1);
\end{scope}
\foreach \x in {1,...,12} { \draw (\x,0) -- (\x,1); }
\end{tikzpicture}`;

describe("cooperative semantic evaluation", () => {
  it("does not let a suspended older run replace a newer committed baseline", async () => {
    const original = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0);
\draw (2,0) -- (3,0);
\end{tikzpicture}`;
    const session = createIncrementalSemanticSession();
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    let paused = false;
    const pending = session.evaluateAsync({ source: original, figure: parseTikz(original).figure }, {
      budgetMs: 0,
      yieldControl: async () => { if (!paused) { paused = true; await gate; } }
    });
    const latest = original.replace("(3,0)", "(30,0)");
    session.evaluate({ source: latest, figure: parseTikz(latest).figure });
    resume();
    await pending;
    const edited = latest.replace("(1,0)", "(10,0)");
    const figure = parseTikz(edited).figure;
    const next = session.evaluate({ source: edited, figure, hints: { changedSourceIds: [figure.body[0].id] } });
    expect(next.stats.strategy).toBe("incremental");
    expect(next.semantic).toEqual(evaluateTikzFigure(figure, edited));
  });

  it("matches synchronous full and selective evaluation across pauses inside scopes", async () => {
    let inBatch = false;
    let yields = 0;
    const work = {
      budgetMs: 0,
      run: <T>(operation: () => T): T => {
        expect(inBatch).toBe(false);
        inBatch = true;
        try { return operation(); } finally { inBatch = false; }
      },
      yieldControl: async () => { expect(inBatch).toBe(false); yields++; }
    };
    const figure = parseTikz(source).figure;
    expect(await evaluateTikzFigureAsync(figure, source, {}, work)).toEqual(evaluateTikzFigure(figure, source));
    const session = createIncrementalSemanticSession();
    const initial = session.evaluate({ source, figure });
    const sourceId = initial.semantic.scene.elements.find(element => element.kind === "Text" && element.text === "Before")!.sourceRef.sourceId;
    const sync = session.fork();
    const edited = source.replace("Before", "After a longer label");
    const input = { source: edited, figure: parseTikz(edited).figure, hints: { changedSourceIds: [sourceId] } };
    const result = await session.evaluateAsync(input, work);
    expect(result).toEqual(sync.evaluate(input));
    expect(result.stats.strategy).toBe("incremental");
    expect(yields).toBeGreaterThan(10);
  });

  it("cancels without committing a partial run or mutating its earlier snapshot", async () => {
    const session = createIncrementalSemanticSession();
    const initial = session.evaluate({ source, figure: parseTikz(source).figure });
    const saved = JSON.stringify(initial);
    const sourceId = initial.semantic.scene.elements.find(element => element.kind === "Text" && element.text === "Before")!.sourceRef.sourceId;
    const reference = session.fork();
    const controller = new AbortController();
    let yields = 0;
    const edited = source.replace("Before", "Abandoned edit");
    await expect(session.evaluateAsync({ source: edited, figure: parseTikz(edited).figure }, {
      budgetMs: 0, signal: controller.signal,
      yieldControl: async () => { if (++yields === 3) controller.abort(); }
    })).rejects.toMatchObject({ name: "AbortError" });
    const latest = source.replace("Before", "Latest");
    const input = { source: latest, figure: parseTikz(latest).figure, hints: { changedSourceIds: [sourceId] } };
    expect(session.evaluate(input)).toEqual(reference.evaluate(input));
    expect(JSON.stringify(initial)).toBe(saved);
  });

  it("keeps text render scopes independent when another render runs during a pause", async () => {
    const textEngine = await createTexNodeTextEngine();
    const expected = await renderTikzToSvgAsync(source, { textEngine });
    let interrupted = false;
    const actual = await renderTikzToSvgAsync(source, {
      textEngine,
      cooperative: { budgetMs: 0, yieldControl: async () => {
        if (interrupted) return;
        interrupted = true;
        await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}\node {Other document};\end{tikzpicture}`, { textEngine });
      } }
    });
    expect(actual.svg.svg).toBe(expected.svg.svg);
    expect(actual.textLayoutContext).not.toBe(expected.textLayoutContext);
  });
});
