import { pt } from "../../coords/scalars.js";
import { worldPoint } from "../../coords/points.js";
import type { WorldPoint } from "../../coords/points.js";
import type { EditHandlePositioningContext } from "../../semantic/types.js";
import { CM_PER_PT, formatNumber, type NumberFormatOptions } from "../format.js";

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
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

function directionSign(value: number): -1 | 0 | 1 {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
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

function hasNonNegativeDistances(direction: string, shift: WorldPoint): boolean {
  const shiftXcm = shift.x * CM_PER_PT;
  const shiftYcm = shift.y * CM_PER_PT;
  const scalar = signedScalarForDirection(direction, shiftXcm, shiftYcm);
  if (scalar !== null) return scalar >= -1e-9;
  const pair = signedPairForDirection(direction, shiftXcm, shiftYcm);
  return pair !== null && pair.vertical >= -1e-9 && pair.horizontal >= -1e-9;
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

/**
 * The positioning option (`right=1.2cm of A`, `below left={1cm and 2cm} of A`)
 * that puts the node where `newWorld` is, measured against the node it is
 * positioned from. Distances are canvas lengths, which PGF does not
 * transform, so they carry no frame. The direction follows the node's
 * centers, snapped to a cardinal one unless `bypassSnapping`.
 */
export function writePositioning(
  newWorld: WorldPoint,
  ctx: EditHandlePositioningContext,
  bypassSnapping = false
): string | null {
  const formatOptions: NumberFormatOptions | undefined = undefined;
  const cardinalSnapRatio = bypassSnapping ? 0 : CARDINAL_SNAP_RATIO;
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
      x: absCx < 1e-6 ? currentSigns.x : directionSign(c2cXcm),
      y: absCy < 1e-6 ? currentSigns.y : directionSign(c2cYcm)
    };
    const horizontalDominant = absCy <= Math.max(absCx * cardinalSnapRatio, 1e-6);
    const verticalDominant = absCx <= Math.max(absCy * cardinalSnapRatio, 1e-6);
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
    // Every other direction is a fallback: the anchors of a rotated node can
    // ask for a diagonal the centers alone do not suggest.
    for (const other of Object.keys(POSITIONING_DIRECTION_SIGNS)) {
      if (!candidateDirections.includes(other)) candidateDirections.push(other);
    }

    const accepted: Array<{ direction: string; shift: WorldPoint }> = [];
    for (const candidateDirection of candidateDirections) {
      const candidateShift = computeShift(candidateDirection);
      const shiftXcm = candidateShift.x * CM_PER_PT;
      const shiftYcm = candidateShift.y * CM_PER_PT;
      const absShiftXcm = Math.abs(shiftXcm);
      const absShiftYcm = Math.abs(shiftYcm);
      const expected = POSITIONING_DIRECTION_SIGNS[candidateDirection];
      if (expected === undefined) throw new RangeError(`Unknown positioning direction ${candidateDirection}`);

      if (expected.x === 0 || expected.y === 0) {
        const axial = Math.max(absShiftXcm, absShiftYcm);
        const orthogonal = expected.x === 0 ? absShiftXcm : absShiftYcm;
        const maxOrthogonal = Math.max(axial * cardinalSnapRatio, 1e-6);
        if (orthogonal > maxOrthogonal) {
          continue;
        }
      }
      accepted.push({ direction: candidateDirection, shift: candidateShift });
    }
    // The first direction whose distances are not negative; else the first the centers suggest.
    const chosen = accepted.find((candidate) => hasNonNegativeDistances(candidate.direction, candidate.shift)) ?? accepted[0];
    if (chosen) {
      direction = chosen.direction;
      shift = chosen.shift;
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
