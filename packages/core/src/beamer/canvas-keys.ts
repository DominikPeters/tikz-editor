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
 * Canvas-focus editing decisions for Beamer scope sessions, kept DOM-free
 * so the editing session and headless scenario tests share one
 * implementation. Selections are buffer-local offsets into the session
 * buffer, which starts at `bufferFrom` in the document.
 */
export type CanvasBufferSelection = {
  readonly bufferFrom: number;
  readonly bufferLength: number;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly backward: boolean;
};

export type CanvasVerticalGoal = { readonly offset: number; readonly x: number };

/**
 * `item`: ←/→ by rendered stops; `line`: ↑/↓ by rendered rows; `edge`:
 * row edges; `scope`: the first or last stop of the scope.
 */
export type CanvasMotion = {
  readonly dir: "left" | "right" | "up" | "down";
  readonly unit: "item" | "line" | "edge" | "scope";
  readonly extend: boolean;
};

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
 * Rendered-stop navigation: atomic over macro calls and embedded objects,
 * per-offset inside math. Returns null when there is no rendered domain
 * (the caller degrades to source-character motion).
 */
export function resolveCanvasRenderedMotion(
  domain: BeamerCaretDomain | null,
  selection: CanvasBufferSelection,
  motion: CanvasMotion,
  verticalGoal: CanvasVerticalGoal | null
): CanvasMotionResult | null {
  if (!domain || domain.offsets.length === 0) {
    return null;
  }
  const { bufferFrom, bufferLength } = selection;
  const toDocument = (local: number) => bufferFrom + clamp(local, 0, bufferLength);
  const toLocal = (documentOffset: number) =>
    clamp(documentOffset - bufferFrom, 0, bufferLength);
  const backwardDir = motion.dir === "left" || motion.dir === "up";

  const focusLocal = selection.backward ? selection.selectionStart : selection.selectionEnd;
  const anchorLocal = selection.backward ? selection.selectionEnd : selection.selectionStart;
  const hasRange = selection.selectionStart !== selection.selectionEnd;
  const focusDoc = toDocument(focusLocal);
  const domainFocus = nearestBeamerCaretOffset(domain, focusDoc) ?? focusDoc;

  let nextDoc: number | null;
  let nextVerticalGoal: CanvasVerticalGoal | null = null;
  switch (motion.unit) {
    case "edge":
      nextDoc = beamerCaretRowEdgeOffset(domain, domainFocus, backwardDir ? "start" : "end");
      break;
    case "scope": {
      const row = backwardDir ? domain.rows[0] : domain.rows[domain.rows.length - 1];
      const stop = backwardDir ? row?.stops[0] : row?.stops[row.stops.length - 1];
      nextDoc = stop?.offset ?? null;
      break;
    }
    case "item":
      if (!motion.extend && hasRange) {
        // Plain arrows collapse a range onto its edge without moving.
        nextDoc = backwardDir
          ? toDocument(selection.selectionStart)
          : toDocument(selection.selectionEnd);
      } else {
        nextDoc = nextBeamerCaretOffset(domain, domainFocus, backwardDir ? -1 : 1) ?? domainFocus;
      }
      break;
    case "line": {
      const goalX = verticalGoal?.offset === domainFocus ? verticalGoal.x : null;
      const moved = verticalBeamerCaretOffset(domain, domainFocus, backwardDir ? -1 : 1, goalX);
      if (moved) {
        nextDoc = moved.offset;
        nextVerticalGoal = { offset: moved.offset, x: moved.goalX };
      } else {
        nextDoc = domainFocus;
      }
      break;
    }
  }
  if (nextDoc == null) {
    return null;
  }

  const nextLocal = toLocal(nextDoc);
  if (motion.extend) {
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

/**
 * Backspace/Delete beside an atomic span (macro output, embedded object)
 * selects it instead of deleting (Word's select-then-delete convention).
 * Null when the selection is a range or nothing atomic is adjacent.
 */
export function resolveCanvasAtomSelection(
  domain: BeamerCaretDomain | null,
  selection: CanvasBufferSelection,
  direction: "backward" | "forward"
): CanvasMotionResult | null {
  if (!domain || domain.offsets.length === 0 || selection.selectionStart !== selection.selectionEnd) {
    return null;
  }
  const { bufferFrom, bufferLength } = selection;
  const atom = beamerCaretAtomBeside(
    domain,
    bufferFrom + clamp(selection.selectionStart, 0, bufferLength),
    direction === "backward" ? "before" : "after"
  );
  if (!atom) {
    return null;
  }
  return {
    selectionStart: clamp(atom.from - bufferFrom, 0, bufferLength),
    selectionEnd: clamp(atom.to - bufferFrom, 0, bufferLength),
    direction,
    verticalGoal: null,
  };
}

/**
 * Outcome of a structural key: "native" means the key has no structural
 * meaning here (the caller applies its plain behaviour); "swallow"
 * consumes it without editing.
 */
export type CanvasStructuralKeyOutcome =
  | { readonly kind: "native" }
  | { readonly kind: "swallow" }
  | { readonly kind: "patch"; readonly patch: BeamerStructuralPatch };

function structuralOutcome(result: BeamerStructuralKeyResult): CanvasStructuralKeyOutcome {
  if (!result || result === "swallow") {
    return { kind: "swallow" };
  }
  return { kind: "patch", patch: result };
}

function documentRange(selection: CanvasBufferSelection): { offset: number; end: number } {
  return {
    offset: selection.bufferFrom + Math.min(selection.selectionStart, selection.selectionEnd),
    end: selection.bufferFrom + Math.max(selection.selectionStart, selection.selectionEnd),
  };
}

/** Enter (item split) and Shift+Enter (line break) under canvas focus. */
export function resolveCanvasStructuralEnter(
  domain: BeamerCaretDomain | null,
  selection: CanvasBufferSelection,
  soft: boolean
): CanvasStructuralKeyOutcome {
  if (!domain) {
    return { kind: "native" };
  }
  const { offset, end } = documentRange(selection);
  const result = soft
    ? beamerStructuralLineBreakPatch(domain, offset, end)
    : beamerStructuralEnterPatch(domain, offset, end);
  // Unknown context (fallback-rendered chunk): plain newline.
  return result == null ? { kind: "native" } : structuralOutcome(result);
}

/** Tab / Shift+Tab: nest or unnest list items; never leaves the session. */
export function resolveCanvasStructuralTab(
  domain: BeamerCaretDomain | null,
  selection: CanvasBufferSelection,
  back: boolean
): CanvasStructuralKeyOutcome {
  if (!domain) {
    return { kind: "swallow" };
  }
  const { offset, end } = documentRange(selection);
  return structuralOutcome(beamerStructuralTabPatch(domain, offset, back ? "unnest" : "nest", end));
}

/** Backspace/Delete at list-item edges (merge, unnest). Collapsed carets only. */
export function resolveCanvasStructuralDelete(
  domain: BeamerCaretDomain | null,
  selection: CanvasBufferSelection,
  direction: "backward" | "forward"
): CanvasStructuralKeyOutcome {
  if (!domain || selection.selectionStart !== selection.selectionEnd) {
    return { kind: "native" };
  }
  const { offset } = documentRange(selection);
  const result = direction === "backward"
    ? beamerStructuralBackspacePatch(domain, offset)
    : beamerStructuralDeletePatch(domain, offset);
  return result == null ? { kind: "native" } : structuralOutcome(result);
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
