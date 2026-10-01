import { createBoundsIndex, createMutableBoundsIndex, createPointIndex } from "./spatial-index.js";
import { worldPoint, worldBounds } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldBounds, WorldPoint } from "../../coords/points.js";
import { roundSnapValue } from "./point-snaps.js";
import {
  SNAP_EPSILON,
  boundsIntersect,
  mergeBounds,
  rangeIntersection,
  rangesOverlap
} from "./geometry.js";
import type {
  Axis,
  AxisMinOffset,
  AxisSnapBuckets,
  Gap,
  GapSnapCandidate,
  SnapBounds,
  SnapLine
} from "./types.js";

export function buildVisibleGaps(
  referenceBounds: readonly SnapBounds[],
  maxPairsPerAxis: number
): { horizontal: Gap[]; vertical: Gap[] } {
  // Overlapping/nested bounds (matrix cells inside their matrix envelope, stacked
  // shapes) act as one unit for spacing purposes; without the merge every contained
  // box would both spawn its own gaps and fail the adjacency test below.
  const mergedBounds = mergeIntersectingBounds(referenceBounds);

  const query = createBoundsIndex(mergedBounds);
  const horizontal: Gap[] = [];
  const vertical: Gap[] = [];

  const sortedX = [...mergedBounds].sort((a, b) => a.minX - b.minX);
  let pairs = 0;

  const xIndices = new Map(sortedX.map((bounds, index) => [bounds, index]));
  for (let i = 0; i < sortedX.length && pairs < maxPairsPerAxis; i += 1) {
    const start = sortedX[i];
    const last = Math.min(sortedX.length - 1, i + maxPairsPerAxis - pairs);
    pairs += sortedX.length - i - 1;
    const candidates = query(worldBounds(start.maxX, start.minY, pt(Infinity), start.maxY))
      .filter(end => xIndices.get(end)! > i && xIndices.get(end)! <= last)
      .sort((a, b) => xIndices.get(a)! - xIndices.get(b)!);
    for (const end of candidates) {
      if (start.maxX >= end.minX) {
        continue;
      }

      const overlap = rangeIntersection([start.minY, start.maxY], [end.minY, end.maxY]);
      if (!overlap) {
        continue;
      }

      if (gapIsBlocked(query(worldBounds(start.maxX, pt(overlap[0]), end.minX, pt(overlap[1]))), start, end, overlap, "x")) {
        continue;
      }

      horizontal.push({
        startBounds: start,
        endBounds: end,
        startSide: [
          worldPoint(pt(start.maxX), pt(start.minY)),
          worldPoint(pt(start.maxX), pt(start.maxY))
        ],
        endSide: [
          worldPoint(pt(end.minX), pt(end.minY)),
          worldPoint(pt(end.minX), pt(end.maxY))
        ],
        overlap,
        length: end.minX - start.maxX
      });
    }
  }

  const sortedY = [...mergedBounds].sort((a, b) => a.minY - b.minY);
  pairs = 0;

  const yIndices = new Map(sortedY.map((bounds, index) => [bounds, index]));
  for (let i = 0; i < sortedY.length && pairs < maxPairsPerAxis; i += 1) {
    const start = sortedY[i];
    const last = Math.min(sortedY.length - 1, i + maxPairsPerAxis - pairs);
    pairs += sortedY.length - i - 1;
    const candidates = query(worldBounds(start.minX, start.maxY, start.maxX, pt(Infinity)))
      .filter(end => yIndices.get(end)! > i && yIndices.get(end)! <= last)
      .sort((a, b) => yIndices.get(a)! - yIndices.get(b)!);
    for (const end of candidates) {
      if (start.maxY >= end.minY) {
        continue;
      }

      const overlap = rangeIntersection([start.minX, start.maxX], [end.minX, end.maxX]);
      if (!overlap) {
        continue;
      }

      if (gapIsBlocked(query(worldBounds(pt(overlap[0]), start.maxY, pt(overlap[1]), end.minY)), start, end, overlap, "y")) {
        continue;
      }

      vertical.push({
        startBounds: start,
        endBounds: end,
        startSide: [
          worldPoint(pt(start.minX), pt(start.maxY)),
          worldPoint(pt(start.maxX), pt(start.maxY))
        ],
        endSide: [
          worldPoint(pt(end.minX), pt(end.minY)),
          worldPoint(pt(end.maxX), pt(end.minY))
        ],
        overlap,
        length: end.minY - start.maxY
      });
    }
  }

  return { horizontal, vertical };
}

function mergeIntersectingBounds(referenceBounds: readonly SnapBounds[]): SnapBounds[] {
  const sizes = referenceBounds.map(bounds => Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)).sort((a, b) => a - b);
  const index = createMutableBoundsIndex<SnapBounds>(Math.max(1, sizes[Math.floor(sizes.length / 2)] ?? 1));
  const order = new Map<SnapBounds, number>();
  for (const [position, bounds] of referenceBounds.entries()) {
    let current = bounds;
    for (;;) {
      const other = index.query(current).filter(candidate => boundsIntersect(candidate, current))
        .sort((a, b) => order.get(a)! - order.get(b)!)[0];
      if (!other) break;
      index.delete(other); order.delete(other);
      current = { ...mergeBounds(other, current), sourceId: other.sourceId,
        sourceIds: [...new Set([...(other.sourceIds ?? [other.sourceId]), ...(current.sourceIds ?? [current.sourceId])])] };
    }
    order.set(current, position); index.add(current);
  }
  return [...order.keys()];
}

function gapIsBlocked(
  allBounds: readonly SnapBounds[],
  start: SnapBounds,
  end: SnapBounds,
  overlap: [number, number],
  axis: Axis
): boolean {
  for (const bounds of allBounds) {
    if (bounds === start || bounds === end) {
      continue;
    }

    if (axis === "x") {
      if (bounds.maxX <= start.maxX + SNAP_EPSILON || bounds.minX >= end.minX - SNAP_EPSILON) {
        continue;
      }
      const lo = Math.max(bounds.minY, overlap[0]);
      const hi = Math.min(bounds.maxY, overlap[1]);
      if (hi - lo > SNAP_EPSILON) {
        return true;
      }
    } else {
      if (bounds.maxY <= start.maxY + SNAP_EPSILON || bounds.minY >= end.minY - SNAP_EPSILON) {
        continue;
      }
      const lo = Math.max(bounds.minX, overlap[0]);
      const hi = Math.min(bounds.maxX, overlap[1]);
      if (hi - lo > SNAP_EPSILON) {
        return true;
      }
    }
  }

  return false;
}

export function collectGapSnaps({
  selectionBounds,
  visibleGaps,
  minOffset,
  nearest,
  enabledAxis
}: {
  selectionBounds: WorldBounds;
  visibleGaps: { horizontal: Gap[]; vertical: Gap[] };
  minOffset: AxisMinOffset;
  nearest: AxisSnapBuckets;
  enabledAxis?: Axis | null;
}): void {
  const centerX = (selectionBounds.minX + selectionBounds.maxX) / 2;
  const centerY = (selectionBounds.minY + selectionBounds.maxY) / 2;
  const width = selectionBounds.maxX - selectionBounds.minX;
  const height = selectionBounds.maxY - selectionBounds.minY;

  if (enabledAxis !== "y") {
    for (const gap of queryGaps(visibleGaps.horizontal, selectionBounds, minOffset.x, "x")) {
      if (!rangesOverlap([selectionBounds.minY, selectionBounds.maxY], gap.overlap)) {
        continue;
      }

      const gapMidX = gap.startSide[0].x + gap.length / 2;
      const centerOffset = gapMidX - centerX;
      if (gap.length > width) {
        pushGapCandidate({
          axis: "x",
          direction: "center_horizontal",
          gap,
          offset: centerOffset,
          minOffset,
          nearest
        });
      }

      const distanceToEnd = selectionBounds.minX - gap.endBounds.maxX;
      const sideOffsetRight = gap.length - distanceToEnd;
      pushGapCandidate({
        axis: "x",
        direction: "side_right",
        gap,
        offset: sideOffsetRight,
        minOffset,
        nearest
      });

      const distanceToStart = gap.startBounds.minX - selectionBounds.maxX;
      const sideOffsetLeft = distanceToStart - gap.length;
      pushGapCandidate({
        axis: "x",
        direction: "side_left",
        gap,
        offset: sideOffsetLeft,
        minOffset,
        nearest
      });
    }
  }

  if (enabledAxis !== "x") {
    for (const gap of queryGaps(visibleGaps.vertical, selectionBounds, minOffset.y, "y")) {
      if (!rangesOverlap([selectionBounds.minX, selectionBounds.maxX], gap.overlap)) {
        continue;
      }

      const gapMidY = gap.startSide[0].y + gap.length / 2;
      const centerOffset = gapMidY - centerY;
      if (gap.length > height) {
        pushGapCandidate({
          axis: "y",
          direction: "center_vertical",
          gap,
          offset: centerOffset,
          minOffset,
          nearest
        });
      }

      const distanceToStart = gap.startBounds.minY - selectionBounds.maxY;
      const sideOffsetTop = distanceToStart - gap.length;
      pushGapCandidate({
        axis: "y",
        direction: "side_top",
        gap,
        offset: sideOffsetTop,
        minOffset,
        nearest
      });

      const distanceToEnd = selectionBounds.minY - gap.endBounds.maxY;
      const sideOffsetBottom = gap.length - distanceToEnd;
      pushGapCandidate({
        axis: "y",
        direction: "side_bottom",
        gap,
        offset: sideOffsetBottom,
        minOffset,
        nearest
      });
    }
  }
}

export function createGapSnapLines(
  selectionBounds: WorldBounds,
  candidates: readonly GapSnapCandidate[]
): SnapLine[] {
  const lines: SnapLine[] = [];

  for (const candidate of candidates) {
    const segments = segmentsForGapCandidate(selectionBounds, candidate);
    if (segments.length === 0) {
      continue;
    }

    lines.push({
      type: "gap",
      sourceIds: [...new Set([...(candidate.gap.startBounds.sourceIds ?? [candidate.gap.startBounds.sourceId]), ...(candidate.gap.endBounds.sourceIds ?? [candidate.gap.endBounds.sourceId])])],
      referenceBounds: [candidate.gap.startBounds, candidate.gap.endBounds],
      direction: candidate.axis === "x" ? "horizontal" : "vertical",
      gapKind: candidate.direction.startsWith("center_") ? "center" : "equal",
      segments
    });
  }

  return dedupeGapLines(lines);
}

function pushGapCandidate({
  axis,
  direction,
  gap,
  offset,
  minOffset,
  nearest
}: {
  axis: Axis;
  direction: GapSnapCandidate["direction"];
  gap: Gap;
  offset: number;
  minOffset: AxisMinOffset;
  nearest: AxisSnapBuckets;
}): void {
  const absOffset = Math.abs(offset);

  if (axis === "x") {
    if (absOffset > minOffset.x + SNAP_EPSILON) return;
    if (absOffset + SNAP_EPSILON < minOffset.x) {
      nearest.x.length = 0;
    }

    nearest.x.push({
      kind: "gap",
      axis,
      direction,
      gap,
      offset
    });
    minOffset.x = absOffset;
    return;
  }

  if (absOffset > minOffset.y + SNAP_EPSILON) return;
  if (absOffset + SNAP_EPSILON < minOffset.y) {
    nearest.y.length = 0;
  }

  nearest.y.push({
    kind: "gap",
    axis,
    direction,
    gap,
    offset
  });
  minOffset.y = absOffset;
}

function segmentsForGapCandidate(
  selectionBounds: WorldBounds,
  candidate: GapSnapCandidate
): Array<[WorldPoint, WorldPoint]> {
  const { gap } = candidate;
  const segments: Array<[WorldPoint, WorldPoint]> = [];

  const verticalIntersection = rangeIntersection(
    [selectionBounds.minY, selectionBounds.maxY],
    gap.overlap
  );

  const horizontalIntersection = rangeIntersection(
    [selectionBounds.minX, selectionBounds.maxX],
    gap.overlap
  );

  switch (candidate.direction) {
    case "center_horizontal": {
      if (!verticalIntersection) return segments;
      const y = (verticalIntersection[0] + verticalIntersection[1]) / 2;
      segments.push(
        [
          worldPoint(pt(gap.startSide[0].x), pt(y)),
          worldPoint(pt(selectionBounds.minX), pt(y))
        ],
        [
          worldPoint(pt(selectionBounds.maxX), pt(y)),
          worldPoint(pt(gap.endSide[0].x), pt(y))
        ]
      );
      return segments;
    }

    case "center_vertical": {
      if (!horizontalIntersection) return segments;
      const x = (horizontalIntersection[0] + horizontalIntersection[1]) / 2;
      segments.push(
        [
          worldPoint(pt(x), pt(gap.startSide[0].y)),
          worldPoint(pt(x), pt(selectionBounds.minY))
        ],
        [
          worldPoint(pt(x), pt(selectionBounds.maxY)),
          worldPoint(pt(x), pt(gap.endSide[0].y))
        ]
      );
      return segments;
    }

    case "side_right": {
      if (!verticalIntersection) return segments;
      const y = (verticalIntersection[0] + verticalIntersection[1]) / 2;
      segments.push(
        [
          worldPoint(pt(gap.startBounds.maxX), pt(y)),
          worldPoint(pt(gap.endBounds.minX), pt(y))
        ],
        [
          worldPoint(pt(gap.endBounds.maxX), pt(y)),
          worldPoint(pt(selectionBounds.minX), pt(y))
        ]
      );
      return segments;
    }

    case "side_left": {
      if (!verticalIntersection) return segments;
      const y = (verticalIntersection[0] + verticalIntersection[1]) / 2;
      segments.push(
        [
          worldPoint(pt(selectionBounds.maxX), pt(y)),
          worldPoint(pt(gap.startBounds.minX), pt(y))
        ],
        [
          worldPoint(pt(gap.startBounds.maxX), pt(y)),
          worldPoint(pt(gap.endBounds.minX), pt(y))
        ]
      );
      return segments;
    }

    case "side_top": {
      if (!horizontalIntersection) return segments;
      const x = (horizontalIntersection[0] + horizontalIntersection[1]) / 2;
      segments.push(
        [
          worldPoint(pt(x), pt(selectionBounds.maxY)),
          worldPoint(pt(x), pt(gap.startBounds.minY))
        ],
        [
          worldPoint(pt(x), pt(gap.startBounds.maxY)),
          worldPoint(pt(x), pt(gap.endBounds.minY))
        ]
      );
      return segments;
    }

    case "side_bottom": {
      if (!horizontalIntersection) return segments;
      const x = (horizontalIntersection[0] + horizontalIntersection[1]) / 2;
      segments.push(
        [
          worldPoint(pt(x), pt(gap.startBounds.maxY)),
          worldPoint(pt(x), pt(gap.endBounds.minY))
        ],
        [
          worldPoint(pt(x), pt(gap.endBounds.maxY)),
          worldPoint(pt(x), pt(selectionBounds.minY))
        ]
      );
      return segments;
    }
  }
}

function dedupeGapLines(lines: SnapLine[]): SnapLine[] {
  const deduped: SnapLine[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (line.type !== "gap") {
      deduped.push(line);
      continue;
    }

    const normalizedSegments = line.segments.map((segment) => normalizeSegment(segment));
    const key = `${line.direction}:${line.gapKind}:${normalizedSegments.join("|")}`;
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push({
      ...line,
      segments: normalizedSegments.map((entry) => {
        const [a, b] = entry.split(";");
        const [ax, ay] = a.split(",").map(Number);
        const [bx, by] = b.split(",").map(Number);
        return [
          worldPoint(pt(ax), pt(ay)),
          worldPoint(pt(bx), pt(by))
        ];
      })
    });
  }

  return deduped;
}

function normalizeSegment(segment: [WorldPoint, WorldPoint]): string {
  const a = `${roundSnapValue(segment[0].x)},${roundSnapValue(segment[0].y)}`;
  const b = `${roundSnapValue(segment[1].x)},${roundSnapValue(segment[1].y)}`;
  return a <= b ? `${a};${b}` : `${b};${a}`;
}

const gapIndexes = new WeakMap<readonly Gap[], { axis: Axis; queries: Array<ReturnType<typeof createPointIndex<WorldPoint & { gap: Gap }>>>; order: Map<Gap, number> }>();
function queryGaps(gaps: readonly Gap[], bounds: WorldBounds, radius: number, axis: Axis): Gap[] {
  let index = gapIndexes.get(gaps);
  if (index?.axis !== axis) {
    const positions = (g: Gap) => axis === "x"
      ? [g.startSide[0].x + g.length / 2, g.endBounds.maxX + g.length, g.startBounds.minX - g.length]
      : [g.startSide[0].y + g.length / 2, g.startBounds.minY - g.length, g.endBounds.maxY + g.length];
    index = { axis, order: new Map(gaps.map((gap, i) => [gap, i])), queries: [0, 1, 2].map(i => createPointIndex(gaps.map(gap => ({ ...worldPoint(pt(positions(gap)[i]), pt(0)), gap })))) };
    gapIndexes.set(gaps, index);
  }
  const coordinates = axis === "x" ? [(bounds.minX + bounds.maxX) / 2, bounds.minX, bounds.maxX] : [(bounds.minY + bounds.maxY) / 2, bounds.maxY, bounds.minY];
  const found = new Set<Gap>();
  index.queries.forEach((query, i) => { for (const candidate of query(worldPoint(pt(coordinates[i]), pt(0)), radius + SNAP_EPSILON, -1)) found.add(candidate.gap); });
  return [...found].sort((a, b) => index.order.get(a)! - index.order.get(b)!);
}
