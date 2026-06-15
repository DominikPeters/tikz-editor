export {
  ComputerModernTexMetricProvider,
  DEFAULT_COMPUTER_MODERN_MATH_FONTS,
  DEFAULT_COMPUTER_MODERN_TEXT_FONTS,
  computerModernTexMetricProvider,
  type DefaultComputerModernMathFont,
  type DefaultComputerModernTextFont,
  type ResolveComputerModernFontOptions,
} from "./fonts/computer-modern.js";
export {
  classicComputerModernFontIdForState,
  classicComputerModernTextFontProfile,
  defaultTexTextFontProfile,
  luaLatexDefaultFontIdForState,
  luaLatexDefaultTextFontProfile,
  type TexTextFontProfile,
} from "./fonts/text-profile.js";
export {
  analyzeSimpleTexParagraph,
  getSimpleTexFallbackReason,
  layoutSimpleTexParagraph,
  type TexParagraphAlignment,
  type TexParagraphLayoutOptions,
  type TexParagraphLayoutResult,
} from "./paragraph.js";
export {
  parseSimpleTexParagraphIr,
  type SimpleTexAlignmentNode,
  type SimpleTexBlockItem,
  type SimpleTexControlNode,
  type SimpleTexDisplayMathBlockItem,
  type SimpleTexDisplayMathNode,
  type SimpleTexEnvironmentBoundaryNode,
  type SimpleTexFontCommandName,
  type SimpleTexFontCommandNode,
  type SimpleTexFontDeclarationName,
  type SimpleTexFontDeclarationNode,
  type SimpleTexFontState,
  type SimpleTexGroupNode,
  type SimpleTexInlineNode,
  type SimpleTexLineBreakNode,
  type SimpleTexMathNode,
  type SimpleTexNoIndentNode,
  type SimpleTexNode,
  type SimpleTexParagraphBreakNode,
  type SimpleTexParagraphBlock,
  type SimpleTexParagraphIr,
  type SimpleTexParagraphSegment,
  type SimpleTexSegmentInput,
  type SimpleTexPlaceholderBlockItem,
  type SimpleTexSpaceNode,
  type SimpleTexTextNode,
  type SimpleTexToken,
  type SimpleTexUnsupportedCommandNode,
  type SimpleTexVerticalGlueBlockItem,
  type SimpleTexVerticalGlueCommandName,
  type SimpleTexVerticalGlueNode,
  type SimpleTexVerticalRuleBlockItem,
  type SimpleTexVerticalRuleNode,
  type TexAlignmentProfile,
  type TexFontFamily,
  type TexFontSeries,
  type TexFontShape,
  type TexSpaceGlueProfile,
} from "./ir.js";
export {
  createSimpleTexLayoutDocumentIr,
  createSimpleTexLayoutDocumentIrFromPreparation,
  prepareSimpleTexLayoutDocument,
  type SimpleTexLayoutDocumentIr,
  type SimpleTexLayoutDocumentPreparation,
  type SimpleTexLayoutDocumentPreparationParams,
} from "./vlist/document.js";
export {
  type TexLayoutParagraphBreakContext,
  type TexLayoutParagraphLineLabel,
} from "./vlist/paragraph-plans.js";
export * from "./math/index.js";
export {
  prepareTexLayoutParagraphsFromVList,
  type TexLayoutParagraphPreparation,
  type TexLayoutParagraphPreparationParams,
  type TexLayoutParagraphPlan,
} from "./vlist/paragraph-plans.js";
export {
  type TexLayoutIrOptions,
} from "./layout-options.js";
export {
  DEFAULT_TEX_PARAGRAPH_BREAK_SCOPE_POLICY,
  type TexParagraphBreakScopePolicy,
  type TexParagraphRightskipStretchMode,
} from "./paragraph-break.js";
export {
  texLayoutItemsForParagraphPlan,
} from "./vlist/paragraph-items.js";
export {
  breakSimpleTexLayoutDocumentParagraphs,
  type TexLayoutParagraphBreakEntriesResult,
} from "./vlist/paragraph-breaker.js";
export {
  type TexLayoutForcedBreakItem,
  type TexLayoutInlineItem,
  type TexLayoutMathItem,
  type TexMathBreakpoint,
  type TexMathBox,
  type TexMathBoxProvider,
  type TexLayoutSpaceItem,
  type TexLayoutTextItem,
} from "./layout-inline-items.js";
export type {
  GeneratedTexCharMetric,
  GeneratedTexFont,
  GeneratedTexFontTable,
  GeneratedTexLigKern,
  ResolveTexFontOptions,
  ResolvedTexFont,
  ShapeTexTextOptions,
  ShapedTexTextRun,
  TexCaretStop,
  TexGlyphBox,
  TexKern,
  TexMetricProvider,
  TexShapedItem,
} from "./fonts/types.js";
