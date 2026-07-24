import type { Statement } from "../ast/types.js";
import { tikzFigureIndexFromRootId } from "../document/root-id.js";
import { scanTikzFigures } from "./figure-scan.js";

export type ContextDefinitionCacheEntry = {
  prefix: string;
  definitions: Statement[];
};

let contextDefinitionCache: ContextDefinitionCacheEntry | null = null;

export function getCachedContextDefinitions(
  prefix: string,
  collectContextDefinitions: (prefix: string) => Statement[]
): Statement[] {
  const cache = contextDefinitionCache;
  if (cache?.prefix === prefix) {
    return cache.definitions;
  }
  const definitions = collectContextDefinitions(prefix);
  contextDefinitionCache = { prefix, definitions };
  return definitions;
}

export function resolveParseWindowSource(
  source: string,
  activeFigureSpan: { from: number; to: number } | null
): string {
  if (!activeFigureSpan) {
    return source;
  }
  const safeFrom = Math.max(0, Math.min(source.length, activeFigureSpan.from));
  const safeTo = Math.max(safeFrom, Math.min(source.length, activeFigureSpan.to));
  const prefix = source.slice(0, safeFrom).replace(/[^\n]/g, " ");
  const figure = source.slice(safeFrom, safeTo);
  return `${prefix}${figure}`;
}

export function resolveActiveFigureSpan(
  spans: readonly { from: number; to: number }[],
  activeFigureId: string | null | undefined
): { from: number; to: number } | null {
  if (activeFigureId === null) {
    return null;
  }
  if (spans.length === 0) {
    return null;
  }
  const requestedIndex = activeFigureId
    ? tikzFigureIndexFromRootId(activeFigureId)
    : 0;
  const index =
    requestedIndex != null && requestedIndex >= 0 && requestedIndex < spans.length
      ? requestedIndex
      : 0;
  return spans[index] ?? null;
}

export function scanFigureSpans(source: string): Array<{ from: number; to: number }> {
  return scanTikzFigures(source)
    .filter((figure) => !figure.isTemplate)
    .map((figure) => ({ from: figure.span.from, to: figure.span.to }));
}
