import { presentSlots, slotChain } from "../tree/navigate.js";
import type { NodeId, SlotId } from "../tree/types.js";
import type { Position } from "./position.js";
import type { EditView } from "./view.js";

/**
 * An optional slot the focus construct could have but does not (V3): a
 * root's index, the script a scripted atom lacks, a description item's
 * label. Shown as a faint box; clicking it creates the slot.
 */
export type GhostSlot = {
  readonly kind: "index" | "sup" | "sub" | "label";
  /** The construct it belongs to. */
  readonly node: NodeId;
  /** Buffer-local offset its source goes at (after `\sqrt`, after the scripts, after `\item`). */
  readonly at: number;
  /**
   * Offsets to place the box by: the construct's start, and for a script
   * the start of the script it pairs with (a superscript's box stands over
   * the subscript).
   */
  readonly anchor: number;
  readonly pair?: number;
};

/** Nodes the focus passes through to the construct around them. */
const PASSED = new Set(["paragraph", "group", "scope"]);

/**
 * The ghost slots of the construct the caret is in: the innermost node
 * around it, past paragraphs and bare groups, when that is a root, a
 * scripted atom or a description item.
 */
export function ghostSlots(view: EditView, caret: Position): GhostSlot[] {
  const { tree } = view;
  const focus = slotChain(tree, caret.slot).map((slot) => tree.slots[slot].node).find((node) => !PASSED.has(tree.nodes[node].kind));
  if (focus == null || view.hidden.has(focus)) {
    return [];
  }
  const node = tree.nodes[focus];
  const absent = (role: string): SlotId | null => node.slots.find((slot) => tree.slots[slot].role === role && tree.slots[slot].presence === "absent") ?? null;
  if (node.kind === "radical") {
    const index = absent("index");
    return index == null ? [] : [{ kind: "index", node: focus, at: tree.slots[index].contentSpan.from, anchor: node.span.from }];
  }
  if (node.kind === "scripted") {
    const slots = presentSlots(tree, focus);
    const sup = slots.find((slot) => slot.role === "sup");
    const sub = slots.find((slot) => slot.role === "sub");
    // An atom with one script lacks the other (with none it is not a scripted atom).
    const present = sup ?? sub;
    if (!present || (sup && sub)) {
      return [];
    }
    return [{ kind: sup ? "sub" : "sup", node: focus, at: node.span.to, anchor: node.span.from, pair: present.contentSpan.from }];
  }
  if (node.kind === "item") {
    const label = absent("label");
    const list = node.parent == null ? null : tree.nodes[tree.slots[node.parent].node];
    if (label == null || list?.command !== "description") {
      return [];
    }
    const flow = presentSlots(tree, focus).find((slot) => slot.role === "flow");
    return [{ kind: "label", node: focus, at: tree.slots[label].contentSpan.from, anchor: flow?.contentSpan.from ?? node.span.from }];
  }
  return [];
}
