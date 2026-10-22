// expect: F6
import { writeShiftPair } from "../../../packages/core/src/edit/writer/authored-values.js";
import type { WorldPoint } from "../../../packages/core/src/coords/points.js";
export function unframed(point: WorldPoint) {
  return writeShiftPair({ x: String(point.x * 2.54 / 72.27), y: String(point.y * 2.54 / 72.27) }, { x: null, y: null });
}
