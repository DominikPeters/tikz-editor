import {
  beamerCaretRowEdgeOffset,
  nearestBeamerCaretOffset,
  nextBeamerCaretOffset,
  verticalBeamerCaretOffset,
  type BeamerCaretDomain,
} from "./caret-stops.js";

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
