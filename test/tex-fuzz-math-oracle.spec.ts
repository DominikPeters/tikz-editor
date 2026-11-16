import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { caseFromTexFuzzAst, shrinkTexFuzzCase, TEX_FUZZ_MATH_SYMBOL_ORACLE_FORMULAS, TEX_FUZZ_MATH_LAYOUT_ORACLE_FORMULAS } from "@tikz-editor/tex-fuzz";
import { texFuzzMathOracleCases, compareTexFuzzMathOracle } from "../scripts/lib/tex-fuzz-math-oracle.mjs";

import { commandExists } from "../scripts/lib/tex-fuzz-oracle.mjs";

const caseData = caseFromTexFuzzAst([{ kind: "math", body: { kind: "fraction", command: "frac",
  numerator: { kind: "atom", value: "x" }, denominator: { kind: "atom", value: "y" } } }]);

describe("shared math glyph differential findings", () => {
  it.runIf(process.env.TEX_FUZZ_ORACLE_TESTS === "1" && commandExists("lualatex")).each([
    String.raw`\mathtt{\hat{/}}`,
    String.raw`\mathfrak{\begin{cases}\rVert&\infty\\{[}&2\end{cases}}`,
    ...["cases", "matrix", "pmatrix", "smallmatrix", "aligned", "array"].flatMap(environment =>
      ["mathfrak", "mathbf", "boldsymbol", "mathtt"].map(alphabet =>
        `\\${alphabet}{\\begin{${environment}}${environment === "array" ? "{cc}" : ""}X&2\\\\y&3\\end{${environment}}}`)),
    String.raw`\mathfrak{\begin{matrix}\mathfrak{X}&2\\y&\mathsf{3}\end{matrix}}`,
    String.raw`\mathfrak{\substack{X\\2}}`, String.raw`\boldsymbol{\substack{X\\2}}`,
    String.raw`\boldsymbol{\mathcal{\begin{matrix}X&2\\y&3\end{matrix}}}`,

    ...["ell", "partial", "alpha"].flatMap(glyph => [
      `\\tilde{{\\${glyph}}}`, `\\hat{{{\\${glyph}}}}`,
      `\\tilde{{\\${glyph}}}_i^2`,
    ]),
    String.raw`\tilde{{\ell x}}`, String.raw`\tilde{{\ell_i}}`,
    String.raw`\hat{\mathcal{X}}`, String.raw`\hat{{\mathcal{X}}}`,
    ...["mathcal", "mathbb", "mathfrak", "mathrm", "mathtt", "boldsymbol"].flatMap(alphabet => [
      `\\hat{\\${alphabet}{X}}_i^2`, `\\hat{{\\${alphabet}{X}}}_i^2`,
    ]),
    String.raw`\hat{\bm{x}}`, String.raw`\hat{{\bm{x}}}`,

    String.raw`\stackrel{\mathrm{\lvert}}{\widehat{\partial}}`,
    String.raw`\int\limits_0^1`,
    String.raw`\hat{\partial}_i^2`,
    ...["hat", "widehat", "bar", "vec"].flatMap(command => [
      `\\stackrel{x}{\\${command}{\\partial}}`,
      `\\underset{x}{\\${command}{\\partial}}`,
      `\\stackrel{x}{\\${command}{y}}`,
    ]),
    ...["mathtt", "mathsf", "mathit", "mathrm", "mathbf", "mathcal", "mathfrak", "mathbb"].flatMap(alphabet =>
      ["hat", "bar", "ddot"].map(command => `\\${alphabet}{\\${command}{X}}`)),
    String.raw`\mathfrak{\bar{X}}_i`, String.raw`\mathfrak{\bar{X}}^2`,
    String.raw`\mathtt{\vec{X}}`, String.raw`\mathbf{\vec{X}}`,
    ...["widehat", "widetilde"].flatMap(command => [
      `\\${command}{abc}+\\mathbb{R}`, `\\${command}{abcdef}+\\mathbb{R}`,
      `x_{\\${command}{abcdef}}+\\mathbb{R}`, `x_{y_{\\${command}{abcdef}}}+\\mathbb{R}`,
      `\\${command}{\\begin{matrix}A&B\\\\C&D\\end{matrix}}`,
      `\\${command}{\\begin{matrix}A&B\\\\C&D\\end{matrix}}+\\mathbb{R}`,
      `\\mathtt{\\${command}{abcdef}}+\\mathbb{R}`,
    ]),
    String.raw`\xrightarrow[{\begin{smallmatrix}\lim_{-}&\left\lbrace{}\|\right\rbrace&\stackrel{;}{\partial}\\\left\langle{}2\right\rangle&\mathbb{*}&\left\lbrace{}\mid\right\rbrace\end{smallmatrix}}]{\frac{\widehat{\begin{bmatrix}(&*&\beta\\b&\{&?\end{bmatrix}}}{{\xleftarrow[{y}]{\rvert}}^{\underbrace{\partial}}}}`,
    ...["mathtt", "mathrm", "mathbf", "mathsf", "mathcal", "mathfrak"].map(alphabet =>
      `\\stackrel{x}{\\${alphabet}{\\alpha}}`),
    ...["mathbf", "mathrm", "mathsf", "mathtt", "boldsymbol", "bm"].map(alphabet =>
      `\\stackrel{x}{\\${alphabet}{y}}`),
    String.raw`\stackrel{\left(y\right)}{\mathtt{\alpha}}`,
    String.raw`\stackrel{x}{{\mathtt{\alpha}}}`,
    String.raw`\stackrel{x}{\mathtt{\mathsf{y}}}`,
    String.raw`\stackrel{x}{\mathsf{;}}`,
    String.raw`\stackrel{x}{\mathrm{ab}}`,
    String.raw`\bigcup_{\mathsf{y}}`,
    String.raw`\bigcup_{\mathrm{y}}`,
    ...["mathtt", "mathbf", "mathrm", "mathsf", "boldsymbol", "bm"].flatMap(alphabet =>
      ["xrightarrow", "xleftarrow"].map(command => `\\${alphabet}{\\${command}{b}}`)),
    String.raw`\scriptstyle\bm{\xrightarrow{b}}`,
    String.raw`\bm{\xleftarrow[xy]{abcdef}}`,
    String.raw`\bm{x+\xrightarrow{b}+y}`,
    String.raw`\bm{\xrightarrow{\mathrm{b}}}`,
    String.raw`\mathtt{\xrightarrow[xy]{abcdef}}`,
    String.raw`\mathbf{\xleftarrow{\mathrm{b}}}`,
    String.raw`\mathbb{\underbrace{1}}`,
    ...["mathbb", "mathbf", "mathrm", "mathsf", "boldsymbol", "bm"].flatMap(alphabet =>
      ["underbrace", "overbrace"].map(command => `\\${alphabet}{\\${command}{a1}}`)),
    String.raw`\mathbb{\underbrace{\mathbb{1}}}`,
    String.raw`\mathrm{\overbrace{\mathbf{x}}}`,
    String.raw`\lim_{\begin{smallmatrix}/&\mid\\{*}&\lvert\end{smallmatrix}}`,
    String.raw`\begin{smallmatrix}a&b\\c&d\end{smallmatrix}`,
    String.raw`x_{\begin{smallmatrix}a&b\\c&d\end{smallmatrix}}`,
    String.raw`x^{y_{\begin{smallmatrix}a&b\\c&d\end{smallmatrix}}}`,
    String.raw`\frac{\prod_{!}}{\int}`, String.raw`\frac{\prod}{\int}`,
    String.raw`\frac{\sum_{!}}{\int}`,
    String.raw`\boldsymbol{\dfrac{+}{\ell}}`, String.raw`\boldsymbol{\tfrac{x}{y}}`,
    String.raw`\boldsymbol{x^2+y_i}`, String.raw`\boldsymbol{\sqrt{x_i}}`,
    String.raw`\boldsymbol{\hat{\ell}_i}`, String.raw`\boldsymbol{\mathrm{R}+\dfrac{1}{2}}`,
    String.raw`\frac{x}{y}+\boldsymbol{\frac{x}{y}}`,
    String.raw`\left|,\right|`, String.raw`\left(x,\right)`,
    String.raw`\left|,\quad\right|`, String.raw`\scriptstyle\left|,\right|`,
    String.raw`\sqrt[{b-,/\parallel-\alpha}]{\left|,\right|}`,
    String.raw`{\tilde{\lvert}}_{]}`, String.raw`\tilde\lvert_{]}`,
    String.raw`\hat{;}_{?}`, String.raw`\hat;_{?}`,
    String.raw`\hat{\parallel}_i`, String.raw`\hat\parallel_i`,
    String.raw`\hat{[}_i`, String.raw`\hat[_i`,
    String.raw`{\mathfrak{;}}_{?}`, String.raw`{\mathfrak{;}}_{{?}^{a}}`,
    String.raw`\stackrel{;}{\beta}`, String.raw`\overline{\stackrel{\parallel}{\partial}}`,
    String.raw`\begin{pmatrix}{y}_{.}&\xrightarrow{\ell}\\\stackrel{;}{\beta}&\Vert\\\sqrt[{\alpha}]{a}&y:<\end{pmatrix}`,
  ])(
    "matches hourly-soak math regression %s", async (content) => {
      await setImmediate();
      expect(compareTexFuzzMathOracle(caseFromTexFuzzAst([{ kind: "math", content }])), content)
        .toEqual({ compared: true, observation: null });
    }, 20_000
  );
  it.each([
    [String.raw`\(x^2\)`, "x^2"], ["$x^2$", "x^2"],
    [String.raw`\[x^2\]`, String.raw`\displaystyle x^2`], ["$$x^2$$", String.raw`\displaystyle x^2`],
  ])("compares the complete math body in %s", (source, expected) => {
    let actual = "";
    const candidate = { ...caseData, source };
    expect(compareTexFuzzMathOracle(candidate, { compare: formula => {
      actual = formula;
      return { ok: true, mismatches: [], ours: { supported: true } };
    } })).toEqual({ compared: true, observation: null });
    expect(actual).toBe(expected);
  });
  it.runIf(process.env.TEX_FUZZ_ORACLE_TESTS === "1" && commandExists("lualatex"))(
    "compares every original nightly math sample and its legacy array context", async () => {
      const cases = JSON.parse(readFileSync(new URL("./fixtures/tex-fuzz/ci-20261110-math-sample.json", import.meta.url), "utf8")) as typeof caseData[];
      expect(cases).toHaveLength(16);
      for (const candidate of cases) {
        await setImmediate();
        expect(compareTexFuzzMathOracle(candidate), candidate.source).toEqual({ compared: true, observation: null });
      }
      const original = JSON.parse(readFileSync(new URL("./fixtures/tex-fuzz/ci-20261110-math-glyph-trace.json", import.meta.url), "utf8")) as { case: typeof caseData; minimizedCase: typeof caseData };
      for (const candidate of [original.case, original.minimizedCase]) {
        await setImmediate();
        expect(compareTexFuzzMathOracle(candidate, { latexRelease: "2025-11-01" }), candidate.source).toEqual({ compared: true, observation: null });
      }
    }, 60_000
  );
  it.runIf(process.env.TEX_FUZZ_ORACLE_TESTS === "1" && commandExists("lualatex")).each([
    ...TEX_FUZZ_MATH_SYMBOL_ORACLE_FORMULAS, ...TEX_FUZZ_MATH_LAYOUT_ORACLE_FORMULAS,
  ])("matches mandatory symbol and layout regression %s", async (content) => {
    await setImmediate();
    const candidate = caseFromTexFuzzAst([{ kind: "math", content }]);
    expect(compareTexFuzzMathOracle(candidate), content).toEqual({ compared: true, observation: null });
  }, 20_000);
  it("selects actual nested syntax rather than replacing generated math with prose", () => {
    const owner = caseFromTexFuzzAst([{ kind: "font", command: "textbf", children: caseData.ast }]);
    const selected = texFuzzMathOracleCases([owner, owner], 8);
    expect(selected).toHaveLength(1);
    expect(selected[0].source).toBe(String.raw`$\frac{x}{y}$`);
    expect(selected[0].sourceMap.some((span) => span.kind === "math.atom")).toBe(true);
  });

  it("turns glyph displacement into a shared, shrinkable diagnostic", async () => {
    const compare = (formula: string) => ({ ok: !formula.includes("frac"),
      mismatches: formula.includes("frac") ? ["glyph 0 x differs: ours=1 tex=2"] : [], ours: { supported: true } });
    const result = compareTexFuzzMathOracle(caseData, { compare });
    expect(result).toMatchObject({ compared: true, observation: { fingerprint: {
      resultClass: "differential", code: "math-glyph-trace", mode: "math",
    } } });
    const shrunk = await shrinkTexFuzzCase(caseData, result.observation!, async (candidates) =>
      candidates.map((candidate) => compareTexFuzzMathOracle(candidate, { compare }).observation)
    );
    expect(shrunk.minimizedCase.source).toContain("frac");
  });

  it("preserves display style when selecting an equation for the math-list oracle", () => {
    const owner = caseFromTexFuzzAst([{ kind: "display-math", delimiter: "equation", content: String.raw`\sum_{i=1}^n i` }]);
    const [selected] = texFuzzMathOracleCases([owner], 1);
    expect(selected.source).toBe(String.raw`\[\sum_{i=1}^n i\]`);
    let comparedFormula = "";
    expect(compareTexFuzzMathOracle(selected, { compare: formula => {
      comparedFormula = formula;
      return { ok: true, mismatches: [], ours: { supported: true } };
    } })).toEqual({ compared: true, observation: null });
    expect(comparedFormula).toBe(String.raw`\displaystyle \sum_{i=1}^n i`);
  });

  it("records an incomparable oracle result without claiming a successful comparison", () => {
    const result = compareTexFuzzMathOracle(caseData, { compare: () => ({
      ok: false, mismatches: ["TeX oracle failed: timeout"], ours: { supported: true },
    }) });
    expect(result.compared).toBe(false);
    expect(result.observation?.detail?.comparable).toBe(false);
  });
  it.runIf(process.env.TEX_FUZZ_ORACLE_TESTS === "1" && commandExists("lualatex"))(
    "matches LuaLaTeX paint for short, long, empty, and nested arrow labels", async () => {
      const formulas = [
        String.raw`\xrightarrow[a]{a}`, String.raw`\xleftarrow[x]{1}`,
        String.raw`\dot{\xrightarrow[a]{a}}`, String.raw`\xleftarrow[\mathbf{rank}]{1-b}`,
        String.raw`\xrightarrow[xy]{abcdabcd}`, String.raw`\xleftarrow[xy]{abcdabcd}`,
        String.raw`\xrightarrow{}`, String.raw`\xleftarrow[]{}`, String.raw`\xrightarrow[a]{}`,
        String.raw`\scriptstyle\xrightarrow[a]{a}`, String.raw`x_{\xrightarrow[a^2]{a^2}}`,
        String.raw`\frac{1}{\xrightarrow[a^2]{a^2}}`,
      ];
      for (const content of formulas) {
        await setImmediate();
        const candidate = caseFromTexFuzzAst([{ kind: "math", content }]);
        const result = compareTexFuzzMathOracle(candidate);
        expect(result, content).toEqual({ compared: true, observation: null });
      }
    }, 30_000
  );

});
