import { describe, expect, it } from "vitest";
import {
  parseTexMath,
  tokenizeTexMath,
  type TexMathAtom,
} from "../packages/core/src/text/tex/index.js";

function atomAt(result: ReturnType<typeof parseTexMath>, index: number): TexMathAtom {
  const item = result.list.items[index];
  expect(item?.kind).toBe("atom");
  return item as TexMathAtom;
}

describe("TeX math parser", () => {
  it("tokenizes commands, groups, and scripts with source offsets", () => {
    const tokens = tokenizeTexMath(String.raw`\frac{x_1}{y^2}`, 20);

    expect(tokens.map((token) => token.kind)).toEqual([
      "command",
      "group-open",
      "character",
      "subscript",
      "character",
      "group-close",
      "group-open",
      "character",
      "superscript",
      "character",
      "group-close",
    ]);
    expect(tokens[0]).toMatchObject({
      text: String.raw`\frac`,
      sourceSpan: { start: 20, end: 25 },
    });
    expect(tokens.at(-1)?.sourceSpan).toEqual({ start: 34, end: 35 });
  });

  it("parses glyph atoms and attaches TeX-style scripts to the preceding atom", () => {
    const result = parseTexMath("x_i^2", { sourceOffset: 7 });
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(result.list.sourceSpan).toEqual({ start: 7, end: 12 });
    expect(atom).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 7, end: 12 },
      nucleus: { kind: "glyph", text: "x", sourceSpan: { start: 7, end: 8 } },
      subscript: { sourceSpan: { start: 8, end: 10 } },
      superscript: { sourceSpan: { start: 10, end: 12 } },
    });
    expect(atom.subscript?.list.items[0]).toMatchObject({
      kind: "atom",
      nucleus: { kind: "glyph", text: "i" },
    });
  });

  it("parses grouped lists as ordinary atoms", () => {
    const result = parseTexMath("{x+y}^2");
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(atom).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 0, end: 7 },
      nucleus: { kind: "list", sourceSpan: { start: 0, end: 5 } },
      superscript: { sourceSpan: { start: 5, end: 7 } },
    });
    expect(atom.nucleus.kind === "list" ? atom.nucleus.list.items : []).toHaveLength(3);
  });

  it("parses fractions and radicals into structured nuclei", () => {
    const result = parseTexMath(String.raw`\frac{x}{\sqrt{y}}`);
    const fraction = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(fraction.atomClass).toBe("ord");
    expect(fraction.nucleus.kind).toBe("fraction");
    if (fraction.nucleus.kind !== "fraction") {
      return;
    }
    expect(fraction.nucleus.numerator.items).toHaveLength(1);
    expect(fraction.nucleus.denominator.items).toHaveLength(1);
    expect(fraction.nucleus.sourceSpan).toEqual({ start: 0, end: 18 });
    expect(fraction.nucleus.denominator.items[0]).toMatchObject({
      kind: "atom",
      nucleus: { kind: "radical", sourceSpan: { start: 9, end: 17 } },
    });
  });

  it("parses dfrac and tfrac as style-forced generalized fractions", () => {
    const result = parseTexMath(String.raw`\dfrac{x}{y}+\tfrac{1}{2}`, { sourceOffset: 12 });

    expect(result.diagnostics).toEqual([]);
    const displayFraction = atomAt(result, 0);
    expect(displayFraction).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 12, end: 24 },
      nucleus: {
        kind: "fraction",
        style: "display",
        sourceSpan: { start: 12, end: 24 },
      },
    });
    const textFraction = atomAt(result, 2);
    expect(textFraction).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 25, end: 37 },
      nucleus: {
        kind: "fraction",
        style: "text",
        sourceSpan: { start: 25, end: 37 },
      },
    });
  });

  it("parses amsmath cfrac with TeX optional numerator alignment", () => {
    const result = parseTexMath(String.raw`\cfrac{a}{bbb}+\cfrac[l]{a}{bbb}+\cfrac[r]{a}{bbb}+\cfrac[c]{a}{bbb}`);

    expect(result.diagnostics).toEqual([]);
    const fractions = result.list.items.filter((item) =>
      item.kind === "atom" && item.nucleus.kind === "fraction"
    );
    expect(fractions.map((item) =>
      item.kind === "atom" && item.nucleus.kind === "fraction"
        ? {
            sourceSpan: item.sourceSpan,
            style: item.nucleus.style,
            alignment: item.nucleus.continued?.numeratorAlignment,
          }
        : null
    )).toEqual([
      { sourceSpan: { start: 0, end: 14 }, style: "display", alignment: "center" },
      { sourceSpan: { start: 15, end: 32 }, style: "display", alignment: "left" },
      { sourceSpan: { start: 33, end: 50 }, style: "display", alignment: "right" },
      { sourceSpan: { start: 51, end: 68 }, style: "display", alignment: "center" },
    ]);
  });

  it("parses binomial commands as TeX generalized fractions", () => {
    const source = String.raw`\binom{n}{k}+\dbinom{n}{k}+\tbinom{n}{k}`;
    const result = parseTexMath(source, { sourceOffset: 4 });

    expect(result.diagnostics).toEqual([]);
    expect(result.list.items).toHaveLength(5);

    const binom = atomAt(result, 0);
    expect(binom).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 4, end: 16 },
      nucleus: {
        kind: "fraction",
        leftDelimiter: "(",
        rightDelimiter: ")",
        ruleThickness: 0,
        sourceSpan: { start: 4, end: 16 },
      },
    });
    if (binom.nucleus.kind !== "fraction") {
      return;
    }
    expect(binom.nucleus.style).toBeUndefined();
    expect(binom.nucleus.numerator.sourceSpan).toEqual({ start: 11, end: 12 });
    expect(binom.nucleus.denominator.sourceSpan).toEqual({ start: 14, end: 15 });

    const dbinom = atomAt(result, 2);
    expect(dbinom).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 17, end: 30 },
      nucleus: {
        kind: "fraction",
        style: "display",
        leftDelimiter: "(",
        rightDelimiter: ")",
        ruleThickness: 0,
      },
    });

    const tbinom = atomAt(result, 4);
    expect(tbinom).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 31, end: 44 },
      nucleus: {
        kind: "fraction",
        style: "text",
        leftDelimiter: "(",
        rightDelimiter: ")",
        ruleThickness: 0,
      },
    });
  });

  it("parses amsmath genfrac as a prefix generalized fraction", () => {
    const source = String.raw`\genfrac{[}{]}{0pt}{3}{a}{b}+\genfrac{}{}{}{2}{x}{y}`;
    const result = parseTexMath(source, { sourceOffset: 5 });

    expect(result.diagnostics).toEqual([]);
    const delimited = atomAt(result, 0);
    expect(delimited).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 5, end: 33 },
      nucleus: {
        kind: "fraction",
        leftDelimiter: "[",
        rightDelimiter: "]",
        ruleThickness: 0,
        style: "scriptscript",
        sourceSpan: { start: 5, end: 33 },
      },
    });
    if (delimited.nucleus.kind !== "fraction") {
      return;
    }
    expect(delimited.nucleus.numerator.sourceSpan).toEqual({ start: 28, end: 29 });
    expect(delimited.nucleus.denominator.sourceSpan).toEqual({ start: 31, end: 32 });

    const plain = atomAt(result, 2);
    expect(plain).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 34, end: 57 },
      nucleus: {
        kind: "fraction",
        style: "script",
        sourceSpan: { start: 34, end: 57 },
      },
    });
    if (plain.nucleus.kind !== "fraction") {
      return;
    }
    expect(plain.nucleus.leftDelimiter).toBeUndefined();
    expect(plain.nucleus.rightDelimiter).toBeUndefined();
    expect(plain.nucleus.ruleThickness).toBeUndefined();
  });

  it("keeps invalid genfrac rule dimensions explicit", () => {
    const result = parseTexMath(String.raw`\genfrac{[}{]}{1em}{0}{a}{b}`);

    expect(result.diagnostics).toContainEqual({
      severity: "error",
      code: "invalid-tex-dimension",
      message: String.raw`Unsupported or invalid TeX dimension for \genfrac rule thickness.`,
      sourceSpan: { start: 15, end: 18 },
    });
  });

  it("parses genfrac style numbers like amsmath", () => {
    const fallbackStyle = atomAt(parseTexMath(String.raw`\genfrac{[}{]}{0pt}{4}{a}{b}`), 0);
    expect(fallbackStyle).toMatchObject({
      nucleus: {
        kind: "fraction",
        style: "scriptscript",
      },
    });

    const invalidStyle = parseTexMath(String.raw`\genfrac{[}{]}{0pt}{x}{a}{b}`);
    expect(invalidStyle.diagnostics).toContainEqual({
      severity: "error",
      code: "invalid-math-style",
      message: String.raw`Bad math style for \genfrac.`,
      sourceSpan: { start: 20, end: 21 },
    });
  });

  it("reports TeX-like errors for invalid genfrac delimiters", () => {
    const invalidDelimiter = parseTexMath(String.raw`\genfrac{(}{a}{}{2}{1}{2}`);
    expect(invalidDelimiter.diagnostics).toContainEqual({
      severity: "error",
      code: "missing-delimiter",
      message: String.raw`Missing or unrecognized delimiter for \genfrac.`,
      sourceSpan: { start: 12, end: 13 },
    });
  });

  it("parses TeX infix over as a generalized fraction over the current list", () => {
    const source = String.raw`a+b \over c+d`;
    const result = parseTexMath(source, { sourceOffset: 7 });
    const fraction = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(result.list.items).toHaveLength(1);
    expect(fraction).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 7, end: 20 },
      nucleus: {
        kind: "fraction",
        sourceSpan: { start: 7, end: 20 },
      },
    });
    if (fraction.nucleus.kind !== "fraction") {
      return;
    }
    expect(fraction.nucleus.numerator.sourceSpan).toEqual({ start: 7, end: 10 });
    expect(fraction.nucleus.numerator.items).toHaveLength(3);
    expect(fraction.nucleus.denominator.sourceSpan).toEqual({ start: 17, end: 20 });
    expect(fraction.nucleus.denominator.items).toHaveLength(3);
  });

  it("parses TeX zero-rule infix fractions and delimited variants", () => {
    const choose = atomAt(parseTexMath(String.raw`n \choose k`), 0);
    const atop = atomAt(parseTexMath(String.raw`a \atop b`), 0);
    const brack = atomAt(parseTexMath(String.raw`n \brack k`), 0);
    const brace = atomAt(parseTexMath(String.raw`n \brace k`), 0);
    const overWithDelims = atomAt(parseTexMath(String.raw`1 \overwithdelims [ ] 2`), 0);
    const atopWithDelims = atomAt(parseTexMath(String.raw`1 \atopwithdelims \lbrace \rbrace 2`), 0);

    expect(choose.nucleus).toMatchObject({
      kind: "fraction",
      leftDelimiter: "(",
      rightDelimiter: ")",
      ruleThickness: 0,
    });
    expect(atop.nucleus).toMatchObject({
      kind: "fraction",
      ruleThickness: 0,
    });
    expect(brack.nucleus).toMatchObject({
      kind: "fraction",
      leftDelimiter: "[",
      rightDelimiter: "]",
      ruleThickness: 0,
    });
    expect(brace.nucleus).toMatchObject({
      kind: "fraction",
      leftDelimiter: "lbrace",
      rightDelimiter: "rbrace",
      ruleThickness: 0,
    });
    expect(overWithDelims.nucleus).toMatchObject({
      kind: "fraction",
      leftDelimiter: "[",
      rightDelimiter: "]",
    });
    expect(atopWithDelims.nucleus).toMatchObject({
      kind: "fraction",
      leftDelimiter: "lbrace",
      rightDelimiter: "rbrace",
      ruleThickness: 0,
    });
  });

  it("parses TeX above infix fractions with absolute rule dimensions", () => {
    const above = atomAt(parseTexMath(String.raw`a \above 1pt b`), 0);
    const aboveWithDelims = atomAt(parseTexMath(String.raw`a \abovewithdelims [ ] 0.5pt b`), 0);
    const converted = atomAt(parseTexMath(String.raw`a \above 1in b`), 0);

    expect(above).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 0, end: 14 },
      nucleus: {
        kind: "fraction",
        ruleThickness: 1,
        numerator: { sourceSpan: { start: 0, end: 1 } },
        denominator: { sourceSpan: { start: 13, end: 14 } },
      },
    });
    expect(aboveWithDelims.nucleus).toMatchObject({
      kind: "fraction",
      leftDelimiter: "[",
      rightDelimiter: "]",
      ruleThickness: 0.5,
    });
    expect(converted.nucleus).toMatchObject({
      kind: "fraction",
      ruleThickness: 72.27,
    });
  });

  it("keeps unsupported relative TeX dimensions explicit", () => {
    const result = parseTexMath(String.raw`a \above 1em b`);

    expect(result.diagnostics).toContainEqual({
      severity: "error",
      code: "invalid-tex-dimension",
      message: String.raw`Unsupported or invalid TeX dimension for above rule thickness.`,
      sourceSpan: { start: 9, end: 12 },
    });
  });

  it("keeps infix fractions scoped to their containing group or script", () => {
    const result = parseTexMath(String.raw`X_{n \choose k}+1`);
    const base = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(result.list.items).toHaveLength(3);
    expect(base.subscript?.list.items).toHaveLength(1);
    const subscriptFraction = base.subscript?.list.items[0];
    expect(subscriptFraction).toMatchObject({
      kind: "atom",
      sourceSpan: { start: 3, end: 14 },
      nucleus: {
        kind: "fraction",
        numerator: { sourceSpan: { start: 3, end: 4 } },
        denominator: { sourceSpan: { start: 13, end: 14 } },
      },
    });
  });

  it("reports ambiguous repeated TeX infix fractions in the same list", () => {
    const result = parseTexMath(String.raw`1 \over 2 \over 3`);
    const fraction = atomAt(result, 0);

    expect(result.diagnostics).toContainEqual({
      severity: "error",
      code: "ambiguous-infix-fraction",
      message: String.raw`Ambiguous use of \over.`,
      sourceSpan: { start: 10, end: 15 },
    });
    expect(fraction.nucleus).toMatchObject({
      kind: "fraction",
    });
    if (fraction.nucleus.kind !== "fraction") {
      return;
    }
    expect(fraction.nucleus.denominator.items).toHaveLength(3);
  });

  it("parses math accents with braced and single-atom bases", () => {
    const result = parseTexMath(String.raw`\hat{x}+\vec y+\dddot z+\ddddot{1}`);
    const hat = atomAt(result, 0);
    const vec = atomAt(result, 2);
    const tripleDot = atomAt(result, 4);
    const quadrupleDot = atomAt(result, 6);

    expect(result.diagnostics).toEqual([]);
    expect(hat).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 0, end: 7 },
      nucleus: {
        kind: "accent",
        command: "hat",
        commandSourceSpan: { start: 0, end: 4 },
        sourceSpan: { start: 0, end: 7 },
      },
    });
    expect(hat.nucleus.kind === "accent" ? hat.nucleus.base.sourceSpan : null).toEqual({ start: 5, end: 6 });
    expect(vec).toMatchObject({
      sourceSpan: { start: 8, end: 14 },
      nucleus: {
        kind: "accent",
        command: "vec",
        commandSourceSpan: { start: 8, end: 12 },
      },
    });
    expect(vec.nucleus.kind === "accent" ? vec.nucleus.base.sourceSpan : null).toEqual({ start: 13, end: 14 });
    expect(tripleDot).toMatchObject({
      sourceSpan: { start: 15, end: 23 },
      nucleus: {
        kind: "accent",
        command: "dddot",
        commandSourceSpan: { start: 15, end: 21 },
      },
    });
    expect(tripleDot.nucleus.kind === "accent" ? tripleDot.nucleus.base.sourceSpan : null).toEqual({ start: 22, end: 23 });
    expect(quadrupleDot).toMatchObject({
      sourceSpan: { start: 24, end: 34 },
      nucleus: {
        kind: "accent",
        command: "ddddot",
        commandSourceSpan: { start: 24, end: 31 },
      },
    });
    expect(quadrupleDot.nucleus.kind === "accent" ? quadrupleDot.nucleus.base.sourceSpan : null).toEqual({ start: 32, end: 33 });
  });

  it("parses overline and underline as structured line nuclei", () => {
    const result = parseTexMath(String.raw`\overline{x}+\underline y`, { sourceOffset: 30 });
    const overline = atomAt(result, 0);
    const underline = atomAt(result, 2);

    expect(result.diagnostics).toEqual([]);
    expect(overline).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 30, end: 42 },
      nucleus: {
        kind: "line",
        command: "overline",
        commandSourceSpan: { start: 30, end: 39 },
        sourceSpan: { start: 30, end: 42 },
      },
    });
    expect(overline.nucleus.kind === "line" ? overline.nucleus.body.sourceSpan : null).toEqual({ start: 40, end: 41 });
    expect(underline).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 43, end: 55 },
      nucleus: {
        kind: "line",
        command: "underline",
        commandSourceSpan: { start: 43, end: 53 },
      },
    });
    expect(underline.nucleus.kind === "line" ? underline.nucleus.body.sourceSpan : null).toEqual({ start: 54, end: 55 });
  });

  it("parses ellipsis commands as inner punctuation lists", () => {
    const result = parseTexMath(String.raw`\ldots+\cdots+\dots`, { sourceOffset: 5 });

    expect(result.diagnostics).toEqual([]);
    expect(result.list.items).toHaveLength(5);

    const ldots = atomAt(result, 0);
    expect(ldots).toMatchObject({
      atomClass: "inner",
      sourceSpan: { start: 5, end: 11 },
      nucleus: {
        kind: "list",
        role: "ellipsis",
        ellipsisCommand: "ldots",
        sourceSpan: { start: 5, end: 11 },
      },
    });
    expect(ldots.nucleus.kind === "list" ? ldots.nucleus.list.items : []).toMatchObject([
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: "." } },
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: "." } },
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: "." } },
    ]);

    const cdots = atomAt(result, 2);
    expect(cdots).toMatchObject({
      atomClass: "inner",
      sourceSpan: { start: 12, end: 18 },
      nucleus: {
        kind: "list",
        role: "ellipsis",
        ellipsisCommand: "cdots",
      },
    });
    expect(cdots.nucleus.kind === "list" ? cdots.nucleus.list.items : []).toMatchObject([
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: String.raw`\cdot` } },
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: String.raw`\cdot` } },
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: String.raw`\cdot` } },
    ]);

    const dots = atomAt(result, 4);
    expect(dots).toMatchObject({
      atomClass: "inner",
      sourceSpan: { start: 19, end: 24 },
      nucleus: {
        kind: "list",
        role: "ellipsis",
        ellipsisCommand: "dots",
      },
    });
    expect(dots.nucleus.kind === "list" ? dots.nucleus.list.items : []).toMatchObject([
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: "." } },
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: "." } },
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: "." } },
      { kind: "glue", command: "," },
    ]);

    const contextual = atomAt(parseTexMath(String.raw`\dots+1`), 0);
    expect(contextual.nucleus.kind === "list" ? contextual.nucleus.list.items : []).toMatchObject([
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: String.raw`\cdot` } },
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: String.raw`\cdot` } },
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: String.raw`\cdot` } },
    ]);

    const alignmentBoundary = atomAt(parseTexMath(String.raw`\begin{aligned}\dots&1\end{aligned}`), 0);
    const alignmentRows = alignmentBoundary.nucleus.kind === "aligned"
      ? alignmentBoundary.nucleus.rows
      : [];
    const alignmentDots = alignmentRows[0]?.cells[0]?.list.items[0];
    expect(
      alignmentDots?.kind === "atom" && alignmentDots.nucleus.kind === "list"
        ? alignmentDots.nucleus.list.items
        : []
    ).toHaveLength(3);

    const comma = atomAt(parseTexMath(String.raw`\dots,1`), 0);
    expect(comma.nucleus.kind === "list" ? comma.nucleus.list.items : []).toMatchObject([
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: "." } },
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: "." } },
      { kind: "atom", atomClass: "punct", nucleus: { kind: "glyph", text: "." } },
    ]);
    expect(comma.nucleus.kind === "list" ? comma.nucleus.list.items : []).toHaveLength(3);

    const displayTerminal = atomAt(parseTexMath(String.raw`\dots`, {
      suppressTerminalEllipsisGlue: true,
    }), 0);
    expect(displayTerminal.nucleus.kind === "list" ? displayTerminal.nucleus.list.items : []).toHaveLength(3);

    const accentedTerminal = atomAt(parseTexMath(String.raw`\bar\dots`), 0);
    const accentedBase = accentedTerminal.nucleus.kind === "accent"
      ? accentedTerminal.nucleus.base.items[0]
      : null;
    expect(
      accentedBase?.kind === "atom" && accentedBase.nucleus.kind === "list"
        ? accentedBase.nucleus.list.items
        : []
    ).toHaveLength(3);
  });

  it("parses amsmath substack rows as a structured centered one-column array", () => {
    const result = parseTexMath(String.raw`\sum_{\substack{i=1\\j=2}}^n`);
    const sum = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(sum.subscript?.list.items).toHaveLength(1);
    const substack = sum.subscript?.list.items[0];
    expect(substack).toMatchObject({
      kind: "atom",
      atomClass: "ord",
      sourceSpan: { start: 6, end: 25 },
      nucleus: {
        kind: "substack",
        commandSourceSpan: { start: 6, end: 15 },
        sourceSpan: { start: 6, end: 25 },
      },
    });
    if (substack?.kind !== "atom" || substack.nucleus.kind !== "substack") {
      return;
    }
    expect(substack.nucleus.rows).toHaveLength(2);
    expect(substack.nucleus.rows[0]).toMatchObject({
      sourceSpan: { start: 16, end: 21 },
      rowBreakSourceSpan: { start: 19, end: 21 },
    });
    expect(substack.nucleus.rows[0]?.cells[0]?.list.sourceSpan).toEqual({ start: 16, end: 19 });
    expect(substack.nucleus.rows[1]).toMatchObject({
      sourceSpan: { start: 21, end: 24 },
    });
    expect(substack.nucleus.rows[1]?.cells[0]?.list.sourceSpan).toEqual({ start: 21, end: 24 });
  });

  it("parses amsmath subarray environments with TeX column alignment", () => {
    const source = String.raw`\begin{subarray}{c}a\\b\end{subarray}+\begin{subarray}{l}a+b\\c\end{subarray}`;
    const result = parseTexMath(source);

    expect(result.diagnostics).toEqual([]);
    const centered = atomAt(result, 0);
    expect(centered).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 0, end: 37 },
      nucleus: {
        kind: "subarray",
        columnAlignment: "center",
        beginSourceSpan: { start: 0, end: 6 },
        preambleSourceSpan: { start: 16, end: 19 },
        endSourceSpan: { start: 23, end: 37 },
      },
    });
    if (centered.nucleus.kind !== "subarray") {
      return;
    }
    expect(centered.nucleus.rows).toHaveLength(2);
    expect(centered.nucleus.rows[0]).toMatchObject({
      sourceSpan: { start: 19, end: 22 },
      rowBreakSourceSpan: { start: 20, end: 22 },
    });
    expect(centered.nucleus.rows[1]?.cells[0]?.list.sourceSpan).toEqual({ start: 22, end: 23 });

    const left = atomAt(result, 2);
    expect(left).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 38, end: 77 },
      nucleus: {
        kind: "subarray",
        columnAlignment: "left",
        beginSourceSpan: { start: 38, end: 44 },
        preambleSourceSpan: { start: 54, end: 57 },
        endSourceSpan: { start: 63, end: 77 },
      },
    });
  });

  it("parses plain text commands as source-spanned text nuclei", () => {
    const result = parseTexMath(String.raw`x+\text{if x}`, { sourceOffset: 10 });
    const text = atomAt(result, 2);

    expect(result.diagnostics).toEqual([]);
    expect(text).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 12, end: 23 },
      nucleus: {
        kind: "text",
        text: "if x",
        textSourceSpan: { start: 18, end: 22 },
        sourceSpan: { start: 12, end: 23 },
      },
    });
  });

  it("parses inline math islands inside text commands", () => {
    const source = String.raw`\text{if $Ax \ge b$,}`;
    const result = parseTexMath(source);
    const text = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(text).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 0, end: source.length },
      nucleus: {
        kind: "text",
        text: "if ,",
        textSourceSpan: { start: 6, end: source.length - 1 },
      },
    });
    expect(text.nucleus.kind === "text" ? text.nucleus.parts : []).toMatchObject([
      { kind: "text", text: "if " },
      { kind: "math", contentSourceSpan: { start: 10, end: 18 } },
      { kind: "text", text: "," },
    ]);
  });

  it("keeps unsupported commands inside text explicit", () => {
    const result = parseTexMath(String.raw`\text{\emph{x}}`);
    const text = atomAt(result, 0);

    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "unsupported-command",
        message: String.raw`Unsupported content in \text: \emph.`,
        sourceSpan: { start: 6, end: 11 },
      },
    ]);
    expect(text).toMatchObject({
      atomClass: "ord",
      nucleus: {
        kind: "unsupported",
        command: String.raw`\text`,
      },
    });
  });

  it("parses operatorname commands as roman operator nuclei with optional display limits", () => {
    const result = parseTexMath(String.raw`\operatorname{rank}+\operatorname*{arg\,max}_{x}`);
    const rank = atomAt(result, 0);
    const argmax = atomAt(result, 2);

    expect(result.diagnostics).toEqual([]);
    expect(rank).toMatchObject({
      atomClass: "op",
      limits: "nolimits",
      sourceSpan: { start: 0, end: 19 },
      nucleus: {
        kind: "operator-name",
        commandSourceSpan: { start: 0, end: 13 },
        nameSourceSpan: { start: 14, end: 18 },
      },
    });
    expect(rank.nucleus.kind === "operator-name" ? rank.nucleus.parts : []).toEqual([
      { kind: "text", text: "r", sourceSpan: { start: 14, end: 15 } },
      { kind: "text", text: "a", sourceSpan: { start: 15, end: 16 } },
      { kind: "text", text: "n", sourceSpan: { start: 16, end: 17 } },
      { kind: "text", text: "k", sourceSpan: { start: 17, end: 18 } },
    ]);
    expect(argmax).toMatchObject({
      atomClass: "op",
      limits: "display",
      sourceSpan: { start: 20, end: 48 },
      nucleus: {
        kind: "operator-name",
        commandSourceSpan: { start: 20, end: 34 },
        nameSourceSpan: { start: 35, end: 43 },
      },
      subscript: { sourceSpan: { start: 44, end: 48 } },
    });
    expect(argmax.nucleus.kind === "operator-name" ? argmax.nucleus.parts : []).toEqual([
      { kind: "text", text: "a", sourceSpan: { start: 35, end: 36 } },
      { kind: "text", text: "r", sourceSpan: { start: 36, end: 37 } },
      { kind: "text", text: "g", sourceSpan: { start: 37, end: 38 } },
      { kind: "spacing", command: ",", sourceSpan: { start: 38, end: 40 } },
      { kind: "text", text: "m", sourceSpan: { start: 40, end: 41 } },
      { kind: "text", text: "a", sourceSpan: { start: 41, end: 42 } },
      { kind: "text", text: "x", sourceSpan: { start: 42, end: 43 } },
    ]);
  });

  it("parses DeclareMathOperator declarations as later roman operator uses", () => {
    const result = parseTexMath(String.raw`\DeclareMathOperator{\R}{R}a\R b`);
    const a = atomAt(result, 0);
    const operator = atomAt(result, 1);
    const b = atomAt(result, 2);

    expect(result.diagnostics).toEqual([]);
    expect(a.sourceSpan).toEqual({ start: 27, end: 28 });
    expect(b.sourceSpan).toEqual({ start: 31, end: 32 });
    expect(operator).toMatchObject({
      atomClass: "op",
      limits: "nolimits",
      sourceSpan: { start: 28, end: 30 },
      nucleus: {
        kind: "operator-name",
        commandSourceSpan: { start: 28, end: 30 },
        nameSourceSpan: { start: 28, end: 30 },
      },
    });
    expect(operator.nucleus.kind === "operator-name" ? operator.nucleus.parts : []).toEqual([
      { kind: "text", text: "R", sourceSpan: { start: 28, end: 30 } },
    ]);
  });

  it("parses starred DeclareMathOperator declarations with display limits", () => {
    const result = parseTexMath(String.raw`\DeclareMathOperator*{\R}{R}\R_{n}`);
    const operator = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(result.list.items).toHaveLength(1);
    expect(operator).toMatchObject({
      atomClass: "op",
      limits: "display",
      sourceSpan: { start: 28, end: 34 },
      nucleus: {
        kind: "operator-name",
        commandSourceSpan: { start: 28, end: 30 },
        nameSourceSpan: { start: 28, end: 30 },
      },
      subscript: { sourceSpan: { start: 30, end: 34 } },
    });
  });

  it("keeps unsupported operatorname macro content explicit", () => {
    const result = parseTexMath(String.raw`\operatorname{\alpha}`);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "unsupported-command",
        message: String.raw`Unsupported content in \operatorname: \alpha.`,
        sourceSpan: { start: 14, end: 20 },
      },
    ]);
    expect(atom.nucleus).toMatchObject({
      kind: "unsupported",
      command: String.raw`\operatorname`,
      sourceSpan: { start: 0, end: 21 },
    });
  });

  it("parses math alphabet commands as source-spanned list nuclei", () => {
    const result = parseTexMath(String.raw`\mathbf{x_i}`, { sourceOffset: 20 });
    const bold = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(bold).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 20, end: 32 },
      nucleus: {
        kind: "alphabet",
        alphabet: "mathbf",
        commandSourceSpan: { start: 20, end: 27 },
        sourceSpan: { start: 20, end: 32 },
      },
    });
    expect(bold.nucleus.kind === "alphabet" ? bold.nucleus.list.sourceSpan : null)
      .toEqual({ start: 28, end: 31 });
    const base = bold.nucleus.kind === "alphabet"
      ? bold.nucleus.list.items[0]
      : null;
    expect(base).toMatchObject({
      kind: "atom",
      nucleus: { kind: "glyph", text: "x" },
      subscript: { sourceSpan: { start: 29, end: 31 } },
    });
  });

  it("parses typewriter and calligraphic math alphabet commands", () => {
    const result = parseTexMath(String.raw`\mathtt{x}+\mathcal{A}`);
    const typewriter = atomAt(result, 0);
    const calligraphic = atomAt(result, 2);

    expect(result.diagnostics).toEqual([]);
    expect(typewriter).toMatchObject({
      nucleus: {
        kind: "alphabet",
        alphabet: "mathtt",
        commandSourceSpan: { start: 0, end: 7 },
        sourceSpan: { start: 0, end: 10 },
      },
    });
    expect(calligraphic).toMatchObject({
      nucleus: {
        kind: "alphabet",
        alphabet: "mathcal",
        commandSourceSpan: { start: 11, end: 19 },
        sourceSpan: { start: 11, end: 22 },
      },
    });
  });

  it("parses TeX macro arguments as single atoms when braces are omitted", () => {
    const fraction = atomAt(parseTexMath(String.raw`\frac1c+\sqrt x`), 0);
    const radical = atomAt(parseTexMath(String.raw`\frac1c+\sqrt x`), 2);

    expect(fraction).toMatchObject({
      nucleus: {
        kind: "fraction",
        numerator: { items: [{ nucleus: { kind: "glyph", text: "1" } }] },
        denominator: { items: [{ nucleus: { kind: "glyph", text: "c" } }] },
        sourceSpan: { start: 0, end: 7 },
      },
    });
    expect(radical).toMatchObject({
      nucleus: {
        kind: "radical",
        radicand: { items: [{ nucleus: { kind: "glyph", text: "x" } }] },
        sourceSpan: { start: 8, end: 15 },
      },
    });
  });

  it("parses named math symbols with TeX atom classes", () => {
    const result = parseTexMath(String.raw`\alpha+\times=\leq\neq:x`);

    expect(result.diagnostics).toEqual([]);
    expect(result.list.items.map((item) =>
      item.kind === "atom" && item.nucleus.kind === "glyph"
        ? { atomClass: item.atomClass, text: item.nucleus.text, sourceSpan: item.sourceSpan }
        : null
    )).toEqual([
      { atomClass: "ord", text: String.raw`\alpha`, sourceSpan: { start: 0, end: 6 } },
      { atomClass: "bin", text: "+", sourceSpan: { start: 6, end: 7 } },
      { atomClass: "bin", text: String.raw`\times`, sourceSpan: { start: 7, end: 13 } },
      { atomClass: "rel", text: "=", sourceSpan: { start: 13, end: 14 } },
      { atomClass: "rel", text: String.raw`\leq`, sourceSpan: { start: 14, end: 18 } },
      { atomClass: "rel", text: String.raw`\neq`, sourceSpan: { start: 18, end: 22 } },
      { atomClass: "rel", text: ":", sourceSpan: { start: 22, end: 23 } },
      { atomClass: "ord", text: "x", sourceSpan: { start: 23, end: 24 } },
    ]);
  });

  it("parses additional plain-TeX symbols and named operators", () => {
    const result = parseTexMath(String.raw`\partial f+\nabla g+\sin x+\bullet+\lvert x\rvert+\lfloor y\rfloor+\colon+\Longrightarrow+\implies+\iff`);

    expect(result.diagnostics).toEqual([]);
    expect(result.list.items.map((item) =>
      item.kind === "atom" && item.nucleus.kind === "glyph"
        ? { atomClass: item.atomClass, text: item.nucleus.text }
        : item.kind === "atom" && item.nucleus.kind === "operator-name"
          ? {
              atomClass: item.atomClass,
              text: item.nucleus.parts.map((part) => part.kind === "text" ? part.text : "").join(""),
            }
          : null
    )).toEqual([
      { atomClass: "ord", text: String.raw`\partial` },
      { atomClass: "ord", text: "f" },
      { atomClass: "bin", text: "+" },
      { atomClass: "ord", text: String.raw`\nabla` },
      { atomClass: "ord", text: "g" },
      { atomClass: "bin", text: "+" },
      { atomClass: "op", text: "sin" },
      { atomClass: "ord", text: "x" },
      { atomClass: "bin", text: "+" },
      { atomClass: "bin", text: String.raw`\bullet` },
      { atomClass: "bin", text: "+" },
      { atomClass: "open", text: String.raw`\lvert` },
      { atomClass: "ord", text: "x" },
      { atomClass: "close", text: String.raw`\rvert` },
      { atomClass: "bin", text: "+" },
      { atomClass: "open", text: String.raw`\lfloor` },
      { atomClass: "ord", text: "y" },
      { atomClass: "close", text: String.raw`\rfloor` },
      { atomClass: "bin", text: "+" },
      { atomClass: "punct", text: String.raw`\colon` },
      { atomClass: "bin", text: "+" },
      { atomClass: "rel", text: String.raw`\Longrightarrow` },
      { atomClass: "bin", text: "+" },
      { atomClass: "rel", text: String.raw`\implies` },
      { atomClass: "bin", text: "+" },
      { atomClass: "rel", text: String.raw`\iff` },
    ]);
  });

  it("parses AMS font symbols with TeX atom classes", () => {
    const result = parseTexMath(String.raw`\digamma+\dotplus+\ulcorner x\urcorner+\lesssim+\gtrsim+\thickapprox+\Bbbk`);

    expect(result.diagnostics).toEqual([]);
    expect(result.list.items.map((item) =>
      item.kind === "atom" && item.nucleus.kind === "glyph"
        ? { atomClass: item.atomClass, text: item.nucleus.text }
        : null
    )).toEqual([
      { atomClass: "ord", text: String.raw`\digamma` },
      { atomClass: "bin", text: "+" },
      { atomClass: "bin", text: String.raw`\dotplus` },
      { atomClass: "bin", text: "+" },
      { atomClass: "open", text: String.raw`\ulcorner` },
      { atomClass: "ord", text: "x" },
      { atomClass: "close", text: String.raw`\urcorner` },
      { atomClass: "bin", text: "+" },
      { atomClass: "rel", text: String.raw`\lesssim` },
      { atomClass: "bin", text: "+" },
      { atomClass: "rel", text: String.raw`\gtrsim` },
      { atomClass: "bin", text: "+" },
      { atomClass: "rel", text: String.raw`\thickapprox` },
      { atomClass: "bin", text: "+" },
      { atomClass: "ord", text: String.raw`\Bbbk` },
    ]);
  });

  it("parses AMS extensible arrows with optional below and required above labels", () => {
    const result = parseTexMath(String.raw`\xrightarrow[xy]{abcd}+\xleftarrow{z}`);

    expect(result.diagnostics).toEqual([]);
    const rightArrow = atomAt(result, 0);
    const leftArrow = atomAt(result, 2);
    expect(rightArrow).toMatchObject({
      atomClass: "rel",
      sourceSpan: { start: 0, end: 22 },
      nucleus: {
        kind: "extensible-arrow",
        command: "xrightarrow",
        commandSourceSpan: { start: 0, end: 12 },
        belowSourceSpan: { start: 12, end: 16 },
        aboveSourceSpan: { start: 16, end: 22 },
      },
    });
    expect(rightArrow.nucleus.kind === "extensible-arrow" ? rightArrow.nucleus.below?.items.map((item) =>
      item.kind === "atom" && item.nucleus.kind === "glyph" ? item.nucleus.text : null
    ) : []).toEqual(["x", "y"]);
    expect(rightArrow.nucleus.kind === "extensible-arrow" ? rightArrow.nucleus.above.items.map((item) =>
      item.kind === "atom" && item.nucleus.kind === "glyph" ? item.nucleus.text : null
    ) : []).toEqual(["a", "b", "c", "d"]);
    expect(leftArrow).toMatchObject({
      atomClass: "rel",
      sourceSpan: { start: 23, end: 37 },
      nucleus: {
        kind: "extensible-arrow",
        command: "xleftarrow",
        commandSourceSpan: { start: 23, end: 34 },
        aboveSourceSpan: { start: 34, end: 37 },
      },
    });
  });

  it("parses arrow, set, and logic symbols with TeX atom classes", () => {
    const result = parseTexMath(String.raw`\forall x\to A\cup B\subseteq C`);

    expect(result.diagnostics).toEqual([]);
    expect(result.list.items.map((item) =>
      item.kind === "atom" && item.nucleus.kind === "glyph"
        ? { atomClass: item.atomClass, text: item.nucleus.text, sourceSpan: item.sourceSpan }
        : null
    )).toEqual([
      { atomClass: "ord", text: String.raw`\forall`, sourceSpan: { start: 0, end: 7 } },
      { atomClass: "ord", text: "x", sourceSpan: { start: 8, end: 9 } },
      { atomClass: "rel", text: String.raw`\to`, sourceSpan: { start: 9, end: 12 } },
      { atomClass: "ord", text: "A", sourceSpan: { start: 13, end: 14 } },
      { atomClass: "bin", text: String.raw`\cup`, sourceSpan: { start: 14, end: 18 } },
      { atomClass: "ord", text: "B", sourceSpan: { start: 19, end: 20 } },
      { atomClass: "rel", text: String.raw`\subseteq`, sourceSpan: { start: 20, end: 29 } },
      { atomClass: "ord", text: "C", sourceSpan: { start: 30, end: 31 } },
    ]);
  });

  it("parses negated relation composites as source-spanned relation atoms", () => {
    const result = parseTexMath(String.raw`x\not= y\not\in A\notin B`);

    expect(result.diagnostics).toEqual([]);
    const relationAtoms = result.list.items
      .filter((item) => item.kind === "atom" && item.atomClass === "rel");
    expect(relationAtoms.map((item) =>
      item.kind === "atom" && item.nucleus.kind === "glyph"
        ? { text: item.nucleus.text, sourceSpan: item.sourceSpan }
        : null
    )).toEqual([
      { text: String.raw`\not=`, sourceSpan: { start: 1, end: 6 } },
      { text: String.raw`\not\in`, sourceSpan: { start: 8, end: 15 } },
      { text: String.raw`\notin`, sourceSpan: { start: 17, end: 23 } },
    ]);
  });

  it("parses TeX operator commands as op atoms with scripts", () => {
    const result = parseTexMath(String.raw`\sum_i^n+\lim_{x}+\iiiint_0^1`);
    const sum = atomAt(result, 0);
    const lim = atomAt(result, 2);
    const multiIntegral = atomAt(result, 4);

    expect(result.diagnostics).toEqual([]);
    expect(sum).toMatchObject({
      atomClass: "op",
      sourceSpan: { start: 0, end: 8 },
      nucleus: {
        kind: "operator",
        command: "sum",
        sourceSpan: { start: 0, end: 4 },
      },
      subscript: { sourceSpan: { start: 4, end: 6 } },
      superscript: { sourceSpan: { start: 6, end: 8 } },
    });
    expect(lim).toMatchObject({
      atomClass: "op",
      sourceSpan: { start: 9, end: 17 },
      nucleus: {
        kind: "operator",
        command: "lim",
        sourceSpan: { start: 9, end: 13 },
      },
      subscript: { sourceSpan: { start: 13, end: 17 } },
    });
    expect(multiIntegral).toMatchObject({
      atomClass: "op",
      sourceSpan: { start: 18, end: 29 },
      nucleus: {
        kind: "operator",
        command: "iiiint",
        sourceSpan: { start: 18, end: 25 },
      },
      subscript: { sourceSpan: { start: 25, end: 27 } },
      superscript: { sourceSpan: { start: 27, end: 29 } },
    });
  });

  it("parses operator limits switches before scripts", () => {
    const result = parseTexMath(String.raw`\sum\limits_i^n+\int\nolimits_0^1+\prod\displaylimits_i+\idotsint\limits_a^b`);
    const sum = atomAt(result, 0);
    const integral = atomAt(result, 2);
    const product = atomAt(result, 4);
    const dottedIntegral = atomAt(result, 6);

    expect(result.diagnostics).toEqual([]);
    expect(sum).toMatchObject({
      limits: "limits",
      sourceSpan: { start: 0, end: 15 },
      subscript: { sourceSpan: { start: 11, end: 13 } },
      superscript: { sourceSpan: { start: 13, end: 15 } },
    });
    expect(integral).toMatchObject({
      limits: "nolimits",
      sourceSpan: { start: 16, end: 33 },
      subscript: { sourceSpan: { start: 29, end: 31 } },
      superscript: { sourceSpan: { start: 31, end: 33 } },
    });
    expect(product).toMatchObject({
      limits: "display",
      sourceSpan: { start: 34, end: 55 },
      subscript: { sourceSpan: { start: 53, end: 55 } },
    });
    expect(dottedIntegral).toMatchObject({
      limits: "limits",
      sourceSpan: { start: 56, end: 76 },
      nucleus: {
        kind: "operator",
        command: "idotsint",
        sourceSpan: { start: 56, end: 65 },
      },
      subscript: { sourceSpan: { start: 72, end: 74 } },
      superscript: { sourceSpan: { start: 74, end: 76 } },
    });
  });

  it("keeps math style changes as source-spanned list items", () => {
    const result = parseTexMath(String.raw`{\displaystyle\sum_i^n}`);
    const group = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(group.nucleus.kind).toBe("list");
    if (group.nucleus.kind !== "list") {
      return;
    }
    expect(group.nucleus.list.items[0]).toMatchObject({
      kind: "style-change",
      style: "display",
      sourceSpan: { start: 1, end: 14 },
    });
    expect(group.nucleus.list.items[1]).toMatchObject({
      kind: "atom",
      nucleus: { kind: "operator", command: "sum" },
    });
  });

  it("parses left-right delimiter groups with delimiter source spans", () => {
    const result = parseTexMath(String.raw`\left(\frac{1}{2}\right)`);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(atom).toMatchObject({
      atomClass: "inner",
      sourceSpan: { start: 0, end: 24 },
      nucleus: {
        kind: "left-right",
        leftDelimiter: "(",
        rightDelimiter: ")",
        leftDelimiterSourceSpan: { start: 5, end: 6 },
        rightDelimiterSourceSpan: { start: 23, end: 24 },
      },
    });
    expect(atom.nucleus.kind === "left-right" ? atom.nucleus.body.items : []).toHaveLength(1);
  });

  it("parses aligned environments into source-spanned rows and cells", () => {
    const source = String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`;
    const result = parseTexMath(source, { sourceOffset: 5 });
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(result.list.items).toHaveLength(1);
    expect(atom).toMatchObject({
      atomClass: "inner",
      sourceSpan: { start: 5, end: 5 + source.length },
      nucleus: {
        kind: "aligned",
        beginSourceSpan: { start: 5, end: 11 },
        endSourceSpan: {
          start: 5 + source.indexOf(String.raw`\end{aligned}`),
          end: 5 + source.length,
        },
      },
    });
    if (atom.nucleus.kind !== "aligned") {
      return;
    }
    expect(atom.nucleus.rows).toHaveLength(2);
    expect(atom.nucleus.rows[0]?.rowBreakSourceSpan).toEqual({
      start: 5 + source.indexOf(String.raw`\\`),
      end: 5 + source.indexOf(String.raw`\\`) + String.raw`\\`.length,
    });
    expect(atom.nucleus.rows.map((row) =>
      row.cells.map((cell) => ({
        sourceSpan: cell.sourceSpan,
        itemCount: cell.list.items.length,
      }))
    )).toEqual([
      [
        {
          sourceSpan: {
            start: 5 + source.indexOf("a&"),
            end: 5 + source.indexOf("a&") + 1,
          },
          itemCount: 1,
        },
        {
          sourceSpan: {
            start: 5 + source.indexOf("=b"),
            end: 5 + source.indexOf("=b") + 2,
          },
          itemCount: 2,
        },
      ],
      [
        {
          sourceSpan: {
            start: 5 + source.indexOf("c&"),
            end: 5 + source.indexOf("c&") + 1,
          },
          itemCount: 1,
        },
        {
          sourceSpan: {
            start: 5 + source.indexOf("=d"),
            end: 5 + source.indexOf("=d") + 2,
          },
          itemCount: 2,
        },
      ],
    ]);
  });

  it("parses display alignment environments with their own end delimiters", () => {
    const source = String.raw`\begin{align}a&=b\\c&=d\end{align}`;
    const result = parseTexMath(source, { sourceOffset: 2 });
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(atom).toMatchObject({
      atomClass: "inner",
      sourceSpan: { start: 2, end: 2 + source.length },
      nucleus: {
        kind: "aligned",
        beginSourceSpan: { start: 2, end: 8 },
        endSourceSpan: {
          start: 2 + source.indexOf(String.raw`\end{align}`),
          end: 2 + source.length,
        },
      },
    });
    if (atom.nucleus.kind !== "aligned") {
      return;
    }
    expect(atom.nucleus.rows.map((row) => row.cells.map((cell) => cell.list.items.length))).toEqual([
      [1, 2],
      [1, 2],
    ]);
  });

  it("parses alignment row metadata without visible math atoms", () => {
    const source = String.raw`\begin{align}a&=b\label{eq:a}\\c&=d\nonumber\end{align}`;
    const result = parseTexMath(source);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(atom.nucleus.kind).toBe("aligned");
    if (atom.nucleus.kind !== "aligned") {
      return;
    }
    expect(atom.nucleus.rows).toHaveLength(2);
    expect(atom.nucleus.rows[0]).toMatchObject({
      labels: [
        {
          text: "eq:a",
          sourceSpan: {
            start: source.indexOf(String.raw`\label`),
            end: source.indexOf(String.raw`\\c`),
          },
          textSourceSpan: {
            start: source.indexOf("{eq:a}") + 1,
            end: source.indexOf("{eq:a}") + 5,
          },
        },
      ],
    });
    expect(atom.nucleus.rows[0]?.cells.map((cell) => cell.list.items.length)).toEqual([1, 2]);
    expect(atom.nucleus.rows[1]).toMatchObject({
      suppressTag: true,
    });
    expect(atom.nucleus.rows[1]?.cells.map((cell) => cell.list.items.length)).toEqual([1, 2]);
  });

  it("parses explicit alignment tags as row labels", () => {
    const result = parseTexMath(String.raw`\begin{align}a\tag{A}\end{align}`);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(atom.nucleus.kind).toBe("aligned");
    if (atom.nucleus.kind !== "aligned") {
      return;
    }
    expect(atom.nucleus.rows[0]).toMatchObject({
      labels: [
        {
          text: "A",
          sourceSpan: { start: 14, end: 21 },
          textSourceSpan: { start: 19, end: 20 },
        },
      ],
    });
    expect(atom.nucleus.rows[0]?.cells[0]?.list.items).toHaveLength(1);
  });

  it("parses gather environments as aligned rows without requiring alignment tabs", () => {
    const source = String.raw`\begin{gather*}a=b\\c=d\end{gather*}`;
    const result = parseTexMath(source);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(atom.nucleus).toMatchObject({
      kind: "aligned",
      rows: [
        { cells: [{ sourceSpan: { start: 15, end: 18 } }] },
        { cells: [{ sourceSpan: { start: 20, end: 23 } }] },
      ],
    });
  });

  it("parses multline environments as row lists with multline placement mode", () => {
    const source = String.raw`\begin{multline*}a=b\\c+d=e\\f=g\end{multline*}`;
    const result = parseTexMath(source);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(atom.nucleus).toMatchObject({
      kind: "aligned",
      columnSeparation: "multline",
      rows: [
        { cells: [{ sourceSpan: { start: source.indexOf("a=b"), end: source.indexOf("a=b") + 3 } }] },
        { cells: [{ sourceSpan: { start: source.indexOf("c+d=e"), end: source.indexOf("c+d=e") + 5 } }] },
        { cells: [{ sourceSpan: { start: source.indexOf("f=g"), end: source.indexOf("f=g") + 3 } }] },
      ],
    });
  });

  it("reports intertext in alignment environments as explicitly unsupported", () => {
    const source = String.raw`\begin{align*}a&=b\\\intertext{words}c&=d\end{align*}`;
    const result = parseTexMath(source);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        code: "unsupported-command",
        message: String.raw`Unsupported alignment command \intertext.`,
        sourceSpan: {
          start: source.indexOf(String.raw`\intertext`),
          end: source.indexOf("c&=d"),
        },
      },
    ]);
    expect(atom.nucleus).toMatchObject({
      kind: "aligned",
      rows: expect.any(Array),
    });
  });

  it("reports displaybreak in alignment environments as explicitly unsupported", () => {
    const source = String.raw`\begin{align*}a&=b\displaybreak[2]\\c&=d\end{align*}`;
    const result = parseTexMath(source);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        code: "unsupported-command",
        message: String.raw`Unsupported alignment command \displaybreak.`,
        sourceSpan: {
          start: source.indexOf(String.raw`\displaybreak`),
          end: source.indexOf(String.raw`\\c&=d`),
        },
      },
    ]);
    expect(atom.nucleus).toMatchObject({
      kind: "aligned",
      rows: expect.any(Array),
    });
  });

  it("reports TeX-like errors for invalid nested display alignment environments", () => {
    const cases = [
      {
        source: String.raw`\begin{align}\begin{align} \end{align}\end{align}`,
        message: String.raw`Erroneous nesting of equation structures: \begin{align} inside \begin{align}.`,
      },
      {
        source: String.raw`\begin{align}\begin{gather} a=b \end{gather}\end{align}`,
        message: String.raw`Erroneous nesting of equation structures: \begin{gather} inside \begin{align}.`,
      },
      {
        source: String.raw`\begin{gather}\begin{gather} \end{gather}\end{gather}`,
        message: String.raw`Erroneous nesting of equation structures: \begin{gather} inside \begin{gather}.`,
      },
    ];

    for (const { source, message } of cases) {
      const result = parseTexMath(source);
      expect(result.diagnostics).toContainEqual({
        severity: "error",
        code: "invalid-environment-nesting",
        message,
        sourceSpan: {
          start: source.indexOf(String.raw`\begin{`, 1),
          end: source.indexOf("}", source.indexOf(String.raw`\begin{`, 1)) + 1,
        },
      });
      expect(atomAt(result, 0).nucleus).toMatchObject({
        kind: "aligned",
        endSourceSpan: {
          start: source.lastIndexOf(String.raw`\end{`),
          end: source.length,
        },
      });
    }
  });

  it("reports TeX-like xalignat argument and row errors while keeping the environment unsupported", () => {
    const invalidArgument = parseTexMath(String.raw`\begin{xalignat}{x} \and{xalignat}`);
    expect(invalidArgument.diagnostics).toContainEqual({
      severity: "error",
      code: "invalid-environment-argument",
      message: String.raw`Argument to \begin{xalignat} must be a positive integer.`,
      sourceSpan: { start: 17, end: 18 },
    });
    expect(atomAt(invalidArgument, 0)).toMatchObject({
      atomClass: "inner",
      sourceSpan: { start: 0, end: 34 },
      nucleus: {
        kind: "unsupported",
        command: String.raw`\begin{xalignat}`,
        sourceSpan: { start: 0, end: 34 },
      },
    });
    expect(invalidArgument.list.items).toHaveLength(1);

    const extraAlignmentTab = parseTexMath(String.raw`\begin{xalignat}{1} a&b & \end{xalignat}`);
    expect(extraAlignmentTab.diagnostics).toContainEqual({
      severity: "error",
      code: "extra-alignment-tab",
      message: "Extra & in row of xalignat.",
      sourceSpan: { start: 24, end: 25 },
    });
    expect(atomAt(extraAlignmentTab, 0)).toMatchObject({
      atomClass: "inner",
      sourceSpan: { start: 0, end: 40 },
      nucleus: {
        kind: "unsupported",
        command: String.raw`\begin{xalignat}`,
        sourceSpan: { start: 0, end: 40 },
      },
    });
    expect(extraAlignmentTab.list.items).toHaveLength(1);
  });

  it("allows align inside gather like amsmath", () => {
    const source = String.raw`\begin{gather}\begin{align} a &= b \end{align}\end{gather}`;
    const result = parseTexMath(source);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(atom.nucleus).toMatchObject({
      kind: "aligned",
      rows: [
        {
          cells: [
            {
              list: {
                items: [
                  {
                    nucleus: {
                      kind: "aligned",
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  it("reports missing aligned environment ends without throwing", () => {
    const result = parseTexMath(String.raw`\begin{aligned}a&=b`);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        code: "missing-environment-end",
        message: String.raw`Expected \end{aligned} to close math environment.`,
        sourceSpan: { start: 0, end: 6 },
      },
    ]);
    expect(atom.nucleus).toMatchObject({
      kind: "aligned",
      rows: [
        {
          cells: [
            { sourceSpan: { start: 15, end: 16 } },
            { sourceSpan: { start: 17, end: 19 } },
          ],
        },
      ],
    });
  });

  it("parses matrix environments into source-spanned rows and centered cells", () => {
    const source = String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`;
    const result = parseTexMath(source, { sourceOffset: 3 });
    const atom = atomAt(result, 0);
    const bareMatrix = atomAt(parseTexMath(String.raw`\begin{matrix}a\end{matrix}`), 0);
    const delimitedMatrixEnvironments = ["pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix"];

    expect(result.diagnostics).toEqual([]);
    expect(bareMatrix).toMatchObject({
      atomClass: "ord",
      nucleus: {
        kind: "matrix",
        environment: "matrix",
      },
    });
    for (const environment of delimitedMatrixEnvironments) {
      expect(atomAt(parseTexMath(String.raw`\begin{` + environment + String.raw`}a\end{` + environment + "}"), 0))
        .toMatchObject({
          atomClass: "inner",
          nucleus: {
            kind: "matrix",
            environment,
          },
        });
    }
    expect(atom).toMatchObject({
      atomClass: "inner",
      sourceSpan: { start: 3, end: 3 + source.length },
      nucleus: {
        kind: "matrix",
        environment: "pmatrix",
        beginSourceSpan: { start: 3, end: 9 },
        endSourceSpan: {
          start: 3 + source.indexOf(String.raw`\end{pmatrix}`),
          end: 3 + source.length,
        },
      },
    });
    if (atom.nucleus.kind !== "matrix") {
      return;
    }
    expect(atom.nucleus.rows.map((row) =>
      row.cells.map((cell) => ({
        sourceSpan: cell.sourceSpan,
        itemCount: cell.list.items.length,
      }))
    )).toEqual([
      [
        { sourceSpan: { start: 18, end: 19 }, itemCount: 1 },
        { sourceSpan: { start: 20, end: 21 }, itemCount: 1 },
      ],
      [
        { sourceSpan: { start: 23, end: 24 }, itemCount: 1 },
        { sourceSpan: { start: 25, end: 26 }, itemCount: 1 },
      ],
    ]);
  });

  it("parses array environments with conservative l/c/r column preambles", () => {
    const source = String.raw`\begin{array}{lr}a&b\\c&d\end{array}`;
    const result = parseTexMath(source, { sourceOffset: 3 });
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(atom).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 3, end: 3 + source.length },
      nucleus: {
        kind: "array",
        beginSourceSpan: { start: 3, end: 9 },
        preambleSourceSpan: { start: 16, end: 20 },
        columnAlignments: ["left", "right"],
        endSourceSpan: {
          start: 3 + source.indexOf(String.raw`\end{array}`),
          end: 3 + source.length,
        },
      },
    });
    if (atom.nucleus.kind !== "array") {
      return;
    }
    expect(atom.nucleus.rows.map((row) =>
      row.cells.map((cell) => ({
        sourceSpan: cell.sourceSpan,
        itemCount: cell.list.items.length,
      }))
    )).toEqual([
      [
        { sourceSpan: { start: 20, end: 21 }, itemCount: 1 },
        { sourceSpan: { start: 22, end: 23 }, itemCount: 1 },
      ],
      [
        { sourceSpan: { start: 25, end: 26 }, itemCount: 1 },
        { sourceSpan: { start: 27, end: 28 }, itemCount: 1 },
      ],
    ]);
  });

  it("parses array optional vertical positions before column preambles", () => {
    const source = String.raw`\begin{array}[b]{c}a\end{array}`;
    const result = parseTexMath(source);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(atom).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 0, end: source.length },
      nucleus: {
        kind: "array",
        preambleSourceSpan: { start: 16, end: 19 },
        columnAlignments: ["center"],
      },
    });
  });

  it("keeps unsupported array preamble extensions explicit", () => {
    const source = String.raw`\begin{array}{c|c}a&b\end{array}`;
    const result = parseTexMath(source);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "unsupported-command",
        message: "Unsupported array column specifier |.",
        sourceSpan: { start: 15, end: 16 },
      },
    ]);
    expect(result.list.items).toHaveLength(1);
    expect(atom.nucleus).toMatchObject({
      kind: "unsupported",
      command: String.raw`\begin{array}`,
      sourceSpan: { start: 0, end: source.length },
    });
  });

  it("parses cases environments into source-spanned rows", () => {
    const source = String.raw`\begin{cases}a&b\\x&y\end{cases}`;
    const result = parseTexMath(source);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(atom).toMatchObject({
      atomClass: "inner",
      sourceSpan: { start: 0, end: source.length },
      nucleus: {
        kind: "cases",
        beginSourceSpan: { start: 0, end: 6 },
        endSourceSpan: {
          start: source.indexOf(String.raw`\end{cases}`),
          end: source.length,
        },
      },
    });
    if (atom.nucleus.kind !== "cases") {
      return;
    }
    expect(atom.nucleus.rows.map((row) =>
      row.cells.map((cell) => ({
        sourceSpan: cell.sourceSpan,
        itemCount: cell.list.items.length,
      }))
    )).toEqual([
      [
        { sourceSpan: { start: 13, end: 14 }, itemCount: 1 },
        { sourceSpan: { start: 15, end: 16 }, itemCount: 1 },
      ],
      [
        { sourceSpan: { start: 18, end: 19 }, itemCount: 1 },
        { sourceSpan: { start: 20, end: 21 }, itemCount: 1 },
      ],
    ]);
  });

  it("parses smallmatrix environments into source-spanned rows", () => {
    const source = String.raw`\begin{smallmatrix}a&b\\x&y\end{smallmatrix}`;
    const result = parseTexMath(source);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([]);
    expect(atom).toMatchObject({
      atomClass: "ord",
      sourceSpan: { start: 0, end: source.length },
      nucleus: {
        kind: "smallmatrix",
        beginSourceSpan: { start: 0, end: 6 },
        endSourceSpan: {
          start: source.indexOf(String.raw`\end{smallmatrix}`),
          end: source.length,
        },
      },
    });
    if (atom.nucleus.kind !== "smallmatrix") {
      return;
    }
    expect(atom.nucleus.rows.map((row) =>
      row.cells.map((cell) => ({
        sourceSpan: cell.sourceSpan,
        itemCount: cell.list.items.length,
      }))
    )).toEqual([
      [
        { sourceSpan: { start: 19, end: 20 }, itemCount: 1 },
        { sourceSpan: { start: 21, end: 22 }, itemCount: 1 },
      ],
      [
        { sourceSpan: { start: 24, end: 25 }, itemCount: 1 },
        { sourceSpan: { start: 26, end: 27 }, itemCount: 1 },
      ],
    ]);
  });

  it("reports missing matrix environment ends without throwing", () => {
    const result = parseTexMath(String.raw`\begin{pmatrix}a&b`);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        code: "missing-environment-end",
        message: String.raw`Expected \end{pmatrix} to close math environment.`,
        sourceSpan: { start: 0, end: 6 },
      },
    ]);
    expect(atom.nucleus).toMatchObject({
      kind: "matrix",
      environment: "pmatrix",
      rows: [
        {
          cells: [
            { sourceSpan: { start: 15, end: 16 } },
            { sourceSpan: { start: 17, end: 18 } },
          ],
        },
      ],
    });
  });

  it("maps TeX left-right delimiter commands to canonical delimiter ids", () => {
    const result = parseTexMath(String.raw`\left\langle x\right\rangle \left\lbrace y\right\rbrace \left|z\right\Vert \left\ulcorner w\right\urcorner`);
    const groups = result.list.items.filter((item): item is ReturnType<typeof atomAt> => item.kind === "atom");

    expect(result.diagnostics).toEqual([]);
    expect(groups.map((group) => group.nucleus.kind === "left-right"
      ? [group.nucleus.leftDelimiter, group.nucleus.rightDelimiter]
      : null)).toEqual([
      ["langle", "rangle"],
      ["lbrace", "rbrace"],
      ["vert", "Vert"],
      ["ulcorner", "urcorner"],
    ]);
  });

  it("parses big delimiter prefixes without treating them as unsupported commands", () => {
    const source = String.raw`\big( x \big)`;
    const result = parseTexMath(source);

    expect(result.diagnostics).toEqual([]);
    expect(result.list.items.map((item) =>
      item.kind === "atom"
        ? { kind: item.nucleus.kind, sourceSpan: item.sourceSpan }
        : null
    )).toEqual([
      { kind: "sized-delimiter", sourceSpan: { start: 0, end: 5 } },
      { kind: "glyph", sourceSpan: { start: 6, end: 7 } },
      { kind: "sized-delimiter", sourceSpan: { start: 8, end: 13 } },
    ]);
  });

  it("uses TeX math classes for big delimiter command variants", () => {
    const result = parseTexMath(String.raw`\big) \bigl( \bigr) \bigm|`);

    expect(result.diagnostics).toEqual([]);
    expect(result.list.items.filter((item) => item.kind === "atom").map((item) =>
      item.kind === "atom" ? item.atomClass : null
    )).toEqual(["ord", "open", "close", "rel"]);
  });

  it("keeps unsupported left-right delimiters explicit instead of treating them as null delimiters", () => {
    const result = parseTexMath(String.raw`\left\unknown x\right)`);
    const atom = atomAt(result, 0);

    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "unsupported-command",
        message: "Unsupported math delimiter \\unknown.",
        sourceSpan: { start: 5, end: 13 },
      },
    ]);
    expect(atom).toMatchObject({
      atomClass: "inner",
      nucleus: {
        kind: "unsupported",
        command: String.raw`\left...\right`,
      },
    });
  });

  it("parses explicit math spacing commands as glue items", () => {
    const result = parseTexMath(String.raw`x\,y\quad z`);

    expect(result.diagnostics).toEqual([]);
    expect(result.list.items.map((item) => item.kind)).toEqual([
      "atom",
      "glue",
      "atom",
      "glue",
      "atom",
    ]);
    expect(result.list.items[1]).toMatchObject({ kind: "glue", command: "," });
    expect(result.list.items[3]).toMatchObject({ kind: "glue", command: "quad" });
  });

  it("keeps parsing unsupported commands and reports diagnostics with spans", () => {
    const result = parseTexMath(String.raw`x+\unknown{y}`);

    expect(result.list.items).toHaveLength(4);
    expect(result.diagnostics).toEqual([
      {
        severity: "warning",
        code: "unsupported-command",
        message: String.raw`Unsupported math command \unknown.`,
        sourceSpan: { start: 2, end: 10 },
      },
    ]);
    expect(result.list.items[2]).toMatchObject({
      kind: "atom",
      nucleus: { kind: "unsupported", command: String.raw`\unknown` },
    });
  });

  it("reports malformed scripts and groups without throwing", () => {
    const result = parseTexMath(String.raw`^2 + \frac{x`);

    expect(result.list.items.length).toBeGreaterThan(0);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "missing-script-target",
      "missing-group",
      "missing-group",
    ]);
  });
});
