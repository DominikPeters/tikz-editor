import type { ResolvedTexFont } from "./types.js";

export function tfmToPt(font: ResolvedTexFont, value: number | undefined): number {
  return (value ?? 0) * font.atPt;
}

export function roundTexPt(value: number): number {
  return Number(value.toFixed(6));
}
