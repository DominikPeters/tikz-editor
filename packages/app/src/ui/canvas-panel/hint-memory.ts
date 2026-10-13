import type { EditingHint } from "@tikz-editor/core/editing/input/index";

/**
 * How often each hint of the hint line (V7) has appeared, so that one
 * seen a few times stops showing (the breadcrumb beside it stays). Kept
 * in this browser only; without storage, hints keep showing.
 */
const STORAGE_KEY = "tikz-editor:editing-hints-seen";
const SHOWN_TIMES = 4;

let counts: Record<string, number> | null = null;

function load(): Record<string, number> {
  if (counts) {
    return counts;
  }
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "{}") as unknown;
    counts = stored && typeof stored === "object" ? stored as Record<string, number> : {};
  } catch {
    counts = {};
  }
  return counts;
}

/** Whether a hint still shows, counting this appearance of it. */
export function hintAppears(hint: EditingHint): boolean {
  const seen = load();
  const times = seen[hint.id] ?? 0;
  if (times >= SHOWN_TIMES) {
    return false;
  }
  seen[hint.id] = times + 1;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // Not stored: it shows again next time.
  }
  return true;
}
