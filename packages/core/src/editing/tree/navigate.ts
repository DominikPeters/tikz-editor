import type { EditNode, EditSlot, EditTree, NodeId, SlotId } from "./types.js";

/** Small structural queries over an EditTree. */

export function slotNode(tree: EditTree, slot: SlotId): EditNode {
  return tree.nodes[tree.slots[slot].node];
}

/** The slot holding a node, or null for the root. */
export function parentSlot(tree: EditTree, node: NodeId): EditSlot | null {
  const parent = tree.nodes[node].parent;
  return parent == null ? null : tree.slots[parent];
}

/** The node's index among its slot's children. */
export function childIndex(tree: EditTree, node: NodeId): number {
  const parent = parentSlot(tree, node);
  return parent ? parent.children.indexOf(node) : -1;
}

export function presentSlots(tree: EditTree, node: NodeId): EditSlot[] {
  return tree.nodes[node].slots.map((id) => tree.slots[id]).filter((slot) => slot.presence === "present");
}

/** A node with no present slots: its whole span is one item. */
export function isLeaf(tree: EditTree, node: NodeId): boolean {
  return presentSlots(tree, node).length === 0;
}

/** The node's ancestors, innermost first (excluding the node itself). */
export function ancestorNodes(tree: EditTree, node: NodeId): NodeId[] {
  const result: NodeId[] = [];
  let parent = tree.nodes[node].parent;
  while (parent != null) {
    const owner = tree.slots[parent].node;
    result.push(owner);
    parent = tree.nodes[owner].parent;
  }
  return result;
}

/** The slots enclosing a slot, innermost first, starting with the slot itself. */
export function slotChain(tree: EditTree, slot: SlotId): SlotId[] {
  const result: SlotId[] = [slot];
  let parent = tree.nodes[tree.slots[slot].node].parent;
  while (parent != null) {
    result.push(parent);
    parent = tree.nodes[tree.slots[parent].node].parent;
  }
  return result;
}
