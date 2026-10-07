import { expect, it } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";

it.each([
  "-- (1,1)",
  "circle (1)",
  "rectangle (1,1)",
  "-- (1,0) -- (1,1) -- cycle",
  "grid (2,2)",
  "plot coordinates {(0,0) (1,1) (2,0)}"
])("renders a bare macro followed by %s (#29)", path => {
  const source = String.raw`\newcommand{\sk}[1]{\node at (1,1.2) {#1}; \draw (0,0) rectangle (2,1);}
\begin{tikzpicture}
  \sk{A}
  \draw[blue] (0,0) ${path};
\end{tikzpicture}
\begin{tikzpicture}
  \sk{B}
  \draw[blue] (0,0) ${path};
\end{tikzpicture}`;
  for (const activeFigureId of ["figure:0", "figure:1"]) {
    const result = renderTikzToSvg(source, { parse: { activeFigureId, includeContextDefinitions: true } });
    expect(result.parse.diagnostics).toEqual([]);
    expect(result.semantic.diagnostics).toEqual([]);
    expect(result.semantic.scene.elements.filter(element => element.kind === "Text").map(element => element.text))
      .toEqual([activeFigureId === "figure:0" ? "A" : "B"]);
    expect(result.semantic.scene.elements.filter(element => element.kind !== "Text").length).toBeGreaterThanOrEqual(2);
  }
});

it("expands consecutive bare calls before a following path keyword (#29)", () => {
  const source = String.raw`\begin{tikzpicture}
\newcommand{\mark}[2][red]{\node[#1] at (0,0) {#2};}
\mark[blue]{A}
\mark{B}
\draw (0,0) circle (1);
\end{tikzpicture}`;
  const result = renderTikzToSvg(source);
  expect(result.parse.diagnostics).toEqual([]);
  expect(result.semantic.diagnostics).toEqual([]);
  expect(result.semantic.scene.elements.filter(element => element.kind === "Text").map(element => element.text)).toEqual(["A", "B"]);
  expect(result.semantic.scene.elements.some(element => element.kind === "Circle")).toBe(true);
});
