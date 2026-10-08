import { describe, expect, it } from "vitest";
import { buildEditTree } from "../../packages/core/src/editing/tree/build.js";
import { checkEditTree } from "../../packages/core/src/editing/tree/invariants.js";
import { compareEditTreeWithEngines } from "../../packages/core/src/editing/tree/agreement.js";
import { printEditTree } from "../../packages/core/src/editing/tree/print.js";
import { createPositionIndex, positionOffset } from "../../packages/core/src/editing/position/index.js";
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
