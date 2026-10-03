import { describe, expect, it } from "vitest";
import {
  createTexDerivedInlineMathBoxProvider, layoutSimpleTexParagraph, parseSimpleTexParagraphIr, texLength,
} from "../packages/core/src/text/tex/index.js";
import { flattenPositionedTexVListItems } from "../packages/core/src/text/tex/vlist/index.js";

function layout(source: string, width = 220) {
  const result = layoutSimpleTexParagraph(source, { width: texLength(width), parindent: texLength(0),
    mathBoxProvider: createTexDerivedInlineMathBoxProvider() });
  expect(result.supported, result.fallbackReason ?? "").toBe(true);
  return result.vlistLayout!;
}
function displays(source: string) {
  return flattenPositionedTexVListItems(layout(source).items).filter(entry => entry.item.kind === "display-math");
}
const align = String.raw`\begin{align*}a&=b\\c&=d\end{align*}`;

describe("display math retains surrounding TeX state", () => {
  it("restores a grouped small declaration and its display registers", () => {
    const source = String.raw`Alpha {\small \[x\]} Beta \[x\] Gamma`;
    const boxes = displays(source);
    // Retained LuaLaTeX T01-T04 grouped-small hlist metrics and positions.
    expect(boxes).toHaveLength(2);
    for (const [index, [width, y]] of [[5.243042, 14.285019], [5.715271, 41.854462]].entries()) {
      expect(boxes[index].metrics.width).toBeCloseTo(width, 3);
      expect(boxes[index].y).toBeCloseTo(y, 3);
      if (boxes[index].item.kind !== "display-math") throw new Error("Expected display");
      const box = boxes[index].item.box;
      const offset = source.indexOf("x", index ? source.indexOf("Beta") : 0);
      expect(box.contentStart).toBe(offset);
      expect(box.caretMap?.entries.some(entry => entry.sourceOffset === offset && entry.kind === "glyph-boundary")).toBe(true);
    }
  });

  it("uses explicit font size for a numbered equation and its tag without resetting display skips", () => {
    const source = String.raw`\fontsize{14}{17}\selectfont Alpha \begin{equation}x\end{equation} Beta`;
    const result = layout(source);
    const boxes = flattenPositionedTexVListItems(result.items).filter(entry => entry.item.kind === "display-math");
    expect(boxes).toHaveLength(1);
    // Roman optical-size selection remains a separate font-profile limit (.028pt here).
    expect(boxes[0].y).toBeCloseTo(16.496002, 1);
    expect(boxes[0].metrics.height).toBeCloseTo(10.5, 3);
    expect(boxes[0].metrics.depth).toBeCloseTo(3.514008, 1);
    const beta = result.boxReport.tree.filter(entry => entry.itemKind === "paragraph").at(-1)!;
    expect(beta.y).toBeCloseTo(40.434006, 1);
    const skips = result.boxReport.tree.filter(entry => entry.glue?.origin?.kind === "display-math-boundary");
    expect(skips.map(entry => entry.glue?.size)).toEqual([0, 6]);
  });

  it("selects small alignment glyphs, current struts and opened baselines", () => {
    const result = layout(String.raw`\small Alpha ${align} Beta`);
    const rows = result.boxReport.tree.filter(entry => entry.hboxRole?.kind === "display-align-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].y).toBeCloseTo(18.244034, 3);
    expect(rows[1].y).toBeCloseTo(32.244034, 3);
    expect(rows[0].width).toBeCloseTo(121.013123, 3);
    expect(rows[0].height).toBeCloseTo(7.699966, 3);
    expect(rows[0].depth).toBeCloseTo(3.300034, 3);
    expect(result.boxReport.tree.filter(entry => entry.itemKind === "paragraph").at(-1)!.y).toBeCloseTo(53.296997, 3);
  });

  it("restores nested size scopes and keeps fontsize's inherited display registers", () => {
    const source = String.raw`\small \[x\] {\Huge \[x\] {\fontsize{14}{17}\selectfont \[x\]}} \[x\] \normalsize \[x\]`;
    const items = parseSimpleTexParagraphIr(source).items.filter(item => item.kind === "display-math");
    expect(items.map(item => item.fontSizePt)).toEqual([9, 24.88, 14, 9, 10]);
    expect(items.map(item => item.baselineSkip)).toEqual([11, 30, 17, 11, 12]);
    expect(items.map(item => item.displaySkipCommand)).toEqual(["small", "small", "small", "small", "normalsize"]);
  });

  it("restores named size environments and inherits footnote skips through explicit sizes", () => {
    const environment = parseSimpleTexParagraphIr(String.raw`\begin{small}\[x\]\end{small}\[x\]`).items.filter(item => item.kind === "display-math");
    expect(environment.map(item => item.fontSizePt)).toEqual([9, 10]);
    expect(environment.map(item => item.displaySkipCommand)).toEqual(["small", undefined]);
    const explicit = parseSimpleTexParagraphIr(String.raw`\footnotesize \[x\] \Large \[x\] \fontsize{14pt}{17pt}\selectfont \[x\]`).items.filter(item => item.kind === "display-math");
    expect(explicit.map(item => item.fontSizePt)).toEqual([8, 14.4, 14]);
    expect(explicit.map(item => item.baselineSkip)).toEqual([9.5, 18, 17]);
    expect(explicit.map(item => item.displaySkipCommand)).toEqual(["footnotesize", "footnotesize", "footnotesize"]);
  });

  it("keys display cache entries by request size and baseline registers", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const params = { source: String.raw`\[x\]`, content: "x", delimiter: "bracket" as const,
      sourceStart: 0, sourceEnd: 5, contentStart: 2, contentEnd: 3 };
    const normal = provider.getDisplayMathBox!({ ...params, atPt: texLength(10), baselineSkip: texLength(12) })!;
    const large = provider.getDisplayMathBox!({ ...params, atPt: texLength(14), baselineSkip: texLength(17) })!;
    const changedBaseline = provider.getDisplayMathBox!({ ...params, atPt: texLength(14), baselineSkip: texLength(20) })!;
    expect(large.width).toBeGreaterThan(normal.width);
    expect(changedBaseline).not.toBe(large);
    expect(changedBaseline.width).toBe(large.width);
    expect(provider.getDisplayMathBox!({ ...params, atPt: texLength(10), baselineSkip: texLength(12) })).toBe(normal);
  });
});

describe("AMS display extent owns normal skips", () => {
  it.each(["align*", "flalign*", "gather*"])("uses normal skips for wide %s after short prose", environment => {
    const body = environment === "gather*" ? String.raw`a=b\\c=d` : String.raw`a&=b\\c&=d`;
    const result = layout(String.raw`Alpha \begin{${environment}}${body}\end{${environment}} Beta`);
    const skips = result.boxReport.tree.filter(entry => entry.glue?.origin?.kind === "display-math-boundary");
    expect(skips.map(entry => entry.glue?.size)).toEqual([10, 10]);
    expect(skips.map(entry => entry.glue?.origin?.kind === "display-math-boundary" ? entry.glue.origin.variant : null)).toEqual(["normal", "normal"]);
  });

  it.each(["where equations hold", "where $x$ holds", "where $x_i=y^2$ holds"])("preserves intertext text and nested math at the retained baseline: %s", body => {
    const result = layout(String.raw`Alpha \begin{align*}a&=b\\\intertext{${body}}c&=d\end{align*} Beta`);
    const rows = result.boxReport.tree.filter(entry => entry.hboxRole?.kind === "display-align-row");
    expect(rows.map(row => Number(row.y))).toEqual([expect.closeTo(20.76004, 3), expect.closeTo(70.76004, 3)]);
    expect(result.boxReport.tree.filter(entry => entry.itemKind === "paragraph").at(-1)!.y).toBeCloseTo(94.330002, 3);
  });

  it("keeps ordinary single-equation short skips and recognizes split's full extent", () => {
    const ordinary = layout(String.raw`Alpha \begin{equation}x\end{equation} Beta`);
    expect(ordinary.boxReport.tree.filter(entry => entry.glue?.origin?.kind === "display-math-boundary").map(entry => entry.glue?.size)).toEqual([0, 6]);
    const split = layout(String.raw`Alpha \begin{equation}\begin{split}a&=b\\c&=d\end{split}\end{equation} Beta`);
    expect(split.boxReport.tree.filter(entry => entry.glue?.origin?.kind === "display-math-boundary").map(entry => entry.glue?.size)).toEqual([10, 10]);
  });

  it("retains alignat as an unsupported environment", () => {
    const ir = parseSimpleTexParagraphIr(String.raw`\begin{alignat}{2}a&=b&c&=d\end{alignat}`);
    expect(ir.items.some(item => item.kind === "display-math")).toBe(false);
    expect(ir.nodes.some(node => node.kind === "literal")).toBe(true);
  });
});
