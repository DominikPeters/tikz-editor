import { expect, it } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";

it.each([
  "-- (1,1)",
  "circle (1)",
  "rectangle (1,1)",
  "-- (1,0) -- (1,1) -- cycle",
  "grid (2,2)",
  "plot coordinates {(0,0) (1,1) (2,0)}",
  "to (1,1)",
  "edge (1,1)",
  "to[bend left] (1,1)",
  "-- (1,1) node {label}",
  "child {node {child}}",
  "svg {M 0 0 L 1 1}",
  'svg "M 0 0 L 1 1"',
  "-- (1,1) coordinate (end)",
  "foreach \\x in {1,2} { -- (\\x,1) }",
  "\\foreach \\x in {1,2} { -- (\\x,1) }"
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
      .toEqual([activeFigureId === "figure:0" ? "A" : "B", ...(path.includes("{label}") ? ["label"] : path.includes("{child}") ? ["child"] : [])]);
    expect(result.semantic.scene.elements.filter(element => element.kind !== "Text").length).toBeGreaterThanOrEqual(2);
  }
});

it.each(["let \\p1=(1,1) in (\\p1)", "decorate { -- (1,1) }"])(
  "keeps diagnostics for a supported parser operation after a bare macro: %s", path => {
    const following = String.raw`\draw (0,0) ${path};`;
    const control = renderTikzToSvg(String.raw`\begin{tikzpicture}${following}\end{tikzpicture}`);
    const result = renderTikzToSvg(String.raw`\begin{tikzpicture}\newcommand{\mark}{\node at (0,0) {A};}\mark
${following}\end{tikzpicture}`);
    expect(result.parse.diagnostics).toEqual([]);
    expect(result.semantic.diagnostics.map(diagnostic => diagnostic.code)).toEqual(control.semantic.diagnostics.map(diagnostic => diagnostic.code));
    expect(result.semantic.scene.elements.some(element => element.kind === "Text" && element.text === "A")).toBe(true);
  }
);

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
