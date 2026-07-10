import { PT_PER_CM } from "tikz-editor/edit/format";
import { pickGridStepPt } from "tikz-editor/edit/snapping";
import { GRID_MINOR_TARGET_PX } from "tikz-editor/edit/snapping/types";
import type { SvgViewBox } from "tikz-editor/svg/types";
import { svgPoint, viewportPoint, pt, px } from "tikz-editor/coords/index";
import type { CanvasTransform } from "../../store/types";
import {
  clientToSvg as typedClientToSvg,
  clientToWorld as typedClientToWorld,
  svgToWorld as typedSvgToWorld,
  svgToViewport,
  viewportToSvg as typedViewportToSvg,
  worldToSvg as typedWorldToSvg
} from "../coords/convert";
import type { ClientPoint, SvgPoint, TextRectLocalPoint, ViewportPoint, WorldPoint } from "../coords/types";
import type { WorldVector } from "tikz-editor/coords/index";

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
  const worldTopLeft = viewportToWorldPoint(viewportPoint(px(0), px(0)), transform, viewBox);
  const worldBottomRight = viewportToWorldPoint(viewportPoint(px(viewportWidth), px(viewportHeight)), transform, viewBox);

  const svgTopLeft = viewportToSvgPoint(viewportPoint(px(0), px(0)), transform, viewBox);
  const svgBottomRight = viewportToSvgPoint(viewportPoint(px(viewportWidth), px(viewportHeight)), transform, viewBox);

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
  point: ClientPoint,
  svgElement: SVGSVGElement | null,
  viewBox: SvgViewBox
): WorldPoint | null {
  return typedClientToWorld(
    point,
    svgElement,
    null,
    { translateX: 0, translateY: 0, scale: 1 },
    viewBox
  );
}

export function clientToSvgPoint(
  point: ClientPoint,
  svgElement: SVGSVGElement | null
): SvgPoint | null {
  return typedClientToSvg(
    point,
    svgElement,
    null,
    { translateX: 0, translateY: 0, scale: 1 },
    { x: 0, y: 0, width: 0, height: 0 }
  );
}

export function rotatePointAroundCenter(
  point: SvgPoint,
  cx: number,
  cy: number,
  degrees: number
): SvgPoint;
export function rotatePointAroundCenter(
  point: TextRectLocalPoint,
  cx: number,
  cy: number,
  degrees: number
): TextRectLocalPoint;
export function rotatePointAroundCenter(
  point: WorldPoint,
  cx: number,
  cy: number,
  degrees: number
): WorldPoint;
export function rotatePointAroundCenter(
  point: SvgPoint | TextRectLocalPoint | WorldPoint,
  cx: number,
  cy: number,
  degrees: number
): SvgPoint | TextRectLocalPoint | WorldPoint {
  return rotateTypedPointAroundCenter(point, cx, cy, degrees);
}

function rotateTypedPointAroundCenter<TPoint extends SvgPoint | TextRectLocalPoint | WorldPoint>(
  point: TPoint,
  cx: number,
  cy: number,
  degrees: number
): TPoint {
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
  } as TPoint;
}

export function viewportToSvgPoint(
  point: ViewportPoint,
  transform: CanvasTransform,
  viewBox: SvgViewBox
): SvgPoint {
  return typedViewportToSvg(point, transform, viewBox);
}

export function viewportToWorldPoint(
  point: ViewportPoint,
  transform: CanvasTransform,
  viewBox: SvgViewBox
): WorldPoint {
  return typedSvgToWorld(viewportToSvgPoint(point, transform, viewBox), viewBox);
}

export function toViewportXFromWorld(worldX: number, viewBox: SvgViewBox, transform: CanvasTransform): number {
  return svgToViewport(svgPoint(pt(worldX), pt(viewBox.y)), transform, viewBox).x;
}

export function toViewportYFromWorld(worldY: number, viewBox: SvgViewBox, transform: CanvasTransform): number {
  return svgToViewport(svgPoint(pt(viewBox.x), pt(worldToSvgY(worldY, viewBox))), transform, viewBox).y;
}

export function worldToSvgPoint(point: WorldPoint, viewBox: Pick<SvgViewBox, "y" | "height">): SvgPoint {
  return typedWorldToSvg(point, viewBox as SvgViewBox);
}

export function worldToSvgY(worldY: number, viewBox: Pick<SvgViewBox, "y" | "height">): number {
  return viewBox.y + viewBox.height - (worldY - viewBox.y);
}

export function svgToWorldPoint(point: SvgPoint, viewBox: Pick<SvgViewBox, "y" | "height">): WorldPoint {
  return typedSvgToWorld(point, viewBox as SvgViewBox);
}

export function resolveOverlayGridSteps(scale: number, minorTargetPx: number = GRID_MINOR_TARGET_PX): OverlayGridSteps {
  const minorStep = pickGridStepPt(scale, minorTargetPx);
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

export function resizeCursorForVector(vector: WorldVector): string {
  const screenVector = { x: Number(vector.x), y: -Number(vector.y) };
  const angle = ((Math.atan2(screenVector.y, screenVector.x) * 180) / Math.PI + 180) % 180;
  const candidates: Array<{ angle: number; cursor: string }> = [
    { angle: 0, cursor: "ew-resize" },
    { angle: 45, cursor: "nwse-resize" },
    { angle: 90, cursor: "ns-resize" },
    { angle: 135, cursor: "nesw-resize" }
  ];

  let best = candidates[0];
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

export function vectorLengthSquared(vector: Pick<WorldPoint, "x" | "y">): number {
  return vector.x * vector.x + vector.y * vector.y;
}

export function distanceSquared(a: WorldPoint, b: WorldPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
