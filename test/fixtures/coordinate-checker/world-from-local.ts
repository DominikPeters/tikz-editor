// expect: F5
// A world point built from a frame-local point's components.
import { worldPoint, type FrameLocalPoint } from "../../../packages/core/src/coords/points.js";

export function asWorld(local: FrameLocalPoint) {
  return worldPoint(local.x, local.y);
}
