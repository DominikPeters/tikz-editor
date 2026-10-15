import type { EditNode, EditSlot, NodeId, SlotId } from "./types.js";

/** Resolve a node reference from an EditTree, rejecting broken tree links. */
export function editNodeAt<T extends EditNode>(nodes: readonly T[], id: NodeId): T {
  const node = nodes[id];
  if (node === undefined) {
    throw new RangeError(`Edit tree references missing node ${id}`);
  }
  return node;
}

/** Resolve a slot reference from an EditTree, rejecting broken tree links. */
export function editSlotAt<T extends EditSlot>(slots: readonly T[], id: SlotId): T {
  const slot = slots[id];
  if (slot === undefined) {
    throw new RangeError(`Edit tree references missing slot ${id}`);
  }
  return slot;
}
