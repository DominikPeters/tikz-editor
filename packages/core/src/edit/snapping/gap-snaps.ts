import { worldPoint } from "../../coords/points.js";
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

  const horizontal: Gap[] = [];
  const vertical: Gap[] = [];

  const sortedX = [...mergedBounds].sort((a, b) => a.minX - b.minX);
  let pairs = 0;

  horizontalLoop: for (let i = 0; i < sortedX.length; i += 1) {
    const start = sortedX[i];
    for (let j = i + 1; j < sortedX.length; j += 1) {
      if (++pairs > maxPairsPerAxis) {
        break horizontalLoop;
      }

      const end = sortedX[j];
      if (start.maxX >= end.minX) {
        continue;
      }

      const overlap = rangeIntersection([start.minY, start.maxY], [end.minY, end.maxY]);
      if (!overlap) {
        continue;
      }

      if (gapIsBlocked(mergedBounds, start, end, overlap, "x")) {
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

  verticalLoop: for (let i = 0; i < sortedY.length; i += 1) {
    const start = sortedY[i];
    for (let j = i + 1; j < sortedY.length; j += 1) {
      if (++pairs > maxPairsPerAxis) {
        break verticalLoop;
      }

      const end = sortedY[j];
      if (start.maxY >= end.minY) {
        continue;
      }

      const overlap = rangeIntersection([start.minX, start.maxX], [end.minX, end.maxX]);
      if (!overlap) {
        continue;
      }

      if (gapIsBlocked(mergedBounds, start, end, overlap, "y")) {
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
  const merged: SnapBounds[] = [];

  for (const bounds of referenceBounds) {
    let current = bounds;
    let intersecting = merged.findIndex((other) => boundsIntersect(other, current));
    while (intersecting !== -1) {
      const [other] = merged.splice(intersecting, 1);
      current = { ...mergeBounds(other, current), sourceId: other.sourceId };
      intersecting = merged.findIndex((candidate) => boundsIntersect(candidate, current));
    }
    merged.push(current);
  }

  return merged;
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
    for (const gap of visibleGaps.horizontal) {
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
    for (const gap of visibleGaps.vertical) {
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
