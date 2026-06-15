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

  it("renders math accents through TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`\vec{x}+\hat{\frac{1}{2}}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="126"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="94"');
    expect(body).toContain('transform="translate(-13.3675 0) scale(100)"');
    expect(body).toContain('transform="translate(1863.0603 -414.2878) scale(100)"');
  });

  it("renders text command glyphs through the document text font", () => {
    const parsed = parseTexMath(String.raw`x+\text{if}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="105"');
    expect(body).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="102"');
    expect(body).toContain('data-source-start="8"');
    expect(body).toContain('data-source-end="10"');
  });

  it("renders math alphabet glyphs through vendored CM font paths", () => {
    const parsed = parseTexMath(String.raw`\mathbf{x}+\mathsf{x}+\mathit{x}+\mathtt{x}+\mathcal{A}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmbx10" data-tex-glyph="120"');
    expect(body).toContain('data-tex-font="cmss10" data-tex-glyph="120"');
    expect(body).toContain('data-tex-font="cmti10" data-tex-glyph="120"');
    expect(body).toContain('data-tex-font="cmtt10" data-tex-glyph="120"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="65"');
  });

  it("renders named Greek and relation symbols through TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`\alpha+\Omega+x\leq y\neq z`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="11"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="10"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="20"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="54"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="61"');
  });

  it("renders arrow, set, and logic symbols through TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`A\to B\mapsto C\wedge D\cup E\subseteq F`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="33"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="55"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="94"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="91"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="18"');
  });

  it("renders negated relation composites through positioned TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`x\notin A+x\not\leq y`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="61"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="50"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="54"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="20"');
  });

  it("renders TeX operators through the selected math fonts", () => {
    const parsed = parseTexMath(String.raw`\sum_i^n+\int_0^1+\lim_{x}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="80"');
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="82"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="108"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="105"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="109"');
    expect(body).toContain('transform="translate(0 -750.0065) scale(100)"');
    expect(body).toContain('transform="translate(1055.559 -502.7868) scale(70)"');
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

  it("renders extensible radicals as stacked TeX glyph recipes", () => {
    const parsed = parseTexMath(String.raw`\sqrt{\sqrt{\sqrt{\sqrt{\frac{1}{2}}}}}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="118"');
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="117"');
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="116"');
    expect(body).toContain('transform="translate(0 -2250.014) scale(100)"');
    expect(body).toContain('transform="translate(0 -1690.007) scale(100)"');
    expect(body).toContain('x="1055.559"');
    expect(body).toContain('y="-2290.013"');
  });

  it("renders left-right delimiters through TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`\left(\frac{1}{2}\right)`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="0"');
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="1"');
    expect(body).toContain('transform="translate(0 -810.007) scale(100)"');
    expect(body).toContain('transform="translate(1096.9489 -810.007) scale(100)"');
  });

  it("renders extensible left-right delimiters as stacked glyph recipes", () => {
    const parsed = parseTexMath(String.raw`\left[\sqrt{\sqrt{\sqrt{\sqrt{\frac{1}{2}}}}}\right]`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="50"');
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="54"');
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="52"');
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="51"');
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="55"');
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="53"');
    expect(body).toContain('transform="translate(0 -2310.022) scale(100)"');
    expect(body).toContain('transform="translate(5360.8499 90.002) scale(100)"');
  });

  it("renders TeX delimiter commands through the selected math fonts", () => {
    const parsed = parseTexMath(String.raw`\left\langle x\right\rangle`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="104"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="105"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="120"');
    expect(body).toContain('transform="translate(960.418');
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

  it("creates display-style math boxes for display formulas without MathJax", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const source = String.raw`\[\sum_i^n\]`;
    const box = provider.getDisplayMathBox?.({
      source,
      content: String.raw`\sum_i^n`,
      delimiter: "bracket",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: 2,
      contentEnd: source.length - 2,
    });

    expect(box).toMatchObject({
      source,
      content: String.raw`\sum_i^n`,
      sourceStart: 0,
      sourceEnd: source.length,
      width: expect.closeTo(14.44448, 5),
    });
    expect(box?.svgBody).toContain('data-tex-math-style="display"');
    expect(box?.svgBody).toContain('data-tex-font="cmex10" data-tex-glyph="88"');
    expect(box?.svgBody).toContain('data-tex-font="cmmi7" data-tex-glyph="110"');
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
    const source = String.raw`$\unknown{x}$`;
    const content = String.raw`\unknown{x}`;
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

  it("lets TeX paragraph layout carry supported display math as a vlist item", () => {
    const source = String.raw`Alpha \[\sum_i^n\] Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:display-math-provider",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const display = result.vlistLayout?.boxReport.items.find((item) =>
      item.itemKind === "display-math"
    );
    expect(display).toMatchObject({
      itemKind: "display-math",
      x: expect.closeTo((160 - 14.44448) / 2, 5),
      width: expect.closeTo(14.44448, 5),
      displayMath: {
        delimiter: "bracket",
        contentStart: source.indexOf(String.raw`\sum`),
        contentEnd: source.indexOf(String.raw`\]`),
      },
    });
    expect(result.vlistLayout?.boxReport.items.filter((item) =>
      item.glue?.origin?.kind === "display-math-boundary"
    ).map((item) => item.glue)).toEqual([
      {
        size: 0,
        stretch: 3,
        shrink: 0,
        stretchOrder: "normal",
        shrinkOrder: "normal",
        origin: { kind: "display-math-boundary", side: "above", variant: "short" },
      },
      {
        size: 6,
        stretch: 3,
        shrink: 3,
        stretchOrder: "normal",
        shrinkOrder: "normal",
        origin: { kind: "display-math-boundary", side: "below", variant: "short" },
      },
    ]);
    expect(result.vlistLayout?.paragraphPlacements).toHaveLength(2);
  });

  it("lets TeX paragraph layout carry equation-star display math as a vlist item", () => {
    const source = String.raw`Alpha \begin{equation*}y^2\end{equation*} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:equation-star-display-math-provider",
      width: 120,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const display = result.vlistLayout?.boxReport.items.find((item) =>
      item.itemKind === "display-math"
    );
    expect(display).toMatchObject({
      itemKind: "display-math",
      displayMath: {
        delimiter: "equation-star",
        contentStart: source.indexOf("y^2"),
        contentEnd: source.indexOf(String.raw`\end{equation*}`),
      },
    });
    expect(result.vlistLayout?.paragraphPlacements.map((placement) =>
      source.slice(placement.sourceSpan.start, placement.sourceSpan.end)
    )).toEqual(["Alpha", "Beta"]);
  });

  it("lets TeX paragraph layout carry basic align-star display math as display rows", () => {
    const source = String.raw`Alpha \begin{align*}a&=b\\c&=d\end{align*} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:align-star-display-math-provider",
      width: 120,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const rows = result.vlistLayout?.boxReport.items.filter((item) =>
      item.hboxRole?.kind === "display-align-row"
    ) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      itemKind: "hbox",
      x: 0,
      y: expect.closeTo(20.760034, 5),
      width: expect.closeTo(71.912081, 5),
      height: expect.closeTo(8.399963, 5),
      depth: expect.closeTo(3.600037, 5),
      hboxRole: {
        kind: "display-align-row",
        delimiter: "align-star",
        rowIndex: 0,
      },
    });
    expect(rows[1]).toMatchObject({
      itemKind: "hbox",
      x: 0,
      y: expect.closeTo(35.760034, 5),
      width: expect.closeTo(71.912081, 5),
      hboxRole: {
        kind: "display-align-row",
        rowIndex: 1,
      },
    });
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content: String.raw`a&=b\\c&=d`,
      delimiter: "align-star",
      sourceStart: source.indexOf(String.raw`\begin{align*}`),
      sourceEnd: source.indexOf(String.raw`\end{align*}`) + String.raw`\end{align*}`.length,
      contentStart: source.indexOf("a&=b"),
      contentEnd: source.indexOf(String.raw`\end{align*}`),
      targetWidth: 120,
    });
    expect(directAlignment?.rows[0]?.svgBody).toContain('data-tex-math-hlist="true"');
    expect(directAlignment?.rows[0]?.svgBody).toContain(`data-source-start="${source.indexOf("a&=b")}"`);
    expect(directAlignment?.rows[1]?.svgBody).toContain(`data-source-start="${source.indexOf("c&=d")}"`);
    expect(result.vlistLayout?.paragraphPlacements.map((placement) =>
      source.slice(placement.sourceSpan.start, placement.sourceSpan.end)
    )).toEqual(["Alpha", "Beta"]);
  });
});
