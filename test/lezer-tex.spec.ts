import { TreeFragment, type Tree } from "@lezer/common";
import { describe, expect, it } from "vitest";

import {
  beamerDocumentParser,
  parseTexSyntax,
  texDocumentParser,
  texFragmentParser,
  texMathParser,
} from "@tikz-editor/lezer-tex";

function errorRanges(tree: Tree): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError) {
      ranges.push({ from: cursor.from, to: cursor.to });
    }
  } while (cursor.next());
  return ranges;
}

describe("@tikz-editor/lezer-tex", () => {
  it("parses source-backed TeX fragments and structured inline math", () => {
    const source = String.raw`Hello \textbf{world} and $x_1+\lambda=0$.`;
    const tree = texFragmentParser.parse(source);

    expect(errorRanges(tree)).toEqual([]);
    expect(tree.toString()).toContain(
      "GenericCommand(ControlSequence(MathTextCmd))"
    );
    expect(tree.toString()).toContain(
      "MathScript(Subscript,MathScriptArgument(MathNumber(NumberToken)))"
    );
    expect(tree.toString()).toContain(
      "MathCommand(ControlSequence(ControlWord))"
    );
  });

  it("uses one grammar with Beamer command specialization as a dialect", () => {
    const source = String.raw`\begin{frame}
\frametitle{Hello}
\only<2->{Visible}
\end{frame}`;
    const genericTree = texDocumentParser.parse(source);
    const beamerTree = beamerDocumentParser.parse(source);

    expect(errorRanges(genericTree)).toEqual([]);
    expect(errorRanges(beamerTree)).toEqual([]);
    expect(genericTree.toString()).not.toContain("BeamerFrameTitleCmd");
    expect(beamerTree.toString()).toContain("BeamerFrameTitleCmd");
    expect(beamerTree.toString()).toContain("BeamerOnlyCmd");
    expect(beamerTree.toString()).toContain("OverlaySpecification");
  });

  it("characterizes pre-cutover angle-bracket and opaque parsing", () => {
    const angleText = String.raw`Alpha <2-> omega`;
    const opaque = String.raw`\begin{verbatim}
{ % literal opaque source
\end{frame}
\end{verbatim}
\begin{frame}Visible\end{frame}`;
    const genericAngleTree = texDocumentParser.parse(angleText);
    const beamerAngleTree = beamerDocumentParser.parse(angleText);
    const opaqueTree = beamerDocumentParser.parse(opaque);

    // Stage 1 of the Beamer CST cutover deliberately changes the first
    // assertion: generic angle text should stop becoming an overlay node.
    expect(genericAngleTree.toString()).toContain("OverlaySpecification");
    expect(beamerAngleTree.toString()).toContain("OverlaySpecification");
    expect(opaqueTree.toString()).not.toContain("OpaqueEnvironmentBody");
    expect(errorRanges(opaqueTree).length).toBeGreaterThan(0);
  });

  it("provides math-fragment and math-environment structure", () => {
    const math = String.raw`x_1+\frac{a}{b}`;
    const document = String.raw`\begin{align}
x &= \begin{bmatrix}y & 0\end{bmatrix} \\
z &= 1
\end{align}`;

    const mathTree = texMathParser.parse(math);
    const documentTree = texDocumentParser.parse(document);

    expect(errorRanges(mathTree)).toEqual([]);
    expect(mathTree.toString()).toContain("TexMathFragment");
    expect(mathTree.toString()).toContain("MathScript");
    expect(mathTree.toString()).toContain("MathGroup");
    expect(errorRanges(documentTree)).toEqual([]);
    let mathEnvironmentCount = 0;
    documentTree.iterate({
      enter(node) {
        if (node.name === "MathEnvironment") {
          mathEnvironmentCount += 1;
        }
      },
    });
    expect(mathEnvironmentCount).toBe(2);
    expect(documentTree.toString()).toContain("AlignmentTab");
  });

  it("retains useful structure around malformed input", () => {
    const source = String.raw`Before \textbf{unfinished and $x_1 after`;
    const tree = parseTexSyntax(source, { top: "TexFragment" });

    expect(errorRanges(tree).length).toBeGreaterThan(0);
    expect(tree.toString()).toContain("GenericCommand");
    expect(tree.toString()).toContain("InlineMath");
    expect(tree.toString()).toContain("MathScript");
  });

  it("supports incremental reparsing with the same result as a fresh parse", () => {
    const before = String.raw`Alpha $x_1$ omega`;
    const from = before.indexOf("1");
    const inserted = "{ij}";
    const after = `${before.slice(0, from)}${inserted}${before.slice(from + 1)}`;
    const initialTree = texFragmentParser.parse(before);
    const fragments = TreeFragment.applyChanges(
      TreeFragment.addTree(initialTree),
      [{
        fromA: from,
        toA: from + 1,
        fromB: from,
        toB: from + inserted.length,
      }]
    );

    const incrementalTree = texFragmentParser.parse(after, fragments);
    const freshTree = texFragmentParser.parse(after);

    expect(errorRanges(incrementalTree)).toEqual([]);
    expect(incrementalTree.toString()).toBe(freshTree.toString());
    expect(incrementalTree.toString()).toContain("MathGroup");
  });
});
