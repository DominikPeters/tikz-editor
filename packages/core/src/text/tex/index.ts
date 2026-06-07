export {
  ComputerModernTexMetricProvider,
  DEFAULT_COMPUTER_MODERN_TEXT_FONTS,
  computerModernTexMetricProvider,
  type DefaultComputerModernTextFont,
  type ResolveComputerModernFontOptions,
} from "./fonts/computer-modern.js";
export {
  getSimpleTexFallbackReason,
  layoutSimpleTexParagraph,
  type TexParagraphAlignment,
  type TexParagraphLayoutOptions,
  type TexParagraphLayoutResult,
} from "./paragraph.js";
export type {
  GeneratedTexCharMetric,
  GeneratedTexFont,
  GeneratedTexFontTable,
  GeneratedTexLigKern,
  ResolvedTexFont,
  ShapeTexTextOptions,
  ShapedTexTextRun,
  TexCaretStop,
  TexGlyphBox,
  TexKern,
  TexShapedItem,
} from "./fonts/types.js";
