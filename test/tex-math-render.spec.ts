import { describe, expect, it } from "vitest";
import type { ParagraphLayoutReport } from "../packages/core/src/text/knuth-plass/paragraph/report.js";
import {
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph,
  layoutTexMathList,
  parseTexMath,
  renderTexMathHListSvgBody,
  resolveDefaultTexMathFontProfileForList,
  type TexMathHListItem,
} from "../packages/core/src/text/tex/index.js";

function firstGlyphX(items: readonly TexMathHListItem[], baseX = 0): number | null {
  for (const item of items) {
    if (item.kind === "glyph") {
      return baseX + item.x;
    }
    if (item.kind === "hlist") {
      const nested = firstGlyphX(item.items, baseX + item.x);
      if (nested !== null) {
        return nested;
      }
    }
  }
  return null;
}

function mathItemsRightEdge(items: readonly TexMathHListItem[], baseX = 0): number {
  let right = 0;
  for (const item of items) {
    const itemRight = baseX + item.x + item.width;
    right = Math.max(right, itemRight);
    if (item.kind === "hlist") {
      right = Math.max(right, mathItemsRightEdge(item.items, baseX + item.x));
    }
  }
  return right;
}

function findChildHList(
  items: readonly TexMathHListItem[],
  role: Extract<TexMathHListItem, { readonly kind: "hlist" }>["role"]
): Extract<TexMathHListItem, { readonly kind: "hlist" }> | null {
  for (const item of items) {
    if (item.kind !== "hlist") {
      continue;
    }
    if (item.role === role) {
      return item;
    }
    const nested = findChildHList(item.items, role);
    if (nested) {
      return nested;
    }
  }
  return null;
}

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

  it("renders ellipsis commands as positioned TeX dot glyphs", () => {
    const parsed = parseTexMath(String.raw`\ldots+\cdots`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body.match(/data-tex-font="cmmi10" data-tex-glyph="58"/g)).toHaveLength(3);
    expect(body.match(/data-tex-font="cmsy10" data-tex-glyph="1"/g)).toHaveLength(3);
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="43"');
    expect(body).toContain('transform="translate(444.4462 0) scale(100)"');
    expect(body).toContain('transform="translate(2388.8982 0) scale(100)"');
    expect(body).toContain('transform="translate(3277.7906 0) scale(100)"');
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

  it("renders binomial commands with TeX delimiters and no fraction rule", () => {
    const parsed = parseTexMath(String.raw`\binom{n}{k}+\dbinom{n}{k}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="0"');
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="1"');
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="18"');
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="19"');
    expect(body).toContain('data-tex-font="cmmi7" data-tex-glyph="110"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="110"');
    expect(body).not.toContain('data-tex-rule="fraction-rule"');
    expect(body).toContain('transform="translate(0 -810.007) scale(100)"');
    expect(body).toContain('transform="translate(2633.2318 -1410.013) scale(100)"');
  });

  it("renders dfrac and tfrac with their forced fraction styles", () => {
    const parsed = parseTexMath(String.raw`\dfrac{1}{2}+\tfrac{1}{2}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-rule="fraction-rule"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="49"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="50"');
    expect(body).toContain('data-tex-font="cmr7" data-tex-glyph="49"');
    expect(body).toContain('data-tex-font="cmr7" data-tex-glyph="50"');
    expect(body).toContain('transform="translate(120 -676.508) scale(100)"');
    expect(body).toContain('transform="translate(2082.2288 -393.732) scale(70)"');
  });

  it("renders amsmath cfrac through display-style TeX fraction layout", () => {
    const parsed = parseTexMath(String.raw`\cfrac[l]{a}{bbb}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-rule="fraction-rule"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="97"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="98"');
  });

  it("renders AMS stacking commands through positioned TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`\overset{a}{b}+\underset{c}{d}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmmi7" data-tex-glyph="97"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="98"');
    expect(body).toContain('data-tex-font="cmmi7" data-tex-glyph="99"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="100"');
    expect(body).toContain('transform="translate(0 -894.445) scale(70)"');
  });

  it("renders TeX buildrel through positioned operator-limit glyph paths", () => {
    const parsed = parseTexMath(String.raw`\buildrel{a}\over =`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-math-role="limit-superscript"');
    expect(body).toContain('data-tex-font="cmmi7" data-tex-glyph="97"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="61"');
  });

  it("renders amsmath genfrac through TeX delimiter and fraction glyph paths", () => {
    const parsed = parseTexMath(String.raw`\genfrac{[}{]}{0pt}{3}{a}{b}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).not.toContain('data-tex-rule="fraction-rule"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="91"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="93"');
    expect(body).toContain('data-tex-font="cmmi5" data-tex-glyph="97"');
    expect(body).toContain('data-tex-font="cmmi5" data-tex-glyph="98"');
  });

  it("renders math accents through TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`\vec{x}+\hat{\frac{1}{2}}+\mathring A`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="126"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="94"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="23"');
    expect(body).toContain('transform="translate(-13.3675 0) scale(100)"');
    expect(body).toContain('transform="translate(1863.0603 -414.2878) scale(100)"');
    expect(body).toContain('transform="translate(3793.4875 -252.777) scale(100)"');
  });

  it("renders overline and underline rules with TeX coordinates", () => {
    const parsed = parseTexMath(String.raw`\overline{x}+a^{\underline{x}}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-rule="overline-rule"');
    expect(body).toContain('data-tex-rule="underline-rule"');
    expect(body).toContain('y="-590.551"');
    expect(body).toContain('width="571.528"');
    expect(body).toContain('width="503.474"');
  });

  it("renders amsmath boxed frame rules through SVG rects", () => {
    const parsed = parseTexMath(String.raw`\boxed{x+y}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body.match(/data-tex-rule="boxed-rule"/gu)).toHaveLength(4);
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="120"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="43"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="121"');
    expect(body).toContain('x="0" y="-923.334" width="2999.9158" height="40"');
    expect(body).toContain('x="2959.9158" y="-923.334" width="40"');
  });

  it("renders LaTeX rule boxes through SVG rects", () => {
    const parsed = parseTexMath(String.raw`\rule[3cm]{2cm}{1cm}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-rule="literal-rule"');
    expect(body).toContain('x="0" y="-11381.1024" width="5690.5512" height="2845.2756"');
  });

  it("renders smash box contents through the child hlist", () => {
    const parsed = parseTexMath(String.raw`\smash{\frac{1}{2}}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(result.hlist.height).toBe(0);
    expect(result.hlist.depth).toBe(0);
    expect(body).toContain('data-tex-math-role="nucleus"');
    expect(body).toContain('data-tex-rule="fraction-rule"');
    expect(body).toContain('data-tex-font="cmr7" data-tex-glyph="49"');
    expect(body).toContain('data-tex-font="cmr7" data-tex-glyph="50"');
  });

  it("renders TeX shifted hboxes through translated child hlists", () => {
    const parsed = parseTexMath(String.raw`\raise2pt\hbox{$x$}+\lower2pt\hbox{$y$}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body.match(/data-tex-math-role="nucleus"/gu)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="120"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="121"');
    expect(body).toContain('translate(0 -200)');
    expect(body).toContain(' 200)');
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

  it("renders old-style math font declarations through vendored CM font paths", () => {
    const parsed = parseTexMath(String.raw`\rm a+\it b+\bf c+\sf d+\tt e+\cal A`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="97"');
    expect(body).toContain('data-tex-font="cmti10" data-tex-glyph="98"');
    expect(body).toContain('data-tex-font="cmbx10" data-tex-glyph="99"');
    expect(body).toContain('data-tex-font="cmss10" data-tex-glyph="100"');
    expect(body).toContain('data-tex-font="cmtt10" data-tex-glyph="101"');
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

  it("renders AMS extensible arrows with TeX arrow and script-label glyph paths", () => {
    const parsed = parseTexMath(String.raw`\xleftarrow[xy]{abcd}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="32"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="0"');
    expect(body).toContain('data-tex-font="cmmi7" data-tex-glyph="97"');
    expect(body).toContain('data-tex-font="cmmi7" data-tex-glyph="120"');
    expect(body).toContain('data-tex-math-role="limit-superscript"');
    expect(body).toContain('data-tex-math-role="limit-subscript"');
  });

  it("renders additional plain-TeX symbols and named operators through TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`\partial f+\nabla g+\sin x+\bullet+\lvert x\rvert+\lfloor y\rfloor+\colon+x:y+\Longrightarrow+\implies+\impliedby+\iff+\smile+\frown`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="64"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="114"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="115"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="105"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="110"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="15"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="106"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="98"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="99"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="58"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="61"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="40"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="41"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="94"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="95"');
  });

  it("renders Mathtools centered-colon relation macros through TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`\coloneq+\Coloneq+\eqqcolon+\Eqqcolon+\colonapprox+\simcolon`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="58"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="61"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="25"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="24"');
  });

  it("keeps automatic atom spacing around explicit math glue", () => {
    const parsed = parseTexMath(String.raw`= \: x`);
    const result = layoutTexMathList(parsed.list, { style: "display" });
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    expect(result.hlist.width).toBeCloseTo(18.493105, 5);
    const glues = result.hlist.items.filter((item) => item.kind === "glue");
    expect(glues.map((item) => item.mu)).toEqual([4, 5]);
  });

  it("renders AMS font symbols through their TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`\digamma+\dotplus+\ulcorner x\urcorner+\lesssim+\gtrsim+\thicksim`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(resolveDefaultTexMathFontProfileForList(parsed.list).id).toBe("lualatex-ams-math");
    expect(body).toContain('data-tex-font="msbm10" data-tex-glyph="122"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="117"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="112"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="113"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="46"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="38"');
    expect(body).toContain('data-tex-font="msbm10" data-tex-glyph="115"');
  });

  it("renders shared AMS symbol declarations through TeX glyph paths", () => {
    const parsed = parseTexMath(
      String.raw`\lozenge+\leftrightharpoons+\varkappa+\nleq+\beth+\blacktriangle+\rightsquigarrow+\Box+\nexists+\varGamma`,
    );
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(resolveDefaultTexMathFontProfileForList(parsed.list).id).toBe("lualatex-ams-math");
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="6"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="11"');
    expect(body).toContain('data-tex-font="msbm10" data-tex-glyph="123"');
    expect(body).toContain('data-tex-font="msbm10" data-tex-glyph="2"');
    expect(body).toContain('data-tex-font="msbm10" data-tex-glyph="105"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="78"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="32"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="3"');
    expect(body).toContain('data-tex-font="msbm10" data-tex-glyph="64"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="0"');
  });

  it("renders additional AMS relation symbols and composites through TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`\lnapprox+\ncong+\Join+\dashrightarrow+\dashleftarrow+\dasharrow`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(resolveDefaultTexMathFontProfileForList(parsed.list).id).toBe("lualatex-ams-math");
    expect(body).toContain('data-tex-font="msbm10" data-tex-glyph="26"');
    expect(body).toContain('data-tex-font="msbm10" data-tex-glyph="29"');
    expect(body).toContain('data-tex-font="msbm10" data-tex-glyph="111"');
    expect(body).toContain('data-tex-font="msbm10" data-tex-glyph="110"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="57"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="75"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="76"');
  });

  it("uses AMS script-size fonts for AMS glyphs in scripts", () => {
    const parsed = parseTexMath(String.raw`x_{\dotplus}^{\digamma}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="msam7" data-tex-glyph="117"');
    expect(body).toContain('data-tex-font="msbm7" data-tex-glyph="122"');
  });

  it("renders negated relation composites through positioned TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`x\notin A+x\not\leq y+x\not\rightarrow y+x\not\longrightarrow y`);
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
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="0"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="33"');
  });

  it("renders TeX operators through the selected math fonts", () => {
    const parsed = parseTexMath(String.raw`\sum_i^n+\int_0^1+\lim_{x}+\iiiint_0^1`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="80"');
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="82"');
    expect(body.match(/data-tex-font="cmex10" data-tex-glyph="82"/g)).toHaveLength(5);
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="108"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="105"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="109"');
    expect(body).toContain('transform="translate(0 -750.0065) scale(100)"');
    expect(body).toContain('transform="translate(1055.559 -502.7868) scale(70)"');
  });

  it("renders AMS multi-integral and multi-dot accent glyphs", () => {
    const parsed = parseTexMath(String.raw`\idotsint\limits_a^b+\ddddot{1}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="82"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="1"');
    expect(body).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="46"');
  });

  it("renders operatorname through roman operator glyphs", () => {
    const parsed = parseTexMath(String.raw`\operatorname*{arg\,max}_{x}`);
    const result = layoutTexMathList(parsed.list, { style: "display" });
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="97"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="103"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="109"');
    expect(body).toContain('data-tex-font="cmmi7" data-tex-glyph="120"');
    expect(body).toContain('transform="translate(1572.2272 0) scale(100)"');
  });

  it("renders amsmath named limit operators through roman operator glyphs", () => {
    const parsed = parseTexMath(String.raw`\injlim+\projlim_{x}`);
    const result = layoutTexMathList(parsed.list, { style: "display" });
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="105"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="106"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="112"');
    expect(body).toContain('data-tex-font="cmmi7" data-tex-glyph="120"');
    expect(body).toContain('data-tex-math-role="limit-subscript"');
  });

  it("renders amsmath varlim operators through TeX glyphs and rules", () => {
    const parsed = parseTexMath(String.raw`\varliminf+\varlimsup+\varinjlim+\varprojlim_i^n`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-rule="var-limit-rule"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="108"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="0"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="33"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="32"');
    expect(body).toContain('data-tex-math-role="var-limit-row"');
    expect(body).toContain('data-tex-math-role="superscript"');
    expect(body).toContain('data-tex-math-role="subscript"');
  });

  it("renders substack limits recursively with scriptstyle CM glyphs", () => {
    const parsed = parseTexMath(String.raw`\sum_{\substack{i=1\\j=2}}^n`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmex10" data-tex-glyph="80"');
    expect(body).toContain('data-tex-font="cmmi7" data-tex-glyph="105"');
    expect(body).toContain('data-tex-font="cmmi7" data-tex-glyph="106"');
    expect(body).toContain('data-tex-font="cmr7" data-tex-glyph="61"');
    expect(body).toContain('transform="translate(1099.7731 120.4034) scale(70)"');
    expect(body).toContain('transform="translate(1055.559 691.1964) scale(70)"');
  });

  it("renders subarray rows recursively with scriptstyle CM glyphs and role metadata", () => {
    const parsed = parseTexMath(String.raw`\begin{subarray}{c}i\\j\end{subarray}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-math-role="subarray-row"');
    expect(body).toContain('data-tex-math-role="subarray-cell"');
    expect(body).toContain('data-tex-font="cmmi7" data-tex-glyph="105"');
    expect(body).toContain('data-tex-font="cmmi7" data-tex-glyph="106"');
  });

  it("renders AMS sideset child boxes with source role metadata", () => {
    const parsed = parseTexMath(String.raw`\sideset{a}{b}X`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-math-role="sideset-pre"');
    expect(body).toContain('data-tex-math-role="sideset-base"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="97"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="88"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="98"');
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

  it("renders indexed radicals with TeX scriptscript degree placement", () => {
    const parsed = parseTexMath(String.raw`\sqrt[4]{x}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const degree = findChildHList(result.hlist.items, "radical-degree");
    const radicalGlyph = result.hlist.items.find((item) =>
      item.kind === "glyph" && item.fontId === "cmsy10" && item.code === 112
    );
    const rule = result.hlist.items.find((item) =>
      item.kind === "rule" && item.role === "radical-rule"
    );

    expect(result.hlist.width).toBeCloseTo(14.673689, 6);
    expect(degree?.x).toBeCloseTo(2.777786, 6);
    expect(degree?.y).toBeCloseTo(-3.363311, 6);
    expect(degree?.width).toBeCloseTo(3.402835, 6);
    expect(radicalGlyph?.x).toBeCloseTo(0.625049, 6);
    expect(radicalGlyph?.y).toBeCloseTo(-7.202774, 6);
    expect(rule?.x).toBeCloseTo(8.958409, 6);
    expect(rule?.width).toBeCloseTo(5.71528, 6);

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-math-role="radical-degree"');
    expect(body).toContain('data-tex-font="cmr5" data-tex-glyph="52"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="112"');
    expect(body).toContain('data-tex-font="cmmi10" data-tex-glyph="120"');
    expect(body).toContain('data-tex-rule="radical-rule"');
  });

  it("renders plain TeX roots with the same metrics as bracketed root degrees", () => {
    const parsed = parseTexMath(String.raw`\root {n+1} \of {x+y}`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const degree = findChildHList(result.hlist.items, "radical-degree");
    const radicalGlyph = result.hlist.items.find((item) =>
      item.kind === "glyph" && item.fontId === "cmsy10" && item.code === 112
    );
    const rule = result.hlist.items.find((item) =>
      item.kind === "rule" && item.role === "radical-rule"
    );

    expect(result.hlist.width).toBeCloseTo(41.700552, 6);
    expect(degree?.x).toBeCloseTo(2.777786, 6);
    expect(degree?.y).toBeCloseTo(-3.113315, 6);
    expect(radicalGlyph?.x).toBeCloseTo(10.168034, 6);
    expect(radicalGlyph?.y).toBeCloseTo(-6.994444, 6);
    expect(rule?.x).toBeCloseTo(18.501394, 6);
    expect(rule?.width).toBeCloseTo(23.199158, 6);
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

  it("renders middle delimiters as TeX delimiter glyph paths", () => {
    const parsed = parseTexMath(String.raw`\left(a\middle|b\right)`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="40"');
    expect(body).toContain('data-tex-font="cmsy10" data-tex-glyph="106"');
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="41"');
    expect(body).not.toContain("middle-delimiter");
  });

  it("renders AMS left-right corner delimiters through fixed AMS glyphs", () => {
    const parsed = parseTexMath(String.raw`\left\ulcorner A\right\urcorner+\left\llcorner B\right\lrcorner`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(resolveDefaultTexMathFontProfileForList(parsed.list).id).toBe("lualatex-ams-math");
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="112"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="113"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="120"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="121"');
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

  it("reports TeX inline math breakpoints after normalized binary and relation atoms", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const source = "$a+b=c$";
    const box = provider.getInlineMathBox({
      source,
      content: "a+b=c",
      delimiter: "dollar",
      sourceStart: 10,
      sourceEnd: 17,
      contentStart: 11,
      contentEnd: 16,
    });

    expect(box?.breakpoints).toHaveLength(2);
    expect(box?.breakpoints).toMatchObject([
      {
        kind: "binary",
        sourceOffset: 13,
        x: expect.any(Number),
        penalty: 700,
        stretchBefore: expect.any(Number),
        shrinkBefore: expect.any(Number),
      },
      {
        kind: "relation",
        sourceOffset: 15,
        x: expect.any(Number),
        penalty: 500,
        stretchBefore: expect.any(Number),
        shrinkBefore: expect.any(Number),
      },
    ]);
    expect(box?.breakpoints?.[0]?.x).toBeGreaterThan(0);
    expect(box?.breakpoints?.[1]?.x).toBeGreaterThan(box?.breakpoints?.[0]?.x ?? 0);
  });

  it("does not report invalid leading or trailing binary operator breakpoints", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const box = provider.getInlineMathBox({
      source: "$+a+b+$",
      content: "+a+b+",
      delimiter: "dollar",
      sourceStart: 20,
      sourceEnd: 27,
      contentStart: 21,
      contentEnd: 26,
    });

    expect(box?.breakpoints).toMatchObject([
      {
        kind: "binary",
        sourceOffset: 24,
        x: expect.any(Number),
        penalty: 700,
        stretchBefore: expect.any(Number),
        shrinkBefore: expect.any(Number),
      },
    ]);
  });

  it("reports explicit TeX math penalty commands as inline math breakpoints", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const source = String.raw`$a\allowbreak b\break c\nobreak d\penalty -250 e$`;
    const content = source.slice(1, -1);
    const box = provider.getInlineMathBox({
      source,
      content,
      delimiter: "dollar",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: 1,
      contentEnd: source.length - 1,
    });

    expect(box).not.toBeNull();
    expect(box?.breakpoints?.filter((breakpoint) => breakpoint.kind === "penalty")).toMatchObject([
      {
        kind: "penalty",
        sourceOffset: 13,
        x: expect.closeTo(5.2859, 5),
        penalty: 0,
      },
      {
        kind: "penalty",
        sourceOffset: 21,
        x: expect.closeTo(9.57757, 5),
        penalty: -10_000,
      },
      {
        kind: "penalty",
        sourceOffset: 31,
        x: expect.closeTo(13.90513, 5),
        penalty: 10_000,
      },
      {
        kind: "penalty",
        sourceOffset: 46,
        x: expect.closeTo(19.11001, 5),
        penalty: -250,
      },
    ]);
  });

  it("exposes TeX inline math glue shrink to paragraph breaking", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const box = provider.getInlineMathBox({
      source: "$x+y=m+n$",
      content: "x+y=m+n",
      delimiter: "dollar",
      sourceStart: 4,
      sourceEnd: 13,
      contentStart: 5,
      contentEnd: 12,
    });

    expect(box?.shrink).toBeGreaterThan(0);

    const source = String.raw`One $x+y=m+n$ two three.`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:math-shrink-break",
      width: 80,
      alignment: "ragged-right",
      parindent: 0,
      rightskipStretch: 80,
      spaceGlueProfile: "font",
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: provider,
    });

    expect(result.supported).toBe(true);
    expect(result.report?.lines.map((line) =>
      line.segments.map((segment) => segment.text ?? "").join("")
    )).toEqual([
      "One x+y=m+n",
      "two three.",
    ]);
    const mathAdvance = result.report?.lines
      .flatMap((line) => line.segments)
      .filter((segment) => segment.sourceKind === "math")
      .reduce((sum, segment) => sum + segment.width, 0) ?? 0;
    expect(mathAdvance).toBeLessThan(box?.width ?? 0);
  });

  it("creates math boxes for operatorname without MathJax", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const inlineContent = String.raw`\operatorname{rank}`;
    const inlineSource = `$${inlineContent}$`;
    const inlineBox = provider.getInlineMathBox({
      source: inlineSource,
      content: inlineContent,
      delimiter: "dollar",
      sourceStart: 0,
      sourceEnd: inlineSource.length,
      contentStart: 1,
      contentEnd: inlineSource.length - 1,
    });

    expect(inlineBox).toMatchObject({
      source: inlineSource,
      content: inlineContent,
      width: expect.closeTo(19.75008, 5),
      height: expect.closeTo(6.94445, 5),
      depth: 0,
    });
    expect(inlineBox?.svgBody).toContain('data-tex-font="cmr10" data-tex-glyph="114"');
    expect(inlineBox?.svgBody).toContain('data-tex-font="cmr10" data-tex-glyph="107"');

    const displayContent = String.raw`\operatorname*{arg\,max}_{x}`;
    const displaySource = String.raw`\[` + displayContent + String.raw`\]`;
    const displayBox = provider.getDisplayMathBox?.({
      source: displaySource,
      content: displayContent,
      delimiter: "bracket",
      sourceStart: 0,
      sourceEnd: displaySource.length,
      contentStart: 2,
      contentEnd: displaySource.length - 2,
    });
    expect(displayBox).toMatchObject({
      source: displaySource,
      content: displayContent,
      width: expect.closeTo(34.333462, 5),
      depth: expect.closeTo(8.94445, 5),
    });
    expect(displayBox?.svgBody).toContain('data-tex-font="cmmi7" data-tex-glyph="120"');
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

  it("creates display-style math boxes for raw equation-star environments", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const source = String.raw`\begin{equation*}a=b\end{equation*}`;
    const box = provider.getDisplayMathBox?.({
      source,
      content: source,
      delimiter: "bracket",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: 0,
      contentEnd: source.length,
    });

    expect(box).toMatchObject({
      source,
      content: source,
      sourceStart: 0,
      sourceEnd: source.length,
    });
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.caretStops).toHaveLength(source.length + 1);
    expect(box?.svgBody).toContain('data-tex-math-style="display"');
    expect(box?.svgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="97"');
    expect(box?.svgBody).toContain('data-tex-font="cmr10" data-tex-glyph="61"');
    expect(box?.svgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="98"');
  });

  it("places explicit equation-star tags at the display edge", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const source = String.raw`\begin{equation*}a=b\tag{A}\end{equation*}`;
    const box = provider.getDisplayMathBox?.({
      source,
      content: source,
      delimiter: "bracket",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: 0,
      contentEnd: source.length,
      targetWidth: 120,
    });

    expect(box?.width).toBeCloseTo(120, 6);
    expect(box?.caretStops).toHaveLength(source.length + 1);
    expect(box?.svgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="97"');
    expect(box?.svgBody).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="40"');
    expect(box?.svgBody).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="65"');
    expect(box?.svgBody).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="41"');
    expect(box?.hlist?.items.some((item) =>
      item.kind === "glyph" &&
      item.sourceSpan.start >= source.indexOf(String.raw`\tag`) &&
      item.x > 100
    )).toBe(true);
  });

  it("lets display-body metadata override automatic equation labels", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const explicitTagSource = String.raw`a=b\tag{A}`;
    const explicitTagBox = provider.getDisplayMathBox?.({
      source: explicitTagSource,
      content: explicitTagSource,
      delimiter: "equation",
      sourceStart: 0,
      sourceEnd: explicitTagSource.length,
      contentStart: 0,
      contentEnd: explicitTagSource.length,
      targetWidth: 120,
      displayLabel: {
        text: "1",
        sourceSpan: { start: explicitTagSource.length, end: explicitTagSource.length },
        textSourceSpan: { start: explicitTagSource.length, end: explicitTagSource.length },
      },
    });

    expect(explicitTagBox?.svgBody).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="65"');
    expect(explicitTagBox?.svgBody).not.toContain('data-tex-font="lmroman10-regular" data-tex-glyph="49"');

    const suppressedSource = String.raw`a=b\notag`;
    const suppressedBox = provider.getDisplayMathBox?.({
      source: suppressedSource,
      content: suppressedSource,
      delimiter: "equation",
      sourceStart: 0,
      sourceEnd: suppressedSource.length,
      contentStart: 0,
      contentEnd: suppressedSource.length,
      targetWidth: 120,
      displayLabel: {
        text: "1",
        sourceSpan: { start: suppressedSource.length, end: suppressedSource.length },
        textSourceSpan: { start: suppressedSource.length, end: suppressedSource.length },
      },
    });

    expect(suppressedBox?.svgBody).not.toContain('data-tex-font="lmroman10-regular" data-tex-glyph="49"');
  });

  it("uses display-style AMS terminal ellipsis spacing for display math boxes", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const inlineSource = String.raw`$\dots$`;
    const inlineBox = provider.getInlineMathBox({
      source: inlineSource,
      content: String.raw`\dots`,
      delimiter: "dollar",
      sourceStart: 0,
      sourceEnd: inlineSource.length,
      contentStart: 1,
      contentEnd: inlineSource.length - 1,
    });
    const displaySource = String.raw`\[\dots\]`;
    const displayBox = provider.getDisplayMathBox?.({
      source: displaySource,
      content: String.raw`\dots`,
      delimiter: "bracket",
      sourceStart: 0,
      sourceEnd: displaySource.length,
      contentStart: 2,
      contentEnd: displaySource.length - 2,
    });

    expect(inlineBox?.width).toBeCloseTo(13.333386, 5);
    expect(displayBox?.width).toBeCloseTo(11.666714, 5);
  });

  it("packs target-width display math boxes with TeX math glue shrink", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const content = String.raw`\begin{array}{l}x\end{array}+\begin{array}{l}y\end{array}`;
    const source = String.raw`\[` + content + String.raw`\]`;
    const natural = provider.getDisplayMathBox?.({
      source,
      content,
      delimiter: "bracket",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: 2,
      contentEnd: source.length - 2,
    });
    const fixed = provider.getDisplayMathBox?.({
      source,
      content,
      delimiter: "bracket",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: 2,
      contentEnd: source.length - 2,
      targetWidth: 30,
    });

    expect(natural?.width).toBeGreaterThan(30);
    expect(fixed).toMatchObject({
      width: 30,
      height: natural?.height,
      depth: natural?.depth,
    });
    expect(fixed?.svgBody).toContain('data-tex-font="cmr10" data-tex-glyph="43"');
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

  it("creates inline math boxes for pmatrix without MathJax", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const content = String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`;
    const source = `$${content}$`;
    const box = provider.getInlineMathBox({
      source,
      content,
      delimiter: "dollar",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: 1,
      contentEnd: source.length - 1,
    });

    expect(box).toMatchObject({
      source,
      content,
      width: expect.closeTo(35.21308, 5),
      height: expect.closeTo(14.50012, 5),
      depth: expect.closeTo(9.50012, 5),
    });
    expect(box?.svgBody).toContain('data-tex-font="cmex10" data-tex-glyph="18"');
    expect(box?.svgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="97"');
    expect(box?.svgBody).toContain('data-tex-font="cmex10" data-tex-glyph="19"');
  });

  it("creates inline math boxes for array environments without MathJax", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const content = String.raw`\begin{array}{lc}a&b\\x&y\end{array}`;
    const source = `$${content}$`;
    const box = provider.getInlineMathBox({
      source,
      content,
      delimiter: "dollar",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: 1,
      contentEnd: source.length - 1,
    });

    expect(box).toMatchObject({
      source,
      content,
      width: expect.closeTo(30.97689, 5),
      height: expect.closeTo(14.5, 5),
      depth: expect.closeTo(9.5, 5),
    });
    expect(box?.svgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="97"');
    expect(box?.svgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="121"');
    expect(box?.svgBody).toContain('transform="translate(500 -610.0037) scale(100)"');
    expect(box?.svgBody).toContain('transform="translate(2071.528 589.9963) scale(100)"');
  });

  it("creates inline math boxes for cases environments without MathJax", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const content = String.raw`\begin{cases}a&b\\x&y\end{cases}`;
    const source = `$${content}$`;
    const box = provider.getInlineMathBox({
      source,
      content,
      delimiter: "dollar",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: 1,
      contentEnd: source.length - 1,
    });

    expect(box).toMatchObject({
      source,
      content,
      width: expect.closeTo(30.23249, 5),
      height: expect.closeTo(17.50015, 5),
      depth: expect.closeTo(12.50015, 5),
    });
    expect(box?.svgBody).toContain('data-tex-font="cmex10" data-tex-glyph="40"');
    expect(box?.svgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="97"');
    expect(box?.svgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="121"');
    expect(box?.svgBody).toContain('transform="translate(805.56 -682.0044) scale(100)"');
  });

  it("creates inline math boxes for smallmatrix environments without MathJax", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const content = String.raw`\begin{smallmatrix}a&b\\x&y\end{smallmatrix}`;
    const source = `$${content}$`;
    const box = provider.getInlineMathBox({
      source,
      content,
      delimiter: "dollar",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: 1,
      contentEnd: source.length - 1,
    });

    expect(box).toMatchObject({
      source,
      content,
      width: expect.closeTo(14.952627, 6),
      height: expect.closeTo(8.611115, 6),
      depth: expect.closeTo(3.611115, 6),
    });
    expect(box?.svgBody).toContain('data-tex-font="cmmi7" data-tex-glyph="97"');
    expect(box?.svgBody).toContain('data-tex-font="cmmi7" data-tex-glyph="121"');
    expect(box?.svgBody).toContain('transform="translate(176.5218 -375) scale(70)"');
    expect(box?.svgBody).toContain('transform="translate(897.9198 225) scale(70)"');
  });

  it("creates inline math boxes for AMS matrix delimiter variants", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const cases = [
      { environment: "bmatrix", left: 20, right: 21 },
      { environment: "Bmatrix", left: 26, right: 27 },
      { environment: "vmatrix", left: 12, right: 12 },
      { environment: "Vmatrix", left: 13, right: 13 },
    ];

    for (const testCase of cases) {
      const content = String.raw`\begin{` + testCase.environment + String.raw`}a&b\\c&d\end{` + testCase.environment + "}";
      const source = `$${content}$`;
      const box = provider.getInlineMathBox({
        source,
        content,
        delimiter: "dollar",
        sourceStart: 0,
        sourceEnd: source.length,
        contentStart: 1,
        contentEnd: source.length - 1,
      });

      expect(box).not.toBeNull();
      expect(box?.svgBody).toContain(`data-tex-font="cmex10" data-tex-glyph="${testCase.left}"`);
      expect(box?.svgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="97"');
      expect(box?.svgBody).toContain(`data-tex-font="cmex10" data-tex-glyph="${testCase.right}"`);
    }
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
    const mathSegments = result.report?.lines
      .flatMap((line) => line.segments)
      .filter((segment) => segment.kind === "math") ?? [];
    const mathAdvanceSegments = result.report?.lines
      .flatMap((line) => line.segments)
      .filter((segment) => segment.sourceKind === "math") ?? [];
    expect(mathSegments).toHaveLength(2);
    expect(mathAdvanceSegments).toHaveLength(3);
    expect(mathSegments.map((segment) => source.slice(
      segment.sourceStartRaw ?? 0,
      segment.sourceEndRaw ?? 0
    )).join("")).toBe("x-y");
    expect(mathAdvanceSegments[1]).toMatchObject({
      kind: "space",
      text: "",
      sourceStartRaw: source.indexOf("-") + 1,
      sourceEndRaw: source.indexOf("-") + 1,
      sourceKind: "math",
      width: 2.222229,
    });
    expect(mathSegments[0]).toMatchObject({
      sourceStartRaw: source.indexOf("x-y"),
      sourceEndRaw: source.indexOf("-") + 1,
      sourceKind: "math",
    });
    expect(mathSegments[1]).toMatchObject({
      sourceStartRaw: source.indexOf("-") + 1,
      sourceEndRaw: source.indexOf("x-y") + "x-y".length,
      sourceKind: "math",
    });
    expect(mathAdvanceSegments.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(23.199158, 6);
    expect(mathSegments[0]?.caretStops?.[0]).toBeCloseTo(mathSegments[0]?.x ?? 0, 6);
    expect(mathSegments[1]?.caretStops?.at(-1)).toBeCloseTo(
      (mathSegments[1]?.x ?? 0) + (mathSegments[1]?.width ?? 0),
      6
    );
    expect(mathSegments[0]?.mathSvgBody).not.toContain('data-tex-math-fragment="true"');
    expect(mathSegments[1]?.mathSvgBody).not.toContain('data-tex-math-fragment="true"');
    expect(mathSegments[0]?.mathSvgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="120"');
    expect(mathSegments[1]?.mathSvgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="121"');
  });

  it("renders split inline math fragments without repainting earlier formula glyphs", () => {
    const source = String.raw`Where \(p_i=\{x,y\}\) is the unordered pair of alternatives swapped when going
from \(R_{i-1}\) to \(R_i\).  We usually write \(p_i=(x,y)\), but the pair is
unordered.`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:math-fragment-no-overpaint",
      width: 150,
      alignment: "ragged-right",
      parindent: 0,
      rightskipStretch: 150,
      spaceGlueProfile: "font",
      tikzTextWidthNode: true,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const mathSegments = result.report?.lines
      .flatMap((line) => line.segments)
      .filter((segment) => segment.kind === "math") ?? [];
    const pairTail = mathSegments.find((segment) => segment.text === "(x,y)");
    const braceTail = mathSegments.find((segment) => segment.text === String.raw`\{x,y\}`);
    const relationFragments = mathSegments.filter((segment) => segment.text === "p_i=");
    expect(relationFragments).toHaveLength(2);
    expect(relationFragments[0]?.width).toBeCloseTo(19.671275, 6);
    expect(relationFragments[0]?.mathSvgBody).toContain('transform="translate(1189.3465 0) scale(100)"');
    expect(relationFragments[1]?.width).toBeCloseTo(19.036204, 6);
    expect(relationFragments[1]?.mathSvgBody).toContain('transform="translate(1125.8394 0) scale(100)"');
    expect(pairTail?.mathSvgBody).toContain('data-tex-font="cmr10" data-tex-glyph="40"');
    expect(pairTail?.mathSvgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="120"');
    expect(pairTail?.mathSvgBody).not.toContain('data-tex-font="cmmi10" data-tex-glyph="112"');
    expect(pairTail?.mathSvgBody).not.toContain('data-tex-font="cmr10" data-tex-glyph="61"');
    expect(braceTail?.mathSvgBody).toContain('data-tex-font="cmsy10" data-tex-glyph="102"');
    expect(braceTail?.mathSvgBody).not.toContain('data-tex-font="cmmi10" data-tex-glyph="112"');
    expect(braceTail?.mathSvgBody).not.toContain('data-tex-font="cmr10" data-tex-glyph="61"');
  });

  it("keeps relation breakpoints before following ellipsis glyphs", () => {
    const source = String.raw`Alpha $\sqrt{\cdots}=\ldots$ beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:math-relation-before-ellipsis",
      width: 62,
      alignment: "ragged-right",
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const mathSegments = result.report?.lines
      .flatMap((line) => line.segments)
      .filter((segment) => segment.kind === "math") ?? [];
    const beforeBreak = mathSegments.find((segment) => segment.text === String.raw`\sqrt{\cdots}=`);
    const afterBreak = mathSegments.find((segment) => segment.text === String.raw`\ldots`);
    expect(beforeBreak?.mathSvgBody).toContain('data-tex-font="cmr10" data-tex-glyph="61"');
    expect(beforeBreak?.mathSvgBody).not.toContain('data-tex-font="cmmi10" data-tex-glyph="58"');
    expect(afterBreak?.mathSvgBody?.match(/data-tex-font="cmmi10" data-tex-glyph="58"/g)).toHaveLength(3);
  });

  it("carries TeX inline math breakpoint metadata into paragraph reports", () => {
    const source = String.raw`Alpha $a+b=c$ beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:math-breakpoint-report",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const mathBreakpoints = result.report?.lines
      .flatMap((line) => line.segments)
      .filter((segment) => segment.kind === "math")
      .flatMap((segment) => segment.mathBreakpoints ?? []) ?? [];
    expect(mathBreakpoints).toEqual([
      {
        kind: "binary",
        sourceOffsetRaw: source.indexOf("+") + 1,
        x: expect.any(Number),
        penalty: 700,
      },
      {
        kind: "relation",
        sourceOffsetRaw: source.indexOf("=") + 1,
        x: expect.any(Number),
        penalty: 500,
      },
    ]);
    expect(mathBreakpoints[0]?.x).toBeGreaterThan(0);
    expect(mathBreakpoints[1]?.x).toBeGreaterThan(mathBreakpoints[0]?.x ?? 0);
  });

  it("uses TeX inline math breakpoints as paragraph break candidates", () => {
    const source = String.raw`Alpha $a+b=c+d$ omega`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:math-break-candidate",
      width: 65,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    expect(result.report?.lines).toHaveLength(2);
    expect(result.report?.lines[0]?.break).toMatchObject({
      kind: "space",
      sourceOffset: source.indexOf("=") + 1,
      visibleHyphen: false,
    });
    expect(result.report?.lines.map((line) =>
      line.segments.map((segment) =>
        source.slice(segment.sourceStartRaw ?? 0, segment.sourceEndRaw ?? 0)
      ).join("")
    )).toEqual([
      "Alpha a+b=",
      "c+d omega",
    ]);
    const mathSegmentsByLine = result.report?.lines.map((line) =>
      line.segments.filter((segment) => segment.kind === "math")
    );
    expect(mathSegmentsByLine?.map((segments) =>
      segments.map((segment) =>
        source.slice(segment.sourceStartRaw ?? 0, segment.sourceEndRaw ?? 0)
      ).join("")
    )).toEqual([
      "a+b=",
      "c+d",
    ]);
    expect(mathSegmentsByLine?.flat().every((segment) =>
      segment.mathSvgBody?.includes("data-tex-math-hlist")
    )).toBe(true);
  });

  it("reports whole-construct ranges for non-linear inline math boxes", () => {
    const source = String.raw`$\frac{1}{2}$ and $\sqrt{x}$`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:math-construct-ranges",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const mathSegments = result.report?.lines
      .flatMap((line) => line.segments)
      .filter((segment) => segment.kind === "math") ?? [];
    expect(mathSegments).toHaveLength(2);
    expect(mathSegments[0]?.mathConstructRanges?.[0]).toMatchObject({
      sourceStartRaw: source.indexOf(String.raw`\frac`),
      sourceEndRaw: source.indexOf("$ and"),
      xStart: expect.any(Number),
      xEnd: expect.any(Number),
    });
    expect(mathSegments[1]?.mathConstructRanges?.[0]).toMatchObject({
      sourceStartRaw: source.indexOf(String.raw`\sqrt`),
      sourceEndRaw: source.lastIndexOf("}") + 1,
      xStart: expect.any(Number),
      xEnd: expect.any(Number),
    });
    const radicalSegment = mathSegments[1];
    const radicalStart = radicalSegment?.sourceStartRaw ?? 0;
    const commandEnd = source.indexOf(String.raw`\sqrt`) + String.raw`\sqrt`.length;
    const radicandStart = source.indexOf("x", source.indexOf(String.raw`\sqrt`));
    expect(radicalSegment?.caretStops?.[commandEnd - radicalStart]).toBeLessThan(
      radicalSegment?.caretStops?.[radicandStart - radicalStart] ?? 0
    );
  });

  it("lets the paragraph math provider use AMS font profile selection", () => {
    const source = String.raw`Alpha $\dots^{\sum}$ beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:math-provider-ams-profile",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const mathSegment = result.report?.lines
      .flatMap((line) => line.segments)
      .find((segment) => segment.kind === "math");
    expect(mathSegment?.mathSvgBody).toContain('data-tex-font="cmex7" data-tex-glyph="80"');
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

  it("centers display math inside quote-local line width", () => {
    const source = String.raw`Alpha \begin{quote}Quoted \[x^2+1\] done.\end{quote} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:quote-display-math-provider",
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
      x: expect.closeTo(66.288151, 5),
      y: expect.closeTo(40.519972, 5),
      width: expect.closeTo(27.423697, 5),
      displayMath: {
        delimiter: "bracket",
        contentStart: source.indexOf("x^2+1"),
        contentEnd: source.indexOf(String.raw`\]`),
      },
    });
    expect(result.vlistLayout?.boxReport.items.find((item) =>
      item.glue?.origin?.kind === "paragraph-boundary-interline" &&
        item.glue.origin.boundary === "quote"
    )?.glue?.size).toBeCloseTo(3.01, 5);
  });

  it("uses TeX short display skips after short scoped list lines", () => {
    const source = String.raw`Alpha \begin{itemize}\item Item \[x^2+1\] done.\end{itemize} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:itemize-display-short-skip",
      width: 180,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.boxReport.items.filter((item) =>
      item.glue?.origin?.kind === "display-math-boundary"
    ).map((item) => item.glue)).toEqual([
      expect.objectContaining({
        size: 0,
        origin: expect.objectContaining({
          side: "above",
          variant: "short",
        }),
      }),
      expect.objectContaining({
        size: 6,
        origin: expect.objectContaining({
          side: "below",
          variant: "short",
        }),
      }),
    ]);
    expect(result.vlistLayout?.boxReport.items.find((item) =>
      item.glue?.origin?.kind === "paragraph-boundary-interline" &&
        item.glue.origin.boundary === "list"
    )?.glue?.size).toBeCloseTo(3.23, 5);
    expect(result.vlistLayout?.boxReport.items.find((item) =>
      item.itemKind === "display-math"
    )?.y).toBeCloseTo(30.519972, 5);
  });

  it("lets TeX paragraph layout carry double-dollar display math as a vlist item", () => {
    const source = String.raw`Alpha $$x^2$$ Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:double-dollar-display-math-provider",
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
      displayMath: {
        delimiter: "double-dollar",
        contentStart: source.indexOf("x^2"),
        contentEnd: source.indexOf("$$ Beta"),
      },
    });
  });

  it("renders numbered equation display math with automatic right-side tags", () => {
    const source = String.raw`Alpha \begin{equation}x^2\end{equation} Beta \begin{equation}y^2\end{equation} Gamma`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:numbered-equation-display-math",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const displays = result.vlistLayout?.boxReport.items.filter((item) =>
      item.itemKind === "display-math"
    ) ?? [];
    expect(displays).toHaveLength(2);
    expect(displays.map((item) => item.displayMath?.delimiter)).toEqual(["equation", "equation"]);

    const displayItems = result.vlistLayout?.items.filter((item) =>
      item.item.kind === "display-math"
    ) ?? [];
    const firstBox = displayItems[0]?.item.kind === "display-math" ? displayItems[0].item.box : null;
    const secondBox = displayItems[1]?.item.kind === "display-math" ? displayItems[1].item.box : null;
    expect(firstBox?.width).toBeCloseTo(160, 6);
    expect(secondBox?.width).toBeCloseTo(160, 6);
    expect(firstBox?.svgBody).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="49"');
    expect(secondBox?.svgBody).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="50"');
  });

  it("renders numbered multi-row display math environments", () => {
    const source = String.raw`Alpha \begin{equation}x^2\end{equation} Beta \begin{align}a&=b\end{align} Gamma \begin{gather}c=d\\e=f\end{gather} Delta \begin{multline}x=y\\z=w\end{multline} Epsilon`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:numbered-display-math-placeholder",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const placeholders = result.vlistLayout?.boxReport.items.filter((item) =>
      item.itemKind === "placeholder"
    ) ?? [];
    expect(placeholders).toHaveLength(0);
  });

  it("renders numbered align display math with automatic row labels", () => {
    const source = String.raw`Alpha \begin{align}a&=b\\c&=d\notag\\e&=f\tag{A}\\g&=h\end{align} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:numbered-align-display-math",
      width: 180,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const rows = result.vlistLayout?.boxReport.items.filter((item) =>
      item.hboxRole?.kind === "display-align-row"
    ) ?? [];
    expect(rows).toHaveLength(4);
    expect(rows.map((row) =>
      row.hboxRole?.kind === "display-align-row" ? row.hboxRole.delimiter : null
    )).toEqual(["align", "align", "align", "align"]);

    const positionedRows = result.vlistLayout?.items.filter((item) =>
      item.item.kind === "hbox" && item.item.role?.kind === "display-align-row"
    ) ?? [];
    const rowSvgBodies = positionedRows.map((row) =>
      row.item.kind === "hbox" ? row.item.box.renderItems.map((renderItem) =>
        renderItem.kind === "tex-math-svg" ? renderItem.svgBody : ""
      ).join("") : ""
    );
    expect(rowSvgBodies).toHaveLength(4);
    expect(rowSvgBodies[0]).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="49"');
    expect(rowSvgBodies[1]).not.toContain('data-tex-font="lmroman10-regular" data-tex-glyph="49"');
    expect(rowSvgBodies[1]).not.toContain('data-tex-font="lmroman10-regular" data-tex-glyph="50"');
    expect(rowSvgBodies[2]).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="65"');
    expect(rowSvgBodies[3]).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="50"');
  });

  it("renders numbered gather display math with automatic row labels", () => {
    const source = String.raw`Alpha \begin{gather}a=b\\c=d\notag\\e=f\tag{A}\\g=h\end{gather} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:numbered-gather-display-math",
      width: 180,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const rows = result.vlistLayout?.boxReport.items.filter((item) =>
      item.hboxRole?.kind === "display-align-row"
    ) ?? [];
    expect(rows).toHaveLength(4);
    expect(rows.map((row) =>
      row.hboxRole?.kind === "display-align-row" ? row.hboxRole.delimiter : null
    )).toEqual(["gather", "gather", "gather", "gather"]);

    const positionedRows = result.vlistLayout?.items.filter((item) =>
      item.item.kind === "hbox" && item.item.role?.kind === "display-align-row"
    ) ?? [];
    const rowSvgBodies = positionedRows.map((row) =>
      row.item.kind === "hbox" ? row.item.box.renderItems.map((renderItem) =>
        renderItem.kind === "tex-math-svg" ? renderItem.svgBody : ""
      ).join("") : ""
    );
    expect(rowSvgBodies).toHaveLength(4);
    expect(rowSvgBodies[0]).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="49"');
    expect(rowSvgBodies[1]).not.toContain('data-tex-font="lmroman10-regular" data-tex-glyph="49"');
    expect(rowSvgBodies[1]).not.toContain('data-tex-font="lmroman10-regular" data-tex-glyph="50"');
    expect(rowSvgBodies[2]).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="65"');
    expect(rowSvgBodies[3]).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="50"');
  });

  it("renders numbered multline display math with one final-row label", () => {
    const source = String.raw`Alpha \begin{multline}a\\b\end{multline} Beta \begin{multline}c\\d\notag\end{multline} Gamma \begin{multline}e\\f\tag{A}\end{multline} Delta \begin{equation}g\end{equation} Epsilon`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:numbered-multline-display-math",
      width: 180,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const rows = result.vlistLayout?.boxReport.items.filter((item) =>
      item.hboxRole?.kind === "display-align-row"
    ) ?? [];
    expect(rows).toHaveLength(6);
    expect(rows.map((row) =>
      row.hboxRole?.kind === "display-align-row" ? row.hboxRole.delimiter : null
    )).toEqual(["multline", "multline", "multline", "multline", "multline", "multline"]);

    const positionedRows = result.vlistLayout?.items.filter((item) =>
      item.item.kind === "hbox" && item.item.role?.kind === "display-align-row"
    ) ?? [];
    const rowSvgBodies = positionedRows.map((row) =>
      row.item.kind === "hbox" ? row.item.box.renderItems.map((renderItem) =>
        renderItem.kind === "tex-math-svg" ? renderItem.svgBody : ""
      ).join("") : ""
    );
    expect(rowSvgBodies).toHaveLength(6);
    expect(rowSvgBodies[0]).not.toContain('data-tex-font="lmroman10-regular" data-tex-glyph="49"');
    expect(rowSvgBodies[1]).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="49"');
    expect(rowSvgBodies[2]).not.toContain('data-tex-font="lmroman10-regular" data-tex-glyph="50"');
    expect(rowSvgBodies[3]).not.toContain('data-tex-font="lmroman10-regular" data-tex-glyph="50"');
    expect(rowSvgBodies[4]).not.toContain('data-tex-font="lmroman10-regular" data-tex-glyph="65"');
    expect(rowSvgBodies[5]).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="65"');

    const displays = result.vlistLayout?.items.filter((item) =>
      item.item.kind === "display-math"
    ) ?? [];
    const equationBox = displays[0]?.item.kind === "display-math" ? displays[0].item.box : null;
    expect(equationBox?.svgBody).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="50"');
  });

  it("renders intertext in display alignments as a source-spanned paragraph between rows", () => {
    const source = String.raw`Alpha \begin{align*}a&=b\\\intertext{words}c&=d\end{align*} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:display-alignment-intertext",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.boxReport.items.some((item) => item.itemKind === "placeholder")).toBe(false);
    const rows = result.vlistLayout?.boxReport.items.filter((item) =>
      item.hboxRole?.kind === "display-align-row"
    ) ?? [];
    const intertextParagraphs = result.vlistLayout?.boxReport.items.filter((item) =>
      item.itemKind === "paragraph" &&
      item.sourceSpan?.start === source.indexOf("{words}") + 1
    ) ?? [];
    expect(rows).toHaveLength(2);
    expect(intertextParagraphs).toHaveLength(1);
    expect(intertextParagraphs[0]).toMatchObject({
      itemKind: "paragraph",
      sourceSpan: {
        start: source.indexOf("{words}") + 1,
        end: source.indexOf("{words}") + 1 + "words".length,
      },
    });
    expect(intertextParagraphs[0]?.y ?? 0).toBeGreaterThan(rows[0]?.y ?? 0);
    expect(intertextParagraphs[0]?.y ?? 0).toBeLessThan(rows[1]?.y ?? Number.POSITIVE_INFINITY);
  });

  it("renders inline math inside display alignment intertext through paragraph math segments", () => {
    const source = String.raw`Alpha \begin{align*}a&=b\\\intertext{where $x_i=y^2$ holds}c&=d\end{align*} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:display-alignment-intertext-inline-math",
      width: 220,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const paragraphReport = result.vlistLayout?.reports.find(
      (report): report is ParagraphLayoutReport => Array.isArray((report as ParagraphLayoutReport).lines)
    );
    const intertextLine = paragraphReport?.lines.find((line) =>
      line.segments.some((segment) =>
        segment.sourceStartRaw === source.indexOf("$x_i") + 1 &&
        segment.sourceKind === "math"
      )
    );
    const mathSegments = intertextLine?.segments.filter((segment) => segment.kind === "math") ?? [];
    expect(mathSegments).toHaveLength(2);
    expect(mathSegments[0]).toMatchObject({
      kind: "math",
      text: "x_i=",
      sourceStartRaw: source.indexOf("$x_i") + 1,
      sourceEndRaw: source.indexOf("=y") + 1,
      sourceKind: "math",
    });
    expect(mathSegments[1]).toMatchObject({
      kind: "math",
      text: "y^2",
      sourceStartRaw: source.indexOf("y^2"),
      sourceEndRaw: source.indexOf("$ holds"),
      sourceKind: "math",
    });
    expect(mathSegments[0]?.mathSvgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="120"');
    expect(intertextLine?.ascent ?? 0).toBeGreaterThan(7);
    expect(intertextLine?.descent ?? 0).toBeGreaterThan(1);
  });

  it("inherits list scope for display alignment intertext paragraphs", () => {
    const source = String.raw`Alpha \begin{itemize}\item First.\item Compact \begin{align*}a&=b\\\intertext{where $x_i=y^2$ holds}c&=d\end{align*} done.\end{itemize} Beta`;
    const intertextStart = source.indexOf("where");
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:display-alignment-intertext-list-scope",
      width: 190,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const intertextParagraph = result.vlistLayout?.boxReport.items.find((item) =>
      item.itemKind === "paragraph" &&
      item.sourceSpan?.start === intertextStart
    );
    expect(intertextParagraph).toBeTruthy();
    expect(intertextParagraph).toMatchObject({
      x: 25,
      sourceSpan: {
        start: intertextStart,
        end: source.indexOf(" holds") + " holds".length,
      },
    });
    const labels = result.vlistLayout?.boxReport.items.filter((item) =>
      item.hboxRole?.kind === "list-label"
    ) ?? [];
    expect(labels).toHaveLength(2);
  });

  it("does not double-apply list margins when breaking display alignment intertext", () => {
    const source = String.raw`Alpha \begin{itemize}\item First item.\item Quoted \begin{align*}\dbinom{2}{\cdots}&=1^z\\\intertext{second condition measured second holds}\big[x+c\big]&=\sqrt{i}\end{align*} result.\end{itemize} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:display-alignment-intertext-list-break-width",
      width: 190,
      alignment: "ragged-right",
      rightskipStretch: 190,
      spaceGlueProfile: "font",
      tikzTextWidthNode: true,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const lineTexts = result.report?.lines.map((line) =>
      line.segments.map((segment) => segment.text).join("")
    ) ?? [];
    expect(lineTexts).toContain("second condition measured second holds");
    expect(lineTexts).not.toContain("holds");
  });

  it("uses normal TeX paragraph breaking for display alignment intertext", () => {
    const source = String.raw`Alpha \begin{align*}\text{min}&=z_j^z\\\intertext{where where measured holds holds}\begin{bmatrix}n^n&\ldots\end{bmatrix}&=a_x^2\end{align*} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:display-alignment-intertext-normal-breaking",
      width: 140,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const paragraphReport = result.vlistLayout?.reports.find(
      (report): report is ParagraphLayoutReport => Array.isArray((report as ParagraphLayoutReport).lines)
    );
    const intertextLines = paragraphReport?.lines.filter((line) =>
      line.segments.map((segment) => segment.text ?? "").join("") ===
        "where where measured holds holds"
    ) ?? [];
    expect(intertextLines).toHaveLength(1);
    const rows = result.vlistLayout?.boxReport.items.filter((item) =>
      item.hboxRole?.kind === "display-align-row"
    ) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[1]?.y).toBeCloseTo(70.519974, 4);
  });

  it("renders displaybreak in alignments as a non-visual page-break directive", () => {
    const source = String.raw`Alpha \begin{align*}a&=b\displaybreak[2]\\c&=d\end{align*} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:displaybreak-display-alignment",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.boxReport.items.some((item) => item.itemKind === "placeholder")).toBe(false);
    const rows = result.vlistLayout?.boxReport.items.filter((item) =>
      item.hboxRole?.kind === "display-align-row"
    ) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => ({
      rowIndex: row.hboxRole?.kind === "display-align-row" ? row.hboxRole.rowIndex : null,
      source: source.slice(row.sourceSpan?.start ?? 0, row.sourceSpan?.end ?? 0),
    }))).toEqual([
      {
        rowIndex: 0,
        source: String.raw`a&=b\displaybreak[2]\\`,
      },
      {
        rowIndex: 1,
        source: "c&=d",
      },
    ]);
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

  it("lets TeX paragraph layout carry flalign-star display math as edge-flush display rows", () => {
    const source = String.raw`Alpha \begin{flalign*}a&=b&c&=d\\e&=f&g&=h\end{flalign*} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:flalign-star-display-math-provider",
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
      width: expect.closeTo(120, 5),
      hboxRole: {
        kind: "display-align-row",
        delimiter: "flalign-star",
        rowIndex: 0,
      },
    });

    const content = String.raw`a&=b&c&=d\\e&=f&g&=h`;
    const provider = createTexDerivedInlineMathBoxProvider();
    const flalign = provider.getDisplayMathAlignment?.({
      source,
      content,
      delimiter: "flalign-star",
      sourceStart: source.indexOf(String.raw`\begin{flalign*}`),
      sourceEnd: source.indexOf(String.raw`\end{flalign*}`) + String.raw`\end{flalign*}`.length,
      contentStart: source.indexOf("a&=b"),
      contentEnd: source.indexOf(String.raw`\end{flalign*}`),
      targetWidth: 120,
    });
    const align = provider.getDisplayMathAlignment?.({
      source,
      content,
      delimiter: "align-star",
      sourceStart: source.indexOf(String.raw`\begin{flalign*}`),
      sourceEnd: source.indexOf(String.raw`\end{flalign*}`) + String.raw`\end{flalign*}`.length,
      contentStart: source.indexOf("a&=b"),
      contentEnd: source.indexOf(String.raw`\end{flalign*}`),
      targetWidth: 120,
    });

    expect(flalign?.rows).toHaveLength(2);
    expect(flalign?.rows[0]?.width).toBeCloseTo(120, 5);
    expect(firstGlyphX(flalign?.rows[0]?.hlist?.items ?? [])).toBeCloseTo(0, 5);
    expect(mathItemsRightEdge(flalign?.rows[0]?.hlist?.items ?? [])).toBeGreaterThan(119);
    expect(firstGlyphX(align?.rows[0]?.hlist?.items ?? []) ?? 0).toBeGreaterThan(10);
    expect(result.vlistLayout?.paragraphPlacements.map((placement) =>
      source.slice(placement.sourceSpan.start, placement.sourceSpan.end)
    )).toEqual(["Alpha", "Beta"]);
  });

  it("lets TeX paragraph layout carry gather-star display math as centered display rows", () => {
    const source = String.raw`Alpha \begin{gather*}a=b\\c+d=e\end{gather*} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:gather-star-display-math-provider",
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
      hboxRole: {
        kind: "display-align-row",
        delimiter: "gather-star",
        rowIndex: 0,
      },
    });
    expect(rows[1]).toMatchObject({
      itemKind: "hbox",
      x: 0,
      hboxRole: {
        kind: "display-align-row",
        delimiter: "gather-star",
        rowIndex: 1,
      },
    });
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content: String.raw`a=b\\c+d=e`,
      delimiter: "gather-star",
      sourceStart: source.indexOf(String.raw`\begin{gather*}`),
      sourceEnd: source.indexOf(String.raw`\end{gather*}`) + String.raw`\end{gather*}`.length,
      contentStart: source.indexOf("a=b"),
      contentEnd: source.indexOf(String.raw`\end{gather*}`),
      targetWidth: 120,
    });
    expect(directAlignment?.delimiter).toBe("gather-star");
    expect(directAlignment?.rows).toHaveLength(2);
    expect(directAlignment?.rows[0]?.svgBody).toContain('data-tex-math-hlist="true"');
    expect(directAlignment?.rows[0]?.svgBody).toContain(`data-source-start="${source.indexOf("a=b")}"`);
    expect(directAlignment?.rows[1]?.svgBody).toContain(`data-source-start="${source.indexOf("c+d=e")}"`);
    expect(result.vlistLayout?.paragraphPlacements.map((placement) =>
      source.slice(placement.sourceSpan.start, placement.sourceSpan.end)
    )).toEqual(["Alpha", "Beta"]);
  });

  it("uses TeX per-row gather tag clearance for numbered rows", () => {
    const source = String.raw`Alpha \begin{gather}\overline{\dots}=\operatorname{proj\,lim}\\\Bigg(\tfrac{j}{\dots}\Bigg)-\left\langle\frac{x}{z}\right\rangle \notag\end{gather} Beta`;
    const content = String.raw`\overline{\dots}=\operatorname{proj\,lim}\\\Bigg(\tfrac{j}{\dots}\Bigg)-\left\langle\frac{x}{z}\right\rangle \notag`;
    const rowBreakEnd = source.indexOf(String.raw`\\`) + String.raw`\\`.length;
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content,
      delimiter: "gather",
      sourceStart: source.indexOf(String.raw`\begin{gather}`),
      sourceEnd: source.indexOf(String.raw`\end{gather}`) + String.raw`\end{gather}`.length,
      contentStart: source.indexOf(String.raw`\overline`),
      contentEnd: source.indexOf(String.raw`\end{gather}`),
      targetWidth: 100,
      displayLabels: [
        {
          text: "1",
          sourceSpan: { start: rowBreakEnd, end: rowBreakEnd },
          textSourceSpan: { start: rowBreakEnd, end: rowBreakEnd },
        },
        null,
      ],
    });

    expect(directAlignment?.rows).toHaveLength(2);
    expect(firstGlyphX(directAlignment?.rows[0]?.hlist?.items ?? [])).toBeCloseTo(14.290451, 5);
    expect(firstGlyphX(directAlignment?.rows[1]?.hlist?.items ?? [])).toBeCloseTo(21.040872, 5);
  });

  it("keeps shifted gather tags out of row hbox metrics", () => {
    const source = String.raw`Alpha \begin{gather}\begin{matrix}\frac{2}{x}&\tfrac{n}{\ldots}&1\end{matrix}+\text{max}\\\begin{cases}a^2&\binom{m}{\dots}\\\ldots&\dots_b\end{cases}=\text{if $Ax \ge b$,}\end{gather} Beta`;
    const content = source.slice(
      source.indexOf(String.raw`\begin{matrix}`),
      source.indexOf(String.raw`\end{gather}`)
    );
    const contentEnd = source.indexOf(String.raw`\end{gather}`);
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content,
      delimiter: "gather",
      sourceStart: source.indexOf(String.raw`\begin{gather}`),
      sourceEnd: source.indexOf(String.raw`\end{gather}`) + String.raw`\end{gather}`.length,
      contentStart: source.indexOf(String.raw`\begin{matrix}`),
      contentEnd,
      targetWidth: 100,
      displayLabels: [
        {
          text: "1",
          sourceSpan: { start: contentEnd, end: contentEnd },
          textSourceSpan: { start: contentEnd, end: contentEnd },
        },
        {
          text: "2",
          sourceSpan: { start: contentEnd, end: contentEnd },
          textSourceSpan: { start: contentEnd, end: contentEnd },
        },
      ],
    });

    expect(directAlignment?.rows).toHaveLength(2);
    expect(directAlignment?.rows[1]).toMatchObject({
      width: 100,
      height: expect.closeTo(17.50015, 5),
      depth: expect.closeTo(15.600037, 5),
    });
  });

  it("lets TeX paragraph layout carry multline-star display math with row-specific placement", () => {
    const source = String.raw`Alpha \begin{multline*}a=b\\c+d=e\\f=g\end{multline*} Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:multline-star-display-math-provider",
      width: 140,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const rows = result.vlistLayout?.boxReport.items.filter((item) =>
      item.hboxRole?.kind === "display-align-row"
    ) ?? [];
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.hboxRole)).toEqual([
      { kind: "display-align-row", delimiter: "multline-star", rowIndex: 0 },
      { kind: "display-align-row", delimiter: "multline-star", rowIndex: 1 },
      { kind: "display-align-row", delimiter: "multline-star", rowIndex: 2 },
    ]);
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content: String.raw`a=b\\c+d=e\\f=g`,
      delimiter: "multline-star",
      sourceStart: source.indexOf(String.raw`\begin{multline*}`),
      sourceEnd: source.indexOf(String.raw`\end{multline*}`) + String.raw`\end{multline*}`.length,
      contentStart: source.indexOf("a=b"),
      contentEnd: source.indexOf(String.raw`\end{multline*}`),
      targetWidth: 140,
    });
    expect(directAlignment?.delimiter).toBe("multline-star");
    expect(directAlignment?.rows).toHaveLength(3);
    expect(directAlignment?.rows[0]?.svgBody).toContain(`data-source-start="${source.indexOf("a=b")}"`);
    expect(directAlignment?.rows[1]?.svgBody).toContain(`data-source-start="${source.indexOf("c+d=e")}"`);
    expect(directAlignment?.rows[2]?.svgBody).toContain(`data-source-start="${source.indexOf("f=g")}"`);
    expect(result.vlistLayout?.paragraphPlacements.map((placement) =>
      source.slice(placement.sourceSpan.start, placement.sourceSpan.end)
    )).toEqual(["Alpha", "Beta"]);
  });

  it("applies TeX multline preamble spacing before leading operators", () => {
    const source = String.raw`\begin{multline}\operatorname{rank}-m\\x_x^n\\\underline{i+a}\end{multline}`;
    const content = String.raw`\operatorname{rank}-m\\x_x^n\\\underline{i+a}`;
    const contentEnd = source.indexOf(String.raw`\end{multline}`);
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content,
      delimiter: "multline",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: source.indexOf(String.raw`\operatorname`),
      contentEnd,
      targetWidth: 140,
      displayLabels: [
        null,
        null,
        {
          text: "1",
          sourceSpan: { start: contentEnd, end: contentEnd },
          textSourceSpan: { start: contentEnd, end: contentEnd },
        },
      ],
    });

    expect(directAlignment?.rows).toHaveLength(3);
    expect(firstGlyphX(directAlignment?.rows[0]?.hlist?.items ?? [])).toBeCloseTo(11.666672, 5);
  });

  it("renders explicit align-star tags as right-aligned row labels", () => {
    const source = String.raw`\begin{align*}a&=b \tag{A}\end{align*}`;
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content: String.raw`a&=b \tag{A}`,
      delimiter: "align-star",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: source.indexOf("a&=b"),
      contentEnd: source.indexOf(String.raw`\end{align*}`),
      targetWidth: 120,
    });

    expect(directAlignment?.rows[0]).toMatchObject({
      width: 120,
    });
    expect(directAlignment?.rows[0]?.svgBody).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="40"');
    expect(directAlignment?.rows[0]?.svgBody).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="65"');
    expect(directAlignment?.rows[0]?.svgBody).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="41"');
  });

  it("lets explicit align-star tags drive TeX overfull row metrics", () => {
    const source = String.raw`\begin{align*}\cdots_i^z&=\begin{bmatrix}\ldots&z&\frac{y}{b}\end{bmatrix} \tag{A}\\\text{when $x_i=y$,}&=\text{if $Ax \ge b$,}\\\text{for $n \ge 1$}&=\begin{bmatrix}y\end{bmatrix}\end{align*}`;
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content: String.raw`\cdots_i^z&=\begin{bmatrix}\ldots&z&\frac{y}{b}\end{bmatrix} \tag{A}\\\text{when $x_i=y$,}&=\text{if $Ax \ge b$,}\\\text{for $n \ge 1$}&=\begin{bmatrix}y\end{bmatrix}`,
      delimiter: "align-star",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: source.indexOf(String.raw`\cdots`),
      contentEnd: source.indexOf(String.raw`\end{align*}`),
      targetWidth: 120,
    });

    expect(directAlignment?.rows).toHaveLength(3);
    for (const row of directAlignment?.rows ?? []) {
      expect(row.width).toBeCloseTo(121.659622, 3);
    }
  });

  it("keeps far-overfull explicit align-star tag rows at TeX display width", () => {
    const source = String.raw`\begin{align*}\sqrt{a+\ldots}&=\text{for $n \ge 1$}+a+b+c+d+e+f+g+h+i+j+k+l+m+n \tag{Long tag}\end{align*}`;
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content: String.raw`\sqrt{a+\ldots}&=\text{for $n \ge 1$}+a+b+c+d+e+f+g+h+i+j+k+l+m+n \tag{Long tag}`,
      delimiter: "align-star",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: source.indexOf(String.raw`\sqrt`),
      contentEnd: source.indexOf(String.raw`\end{align*}`),
      targetWidth: 160,
    });

    expect(directAlignment?.rows).toHaveLength(1);
    expect(directAlignment?.rows[0]?.width).toBeCloseTo(160, 6);
    expect(directAlignment?.rows[0]?.depth).toBeCloseTo(15.600037, 5);
  });

  it("lowers align-star tags that collide with the equation body", () => {
    const source = String.raw`\begin{align*}a&=b+c+d+e+f+g+h+i+j+k+l+m+n+o \tag{Long tag}\end{align*}`;
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content: String.raw`a&=b+c+d+e+f+g+h+i+j+k+l+m+n+o \tag{Long tag}`,
      delimiter: "align-star",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: source.indexOf("a&=b"),
      contentEnd: source.indexOf(String.raw`\end{align*}`),
      targetWidth: 300,
    });

    expect(directAlignment?.rows[0]?.depth).toBeCloseTo(15.600037, 5);
    expect(directAlignment?.rows[0]?.svgBody).toContain('data-tex-font="lmroman10-regular" data-tex-glyph="76"');
  });

  it("uses TeX shifted-tag metrics for two-row alignments", () => {
    const source = String.raw`\begin{align*}a&=b+c+d+e+f+g+h+i+j+k+l+m+n+o \tag{Long tag}\\c&=d\end{align*}`;
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content: String.raw`a&=b+c+d+e+f+g+h+i+j+k+l+m+n+o \tag{Long tag}\\c&=d`,
      delimiter: "align-star",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: source.indexOf("a&=b"),
      contentEnd: source.indexOf(String.raw`\end{align*}`),
      targetWidth: 300,
    });

    expect(directAlignment?.rows[0]?.depth).toBeCloseTo(15.600037, 5);
    expect(directAlignment?.rows[0]?.svgBody).toMatch(/translate\([0-9.]+ 1200\) scale\(100\)/u);
  });

  it("uses TeX normal-baseline shifted-tag placement for deep multi-row alignments", () => {
    const source = String.raw`Alpha \begin{align*}\dfrac{j}{\dots}&=\tilde{n+a} \tag{A}\\\begin{pmatrix}\dots_x&\cdots\end{pmatrix}&=j\\\operatorname*{span}&=\text{off}\end{align*} Beta`;
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content: String.raw`\dfrac{j}{\dots}&=\tilde{n+a} \tag{A}\\\begin{pmatrix}\dots_x&\cdots\end{pmatrix}&=j\\\operatorname*{span}&=\text{off}`,
      delimiter: "align-star",
      sourceStart: source.indexOf(String.raw`\begin{align*}`),
      sourceEnd: source.indexOf(String.raw`\end{align*}`) + String.raw`\end{align*}`.length,
      contentStart: source.indexOf(String.raw`\dfrac`),
      contentEnd: source.indexOf(String.raw`\end{align*}`),
      targetWidth: 100,
    });
    const tagGlyphs = directAlignment?.rows.at(0)?.hlist?.items.filter((item): item is Extract<typeof item, { readonly kind: "glyph" }> =>
      item.kind === "glyph" &&
      item.fontId === "lmroman10-regular" &&
      (item.code === 40 || item.code === 65 || item.code === 41)
    ) ?? [];

    expect(directAlignment?.rows.at(0)?.depth).toBeCloseTo(19.85951, 4);
    expect(tagGlyphs).toHaveLength(3);
    expect(tagGlyphs.map((glyph) => glyph.y)).toEqual([
      expect.closeTo(16.25951, 5),
      expect.closeTo(16.25951, 5),
      expect.closeTo(16.25951, 5),
    ]);
  });

  it("inherits amsmath measured line depth for the first shifted align tag", () => {
    const source = String.raw`Alpha \begin{align*}\tilde{1}&=n&\ldots_z&=\tbinom{c}{2} \tag{A}\\\Big[y+c\Big]&=\begin{smallmatrix}c\end{smallmatrix}&\tbinom{2}{m}&=\begin{vmatrix}\cdots\end{vmatrix}\\\hat{j}&=\frac{m}{\cdots}&\big[\tfrac{j}{2}\big]&=m^2\end{align*} Beta`;
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content: String.raw`\tilde{1}&=n&\ldots_z&=\tbinom{c}{2} \tag{A}\\\Big[y+c\Big]&=\begin{smallmatrix}c\end{smallmatrix}&\tbinom{2}{m}&=\begin{vmatrix}\cdots\end{vmatrix}\\\hat{j}&=\frac{m}{\cdots}&\big[\tfrac{j}{2}\big]&=m^2`,
      delimiter: "align-star",
      sourceStart: source.indexOf(String.raw`\begin{align*}`),
      sourceEnd: source.indexOf(String.raw`\end{align*}`) + String.raw`\end{align*}`.length,
      contentStart: source.indexOf(String.raw`\tilde`),
      contentEnd: source.indexOf(String.raw`\end{align*}`),
      targetWidth: 120,
    });
    const tagGlyphs = directAlignment?.rows.at(0)?.hlist?.items.filter((item): item is Extract<typeof item, { readonly kind: "glyph" }> =>
      item.kind === "glyph" &&
      item.fontId === "lmroman10-regular" &&
      (item.code === 40 || item.code === 65 || item.code === 41)
    ) ?? [];

    expect(directAlignment?.rows.at(0)?.height).toBeCloseTo(8.81748, 5);
    expect(directAlignment?.rows.at(0)?.depth).toBeCloseTo(19.85951, 4);
    expect(tagGlyphs.map((glyph) => glyph.y)).toEqual([
      expect.closeTo(16.25951, 5),
      expect.closeTo(16.25951, 5),
      expect.closeTo(16.25951, 5),
    ]);
  });

  it("uses the maximum measured align-row depth for the first shifted tag", () => {
    const source = String.raw`Aligned $\underline{x+2}+\tfrac{\ldots}{n}$ first. \par \noindent after \begin{align*}\sqrt{j}&=\hat{\ldots+n}&\begin{smallmatrix}\frac{\ldots}{j}&n_x^y\\\tfrac{2}{c}&\tfrac{c}{a}\end{smallmatrix}&=\begin{array}{cr}x&\binom{z}{\cdots}\end{array} \tag{A}\\\begin{cases}\dbinom{\dots}{b}&\binom{a}{n}\\\dfrac{i}{\cdots}&i\end{cases}&=2_n^2&1^y&=\operatorname*{arg\,max}\\\dbinom{n}{y}&=\frac{1}{x}&\begin{pmatrix}c&\frac{2}{c}\\a&\cdots^j\end{pmatrix}&=\underline{\ldots+x}\end{align*} closing \(n\).`;
    const content = String.raw`\sqrt{j}&=\hat{\ldots+n}&\begin{smallmatrix}\frac{\ldots}{j}&n_x^y\\\tfrac{2}{c}&\tfrac{c}{a}\end{smallmatrix}&=\begin{array}{cr}x&\binom{z}{\cdots}\end{array} \tag{A}\\\begin{cases}\dbinom{\dots}{b}&\binom{a}{n}\\\dfrac{i}{\cdots}&i\end{cases}&=2_n^2&1^y&=\operatorname*{arg\,max}\\\dbinom{n}{y}&=\frac{1}{x}&\begin{pmatrix}c&\frac{2}{c}\\a&\cdots^j\end{pmatrix}&=\underline{\ldots+x}`;
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content,
      delimiter: "align-star",
      sourceStart: source.indexOf(String.raw`\begin{align*}`),
      sourceEnd: source.indexOf(String.raw`\end{align*}`) + String.raw`\end{align*}`.length,
      contentStart: source.indexOf(String.raw`\sqrt`),
      contentEnd: source.indexOf(String.raw`\end{align*}`),
      targetWidth: 170,
    });
    const tagGlyphs = directAlignment?.rows.at(0)?.hlist?.items.filter((item): item is Extract<typeof item, { readonly kind: "glyph" }> =>
      item.kind === "glyph" &&
      item.fontId === "lmroman10-regular" &&
      (item.code === 40 || item.code === 65 || item.code === 41)
    ) ?? [];

    expect(directAlignment?.rows.at(0)?.depth).toBeCloseTo(32.610077, 4);
    expect(tagGlyphs.map((glyph) => glyph.y)).toEqual([
      expect.closeTo(29.01004, 5),
      expect.closeTo(29.01004, 5),
      expect.closeTo(29.01004, 5),
    ]);
  });

  it("keeps non-colliding align-star tags on the equation baseline", () => {
    const source = String.raw`\begin{align*}a&=b \tag{A}\end{align*}`;
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content: String.raw`a&=b \tag{A}`,
      delimiter: "align-star",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: source.indexOf("a&=b"),
      contentEnd: source.indexOf(String.raw`\end{align*}`),
      targetWidth: 300,
    });

    expect(directAlignment?.rows[0]?.depth).toBeLessThan(4);
  });

  it("applies TeX right-tag clearance to multi-pair centered alignments", () => {
    const source = String.raw`Alpha \begin{align*}\text{for $n \ge 1$}&=\text{if}&\sqrt{n+y}&=\big[a+c\big] \tag{A}\\
\overline{i+c}&=n&\Big\langle \frac{i}{\dots}\Big\rangle&=\tfrac{\ldots}{\ldots}\end{align*} Beta`;
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content: String.raw`\text{for $n \ge 1$}&=\text{if}&\sqrt{n+y}&=\big[a+c\big] \tag{A}\\
\overline{i+c}&=n&\Big\langle \frac{i}{\dots}\Big\rangle&=\tfrac{\ldots}{\ldots}`,
      delimiter: "align-star",
      sourceStart: source.indexOf(String.raw`\begin{align*}`),
      sourceEnd: source.indexOf(String.raw`\end{align*}`) + String.raw`\end{align*}`.length,
      contentStart: source.indexOf(String.raw`\text{for`),
      contentEnd: source.indexOf(String.raw`\end{align*}`),
      targetWidth: 220,
    });
    const firstRow = directAlignment?.rows.at(0);
    const secondRow = directAlignment?.rows.at(1);
    const firstRowCells = firstRow?.hlist?.items.filter((item) =>
      item.kind === "hlist" && item.role === "aligned-cell"
    ) ?? [];
    const secondRowCells = secondRow?.hlist?.items.filter((item) =>
      item.kind === "hlist" && item.role === "aligned-cell"
    ) ?? [];

    expect(firstRowCells).toHaveLength(4);
    expect(secondRowCells).toHaveLength(4);
    const firstRowCellXs = firstRowCells.map((cell) => cell.x);
    const secondRowCellXs = secondRowCells.map((cell) => cell.x);
    expect(firstRowCellXs).toEqual([
      expect.closeTo(23.472146, 5),
      expect.closeTo(63.117898, 5),
      expect.closeTo(105.925776, 5),
      expect.closeTo(137.745364, 5),
    ]);
    expect(secondRowCellXs).toEqual([
      expect.closeTo(43.12294, 5),
      expect.closeTo(63.117898, 5),
      expect.closeTo(111.45639, 5),
      expect.closeTo(137.745364, 5),
    ]);
  });

  it("applies TeX right-tag clearance to single-pair multi-row alignments", () => {
    const source = String.raw`Alpha \begin{align}y&=\text{for $n \ge 1$}\\\begin{cases}\tfrac{n}{z}&m\\b_c^y&\tfrac{j}{x}\end{cases}&=\bigg\langle a+y\bigg\rangle \notag\\\underline{\tfrac{j}{m}}&=\begin{cases}x_m&\binom{1}{a}\end{cases}\\\text{for $n \ge 1$}&=b_y^a\end{align} Beta`;
    const content = String.raw`y&=\text{for $n \ge 1$}\\\begin{cases}\tfrac{n}{z}&m\\b_c^y&\tfrac{j}{x}\end{cases}&=\bigg\langle a+y\bigg\rangle \notag\\\underline{\tfrac{j}{m}}&=\begin{cases}x_m&\binom{1}{a}\end{cases}\\\text{for $n \ge 1$}&=b_y^a`;
    const rowBreaks = [...source.matchAll(/\\\\/gu)].map((match) => (match.index ?? 0) + match[0].length);
    const contentEnd = source.indexOf(String.raw`\end{align}`);
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content,
      delimiter: "align",
      sourceStart: source.indexOf(String.raw`\begin{align}`),
      sourceEnd: source.indexOf(String.raw`\end{align}`) + String.raw`\end{align}`.length,
      contentStart: source.indexOf("y&="),
      contentEnd,
      targetWidth: 120,
      displayLabels: [
        {
          text: "1",
          sourceSpan: { start: rowBreaks[0] ?? contentEnd, end: rowBreaks[0] ?? contentEnd },
          textSourceSpan: { start: rowBreaks[0] ?? contentEnd, end: rowBreaks[0] ?? contentEnd },
        },
        null,
        {
          text: "2",
          sourceSpan: { start: rowBreaks[2] ?? contentEnd, end: rowBreaks[2] ?? contentEnd },
          textSourceSpan: { start: rowBreaks[2] ?? contentEnd, end: rowBreaks[2] ?? contentEnd },
        },
        {
          text: "3",
          sourceSpan: { start: contentEnd, end: contentEnd },
          textSourceSpan: { start: contentEnd, end: contentEnd },
        },
      ],
    });

    expect(directAlignment?.rows).toHaveLength(4);
    expect(firstGlyphX(directAlignment?.rows[0]?.hlist?.items ?? [])).toBeCloseTo(41.681699, 5);
    expect(firstGlyphX(directAlignment?.rows[3]?.hlist?.items ?? [])).toBeCloseTo(7.297557, 5);
  });

  it("keeps shifted tagged align rows at TeX display width", () => {
    const source = String.raw`Alpha \begin{align}\tilde{\frac{m}{a}}&=\cdots_c^i&b_2^i&=\ldots \tag{A}\\\begin{smallmatrix}\binom{1}{1}\\c_n^i\end{smallmatrix}&=\begin{Vmatrix}\binom{2}{j}&a_c\end{Vmatrix}&\underline{\frac{x}{j}}&=z_j^m\\\Big[y+1\Big]&=\overline{j}&\bigcup_y^a&=\begin{array}{c}m_j\end{array}\end{align} Beta`;
    const content = String.raw`\tilde{\frac{m}{a}}&=\cdots_c^i&b_2^i&=\ldots \tag{A}\\\begin{smallmatrix}\binom{1}{1}\\c_n^i\end{smallmatrix}&=\begin{Vmatrix}\binom{2}{j}&a_c\end{Vmatrix}&\underline{\frac{x}{j}}&=z_j^m\\\Big[y+1\Big]&=\overline{j}&\bigcup_y^a&=\begin{array}{c}m_j\end{array}`;
    const rowBreaks = [...source.matchAll(/\\\\/gu)].map((match) => (match.index ?? 0) + match[0].length);
    const contentEnd = source.indexOf(String.raw`\end{align}`);
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content,
      delimiter: "align",
      sourceStart: source.indexOf(String.raw`\begin{align}`),
      sourceEnd: source.indexOf(String.raw`\end{align}`) + String.raw`\end{align}`.length,
      contentStart: source.indexOf(String.raw`\tilde`),
      contentEnd,
      targetWidth: 140,
      displayLabels: [
        null,
        {
          text: "1",
          sourceSpan: { start: rowBreaks[1] ?? contentEnd, end: rowBreaks[1] ?? contentEnd },
          textSourceSpan: { start: rowBreaks[1] ?? contentEnd, end: rowBreaks[1] ?? contentEnd },
        },
        {
          text: "2",
          sourceSpan: { start: contentEnd, end: contentEnd },
          textSourceSpan: { start: contentEnd, end: contentEnd },
        },
      ],
    });

    expect(directAlignment?.rows).toHaveLength(3);
    expect(directAlignment?.rows.map((row) => row.width)).toEqual([
      expect.closeTo(140, 6),
      expect.closeTo(140, 6),
      expect.closeTo(140, 6),
    ]);
  });

  it("expands tagged align rows when the equation body exceeds the display width", () => {
    const source = String.raw`Alpha \begin{align*}\begin{cases}a&2\end{cases}&=\bigg(1+x\bigg)&\sqrt{c+m}&=\text{if} \tag{A}\\\text{when $x_i=y$,}&=\begin{Bmatrix}\tfrac{y}{m}\end{Bmatrix}&\underline{\tfrac{i}{c}}&=\tbinom{2}{x}\end{align*} Beta`;
    const content = String.raw`\begin{cases}a&2\end{cases}&=\bigg(1+x\bigg)&\sqrt{c+m}&=\text{if} \tag{A}\\\text{when $x_i=y$,}&=\begin{Bmatrix}\tfrac{y}{m}\end{Bmatrix}&\underline{\tfrac{i}{c}}&=\tbinom{2}{x}`;
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content,
      delimiter: "align-star",
      sourceStart: source.indexOf(String.raw`\begin{align*}`),
      sourceEnd: source.indexOf(String.raw`\end{align*}`) + String.raw`\end{align*}`.length,
      contentStart: source.indexOf(String.raw`\begin{cases}`),
      contentEnd: source.indexOf(String.raw`\end{align*}`),
      targetWidth: 120,
    });

    expect(directAlignment?.rows).toHaveLength(2);
    expect(directAlignment?.rows.map((row) => row.width)).toEqual([
      expect.closeTo(178.220987, 5),
      expect.closeTo(178.220987, 5),
    ]);
  });

  it("expands numbered align rows when a tagged equation body exceeds the display width", () => {
    const source = String.raw`Alpha \begin{align}\operatorname{span}&=c_x&\sqrt{\tfrac{y}{\cdots}}&=\begin{array}{cl}m_y^i&\tbinom{b}{n}\\\dbinom{a}{a}&x\end{array}\\\underline{b+\cdots}&=\operatorname{cone}&\tbinom{\ldots}{j}&=\text{max} \notag\\\tbinom{2}{\ldots}&=i&\begin{array}{rl}\dbinom{a}{m}&y_x\end{array}&=\begin{Vmatrix}\dots^j&\dbinom{i}{\cdots}\\2_x^a&\tfrac{\dots}{1}\end{Vmatrix}\\\sum_i^b&=1&\dots_c&=\Bigg(\tfrac{2}{z}\Bigg)\end{align} Beta`;
    const content = source.slice(
      source.indexOf(String.raw`\operatorname`),
      source.indexOf(String.raw`\end{align}`)
    );
    const contentEnd = source.indexOf(String.raw`\end{align}`);
    const directAlignment = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content,
      delimiter: "align",
      sourceStart: source.indexOf(String.raw`\begin{align}`),
      sourceEnd: source.indexOf(String.raw`\end{align}`) + String.raw`\end{align}`.length,
      contentStart: source.indexOf(String.raw`\operatorname`),
      contentEnd,
      targetWidth: 160,
    });

    expect(directAlignment?.rows).toHaveLength(4);
    expect(directAlignment?.rows.map((row) => row.width)).toEqual([
      expect.closeTo(201.112371, 6),
      expect.closeTo(201.112371, 6),
      expect.closeTo(201.112371, 6),
      expect.closeTo(201.112371, 6),
    ]);
  });

  it("does not insert aligned inter-pair gap for alignedat environments", () => {
    const aligned = layoutTexMathList(parseTexMath(
      String.raw`\begin{aligned}a&=b&c&=d\\e&=f&g&=h\end{aligned}`
    ).list, { style: "display" });
    const alignedat = layoutTexMathList(parseTexMath(
      String.raw`\begin{alignedat}{2}a&=b&c&=d\\e&=f&g&=h\end{alignedat}`
    ).list, { style: "display" });

    expect(aligned.supported).toBe(true);
    expect(alignedat.supported).toBe(true);
    if (!aligned.supported || !alignedat.supported) {
      return;
    }
    expect(aligned.hlist.width).toBeCloseTo(58.815004, 6);
    expect(alignedat.hlist.width).toBeCloseTo(48.815004, 6);
    expect(aligned.hlist.width - alignedat.hlist.width).toBeCloseTo(10, 6);
  });

  it("creates display alignment boxes with nested split and gathered rows", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const cases = [
      {
        source: String.raw`\begin{align*} a&=b \begin{split} r&=s\\ & =t \end{split} \\ c&=d \end{align*}`,
        content: String.raw` a&=b \begin{split} r&=s\\ & =t \end{split} \\ c&=d `,
      },
      {
        source: String.raw`\begin{align*} a&=b \begin{gathered} r=s\\  =t \end{gathered} \\ c&=d \end{align*}`,
        content: String.raw` a&=b \begin{gathered} r=s\\  =t \end{gathered} \\ c&=d `,
      },
    ];

    for (const testCase of cases) {
      const box = provider.getDisplayMathAlignment?.({
        source: testCase.source,
        content: testCase.content,
        delimiter: "align-star",
        sourceStart: 0,
        sourceEnd: testCase.source.length,
        contentStart: testCase.source.indexOf(testCase.content),
        contentEnd: testCase.source.indexOf(testCase.content) + testCase.content.length,
        targetWidth: 180,
      });

      expect(box, testCase.source).not.toBeNull();
      expect(box?.rows, testCase.source).toHaveLength(2);
      expect(box?.rows[0]?.svgBody, testCase.source).toContain('data-tex-math-role="aligned-row"');
    }
  });

  it("applies multline shove commands to display row placement", () => {
    const source = String.raw`\begin{multline*}a\\\shoveleft b\\\shoveright c\end{multline*}`;
    const content = String.raw`a\\\shoveleft b\\\shoveright c`;
    const box = createTexDerivedInlineMathBoxProvider().getDisplayMathAlignment?.({
      source,
      content,
      delimiter: "multline-star",
      sourceStart: 0,
      sourceEnd: source.length,
      contentStart: source.indexOf("a"),
      contentEnd: source.indexOf(String.raw`\end{multline*}`),
      targetWidth: 120,
    });

    expect(box?.rows).toHaveLength(3);
    const rowLefts = box?.rows.map((row) => firstGlyphX(row.hlist?.items ?? []) ?? 0);
    expect(rowLefts?.[0]).toBeCloseTo(10, 6);
    expect(rowLefts?.[1]).toBeCloseTo(10, 6);
    expect(rowLefts?.[2]).toBeGreaterThan(100);
  });
});
