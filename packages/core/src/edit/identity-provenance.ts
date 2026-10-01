import type { Span, Statement } from "../ast/types.js";
import { walkStatements } from "../ast/walk.js";
import type { EditGeometrySession } from "./geometry-session.js";
import type { SourcePatch } from "./types.js";

export type IdentityMove = { oldSpan: Span; newSpan: Span };

export function collectIdentitySpans(statements: readonly Statement[]): IdentityMove[] {
  const moves: IdentityMove[] = [];
  const add = ({ span }: { span: Span }) => moves.push({ oldSpan: span, newSpan: span });
  walkStatements(statements, { onStatement: add, onNode: add });
  return moves;
}

/** A relocation proves ownership; ordinary patches only prove surviving spans. */
export function createIdentitySpanMapper(patches: readonly SourcePatch[], moves: readonly IdentityMove[] = []): (span: Span) => Span | null {
  const exact = new Map(moves.map(move => [key(move.oldSpan), move]));
  const containers = [...moves].sort((a, b) => length(a.oldSpan) - length(b.oldSpan));
  const sortedPatches = [...patches].sort((a, b) => b.oldSpan.from - a.oldSpan.from);
  return span => {
    const relocation = exact.get(key(span)) ?? containers.find(move => contains(move.oldSpan, span));
    if (relocation) {
      if (relocation.oldSpan.from === span.from && relocation.oldSpan.to === span.to) return { ...relocation.newSpan };
      const delta = relocation.newSpan.from - relocation.oldSpan.from;
      return { from: span.from + delta, to: span.to + delta };
    }
    let mapped = { ...span };
    for (const patch of sortedPatches) {
      const old = patch.oldSpan, delta = patch.replacement.length - length(old);
      if (old.to <= mapped.from) { mapped = { from: mapped.from + delta, to: mapped.to + delta }; continue; }
      if (old.from >= mapped.to) continue;
      if (old.from <= mapped.from && old.to >= mapped.to) return null;
      if (!contains(mapped, old)) return null;
      mapped.to += delta;
    }
    return mapped;
  };
}

export function advanceIdentityMoves(moves: readonly IdentityMove[], patches: readonly SourcePatch[], relocations: readonly IdentityMove[] = []): IdentityMove[] {
  const mapSpan = createIdentitySpanMapper(patches, relocations);
  return moves.flatMap(move => {
    const newSpan = mapSpan(move.newSpan);
    return newSpan ? [{ oldSpan: move.oldSpan, newSpan }] : [];
  });
}

/** Gestures write from an immutable baseline. Translate that ownership into the
 * current revision as well as the text patches, including a return to baseline. */
export function geometryIdentityMoves(
  geometry: EditGeometrySession, currentSource: string, newSource: string,
  baselinePatches: readonly SourcePatch[], relocations: readonly IdentityMove[] = []
): IdentityMove[] | undefined {
  let cache = geometryMoves.get(geometry);
  if (!cache) {
    cache = { baseline: collectIdentitySpans(geometry.parsed.figure.body), revisions: new Map() };
    geometryMoves.set(geometry, cache);
  }
  const current = currentSource === geometry.source ? cache.baseline : cache.revisions.get(currentSource);
  const next = advanceIdentityMoves(cache.baseline, baselinePatches, relocations);
  cache.revisions.set(newSource, next);
  if (cache.revisions.size > 24) cache.revisions.delete(cache.revisions.keys().next().value!);
  if (!current) return;
  const byOriginalSpan = new Map(current.map(move => [key(move.oldSpan), move.newSpan]));
  return next.flatMap(move => {
    const oldSpan = byOriginalSpan.get(key(move.oldSpan));
    return oldSpan ? [{ oldSpan, newSpan: move.newSpan }] : [];
  });
}

const geometryMoves = new WeakMap<EditGeometrySession, { baseline: IdentityMove[]; revisions: Map<string, IdentityMove[]> }>();
function contains(outer: Span, inner: Span) { return outer.from <= inner.from && outer.to >= inner.to; }
function length(span: Span) { return span.to - span.from; }
function key(span: Span) { return `${span.from}:${span.to}`; }
