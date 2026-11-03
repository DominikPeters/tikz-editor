// expect: TS2322
// A helper that returns coordinate text as a plain string.
import { applyFragments } from "../../../packages/core/src/edit/fragment.js";
import type { WorldPoint } from "../../../packages/core/src/coords/points.js";

function coordinateText(point: WorldPoint): string {
  return `(${point.x / 28.45}cm,${point.y / 28.45}cm)`;
}

export function moveTo(source: string, point: WorldPoint) {
  return applyFragments(source, [{ span: { from: 0, to: 5 }, fragment: coordinateText(point) }]);
}
