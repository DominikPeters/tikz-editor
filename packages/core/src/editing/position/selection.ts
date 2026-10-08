import { itemRole } from "../ownership/kinds.js";
import { childIndex, slotChain } from "../tree/navigate.js";
import type { NodeId, SlotId } from "../tree/types.js";
import type { Position } from "./position.js";
import type { EditView } from "./view.js";

export type SelectionEnds = { readonly anchor: Position; readonly focus: Position };

/**
 * Selection promotion (R9 snapping, N3): a selection inside one slot is
 * free. When its ends sit in different slots, each end that is inside a
 * content construct below their lowest common slot is lifted to just
 * before (the earlier end) or after (the later end) the outermost such
 * construct. Style wrappers and flow are transparent, so a range may cover
 * part of a bold run or of two paragraphs (F5). Promotion is a function of
 * the raw ends, so moving the focus back undoes it.
 */
export function promoteSelection(view: EditView, raw: SelectionEnds): SelectionEnds {
  const { tree } = view;
  if (raw.anchor.slot === raw.focus.slot) {
    return raw;
  }
  const anchorChain = slotChain(tree, raw.anchor.slot);
  const focusChain = new Set(slotChain(tree, raw.focus.slot));
  const common = anchorChain.find((slot) => focusChain.has(slot));
  if (common == null) {
    return raw;
  }
  const forward = view.rank(raw.anchor) <= view.rank(raw.focus);
  const lift = (end: Position, isStart: boolean): Position => {
    const construct = outermostConstructBelow(view, end.slot, common);
    if (construct == null) {
      return end;
    }
    const parent = tree.nodes[construct].parent!;
    const at = childIndex(tree, construct);
    return { slot: parent, index: isStart ? at : at + 1 };
  };
  return {
    anchor: lift(raw.anchor, forward),
    focus: lift(raw.focus, !forward),
  };
}

/** The outermost non-transparent node between a slot and an enclosing slot. */
function outermostConstructBelow(view: EditView, slot: SlotId, common: SlotId): NodeId | null {
  const { tree } = view;
  let found: NodeId | null = null;
  let current: SlotId | null = slot;
  while (current != null && current !== common) {
    const owner: NodeId = tree.slots[current].node;
    const role = itemRole(tree, owner);
    if (role === "construct" || role === "scripted") {
      found = owner;
    }
    current = tree.nodes[owner].parent;
  }
  return found;
}
