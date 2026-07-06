import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint } from "../../coords/points.js";
import type {
  Axis,
  AxisMinOffset,
  AxisSnapBuckets,
  PointSnapCandidate,
  SelectionSnapPoint,
  SnapLine,
  SnapPoint,
  SnapPointRole
} from "./types.js";
import { SNAP_EPSILON } from "./geometry.js";

/**
 * When several references fall within the snap threshold, prefer the visually
 * nearest cluster of references over a distant element that wins on raw offset
 * by a hair. Candidates whose distance jumps by more than this (screen px,
 * converted to world by the caller) past the previous one are discarded.
 */
export const SNAP_CLUSTER_BREAK_PX = 200;

type RawPointCandidate = {
  from: WorldPoint;
  to: WorldPoint;
  offset: number;
  absOffset: number;
  visualDistance: number;
  role?: SnapPointRole;
  sourceId?: string;
};

export function collectPointSnaps({
  selectionPoints,
  referencePoints,
  minOffset,
  nearest,
  kind,
  enabledAxis,
  clusterBreakWorld
}: {
  selectionPoints: readonly SelectionSnapPoint[];
  referencePoints: readonly (SnapPoint | WorldPoint)[];
  minOffset: AxisMinOffset;
  nearest: AxisSnapBuckets;
  kind: "point" | "grid";
  enabledAxis?: Axis | null;
  clusterBreakWorld?: number;
}): void {
  const rawX: RawPointCandidate[] = [];
  const rawY: RawPointCandidate[] = [];

  for (const from of selectionPoints) {
    for (const to of referencePoints) {
      const toRole = (to as Partial<SnapPoint>).role;
      if (from.role && toRole && from.role !== toRole) {
        continue;
      }

      const role = from.role ?? toRole;
      const sourceId = (to as Partial<SnapPoint>).sourceId;
      const offsetX = to.x - from.x;
      const offsetY = to.y - from.y;
      const visualDistance = Math.hypot(offsetX, offsetY);

      if (enabledAxis !== "y") {
        const absX = Math.abs(offsetX);
        if (absX <= minOffset.x + SNAP_EPSILON) {
          rawX.push({ from, to, offset: offsetX, absOffset: absX, visualDistance, role, sourceId });
        }
      }

      if (enabledAxis !== "x") {
        const absY = Math.abs(offsetY);
        if (absY <= minOffset.y + SNAP_EPSILON) {
          rawY.push({ from, to, offset: offsetY, absOffset: absY, visualDistance, role, sourceId });
        }
      }
    }
  }

  pushAxisCandidates("x", filterToNearestCluster(rawX, clusterBreakWorld), minOffset, nearest, kind);
  pushAxisCandidates("y", filterToNearestCluster(rawY, clusterBreakWorld), minOffset, nearest, kind);
}

function filterToNearestCluster(
  candidates: RawPointCandidate[],
  clusterBreakWorld: number | undefined
): RawPointCandidate[] {
  if (clusterBreakWorld === undefined || candidates.length <= 1) {
    return candidates;
  }

  const sorted = [...candidates].sort((a, b) => a.visualDistance - b.visualDistance);
  const kept = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].visualDistance - sorted[i - 1].visualDistance > clusterBreakWorld) {
      break;
    }
    kept.push(sorted[i]);
  }
  return kept;
}

function pushAxisCandidates(
  axis: Axis,
  candidates: readonly RawPointCandidate[],
  minOffset: AxisMinOffset,
  nearest: AxisSnapBuckets,
  kind: "point" | "grid"
): void {
  for (const candidate of candidates) {
    const current = axis === "x" ? minOffset.x : minOffset.y;
    if (candidate.absOffset > current + SNAP_EPSILON) {
      continue;
    }

    const bucket = axis === "x" ? nearest.x : nearest.y;
    if (candidate.absOffset + SNAP_EPSILON < current) {
      bucket.length = 0;
    }

    bucket.push({
      kind,
      axis,
      from: worldPoint(pt(candidate.from.x), pt(candidate.from.y)),
      to: worldPoint(pt(candidate.to.x), pt(candidate.to.y)),
      offset: candidate.offset,
      key: roundSnapValue(axis === "x" ? candidate.to.x : candidate.to.y),
      role: candidate.role,
      sourceId: candidate.sourceId
    });

    if (axis === "x") {
      minOffset.x = candidate.absOffset;
    } else {
      minOffset.y = candidate.absOffset;
    }
  }
}

export function collectGuideSnaps({
  selectionPoints,
  guides,
  minOffset,
  nearest,
  enabledAxis
}: {
  selectionPoints: readonly WorldPoint[];
  guides: { x: readonly number[]; y: readonly number[] };
  minOffset: AxisMinOffset;
  nearest: AxisSnapBuckets;
  enabledAxis?: Axis | null;
}): void {
  for (const from of selectionPoints) {
    if (enabledAxis !== "y") {
      for (const guideX of guides.x) {
        const offsetX = guideX - from.x;
        const absX = Math.abs(offsetX);
        if (absX <= minOffset.x + SNAP_EPSILON) {
          if (absX + SNAP_EPSILON < minOffset.x) {
            nearest.x.length = 0;
          }

          nearest.x.push({
            kind: "guide",
            axis: "x",
            from: worldPoint(pt(from.x), pt(from.y)),
            to: worldPoint(pt(guideX), pt(from.y)),
            offset: offsetX,
            key: roundSnapValue(guideX)
          });
          minOffset.x = absX;
        }
      }
    }

    if (enabledAxis !== "x") {
      for (const guideY of guides.y) {
        const offsetY = guideY - from.y;
        const absY = Math.abs(offsetY);
        if (absY <= minOffset.y + SNAP_EPSILON) {
          if (absY + SNAP_EPSILON < minOffset.y) {
            nearest.y.length = 0;
          }

          nearest.y.push({
            kind: "guide",
            axis: "y",
            from: worldPoint(pt(from.x), pt(from.y)),
            to: worldPoint(pt(from.x), pt(guideY)),
            offset: offsetY,
            key: roundSnapValue(guideY)
          });
          minOffset.y = absY;
        }
      }
    }
  }
}

export function pointSnapOffset(nearest: AxisSnapBuckets): WorldPoint {
  const xSnap = nearest.x.find((snap): snap is PointSnapCandidate => snap.kind !== "gap");
  const ySnap = nearest.y.find((snap): snap is PointSnapCandidate => snap.kind !== "gap");

  return worldPoint(pt(xSnap?.offset ?? 0), pt(ySnap?.offset ?? 0));
}

export function createPointSnapLines(nearest: AxisSnapBuckets): SnapLine[] {
  const lines: SnapLine[] = [];

  for (const axis of ["x", "y"] as const) {
    const groups = new Map<
      string,
      { key: number; role: SnapPointRole | undefined; points: WorldPoint[]; sourceIds: Set<string> }
    >();

    for (const snap of nearest[axis]) {
      if (snap.kind !== "point") {
        continue;
      }

      const groupKey = `${snap.key}:${snap.role ?? "any"}`;
      let group = groups.get(groupKey);
      if (!group) {
        group = { key: snap.key, role: snap.role, points: [], sourceIds: new Set() };
        groups.set(groupKey, group);
      }

      // Project the selection point onto the guide coordinate; at render time
      // (post-snap, threshold 0) it already lies there up to float noise.
      group.points.push(
        axis === "x"
          ? worldPoint(pt(snap.key), pt(snap.from.y))
          : worldPoint(pt(snap.from.x), pt(snap.key)),
        worldPoint(pt(snap.to.x), pt(snap.to.y))
      );
      if (snap.sourceId) {
        group.sourceIds.add(snap.sourceId);
      }
    }

    for (const group of groups.values()) {
      lines.push({
        type: "points",
        axis,
        role: group.role,
        points: dedupeAndSortLinePoints(axis, group.points),
        sourceIds: group.sourceIds.size > 0 ? [...group.sourceIds] : undefined
      });
    }
  }

  return suppressBracketedCenterLines(lines);
}

function dedupeAndSortLinePoints(axis: Axis, points: readonly WorldPoint[]): WorldPoint[] {
  const seen = new Set<string>();
  const deduped: WorldPoint[] = [];
  for (const point of points) {
    const key = `${roundSnapValue(point.x)}:${roundSnapValue(point.y)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(point);
  }

  return deduped.sort((a, b) => (axis === "x" ? a.y - b.y : a.x - b.x));
}

/**
 * When both edges of the selection align (equal-size objects), the centers
 * necessarily align too; the middle guide adds no information, so drop any
 * center line strictly bracketed by corner lines on the same axis.
 */
function suppressBracketedCenterLines(lines: SnapLine[]): SnapLine[] {
  return lines.filter((line) => {
    if (line.type !== "points" || line.role !== "center" || line.points.length === 0) {
      return true;
    }

    const coordinate = line.axis === "x" ? line.points[0].x : line.points[0].y;
    let hasBelow = false;
    let hasAbove = false;
    for (const other of lines) {
      if (other === line || other.type !== "points" || other.axis !== line.axis || other.role !== "corner") {
        continue;
      }
      if (other.points.length === 0) {
        continue;
      }
      const otherCoordinate = line.axis === "x" ? other.points[0].x : other.points[0].y;
      if (otherCoordinate < coordinate - SNAP_EPSILON) {
        hasBelow = true;
      } else if (otherCoordinate > coordinate + SNAP_EPSILON) {
        hasAbove = true;
      }
    }

    return !(hasBelow && hasAbove);
  });
}

export function createPointerLinesForPointSnap(nearest: AxisSnapBuckets, snappedPoint: WorldPoint): SnapLine[] {
  const lines: SnapLine[] = [];

  const xSnap = nearest.x.find((snap): snap is PointSnapCandidate => snap.kind === "point");
  if (xSnap) {
    lines.push({
      type: "pointer",
      axis: "x",
      from: worldPoint(pt(xSnap.to.x), pt(xSnap.to.y)),
      to: worldPoint(pt(xSnap.to.x), pt(snappedPoint.y)),
      sourceIds: xSnap.sourceId ? [xSnap.sourceId] : undefined
    });
  }

  const ySnap = nearest.y.find((snap): snap is PointSnapCandidate => snap.kind === "point");
  if (ySnap) {
    lines.push({
      type: "pointer",
      axis: "y",
      from: worldPoint(pt(ySnap.to.x), pt(ySnap.to.y)),
      to: worldPoint(pt(snappedPoint.x), pt(ySnap.to.y)),
      sourceIds: ySnap.sourceId ? [ySnap.sourceId] : undefined
    });
  }

  return lines;
}

export function createEmptySnapBuckets(): AxisSnapBuckets {
  return {
    x: [],
    y: []
  };
}

export function createMinOffset(threshold: number, enabledAxis?: Axis | null): AxisMinOffset {
  return {
    x: enabledAxis === "y" ? 0 : Math.max(0, threshold),
    y: enabledAxis === "x" ? 0 : Math.max(0, threshold)
  };
}

export function roundSnapValue(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
