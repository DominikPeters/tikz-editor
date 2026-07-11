import { worldToLocal } from "@tikz-editor/core/edit/coords";
import type { ResizeRole } from "@tikz-editor/core/edit/actions";
import type { EditHandle, SceneCircle, SceneElement, SceneEllipse, ScenePath, ScenePathShapeHint, SceneText } from "@tikz-editor/core/semantic/types";
import { isFrameLocalCoordinateEditHandle } from "@tikz-editor/core/semantic/types";
import {
  applyFrameTransform,
  applyFrameVector,
  frameTransform,
  frameLocalPoint,
  frameLocalVector,
  svgBounds,
  worldBounds,
  worldPoint,
  worldTransform,
  worldVector,
  pt
} from "@tikz-editor/core/coords/index";
import type { FrameLocalPoint, FrameTransform, WorldBounds, WorldTransform, WorldVector } from "@tikz-editor/core/coords/index";
import { applyMatrix } from "@tikz-editor/core/semantic/transform";
import type { SvgViewBox } from "@tikz-editor/core/svg/types";
import { svgPoint } from "@tikz-editor/core/coords/index";
import type { SvgBounds, SvgPoint, WorldPoint } from "../coords/types";
import { svgToWorldPoint, worldToSvgPoint } from "./geometry";

export type ResizeFrameCornerRole = Extract<ResizeRole, "top-left" | "top-right" | "bottom-left" | "bottom-right">;

export const RESIZE_FRAME_CORNER_ROLES: readonly ResizeFrameCornerRole[] = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left"
];

export type ResizeFrameCorner = {
  world: WorldPoint;
  svg: SvgPoint;
};

export type ResizeFrame = {
  sourceId: string;
  centerWorld: WorldPoint;
  centerSvg: SvgPoint;
  cornersByRole: Record<ResizeFrameCornerRole, ResizeFrameCorner>;
  polygonSvg: SvgPoint[];
  boundsSvg: SvgBounds;
};

const EPSILON = 1e-6;

const IDENTITY_MATRIX: WorldTransform = worldTransform(1, 0, 0, 1, 0, 0);

export function resolveResizeFrameForSource(
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox,
  pathShapeHintOverride?: ScenePathShapeHint | null
): ResizeFrame | null {
  const sourceElements = elements.filter((element) => element.sourceRef.sourceId === sourceId && !element.adornment);
  const nonTextElements = sourceElements.filter((element) => element.kind !== "Text");
  const textElements = sourceElements.filter(
    (element): element is SceneText => element.kind === "Text"
  );
  if (nonTextElements.length === 1) {
    const element = nonTextElements[0];
    if (!element) {
      return null;
    }

    if (element.kind === "Path") {
      return resolvePathResizeFrame(
        element,
        sourceElements,
        editHandles,
        sourceId,
        viewBox,
        pathShapeHintOverride
      );
    }
    if (element.kind === "Circle") {
      return resolveCircleResizeFrame(element, editHandles, sourceId, viewBox);
    }
    if (element.kind === "Ellipse") {
      return resolveEllipseResizeFrame(element, editHandles, sourceId, viewBox);
    }
    return null;
  }

  if (nonTextElements.length === 0 && textElements.length === 1) {
    return resolveTextResizeFrame(sourceId, textElements[0], viewBox);
  }
  return null;
}

export function resolveResizeFrameFromBounds(
  sourceId: string,
  bounds: SvgBounds,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!(width > EPSILON) || !(height > EPSILON)) {
    return null;
  }

  const cornersByRoleSvg: Record<ResizeFrameCornerRole, SvgPoint> = {
    "top-left": svgPoint(pt(bounds.minX), pt(bounds.minY)),
    "top-right": svgPoint(pt(bounds.maxX), pt(bounds.minY)),
    "bottom-right": svgPoint(pt(bounds.maxX), pt(bounds.maxY)),
    "bottom-left": svgPoint(pt(bounds.minX), pt(bounds.maxY))
  };
  const centerWorld = svgToWorldPoint(
    svgPoint(pt((bounds.minX + bounds.maxX) / 2), pt((bounds.minY + bounds.maxY) / 2)),
    viewBox
  );
  const cornersByRoleWorld: Record<ResizeFrameCornerRole, WorldPoint> = {
    "top-left": svgToWorldPoint(cornersByRoleSvg["top-left"], viewBox),
    "top-right": svgToWorldPoint(cornersByRoleSvg["top-right"], viewBox),
    "bottom-right": svgToWorldPoint(cornersByRoleSvg["bottom-right"], viewBox),
    "bottom-left": svgToWorldPoint(cornersByRoleSvg["bottom-left"], viewBox)
  };
  return buildResizeFrame(sourceId, centerWorld, cornersByRoleWorld, viewBox);
}

function resolvePathResizeFrame(
  path: ScenePath,
  sourceElements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox,
  pathShapeHintOverride?: ScenePathShapeHint | null
): ResizeFrame | null {
  const pathShapeHint = pathShapeHintOverride === undefined ? (path.shapeHint ?? null) : pathShapeHintOverride;
  if (!pathShapeHint) {
    return resolveNodePathResizeFrame(path, sourceElements, editHandles, sourceId, viewBox);
  }
  if (pathShapeHint === "rectangle") {
    return resolvePathRectangleResizeFrame(editHandles, sourceId, viewBox);
  }
  if (pathShapeHint === "circle" || pathShapeHint === "ellipse") {
    const centerHandle = pickCenterPathPointHandle(editHandles, sourceId);
    if (!centerHandle) {
      return null;
    }
    const radii = resolvePathArcRadii(path, pathShapeHint);
    if (!radii) {
      return null;
    }
    return resolveEllipseLikeResizeFrame(
      sourceId,
      centerHandle.world,
      radii.rx,
      radii.ry,
      viewBox,
      frameTransform(
        centerHandle.transform.a,
        centerHandle.transform.b,
        centerHandle.transform.c,
        centerHandle.transform.d,
        centerHandle.transform.e,
        centerHandle.transform.f
      )
    );
  }
  return null;
}

function resolveNodePathResizeFrame(
  path: ScenePath,
  sourceElements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const isNodeSource =
    sourceElements.some((element) => element.kind === "Text") ||
    editHandles.some((handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "node-position");
  if (!isNodeSource) {
    return null;
  }

  const corners = resolveRectanglePathCorners(path);
  if (!corners) {
    return resolveGenericNodePathResizeFrame(path, sourceId, viewBox);
  }
  const transformedCorners = path.transform
    ? corners.map((corner) => applyMatrix(path.transform!, corner))
    : corners;
  const centerWorld = worldPoint(
    pt(transformedCorners.reduce((sum, point) => sum + point.x, 0) / transformedCorners.length),
    pt(transformedCorners.reduce((sum, point) => sum + point.y, 0) / transformedCorners.length)
  );
  const basis = resolveRectangleBasis(transformedCorners);
  if (!basis) {
    return null;
  }
  const cornersByRole = assignCornersByRoleWithBasis(transformedCorners, centerWorld, basis.u, basis.v);
  if (!cornersByRole) {
    return null;
  }
  return buildResizeFrame(sourceId, centerWorld, cornersByRole, viewBox);
}

function resolveGenericNodePathResizeFrame(
  path: ScenePath,
  sourceId: string,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const localBounds = approximatePathBoundsInWorld(path);
  if (!localBounds) {
    return null;
  }
  const width = localBounds.maxX - localBounds.minX;
  const height = localBounds.maxY - localBounds.minY;
  if (!(width > EPSILON) || !(height > EPSILON)) {
    return null;
  }

  const roleLocal: Record<ResizeFrameCornerRole, WorldPoint> = {
    "top-left": worldPoint(pt(localBounds.minX), pt(localBounds.maxY)),
    "top-right": worldPoint(pt(localBounds.maxX), pt(localBounds.maxY)),
    "bottom-right": worldPoint(pt(localBounds.maxX), pt(localBounds.minY)),
    "bottom-left": worldPoint(pt(localBounds.minX), pt(localBounds.minY))
  };
  const transform = path.transform;
  const roleWorld: Record<ResizeFrameCornerRole, WorldPoint> = transform
    ? {
        "top-left": applyMatrix(transform, roleLocal["top-left"]),
        "top-right": applyMatrix(transform, roleLocal["top-right"]),
        "bottom-right": applyMatrix(transform, roleLocal["bottom-right"]),
        "bottom-left": applyMatrix(transform, roleLocal["bottom-left"])
      }
    : roleLocal;
  const centerLocal = worldPoint(
    pt((localBounds.minX + localBounds.maxX) / 2),
    pt((localBounds.minY + localBounds.maxY) / 2)
  );
  const centerWorld = transform ? applyMatrix(transform, centerLocal) : centerLocal;
  return buildResizeFrame(sourceId, centerWorld, roleWorld, viewBox);
}

function approximatePathBoundsInWorld(path: ScenePath): WorldBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let current: WorldPoint | null = null;

  const includePoint = (point: WorldPoint): void => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const command of path.commands) {
    if (command.kind === "M") {
      current = command.to;
      includePoint(command.to);
      continue;
    }
    if (command.kind === "L") {
      current = command.to;
      includePoint(command.to);
      continue;
    }
    if (command.kind === "C") {
      includePoint(command.c1);
      includePoint(command.c2);
      includePoint(command.to);
      current = command.to;
      continue;
    }
    if (command.kind === "A") {
      if (current) {
        includePoint(worldPoint(pt(current.x - command.rx), pt(current.y - command.ry)));
        includePoint(worldPoint(pt(current.x + command.rx), pt(current.y + command.ry)));
      }
      includePoint(worldPoint(pt(command.to.x - command.rx), pt(command.to.y - command.ry)));
      includePoint(worldPoint(pt(command.to.x + command.rx), pt(command.to.y + command.ry)));
      current = command.to;
      continue;
    }
    if (command.kind === "Z") {
      continue;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return worldBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

function resolvePathRectangleResizeFrame(
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const pathPointHandles = editHandles.filter(
    (handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "path-point"
  );
  if (pathPointHandles.length !== 2) {
    return null;
  }

  const [startHandle, oppositeHandle] = pathPointHandles;
  if (!startHandle || !oppositeHandle) {
    return null;
  }
  if (!transformsApproximatelyEqual(startHandle.transform, oppositeHandle.transform)) {
    return null;
  }

  const transform = frameTransform(
    startHandle.transform.a,
    startHandle.transform.b,
    startHandle.transform.c,
    startHandle.transform.d,
    startHandle.transform.e,
    startHandle.transform.f
  );
  const startLocal = isFrameLocalCoordinateEditHandle(startHandle)
    ? startHandle.local
    : worldToLocal(startHandle.world, transform);
  const oppositeLocal = isFrameLocalCoordinateEditHandle(oppositeHandle)
    ? oppositeHandle.local
    : worldToLocal(oppositeHandle.world, transform);
  if (!startLocal || !oppositeLocal) {
    return null;
  }

  const minX = Math.min(startLocal.x, oppositeLocal.x);
  const maxX = Math.max(startLocal.x, oppositeLocal.x);
  const minY = Math.min(startLocal.y, oppositeLocal.y);
  const maxY = Math.max(startLocal.y, oppositeLocal.y);
  const roleLocal: Record<ResizeFrameCornerRole, FrameLocalPoint> = {
    "top-left": frameLocalPoint(pt(minX), pt(maxY)),
    "top-right": frameLocalPoint(pt(maxX), pt(maxY)),
    "bottom-right": frameLocalPoint(pt(maxX), pt(minY)),
    "bottom-left": frameLocalPoint(pt(minX), pt(minY))
  };
  const roleWorld: Record<ResizeFrameCornerRole, WorldPoint> = {
    "top-left": applyFrameTransform(transform, roleLocal["top-left"]),
    "top-right": applyFrameTransform(transform, roleLocal["top-right"]),
    "bottom-right": applyFrameTransform(transform, roleLocal["bottom-right"]),
    "bottom-left": applyFrameTransform(transform, roleLocal["bottom-left"])
  };
  const centerWorld = applyFrameTransform(
    transform,
    frameLocalPoint(pt((startLocal.x + oppositeLocal.x) / 2), pt((startLocal.y + oppositeLocal.y) / 2))
  );
  return buildResizeFrame(sourceId, centerWorld, roleWorld, viewBox);
}

function resolveCircleResizeFrame(
  circle: SceneCircle,
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const centerHandle = pickCenterPathPointHandle(editHandles, sourceId, circle.center);
  if (!centerHandle || circle.radius <= EPSILON) {
    return null;
  }
  return resolveEllipseLikeResizeFrame(
    sourceId,
    circle.center,
    circle.radius,
    circle.radius,
    viewBox,
    frameTransform(
      centerHandle.transform.a,
      centerHandle.transform.b,
      centerHandle.transform.c,
      centerHandle.transform.d,
      centerHandle.transform.e,
      centerHandle.transform.f
    )
  );
}

function resolveEllipseResizeFrame(
  ellipse: SceneEllipse,
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const centerHandle = pickCenterPathPointHandle(editHandles, sourceId, ellipse.center);
  if (!centerHandle || ellipse.rx <= EPSILON || ellipse.ry <= EPSILON) {
    return null;
  }

  const transform = centerHandle.transform;
  const shouldApplyEllipseRotation = matrixIsIdentity(transform) && Math.abs(ellipse.rotation ?? 0) > EPSILON;

  return resolveEllipseLikeResizeFrame(
    sourceId,
    ellipse.center,
    ellipse.rx,
    ellipse.ry,
    viewBox,
    frameTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f),
    shouldApplyEllipseRotation ? (ellipse.rotation ?? 0) : 0
  );
}

function resolveEllipseLikeResizeFrame(
  sourceId: string,
  centerWorld: WorldPoint,
  rx: number,
  ry: number,
  viewBox: SvgViewBox,
  transform: FrameTransform,
  extraRotation = 0
): ResizeFrame | null {
  if (!(rx > EPSILON) || !(ry > EPSILON)) {
    return null;
  }

  const localByRole: Record<ResizeFrameCornerRole, FrameLocalPoint> = {
    "top-left": frameLocalPoint(pt(-rx), pt(ry)),
    "top-right": frameLocalPoint(pt(rx), pt(ry)),
    "bottom-right": frameLocalPoint(pt(rx), pt(-ry)),
    "bottom-left": frameLocalPoint(pt(-rx), pt(-ry))
  };
  const toWorldCorner = (localCorner: FrameLocalPoint): WorldPoint => {
    let worldOffset = applyFrameVector(transform, frameLocalVector(pt(localCorner.x), pt(localCorner.y)));
    if (Math.abs(extraRotation) > EPSILON) {
      worldOffset = rotateVector(worldOffset, extraRotation);
    }
    return worldPoint(pt(centerWorld.x + worldOffset.x), pt(centerWorld.y + worldOffset.y));
  };
  const roleWorld: Record<ResizeFrameCornerRole, WorldPoint> = {
    "top-left": toWorldCorner(localByRole["top-left"]),
    "top-right": toWorldCorner(localByRole["top-right"]),
    "bottom-right": toWorldCorner(localByRole["bottom-right"]),
    "bottom-left": toWorldCorner(localByRole["bottom-left"])
  };
  return buildResizeFrame(sourceId, centerWorld, roleWorld, viewBox);
}

function resolveTextResizeFrame(
  sourceId: string,
  text: SceneText,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const width = text.nodeVisualWidth ?? text.textBlockWidth ?? estimateTextBlockWidth(text.text, text.style.fontSize);
  const lineCount = Math.max(1, text.text.split("\n").length);
  const height = text.nodeVisualHeight ?? text.textBlockHeight ?? lineCount * text.style.fontSize * 1.15;
  if (!(width > EPSILON) || !(height > EPSILON)) {
    return null;
  }

  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const rotation = text.rotation ?? 0;
  const localByRole: Record<ResizeFrameCornerRole, FrameLocalPoint> = {
    "top-left": frameLocalPoint(pt(-halfWidth), pt(halfHeight)),
    "top-right": frameLocalPoint(pt(halfWidth), pt(halfHeight)),
    "bottom-right": frameLocalPoint(pt(halfWidth), pt(-halfHeight)),
    "bottom-left": frameLocalPoint(pt(-halfWidth), pt(-halfHeight))
  };
  const cornersByRole = {
    "top-left": rotateAndTranslatePoint(localByRole["top-left"], text.position, rotation),
    "top-right": rotateAndTranslatePoint(localByRole["top-right"], text.position, rotation),
    "bottom-right": rotateAndTranslatePoint(localByRole["bottom-right"], text.position, rotation),
    "bottom-left": rotateAndTranslatePoint(localByRole["bottom-left"], text.position, rotation)
  };
  if (!text.transform) {
    return buildResizeFrame(sourceId, text.position, cornersByRole, viewBox);
  }
  const transformedCornersByRole = {
    "top-left": applyMatrix(text.transform, cornersByRole["top-left"]),
    "top-right": applyMatrix(text.transform, cornersByRole["top-right"]),
    "bottom-right": applyMatrix(text.transform, cornersByRole["bottom-right"]),
    "bottom-left": applyMatrix(text.transform, cornersByRole["bottom-left"])
  };
  const centerWorld = applyMatrix(text.transform, text.position);
  return buildResizeFrame(sourceId, centerWorld, transformedCornersByRole, viewBox);
}

function resolvePathArcRadii(
  path: ScenePath,
  pathShapeHint: Extract<ScenePathShapeHint, "circle" | "ellipse">
): { rx: number; ry: number } | null {
  const arc = path.commands.find(
    (command): command is Extract<ScenePath["commands"][number], { kind: "A" }> => command.kind === "A"
  );
  if (!arc) {
    return null;
  }
  if (pathShapeHint === "circle") {
    const radius = Math.max(Math.abs(arc.rx), Math.abs(arc.ry));
    if (!(radius > EPSILON)) {
      return null;
    }
    return { rx: radius, ry: radius };
  }
  const rx = Math.abs(arc.rx);
  const ry = Math.abs(arc.ry);
  if (!(rx > EPSILON) || !(ry > EPSILON)) {
    return null;
  }
  return { rx, ry };
}

function buildResizeFrame(
  sourceId: string,
  centerWorld: WorldPoint,
  cornersByRoleWorld: Record<ResizeFrameCornerRole, WorldPoint>,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const cornersByRole = {
    "top-left": {
      world: cornersByRoleWorld["top-left"],
      svg: worldToSvgPoint(cornersByRoleWorld["top-left"], viewBox)
    },
    "top-right": {
      world: cornersByRoleWorld["top-right"],
      svg: worldToSvgPoint(cornersByRoleWorld["top-right"], viewBox)
    },
    "bottom-right": {
      world: cornersByRoleWorld["bottom-right"],
      svg: worldToSvgPoint(cornersByRoleWorld["bottom-right"], viewBox)
    },
    "bottom-left": {
      world: cornersByRoleWorld["bottom-left"],
      svg: worldToSvgPoint(cornersByRoleWorld["bottom-left"], viewBox)
    }
  };

  const polygonSvg = RESIZE_FRAME_CORNER_ROLES.map((role) => cornersByRole[role].svg);
  const boundsSvg = boundsFromPoints(polygonSvg);

  return {
    sourceId,
    centerWorld,
    centerSvg: worldToSvgPoint(centerWorld, viewBox),
    cornersByRole,
    polygonSvg,
    boundsSvg
  };
}

function resolveRectanglePathCorners(path: ScenePath): WorldPoint[] | null {
  const corners: WorldPoint[] = [];
  let closed = false;
  for (const command of path.commands) {
    if (command.kind === "M" || command.kind === "L") {
      if (closed) {
        return null;
      }
      corners.push(command.to);
      continue;
    }
    if (command.kind === "Z") {
      closed = true;
      break;
    }
    return null;
  }

  if (!closed || corners.length < 4) {
    return null;
  }
  const first = corners[0];
  const last = corners[corners.length - 1];
  if (!first || !last) {
    return null;
  }
  if (pointsApproximatelyEqual(first, last)) {
    corners.pop();
  }
  if (corners.length !== 4) {
    return null;
  }
  return resolveRectangleBasis(corners) ? corners : null;
}

function resolveRectangleBasis(corners: readonly WorldPoint[]): { u: WorldVector; v: WorldVector } | null {
  if (corners.length !== 4) {
    return null;
  }

  const edge01 = subtractPoints(corners[1], corners[0]);
  const edge12 = subtractPoints(corners[2], corners[1]);
  const edge23 = subtractPoints(corners[3], corners[2]);
  const edge30 = subtractPoints(corners[0], corners[3]);
  const len01 = Math.hypot(edge01.x, edge01.y);
  const len12 = Math.hypot(edge12.x, edge12.y);
  const len23 = Math.hypot(edge23.x, edge23.y);
  const len30 = Math.hypot(edge30.x, edge30.y);
  if (len01 <= EPSILON || len12 <= EPSILON || len23 <= EPSILON || len30 <= EPSILON) {
    return null;
  }

  const orthogonalityTolerance = 1e-3;
  const lengthTolerance = 1e-3;
  if (Math.abs(dot(edge01, edge12)) > orthogonalityTolerance * len01 * len12) {
    return null;
  }
  if (Math.abs(dot(edge12, edge23)) > orthogonalityTolerance * len12 * len23) {
    return null;
  }
  if (Math.abs(len01 - len23) > lengthTolerance * Math.max(len01, len23)) {
    return null;
  }
  if (Math.abs(len12 - len30) > lengthTolerance * Math.max(len12, len30)) {
    return null;
  }

  return {
    u: worldVector(pt(edge01.x / len01), pt(edge01.y / len01)),
    v: worldVector(pt(edge12.x / len12), pt(edge12.y / len12))
  };
}

function assignCornersByRoleWithBasis(
  points: readonly WorldPoint[],
  center: WorldPoint,
  uAxis: WorldVector,
  vAxis: WorldVector
): Record<ResizeFrameCornerRole, WorldPoint> | null {
  if (points.length !== 4) {
    return null;
  }

  const projections = points.map((point) => ({
    point,
    u: dot(subtractPoints(point, center), uAxis),
    v: dot(subtractPoints(point, center), vAxis)
  }));
  const maxAbsU = Math.max(...projections.map((projection) => Math.abs(projection.u)));
  const maxAbsV = Math.max(...projections.map((projection) => Math.abs(projection.v)));
  if (maxAbsU <= EPSILON || maxAbsV <= EPSILON) {
    return null;
  }

  const usedIndices = new Set<number>();
  const pick = (targetU: number, targetV: number): WorldPoint | null => {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < projections.length; index += 1) {
      if (usedIndices.has(index)) {
        continue;
      }
      const projection = projections[index];
      if (!projection) {
        continue;
      }
      const normalizedU = projection.u / maxAbsU;
      const normalizedV = projection.v / maxAbsV;
      const distance =
        (normalizedU - targetU) * (normalizedU - targetU) +
        (normalizedV - targetV) * (normalizedV - targetV);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) {
      return null;
    }
    usedIndices.add(bestIndex);
    return projections[bestIndex]?.point ?? null;
  };

  const topLeft = pick(-1, 1);
  const topRight = pick(1, 1);
  const bottomRight = pick(1, -1);
  const bottomLeft = pick(-1, -1);
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) {
    return null;
  }
  return {
    "top-left": topLeft,
    "top-right": topRight,
    "bottom-right": bottomRight,
    "bottom-left": bottomLeft
  };
}

function pickCenterPathPointHandle(
  editHandles: readonly EditHandle[],
  sourceId: string,
  targetCenter?: WorldPoint
): EditHandle | null {
  const pathPointHandles = editHandles.filter(
    (handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "path-point"
  );
  const candidateHandles =
    pathPointHandles.length > 0
      ? pathPointHandles
      : editHandles.filter(
          (handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "node-position"
        );
  if (candidateHandles.length === 0) {
    return null;
  }
  if (!targetCenter) {
    return candidateHandles[0] ?? null;
  }

  let bestHandle = candidateHandles[0] ?? null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const handle of candidateHandles) {
    const dx = handle.world.x - targetCenter.x;
    const dy = handle.world.y - targetCenter.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestHandle = handle;
    }
  }
  return bestHandle;
}

function boundsFromPoints(points: readonly SvgPoint[]): SvgBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return svgBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

function rotateVector(
  vector: Pick<WorldPoint, "x" | "y"> | Pick<FrameLocalPoint, "x" | "y">,
  degrees: number
): WorldVector {
  if (Math.abs(degrees) <= EPSILON) {
    return worldVector(pt(vector.x), pt(vector.y));
  }
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return worldVector(
    pt(vector.x * cos - vector.y * sin),
    pt(vector.x * sin + vector.y * cos)
  );
}

function rotateAndTranslatePoint(localPoint: FrameLocalPoint, center: WorldPoint, degrees: number): WorldPoint {
  const rotated = rotateVector(localPoint, degrees);
  return worldPoint(pt(center.x + rotated.x), pt(center.y + rotated.y));
}

function subtractPoints(left: WorldPoint, right: WorldPoint): WorldVector {
  return worldVector(pt(left.x - right.x), pt(left.y - right.y));
}

function dot(left: WorldVector, right: WorldVector): number {
  return left.x * right.x + left.y * right.y;
}

function pointsApproximatelyEqual(left: WorldPoint, right: WorldPoint, epsilon = 1e-6): boolean {
  return Math.abs(left.x - right.x) <= epsilon && Math.abs(left.y - right.y) <= epsilon;
}

function estimateTextBlockWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  if (maxChars <= 0) {
    return 0;
  }
  return maxChars * fontSize * 0.7;
}

function matrixIsIdentity(matrix: WorldTransform): boolean {
  return (
    Math.abs(matrix.a - IDENTITY_MATRIX.a) <= EPSILON &&
    Math.abs(matrix.b - IDENTITY_MATRIX.b) <= EPSILON &&
    Math.abs(matrix.c - IDENTITY_MATRIX.c) <= EPSILON &&
    Math.abs(matrix.d - IDENTITY_MATRIX.d) <= EPSILON &&
    Math.abs(matrix.e - IDENTITY_MATRIX.e) <= EPSILON &&
    Math.abs(matrix.f - IDENTITY_MATRIX.f) <= EPSILON
  );
}

function transformsApproximatelyEqual(
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
