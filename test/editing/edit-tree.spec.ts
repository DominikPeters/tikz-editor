import { describe, expect, it } from "vitest";
import { buildEditTree } from "../../packages/core/src/editing/tree/build.js";
import { checkEditTree } from "../../packages/core/src/editing/tree/invariants.js";
import { compareEditTreeWithEngines } from "../../packages/core/src/editing/tree/agreement.js";
import { printEditTree } from "../../packages/core/src/editing/tree/print.js";
import {
  caretContext,
  createEditView,
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
    expect(path(R`\begin{itemize}\item a $\frac{1}{n‸}$\end{itemize}`)).toBe("itemize › item › math* › frac* › denominator*");
    expect(path(R`$x^{2‸}$`)).toBe("math* › sup*");
    expect(path(R`\begin{block}{T‸i} x \end{block}`)).toBe("block › title*");
  });

  it("tells the inside of a construct's edge from the outside (R8)", () => {
    expect(path(R`\textbf{a‸} b`)).toBe("textbf*");
    expect(path(R`\textbf{a}‸ b`)).toBe("");
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

  it("agrees with the math parser and the text IR", () => {
    const disagreements = scopes.flatMap((scope) =>
      compareEditTreeWithEngines(buildEditTree(scope.text, { commands: scope.commands }))
        .map((entry) => `${scope.file} frame ${scope.frameIndex}: ${entry.engine} ${entry.side} ${entry.fact}`)
    );
    expect(disagreements).toEqual([]);
  });
});
