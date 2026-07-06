import {
  isCoordinateEditHandle,
  isFrameLocalCoordinateEditHandle,
  isRelativeCoordinateEditHandle,
  type EditHandle,
  type EditHandlePositioningContext
} from "../semantic/types.js";
import { pt } from "../coords/scalars.js";
import { worldPoint, worldVector } from "../coords/points.js";
import type { WorldPoint } from "../coords/points.js";
import { ptToCm } from "../coords/source.js";
import { worldToLocal, worldDeltaToLocalDelta, localToSourceUnits } from "./coords.js";
import { CM_PER_PT, formatNumber, type NumberFormatOptions } from "./format.js";
import { formatCoordinate, formatPolarCoordinate } from "./style.js";

/**
 * Compute a replacement source string for moving a handle to a new world position.
 * Returns null if the rewrite cannot be performed.
 */
export function rewriteCoordinate(
  newWorld: WorldPoint,
  handle: EditHandle,
  source: string
): string | null {
  if (handle.rewriteMode === "positioning") {
    return rewritePositioning(newWorld, handle);
  }

  if (handle.rewriteMode === "unsupported") {
    return rewriteUnsupportedCoordinate(newWorld, handle, source);
  }

  if (handle.rewriteMode === "delta") {
    return rewriteDelta(newWorld, handle, source);
  }

  switch (handle.coordinateForm) {
    case "cartesian":
      return rewriteCartesian(newWorld, handle, source);
    case "polar":
      return rewritePolar(newWorld, handle, source);
    case "xyz":
    case "calc":
    case "explicit":
    case "named":
    case "unknown":
      return null;
  }
}

export function supportsUnsupportedCoordinateDetach(handle: EditHandle): boolean {
  return handle.kind === "path-point" && handle.coordinateForm === "named";
}

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

function rewriteUnsupportedCoordinate(
  newWorld: WorldPoint,
  handle: EditHandle,
  source: string
): string | null {
  if (!supportsUnsupportedCoordinateDetach(handle)) {
    return null;
  }

  if (isFrameLocalCoordinateEditHandle(handle)) {
    return rewriteCartesian(newWorld, {
      ...handle,
      coordinateForm: "cartesian"
    }, source);
  }

  if (!isCoordinateEditHandle(handle)) {
    return null;
  }

  const cmPoint = {
    x: ptToCm(newWorld.x),
    y: ptToCm(newWorld.y)
  };
  const oldRaw = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  return formatCoordinate(oldRaw, formatNumber(cmPoint.x), formatNumber(cmPoint.y));
}

function rewriteCartesian(
  newWorld: WorldPoint,
  handle: EditHandle,
  source: string
): string | null {
  if (!isFrameLocalCoordinateEditHandle(handle)) {
    return null;
  }
  const local = worldToLocal(newWorld, handle.frame);
  if (!local) {
    return null;
  }
  const cm = localToSourceUnits(local);
  const oldRaw = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  const coordinate = formatCoordinate(oldRaw, formatNumber(cm.x), formatNumber(cm.y));
  return applyInsertionSyntax(source, handle, coordinate);
}

function rewritePolar(
  newWorld: WorldPoint,
  handle: EditHandle,
  source: string
): string | null {
  if (!isFrameLocalCoordinateEditHandle(handle)) {
    return null;
  }
  const local = worldToLocal(newWorld, handle.frame);
  if (!local) {
    return null;
  }
  const cm = localToSourceUnits(local);
  const { angleDeg, radius } = toPolar(cm);
  const oldRaw = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  const coordinate = formatPolarCoordinate(oldRaw, formatNumber(angleDeg), formatNumber(radius));
  return applyInsertionSyntax(source, handle, coordinate);
}

function rewriteDelta(
  newWorld: WorldPoint,
  handle: EditHandle,
  source: string
): string | null {
  if (!isRelativeCoordinateEditHandle(handle)) {
    return null;
  }
  const base = handle.relativeBase;
  if (!base) {
    return null;
  }
  const delta = worldVector(pt(newWorld.x - base.x), pt(newWorld.y - base.y));
  const localDelta = worldDeltaToLocalDelta(delta, handle.frame);
  if (!localDelta) {
    return null;
  }
  const cm = localToSourceUnits(localDelta);
  const oldRaw = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  if (handle.coordinateForm === "polar") {
    const { angleDeg, radius } = toPolar(cm);
    const coordinate = formatPolarCoordinate(oldRaw, formatNumber(angleDeg), formatNumber(radius));
    return applyInsertionSyntax(source, handle, coordinate);
  }
  if (handle.coordinateForm === "xyz") {
    return null;
  }
  const coordinate = formatCoordinate(oldRaw, formatNumber(cm.x), formatNumber(cm.y));
  return applyInsertionSyntax(source, handle, coordinate);
}

function applyInsertionSyntax(source: string, handle: EditHandle, coordinate: string): string {
  if (!handle.insertion) {
    return coordinate;
  }

  if (handle.insertion.kind === "node-inline-at") {
    const offset = handle.sourceRef.sourceSpan.from;
    const previousChar = offset > 0 ? source[offset - 1] : "";
    const nextChar = offset < source.length ? source[offset] : "";
    const leading = previousChar.length > 0 && !/\s/.test(previousChar) ? " " : "";
    const trailing = nextChar.length > 0 && !/\s/.test(nextChar) && nextChar !== ";" ? " " : "";
    return `${leading}at ${coordinate}${trailing}`;
  }

  return coordinate;
}

function toPolar(point: { x: number; y: number }): { angleDeg: number; radius: number } {
  const radius = Math.sqrt(point.x * point.x + point.y * point.y);
  let angleDeg = (Math.atan2(point.y, point.x) * 180) / Math.PI;
  if (angleDeg < 0) {
    angleDeg += 360;
  }
  return { angleDeg, radius };
}

/** Snap threshold: if one component is less than this fraction of the other, use a cardinal direction. */
const CARDINAL_SNAP_RATIO = 0.25;

const POSITIONING_DIRECTION_SIGNS: Record<string, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  above: { x: 0, y: 1 },
  below: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  "above left": { x: -1, y: 1 },
  "above right": { x: 1, y: 1 },
  "below left": { x: -1, y: -1 },
  "below right": { x: 1, y: -1 }
};

/**
 * For a given positioning direction, return the anchor offsets (from center) for
 * target and current nodes, using the stored half-dimensions.
 * Returns { targetAnchor, currentAnchor } as offsets from each node's center.
 */
function anchorOffsetsForDirection(
  direction: string,
  targetHW: number,
  targetHH: number,
  currentHW: number,
  currentHH: number
): { targetAnchor: WorldPoint; currentAnchor: WorldPoint } {
  // TikZ positioning: target anchor is the "outward" side of A toward B,
  // current anchor is the "inward" side of B toward A.
  const dirMeta: Record<string, { tx: number; ty: number; cx: number; cy: number }> = {
    "right":       { tx:  1, ty:  0, cx: -1, cy:  0 },
    "left":        { tx: -1, ty:  0, cx:  1, cy:  0 },
    "above":       { tx:  0, ty:  1, cx:  0, cy: -1 },
    "below":       { tx:  0, ty: -1, cx:  0, cy:  1 },
    "above right": { tx:  1, ty:  1, cx: -1, cy: -1 },
    "above left":  { tx: -1, ty:  1, cx:  1, cy: -1 },
    "below right": { tx:  1, ty: -1, cx: -1, cy:  1 },
    "below left":  { tx: -1, ty: -1, cx:  1, cy:  1 }
  };
  const m = dirMeta[direction];
  if (!m) {
    return { targetAnchor: wp(0, 0), currentAnchor: wp(0, 0) };
  }
  return {
    targetAnchor: wp(m.tx * targetHW, m.ty * targetHH),
    currentAnchor: wp(m.cx * currentHW, m.cy * currentHH)
  };
}

function cardinalDirectionFromSigns(signs: { x: -1 | 0 | 1; y: -1 | 0 | 1 }): string | null {
  if (signs.x > 0) {
    return "right";
  }
  if (signs.x < 0) {
    return "left";
  }
  if (signs.y > 0) {
    return "above";
  }
  if (signs.y < 0) {
    return "below";
  }
  return null;
}

function diagonalDirectionFromSigns(signs: { x: -1 | 0 | 1; y: -1 | 0 | 1 }): string | null {
  if (signs.x > 0 && signs.y > 0) {
    return "above right";
  }
  if (signs.x < 0 && signs.y > 0) {
    return "above left";
  }
  if (signs.x > 0 && signs.y < 0) {
    return "below right";
  }
  if (signs.x < 0 && signs.y < 0) {
    return "below left";
  }
  return null;
}

function signedScalarForDirection(direction: string, shiftXcm: number, shiftYcm: number): number | null {
  const signs = POSITIONING_DIRECTION_SIGNS[direction];
  if (!signs) {
    return null;
  }
  if (signs.x !== 0 && signs.y === 0) {
    return shiftXcm * signs.x;
  }
  if (signs.y !== 0 && signs.x === 0) {
    return shiftYcm * signs.y;
  }
  return null;
}

function signedPairForDirection(
  direction: string,
  shiftXcm: number,
  shiftYcm: number
): { vertical: number; horizontal: number } | null {
  const signs = POSITIONING_DIRECTION_SIGNS[direction];
  if (!signs || signs.x === 0 || signs.y === 0) {
    return null;
  }
  return {
    vertical: shiftYcm * signs.y,
    horizontal: shiftXcm * signs.x
  };
}

function rewritePositioning(
  newWorld: WorldPoint,
  handle: EditHandle
): string | null {
  if (handle.handleType !== "node-positioning") {
    return null;
  }
  return rewritePositioningFromContext(newWorld, handle.positioningContext);
}

export function rewritePositioningFromContext(
  newWorld: WorldPoint,
  ctx: EditHandlePositioningContext,
  formatOptions?: NumberFormatOptions
): string | null {
  const centerDeltaWorld = wp(newWorld.x - ctx.targetCenter.x, newWorld.y - ctx.targetCenter.y);
  const c2cXcm = centerDeltaWorld.x * CM_PER_PT;
  const c2cYcm = centerDeltaWorld.y * CM_PER_PT;
  const absCx = Math.abs(c2cXcm);
  const absCy = Math.abs(c2cYcm);
  const maxComp = Math.max(absCx, absCy);
  const currentSigns = POSITIONING_DIRECTION_SIGNS[ctx.direction] ?? { x: 1, y: 0 };

  const computeShift = (direction: string): WorldPoint => {
    const offsets = ctx.anchorOffsetsByDirection?.[direction]
      ?? anchorOffsetsForDirection(direction, ctx.targetAnchorHW, ctx.targetAnchorHH, ctx.currentAnchorHW, ctx.currentAnchorHH);
    return wp(
      centerDeltaWorld.x - offsets.targetAnchor.x + offsets.currentAnchor.x,
      centerDeltaWorld.y - offsets.targetAnchor.y + offsets.currentAnchor.y
    );
  };

  let direction = ctx.direction;
  let shift = computeShift(direction);

  if (maxComp >= 1e-6) {
    const resolvedSigns = {
      x: (absCx < 1e-6 ? currentSigns.x : Math.sign(c2cXcm)) as -1 | 0 | 1,
      y: (absCy < 1e-6 ? currentSigns.y : Math.sign(c2cYcm)) as -1 | 0 | 1
    };
    const horizontalDominant = absCy <= Math.max(absCx * CARDINAL_SNAP_RATIO, 1e-6);
    const verticalDominant = absCx <= Math.max(absCy * CARDINAL_SNAP_RATIO, 1e-6);
    const candidateDirections: string[] = [];

    if (horizontalDominant) {
      const cardinal = cardinalDirectionFromSigns({ x: resolvedSigns.x, y: 0 });
      if (cardinal) {
        candidateDirections.push(cardinal);
      }
    }
    if (verticalDominant) {
      const cardinal = cardinalDirectionFromSigns({ x: 0, y: resolvedSigns.y });
      if (cardinal) {
        candidateDirections.push(cardinal);
      }
    }

    const diagonalSigns = {
      x: (resolvedSigns.x === 0 ? (currentSigns.x === 0 ? 1 : currentSigns.x) : resolvedSigns.x) as -1 | 0 | 1,
      y: (resolvedSigns.y === 0 ? (currentSigns.y === 0 ? 1 : currentSigns.y) : resolvedSigns.y) as -1 | 0 | 1
    };
    const diagonal = diagonalDirectionFromSigns(diagonalSigns);
    if (diagonal) {
      candidateDirections.push(diagonal);
    }

    if (!candidateDirections.includes(ctx.direction)) {
      candidateDirections.push(ctx.direction);
    }

    for (const candidateDirection of candidateDirections) {
      const candidateShift = computeShift(candidateDirection);
      const shiftXcm = candidateShift.x * CM_PER_PT;
      const shiftYcm = candidateShift.y * CM_PER_PT;
      const absShiftXcm = Math.abs(shiftXcm);
      const absShiftYcm = Math.abs(shiftYcm);
      const expected = POSITIONING_DIRECTION_SIGNS[candidateDirection];

      if (expected.x === 0 || expected.y === 0) {
        const axial = Math.max(absShiftXcm, absShiftYcm);
        const orthogonal = expected.x === 0 ? absShiftXcm : absShiftYcm;
        const maxOrthogonal = Math.max(axial * CARDINAL_SNAP_RATIO, 1e-6);
        if (orthogonal > maxOrthogonal) {
          continue;
        }
      }

      direction = candidateDirection;
      shift = candidateShift;
      break;
    }
  }

  const shiftXcm = shift.x * CM_PER_PT;
  const shiftYcm = shift.y * CM_PER_PT;

  if (direction === "left" || direction === "right") {
    const scalar = signedScalarForDirection(direction, shiftXcm, shiftYcm);
    if (scalar == null) {
      return null;
    }
    return `${direction}=${formatNumber(scalar, formatOptions)}cm of ${ctx.targetNodeName}`;
  }
  if (direction === "above" || direction === "below") {
    const scalar = signedScalarForDirection(direction, shiftXcm, shiftYcm);
    if (scalar == null) {
      return null;
    }
    return `${direction}=${formatNumber(scalar, formatOptions)}cm of ${ctx.targetNodeName}`;
  }

  const pair = signedPairForDirection(direction, shiftXcm, shiftYcm);
  if (!pair) {
    return null;
  }

  return `${direction}={${formatNumber(pair.vertical, formatOptions)}cm and ${formatNumber(
    pair.horizontal,
    formatOptions
  )}cm} of ${ctx.targetNodeName}`;
}
