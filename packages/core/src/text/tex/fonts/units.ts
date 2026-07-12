import type { ResolvedTexFont } from "./types.js";

export function tfmToPt(font: ResolvedTexFont, value: number | undefined): number {
  return (value ?? 0) * font.atPt;
}

export function roundTexPt(value: number): number {
  // Arithmetic form of Number(value.toFixed(6)); this helper is on the
  // shaping hot path and the string round-trip dominated its cost.
  return Math.round(value * 1e6) / 1e6;
}
