import type { ElementTemplate } from "tikz-editor/edit/actions";
import type { SelectionGeometry } from "tikz-editor/edit/snapping";
import type { EditHandle, SceneElement, ScenePathCommand } from "tikz-editor/semantic/types";
import { CM_PER_PT, PT_PER_CM, formatNumber } from "tikz-editor/edit/format";
import { worldPoint, worldVector, svgBounds, pt } from "tikz-editor/coords/index";

import { distanceSquared } from "./geometry";
import { shouldConstrainToolCreateToSquare, type ToolCreateMode } from "../tool-config";
import type { DragState, DragTooltipRow, SelectionAnchorRatio } from "./types";
import type { ResizeFrame } from "./resize-frames";
import { resolveAddShapeDraft } from "./add-shape-draft";
import type { SvgBounds, SvgPoint, WorldBounds, WorldPoint } from "../coords/types";
import type { WorldVector } from "tikz-editor/coords/index";

const DEFAULT_BEZIER_LENGTH_PT = 2 * PT_PER_CM;
const STEP_SNAP_EPSILON = 1e-9;
export const DEFAULT_GRID_TOOL_STEP_PT = PT_PER_CM;
const TOOLTIP_ZERO_EPSILON = 1e-6;
const MIN_SHAPE_DRAG_DIMENSION_PT = 0.1 * PT_PER_CM;

export function boundsFromPoints(a: SvgPoint, b: SvgPoint): SvgBounds {
  return svgBounds(
    pt(Math.min(a.x, b.x)),
    pt(Math.min(a.y, b.y)),
    pt(Math.max(a.x, b.x)),
    pt(Math.max(a.y, b.y))
  );
}

export function collectSourceIdsInBounds(boundsBySource: ReadonlyMap<string, SvgBounds>, selection: SvgBounds): string[] {
  const result: string[] = [];
  for (const [sourceId, bounds] of boundsBySource) {
    if (boundsContainedWithin(bounds, selection)) {
      result.push(sourceId);
    }
  }
  return result;
}

export function deriveSelectionTranslationDeltaFromAnchor(
  initialSelection: SelectionGeometry,
  currentSelection: SelectionGeometry | null,
  anchorRatio: SelectionAnchorRatio | null
): WorldPoint {
  if (!currentSelection) {
    return worldPoint(pt(0), pt(0));
  }

  const ratio = anchorRatio ?? { x: 0.5, y: 0.5 };
  const initialCenter = pointFromBoundsAnchorRatio(initialSelection.bounds, ratio);
  const currentCenter = pointFromBoundsAnchorRatio(currentSelection.bounds, ratio);
  return worldPoint(
    pt(currentCenter.x - initialCenter.x),
    pt(currentCenter.y - initialCenter.y)
  );
}

export function createTemplateForToolDrag(
  mode: ToolCreateMode,
  startWorld: WorldPoint,
  endWorld: WorldPoint,
  options?: {
    selectedAddShape?: string;
    strokeColor?: string;
    fillColor?: string;
  }
): ElementTemplate {
  const dx = endWorld.x - startWorld.x;
  const dy = endWorld.y - startWorld.y;
  const dragDistance = Math.hypot(dx, dy);
  const hasDrag = dragDistance >= 1e-3;
  const hasShapeDrag =
    Math.max(Math.abs(dx), Math.abs(dy)) >= MIN_SHAPE_DRAG_DIMENSION_PT;

  const strokeColor = options?.strokeColor;
  const fillColor = options?.fillColor;

  if (mode === "addPath") {
    return hasDrag
      ? { kind: "line", hasArrow: false, to: endWorld, strokeColor }
      : { kind: "line", hasArrow: false, strokeColor };
  }

  if (mode === "addLine") {
    return hasDrag
      ? { kind: "line", hasArrow: false, to: endWorld, strokeColor }
      : { kind: "line", hasArrow: false, strokeColor };
  }

  if (mode === "addArrow") {
    return hasDrag
      ? { kind: "line", hasArrow: true, to: endWorld, strokeColor }
      : { kind: "line", hasArrow: true, strokeColor };
  }

  if (mode === "addBezier") {
    const bend = worldPoint(
      pt((startWorld.x + endWorld.x) / 2),
      pt((startWorld.y + endWorld.y) / 2)
    );
    if (hasDrag) {
      return createBezierTemplateFromBend(startWorld, endWorld, bend, { strokeColor });
    }
    return { kind: "bezier", strokeColor };
  }

  if (mode === "addGrid") {
    return hasDrag
      ? { kind: "grid", corner: endWorld, strokeColor }
      : { kind: "grid", strokeColor };
  }

  if (mode === "addRect") {
    return hasDrag
      ? { kind: "rectangle", corner: endWorld, strokeColor, fillColor }
      : { kind: "rectangle", strokeColor, fillColor };
  }

  if (mode === "addEllipse") {
    return hasDrag
      ? { kind: "ellipse", corner: endWorld, strokeColor, fillColor }
      : { kind: "ellipse", strokeColor, fillColor };
  }

  if (mode === "addShape") {
    const draft = resolveAddShapeDraft(
      options?.selectedAddShape ?? "rectangle",
      Math.max(Math.abs(dx), MIN_SHAPE_DRAG_DIMENSION_PT),
      Math.max(Math.abs(dy), MIN_SHAPE_DRAG_DIMENSION_PT)
    );
    return hasShapeDrag
      ? {
          kind: "node",
          shape: options?.selectedAddShape ?? "rectangle",
          text: "",
          minimumWidthPt: draft.minimumWidthPt,
          minimumHeightPt: draft.minimumHeightPt,
          strokeColor,
          fillColor
        }
      : {
          kind: "node",
          shape: options?.selectedAddShape ?? "rectangle",
          text: "",
          strokeColor,
          fillColor
        };
  }

  return hasDrag
    ? { kind: "circle", edge: endWorld, strokeColor, fillColor }
    : { kind: "circle", strokeColor, fillColor };
}

export function resolveBezierControlsFromBend(
  startWorld: WorldPoint,
  endWorld: WorldPoint,
  bendWorld: WorldPoint
): { endWorld: WorldPoint; control1: WorldPoint; control2: WorldPoint } {
  let resolvedEnd = endWorld;
  let dx = resolvedEnd.x - startWorld.x;
  let dy = resolvedEnd.y - startWorld.y;
  let length = Math.hypot(dx, dy);
  if (length <= 1e-6) {
    resolvedEnd = worldPoint(pt(startWorld.x + DEFAULT_BEZIER_LENGTH_PT), pt(startWorld.y));
    dx = resolvedEnd.x - startWorld.x;
    dy = resolvedEnd.y - startWorld.y;
    length = Math.hypot(dx, dy);
  }

  const unitTangent = { x: dx / length, y: dy / length };
  const unitNormal = { x: -unitTangent.y, y: unitTangent.x };
  const midpoint = worldPoint(
    pt((startWorld.x + resolvedEnd.x) / 2),
    pt((startWorld.y + resolvedEnd.y) / 2)
  );
  const signedNormalOffset =
    (bendWorld.x - midpoint.x) * unitNormal.x +
    (bendWorld.y - midpoint.y) * unitNormal.y;
  const controlNormalOffset = (4 / 3) * signedNormalOffset;

  const control1 = worldPoint(
    pt(startWorld.x + dx / 3 + unitNormal.x * controlNormalOffset),
    pt(startWorld.y + dy / 3 + unitNormal.y * controlNormalOffset)
  );
  const control2 = worldPoint(
    pt(startWorld.x + (2 * dx) / 3 + unitNormal.x * controlNormalOffset),
    pt(startWorld.y + (2 * dy) / 3 + unitNormal.y * controlNormalOffset)
  );

  return {
    endWorld: resolvedEnd,
    control1,
    control2
  };
}

export function createBezierTemplateFromBend(
  startWorld: WorldPoint,
  endWorld: WorldPoint,
  bendWorld: WorldPoint,
  options?: { strokeColor?: string }
): Extract<ElementTemplate, { kind: "bezier" }> {
  const controls = resolveBezierControlsFromBend(startWorld, endWorld, bendWorld);
  return {
    kind: "bezier",
    to: controls.endWorld,
    control1: controls.control1,
    control2: controls.control2,
    strokeColor: options?.strokeColor
  };
}

export function resolveToolCreateCurrentWorld(
  startWorld: WorldPoint,
  rawCurrentWorld: WorldPoint,
  mode: ToolCreateMode,
  shiftKey: boolean
): WorldPoint {
  return shouldConstrainToolCreateToSquare(mode) && shiftKey
    ? constrainRectCornerToSquare(startWorld, rawCurrentWorld)
    : rawCurrentWorld;
}

export function snapPointDeltaToAxisStepMultiples(
  anchorWorld: WorldPoint,
  currentWorld: WorldPoint,
  stepX: number,
  stepY: number
): WorldPoint {
  return worldPoint(
    pt(anchorWorld.x + snapDeltaToStep(currentWorld.x - anchorWorld.x, stepX)),
    pt(anchorWorld.y + snapDeltaToStep(currentWorld.y - anchorWorld.y, stepY))
  );
}

export function resolveHandleIdForDrag(
  drag: Extract<DragState, { kind: "handle" }>,
  handles: EditHandle[]
): string | null {
  const direct = handles.find((handle) => handle.id === drag.handleId);
  if (direct) {
    return direct.id;
  }

  const best = findClosestHandleMatch(handles, drag.lastKnownWorld, (handle) => handle.kind === drag.handleKind);

  if (!best) {
    return null;
  }

  drag.handleId = best.id;
  drag.sourceId = best.sourceRef.sourceId;
  drag.lastKnownWorld = { ...best.world };
  return best.id;
}

function findClosestHandleMatch(
  handles: readonly EditHandle[],
  target: WorldPoint,
  predicate: (handle: EditHandle) => boolean
): EditHandle | null {
  let best: EditHandle | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const handle of handles) {
    if (!predicate(handle)) {
      continue;
    }
    const dx = handle.world.x - target.x;
    const dy = handle.world.y - target.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = handle;
    }
  }
  return best;
}

function boundsContainedWithin(inner: SvgBounds, outer: SvgBounds): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

function pointFromBoundsAnchorRatio(bounds: WorldBounds, ratio: SelectionAnchorRatio): WorldPoint {
  return worldPoint(
    pt(bounds.minX + (bounds.maxX - bounds.minX) * ratio.x),
    pt(bounds.minY + (bounds.maxY - bounds.minY) * ratio.y)
  );
}

function constrainRectCornerToSquare(startWorld: WorldPoint, cornerWorld: WorldPoint): WorldPoint {
  const dx = cornerWorld.x - startWorld.x;
  const dy = cornerWorld.y - startWorld.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  if (side <= 1e-6) {
    return cornerWorld;
  }

  const xSign = dx < 0 ? -1 : 1;
  const ySign = dy < 0 ? -1 : 1;
  return worldPoint(
    pt(startWorld.x + xSign * side),
    pt(startWorld.y + ySign * side)
  );
}

function snapDeltaToStep(delta: number, step: number): number {
  if (!(step > STEP_SNAP_EPSILON)) {
    return delta;
  }
  return Math.round(delta / step) * step;
}

export function sourceIdAnchorWorld(elements: SceneElement[], sourceId: string): WorldPoint {
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const element of elements) {
    if (element.sourceRef.sourceId !== sourceId) {
      continue;
    }
    const anchor = elementAnchorWorld(element);
    sumX += anchor.x;
    sumY += anchor.y;
    count += 1;
  }

  if (count === 0) {
    return worldPoint(pt(0), pt(0));
  }

  return worldPoint(pt(sumX / count), pt(sumY / count));
}

export function formatTooltipLengthRows(widthPt: number, heightPt: number): DragTooltipRow[] {
  return [
    { label: "Width", value: formatTooltipLength(widthPt) },
    { label: "Height", value: formatTooltipLength(heightPt) }
  ];
}

export function formatTooltipCoordinateRows(point: WorldPoint): DragTooltipRow[] {
  return [
    { label: "X", value: formatTooltipLengthCm(point.x) },
    { label: "Y", value: formatTooltipLengthCm(point.y) }
  ];
}

export function formatToolCreateLengthRows(
  mode: ToolCreateMode,
  size: { width: number; height: number; radius?: number }
): DragTooltipRow[] {
  if (mode === "addCircle") {
    return [
      { label: "Radius", value: formatTooltipLength(size.radius ?? size.width / 2) }
    ];
  }

  return formatTooltipLengthRows(size.width, size.height);
}

export function formatTooltipAngleRow(degrees: number): DragTooltipRow {
  const normalized = Math.abs(degrees) <= TOOLTIP_ZERO_EPSILON ? 0 : degrees;
  return {
    label: "Angle",
    value: `${Math.round(normalized)}°`
  };
}

export function formatTooltipGridCountRow(columns: number, rows: number): DragTooltipRow {
  return {
    label: "Cells",
    value: `${columns} col, ${rows} row`
  };
}

export function resolveFrameBasis(frame: ResizeFrame): {
  widthUnit: WorldVector;
  heightUnit: WorldVector;
  width: number;
  height: number;
} {
  const topLeft = frame.cornersByRole["top-left"].world;
  const topRight = frame.cornersByRole["top-right"].world;
  const bottomLeft = frame.cornersByRole["bottom-left"].world;
  const widthVector = {
    x: topRight.x - topLeft.x,
    y: topRight.y - topLeft.y
  };
  const heightVector = {
    x: topLeft.x - bottomLeft.x,
    y: topLeft.y - bottomLeft.y
  };
  const width = Math.hypot(widthVector.x, widthVector.y);
  const height = Math.hypot(heightVector.x, heightVector.y);
  return {
    widthUnit:
      width > TOOLTIP_ZERO_EPSILON
        ? worldVector(pt(widthVector.x / width), pt(widthVector.y / width))
        : worldVector(pt(1), pt(0)),
    heightUnit:
      height > TOOLTIP_ZERO_EPSILON
        ? worldVector(pt(heightVector.x / height), pt(heightVector.y / height))
        : worldVector(pt(0), pt(1)),
    width,
    height
  };
}

export function oppositeCornerWorld(frame: ResizeFrame, role: Extract<DragState, { kind: "resize" }>["role"]): WorldPoint {
  const oppositeRole =
    role === "top-left" ? "bottom-right" :
    role === "top-right" ? "bottom-left" :
    role === "bottom-left" ? "top-right" :
    "top-left";
  return frame.cornersByRole[oppositeRole].world;
}

export function projectResizeDimensionsFromCenter(
  pointerWorld: WorldPoint,
  frame: ResizeFrame,
  preserveAspectRatio: number | null,
  preserveAspectDuringResize: boolean
): { width: number; height: number } {
  const basis = resolveFrameBasis(frame);
  const relative = worldVector(
    pt(pointerWorld.x - frame.centerWorld.x),
    pt(pointerWorld.y - frame.centerWorld.y)
  );
  let width = 2 * Math.abs(dotPoint(relative, basis.widthUnit));
  let height = 2 * Math.abs(dotPoint(relative, basis.heightUnit));
  const aspectRatio =
    preserveAspectRatio && preserveAspectRatio > TOOLTIP_ZERO_EPSILON
      ? preserveAspectRatio
      : null;

  if (preserveAspectDuringResize && aspectRatio) {
    if (width > TOOLTIP_ZERO_EPSILON || height > TOOLTIP_ZERO_EPSILON) {
      width = Math.max(width, height / aspectRatio);
      height = width * aspectRatio;
    }
  }

  return {
    width: clampTooltipScalar(width),
    height: clampTooltipScalar(height)
  };
}

export function projectResizeDimensionsFromOppositeCorner(
  pointerWorld: WorldPoint,
  frame: ResizeFrame,
  role: Extract<DragState, { kind: "resize" }>["role"],
  preserveAspectRatio: number | null = null,
  preserveAspectDuringResize = false
): { width: number; height: number } {
  const basis = resolveFrameBasis(frame);
  const fixed = oppositeCornerWorld(frame, role);
  const delta = worldVector(pt(pointerWorld.x - fixed.x), pt(pointerWorld.y - fixed.y));
  let width = Math.abs(dotPoint(delta, basis.widthUnit));
  let height = Math.abs(dotPoint(delta, basis.heightUnit));
  const aspectRatio =
    preserveAspectRatio && preserveAspectRatio > TOOLTIP_ZERO_EPSILON
      ? preserveAspectRatio
      : null;

  if (preserveAspectDuringResize && aspectRatio) {
    if (width > TOOLTIP_ZERO_EPSILON || height > TOOLTIP_ZERO_EPSILON) {
      width = Math.max(width, height / aspectRatio);
      height = width * aspectRatio;
    }
  }

  return {
    width: clampTooltipScalar(width),
    height: clampTooltipScalar(height)
  };
}

export function resolveToolCreateSize(
  mode: ToolCreateMode,
  startWorld: WorldPoint,
  currentWorld: WorldPoint
): { width: number; height: number; radius?: number } {
  if (mode === "addCircle") {
    const radius = Math.hypot(currentWorld.x - startWorld.x, currentWorld.y - startWorld.y);
    const diameter = clampTooltipScalar(radius * 2);
    return { width: diameter, height: diameter, radius: clampTooltipScalar(radius) };
  }

  return {
    width: clampTooltipScalar(Math.abs(currentWorld.x - startWorld.x)),
    height: clampTooltipScalar(Math.abs(currentWorld.y - startWorld.y))
  };
}

export function resolveGridTooltipCounts(startWorld: WorldPoint, currentWorld: WorldPoint): { columns: number; rows: number } {
  const width = Math.abs(currentWorld.x - startWorld.x);
  const height = Math.abs(currentWorld.y - startWorld.y);
  return {
    columns: Math.max(1, Math.round(width / DEFAULT_GRID_TOOL_STEP_PT)),
    rows: Math.max(1, Math.round(height / DEFAULT_GRID_TOOL_STEP_PT))
  };
}

function formatTooltipLength(valuePt: number): string {
  const clamped = clampTooltipScalar(valuePt);
  return `${formatTooltipLengthCm(clamped)} (${formatNumber(clamped)}pt)`;
}

function formatTooltipLengthCm(valuePt: number): string {
  return `${formatNumber(clampTooltipScalar(valuePt) * CM_PER_PT)}cm`;
}

function clampTooltipScalar(value: number): number {
  return Math.abs(value) <= TOOLTIP_ZERO_EPSILON ? 0 : value;
}

function dotPoint(a: WorldVector, b: WorldVector): number {
  return a.x * b.x + a.y * b.y;
}

function elementAnchorWorld(element: SceneElement): WorldPoint {
  if (element.kind === "Circle" || element.kind === "Ellipse") {
    return element.center;
  }
  if (element.kind === "Text") {
    return element.position;
  }

  const firstPoint = firstPathPoint(element.commands);
  return firstPoint ?? worldPoint(pt(0), pt(0));
}

function firstPathPoint(commands: ScenePathCommand[]): WorldPoint | null {
  for (const command of commands) {
    if (command.kind === "Z") {
      continue;
    }
    return command.to;
  }
  return null;
}

export function pickClosestSourceId(
  elements: SceneElement[],
  sourceIds: readonly string[],
  preferredWorld: WorldPoint
): string {
  let bestId = sourceIds[0];
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (const sourceId of sourceIds) {
    const anchor = sourceIdAnchorWorld(elements, sourceId);
    const distSq = distanceSquared(anchor, preferredWorld);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestId = sourceId;
    }
  }

  return bestId;
}
