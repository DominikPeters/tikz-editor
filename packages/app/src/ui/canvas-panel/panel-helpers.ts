import type { AdornmentOwnerGeometry, NodeItem, PathItem, Span, Statement } from "tikz-editor/ast/types";
import type { ResizeRole } from "tikz-editor/edit/actions";
import { mapWorldTransformToSvgTransform, svgPoint, svgBounds, worldPoint, worldVector, worldTransform, pt } from "tikz-editor/coords/index";
import { parseCoordinateLike, parseLength } from "tikz-editor/semantic/coords/parse-length";
import { resolveTransformInspectorMutationContextFromOptionEntries } from "tikz-editor/edit/property-write-builders";
import type { OptionListAst } from "tikz-editor/options/types";
import {
  isFrameLocalCoordinateEditHandle,
  type EditHandle,
  type SceneClipPath,
  type SceneElement,
  type ScenePath,
  type ScenePathCommand,
  type ScenePathShapeHint,
  type SceneText
} from "tikz-editor/semantic/types";
import type { SvgTransform, WorldTransform, WorldVector } from "tikz-editor/coords/index";
import { intersectRayWithPolygon } from "tikz-editor/semantic/nodes/shape-geometry";
import type { SvgViewBox } from "tikz-editor/svg/index";
import { applyMatrixToVector, inverseMatrix } from "tikz-editor/semantic/transform";
import type { CanvasDragKind } from "../../store/types";
import type { ClientPoint, SvgBounds, SvgPoint, TextRectLocalPoint, WorldBounds, WorldPoint } from "../coords/types";
import {
  isSvgPointInsideRectHitRegionContentBox,
  resolveRectHitRegionContentBox as resolveTypedRectHitRegionContentBox,
  svgPointToTextRectLocal
} from "../coords/regions";
import type { HitRegion } from "./hit-regions";
import type {
  DragState,
  EditableTextTarget,
  GridResizeSnapConfig,
  SelectionAnchorRatio,
  SelectionBounds
} from "./types";
import {
  clamp,
  distanceSquared,
  fmt,
  resizeCursorForVector,
  vectorLengthSquared,
  worldToSvgPoint
} from "./geometry";

type GuideOrientation = "vertical" | "horizontal";

type GuidesState = {
  vertical: number[];
  horizontal: number[];
};

const GRID_SNAP_STEP_EPSILON = 1e-9;
const DEFAULT_GRID_STEP = parseLength("1", "cm") ?? 28.4527559055;

export function collectSelectionBounds(
  elements: SceneElement[],
  selectedIds: ReadonlySet<string>,
  viewBox: SvgViewBox
): SelectionBounds[] {
  const boundsBySource = collectSourceBounds(elements, viewBox);
  const selections: SelectionBounds[] = [];
  for (const [sourceId, bounds] of boundsBySource.entries()) {
    if (selectedIds.has(sourceId)) {
      selections.push({ sourceId, bounds });
    }
  }
  return selections;
}

export function rectHitRegionsForTargetId(
  hitRegions: readonly HitRegion[],
  targetId: string
): Array<Extract<HitRegion, { shape: "rect" }>> {
  return hitRegions.filter(
    (candidate): candidate is Extract<HitRegion, { shape: "rect" }> =>
      candidate.shape === "rect" && candidate.targetId === targetId
  );
}

export function resolveRectHitRegionContentBox(region: Extract<HitRegion, { shape: "rect" }>): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return resolveTypedRectHitRegionContentBox(region);
}

export function isPointInsideRectHitRegionContentBox(
  point: SvgPoint,
  region: Extract<HitRegion, { shape: "rect" }>
): boolean {
  return isSvgPointInsideRectHitRegionContentBox(point, region);
}

export function mapPointToRectRegionLocal(
  point: SvgPoint,
  region: Extract<HitRegion, { shape: "rect" }>
): TextRectLocalPoint {
  return svgPointToTextRectLocal(point, region);
}

export function collectSourceBounds(elements: SceneElement[], viewBox: SvgViewBox): Map<string, SvgBounds> {
  const boundsBySource = new Map<string, SvgBounds>();

  for (const element of elements) {
    if (element.adornment?.kind === "pin" && element.kind === "Path") {
      continue;
    }
    const bounds = effectiveElementBoundsInSvg(element, viewBox);
    if (!bounds) continue;

    const targetId = element.adornment?.targetId ?? element.sourceRef.sourceId;
    const existing = boundsBySource.get(targetId);
    if (!existing) {
      boundsBySource.set(targetId, bounds);
    } else {
      boundsBySource.set(targetId, mergeBounds(existing, bounds));
    }
  }

  return boundsBySource;
}

export function resolveAdornmentOwnerBoundaryPoint(
  ownerGeometry: AdornmentOwnerGeometry | undefined,
  ownerPoint: WorldPoint,
  targetPoint: WorldPoint
): WorldPoint {
  const center = ownerGeometry
    ? worldPoint(pt(ownerGeometry.center.x), pt(ownerGeometry.center.y))
    : ownerPoint;
  const anchorPolygon = ownerGeometry?.anchorPolygon?.map((point) => worldPoint(pt(point.x), pt(point.y)));
  const dx = targetPoint.x - center.x;
  const dy = targetPoint.y - center.y;
  const radius = Math.hypot(dx, dy);
  if (radius <= 1e-6 || !ownerGeometry || ownerGeometry.shape === "coordinate") {
    return center;
  }
  const direction = worldVector(pt(dx / radius), pt(dy / radius));

  if (anchorPolygon && anchorPolygon.length >= 3) {
    const hit = intersectRayWithPolygon(worldPoint(pt(0), pt(0)), worldVector(pt(direction.x), pt(direction.y)), anchorPolygon);
    if (hit) {
      return worldPoint(pt(center.x + hit.x), pt(center.y + hit.y));
    }
  }

  let borderDistance = 0;
  if (ownerGeometry.shape === "circle") {
    const transform = ownerGeometry.anchorTransform
      ? worldTransform(
          ownerGeometry.anchorTransform.a,
          ownerGeometry.anchorTransform.b,
          ownerGeometry.anchorTransform.c,
          ownerGeometry.anchorTransform.d,
          ownerGeometry.anchorTransform.e,
          ownerGeometry.anchorTransform.f
        )
      : undefined;
    const localDirection = (() => {
      if (!transform) return direction;
      const inverse = inverseMatrix(transform);
      if (!inverse) return direction;
      return applyMatrixToVector(inverse, direction);
    })();
    const localLen = Math.hypot(localDirection.x, localDirection.y);
    if (Number.isFinite(localLen) && localLen > 1e-9) {
      const localPoint = worldVector(
        pt((localDirection.x / localLen) * Math.max(0, ownerGeometry.anchorRadius)),
        pt((localDirection.y / localLen) * Math.max(0, ownerGeometry.anchorRadius))
      );
      const mapped = transform ? applyMatrixToVector(transform, localPoint) : localPoint;
      borderDistance = Math.hypot(mapped.x, mapped.y);
    }
  } else if (ownerGeometry.shape === "rectangle") {
    const transform = ownerGeometry.anchorTransform
      ? worldTransform(
          ownerGeometry.anchorTransform.a,
          ownerGeometry.anchorTransform.b,
          ownerGeometry.anchorTransform.c,
          ownerGeometry.anchorTransform.d,
          ownerGeometry.anchorTransform.e,
          ownerGeometry.anchorTransform.f
        )
      : undefined;
    const localDirection = (() => {
      if (!transform) return direction;
      const inverse = inverseMatrix(transform);
      if (!inverse) return direction;
      return applyMatrixToVector(inverse, direction);
    })();
    const hw = Math.max(ownerGeometry.anchorHalfWidth, 1e-6);
    const hh = Math.max(ownerGeometry.anchorHalfHeight, 1e-6);
    const scale = 1 / Math.max(Math.abs(localDirection.x) / hw, Math.abs(localDirection.y) / hh);
    if (Number.isFinite(scale)) {
      const localPoint = worldVector(pt(localDirection.x * scale), pt(localDirection.y * scale));
      const mapped = transform ? applyMatrixToVector(transform, localPoint) : localPoint;
      borderDistance = Math.hypot(mapped.x, mapped.y);
    }
  } else if (ownerGeometry.shape === "ellipse") {
    const transform = ownerGeometry.anchorTransform
      ? worldTransform(
          ownerGeometry.anchorTransform.a,
          ownerGeometry.anchorTransform.b,
          ownerGeometry.anchorTransform.c,
          ownerGeometry.anchorTransform.d,
          ownerGeometry.anchorTransform.e,
          ownerGeometry.anchorTransform.f
        )
      : undefined;
    const localDirection = (() => {
      if (!transform) return direction;
      const inverse = inverseMatrix(transform);
      if (!inverse) return direction;
      return applyMatrixToVector(inverse, direction);
    })();
    const rx = Math.max(ownerGeometry.anchorHalfWidth, 1e-6);
    const ry = Math.max(ownerGeometry.anchorHalfHeight, 1e-6);
    const scale = 1 / Math.sqrt((localDirection.x * localDirection.x) / (rx * rx) + (localDirection.y * localDirection.y) / (ry * ry));
    if (Number.isFinite(scale)) {
      const localPoint = worldVector(pt(localDirection.x * scale), pt(localDirection.y * scale));
      const mapped = transform ? applyMatrixToVector(transform, localPoint) : localPoint;
      borderDistance = Math.hypot(mapped.x, mapped.y);
    }
  }

  return worldPoint(
    pt(center.x + direction.x * borderDistance),
    pt(center.y + direction.y * borderDistance)
  );
}

export function resolveBoundsEdgePointToward(bounds: SvgBounds, from: SvgPoint): SvgPoint {
  const center = svgPoint(
    pt((bounds.minX + bounds.maxX) / 2),
    pt((bounds.minY + bounds.maxY) / 2)
  );
  const vector = worldVector(pt(from.x - center.x), pt(from.y - center.y));
  const halfWidth = Math.max((bounds.maxX - bounds.minX) / 2, 1e-6);
  const halfHeight = Math.max((bounds.maxY - bounds.minY) / 2, 1e-6);
  const scale = Math.max(Math.abs(vector.x) / halfWidth, Math.abs(vector.y) / halfHeight);
  if (!Number.isFinite(scale) || scale <= 1e-6) {
    return center;
  }
  return svgPoint(pt(center.x + vector.x / scale), pt(center.y + vector.y / scale));
}

export function elementBoundsInSvg(element: SceneElement, viewBox: SvgViewBox): SvgBounds | null {
  if (element.kind === "Path") {
    const bounds = pathBoundsInSvg(element, viewBox);
    return applyElementTransformToSvgBounds(bounds, element.transform, viewBox);
  }

  if (element.kind === "Circle") {
    const center = worldToSvgPoint(element.center, viewBox);
    const bounds = svgBounds(
      pt(center.x - element.radius),
      pt(center.y - element.radius),
      pt(center.x + element.radius),
      pt(center.y + element.radius)
    );
    return applyElementTransformToSvgBounds(bounds, element.transform, viewBox);
  }

  if (element.kind === "Ellipse") {
    const center = worldToSvgPoint(element.center, viewBox);
    const bounds = computeEllipseBounds(center.x, center.y, element.rx, element.ry, element.rotation ?? 0);
    return applyElementTransformToSvgBounds(bounds, element.transform, viewBox);
  }

  const bounds = textBounds(element, viewBox);
  return applyElementTransformToSvgBounds(bounds, element.transform, viewBox);
}

export function effectiveElementBoundsInSvg(element: SceneElement, viewBox: SvgViewBox): SvgBounds | null {
  return constrainBoundsToClipChain(elementBoundsInSvg(element, viewBox), element.clipChain ?? [], viewBox);
}

export function textBounds(element: SceneText, viewBox: SvgViewBox): SvgBounds {
  const textGeometry = textGeometryInSvg(element, viewBox);
  return computeRotatedRectBounds(
    textGeometry.cx,
    textGeometry.cy,
    textGeometry.width,
    textGeometry.height,
    textGeometry.rotation
  );
}

export function textGeometryInSvg(
  element: SceneText,
  viewBox: Pick<SvgViewBox, "y" | "height">
): { cx: number; cy: number; width: number; height: number; rotation: number } {
  const center = worldToSvgPoint(element.position, viewBox);
  const width = element.textBlockWidth ?? estimateTextBlockWidth(element.text, element.style.fontSize);
  const height = element.textBlockHeight ?? Math.max(1, element.text.split("\n").length) * element.style.fontSize * 1.15;

  return {
    cx: center.x,
    cy: center.y,
    width,
    height,
    rotation: element.rotation ?? 0
  };
}

export function pathBoundsInSvg(path: ScenePath, viewBox: SvgViewBox): SvgBounds | null {
  return pathCommandBoundsInSvg(path.commands, viewBox);
}

export function clipPathBoundsInSvg(clipPath: SceneClipPath, viewBox: SvgViewBox): SvgBounds | null {
  return pathCommandBoundsInSvg(clipPath.commands, viewBox);
}

export function constrainBoundsToClipChain(
  bounds: SvgBounds | null,
  clipChain: readonly SceneClipPath[],
  viewBox: SvgViewBox
): SvgBounds | null {
  if (!bounds) {
    return null;
  }
  let constrained: SvgBounds | null = svgBounds(pt(bounds.minX), pt(bounds.minY), pt(bounds.maxX), pt(bounds.maxY));
  for (const clipPath of clipChain) {
    const clipBounds = clipPathBoundsInSvg(clipPath, viewBox);
    if (!clipBounds) {
      continue;
    }
    constrained = intersectBounds(constrained, clipBounds);
    if (!constrained) {
      return null;
    }
  }
  return constrained;
}

function pathCommandBoundsInSvg(commands: readonly ScenePathCommand[], viewBox: SvgViewBox): SvgBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let previous: SvgPoint | null = null;

  const includePoint = (point: SvgPoint) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const command of commands) {
    if (command.kind === "Z") continue;

    if (command.kind === "C") {
      includePoint(worldToSvgPoint(command.c1, viewBox));
      includePoint(worldToSvgPoint(command.c2, viewBox));
    }

    if (command.kind === "A") {
      if (previous) {
        includePoint(svgPoint(pt(previous.x - command.rx), pt(previous.y - command.ry)));
        includePoint(svgPoint(pt(previous.x + command.rx), pt(previous.y + command.ry)));
      }
      const to = worldToSvgPoint(command.to, viewBox);
      includePoint(svgPoint(pt(to.x - command.rx), pt(to.y - command.ry)));
      includePoint(svgPoint(pt(to.x + command.rx), pt(to.y + command.ry)));
      previous = to;
      continue;
    }

    const point = worldToSvgPoint(command.to, viewBox);
    includePoint(point);
    previous = point;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return svgBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

function intersectBounds(a: SvgBounds, b: SvgBounds): SvgBounds | null {
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);
  if (minX > maxX || minY > maxY) {
    return null;
  }
  return svgBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

export function computeEllipseBounds(cx: number, cy: number, rx: number, ry: number, rotation: number): SvgBounds {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const extentX = Math.sqrt(rx * rx * cos * cos + ry * ry * sin * sin);
  const extentY = Math.sqrt(rx * rx * sin * sin + ry * ry * cos * cos);

  return svgBounds(pt(cx - extentX), pt(cy - extentY), pt(cx + extentX), pt(cy + extentY));
}

export function computeRotatedRectBounds(cx: number, cy: number, width: number, height: number, rotation: number): SvgBounds {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  if (Math.abs(rotation) <= 1e-6) {
    return svgBounds(pt(cx - halfWidth), pt(cy - halfHeight), pt(cx + halfWidth), pt(cy + halfHeight));
  }

  const theta = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  const extentX = halfWidth * cos + halfHeight * sin;
  const extentY = halfWidth * sin + halfHeight * cos;

  return svgBounds(pt(cx - extentX), pt(cy - extentY), pt(cx + extentX), pt(cy + extentY));
}

export function mergeBounds(a: SvgBounds, b: SvgBounds): SvgBounds {
  return svgBounds(
    pt(Math.min(a.minX, b.minX)),
    pt(Math.min(a.minY, b.minY)),
    pt(Math.max(a.maxX, b.maxX)),
    pt(Math.max(a.maxY, b.maxY))
  );
}

function applyElementTransformToSvgBounds(
  bounds: SvgBounds | null,
  transform: WorldTransform | undefined,
  viewBox: Pick<SvgViewBox, "y" | "height">
): SvgBounds | null {
  if (!bounds) {
    return null;
  }
  if (!transform) {
    return bounds;
  }
  const svgTransform = worldTransformToSvgTransform(transform, viewBox);
  return transformBounds(bounds, svgTransform);
}

function worldTransformToSvgTransform(
  matrix: WorldTransform,
  viewBox: Pick<SvgViewBox, "y" | "height">
): SvgTransform {
  return mapWorldTransformToSvgTransform(matrix, viewBox);
}

function transformBounds(bounds: SvgBounds, transform: SvgTransform): SvgBounds {
  const corners: SvgPoint[] = [
    svgPoint(pt(bounds.minX), pt(bounds.minY)),
    svgPoint(pt(bounds.maxX), pt(bounds.minY)),
    svgPoint(pt(bounds.maxX), pt(bounds.maxY)),
    svgPoint(pt(bounds.minX), pt(bounds.maxY))
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of corners) {
    const mapped = svgPoint(
      pt(transform.a * point.x + transform.c * point.y + transform.e),
      pt(transform.b * point.x + transform.d * point.y + transform.f)
    );
    minX = Math.min(minX, mapped.x);
    minY = Math.min(minY, mapped.y);
    maxX = Math.max(maxX, mapped.x);
    maxY = Math.max(maxY, mapped.y);
  }

  return svgBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

export function selectionAnchorRatioFromPoint(bounds: WorldBounds, point: WorldPoint): SelectionAnchorRatio {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return {
    x: Math.abs(width) > 1e-9 ? (point.x - bounds.minX) / width : 0.5,
    y: Math.abs(height) > 1e-9 ? (point.y - bounds.minY) / height : 0.5
  };
}

export function caretStrokeWidthInSvg(fontSizePt: number): number {
  if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) {
    return 0.5;
  }
  return clamp(fontSizePt * 0.055, 0.45, 1.1);
}

export function estimateTextBlockWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  if (maxChars <= 0) {
    return 0;
  }
  return maxChars * fontSize * 0.7;
}

export function makeMergeKey(prefix: string, id: string, pointerId: number): string {
  return `${prefix}:${id}:${pointerId}:${Date.now().toString(36)}`;
}

export function buildAnchoredGridPreviewLines(
  anchor: number,
  min: number,
  max: number,
  step: number,
  maxLines: number
): number[] {
  if (!Number.isFinite(anchor) || !Number.isFinite(min) || !Number.isFinite(max) || !(step > 0)) {
    return [];
  }
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  const epsilon = step * 1e-6;
  const startIndex = Math.ceil((lower - anchor - epsilon) / step);
  const endIndex = Math.floor((upper - anchor + epsilon) / step);
  if (endIndex < startIndex) {
    return [];
  }

  const count = endIndex - startIndex + 1;
  const stride = Math.max(1, Math.ceil(count / Math.max(1, maxLines)));
  const values: number[] = [];
  for (let index = startIndex; index <= endIndex; index += stride) {
    values.push(anchor + index * step);
  }

  if (startIndex <= 0 && endIndex >= 0 && !values.some((value) => Math.abs(value - anchor) <= epsilon)) {
    values.push(anchor);
    values.sort((left, right) => left - right);
  }

  return values;
}

export function previewArrowPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: number
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) {
    return `${fmt(x2)},${fmt(y2)}`;
  }

  const ux = dx / len;
  const uy = dy / len;
  const baseX = x2 - ux * size;
  const baseY = y2 - uy * size;
  const halfWidth = size * 0.45;
  const px = -uy * halfWidth;
  const py = ux * halfWidth;

  const p1 = `${fmt(x2)},${fmt(y2)}`;
  const p2 = `${fmt(baseX + px)},${fmt(baseY + py)}`;
  const p3 = `${fmt(baseX - px)},${fmt(baseY - py)}`;
  return `${p1} ${p2} ${p3}`;
}

export function collectNewSourceIds(elements: SceneElement[], beforeIds: ReadonlySet<string>): string[] {
  const newIds = new Set<string>();
  for (const element of elements) {
    if (!beforeIds.has(element.sourceRef.sourceId)) {
      newIds.add(element.sourceRef.sourceId);
    }
  }
  return [...newIds];
}

export function collectMatrixStatementSourceIds(statements: readonly Statement[]): Set<string> {
  const sourceIds = new Set<string>();

  const visitStatements = (items: readonly Statement[]) => {
    for (const statement of items) {
      if (statement.kind === "Path") {
        if (statement.items.some((item) => item.kind === "Node" && isMatrixNodeItem(item))) {
          sourceIds.add(statement.id);
        }
        continue;
      }
      if (statement.kind === "Scope") {
        visitStatements(statement.body);
      }
    }
  };

  visitStatements(statements);
  return sourceIds;
}

export function isMatrixNodeItem(item: NodeItem): boolean {
  for (const entry of item.options?.entries ?? []) {
    if (entry.kind !== "flag" && entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "matrix" || entry.key === "matrix of nodes" || entry.key === "matrix of math nodes") {
      return true;
    }
  }
  return false;
}

export function resolveEditableTextTargetForSelectionOffsets(
  targetId: string,
  anchorOffset: number,
  headOffset: number,
  hitRegions: readonly HitRegion[],
  resolveEditableTextTarget: (targetId: string, region: HitRegion | undefined) => EditableTextTarget | null
): EditableTextTarget | null {
  const rectRegions = hitRegions.filter(
    (candidate): candidate is Extract<HitRegion, { shape: "rect" }> => candidate.targetId === targetId && candidate.shape === "rect"
  );
  if (rectRegions.length === 0) {
    return null;
  }

  const minOffset = Math.min(anchorOffset, headOffset);
  const maxOffset = Math.max(anchorOffset, headOffset);
  let fallback: EditableTextTarget | null = null;

  for (const region of rectRegions) {
    const target = resolveEditableTextTarget(targetId, region);
    if (!target) {
      continue;
    }
    fallback ??= target;
    if (minOffset >= target.sourceSpan.from && maxOffset <= target.sourceSpan.to) {
      return target;
    }
  }

  return fallback;
}

export function sourceHasSingleResizablePathShape(
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  sourceId: string,
  statements?: readonly Statement[]
): boolean {
  const sourceElements = elements.filter((element) => element.sourceRef.sourceId === sourceId);
  const nonText = sourceElements.filter((element) => element.kind !== "Text");
  if (nonText.length !== 1) {
    return false;
  }

  const shapeElement = nonText[0];
  if (!shapeElement) {
    return false;
  }

  if (shapeElement.kind === "Circle") {
    return true;
  }
  if (shapeElement.kind === "Ellipse") {
    return true;
  }
  if (shapeElement.kind !== "Path") {
    return false;
  }

  const pathHandles = editHandles.filter(
    (handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "path-point"
  );

  const pathShapeHint = resolveScenePathShapeHint(shapeElement, statements, sourceId);
  if (!pathShapeHint) {
    return false;
  }

  if (pathShapeHint === "rectangle") {
    if (pathHandles.length !== 2) {
      return false;
    }
    const [firstHandle, secondHandle] = pathHandles;
    if (!firstHandle || !secondHandle) {
      return false;
    }
    if (firstHandle.rewriteMode === "unsupported" || secondHandle.rewriteMode === "unsupported") {
      return false;
    }
    if (
      firstHandle.sourceRef.sourceSpan.from === secondHandle.sourceRef.sourceSpan.from &&
      firstHandle.sourceRef.sourceSpan.to === secondHandle.sourceRef.sourceSpan.to
    ) {
      return false;
    }
    if (!transformsApproximatelyEqual(firstHandle.transform, secondHandle.transform)) {
      return false;
    }
    return true;
  }

  return pathHandles.length === 1;
}

export function findPathStatementById(
  statements: readonly Statement[],
  sourceId: string
): Extract<Statement, { kind: "Path" }> | null {
  for (const statement of statements) {
    if (statement.kind === "Path" && statement.id === sourceId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, sourceId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

export function resolveGridResizeSnapForHandleDrag(
  handle: EditHandle,
  editHandles: readonly EditHandle[],
  statements: readonly Statement[] | undefined
): GridResizeSnapConfig | null {
  if (handle.kind !== "path-point" || !statements || !isFrameLocalCoordinateEditHandle(handle)) {
    return null;
  }
  const siblingPathPointHandles = editHandles.filter(
    (candidate) => candidate.sourceRef.sourceId === handle.sourceRef.sourceId && candidate.kind === "path-point"
  );
  if (siblingPathPointHandles.length !== 2) {
    return null;
  }
  const anchorHandle = siblingPathPointHandles.find((candidate) => candidate.id !== handle.id);
  if (!anchorHandle || !isFrameLocalCoordinateEditHandle(anchorHandle) || !transformsApproximatelyEqual(handle.transform, anchorHandle.transform)) {
    return null;
  }

  const pathStatement = findPathStatementById(statements, handle.sourceRef.sourceId);
  if (!pathStatement) {
    return null;
  }
  const gridCandidate = resolveSingleGridResizeCandidate(pathStatement.items);
  if (!gridCandidate) {
    return null;
  }

  const handleIsStart = spansEqual(handle.sourceRef.sourceSpan, gridCandidate.startSpan);
  const handleIsEnd = spansEqual(handle.sourceRef.sourceSpan, gridCandidate.endSpan);
  const anchorIsStart = spansEqual(anchorHandle.sourceRef.sourceSpan, gridCandidate.startSpan);
  const anchorIsEnd = spansEqual(anchorHandle.sourceRef.sourceSpan, gridCandidate.endSpan);
  if ((!handleIsStart && !handleIsEnd) || (!anchorIsStart && !anchorIsEnd)) {
    return null;
  }

  return {
    anchorWorld: anchorHandle.world,
    stepX: gridCandidate.stepX,
    stepY: gridCandidate.stepY,
    transform: handle.frame
  };
}

type GridResizeCandidate = {
  startSpan: Span;
  endSpan: Span;
  stepX: number;
  stepY: number;
};

function resolveSingleGridResizeCandidate(items: readonly PathItem[]): GridResizeCandidate | null {
  const candidates: GridResizeCandidate[] = [];
  let previousCoordinate: Extract<PathItem, { kind: "Coordinate" }> | null = null;
  let pending: { startSpan: Span; stepX: number; stepY: number } | null = null;

  for (const item of items) {
    if (item.kind === "Coordinate") {
      if (pending) {
        candidates.push({
          startSpan: pending.startSpan,
          endSpan: item.span,
          stepX: pending.stepX,
          stepY: pending.stepY
        });
        pending = null;
      }
      previousCoordinate = item;
      continue;
    }

    if (item.kind === "PathKeyword" && item.keyword === "grid") {
      pending =
        previousCoordinate == null
          ? null
          : {
              startSpan: previousCoordinate.span,
              stepX: DEFAULT_GRID_STEP,
              stepY: DEFAULT_GRID_STEP
            };
      continue;
    }

    if (pending && item.kind === "PathOption") {
      applyGridStepOptionOverrides(pending, item);
      continue;
    }

    if (pending && item.kind !== "PathComment") {
      pending = null;
    }
  }

  if (candidates.length !== 1) {
    return null;
  }
  return candidates[0] ?? null;
}

function applyGridStepOptionOverrides(
  pending: { stepX: number; stepY: number },
  optionItem: Extract<PathItem, { kind: "PathOption" }>
): void {
  for (const entry of optionItem.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "step") {
      const pair = parseCoordinateLike(entry.valueRaw);
      if (pair) {
        const nextX = parseLength(pair.x, "cm");
        const nextY = parseLength(pair.y, "cm");
        if (nextX != null && nextX > GRID_SNAP_STEP_EPSILON) {
          pending.stepX = nextX;
        }
        if (nextY != null && nextY > GRID_SNAP_STEP_EPSILON) {
          pending.stepY = nextY;
        }
        continue;
      }
      const scalar = parseLength(entry.valueRaw, "cm");
      if (scalar != null && scalar > GRID_SNAP_STEP_EPSILON) {
        pending.stepX = scalar;
        pending.stepY = scalar;
      }
      continue;
    }

    if (entry.key === "xstep" || entry.key === "x step") {
      const nextX = parseLength(entry.valueRaw, "cm");
      if (nextX != null && nextX > GRID_SNAP_STEP_EPSILON) {
        pending.stepX = nextX;
      }
      continue;
    }

    if (entry.key === "ystep" || entry.key === "y step") {
      const nextY = parseLength(entry.valueRaw, "cm");
      if (nextY != null && nextY > GRID_SNAP_STEP_EPSILON) {
        pending.stepY = nextY;
      }
    }
  }
}

function spansEqual(left: Span, right: Span): boolean {
  return left.from === right.from && left.to === right.to;
}

export function resolveStatementRotateDegrees(statement: Statement | null | undefined): number {
  if (statement?.kind !== "Path") {
    return 0;
  }
  return resolveRotateDegreesFromOptions(statement.options);
}

export function resolveRotateDegreesFromOptions(options: OptionListAst | undefined): number {
  return resolveTransformInspectorMutationContextFromOptionEntries(options?.entries).values.rotate;
}

export function resolveScenePathShapeHint(
  path: ScenePath,
  statements: readonly Statement[] | undefined,
  sourceId: string
): ScenePathShapeHint | null {
  if (path.shapeHint) {
    return path.shapeHint;
  }
  if (!statements) {
    return null;
  }
  const pathStatement = findPathStatementById(statements, sourceId);
  if (!pathStatement) {
    return null;
  }
  return resolvePathShapeHintFromItems(pathStatement.items);
}

export function resolvePathShapeHintFromItems(items: readonly PathItem[]): ScenePathShapeHint | null {
  const hints = new Set<ScenePathShapeHint>();
  collectPathShapeHints(items, hints);
  if (hints.size !== 1) {
    return null;
  }
  return [...hints][0] ?? null;
}

export function collectPathShapeHints(items: readonly PathItem[], hints: Set<ScenePathShapeHint>): void {
  for (const item of items) {
    if (item.kind === "PathKeyword") {
      if (item.keyword === "rectangle") {
        hints.add("rectangle");
      } else if (item.keyword === "circle") {
        hints.add("circle");
      } else if (item.keyword === "ellipse") {
        hints.add("ellipse");
      }
      continue;
    }
    if (item.kind === "ChildOperation") {
      collectPathShapeHints(item.body, hints);
    }
  }
}

export function transformsApproximatelyEqual(
  left: EditHandle["transform"],
  right: EditHandle["transform"],
  epsilon = 1e-9
): boolean {
  return (
    Math.abs(left.a - right.a) <= epsilon &&
    Math.abs(left.b - right.b) <= epsilon &&
    Math.abs(left.c - right.c) <= epsilon &&
    Math.abs(left.d - right.d) <= epsilon &&
    Math.abs(left.e - right.e) <= epsilon &&
    Math.abs(left.f - right.f) <= epsilon
  );
}

export function ellipseAspectRatioForSource(
  elements: readonly SceneElement[],
  sourceId: string
): number | null {
  const ellipses = elements.filter(
    (element): element is Extract<SceneElement, { kind: "Ellipse" }> =>
      element.sourceRef.sourceId === sourceId && element.kind === "Ellipse"
  );
  if (ellipses.length !== 1) {
    return null;
  }

  const ellipse = ellipses[0];
  if (!ellipse || ellipse.rx <= 1e-6 || ellipse.ry <= 1e-6) {
    return null;
  }
  return ellipse.ry / ellipse.rx;
}

export function preferredNodeBoundsForSource(
  elements: SceneElement[],
  sourceId: string,
  viewBox: SvgViewBox,
  fallback: SvgBounds | null
): SvgBounds | null {
  const sourceElements = elements.filter((element) => element.sourceRef.sourceId === sourceId && !element.adornment);
  if (sourceElements.length === 0) {
    return fallback;
  }

  const nonText = sourceElements.filter((element) => element.kind !== "Text");
  if (nonText.length === 0) {
    const textOnlyBounds = collectTextOnlyNodeVisualBoundsInSvg(sourceElements, viewBox);
    if (textOnlyBounds) {
      return textOnlyBounds;
    }
  }
  const nodeBoxPaths = nonText.filter(
    (element): element is ScenePath =>
      element.kind === "Path" && element.id.startsWith("scene-node-box:")
  );
  const preferred = nodeBoxPaths.length > 0
    ? nodeBoxPaths
    : nonText.length > 0
      ? nonText
      : sourceElements;

  let bounds: SvgBounds | null = null;
  for (const element of preferred) {
    const next = effectiveElementBoundsInSvg(element, viewBox);
    if (!next) continue;
    bounds = bounds ? mergeBounds(bounds, next) : next;
  }

  return bounds ?? fallback;
}

export function isTextOnlyNodeSource(elements: SceneElement[], sourceId: string): boolean {
  const sourceElements = elements.filter((element) => element.sourceRef.sourceId === sourceId && !element.adornment);
  if (sourceElements.length === 0) {
    return false;
  }
  return sourceElements.some(isTextNodeWithVisualBounds) && sourceElements.every((element) => element.kind === "Text");
}

function collectTextOnlyNodeVisualBoundsInSvg(
  sourceElements: SceneElement[],
  viewBox: SvgViewBox
): SvgBounds | null {
  let bounds: SvgBounds | null = null;
  for (const element of sourceElements) {
    if (!isTextNodeWithVisualBounds(element)) {
      continue;
    }
    const center = worldToSvgPoint(element.position, viewBox);
    const next = computeRotatedRectBounds(
      center.x,
      center.y,
      element.nodeVisualWidth,
      element.nodeVisualHeight,
      element.rotation ?? 0
    );
    const clipped = constrainBoundsToClipChain(next, element.clipChain ?? [], viewBox);
    if (!clipped) {
      continue;
    }
    bounds = bounds ? mergeBounds(bounds, clipped) : clipped;
  }
  return bounds;
}

function isTextNodeWithVisualBounds(element: SceneElement): element is SceneText & { nodeVisualWidth: number; nodeVisualHeight: number } {
  return (
    element.kind === "Text"
    && Number.isFinite(element.nodeVisualWidth)
    && Number.isFinite(element.nodeVisualHeight)
    && (element.nodeVisualWidth ?? 0) > 0
    && (element.nodeVisualHeight ?? 0) > 0
  );
}

export function getHandleCursor(
  handle: EditHandle,
  scene: { elements: SceneElement[] } | null,
  allHandles: EditHandle[]
): string {
  if (handle.kind !== "path-point" || !scene) {
    return "move";
  }

  const siblingPathHandles = allHandles.filter(
    (candidate) => candidate.kind === "path-point" && candidate.sourceRef.sourceId === handle.sourceRef.sourceId
  );
  if (siblingPathHandles.length === 2) {
    const other = siblingPathHandles.find((candidate) => candidate.id !== handle.id);
    if (other) {
      const vector = worldVector(
        pt(other.world.x - handle.world.x),
        pt(other.world.y - handle.world.y)
      );
      if (vectorLengthSquared(vector) > 1e-12) {
        return resizeCursorForVector(vector);
      }
    }
  }

  const sourcePaths = scene.elements.filter(
    (element): element is ScenePath => element.kind === "Path" && element.sourceRef.sourceId === handle.sourceRef.sourceId
  );
  if (sourcePaths.length === 0) {
    return "move";
  }

  let bestVector: WorldVector | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const path of sourcePaths) {
    let current: WorldPoint | null = null;
    let subpathStart: WorldPoint | null = null;
    for (const command of path.commands) {
      if (command.kind === "M") {
        current = command.to;
        subpathStart = command.to;
        continue;
      }

      if (command.kind === "Z") {
        if (current && subpathStart) {
          const vector = worldVector(
            pt(subpathStart.x - current.x),
            pt(subpathStart.y - current.y)
          );
          const fromDist = distanceSquared(handle.world, current);
          if (fromDist < bestDistance && vectorLengthSquared(vector) > 1e-12) {
            bestDistance = fromDist;
            bestVector = vector;
          }
          const toDist = distanceSquared(handle.world, subpathStart);
          if (toDist < bestDistance && vectorLengthSquared(vector) > 1e-12) {
            bestDistance = toDist;
            bestVector = vector;
          }
          current = subpathStart;
        }
        continue;
      }

      if (!current) {
        current = command.to;
        continue;
      }

      const from = current;
      const to = command.to;

      if (command.kind === "L" || command.kind === "A") {
        const vector = worldVector(pt(to.x - from.x), pt(to.y - from.y));
        const fromDist = distanceSquared(handle.world, from);
        if (fromDist < bestDistance && vectorLengthSquared(vector) > 1e-12) {
          bestDistance = fromDist;
          bestVector = vector;
        }
        const toDist = distanceSquared(handle.world, to);
        if (toDist < bestDistance && vectorLengthSquared(vector) > 1e-12) {
          bestDistance = toDist;
          bestVector = vector;
        }
      } else {
        const startVector = worldVector(pt(command.c1.x - from.x), pt(command.c1.y - from.y));
        const endVector = worldVector(pt(to.x - command.c2.x), pt(to.y - command.c2.y));

        const fromDist = distanceSquared(handle.world, from);
        if (fromDist < bestDistance && vectorLengthSquared(startVector) > 1e-12) {
          bestDistance = fromDist;
          bestVector = startVector;
        }
        const toDist = distanceSquared(handle.world, to);
        if (toDist < bestDistance && vectorLengthSquared(endVector) > 1e-12) {
          bestDistance = toDist;
          bestVector = endVector;
        }
      }

      current = to;
    }
  }

  if (!bestVector) {
    return "move";
  }

  return resizeCursorForVector(bestVector);
}

export function selectNudgeAnchorHandle(handles: EditHandle[]): EditHandle | null {
  if (handles.length === 0) {
    return null;
  }
  return handles.find((handle) => handle.kind === "node-position") ?? handles[0];
}

export function canvasDragKindFromDragState(drag: DragState | null): CanvasDragKind | null {
  if (!drag) {
    return null;
  }
  if (drag.kind === "tool-bezier-bend" || drag.kind === "tool-path-segment") {
    return "tool-create";
  }
  if (drag.kind === "tool-freehand") {
    return "tool-create";
  }
  return drag.kind;
}

export function dragCursorForState(drag: DragState | null): string | null {
  if (!drag) {
    return null;
  }
  if (drag.kind === "handle" || drag.kind === "resize" || drag.kind === "rotate") {
    return drag.cursor;
  }
  if (drag.kind === "element") {
    return "move";
  }
  if (drag.kind === "pan") {
    return "grabbing";
  }
  if (
    drag.kind === "marquee" ||
    drag.kind === "tool-create" ||
    drag.kind === "tool-bezier-bend" ||
    drag.kind === "tool-path-segment" ||
    drag.kind === "tool-freehand"
  ) {
    return "crosshair";
  }
  return null;
}

export function resizeCursorForRole(role: ResizeRole): string {
  if (role === "left" || role === "right") {
    return "ew-resize";
  }
  if (role === "top" || role === "bottom") {
    return "ns-resize";
  }
  return role === "top-left" || role === "bottom-right" ? "nwse-resize" : "nesw-resize";
}

export function isPointInsideRect(point: ClientPoint, rect: DOMRect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

export function addGuide(guides: GuidesState, orientation: GuideOrientation, value: number): GuidesState {
  if (orientation === "vertical") {
    const nextVertical = [...guides.vertical];
    const added = upsertGuideValue(nextVertical, value);
    if (!added) {
      return guides;
    }
    nextVertical.sort((a, b) => a - b);
    return { ...guides, vertical: nextVertical };
  }

  const nextHorizontal = [...guides.horizontal];
  const added = upsertGuideValue(nextHorizontal, value);
  if (!added) {
    return guides;
  }
  nextHorizontal.sort((a, b) => a - b);
  return { ...guides, horizontal: nextHorizontal };
}

export function removeGuide(guides: GuidesState, orientation: GuideOrientation, value: number): GuidesState {
  if (orientation === "vertical") {
    const nextVertical = [...guides.vertical];
    const removed = removeGuideValue(nextVertical, value);
    if (!removed) {
      return guides;
    }
    return { ...guides, vertical: nextVertical };
  }

  const nextHorizontal = [...guides.horizontal];
  const removed = removeGuideValue(nextHorizontal, value);
  if (!removed) {
    return guides;
  }
  return { ...guides, horizontal: nextHorizontal };
}

export function moveGuide(
  guides: GuidesState,
  orientation: GuideOrientation,
  sourceValue: number,
  targetValue: number
): GuidesState {
  const withoutSource = removeGuide(guides, orientation, sourceValue);
  return addGuide(withoutSource, orientation, targetValue);
}

export function upsertGuideValue(values: number[], value: number): boolean {
  const normalized = normalizeGuideValue(value);
  if (values.some((existing) => Math.abs(existing - normalized) <= 1e-4)) {
    return false;
  }
  values.push(normalized);
  return true;
}

export function removeGuideValue(values: number[], value: number): boolean {
  const normalized = normalizeGuideValue(value);
  const index = values.findIndex((existing) => Math.abs(existing - normalized) <= 1e-4);
  if (index < 0) {
    return false;
  }
  values.splice(index, 1);
  return true;
}

export function normalizeGuideValue(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
