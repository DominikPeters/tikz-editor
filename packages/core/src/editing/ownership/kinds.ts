import { isLeaf } from "../tree/navigate.js";
import type { EditNodeKind, EditTree, NodeId, SlotId } from "../tree/types.js";

/**
 * What each node kind declares to the editing operations
 * (design/canvas-editing-architecture.md, "Ownership, operations"): caret
 * motion, selection promotion and deletion read the node's role here
 * instead of branching on kinds themselves.
 *
 * - `invisible`: renders nothing (comments, declarations, `\label`). Costs
 *   no keystroke and is never deleted by ⌫/⌦ (R7, R11).
 * - `unit`: one visible item (a character, a symbol, a symbol macro).
 *   ⌫/⌦ delete it.
 * - `transparent`: a style wrapper. ⌫/⌦ and selections look through it,
 *   and it disappears when emptied (R9).
 * - `scripted`: a base with its scripts. ⌫ from after it looks into the
 *   last script; ⌦ from before it selects it (O3).
 * - `construct`: content (formulas, fractions, links, macro calls). ⌫/⌦
 *   from outside select it first; selections crossing its edge cover it.
 * - `flow`: block structure (paragraphs, items, displays). Its edges belong
 *   to the structural keys.
 */
export type ItemRole = "invisible" | "unit" | "transparent" | "scripted" | "construct" | "flow";

const ROLES: Record<EditNodeKind, ItemRole> = {
  scope: "flow",
  paragraph: "flow",
  list: "flow",
  item: "flow",
  container: "flow",
  display: "flow",
  alignment: "construct",
  row: "construct",
  vertical: "invisible",
  style: "transparent",
  declaration: "invisible",
  overlay: "transparent",
  group: "transparent",
  formula: "construct",
  "text-in-math": "construct",
  link: "construct",
  break: "unit",
  fraction: "construct",
  radical: "construct",
  scripted: "scripted",
  delimited: "construct",
  accent: "construct",
  overset: "construct",
  operator: "unit",
  char: "unit",
  symbol: "unit",
  atom: "construct",
  space: "unit",
  invisible: "invisible",
};

/** Atoms that typeset nothing. */
const INVISIBLE_ATOMS = new Set(["label", "nocite", "index", "phantomsection", "newcommand", "renewcommand",
  "providecommand", "def"]);

export function itemRole(tree: EditTree, node: NodeId): ItemRole {
  const record = tree.nodes[node];
  if (record.kind === "atom") {
    if (record.command && INVISIBLE_ATOMS.has(record.command)) {
      return "invisible";
    }
    // A bare control sequence (`\R`, `\act`) is a symbol macro: one unit (K1).
    const bare = record.command != null && record.span.to - record.span.from === record.command.length + 1;
    return bare ? "unit" : "construct";
  }
  if (record.kind === "group" && tree.slots[record.slots[0]].children.length === 0) {
    // An empty group (`\LaTeX{}`) is a terminator and typesets nothing.
    return "invisible";
  }
  if (record.kind === "operator" && !isLeaf(tree, node)) {
    return "construct";
  }
  return ROLES[record.kind];
}

/**
 * Whether the slot's positions are caret stops. Flow slots hold blocks and
 * an alignment's slot holds rows; between those there is no caret, unless
 * the slot is empty (an empty item still takes the caret).
 */
export function isCaretSlot(tree: EditTree, slot: SlotId): boolean {
  const record = tree.slots[slot];
  if (record.presence === "absent") {
    return false;
  }
  if (record.children.length === 0) {
    return true;
  }
  return !record.flow && tree.nodes[record.node].kind !== "alignment";
}

/** Argument slots that may be unbraced (`\frac1n`, `x^2`): emptied or extended, they need braces. */
export const ARGUMENT_ROLES: ReadonlySet<string> = new Set([
  "numerator", "denominator", "radicand", "index", "sup", "sub", "above", "below",
]);
