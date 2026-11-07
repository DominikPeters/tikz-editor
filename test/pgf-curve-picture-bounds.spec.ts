import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

// pgfcorepathconstruct.code.tex's pgf@lt@curveto protocols both controls
// before the endpoint. Picture bounds deliberately exceed the ink bounds.
describe("PGF cubic picture bounds", () => {
  it("includes both controls and stroke padding in the picture box", () => {
    const page = renderTikzToSvg(String.raw`\begin{tikzpicture}\draw (0pt,0pt) .. controls (30pt,20pt) and (-10pt,20pt) .. (20pt,0pt);\end{tikzpicture}`);
    expect(page.semantic.diagnostics).toEqual([]);
    expect(page.semantic.scene.bounds).toMatchObject({ minX: -10.2, minY: -.2, maxX: 30.2, maxY: 20.2 });
  });
  it("protocols the transformed controls", () => {
    const page = renderTikzToSvg(String.raw`\begin{tikzpicture}[rotate=90]\draw (0pt,0pt) .. controls (30pt,20pt) and (-10pt,20pt) .. (20pt,0pt);\end{tikzpicture}`);
    expect(page.semantic.scene.bounds?.minX).toBeCloseTo(-20.2, 6);
    expect(page.semantic.scene.bounds?.maxY).toBeCloseTo(30.2, 6);
    expect(page.semantic.scene.bounds?.minY).toBeCloseTo(-10.2, 6);
  });
});
