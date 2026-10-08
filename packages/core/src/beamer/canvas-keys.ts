import {
  beamerCaretAtomBeside,
  beamerCaretRowEdgeOffset,
  nearestBeamerCaretOffset,
  nextBeamerCaretOffset,
  verticalBeamerCaretOffset,
  type BeamerCaretDomain,
} from "./caret-stops.js";
import {
  beamerStructuralBackspacePatch,
  beamerStructuralDeletePatch,
  beamerStructuralEnterPatch,
  beamerStructuralLineBreakPatch,
  beamerStructuralTabPatch,
  type BeamerStructuralKeyResult,
  type BeamerStructuralPatch,
} from "./structural-edit.js";

/**
 * Canvas-focus key decisions for Beamer scope sessions, kept DOM-free so
 * the app's key handlers and headless scenario tests share one
 * implementation. Selections are buffer-local offsets into the session
 * buffer, which starts at `bufferFrom` in the document.
 */
export type CanvasKeyStroke = {
  readonly key: string;
  readonly shift: boolean;
  /** Cmd on macOS, Ctrl elsewhere. */
  readonly primary: boolean;
  readonly alt: boolean;
};

export type CanvasBufferSelection = {
  readonly bufferFrom: number;
  readonly bufferLength: number;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly backward: boolean;
};

export type CanvasVerticalGoal = { readonly offset: number; readonly x: number };

export type CanvasMotionResult = {
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly direction: "forward" | "backward" | "none";
  readonly verticalGoal: CanvasVerticalGoal | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Rendered-stop navigation: arrows move by rendered stops (atomic over
 * macro calls and embedded objects, per-offset inside math), ↑/↓ by
 * rendered rows, Home/End to row edges, and Backspace/Delete beside an
 * atomic span select it before deleting (Word's select-then-delete
 * convention). Returns null to fall through to native source-style
 * behavior (no domain, alt-modified keys, range deletes).
 */
export function resolveCanvasRenderedMotion(
  domain: BeamerCaretDomain | null,
  selection: CanvasBufferSelection,
  stroke: CanvasKeyStroke,
  verticalGoal: CanvasVerticalGoal | null
): CanvasMotionResult | null {
  const key = stroke.key;
  const horizontal = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
  const vertical = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
  const isHome = key === "Home";
  const isEnd = key === "End";
  const isBackspace = key === "Backspace";
  const isDelete = key === "Delete";
  if (!horizontal && !vertical && !isHome && !isEnd && !isBackspace && !isDelete) {
    return null;
  }
  if (stroke.alt) {
    return null;
  }
  const withPrimary = stroke.primary;
  if ((isBackspace || isDelete) && (withPrimary || stroke.shift)) {
    return null;
  }
  if (!domain || domain.offsets.length === 0) {
    return null;
  }
  const { bufferFrom, bufferLength } = selection;
  const toDocument = (local: number) => bufferFrom + clamp(local, 0, bufferLength);
  const toLocal = (documentOffset: number) =>
    clamp(documentOffset - bufferFrom, 0, bufferLength);

  if (isBackspace || isDelete) {
    if (selection.selectionStart !== selection.selectionEnd) {
      // Range deletes (including an atom selected by the previous press)
      // run natively through the beforeinput machine.
      return null;
    }
    const atom = beamerCaretAtomBeside(
      domain,
      toDocument(selection.selectionStart),
      isBackspace ? "before" : "after"
    );
    if (!atom) {
      return null;
    }
    return {
      selectionStart: toLocal(atom.from),
      selectionEnd: toLocal(atom.to),
      direction: isBackspace ? "backward" : "forward",
      verticalGoal,
    };
  }

  const focusLocal = selection.backward ? selection.selectionStart : selection.selectionEnd;
  const anchorLocal = selection.backward ? selection.selectionEnd : selection.selectionStart;
  const hasRange = selection.selectionStart !== selection.selectionEnd;
  const focusDoc = toDocument(focusLocal);
  const domainFocus = nearestBeamerCaretOffset(domain, focusDoc) ?? focusDoc;

  let nextDoc: number | null;
  let nextVerticalGoal: CanvasVerticalGoal | null = null;
  if (isHome || isEnd || (withPrimary && horizontal !== 0)) {
    nextDoc = beamerCaretRowEdgeOffset(
      domain,
      domainFocus,
      isHome || horizontal < 0 ? "start" : "end"
    );
  } else if (withPrimary && vertical !== 0) {
    const row = vertical < 0 ? domain.rows[0] : domain.rows[domain.rows.length - 1];
    const stop = vertical < 0 ? row?.stops[0] : row?.stops[row.stops.length - 1];
    nextDoc = stop?.offset ?? null;
  } else if (horizontal !== 0) {
    if (!stroke.shift && hasRange) {
      // Plain arrows collapse a range onto its edge without moving.
      nextDoc = horizontal < 0
        ? toDocument(selection.selectionStart)
        : toDocument(selection.selectionEnd);
    } else {
      nextDoc = nextBeamerCaretOffset(domain, domainFocus, horizontal) ?? domainFocus;
    }
  } else {
    const goalX = verticalGoal?.offset === domainFocus ? verticalGoal.x : null;
    const moved = verticalBeamerCaretOffset(domain, domainFocus, vertical as -1 | 1, goalX);
    if (moved) {
      nextDoc = moved.offset;
      nextVerticalGoal = { offset: moved.offset, x: moved.goalX };
    } else {
      nextDoc = domainFocus;
    }
  }
  if (nextDoc == null) {
    return null;
  }

  const nextLocal = toLocal(nextDoc);
  if (stroke.shift) {
    return {
      selectionStart: Math.min(anchorLocal, nextLocal),
      selectionEnd: Math.max(anchorLocal, nextLocal),
      direction: nextLocal < anchorLocal ? "backward" : "forward",
      verticalGoal: nextVerticalGoal,
    };
  }
  return {
    selectionStart: nextLocal,
    selectionEnd: nextLocal,
    direction: "none",
    verticalGoal: nextVerticalGoal,
  };
}

export type CanvasStructuralKeyOutcome =
  | { readonly kind: "native" }
  | { readonly kind: "swallow" }
  | { readonly kind: "patch"; readonly patch: BeamerStructuralPatch };

/**
 * Structural keys under canvas focus (Enter, Shift+Enter, Tab, and
 * Backspace/Delete at list-item edges). "native" falls through to the
 * next handler; "swallow" consumes the key without editing.
 */
export function resolveCanvasStructuralKey(
  domain: BeamerCaretDomain | null,
  selection: CanvasBufferSelection,
  stroke: CanvasKeyStroke
): CanvasStructuralKeyOutcome {
  const key = stroke.key;
  const isEnter = key === "Enter";
  const isTab = key === "Tab";
  const isBackspace = key === "Backspace";
  const isDelete = key === "Delete";
  if (!isEnter && !isTab && !isBackspace && !isDelete) {
    return { kind: "native" };
  }
  if (stroke.primary || stroke.alt) {
    return { kind: "native" };
  }
  if ((isBackspace || isDelete) && stroke.shift) {
    return { kind: "native" };
  }
  const hasRange = selection.selectionStart !== selection.selectionEnd;
  if (hasRange && (isBackspace || isDelete)) {
    // Range deletes (including a selected atom) run natively through the
    // beforeinput machine.
    return { kind: "native" };
  }
  if (!domain) {
    // No rendered domain: degrade to plain source keys (design safety
    // property); Tab still must not escape the session.
    return isTab ? { kind: "swallow" } : { kind: "native" };
  }
  const offset =
    selection.bufferFrom + Math.min(selection.selectionStart, selection.selectionEnd);
  const end =
    selection.bufferFrom + Math.max(selection.selectionStart, selection.selectionEnd);
  let result: BeamerStructuralKeyResult;
  if (isEnter) {
    result = stroke.shift
      ? beamerStructuralLineBreakPatch(domain, offset, end)
      : beamerStructuralEnterPatch(domain, offset, end);
    if (result == null) {
      // Unknown context (fallback-rendered chunk): plain newline through
      // the beforeinput machine.
      return { kind: "native" };
    }
  } else if (isTab) {
    result = beamerStructuralTabPatch(domain, offset, stroke.shift ? "unnest" : "nest", end);
  } else {
    result = isBackspace
      ? beamerStructuralBackspacePatch(domain, offset)
      : beamerStructuralDeletePatch(domain, offset);
    if (result == null) {
      return { kind: "native" };
    }
  }
  if (!result || result === "swallow") {
    return { kind: "swallow" };
  }
  return { kind: "patch", patch: result };
}

/**
 * Applies a structural patch to a session buffer under the staleness
 * guard (the domain reflects the last reconciled render): every edited
 * range must still hold the text the patch was computed against, else the
 * edit is dropped (null) and the caller waits for reconciliation.
 */
export function applyBeamerStructuralPatchToBuffer(
  buffer: { readonly text: string; readonly from: number },
  domainSource: string,
  patch: BeamerStructuralPatch
): { nextText: string; caretLocal: number; selectionEndLocal: number } | null {
  const toLocal = (documentOffset: number) => documentOffset - buffer.from;
  for (const edit of patch.edits) {
    const from = toLocal(edit.span.from);
    const to = toLocal(edit.span.to);
    if (from < 0 || to > buffer.text.length || from > to) {
      return null;
    }
    if (buffer.text.slice(from, to) !== domainSource.slice(edit.span.from, edit.span.to)) {
      return null;
    }
  }
  let nextText = buffer.text;
  for (let index = patch.edits.length - 1; index >= 0; index -= 1) {
    const edit = patch.edits[index];
    nextText =
      nextText.slice(0, toLocal(edit.span.from)) +
      edit.insert +
      nextText.slice(toLocal(edit.span.to));
  }
  return {
    nextText,
    caretLocal: clamp(toLocal(patch.caretOffset), 0, nextText.length),
    selectionEndLocal: clamp(toLocal(patch.selectionEnd ?? patch.caretOffset), 0, nextText.length),
  };
}
