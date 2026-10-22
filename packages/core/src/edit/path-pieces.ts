import { joinFragments, layout, sourceSlice, tikz, type CoordinateText, type TikzFragment } from "./fragment.js";
import type { CoordinateItem, Span } from "../ast/types.js";
import type { WorldPoint } from "../coords/points.js";
import { isCoordinateEditHandle, isRelativeCoordinateEditHandle, type CoordinateEditHandle, type EditHandle } from "../semantic/types.js";
import { normalizeOptionKey } from "./option-key.js";
import { createCoordinateWriter, type WriterResult } from "./writer/index.js";
import type { ExplicitPathAnalysis, ExplicitPathSegment } from "./path-editing.js";

/** A point of a rewritten path: one of the statement's coordinates, or one the writer wrote. */
export type PathPoint =
  | Readonly<{ kind: "item"; index: number }>
  | Readonly<{ kind: "written"; text: CoordinateText; world: WorldPoint }>;

/**
 * A rewritten path, piece by piece. `segment` is one of the path's own
 * segments, in its own direction; `line` and `curve` are segments the
 * rewrite makes. A closing `cycle` stays the last piece.
 */
export type PathPiece =
  | Readonly<{ kind: "start"; point: PathPoint }>
  | Readonly<{ kind: "segment"; segment: ExplicitPathSegment }>
  | Readonly<{ kind: "line"; target: PathPoint | "cycle" }>
  | Readonly<{ kind: "curve"; control1: PathPoint; control2: PathPoint | null; target: PathPoint | "cycle" }>;

export function itemPoint(index: number): PathPoint {
  return { kind: "item", index };
}

/** The path's own pieces from `startAnchorIndex`, through the given segments. */
export function segmentPieces(analysis: ExplicitPathAnalysis, startAnchorIndex: number, segmentIndices: readonly number[]): PathPiece[] {
  const start = analysis.anchors[startAnchorIndex];
  if (!start) throw new RangeError(`No anchor ${startAnchorIndex}`);
  const pieces: PathPiece[] = [{ kind: "start", point: itemPoint(start.coordinateIndex) }];
  for (const index of segmentIndices) {
    const segment = analysis.segments[index];
    if (segment && !segment.closesPath) pieces.push({ kind: "segment", segment });
  }
  return pieces;
}

/** A segment as a piece that ends at a point instead of closing the path. */
export function explicitPiece(analysis: ExplicitPathAnalysis, segment: ExplicitPathSegment): PathPiece {
  if (!segment.closesPath) return { kind: "segment", segment };
  const target = analysis.anchors[segment.endAnchorIndex];
  if (!target) throw new RangeError(`No anchor ${segment.endAnchorIndex}`);
  return segment.kind === "line"
    ? { kind: "line", target: itemPoint(target.coordinateIndex) }
    : { kind: "curve", control1: itemPoint(segment.control1Index), control2: segment.usedAnd ? itemPoint(segment.control2Index) : null, target: itemPoint(target.coordinateIndex) };
}

type Step =
  | { kind: "start"; point: PathPoint }
  | { kind: "line"; target: PathPoint | "cycle" }
  | { kind: "curve"; control1: PathPoint; control2: PathPoint | null; target: PathPoint | "cycle" };

function stepOf(piece: PathPiece): Step {
  if (piece.kind !== "segment") return piece;
  const { segment } = piece;
  const target = segment.closesPath ? "cycle" : itemPoint(segment.targetIndex);
  return segment.kind === "line"
    ? { kind: "line", target }
    : { kind: "curve", control1: itemPoint(segment.control1Index), control2: segment.usedAnd ? itemPoint(segment.control2Index) : null, target };
}

/** Where a point is read from: `null` before the path has a current point. */
type Base = WorldPoint | null;

/** Where a path stands: the last point it reached, and the current point relative coordinates are read from. */
export type PathState = Readonly<{ drawn: Base; current: Base }>;

/**
 * Walks `steps` as TikZ reads them, telling `visit` the point each
 * coordinate is read from: a coordinate from the current point, which a `+`
 * one does not update; a first control from where the curve starts; a
 * curve's end from the current point; a second control from the curve's
 * end (controls never update it). `visit` returns the coordinate's prefix
 * as it is written, which decides whether it updates the current point.
 */
function readPath(
  steps: readonly Step[],
  worldOf: (point: PathPoint) => WorldPoint,
  visit: (point: PathPoint, base: Base) => string | undefined,
  from: PathState = { drawn: null, current: null }
): PathState {
  let drawn: Base = from.drawn;
  let current: Base = from.current;
  let first: Base = null;
  const reach = (point: PathPoint | "cycle") => {
    if (point === "cycle") {
      drawn = first;
      current = first;
      return;
    }
    const prefix = visit(point, current);
    drawn = worldOf(point);
    if (prefix !== "+") current = drawn;
  };
  for (const step of steps) {
    if (step.kind === "start") {
      reach(step.point);
      first = drawn;
    } else if (step.kind === "line") {
      reach(step.target);
    } else {
      visit(step.control1, drawn);
      reach(step.target);
      if (step.control2) visit(step.control2, drawn);
    }
  }
  return { drawn, current };
}

/** The points of `steps`, in the order `readPath` visits them. */
function stepPoints(steps: readonly Step[]): PathPoint[] {
  return steps.flatMap(step => {
    if (step.kind === "start") return [step.point];
    if (step.kind === "line") return step.target === "cycle" ? [] : [step.target];
    return [step.control1, ...(step.target === "cycle" ? [] : [step.target]), ...(step.control2 ? [step.control2] : [])];
  });
}

export type SpellPathInput = Readonly<{
  source: string;
  analysis: ExplicitPathAnalysis;
  pieces: readonly PathPiece[];
  /** The handles of the path's coordinates, asked for only when a relative coordinate may need them. */
  handles: () => readonly EditHandle[];
  /**
   * When the pieces continue another path (a join, or segments prepended):
   * where that one stands, so the first piece is reached from there. Asked
   * for only when a relative coordinate needs it; null refuses.
   */
  continuesFrom?: () => PathState | null;
}>;

/**
 * The text of a rewritten path. A relative coordinate is read from the point
 * before it, so one that lands after a different point is written again
 * from there (`writer.point` with the new base), or as an absolute point
 * where the path starts; every other coordinate keeps its text.
 */
export function spellPath(input: SpellPathInput): WriterResult<TikzFragment> {
  const { source, analysis, pieces } = input;
  const steps = pieces.map(stepOf);
  // Keyed by occurrence: a path opened at a point starts and ends at it.
  const respelled = new Map<string, CoordinateText>();
  const absolute = new Set<string>();
  const relative = stepPoints(steps).some(point => point.kind === "item" && isRelativeItem(coordinateAt(analysis, point.index)));
  if (relative) {
    const refusal = respellRelative(input, steps, respelled, absolute);
    if (refusal) return refusal;
  }

  const occurrence = occurrences();
  // A coordinate's span leaves out its `+`/`++`, which goes with it unless it became absolute.
  const pointText = (point: PathPoint): TikzFragment => {
    if (point.kind === "written") return point.text;
    const key = occurrence(point.index);
    const text = respelled.get(key) ?? sourceSlice(source, coordinateAt(analysis, point.index).span);
    if (absolute.has(key)) return text;
    const prefix = coordinateAt(analysis, point.index).relativePrefix;
    return prefix === "++" ? tikz`++${text}` : prefix === "+" ? tikz`+${text}` : text;
  };
  const targetText = (target: PathPoint | "cycle"): TikzFragment => target === "cycle" ? tikz`cycle` : pointText(target);
  const parts = pieces.map((piece): TikzFragment => {
    switch (piece.kind) {
      case "start":
        return pointText(piece.point);
      case "segment":
        return segmentText(source, analysis, piece.segment, index => respelled.get(occurrence(index)));
      case "line":
        return tikz`-- ${targetText(piece.target)}`;
      case "curve":
        return piece.control2
          ? tikz`.. controls ${pointText(piece.control1)} and ${pointText(piece.control2)} .. ${targetText(piece.target)}`
          : tikz`.. controls ${pointText(piece.control1)} .. ${targetText(piece.target)}`;
    }
  });
  return { kind: "ok", fragment: joinFragments(parts, layout(" ")) };
}

/**
 * Fills `respelled` with the relative coordinates read from another point
 * than before, and `absolute` with those that became absolute; a refusal
 * when one cannot be written.
 */
function respellRelative(input: SpellPathInput, steps: readonly Step[], respelled: Map<string, CoordinateText>, absolute: Set<string>): WriterResult<never> | null {
  const { source, analysis, pieces } = input;
  const handles = input.handles();
  const ownSteps = originalSteps(analysis);
  const located = locate(source, analysis, handles, [...stepPoints(ownSteps), ...stepPoints(steps)]);
  if (!located) return unsupported("a coordinate of the path has no position to rewrite it from");
  const { worldOf, handleOf } = located;

  // The points the path's coordinates were read from, checked against the evaluator's.
  const ownBases = new Map<number, Base>();
  const unknownBases: number[] = [];
  readPath(ownSteps, worldOf, (point, base) => {
    if (point.kind !== "item") return;
    ownBases.set(point.index, base);
    const handle = handleOf(point.index);
    if (base && handle && isRelativeCoordinateEditHandle(handle) && !samePoint(base, handle.relativeBase)) unknownBases.push(point.index);
    return coordinateAt(analysis, point.index).relativePrefix;
  });
  if (unknownBases.length > 0) return unsupported("a relative coordinate is read from a point this rewrite does not know");

  const from = input.continuesFrom?.();
  if (from === null) return unsupported("the path this one continues has no position to read its points from");
  // A turn follows the tangent into it, which only an unchanged path before it keeps.
  const unchangedItems = new Set(stepPoints(pieces.slice(0, unchangedPrefixLength(pieces, analysis)).map(stepOf))
    .flatMap(point => point.kind === "item" ? [point.index] : []));
  const writer = createCoordinateWriter(source);
  const refusals: WriterResult<never>[] = [];
  const occurrence = occurrences();
  readPath(steps, worldOf, (point, base) => {
    if (point.kind !== "item") return;
    const key = occurrence(point.index);
    const item = coordinateAt(analysis, point.index);
    if (!isRelativeItem(item) || refusals.length > 0) return item.relativePrefix;
    if (hasTurn(item)) {
      if (!unchangedItems.has(point.index)) refusals.push(unsupported("a `turn` coordinate cannot be moved to another place in the path"));
      return item.relativePrefix;
    }
    if (sameBase(base, ownBases.get(point.index) ?? null)) return item.relativePrefix;
    const handle = handleOf(point.index);
    if (!handle) {
      refusals.push(unsupported("a coordinate of the path has no position to rewrite it from"));
      return item.relativePrefix;
    }
    // Where nothing comes before it, the coordinate becomes absolute.
    // The point does not move, so it is written exactly, not rounded like a drag.
    const written = base === null
      ? writer.point({ kind: "context", context: handle.siteContext, replaces: withoutRelativePrefix(source.slice(item.span.from, item.span.to)) }, handle.world, EXACT)
      : writer.point({ kind: "coordinate", handle, relativeBase: base }, handle.world, EXACT);
    if (written.kind !== "ok") {
      refusals.push(written);
      return item.relativePrefix;
    }
    respelled.set(key, written.fragment);
    if (base !== null) return item.relativePrefix;
    absolute.add(key);
    return;
  }, from);
  return refusals[0] ?? null;
}

/** Where a path stands at its end, as its relative coordinates read it; null without a position for every point. */
export function pathEndState(source: string, analysis: ExplicitPathAnalysis, handles: readonly EditHandle[]): PathState | null {
  const steps = originalSteps(analysis);
  const located = locate(source, analysis, handles, stepPoints(steps));
  if (!located) return null;
  return readPath(steps, located.worldOf, point => point.kind === "item" ? coordinateAt(analysis, point.index).relativePrefix : "");
}

/** The path as it is written: its start, its segments, and the closing one last. */
function originalSteps(analysis: ExplicitPathAnalysis): Step[] {
  return [...segmentPieces(analysis, 0, analysis.segments.map((_, index) => index)).map(stepOf),
    ...analysis.segments.filter(segment => segment.closesPath).map(segment => stepOf({ kind: "segment", segment }))];
}

function locate(source: string, analysis: ExplicitPathAnalysis, handles: readonly EditHandle[], points: readonly PathPoint[]) {
  const found = new Map<number, CoordinateEditHandle>();
  for (const point of points) {
    if (point.kind !== "item" || found.has(point.index)) continue;
    const handle = coordinateHandle(source, analysis, handles, point.index);
    if (!handle) return null;
    found.set(point.index, handle);
  }
  return {
    handleOf: (index: number) => found.get(index),
    worldOf: (point: PathPoint): WorldPoint => {
      if (point.kind === "written") return point.world;
      const handle = found.get(point.index);
      if (!handle) throw new RangeError(`No position for path item ${point.index}`);
      return handle.world;
    }
  };
}

function coordinateAt(analysis: ExplicitPathAnalysis, index: number): CoordinateItem {
  const item = analysis.statement.items[index];
  if (item?.kind !== "Coordinate") throw new RangeError(`Path item ${index} is not a coordinate`);
  return item;
}

function coordinateHandle(source: string, analysis: ExplicitPathAnalysis, handles: readonly EditHandle[], index: number): CoordinateEditHandle | undefined {
  const item = analysis.statement.items[index];
  if (item?.kind !== "Coordinate") return undefined;
  const span = item.span;
  return handles.find((candidate): candidate is CoordinateEditHandle =>
    isCoordinateEditHandle(candidate) &&
    candidate.sourceRef.sourceId === analysis.statement.id &&
    (candidate.kind === "path-point" || candidate.kind === "path-control") &&
    sameSpan(candidate.sourceRef.sourceSpan, span) &&
    source.slice(span.from, span.to) === candidate.sourceText);
}

/** A segment's own text, with the coordinates written again replaced in place. */
function segmentText(source: string, analysis: ExplicitPathAnalysis, segment: ExplicitPathSegment, respelled: (index: number) => CoordinateText | undefined): TikzFragment {
  const items = analysis.statement.items;
  const from = items[segment.operatorIndex]?.span.from;
  const to = items[segment.targetIndex]?.span.to;
  if (from === undefined || to === undefined) throw new RangeError("Segment items are missing");
  const indices = segment.kind === "cubic" ? [segment.control1Index, ...(segment.usedAnd ? [segment.control2Index] : []), segment.targetIndex] : [segment.targetIndex];
  const parts: TikzFragment[] = [];
  let cursor = from;
  for (const index of indices) {
    const replacement = respelled(index);
    const span = items[index]?.span;
    if (!replacement || !span) continue;
    parts.push(sourceSlice(source, { from: cursor, to: span.from }), replacement);
    cursor = span.to;
  }
  parts.push(sourceSlice(source, { from: cursor, to }));
  return joinFragments(parts);
}

/** Counts each item's occurrences, in the order they are met: `index#n`. */
function occurrences(): (index: number) => string {
  const seen = new Map<number, number>();
  return index => {
    const count = seen.get(index) ?? 0;
    seen.set(index, count + 1);
    return `${index}#${count}`;
  };
}

/** How many of `pieces` repeat the path's own pieces from its start. */
function unchangedPrefixLength(pieces: readonly PathPiece[], analysis: ExplicitPathAnalysis): number {
  const original = segmentPieces(analysis, 0, analysis.segments.map((_, index) => index));
  let length = 0;
  for (const [index, piece] of pieces.entries()) {
    const own = original[index];
    const same = own !== undefined && (
      (piece.kind === "start" && own.kind === "start" && piece.point.kind === "item" && own.point.kind === "item" && piece.point.index === own.point.index) ||
      (piece.kind === "segment" && own.kind === "segment" && piece.segment === own.segment));
    if (!same) break;
    length += 1;
  }
  return length;
}


function isRelativeItem(item: CoordinateItem): boolean {
  return item.relativePrefix !== undefined || hasTurn(item);
}

function hasTurn(item: CoordinateItem): boolean {
  return item.options?.entries.some(entry => (entry.kind === "flag" || entry.kind === "kv") && normalizeOptionKey(entry.key) === "turn") ?? false;
}

function withoutRelativePrefix(raw: string): string {
  return raw.replace(/^\s*\+\+?\s*/u, "");
}


const TOLERANCE_PT = 1e-3;
const EXACT = { precision: "reparameterize" } as const;

function samePoint(left: WorldPoint, right: WorldPoint): boolean {
  return Math.abs(left.x - right.x) <= TOLERANCE_PT && Math.abs(left.y - right.y) <= TOLERANCE_PT;
}

function sameBase(left: Base, right: Base): boolean {
  return left === null || right === null ? left === right : samePoint(left, right);
}

function sameSpan(left: Span, right: Span): boolean {
  return left.from === right.from && left.to === right.to;
}

function unsupported(reason: string): WriterResult<never> {
  return { kind: "unsupported", reason };
}
