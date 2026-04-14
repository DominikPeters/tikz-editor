import { PT_PER_CM } from "tikz-editor/edit/format";
import { GRID_MINOR_TARGET_PX } from "tikz-editor/edit/snapping/types";
import type { Point } from "tikz-editor/semantic/types";
import type { SvgViewBox } from "tikz-editor/svg/types";
import type { CanvasTransform } from "../../store/types";

export type RulerTick = {
  viewportPos: number;
  major: boolean;
  label?: string;
};

export type VisibleRanges = {
  worldMinX: number;
  worldMaxX: number;
  worldMinY: number;
  worldMaxY: number;
  svgMinY: number;
  svgMaxY: number;
};

export type OverlayGridSteps = {
  minorStep: number;
  majorStep: number;
};

const OVERLAY_MAJOR_STEP_MULTIPLE = 5;

export function computeVisibleRanges(
  viewBox: SvgViewBox,
  transform: CanvasTransform,
  viewportWidth: number,
  viewportHeight: number
): VisibleRanges {
  const worldTopLeft = viewportToWorldPoint(0, 0, transform, viewBox);
  const worldBottomRight = viewportToWorldPoint(viewportWidth, viewportHeight, transform, viewBox);

  const svgTopLeft = viewportToSvgPoint(0, 0, transform, viewBox);
  const svgBottomRight = viewportToSvgPoint(viewportWidth, viewportHeight, transform, viewBox);

  return {
    worldMinX: Math.min(worldTopLeft.x, worldBottomRight.x),
    worldMaxX: Math.max(worldTopLeft.x, worldBottomRight.x),
    worldMinY: Math.min(worldTopLeft.y, worldBottomRight.y),
    worldMaxY: Math.max(worldTopLeft.y, worldBottomRight.y),
    svgMinY: Math.min(svgTopLeft.y, svgBottomRight.y),
    svgMaxY: Math.max(svgTopLeft.y, svgBottomRight.y)
  };
}

export function buildTicks(
  worldMin: number,
  worldMax: number,
  minorStep: number,
  majorStep: number,
  mapWorldToViewport: (value: number) => number
): RulerTick[] {
  const values = buildValueSequence(worldMin, worldMax, minorStep, 1000);
  const ticks: RulerTick[] = [];

  for (const worldValue of values) {
    const major = isMultipleOfStep(worldValue, majorStep);
    ticks.push({
      viewportPos: mapWorldToViewport(worldValue),
      major,
      label: major ? formatCm(worldValue / PT_PER_CM) : undefined
    });
  }

  return ticks;
}

export function buildValueSequence(min: number, max: number, step: number, maxCount: number): number[] {
  if (!(step > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return [];

  let startIndex = Math.floor(min / step) - 1;
  let endIndex = Math.ceil(max / step) + 1;

  if (endIndex < startIndex) {
    [startIndex, endIndex] = [endIndex, startIndex];
  }

  const total = endIndex - startIndex + 1;
  const stride = Math.max(1, Math.ceil(total / maxCount));

  const values: number[] = [];
  for (let i = startIndex; i <= endIndex; i += stride) {
    values.push(i * step);
  }
  return values;
}

export function clientToWorldPoint(
  clientX: number,
  clientY: number,
  svgElement: SVGSVGElement | null,
  viewBox: SvgViewBox
): Point | null {
  if (!svgElement) return null;

  const ctm = svgElement.getScreenCTM();
  if (!ctm) return null;

  const point = svgElement.createSVGPoint();
  point.x = clientX;
  point.y = clientY;

  const svgPoint = point.matrixTransform(ctm.inverse());
  return svgToWorldPoint(svgPoint, viewBox);
}

export function worldToClientPoint(
  worldX: number,
  worldY: number,
  svgElement: SVGSVGElement | null,
  viewBox: SvgViewBox
): { clientX: number; clientY: number } | null {
  if (!svgElement) return null;
  const ctm = svgElement.getScreenCTM();
  if (!ctm) return null;
  const svgPt = svgElement.createSVGPoint();
  svgPt.x = worldX;
  svgPt.y = worldToSvgY(worldY, viewBox);
  const transformed = svgPt.matrixTransform(ctm);
  return { clientX: transformed.x, clientY: transformed.y };
}

export function clientToSvgPoint(
  clientX: number,
  clientY: number,
  svgElement: SVGSVGElement | null
): { x: number; y: number } | null {
  if (!svgElement) {
    return null;
  }
  const ctm = svgElement.getScreenCTM();
  if (!ctm) {
    return null;
  }
  const point = svgElement.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const svgPoint = point.matrixTransform(ctm.inverse());
  return { x: svgPoint.x, y: svgPoint.y };
}

export function rotatePointAroundCenter(
  point: { x: number; y: number },
  cx: number,
  cy: number,
  degrees: number
): { x: number; y: number } {
  if (Math.abs(degrees) <= 1e-6) {
    return point;
  }
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const dx = point.x - cx;
  const dy = point.y - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos
  };
}

export function viewportToSvgPoint(
  viewportX: number,
  viewportY: number,
  transform: CanvasTransform,
  viewBox: SvgViewBox
): { x: number; y: number } {
  const scale = Math.max(transform.scale, 1e-6);
  return {
    x: viewBox.x + (viewportX - transform.translateX) / scale,
    y: viewBox.y + (viewportY - transform.translateY) / scale
  };
}

export function viewportToWorldPoint(
  viewportX: number,
  viewportY: number,
  transform: CanvasTransform,
  viewBox: SvgViewBox
): Point {
  return svgToWorldPoint(viewportToSvgPoint(viewportX, viewportY, transform, viewBox), viewBox);
}

export function toViewportXFromWorld(worldX: number, viewBox: SvgViewBox, transform: CanvasTransform): number {
  return transform.translateX + (worldX - viewBox.x) * transform.scale;
}

export function toViewportYFromWorld(worldY: number, viewBox: SvgViewBox, transform: CanvasTransform): number {
  const svgY = worldToSvgY(worldY, viewBox);
  return transform.translateY + (svgY - viewBox.y) * transform.scale;
}

export function worldToSvgPoint(point: { x: number; y: number }, viewBox: Pick<SvgViewBox, "y" | "height">): { x: number; y: number } {
  return {
    x: point.x,
    y: worldToSvgY(point.y, viewBox)
  };
}

export function worldToSvgY(worldY: number, viewBox: Pick<SvgViewBox, "y" | "height">): number {
  return viewBox.y + viewBox.height - (worldY - viewBox.y);
}

export function svgToWorldPoint(point: { x: number; y: number }, viewBox: Pick<SvgViewBox, "y" | "height">): Point {
  return {
    x: point.x,
    y: viewBox.y + viewBox.height - (point.y - viewBox.y)
  };
}

export function pickStepPt(scale: number, targetPixels: number): number {
  const cmSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
  const minStepPt = targetPixels / Math.max(scale, 1e-6);

  for (const cmStep of cmSteps) {
    const pt = cmStep * PT_PER_CM;
    if (pt >= minStepPt) return pt;
  }

  return cmSteps[cmSteps.length - 1]! * PT_PER_CM;
}

export function resolveOverlayGridSteps(scale: number, minorTargetPx: number = GRID_MINOR_TARGET_PX): OverlayGridSteps {
  const minorStep = pickStepPt(scale, minorTargetPx);
  return {
    minorStep,
    majorStep: minorStep * OVERLAY_MAJOR_STEP_MULTIPLE
  };
}

export function isMultipleOfStep(value: number, step: number): boolean {
  if (!(step > 0)) return false;
  const q = value / step;
  return Math.abs(q - Math.round(q)) < 1e-4;
}

function formatCm(valueCm: number): string {
  if (Math.abs(valueCm) < 1e-8) return "0";

  const rounded2 = Math.round(valueCm * 100) / 100;
  if (Math.abs(rounded2 - Math.round(rounded2)) < 1e-8) {
    return String(Math.round(rounded2));
  }

  if (Math.abs(rounded2 * 10 - Math.round(rounded2 * 10)) < 1e-8) {
    return rounded2.toFixed(1);
  }

  return rounded2.toFixed(2);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function fmt(value: number): string {
  return Number(value.toFixed(4)).toString();
}

export function resizeCursorForVector(vector: Point): string {
  const screenVector = { x: vector.x, y: -vector.y };
  const angle = ((Math.atan2(screenVector.y, screenVector.x) * 180) / Math.PI + 180) % 180;
  const candidates: Array<{ angle: number; cursor: string }> = [
    { angle: 0, cursor: "ew-resize" },
    { angle: 45, cursor: "nwse-resize" },
    { angle: 90, cursor: "ns-resize" },
    { angle: 135, cursor: "nesw-resize" }
  ];

  let best = candidates[0]!;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const diff = Math.min(Math.abs(angle - candidate.angle), 180 - Math.abs(angle - candidate.angle));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }

  return best.cursor;
}

export function vectorLengthSquared(vector: Point): number {
  return vector.x * vector.x + vector.y * vector.y;
}

export function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
