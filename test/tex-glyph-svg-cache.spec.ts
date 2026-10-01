import { describe, expect, it } from "vitest";
import { texGlyphSvgPath } from "../packages/core/src/text/tex/fonts/glyph-svg.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/fonts/computer-modern.js";
import type { ResolvedTexFont } from "../packages/core/src/text/tex/fonts/types.js";
import {
  texHBoxLocalX,
  texHBoxLocalY,
  texLength,
} from "../packages/core/src/text/tex/coordinates.js";
import { defaultTexMathFontProfile } from "../packages/core/src/text/tex/math/font-profile.js";
import type { TexMathGlyphLayoutItem } from "../packages/core/src/text/tex/math/layout.js";
import { texMathGlyphVisualBounds } from "../packages/core/src/text/tex/math/render-svg.js";

function fontWithPath(path: string) {
  const base = computerModernTexMetricProvider.resolveFont();
  const glyphs: Record<string, string> = { 65: path };
  const font: ResolvedTexFont = {
    ...base,
    data: { ...base.data, glyphs },
  };
  return { font, glyphs };
}

function visualBounds(font: ResolvedTexFont, atPt: number, originX = 0, originY = 0) {
  const item: TexMathGlyphLayoutItem = {
    kind: "glyph",
    fontId: font.id,
    atPt: texLength(atPt),
    family: "text",
    code: 65,
    text: "A",
    x: texHBoxLocalX(2),
    y: texHBoxLocalY(3),
    width: texLength(0),
    height: texLength(0),
    depth: texLength(0),
    italicCorrection: texLength(0),
    sourceSpan: { start: 0, end: 1 },
  };
  const profile = {
    ...defaultTexMathFontProfile,
    metricProvider: {
      shapeText: computerModernTexMetricProvider.shapeText.bind(computerModernTexMetricProvider),
      resolveFont: () => ({ ...font, atPt: item.atPt }),
    },
  };
  return texMathGlyphVisualBounds(item, profile, originX, originY);
}

describe("cached TeX glyph outlines", () => {
  it("escapes paths and refreshes changed glyph data", () => {
    const { font, glyphs } = fontWithPath('M0 0 &"<>');
    expect(texGlyphSvgPath(font, 65)).toBe("M0 0 &amp;&quot;&lt;&gt;");
    expect(texGlyphSvgPath({ ...font, atPt: texLength(20) }, 65)).toBe(
      "M0 0 &amp;&quot;&lt;&gt;"
    );
    glyphs[65] = "M1 2 &";
    expect(texGlyphSvgPath(font, 65)).toBe("M1 2 &amp;");
    delete glyphs[65];
    expect(texGlyphSvgPath(font, 65)).toBe("");
  });

  it("isolates different font data even when font IDs match", () => {
    const first = fontWithPath("M0 0 L1 2").font;
    const second = fontWithPath("M3 4 L5 6").font;
    expect(second.id).toBe(first.id);
    expect(texGlyphSvgPath(first, 65)).toBe("M0 0 L1 2");
    expect(texGlyphSvgPath(second, 65)).toBe("M3 4 L5 6");
    expect(visualBounds(first, 10)).toEqual({ xStart: 2, xEnd: 3, yStart: 3, yEnd: 5 });
    expect(visualBounds(second, 10)).toEqual({ xStart: 5, xEnd: 7, yStart: 7, yEnd: 9 });
  });

  it("transforms cached control-point bounds for each size and placement", () => {
    const { font } = fontWithPath("M-1 -2 C0 5 3 -4 2 1");
    expect(visualBounds(font, 10)).toEqual({ xStart: 1, xEnd: 5, yStart: -1, yEnd: 8 });
    expect(visualBounds(font, 20, 10, 20)).toEqual({ xStart: 10, xEnd: 18, yStart: 15, yEnd: 33 });
    expect(visualBounds(font, -10)).toEqual({ xStart: -1, xEnd: 3, yStart: -2, yEnd: 7 });
    expect(visualBounds(font, 0)).toEqual({ xStart: 2, xEnd: 2, yStart: 3, yEnd: 3 });
  });

  it("refreshes changed paths and caches missing control points safely", () => {
    const { font, glyphs } = fontWithPath("M0 0 L1 2");
    expect(visualBounds(font, 10)?.xEnd).toBe(3);
    glyphs[65] = "M3 4 L5 6";
    expect(visualBounds(font, 10)).toEqual({ xStart: 5, xEnd: 7, yStart: 7, yEnd: 9 });
    glyphs[65] = " ";
    expect(visualBounds(font, 10)).toBeNull();
    expect(visualBounds(font, 20)).toBeNull();
    glyphs[65] = "M0 0 L2 2";
    expect(visualBounds(font, 10)?.xEnd).toBe(4);
    delete glyphs[65];
    expect(visualBounds(font, 10)).toBeNull();
  });
});
