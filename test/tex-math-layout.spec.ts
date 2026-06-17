import { describe, expect, it } from "vitest";
import {
  computerModernTexMetricProvider,
  layoutTexMathList,
  parseTexMath,
  resolveMathGlyph,
  setTexMathHListWidth,
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

  it("sets display hlist width by stretching and shrinking top-level math glue", () => {
    const parsed = parseTexMath("a+b");
    const result = layoutTexMathList(parsed.list, { style: "display" });
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const plus = result.hlist.items.find((item) =>
      item.kind === "glyph" && item.fontId === "cmr10" && item.code === 43
    );
    expect(plus).toMatchObject({
      x: expect.closeTo(7.508129, 6),
    });

    const shrunk = setTexMathHListWidth(result.hlist, result.hlist.width - 10);
    const shrunkPlus = shrunk.items.find((item) =>
      item.kind === "glyph" && item.fontId === "cmr10" && item.code === 43
    );
    expect(shrunk.width).toBeCloseTo(result.hlist.width - 10, 6);
    expect(shrunkPlus).toMatchObject({
      x: expect.closeTo(5.2859, 5),
    });
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

  it("lays out AMS font symbols through msam and msbm glyphs", () => {
    const result = layout(String.raw`\digamma+\dotplus+\ulcorner x\urcorner+\lesssim+\thickapprox+\thicksim+\Bbbk`);

    expect(result.supported).toBe(true);
    const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
    expect(glyphs.map((glyph) => ({
      fontId: glyph.fontId,
      code: glyph.code,
      sourceSpan: glyph.sourceSpan,
    }))).toEqual([
      { fontId: "msbm10", code: 0x7a, sourceSpan: { start: 0, end: 8 } },
      { fontId: "cmr10", code: 43, sourceSpan: { start: 8, end: 9 } },
      { fontId: "msam10", code: 0x75, sourceSpan: { start: 9, end: 17 } },
      { fontId: "cmr10", code: 43, sourceSpan: { start: 17, end: 18 } },
      { fontId: "msam10", code: 0x70, sourceSpan: { start: 18, end: 27 } },
      { fontId: "cmmi10", code: 120, sourceSpan: { start: 28, end: 29 } },
      { fontId: "msam10", code: 0x71, sourceSpan: { start: 29, end: 38 } },
      { fontId: "cmr10", code: 43, sourceSpan: { start: 38, end: 39 } },
      { fontId: "msam10", code: 0x2e, sourceSpan: { start: 39, end: 47 } },
      { fontId: "cmr10", code: 43, sourceSpan: { start: 47, end: 48 } },
      { fontId: "msbm10", code: 0x74, sourceSpan: { start: 48, end: 60 } },
      { fontId: "cmr10", code: 43, sourceSpan: { start: 60, end: 61 } },
      { fontId: "msbm10", code: 0x73, sourceSpan: { start: 61, end: 70 } },
      { fontId: "cmr10", code: 43, sourceSpan: { start: 70, end: 71 } },
      { fontId: "msbm10", code: 0x7c, sourceSpan: { start: 71, end: 76 } },
    ]);
  });

  it("lays out arrow, set, and logic symbols through TeX math fonts", () => {
    const result = layout(String.raw`A\to B\mapsto C\wedge D\cup E\subseteq F\smile G\frown H`);

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
      { fontId: "cmmi10", code: 0x5e, sourceSpan: { start: 40, end: 46 } },
      { fontId: "cmmi10", code: 71, sourceSpan: { start: 47, end: 48 } },
      { fontId: "cmmi10", code: 0x5f, sourceSpan: { start: 48, end: 54 } },
      { fontId: "cmmi10", code: 72, sourceSpan: { start: 55, end: 56 } },
    ]);
  });

  it("lays out AMS extensible arrows with script labels and stretched relation bars", () => {
    const right = layout(String.raw`\xrightarrow[xy]{abcd}`);
    const left = layout(String.raw`\xleftarrow{abcd}`);

    expect(right.supported).toBe(true);
    expect(left.supported).toBe(true);
    const rightItems = right.hlist?.items ?? [];
    const leftItems = left.hlist?.items ?? [];
    expect(rightItems.filter((item): item is TexMathChildHListLayoutItem => item.kind === "hlist").map((item) => item.role)).toEqual([
      "limit-superscript",
      "limit-subscript",
    ]);
    expect(leftItems.filter((item): item is TexMathChildHListLayoutItem => item.kind === "hlist").map((item) => item.role)).toEqual([
      "limit-superscript",
    ]);
    const rightBodyGlyphs = rightItems.filter((item): item is TexMathGlyphLayoutItem => item.kind === "glyph");
    const leftBodyGlyphs = leftItems.filter((item): item is TexMathGlyphLayoutItem => item.kind === "glyph");
    expect(rightBodyGlyphs[0]).toMatchObject({ fontId: "cmsy10", code: 0, sourceSpan: { start: 0, end: 12 } });
    expect(rightBodyGlyphs.at(-1)).toMatchObject({ fontId: "cmsy10", code: 33, sourceSpan: { start: 0, end: 12 } });
    expect(leftBodyGlyphs[0]).toMatchObject({ fontId: "cmsy10", code: 32, sourceSpan: { start: 0, end: 11 } });
    expect(leftBodyGlyphs.at(-1)).toMatchObject({ fontId: "cmsy10", code: 0, sourceSpan: { start: 0, end: 11 } });
    expect(rightBodyGlyphs.length).toBeGreaterThan(2);
    expect(leftBodyGlyphs.length).toBeGreaterThan(2);
    expect(right.hlist?.width).toBeGreaterThan(0);
    expect(left.hlist?.width).toBeGreaterThan(0);

    const rightGlyphs = flattenGlyphItems(rightItems);
    expect(rightGlyphs).toEqual(expect.arrayContaining([
      expect.objectContaining({ fontId: "cmmi7", code: 97, sourceSpan: { start: 17, end: 18 } }),
      expect.objectContaining({ fontId: "cmmi7", code: 120, sourceSpan: { start: 13, end: 14 } }),
    ]));
  });

  it("lays out ellipsis commands as inner punctuation lists with TeX spacing", () => {
    const ldots = layout(String.raw`\ldots`);
    expect(ldots.supported).toBe(true);
    expect(ldots.hlist?.width).toBeCloseTo(11.666714, 5);
    expect(ldots.hlist?.height).toBeCloseTo(1.05556, 5);
    expect(ldots.hlist?.items[0]).toMatchObject({
      kind: "hlist",
      role: "nucleus",
      width: expect.closeTo(11.666714, 5),
      items: [
        { kind: "glyph", fontId: "cmmi10", code: 58, x: 0 },
        { kind: "glue", source: "inter-atom", x: expect.closeTo(2.77779, 5), width: expect.closeTo(1.666672, 5) },
        { kind: "glyph", fontId: "cmmi10", code: 58, x: expect.closeTo(4.444462, 5) },
        { kind: "glue", source: "inter-atom", x: expect.closeTo(7.222252, 5), width: expect.closeTo(1.666672, 5) },
        { kind: "glyph", fontId: "cmmi10", code: 58, x: expect.closeTo(8.888924, 5) },
      ],
    });

    const cdots = layout(String.raw`a+\cdots+b`);
    expect(cdots.supported).toBe(true);
    expect(cdots.hlist?.width).toBeCloseTo(45.68882, 5);
    expect(cdots.hlist?.items).toMatchObject([
      { kind: "glyph", fontId: "cmmi10", code: 97, x: 0 },
      { kind: "glue", source: "inter-atom", width: expect.closeTo(2.222229, 5) },
      { kind: "glyph", fontId: "cmr10", code: 43, x: expect.closeTo(7.508129, 5) },
      { kind: "glue", source: "inter-atom", width: expect.closeTo(2.222229, 5) },
      {
        kind: "hlist",
        role: "nucleus",
        x: expect.closeTo(17.508168, 5),
        width: expect.closeTo(11.666714, 5),
      },
      { kind: "glue", source: "inter-atom", width: expect.closeTo(2.222229, 5) },
      { kind: "glyph", fontId: "cmr10", code: 43, x: expect.closeTo(31.397111, 5) },
      { kind: "glue", source: "inter-atom", width: expect.closeTo(2.222229, 5) },
      { kind: "glyph", fontId: "cmmi10", code: 98, x: expect.closeTo(41.39715, 5) },
    ]);
    const cdotGlyphs = flattenGlyphItems(cdots.hlist?.items ?? [])
      .filter((glyph) => glyph.sourceSpan.start === 2 && glyph.sourceSpan.end === 8);
    expect(cdotGlyphs.map((glyph) => ({ fontId: glyph.fontId, code: glyph.code }))).toEqual([
      { fontId: "cmsy10", code: 1 },
      { fontId: "cmsy10", code: 1 },
      { fontId: "cmsy10", code: 1 },
    ]);

    const terminalDots = layout(String.raw`\dots`);
    expect(terminalDots.supported).toBe(true);
    expect(terminalDots.hlist?.width).toBeCloseTo(13.333386, 5);

    const accentedDots = layout(String.raw`\bar\dots`);
    expect(accentedDots.supported).toBe(true);
    expect(accentedDots.hlist?.width).toBeCloseTo(11.666714, 5);

    const accentedCdots = layout(String.raw`\vec\cdots`);
    expect(accentedCdots.supported).toBe(true);
    expect(accentedCdots.hlist?.width).toBeCloseTo(11.666714, 5);

    const scriptedDots = layout(String.raw`\dots^{\sum}`);
    expect(scriptedDots.supported).toBe(true);
    const scriptedDotsGlyphs = flattenGlyphItems(scriptedDots.hlist?.items ?? []);
    expect(scriptedDotsGlyphs.map((glyph) => ({ fontId: glyph.fontId, code: glyph.code }))).toContainEqual({
      fontId: "cmex7",
      code: 80,
    });

    const lineNoadAmsProfile = layout(String.raw`\overline{\ldots}-\overline{\infty_2^\sum}`);
    expect(lineNoadAmsProfile.supported).toBe(true);
    const lineNoadGlyphs = flattenGlyphItems(lineNoadAmsProfile.hlist?.items ?? []);
    expect(lineNoadGlyphs.map((glyph) => ({ fontId: glyph.fontId, code: glyph.code }))).toContainEqual({
      fontId: "cmex7",
      code: 80,
    });
  });

  it("lays out negated relation composites with TeX overlay glyph traces", () => {
    const notIn = layout(String.raw`x\notin A`);
    expect(notIn.supported).toBe(true);
    expect(notIn.hlist?.items.map((item) => item.kind)).toEqual([
      "glyph",
      "glue",
      "kern",
      "glyph",
      "glyph",
      "glue",
      "glyph",
    ]);
    expect(notIn.hlist?.items[2]).toMatchObject({
      kind: "kern",
      x: expect.closeTo(9.048546, 3),
      width: expect.closeTo(0.555542, 6),
    });
    expect(notIn.hlist?.items[3]).toMatchObject({
      kind: "glyph",
      fontId: "cmmi10",
      code: 61,
      x: expect.closeTo(9.604088, 3),
      width: expect.closeTo(5.000015, 5),
    });
    expect(notIn.hlist?.items[4]).toMatchObject({
      kind: "glyph",
      fontId: "cmsy10",
      code: 50,
      x: expect.closeTo(8.492981, 3),
      width: expect.closeTo(6.666687, 5),
    });

    const genericNot = layout(String.raw`x\not\leq y`);
    expect(genericNot.supported).toBe(true);
    const glyphs = flattenGlyphItems(genericNot.hlist?.items ?? []);
    expect(glyphs.map((glyph) => ({
      fontId: glyph.fontId,
      code: glyph.code,
      sourceSpan: glyph.sourceSpan,
    }))).toEqual([
      { fontId: "cmmi10", code: 120, sourceSpan: { start: 0, end: 1 } },
      { fontId: "cmsy10", code: 54, sourceSpan: { start: 1, end: 9 } },
      { fontId: "cmsy10", code: 20, sourceSpan: { start: 1, end: 9 } },
      { fontId: "cmmi10", code: 121, sourceSpan: { start: 10, end: 11 } },
    ]);
  });

  it("lays out models as a TeX joined relation", () => {
    const result = layout(String.raw`x\models y`);

    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(25.42139, 5);
    expect(result.hlist?.items).toMatchObject([
      { kind: "glyph", fontId: "cmmi10", code: 120, x: 0 },
      { kind: "glue", source: "inter-atom", mu: 5, width: expect.closeTo(2.777786, 5) },
      {
        kind: "hlist",
        role: "nucleus",
        x: expect.closeTo(8.493066, 5),
        width: expect.closeTo(8.888928, 5),
      },
      { kind: "glue", source: "inter-atom", mu: 5, width: expect.closeTo(2.777786, 5) },
      { kind: "glyph", fontId: "cmmi10", code: 121, x: expect.closeTo(20.15978, 5) },
      {
        kind: "kern",
        reason: "italic-correction",
        x: expect.closeTo(25.0626, 5),
        width: expect.closeTo(0.35879, 5),
      },
    ]);
    const body = result.hlist?.items[2] as TexMathChildHListLayoutItem | undefined;
    expect(body?.items).toMatchObject([
      { kind: "glyph", fontId: "cmsy10", code: 106, x: 0, width: expect.closeTo(2.77779, 5) },
      { kind: "glue", source: "explicit", mu: -3, x: expect.closeTo(2.77779, 5), width: expect.closeTo(-1.666672, 5) },
      { kind: "glyph", fontId: "cmr10", code: 61, x: expect.closeTo(1.111118, 5), width: expect.closeTo(7.77781, 5) },
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

    const singleAtomGroup = layout(String.raw`{\beta}_{1}`);
    expect(singleAtomGroup.supported).toBe(true);
    expect(singleAtomGroup.hlist?.width).toBeCloseTo(10.142389, 5);
    expect(singleAtomGroup.hlist?.items.map((item) => item.kind)).toEqual(["glyph", "hlist"]);
    expect(singleAtomGroup.hlist?.items[1]).toMatchObject({
      kind: "hlist",
      role: "subscript",
      x: expect.closeTo(5.65626, 5),
      y: expect.closeTo(1.5, 5),
    });

    const groupedLargeSubscript = layout(String.raw`{\beta}_{\sum^{\gamma}}`);
    expect(groupedLargeSubscript.supported).toBe(true);
    expect(groupedLargeSubscript.hlist?.width).toBeCloseTo(21.293605, 5);
    const groupedLargeGlyphs = flattenGlyphItems(groupedLargeSubscript.hlist?.items ?? []);
    expect(groupedLargeGlyphs.map((glyph) => `${glyph.fontId}/${glyph.code}`)).toEqual([
      "cmmi10/12",
      "cmex10/80",
      "cmmi5/13",
    ]);

    const groupedCombinedFractionScript = layout(String.raw`{c-\beta^1}_{\frac{b}{x}}^x`);
    expect(groupedCombinedFractionScript.supported).toBe(true);
    expect(groupedCombinedFractionScript.hlist?.depth).toBeCloseTo(4.881668, 5);
    expect(groupedCombinedFractionScript.hlist?.items[2]).toMatchObject({
      kind: "hlist",
      role: "subscript",
      y: expect.closeTo(2.47217, 5),
    });
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

  it("lays out math islands inside text command nuclei", () => {
    const result = layout(String.raw`\text{if $Ax \ge b$,}`);

    expect(result.supported).toBe(true);
    const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
    expect(glyphs.map((glyph) => `${glyph.fontId}/${glyph.code}`)).toEqual([
      "lmroman10-regular/105",
      "lmroman10-regular/102",
      "lmroman10-regular/32",
      "cmmi10/65",
      "cmmi10/120",
      "cmsy10/21",
      "cmmi10/98",
      "lmroman10-regular/44",
    ]);
  });

  it("lays out mbox command nuclei through the same text-in-math path", () => {
    const result = layout(String.raw`x+\mbox{if}`);

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

  it("keeps trailing script italic correction in width without emitting a kern node", () => {
    const superscript = layout("x^y");
    expect(superscript.supported).toBe(true);
    expect(superscript.hlist?.width).toBeCloseTo(10.522037, 5);
    expect(flattenGlyphItems(superscript.hlist?.items ?? []).map((glyph) => glyph.code)).toEqual([120, 121]);
    expect(superscript.hlist?.items.some((item) => item.kind === "kern")).toBe(false);

    const subscript = layout("x_y");
    expect(subscript.supported).toBe(true);
    expect(subscript.hlist?.width).toBeCloseTo(10.522037, 5);
    expect(subscript.hlist?.items.some((item) => item.kind === "kern")).toBe(false);

    const fraction = layout(String.raw`\frac{2}{\beta}`);
    expect(fraction.supported).toBe(true);
    const denominator = fraction.hlist?.items[2] as TexMathChildHListLayoutItem | undefined;
    expect(denominator?.items.some((item) => item.kind === "kern")).toBe(false);
    expect(denominator?.width).toBeCloseTo(4.894141, 5);
  });

  it("restores TeX rebox italic correction when centering one-character fraction boxes", () => {
    const fraction = layout(String.raw`\frac{z}{x}`);

    expect(fraction.supported).toBe(true);
    const numerator = fraction.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(numerator?.items.map((item) => item.kind)).toEqual(["glyph", "kern"]);
    expect(numerator?.items[1]).toMatchObject({
      kind: "kern",
      x: expect.closeTo(3.820649, 5),
      width: expect.closeTo(0.287035, 5),
      reason: "italic-correction",
    });
  });

  it("uses TeX cramped styles for nested scripts inside subscripts", () => {
    const result = layout("x_{y^2}");

    expect(result.supported).toBe(true);
    const subscript = result.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(subscript).toMatchObject({
      kind: "hlist",
      role: "subscript",
      x: expect.closeTo(5.71528, 5),
      y: expect.closeTo(1.777783, 5),
    });
    const nestedSuperscript = subscript?.items[2] as TexMathChildHListLayoutItem | undefined;
    expect(nestedSuperscript).toMatchObject({
      kind: "hlist",
      role: "superscript",
      x: expect.closeTo(4.306757, 5),
      y: expect.closeTo(-1.999998, 5),
    });
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

  it("honors amsmath dfrac and tfrac style-forced fraction metrics", () => {
    const displayFraction = layout(String.raw`\dfrac{1}{2}`);

    expect(displayFraction.supported).toBe(true);
    expect(displayFraction.hlist?.width).toBeCloseTo(7.40002, 5);
    expect(displayFraction.hlist?.height).toBeCloseTo(13.20952, 5);
    expect(displayFraction.hlist?.depth).toBeCloseTo(6.85951, 5);
    expect(displayFraction.hlist?.items[0]).toMatchObject({
      kind: "hlist",
      y: expect.closeTo(-6.76508, 5),
      items: [{ kind: "glyph", fontId: "cmr10", code: 49 }],
    });
    expect(displayFraction.hlist?.items[2]).toMatchObject({
      kind: "hlist",
      y: expect.closeTo(6.85951, 5),
      items: [{ kind: "glyph", fontId: "cmr10", code: 50 }],
    });

    const textFraction = layout(String.raw`\tfrac{1}{2}`);
    expect(textFraction.supported).toBe(true);
    expect(textFraction.hlist?.width).toBeCloseTo(6.386129, 6);
    expect(textFraction.hlist?.height).toBeCloseTo(8.448428, 6);
    expect(textFraction.hlist?.depth).toBeCloseTo(3.44841, 5);
    expect(textFraction.hlist?.items[0]).toMatchObject({
      kind: "hlist",
      y: expect.closeTo(-3.93732, 5),
      items: [{ kind: "glyph", fontId: "cmr7", code: 49 }],
    });
    expect(textFraction.hlist?.items[2]).toMatchObject({
      kind: "hlist",
      y: expect.closeTo(3.44841, 5),
      items: [{ kind: "glyph", fontId: "cmr7", code: 50 }],
    });
  });

  it("lays out amsmath boxed formulas with TeX fbox rule and sep", () => {
    const boxed = layout(String.raw`\boxed{x+y}`);

    expect(boxed.supported).toBe(true);
    expect(boxed.hlist?.width).toBeCloseTo(29.999158, 5);
    expect(boxed.hlist?.height).toBeCloseTo(9.23334, 5);
    expect(boxed.hlist?.depth).toBeCloseTo(5.34445, 5);
    expect(boxed.hlist?.items).toMatchObject([
      {
        kind: "rule",
        role: "boxed-rule",
        x: 0,
        y: expect.closeTo(-9.23334, 5),
        width: expect.closeTo(29.999158, 5),
        height: 0.4,
      },
      {
        kind: "rule",
        role: "boxed-rule",
        x: 0,
        y: expect.closeTo(-9.23334, 5),
        width: 0.4,
      },
      {
        kind: "hlist",
        role: "boxed-body",
        x: 3.4,
        y: 0,
        items: expect.arrayContaining([
          expect.objectContaining({ kind: "glyph", fontId: "cmmi10", code: 120, x: 0 }),
          expect.objectContaining({ kind: "glue", width: expect.closeTo(2.222229, 5) }),
          expect.objectContaining({ kind: "glyph", fontId: "cmr10", code: 43, x: expect.closeTo(7.937509, 5) }),
          expect.objectContaining({ kind: "glyph", fontId: "cmmi10", code: 121, x: expect.closeTo(17.937548, 5) }),
          expect.objectContaining({ kind: "kern", reason: "italic-correction", width: expect.closeTo(0.35879, 5) }),
        ]),
      },
      {
        kind: "rule",
        role: "boxed-rule",
        x: expect.closeTo(29.599158, 5),
        y: expect.closeTo(-9.23334, 5),
        width: 0.4,
      },
      {
        kind: "rule",
        role: "boxed-rule",
        x: 0,
        y: expect.closeTo(4.94445, 5),
        width: expect.closeTo(29.999158, 5),
        height: 0.4,
      },
    ]);

    const boxedFraction = layout(String.raw`\boxed{\frac{1}{2}}`);
    expect(boxedFraction.supported).toBe(true);
    expect(boxedFraction.hlist?.width).toBeCloseTo(14.20002, 5);
    const boxedFractionBody = boxedFraction.hlist?.items[2] as TexMathChildHListLayoutItem | undefined;
    expect(boxedFractionBody).toMatchObject({
      kind: "hlist",
      role: "boxed-body",
      x: 3.4,
      height: expect.closeTo(13.20952, 5),
      depth: expect.closeTo(6.85951, 5),
    });
  });

  it("lays out amsmath cfrac with display style, numerator alignment, and trailing kern", () => {
    const centered = layout(String.raw`\cfrac{a}{bbb}`);
    const left = layout(String.raw`\cfrac[l]{a}{bbb}`);
    const right = layout(String.raw`\cfrac[r]{a}{bbb}`);
    const display = layout(String.raw`\dfrac{a}{bbb}`);

    expect(centered.supported).toBe(true);
    expect(left.supported).toBe(true);
    expect(right.supported).toBe(true);
    expect(display.supported).toBe(true);
    expect(centered.hlist?.height ?? 0).toBeGreaterThan(display.hlist?.height ?? 0);
    expect(centered.hlist?.items.at(-1)).toMatchObject({
      kind: "kern",
      reason: "fraction-kern",
      width: expect.closeTo(-1.2, 6),
    });

    const centeredNumerator = centered.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const leftNumerator = left.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const rightNumerator = right.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(leftNumerator).toMatchObject({
      kind: "hlist",
      x: expect.closeTo(1.2, 6),
      items: [{ kind: "glyph", fontId: "cmmi10", code: 97 }],
    });
    expect(centeredNumerator?.x ?? 0).toBeGreaterThan(leftNumerator?.x ?? 0);
    expect(rightNumerator?.x ?? 0).toBeGreaterThan(centeredNumerator?.x ?? 0);
    expect(rightNumerator).toMatchObject({
      kind: "hlist",
      items: [{ kind: "glyph", fontId: "cmmi10", code: 97 }],
    });
  });

  it("lays out binomial commands as zero-rule generalized fractions with TeX delimiters", () => {
    const binom = layout(String.raw`\binom{n}{k}`);

    expect(binom.supported).toBe(true);
    expect(binom.hlist?.width).toBeCloseTo(14.11005, 5);
    expect(binom.hlist?.height).toBeCloseTo(8.50006, 5);
    expect(binom.hlist?.depth).toBeCloseTo(3.50006, 5);
    expect(binom.hlist?.items.map((item) => item.kind)).toEqual(["glyph", "hlist", "glyph"]);
    expect(binom.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 0,
      x: expect.closeTo(0, 6),
      y: expect.closeTo(-8.10007, 5),
    });
    const body = binom.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(body).toMatchObject({
      kind: "hlist",
      role: "nucleus",
      x: expect.closeTo(4.58336, 5),
      width: expect.closeTo(4.94333, 5),
    });
    expect(body?.items[0]).toMatchObject({
      kind: "hlist",
      y: expect.closeTo(-4.43731, 5),
      items: [{ kind: "glyph", fontId: "cmmi7", code: 110 }],
    });
    expect(body?.items[1]).toMatchObject({
      kind: "hlist",
      y: expect.closeTo(3.44841, 5),
    });
    expect((body?.items[1] as TexMathChildHListLayoutItem | undefined)?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmmi7",
      code: 107,
    });
    expect(binom.hlist?.items[2]).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 1,
      x: expect.closeTo(9.52669, 5),
      y: expect.closeTo(-8.10007, 5),
    });

    const displayBinom = layout(String.raw`\dbinom{n}{k}`);
    expect(displayBinom.supported).toBe(true);
    expect(displayBinom.hlist?.width).toBeCloseTo(20.72465, 5);
    expect(displayBinom.hlist?.height).toBeCloseTo(14.50012, 5);
    expect(displayBinom.hlist?.depth).toBeCloseTo(9.50012, 5);
    expect(displayBinom.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 18,
      y: expect.closeTo(-14.10013, 5),
    });
    expect(displayBinom.hlist?.items[2]).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 19,
      x: expect.closeTo(13.3635, 5),
      y: expect.closeTo(-14.10013, 5),
    });
    const displayBody = displayBinom.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(displayBody?.items[0]).toMatchObject({
      kind: "hlist",
      y: expect.closeTo(-6.76508, 5),
      items: [{ kind: "glyph", fontId: "cmmi10", code: 110 }],
    });
    expect(displayBody?.items[1]).toMatchObject({
      kind: "hlist",
      y: expect.closeTo(6.85951, 5),
    });
    expect((displayBody?.items[1] as TexMathChildHListLayoutItem | undefined)?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmmi10",
      code: 107,
    });

    const scriptBinom = layout(String.raw`a^{\binom{1}{c}}`);
    expect(scriptBinom.supported).toBe(true);
    const superscript = scriptBinom.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(superscript).toMatchObject({
      kind: "hlist",
      role: "superscript",
      y: expect.closeTo(-3.628922, 5),
    });
    expect(superscript?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmr10",
      code: 40,
      y: expect.closeTo(0, 6),
    });

    const binomSuperscript = layout(String.raw`\binom{n}{k}^2`);
    expect(binomSuperscript.supported).toBe(true);
    expect(binomSuperscript.hlist?.items.at(-1)).toMatchObject({
      kind: "hlist",
      role: "superscript",
      y: expect.closeTo(-6.027847, 4),
    });

    const binomSubscript = layout(String.raw`\binom{n}{k}_2`);
    expect(binomSubscript.supported).toBe(true);
    expect(binomSubscript.hlist?.items.at(-1)).toMatchObject({
      kind: "hlist",
      role: "subscript",
      y: expect.closeTo(4.000046, 4),
    });
  });

  it("lays out TeX infix fractions through the generalized fraction path", () => {
    const over = layout(String.raw`1 \over 2`);
    expect(over.supported).toBe(true);
    expect(over.hlist?.items.map((item) => item.kind)).toEqual(["hlist", "rule", "hlist"]);
    expect(over.hlist?.items[1]).toMatchObject({
      kind: "rule",
      role: "fraction-rule",
      height: expect.closeTo(0.39999, 6),
    });

    const choose = layout(String.raw`n \choose k`);
    expect(choose.supported).toBe(true);
    expect(choose.hlist?.items.map((item) => item.kind)).toEqual(["glyph", "hlist", "glyph"]);
    expect(choose.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 0,
    });
    expect(choose.hlist?.items[2]).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 1,
    });

    const brack = layout(String.raw`n \brack k`);
    expect(brack.supported).toBe(true);
    expect(brack.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 2,
    });

    const overWithDelims = layout(String.raw`1 \overwithdelims [ ] 2`);
    expect(overWithDelims.supported).toBe(true);
    expect(overWithDelims.hlist?.items.map((item) => item.kind)).toEqual(["glyph", "hlist", "glyph"]);
    expect((overWithDelims.hlist?.items[1] as TexMathChildHListLayoutItem | undefined)?.items)
      .toContainEqual(expect.objectContaining({ kind: "rule", role: "fraction-rule" }));

    const above = layout(String.raw`a \above 1pt b`);
    expect(above.supported).toBe(true);
    expect(above.hlist?.items[1]).toMatchObject({
      kind: "rule",
      role: "fraction-rule",
      height: expect.closeTo(1, 6),
    });

    const aboveWithDelims = layout(String.raw`a \abovewithdelims [ ] 1pt b`);
    expect(aboveWithDelims.supported).toBe(true);
    expect(aboveWithDelims.hlist?.items.map((item) => item.kind)).toEqual(["glyph", "hlist", "glyph"]);
    expect((aboveWithDelims.hlist?.items[1] as TexMathChildHListLayoutItem | undefined)?.items)
      .toContainEqual(expect.objectContaining({ kind: "rule", role: "fraction-rule", height: expect.closeTo(1, 6) }));
  });

  it("lays out amsmath genfrac through the generalized fraction path", () => {
    const delimited = layout(String.raw`\genfrac{[}{]}{0pt}{3}{a}{b}`);
    expect(delimited.supported).toBe(true);
    expect(delimited.hlist?.items.map((item) => item.kind)).toEqual(["glyph", "hlist", "glyph"]);
    expect(delimited.hlist?.items[0]).toMatchObject({ kind: "glyph", fontId: "cmr10", code: 91 });
    expect(delimited.hlist?.items[2]).toMatchObject({ kind: "glyph", fontId: "cmr10", code: 93 });
    const delimitedBody = (delimited.hlist?.items[1] as TexMathChildHListLayoutItem | undefined)?.items ?? [];
    expect(delimitedBody).not.toContainEqual(expect.objectContaining({ kind: "rule", role: "fraction-rule" }));
    expect(flattenGlyphItems(delimitedBody)).toEqual(expect.arrayContaining([
      expect.objectContaining({ fontId: "cmmi5", code: 97 }),
      expect.objectContaining({ fontId: "cmmi5", code: 98 }),
    ]));

    const withDefaultRule = layout(String.raw`\genfrac{}{}{}{0}{a}{b}`);
    expect(withDefaultRule.supported).toBe(true);
    expect(withDefaultRule.hlist?.items.map((item) => item.kind)).toEqual(["hlist", "rule", "hlist"]);
    expect(withDefaultRule.hlist?.items[1]).toMatchObject({
      kind: "rule",
      role: "fraction-rule",
      height: expect.closeTo(0.39999, 6),
    });
  });

  it("lays out TeX overline and underline noads with TeX rule spacing", () => {
    const overline = layout(String.raw`\overline{x}`);

    expect(overline.supported).toBe(true);
    expect(overline.hlist?.width).toBeCloseTo(5.71528, 6);
    expect(overline.hlist?.height).toBeCloseTo(6.3055, 5);
    expect(overline.hlist?.depth).toBeCloseTo(0, 6);
    expect(overline.hlist?.items.map((item) => item.kind)).toEqual(["rule", "hlist"]);
    expect(overline.hlist?.items[0]).toMatchObject({
      kind: "rule",
      role: "overline-rule",
      x: 0,
      y: expect.closeTo(-5.90551, 5),
      width: expect.closeTo(5.71528, 6),
      height: expect.closeTo(0.39999, 6),
    });
    expect(overline.hlist?.items[1]).toMatchObject({
      kind: "hlist",
      role: "nucleus",
      x: 0,
      y: 0,
    });

    const underline = layout(String.raw`\underline{x}`);
    expect(underline.supported).toBe(true);
    expect(underline.hlist?.width).toBeCloseTo(5.71528, 6);
    expect(underline.hlist?.height).toBeCloseTo(4.30555, 5);
    expect(underline.hlist?.depth).toBeCloseTo(1.99995, 5);
    expect(underline.hlist?.items.map((item) => item.kind)).toEqual(["hlist", "rule"]);
    expect(underline.hlist?.items[1]).toMatchObject({
      kind: "rule",
      role: "underline-rule",
      x: 0,
      y: expect.closeTo(1.19997, 5),
      width: expect.closeTo(5.71528, 6),
      height: expect.closeTo(0.39999, 6),
    });
  });

  it("matches TeX script placement and scriptspace widening for line noads", () => {
    const scriptedOverline = layout(String.raw`\overline{x}^2`);

    expect(scriptedOverline.supported).toBe(true);
    expect(scriptedOverline.hlist?.items.at(-1)).toMatchObject({
      kind: "hlist",
      role: "superscript",
      x: expect.closeTo(5.71528, 6),
      y: expect.closeTo(-3.833237, 3),
    });

    const overlineInScript = layout(String.raw`a^{\overline{x}}`);
    expect(overlineInScript.supported).toBe(true);
    const overlineSuperscript = overlineInScript.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(overlineSuperscript).toMatchObject({
      kind: "hlist",
      role: "superscript",
      width: expect.closeTo(5.03474, 5),
    });
    expect(overlineSuperscript?.items[0]).toMatchObject({
      kind: "rule",
      role: "overline-rule",
      width: expect.closeTo(5.03474, 5),
    });

    const underlineInScript = layout(String.raw`a^{\underline{x}}`);
    expect(underlineInScript.supported).toBe(true);
    const underlineSuperscript = underlineInScript.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(underlineSuperscript?.items[1]).toMatchObject({
      kind: "rule",
      role: "underline-rule",
      width: expect.closeTo(5.03474, 5),
    });
  });

  it("lays out amsmath substack rows with LuaTeX scriptstyle stack parameters", () => {
    const standalone = layout(String.raw`\substack{i\\j}`);

    expect(standalone.supported).toBe(true);
    expect(standalone.hlist?.width).toBeCloseTo(3.713577, 6);
    expect(standalone.hlist?.height).toBeCloseTo(8.350493, 6);
    expect(standalone.hlist?.depth).toBeCloseTo(3.350494, 6);
    expect(standalone.hlist?.items).toHaveLength(2);
    const firstRow = standalone.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const secondRow = standalone.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(firstRow).toMatchObject({
      kind: "hlist",
      role: "substack-row",
      y: expect.closeTo(-3.718551, 6),
    });
    expect(firstRow?.items[0]).toMatchObject({
      kind: "hlist",
      role: "substack-cell",
      x: expect.closeTo(0.442141, 6),
      items: [{ kind: "glyph", fontId: "cmmi7", code: 105 }],
    });
    expect(secondRow).toMatchObject({
      kind: "hlist",
      role: "substack-row",
      y: expect.closeTo(1.989379, 6),
    });
    expect(secondRow?.items[0]).toMatchObject({
      kind: "hlist",
      role: "substack-cell",
      x: 0,
    });
    expect((secondRow?.items[0] as TexMathChildHListLayoutItem | undefined)?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmmi7",
      code: 106,
    });

    const limitSubstack = layout(String.raw`\sum_{\substack{i=1\\j=2}}^n`);
    expect(limitSubstack.supported).toBe(true);
    expect(limitSubstack.hlist?.width).toBeCloseTo(24.894212, 6);
    const subscript = limitSubstack.hlist?.items[2] as TexMathChildHListLayoutItem | undefined;
    expect(subscript).toMatchObject({
      kind: "hlist",
      role: "subscript",
      y: expect.closeTo(4.172585, 6),
    });
    expect(subscript?.items[0]).toMatchObject({
      kind: "hlist",
      role: "substack-row",
      y: expect.closeTo(-2.968551, 6),
    });
    expect(subscript?.items[1]).toMatchObject({
      kind: "hlist",
      role: "substack-row",
      y: expect.closeTo(2.739379, 6),
    });

    const ellipsisRows = layout(String.raw`\substack{x=b\\\dots\\\cdots=\sum}`);
    expect(ellipsisRows.supported).toBe(true);
    const ellipsisRow = ellipsisRows.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    const ellipsisCell = ellipsisRow?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(ellipsisCell).toMatchObject({
      kind: "hlist",
      role: "substack-cell",
      x: expect.closeTo(7.270865, 6),
      width: expect.closeTo(7.125048, 6),
    });
    const ellipsisNucleus = ellipsisCell?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(ellipsisNucleus?.items).toMatchObject([
      { kind: "glyph", fontId: "cmmi7", code: 58, x: 0 },
      { kind: "glyph", fontId: "cmmi7", code: 58, x: expect.closeTo(2.375016, 6) },
      { kind: "glyph", fontId: "cmmi7", code: 58, x: expect.closeTo(4.750032, 6) },
    ]);
  });

  it("lays out amsmath subarray rows with TeX scriptstyle stack parameters and column alignment", () => {
    const centered = layout(String.raw`\begin{subarray}{c}i\\j\end{subarray}`);

    expect(centered.supported).toBe(true);
    expect(centered.hlist?.width).toBeCloseTo(3.713577, 6);
    expect(centered.hlist?.height).toBeCloseTo(8.350493, 6);
    expect(centered.hlist?.depth).toBeCloseTo(3.350494, 6);
    const centeredFirstRow = centered.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const centeredSecondRow = centered.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(centeredFirstRow).toMatchObject({
      kind: "hlist",
      role: "subarray-row",
      y: expect.closeTo(-3.718551, 6),
    });
    expect(centeredFirstRow?.items[0]).toMatchObject({
      kind: "hlist",
      role: "subarray-cell",
      x: expect.closeTo(0.442141, 6),
    });
    expect(centeredSecondRow?.items[0]).toMatchObject({
      kind: "hlist",
      role: "subarray-cell",
      x: 0,
    });

    const left = layout(String.raw`\begin{subarray}{l}i\\j\end{subarray}`);
    expect(left.supported).toBe(true);
    const leftFirstRow = left.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const leftSecondRow = left.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(leftFirstRow?.items[0]).toMatchObject({
      kind: "hlist",
      role: "subarray-cell",
      x: 0,
    });
    expect(leftSecondRow?.items[0]).toMatchObject({
      kind: "hlist",
      role: "subarray-cell",
      x: 0,
    });
  });

  it("lays out AMS sideset as a scriptable operator hlist", () => {
    const simple = layout(String.raw`\sideset{a}{b}X`);

    expect(simple.supported).toBe(true);
    expect(simple.hlist?.items).toMatchObject([
      {
        kind: "hlist",
        role: "sideset-pre",
        x: expect.closeTo(1.666672, 6),
        items: [{ kind: "glyph", fontId: "cmmi10", code: 97 }],
      },
      {
        kind: "hlist",
        role: "sideset-base",
        items: [
          { kind: "glyph", fontId: "cmmi10", code: 88 },
          { kind: "kern", reason: "italic-correction" },
          { kind: "glyph", fontId: "cmmi10", code: 98 },
        ],
      },
    ]);

    const limitedParsed = parseTexMath(String.raw`\sideset{}{'}\sum_{n=0}^{k}n`);
    expect(limitedParsed.diagnostics).toEqual([]);
    const limited = layoutTexMathList(limitedParsed.list, { style: "display" });
    expect(limited.supported).toBe(true);
    expect(limited.hlist?.items.map((item) => item.kind === "hlist" ? item.role : item.kind)).toEqual([
      "limit-superscript",
      "sideset-base",
      "limit-subscript",
      "glue",
      "glyph",
    ]);
    const base = limited.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(base).toMatchObject({
      kind: "hlist",
      role: "sideset-base",
    });
    expect(flattenGlyphItems(base?.items ?? []).map((item) => item.text)).toEqual([
      String.raw`\sum`,
      String.raw`\prime`,
    ]);
  });

  it("spaces fractions as TeX fraction noads rather than inner noads", () => {
    const leadingPlus = layout(String.raw`+\frac{x}{m}`);
    expect(leadingPlus.supported).toBe(true);
    expect(leadingPlus.hlist?.width).toBeCloseTo(17.273927, 5);
    expect(leadingPlus.hlist?.items.map((item) => item.kind)).toEqual([
      "glyph",
      "hlist",
      "rule",
      "hlist",
    ]);
    expect(leadingPlus.hlist?.items[1]).toMatchObject({
      kind: "hlist",
      x: expect.closeTo(10.258498, 5),
    });
    expect(leadingPlus.hlist?.items[2]).toMatchObject({
      kind: "rule",
      x: expect.closeTo(8.97781, 5),
    });

    const afterOperator = layout(String.raw`\prod_1^z+\frac{x}{m}`);
    expect(afterOperator.supported).toBe(true);
    expect(afterOperator.hlist?.width).toBeCloseTo(32.992753, 5);
    expect(afterOperator.hlist?.items.map((item) => item.kind)).toEqual([
      "glyph",
      "hlist",
      "hlist",
      "glue",
      "glyph",
      "hlist",
      "rule",
      "hlist",
    ]);
    expect(afterOperator.hlist?.items[5]).toMatchObject({
      kind: "hlist",
      x: expect.closeTo(25.977324, 5),
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

    const ringX = layout(String.raw`\mathring{x}`);
    expect(ringX.supported).toBe(true);
    expect(ringX.hlist?.width).toBeCloseTo(5.71528, 5);
    expect(ringX.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmr10",
      code: 23,
      x: expect.closeTo(-0.61458, 5),
      y: 0,
    });

    const ringA = layout(String.raw`\mathring A`);
    expect(ringA.supported).toBe(true);
    expect(ringA.hlist?.width).toBeCloseTo(7.50002, 5);
    expect(ringA.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmr10",
      code: 23,
      x: expect.closeTo(1.38893, 5),
      y: expect.closeTo(-2.52777, 5),
    });

    const accentedSingleGlyphSup = layout(String.raw`\ddot{3}^2`);
    expect(accentedSingleGlyphSup.supported).toBe(true);
    expect(accentedSingleGlyphSup.hlist?.items.find((item) =>
      item.kind === "hlist" && item.role === "superscript"
    )).toMatchObject({
      kind: "hlist",
      role: "superscript",
      y: expect.closeTo(-3.62892, 5),
    });

    const multiDotAccents = layout(String.raw`\dddot{x}+\ddddot{1}`);
    expect(multiDotAccents.supported).toBe(true);
    const multiDotGlyphs = multiDotAccents.hlist?.items.filter((item) =>
      item.kind === "glyph" && item.fontId === "lmroman10-regular" && item.code === 46
    ) ?? [];
    expect(multiDotGlyphs).toHaveLength(7);
    expect(multiDotGlyphs[0]).toMatchObject({
      x: expect.closeTo(1.666667, 5),
      y: expect.closeTo(-5.84555, 5),
      width: expect.closeTo(2.78, 5),
    });
    expect(multiDotGlyphs[3]).toMatchObject({
      x: expect.closeTo(23.895602, 5),
      y: expect.closeTo(-7.98444, 5),
      width: expect.closeTo(2.78, 5),
    });
    expect(multiDotAccents.hlist?.items.filter((item) =>
      item.kind === "hlist" && item.role === "nucleus"
    )).toHaveLength(2);

    const nestedAccentSup = layout(String.raw`\hat{\tilde{x}}^2`);
    expect(nestedAccentSup.supported).toBe(true);
    expect(nestedAccentSup.hlist?.items.find((item) =>
      item.kind === "hlist" && item.role === "superscript"
    )).toMatchObject({
      kind: "hlist",
      role: "superscript",
      y: expect.closeTo(-6.845291, 5),
    });

    const accentFractionSup = layout(String.raw`\hat{\frac{x}{y}}^2`);
    expect(accentFractionSup.supported).toBe(true);
    expect(accentFractionSup.hlist?.items.find((item) =>
      item.kind === "hlist" && item.role === "superscript"
    )).toMatchObject({
      kind: "hlist",
      role: "superscript",
      y: expect.closeTo(-7.117905, 5),
    });

    const vecSup = layout(String.raw`\vec{z}^y`);
    expect(vecSup.supported).toBe(true);
    expect(vecSup.hlist?.items.find((item) =>
      item.kind === "kern" && item.reason === "italic-correction"
    )).toMatchObject({
      kind: "kern",
      x: expect.closeTo(4.650497, 5),
      width: expect.closeTo(0.43981, 5),
    });
    expect(vecSup.hlist?.items.find((item) =>
      item.kind === "hlist" && item.role === "superscript"
    )).toMatchObject({
      kind: "hlist",
      role: "superscript",
      x: expect.closeTo(5.09031, 5),
      y: expect.closeTo(-3.62892, 5),
    });

    const vecSubSup = layout(String.raw`\vec{z}_y^x`);
    expect(vecSubSup.supported).toBe(true);
    expect(vecSubSup.hlist?.items.find((item) =>
      item.kind === "hlist" && item.role === "superscript"
    )).toMatchObject({
      kind: "hlist",
      role: "superscript",
      x: expect.closeTo(5.09031, 5),
    });
    expect(vecSubSup.hlist?.items.find((item) =>
      item.kind === "hlist" && item.role === "subscript"
    )).toMatchObject({
      kind: "hlist",
      role: "subscript",
      x: expect.closeTo(4.650497, 5),
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

  it("lays out AMS multi-integral operators with TeX intkern spacing", () => {
    const result = layout(String.raw`\iiiint_0^1`);
    expect(result.supported).toBe(true);

    const operatorItems = result.hlist?.items.slice(0, 9) ?? [];
    expect(operatorItems.map((item) => item.kind)).toEqual([
      "glyph",
      "kern",
      "glyph",
      "kern",
      "glyph",
      "kern",
      "glyph",
      "hlist",
      "hlist",
    ]);
    expect(operatorItems.filter((item) => item.kind === "glyph").map((item) =>
      item.kind === "glyph" ? { fontId: item.fontId, code: item.code } : null
    )).toEqual([
      { fontId: "cmex10", code: 82 },
      { fontId: "cmex10", code: 82 },
      { fontId: "cmex10", code: 82 },
      { fontId: "cmex10", code: 82 },
    ]);
    const kerns = operatorItems.filter((item) => item.kind === "kern");
    expect(kerns).toHaveLength(3);
    expect(kerns.every((item) => item.kind === "kern" && item.reason === "operator-kern")).toBe(true);
    expect(kerns[0]).toMatchObject({
      kind: "kern",
      width: expect.closeTo(-3.333343, 5),
    });
    expect(operatorItems[7]).toMatchObject({
      kind: "hlist",
      role: "superscript",
    });
    expect(operatorItems[8]).toMatchObject({
      kind: "hlist",
      role: "subscript",
    });

    const parsed = parseTexMath(String.raw`\iint`);
    const display = layoutTexMathList(parsed.list, { style: "display" });
    expect(display.supported).toBe(true);
    const displayKern = display.hlist?.items.find((item) => item.kind === "kern");
    expect(displayKern).toMatchObject({
      kind: "kern",
      width: expect.closeTo(-5.000015, 5),
    });

    const dotted = layout(String.raw`\idotsint\limits_a^b`);
    expect(dotted.supported).toBe(true);
    const dottedItems = dotted.hlist?.items ?? [];
    expect(dottedItems.filter((item) => item.kind === "glyph").map((item) =>
      item.kind === "glyph" ? { fontId: item.fontId, code: item.code } : null
    )).toEqual([
      { fontId: "cmex10", code: 82 },
      { fontId: "cmsy10", code: 1 },
      { fontId: "cmsy10", code: 1 },
      { fontId: "cmsy10", code: 1 },
      { fontId: "cmex10", code: 82 },
    ]);
    expect(dottedItems.some((item) => item.kind === "hlist" && item.role === "limit-superscript")).toBe(true);
    expect(dottedItems.some((item) => item.kind === "hlist" && item.role === "limit-subscript")).toBe(true);

    const sideScriptDotted = layout(String.raw`\idotsint_a^b`);
    expect(sideScriptDotted.supported).toBe(true);
    expect(sideScriptDotted.hlist?.items.some((item) => item.kind === "hlist" && item.role === "superscript")).toBe(true);
    expect(sideScriptDotted.hlist?.items.some((item) => item.kind === "hlist" && item.role === "limit-superscript")).toBe(false);
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

  it("lays out operatorname as an AMS roman math operator", () => {
    const rank = layout(String.raw`\operatorname{rank}`);
    expect(rank.supported).toBe(true);
    expect(rank.hlist?.width).toBeCloseTo(19.75008, 5);
    expect(rank.hlist?.items).toMatchObject([
      { kind: "glyph", fontId: "cmr10", code: 114, x: 0 },
      { kind: "glyph", fontId: "cmr10", code: 97, x: expect.closeTo(3.91668, 5) },
      { kind: "glyph", fontId: "cmr10", code: 110, x: expect.closeTo(8.9167, 5) },
      { kind: "glyph", fontId: "cmr10", code: 107, x: expect.closeTo(14.47227, 5) },
    ]);

    const projLim = layout(String.raw`\operatorname{proj\,lim}`);
    expect(projLim.supported).toBe(true);
    expect(projLim.hlist?.width).toBeCloseTo(33.639002, 5);
    expect(projLim.hlist?.items).toMatchObject([
      { kind: "glyph", fontId: "cmr10", code: 112, x: 0 },
      { kind: "glyph", fontId: "cmr10", code: 114, x: expect.closeTo(5.55557, 5) },
      { kind: "glyph", fontId: "cmr10", code: 111, x: expect.closeTo(9.47225, 5) },
      {
        kind: "kern",
        reason: "text-kern",
        x: expect.closeTo(14.47227, 5),
        width: expect.closeTo(0.55555, 5),
      },
      { kind: "glyph", fontId: "cmr10", code: 106, x: expect.closeTo(15.02782, 5) },
      { kind: "glue", width: expect.closeTo(1.666672, 5), x: expect.closeTo(18.08339, 5) },
      { kind: "glyph", fontId: "cmr10", code: 108, x: expect.closeTo(19.750062, 5) },
      { kind: "glyph", fontId: "cmr10", code: 105, x: expect.closeTo(22.527852, 5) },
      { kind: "glyph", fontId: "cmr10", code: 109, x: expect.closeTo(25.305642, 5) },
    ]);

    const argmax = layoutTexMathList(
      parseTexMath(String.raw`\operatorname*{arg\,max}_{x}`).list,
      { style: "display" }
    );
    expect(argmax.supported).toBe(true);
    expect(argmax.hlist?.width).toBeCloseTo(34.333462, 5);
    expect(argmax.hlist?.items).toMatchObject([
      { kind: "glyph", fontId: "cmr10", code: 97, x: 0 },
      { kind: "glyph", fontId: "cmr10", code: 114, x: expect.closeTo(5.00002, 5) },
      { kind: "glyph", fontId: "cmr10", code: 103, x: expect.closeTo(8.9167, 5) },
      { kind: "kern", width: expect.closeTo(0.13888, 5), x: expect.closeTo(13.91672, 5) },
      { kind: "glue", width: expect.closeTo(1.666672, 5), x: expect.closeTo(14.0556, 5) },
      { kind: "glyph", fontId: "cmr10", code: 109, x: expect.closeTo(15.722272, 5) },
      { kind: "glyph", fontId: "cmr10", code: 97, x: expect.closeTo(24.055632, 5) },
      { kind: "glyph", fontId: "cmr10", code: 120, x: expect.closeTo(29.055652, 5) },
      {
        kind: "hlist",
        role: "limit-subscript",
        x: expect.closeTo(14.899361, 5),
        y: expect.closeTo(7.94445, 5),
      },
    ]);
  });

  it("lays out modular arithmetic macros with TeX mu glue", () => {
    const bmod = layout(String.raw`a\bmod b`);
    expect(bmod.supported).toBe(true);
    expect(bmod.hlist?.width).toBeCloseTo(29.855424, 5);
    const bmodBody = bmod.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(bmodBody?.items.filter((item) => item.kind === "glue").map((item) =>
      item.kind === "glue"
        ? { mu: item.mu, width: item.width, stretch: item.stretch, shrink: item.shrink }
        : null
    )).toEqual([
      { mu: -4, width: expect.closeTo(-2.222229, 5), stretch: expect.closeTo(-1.111114, 5), shrink: expect.closeTo(-2.222229, 5) },
      { mu: 5, width: expect.closeTo(2.777786, 5), stretch: 0, shrink: 0 },
      { mu: 5, width: expect.closeTo(2.777786, 5), stretch: 0, shrink: 0 },
      { mu: -4, width: expect.closeTo(-2.222229, 5), stretch: expect.closeTo(-1.111114, 5), shrink: expect.closeTo(-2.222229, 5) },
    ]);

    const scriptBmod = layoutTexMathList(
      parseTexMath(String.raw`a\bmod b`).list,
      { style: "script" }
    );
    expect(scriptBmod.supported).toBe(true);
    expect(scriptBmod.hlist?.width).toBeCloseTo(27.594399, 5);
    const scriptBmodBody = scriptBmod.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(scriptBmodBody?.items.filter((item) => item.kind === "glue").map((item) =>
      item.kind === "glue" ? item.mu : null
    )).toEqual([5, 5]);

    const pmod = layout(String.raw`a\pmod b`);
    expect(pmod.supported).toBe(true);
    expect(pmod.hlist?.width).toBeCloseTo(44.299911, 5);
    const pmodBody = pmod.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(pmodBody?.items.find((item) => item.kind === "glue")).toMatchObject({
      kind: "glue",
      mu: 8,
      width: expect.closeTo(4.444458, 5),
    });

    const displayPmod = layoutTexMathList(
      parseTexMath(String.raw`a\pmod b`).list,
      { style: "display" }
    );
    expect(displayPmod.supported).toBe(true);
    expect(displayPmod.hlist?.width).toBeCloseTo(49.855483, 5);
    const displayPmodBody = displayPmod.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(displayPmodBody?.items.find((item) => item.kind === "glue")).toMatchObject({
      kind: "glue",
      mu: 18,
      width: expect.closeTo(10.00003, 5),
    });

    const mod = layout(String.raw`a\mod b`);
    expect(mod.supported).toBe(true);
    expect(mod.hlist?.width).toBeCloseTo(38.744341, 5);
    const modBody = mod.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(modBody?.items.filter((item) => item.kind === "glue").map((item) =>
      item.kind === "glue" ? item.mu : null
    )).toEqual([12, 3, 3]);

    const displayMod = layoutTexMathList(
      parseTexMath(String.raw`a\mod b`).list,
      { style: "display" }
    );
    expect(displayMod.supported).toBe(true);
    expect(displayMod.hlist?.width).toBeCloseTo(42.077684, 5);
    const displayModBody = displayMod.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(displayModBody?.items.filter((item) => item.kind === "glue").map((item) =>
      item.kind === "glue" ? item.mu : null
    )).toEqual([18, 3, 3]);
  });

  it("lays out declared math operators as roman operator names", () => {
    const declared = layout(String.raw`\DeclareMathOperator{\R}{R}\R`);
    expect(declared.supported).toBe(true);
    expect(declared.hlist?.width).toBeCloseTo(7.36113, 5);
    expect(declared.hlist?.items).toMatchObject([
      { kind: "glyph", fontId: "cmr10", code: 82, x: 0 },
    ]);

    const starred = layoutTexMathList(
      parseTexMath(String.raw`\DeclareMathOperator*{\R}{R}\R_{n}`).list,
      { style: "display" }
    );
    expect(starred.supported).toBe(true);
    expect(starred.hlist?.items.some((item) => item.kind === "hlist" && item.role === "limit-subscript")).toBe(true);
  });

  it("uses TeX display limits for built-in named operators that take limits", () => {
    const displayLimits = layoutTexMathList(
      parseTexMath(String.raw`\min_{x:Ax\ge b} f(x)+\inf_x g(x)`).list,
      { style: "display" }
    );
    expect(displayLimits.supported).toBe(true);
    expect(displayLimits.hlist?.items.filter((item) =>
      item.kind === "hlist" && item.role === "limit-subscript"
    )).toHaveLength(2);

    const noLimits = layoutTexMathList(
      parseTexMath(String.raw`\sin_x x+\log_y y`).list,
      { style: "display" }
    );
    expect(noLimits.supported).toBe(true);
    expect(noLimits.hlist?.items.some((item) =>
      item.kind === "hlist" && item.role === "limit-subscript"
    )).toBe(false);
  });

  it("preserves trailing italic correction in named operator widths", () => {
    const inf = layoutTexMathList(parseTexMath(String.raw`\inf_x f(x)`).list, {
      style: "display",
    });
    expect(inf.supported).toBe(true);
    expect(inf.hlist?.width).toBeCloseTo(33.298676, 3);

    const sin = layoutTexMathList(parseTexMath(String.raw`\sin x`).list, {
      style: "display",
    });
    expect(sin.supported).toBe(true);
    expect(sin.hlist?.width).toBeCloseTo(19.659762, 5);
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

  it("lays out display align, gather, and multline environments through the aligned hlist model", () => {
    const align = layoutTexMathList(
      parseTexMath(String.raw`\begin{align}a&=b\\c&=d\end{align}`).list,
      { style: "display" }
    );
    const gather = layoutTexMathList(
      parseTexMath(String.raw`\begin{gather*}a=b\\c+d=e\end{gather*}`).list,
      { style: "display" }
    );
    const multline = layoutTexMathList(
      parseTexMath(String.raw`\begin{multline*}a=b\\c+d=e\\f=g\end{multline*}`).list,
      { style: "display" }
    );

    expect(align.supported).toBe(true);
    expect(align.hlist?.items.map((item) => item.kind === "hlist" ? item.role : null)).toEqual([
      "aligned-row",
      "aligned-row",
    ]);
    const alignFirstRow = align.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(alignFirstRow?.items.map((item) => item.kind === "hlist" ? item.role : null)).toEqual([
      "aligned-cell",
      "aligned-cell",
    ]);

    expect(gather.supported).toBe(true);
    expect(gather.hlist?.width).toBeCloseTo(39.74436, 5);
    expect(gather.hlist?.items.map((item) => item.kind === "hlist" ? item.role : null)).toEqual([
      "aligned-row",
      "aligned-row",
    ]);
    const gatherFirstRow = gather.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(gatherFirstRow?.items).toHaveLength(1);
    expect(gatherFirstRow?.items[0]).toMatchObject({
      kind: "hlist",
      role: "aligned-cell",
      x: expect.closeTo(8.416704, 5),
    });

    expect(multline.supported).toBe(true);
    expect(multline.hlist?.width).toBeCloseTo(39.74436, 5);
    expect(multline.hlist?.items.map((item) => item.kind === "hlist" ? item.role : null)).toEqual([
      "aligned-row",
      "aligned-row",
      "aligned-row",
    ]);
    const multlineFirstRow = multline.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(multlineFirstRow?.items).toHaveLength(1);
    expect(multlineFirstRow?.items[0]).toMatchObject({
      kind: "hlist",
      role: "aligned-cell",
      x: 0,
    });
  });

  it("lays out split and gathered nested inside display alignments", () => {
    const split = layoutTexMathList(
      parseTexMath(String.raw`\begin{align*}a&=b \begin{split}r&=s\\&=t\end{split}\\c&=d\end{align*}`).list,
      { style: "display" }
    );
    const gathered = layoutTexMathList(
      parseTexMath(String.raw`\begin{align*}a&=b \begin{gathered}r=s\\t=u\end{gathered}\\c&=d\end{align*}`).list,
      { style: "display" }
    );

    expect(split.supported).toBe(true);
    expect(gathered.supported).toBe(true);
    if (!split.supported || !gathered.supported) {
      return;
    }

    const splitRows = split.hlist.items.filter((item): item is TexMathChildHListLayoutItem =>
      item.kind === "hlist" && item.role === "aligned-row"
    );
    expect(splitRows).toHaveLength(2);
    expect(splitRows[0]?.items.some((item) =>
      item.kind === "hlist" &&
      item.items.some((nested) => nested.kind === "hlist" && nested.role === "aligned-row")
    )).toBe(true);

    const gatheredRows = gathered.hlist.items.filter((item): item is TexMathChildHListLayoutItem =>
      item.kind === "hlist" && item.role === "aligned-row"
    );
    expect(gatheredRows).toHaveLength(2);
    expect(gatheredRows[0]?.items.some((item) =>
      item.kind === "hlist" &&
      item.items.some((nested) => nested.kind === "hlist" && nested.role === "aligned-row")
    )).toBe(true);
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

  it("lays out xalignat environments with AMS minimum pair gaps in the natural hlist", () => {
    const result = layoutTexMathList(
      parseTexMath(String.raw`\begin{xalignat}{2}a&=&b&c\\d&=&e&f\end{xalignat}`).list,
      { style: "display" }
    );
    const alignat = layoutTexMathList(
      parseTexMath(String.raw`\begin{alignat}{2}a&=&b&c\\d&=&e&f\end{alignat}`).list,
      { style: "display" }
    );

    expect(result.supported).toBe(true);
    expect(alignat.supported).toBe(true);
    const firstRow = result.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const alignatFirstRow = alignat.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const firstCells = firstRow?.items as readonly TexMathChildHListLayoutItem[] | undefined;
    const alignatFirstCells = alignatFirstRow?.items as readonly TexMathChildHListLayoutItem[] | undefined;
    expect(firstCells).toHaveLength(4);
    expect(alignatFirstCells).toHaveLength(4);
    if (!firstCells || !alignatFirstCells) {
      return;
    }

    const xalignatGap = (firstCells[2]?.x ?? 0) - ((firstCells[1]?.x ?? 0) + (firstCells[1]?.width ?? 0));
    const alignatGap = (alignatFirstCells[2]?.x ?? 0) - ((alignatFirstCells[1]?.x ?? 0) + (alignatFirstCells[1]?.width ?? 0));
    expect(xalignatGap - alignatGap).toBeCloseTo(10, 5);
  });

  it("lays out xxalignat environments with AMS minimum pair gaps in the natural hlist", () => {
    const result = layoutTexMathList(
      parseTexMath(String.raw`\begin{xxalignat}{2}a&b&c&d\end{xxalignat}`).list,
      { style: "display" }
    );
    const alignat = layoutTexMathList(
      parseTexMath(String.raw`\begin{alignat}{2}a&b&c&d\end{alignat}`).list,
      { style: "display" }
    );

    expect(result.supported).toBe(true);
    expect(alignat.supported).toBe(true);
    const firstRow = result.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const alignatFirstRow = alignat.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const firstCells = firstRow?.items as readonly TexMathChildHListLayoutItem[] | undefined;
    const alignatFirstCells = alignatFirstRow?.items as readonly TexMathChildHListLayoutItem[] | undefined;
    expect(firstCells).toHaveLength(4);
    expect(alignatFirstCells).toHaveLength(4);
    if (!firstCells || !alignatFirstCells) {
      return;
    }

    const xxalignatGap = (firstCells[2]?.x ?? 0) - ((firstCells[1]?.x ?? 0) + (firstCells[1]?.width ?? 0));
    const alignatGap = (alignatFirstCells[2]?.x ?? 0) - ((alignatFirstCells[1]?.x ?? 0) + (alignatFirstCells[1]?.width ?? 0));
    expect(xxalignatGap - alignatGap).toBeCloseTo(10, 5);
  });

  it("lays out LaTeX eqnarray with r/c/l columns and arraycolsep gaps", () => {
    const result = layoutTexMathList(
      parseTexMath(String.raw`\begin{eqnarray}a&=&bb\\ccc&=&d\end{eqnarray}`).list,
      { style: "display" }
    );

    expect(result.supported).toBe(true);
    const firstRow = result.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const secondRow = result.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    const firstCells = firstRow?.items as readonly TexMathChildHListLayoutItem[] | undefined;
    const secondCells = secondRow?.items as readonly TexMathChildHListLayoutItem[] | undefined;
    expect(firstCells).toHaveLength(3);
    expect(secondCells).toHaveLength(3);
    if (!firstCells || !secondCells) {
      return;
    }

    expect(firstCells[0]?.x ?? 0).toBeGreaterThan(0);
    expect(secondCells[0]?.x).toBe(0);
    expect(firstCells[1]?.x).toBeCloseTo(secondCells[1]?.x ?? 0, 5);
    expect(firstCells[2]?.x).toBeCloseTo(secondCells[2]?.x ?? 0, 5);
    expect((firstCells[1]?.x ?? 0) - ((firstCells[0]?.x ?? 0) + (firstCells[0]?.width ?? 0))).toBeCloseTo(10, 5);
    expect((firstCells[2]?.x ?? 0) - ((firstCells[1]?.x ?? 0) + (firstCells[1]?.width ?? 0))).toBeCloseTo(10, 5);
  });

  it("lays out matrix environments with TeX array struts and centered columns", () => {
    const result = layoutTexMathList(
      parseTexMath(String.raw`\begin{matrix}a&b\\c&d\end{matrix}`).list,
      { style: "display" }
    );

    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(20.49078, 5);
    expect(result.hlist?.height).toBeCloseTo(14.5, 5);
    expect(result.hlist?.depth).toBeCloseTo(9.5, 5);
    expect(result.hlist?.items).toMatchObject([
      { kind: "hlist", role: "matrix-row", y: expect.closeTo(-6.100037, 5) },
      { kind: "hlist", role: "matrix-row", y: expect.closeTo(5.899963, 5) },
    ]);
    const firstRow = result.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const secondRow = result.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(firstRow?.items).toMatchObject([
      { kind: "hlist", role: "matrix-cell", x: 0 },
      { kind: "hlist", role: "matrix-cell", x: expect.closeTo(15.742505, 5) },
    ]);
    expect(secondRow?.items).toMatchObject([
      { kind: "hlist", role: "matrix-cell", x: expect.closeTo(0.47917, 5) },
      { kind: "hlist", role: "matrix-cell", x: expect.closeTo(15.2859, 5) },
    ]);

    const adjacentMatrix = layoutTexMathList(
      parseTexMath(String.raw`a\begin{matrix}b\end{matrix}`).list,
      { style: "display" }
    );
    expect(adjacentMatrix.supported).toBe(true);
    expect(adjacentMatrix.hlist?.width).toBeCloseTo(9.57757, 5);
    expect(adjacentMatrix.hlist?.items).toMatchObject([
      { kind: "glyph", x: 0 },
      { kind: "hlist", role: "matrix-row", x: expect.closeTo(5.2859, 5) },
    ]);

    const operatorMatrix = layoutTexMathList(
      parseTexMath(String.raw`\prod_b^i+\begin{matrix}j&z_c^a&m^i\end{matrix}`).list,
      { style: "display" }
    );
    expect(operatorMatrix.supported).toBe(true);
    expect(operatorMatrix.hlist?.width).toBeCloseTo(68.950185, 5);
    expect(operatorMatrix.hlist?.items).toMatchObject([
      { kind: "hlist", role: "limit-superscript" },
      { kind: "glyph", code: 89 },
      { kind: "hlist", role: "limit-subscript" },
      { kind: "glue", width: expect.closeTo(1.666672, 5) },
      { kind: "glyph", code: 43, x: expect.closeTo(14.444482, 5) },
      { kind: "hlist", role: "matrix-row", x: expect.closeTo(22.222292, 5) },
    ]);
  });

  it("lays out Mathtools starred matrix column alignment options", () => {
    const left = layoutTexMathList(
      parseTexMath(String.raw`\begin{matrix*}[l]a&bb\\ccc&d\end{matrix*}`).list,
      { style: "display" }
    );
    const right = layoutTexMathList(
      parseTexMath(String.raw`\begin{matrix*}[r]a&bb\\ccc&d\end{matrix*}`).list,
      { style: "display" }
    );

    expect(left.supported).toBe(true);
    expect(right.supported).toBe(true);
    const leftFirstRow = left.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const rightFirstRow = right.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const leftFirstCell = leftFirstRow?.items[0] as TexMathChildHListLayoutItem | undefined;
    const rightFirstCell = rightFirstRow?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(leftFirstCell?.x).toBe(0);
    expect(rightFirstCell?.x ?? 0).toBeGreaterThan(0);
    expect(left.hlist?.width).toBeCloseTo(right.hlist?.width ?? 0, 6);
  });

  it("lays out array environments with TeX arraycolsep and l/c/r preamble alignment", () => {
    const centered = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{cc}a&b\\c&d\end{array}`).list,
      { style: "display" }
    );

    expect(centered.supported).toBe(true);
    expect(centered.hlist?.width).toBeCloseTo(30.49078, 5);
    expect(centered.hlist?.height).toBeCloseTo(14.5, 5);
    expect(centered.hlist?.depth).toBeCloseTo(9.5, 5);
    expect(centered.hlist?.items).toMatchObject([
      { kind: "hlist", role: "array-row", y: expect.closeTo(-6.100037, 5) },
      { kind: "hlist", role: "array-row", y: expect.closeTo(5.899963, 5) },
    ]);
    const centeredFirstRow = centered.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const centeredSecondRow = centered.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(centeredFirstRow?.items).toMatchObject([
      { kind: "hlist", role: "array-cell", x: 5 },
      { kind: "hlist", role: "array-cell", x: expect.closeTo(20.742493, 4) },
    ]);
    expect(centeredSecondRow?.items).toMatchObject([
      { kind: "hlist", role: "array-cell", x: expect.closeTo(5.479164, 4) },
      { kind: "hlist", role: "array-cell", x: expect.closeTo(20.285889, 4) },
    ]);

    const mixed = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{lc}a&b\\x&y\end{array}`).list,
      { style: "display" }
    );
    expect(mixed.supported).toBe(true);
    expect(mixed.hlist?.width).toBeCloseTo(30.97689, 5);
    const mixedFirstRow = mixed.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const mixedSecondRow = mixed.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(mixedFirstRow?.items).toMatchObject([
      { kind: "hlist", role: "array-cell", x: 5 },
      { kind: "hlist", role: "array-cell", x: expect.closeTo(21.200241, 4) },
    ]);
    expect(mixedSecondRow?.items).toMatchObject([
      { kind: "hlist", role: "array-cell", x: 5 },
      { kind: "hlist", role: "array-cell", x: expect.closeTo(20.715271, 4) },
    ]);

    const ellipsisBoundary = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{cc}\cdots&x\end{array}`).list
    );
    expect(ellipsisBoundary.supported).toBe(true);
    expect(ellipsisBoundary.hlist?.width).toBeCloseTo(39.048508, 3);
    const ellipsisRow = ellipsisBoundary.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(ellipsisRow?.items).toMatchObject([
      { kind: "hlist", role: "array-cell", x: 5, width: expect.closeTo(13.333386, 5) },
      { kind: "hlist", role: "array-cell", x: expect.closeTo(28.333386, 5) },
    ]);
  });

  it("lays out array vertical rules without changing single-rule preamble width", () => {
    const result = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{|c|c|}a&b\\c&d\end{array}`).list,
      { style: "display" }
    );

    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(30.49078, 5);
    const firstRow = result.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(firstRow?.items).toMatchObject([
      {
        kind: "rule",
        role: "array-rule",
        x: expect.closeTo(-0.2, 5),
        width: 0.4,
        sourceSpan: { start: 14, end: 15 },
      },
      { kind: "hlist", role: "array-cell", x: 5 },
      {
        kind: "rule",
        role: "array-rule",
        x: expect.closeTo(15.0859, 5),
        width: 0.4,
        sourceSpan: { start: 16, end: 17 },
      },
      { kind: "hlist", role: "array-cell", x: expect.closeTo(20.742493, 4) },
      {
        kind: "rule",
        role: "array-rule",
        x: expect.closeTo(30.29078, 5),
        width: 0.4,
        sourceSpan: { start: 18, end: 19 },
      },
    ]);

    const doubleRule = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{c||c}a&b\end{array}`).list,
      { style: "display" }
    );
    expect(doubleRule.supported).toBe(true);
    expect(doubleRule.hlist?.width).toBeCloseTo(31.57757, 5);
    const doubleRuleRow = doubleRule.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(doubleRuleRow?.items).toMatchObject([
      { kind: "hlist", role: "array-cell", x: 5 },
      {
        kind: "rule",
        role: "array-rule",
        x: expect.closeTo(15.0859, 5),
        width: 0.4,
      },
      {
        kind: "rule",
        role: "array-rule",
        x: expect.closeTo(17.0859, 5),
        width: 0.4,
      },
      { kind: "hlist", role: "array-cell", x: expect.closeTo(22.2859, 4) },
    ]);
  });

  it("lays out array hline rules at TeX row boundaries", () => {
    const topRule = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{c}\hline a\end{array}`).list,
      { style: "display" }
    );
    expect(topRule.supported).toBe(true);
    expect(topRule.hlist?.items).toMatchObject([
      {
        kind: "rule",
        role: "array-rule",
        x: 0,
        y: expect.closeTo(-8.7, 5),
        width: expect.closeTo(15.2859, 5),
        height: 0.4,
        sourceSpan: { start: 16, end: 22 },
      },
      { kind: "hlist", role: "array-row", y: expect.closeTo(0.099963, 5) },
    ]);
    expect(topRule.hlist?.height).toBeCloseTo(8.7, 5);
    expect(topRule.hlist?.depth).toBeCloseTo(3.7, 5);

    const middleRule = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{c}a\\\hline b\end{array}`).list,
      { style: "display" }
    );
    expect(middleRule.supported).toBe(true);
    expect(middleRule.hlist?.items).toMatchObject([
      { kind: "hlist", role: "array-row", y: expect.closeTo(-6.300037, 5) },
      {
        kind: "rule",
        role: "array-rule",
        x: 0,
        y: expect.closeTo(-2.7, 5),
        width: expect.closeTo(15.2859, 5),
        height: 0.4,
      },
      { kind: "hlist", role: "array-row", y: expect.closeTo(6.099963, 5) },
    ]);

    const bottomRule = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{c}a\\\hline\end{array}`).list,
      { style: "display" }
    );
    expect(bottomRule.supported).toBe(true);
    expect(bottomRule.hlist?.items).toMatchObject([
      { kind: "hlist", role: "array-row", y: expect.closeTo(-0.300037, 5) },
      {
        kind: "rule",
        role: "array-rule",
        x: 0,
        y: expect.closeTo(3.3, 5),
        width: expect.closeTo(15.2859, 5),
        height: 0.4,
      },
    ]);

    const withVerticalRules = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{|c|}\hline a\\\hline\end{array}`).list,
      { style: "display" }
    );
    expect(withVerticalRules.supported).toBe(true);
    expect(withVerticalRules.hlist?.items).toMatchObject([
      { kind: "rule", role: "array-rule", y: expect.closeTo(-8.9, 5) },
      { kind: "hlist", role: "array-row", y: expect.closeTo(-0.100037, 5) },
      { kind: "rule", role: "array-rule", y: expect.closeTo(3.5, 5) },
    ]);
  });

  it("lays out repeated array preambles like their explicit expansion", () => {
    const withoutSourceSpans = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(withoutSourceSpans);
      }
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([key]) => key !== "sourceSpan")
            .map(([key, entry]) => [key, withoutSourceSpans(entry)])
        );
      }
      return value;
    };
    const repeated = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{*{2}{rc}}a&b&c&d\\e&f&g&h\end{array}`).list,
      { style: "display" }
    );
    const explicit = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{rcrc}a&b&c&d\\e&f&g&h\end{array}`).list,
      { style: "display" }
    );

    expect(repeated.supported).toBe(true);
    expect(explicit.supported).toBe(true);
    expect(repeated.hlist?.width).toBeCloseTo(explicit.hlist?.width ?? 0, 6);
    expect(repeated.hlist?.height).toBeCloseTo(explicit.hlist?.height ?? 0, 6);
    expect(repeated.hlist?.depth).toBeCloseTo(explicit.hlist?.depth ?? 0, 6);
    expect(withoutSourceSpans(repeated.hlist?.items)).toEqual(withoutSourceSpans(explicit.hlist?.items));
  });

  it("lays out array preamble inserts with TeX arraycolsep semantics", () => {
    const defaultSpacing = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{c}a\end{array}`).list,
      { style: "display" }
    );
    const trimmedSpacing = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{@{}c@{}}a\end{array}`).list,
      { style: "display" }
    );

    expect(defaultSpacing.supported).toBe(true);
    expect(trimmedSpacing.supported).toBe(true);
    expect((defaultSpacing.hlist?.width ?? 0) - (trimmedSpacing.hlist?.width ?? 0)).toBeCloseTo(10, 5);

    const replacedSpacing = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{c@{x}c}a&b\end{array}`).list,
      { style: "display" }
    );
    const addedSpacing = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{c!{x}c}a&b\end{array}`).list,
      { style: "display" }
    );

    expect(replacedSpacing.supported).toBe(true);
    expect(addedSpacing.supported).toBe(true);
    expect((addedSpacing.hlist?.width ?? 0) - (replacedSpacing.hlist?.width ?? 0)).toBeCloseTo(10, 5);
    const replacedRow = replacedSpacing.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(replacedRow?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "hlist", role: "array-insert" }),
    ]));

    const insertRuleMix = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{!{a}|@{b}c}X\end{array}`).list,
      { style: "display" }
    );
    expect(insertRuleMix.supported).toBe(true);
    expect(insertRuleMix.hlist?.width).toBeCloseTo(26.046982, 4);
    const insertRuleRow = insertRuleMix.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(insertRuleRow?.items).toMatchObject([
      { kind: "hlist", role: "array-insert", x: 0 },
      { kind: "rule", role: "array-rule", x: expect.closeTo(7.2859, 4) },
      { kind: "hlist", role: "array-insert", x: expect.closeTo(7.6859, 4) },
      { kind: "hlist", role: "array-cell", x: expect.closeTo(11.9776, 4) },
    ]);

    const ruleInsertMix = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{|!{a}c}X\end{array}`).list,
      { style: "display" }
    );
    expect(ruleInsertMix.supported).toBe(true);
    expect(ruleInsertMix.hlist?.width).toBeCloseTo(26.755325, 4);
    const ruleInsertRow = ruleInsertMix.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(ruleInsertRow?.items).toMatchObject([
      { kind: "rule", role: "array-rule", x: 0 },
      { kind: "hlist", role: "array-insert", x: expect.closeTo(2.4, 4) },
      { kind: "hlist", role: "array-cell", x: expect.closeTo(12.6859, 4) },
    ]);
  });

  it("lays out array cell template inserts inside column boxes", () => {
    const prefixed = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{> {x} c}X\end{array}`).list,
      { style: "display" }
    );

    expect(prefixed.supported).toBe(true);
    expect(prefixed.hlist?.width).toBeCloseTo(24.784714, 4);
    const prefixedRow = prefixed.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const prefixedCell = prefixedRow?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(prefixedCell).toMatchObject({
      kind: "hlist",
      role: "array-cell",
      x: 5,
      width: expect.closeTo(14.78473, 4),
    });
    expect(prefixedCell?.items).toMatchObject([
      { kind: "hlist", role: "array-insert", x: 0, width: expect.closeTo(5.71528, 4) },
      { kind: "hlist", role: "nucleus", x: expect.closeTo(5.71528, 4) },
    ]);

    const suffixed = layoutTexMathList(
      parseTexMath(String.raw`\begin{array}{c<{A}}x\\y\end{array}`).list,
      { style: "display" }
    );

    expect(suffixed.supported).toBe(true);
    expect(suffixed.hlist?.width).toBeCloseTo(23.2153, 4);
    const suffixedFirstRow = suffixed.hlist?.items[0] as TexMathChildHListLayoutItem | undefined;
    const suffixedFirstCell = suffixedFirstRow?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(suffixedFirstCell?.items).toMatchObject([
      { kind: "hlist", role: "nucleus", x: 0 },
      { kind: "hlist", role: "array-insert", x: expect.closeTo(5.71528, 4) },
    ]);
  });

  it("lays out cases as amsmath array with stretched struts, quad gap, and left brace", () => {
    const result = layoutTexMathList(
      parseTexMath(String.raw`\begin{cases}a&b\\x&y\end{cases}`).list,
      { style: "display" }
    );

    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(30.23249, 5);
    expect(result.hlist?.height).toBeCloseTo(17.50015, 5);
    expect(result.hlist?.depth).toBeCloseTo(12.50015, 5);
    expect(result.hlist?.items).toMatchObject([
      {
        kind: "glyph",
        fontId: "cmex10",
        code: 40,
        y: expect.closeTo(-17.10016, 5),
      },
      {
        kind: "hlist",
        role: "nucleus",
        x: expect.closeTo(8.0556, 5),
        width: expect.closeTo(20.97689, 5),
        height: expect.closeTo(16.9, 5),
        depth: expect.closeTo(11.9, 5),
      },
    ]);
    const body = result.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    expect(body?.items).toMatchObject([
      {
        kind: "hlist",
        role: "cases-row",
        y: expect.closeTo(-6.820044, 5),
        height: expect.closeTo(10.079956, 5),
        depth: expect.closeTo(4.320044, 5),
      },
      {
        kind: "hlist",
        role: "cases-row",
        y: expect.closeTo(7.579956, 5),
        height: expect.closeTo(10.079956, 5),
        depth: expect.closeTo(4.320044, 5),
      },
    ]);
    const firstRow = body?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(firstRow?.items).toMatchObject([
      { kind: "hlist", role: "cases-cell", x: 0 },
      { kind: "hlist", role: "cases-cell", x: expect.closeTo(15.71528, 5) },
    ]);

    const ellipsisBoundary = layoutTexMathList(
      parseTexMath(String.raw`\begin{cases}\cdots&x\end{cases}`).list
    );
    expect(ellipsisBoundary.supported).toBe(true);
    expect(ellipsisBoundary.hlist?.width).toBeCloseTo(36.915192, 3);
    const ellipsisBody = ellipsisBoundary.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    const ellipsisRow = ellipsisBody?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(ellipsisRow?.items).toMatchObject([
      { kind: "hlist", role: "cases-cell", x: 0, width: expect.closeTo(13.333386, 5) },
      { kind: "hlist", role: "cases-cell", x: expect.closeTo(23.333386, 5) },
    ]);
  });

  it("lays out plain-TeX cases macros through the cases layout", () => {
    const result = layoutTexMathList(
      parseTexMath(String.raw`\cases{a&b\\x&y}`).list,
      { style: "display" }
    );

    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(30.23249, 5);
    expect(result.hlist?.height).toBeCloseTo(17.50015, 5);
    expect(result.hlist?.depth).toBeCloseTo(12.50015, 5);
    const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
    expect(glyphs.map((glyph) => `${glyph.fontId}/${glyph.code}`)).toContain("cmex10/40");
  });

  it("lays out smallmatrix with scriptstyle cells, thin outer skips, and TeX row spacing", () => {
    const result = layoutTexMathList(
      parseTexMath(String.raw`\begin{smallmatrix}a&b\\x&y\end{smallmatrix}`).list
    );

    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(14.952627, 6);
    expect(result.hlist?.height).toBeCloseTo(8.611115, 6);
    expect(result.hlist?.depth).toBeCloseTo(3.611115, 6);
    expect(result.hlist?.items).toMatchObject([
      { kind: "glue", x: 0, width: expect.closeTo(1.666672, 6), mu: 3 },
      {
        kind: "hlist",
        role: "smallmatrix-row",
        x: expect.closeTo(1.666672, 6),
        y: expect.closeTo(-3.75, 6),
      },
      {
        kind: "hlist",
        role: "smallmatrix-row",
        x: expect.closeTo(1.666672, 6),
        y: expect.closeTo(2.25, 6),
      },
      { kind: "glue", x: expect.closeTo(13.285955, 6), width: expect.closeTo(1.666672, 6), mu: 3 },
    ]);
    const firstRow = result.hlist?.items[1] as TexMathChildHListLayoutItem | undefined;
    const secondRow = result.hlist?.items[2] as TexMathChildHListLayoutItem | undefined;
    expect(firstRow?.items).toMatchObject([
      { kind: "hlist", role: "smallmatrix-cell", x: expect.closeTo(0.098546, 6) },
      { kind: "hlist", role: "smallmatrix-cell", x: expect.closeTo(7.707567, 6) },
    ]);
    expect(secondRow?.items).toMatchObject([
      { kind: "hlist", role: "smallmatrix-cell", x: 0 },
      { kind: "hlist", role: "smallmatrix-cell", x: expect.closeTo(7.312526, 6) },
    ]);
    const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
    expect(glyphs.map((glyph) => `${glyph.fontId}/${glyph.atPt}/${glyph.code}`)).toEqual([
      "cmmi7/7/97",
      "cmmi7/7/98",
      "cmmi7/7/120",
      "cmmi7/7/121",
    ]);
  });

  it("lays out Mathtools fenced smallmatrix variants with alignment options", () => {
    const result = layoutTexMathList(
      parseTexMath(String.raw`\begin{bsmallmatrix*}[l]a&bb\\ccc&d\end{bsmallmatrix*}`).list
    );

    expect(result.supported).toBe(true);
    expect(result.hlist?.items.some((item) => item.kind === "hlist" && item.role === "nucleus")).toBe(true);
    const body = result.hlist?.items.find((item) =>
      item.kind === "hlist" && item.role === "nucleus"
    ) as TexMathChildHListLayoutItem | undefined;
    const firstRow = body?.items[1] as TexMathChildHListLayoutItem | undefined;
    const firstCell = firstRow?.items[0] as TexMathChildHListLayoutItem | undefined;
    expect(firstCell?.x).toBe(0);
    const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
    expect(glyphs.some((glyph) => glyph.fontId === "cmex10" && glyph.code === 2)).toBe(true);
    expect(glyphs.some((glyph) => glyph.fontId === "cmex10" && glyph.code === 3)).toBe(true);
  });

  it("uses amsmath cmex script sizing inside matrix cells", () => {
    const result = layoutTexMathList(
      parseTexMath(String.raw`\begin{matrix}3_{\sum}\end{matrix}`).list
    );

    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(13.902834, 5);
    const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
    expect(glyphs.map((glyph) => `${glyph.fontId}/${glyph.atPt}/${glyph.code}`)).toEqual([
      "cmr10/10/51",
      "cmex7/7/80",
    ]);
    expect(glyphs[1]).toMatchObject({
      width: expect.closeTo(8.402814, 5),
      y: expect.closeTo(-5.250046, 5),
    });
  });

  it("lays out pmatrix as an amsmath matrix wrapped in TeX-sized delimiters", () => {
    const result = layoutTexMathList(
      parseTexMath(String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`).list,
      { style: "display" }
    );

    expect(result.supported).toBe(true);
    expect(result.hlist?.width).toBeCloseTo(35.21308, 5);
    expect(result.hlist?.height).toBeCloseTo(14.50012, 5);
    expect(result.hlist?.depth).toBeCloseTo(9.50012, 5);
    const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
    expect(glyphs.map((glyph) => `${glyph.fontId}/${glyph.code}`)).toEqual([
      "cmex10/18",
      "cmmi10/97",
      "cmmi10/98",
      "cmmi10/99",
      "cmmi10/100",
      "cmex10/19",
    ]);
    expect(glyphs[0]).toMatchObject({
      x: 0,
      y: expect.closeTo(-14.10013, 5),
    });
    expect(glyphs.at(-1)).toMatchObject({
      x: expect.closeTo(27.85193, 5),
      y: expect.closeTo(-14.10013, 5),
    });
  });

  it("lays out AMS matrix delimiter variants with TeX delimiter glyphs", () => {
    const cases = [
      {
        environment: "bmatrix",
        width: 31.0464,
        delimiterCodes: [20, 21],
      },
      {
        environment: "Bmatrix",
        width: 35.49082,
        delimiterCodes: [26, 27],
      },
      {
        environment: "vmatrix",
        width: 27.15746,
        delimiterCodes: [12, 12],
      },
      {
        environment: "Vmatrix",
        width: 31.60192,
        delimiterCodes: [13, 13],
      },
    ];

    for (const testCase of cases) {
      const result = layoutTexMathList(
        parseTexMath(String.raw`\begin{` + testCase.environment + String.raw`}a&b\\c&d\end{` + testCase.environment + "}").list,
        { style: "display" }
      );
      expect(result.supported).toBe(true);
      expect(result.hlist?.width).toBeCloseTo(testCase.width, 5);
      expect(result.hlist?.height).toBeCloseTo(14.50012, 5);
      expect(result.hlist?.depth).toBeCloseTo(9.50012, 5);
      const glyphs = flattenGlyphItems(result.hlist?.items ?? []);
      expect(glyphs.some((glyph) => glyph.fontId === "cmmi10" && glyph.code === 97)).toBe(true);
      expect(glyphs[0]).toMatchObject({
        fontId: "cmex10",
        code: testCase.delimiterCodes[0],
      });
      expect(glyphs.at(-1)).toMatchObject({
        fontId: "cmex10",
        code: testCase.delimiterCodes[1],
      });
    }
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

  it("uses cramped radicand style and TeX overbar thickness for radicals", () => {
    const result = layout(String.raw`\sqrt{y^2}`);

    expect(result.supported).toBe(true);
    expect(result.hlist?.items[0]).toMatchObject({
      kind: "glyph",
      fontId: "cmex10",
      code: 112,
      y: expect.closeTo(-8.777833, 5),
      height: expect.closeTo(0.39999, 5),
    });
    expect(result.hlist?.items[1]).toMatchObject({
      kind: "rule",
      role: "radical-rule",
      y: expect.closeTo(-9.177823, 5),
      height: expect.closeTo(0.39999, 5),
    });
    const radicand = result.hlist?.items[2] as TexMathChildHListLayoutItem | undefined;
    const superscript = radicand?.items[2] as TexMathChildHListLayoutItem | undefined;
    expect(superscript).toMatchObject({
      kind: "hlist",
      role: "superscript",
      y: expect.closeTo(-2.88889, 5),
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

    const delimiters = layout(String.raw`\left\lbrace x\right\rbrace\left|x\right|\left\lvert x\right\rvert\left\Vert x\right\Vert\left\lVert x\right\rVert\left\backslash x\right/`);
    expect(delimiters.supported).toBe(true);
    expect(delimiters.hlist?.items.filter((item) => item.kind === "glyph").map((item) => item.code)).toEqual([
      102,
      103,
      106,
      106,
      106,
      106,
      107,
      107,
      107,
      107,
      110,
      47,
    ]);
    expect(delimiters.hlist?.items[1]).toMatchObject({
      kind: "hlist",
      items: [{ kind: "glyph", fontId: "cmmi10", code: 120 }],
    });

    const corners = layout(String.raw`\left\ulcorner x\right\urcorner\left\llcorner x\right\lrcorner`);
    expect(corners.supported).toBe(true);
    expect(corners.hlist?.items.filter((item) => item.kind === "glyph").map((item) => ({
      fontId: item.fontId,
      code: item.code,
    }))).toEqual([
      { fontId: "msam10", code: 0x70 },
      { fontId: "msam10", code: 0x71 },
      { fontId: "msam10", code: 0x78 },
      { fontId: "msam10", code: 0x79 },
    ]);
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
