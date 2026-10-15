import { editNodeAt, editSlotAt } from "../tree/lookup.js";
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
    const parent = editNodeAt(tree.nodes, construct).parent!;
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
    const owner: NodeId = editSlotAt(tree.slots, current).node;
    const role = view.role(owner);
    if (role === "construct" || role === "scripted") {
      found = owner;
    }
    current = editNodeAt(tree.nodes, owner).parent;
  }
  return found;
}

/**
 * A selection made by offsets (a pointer drag, the hidden input), as it is
 * drawn and acted on: its promotion (N3), as offsets with the anchor first.
 */
export function promotedOffsets(view: EditView, anchor: number, focus: number): { anchor: number; focus: number } {
  if (anchor === focus) {
    return { anchor, focus };
  }
  const promoted = promoteSelection(view, selectionEndsAt(view, anchor, focus));
  const from = view.offset(promoted.anchor);
  const to = view.offset(promoted.focus);
  // Promotion only widens: keep the raw end where it already reaches further.
  return anchor <= focus
    ? { anchor: Math.min(anchor, from, to), focus: Math.max(focus, from, to) }
    : { anchor: Math.max(anchor, from, to), focus: Math.min(focus, from, to) };
}

/**
 * The raw ends of a selection given by offsets. A range's start belongs to
 * what follows it and its end to what precedes it: the end of
 * `⟦Beta & 22\\⟧ Gamma` is after the row, not at the start of `Gamma`'s
 * row, so promoting a promoted selection again changes nothing.
 */
export function selectionEndsAt(view: EditView, anchor: number, focus: number): SelectionEnds {
  if (anchor === focus) {
    const caret = view.positionAt(anchor);
    return { anchor: caret, focus: caret };
  }
  const at = (offset: number, affinity: "before" | "after") => view.index.resolve(offset, affinity) ?? view.positionAt(offset);
  const forward = anchor < focus;
  return { anchor: at(anchor, forward ? "after" : "before"), focus: at(focus, forward ? "before" : "after") };
}
