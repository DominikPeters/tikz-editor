import { describe, expect, it } from "vitest";
import {
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph,
  layoutTexMathList,
  parseTexMath,
  renderTexMathHListSvgBody,
} from "../packages/core/src/text/tex/index.js";

describe("TeX math SVG rendering", () => {
  it("renders simple hlist glyphs as TeX font SVG paths in MathJax-compatible units", () => {
    const parsed = parseTexMath("a+1", { sourceOffset: 10 });
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-math-hlist="true"');
    expect(body).toContain('data-tex-math-style="text"');
    expect(body).toContain('data-source-start="10"');
    expect(body).toContain('data-source-end="13"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="97"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="43"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="49"');
    expect(body).toContain('transform="translate(0 0) scale(100)"');
    expect(body).toContain('transform="translate(750.8129 0) scale(100)"');
  });

  it("renders script-style hlist glyphs with script font scaling", () => {
    const parsed = parseTexMath("a");
    const result = layoutTexMathList(parsed.list, { style: "script" });
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmmi7" data-tex-glyph="97"');
    expect(body).toContain('transform="translate(0 0) scale(70)"');
  });

  it("renders simple script hlists recursively with vertical glyph offsets", () => {
    const parsed = parseTexMath("x^2");
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="120"');
    expect(body).toContain('data-tex-font="cmr7" data-tex-glyph="50"');
    expect(body).toContain('transform="translate(571.528 -362.892) scale(70)"');
  });

  it("renders grouped list nuclei recursively", () => {
    const parsed = parseTexMath("{x+y}^2");
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="120"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="43"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="121"');
    expect(body).toContain('data-tex-font="cmr7" data-tex-glyph="50"');
    expect(body).toContain('transform="translate(2319.9158 -362.892) scale(70)"');
  });

  it("renders simple fractions with glyphs and a TeX rule", () => {
    const parsed = parseTexMath(String.raw`\frac{1}{2}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmr7" data-tex-glyph="49"');
    expect(body).toContain('data-tex-font="cmr7" data-tex-glyph="50"');
    expect(body).toContain('data-tex-rule="fraction-rule"');
    expect(body).toContain('x="120"');
    expect(body).toContain('y="-269.9995"');
    expect(body).toContain('width="398.6129"');
    expect(body).toContain('height="39.999"');
  });

  it("renders simple radicals with the CM radical glyph and TeX rule", () => {
    const parsed = parseTexMath(String.raw`\sqrt{x}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="112"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="120"');
    expect(body).toContain('data-tex-rule="radical-rule"');
    expect(body).toContain('transform="translate(0 -720.2774) scale(100)"');
    expect(body).toContain('x="833.336"');
    expect(body).toContain('y="-760.2764"');
  });

  it("renders taller radicals with TeX next-larger extension glyphs", () => {
    const parsed = parseTexMath(String.raw`\sqrt{\frac{1}{2}}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="113"');
    expect(body).toContain('data-tex-rule="radical-rule"');
    expect(body).toContain('transform="translate(0 -1155.0098) scale(100)"');
    expect(body).toContain('x="1000.003"');
    expect(body).toContain('y="-1195.0088"');
  });

  it("creates inline math boxes for supported formulas without MathJax", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const box = provider.getInlineMathBox({
      source: "$x-y$",
      content: "x-y",
      delimiter: "dollar",
      sourceStart: 6,
      sourceEnd: 11,
      contentStart: 7,
      contentEnd: 10,
    });

    expect(box).toMatchObject({
      source: "$x-y$",
      content: "x-y",
      sourceStart: 6,
      sourceEnd: 11,
      width: expect.closeTo(23.199158, 6),
      height: expect.any(Number),
      depth: expect.any(Number),
    });
    expect(box?.svgBody).toContain('data-tex-math-hlist="true"');
    expect(box?.svgBody).toContain('data-source-start="7"');
    expect(box?.svgBody).toContain('data-source-end="10"');
    expect(box?.svgBody).toContain('data-tex-font="cmsy10" data-tex-glyph="0"');
  });

  it("creates inline math boxes for simple superscripts and subscripts without MathJax", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const box = provider.getInlineMathBox({
      source: "$y_i^2$",
      content: "y_i^2",
      delimiter: "dollar",
      sourceStart: 4,
      sourceEnd: 11,
      contentStart: 5,
      contentEnd: 10,
    });

    expect(box).toMatchObject({
      source: "$y_i^2$",
      content: "y_i^2",
      sourceStart: 4,
      sourceEnd: 11,
      width: expect.closeTo(9.747739, 6),
    });
    expect(box?.svgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="121"');
    expect(box?.svgBody).toContain('data-tex-font="cmr7" data-tex-glyph="50"');
    expect(box?.svgBody).toContain('data-tex-font="cmmi7" data-tex-glyph="105"');
  });

  it("returns null for unsupported formulas instead of approximate SVG", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const source = String.raw`$\sqrt{\sqrt{\sqrt{\sqrt{\frac{1}{2}}}}}$`;
    const content = String.raw`\sqrt{\sqrt{\sqrt{\sqrt{\frac{1}{2}}}}}`;
    const box = provider.getInlineMathBox({
      source,
      content,
      delimiter: "dollar",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: 1,
      contentEnd: source.length - 1,
    });

    expect(box).toBeNull();
  });

  it("lets TeX paragraph layout render supported inline math through the provider", () => {
    const source = String.raw`Alpha $x-y$ beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:math-provider",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const mathSegment = result.report?.lines
      .flatMap((line) => line.segments)
      .find((segment) => segment.kind === "math");
    expect(mathSegment).toMatchObject({
      text: "x-y",
      sourceStartRaw: source.indexOf("$x-y$"),
      sourceEndRaw: source.indexOf("$x-y$") + "$x-y$".length,
      sourceKind: "math",
      width: expect.closeTo(23.199158, 6),
    });
    expect(mathSegment?.mathSvgBody).toContain('data-tex-math-hlist="true"');
    expect(mathSegment?.mathSvgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="120"');
  });
});
