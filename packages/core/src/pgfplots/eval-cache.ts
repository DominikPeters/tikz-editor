/**
 * Content-keyed caches inside axis evaluation (design/pgfplots.md 4.3):
 * dragging an axis or a neighbouring node re-evaluates the axis statement,
 * but must not resample its plots or re-read its tables. A key holds
 * everything the cached value depends on, as text, so a warm evaluation
 * equals a cold one; values are never mutated by their users.
 */
import type { PlotData } from "./data.js";

const MAX_ENTRIES = 96;

let enabled = true;
const plotData = new Map<string, PlotData>();
let stats = { hits: 0, misses: 0 };

/** For tests and benchmarks: switch the caches off (and clear them). */
export function setPgfplotsEvaluationCachesEnabled(value: boolean): void {
  enabled = value;
  plotData.clear();
}

export function pgfplotsEvaluationCacheStats(): { hits: number; misses: number } {
  return { ...stats };
}

export function resetPgfplotsEvaluationCacheStats(): void {
  stats = { hits: 0, misses: 0 };
}

/**
 * The data of one plot. `key` is null when the data depends on something
 * outside the document text (a table file, a `\pgfplotstableread` macro).
 * Only plain point lists are kept: results that carry source spans
 * (diagnostics) are recomputed so their positions stay current.
 */
export function cachedPlotData(key: string | null, compute: () => PlotData): PlotData {
  if (!enabled || key === null) return compute();
  const hit = plotData.get(key);
  if (hit) {
    stats.hits += 1;
    // Most recently used last.
    plotData.delete(key);
    plotData.set(key, hit);
    return hit;
  }
  stats.misses += 1;
  const value = compute();
  if (value.kind === "points" && !value.notes?.length) {
    plotData.set(key, value);
    if (plotData.size > MAX_ENTRIES) {
      const oldest = plotData.keys().next().value;
      if (oldest !== undefined) plotData.delete(oldest);
    }
  }
  return value;
}

/**
 * JSON of a value without source positions: spans, statements and option
 * origins move with unrelated edits and do not change data.
 */
export function stableKeyText(value: unknown): string | null {
  try {
    return stableKeyTextUnchecked(value);
  } catch {
    // Cyclic or otherwise unserialisable: no key, no caching.
    return null;
  }
}

function stableKeyTextUnchecked(value: unknown): string {
  return JSON.stringify(value, (key, nested: unknown) => {
    if (key === "span" || key === "statement" || key === "origin" || key.endsWith("Span")) return undefined;
    if (nested instanceof Map) return [...nested.entries()];
    if (nested instanceof Set) return [...nested.values()];
    if (typeof nested === "function") return String(nested);
    return nested;
  });
}
