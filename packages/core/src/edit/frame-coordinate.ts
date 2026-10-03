import type { WorldPoint } from "../coords/points.js";
import { isFrameLocalCoordinateEditHandle, type EditHandle } from "../semantic/types.js";
import { localToSourceUnits, worldToLocal } from "./coords.js";
import { formatNumber } from "./format.js";
import { rewriteCoordinate } from "./rewrite.js";
import { formatCoordinate, formatPolarCoordinate } from "./style.js";

/** Frame reparameterization must not introduce ordinary drag-rounding jumps. */
export function rewritePreciseFrameCoordinate(
  newWorld: WorldPoint,
  handle: EditHandle,
  source: string,
  bypassSnapping = false
): string | null {
  if (!isFrameLocalCoordinateEditHandle(handle) || handle.rewriteMode !== "direct" || handle.insertion) {
    return rewriteCoordinate(newWorld, handle, source, bypassSnapping);
  }
  const local = worldToLocal(newWorld, handle.frame);
  if (!local) return null;
  const point = localToSourceUnits(local);
  const oldRaw = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  const fine = { fractionDigits: 6 };
  if (handle.coordinateForm === "cartesian") {
    return formatCoordinate(oldRaw, formatNumber(point.x, fine), formatNumber(point.y, fine), handle.sourceUnits);
  }
  if (handle.coordinateForm === "polar") {
    return formatPolarCoordinate(oldRaw, formatNumber(Math.atan2(point.y, point.x) * 180 / Math.PI, fine),
      formatNumber(Math.hypot(point.x, point.y), fine), handle.sourceUnits);
  }
  return rewriteCoordinate(newWorld, handle, source, bypassSnapping);
}
