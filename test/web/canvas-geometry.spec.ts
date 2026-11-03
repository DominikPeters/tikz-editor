import { describe, expect, it } from "vitest";
import { pickGridStepPt } from "../../packages/core/src/edit/snapping/grid-snaps.js";
import { GRID_MINOR_TARGET_PX } from "../../packages/core/src/edit/snapping/types.js";
import { clientToSvgPoint, clientToWorldPoint, resolveOverlayGridSteps } from "../../packages/app/src/ui/canvas-panel/geometry.js";
import { clientToSvg, clientToWorld } from "../../packages/app/src/ui/coords/convert.js";
import { clientPoint, px } from "../../packages/core/src/coords/index.js";

type Matrix = Pick<DOMMatrix, "a" | "b" | "c" | "d" | "e" | "f">;

function svgWithInverse(inverse: Matrix | null): SVGSVGElement {
  return {
    getScreenCTM: () => inverse ? { inverse: () => inverse } : null,
    createSVGPoint: () => ({
      x: 0, y: 0,
      matrixTransform(matrix: Matrix) {
        return { x: matrix.a * this.x + matrix.c * this.y + matrix.e, y: matrix.b * this.x + matrix.d * this.y + matrix.f };
      }
    })
  } as unknown as SVGSVGElement;
}

describe("client coordinate conversion", () => {
  const point = clientPoint(px(420), px(300));
  const viewBox = { x: 17, y: -31, width: 500, height: 400 };
  const transform = { translateX: 47, translateY: -19, scale: 2.5 };
  const rect: DOMRect = { x: 123, y: 61, left: 123, top: 61, width: 800, height: 600, right: 923, bottom: 661, toJSON: () => ({}) };
  // Screen mapping: client = viewport origin + pan + zoom * (svg - viewBox origin).
  const liveSvg = svgWithInverse({ a: .4, b: 0, c: 0, d: .4, e: -51, f: -47.8 });

  it.each([null, svgWithInverse(null)])("does not label client coordinates as SVG or world coordinates without a screen CTM (%s)", svg => {
    expect(clientToSvgPoint(point, svg)).toBeNull();
    expect(clientToWorldPoint(point, svg, viewBox)).toBeNull();
    expect(clientToSvg(point, svg)).toBeNull();
  });

  it.each([null, svgWithInverse(null)])("converts with the real viewport offset, pan, zoom and viewBox when the CTM is absent (%s)", svg => {
    const result = clientToSvg(point, svg, rect, transform, viewBox);
    expect(result?.x).toBeCloseTo(117);
    expect(result?.y).toBeCloseTo(72.2);
    const world = clientToWorld(point, svg, rect, transform, viewBox);
    expect(world?.x).toBeCloseTo(117);
    expect(world?.y).toBeCloseTo(265.8);
    expect(result).toEqual(clientToSvgPoint(point, liveSvg));
  });

  it("requires the viewport rect for a fallback, even when the canvas transform and viewBox are known", () => {
    expect(clientToSvg(point, null, null, transform, viewBox)).toBeNull();
    expect(clientToWorld(point, null, null, transform, viewBox)).toBeNull();
  });

  it("uses the live CTM when the viewport is unavailable", () => {
    const result = clientToSvg(point, liveSvg, null, transform, viewBox);
    expect(result?.x).toBeCloseTo(117);
    expect(result?.y).toBeCloseTo(72.2);
    expect(clientToWorldPoint(point, liveSvg, viewBox)?.y).toBeCloseTo(265.8);
  });

  it("uses the screen matrix for rotated or skewed SVGs instead of the viewport fallback", () => {
    const svg = svgWithInverse({ a: 0, b: -.5, c: .25, d: 0, e: 7, f: 11 });
    expect(clientToSvg(point, svg, rect, transform, viewBox)).toEqual({ x: 82, y: -199 });
  });

  it("rejects a non-finite CTM result, using a complete fallback when available", () => {
    const svg = svgWithInverse({ a: Number.NaN, b: 0, c: 0, d: Number.NaN, e: 0, f: 0 });
    expect(clientToSvgPoint(point, svg)).toBeNull();
    expect(clientToWorldPoint(point, svg, viewBox)).toBeNull();
    expect(clientToSvg(point, svg, rect, transform, viewBox)).toEqual(clientToSvg(point, null, rect, transform, viewBox));
  });
});

describe("canvas overlay grid/ruler steps", () => {
  it("keeps overlay minor steps aligned with snapping grid steps across zoom levels", () => {
    const scales = [0.35, 0.75, 1, 1.5, 2, 3.5, 8];

    for (const scale of scales) {
      const overlay = resolveOverlayGridSteps(scale);
      const snapMinor = pickGridStepPt(scale, GRID_MINOR_TARGET_PX);

      expect(overlay.minorStep).toBeCloseTo(snapMinor, 9);
      expect(overlay.majorStep).toBeCloseTo(snapMinor * 5, 9);
    }
  });
});
