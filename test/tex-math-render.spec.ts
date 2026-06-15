import { describe, expect, it } from "vitest";
import {
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph,
  layoutTexMathList,
  parseTexMath,
  renderTexMathHListSvgBody,
  resolveDefaultTexMathFontProfileForList,
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

  it("renders additional plain-TeX symbols and named operators through TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`\partial f+\nabla g+\sin x+\bullet+\lvert x\rvert+\lfloor y\rfloor+\colon+\Longrightarrow+\implies+\iff`);
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
  });

  it("renders AMS font symbols through their TeX glyph paths", () => {
    const parsed = parseTexMath(String.raw`\digamma+\dotplus+\ulcorner x\urcorner+\lesssim+\gtrsim`);
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
    expect(body).toContain('data-tex-font="cmr10" data-tex-glyph="46"');
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

  it("renders AMS left-right corner delimiters through fixed AMS glyphs", () => {
    const parsed = parseTexMath(String.raw`\left\ulcorner A\right\urcorner`);
    const result = layoutTexMathList(parsed.list);
    expect(result.supported).toBe(true);
    if (!result.supported) {
      return;
    }

    const body = renderTexMathHListSvgBody(result.hlist);
    expect(resolveDefaultTexMathFontProfileForList(parsed.list).id).toBe("lualatex-ams-math");
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="112"');
    expect(body).toContain('data-tex-font="msam10" data-tex-glyph="113"');
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
      String.raw`One $x+y=m+n$`,
      "two three.",
    ]);
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
    )).join("")).toBe("$x-y$");
    expect(mathAdvanceSegments[1]).toMatchObject({
      kind: "space",
      text: "",
      sourceStartRaw: source.indexOf("-") + 1,
      sourceEndRaw: source.indexOf("-") + 1,
      sourceKind: "math",
      width: 2.222229,
    });
    expect(mathSegments[0]).toMatchObject({
      sourceStartRaw: source.indexOf("$x-y$"),
      sourceEndRaw: source.indexOf("-") + 1,
      sourceKind: "math",
      mathSvgBody: expect.stringContaining('data-tex-math-fragment="true"'),
    });
    expect(mathSegments[1]).toMatchObject({
      sourceStartRaw: source.indexOf("-") + 1,
      sourceEndRaw: source.indexOf("$x-y$") + "$x-y$".length,
      sourceKind: "math",
      mathSvgBody: expect.stringContaining('data-tex-math-fragment="true"'),
    });
    expect(mathAdvanceSegments.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(23.199158, 6);
    expect(mathSegments[0]?.caretStops?.[0]).toBeCloseTo(mathSegments[0]?.x ?? 0, 6);
    expect(mathSegments[1]?.caretStops?.at(-1)).toBeCloseTo(
      (mathSegments[1]?.x ?? 0) + (mathSegments[1]?.width ?? 0),
      6
    );
    expect(mathSegments[0]?.mathSvgBody).toContain('data-tex-font="cmmi10" data-tex-glyph="120"');
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
      String.raw`Alpha $a+b=`,
      String.raw`c+d$ omega`,
    ]);
    const mathSegmentsByLine = result.report?.lines.map((line) =>
      line.segments.filter((segment) => segment.kind === "math")
    );
    expect(mathSegmentsByLine?.map((segments) =>
      segments.map((segment) =>
        source.slice(segment.sourceStartRaw ?? 0, segment.sourceEndRaw ?? 0)
      ).join("")
    )).toEqual([
      String.raw`$a+b=`,
      String.raw`c+d$`,
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

  it("uses explicit placeholders for numbered display math environments", () => {
    const source = String.raw`Alpha \begin{equation}x^2\end{equation} Beta \begin{align}a&=b\end{align} Gamma`;
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
    expect(placeholders).toHaveLength(2);
    expect(placeholders.map((item) => item.placeholderReason)).toEqual([
      "Numbered TeX display math is not implemented yet.",
      "Numbered TeX display math is not implemented yet.",
    ]);
    expect(placeholders.map((item) => item.sourceSpan)).toEqual([
      {
        start: source.indexOf(String.raw`\begin{equation}`),
        end: source.indexOf(String.raw`\end{equation}`) + String.raw`\end{equation}`.length,
      },
      {
        start: source.indexOf(String.raw`\begin{align}`),
        end: source.indexOf(String.raw`\end{align}`) + String.raw`\end{align}`.length,
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
});
