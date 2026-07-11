import type { ScenePathCommand } from "@tikz-editor/core/semantic/types";
import { worldBounds, worldPoint, pt } from "@tikz-editor/core/coords/index";
import type { WorldBounds, WorldPoint } from "../coords/types";
import type { NodeShape } from "@tikz-editor/core/semantic/nodes/types";
import {
  makeCircularSector,
  makeCloud,
  makeCloudCallout,
  makeCylinder,
  makeDartPolygon,
  makeDiamondPolygonForSizing,
  makeDoubleArrow,
  makeEllipseCallout,
  makeIsoscelesTrianglePolygon,
  makeKitePolygon,
  makeRectangleCallout,
  makeRegularPolygon,
  makeSemicircle,
  makeSignal,
  makeSingleArrow,
  makeStar,
  makeStarburst,
  makeTape,
  makeTrapeziumPolygon,
  resolveCalloutPointerOffset,
  resolveNodeShapeGeometryParams
} from "@tikz-editor/core/semantic/nodes/shape-geometry";

const DEFAULT_NODE_MINIMUM_DIMENSION_PT = 1;
const PREVIEW_CONSTRAINT_PENALTY = 0.01;

type DraftPreviewPoint = WorldPoint;
type DraftPreviewBounds = WorldBounds;

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

export type AddShapeDraftPreviewGeometry =
  | { kind: "path"; commands: ScenePathCommand[]; bounds: DraftPreviewBounds }
  | { kind: "ellipse"; rx: number; ry: number; bounds: DraftPreviewBounds }
  | { kind: "circle"; radius: number; bounds: DraftPreviewBounds };

export type AddShapeDraftResolution = {
  minimumWidthPt?: number;
  minimumHeightPt?: number;
  preview: AddShapeDraftPreviewGeometry;
};

export function resolveAddShapeOriginFromDrag(
  shapeRaw: string,
  startWorld: WorldPoint,
  endWorld: WorldPoint
): WorldPoint {
  const draft = resolveAddShapeDraft(
    shapeRaw,
    Math.abs(endWorld.x - startWorld.x),
    Math.abs(endWorld.y - startWorld.y)
  );
  const dx = endWorld.x - startWorld.x;
  const dy = endWorld.y - startWorld.y;
  const anchorX = dx >= 0 ? draft.preview.bounds.minX : draft.preview.bounds.maxX;
  const anchorY = dy >= 0 ? draft.preview.bounds.minY : draft.preview.bounds.maxY;
  return worldPoint(pt(startWorld.x - anchorX), pt(startWorld.y - anchorY));
}

type ShapeConstraintCandidate = {
  minimumWidthPt?: number;
  minimumHeightPt?: number;
  preview: AddShapeDraftPreviewGeometry;
  explicitConstraintCount: number;
};

export function resolveAddShapeDraft(
  shapeRaw: string,
  requestedWidthPt: number,
  requestedHeightPt: number
): AddShapeDraftResolution {
  const shape = normalizeNodeShape(shapeRaw);
  const safeRequestedWidth = Math.max(requestedWidthPt, DEFAULT_NODE_MINIMUM_DIMENSION_PT);
  const safeRequestedHeight = Math.max(requestedHeightPt, DEFAULT_NODE_MINIMUM_DIMENSION_PT);
  const candidates = dedupeConstraintCandidates([
    buildConstraintCandidate(shape, safeRequestedWidth, safeRequestedHeight),
    buildConstraintCandidate(shape, safeRequestedWidth),
    buildConstraintCandidate(shape, undefined, safeRequestedHeight)
  ]);

  let best = candidates[0] ?? buildConstraintCandidate(shape);
  let bestScore = scoreConstraintCandidate(best, safeRequestedWidth, safeRequestedHeight);

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) {
      continue;
    }
    const score = scoreConstraintCandidate(candidate, safeRequestedWidth, safeRequestedHeight);
    if (score < bestScore - 1e-6) {
      best = candidate;
      bestScore = score;
    }
  }

  return {
    minimumWidthPt: best.minimumWidthPt,
    minimumHeightPt: best.minimumHeightPt,
    preview: best.preview
  };
}

function scoreConstraintCandidate(
  candidate: ShapeConstraintCandidate,
  requestedWidthPt: number,
  requestedHeightPt: number
): number {
  const bounds = candidate.preview.bounds;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return (
    Math.abs(width - requestedWidthPt) +
    Math.abs(height - requestedHeightPt) +
    candidate.explicitConstraintCount * PREVIEW_CONSTRAINT_PENALTY
  );
}

function dedupeConstraintCandidates(candidates: readonly ShapeConstraintCandidate[]): ShapeConstraintCandidate[] {
  const unique = new Map<string, ShapeConstraintCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.minimumWidthPt ?? "_"}:${candidate.minimumHeightPt ?? "_"}`;
    if (!unique.has(key)) {
      unique.set(key, candidate);
    }
  }
  return [...unique.values()];
}

function buildConstraintCandidate(
  shape: NodeShape,
  minimumWidthPt?: number,
  minimumHeightPt?: number
): ShapeConstraintCandidate {
  return {
    minimumWidthPt,
    minimumHeightPt,
    preview: buildPreviewGeometry(shape, minimumWidthPt, minimumHeightPt),
    explicitConstraintCount: (minimumWidthPt != null ? 1 : 0) + (minimumHeightPt != null ? 1 : 0)
  };
}

function buildPreviewGeometry(
  shape: NodeShape,
  minimumWidthPt: number | undefined,
  minimumHeightPt: number | undefined
): AddShapeDraftPreviewGeometry {
  const params = resolveNodeShapeGeometryParams();
  const sizing = {
    naturalWidth: 0,
    naturalHeight: 0,
    minimumWidth: minimumWidthPt ?? DEFAULT_NODE_MINIMUM_DIMENSION_PT,
    minimumHeight: minimumHeightPt ?? DEFAULT_NODE_MINIMUM_DIMENSION_PT
  };

  if (shape === "circle") {
    const radius = Math.max(sizing.minimumWidth, sizing.minimumHeight) / 2;
    return {
      kind: "circle",
      radius,
      bounds: worldBounds(pt(-radius), pt(-radius), pt(radius), pt(radius))
    };
  }

  if (shape === "ellipse") {
    const rx = sizing.minimumWidth / 2;
    const ry = sizing.minimumHeight / 2;
    return {
      kind: "ellipse",
      rx,
      ry,
      bounds: worldBounds(pt(-rx), pt(-ry), pt(rx), pt(ry))
    };
  }

  if (shape === "diamond") {
    return pathPreviewFromPolygons([
      makeDiamondPolygonForSizing(sizing, params.diamondAspect)
    ]);
  }

  if (shape === "trapezium") {
    return pathPreviewFromPolygons([
      makeTrapeziumPolygon(
        {
          naturalHalfWidth: 0,
          naturalHalfHeight: 0,
          minimumWidth: sizing.minimumWidth,
          minimumHeight: sizing.minimumHeight
        },
        params.trapeziumLeftAngle,
        params.trapeziumRightAngle,
        params.shapeBorderRotate,
        params.trapeziumStretches,
        params.trapeziumStretchesBody
      )
    ]);
  }

  if (shape === "semicircle") {
    return pathPreviewFromPolygons([makeSemicircle(sizing, params.shapeBorderRotate, 0).polygon]);
  }

  if (shape === "isosceles triangle") {
    return pathPreviewFromPolygons([
      makeIsoscelesTrianglePolygon(
        sizing,
        params.isoscelesTriangleApexAngle,
        params.shapeBorderRotate,
        params.isoscelesTriangleStretches
      )
    ]);
  }

  if (shape === "kite") {
    return pathPreviewFromPolygons([
      makeKitePolygon(sizing, params.kiteUpperVertexAngle, params.kiteLowerVertexAngle, params.shapeBorderRotate)
    ]);
  }

  if (shape === "dart") {
    return pathPreviewFromPolygons([
      makeDartPolygon(sizing, params.dartTipAngle, params.dartTailAngle, params.shapeBorderRotate)
    ]);
  }

  if (shape === "circular sector") {
    return pathPreviewFromPolygons([
      makeCircularSector(sizing, params.circularSectorAngle, params.shapeBorderRotate, 0).polygon
    ]);
  }

  if (shape === "cylinder") {
    return pathPreviewFromPolygons([
      makeCylinder(sizing, params.cylinderAspect, params.shapeBorderRotate, 0).polygon
    ]);
  }

  if (shape === "regular polygon") {
    return pathPreviewFromPolygons([
      makeRegularPolygon(sizing, params.regularPolygonSides, params.shapeBorderRotate)
    ]);
  }

  if (shape === "star") {
    return pathPreviewFromPolygons([
      makeStar(
        sizing,
        params.starPoints,
        params.starPointRatio,
        params.starPointHeightPt,
        params.starUsesPointRatio,
        params.shapeBorderRotate
      ).polygon
    ]);
  }

  if (shape === "cloud") {
    return pathPreviewFromPolygons([
      makeCloud(sizing, params.cloudPuffs, params.cloudPuffArc, 1, params.cloudIgnoresAspect, params.shapeBorderRotate).polygon
    ]);
  }

  if (shape === "starburst") {
    return pathPreviewFromPolygons([
      makeStarburst(
        sizing,
        params.starburstPoints,
        params.starburstPointHeightPt,
        params.randomStarburstSeed,
        params.shapeBorderRotate
      ).polygon
    ]);
  }

  if (shape === "signal") {
    return pathPreviewFromPolygons([
      makeSignal(sizing, params.signalPointerAngle, params.signalToSides, params.signalFromSides).polygon
    ]);
  }

  if (shape === "tape") {
    return pathPreviewFromPolygons([
      makeTape(sizing, params.tapeBendTop, params.tapeBendBottom, params.tapeBendHeightPt).polygon
    ]);
  }

  if (shape === "rectangle callout") {
    const pointerOffset = resolveCalloutPointerOffset(params, null, null);
    return pathPreviewFromPolygons([
      makeRectangleCallout(
        sizing,
        pointerOffset,
        params.calloutPointerWidthPt,
        params.calloutPointerIsAbsolute,
        params.calloutPointerShortenPt
      ).polygon
    ]);
  }

  if (shape === "ellipse callout") {
    const pointerOffset = resolveCalloutPointerOffset(params, null, null);
    return pathPreviewFromPolygons([
      makeEllipseCallout(
        sizing,
        pointerOffset,
        params.calloutPointerArc,
        params.calloutPointerIsAbsolute,
        params.calloutPointerShortenPt
      ).polygon
    ]);
  }

  if (shape === "cloud callout") {
    const pointerOffset = resolveCalloutPointerOffset(params, null, null);
    const cloud = makeCloudCallout(
      sizing,
      params.cloudPuffs,
      params.cloudPuffArc,
      1,
      params.cloudIgnoresAspect,
      params.shapeBorderRotate,
      pointerOffset,
      params.calloutPointerStartSizeRaw,
      params.calloutPointerEndSizeRaw,
      params.calloutPointerSegments,
      params.calloutPointerIsAbsolute,
      params.calloutPointerShortenPt
    );
    return pathPreviewFromPolygons([cloud.polygon, cloud.pointerPolygon]);
  }

  if (shape === "single arrow") {
    return pathPreviewFromPolygons([
      makeSingleArrow(
        sizing,
        params.singleArrowTipAngle,
        params.singleArrowHeadExtendPt,
        params.singleArrowHeadIndentPt,
        params.shapeBorderRotate
      ).polygon
    ]);
  }

  if (shape === "double arrow") {
    return pathPreviewFromPolygons([
      makeDoubleArrow(
        sizing,
        params.doubleArrowTipAngle,
        params.doubleArrowHeadExtendPt,
        params.doubleArrowHeadIndentPt,
        params.shapeBorderRotate
      ).polygon
    ]);
  }

  const halfWidth = sizing.minimumWidth / 2;
  const halfHeight = sizing.minimumHeight / 2;
  return pathPreviewFromPolygons([[
    wp(-halfWidth, -halfHeight),
    wp(halfWidth, -halfHeight),
    wp(halfWidth, halfHeight),
    wp(-halfWidth, halfHeight)
  ]]);
}

function pathPreviewFromPolygons(polygons: ReadonlyArray<ReadonlyArray<DraftPreviewPoint>>): AddShapeDraftPreviewGeometry {
  const commands: ScenePathCommand[] = [];
  let bounds: DraftPreviewBounds | null = null;

  for (const polygon of polygons) {
    const first = polygon[0];
    if (!first) {
      continue;
    }
    commands.push({ kind: "M", to: worldPoint(pt(first.x), pt(first.y)) });
    bounds = expandBounds(bounds, first);
    for (let index = 1; index < polygon.length; index += 1) {
      const point = polygon[index];
      if (!point) {
        continue;
      }
      commands.push({ kind: "L", to: worldPoint(pt(point.x), pt(point.y)) });
      bounds = expandBounds(bounds, point);
    }
    commands.push({ kind: "Z" });
  }

  return {
    kind: "path",
    commands,
    bounds: bounds ?? worldBounds(pt(0), pt(0), pt(0), pt(0))
  };
}

function expandBounds(bounds: DraftPreviewBounds | null, point: DraftPreviewPoint): DraftPreviewBounds {
  if (!bounds) {
    return worldBounds(pt(point.x), pt(point.y), pt(point.x), pt(point.y));
  }
  return worldBounds(
    pt(Math.min(bounds.minX, point.x)),
    pt(Math.min(bounds.minY, point.y)),
    pt(Math.max(bounds.maxX, point.x)),
    pt(Math.max(bounds.maxY, point.y))
  );
}

function normalizeNodeShape(shapeRaw: string): NodeShape {
  return (shapeRaw || "rectangle") as NodeShape;
}
