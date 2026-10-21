import { describe, expect, it } from "vitest";
import { buildEditTree } from "../../packages/core/src/editing/tree/build.js";
import { checkEditTree } from "../../packages/core/src/editing/tree/invariants.js";
import { compareEditTreeWithEngines } from "../../packages/core/src/editing/tree/agreement.js";
import { printEditTree } from "../../packages/core/src/editing/tree/print.js";
import {
  caretContext,
  createEditView,
  emptyMathSlots,
  createPositionIndex,
  positionOffset,
} from "../../packages/core/src/editing/position/index.js";
import { parseMarkedSource } from "../../packages/core/src/editing/testing/index.js";
import { beamerCorpusScopes } from "./beamer-corpus.js";

const R = String.raw;

function tree(text: string) {
  const built = buildEditTree(text);
  expect(checkEditTree(built)).toEqual([]);
  return built;
}

describe("edit tree binding", () => {

  it("binds listing characters literally and alltt controls structurally", () => {
    const source = R`\begin{lstlisting}[language=Python]
\note{literal} % $ _ { }
\end{lstlisting}`;
    const built = tree(source);
    expect(built.diagnostics).toEqual([]);
    expect(built.nodes.some(node => node.command === "note" || node.kind === "formula")).toBe(false);
    for (const char of ["%", "$", "_", "{", "}"]) {
      const from = source.indexOf(char, source.indexOf("\n"));
      expect(built.nodes.some(node => node.kind === "char" && node.span.from === from)).toBe(true);
    }
    const alltt = tree(R`\begin{alltt}\textbf{bold} % $ _\end{alltt}`);
    expect(alltt.diagnostics).toEqual([]);
    expect(alltt.nodes.some(node => node.command === "textbf")).toBe(true);
    expect(alltt.nodes.some(node => node.kind === "formula")).toBe(false);
  });

  it("binds scripts by TeX's single-token rule", () => {
    expect(printEditTree(tree(R`$x^23 + x_i^{n+1}$`))).toBe(
      `(scope (paragraph (formula (scripted base:["x"] sup:["2"]) "3+" (scripted base:["x"] sub:["i"] sup:["n+1"]))))`
    );
  });

  it("binds unbraced arguments and optional slots", () => {
    expect(printEditTree(tree(R`$\frac1n \sqrt[3]{x} \sqrt{y}$`))).toBe(
      `(scope (paragraph (formula (fraction:frac numerator:["1"] denominator:["n"]) (radical:sqrt index:["3"] radicand:["x"]) (radical:sqrt index:∅ radicand:["y"]))))`
    );
  });

  it.each([
    ["$\\frac% numerator\n{a}% denominator\r\n{b}$", "fraction", ["a", "b"]],
    ["$\\sqrt% index\n[3]% radicand\n{x}$", "radical", ["3", "x"]],
    ["$x^% exponent\n% continued\n2$", "scripted", ["x", "2"]],
    ["\\textbf% content\n{x}", "style", ["x"]],
    ["\\begin{block}% title\n{T}Body\\end{block}", "container", ["T", "Body"]],
  ] as const)("binds arguments past TeX comments: %s", (source, kind, contents) => {
    const built = tree(source);
    expect(built.diagnostics).toEqual([]);
    const node = built.nodes.find((candidate) => candidate.kind === kind)!;
    expect(node.slots.map((slot) => {
      const span = built.slots[slot].contentSpan;
      return source.slice(span.from, span.to);
    })).toEqual(contents);
  });

  it("ends an unclosed argument where recovery closes it, as the renderer does", () => {
    const source = "A \\emph{an open\n\\begin{itemize}\n\\item x\n\\end{itemize}";
    const built = tree(source);
    const emph = built.nodes.find((node) => node.command === "emph")!;
    expect(source.slice(emph.span.from, emph.span.to)).toBe("\\emph{an open");
    expect(built.nodes.some((node) => node.kind === "list")).toBe(true);
    expect(built.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unclosed-group");
  });

  it("reads a % in an environment's name as a comment, its \\end included (keystroke fuzz)", () => {
    const built = tree(R`Before.\begin{table}\caption*{A table.}\begin{tabular%}{lr}a&b\end{tabular}\end{table}After.` + "\n");
    expect(printEditTree(built)).toBe(R`(scope (paragraph "Before." ⟨\begin{table}⟩ (style:caption "A" ␣ "table.") ⟨\begin{tabular⟩ %))`);
    expect(built.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unclosed-environment");
  });

  it("stops at a blank line after a comment, a paragraph end to TeX", () => {
    const built = tree("\\textbf% content\n\n{x}");
    expect(printEditTree(built)).toBe(`(scope (paragraph (style:textbf) %) (paragraph (group "x")))`);
    expect(built.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["missing-argument"]);
  });

  it("keeps a comment at a missing argument within its enclosing slot", () => {
    const built = tree("$\\frac% no argument\n$");
    expect(built.diagnostics.map((diagnostic) => diagnostic.code)).toContain("missing-argument");
  });

  it("binds the argument shapes of named math families", () => {
    const built = tree(R`$a\pmod{n}+\mod m+\underset{a}{b}+\makebox[1cm][l]{x}+\framebox[2cm][r]{y}$`);
    expect(built.diagnostics).toEqual([]);
    const shapes = built.nodes.filter((node) => ["pmod", "mod", "underset", "makebox", "framebox"].includes(node.command ?? ""))
      .map((node) => ({ command: node.command, slots: node.slots.map((slot) => built.slots[slot].role), values: node.values.map((value) => value.role) }));
    expect(shapes).toEqual([
      { command: "pmod", slots: ["content"], values: [] },
      { command: "mod", slots: ["content"], values: [] },
      { command: "underset", slots: ["below", "base"], values: [] },
      { command: "makebox", slots: ["content"], values: ["dimension", "value"] },
      { command: "framebox", slots: ["content"], values: ["dimension", "value"] },
    ]);
  });

  it("binds nothing beyond an unbraced argument that is itself a command", () => {
    expect(printEditTree(tree(R`a{\textbf\textit{[}} b`))).toBe(
      `(scope (paragraph "a" (group (style:textbf (style:textit)) (group "[")) ␣ "b"))`
    );
  });

  it("builds lists, items and style wrappers in prose", () => {
    expect(printEditTree(tree(`Let $x$ be \\textbf{bold}.\n\\begin{itemize}\n  \\item[a] One\n  \\item \n\\end{itemize}`))).toBe(
      `(scope (paragraph "Let" ␣ (formula "x") ␣ "be" ␣ (style:textbf "bold") ".") (list:itemize (item label:["a"] flow:[(paragraph "One")]) (item label:∅ flow:[])))`
    );
  });

  it("splits alignments into rows and cells", () => {
    expect(printEditTree(tree(R`\[ \begin{aligned} a &= b \\ c &= d \end{aligned} \]`))).toBe(
      `(scope (display (alignment:aligned (row cell:["a"] cell:["=b"]) (row cell:["c"] cell:["=d"]))))`
    );
  });

  it("opens floats and bibliographies as editable flow", () => {
    expect(printEditTree(tree(`\\begin{figure}[h]\\centering\n  \\caption{Plot}\n\\end{figure}`))).toBe(
      `(scope (container:figure options=h (paragraph \\centering (style:caption "Plot"))))`
    );
    expect(printEditTree(tree(`\\begin{thebibliography}{9}\n\\bibitem[AB]{key} A. Author.\n\\newblock Title.\n\\end{thebibliography}`))).toBe(
      `(scope (list:thebibliography value=9 (item:bibitem label-key=key label:["AB"] flow:[(paragraph "A." ␣ "Author." ␣ \\newblock "Title.")])))`
    );
  });

  it("keeps broken source sound and says why", () => {
    const broken = tree(R`Broken $x^{2 and \foo{bar}`);
    expect(broken.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["unclosed-group", "unknown-command", "unclosed-math"])
    );
  });

  it("gives the inside end of an unbraced script and the position after it the same offset", () => {
    const built = tree(R`$x^2$`);
    const index = createPositionIndex(built);
    const atEnd = index.positionsAt(4);
    expect(atEnd.length).toBeGreaterThan(1);
    const supSlot = built.slots.find((slot) => slot.role === "sup")!;
    expect(index.positionAt(4, "before")).toEqual({ slot: supSlot.id, index: 1 });
    expect(positionOffset(built, index.positionAt(4, "after")!)).toBe(4);
  });

  it("resolves offsets in insignificant whitespace to the position they belong to", () => {
    const built = tree(R`$a \le  b$`);
    const index = createPositionIndex(built);
    const beforeB = index.positionAt(R`$a \le  `.length, "before")!;
    // Just after `\le`, inside the math spaces, and at the start of `b` are one place.
    for (const offset of [R`$a \le`.length, R`$a \le `.length]) {
      expect(index.positionAt(offset, "before")).toBeNull();
      expect(index.resolve(offset, "before")).toEqual(beforeB);
    }
    // Inside a command name there is no position.
    expect(index.resolve(R`$a \l`.length, "before")).toBeNull();
  });
});

describe("caret context", () => {
  const path = (marked: string) => {
    const { source, selection } = parseMarkedSource(marked);
    const view = createEditView(tree(source));
    return caretContext(view, view.positionAt(selection.focus))
      .map((crumb) => `${crumb.label}${crumb.outlined ? "*" : ""}`)
      .join(" › ");
  };

  it("names lists, formulas, wrappers and slots, outermost first (V11)", () => {
    expect(path(R`\begin{itemize}\item a $\frac{1}{n‸}$\end{itemize}`)).toBe(R`itemize › \item › math* › \frac* › denominator*`);
    expect(path(R`$x^{2‸}$`)).toBe("math* › sup*");
    expect(path(R`$\left(a‸\right)$`)).toBe(R`math* › \left( … \right)*`);
    expect(path(R`\begin{block}{T‸i} x \end{block}`)).toBe("block › title*");
  });

  it("tells the inside of a construct's edge from the outside (R8)", () => {
    expect(path(R`\textbf{a‸} b`)).toBe(R`\textbf*`);
    expect(path(R`\textbf{a}‸ b`)).toBe("");
  });
});

describe("empty slots of math (V3)", () => {
  const empty = (text: string) => {
    const view = createEditView(tree(text));
    return emptyMathSlots(view).map((slot) => `${view.tree.slots[slot.slot].role}${slot.centered ? "*" : ""}@${slot.at}`);
  };

  it.each([
    [R`$\frac{}{}$`, ["numerator*@7", "denominator*@9"]],
    [R`$x^{}+y_{}$`, ["sup@4", "sub@9"]],
    ["a ${}$ b", ["content@4"]],
    [R`$\left(\right)$`, ["content@7"]],
    [R`$\sqrt{}$`, ["radicand@7"]],
  ])("shows a placeholder where %s puts its content", (text, expected) => {
    expect(empty(text)).toEqual(expected);
  });

  it.each([R`$a&{}=b$`, R`$\text{}$`, R`\textbf{}`, R`$\frac12$`])("not for an empty atom, text, or what is filled: %s", (text) => {
    expect(empty(text)).toEqual([]);
  });
});

describe("edit tree over the Beamer fixture corpus", () => {
  const scopes = beamerCorpusScopes();

  it("satisfies the tree invariants in every scope", () => {
    const failures = scopes.flatMap((scope) => {
      const violations = checkEditTree(buildEditTree(scope.text, { commands: scope.commands }));
      return violations.length ? [`${scope.file} frame ${scope.frameIndex} ${scope.kind}: ${violations[0]}`] : [];
    });
    expect(failures).toEqual([]);
  });

  it("skips unavailable math content slots during engine comparison", () => {
    const tree = buildEditTree("$x$");
    expect(tree.nodes.some((node) => node.kind === "formula")).toBe(true);
    const unavailable = { ...tree, nodes: tree.nodes.map((node) =>
      node.kind === "formula" ? { ...node, slots: [] } : node) };
    expect(() => compareEditTreeWithEngines(unavailable)).not.toThrow();
  });

  it("compares supported math next to an unsupported package macro's literal argument", () => {
    const source = R`$\unregisteredket{\Phi^+}+x^2$`;
    const built = tree(source);
    expect(compareEditTreeWithEngines(built)).toEqual([]);
    const adjacent = built.nodes.find(node => node.kind === "scripted" && source.slice(node.span.from, node.span.to) === "x^2")!;
    const broken = { ...built, nodes: built.nodes.map(node => node.id === adjacent.id ? { ...node, span: { ...node.span, to: node.span.to - 1 } } : node) };
    expect(compareEditTreeWithEngines(broken)).toContainEqual(expect.objectContaining({ engine: "math", side: "tree-only" }));
  });

  it("agrees with the math parser and the text IR", () => {
    const disagreements = scopes.flatMap((scope) =>
      compareEditTreeWithEngines(buildEditTree(scope.text, { commands: scope.commands }))
        .map((entry) => `${scope.file} frame ${scope.frameIndex}: ${entry.engine} ${entry.side} ${entry.fact}`)
    );
    expect(disagreements).toEqual([]);
  });
});
