import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { PT_PER_CM } from "../../coords/source.js";
import type { WorldPoint } from "../../coords/points.js";
import { SNAP_EPSILON } from "./geometry.js";
import { roundSnapValue } from "./point-snaps.js";
import type { Axis, AxisMinOffset, AxisSnapBuckets } from "./types.js";

const GRID_STEPS_CM = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
export function pickGridStepPt(scale: number, targetPixels: number): number {
  const minStepPt = targetPixels / Math.max(scale, 1e-6);

  for (const stepCm of GRID_STEPS_CM) {
    const stepPt = stepCm * PT_PER_CM;
    if (stepPt >= minStepPt) {
      return stepPt;
    }
  }

  return GRID_STEPS_CM[GRID_STEPS_CM.length - 1] * PT_PER_CM;
}

export function snapToNextMultiple(value: number, step: number, direction: -1 | 1): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value + direction * step;
  }

  const normalized = value / step;
  const epsilon = 1e-9;
  const biased = normalized + direction * epsilon;
  const nextIndex = direction > 0 ? Math.ceil(biased) : Math.floor(biased);
  return nextIndex * step;
}

export function collectGridSnaps({
  selectionPoints,
  minOffset,
  nearest,
  gridStep,
  enabledAxis
}: {
  selectionPoints: readonly WorldPoint[];
  minOffset: AxisMinOffset;
  nearest: AxisSnapBuckets;
  gridStep: number;
  enabledAxis?: Axis | null;
}): void {
  if (!(gridStep > 0)) {
    return;
  }

  for (const point of selectionPoints) {
    if (enabledAxis !== "y") {
      const gridX = roundSnapValue(Math.round(point.x / gridStep) * gridStep);
      const offsetX = gridX - point.x;
      const absX = Math.abs(offsetX);

      if (absX <= minOffset.x + SNAP_EPSILON) {
        if (absX + SNAP_EPSILON < minOffset.x) {
          nearest.x.length = 0;
        }

        nearest.x.push({
          kind: "grid",
          axis: "x",
          from: worldPoint(pt(point.x), pt(point.y)),
          to: worldPoint(pt(gridX), pt(point.y)),
          offset: offsetX,
          key: gridX
        });
        minOffset.x = absX;
      }
    }

    if (enabledAxis !== "x") {
      const gridY = roundSnapValue(Math.round(point.y / gridStep) * gridStep);
      const offsetY = gridY - point.y;
      const absY = Math.abs(offsetY);

      if (absY <= minOffset.y + SNAP_EPSILON) {
        if (absY + SNAP_EPSILON < minOffset.y) {
          nearest.y.length = 0;
        }

        nearest.y.push({
          kind: "grid",
          axis: "y",
          from: worldPoint(pt(point.x), pt(point.y)),
          to: worldPoint(pt(point.x), pt(gridY)),
          offset: offsetY,
          key: gridY
        });
        minOffset.y = absY;
      }
    }
  }
}
