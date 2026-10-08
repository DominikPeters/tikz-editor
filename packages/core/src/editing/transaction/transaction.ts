import type { SelectionEnds } from "../position/selection.js";

/**
 * Transactions (design/canvas-editing-architecture.md, "Transactions"):
 * every edit in a canvas editing session is a set of disjoint patches
 * against the session buffer plus the selection afterwards. The patches
 * double as the position map, so positions computed against the
 * pre-edit buffer can be carried across the edit.
 *
 * All offsets are buffer-local (0 is the start of the session buffer).
 */

export type BufferPatch = {
  /** Pre-edit coordinates. */
  readonly from: number;
  readonly to: number;
  readonly insert: string;
};

/**
 * A pre-edit offset with an affinity: at an insertion point, or inside a
 * replaced range, `assoc` -1 keeps the position before the inserted text
 * and +1 moves it after.
 */
export type MappedPosition = {
  readonly offset: number;
  readonly assoc: -1 | 1;
};

export type TransactionSelection =
  | { readonly kind: "mapped"; readonly anchor: MappedPosition; readonly focus: MappedPosition }
  /**
   * Post-edit offsets, for edits that compute their caret themselves.
   * `positions` are the raw selection ends as tree positions in the
   * post-edit buffer, when known: they keep what offsets cannot (the
   * inside and outside of `x^2‸` share an offset; a promoted selection's
   * raw focus differs from its effective one).
   */
  | {
      readonly kind: "absolute";
      readonly anchor: number;
      readonly focus: number;
      readonly positions?: SelectionEnds;
    };

/**
 * Undo grouping is declared by the transaction, never inferred from text:
 * - `own-step`: one undo step.
 * - `typing-run`: merges with the previous transaction when it belongs to
 *   the same run and nothing broke the run in between (see history.ts).
 * - `composition`: an IME update; `first` opens a step, later updates of
 *   the same composition merge into it.
 *
 * Transactions without patches (selection only) never create undo steps.
 */
export type UndoGrouping =
  | { readonly group: "own-step" }
  | { readonly group: "typing-run"; readonly run: string }
  | { readonly group: "composition"; readonly first: boolean };

export type BufferRange = { readonly from: number; readonly to: number };

/** Sticky goal for consecutive vertical motion (document offset and x). */
export type VerticalGoal = { readonly offset: number; readonly x: number };

export type Transaction = {
  /** Buffer revision the transaction was computed against. */
  readonly baseRevision: number;
  /** Sorted, non-overlapping, in pre-edit coordinates. */
  readonly patches: readonly BufferPatch[];
  readonly selection: TransactionSelection;
  readonly undo: UndoGrouping;
  /** The IME composition overlay afterwards; absent means none. */
  readonly composition?: BufferRange | null;
  /** Vertical-motion goal afterwards; absent means cleared. */
  readonly verticalGoal?: VerticalGoal | null;
};

export function assertDisjointPatches(patches: readonly BufferPatch[], length: number): void {
  let previousTo = 0;
  for (const patch of patches) {
    if (patch.from < previousTo || patch.to < patch.from || patch.to > length) {
      throw new Error(
        `Transaction patches must be sorted, disjoint and inside the buffer: ${JSON.stringify(patches)} (length ${length})`
      );
    }
    previousTo = patch.to;
  }
}

export function applyPatches(text: string, patches: readonly BufferPatch[]): string {
  assertDisjointPatches(patches, text.length);
  let result = "";
  let cursor = 0;
  for (const patch of patches) {
    result += text.slice(cursor, patch.from) + patch.insert;
    cursor = patch.to;
  }
  return result + text.slice(cursor);
}

/**
 * Maps a pre-edit offset through the patches. Offsets strictly inside a
 * replaced range, or at a pure insertion point, follow `assoc`; the start
 * of a replaced range stays before it and its end lands after it.
 */
export function mapOffset(patches: readonly BufferPatch[], offset: number, assoc: -1 | 1): number {
  let delta = 0;
  for (const patch of patches) {
    if (offset < patch.from) {
      break;
    }
    if (offset > patch.to) {
      delta += patch.insert.length - (patch.to - patch.from);
      continue;
    }
    const start = patch.from + delta;
    const end = start + patch.insert.length;
    if (offset === patch.from && offset !== patch.to) {
      return start;
    }
    if (offset === patch.to && offset !== patch.from) {
      return end;
    }
    return assoc < 0 ? start : end;
  }
  return offset + delta;
}

export type AppliedTransaction = {
  readonly text: string;
  readonly anchor: number;
  readonly focus: number;
};

/** Applies a transaction to the buffer it was computed against. */
export function applyTransaction(text: string, transaction: Transaction): AppliedTransaction {
  const next = applyPatches(text, transaction.patches);
  const clampOffset = (offset: number) => Math.min(next.length, Math.max(0, offset));
  const { selection } = transaction;
  if (selection.kind === "absolute") {
    return { text: next, anchor: clampOffset(selection.anchor), focus: clampOffset(selection.focus) };
  }
  return {
    text: next,
    anchor: mapOffset(transaction.patches, selection.anchor.offset, selection.anchor.assoc),
    focus: mapOffset(transaction.patches, selection.focus.offset, selection.focus.assoc),
  };
}

/**
 * Patches for a whole-buffer replacement computed by a text helper: the
 * minimal changed range as one patch (none when the text is unchanged).
 */
export function replacementPatches(text: string, nextText: string): BufferPatch[] {
  let prefix = 0;
  const minLength = Math.min(text.length, nextText.length);
  while (prefix < minLength && text.charCodeAt(prefix) === nextText.charCodeAt(prefix)) {
    prefix += 1;
  }
  let oldEnd = text.length;
  let newEnd = nextText.length;
  while (oldEnd > prefix && newEnd > prefix && text.charCodeAt(oldEnd - 1) === nextText.charCodeAt(newEnd - 1)) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  if (prefix === oldEnd && prefix === newEnd) {
    return [];
  }
  return [{ from: prefix, to: oldEnd, insert: nextText.slice(prefix, newEnd) }];
}
