import { isCaretSlot, isDeclarationGroup, isRevealedCode, isTerminatorGroup, itemRole, type ItemRole } from "../ownership/kinds.js";
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
 * - inside a bare group's edges (`{x}`): same as just outside; an empty
 *   group is a stop unless it terminates a control word (`\LaTeX{}`). A
 *   group opening with a declaration (`{\bf x}`) is a style wrapper, with
 *   an inside start right after the declaration.
 *
 * A position that is not a stop is represented by the stop it looks like,
 * the nearest stop before it in document order.
 *
 * `hidden` nodes and `hiddenSlots` are what the rendered layout does not
 * show (inactive overlay arguments, paragraphs after `\pause`): they count as
 * invisible items, so motion and deletion pass over them. So do spaces at
 * a paragraph's start or end (around invisibles only), which TeX drops:
 * `text\n\pause` ends with "text".
 */
export type EditView = {
  readonly tree: EditTree;
  readonly index: PositionIndex;
  readonly hidden: ReadonlySet<NodeId>;
  readonly hiddenSlots: ReadonlySet<SlotId>;
  /** The node's role for motion and deletion: its kind's, or invisible when hidden. */
  role(node: NodeId): ItemRole;
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

export type EditViewOptions = {
  readonly hidden?: ReadonlySet<NodeId>;
  readonly hiddenSlots?: ReadonlySet<SlotId>;
  /**
   * Reveal codes (R14): invisible syntax (`\pause`, comments, `\label`,
   * vertical space) is an item the caret steps over and ⌫ selects first.
   */
  readonly revealCodes?: boolean;
};

const NO_HIDDEN: ReadonlySet<NodeId> = new Set();

export function createEditView(tree: EditTree, options: EditViewOptions = {}): EditView {
  const index = createPositionIndex(tree);
  const hidden = options.hidden ?? NO_HIDDEN;
  const hiddenSlots = options.hiddenSlots ?? NO_HIDDEN;
  const hiddenDescendants = new Set(hidden);
  const hideNode = (node: NodeId) => {
    hiddenDescendants.add(node);
    for (const slot of tree.nodes[node].slots) for (const child of tree.slots[slot].children) hideNode(child);
  };
  for (const slot of hiddenSlots) for (const child of tree.slots[slot].children) hideNode(child);
  const revealed = options.revealCodes === true;
  const baseRole = (node: NodeId): ItemRole => hiddenDescendants.has(node) ? "invisible"
    : revealed && isRevealedCode(tree, node) ? "construct" : itemRole(tree, node);
  const droppedSpaces = paragraphEdgeSpaces(tree, baseRole);
  const role = (node: NodeId): ItemRole => (droppedSpaces.has(node) ? "invisible" : baseRole(node));
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
    if (owner.kind === "group" && isDeclarationGroup(tree, owner.id)) {
      // `{\bf x}` is a style wrapper (P8): its inside starts after the
      // declaration, and its end is a stop of its own.
      return at === 0 || (at > 1 && role(record.children[at - 1]) === "invisible");
    }
    if (at > 0 && role(record.children[at - 1]) === "invisible") {
      return true;
    }
    if (owner.kind === "scripted" && record.role === "base" && at === 0) {
      return true;
    }
    // A bare group's edges look like its outside; an empty one is a box
    // to type into (`$a{‸}$`), unless it terminates a control word.
    return owner.kind === "group" && (at === 0 || at === record.children.length) &&
      (record.children.length > 0 || isTerminatorGroup(tree, owner.id));
  };

  const stops: Position[] = [];
  const stopRanks: number[] = [];
  const visitNode = (node: NodeId) => {
    if (hiddenDescendants.has(node)) {
      return;
    }
    for (const slot of tree.nodes[node].slots) {
      if (tree.slots[slot].presence === "present" && !hiddenSlots.has(slot)) {
        visitSlot(slot);
      }
    }
  };
  const visitSlot = (slot: SlotId) => {
    const record = tree.slots[slot];
    const caret = isCaretSlot(tree, slot);
    const before = stops.length;
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
    // A flow with no text in it (`\vspace{1em}`, `\pause`) keeps one stop, after that: somewhere to type.
    if (record.flow && stops.length === before) {
      const position = { slot, index: record.children.length };
      stops.push(position);
      stopRanks.push(rank(position));
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
    hidden: hiddenDescendants,
    hiddenSlots,
    role,
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

/** Spaces TeX drops: at a paragraph's start or end, with only invisible items beyond them. */
function paragraphEdgeSpaces(tree: EditTree, role: (node: NodeId) => ItemRole): Set<NodeId> {
  const dropped = new Set<NodeId>();
  for (const node of tree.nodes) {
    if (node.kind !== "paragraph") {
      continue;
    }
    const children = tree.slots[node.slots[0]].children;
    const mark = (order: readonly NodeId[]) => {
      for (const child of order) {
        if (tree.nodes[child].kind === "space") {
          dropped.add(child);
        } else if (role(child) !== "invisible") {
          return;
        }
      }
    };
    mark(children);
    mark([...children].reverse());
  }
  return dropped;
}
