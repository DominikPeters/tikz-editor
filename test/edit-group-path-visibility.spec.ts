import { describe, expect, it } from "vitest";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";

const picture = (producer: string, definition = "", fallback = "") => String.raw`\begin{tikzpicture}
${definition}
${fallback}
\path[${producer}] (-1,2) -- (1,2);
\draw (3,0) -- (4,0);
\path[name path=cut] (0,0) -- (0,3);
\draw[name intersections={of=line and cut,by=hit}] (hit) -- (1,0);
\end{tikzpicture}`;

describe("grouped named path visibility", () => {
  it.each([
    ["name path=line", "", ""],
    ["line style", String.raw`\tikzset{line style/.style={name path=line}}`, ""],
    ["name path=line", "", String.raw`\path[name path=line] (-1,1) -- (1,1);`]
  ])("refuses to hide a local path consumed outside the group (%s, %s, %s)", (producer, definition, fallback) => {
    const source = picture(producer, definition, fallback);
    const figure = parseTikz(source).figure;
    expect(evaluateTikzFigure(figure, source).diagnostics).toEqual([]);
    const paths = figure.body.filter(statement => statement.kind === "Path");
    const offset = fallback ? 1 : 0;
    const result = applyEditAction(source, [], { kind: "groupElements", elementIds: [paths[offset].id, paths[offset + 1].id] });
    expect(result).toMatchObject({ kind: "unsupported", reason: expect.stringContaining("named path") });
  });

  it("includes consumers inside an unselected sibling scope", () => {
    const source = picture("name path=line")
      .replace("\\draw[name intersections", "\\begin{scope}\\draw[name intersections")
      .replace("\\end{tikzpicture}", "\\end{scope}\n\\end{tikzpicture}");
    const paths = parseTikz(source).figure.body.filter(statement => statement.kind === "Path");
    expect(applyEditAction(source, [], { kind: "groupElements", elementIds: [paths[0].id, paths[1].id] }))
      .toMatchObject({ kind: "unsupported", reason: expect.stringContaining("named path") });
  });

  it("does not refuse a local assignment whose existing scope already limits its visibility", () => {
    const source = picture("name path=line", "", String.raw`\begin{scope}\path[name path=line] (-1,1) -- (1,1);\end{scope}`);
    const figure = parseTikz(source).figure;
    const scope = figure.body.find(statement => statement.kind === "Scope")!;
    const paths = figure.body.filter(statement => statement.kind === "Path");
    const result = applyEditAction(source, [], { kind: "groupElements", elementIds: [scope.id, paths[1].id] });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expect(evaluateTikzFigure(parseTikz(result.newSource).figure, result.newSource).diagnostics).toEqual([]);
  });

  it.each([
    ["name path global=line", ""],
    ["line style", String.raw`\tikzset{line style/.style={name path global=line}}`]
  ])("allows global named paths to remain available outside a new group (%s)", (producer, definition) => {
    const source = picture(producer, definition);
    const paths = parseTikz(source).figure.body.filter(statement => statement.kind === "Path");
    const result = applyEditAction(source, [], { kind: "groupElements", elementIds: [paths[0].id, paths[1].id] });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    const figure = parseTikz(result.newSource).figure;
    expect(evaluateTikzFigure(figure, result.newSource).diagnostics).toEqual([]);
  });

  it("allows a local path when all of its consumers join the same group", () => {
    const source = picture("name path=line");
    const figure = parseTikz(source).figure;
    const result = applyEditAction(source, [], { kind: "groupElements", elementIds: figure.body.map(statement => statement.id) });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    const grouped = parseTikz(result.newSource).figure;
    expect(evaluateTikzFigure(grouped, result.newSource).diagnostics).toEqual([]);
  });
});
