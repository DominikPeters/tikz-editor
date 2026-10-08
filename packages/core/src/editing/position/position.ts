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
 * The canonical offset of a position: the start of the next child (after
 * any insignificant source), else the end of the last child, else the
 * start of the empty slot.
 */
export function positionOffset(tree: EditTree, position: Position): number {
  const slot = tree.slots[position.slot];
  if (slot.presence === "absent") {
    throw new Error(`Slot ${slot.id} is absent and has no positions`);
  }
  const { children } = slot;
  if (position.index < children.length) {
    return tree.nodes[children[position.index]].span.from;
  }
  const last = children.at(-1);
  return last != null ? tree.nodes[last].span.to : slot.contentSpan.from;
}

export type PositionIndex = {
  /** Every position in document order. */
  readonly positions: readonly Position[];
  readonly offsets: readonly number[];
  positionsAt(offset: number): readonly Position[];
  positionAt(offset: number, affinity: Affinity): Position | null;
};

/**
 * All positions in document order: a slot's position i, then the positions
 * inside child i (its present slots in order), then position i + 1.
 */
export function createPositionIndex(tree: EditTree): PositionIndex {
  const positions: Position[] = [];
  const offsets: number[] = [];
  const visitNode = (node: NodeId) => {
    for (const slot of tree.nodes[node].slots) {
      visitSlot(slot);
    }
  };
  const visitSlot = (slotId: SlotId) => {
    const slot = tree.slots[slotId];
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
  const byOffset = new Map<number, Position[]>();
  positions.forEach((position, index) => {
    const offset = offsets[index];
    const list = byOffset.get(offset);
    if (list) {
      list.push(position);
    } else {
      byOffset.set(offset, [position]);
    }
  });
  return {
    positions,
    offsets,
    positionsAt: (offset) => byOffset.get(offset) ?? [],
    positionAt(offset, affinity) {
      const candidates = byOffset.get(offset);
      if (!candidates) {
        return null;
      }
      return affinity === "before" ? candidates[0] : candidates[candidates.length - 1];
    },
  };
}
