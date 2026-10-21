import { requireArrayValue } from "../../utils/collections.js";
import { editSlotAt, editNodeAt } from "../tree/lookup.js";
import type { EditTree, NodeId, SlotId } from "../tree/types.js";

/**
 * Positions (design/canvas-editing-architecture.md, "Positions and
 * selection"): a place between two children of a present slot. Offsets
 * are not unique — the inside end of an unbraced script and the position
 * after the scripted atom share one offset — so offset → position needs an
 * affinity, while position → offset is a function.
 */
export type Position = { readonly slot: SlotId; readonly index: number };

/** Which of the positions sharing an offset: the first or last in document order. */
export type Affinity = "before" | "after";

/**
 * The canonical offset of a position: the start of the next child, else
 * the end of the slot's content; either way after any insignificant
 * whitespace (`$a\cup ‸B$`, `$x^2 ‸$`).
 */
export function positionOffset(tree: EditTree, position: Position): number {
  const slot = editSlotAt(tree.slots, position.slot);
  if (slot.presence === "absent") {
    throw new Error(`Slot ${slot.id} is absent and has no positions`);
  }
  const { children } = slot;
  if (position.index < children.length) {
    return editNodeAt(tree.nodes, requireArrayValue(children, position.index)).span.from;
  }
  // A slot's end is after its trailing whitespace; an empty slot's only
  // position is at its start (`\item ‸`, not before the next line's indent).
  return children.length === 0 ? slot.contentSpan.from : slot.contentSpan.to;
}

/**
 * Where text typed at a position goes: its canonical offset, except at
 * the end of a text slot whose trailing whitespace is a gap (a table cell
 * before `&`), where it goes right after the last child, so that `a ‸&`
 * typed into is `ax &`, not `a x&` with a space that shows.
 */
export function insertionOffset(tree: EditTree, position: Position): number {
  const offset = positionOffset(tree, position);
  const slot = editSlotAt(tree.slots, position.slot);
  const last = slot.children.at(-1);
  if (slot.mode !== "text" || slot.flow || last == null || position.index < slot.children.length) {
    return offset;
  }
  const end = editNodeAt(tree.nodes, last).span.to;
  return /^\s*$/u.test(tree.text.slice(end, offset)) ? end : offset;
}

export type PositionIndex = {
  /** Every position in document order. */
  readonly positions: readonly Position[];
  readonly offsets: readonly number[];
  positionsAt(offset: number): readonly Position[];
  positionAt(offset: number, affinity: Affinity): Position | null;
  /**
   * The position for any source offset. An offset with positions resolves
   * by affinity; an offset in or at the edge of a slot gap (insignificant
   * whitespace) resolves to the position that gap belongs to. Offsets
   * inside a leaf or inside a construct's own syntax (command names,
   * braces, values) have no position: null.
   */
  resolve(offset: number, affinity: Affinity): Position | null;
};

/**
 * All positions in document order: a slot's position i, then the positions
 * inside child i (its present slots in order), then position i + 1.
 */
export function createPositionIndex(tree: EditTree): PositionIndex {
  const positions: Position[] = [];
  const offsets: number[] = [];
  const visitNode = (node: NodeId) => {
    for (const slot of editNodeAt(tree.nodes, node).slots) {
      visitSlot(slot);
    }
  };
  const visitSlot = (slotId: SlotId) => {
    const slot = editSlotAt(tree.slots, slotId);
    if (slot.presence === "absent") {
      return;
    }
    slot.children.forEach((child, index) => {
      positions.push({ slot: slotId, index });
      offsets.push(positionOffset(tree, { slot: slotId, index }));
      visitNode(child);
    });
    positions.push({ slot: slotId, index: slot.children.length });
    offsets.push(positionOffset(tree, { slot: slotId, index: slot.children.length }));
  };
  visitNode(tree.root);
  // The position each gap character belongs to: the one before the next child.
  const gapPosition = new Map<number, Position>();
  for (const slot of tree.slots) {
    if (slot.presence === "absent") {
      continue;
    }
    let cursor = slot.contentSpan.from;
    const markGap = (to: number, index: number) => {
      for (let offset = cursor; offset < to; offset += 1) {
        gapPosition.set(offset, { slot: slot.id, index });
      }
    };
    slot.children.forEach((child, index) => {
      markGap(editNodeAt(tree.nodes, child).span.from, index);
      cursor = Math.max(cursor, editNodeAt(tree.nodes, child).span.to);
    });
    markGap(slot.contentSpan.to, slot.children.length);
  }
  const byOffset = new Map<number, Position[]>();
  positions.forEach((position, index) => {
    const offset = requireArrayValue(offsets, index);
    const list = byOffset.get(offset);
    if (list) {
      list.push(position);
    } else {
      byOffset.set(offset, [position]);
    }
  });
  const positionAt = (offset: number, affinity: Affinity): Position | null => {
    const candidates = byOffset.get(offset);
    if (!candidates) {
      return null;
    }
    return affinity === "before" ? requireArrayValue(candidates, 0) : requireArrayValue(candidates, candidates.length - 1);
  };
  return {
    positions,
    offsets,
    positionsAt: (offset) => byOffset.get(offset) ?? [],
    positionAt,
    resolve: (offset, affinity) =>
      positionAt(offset, affinity) ?? gapPosition.get(offset) ?? gapPosition.get(offset - 1) ?? null,
  };
}
