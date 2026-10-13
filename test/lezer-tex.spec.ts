/* eslint @typescript-eslint/no-base-to-string: ["warn", { "ignoredTypeNames": ["Tree"] }] -- Lezer implements Tree.toString() but omits it from its declarations. */
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

function countNodes(tree: Tree, name: string): number {
  let count = 0;
  const cursor = tree.cursor();
  do {
    if (cursor.name === name) {
      count += 1;
    }
  } while (cursor.next());
  return count;
}

describe("@tikz-editor/lezer-tex", () => {
  it("closes adjacent inline dollar math before opening the next formula", () => {
    const tree = texFragmentParser.parse("$x$$y$$z$ $$w$$");
    expect(errorRanges(tree)).toEqual([]);
    expect(countNodes(tree, "InlineMath")).toBe(3);
    expect(countNodes(tree, "DisplayMath")).toBe(1);
  });
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

  it("keeps overlays Beamer-specific and opaque bodies lexical", () => {
    const angleText = String.raw`\item<2-> omega`;
    const opaque = String.raw`\begin{verbatim}
{ % literal opaque source
\end{frame}
\end{verbatim}
\begin{frame}Visible\end{frame}`;
    const genericAngleTree = texDocumentParser.parse(angleText);
    const beamerAngleTree = beamerDocumentParser.parse(angleText);
    const opaqueTree = beamerDocumentParser.parse(opaque);

    expect(errorRanges(genericAngleTree)).toEqual([]);
    expect(genericAngleTree.toString()).not.toContain("OverlaySpecification");
    expect(beamerAngleTree.toString()).toContain("OverlaySpecification");
    expect(errorRanges(beamerAngleTree)).toEqual([]);
    expect(opaqueTree.toString()).toContain(
      "OpaqueEnvironment(OpaqueEnvironmentToken)"
    );
    expect(errorRanges(opaqueTree)).toEqual([]);
  });

  it.each([
    ["the default overlay of a list", String.raw`\begin{itemize}[<+->] \item a \end{itemize}`, 1],
    ["a command and its arguments", String.raw`\only<1>{a}<2> \item[x]<3> \begin{block}<4>{T}<5> \end{block}`, 5],
    ["incremental, mode and action specifications", String.raw`\item<+(1)-> a \item<.-| alert@+> b \uncover<1|handout:0>{c}`, 3],
    ["an empty specification", String.raw`\newcommand<>{\x}{y}`, 1],
    ["a starred command, across a space", String.raw`\item* <2> a`, 1],
    ["a modified command", String.raw`\onslide+<2-> a \onslide*<3>{b}`, 2],
    ["a command across a comment", "\\uncover % wrapper\n<2-> {a}", 1],
  ])("reads an overlay specification behind %s", (_, source, count) => {
    const tree = beamerDocumentParser.parse(source);
    expect(errorRanges(tree)).toEqual([]);
    expect(countNodes(tree, "OverlaySpecification")).toBe(count);
  });

  it.each([
    ["a comparison in text", "Alpha <2-> omega and x < y > z"],
    ["a tag in a group", String.raw`\texttt{<tag>} and {<a>}`],
    ["listings escapes", String.raw`\lstset{escapeinside={<@}{@>}}`],
    ["a command in the brackets", String.raw`\textbf{a} < \textcolor{red}{b} > c`],
    ["an escaped backslash", String.raw`a\\item<2> b`],
    ["a command across a paragraph break", "\\item\n\n<2> a"],
    ["a command whose comment sign is escaped", "\\item \\% x\n\n<2> a"],
  ])("reads %s as text, not an overlay specification", (_, source) => {
    const tree = beamerDocumentParser.parse(source);
    expect(errorRanges(tree)).toEqual([]);
    expect(countNodes(tree, "OverlaySpecification")).toBe(0);
  });

  it.each(["math", "array", "equation", "align", "cases", "matrix"])("reads %s as a word outside an environment name", (word) => {
    const tree = beamerDocumentParser.parse(String.raw`\begin{frame}{Inline ${word}} An ${word} here. \begin{${word}}x\end{${word}}\end{frame}`);
    expect(errorRanges(tree)).toEqual([]);
    expect(countNodes(tree, "MathEnvironment")).toBe(1);
  });

  it.each([
    ["an environment opened in one body and closed in the other", String.raw`\newenvironment{wide}{\begin{frame}}{\end{frame}}`],
    ["a math environment split the same way", "\\newenvironment{rcases}\n  {\\left.\\begin{aligned}}\n  {\\end{aligned}\\right\\rbrace}"],
    ["arguments, a default and comments between the parts", "\\renewenvironment*{abstract}[1][x]% args\n{\\begin{list}{}{}}%\n{\\end{list}}"],
    ["a command opening an environment", String.raw`\newcommand{\bi}{\begin{itemize}}\providecommand\ei{\end{itemize}}`],
    ["a command with arguments and a balanced environment", String.raw`\renewcommand*{\x}[2][d]{\begin{center}#1#2\end{center}}`],
  ])("parses a definition with %s", (_, definition) => {
    const tree = beamerDocumentParser.parse(`${definition}\n\\begin{document}\\begin{frame}A\\end{frame}\\end{document}`);
    expect(errorRanges(tree)).toEqual([]);
    expect(countNodes(tree, "Definition")).toBeGreaterThan(0);
    expect(countNodes(tree, "Environment")).toBeGreaterThanOrEqual(2);
  });

  it("keeps a definition command in an argument an ordinary command", () => {
    const tree = beamerDocumentParser.parse(String.raw`\foo[\newcommand]{x} $\renewcommand$`);
    expect(errorRanges(tree)).toEqual([]);
    expect(countNodes(tree, "Definition")).toBe(0);
  });

  it("reads angle brackets in Beamer math as relations, not overlay specifications", () => {
    const source = String.raw`\item<2-> If \[ f(x)^Td<0, \] and $a > b$ then $c<d$ \only<3>{shown}.`;
    const tree = beamerDocumentParser.parse(source);

    expect(errorRanges(tree)).toEqual([]);
    expect(countNodes(tree, "OverlaySpecification")).toBe(2);
    expect(countNodes(tree, "DisplayMath")).toBe(1);
    expect(countNodes(tree, "InlineMath")).toBe(2);
  });

  it.each([
    ["BVerbatim", String.raw`[fontsize=\small]`],
    ["Verbatim", "[numbers=left]"],
    ["alltt", ""],
    ["lstlisting", "[language=TeX]"],
    ["minted", "[linenos]{tex}"],
    ["semiverbatim", ""],
    ["verbatim", ""],
    ["verbatim*", ""],
  ])("tokenizes %s through its matching terminator", (name, header) => {
    const source = String.raw`\begin{${name}}${header}
{ unmatched
literal % \end{frame}
\begin{frame}{not structural}
\end{${name}}
\begin{frame}Visible\end{frame}`;
    const tree = beamerDocumentParser.parse(source);

    expect(errorRanges(tree)).toEqual([]);
    expect(countNodes(tree, "OpaqueEnvironmentToken")).toBe(1);
    expect(countNodes(tree, "BeginEnvironment")).toBe(1);
    expect(countNodes(tree, "EndEnvironment")).toBe(1);
  });

  it("keeps an unterminated opaque body through the source limit", () => {
    const source = String.raw`\begin{verbatim}
literal % source
\end{frame}
\begin{frame}{not structural}`;
    const tree = beamerDocumentParser.parse(source);

    expect(countNodes(tree, "UnterminatedOpaqueEnvironmentToken")).toBe(1);
    expect(countNodes(tree, "BeginEnvironment")).toBe(0);
    expect(errorRanges(tree).length).toBeGreaterThan(0);
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
