import { describe, expect, it } from "vitest";
import { layoutTexMathList, parseTexMath, type TexMathGlyphLayoutItem } from "../packages/core/src/text/tex/index.js";

function layout(formula: string) {
  const parsed = parseTexMath(formula);
  expect(parsed.diagnostics).toEqual([]);
  const result = layoutTexMathList(parsed.list);
  expect(result.supported).toBe(true);
  if (!result.hlist) throw new Error("Missing arrow layout.");
  return result.hlist;
}

// Values recorded from LuaLaTeX/amsmath, including the painted leaders.
describe("amsmath extensible arrow regressions", () => {
  it.each([
    [String.raw`\xrightarrow[a]{a}`, 10.71109, 33],
    [String.raw`\xleftarrow[x]{1}`, 10.908173, 32],
  ] as const)("preserves the short-arrow width and label baselines in %s", (formula, width, head) => {
    const hlist = layout(formula);
    expect(hlist.width).toBeCloseTo(width, 3);
    const glyphs = hlist.items.filter((item): item is TexMathGlyphLayoutItem => item.kind === "glyph");
    expect(glyphs.map((item) => item.code).sort((a, b) => a - b)).toEqual([0, head]);
    expect(glyphs.find((item) => item.code === 0)).toMatchObject({ height: 0, depth: 0 });
    const limits = hlist.items.filter((item) => item.kind === "hlist");
    expect(limits.map((item) => item.y)).toEqual([
      expect.closeTo(-5.668732, 3), expect.closeTo(6, 3),
    ]);
  });

  it.each([
    [String.raw`\xrightarrow[xy]{abcdabcd}`, [0, 5.444183, 10.999817, 16.55545, 22.111084, 27.555283]],
    [String.raw`\xleftarrow[xy]{abcdabcd}`, [0, 7.666397, 13.222031, 18.777664, 24.333298, 29.777496]],
  ] as const)("centers shaft leaders within the measured width in %s", (formula, positions) => {
    const hlist = layout(formula);
    expect(hlist.width).toBeCloseTo(37.555298, 3);
    const glyphs = hlist.items.filter((item): item is TexMathGlyphLayoutItem => item.kind === "glyph");
    expect(glyphs.map((item) => item.x)).toEqual(positions.map((x) => expect.closeTo(x, 3)));
    expect(glyphs.filter((item) => item.code === 0).every((item) => item.height === 0 && item.depth === 0)).toBe(true);
  });

  it("measures script arrows in scriptstyle while typesetting their labels in scriptscriptstyle", () => {
    const hlist = layout(String.raw`\scriptstyle\xrightarrow[a]{a}`);
    expect(hlist.width).toBeCloseTo(10.71109, 3);
    const limits = hlist.items.filter((item) => item.kind === "hlist");
    expect(limits.map((item) => item.y)).toEqual([
      expect.closeTo(-5.068726, 3), expect.closeTo(4.277756, 3),
    ]);
    expect(limits.flatMap((item) => item.items).filter((item) => item.kind === "glyph")
      .map((item) => item.fontId)).toEqual(["cmmi5", "cmmi5"]);
  });

  it.each([String.raw`\xrightarrow{}`, String.raw`\xleftarrow[]{}`])(
    "omits absent limit boxes for %s", (formula) => {
      const hlist = layout(formula);
      expect(hlist.items.some((item) => item.kind === "hlist")).toBe(false);
      expect(hlist.height).toBeCloseTo(3.668732, 3);
      expect(hlist.depth).toBe(0);
    }
  );

  it("retains the bottom label without reserving space for an empty top label", () => {
    const hlist = layout(String.raw`\xrightarrow[a]{}`);
    expect(hlist.items.filter((item) => item.kind === "hlist").map((item) => item.role)).toEqual(["limit-subscript"]);
    expect(hlist.height).toBeCloseTo(3.668732, 3);
  });
});
