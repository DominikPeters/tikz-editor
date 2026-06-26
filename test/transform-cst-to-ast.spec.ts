import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import type { ScannedFigure } from "../packages/core/src/parser/figure-scan.js";
import { parseSyntax } from "@tikz-editor/lezer-tikz";
import { collectContextDefinitions, fromCst } from "../packages/core/src/transform/cst-to-ast.js";

describe("CST to AST transform edge cases", () => {
  it("recovers unterminated inline tikz options without fabricating option entries", () => {
    const parsed = parseTikz(String.raw`\tikz[draw \draw (0,0) -- (1,0);`, { recover: true });

    expect(parsed.activeFigureId).toBeNull();
    expect(parsed.figure.options).toBeUndefined();
    expect(parsed.figure.body.some((statement) => statement.kind === "Path")).toBe(true);
  });

  it("honors explicit context definitions when mapping an active figure", () => {
    const source = String.raw`\def\external{(1,0)}
\begin{tikzpicture}[baseline]
  \draw (0,0) -- \external;
\end{tikzpicture}`;
    const tree = parseSyntax(source);
    const contextDefinitions = collectContextDefinitions(String.raw`\def\external{(1,0)}`);
    const parsed = fromCst(tree, source, {
      activeFigureId: "figure:0",
      includeContextDefinitions: true,
      contextDefinitions
    });

    expect(parsed.figure.options?.entries.some((entry) => entry.kind === "flag" && entry.key === "baseline")).toBe(true);
    expect(parsed.figure.body[0]?.kind).toBe("MacroDefinition");
  });

  it("falls back to source scanning and masks stale scanned spans defensively", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const scanned = fromCst(parseSyntax(source), source);
    const fakeFigure: ScannedFigure = {
      span: { from: 0, to: 5 },
      beginSpan: { from: 0, to: 5 },
      endSpan: { from: 0, to: 5 },
      isTemplate: false
    };
    const stale = fromCst(parseSyntax("plain"), "plain", { scannedFigures: [fakeFigure] });

    expect(scanned.activeFigureId).toBe("figure:0");
    expect(stale.activeFigureId).toBe("figure:0");
    expect(stale.figure.body).toEqual([]);
  });

  it("keeps only syntactically complete visible macro context definitions", () => {
    const definitions = collectContextDefinitions(String.raw`
\def missingControl{ignored}
\def\missingBody
\let missingName\target
\let\grouped={target body}
\let\missingTarget
\newcommand
\newcommand{notControl}{ignored}
\newcommand{\missingCommandBody}
\newcommand*{\withOptional}[2][fallback]{#1/#2}
\DeclareMathOperator*{\argmax}{arg\,max}
{
  \providecommand{\hidden}{x}
}
\renewcommand{\visible}{y}`);

    const names = definitions.flatMap((statement) =>
      statement.kind === "MacroCommandDefinition" || statement.kind === "MacroDefinition" || statement.kind === "MacroAlias"
        ? [statement.nameRaw]
        : []
    );
    const optional = definitions.find(
      (statement) => statement.kind === "MacroCommandDefinition" && statement.nameRaw === "\\withOptional"
    );
    const operator = definitions.find(
      (statement) => statement.kind === "MacroCommandDefinition" && statement.nameRaw === "\\argmax"
    );

    expect(collectContextDefinitions("")).toEqual([]);
    expect(names).toEqual(expect.arrayContaining(["\\grouped", "\\withOptional", "\\argmax", "\\visible"]));
    expect(names).not.toContain("\\hidden");
    expect(optional?.kind).toBe("MacroCommandDefinition");
    if (optional?.kind === "MacroCommandDefinition") {
      expect(optional.starred).toBe(true);
      expect(optional.arity).toBe(2);
      expect(optional.optionalDefaultRaw).toBe("fallback");
    }
    expect(operator?.kind).toBe("MacroCommandDefinition");
    if (operator?.kind === "MacroCommandDefinition") {
      expect(operator.bodyRaw).toBe(String.raw`\operatorname*{arg\,max}`);
    }
  });

  it("keeps only syntactically complete visible color context definitions", () => {
    const definitions = collectContextDefinitions(String.raw`
\colorlet
\colorlet{missingValue}
\definecolor
\definecolor{missingModel}
\definecolor{missingSpecification}{RGB}
\colorlet{accent}{blue}
\definecolor{brand}{HTML}{1A2B3C}
\begingroup
  \colorlet{hidden}{red}
\endgroup
\begin{scope}
  \definecolor{alsohidden}{RGB}{1,2,3}
\end{scope}`);

    expect(definitions.flatMap((statement) => (statement.kind === "Colorlet" ? [statement.nameRaw] : []))).toEqual(["accent"]);
    expect(definitions.flatMap((statement) => (statement.kind === "DefineColor" ? [statement.nameRaw] : []))).toEqual(["brand"]);
  });
});
