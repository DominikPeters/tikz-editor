import type { EditView } from "../position/view.js";
import type { EditMode, EditTree } from "../tree/types.js";

/** Value arguments allow raw value edits, but not formulas or text formatting. */
export function inValue(view: EditView, at: number): boolean {
  return view.tree.nodes.some(node =>
    node.values.some(value => value.contentSpan.from <= at && at <= value.contentSpan.to) ||
    (node.kind === "break" && node.span.from < at && at < node.span.to) ||
    (node.kind === "row" && node.delimiters.some(span => span.from < at && at < span.to))
  );
}

/** alltt prints TeX specials literally while keeping commands and groups active. */
export function editSyntaxAt(tree: EditTree, mode: EditMode, at: number): "text" | "math" | "alltt" | "literal" {
  if (mode !== "verbatim") return mode;
  return tree.nodes.some(node => node.command === "alltt" && node.span.from < at && at < node.span.to)
    ? "alltt" : "literal";
}
