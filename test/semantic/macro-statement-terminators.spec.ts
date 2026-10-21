import { expect, it } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";

it.each(["", "\n", " \t\r\n", "\n% trailing comment\n", "\n% ignored semicolon ;\n% another comment\n"])(
  "renders a macro with trailing trivia %j and an invocation semicolon (#30)", trivia => {
    const source = String.raw`\newcommand{\skel}[1]{\draw (0,0) -- (2,0); \node at (1,1.2) {#1};${trivia}}
\begin{tikzpicture}\skel{A};\end{tikzpicture}
\begin{tikzpicture}\skel{B};\end{tikzpicture}`;
    for (const activeFigureId of ["figure:0", "figure:1"]) {
      const result = renderTikzToSvg(source, { parse: { activeFigureId, includeContextDefinitions: true } });
      expect(result.parse.diagnostics).toEqual([]);
      expect(result.semantic.diagnostics).toEqual([]);
      expect(result.semantic.scene.elements.map(element => element.kind)).toEqual(["Path", "Text"]);
      expect(result.semantic.scene.elements.find(element => element.kind === "Text")?.text).toBe(activeFigureId === "figure:0" ? "A" : "B");
    }
  });

it("keeps the call's sole terminator when the macro body has none (#30)", () => {
  const source = String.raw`\newcommand{\stroke}{\draw (0,0) -- (2,0)
}
\begin{tikzpicture}\stroke;\end{tikzpicture}`;
  const result = renderTikzToSvg(source, { parse: { includeContextDefinitions: true } });
  expect(result.parse.diagnostics).toEqual([]);
  expect(result.semantic.diagnostics).toEqual([]);
  expect(result.semantic.scene.elements.map(element => element.kind)).toEqual(["Path"]);
});
