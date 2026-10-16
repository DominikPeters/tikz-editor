import { describe, expect, it } from "vitest";
import { createIdentityMappedText, projectInputRange } from "../packages/core/src/text/source-map.js";
import { parseScientificNumber, parseUnitExpression, projectBeamerScientificNotation } from "../packages/core/src/beamer/package-notation.js";
import { projectBeamerPreformatted } from "../packages/core/src/beamer/preformatted.js";
import { parseTexMath } from "../packages/core/src/text/tex/math/parser.js";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { buildNativeBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { projectBeamerCaptions } from "../packages/core/src/beamer/captions.js";
import type { Diagnostic } from "../packages/core/src/diagnostics/types.js";

describe("bounded scientific notation", () => {
  it("parses decimal/scientific numbers and preserves unit factor ownership", () => {
    expect(parseScientificNumber("1e0")).toEqual({ mantissa: "1" });
    expect(parseScientificNumber("6.67e-5")).toEqual({ mantissa: "6.67", exponent: "-5" });
    for (const number of ["1.2(3)", "10000", "+2", "001.2", "-0", ".5", "1.23456"]) expect(parseScientificNumber(number)).toBeNull();
    for (const unit of [String.raw`\metre\per`, String.raw`\metre\per\squared`, String.raw`\micro\metre`]) expect(parseUnitExpression(unit)).toBeNull();
    const source = String.raw`\milli\metre\squared\per\second\pascal`;
    const factors = parseUnitExpression(source)!;
    expect(factors.map(factor => [factor.symbol, factor.power])).toEqual([["mm", 2], ["s", -1], ["Pa", 1]]);
    expect(factors.map(factor => source.slice(factor.span.from, factor.span.to))).toEqual([String.raw`\milli\metre\squared`, String.raw`\second`, String.raw`\pascal`]);
  });
  it("retains direct numeric input and diagnoses unsupported options without consuming neighboring content", () => {
    const source = String.raw`$x=\SI{6.67e-5}{\metre\squared\per\second}$`;
    const diagnostics: Diagnostic[] = [];
    const projected = projectBeamerScientificNotation(createIdentityMappedText(source, 100), diagnostics);
    const from = projected.text.indexOf("6");
    expect(projectInputRange(projected.sourceMap, from, from + 1)).toEqual(expect.objectContaining({ kind: "source-range", from: 100 + source.indexOf("6") }));
    expect(diagnostics).toEqual([]);
    const unsupported = String.raw`\SI[per-mode=symbol]{1}{\metre\per\second}`;
    expect(projectBeamerScientificNotation(createIdentityMappedText(unsupported), diagnostics).text).toBe(unsupported);
    expect(diagnostics.map(item => item.code)).toEqual(["beamer-siunitx-unsupported"]);
  });
  it("owns generated unit glyphs by their authored factor and respects scoped package configuration", () => {
    const source = String.raw`\SI{2}{\milli\metre}`;
    const projected = projectBeamerScientificNotation(createIdentityMappedText(source), []);
    const glyph = projected.text.indexOf(String.raw`\textnormal{m}`);
    expect(projectInputRange(projected.sourceMap, glyph, glyph + 1)).toMatchObject({ kind: "source-range", from: source.indexOf(String.raw`\milli`), to: source.lastIndexOf("}") });
    for (const config of [String.raw`\usepackage[locale=DE]{siunitx}`, String.raw`\sisetup{per-mode=symbol}`]) {
      const diagnostics: Diagnostic[] = [];
      const full = config + source;
      expect(projectBeamerScientificNotation(createIdentityMappedText(source, config.length), diagnostics, full).text).toBe(source);
      expect(diagnostics.map(item => item.code)).toEqual(["beamer-siunitx-unsupported"]);
    }
    const earlier = String.raw`{\sisetup{locale=DE}}`;
    const diagnostics: Diagnostic[] = [];
    expect(projectBeamerScientificNotation(createIdentityMappedText(source, earlier.length), diagnostics, earlier + source).text).not.toBe(source);
    expect(diagnostics).toEqual([]);
  });

});

describe("Dirac notation", () => {
  it.each([String.raw`\ket0`, String.raw`\ket\psi`, String.raw`\bra{\phi}A\ket{\psi}`, String.raw`\braket{a|b}`, String.raw`\Ket{\frac ab}`])("parses %s and retains original source spans", source => {
    const result = parseTexMath(source, { sourceOffset: 50 });
    expect(result.diagnostics).toEqual([]);
    expect(result.list.sourceSpan).toEqual({ start: 50, end: 50 + source.length });
  });
});

describe("preformatted source boundaries", () => {
  it("treats listing TeX-like source as literal code and retains alltt controls", () => {
    const source = String.raw`\lstset{columns=fullflexible,basicstyle=\ttfamily}\begin{lstlisting}
\note{private} # $ x_y {z}
\end{lstlisting}`;
    const from = source.indexOf(String.raw`\begin`);
    const diagnostics: Diagnostic[] = [];
    const listing = projectBeamerPreformatted(createIdentityMappedText(source.slice(from), from), source, diagnostics);
    expect(listing.text).not.toContain(String.raw`\note{private}`);
    expect(listing.text).toContain(String.raw`\textbackslash`);
    expect(diagnostics).toEqual([]);
    const alltt = String.raw`\begin{alltt}
\textbf{strong} $ % _
\end{alltt}`;
    const projected = projectBeamerPreformatted(createIdentityMappedText(alltt), alltt, diagnostics);
    expect(projected.text).toContain(String.raw`\textbf{strong}`);
    expect(projected.text).toContain(String.raw`\%`);
  });
  it("keeps unsupported listing options visible and diagnoses the package boundary", async () => {
    const source = String.raw`\documentclass{beamer}\usepackage{listings}\begin{document}\begin{frame}[fragile]
\begin{lstlisting}[numbers=left]
print(1)
\end{lstlisting}\end{frame}\end{document}`;
    const page = await prepareBeamerDocument(source).renderFrame();
    expect(page.diagnostics.map(item => item.code)).toContain("beamer-listings-unsupported-options");
  });
  it.each(["keepspaces=false", "language=Java", "numbers=left", String.raw`basicstyle=\rmfamily`, String.raw`keywordstyle=\unknown`])("diagnoses unsupported %s", option => {
    const source = String.raw`\lstset{columns=fullflexible,basicstyle=\ttfamily,` + option + String.raw`}\begin{lstlisting}
x
\end{lstlisting}`;
    const start = source.indexOf(String.raw`\begin`);
    const diagnostics: Diagnostic[] = [];
    const literal = source.slice(start);
    expect(projectBeamerPreformatted(createIdentityMappedText(literal, start), source, diagnostics).text).toBe(literal);
    expect(diagnostics.map(item => item.code)).toEqual(["beamer-listings-unsupported-options"]);
  });
  it("keeps a literal note command visible and retains ownership of escaped code characters", async () => {
    const source = String.raw`\documentclass{beamer}\usepackage{listings}\lstset{columns=fullflexible,basicstyle=\ttfamily}\begin{document}\begin{frame}[fragile]
\begin{lstlisting}
\note{literal} # $ ^ _ & % ~
\end{lstlisting}
\end{frame}\end{document}`;
    const page = await prepareBeamerDocument(source).renderFrame();
    expect(page.diagnostics).toEqual([]);
    const trace = buildNativeBeamerPageTrace(page, computerModernTexMetricProvider);
    expect(trace.lines.some(line => line.text.includes("literal"))).toBe(true);
    expect(trace.glyphs.some(glyph => glyph.code === 92)).toBe(true);
    const from = source.indexOf(String.raw`\begin{lstlisting}`), to = source.indexOf(String.raw`\end{frame}`);
    const mapped = projectBeamerPreformatted(createIdentityMappedText(source.slice(from, to), from), source, []);
    const escaped = mapped.text.indexOf(String.raw`\#`);
    expect(projectInputRange(mapped.sourceMap, escaped, escaped + 2)).toMatchObject({ kind: "source-range", from: source.indexOf("#"), to: source.indexOf("#") + 1 });
  });

});


describe("subfigure boundaries", () => {
  it.each(["[t]", "[c]"])("diagnoses unsupported alignment %s", alignment => {
    const source = String.raw`\usepackage{subcaption}\begin{figure}\begin{subfigure}` + alignment + String.raw`{.4\textwidth}\rule{20pt}{10pt}\caption{Panel}\end{subfigure}\end{figure}`;
    const diagnostics: Diagnostic[] = [];
    const projected = projectBeamerCaptions(createIdentityMappedText(source), source, undefined, { widthPt: 100, measure: () => 10, diagnostics });
    expect(diagnostics.map(item => item.code)).toEqual(["beamer-subfigure-unsupported"]);
    expect(projected.text).toContain(String.raw`\begin{subfigure}`);
  });
});
