import type { TikzFragment } from "./fragment.js";
import type { WorldPoint } from "../coords/points.js";
import type { SiteContext } from "../semantic/site-context.js";
import { isFrameLocalCoordinateEditHandle, type EditHandle } from "../semantic/types.js";
import { rewriteCoordinate } from "./rewrite.js";

/**
 * Frame reparameterization must not introduce ordinary drag-rounding jumps:
 * direct cartesian and polar coordinates are written at full precision.
 */
export function rewritePreciseFrameCoordinate(
  newWorld: WorldPoint,
  handle: EditHandle,
  source: string,
  bypassSnapping = false,
  context?: SiteContext
): TikzFragment | null {
  const precise = isFrameLocalCoordinateEditHandle(handle) && handle.rewriteMode === "direct" && !handle.insertion &&
    (handle.coordinateForm === "cartesian" || handle.coordinateForm === "polar");
  return rewriteCoordinate(newWorld, handle, source, bypassSnapping, context, precise ? { precision: "reparameterize" } : undefined);
}
