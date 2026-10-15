export { resolveBeamerPageGeometry } from "./geometry.js";
export { beamerObjectOverlayTarget, type BeamerObjectOverlayTarget } from "./object-overlays.js";
export {
  buildBeamerBuildModel,
  canEditBeamerBuildTiming,
  beamerBuildTimingPatch,
  beamerBuildRange,
  beamerBuildBoundaryPatch,
  type BeamerBuildTimingAction,
  type BeamerBuildBoundary,
  beamerBuildStateAt,
  beamerBuildSpecPatch,
  firstVisibleBeamerBuildStep,
  isExplicitBeamerBuildSpec,
  reconcileBeamerBuildRow,
  type BeamerBuildModel,
  type BeamerBuildRow,
  type BeamerBuildState,
} from "./builds.js";
export { parseBeamerFrameBody } from "./content.js";
export {
  beamerCaretAtomBeside,
  beamerCaretRowEdgeOffset,
  beamerCaretRowForOffset,
  buildBeamerCaretStopDomain,
  nearestBeamerCaretOffset,
  nextBeamerCaretOffset,
  verticalBeamerCaretOffset,
  type BeamerCaretDomain,
  type BeamerCaretDomainParagraph,
  type BeamerCaretRow,
  type BeamerCaretStop,
} from "./caret-stops.js";
export {
  resolveCanvasRenderedMotion,
  type CanvasBufferSelection,
  type CanvasMotion,
  type CanvasMotionResult,
  type CanvasVerticalGoal,
} from "./canvas-keys.js";
export {
  applyBeamerStructuralEdits,
  beamerObjectDeletionPatch,
  beamerObjectDuplicationPatch,
  type BeamerObjectEditPatch,
  type BeamerStructuralEdit,
} from "./structural-edit.js";
export {
  applyDeckEditAction,
  isDeckEditAction,
  type DeckEditAction,
} from "./deck-edit-actions.js";
export {
  buildDeckFrameInspector,
  buildDeckObjectInspector,
  splitDeckDimension,
  type DeckInspectorField,
  type DeckInspectorModel,
  type DeckInspectorWrite,
} from "./deck-inspector.js";
export {
  beamerObjectAtOffset,
  buildBeamerObjectIndex,
  type BeamerObjectIndex,
  type BeamerObjectKind,
  type BeamerObjectListItemContext,
  type BeamerObjectNode,
} from "./object-index.js";
export { collectBeamerEditScopes, collectBeamerRecovery, resolveBeamerEditScopeAt } from "./edit-scopes.js";
export {
  beamerOverlaySpecContains,
  projectBeamerOverlayText,
  resolveBeamerOverlaySpanVisibility,
  scanBeamerFrameOverlays,
} from "./overlay.js";
export {
  beamerTikzFontCommand,
  prepareBeamerDocument,
  renderBeamerFrame,
  renderBeamerFramePages,
  type PreparedBeamerDocument,
} from "./render.js";
export {
  BEAMER_DRAWING_LAYER,
  BEAMER_TIKZ_LAYER,
  BEAMER_TIKZ_LAYER_DEFINITION,
  BEAMER_TIKZ_LAYER_OPTIONS,
  beamerTikzLayerState,
  type BeamerTikzLayerState,
  beamerDrawingLayerInsertions,
  beamerDrawingLayerRemovalSpan,
  beamerOverlayPicturesIn,
  type BeamerOverlayPicture,
} from "./overlay-pictures.js";
export { beamerTikzLayerPreambleInsertion } from "./tikz-layer-preamble.js";
export { scanBeamerDocument, scanBeamerDocumentClass } from "./scan.js";
export { scanBeamerNoteCommands, beamerSpeakerNotes, type BeamerNoteCommand } from "./notes.js";
export { beamerFrameNotes, checkBeamerNoteBody, editBeamerFrameNote, type BeamerFrameNote, type BeamerNoteBodyProblem, type BeamerNoteEdit } from "./note-editing.js";
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
export type { BeamerLinkDestination, BeamerLinkRegion } from "./references.js";
export type * from "./content-types.js";
export type * from "./overlay.js";
export type * from "./theorems.js";
export type * from "./theme/index.js";

export { beamerColumnDividers, beamerColumnResizePatches, beamerImageResizeTarget, beamerImageResizePatches,
  type BeamerColumnDivider, type BeamerImageResizeTarget } from "./deck-resize.js";

export { beamerSpacingTargets, beamerSpacingResizePatches, type BeamerSpacingTarget } from "./deck-spacing.js";
export { BEAMER_SLIDE_TEMPLATES, beamerSlideTemplates, beamerSlideTemplateFrame, type BeamerSlideTemplate, type BeamerSlideTemplateId, type BeamerSlideTemplateFrame } from "./slide-templates.js";
export { copyBeamerSlides, editBeamerSlides, beamerSlideIsEditable, beamerSlideSourceSpan, type BeamerSlideEdit, type BeamerSlideDestination, type BeamerSlideEditResult } from "./slide-manager.js";

export { analyzeBeamerSlideMove, type BeamerSlideMoveAnalysis, type BeamerSlideMoveIssue, type BeamerSlideMoveExcerpt } from "./slide-move-analysis.js";
