// A tree child has no position of its own in the source: PGF places it from
// its parent's anchor by the growth function (`level distance`, `sibling
// distance`, `grow`); `child[xshift=…]` only shifts it, with its subtree,
// from that computed place (tikz.code.tex, \tikz@childnode: the child's
// transform precedes \tikz@grow).
// The editor does not drag tree children (as it does not drag matrix cells),
// so moving or arranging one refuses rather than rewriting the child.

export const TREE_CHILD_MOVE_BLOCK_REASON =
  "Tree children follow the tree layout and cannot be moved.";

export function isTreeChildSourceId(sourceId: string): boolean {
  return sourceId.includes(":tree-child:");
}

/** Whether `sourceId` is a tree child below `ancestorId` (a tree root or another child). */
export function isTreeDescendantSourceId(sourceId: string, ancestorId: string): boolean {
  return sourceId.startsWith(`${ancestorId}:tree-child:`);
}

/**
 * Tree children that would have to move by themselves. A child whose root
 * or ancestor child is also moved follows it, so it needs no move of its own.
 */
export function independentlyMovedTreeChildIds(sourceIds: readonly string[]): string[] {
  return sourceIds.filter((sourceId) =>
    isTreeChildSourceId(sourceId) &&
    !sourceIds.some((other) => other !== sourceId && isTreeDescendantSourceId(sourceId, other))
  );
}
