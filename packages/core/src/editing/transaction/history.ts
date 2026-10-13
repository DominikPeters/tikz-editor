import type { HistoryState, Transaction } from "./transaction.js";

/**
 * Session undo history with explicit grouping
 * (design/canvas-editing-architecture.md, "Transactions"). Each step
 * stores the buffer and selection before it.
 *
 * A typing run (consecutive transactions with the same `run` key) is one
 * step. The run breaks on any other transaction, on a selection change
 * that is not part of the run, on undo/redo, and on a pause longer than
 * TYPING_RUN_PAUSE_MS between two transactions of the run.
 */

export type HistorySnapshot = HistoryState;

export type UndoHistory = {
  readonly undo: readonly HistorySnapshot[];
  readonly redo: readonly HistorySnapshot[];
  /** The run the newest step belongs to, while it can still grow. */
  readonly openRun: { readonly run: string; readonly time: number } | null;
};

export const TYPING_RUN_PAUSE_MS = 1000;

export const EMPTY_UNDO_HISTORY: UndoHistory = { undo: [], redo: [], openRun: null };

export function breakTypingRun(history: UndoHistory): UndoHistory {
  return history.openRun ? { ...history, openRun: null } : history;
}

/**
 * Records an applied transaction that changed the buffer. `before` is the
 * state the transaction was applied to; `time` is in milliseconds.
 */
export function recordTransaction(
  history: UndoHistory,
  before: HistorySnapshot,
  transaction: Transaction,
  time: number
): UndoHistory {
  const grouping = transaction.undo;
  let merges = false;
  let openRun: UndoHistory["openRun"] = null;
  switch (grouping.group) {
    case "own-step":
      break;
    case "typing-run":
      merges =
        history.openRun?.run === grouping.run &&
        time - history.openRun.time <= TYPING_RUN_PAUSE_MS &&
        history.undo.length > 0;
      openRun = { run: grouping.run, time };
      break;
    case "composition":
      merges = !grouping.first && history.undo.length > 0;
      break;
    case "amend":
      merges = history.undo.length > 0;
      break;
    case "transformation": {
      // The literal keystroke goes as a typing run would; the transformation
      // is the step after it, and typing after it starts a new run.
      const literalMerges =
        history.openRun?.run === grouping.run &&
        time - history.openRun.time <= TYPING_RUN_PAUSE_MS &&
        history.undo.length > 0;
      const undo = literalMerges ? history.undo : [...history.undo, before];
      return { undo: [...undo, grouping.literal], redo: [], openRun: null };
    }
  }
  if (merges) {
    return { undo: history.undo, redo: [], openRun };
  }
  return { undo: [...history.undo, before], redo: [], openRun };
}

export function undoStep(
  history: UndoHistory,
  current: HistorySnapshot
): { history: UndoHistory; restore: HistorySnapshot } | null {
  const restore = history.undo[history.undo.length - 1];
  if (!restore) {
    return null;
  }
  return {
    history: { undo: history.undo.slice(0, -1), redo: [...history.redo, current], openRun: null },
    restore,
  };
}

export function redoStep(
  history: UndoHistory,
  current: HistorySnapshot
): { history: UndoHistory; restore: HistorySnapshot } | null {
  const restore = history.redo[history.redo.length - 1];
  if (!restore) {
    return null;
  }
  return {
    history: { undo: [...history.undo, current], redo: history.redo.slice(0, -1), openRun: null },
    restore,
  };
}
