import { describe, expect, it } from "vitest";
import {
  computerModernTexMetricProvider,
  layoutTexMathList,
  parseTexMath,
  resolveMathGlyph,
  type TexMathChildHListLayoutItem,
  type TexMathGlyphLayoutItem,
  type TexMathHListItem,
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

function flattenGlyphItems(items: readonly TexMathHListItem[]): readonly TexMathGlyphLayoutItem[] {
  return items.flatMap((item) => {
    if (item.kind === "glyph") {
      return [item];
    }
    if (item.kind === "hlist") {
      return flattenGlyphItems(item.items);
    }
    return [];
  });
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

  it("lays out named Greek and symbol commands through TeX math fonts", () => {
    const result = layout(String.raw`\alpha+\beta=\gamma+\Gamma+\Omega+x\leq y\neq z`);

    expect(result.supported).toBe(true);
    const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
    expect(glyphs.map((glyph) => ({
      fontId: glyph.fontId,
      code: glyph.code,
      sourceSpan: glyph.sourceSpan,
    }))).toEqual([
      { fontId: "cmmi10", code: 11, sourceSpan: { start: 0, end: 6 } },
      { fontId: "cmr10", code: 43, sourceSpan: { start: 6, end: 7 } },
      { fontId: "cmmi10", code: 12, sourceSpan: { start: 7, end: 12 } },
      { fontId: "cmr10", code: 61, sourceSpan: { start: 12, end: 13 } },
      { fontId: "cmmi10", code: 13, sourceSpan: { start: 13, end: 19 } },
      { fontId: "cmr10", code: 43, sourceSpan: { start: 19, end: 20 } },
      { fontId: "cmr10", code: 0, sourceSpan: { start: 20, end: 26 } },
      { fontId: "cmr10", code: 43, sourceSpan: { start: 26, end: 27 } },
      { fontId: "cmr10", code: 10, sourceSpan: { start: 27, end: 33 } },
      { fontId: "cmr10", code: 43, sourceSpan: { start: 33, end: 34 } },
      { fontId: "cmmi10", code: 120, sourceSpan: { start: 34, end: 35 } },
      { fontId: "cmsy10", code: 20, sourceSpan: { start: 35, end: 39 } },
      { fontId: "cmmi10", code: 121, sourceSpan: { start: 40, end: 41 } },
      { fontId: "cmsy10", code: 54, sourceSpan: { start: 41, end: 45 } },
      { fontId: "cmr10", code: 61, sourceSpan: { start: 41, end: 45 } },
      { fontId: "cmmi10", code: 122, sourceSpan: { start: 46, end: 47 } },
    ]);
  });

  it("lays out arrow, set, and logic symbols through TeX math fonts", () => {
    const result = layout(String.raw`A\to B\mapsto C\wedge D\cup E\subseteq F`);

    expect(result.supported).toBe(true);
    const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
    expect(glyphs.map((glyph) => ({
      fontId: glyph.fontId,
      code: glyph.code,
      sourceSpan: glyph.sourceSpan,
    }))).toEqual([
      { fontId: "cmmi10", code: 65, sourceSpan: { start: 0, end: 1 } },
      { fontId: "cmsy10", code: 33, sourceSpan: { start: 1, end: 4 } },
      { fontId: "cmmi10", code: 66, sourceSpan: { start: 5, end: 6 } },
      { fontId: "cmsy10", code: 55, sourceSpan: { start: 6, end: 13 } },
      { fontId: "cmsy10", code: 33, sourceSpan: { start: 6, end: 13 } },
      { fontId: "cmmi10", code: 67, sourceSpan: { start: 14, end: 15 } },
      { fontId: "cmsy10", code: 94, sourceSpan: { start: 15, end: 21 } },
      { fontId: "cmmi10", code: 68, sourceSpan: { start: 22, end: 23 } },
      { fontId: "cmsy10", code: 91, sourceSpan: { start: 23, end: 27 } },
      { fontId: "cmmi10", code: 69, sourceSpan: { start: 28, end: 29 } },
      { fontId: "cmsy10", code: 18, sourceSpan: { start: 29, end: 38 } },
      { fontId: "cmmi10", code: 70, sourceSpan: { start: 39, end: 40 } },
    ]);
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

  it("lays out text command nuclei through the document text font profile", () => {
    const result = layout(String.raw`x+\text{if}`);

    expect(result.supported).toBe(true);
    const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
    expect(glyphs.map((glyph) => ({
      fontId: glyph.fontId,
      code: glyph.code,
      sourceSpan: glyph.sourceSpan,
    }))).toEqual([
      { fontId: "cmmi10", code: 120, sourceSpan: { start: 0, end: 1 } },
      { fontId: "cmr10", code: 43, sourceSpan: { start: 1, end: 2 } },
      { fontId: "lmroman10-regular", code: 105, sourceSpan: { start: 8, end: 9 } },
      { fontId: "lmroman10-regular", code: 102, sourceSpan: { start: 9, end: 10 } },
    ]);
    expect(result.hlist?.width).toBeCloseTo(23.777548, 6);
  });

  it("scales text command nuclei in script style", () => {
    const result = layout(String.raw`x_{\text{if}}`);

    expect(result.supported).toBe(true);
    const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
    expect(glyphs.map((glyph) => ({
      fontId: glyph.fontId,
      atPt: glyph.atPt,
      code: glyph.code,
    }))).toEqual([
      { fontId: "cmmi10", atPt: 10, code: 120 },
      { fontId: "lmroman10-regular", atPt: 7, code: 105 },
      { fontId: "lmroman10-regular", atPt: 7, code: 102 },
    ]);
  });

  it("lays out math alphabet commands with LuaLaTeX CM alphabet fonts", () => {
    const italic = layout(String.raw`\mathit{ABC123}`);
    expect(italic.supported).toBe(true);
    expect(flattenGlyphItems(italic.hlist?.items ?? []).map((glyph) => ({
      fontId: glyph.fontId,
      code: glyph.code,
    }))).toEqual([
      { fontId: "cmti10", code: 65 },
      { fontId: "cmti10", code: 66 },
      { fontId: "cmti10", code: 67 },
      { fontId: "cmti10", code: 49 },
      { fontId: "cmti10", code: 50 },
      { fontId: "cmti10", code: 51 },
    ]);
    expect(italic.hlist?.width).toBeCloseTo(38.316452, 5);

    const alphabets = layout(String.raw`\mathrm{x}+\mathbf{x}+\mathsf{x}`);
    expect(alphabets.supported).toBe(true);
    expect(flattenGlyphItems(alphabets.hlist?.items ?? []).map((glyph) => glyph.fontId))
      .toEqual(["cmr10", "cmr10", "cmbx10", "cmr10", "cmss10"]);
  });

  it("uses exact script variants for math alphabet commands", () => {
    const result = layout(String.raw`x_{y_{\mathbf{i}}}+x_{\mathsf{i}}`);

    expect(result.supported).toBe(true);
    const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
    expect(glyphs.map((glyph) => ({
      fontId: glyph.fontId,
      atPt: glyph.atPt,
      code: glyph.code,
    }))).toEqual([
      { fontId: "cmmi10", atPt: 10, code: 120 },
      { fontId: "cmmi7", atPt: 7, code: 121 },
      { fontId: "cmbx5", atPt: 5, code: 105 },
      { fontId: "cmr10", atPt: 10, code: 43 },
      { fontId: "cmmi10", atPt: 10, code: 120 },
      { fontId: "cmss8", atPt: 7, code: 105 },
    ]);
  });

  it("lays out typewriter and calligraphic alphabets with TeX script fonts", () => {
    const result = layout(String.raw`\mathtt{ABC}+x_{\mathtt{i}}+\mathcal{ABC}+x_{y_{\mathcal{A}}}`);

    expect(result.supported).toBe(true);
    const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
    expect(glyphs.map((glyph) => ({
      fontId: glyph.fontId,
      atPt: glyph.atPt,
      code: glyph.code,
    }))).toEqual([
      { fontId: "cmtt10", atPt: 10, code: 65 },
      { fontId: "cmtt10", atPt: 10, code: 66 },
      { fontId: "cmtt10", atPt: 10, code: 67 },
      { fontId: "cmr10", atPt: 10, code: 43 },
      { fontId: "cmmi10", atPt: 10, code: 120 },
      { fontId: "cmtt8", atPt: 7, code: 105 },
      { fontId: "cmr10", atPt: 10, code: 43 },
      { fontId: "cmsy10", atPt: 10, code: 65 },
      { fontId: "cmsy10", atPt: 10, code: 66 },
      { fontId: "cmsy10", atPt: 10, code: 67 },
      { fontId: "cmr10", atPt: 10, code: 43 },
      { fontId: "cmmi10", atPt: 10, code: 120 },
      { fontId: "cmmi7", atPt: 7, code: 121 },
      { fontId: "cmsy5", atPt: 5, code: 65 },
    ]);
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

  it("lays out math accents with TeX skew and italic-width handling", () => {
    const hatX = layout(String.raw`\hat{x}`);
    expect(hatX.supported).toBe(true);
    expect(hatX.hlist?.width).toBeCloseTo(5.71528, 5);
    expect(hatX.hlist?.items).toMatchObject([
      {
        kind: "glyph",
        fontId: "cmr10",
        code: 94,
        x: expect.closeTo(0.63542, 5),
        y: 0,
      },
      {
        kind: "hlist",
        items: [{ kind: "glyph", fontId: "cmmi10", code: 120, x: 0 }],
      },
    ]);

    const hatY = layout(String.raw`\hat{y}`);
    expect(hatY.supported).toBe(true);
    expect(hatY.hlist?.width).toBeCloseTo(5.26161, 5);
    expect(hatY.hlist?.items[1]).toMatchObject({
      kind: "hlist",
      items: [{ kind: "glyph", fontId: "cmmi10", code: 121 }],
    });
    expect(hatY.hlist?.items[1]?.kind === "hlist" ? hatY.hlist.items[1].items : []).toHaveLength(1);

    const vecX = layout(String.raw`\vec{x}`);
    expect(vecX.supported).toBe(true);
    expect(vecX.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmmi10",
      code: 126,
      x: expect.closeTo(-0.133675, 5),
    });

    const grouped = layout(String.raw`\hat{xy}`);
    expect(grouped.supported).toBe(true);
    expect(grouped.hlist?.items[1]).toMatchObject({
      kind: "hlist",
      items: [
        { kind: "glyph", fontId: "cmmi10", code: 120 },
        { kind: "glyph", fontId: "cmmi10", code: 121 },
        { kind: "kern", width: expect.closeTo(0.35879, 5) },
      ],
    });
  });

  it("raises math accents over tall nuclei like TeX", () => {
    const result = layout(String.raw`\hat{\frac{1}{2}}`);
    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(6.386129, 6);
    expect(result.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmr10",
      code: 94,
      x: expect.closeTo(0.693055, 5),
      y: expect.closeTo(-4.142878, 5),
    });
  });

  it("lays out TeX large operators with inline side scripts", () => {
    const sum = layout(String.raw`\sum_i^n`);
    expect(sum.supported).toBe(true);
    expect(sum.hlist?.width).toBeCloseTo(15.99892, 5);
    expect(sum.hlist?.items).toMatchObject([
      {
        kind: "glyph",
        fontId: "cmex10",
        code: 80,
        y: expect.closeTo(-7.500065, 5),
      },
      {
        kind: "hlist",
        role: "superscript",
        x: expect.closeTo(10.55559, 5),
        y: expect.closeTo(-5.027868, 5),
      },
      {
        kind: "hlist",
        role: "subscript",
        x: expect.closeTo(10.55559, 5),
        y: expect.closeTo(3.000061, 5),
      },
    ]);

    const product = layout(String.raw`\prod_i^n\coprod_i^n\bigcup_i^n\bigcap_i^n`);
    expect(product.supported).toBe(true);
    expect(product.hlist?.items.filter((item) => item.kind === "glyph").map((item) => item.code)).toEqual([
      81,
      96,
      83,
      84,
    ]);
  });

  it("lays out TeX integral operators with italic-correction script offsets", () => {
    const result = layout(String.raw`\int_0^1+\oint_0^1`);
    expect(result.supported).toBe(true);
    expect(result.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 82,
      y: expect.closeTo(-8.05561, 5),
      width: expect.closeTo(4.72223, 5),
    });
    expect(result.hlist?.items[1]).toMatchObject({
      kind: "hlist",
      role: "superscript",
      x: expect.closeTo(6.66669, 5),
    });
    expect(result.hlist?.items[2]).toMatchObject({
      kind: "hlist",
      role: "subscript",
      x: expect.closeTo(4.72223, 5),
    });
  });

  it("lays out named roman operators such as lim", () => {
    const result = layout(String.raw`\lim_{x}`);
    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(18.92368, 5);
    expect(result.hlist?.items.slice(0, 3)).toMatchObject([
      { kind: "glyph", fontId: "cmr10", code: 108, x: 0 },
      { kind: "glyph", fontId: "cmr10", code: 105, x: expect.closeTo(2.77779, 5) },
      { kind: "glyph", fontId: "cmr10", code: 109, x: expect.closeTo(5.55558, 5) },
    ]);
    expect(result.hlist?.items[3]).toMatchObject({
      kind: "hlist",
      role: "subscript",
      x: expect.closeTo(13.88894, 5),
      y: expect.closeTo(1.5, 5),
    });
  });

  it("lays out TeX operator limits as vertical boxes", () => {
    const result = layout(String.raw`\sum\limits_i^n+\int\limits_0^1`);
    expect(result.supported).toBe(true);
    expect(result.hlist?.items.slice(0, 3)).toMatchObject([
      {
        kind: "hlist",
        role: "limit-superscript",
        x: expect.closeTo(2.806129, 5),
        y: expect.closeTo(-9.500065, 5),
      },
      {
        kind: "glyph",
        fontId: "cmex10",
        code: 80,
        y: expect.closeTo(-7.500061, 5),
      },
      {
        kind: "hlist",
        role: "limit-subscript",
        x: expect.closeTo(3.863152, 5),
        y: expect.closeTo(8.798677, 5),
      },
    ]);

    const integral = layout(String.raw`\int\limits_0^1`);
    expect(integral.supported).toBe(true);
    expect(integral.hlist?.width).toBeCloseTo(6.66669, 5);
    expect(integral.hlist?.items).toMatchObject([
      {
        kind: "hlist",
        role: "limit-superscript",
        x: expect.closeTo(2.312511, 5),
        y: expect.closeTo(-10.05561, 5),
      },
      {
        kind: "glyph",
        fontId: "cmex10",
        code: 82,
        y: expect.closeTo(-8.05561, 5),
      },
      {
        kind: "hlist",
        role: "limit-subscript",
        x: expect.closeTo(0.36805, 5),
        y: expect.closeTo(9.233383, 5),
      },
    ]);
  });

  it("uses TeX display-style operator limit defaults", () => {
    const parsed = parseTexMath(String.raw`\sum_i^n+\int_0^1+\lim_{x}`);
    const result = layoutTexMathList(parsed.list, { style: "display" });
    expect(result.supported).toBe(true);
    expect(result.hlist?.items.slice(0, 3)).toMatchObject([
      {
        kind: "hlist",
        role: "limit-superscript",
        x: expect.closeTo(4.750572, 5),
        y: expect.closeTo(-12.500065, 5),
      },
      {
        kind: "glyph",
        fontId: "cmex10",
        code: 88,
        y: expect.closeTo(-9.500055, 5),
      },
      {
        kind: "hlist",
        role: "limit-subscript",
        x: expect.closeTo(5.807594, 5),
        y: expect.closeTo(11.798677, 5),
      },
    ]);
    const integral = result.hlist?.items.find((item): item is TexMathGlyphLayoutItem =>
      item.kind === "glyph" && item.code === 90
    );
    expect(integral).toMatchObject({
      fontId: "cmex10",
      y: expect.closeTo(-13.61123, 5),
    });
    const limSubscript = result.hlist?.items.at(-1);
    expect(limSubscript).toMatchObject({
      kind: "hlist",
      role: "limit-subscript",
      y: expect.closeTo(6, 5),
    });
  });

  it("lays out aligned environments with row baselines and column anchors", () => {
    const parsed = parseTexMath(String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`);
    const result = layoutTexMathList(parsed.list, { style: "display" });

    expect(parsed.diagnostics).toEqual([]);
    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(23.823975, 3);
    expect(result.hlist?.height).toBeCloseTo(16, 5);
    expect(result.hlist?.depth).toBeCloseTo(11, 5);
    expect(result.hlist?.items).toMatchObject([
      {
        kind: "hlist",
        role: "aligned-row",
        y: expect.closeTo(-7.600037, 5),
        width: expect.closeTo(23.823975, 3),
      },
      {
        kind: "hlist",
        role: "aligned-row",
        y: expect.closeTo(7.399963, 5),
        width: expect.closeTo(23.823975, 3),
      },
    ]);
    const firstRow = result.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const secondRow = result.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(firstRow?.items).toMatchObject([
      { kind: "hlist", role: "aligned-cell", x: 0 },
      { kind: "hlist", role: "aligned-cell", x: expect.closeTo(5.285889, 4) },
    ]);
    expect(secondRow?.items).toMatchObject([
      { kind: "hlist", role: "aligned-cell", x: expect.closeTo(0.958329, 4) },
      { kind: "hlist", role: "aligned-cell", x: expect.closeTo(5.285889, 4) },
    ]);
  });

  it("uses amsmath display-style cells, inter-pair gaps, and TeX interline glue in aligned environments", () => {
    const scriptFraction = layoutTexMathList(
      parseTexMath(String.raw`\begin{aligned}x_i&=y^2\\\frac{1}{2}&=z\end{aligned}`).list,
      { style: "display" }
    );
    expect(scriptFraction.supported).toBe(true);
    expect(scriptFraction.hlist?.height).toBeCloseTo(20.654547, 5);
    expect(scriptFraction.hlist?.depth).toBeCloseTo(15.654548, 5);
    expect(scriptFraction.hlist?.items).toMatchObject([
      { kind: "hlist", role: "aligned-row", y: expect.closeTo(-12.014526, 4) },
      { kind: "hlist", role: "aligned-row", y: expect.closeTo(8.795029, 4) },
    ]);
    expect(flattenGlyphItems(scriptFraction.hlist?.items ?? []).some((glyph) =>
      glyph.fontId === "cmr10" && glyph.code === 49
    )).toBe(true);

    const multiplePairs = layoutTexMathList(
      parseTexMath(String.raw`\begin{aligned}a&=b&c&=d\\e&=f&g&=h\end{aligned}`).list,
      { style: "display" }
    );
    expect(multiplePairs.supported).toBe(true);
    expect(multiplePairs.hlist?.width).toBeCloseTo(58.814636, 3);
    const firstRow = multiplePairs.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(firstRow?.items).toMatchObject([
      { kind: "hlist", role: "aligned-cell", x: 0 },
      { kind: "hlist", role: "aligned-cell", x: expect.closeTo(5.285889, 4) },
      { kind: "hlist", role: "aligned-cell", x: expect.closeTo(35.392273, 3) },
      { kind: "hlist", role: "aligned-cell", x: expect.closeTo(39.719833, 3) },
    ]);

    const operatorRows = layoutTexMathList(
      parseTexMath(String.raw`\begin{aligned}\sum_i^n&=x\\\sqrt{x}&=y\end{aligned}`).list,
      { style: "display" }
    );
    expect(operatorRows.supported).toBe(true);
    expect(operatorRows.hlist?.items).toMatchObject([
      { kind: "hlist", role: "aligned-row", y: expect.closeTo(-8.687836, 4) },
      { kind: "hlist", role: "aligned-row", y: expect.closeTo(16.60173, 4) },
    ]);
    expect(flattenGlyphItems(operatorRows.hlist?.items ?? []).some((glyph) =>
      glyph.fontId === "cmex10" && glyph.code === 88
    )).toBe(true);

    const singleRow = layoutTexMathList(
      parseTexMath(String.raw`\begin{aligned}a&=y\end{aligned}`).list,
      { style: "display" }
    );
    expect(singleRow.supported).toBe(true);
    expect(singleRow.hlist?.width).toBeCloseTo(33.880707, 3);
  });

  it("lets explicit nolimits keep display operators on side scripts", () => {
    const parsed = parseTexMath(String.raw`\sum\nolimits_i^n`);
    const result = layoutTexMathList(parsed.list, { style: "display" });

    expect(result.supported).toBe(true);
    expect(result.hlist?.items).toMatchObject([
      {
        kind: "glyph",
        fontId: "cmex10",
        code: 88,
        y: expect.closeTo(-9.500055, 5),
      },
      {
        kind: "hlist",
        role: "superscript",
      },
      {
        kind: "hlist",
        role: "subscript",
      },
    ]);
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

  it("assembles extensible radical glyph recipes for very tall radicals", () => {
    const result = layout(String.raw`\sqrt{\sqrt{\sqrt{\sqrt{\frac{1}{2}}}}}`);

    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(46.941809, 6);
    expect(result.hlist?.items.slice(0, 4)).toMatchObject([
      {
        kind: "glyph",
        fontId: "cmex10",
        code: 118,
        y: expect.closeTo(-22.50014, 5),
      },
      {
        kind: "glyph",
        fontId: "cmex10",
        code: 117,
        y: expect.closeTo(-16.90007, 5),
      },
      {
        kind: "glyph",
        fontId: "cmex10",
        code: 117,
        y: expect.closeTo(-10.90001, 5),
      },
      {
        kind: "glyph",
        fontId: "cmex10",
        code: 116,
        y: expect.closeTo(-4.89995, 5),
      },
    ]);
    expect(result.hlist?.items[4]).toMatchObject({
      kind: "rule",
      role: "radical-rule",
      x: expect.closeTo(10.55559, 5),
      y: expect.closeTo(-22.90013, 5),
    });
  });

  it("lays out left-right delimiter groups with TeX delimiter sizing", () => {
    const simple = layout(String.raw`\left(x\right)`);
    expect(simple.supported).toBe(true);
    expect(simple.hlist?.width).toBeCloseTo(13.49308, 6);
    expect(simple.hlist?.items.map((item) => item.kind)).toEqual(["glyph", "hlist", "glyph"]);
    expect(simple.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmr10",
      code: 40,
      y: 0,
    });
    expect(simple.hlist?.items[2]).toMatchObject({
      kind: "glyph",
      fontId: "cmr10",
      code: 41,
      x: expect.closeTo(9.60418, 6),
    });

    const fraction = layout(String.raw`\left(\frac{1}{2}\right)`);
    expect(fraction.supported).toBe(true);
    expect(fraction.hlist?.width).toBeCloseTo(15.552849, 6);
    expect(fraction.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 0,
      y: expect.closeTo(-8.10007, 5),
      width: expect.closeTo(4.58336, 5),
    });
    expect(fraction.hlist?.items.at(-1)).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 1,
      x: expect.closeTo(10.969489, 5),
      y: expect.closeTo(-8.10007, 5),
    });
  });

  it("lays out null and extensible left-right delimiters like TeX", () => {
    const nullLeft = layout(String.raw`\left.\frac{1}{2}\right]`);
    expect(nullLeft.supported).toBe(true);
    expect(nullLeft.hlist?.width).toBeCloseTo(11.752819, 6);
    expect(nullLeft.hlist?.items[0]).toMatchObject({
      kind: "hlist",
      x: expect.closeTo(1.2, 6),
    });
    expect(nullLeft.hlist?.items.at(-1)).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 3,
      x: expect.closeTo(7.586129, 6),
    });

    const extensible = layout(String.raw`\left[\sqrt{\sqrt{\sqrt{\sqrt{\frac{1}{2}}}}}\right]`);
    expect(extensible.supported).toBe(true);
    expect(extensible.hlist?.width).toBeCloseTo(60.275189, 6);
    expect(extensible.hlist?.items.slice(0, 3)).toMatchObject([
      { kind: "glyph", fontId: "cmex10", code: 50, y: expect.closeTo(-23.10022, 5) },
      { kind: "glyph", fontId: "cmex10", code: 54, y: expect.closeTo(-5.50003, 5) },
      { kind: "glyph", fontId: "cmex10", code: 52, y: expect.closeTo(0.90002, 5) },
    ]);
    expect(extensible.hlist?.items.at(-1)).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 53,
      x: expect.closeTo(53.608499, 5),
    });
  });

  it("lays out common TeX left-right delimiter commands with TeX glyph choices", () => {
    const angle = layout(String.raw`\left\langle x\right\rangle`);
    expect(angle.supported).toBe(true);
    expect(angle.hlist?.width).toBeCloseTo(13.49308, 5);
    expect(angle.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmsy10",
      code: 104,
    });
    expect(angle.hlist?.items.at(-1)).toMatchObject({
      kind: "glyph",
      fontId: "cmsy10",
      code: 105,
      x: expect.closeTo(9.60418, 5),
    });

    const delimiters = layout(String.raw`\left\lbrace x\right\rbrace\left|x\right|\left\Vert x\right\Vert\left\backslash x\right/`);
    expect(delimiters.supported).toBe(true);
    expect(delimiters.hlist?.items.filter((item) => item.kind === "glyph").map((item) => item.code)).toEqual([
      102,
      103,
      106,
      106,
      107,
      107,
      110,
      47,
    ]);
    expect(delimiters.hlist?.items[1]).toMatchObject({
      kind: "hlist",
      items: [{ kind: "glyph", fontId: "cmmi10", code: 120 }],
    });
  });

  it("uses extension-family chains for tall TeX delimiter commands", () => {
    const result = layout(String.raw`\left\lfloor\sqrt{\sqrt{\sqrt{\sqrt{\frac{1}{2}}}}}\right\rfloor`);
    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(60.275189, 6);
    expect(result.hlist?.items.slice(0, 5)).toMatchObject([
      { kind: "glyph", fontId: "cmex10", code: 54, y: expect.closeTo(-23.50021, 5) },
      { kind: "glyph", fontId: "cmex10", code: 54, y: expect.closeTo(-17.50015, 5) },
      { kind: "glyph", fontId: "cmex10", code: 54, y: expect.closeTo(-11.50009, 5) },
      { kind: "glyph", fontId: "cmex10", code: 54, y: expect.closeTo(-5.50003, 5) },
      { kind: "glyph", fontId: "cmex10", code: 52, y: expect.closeTo(0.90002, 5) },
    ]);
    expect(result.hlist?.items.at(-1)).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 53,
      x: expect.closeTo(53.608499, 5),
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
    for (const source of [String.raw`\unknown{x}`, String.raw`\left\unknown x\right)`]) {
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
