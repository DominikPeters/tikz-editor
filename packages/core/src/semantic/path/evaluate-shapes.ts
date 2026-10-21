import { worldPoint } from "../../coords/points.js";
import type { WorldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { ResolvedStyle, SceneElement, ScenePath } from "../types.js";
import type { StyleChainEntry } from "../style-chain.js";
import { applyMatrixToVector } from "../transform.js";
import {
  appendCircleSubpath,
  appendEllipseSubpath,
  ensurePathForSubpath,
  makeCircleElement,
  makeEllipseElement,
  markPathShapeHint
} from "./elements.js";
import type { FeatureMarkFn } from "./types.js";

export type EllipseGeometry = {
  rx: number;
  ry: number;
  rotation: number;
};

export type CircleOrEllipseGeometry =
  | {
      kind: "circle";
      radius: number;
    }
  | ({
      kind: "ellipse";
    } & EllipseGeometry);

export function transformCircleGeometry(
  radius: number,
  transform: { a: number; b: number; c: number; d: number }
): CircleOrEllipseGeometry {
  const transformed = transformEllipseGeometry(radius, radius, 0, transform);
  const tolerance = Math.max(transformed.rx, transformed.ry) * 1e-6;
  if (Math.abs(transformed.rx - transformed.ry) <= tolerance) {
    return { kind: "circle", radius: (transformed.rx + transformed.ry) / 2 };
  }
  return { kind: "ellipse", ...transformed };
}

export function transformEllipseGeometry(
  rx: number,
  ry: number,
  rotation: number,
  transform: { a: number; b: number; c: number; d: number }
): EllipseGeometry {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const axisX = worldPoint(pt(rx * cos), pt(rx * sin));
  const axisY = worldPoint(pt(-ry * sin), pt(ry * cos));
  const transformedAxisX = applyMatrixToVector(transform, axisX);
  const transformedAxisY = applyMatrixToVector(transform, axisY);

  const s11 = transformedAxisX.x * transformedAxisX.x + transformedAxisY.x * transformedAxisY.x;
  const s12 = transformedAxisX.x * transformedAxisX.y + transformedAxisY.x * transformedAxisY.y;
  const s22 = transformedAxisX.y * transformedAxisX.y + transformedAxisY.y * transformedAxisY.y;

  const traceHalf = (s11 + s22) / 2;
  const discriminant = Math.sqrt(Math.max(0, traceHalf * traceHalf - (s11 * s22 - s12 * s12)));
  const lambda1 = Math.max(0, traceHalf + discriminant);
  const lambda2 = Math.max(0, traceHalf - discriminant);
  const major = Math.sqrt(lambda1);
  const minor = Math.sqrt(lambda2);

  if (!Number.isFinite(major) || !Number.isFinite(minor) || major <= 1e-9 || minor <= 1e-9) {
    return { rx, ry, rotation };
  }

  const rotationRadians = Math.abs(lambda1 - lambda2) <= 1e-9 ? 0 : 0.5 * Math.atan2(2 * s12, s11 - s22);
  return {
    rx: major,
    ry: minor,
    rotation: normalizeDegrees((rotationRadians * 180) / Math.PI)
  };
}

function normalizeDegrees(degrees: number): number {
  let normalized = degrees % 360;
  if (normalized <= -180) {
    normalized += 360;
  } else if (normalized > 180) {
    normalized -= 360;
  }
  return Math.abs(normalized) <= 1e-9 ? 0 : normalized;
}

export function emitCircleOrEllipse(params: {
  geometry: CircleOrEllipseGeometry;
  center: WorldPoint;
  statementId: string;
  itemId: string;
  span: { from: number; to: number };
  style: ResolvedStyle;
  styleChain: StyleChainEntry[];
  shouldCompoundFilledSubpaths: boolean;
  activePath: ScenePath | null;
  geometryElements: SceneElement[];
  markFeature: FeatureMarkFn;
}): ScenePath | null {
  const {
    geometry,
    center,
    statementId,
    itemId,
    span,
    style,
    styleChain,
    shouldCompoundFilledSubpaths,
    activePath,
    geometryElements,
    markFeature
  } = params;

  if (geometry.kind === "circle") {
    markFeature("shape_circle", "supported");
    if (shouldCompoundFilledSubpaths) {
      const nextPath = ensurePathForSubpath(activePath, statementId, itemId, style, styleChain, span);
      markPathShapeHint(nextPath, "circle");
      appendCircleSubpath(nextPath.commands, center, geometry.radius);
      markFeature("svg_path", "supported");
      return nextPath;
    }
    markFeature("svg_circle", "supported");
    geometryElements.push(makeCircleElement(statementId, itemId, center, geometry.radius, style, styleChain, span));
    return activePath;
  }

  markFeature("shape_ellipse", "supported");
  if (shouldCompoundFilledSubpaths) {
    const nextPath = ensurePathForSubpath(activePath, statementId, itemId, style, styleChain, span);
    markPathShapeHint(nextPath, "ellipse");
    appendEllipseSubpath(nextPath.commands, center, geometry.rx, geometry.ry, geometry.rotation);
    markFeature("svg_path", "supported");
    return nextPath;
  }
  geometryElements.push(makeEllipseElement(statementId, itemId, center, geometry.rx, geometry.ry, style, styleChain, span, geometry.rotation));
  return activePath;
}
