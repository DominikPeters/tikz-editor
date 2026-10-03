import { describe, expect, it } from "vitest";
import { texHBoxLocalX } from "../packages/core/src/text/tex/coordinates.js";
import {
  createTexDerivedInlineMathBoxProvider,
  layoutTexMathList,
  parseTexMath,
  type TexMathHListItem,
} from "../packages/core/src/text/tex/index.js";

function layout(source: string) {
  const parsed = parseTexMath(source);
  expect(parsed.diagnostics).toEqual([]);
  const result = layoutTexMathList(parsed.list);
  expect(result.supported).toBe(true);
  return result.hlist!;
}

function glyphs(items: readonly TexMathHListItem[], originX = 0): Extract<TexMathHListItem, { kind: "glyph" }>[] {
  return items.flatMap(item => item.kind === "glyph" ? [{ ...item, x: texHBoxLocalX(originX + item.x) }]
    : item.kind === "hlist" ? glyphs(item.items, originX + item.x) : []);
}

describe("TeX ordinary character noads", () => {
  // Retained actual LuaLaTeX T05 pair traces. The positive values are
  // zero-space cmmi10 italic corrections; AV has a genuine cmti10 kern.
  it.each([
    ["BC", 15.949295, 8.086807], ["CD", 16.419434, 7.862488],
    ["DE", 16.515259, 8.556946], [String.raw`\mathit{AV}`, 15.680466, 6.411072],
    ["AB", 15.586823, 7.500015], ["xy", 10.976868, 5.715271], ["ab", 9.577545, 5.285889],
  ] as const)("matches retained width and second-glyph position for %s", (source, width, secondX) => {
    const box = layout(source);
    expect(box.width).toBeCloseTo(width, 3);
    expect(glyphs(box.items)[1].x).toBeCloseTo(secondX, 3);
    if (source === "BC") expect(box.items[1]).toMatchObject({ kind: "kern", reason: "italic-correction" });
    if (source.includes("mathit")) expect(box.items[0].kind).toBe("hlist");
  });

  // Fresh Batch20 LuaLaTeX boundary traces, including font ligatures.
  it.each([
    [String.raw`\mathit{AV_i}`, 17.540894], [String.raw`\mathit{A_iV}`, 20.399216],
    [String.raw`\mathit{A{V}}`, 15.680466], [String.raw`\mathit{A\,V}`, 18.369308],
    [String.raw`\mathit{A\mathclose{V}}`, 15.680466],
    [String.raw`\mathrm{ffi}`, 8.333359], [String.raw`\mathrm{ff_i}`, 8.597260],
    [String.raw`x^{\mathit{AV}}`, 18.814026],
  ] as const)("preserves TeX eligibility and metrics for %s", (source, width) => {
    expect(layout(source).width).toBeCloseTo(width, 3);
  });

  it("keeps source glyphs distinct around a negative kern and transfers right scripts to a ligature", () => {
    const source = String.raw`\mathit{AV_i}`;
    const run = glyphs(layout(source).items);
    expect(run.map(item => item.sourceSpan)).toEqual([
      { start: source.indexOf("A"), end: source.indexOf("A") + 1 },
      { start: source.indexOf("V"), end: source.indexOf("V") + 1 },
      { start: source.lastIndexOf("i"), end: source.lastIndexOf("i") + 1 },
    ]);
    const ligature = glyphs(layout(String.raw`\mathrm{ff_i}`).items);
    expect(ligature.map(item => item.code)).toEqual([11, 105]);
    expect(ligature[0].sourceSpan).toEqual({ start: 8, end: 10 });
    expect(ligature[1].x).toBeCloseTo(5.833359, 3);
  });

  it("uses restored ordinary character widths inside accents", () => {
    const box = layout(String.raw`\widehat{ABCDE}`);
    expect(box.width).toBeCloseTo(39.964569, 3);
    expect(glyphs(box.items)[0].x).toBeCloseTo(12.760071, 3);
  });

  it.each([String.raw`\mathit{A\mathinner{V}}`, String.raw`\mathit{A{VV}}`])("keeps ineligible right noads outside make_ord for %s", source => {
    const wrapper = layout(source).items[0];
    expect(wrapper.kind).toBe("hlist");
    if (wrapper.kind !== "hlist") return;
    expect(glyphs(wrapper.items).map(item => item.code)).toEqual(source.includes("VV") ? [65, 86, 86] : [65, 86]);
    if (source.includes("VV")) expect(wrapper.items.some(item => item.kind === "hlist")).toBe(true);
    expect(wrapper.items.filter(item => item.kind === "kern" && item.reason === "text-kern")).toEqual([]);
  });

  it("does not kern across alphabet families", () => {
    const box = layout(String.raw`\mathit{A}\mathrm{V}`);
    expect(glyphs(box.items).map(item => item.fontId)).toEqual(["cmti10", "cmr10"]);
    expect(box.items.filter(item => item.kind === "kern" && item.reason === "text-kern")).toEqual([]);
  });

  it.each([String.raw`\mathit{A{{V}}}`, String.raw`\mathit{{{A}}V}`])("simplifies eligible original Ord wrappers recursively for %s", source => {
    const box = layout(source);
    expect(box.width).toBeCloseTo(15.680466, 3);
    const run = glyphs(box.items);
    expect(run[1].x).toBeCloseTo(6.411072, 3);
    expect(run.map(item => item.sourceSpan)).toEqual(["A", "V"].map(character => ({
      start: source.indexOf(character), end: source.indexOf(character) + 1,
    })));
  });

  it("collapses nested ordinary ligatures while preserving authored glyph and caret ownership", () => {
    const source = String.raw`\mathrm{f{{f}}i}`;
    const parsed = parseTexMath(source);
    const original = JSON.stringify(parsed.list);
    const box = layoutTexMathList(parsed.list).hlist!;
    expect(box.width).toBeCloseTo(8.333359, 3);
    expect(glyphs(box.items)).toMatchObject([{ code: 14, sourceSpan: {
      start: source.indexOf("{") + 1, end: source.lastIndexOf("i") + 1,
    }, sourceCharacterSpans: [source.indexOf("f"), source.lastIndexOf("f"), source.lastIndexOf("i")]
      .map(start => ({ start, end: start + 1 })) }]);
    expect(glyphs(box.items)).toHaveLength(1);
    expect(JSON.stringify(parsed.list)).toBe(original);
    const provider = createTexDerivedInlineMathBoxProvider();
    const inline = provider.getInlineMathBox({ source, content: source, delimiter: "dollar", sourceStart: 0,
      sourceEnd: source.length, contentStart: 0, contentEnd: source.length });
    expect(inline?.caretStops).toHaveLength(source.length + 1);
    for (const offset of [source.indexOf("f"), source.lastIndexOf("f"), source.lastIndexOf("i")]) {
      expect(inline?.caretMap?.entries.some(entry => entry.sourceOffset === offset)).toBe(true);
    }
    // Nested brace gaps remain editable without adding glyph advance.
    expect(inline?.caretStops?.[9]).toBe(inline?.caretStops?.[10]);
    expect(inline?.caretStops?.[10]).toBe(inline?.caretStops?.[11]);
    expect(inline?.caretStops?.[12]).toBe(inline?.caretStops?.[13]);
    expect(inline?.caretStops?.[13]).toBe(inline?.caretStops?.[14]);
  });

  it.each([
    [String.raw`\mathit{A{\mathbin{V}}}`, 16.70269],
    [String.raw`\mathit{{A{\mathbin{V}}}}`, 16.70269],
    [String.raw`\mathit{{{A_i}}V}`, 20.399216],
    [String.raw`\mathit{A{{V_i}}}`, 18.563111],
  ] as const)("retains original class and script barriers for %s", (source, width) => {
    expect(layout(source).width).toBeCloseTo(width, 3);
  });

  it("retains a nested multi-atom barrier", () => {
    expect(layout(String.raw`\mathit{A{{VV}}}`).width).toBe(layout(String.raw`\mathit{A{VV}}`).width);
    expect(layout(String.raw`\mathit{A{{VV}}}`).width).toBeGreaterThan(layout(String.raw`\mathit{AVV}`).width);
  });

  it.each([String.raw`\mathit{AV}`, String.raw`\mathrm{ffi}`])("retains source and interior caret coverage for %s", source => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const box = provider.getInlineMathBox({ source, content: source, delimiter: "dollar", sourceStart: 0,
      sourceEnd: source.length, contentStart: 0, contentEnd: source.length });
    expect(box).not.toBeNull();
    const start = source.indexOf("{") + 1;
    // The existing alphabet-command caret limitation is outside this fix;
    // every authored character, including ligature interiors, stays covered.
    expect((box?.caretMap?.diagnostics ?? []).every(diagnostic => diagnostic.sourceSpan.end <= start)).toBe(true);
    for (let offset = start; offset < source.length - 1; offset += 1) {
      expect(box?.caretMap?.entries.some(entry => entry.sourceOffset === offset)).toBe(true);
    }
    expect(box?.caretStops).toHaveLength(source.length + 1);
  });
});
