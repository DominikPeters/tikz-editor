const TEX_PT_PER_IN = 72.27;
const CSS_SCREEN_DPI = 96;
// Canvas transforms use CSS pixels, whose reference inch is 96 px.
export const ACTUAL_SIZE_SCALE = CSS_SCREEN_DPI / TEX_PT_PER_IN;

export function zoomPercentForScale(scale: number): number {
  return Math.round((scale / ACTUAL_SIZE_SCALE) * 100);
}
