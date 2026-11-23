import type { ResolvedTexFont } from "./types.js";
import { texLength, type TexLength } from "../coordinates.js";

export function tfmToPt(font: ResolvedTexFont, value: number | undefined): TexLength {
  return texLength((value ?? 0) * font.atPt);
}

export function roundTexPt<T extends number>(value: T): T {
  // Arithmetic form of Number(value.toFixed(6)); this helper is on the
  // shaping hot path and the string round-trip dominated its cost.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Rounding preserves the caller's coordinate frame while arithmetic erases its numeric brand.
  return (Math.round(value * 1e6) / 1e6) as T;
}

/**
 * The pre-display allowance LuaTeX adds to a line's width (\predisplaygapfactor = 2000): it divides the quad
 * by 1000 in scaled points before multiplying, so the gap is slightly under two quads (17.97485pt at 9pt).
 */
export function texPreDisplayGapPt(quadPt: number): TexLength {
  return texLength(Math.trunc(Math.round(quadPt * 65_536) / 1000) * 2000 / 65_536);
}
