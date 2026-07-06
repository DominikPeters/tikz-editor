export { KnuthPlassVisitor } from './KnuthPlassVisitor.js';
export {
  DEFAULT_PARAGRAPH_ALIGNMENT,
  TEX_INTERWORD_SHRINK_EM,
  TEX_INTERWORD_SPACE_EM,
  TEX_INTERWORD_STRETCH_EM,
  TIKZ_RAGGED_SKIP_STRETCH_EM,
  buildAlignmentProfile,
  normalizeParagraphAlignment,
  type ParagraphAlignment,
  type AlignmentProfile,
  type AlignmentGlue,
} from './alignment.js';
export {
  installKnuthPlassVisitor,
  getKnuthPlassReportsFromOutputJax,
  setKnuthPlassOptionsOnOutputJax,
  getKnuthPlassCaretFromPoint,
  getKnuthPlassLineRangeFromPoint,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects,
  clearKnuthPlassCaretMappingCache,
  type KnuthPlassConfig,
  type KnuthPlassLayoutMode,
  type WrappedTextGap,
  type MathJaxConfigLike,
  type MathJaxOutputConfig,
  type OutputJaxName,
  type CaretFromPointParams,
  type PointFromOffsetParams,
  type SelectionRectsParams,
  type CaretHitResult,
  type LineRangeFromPointResult,
  type CaretPointResult,
  type SelectionRectsResult,
} from './install.js';

export type {
  ParagraphLayoutReport,
  LineReport,
  RunReport,
  BreakReport,
} from './paragraph/report.js';

export type {
  FlattenResult,
  ParagraphRun,
  TextRun,
  SpaceRun,
  MathRun,
  BreakRef,
} from './paragraph/types.js';

export type {
  Item,
  BoxItem,
  GlueItem,
  PenaltyItem,
  ParagraphModel,
  ParagraphBuildOptions,
} from './paragraph/items.js';

export {
  runsToItems,
  getBreakableRunIndices,
} from './paragraph/items.js';

export type {
  MeasurementService,
  MeasurementStats,
} from './paragraph/measure.js';

export { createMeasurementService } from './paragraph/measure.js';
export { flattenParagraph } from './paragraph/tokenize.js';
export { greedyBreakParagraph } from './paragraph/greedy.js';
export type { DpResult } from './paragraph/dp.js';
export { breakWithDp } from './paragraph/dp.js';
export type { Hyphenator } from './paragraph/hyphenate.js';
export { createEnglishHyphenator, EnglishHyphenator } from './paragraph/hyphenate.js';

export { englishDefaults, ENGLISH_LANGUAGE_CODE } from './languages/en.js';

export {
  parseSourceSpans,
  type SourceParseError,
  type SourceParseResult,
  type SourceSpan,
  type TextSourceSpan,
  type MathSourceSpan,
  type MathDelimiterKind,
} from './editor/sourceParser.js';

export {
  stabilizePrefixForMeasurement,
  scanTeXPrefixState,
  hasDanglingMathScriptOperator,
  createMathPrefixCache,
  normalizeMathSourceForCache,
  seedPrefixWidthTable,
  finalizePrefixWidthTable,
  readPrefixUnitsFromTable,
  findNearestPrefixIndexFromTable,
  type MathPrefixCache,
} from './editor/mathPrefix.js';
