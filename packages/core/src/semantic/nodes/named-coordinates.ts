import { currentFrame } from "../context.js";
import { parseCoordinate } from "../../domains/coordinates/parse.js";
import { pt } from "../../coords/scalars.js";
import type { CoordinateItem, PathItem } from "../../ast/types.js";
import {
  readNamedNodeGeometry,
  type NamedNodeGeometry,
  type SemanticContext
} from "../context.js";
import { worldPoint as makeWorldPoint, worldVector as makeWorldVector, type WorldPoint, type WorldVector } from "../../coords/points.js";
import { intersectRayWithPolygon } from "./shape-geometry.js";
import { applyMatrixToVector, inverseMatrix } from "../transform.js";

function worldPoint(x: number, y: number): WorldPoint {
  return makeWorldPoint(pt(x), pt(y));
}

function worldVector(x: number, y: number): WorldVector {
  return makeWorldVector(pt(x), pt(y));
}

export function collectScopedNodeNames(name: string | undefined, aliases: string[] | undefined, context: SemanticContext): string[] {
  const names = [name, ...(aliases ?? [])].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  const scoped = names.map((entry) => applyNameScope(entry, context));
  return Array.from(new Set(scoped));
}

export function maybeResolveTrailingCoordinateFromNodeName(name: string | undefined): string | null {
  if (!name) {
    return null;
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const asCoordinate = `(${trimmed})`;
  const parsed = parseCoordinate(asCoordinate);
  if (parsed.form === "named" || parsed.form === "unknown") {
    return null;
  }
  return asCoordinate;
}

export function shouldCaptureStandaloneNodeNameCoordinate(items: PathItem[], coordinateIndex: number): boolean {
  for (let index = 0; index < coordinateIndex; index += 1) {
    if (items[index]?.kind === "Node") {
      return false;
    }
  }

  for (let index = coordinateIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind === "PathComment") {
      continue;
    }
    if (item.kind === "PathKeyword" && item.keyword === "at") {
      return false;
    }
    break;
  }

  return true;
}

export function applyNameScope(name: string, context: SemanticContext): string {
  const frame = currentFrame(context);
  const prefix = frame.namePrefix;
  const suffix = frame.nameSuffix;
  if (prefix.length === 0 && suffix.length === 0) {
    return name.trim();
  }

  const trimmed = name.trim();
  const dot = trimmed.indexOf(".");
  if (dot === -1) {
    return `${prefix}${trimmed}${suffix}`;
  }

  const base = trimmed.slice(0, dot);
  const anchor = trimmed.slice(dot);
  return `${prefix}${base}${suffix}${anchor}`;
}

export function maybeResolveNamedCoordinateBorderPoint(
  coordinate: Pick<CoordinateItem, "form" | "x">,
  fallbackWorldPoint: WorldPoint,
  fromWorldPoint: WorldPoint | null,
  context: SemanticContext
): WorldPoint {
  if (coordinate.form !== "named") {
    return fallbackWorldPoint;
  }
  return maybeResolveNamedNodeBorderWorldPoint(coordinate.x, fallbackWorldPoint, fromWorldPoint, context);
}

export function maybeResolveNamedCoordinateBorderPointFromRaw(
  rawCoordinate: string,
  fallbackWorldPoint: WorldPoint,
  fromWorldPoint: WorldPoint | null,
  context: SemanticContext
): WorldPoint {
  const parsed = parseCoordinate(rawCoordinate);
  if (parsed.form !== "named") {
    return fallbackWorldPoint;
  }
  return maybeResolveNamedNodeBorderWorldPoint(parsed.x, fallbackWorldPoint, fromWorldPoint, context);
}

export function maybeResolveNamedCoordinateBorderPointFromRawAlongAngle(
  rawCoordinate: string,
  fallbackWorldPoint: WorldPoint,
  angleDegrees: number,
  context: SemanticContext
): WorldPoint {
  const parsed = parseCoordinate(rawCoordinate);
  if (parsed.form !== "named") {
    return fallbackWorldPoint;
  }
  return maybeResolveNamedNodeBorderWorldPointAlongAngle(parsed.x, fallbackWorldPoint, angleDegrees, context);
}

function maybeResolveNamedNodeBorderWorldPoint(
  rawName: string,
  fallbackWorldPoint: WorldPoint,
  fromWorldPoint: WorldPoint | null,
  context: SemanticContext
): WorldPoint {
  if (!fromWorldPoint) {
    return fallbackWorldPoint;
  }

  const trimmed = rawName.trim();
  if (trimmed.length === 0 || trimmed.includes(".")) {
    return fallbackWorldPoint;
  }

  const geometry = resolveNamedNodeGeometry(trimmed, context);
  if (!geometry || geometry.shape === "coordinate") {
    return fallbackWorldPoint;
  }

  const borderWorldPoint = intersectNodeBorder(geometry, fromWorldPoint);
  return borderWorldPoint ?? fallbackWorldPoint;
}

function maybeResolveNamedNodeBorderWorldPointAlongAngle(
  rawName: string,
  fallbackWorldPoint: WorldPoint,
  angleDegrees: number,
  context: SemanticContext
): WorldPoint {
  const trimmed = rawName.trim();
  if (trimmed.length === 0 || trimmed.includes(".")) {
    return fallbackWorldPoint;
  }

  const geometry = resolveNamedNodeGeometry(trimmed, context);
  if (!geometry || geometry.shape === "coordinate") {
    return fallbackWorldPoint;
  }

  const radians = (angleDegrees * Math.PI) / 180;
  const probeWorldPoint = worldPoint(
    geometry.center.x + Math.cos(radians),
    geometry.center.y + Math.sin(radians)
  );
  const borderWorldPoint = intersectNodeBorder(geometry, probeWorldPoint);
  return borderWorldPoint ?? fallbackWorldPoint;
}

function resolveNamedNodeGeometry(rawName: string, context: SemanticContext): NamedNodeGeometry | null {
  const scoped = applyNameScope(rawName, context);
  const candidates = scoped === rawName ? [rawName] : [scoped, rawName];
  for (const candidate of candidates) {
    const geometry = readNamedNodeGeometry(context, candidate);
    if (geometry) {
      return geometry;
    }
  }
  return null;
}

function intersectNodeBorder(
  geometry: NamedNodeGeometry,
  fromWorldPoint: WorldPoint
): WorldPoint | null {
  const dx = fromWorldPoint.x - geometry.center.x;
  const dy = fromWorldPoint.y - geometry.center.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return null;
  }
  const direction = worldVector(dx, dy);

  if (geometry.anchorPolygon && geometry.anchorPolygon.length >= 3) {
    const border = intersectRayWithPolygon(worldPoint(0, 0), direction, geometry.anchorPolygon);
    if (!border) {
      return null;
    }
    return worldPoint(geometry.center.x + border.x, geometry.center.y + border.y);
  }

  if (geometry.shape === "circle") {
    const transform = geometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return direction;
      const inverse = inverseMatrix(transform);
      if (!inverse) return direction;
      return applyMatrixToVector(inverse, direction);
    })();
    const localLen = Math.hypot(localDirection.x, localDirection.y);
    if (!Number.isFinite(localLen) || localLen <= 1e-9) {
      return null;
    }
    const radius = geometry.anchorRadius;
    if (!Number.isFinite(radius) || radius <= 1e-9) {
      return null;
    }
    const scale = radius / localLen;
    const localWorldPoint = worldVector(localDirection.x * scale, localDirection.y * scale);
    if (!transform) {
      return worldPoint(geometry.center.x + localWorldPoint.x, geometry.center.y + localWorldPoint.y);
    }
    const mapped = applyMatrixToVector(transform, localWorldPoint);
    return worldPoint(geometry.center.x + mapped.x, geometry.center.y + mapped.y);
  }

  if (geometry.shape === "rectangle") {
    const transform = geometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return direction;
      const inverse = inverseMatrix(transform);
      if (!inverse) return direction;
      return applyMatrixToVector(inverse, direction);
    })();
    const hw = geometry.anchorHalfWidth;
    const hh = geometry.anchorHalfHeight;
    if (!Number.isFinite(hw) || !Number.isFinite(hh) || hw <= 1e-9 || hh <= 1e-9) {
      return null;
    }
    const scale = 1 / Math.max(Math.abs(localDirection.x) / hw, Math.abs(localDirection.y) / hh);
    const localWorldPoint = worldVector(localDirection.x * scale, localDirection.y * scale);
    if (!transform) {
      return worldPoint(geometry.center.x + localWorldPoint.x, geometry.center.y + localWorldPoint.y);
    }
    const mapped = applyMatrixToVector(transform, localWorldPoint);
    return worldPoint(geometry.center.x + mapped.x, geometry.center.y + mapped.y);
  }

  if (geometry.shape === "ellipse") {
    const transform = geometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return direction;
      const inverse = inverseMatrix(transform);
      if (!inverse) return direction;
      return applyMatrixToVector(inverse, direction);
    })();
    const rx = geometry.anchorHalfWidth;
    const ry = geometry.anchorHalfHeight;
    if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 1e-9 || ry <= 1e-9) {
      return null;
    }
    const scale = 1 / Math.sqrt((localDirection.x * localDirection.x) / (rx * rx) + (localDirection.y * localDirection.y) / (ry * ry));
    if (!Number.isFinite(scale)) {
      return null;
    }
    const localWorldPoint = worldVector(localDirection.x * scale, localDirection.y * scale);
    if (!transform) {
      return worldPoint(geometry.center.x + localWorldPoint.x, geometry.center.y + localWorldPoint.y);
    }
    const mapped = applyMatrixToVector(transform, localWorldPoint);
    return worldPoint(geometry.center.x + mapped.x, geometry.center.y + mapped.y);
  }

  return null;
}
