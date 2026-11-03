import { requireArrayValue } from "@tikz-editor/core/utils/collections";
import { pt, worldPoint } from "@tikz-editor/core/coords/index";
import type { ComplexPathSegment } from "@tikz-editor/core/edit/element-templates";
import type { WorldPoint } from "../coords/types";
import { distanceSquared } from "./geometry";

const MIN_WORLD_DISTANCE_PT = 1e-3;

export const FREEHAND_LIVE_POINT_SPACING_PX = 12;
export const FREEHAND_MIN_POINTS = 3;
export const FREEHAND_SMOOTHING_MIN_PX = 4;
export const FREEHAND_SMOOTHING_MAX_PX = 32;
export const FREEHAND_SMOOTHING_DEFAULT_PX = 16;

export type FreehandToolDraft = {
  points: WorldPoint[];
  minSampleDistanceWorld: number;
};

export type FreehandBezierSegment = {
  control1: WorldPoint;
  control2: WorldPoint;
  to: WorldPoint;
};

export function createFreehandToolDraft(startWorld: WorldPoint, zoom: number): FreehandToolDraft {
  return {
    points: [startWorld],
    minSampleDistanceWorld: FREEHAND_LIVE_POINT_SPACING_PX / Math.max(zoom, 1e-3)
  };
}

export function appendFreehandToolPoint(draft: FreehandToolDraft, point: WorldPoint): FreehandToolDraft {
  const last = draft.points[draft.points.length - 1];
  if (last && distanceSquared(last, point) < draft.minSampleDistanceWorld * draft.minSampleDistanceWorld) {
    return draft;
  }
  return {
    ...draft,
    points: [...draft.points, point]
  };
}

export function simplifyFreehandPoints(points: readonly WorldPoint[], toleranceWorld: number): WorldPoint[] {
  if (points.length <= 2) {
    return [...points];
  }

  const toleranceSq = toleranceWorld * toleranceWorld;
  const simplified: WorldPoint[] = [requireArrayValue(points, 0)];
  let lastKept = requireArrayValue(points, 0);

  for (let i = 1; i < points.length - 1; i += 1) {
    const point = requireArrayValue(points, i);
    if (distanceSquared(lastKept, point) >= toleranceSq) {
      simplified.push(point);
      lastKept = point;
    }
  }

  const lastPoint = requireArrayValue(points, points.length - 1);
  const currentLast = requireArrayValue(simplified, simplified.length - 1);
  if (distanceSquared(currentLast, lastPoint) > 0) {
    simplified.push(lastPoint);
  }

  return simplified;
}

export function catmullRomToBezierSegments(points: readonly WorldPoint[]): FreehandBezierSegment[] {
  if (points.length < 2) {
    return [];
  }

  const segments: FreehandBezierSegment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = i === 0 ? requireArrayValue(points, i) : requireArrayValue(points, i - 1);
    const p1 = requireArrayValue(points, i);
    const p2 = requireArrayValue(points, i + 1);
    const p3 = i + 2 < points.length ? requireArrayValue(points, i + 2) : p2;

    segments.push({
      control1: worldPoint(
        pt(p1.x + (p2.x - p0.x) / 6),
        pt(p1.y + (p2.y - p0.y) / 6)
      ),
      control2: worldPoint(
        pt(p2.x - (p3.x - p1.x) / 6),
        pt(p2.y - (p3.y - p1.y) / 6)
      ),
      to: p2
    });
  }

  return segments;
}

export function resolveFreehandPreviewSegments(
  draft: FreehandToolDraft,
  smoothingTolerancePx = FREEHAND_SMOOTHING_DEFAULT_PX,
  zoom = 1
): Array<
  | { kind: "line"; from: WorldPoint; to: WorldPoint }
  | { kind: "bezier"; from: WorldPoint; control1: WorldPoint; control2: WorldPoint; to: WorldPoint }
> {
  const smoothingToleranceWorld = clampSmoothingTolerancePx(smoothingTolerancePx) / Math.max(zoom, 1e-3);
  const previewPoints = simplifyFreehandPoints(draft.points, smoothingToleranceWorld);

  if (previewPoints.length < FREEHAND_MIN_POINTS) {
    const previewSegments: Array<{ kind: "line"; from: WorldPoint; to: WorldPoint }> = [];
    for (let i = 1; i < previewPoints.length; i += 1) {
      previewSegments.push({
        kind: "line",
        from: requireArrayValue(previewPoints, i - 1),
        to: requireArrayValue(previewPoints, i)
      });
    }
    return previewSegments;
  }

  const curves = catmullRomToBezierSegments(previewPoints);
  const previewSegments: Array<{ kind: "bezier"; from: WorldPoint; control1: WorldPoint; control2: WorldPoint; to: WorldPoint }> = [];
  let current = requireArrayValue(previewPoints, 0);
  for (const segment of curves) {
    previewSegments.push({
      kind: "bezier",
      from: current,
      control1: segment.control1,
      control2: segment.control2,
      to: segment.to
    });
    current = segment.to;
  }
  return previewSegments;
}

/**
 * The stroke as a path through world points: simplified to the smoothing
 * tolerance, then fitted with curves. The core writes it where it is read.
 */
export function freehandToolPath(
  draft: FreehandToolDraft,
  zoom: number,
  smoothingTolerancePx = FREEHAND_SMOOTHING_DEFAULT_PX
): { start: WorldPoint; segments: ComplexPathSegment[] } | null {
  const toleranceWorld = clampSmoothingTolerancePx(smoothingTolerancePx) / Math.max(zoom, 1e-3);
  const simplified = simplifyFreehandPoints(draft.points, toleranceWorld);
  if (simplified.length < FREEHAND_MIN_POINTS) {
    return null;
  }

  if (polylineLength(simplified) <= MIN_WORLD_DISTANCE_PT) {
    return null;
  }

  const segments = catmullRomToBezierSegments(simplified);
  if (segments.length === 0) {
    return null;
  }
  return { start: requireArrayValue(simplified, 0), segments: segments.map(segment => ({ kind: "bezier", ...segment })) };
}

function polylineLength(points: readonly WorldPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.sqrt(distanceSquared(requireArrayValue(points, i - 1), requireArrayValue(points, i)));
  }
  return length;
}

function clampSmoothingTolerancePx(value: number): number {
  if (!Number.isFinite(value)) {
    return FREEHAND_SMOOTHING_DEFAULT_PX;
  }
  const rounded = Math.round(value);
  return Math.max(FREEHAND_SMOOTHING_MIN_PX, Math.min(FREEHAND_SMOOTHING_MAX_PX, rounded));
}
