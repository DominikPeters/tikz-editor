import { describe, expect, it } from "vitest";
import {
  computerModernTexMetricProvider,
  layoutTexMathList,
  parseTexMath,
  resolveMathGlyph,
  type TexMathGlyphLayoutItem,
} from "../packages/core/src/text/tex/index.js";

function layout(source: string) {
  const parsed = parseTexMath(source);
  expect(parsed.diagnostics).toEqual([]);
  return layoutTexMathList(parsed.list);
}

function glyphItems(source: string): readonly TexMathGlyphLayoutItem[] {
  const result = layout(source);
  expect(result.supported).toBe(true);
  return result.hlist?.items.filter((item): item is TexMathGlyphLayoutItem => item.kind === "glyph") ?? [];
}

describe("TeX math hlist layout", () => {
  it("resolves default LuaLaTeX math glyph families and codes for simple symbols", () => {
    const parsed = parseTexMath("a1+-=(),");
    const glyphs = parsed.list.items
      .filter((item) => item.kind === "atom" && item.nucleus.kind === "glyph")
      .map((item) => item.kind === "atom" && item.nucleus.kind === "glyph"
        ? resolveMathGlyph(item.nucleus)
        : null);

    expect(glyphs.map((glyph) => glyph && { family: glyph.family, fontId: glyph.font.id, code: glyph.code })).toEqual([
      { family: "letters", fontId: "cmmi10", code: 97 },
      { family: "operators", fontId: "cmr10", code: 49 },
      { family: "operators", fontId: "cmr10", code: 43 },
      { family: "symbols", fontId: "cmsy10", code: 0 },
      { family: "operators", fontId: "cmr10", code: 61 },
      { family: "operators", fontId: "cmr10", code: 40 },
      { family: "operators", fontId: "cmr10", code: 41 },
      { family: "letters", fontId: "cmmi10", code: 59 },
    ]);
  });

  it("lays out glyphs and TeX mu glue in source order", () => {
    const result = layout("a+1");
    expect(result.supported).toBe(true);
    const hlist = result.hlist;
    expect(hlist?.items.map((item) => item.kind)).toEqual([
      "glyph",
      "glue",
      "glyph",
      "glue",
      "glyph",
    ]);
    expect(hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmmi10",
      code: 97,
      x: 0,
      width: 5.2859,
    });
    expect(hlist?.items[1]).toMatchObject({
      kind: "glue",
      x: 5.2859,
      width: 2.222229,
      mu: 4,
    });
    expect(hlist?.items[2]).toMatchObject({
      kind: "glyph",
      fontId: "cmr10",
      code: 43,
      x: 7.508129,
      width: 7.77781,
    });
    expect(hlist?.items[3]).toMatchObject({
      kind: "glue",
      x: 15.285939,
      width: 2.222229,
      mu: 4,
    });
    expect(hlist?.items[4]).toMatchObject({
      kind: "glyph",
      fontId: "cmr10",
      code: 49,
      x: 17.508168,
      width: 5.00002,
    });
    expect(hlist?.width).toBe(22.508188);
    expect(hlist?.height).toBeGreaterThan(6);
  });

  it("adds math italic correction kerns after italic glyphs that need them", () => {
    const result = layout("xy");

    expect(result.supported).toBe(true);
    expect(result.hlist?.items.map((item) => item.kind)).toEqual([
      "glyph",
      "glyph",
      "kern",
    ]);
    expect(result.hlist?.items[1]).toMatchObject({
      kind: "glyph",
      fontId: "cmmi10",
      code: 121,
      width: 4.90282,
      italicCorrection: 0.35879,
    });
    expect(result.hlist?.items[2]).toMatchObject({
      kind: "kern",
      reason: "italic-correction",
      width: 0.35879,
    });
    expect(result.hlist?.width).toBe(10.97689);
  });

  it("uses script-style fonts and script mu units when requested", () => {
    const parsed = parseTexMath("a+1");
    const result = layoutTexMathList(parsed.list, { style: "script" });

    expect(result.supported).toBe(true);
    expect(glyphItems("a").map((glyph) => glyph.fontId)).toEqual(["cmmi10"]);
    expect(result.hlist?.items.map((item) => item.kind)).toEqual([
      "glyph",
      "glyph",
      "glyph",
    ]);
    expect(result.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmmi7",
      code: 97,
    });
    expect(result.hlist?.items[1]).toMatchObject({
      kind: "glyph",
      fontId: "cmr7",
      code: 43,
    });
  });

  it("matches vendored metrics for the generated glyph boxes", () => {
    const [minus, comma] = glyphItems("-,");
    const cmsy = computerModernTexMetricProvider.resolveFont({ fontId: "cmsy10", atPt: 10 });
    const cmmi = computerModernTexMetricProvider.resolveFont({ fontId: "cmmi10", atPt: 10 });

    expect(minus).toMatchObject({
      fontId: "cmsy10",
      code: 0,
      width: expect.closeTo((cmsy.data.chars["0"]?.width ?? 0) * 10, 6),
    });
    expect(comma).toMatchObject({
      fontId: "cmmi10",
      code: 59,
      width: expect.closeTo((cmmi.data.chars["59"]?.width ?? 0) * 10, 6),
    });
  });

  it("reports unsupported constructs instead of producing approximate layout", () => {
    for (const source of ["x^2", String.raw`\frac{1}{2}`, "{x}"]) {
      const result = layout(source);
      expect(result.supported).toBe(false);
      expect(result.hlist).toBeNull();
      expect(result.errors[0]?.message).toContain("Only simple glyph math atoms");
    }
  });
});
