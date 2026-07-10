import { applyMatrix } from "@tikz-editor/core/semantic/transform";
import type { SvgTransform, WorldBounds, WorldPoint, WorldTransform } from "@tikz-editor/core/coords/index";
import { mapWorldTransformToSvgTransform, worldPoint, worldToSvgTransform, pt } from "@tikz-editor/core/coords/index";
import type { SceneClipPath, SceneElement, ScenePathCommand, SceneText } from "@tikz-editor/core/semantic/types";
import type { SvgPoint } from "../coords/types";
import type { SvgViewBox } from "@tikz-editor/core/svg/types";
import { worldToSvgPoint } from "./geometry";

const HIT_STROKE_PX = 18;
const ADORNMENT_TEXT_HIT_PADDING_PX = 8;

export type HitRegionClipPath = {
  id: string;
  d: string;
  fillRule: "nonzero" | "evenodd";
};

export type HitRegion =
  | {
      shape: "path";
      key: string;
      sourceId: string;
      targetId: string;
      clipChain?: HitRegionClipPath[];
      d: string;
      transform?: SvgTransform;
      pointerMode: "stroke" | "fill";
      strokeWidth: number;
    }
  | {
      shape: "circle";
      key: string;
      sourceId: string;
      targetId: string;
      clipChain?: HitRegionClipPath[];
      cx: number;
      cy: number;
      r: number;
      pointerMode: "stroke" | "fill";
      strokeWidth: number;
    }
  | {
      shape: "ellipse";
      key: string;
      sourceId: string;
      targetId: string;
      clipChain?: HitRegionClipPath[];
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      rotation: number;
      pointerMode: "stroke" | "fill";
      strokeWidth: number;
    }
  | {
      shape: "rect";
      key: string;
      sourceId: string;
      targetId: string;
      clipChain?: HitRegionClipPath[];
      x: number;
      y: number;
      width: number;
      height: number;
      cx: number;
      cy: number;
      rotation: number;
      transform?: SvgTransform;
      interactionMode?: "move" | "text";
      pointerMode?: "stroke" | "fill";
      strokeWidth?: number;
      sceneTextKey?: string;
      contentWidth?: number;
      contentHeight?: number;
      matrixEdgeSelection?: {
        kind: "row" | "column";
        matrixSourceId: string;
        selectionIds: string[];
        cursor: "e-resize" | "s-resize";
      };
    };

export type ScopeHitBounds = {
  scopeId: string;
  bounds: WorldBounds;
};

export function buildHitRegions(
  elements: SceneElement[],
  viewBox: SvgViewBox,
  scale: number,
  scopeHitBounds: readonly ScopeHitBounds[] = []
): HitRegion[] {
  const regions: HitRegion[] = [];
  const strokeWidth = HIT_STROKE_PX / Math.max(scale, 1e-3);
  const sourceHasNonAdornmentNonText = new Set<string>();
  for (const element of elements) {
    if (!element.adornment && element.kind !== "Text") {
      sourceHasNonAdornmentNonText.add(element.sourceRef.sourceId);
    }
  }

  for (const element of elements) {
    const sourceId = element.sourceRef.sourceId;
    const clipChain = encodeClipChain(element.clipChain ?? [], viewBox);
    if (element.kind === "Path") {
      const pointerMode = resolveShapePointerMode(element.style.fill, element.style.stroke, element.style.fillOpacity, element.style.strokeOpacity, element.style.opacity);
      if (!pointerMode) continue;
      const d = encodePathData(element.commands, viewBox);
      if (!d) continue;
      const transform = element.transform ? worldTransformToSvgTransform(element.transform, viewBox) : undefined;
      regions.push({
        shape: "path",
        key: `hit:${element.id}`,
        sourceId,
        targetId: element.adornment?.targetId ?? sourceId,
        clipChain,
        d,
        transform,
        pointerMode,
        strokeWidth
      });
      continue;
    }

    if (element.kind === "Circle") {
      const pointerMode = resolveShapePointerMode(element.style.fill, element.style.stroke, element.style.fillOpacity, element.style.strokeOpacity, element.style.opacity);
      if (!pointerMode) continue;
      const center = worldToSvgPoint(element.center, viewBox);
      regions.push({
        shape: "circle",
        key: `hit:${element.id}`,
        sourceId,
        targetId: element.adornment?.targetId ?? sourceId,
        clipChain,
        cx: center.x,
        cy: center.y,
        r: element.radius,
        pointerMode,
        strokeWidth
      });
      continue;
    }

    if (element.kind === "Ellipse") {
      const pointerMode = resolveShapePointerMode(element.style.fill, element.style.stroke, element.style.fillOpacity, element.style.strokeOpacity, element.style.opacity);
      if (!pointerMode) continue;
      const center = worldToSvgPoint(element.center, viewBox);
      regions.push({
        shape: "ellipse",
        key: `hit:${element.id}`,
        sourceId,
        targetId: element.adornment?.targetId ?? sourceId,
        clipChain,
        cx: center.x,
        cy: center.y,
        rx: element.rx,
        ry: element.ry,
        rotation: element.rotation ?? 0,
        pointerMode,
        strokeWidth
      });
      continue;
    }

    const textGeometry = textGeometryInSvg(element, viewBox);
    const sceneTextKey = `hit:${element.id}`;
    const hitPadding = element.adornment ? ADORNMENT_TEXT_HIT_PADDING_PX / Math.max(scale, 1e-3) : 0;
    if (element.adornment && hitPadding > 0) {
      regions.push({
        shape: "rect",
        key: `${sceneTextKey}:halo`,
        sourceId,
        targetId: element.adornment.targetId,
        clipChain,
        x: textGeometry.cx - textGeometry.width / 2 - hitPadding,
        y: textGeometry.cy - textGeometry.height / 2 - hitPadding,
        width: textGeometry.width + 2 * hitPadding,
        height: textGeometry.height + 2 * hitPadding,
        cx: textGeometry.cx,
        cy: textGeometry.cy,
        rotation: textGeometry.rotation,
        transform: textGeometry.transform,
        interactionMode: "move",
        sceneTextKey,
        contentWidth: textGeometry.width,
        contentHeight: textGeometry.height
      });
    }
    const hasNodeVisualBounds =
      Number.isFinite(element.nodeVisualWidth) &&
      Number.isFinite(element.nodeVisualHeight) &&
      (element.nodeVisualWidth ?? 0) > 0 &&
      (element.nodeVisualHeight ?? 0) > 0;
    const isTextOnlyNodeSource =
      !element.adornment &&
      !element.matrixCell &&
      !sourceHasNonAdornmentNonText.has(sourceId);
    if (isTextOnlyNodeSource && hasNodeVisualBounds) {
      const nodeWidth = element.nodeVisualWidth!;
      const nodeHeight = element.nodeVisualHeight!;
      const hasExtraNodeArea =
        nodeWidth > textGeometry.width + 1e-6 ||
        nodeHeight > textGeometry.height + 1e-6;
      if (hasExtraNodeArea) {
        regions.push({
          shape: "rect",
          key: `${sceneTextKey}:node-area`,
          sourceId,
          targetId: sourceId,
          clipChain,
          x: textGeometry.cx - nodeWidth / 2,
          y: textGeometry.cy - nodeHeight / 2,
          width: nodeWidth,
          height: nodeHeight,
          cx: textGeometry.cx,
          cy: textGeometry.cy,
          rotation: textGeometry.rotation,
          transform: textGeometry.transform,
          interactionMode: "move",
          sceneTextKey,
          contentWidth: textGeometry.width,
          contentHeight: textGeometry.height
        });
      }
    }
    regions.push({
      shape: "rect",
      key: sceneTextKey,
      sourceId,
      targetId: element.adornment?.targetId ?? sourceId,
      clipChain,
      x: textGeometry.cx - textGeometry.width / 2,
      y: textGeometry.cy - textGeometry.height / 2,
      width: textGeometry.width,
      height: textGeometry.height,
      cx: textGeometry.cx,
      cy: textGeometry.cy,
      rotation: textGeometry.rotation,
      transform: textGeometry.transform,
      interactionMode: "text",
      pointerMode: "fill",
      sceneTextKey,
      contentWidth: textGeometry.width,
      contentHeight: textGeometry.height
    });
  }

  for (const scope of scopeHitBounds) {
    const topLeft = worldToSvgPoint(worldPoint(scope.bounds.minX, scope.bounds.maxY), viewBox);
    const bottomRight = worldToSvgPoint(worldPoint(scope.bounds.maxX, scope.bounds.minY), viewBox);
    const pad = strokeWidth / 2;
    const width = Math.max(0, bottomRight.x - topLeft.x) + strokeWidth;
    const height = Math.max(0, bottomRight.y - topLeft.y) + strokeWidth;
    regions.push({
      shape: "rect",
      key: `scope-hit:${scope.scopeId}`,
      sourceId: scope.scopeId,
      targetId: scope.scopeId,
      x: topLeft.x - pad,
      y: topLeft.y - pad,
      width,
      height,
      cx: topLeft.x + (bottomRight.x - topLeft.x) / 2,
      cy: topLeft.y + (bottomRight.y - topLeft.y) / 2,
      rotation: 0,
      interactionMode: "move",
      pointerMode: "stroke",
      strokeWidth
    });
  }

  return regions;
}

function resolveShapePointerMode(
  fill: string | null,
  stroke: string | null,
  fillOpacity: number,
  strokeOpacity: number,
  opacity: number
): "stroke" | "fill" | null {
  if (hasVisibleFill(fill, fillOpacity, opacity)) {
    return "fill";
  }
  if (hasVisibleStroke(stroke, strokeOpacity, opacity)) {
    return "stroke";
  }
  return null;
}

function hasVisibleFill(fill: string | null, fillOpacity: number, opacity: number): boolean {
  return fill != null && fill !== "none" && fillOpacity > 0 && opacity > 0;
}

function hasVisibleStroke(stroke: string | null, strokeOpacity: number, opacity: number): boolean {
  return stroke != null && stroke !== "none" && strokeOpacity > 0 && opacity > 0;
}

function encodeClipChain(
  clipChain: readonly SceneClipPath[],
  viewBox: Pick<SvgViewBox, "y" | "height">
): HitRegionClipPath[] | undefined {
  if (clipChain.length === 0) {
    return undefined;
  }
  const encoded = clipChain.flatMap((clipPath) => {
    const d = encodePathData(clipPath.commands, viewBox);
    if (!d) {
      return [];
    }
    return [{
      id: clipPath.id,
      d,
      fillRule: clipPath.fillRule
    }];
  });
  return encoded.length > 0 ? encoded : undefined;
}

function textGeometryInSvg(
  element: SceneText,
  viewBox: Pick<SvgViewBox, "y" | "height">
): { cx: number; cy: number; width: number; height: number; rotation: number; transform?: SvgTransform } {
  const center = worldToSvgPoint(element.position, viewBox);
  const width = element.textBlockWidth ?? estimateTextBlockWidth(element.text, element.style.fontSize);
  const height = element.textBlockHeight ?? Math.max(1, element.text.split("\n").length) * element.style.fontSize * 1.15;
  const x = center.x - width / 2;
  const y = center.y - height / 2;
  const transform = resolveTextRectTransformInSvg(element, { x, y, width, height }, viewBox);

  return {
    cx: center.x,
    cy: center.y,
    width,
    height,
    rotation: 0,
    transform
  };
}

function resolveTextRectTransformInSvg(
  element: SceneText,
  localRect: { x: number; y: number; width: number; height: number },
  viewBox: Pick<SvgViewBox, "y" | "height">
): SvgTransform | undefined {
  const center = element.position;
  const halfWidth = localRect.width / 2;
  const halfHeight = localRect.height / 2;
  const rotation = element.rotation ?? 0;
  const localCornersWorld = {
    topLeft: rotateWorldPointAroundCenter(worldPoint(pt(center.x - halfWidth), pt(center.y + halfHeight)), center, rotation),
    topRight: rotateWorldPointAroundCenter(worldPoint(pt(center.x + halfWidth), pt(center.y + halfHeight)), center, rotation),
    bottomLeft: rotateWorldPointAroundCenter(worldPoint(pt(center.x - halfWidth), pt(center.y - halfHeight)), center, rotation)
  };
  const actualCornersWorld = element.transform
    ? {
        topLeft: applyMatrix(element.transform, localCornersWorld.topLeft),
        topRight: applyMatrix(element.transform, localCornersWorld.topRight),
        bottomLeft: applyMatrix(element.transform, localCornersWorld.bottomLeft)
      }
    : localCornersWorld;
  const actualCornersSvg = {
    topLeft: worldToSvgPoint(actualCornersWorld.topLeft, viewBox),
    topRight: worldToSvgPoint(actualCornersWorld.topRight, viewBox),
    bottomLeft: worldToSvgPoint(actualCornersWorld.bottomLeft, viewBox)
  };

  const transform = rectTransformFromCorners(localRect, actualCornersSvg);
  return isIdentityAffine(transform) ? undefined : transform;
}

function rotateWorldPointAroundCenter(point: WorldPoint, center: WorldPoint, degrees: number): WorldPoint {
  if (Math.abs(degrees) <= 1e-6) {
    return point;
  }
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return worldPoint(
    pt(center.x + dx * cos - dy * sin),
    pt(center.y + dx * sin + dy * cos)
  );
}

function rectTransformFromCorners(
  localRect: { x: number; y: number; width: number; height: number },
  corners: {
    topLeft: SvgPoint;
    topRight: SvgPoint;
    bottomLeft: SvgPoint;
  }
): SvgTransform {
  const safeWidth = Math.max(localRect.width, 1e-9);
  const safeHeight = Math.max(localRect.height, 1e-9);
  const a = (corners.topRight.x - corners.topLeft.x) / safeWidth;
  const b = (corners.topRight.y - corners.topLeft.y) / safeWidth;
  const c = (corners.bottomLeft.x - corners.topLeft.x) / safeHeight;
  const d = (corners.bottomLeft.y - corners.topLeft.y) / safeHeight;
  const e = corners.topLeft.x - a * localRect.x - c * localRect.y;
  const f = corners.topLeft.y - b * localRect.x - d * localRect.y;
  return worldToSvgTransform(a, b, c, d, e, f);
}

function isIdentityAffine(matrix: SvgTransform): boolean {
  return (
    Math.abs(matrix.a - 1) <= 1e-6 &&
    Math.abs(matrix.b) <= 1e-6 &&
    Math.abs(matrix.c) <= 1e-6 &&
    Math.abs(matrix.d - 1) <= 1e-6 &&
    Math.abs(matrix.e) <= 1e-6 &&
    Math.abs(matrix.f) <= 1e-6
  );
}

function estimateTextBlockWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  if (maxChars <= 0) {
    return 0;
  }
  return maxChars * fontSize * 0.7;
}

function encodePathData(commands: ScenePathCommand[], viewBox: Pick<SvgViewBox, "y" | "height">): string {
  const chunks: string[] = [];

  for (const command of commands) {
    if (command.kind === "Z") {
      chunks.push("Z");
      continue;
    }

    if (command.kind === "A") {
      const to = worldToSvgPoint(command.to, viewBox);
      const sweep = command.sweep ? 0 : 1;
      chunks.push(
        `A ${fmt(command.rx)} ${fmt(command.ry)} ${fmt(-command.xAxisRotation)} ${command.largeArc ? 1 : 0} ${sweep} ${fmt(to.x)} ${fmt(to.y)}`
      );
      continue;
    }

    if (command.kind === "C") {
      const c1 = worldToSvgPoint(command.c1, viewBox);
      const c2 = worldToSvgPoint(command.c2, viewBox);
      const to = worldToSvgPoint(command.to, viewBox);
      chunks.push(`C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(to.x)} ${fmt(to.y)}`);
      continue;
    }

    const to = worldToSvgPoint(command.to, viewBox);
    chunks.push(`${command.kind} ${fmt(to.x)} ${fmt(to.y)}`);
  }

  return chunks.join(" ");
}

function fmt(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function worldTransformToSvgTransform(
  matrix: WorldTransform,
  viewBox: Pick<SvgViewBox, "y" | "height">
): SvgTransform {
  return mapWorldTransformToSvgTransform(matrix, viewBox);
}
