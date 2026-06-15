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

  it("parses math accents with braced and single-atom bases", () => {
    const result = parseTexMath(String.raw`\hat{x}+\vec y`);
    const hat = atomAt(result, 0);
    const vec = atomAt(result, 2);

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
  });

  it("parses TeX operator commands as op atoms with scripts", () => {
    const result = parseTexMath(String.raw`\sum_i^n+\lim_{x}`);
    const sum = atomAt(result, 0);
    const lim = atomAt(result, 2);

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

  it("maps TeX left-right delimiter commands to canonical delimiter ids", () => {
    const result = parseTexMath(String.raw`\left\langle x\right\rangle \left\lbrace y\right\rbrace \left|z\right\Vert`);
    const groups = result.list.items.filter((item): item is ReturnType<typeof atomAt> => item.kind === "atom");

    expect(result.diagnostics).toEqual([]);
    expect(groups.map((group) => group.nucleus.kind === "left-right"
      ? [group.nucleus.leftDelimiter, group.nucleus.rightDelimiter]
      : null)).toEqual([
      ["langle", "rangle"],
      ["lbrace", "rbrace"],
      ["vert", "Vert"],
    ]);
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
