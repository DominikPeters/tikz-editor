import { worldPoint, worldVector, type WorldPoint, type WorldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { NamedNodeGeometry } from "../context.js";
import { applyMatrixToVector, inverseMatrix } from "../transform.js";
import { intersectRayWithPolygon } from "./shape-geometry.js";

/**
 * The coordinate frame a border direction is given in.
 *
 * - `world`: `\pgfpointshapeborder{node}{point}`. The point is mapped through the inverse node
 *   transform into the shape's own frame, so the result lies on the world-space ray from the centre.
 * - `local`: numeric anchors such as `(node.30)`, `label=30:x` and `pin=30:x`. PGF hands the polar point
 *   to the shape's `\anchorborder` untransformed and then applies the node transform to the result,
 *   so the angle is measured in the shape's own (possibly rotated, scaled or slanted) frame.
 */
export type NodeBorderDirectionSpace = "world" | "local";

/**
 * The single border-intersection routine (PGF's `\anchorborder`). Circle, rectangle and ellipse are exact
 * in the shape frame; every other shape intersects the ray with its stored (already transformed) polygon.
 * Returns null when the geometry offers no border or the direction is degenerate.
 */
export function intersectNodeShapeBorder(
  geometry: NamedNodeGeometry,
  direction: Pick<WorldVector, "x" | "y">,
  space: NodeBorderDirectionSpace
): WorldPoint | null {
  const length = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(length) || length <= 1e-9 || geometry.shape === "coordinate") {
    return null;
  }

  const transform = geometry.anchorTransform;
  const inverse = transform ? inverseMatrix(transform) : null;
  if (transform && !inverse) {
    // A singular node transform collapses the shape onto its centre.
    return geometry.center;
  }
  const mapping = transform && inverse ? transform : undefined;
  const directionVector = worldVector(pt(direction.x), pt(direction.y));
  const localDirection =
    space === "local" ? directionVector : inverse ? applyMatrixToVector(inverse, directionVector) : directionVector;
  const worldDirection =
    space === "world" ? directionVector : mapping ? applyMatrixToVector(mapping, directionVector) : directionVector;
  const localLength = Math.hypot(localDirection.x, localDirection.y);
  if (!Number.isFinite(localLength) || localLength <= 1e-9) {
    return null;
  }

  const fromLocal = (point: { x: number; y: number }): WorldPoint => {
    const mapped = mapping ? applyMatrixToVector(mapping, worldVector(pt(point.x), pt(point.y))) : point;
    return worldPoint(pt(geometry.center.x + mapped.x), pt(geometry.center.y + mapped.y));
  };

  if (geometry.shape === "circle") {
    const radius = geometry.anchorRadius;
    if (!Number.isFinite(radius) || radius <= 1e-9) {
      return null;
    }
    return fromLocal({ x: (localDirection.x / localLength) * radius, y: (localDirection.y / localLength) * radius });
  }

  if (geometry.shape === "rectangle") {
    const hw = geometry.anchorHalfWidth;
    const hh = geometry.anchorHalfHeight;
    if (!Number.isFinite(hw) || !Number.isFinite(hh) || hw <= 1e-9 || hh <= 1e-9) {
      return null;
    }
    const scale = 1 / Math.max(Math.abs(localDirection.x) / hw, Math.abs(localDirection.y) / hh);
    return fromLocal({ x: localDirection.x * scale, y: localDirection.y * scale });
  }

  if (geometry.shape === "ellipse") {
    const rx = geometry.anchorHalfWidth;
    const ry = geometry.anchorHalfHeight;
    if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 1e-9 || ry <= 1e-9) {
      return null;
    }
    const scale = 1 / Math.sqrt((localDirection.x * localDirection.x) / (rx * rx) + (localDirection.y * localDirection.y) / (ry * ry));
    if (!Number.isFinite(scale)) {
      return null;
    }
    return fromLocal({ x: localDirection.x * scale, y: localDirection.y * scale });
  }

  if (geometry.anchorPolygon && geometry.anchorPolygon.length >= 3) {
    const border = intersectRayWithPolygon(worldPoint(pt(0), pt(0)), worldDirection, geometry.anchorPolygon);
    if (border) {
      return worldPoint(pt(geometry.center.x + border.x), pt(geometry.center.y + border.y));
    }
  }

  return null;
}
