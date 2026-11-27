import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PGF_NUMBER_FORMAT,
  applyPgfNumberFormatOptions,
  formatPgfNumber,
  parsePgfFloat,
  pgfRoundTo
} from "../packages/core/src/semantic/pgfmath/number-format.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

/**
 * Fixture: `\pgfmathprintnumberto[options]{input}\result` run in LuaLaTeX
 * (PGF 3.1.10) for each case, `expected` = `\detokenize` of `\result`.
 * Regenerate with `node scripts/capture-pgf-number-format-oracle.mjs`.
 *
 * Normalisation before the exact string comparison:
 * - `\pgfutilensuremath {X}` (added unless `assume math mode`) is unwrapped to
 *   `X` and checked against `ensureMath`;
 * - the space `\detokenize` writes after a control word is dropped on both
 *   sides (`\cdot 10^{2}` and `\cdot10^{2}` are the same tokens);
 * - `\pgfmathfloatfrac@verbatim {a}{b}` (the `verbatim` style's `frac TeX`,
 *   which typesets `a/b`) is compared as `a/b`, which is what the module emits.
 * Braces are compared as they are.
 */
type Oracle = {
  pgfVersion: string;
  caseCount: number;
  groups: Array<{ options: string; cases: Array<[string, string, string?]> }>;
};

const oracle = JSON.parse(readFileSync(new URL("./fixtures/pgf-number-format/cases.json", import.meta.url), "utf8")) as Oracle;

function normalize(tex: string): string {
  return tex
    .replace(/(\\[A-Za-z@]+) /gu, "$1")
    .replace(/\\pgfmathfloatfrac@verbatim\{([^{}]*)\}\{([^{}]*)\}/gu, "$1/$2");
}

function unwrap(expected: string): { tex: string; ensureMath: boolean } {
  const match = /^\\pgfutilensuremath \{([\s\S]*)\}$/u.exec(expected);
  return match ? { tex: match[1] ?? "", ensureMath: true } : { tex: expected, ensureMath: false };
}

function format(input: string, options: string) {
  const applied = applyPgfNumberFormatOptions(DEFAULT_PGF_NUMBER_FORMAT, options);
  expect(applied.diagnostics).toEqual([]);
  return formatPgfNumber(input, applied.format);
}

describe("\\pgfmathprintnumber matches PGF (TeX oracle)", () => {
  it("has a substantial fixture from PGF 3.1.10", () => {
    expect(oracle.pgfVersion).toBe("3.1.10");
    expect(oracle.caseCount).toBeGreaterThan(1500);
    expect(oracle.groups.reduce((sum, group) => sum + group.cases.length, 0)).toBe(oracle.caseCount);
  });

  it.each(oracle.groups.map(group => [group.options === "" ? "(defaults)" : group.options, group] as const))("%s", (_name, group) => {
    const applied = applyPgfNumberFormatOptions(DEFAULT_PGF_NUMBER_FORMAT, group.options);
    expect(applied.diagnostics).toEqual([]);
    const mismatches: string[] = [];
    for (const [input, expected, texError] of group.cases) {
      const want = unwrap(expected);
      const got = formatPgfNumber(input, applied.format);
      if (normalize(got.tex) !== normalize(want.tex) || got.ensureMath !== want.ensureMath) {
        mismatches.push(`${input}: TeX ${JSON.stringify(expected)}, module ${JSON.stringify(got.tex)} (ensureMath ${got.ensureMath})`);
      }
      // TeX reported a parse error (and printed NaN): the module must diagnose it.
      if (texError !== undefined && !got.diagnostics.some(diagnostic => diagnostic.code === "invalid-number")) {
        mismatches.push(`${input}: TeX error ${texError} not diagnosed`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

function nodeTexts(source: string): { texts: string[]; diagnostics: string[]; usage: string | undefined } {
  const rendered = renderTikzToSvg(source);
  const texts = rendered.semantic.scene.elements.flatMap(element => element.kind === "Text" && element.text !== undefined ? [element.text] : []);
  return { texts, diagnostics: rendered.semantic.diagnostics.map(diagnostic => diagnostic.code ?? ""), usage: rendered.semantic.featureUsage.pgfmath_number_printing };
}

describe("\\pgfmathprintnumber in node text", () => {
  it("prints with the scoped /pgf/number format/ state from \\pgfkeys and \\tikzset", () => {
    const result = nodeTexts(String.raw`\begin{tikzpicture}
\pgfkeys{/pgf/number format/.cd,fixed,precision=1,use comma}
\pgfmathsetmacro{\v}{1234.56}
\node at (0,0) {\pgfmathprintnumber{\v}};
\begin{scope}
  \tikzset{/pgf/number format/precision=3}
  \node at (0,1) {$x=\pgfmathprintnumber[assume math mode]{3.14159}$};
\end{scope}
\node at (0,2) {\pgfmathprintnumber{3.14159}};
\node at (0,3) {\pgfmathprintnumber[sci,precision=2,use period]{0.00123}};
\end{tikzpicture}`);
    expect(result.texts).toEqual([
      "\\ensuremath{1.234{,}6}",
      "$x=3{,}142$",
      "\\ensuremath{3{,}1}",
      "\\ensuremath{1.23\\cdot10^{-3}}"
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(result.usage).toBe("used-supported");
  });

  it("reads a whole macro argument, macro bodies and \\pgfmathprintnumberto", () => {
    const result = nodeTexts(String.raw`\begin{tikzpicture}
\pgfmathsetmacro{\v}{2.5}
\newcommand\num[1]{\pgfmathprintnumber[frac]{#1}}
\node at (0,0) {\pgfmathprintnumber\v{} and \pgfmathprintnumberto[sci]{42}{\r}\r};
\node at (0,1) {\num{0.75}};
\end{tikzpicture}`);
    expect(result.texts).toEqual(["\\ensuremath{2.5}{} and \\ensuremath{4.2\\cdot10^{1}}", "\\ensuremath{\\frac{3}{4}}"]);
  });

  it("reports unknown number-format keys", () => {
    const result = nodeTexts(String.raw`\begin{tikzpicture}
\pgfkeys{/pgf/number format/no such key}
\node {\pgfmathprintnumber[bogus]{1}};
\end{tikzpicture}`);
    expect(result.texts).toEqual(["\\ensuremath{1}"]);
    expect(result.diagnostics).toEqual(["pgf-number-format-unknown-key", "pgfmathprintnumber-unknown-key"]);
  });
});

describe("number format module", () => {
  it("returns structured parts alongside the TeX", () => {
    const fixed = format("-1234567.891", "fixed,precision=2");
    expect(fixed.tex).toBe("-1{,}234{,}567.89");
    expect(fixed).toMatchObject({ kind: "fixed", sign: "-", integerDigits: "1234567", fractionDigits: "89", exponent: null, ensureMath: true });
    expect(fixed.parts.map(part => part.role)).toEqual(["sign", "integer", "thousands-separator", "integer", "thousands-separator", "integer", "decimal-separator", "fraction"]);

    const sci = format("0.0015", "sci");
    expect(sci.tex).toBe("1.5\\cdot10^{-3}");
    expect(sci).toMatchObject({ kind: "sci", sign: "", integerDigits: "1", fractionDigits: "5", exponent: "-3", mantissaShown: true });
    expect(sci.parts.at(-1)).toEqual({ role: "exponent", tex: "10^{-3}", value: "-3" });

    const unit = format("1000", "sci,retain unit mantissa=false");
    expect(unit).toMatchObject({ tex: "10^{3}", mantissaShown: false, integerDigits: "" });

    const half = format("2.5", "frac");
    expect(half.tex).toBe("2\\frac{1}{2}");
    expect(half.parts).toEqual([{ role: "frac-whole", tex: "2" }, { role: "frac", tex: "\\frac{1}{2}", value: "1/2" }]);
  });

  it("rounds digit strings, not doubles", () => {
    expect(pgfRoundTo("19999.9996", 2, false)).toEqual({ result: "20000", hasPeriod: false, mayNeedRenormalize: false });
    expect(pgfRoundTo("99.996", 2, false)).toEqual({ result: "100", hasPeriod: false, mayNeedRenormalize: true });
    expect(pgfRoundTo("9.96", 1, true)).toEqual({ result: "10.0", hasPeriod: true, mayNeedRenormalize: true });
    expect(pgfRoundTo("1.005", 2, false).result).toBe("1.01");
    expect(pgfRoundTo("-0.004", 2, true).result).toBe("0.00");
    expect(format("0.30000000000000004", "fixed,precision=16").tex).toBe("0.3");
    expect(format("123456789012345678901234567890.5", "fixed,precision=0,1000 sep={}").tex).toBe("123456789012345678901234567891");
    expect(formatPgfNumber(0.1 + 0.2).tex).toBe("0.3");
  });

  it("parses the inputs \\pgfmathprintnumber accepts", () => {
    expect(parsePgfFloat("1Y1.5e2]").float).toEqual({ flags: 1, mantissa: "1.5", exponent: 2 });
    expect(parsePgfFloat("-0.00120").float).toEqual({ flags: 2, mantissa: "1.2", exponent: -3 });
    expect(parsePgfFloat("100.5").float).toEqual({ flags: 1, mantissa: "1.005", exponent: 2 });
    expect(parsePgfFloat("-inf").float.flags).toBe(5);
    expect(parsePgfFloat("1,5", true).float).toEqual({ flags: 1, mantissa: "1.5", exponent: 0 });
    expect(parsePgfFloat("1,5").error).not.toBeNull();
    expect(formatPgfNumber(Number.NaN).tex).toBe("\\hbox{NaN}");
  });

  it("applies keys in order and reports unknown ones", () => {
    const later = applyPgfNumberFormatOptions(DEFAULT_PGF_NUMBER_FORMAT, "sci,fixed,precision=1,precision=3");
    expect(later.format).toMatchObject({ printer: "fixed", precision: 3 });
    const unknown = applyPgfNumberFormatOptions(DEFAULT_PGF_NUMBER_FORMAT, "fixed,no such key=1,/tikz/red");
    expect(unknown.format.printer).toBe("fixed");
    expect(unknown.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.key])).toEqual([["unknown-key", "no such key"], ["unknown-key", "/tikz/red"]]);
    const invalid = applyPgfNumberFormatOptions(DEFAULT_PGF_NUMBER_FORMAT, "precision=abc,showpos=maybe");
    expect(invalid.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["invalid-value", "invalid-value"]);
  });
});
