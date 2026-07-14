import type { ResolvedTexFont } from "./types.js";
import { texLength, type TexLength } from "../coordinates.js";

export function tfmToPt(font: ResolvedTexFont, value: number | undefined): TexLength {
  return texLength((value ?? 0) * font.atPt);
}

export function roundTexPt<T extends number>(value: T): T {
  // Arithmetic form of Number(value.toFixed(6)); this helper is on the
  // shaping hot path and the string round-trip dominated its cost.
  return (Math.round(value * 1e6) / 1e6) as T;
}
