import type { Span } from "@tikz-editor/core/ast/types";
import { computeMinimalReplacementPatch, replaceSpan } from "@tikz-editor/core/edit/patch";
import {
  EMPTY_UNDO_HISTORY,
  applyTransaction,
  breakTypingRun,
  recordTransaction,
  redoStep,
  undoStep,
  type AppliedTransaction,
  type HistorySnapshot,
  type Transaction,
  type UndoHistory,
  type VerticalGoal
} from "@tikz-editor/core/editing/transaction/index";
import type { SelectionEnds } from "@tikz-editor/core/editing/position/index";
import { NO_INTERACTION, type InteractionState } from "@tikz-editor/core/editing/input/index";

import type { EditableTextTarget, TextEditingSession, TextSelectionOverlay } from "./types";
import { clamp } from "./geometry";

export type CanvasTextLineRange = {
  start: number;
  end: number;
};

export type CanvasTextSelectionMode = "char" | "word" | "line";

export type CanvasTextSelectionDragState = {
  pointerId: number;
  sourceId: string;
  sceneTextId: string;
  initialSelectionStart: number;
  initialSelectionEnd: number;
  anchorOffset: number;
  mode: CanvasTextSelectionMode;
  anchorLineRange: CanvasTextLineRange | null;
};

/**
 * Which surface interprets the keyboard during a session. Both surfaces
 * share one buffer and identical typing; they differ in navigation and
 * structure keys. Scope (deck) sessions default to canvas focus on entry
 * (click slide text → canvas); non-scope sessions are bar-only.
 */
export type CanvasTextEditFocusSurface = "bar" | "canvas";

export type CanvasTextEditState = {
  session: TextEditingSession | null;
  selectionOverlay: TextSelectionOverlay | null;
  dragSelection: CanvasTextSelectionDragState | null;
  compositionRange: CanvasTextLineRange | null;
  focusSurface: CanvasTextEditFocusSurface;
  /** Session-local undo with explicit grouping (typing runs, steps). */
  history: UndoHistory;
  /** Sticky goal for consecutive ↑/↓ under canvas focus. */
  verticalGoal: VerticalGoal | null;
  /**
   * The raw selection ends as edit-tree positions, from the last
   * transaction that knew them. Valid only while the buffer and selection
   * are still the ones it recorded (see selectionPositions).
   */
  treeSelection: CanvasTreeSelection | null;
  /** Buffer revision: advances with every buffer edit. */
  inputRevision: number;
  asyncRequestRevision: number;
  sourceRevision: number;
};

export type CanvasTreeSelection = {
  readonly text: string;
  readonly anchor: number;
  readonly focus: number;
  readonly ends: SelectionEnds | null;
  readonly interaction: InteractionState;
};

/** The transaction's record, when it leaves positions or interaction state to keep. */
function treeSelectionAfter(transaction: Transaction, applied: AppliedTransaction): CanvasTreeSelection | null {
  const ends = transaction.selection.kind === "absolute" ? transaction.selection.positions ?? null : null;
  const interaction = transaction.interaction ?? NO_INTERACTION;
  if (!ends && interaction === NO_INTERACTION) {
    return null;
  }
  return { text: applied.text, anchor: applied.anchor, focus: applied.focus, ends, interaction };
}

/** The record, while buffer and selection are still the ones it was made for. */
function currentTreeSelection(state: CanvasTextEditState, anchor: number, focus: number): CanvasTreeSelection | null {
  const recorded = state.treeSelection;
  if (!recorded || recorded.text !== state.session?.text) {
    return null;
  }
  return recorded.anchor === anchor && recorded.focus === focus ? recorded : null;
}

/**
 * The raw selection ends for the current buffer and selection, or null
 * when anything changed them since the transaction that recorded them
 * (typing, a click, undo): the caller then resolves positions from offsets.
 */
export function selectionPositions(state: CanvasTextEditState, anchor: number, focus: number): SelectionEnds | null {
  return currentTreeSelection(state, anchor, focus)?.ends ?? null;
}

/** The interaction state the last transaction left, or none once buffer or selection changed otherwise. */
export function interactionState(state: CanvasTextEditState, anchor: number, focus: number): InteractionState {
  return currentTreeSelection(state, anchor, focus)?.interaction ?? NO_INTERACTION;
}

export type CanvasTextEditAction =
  | {
      type: "start_session";
      target: EditableTextTarget;
      source: string;
      selectionStart: number;
      selectionEnd: number;
      historyMergeKey: string;
    }
  | {
      type: "pointer_down_provisional";
      target: EditableTextTarget;
      source: string;
      pointerId: number;
      selectionStart: number;
      selectionEnd: number;
      anchorOffset: number;
      mode: CanvasTextSelectionMode;
      anchorLineRange: CanvasTextLineRange | null;
      historyMergeKey: string;
    }
  | {
      type: "pointer_resolved";
      requestRevision: number;
      baseInputRevision: number;
      sourceId: string;
      sceneTextId: string;
      pointerId: number;
      selectionStart: number;
      selectionEnd: number;
      anchorOffset: number;
      anchorLineRange: CanvasTextLineRange | null;
    }
  | {
      type: "drag_resolved";
      requestRevision: number;
      baseInputRevision: number;
      sourceId: string;
      sceneTextId: string;
      selectionStart: number;
      selectionEnd: number;
    }
  | {
      type: "textarea_selection";
      selectionStart: number;
      selectionEnd: number;
    }
  | {
      type: "source_reconciled";
      source: string;
      sourceRevision: number;
      target: EditableTextTarget | null;
    }
  | {
      type: "focus_surface";
      surface: CanvasTextEditFocusSurface;
    }
  | {
      /**
       * An edit computed by the intent resolver: disjoint patches against
       * the buffer at `transaction.baseRevision`, the selection afterwards
       * and its undo grouping. `time` (ms) drives typing-run pauses.
       */
      type: "apply_transaction";
      transaction: Transaction;
      time: number;
    }
  | {
      type: "history";
      direction: "undo" | "redo";
    }
  | {
      type: "session_close";
    }
  | {
      type: "overlay_resolved";
      requestRevision: number;
      sourceId: string;
      selectionStart: number;
      selectionEnd: number;
      overlay: TextSelectionOverlay | null;
    };

export type CanvasTextEditEffect =
  | {
      type: "apply_source_patch";
      sourceId: string;
      historyMergeKey: string;
      nextText: string;
      /** Minimal changed range in pre-edit document coordinates. */
      previousSpan: Span;
      /** Minimal changed range in post-edit document coordinates. */
      changedSpan: Span;
      /** Replacement for `previousSpan` only, not the whole session buffer. */
      replacement: string;
      /** The session's full buffer span after the edit. */
      sessionSpan: Span;
      /**
       * Structural mask for this edit in post-edit document coordinates:
       * the whole buffer when it is structure-free, else the structure-free
       * range containing the edit, or null when the edit crosses range
       * boundaries and no mask is safe.
       */
      maskSpan: Span | null;
      nextSource: string;
    };

export const INITIAL_CANVAS_TEXT_EDIT_STATE: CanvasTextEditState = {
  session: null,
  selectionOverlay: null,
  dragSelection: null,
  compositionRange: null,
  focusSurface: "bar",
  history: EMPTY_UNDO_HISTORY,
  verticalGoal: null,
  treeSelection: null,
  inputRevision: 0,
  asyncRequestRevision: 0,
  sourceRevision: 0
};

function resolveCurrentTextSpan(source: string, expectedText: string, previousSpan: Span): Span {
  if (source.slice(previousSpan.from, previousSpan.to) === expectedText) {
    return previousSpan;
  }
  if (expectedText.length === 0) {
    return { from: previousSpan.from, to: previousSpan.from };
  }
  let bestStart = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let searchFrom = 0;
  while (searchFrom <= source.length - expectedText.length) {
    const matchAt = source.indexOf(expectedText, searchFrom);
    if (matchAt < 0) {
      break;
    }
    const distance = Math.abs(matchAt - previousSpan.from);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestStart = matchAt;
      if (distance === 0) {
        break;
      }
    }
    searchFrom = matchAt + 1;
  }
  if (bestStart < 0) {
    return previousSpan;
  }
  return {
    from: bestStart,
    to: bestStart + expectedText.length
  };
}

function normalizeSelection(textLength: number, selectionStart: number, selectionEnd: number): { start: number; end: number } {
  const boundedStart = clamp(Math.floor(selectionStart), 0, textLength);
  const boundedEnd = clamp(Math.floor(selectionEnd), 0, textLength);
  return {
    start: Math.min(boundedStart, boundedEnd),
    end: Math.max(boundedStart, boundedEnd)
  };
}

function sameSpan(left: Span, right: Span): boolean {
  return left.from === right.from && left.to === right.to;
}

function sameRegion(left: TextEditingSession["region"], right: TextEditingSession["region"]): boolean {
  const leftTransform = left.transform ?? null;
  const rightTransform = right.transform ?? null;
  return (
    left.key === right.key &&
    left.sourceId === right.sourceId &&
    left.targetId === right.targetId &&
    left.interactionMode === right.interactionMode &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.cx === right.cx &&
    left.cy === right.cy &&
    left.rotation === right.rotation &&
    (left.contentWidth ?? null) === (right.contentWidth ?? null) &&
    (left.contentHeight ?? null) === (right.contentHeight ?? null) &&
    ((leftTransform == null && rightTransform == null) ||
      (leftTransform != null &&
        leftTransform.a === rightTransform?.a &&
        leftTransform.b === rightTransform.b &&
        leftTransform.c === rightTransform.c &&
        leftTransform.d === rightTransform.d &&
        leftTransform.e === rightTransform.e &&
        leftTransform.f === rightTransform.f))
  );
}

function closeState(state: CanvasTextEditState): CanvasTextEditState {
  if (
    !state.session &&
    !state.selectionOverlay &&
    !state.dragSelection &&
    !state.compositionRange &&
    state.focusSurface === "bar" &&
    state.history === EMPTY_UNDO_HISTORY &&
    state.verticalGoal == null
  ) {
    return state;
  }
  return {
    ...state,
    session: null,
    selectionOverlay: null,
    dragSelection: null,
    compositionRange: null,
    focusSurface: "bar",
    history: EMPTY_UNDO_HISTORY,
    verticalGoal: null,
    asyncRequestRevision: state.asyncRequestRevision + 1
  };
}

const IS_FAIL_FAST = import.meta.env.DEV || import.meta.env.MODE === "test";

function sessionSnapshot(session: TextEditingSession): HistorySnapshot {
  return {
    text: session.text,
    anchor: session.selectionStart,
    focus: session.selectionEnd
  };
}

function normalizeRange(textLength: number, range: CanvasTextLineRange): CanvasTextLineRange {
  const normalized = normalizeSelection(textLength, range.start, range.end);
  return {
    start: normalized.start,
    end: normalized.end
  };
}

function resolveSourceSpanForSessionText(source: string, text: string, suggestedSpan: Span): Span {
  if (source.slice(suggestedSpan.from, suggestedSpan.to) === text) {
    return suggestedSpan;
  }
  const resolved = resolveCurrentTextSpan(source, text, suggestedSpan);
  if (source.slice(resolved.from, resolved.to) === text) {
    return resolved;
  }
  const suggestedLength = Math.max(0, suggestedSpan.to - suggestedSpan.from);
  if (suggestedLength < text.length) {
    const expandedTo = Math.min(source.length, suggestedSpan.from + text.length);
    if (expandedTo > suggestedSpan.to) {
      return {
        from: suggestedSpan.from,
        to: expandedTo
      };
    }
  }
  return suggestedSpan;
}

function resolveReconciledSessionSourceSpan(
  source: string,
  session: TextEditingSession,
  targetSpan: Span
): Span {
  // The session's own span stays authoritative while it still slices to the
  // session text: string-based re-anchoring against the target span can
  // latch onto ambiguous needles (a transient lone `\` matches every
  // command prefix). Re-anchor only when a foreign edit invalidated it.
  if (source.slice(session.sourceSpan.from, session.sourceSpan.to) === session.text) {
    return session.sourceSpan;
  }
  return resolveSourceSpanForSessionText(source, session.text, targetSpan);
}

/**
 * Maps a structure-free span through an edit. Spans strictly before the
 * edit are unchanged, spans after shift by the length delta, the span
 * containing the edit grows or shrinks with it, and spans partially
 * overlapped by the edit are dropped (no longer provably structure-free).
 */
function adjustMaskRangeForEdit(range: Span, oldSpan: Span, delta: number): Span | null {
  if (range.from <= oldSpan.from && oldSpan.to <= range.to) {
    return { from: range.from, to: range.to + delta };
  }
  if (range.to <= oldSpan.from) {
    return range;
  }
  if (range.from >= oldSpan.to) {
    return { from: range.from + delta, to: range.to + delta };
  }
  return null;
}

function sameMaskRanges(
  left: readonly Span[] | null,
  right: readonly Span[] | null
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || left.length !== right?.length) {
    return false;
  }
  return left.every((span, index) => sameSpan(span, right[index]));
}

function applySessionTextUpdate(
  state: CanvasTextEditState,
  nextText: string,
  selectionStart: number,
  selectionEnd: number
): { state: CanvasTextEditState; effects: CanvasTextEditEffect[] } {
  const current = state.session;
  if (!current) {
    return { state, effects: [] };
  }
  const selection = normalizeSelection(nextText.length, selectionStart, selectionEnd);
  // Every keystroke writes through, including a trailing backslash: the
  // structural parse mask keeps the document stable while the span content
  // is momentarily invalid TeX (e.g. a pending `\}` escape).
  const currentSlice = current.workingSource.slice(current.sourceSpan.from, current.sourceSpan.to);
  const currentSpan = currentSlice === current.text
    ? current.sourceSpan
    : resolveCurrentTextSpan(current.workingSource, current.text, current.sourceSpan);
  const updated = replaceSpan(current.workingSource, currentSpan, nextText);
  // The dispatched patch covers only the changed characters inside the
  // buffer, so a keystroke in a scope-sized session stays a keystroke-sized
  // source change for incremental parsing and history.
  const bufferDiff = computeMinimalReplacementPatch(current.text, nextText);
  const editOldSpan: Span = {
    from: currentSpan.from + bufferDiff.oldSpan.from,
    to: currentSpan.from + bufferDiff.oldSpan.to
  };
  const editDelta = bufferDiff.replacement.length - (editOldSpan.to - editOldSpan.from);
  let maskSpan: Span | null;
  let nextMaskRanges: readonly Span[] | null;
  if (current.maskRanges == null) {
    maskSpan = updated.changedSpan;
    nextMaskRanges = null;
  } else {
    maskSpan = null;
    const adjusted: Span[] = [];
    for (const range of current.maskRanges) {
      const containsEdit = range.from <= editOldSpan.from && editOldSpan.to <= range.to;
      const next = adjustMaskRangeForEdit(range, editOldSpan, editDelta);
      if (next) {
        adjusted.push(next);
        if (containsEdit) {
          maskSpan = next;
        }
      }
    }
    nextMaskRanges = adjusted;
  }
  return {
    state: {
      ...state,
      session: {
        ...current,
        sourceSpan: updated.changedSpan,
        workingSource: updated.source,
        maskRanges: nextMaskRanges,
        text: nextText,
        selectionStart: selection.start,
        selectionEnd: selection.end
      },
      inputRevision: state.inputRevision + 1,
      asyncRequestRevision: state.asyncRequestRevision + 1
    },
    effects: [
      {
        type: "apply_source_patch",
        sourceId: current.sourceId,
        historyMergeKey: current.historyMergeKey,
        nextText,
        previousSpan: editOldSpan,
        changedSpan: {
          from: currentSpan.from + bufferDiff.newSpan.from,
          to: currentSpan.from + bufferDiff.newSpan.to
        },
        replacement: bufferDiff.replacement,
        sessionSpan: updated.changedSpan,
        maskSpan,
        nextSource: updated.source
      }
    ]
  };
}

export function reduceCanvasTextEdit(
  state: CanvasTextEditState,
  action: CanvasTextEditAction
): { state: CanvasTextEditState; effects: CanvasTextEditEffect[] } {
  switch (action.type) {
    case "start_session": {
      const selection = normalizeSelection(action.target.text.length, action.selectionStart, action.selectionEnd);
      const sourceSpan = resolveSourceSpanForSessionText(
        action.source,
        action.target.text,
        action.target.sourceSpan
      );
      return {
        state: {
          ...state,
          session: {
            sourceId: action.target.sourceId,
            sceneTextId: action.target.sceneTextId,
            sourceSpan,
            workingSource: action.source,
            maskRanges: action.target.structuralMaskRanges ?? null,
            text: action.target.text,
            selectionStart: selection.start,
            selectionEnd: selection.end,
            historyMergeKey: action.historyMergeKey,
            usesTex: action.target.usesTex,
            paragraphId: action.target.paragraphId,
            renderSourceText: action.target.renderSourceText,
            layoutKind: action.target.layoutKind,
            region: action.target.region,
            popupAnchorBox: action.target.popupAnchorBox,
            isForeachTemplateEdit: action.target.isForeachTemplateEdit === true,
            editMode: action.target.editMode ?? "default",
            isScopeSession: action.target.scopeParagraphs != null
          },
          selectionOverlay: null,
          dragSelection: null,
          compositionRange: null,
          focusSurface: action.target.scopeParagraphs != null ? "canvas" : "bar",
          history: EMPTY_UNDO_HISTORY,
          verticalGoal: null,
          asyncRequestRevision: state.asyncRequestRevision + 1
        },
        effects: []
      };
    }

    case "pointer_down_provisional": {
      const selection = normalizeSelection(action.target.text.length, action.selectionStart, action.selectionEnd);
      const sourceSpan = resolveSourceSpanForSessionText(
        action.source,
        action.target.text,
        action.target.sourceSpan
      );
      return {
        state: {
          ...state,
          session: {
            sourceId: action.target.sourceId,
            sceneTextId: action.target.sceneTextId,
            sourceSpan,
            workingSource: action.source,
            maskRanges: action.target.structuralMaskRanges ?? null,
            text: action.target.text,
            selectionStart: selection.start,
            selectionEnd: selection.end,
            historyMergeKey: action.historyMergeKey,
            usesTex: action.target.usesTex,
            paragraphId: action.target.paragraphId,
            renderSourceText: action.target.renderSourceText,
            layoutKind: action.target.layoutKind,
            region: action.target.region,
            popupAnchorBox: action.target.popupAnchorBox,
            isForeachTemplateEdit: action.target.isForeachTemplateEdit === true,
            editMode: action.target.editMode ?? "default",
            isScopeSession: action.target.scopeParagraphs != null
          },
          selectionOverlay: null,
          dragSelection: {
            pointerId: action.pointerId,
            sourceId: action.target.sourceId,
            sceneTextId: action.target.sceneTextId,
            initialSelectionStart: selection.start,
            initialSelectionEnd: selection.end,
            anchorOffset: action.anchorOffset,
            mode: action.mode,
            anchorLineRange: action.anchorLineRange
          },
          compositionRange: null,
          // Clicking slide text always claims canvas focus, including when
          // the bar held it a moment ago.
          focusSurface: action.target.scopeParagraphs != null ? "canvas" : "bar",
          history: EMPTY_UNDO_HISTORY,
          verticalGoal: null,
          asyncRequestRevision: state.asyncRequestRevision + 1
        },
        effects: []
      };
    }

    case "pointer_resolved": {
      if (action.requestRevision !== state.asyncRequestRevision || action.baseInputRevision !== state.inputRevision) {
        return { state, effects: [] };
      }
      const session = state.session;
      if (session?.sourceId !== action.sourceId || session.sceneTextId !== action.sceneTextId) {
        return { state, effects: [] };
      }
      const selection = normalizeSelection(session.text.length, action.selectionStart, action.selectionEnd);
      const shouldUpdateSessionSelection =
        state.dragSelection?.pointerId !== action.pointerId ||
        state.dragSelection.sourceId !== action.sourceId ||
        state.dragSelection.sceneTextId !== action.sceneTextId ||
        (session.selectionStart === state.dragSelection.initialSelectionStart &&
          session.selectionEnd === state.dragSelection.initialSelectionEnd);
      return {
        state: {
          ...state,
          session: shouldUpdateSessionSelection
            ? {
                ...session,
                selectionStart: selection.start,
                selectionEnd: selection.end
              }
            : session,
          history: breakTypingRun(state.history),
          compositionRange: null,
          dragSelection:
            state.dragSelection?.pointerId === action.pointerId &&
            state.dragSelection.sourceId === action.sourceId &&
            state.dragSelection.sceneTextId === action.sceneTextId
              ? {
                  ...state.dragSelection,
                  anchorOffset: clamp(action.anchorOffset, 0, session.text.length),
                  anchorLineRange: action.anchorLineRange
                }
              : state.dragSelection
        },
        effects: []
      };
    }

    case "drag_resolved": {
      if (action.requestRevision !== state.asyncRequestRevision || action.baseInputRevision !== state.inputRevision) {
        return { state, effects: [] };
      }
      const session = state.session;
      if (session?.sourceId !== action.sourceId || session.sceneTextId !== action.sceneTextId) {
        return { state, effects: [] };
      }
      const selection = normalizeSelection(session.text.length, action.selectionStart, action.selectionEnd);
      return {
        state: {
          ...state,
          session: {
            ...session,
            selectionStart: selection.start,
            selectionEnd: selection.end
          },
          history: breakTypingRun(state.history),
          compositionRange: null
        },
        effects: []
      };
    }

    case "apply_transaction": {
      const session = state.session;
      if (!session) {
        return { state, effects: [] };
      }
      const { transaction } = action;
      if (transaction.baseRevision !== state.inputRevision) {
        // Intents resolve synchronously against the current buffer, so a
        // stale transaction is a bug in the caller, not a race to absorb.
        const message =
          `[canvas-text-edit] transaction for revision ${transaction.baseRevision} ` +
          `applied at revision ${state.inputRevision}`;
        if (IS_FAIL_FAST) {
          throw new Error(message);
        }
        console.warn(message);
        return { state, effects: [] };
      }
      const applied = applyTransaction(session.text, transaction);
      const compositionRange = transaction.composition
        ? { start: transaction.composition.from, end: transaction.composition.to }
        : null;
      const verticalGoal = transaction.verticalGoal ?? null;
      const treeSelection = treeSelectionAfter(transaction, applied);
      if (applied.text === session.text) {
        const selection = normalizeSelection(session.text.length, applied.anchor, applied.focus);
        return {
          state: {
            ...state,
            session: {
              ...session,
              selectionStart: selection.start,
              selectionEnd: selection.end
            },
            history: breakTypingRun(state.history),
            compositionRange,
            verticalGoal,
            treeSelection
          },
          effects: []
        };
      }
      const reduced = applySessionTextUpdate(state, applied.text, applied.anchor, applied.focus);
      return {
        state: {
          ...reduced.state,
          history: recordTransaction(state.history, sessionSnapshot(session), transaction, action.time),
          compositionRange,
          verticalGoal,
          treeSelection
        },
        effects: reduced.effects
      };
    }

    case "history": {
      const session = state.session;
      if (!session) {
        return { state, effects: [] };
      }
      const step = action.direction === "undo"
        ? undoStep(state.history, sessionSnapshot(session))
        : redoStep(state.history, sessionSnapshot(session));
      if (!step) {
        return { state, effects: [] };
      }
      const reduced = applySessionTextUpdate(state, step.restore.text, step.restore.anchor, step.restore.focus);
      return {
        state: {
          ...reduced.state,
          history: step.history,
          compositionRange: null,
          verticalGoal: null
        },
        effects: reduced.effects
      };
    }

    case "textarea_selection": {
      const session = state.session;
      if (!session) {
        return { state, effects: [] };
      }
      const selection = normalizeSelection(session.text.length, action.selectionStart, action.selectionEnd);
      if (session.selectionStart === selection.start && session.selectionEnd === selection.end) {
        return { state, effects: [] };
      }
      const preservedCompositionRange =
        state.compositionRange?.start === selection.start &&
        state.compositionRange.end === selection.end
          ? state.compositionRange
          : null;
      return {
        state: {
          ...state,
          session: {
            ...session,
            selectionStart: selection.start,
            selectionEnd: selection.end
          },
          // A selection change outside the composition overlay ends a typing run.
          history: preservedCompositionRange ? state.history : breakTypingRun(state.history),
          compositionRange: preservedCompositionRange
        },
        effects: []
      };
    }

    case "source_reconciled": {
      const session = state.session;
      if (!session) {
        if (state.sourceRevision === action.sourceRevision) {
          return { state, effects: [] };
        }
        return {
          state: {
            ...state,
            sourceRevision: action.sourceRevision
          },
          effects: []
        };
      }
      if (action.target?.sourceId !== session.sourceId) {
        if (session.editMode === "inline-typo") {
          return {
            state: {
              ...state,
              sourceRevision: action.sourceRevision,
              session: null,
              selectionOverlay: null,
              dragSelection: null,
              compositionRange: null,
              history: EMPTY_UNDO_HISTORY,
              verticalGoal: null,
              asyncRequestRevision: state.asyncRequestRevision + 1
            },
            effects: []
          };
        }
        if (state.sourceRevision === action.sourceRevision && session.workingSource === action.source) {
          return { state, effects: [] };
        }
        return {
          state: {
            ...state,
            sourceRevision: action.sourceRevision,
            compositionRange: null,
            session: {
              ...session,
              workingSource: action.source
            }
          },
          effects: []
        };
      }
      const targetMatchesSessionText = action.target.text === session.text;
      const reconciledSourceSpan = resolveReconciledSessionSourceSpan(
        action.source,
        session,
        action.target.sourceSpan
      );
      const nextSceneTextId = targetMatchesSessionText ? action.target.sceneTextId : session.sceneTextId;
      const nextUsesTex = targetMatchesSessionText ? action.target.usesTex : session.usesTex;
      const nextParagraphId = targetMatchesSessionText ? action.target.paragraphId : session.paragraphId;
      const nextRenderSourceText = targetMatchesSessionText ? action.target.renderSourceText : session.renderSourceText;
      const nextLayoutKind = targetMatchesSessionText ? action.target.layoutKind : session.layoutKind;
      const nextRegion = targetMatchesSessionText ? action.target.region : session.region;
      const nextPopupAnchorBox = targetMatchesSessionText ? action.target.popupAnchorBox : session.popupAnchorBox;
      const nextIsForeachTemplateEdit = targetMatchesSessionText
        ? action.target.isForeachTemplateEdit === true
        : session.isForeachTemplateEdit;
      const nextMaskRanges = targetMatchesSessionText
        ? action.target.structuralMaskRanges ?? null
        : session.maskRanges;
      if (
        state.sourceRevision === action.sourceRevision &&
        session.workingSource === action.source &&
        session.sceneTextId === nextSceneTextId &&
        session.usesTex === nextUsesTex &&
        sameSpan(session.sourceSpan, reconciledSourceSpan) &&
        sameMaskRanges(session.maskRanges, nextMaskRanges) &&
        session.paragraphId === nextParagraphId &&
        session.renderSourceText === nextRenderSourceText &&
        session.layoutKind === nextLayoutKind &&
        session.isForeachTemplateEdit === nextIsForeachTemplateEdit &&
        sameRegion(session.region, nextRegion) &&
        session.popupAnchorBox?.minX === nextPopupAnchorBox?.minX &&
        session.popupAnchorBox?.minY === nextPopupAnchorBox?.minY &&
        session.popupAnchorBox?.maxX === nextPopupAnchorBox?.maxX &&
        session.popupAnchorBox?.maxY === nextPopupAnchorBox?.maxY
      ) {
        return { state, effects: [] };
      }
      return {
        state: {
          ...state,
          sourceRevision: action.sourceRevision,
          compositionRange:
            state.compositionRange &&
            state.compositionRange.start >= 0 &&
            state.compositionRange.end <= session.text.length
              ? normalizeRange(session.text.length, state.compositionRange)
              : null,
          session: {
            ...session,
            sceneTextId: nextSceneTextId,
            sourceSpan: reconciledSourceSpan,
            workingSource: action.source,
            maskRanges: nextMaskRanges,
            usesTex: nextUsesTex,
            paragraphId: nextParagraphId,
            renderSourceText: nextRenderSourceText,
            layoutKind: nextLayoutKind,
            region: nextRegion,
            popupAnchorBox: nextPopupAnchorBox,
            isForeachTemplateEdit: nextIsForeachTemplateEdit
          }
        },
        effects: []
      };
    }

    case "overlay_resolved": {
      if (action.requestRevision !== state.asyncRequestRevision) {
        return { state, effects: [] };
      }
      const session = state.session;
      if (session?.sourceId !== action.sourceId) {
        return { state, effects: [] };
      }
      const nextOverlay = action.overlay
        ? {
            ...action.overlay,
            selectionStart: action.selectionStart,
            selectionEnd: action.selectionEnd
          }
        : null;
      return {
        state: {
          ...state,
          selectionOverlay: nextOverlay
        },
        effects: []
      };
    }

    case "focus_surface": {
      const session = state.session;
      if (!session) {
        return { state, effects: [] };
      }
      // Canvas focus only exists for scope (deck) sessions; node sessions
      // stay bar-focused regardless of what is requested.
      const surface = session.isScopeSession ? action.surface : "bar";
      if (state.focusSurface === surface) {
        return { state, effects: [] };
      }
      return {
        state: {
          ...state,
          focusSurface: surface
        },
        effects: []
      };
    }

    case "session_close": {
      return {
        state: closeState(state),
        effects: []
      };
    }

    default: {
      return { state, effects: [] };
    }
  }
}
