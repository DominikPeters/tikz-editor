/**
 * The TikZ context of an axis (behaviour AC1-AC4): picture options, an
 * enclosing scope, `every picture`, `every path`, `every mark`, `every node`.
 */
import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import type { ScenePath } from "../packages/core/src/semantic/types.js";

const AXIS = String.raw`\begin{axis}[xmin=0,xmax=2,ymin=0,ymax=3]
\addplot coordinates {(0,1) (1,2)};
\addlegendentry{a}
\addplot[blue,thick] coordinates {(0,2) (2,1)};
\draw (axis cs:0,0) -- (axis cs:1,1);
\end{axis}`;

function render(pre: string, pictureOptions: string, body = AXIS) {
  const source = `\\pgfplotsset{compat=1.18}\n${pre}\\begin{tikzpicture}${pictureOptions ? `[${pictureOptions}]` : ""}\n${body}\n\\end{tikzpicture}`;
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  const semantic = evaluateTikzFigure(parsed.figure, source);
  const paths = semantic.scene.elements.filter((element): element is ScenePath => element.kind === "Path");
  const byId = (pattern: RegExp) => paths.filter((path) => pattern.test(path.id) || pattern.test(path.sourceRef.sourceId));
  return { semantic, paths, byId };
}

const box = (paths: ScenePath[]) => paths.find((path) => path.id.endsWith(":box"));
const lines = (paths: ScenePath[]) => paths.filter((path) => /:plot:\d+$/u.test(path.sourceRef.sourceId) && path.id.endsWith(":line"));
const embedded = (paths: ScenePath[]) => paths.find((path) => path.sourceRef.sourceId.startsWith("path:"));

describe("pgfplots: the TikZ context of an axis (behaviour AC)", () => {
  it("AC1: resets the picture's line width and draw colour at the axis, keeps its colour", () => {
    const { paths } = render("", "thick, draw=green, red");
    expect(box(paths)?.style.lineWidth).toBeCloseTo(0.4, 6);
    expect(box(paths)?.style.stroke).toBe("#ff0000");
    expect(lines(paths)[0]?.style.lineWidth).toBeCloseTo(0.4, 6);
    expect(embedded(paths)?.style.lineWidth).toBeCloseTo(0.4, 6);
    expect(embedded(paths)?.style.stroke).toBe("#ff0000");
  });

  it("AC1: applies every picture again after the reset", () => {
    const { paths } = render("\\tikzset{every picture/.style={line width=1.5pt}}\n", "");
    expect(box(paths)?.style.lineWidth).toBeCloseTo(1.5, 6);
    expect(lines(paths)[0]?.style.lineWidth).toBeCloseTo(1.5, 6);
    // `\addplot[blue,thick]` sets its own width.
    expect(lines(paths)[1]?.style.lineWidth).toBeCloseTo(0.8, 6);
  });

  it("AC2: every path wins over the plot styles and reaches the box and the legend image, not the marks", () => {
    const { paths } = render("", "every path/.style={line width=1pt, orange}");
    expect(lines(paths).map((path) => path.style.lineWidth)).toEqual([1, 1]);
    expect(new Set(lines(paths).map((path) => path.style.stroke)).size).toBe(1);
    expect(box(paths)?.style.lineWidth).toBe(1);
    const marks = paths.filter((path) => /:mark:\d+:\d+$/u.test(path.id) && path.style.stroke);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((path) => Math.abs(path.style.lineWidth - 0.4) < 1e-9)).toBe(true);
  });

  it("AC3: every mark scales the marks; mark options replaces it", () => {
    const extent = (pathsIn: ScenePath[], plot: number) => {
      const mark = pathsIn.find((path) => path.sourceRef.sourceId === `axis:1:plot:${String(plot)}` && /:mark:0:0$/u.test(path.id));
      const xs = (mark?.commands ?? []).flatMap((c) => (c.kind === "Z" || c.kind === "A" ? [] : [c.to.x]));
      return Math.max(...xs) - Math.min(...xs);
    };
    const body = String.raw`\begin{axis}[xmin=0,xmax=2,ymin=0,ymax=3]
\addplot coordinates {(1,1)};
\addplot+[mark options={fill=yellow}] coordinates {(1,2)};
\end{axis}`;
    const plain = render("", "", body);
    const scaled = render("", "every mark/.append style={scale=2}", body);
    expect(extent(scaled.paths, 0) / extent(plain.paths, 0)).toBeCloseTo(2, 6);
    expect(extent(scaled.paths, 1) / extent(plain.paths, 1)).toBeCloseTo(1, 6);
  });

  it("AC4: diagnoses every node with draw", () => {
    const { semantic } = render("\\tikzset{every node/.style={draw}}\n", "");
    expect(semantic.diagnostics.map((d) => d.code)).toContain("unsupported-pgfplots-every-node-draw");
  });
});
