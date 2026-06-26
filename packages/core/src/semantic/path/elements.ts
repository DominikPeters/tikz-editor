import type { WorldTransform } from "../../coords/transforms.js";
import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint } from "../../coords/points.js";
import type { ResolvedStyle, SceneCircle, SceneElement, SceneEllipse, ScenePath, ScenePathCommand, ScenePathShapeHint } from "../types.js";
import { MAIN_SCENE_LAYER } from "../types.js";
import { applyMatrix, inverseMatrix } from "../transform.js";
import { appendPathPoint, roundClosedPathStartCorner } from "./segments.js";
import type { StyleChainEntry } from "../style-chain.js";
import { cloneStyleChain } from "../style-chain.js";

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

export function makePath(
  sourceId: string,
  itemId: string,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  span: { from: number; to: number },
  shapeHint?: ScenePathShapeHint | null
): ScenePath {
  return {
    kind: "Path",
    id: `scene-path:${sourceId}:${itemId}`,
    runtimeId: `scene-path:${sourceId}:${itemId}`,
    layer: MAIN_SCENE_LAYER,
    sourceRef: {
      sourceId,
      sourceSpan: span,
      sourceFingerprint: ""
    },
    shapeHint: shapeHint ?? null,
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    clipChain: [],
    commands: []
  };
}

export function ensurePathForSubpath(
  activePath: ScenePath | null,
  sourceId: string,
  itemId: string,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  span: { from: number; to: number },
  shapeHint?: ScenePathShapeHint | null
): ScenePath {
  if (activePath) {
    return activePath;
  }
  return makePath(sourceId, itemId, style, styleChain, span, shapeHint);
}

export function markPathShapeHint(path: ScenePath, hint: ScenePathShapeHint): void {
  if (path.shapeHint == null) {
    if (path.commands.every((command) => command.kind === "M")) {
      path.shapeHint = hint;
    }
    return;
  }
  if (path.shapeHint !== hint) {
    path.shapeHint = null;
  }
}

export function appendRectangleSubpath(
  commands: ScenePathCommand[],
  from: WorldPoint,
  to: WorldPoint,
  roundedCorners: number | null = null,
  transform?: WorldTransform
): void {
  const corners = resolveRectangleCorners(from, to, transform);
  const start = corners[0];
  const topRight = corners[1];
  const opposite = corners[2];
  const bottomLeft = corners[3];

  if (!roundedCorners || roundedCorners <= 0) {
    commands.push({ kind: "M", to: start });
    commands.push({ kind: "L", to: topRight });
    commands.push({ kind: "L", to: opposite });
    commands.push({ kind: "L", to: bottomLeft });
    commands.push({ kind: "Z" });
    return;
  }

  commands.push({ kind: "M", to: start });
  let previousSegmentRoundedCorners: number | null = null;
  previousSegmentRoundedCorners = appendPathPoint(
    commands,
    "--",
    start,
    topRight,
    previousSegmentRoundedCorners,
    roundedCorners
  ).nextRoundedCorners;
  previousSegmentRoundedCorners = appendPathPoint(
    commands,
    "--",
    topRight,
    opposite,
    previousSegmentRoundedCorners,
    roundedCorners
  ).nextRoundedCorners;
  previousSegmentRoundedCorners = appendPathPoint(
    commands,
    "--",
    opposite,
    bottomLeft,
    previousSegmentRoundedCorners,
    roundedCorners
  ).nextRoundedCorners;
  appendPathPoint(commands, "--", bottomLeft, start, previousSegmentRoundedCorners, roundedCorners);
  roundClosedPathStartCorner(commands, bottomLeft, start, roundedCorners);
  commands.push({ kind: "Z" });
}

export function appendCircleSubpath(commands: ScenePathCommand[], center: WorldPoint, radius: number): void {
  appendEllipseSubpath(commands, center, radius, radius, 0);
}

export function appendEllipseSubpath(commands: ScenePathCommand[], center: WorldPoint, rx: number, ry: number, rotation: number): void {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const axis = wp(rx * cos, rx * sin);
  const start = wp(center.x + axis.x, center.y + axis.y);
  const opposite = wp(center.x - axis.x, center.y - axis.y);

  commands.push({ kind: "M", to: start });
  commands.push({
    kind: "A",
    rx,
    ry,
    xAxisRotation: rotation,
    largeArc: false,
    sweep: true,
    to: opposite
  });
  commands.push({
    kind: "A",
    rx,
    ry,
    xAxisRotation: rotation,
    largeArc: false,
    sweep: true,
    to: start
  });
  commands.push({ kind: "Z" });
}

export function hasDrawablePathSegments(path: ScenePath): boolean {
  return path.commands.some((command) => command.kind === "L" || command.kind === "C" || command.kind === "A");
}

export function dropUndrawnActivePath(path: ScenePath | null): ScenePath | null {
  if (!path) {
    return null;
  }
  return hasDrawablePathSegments(path) ? path : null;
}

export function flushDrawableActivePath(elements: SceneElement[], path: ScenePath | null): ScenePath | null {
  const drawable = dropUndrawnActivePath(path);
  if (drawable) {
    elements.push(drawable);
  }
  return null;
}

export function makeRectangleElement(
  sourceId: string,
  itemId: string,
  from: WorldPoint,
  to: WorldPoint,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  span: { from: number; to: number },
  roundedCorners: number | null = style.roundedCorners,
  transform?: WorldTransform
): ScenePath {
  const commands: ScenePathCommand[] = [];
  appendRectangleSubpath(commands, from, to, roundedCorners, transform);

  return {
    kind: "Path",
    id: `scene-rectangle:${sourceId}:${itemId}`,
    runtimeId: `scene-rectangle:${sourceId}:${itemId}`,
    layer: MAIN_SCENE_LAYER,
    sourceRef: {
      sourceId,
      sourceSpan: span,
      sourceFingerprint: ""
    },
    shapeHint: "rectangle",
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    clipChain: [],
    commands
  };
}

function resolveRectangleCorners(from: WorldPoint, to: WorldPoint, transform?: WorldTransform): [WorldPoint, WorldPoint, WorldPoint, WorldPoint] {
  if (!transform) {
    return [from, wp(to.x, from.y), to, wp(from.x, to.y)];
  }

  const localFrom = applyInverseMatrix(transform, from);
  const localTo = applyInverseMatrix(transform, to);
  if (!localFrom || !localTo) {
    return [from, wp(to.x, from.y), to, wp(from.x, to.y)];
  }

  const localTopRight = wp(localTo.x, localFrom.y);
  const localBottomLeft = wp(localFrom.x, localTo.y);
  return [
    applyMatrix(transform, localFrom),
    applyMatrix(transform, localTopRight),
    applyMatrix(transform, localTo),
    applyMatrix(transform, localBottomLeft)
  ];
}

function applyInverseMatrix(matrix: WorldTransform, point: WorldPoint): WorldPoint | null {
  const inv = inverseMatrix(matrix);
  if (!inv) {
    return null;
  }
  return applyMatrix(inv, point);
}

export function makeCircleElement(
  sourceId: string,
  center: WorldPoint,
  radius: number,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  span: { from: number; to: number }
): SceneCircle {
  return {
    kind: "Circle",
    id: `scene-circle:${sourceId}:${span.from}`,
    runtimeId: `scene-circle:${sourceId}:${span.from}`,
    layer: MAIN_SCENE_LAYER,
    sourceRef: {
      sourceId,
      sourceSpan: span,
      sourceFingerprint: ""
    },
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    clipChain: [],
    center,
    radius
  };
}

export function makeEllipseElement(
  sourceId: string,
  center: WorldPoint,
  rx: number,
  ry: number,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  span: { from: number; to: number },
  rotation = 0
): SceneEllipse {
  return {
    kind: "Ellipse",
    id: `scene-ellipse:${sourceId}:${span.from}`,
    runtimeId: `scene-ellipse:${sourceId}:${span.from}`,
    layer: MAIN_SCENE_LAYER,
    sourceRef: {
      sourceId,
      sourceSpan: span,
      sourceFingerprint: ""
    },
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    clipChain: [],
    center,
    rx,
    ry,
    rotation
  };
}
