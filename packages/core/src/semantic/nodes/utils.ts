import type { ArcParameters } from "../path/types.js";
import { worldPoint } from "../../coords/points.js";
import type { WorldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { normalizeOptionValue, isWrappedBySingleBracePair } from "../shared/option-value.js";

export { normalizeOptionValue, isWrappedBySingleBracePair };
export { clamp } from "../../utils/math.js";

export function interpolate(from: WorldPoint, to: WorldPoint, t: number): WorldPoint {
  return worldPoint(
    pt(from.x + (to.x - from.x) * t),
    pt(from.y + (to.y - from.y) * t)
  );
}

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function arcCenter(from: WorldPoint, params: ArcParameters): WorldPoint {
  const startRadians = toRadians(params.startAngle);
  return worldPoint(
    pt(from.x - params.rx * Math.cos(startRadians)),
    pt(from.y - params.ry * Math.sin(startRadians))
  );
}
