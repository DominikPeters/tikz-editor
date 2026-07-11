import { worldPoint } from "../../coords/points.js";
import type { WorldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { normalizeOptionValue, isWrappedBySingleBracePair } from "../shared/option-value.js";
import { clamp } from "../../utils/math.js";

export { normalizeOptionValue, isWrappedBySingleBracePair };
export { clamp };

export function coordinateInner(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    return null;
  }
  return trimmed.slice(1, -1).trim();
}

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function interpolate(from: WorldPoint, to: WorldPoint, t: number): WorldPoint {
  return worldPoint(
    pt(from.x + (to.x - from.x) * t),
    pt(from.y + (to.y - from.y) * t)
  );
}
