import type { SyntaxNode } from "@lezer/common";
import { describe, expect, it } from "vitest";

import { parseSyntax } from "@tikz-editor/lezer-tikz";

function hasNode(root: SyntaxNode, name: string): boolean {
  if (root.name === name) {
    return true;
  }
  let child = root.firstChild;
  while (child) {
    if (hasNode(child, name)) {
      return true;
    }
    child = child.nextSibling;
  }
  return false;
}

function expectCleanTree(source: string, expectedNodes: readonly string[]): void {
  const tree = parseSyntax(source);
  expect(tree.topNode.name).toBe("TikzFile");
  expect(hasNode(tree.topNode, "⚠")).toBe(false);
  for (const nodeName of expectedNodes) {
    expect(hasNode(tree.topNode, nodeName), nodeName).toBe(true);
  }
}

describe("@tikz-editor/lezer-tikz", () => {
  it("parses inline TikZ", () => {
    expectCleanTree(String.raw`\tikz \draw (0,0) -- (1,1);`, [
      "TikzInline",
      "InlineTikzCmd",
      "PathStatement",
      "Coordinate",
    ]);
  });

  it("parses tikzpicture environments", () => {
    expectCleanTree(String.raw`\begin{tikzpicture}\draw (0,0) rectangle (1,1);\end{tikzpicture}`, [
      "TikzEnvironment",
      "BeginTikz",
      "EndTikz",
      "PathStatement",
    ]);
  });

  it("parses comments", () => {
    expectCleanTree("% a comment\n\\draw (0,0) -- (1,0);", ["Comment", "PathStatement"]);
  });

  it("parses representative paths with nodes", () => {
    expectCleanTree(
      String.raw`\begin{tikzpicture}\draw[red] (0,0) -- (1,1) node[midway] {x};\end{tikzpicture}`,
      ["OptionList", "PathOperator", "NodeItem", "NodeTextGroup"],
    );
  });
});
