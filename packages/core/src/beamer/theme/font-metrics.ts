import { texDecimalTimesDimensionPt } from "../../text/tex/dimensions.js";
import { texLength } from "../../text/tex/coordinates.js";
import { createBeamerTexTextFontProfile } from "./font.js";
import type { BeamerThemeFont } from "./types.js";

const SP_PER_PT = 65_536;

/**
 * The font's `ex`: the x-height fontdimen of the role's font at its size,
 * rounded to scaled points as TeX assigns a fractional Lua font parameter.
 * Stock themes state their bar heights and skips in ex of the head/foot
 * font, so these dimensions scale with beamerposter's larger fonts.
 */
export function beamerFontExPt(font: BeamerThemeFont): number {
  const profile = createBeamerTexTextFontProfile(font);
  const resolved = profile.resolveTextFont(profile.defaultFontState, texLength(font.sizePt), profile.metricProvider);
  return Math.round(resolved.data.fontdimen.xheight * font.sizePt * SP_PER_PT) / SP_PER_PT;
}

/**
 * `<decimal>ex` (or `<decimal>em`, `<decimal>\baselineskip`: any dimension
 * register) as TeX scans it: the decimal becomes a 16-bit fraction and the
 * product with the ex register truncates to scaled points, so `1.125ex` is
 * not simply `1.125 * ex`.
 */
export function beamerExMultiple(decimal: number, exPt: number): number {
  return texDecimalTimesDimensionPt(String(decimal), exPt) ?? decimal * exPt;
}

/**
 * The font's interword space (`\fontdimen2`) at its size, rounded to scaled
 * points: the glue a stray end-of-line space contributes in that font.
 */
export function beamerFontSpacePt(font: BeamerThemeFont): number {
  const profile = createBeamerTexTextFontProfile(font);
  const resolved = profile.resolveTextFont(profile.defaultFontState, texLength(font.sizePt), profile.metricProvider);
  return Math.round(resolved.data.fontdimen.space * font.sizePt * SP_PER_PT) / SP_PER_PT;
}
