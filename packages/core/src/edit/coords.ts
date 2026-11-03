import type { FrameLocalPoint, FrameLocalVector, WorldPoint, WorldVector } from "../coords/points.js";
import type { FrameTransform } from "../coords/transforms.js";
import { worldToFrameLocal, worldVectorToFrameLocal } from "../coords/frame.js";

/**
 * Convert a world-space position to local (pre-transform) coordinates.
 * Returns null if the transform is not invertible.
 */
export function worldToFrameLocalPoint(world: WorldPoint, transform: FrameTransform): FrameLocalPoint | null {
  return worldToFrameLocal(world, transform);
}

/**
 * Convert a world-space delta to a local-space delta (excludes translation).
 * Returns null if the transform is not invertible.
 */
export function worldVectorToFrameLocalPoint(delta: WorldVector, transform: FrameTransform): FrameLocalVector | null {
  return worldVectorToFrameLocal(delta, transform);
}

export const worldToLocal = worldToFrameLocalPoint;
export const worldDeltaToLocalDelta = worldVectorToFrameLocalPoint;
