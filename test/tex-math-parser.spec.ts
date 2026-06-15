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

  it("parses named math symbols with TeX atom classes", () => {
    const result = parseTexMath(String.raw`\alpha+\times=\leq\neq`);

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
    ]);
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

  it("parses operator limits switches before scripts", () => {
    const result = parseTexMath(String.raw`\sum\limits_i^n+\int\nolimits_0^1+\prod\displaylimits_i`);
    const sum = atomAt(result, 0);
    const integral = atomAt(result, 2);
    const product = atomAt(result, 4);

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
