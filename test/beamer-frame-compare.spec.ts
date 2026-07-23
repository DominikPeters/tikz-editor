import { describe, expect, it } from "vitest";

import {
  compareBeamerPageTraces,
  type BeamerTraceGlyph,
  type NativeBeamerPageTrace,
  type OracleBeamerPageTrace,
} from "../scripts/lib/beamer-frame-compare.mjs";

const COORDINATE_SYSTEM = {
  unit: "tex-pt",
  origin: "top-left",
  yAxis: "down",
} as const;

function glyph(overrides: Partial<BeamerTraceGlyph> = {}): BeamerTraceGlyph {
  return {
    code: 72,
    x: 10,
    y: 20,
    width: 7,
    height: 7,
    depth: 0,
    fontName: "lmsans10-regular",
    fontSize: 10,
    ...overrides,
  };
}

describe("Beamer structural frame comparison", () => {
  it("reports rectangle edges and absolute page glyph deltas", () => {
    const native: NativeBeamerPageTrace = {
      coordinateSystem: COORDINATE_SYSTEM,
      page: { x: 0, y: 0, width: 160, height: 90 },
      untracedRegions: [{
        kind: "embedded-tikz",
        itemId: "tikz:0",
        bounds: { x: 80, y: 20, width: 60, height: 50 },
      }],
      rectangles: [{
        id: "frame:0:frame-title:background",
        role: "frame-title",
        x: 0,
        y: 0,
        width: 160,
        height: 12,
      }],
      lines: [{
        id: "frame:0:body:line:0",
        paragraphId: "frame:0:body",
        role: "body",
        lineIndex: 0,
        sourceSpan: { from: 10, to: 11 },
        text: "H",
        x: 10,
        baselineY: 20,
        glyphs: [glyph()],
      }],
      glyphs: [],
    };
    const oracle: OracleBeamerPageTrace = {
      coordinateSystem: COORDINATE_SYSTEM,
      page: { x: 0, y: 0, width: 160, height: 90 },
      shipoutOrigin: { x: -72.27, y: -72.27 },
      boxes: [],
      rules: [{
        path: "root.1",
        x: 0,
        y: 0,
        width: 160,
        height: 10,
        depth: 0,
        totalHeight: 10,
      }],
      glyphs: [],
      lines: [
        {
          text: "H",
          x: 9.5,
          baselineY: 18,
          glyphs: [glyph({ x: 9.5, y: 18 })],
        },
        {
          text: "diagram",
          x: 100,
          baselineY: 40,
          glyphs: [glyph({ x: 100, y: 40 })],
        },
      ],
    };

    const comparison = compareBeamerPageTraces(native, oracle);

    expect(comparison.summary).toEqual({
      matchedRectangles: 1,
      unmatchedNativeRectangles: 0,
      unmatchedOracleRules: 0,
      maxRectangleEdgeDeltaPt: 2,
      matchedTextLines: 1,
      unmatchedNativeTextLines: 0,
      unmatchedOracleTextLines: 0,
      excludedOracleTextLines: 1,
      comparedGlyphs: 1,
      maxAbsoluteGlyphDxPt: 0.5,
      maxAbsoluteGlyphDyPt: 2,
      glyphCodeMatch: true,
      fontMatch: true,
    });
  });
});
