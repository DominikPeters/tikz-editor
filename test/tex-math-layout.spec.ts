import { describe, expect, it } from "vitest";
import {
  computerModernTexMetricProvider,
  layoutTexMathList,
  parseTexMath,
  resolveMathGlyph,
  type TexMathChildHListLayoutItem,
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

  it("lays out simple superscripts with TeX script shifts and script space", () => {
    const result = layout("x^2");

    expect(result.supported).toBe(true);
    expect(result.hlist?.items.map((item) => item.kind)).toEqual(["glyph", "hlist"]);
    expect(result.hlist?.width).toBeCloseTo(10.20141, 5);
    const script = result.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(script).toMatchObject({
      kind: "hlist",
      role: "superscript",
      x: expect.closeTo(5.71528, 5),
      y: expect.closeTo(-3.62892, 5),
      width: expect.closeTo(4.48613, 5),
    });
    expect(script?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmr7",
      code: 50,
      x: 0,
      y: 0,
    });
  });

  it("lays out simple subscripts and combined scripts with TeX italic-correction offsets", () => {
    const subscript = layout("x_i");
    expect(subscript.supported).toBe(true);
    expect(subscript.hlist?.width).toBeCloseTo(9.04457, 5);
    expect(subscript.hlist?.items[1]).toMatchObject({
      kind: "hlist",
      role: "subscript",
      x: expect.closeTo(5.71528, 5),
      y: expect.closeTo(1.5, 5),
      width: expect.closeTo(3.3293, 5),
    });

    const combined = layout("y_i^2");
    expect(combined.supported).toBe(true);
    expect(combined.hlist?.items.map((item) => item.kind)).toEqual(["glyph", "hlist", "hlist"]);
    expect(combined.hlist?.width).toBeCloseTo(9.747739, 6);
    expect(combined.hlist?.items[1]).toMatchObject({
      kind: "hlist",
      role: "superscript",
      x: expect.closeTo(5.26161, 5),
      y: expect.closeTo(-3.62892, 5),
    });
    expect(combined.hlist?.items[2]).toMatchObject({
      kind: "hlist",
      role: "subscript",
      x: expect.closeTo(4.90282, 5),
      y: expect.closeTo(2.602982, 6),
    });
  });

  it("lays out grouped list nuclei and scripts on grouped nuclei", () => {
    const group = layout("{x+y}");
    expect(group.supported).toBe(true);
    expect(group.hlist?.items).toMatchObject([
      {
        kind: "hlist",
        role: "nucleus",
        x: 0,
        y: 0,
      },
    ]);
    expect(group.hlist?.width).toBeCloseTo(23.199158, 6);

    const scriptedGroup = layout("{x+y}^2");
    expect(scriptedGroup.supported).toBe(true);
    expect(scriptedGroup.hlist?.items.map((item) => item.kind)).toEqual(["hlist", "hlist"]);
    expect(scriptedGroup.hlist?.items[1]).toMatchObject({
      kind: "hlist",
      role: "superscript",
      x: expect.closeTo(23.199158, 6),
      y: expect.closeTo(-3.62892, 5),
    });
    expect(scriptedGroup.hlist?.width).toBeCloseTo(27.685287, 6);
  });

  it("lays out nested scripts through recursive script lists", () => {
    const result = layout("x^{y_i}");

    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(13.438737, 6);
    const superscript = result.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(superscript).toMatchObject({
      kind: "hlist",
      role: "superscript",
      x: expect.closeTo(5.71528, 5),
      y: expect.closeTo(-3.62892, 5),
    });
    expect(superscript?.items.map((item) => item.kind)).toEqual(["glyph", "hlist"]);
  });

  it("lays out simple fractions as TeX-style vertical nuclei with a rule", () => {
    const result = layout(String.raw`\frac{1}{2}`);

    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(6.386129, 6);
    expect(result.hlist?.height).toBeCloseTo(8.448428, 6);
    expect(result.hlist?.depth).toBeCloseTo(3.44841, 6);
    expect(result.hlist?.items.map((item) => item.kind)).toEqual(["hlist", "rule", "hlist"]);
    expect(result.hlist?.items[0]).toMatchObject({
      kind: "hlist",
      role: "nucleus",
      x: expect.closeTo(1.2, 6),
      y: expect.closeTo(-3.93732, 5),
    });
    expect(result.hlist?.items[1]).toMatchObject({
      kind: "rule",
      role: "fraction-rule",
      x: expect.closeTo(1.2, 6),
      y: expect.closeTo(-2.699995, 6),
      width: expect.closeTo(3.986129, 6),
      height: expect.closeTo(0.39999, 6),
    });
    expect(result.hlist?.items[2]).toMatchObject({
      kind: "hlist",
      role: "nucleus",
      x: expect.closeTo(1.2, 6),
      y: expect.closeTo(3.44841, 5),
    });
  });

  it("lays out simple radicals with TeX-style radical glyph shifts and overbar rule", () => {
    const result = layout(String.raw`\sqrt{x}`);

    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(14.04864, 6);
    expect(result.hlist?.height).toBeCloseTo(8.002754, 6);
    expect(result.hlist?.depth).toBeCloseTo(2.397236, 6);
    expect(result.hlist?.items.map((item) => item.kind)).toEqual(["glyph", "rule", "hlist"]);
    expect(result.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmsy10",
      code: 112,
      x: 0,
      y: expect.closeTo(-7.202774, 6),
      width: expect.closeTo(8.33336, 6),
    });
    expect(result.hlist?.items[1]).toMatchObject({
      kind: "rule",
      role: "radical-rule",
      x: expect.closeTo(8.33336, 6),
      y: expect.closeTo(-7.602764, 6),
      width: expect.closeTo(5.71528, 6),
      height: expect.closeTo(0.39999, 6),
    });
    expect(result.hlist?.items[2]).toMatchObject({
      kind: "hlist",
      role: "nucleus",
      x: expect.closeTo(8.33336, 6),
      y: 0,
    });
  });

  it("selects TeX next-larger radical glyphs for taller radicals", () => {
    const result = layout(String.raw`\sqrt{\frac{1}{2}}`);

    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(16.386159, 6);
    expect(result.hlist?.height).toBeCloseTo(12.350078, 6);
    expect(result.hlist?.depth).toBeCloseTo(6.050092, 6);
    expect(result.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 113,
      y: expect.closeTo(-11.550098, 6),
      width: expect.closeTo(10.00003, 6),
    });
    expect(result.hlist?.items[1]).toMatchObject({
      kind: "rule",
      role: "radical-rule",
      x: expect.closeTo(10.00003, 6),
      y: expect.closeTo(-11.950088, 6),
      width: expect.closeTo(6.386129, 6),
    });
  });

  it("keeps extensible radicals unsupported until varchar assembly is implemented", () => {
    const result = layout(String.raw`\sqrt{\sqrt{\sqrt{\sqrt{\frac{1}{2}}}}}`);

    expect(result.supported).toBe(false);
    expect(result.hlist).toBeNull();
    expect(result.errors[0]?.message).toMatch(/Only simple glyph math atoms/);
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
    for (const source of [String.raw`\unknown{x}`]) {
      const parsed = parseTexMath(source);
      expect(parsed.diagnostics).toMatchObject([
        {
          code: "unsupported-command",
        },
      ]);
      const result = layoutTexMathList(parsed.list);
      expect(result.supported).toBe(false);
      expect(result.hlist).toBeNull();
      expect(result.errors[0]?.message).toMatch(/Unsupported TeX math item|Only simple glyph math atoms/);
    }
  });
});
