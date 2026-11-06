import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { computeBounds } from "../packages/core/src/semantic/evaluate.js";

// LuaLaTeX/PGF's uninstrumented dimensions, not analytic ellipse extrema.
// Logging pgf@protocolsizes itself commits a pending assignment and changes
// the result; these values were collected only after the completed path.
describe("PGF ellipse picture bounds", () => {
  it("preserves the authored cubic axes and the pending first-control y assignment", () => {
    const result = renderTikzToSvg(String.raw`\begin{tikzpicture}[rotate=-25]\fill (0,0) ellipse[x radius=.325cm,y radius=.35cm];\end{tikzpicture}`);
    const bounds = result.semantic.scene.bounds!;
    expect(bounds.minX).toBeCloseTo(-10.70515, 3);
    expect(bounds.maxX).toBeCloseTo(10.70515, 3);
    expect(bounds.minY).toBeCloseTo(-9.0256, 3);
    expect(bounds.maxY).toBeCloseTo(11.18396, 3);
    // Logical picture bounds can exclude some ink. Selection/geometry
    // measurement must continue to use the tight painted ellipse.
    expect(computeBounds(result.semantic.scene.elements)?.minY).toBeLessThan(bounds.minY);
  });
});
