import type { DeckActiveFrame } from "./compute";
import type { buildBeamerObjectIndex } from "@tikz-editor/core/beamer/index";
import type { createTextLayoutContext } from "@tikz-editor/core/text/layout-context";

// Each typed key owns its values, preventing callers from interpreting the
// same string key as unrelated types. Frames retain weak ownership.
export class DeckPageDerivedKey<T> {
  private readonly entries = new WeakMap<DeckActiveFrame, { source: string; value: T }>();

  readonly derive = (frame: DeckActiveFrame, source: string, build: () => T): T => {
    const entry = this.entries.get(frame);
    if (entry?.source === source) return entry.value;
    const value = build();
    this.entries.set(frame, { source, value });
    return value;
  };
}

export const deckObjectIndexKey = new DeckPageDerivedKey<ReturnType<typeof buildBeamerObjectIndex>>();
export const deckTextContextKey = new DeckPageDerivedKey<ReturnType<typeof createTextLayoutContext>>();

export function deckPageDerived<T>(frame: DeckActiveFrame, source: string, key: DeckPageDerivedKey<T>, build: () => T): T {
  return key.derive(frame, source, build);
}
