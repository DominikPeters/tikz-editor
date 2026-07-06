export { FeatureFlags } from "./ast/features.js";
export * from "./coords/index.js";
export { parseTikz, createIncrementalParseSession } from "./parser/index.js";
export { applyEdit, applyEditIntent } from "./edit/apply.js";
export { EditorSession } from "./edit/session.js";
export { createEditAnalysisSession } from "./edit/analysis.js";
export { collectTikzSnippetsFromDocs, extractTikzSnippetsFromSource } from "./corpus/extract.js";
export {
  evaluateTikzFigure,
  createIncrementalSemanticSession,
  collectGeometryInvalidation
} from "./semantic/index.js";
export { emitSvg, emitSvgModel, serializeSvgModel, serializeSvgModelAsync, diffSvgModels } from "./svg/index.js";
export { renderTikzToSvg, renderTikzToSvgAsync } from "./render/index.js";
export { capabilityMatrix, FEATURE_IDS } from "./capabilities/index.js";
export { createMathJaxNodeTextEngine, setWorkerFontLoader } from "./text/mathjax-engine.js";
export type { MathJaxFont } from "./text/mathjax-engine.js";
export { collectSymbols, resolveDocHoverTarget } from "./completion/index.js";
export {
  createPdfExportArtifact,
  normalizePdfExportFileName,
  PDF_EXPORT_MIME_TYPE,
  DEFAULT_PDF_EXPORT_FILE_NAME,
  createPngExportArtifact,
  normalizePngExportFileName,
  PNG_EXPORT_MIME_TYPE,
  DEFAULT_PNG_EXPORT_FILE_NAME,
  createSvgExportArtifact,
  normalizeSvgExportFileName,
  SVG_EXPORT_MIME_TYPE,
  DEFAULT_SVG_EXPORT_FILE_NAME,
  createStandaloneLatexExportArtifact,
  createMinimalTikzSourceArtifact,
  normalizeStandaloneLatexExportFileName,
  STANDALONE_LATEX_EXPORT_MIME_TYPE,
  DEFAULT_STANDALONE_LATEX_EXPORT_FILE_NAME
} from "./export/index.js";
export { EDIT_ACTION_IDS, getEditActionAvailability } from "./edit/action-availability.js";
export {
  buildSnapContext,
  snapSelectionTranslation,
  snapHandlePosition,
  snapKeyboardNudge,
  snapToolPointer,
  pickGridStepPt,
  snapToNextMultiple,
  resolveSnapSettings,
  collectSelectionGeometry,
  collectSelectionGeometryFromBounds,
  collectSourceWorldBounds,
  boundsFromPoints,
  selectionSnapPointsFromBounds
} from "./edit/snapping/index.js";

export type { ParseTikzOptions, ParseTikzResult } from "./parser/index.js";
export type * from "./parser/incremental.js";
export type { TikzEdit, ApplyEditResult, EditIntent, EditIntentResult, SourcePatch } from "./edit/types.js";
export type { EditAnalysisSession, EditAnalysisView, EditAnalysisOptions } from "./edit/analysis.js";
export type { TikzSnippet, TikzSnippetKind } from "./corpus/extract.js";
export type { EvaluateTikzResult } from "./semantic/index.js";
export type {
  EmitSvgResult,
  EmitSvgOptions,
  SvgViewBox,
  SvgRenderModel,
  SvgRenderPart,
  SvgPatchOp,
  SvgDiffHints
} from "./svg/index.js";
export type { RenderTikzOptions, RenderTikzToSvgResult } from "./render/index.js";
export type { CapabilityMatrix, CapabilityRow, LayerStatus, FeatureId } from "./capabilities/index.js";
export type { DocumentSymbols, DocHoverTarget, DocHoverTargetKind, ResolveDocHoverTargetInput } from "./completion/index.js";
export type {
  PdfExportArtifact,
  CreatePdfExportArtifactOptions,
  PngExportArtifact,
  CreatePngExportArtifactOptions,
  SvgExportArtifact,
  CreateSvgExportArtifactOptions,
  StandaloneLatexExportArtifact,
  CreateStandaloneLatexExportArtifactOptions,
  MinimalTikzSourceArtifact,
  CreateMinimalTikzSourceArtifactOptions
} from "./export/index.js";
export type {
  ActionAvailability,
  EditActionAvailability,
  EditActionId,
  GetEditActionAvailabilityInput
} from "./edit/action-availability.js";
export type * from "./edit/snapping/types.js";
export type * from "./text/types.js";
export type * from "./ast/types.js";
export type * from "./diagnostics/types.js";
export type * from "./semantic/index.js";
export type * from "./options/types.js";
