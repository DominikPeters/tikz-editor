export { resolveBeamerPageGeometry } from "./geometry.js";
export { parseBeamerFrameBody } from "./content.js";
export {
  beamerOverlaySpecContains,
  projectBeamerOverlayText,
  resolveBeamerOverlaySpanVisibility,
  scanBeamerFrameOverlays,
} from "./overlay.js";
export { renderBeamerFrame, renderBeamerFramePages } from "./render.js";
export { scanBeamerDocument } from "./scan.js";
export {
  activeBeamerTheoremDeclarations,
  resolveBeamerTheoremCounterSeed,
  resolveBeamerTheoremOccurrences,
} from "./theorems.js";
export {
  createBeamerFrameNavigationSnapshot,
  createBeamerNavigationModel,
  createBeamerTexMathFontProfile,
  createBeamerTexTextFontProfile,
  planBeamerBlockTemplate,
  planBeamerFrameChrome,
  planBeamerTitlePageTemplate,
  resolveBeamerEnumerateMarker,
  resolveBeamerItemizeMarkers,
  resolveBeamerTheme,
  resolveBeamerThemeColor,
} from "./theme/index.js";
export type * from "./types.js";
export type * from "./content-types.js";
export type * from "./overlay.js";
export type * from "./theorems.js";
export type * from "./theme/index.js";
