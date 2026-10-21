import { svgPoint, pt } from "@tikz-editor/core/coords/index";
import type { SvgPoint, WorldPoint } from "../coords/types";
import type { ResizeFrame } from "./resize-frames";

const EPSILON = 1e-9;

export function angleDeg(center: WorldPoint, point: WorldPoint): number {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) {
    return 0;
  }
  return normalizeSignedDeg((Math.atan2(dy, dx) * 180) / Math.PI);
}

export function normalizeSignedDeg(degrees: number): number {
  if (!Number.isFinite(degrees)) {
    return 0;
  }
  let normalized = ((degrees % 360) + 360) % 360;
  if (normalized > 180) {
    normalized -= 360;
  }
  if (normalized <= -180) {
    normalized += 360;
  }
  return normalized;
}

export function snapAngleDeg(value: number, stepDeg: number): number {
  if (!(stepDeg > 0) || !Number.isFinite(value)) {
    return value;
  }
  return Math.round(value / stepDeg) * stepDeg;
}

export function magneticSnapAngleDeg(value: number, stepDeg: number, thresholdDeg: number): number {
  if (!(stepDeg > 0) || !(thresholdDeg >= 0) || !Number.isFinite(value)) {
    return value;
  }
  const snapped = snapAngleDeg(value, stepDeg);
  const delta = Math.abs(normalizeSignedDeg(value - snapped));
  return delta <= thresholdDeg ? snapped : value;
}

export function resolveDraggedRotateDeg(args: {
  baseRotateDeg: number;
  startPointerAngleDeg: number;
  currentPointerAngleDeg: number;
  shiftKey: boolean;
  ctrlOrMetaKey: boolean;
  shiftSnapStepDeg?: number;
  magneticSnapStepDeg?: number;
  magneticSnapThresholdDeg?: number;
  roundToInteger?: boolean;
}): number {
  const shiftSnapStepDeg = args.shiftSnapStepDeg ?? 15;
  const magneticSnapStepDeg = args.magneticSnapStepDeg ?? 90;
  const magneticSnapThresholdDeg = args.magneticSnapThresholdDeg ?? 7;
  const roundToInteger = args.roundToInteger ?? true;
  const rawDelta = normalizeSignedDeg(args.currentPointerAngleDeg - args.startPointerAngleDeg);
  const rawRotate = normalizeSignedDeg(args.baseRotateDeg + rawDelta);

  let nextRotate = rawRotate;
  if (args.shiftKey) {
    // Shift snapping is absolute to the global angle axis, not relative to drag start.
    nextRotate = snapAngleDeg(rawRotate, shiftSnapStepDeg);
  } else if (!args.ctrlOrMetaKey) {
    nextRotate = magneticSnapAngleDeg(rawRotate, magneticSnapStepDeg, magneticSnapThresholdDeg);
  }

  if (roundToInteger) {
    nextRotate = Math.round(nextRotate);
  }
  return normalizeSignedDeg(nextRotate);
}

export function resolveRotateHandlePosition(
  frame: ResizeFrame,
  scale: number,
  offsetPx: number
): { anchorSvg: SvgPoint; handleSvg: SvgPoint } {
  const topLeft = frame.cornersByRole["top-left"].svg;
  const topRight = frame.cornersByRole["top-right"].svg;
  const anchorSvg = svgPoint(pt((topLeft.x + topRight.x) / 2), pt((topLeft.y + topRight.y) / 2));
  const outward = {
    x: anchorSvg.x - frame.centerSvg.x,
    y: anchorSvg.y - frame.centerSvg.y
  };
  const outwardLength = Math.hypot(outward.x, outward.y);
  const safeScale = Math.max(scale, 1e-3);
  const offsetSvg = offsetPx / safeScale;
  const outwardUnit =
    outwardLength > EPSILON
      ? {
          x: outward.x / outwardLength,
          y: outward.y / outwardLength
        }
      : { x: 0, y: -1 };

  const handleSvg = svgPoint(
    pt(anchorSvg.x + outwardUnit.x * offsetSvg),
    pt(anchorSvg.y + outwardUnit.y * offsetSvg)
  );
  return { anchorSvg, handleSvg };
}
