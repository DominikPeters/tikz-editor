import type { DeckActiveFrame } from "./compute";

// Weak ownership follows the bounded render cache and currently displayed
// frames. Selection/cursor state must never be put in this cache.
const entries = new WeakMap<DeckActiveFrame, { source: string; values: Map<string, unknown> }>();

export function deckPageDerived<T>(frame: DeckActiveFrame, source: string, key: string, build: () => T): T {
  let entry = entries.get(frame);
  if (entry?.source !== source) {
    entry = { source, values: new Map() }; entries.set(frame, entry);
  }
  if (entry.values.has(key)) return entry.values.get(key) as T;
  const value = build(); entry.values.set(key, value);
  return value;
}
