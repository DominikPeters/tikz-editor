import { isCaretSlot, itemRole } from "../ownership/kinds.js";
import { slotChain } from "../tree/navigate.js";
import type { EditTree, NodeId, SlotId } from "../tree/types.js";
import { createPositionIndex, positionOffset, type Position, type PositionIndex } from "./position.js";

/**
 * An EditTree with its positions and caret stops: what motion, selection
 * and deletion need to answer "where is the caret" and "where does it go".
 *
 * Caret stops (R7: one keystroke, one visible change) are the positions of
 * caret slots minus those that look identical to the stop before them:
 * - after an invisible item (`\label`, a comment): same place as before it;
 * - the start of a script's base: same place as before the scripted atom;
 * - inside a bare group's edges (`{}`, `{\bf x}`): same as just outside.
 *
 * A position that is not a stop is represented by the stop it looks like,
 * the nearest stop before it in document order.
 */
export type EditView = {
  readonly tree: EditTree;
  readonly index: PositionIndex;
  /** Caret stops in document order. */
  readonly stops: readonly Position[];
  /** Document-order rank of a position (total over all positions). */
  rank(position: Position): number;
  /** Nesting depth of a slot (the root's slots have depth 0). */
  depth(slot: SlotId): number;
  offset(position: Position): number;
  isStop(position: Position): boolean;
  representative(position: Position): Position;
  /**
   * The caret position for a source offset: the shallowest stop there,
   * else the stop of the gap it lies in, else the nearest stop before it
   * (for offsets inside a command name or a brace).
   */
  positionAt(offset: number): Position;
  /**
   * The stop an offset names exactly (the shallowest stop there, or the
   * stop of the whitespace gap it lies in), or null inside an item's or a
   * delimiter's source. Used to snap a caret after an edit.
   */
  stopAt(offset: number): Position | null;
  /** The next or previous stop, or null at the ends. */
  step(position: Position, direction: -1 | 1): Position | null;
};

const key = (position: Position) => `${position.slot}:${position.index}`;

export function createEditView(tree: EditTree): EditView {
  const index = createPositionIndex(tree);
  const ranks = new Map<string, number>();
  index.positions.forEach((position, rank) => ranks.set(key(position), rank));
  const rank = (position: Position): number => {
    const found = ranks.get(key(position));
    if (found == null) {
      throw new Error(`No position ${key(position)} in this tree`);
    }
    return found;
  };

  const depths = new Map<SlotId, number>();
  const depth = (slot: SlotId): number => {
    let found = depths.get(slot);
    if (found == null) {
      found = slotChain(tree, slot).length - 1;
      depths.set(slot, found);
    }
    return found;
  };

  const suppressed = (slot: SlotId, at: number): boolean => {
    const record = tree.slots[slot];
    const owner = tree.nodes[record.node];
    if (at > 0 && itemRole(tree, record.children[at - 1]) === "invisible") {
      return true;
    }
    if (owner.kind === "scripted" && record.role === "base" && at === 0) {
      return true;
    }
    return owner.kind === "group" && (at === 0 || at === record.children.length);
  };

  const stops: Position[] = [];
  const stopRanks: number[] = [];
  const visitNode = (node: NodeId) => {
    for (const slot of tree.nodes[node].slots) {
      if (tree.slots[slot].presence === "present") {
        visitSlot(slot);
      }
    }
  };
  const visitSlot = (slot: SlotId) => {
    const record = tree.slots[slot];
    const caret = isCaretSlot(tree, slot);
    for (let at = 0; at <= record.children.length; at += 1) {
      if (caret && !suppressed(slot, at)) {
        const position = { slot, index: at };
        stops.push(position);
        stopRanks.push(rank(position));
      }
      if (at < record.children.length) {
        visitNode(record.children[at]);
      }
    }
  };
  visitNode(tree.root);
  const stopKeys = new Set(stops.map(key));

  /** Index of the last stop at or before a rank (binary search), or -1. */
  const lastStopAtOrBefore = (target: number): number => {
    let low = 0;
    let high = stopRanks.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (stopRanks[middle] <= target) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  };

  const representativeIndex = (position: Position): number =>
    Math.max(0, lastStopAtOrBefore(rank(position)));

  const view: EditView = {
    tree,
    index,
    stops,
    rank,
    depth,
    offset: (position) => positionOffset(tree, position),
    isStop: (position) => stopKeys.has(key(position)),
    representative: (position) => stops[representativeIndex(position)] ?? position,
    stopAt(offset) {
      const atOffset = index.positionsAt(offset).filter((position) => stopKeys.has(key(position)));
      if (atOffset.length > 0) {
        return atOffset.reduce((best, position) => (depth(position.slot) < depth(best.slot) ? position : best));
      }
      const resolved = index.resolve(offset, "before");
      return resolved ? view.representative(resolved) : null;
    },
    positionAt(offset) {
      const exact = view.stopAt(offset);
      if (exact) {
        return exact;
      }
      // Inside a unit's or a delimiter's source: the last stop before it.
      let best: Position | null = null;
      for (let at = 0; at < stops.length; at += 1) {
        if (positionOffset(tree, stops[at]) <= offset) {
          best = stops[at];
        }
      }
      return best ?? stops[0];
    },
    step(position, direction) {
      const from = representativeIndex(position);
      const next = from + direction;
      return next >= 0 && next < stops.length ? stops[next] : null;
    },
  };
  return view;
}
