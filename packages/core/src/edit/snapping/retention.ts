import type { AxisSnapBuckets, AxisSnapCandidate, SelectionGeometry, SelectionSnapPoint, SnapContext, SnapSettings } from "./types.js";
import { SNAP_EPSILON, rangesOverlap } from "./geometry.js";

export const SNAP_RELEASE_RATIO = 1.5;
const SWITCH_ADVANTAGE_PX = 2;

/** Gesture-owned targets are remeasured from the raw pointer each frame. */
export function retainSnapTargets(
  nearest: AxisSnapBuckets, previous: AxisSnapBuckets | undefined,
  context: SnapContext, settings: SnapSettings, points: readonly SelectionSnapPoint[],
  selection?: SelectionGeometry, enabledAxis?: "x" | "y" | null
): void {
  if (!previous) return;
  const release = settings.thresholdPx * SNAP_RELEASE_RATIO / context.zoom;
  for (const axis of ["x", "y"] as const) {
    if (enabledAxis && axis !== enabledAxis) continue;
    const retained = previous[axis].flatMap<AxisSnapCandidate>(target => {
      if (target.kind === "gap") {
        if (!settings.gaps.enabled || !selection) return [];
        const b = selection.bounds, g = target.gap;
        if (!rangesOverlap(axis === "x" ? [b.minY, b.maxY] : [b.minX, b.maxX], g.overlap)) return [];
        let offset: number;
        switch (target.direction) {
          case "center_horizontal": if (g.length <= b.maxX - b.minX) return []; offset = g.startSide[0].x + g.length / 2 - (b.minX + b.maxX) / 2; break;
          case "center_vertical": if (g.length <= b.maxY - b.minY) return []; offset = g.startSide[0].y + g.length / 2 - (b.minY + b.maxY) / 2; break;
          case "side_left": offset = g.startBounds.minX - b.maxX - g.length; break;
          case "side_right": offset = g.length - b.minX + g.endBounds.maxX; break;
          case "side_top": offset = g.startBounds.minY - b.maxY - g.length; break;
          case "side_bottom": offset = g.length - b.minY + g.endBounds.maxY; break;
        }
        return Math.abs(offset) <= release ? [{ ...target, offset }] : [];
      }
      if ((target.kind === "point" && !settings.points.enabled) || (target.kind === "grid" && !settings.grid.enabled)) return [];
      if (target.kind === "guide" && !context.guides[axis].includes(target.key)) return [];
      const from = points[target.selectionIndex ?? 0];
      if (!from || (from.role && target.role && from.role !== target.role)) return [];
      const offset = target.key - from[axis];
      return Math.abs(offset) <= release ? [{ ...target, from, offset }] : [];
    });
    const old = retained[0];
    if (!old) continue;
    const next = nearest[axis][0];
    if (next && Math.abs(next.offset) + SWITCH_ADVANTAGE_PX / context.zoom < Math.abs(old.offset) - SNAP_EPSILON) continue;
    nearest[axis] = retained.filter(candidate => Math.abs(candidate.offset - old.offset) <= SNAP_EPSILON);
  }
}
