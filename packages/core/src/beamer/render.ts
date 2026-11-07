import { createBeamerAmbientBlockTheme } from "./ambient-block-theme.js";
import { beamerItemActionCommitsParagraph } from "./item-actions.js";
import { projectBeamerInlineFlow, beamerBoxesClearingPendingItemLabels } from "./inline-flow.js";
import { matchTexSyntaxEnvironments } from "../text/tex/syntax-index.js";
import type { SimpleTexBoxBlockItem } from "../text/tex/ir.js";
import type { TexVListItem } from "../text/tex/vlist/types.js";
import { createBeamerAmbientText } from "./ambient-text.js";
import { expandBeamerLocalMacros } from "./local-macros.js";
import { interleaveBeamerPicturePaint, type BeamerPicturePaintOwner } from "./picture-paint.js";
import { projectBeamerInlinePictures, type BeamerInlinePicture } from "./inline-pictures.js";
import { projectBeamerTikzSource } from "./overlay.js";
import { beamerDateBindings, beamerMetadataWithDefaultDate, projectBeamerDateRegisters, type BeamerCompilationDate } from "./date.js";
import { projectBeamerPreformatted } from "./preformatted.js";
import { projectBeamerScientificNotation } from "./package-notation.js";
import { createBeamerScopedTheme } from "./theme/scoped-declarations.js";
import { requireDefined } from "../utils/invariants.js";
import { requireArrayValue } from "../utils/collections.js";
import { beamerBibliographyStyle, beamerBibliographyGraphicsResolver } from "./bibliography.js";
import { projectBeamerOverprints } from "./overprint.js";
import { projectBeamerOverlayAreas } from "./overlay-area.js";
import { prepareBeamerContents } from "./contents.js";
import { buildBeamerFrameFootnotes, beamerFootnoteTextMapped, projectBeamerFootnotes } from "./footnotes.js";
import { beamerContinuationTitleSuffix, collectBeamerContinuationBreaks, projectBeamerContinuationBreaks, splitBeamerFrameContinuations } from "./continuations.js";
import {
  buildBeamerReferenceIndex,
  projectBeamerReferences,
  layoutBeamerLinks,
  type BeamerReferenceContext,
  type BeamerReferenceIndex,
} from "./references.js";
import {
  remapParagraphLayoutReportSourceMap,
  remapTexVListLayoutSourceMap,
  remapSimpleTexListStructureSourceMap,
} from "../text/tex/source-map-report.js";
import { maskTikzPictureSource } from "../document/masking.js";
import { collectContextDefinitions } from "../transform/cst-to-ast.js";
import type { Span } from "../ast/types.js";
import { projectBeamerCaptions } from "./captions.js";
import { pt, svgPoint, svgRect, type SvgPoint, type SvgRect } from "../coords/index.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { DocumentGraphicsResolver } from "../graphics/types.js";
import {
  collectMacroBindings,
  type MacroBinding,
} from "../macros/index.js";
import { renderTikzToSvgAsync, type RenderTikzToSvgResult } from "../render/index.js";
import { BeamerRenderWork, runBeamerRenderOperation } from "./cooperative-render-work.js";
import { formatSvgNumber as fmt } from "../svg/format.js";
import {
  createSvgModelBuilder,
  serializeSvgModel,
} from "../svg/model.js";
import {
  createGeneratedMappedText,
  createIdentityMappedText,
  concatMappedText,
  projectInputRange,
  sliceMappedText,
  type MappedText,
} from "../text/source-map.js";
import { createTexNodeTextEngine } from "../text/tex-node-text-engine.js";
import {
  computerModernTexMetricProvider,
  collectTexGraphicsPlacements,
  createTexDerivedInlineMathBoxProvider,
  defaultTexMathFontProfile,
  layoutSimpleTexParagraph,
  renderTexParagraphSvgBody,
  TEX_ALERT_COLOR_ALIAS,
  texLength,
  texLineX,
  type TexListLayoutProfile,
  type TexMetricProvider,
} from "../text/tex/index.js";
import { parseTexDimensionExpression } from "../text/tex/dimensions.js";
import { parseSimpleTexTabularRegisters } from "../text/tex/ir.js";
import { collectBeamerParagraphSpacing } from "./spacing.js";
import { resolveBeamerColumnPositions, resolveBeamerColumnWidth } from "./column-dimensions.js";
import { beamerFrameBodyTransform, beamerFrameShrinkScale, beamerFrameShrinkWidth, crampedBeamerListProfile, resolveBeamerFrameShrink, transformBeamerPoint, transformBeamerRect } from "./frame-shrink.js";
import { beamerDisplayMathProfile, beamerListSizeOverrides, beamerNamedFontSize, beamerNamedFontSizes, beamerTrivlistSpacing } from "./theme/font-sizes.js";
import { emitTcolorboxBackground, measureTcolorboxGeometry, parseTcolorboxOptions, projectTcolorboxFontDeclaration, resolveTcolorboxPlan, tcolorboxSurroundingSpacing } from "./tcolorbox.js";
import { parseBeamerFrameBody } from "./content.js";
import { beamerRecoveryDiagnostics, collectBeamerEditScopes, collectBeamerRecovery } from "./edit-scopes.js";
import { emitEmbeddedTikz } from "./embedded-tikz.js";
import {
  leadingBeamerTrivlistAdjustment,
  paragraphEndingMaterialDepth,
  paragraphLastLineDepth,
  paragraphStartingMaterialHeight,
  paragraphStartingBaselineSkip,
  positionPreparedFrameFlow,
  previousDepthBeforeTrailingVerticalSpace,
  trailingBeamerListSkip,
  trailingBeamerTrivlistSkip,
} from "./frame-flow.js";
import type {
  BeamerBlockBodyNode,
  BeamerColumnAlignment,
  BeamerColumnBodyNode,
  BeamerColumnFlowNode,
  BeamerFrameBodyIr,
  BeamerFrameBodyNode,
  BeamerParagraphBodyNode,
  BeamerTheoremBodyNode,
  BeamerTitlePageBodyNode,
} from "./content-types.js";
import { resolveBeamerPageGeometry } from "./geometry.js";
import {
  beamerOverlaySpecContains,
  projectBeamerOverlayText,
  resolveBeamerOverlaySpanVisibility,
  scanBeamerFrameOverlays,
  type BeamerOverlayModel,
  type BeamerOverlayVisibility,
} from "./overlay.js";
import { scanBeamerDocumentWithSyntax } from "./scan.js";
import { formatDocumentRootId } from "../document/root-id.js";
import { createBeamerSyntaxContext, beamerRequiredArgumentAfter, beamerOptionalArgumentAfter, type BeamerSyntaxContext } from "./syntax.js";
import { beamerSpeakerNotes, projectBeamerSpeakerNotes, scanBeamerNoteCommands, type BeamerNoteCommand } from "./notes.js";
import { BEAMER_TIKZ_LAYER_OPTIONS, beamerOverlayPictureOrigin, beamerOverlayPicturesIn, beamerTikzLayerState, projectBeamerOverlayPictureBoxes } from "./overlay-pictures.js";
import { getTexSyntaxIndex, type TexSyntaxIndex } from "../text/tex/syntax-index.js";
import { texFragmentParser } from "@tikz-editor/lezer-tex";
import type { NodeTextColorResolver } from "../text/types.js";
import {
  activeBeamerTheoremDeclarations,
  resolveBeamerTheoremOccurrences,
  type BeamerTheoremOccurrence,
} from "./theorems.js";
import {
  createBeamerTexMathFontProfile,
  createBeamerTexTextFontProfile,
  createBeamerFrameNavigationSnapshot,
  createBeamerNavigationModel,
  planBeamerBlockTemplate,
  planBeamerFrameChrome,
  planBeamerTitlePageTemplate,
  resolveBeamerEnumerateMarker,
  resolveBeamerItemizeMarkers,
  resolveBeamerListLabelColor,
  resolveBeamerTheme,
  resolveBeamerThemeColor,
} from "./theme/index.js";
import { documentWithPresentationTheme, planPresentationThemeSwitch } from "./theme-switch.js";
import type {
  BeamerFrameChromePlan,
  BeamerNavigationModel,
  BeamerTemplatePrimitive,
  BeamerThemeFont,
  BeamerThemeFontRole,
  ResolvedBeamerTheme,
} from "./theme/types.js";
import { beamerRoundedShadowMarkup } from "./theme/rounded-shadow.js";
import { classifyMacro } from "../editing/commands/macro-classes.js";
import {
  escapeAttribute,
  paragraphMarkup,
  rectMarkup,
  textColor,
  vectorTemplateMarkup,
} from "./theme/svg-markup.js";
import type {
  ColumnVerticalBox,
  LaidParagraph,
  PreparedBlock,
  PreparedColumnContent,
  PreparedColumnFlowItem,
  PreparedFrameFlowItem,
  PreparedTitlePage,
} from "./render-model.js";
import {
  prepareUnsupportedPlaceholder,
  unsupportedPlaceholderMarkup,
  type BeamerUnsupportedPlaceholder,
} from "./unsupported-placeholder.js";
import type {
  BeamerDocumentModel,
  BeamerEmbeddedTikzLayout,
  BeamerFrameModel,
  BeamerFrameLayout,
  BeamerPaintTransform,
  BeamerSpacingLayout,
  BeamerFrameLayoutItem,
  BeamerGraphicsLayout,
  BeamerMetadataFieldModel,
  BeamerMetadataFieldName,
  BeamerPageGeometry,
  BeamerListTopology,
  BeamerParagraphLayout,
  BeamerRect,
  RenderBeamerFrameOptions,
  RenderBeamerFramePagesOptions,
  RenderBeamerFramePagesResult,
  RenderBeamerFrameResult,
  PrepareBeamerDocumentOptions,
} from "./types.js";

const TEX_POINTS_PER_CM = 72.27 / 2.54;
const TEX_POINTS_PER_BP = 72.27 / 72;
const TOP_ALIGNED_FRAME_SKIP_PT = 0.2 * TEX_POINTS_PER_CM;
// A root-level `center` is LaTeX's trivlist-based center environment.
// size11.clo supplies \topsep 9pt plus 3pt minus 5pt. Beamer's frame vbox
// applies one ordinary-order shrink ratio to these two skips and to display
// skips in the surrounding body.
// beamerbaselocalstructure.sty: \leftmargini..iii=2em,
// \topsep=3pt/2pt/2pt, \partopsep=0pt, \parsep=0pt, and first-level
// \itemsep=3pt. The deeper itemsep values alias their zero parsep.
const BEAMER_LIST_LAYOUT_PROFILE: TexListLayoutProfile = {
  groupItemBodies: true,
  trivlistTopsepPt: 9,
  // Beamer globally zeros \partopsep after size11.clo is loaded.
  trivlistPartopsepPt: 0,
  leftMarginEmByDepth: [2, 2, 2],
  // beamerbaselocalstructure.sty: \beamer@descriptionwidth=2cm.
  descriptionLabelWidthPt: (2 / 2.54) * 72.27,
  topsepPtByDepth: [3, 2, 2],
  topsepStretchPtByDepth: [2, 1, 1],
  topsepShrinkPtByDepth: [2.5, 2, 2],
  partopsepPtByDepth: [0, 0, 0],
  itemsepPtByDepth: [3, 0, 0],
  itemsepStretchPtByDepth: [2, 1, 1],
  itemsepShrinkPtByDepth: [3, 0, 0],
  parsepPtByDepth: [0, 0, 0],
  parsepStretchPtByDepth: [0, 1, 1],
  parsepShrinkPtByDepth: [0, 0, 0],
  initialItemBaselineAdjustmentPt: 0,
};

/**
 * The label columns of description lists given their widest label
 * (`\begin{description}[Longest label]`, beamerbaselocalstructure.sty):
 * that label's width as the description item template sets it, keyed by
 * the list's `\begin`. A `[<+->]` there is a default overlay, not a label.
 */
function beamerDescriptionLabelWidths(text: string, measure: (tex: string) => number): ReadonlyMap<number, number> {
  const widths = new Map<number, number>();
  if (!text.includes("\\begin{description}")) {
    return widths;
  }
  const syntax = getTexSyntaxIndex(text, texFragmentParser);
  for (const match of text.matchAll(/\\begin\s*\{description\}/gu)) {
    const option = syntax.argumentAfter(match.index + match[0].length, "optional", text.length);
    const label = option ? text.slice(option.contentSpan.from, option.contentSpan.to) : "";
    if (option && !label.trimStart().startsWith("<")) {
      widths.set(match.index, measure(label));
    }
  }
  return widths;
}

function beamerListLayoutProfile(
  theme: ResolvedBeamerTheme,
  cramped = false
): TexListLayoutProfile {
  const markerCache = new Map<number, ReturnType<typeof resolveBeamerItemizeMarkers>>();
  const classSize = String(theme.options["class-font-size"] ?? "11");
  const small = beamerNamedFontSize(classSize, "small");
  const footnotesize = beamerNamedFontSize(classSize, "footnotesize");
  const profile: TexListLayoutProfile = {
    ...BEAMER_LIST_LAYOUT_PROFILE,
    trivlistTopsepPt: beamerTrivlistSpacing(theme).naturalPt,
    sizeOverrides: beamerListSizeOverrides(theme),
    dimensionFontSizePt: beamerNamedFontSize(classSize, "normalsize").sizePt,
    paragraphSkipPt: Number(theme.options["paragraph-skip-pt"] ?? 0),
    selectBodyFontBeforeList: true,
    enumerateMiniTemplates: true,
    resolveEnumerateText: (counters, depth) => theme.templates.enumerations[depth - 1]?.id.endsWith("/default") ? counters.join(".") + (depth === 1 ? "." : "") : undefined,
    bodyFontSizePtByDepth: [undefined, small.sizePt, footnotesize.sizePt],
    bodyDisplaySkipCommandByDepth: [undefined, "small", "footnotesize"],
    bodyBaselineSkipPtByDepth: [undefined, small.lineHeightPt * Number(theme.options["line-spread"] ?? 1), footnotesize.lineHeightPt * Number(theme.options["line-spread"] ?? 1)],
    leftMarginEmByDepth: theme.dimensions.listLeftMarginEmByDepth,
    itemizeMarkersByDepth: resolveBeamerItemizeMarkers(theme),
    resolveItemizeMarker: (depth, sizePt, listDepth = depth) => {
      const size = sizePt ?? theme.fonts["normal-text"].sizePt;
      let markers = markerCache.get(size);
      if (!markers) {
        const scale = size / theme.fonts["normal-text"].sizePt;
        markers = resolveBeamerItemizeMarkers(theme, size).map(marker => ({ ...marker,
          widthEm: marker.widthEm * scale, heightEm: marker.heightEm * scale, depthEm: marker.depthEm * scale,
          ...(marker.rightEdgeOffsetEm === undefined ? {} : { rightEdgeOffsetEm: marker.rightEdgeOffsetEm * scale }),
          ...(marker.glyph ? { glyph: { ...marker.glyph, baselineOffsetEm: marker.glyph.baselineOffsetEm * scale } } : {}),
          ...(marker.paintBoundsEm ? { paintBoundsEm: { x: marker.paintBoundsEm.x * scale, y: marker.paintBoundsEm.y * scale, width: marker.paintBoundsEm.width * scale, height: marker.paintBoundsEm.height * scale } } : {}),
        }));
        markerCache.set(size, markers);
      }
      return markers[Math.min(listDepth - 1, markers.length - 1)];
    },
    resolveLabelColor: (kind, labelDepth, listDepth) => resolveBeamerListLabelColor(theme, kind, labelDepth, listDepth),
    resolveEnumerateMarker: (itemIndex, labelDepth, sizePt) =>
      resolveBeamerEnumerateMarker(theme, itemIndex, labelDepth, sizePt),
  };
  return cramped ? crampedBeamerListProfile(profile) : profile;
}

/**
 * The document-level state shared by every frame/step render of one source
 * revision: scan, resolved theme, page geometry, macro bindings, navigation
 * topology, and theorem counters.
 */
type BeamerRenderContext = {
  readonly compilationDate: BeamerCompilationDate;
  readonly noteCommands: readonly BeamerNoteCommand[];
  readonly source: string;
  readonly syntax: TexSyntaxIndex;
  readonly document: BeamerDocumentModel;
  readonly theme: ResolvedBeamerTheme;
  readonly macroBindingsAt: (offset: number) => ReadonlyMap<string, MacroBinding>;
  readonly macroBindingsForFrame: (frame: BeamerFrameModel) => ReadonlyMap<string, MacroBinding>;
  readonly references: BeamerReferenceIndex;
  readonly overlaysByFrameId: ReadonlyMap<string, BeamerOverlayModel>;
  readonly page: BeamerPageGeometry;
  readonly navigationModel: BeamerNavigationModel;
  readonly theoremOccurrences: ReadonlyMap<number, BeamerTheoremOccurrence>;
};

function createBeamerRenderContext(
  source: string,
  options: PrepareBeamerDocumentOptions = {}
): BeamerRenderContext {
  const noteCommands = scanBeamerNoteCommands(source);
  const syntaxContext = createBeamerSyntaxContext(
    source,
    [...(options.structuralMasks ?? []), ...noteCommands.map(note => note.bodySpan)],
    options.previousSyntax,
    options.exactSyntax
  );
  const document = scanBeamerDocumentWithSyntax(syntaxContext);
  const themeSwitch = options.presentationTheme === undefined
    ? null
    : planPresentationThemeSwitch(document, options.presentationTheme);
  // Only the theme sees the switched uses; spans elsewhere stay the source's.
  const theme = resolveBeamerTheme(themeSwitch ? documentWithPresentationTheme(document, themeSwitch) : document);
  const dateBindings = beamerDateBindings(document, syntaxContext);
  const pointMacroBindings = new Map<number, ReadonlyMap<string, MacroBinding>>();
  const bindingsAt = (offset: number): ReadonlyMap<string, MacroBinding> => {
    const cached = pointMacroBindings.get(offset);
    if (cached) return cached;
    const prefix = source.slice(0, offset);
    let collected = collectMacroBindings(collectContextDefinitions(prefix));
    // A callable or alias can execute a declaration whose command name never
    // appears at the call site. Replay the supported macro stream in that case.
    if ([...collected.values()].some(binding => /\\(?:newcommand|renewcommand|providecommand|def|let)\b/u.test(binding.kind === "text" ? binding.value : binding.body))) {
      collected = new Map(expandBeamerLocalMacros(createIdentityMappedText(prefix), new Map(), true).bindings);
    }
    collected.delete("\\arraystretch");
    for (const [name, binding] of dateBindings.bindings) if (!collected.has(name)) collected.set(name, binding);
    pointMacroBindings.set(offset, collected);
    return collected;
  };
  const overlaysByFrameId = new Map(document.frames.map((frame) => {
    const overlays = scanBeamerFrameOverlays(source, frame, syntaxContext.syntax);
    return [frame.id, frame.options?.allowFrameBreaks == null ? overlays : { ...overlays, stepCount: 1 }] as const;
  }));
  return {
    compilationDate: dateBindings.date,
    noteCommands,
    source,
    syntax: syntaxContext.syntax,
    document,
    theme,
    macroBindingsAt: bindingsAt,
    macroBindingsForFrame: frame => bindingsAt(frame.span.from),
    references: buildBeamerReferenceIndex(document, syntaxContext.syntax, overlaysByFrameId),
    overlaysByFrameId,
    page: resolveBeamerPageGeometry(document, theme),
    navigationModel: createBeamerNavigationModel(document),
    theoremOccurrences: resolveBeamerTheoremOccurrences(
      document,
      syntaxContext.syntax
    ),
  };
}

/**
 * A prepared Beamer document: document-level passes run once, then any
 * frame/step renders against the shared model. Frame body IRs are parsed
 * lazily and cached per frame.
 */
export type PreparedBeamerDocument = {
  readonly document: BeamerDocumentModel;
  readonly theme: ResolvedBeamerTheme;
  /** Retained by the app compute session for incremental document parsing. */
  readonly syntax: TexSyntaxIndex;
  /** Overlay step count for one frame, without rendering it. */
  frameStepCount(frameIndex: number): number;
  /** Presenter-only standard Beamer note source for this overlay build. */
  speakerNotes(frameIndex: number, step: number): string;
  /**
   * The interpretation environment for editing a frame: the user macros
   * in effect at it, and the theorem-like environment names declared
   * before it.
   */
  frameEditingEnvironment(frameIndex: number): {
    readonly macros: ReadonlyMap<string, MacroBinding>;
    readonly theorems: readonly string[];
    /** The document's quotation marks: Unicode “ ” where it uses them and never ``` `` ```. */
    readonly quotes: "tex" | "unicode";
  };
  renderFrame(
    options?: RenderBeamerFrameOptions
  ): Promise<RenderBeamerFrameResult>;
  renderFramePages(
    options?: RenderBeamerFramePagesOptions
  ): Promise<RenderBeamerFramePagesResult>;
};

/**
 * Run the document-level Beamer passes (scan, theme resolution, page
 * geometry, macro collection, navigation topology, theorem counters) once
 * and return a handle that renders frames and steps against the prepared
 * model. `renderBeamerFrame`/`renderBeamerFramePages` are one-shot wrappers
 * over this entry point.
 */
export function prepareBeamerDocument(
  source: string,
  options: PrepareBeamerDocumentOptions = {}
): PreparedBeamerDocument {
  const context = createBeamerRenderContext(source, options);
  let quotes: "tex" | "unicode" | undefined;
  const bodyIrByFrameIndex = new Map<number, BeamerFrameBodyIr>();
  // Asset refreshes replace resolvers while keeping this prepared document.
  // Old counter results must not keep those resolvers and their image bytes alive.
  const noGraphicsResolver = {};
  const counterContexts = new WeakMap<object, Promise<{ beforeFrames: number[]; totalFrames: number }>>();

  const requireFrame = (frameIndex: number): BeamerFrameModel => {
    const frame = context.document.frames[frameIndex];
    if (!frame) {
      throw new RangeError(
        `Beamer frame index ${frameIndex} is outside the document's ${context.document.frames.length} frames.`
      );
    }
    return frame;
  };

  const frameBodyIr = (frameIndex: number): BeamerFrameBodyIr => {
    const cached = bodyIrByFrameIndex.get(frameIndex);
    if (cached) {
      return cached;
    }
    const frame = requireFrame(frameIndex);
    const overlays = context.overlaysByFrameId.get(frame.id);
    const bodyIr = parseBeamerFrameBody({
      source: context.source,
      frame: requireFrame(frameIndex),
      document: context.document,
      syntax: context.syntax,
      theoremOccurrences: context.theoremOccurrences,
      ...(overlays !== undefined ? { overlays } : {}),
    });
    bodyIrByFrameIndex.set(frameIndex, bodyIr);
    return bodyIr;
  };

  const requireStep = (bodyIr: BeamerFrameBodyIr, step: number): void => {
    if (!Number.isInteger(step) || step < 1) {
      throw new RangeError(
        "A Beamer overlay step must be a positive integer."
      );
    }
    if (step > bodyIr.overlays.stepCount) {
      throw new RangeError(
        `Beamer overlay step ${step} is outside the frame's ${bodyIr.overlays.stepCount} steps.`
      );
    }
  };

  // Beamer increments framenumber for every allowframebreaks continuation,
  // while ordinary overlays retain one frame number. Measure only the frames
  // that can split, once per graphics resolver, to make totals and later
  // frames independent of the order in which callers request their pages.
  const frameCounterContext = (graphicsResolver?: DocumentGraphicsResolver, work?: BeamerRenderWork) => {
    const key = graphicsResolver ?? noGraphicsResolver;
    let pending = counterContexts.get(key);
    if (!pending) {
      pending = (async () => {
        const beforeFrames: number[] = [];
        let totalFrames = 0;
        for (const [frameIndex, frame] of context.document.frames.entries()) {
          beforeFrames.push(totalFrames);
          if (frame.options?.noFrameNumbering) continue;
          if (frame.options?.allowFrameBreaks == null) { totalFrames++; continue; }
          if (work) await work.checkpoint();
          const measured = await renderBeamerFrameStep({ context, frame, frameIndex, bodyIr: frameBodyIr(frameIndex), step: 1, ...(graphicsResolver !== undefined ? { graphicsResolver } : {}), ...(work !== undefined ? { work } : {}) });
          totalFrames += measured.layout.continuation?.count ?? 1;
        }
        return { beforeFrames, totalFrames };
      })();
      counterContexts.set(key, pending);
      void pending.catch(() => { if (counterContexts.get(key) === pending) counterContexts.delete(key); });
    }
    return pending;
  };

  return {
    document: context.document,
    theme: context.theme,
    syntax: context.syntax,
    frameStepCount: (frameIndex) => {
      return requireDefined(context.overlaysByFrameId.get(requireFrame(frameIndex).id), "Expected an internal render value").stepCount;
    },
    speakerNotes: (frameIndex, step) => beamerSpeakerNotes(context.document, context.noteCommands, frameIndex, step, requireDefined(context.overlaysByFrameId.get(requireFrame(frameIndex).id), "Expected an internal render value")),
    frameEditingEnvironment: (frameIndex) => {
      const frame = requireFrame(frameIndex);
      quotes ??= /[“”]/u.test(source) && !source.includes("``") ? "unicode" : "tex";
      return {
        macros: context.macroBindingsForFrame(frame),
        theorems: [...activeBeamerTheoremDeclarations(context.document, frame.span.from).keys()],
        quotes,
      };
    },
    async renderFrame(options = {}) {
      options.cooperative?.signal?.throwIfAborted();
      const frameIndex = options.frameIndex ?? 0;
      const frame = requireFrame(frameIndex);
      const bodyIr = frameBodyIr(frameIndex);
      const step = options.step ?? 1;
      requireStep(bodyIr, step);
      const work = options.cooperative ? new BeamerRenderWork(options.cooperative) : undefined;
      const counters = await frameCounterContext(options.graphicsResolver, work);
      return renderBeamerFrameStep({
        context,
        frame,
        frameIndex,
        bodyIr,
        step,
        ...(options.continuation !== undefined ? { continuation: options.continuation } : {}),
        frameCounter: { beforeFrame: requireArrayValue(counters.beforeFrames, frameIndex), totalFrames: counters.totalFrames },
        ...(options.graphicsResolver !== undefined ? { graphicsResolver: options.graphicsResolver } : {}),
        ...(options.drawingLayer !== undefined ? { drawingLayer: options.drawingLayer } : {}),
        ...(work !== undefined ? { work } : {}),
      });
    },
    async renderFramePages(options = {}) {
      options.cooperative?.signal?.throwIfAborted();
      const frameIndex = options.frameIndex ?? 0;
      const frame = requireFrame(frameIndex);
      const bodyIr = frameBodyIr(frameIndex);
      const stepCount = bodyIr.overlays.stepCount;
      const pages: RenderBeamerFrameResult[] = [];
      const work = options.cooperative ? new BeamerRenderWork(options.cooperative) : undefined;
      const counters = await frameCounterContext(options.graphicsResolver, work);
      const frameCounter = { beforeFrame: requireArrayValue(counters.beforeFrames, frameIndex), totalFrames: counters.totalFrames };
      for (let step = 1; step <= stepCount; step += 1) {
        if (work) await work.checkpoint();
        pages.push(
          await renderBeamerFrameStep({
            context,
            frame,
            frameIndex,
            bodyIr,
            step,
            frameCounter,
            ...(options.graphicsResolver !== undefined ? { graphicsResolver: options.graphicsResolver } : {}),
            ...(work !== undefined ? { work } : {}),
          })
        );
      }
      const continuationCount = pages[0]?.layout.continuation?.count ?? 1;
      for (let continuation = 2; continuation <= continuationCount; continuation += 1) {
        if (work) await work.checkpoint();
        pages.push(await renderBeamerFrameStep({ context, frame, frameIndex, bodyIr, step: 1, continuation, frameCounter, ...(options.graphicsResolver !== undefined ? { graphicsResolver: options.graphicsResolver } : {}), ...(work !== undefined ? { work } : {}) }));
      }
      return {
        document: context.document,
        frame,
        stepCount,
        pageCount: pages.length,
        pages,
        diagnostics: pages.flatMap((page) => page.diagnostics),
      };
    },
  };
}

/**
 * Render one Beamer frame into a fixed-page SVG and a source-addressable
 * layout contract.
 *
 * Theme names are resolved before composition. This function consumes only
 * semantic font/color roles and generic chrome primitives.
 */
export async function renderBeamerFrame(
  source: string,
  options: RenderBeamerFrameOptions = {}
): Promise<RenderBeamerFrameResult> {
  return prepareBeamerDocument(source).renderFrame(options);
}

async function renderBeamerFrameStep(params: {
  context: BeamerRenderContext;
  frame: BeamerFrameModel;
  frameIndex: number;
  bodyIr: BeamerFrameBodyIr;
  step: number;
  continuation?: number;
  frameCounter?: { beforeFrame: number; totalFrames: number };
  graphicsResolver?: DocumentGraphicsResolver;
  drawingLayer?: string;
  work?: BeamerRenderWork;
}): Promise<RenderBeamerFrameResult> {
  const { context, frame, frameIndex, bodyIr, step } = params;
  const { source, document, theme, page } = context;
  const macroBindings = context.macroBindingsForFrame(frame);
  const allowFrameBreaks = frame.options?.allowFrameBreaks;
  const shrink = resolveBeamerFrameShrink(frame);
  const continuationIndex = params.continuation ?? 1;
  if (!Number.isInteger(continuationIndex) || continuationIndex < 1) throw new RangeError("A Beamer continuation page must be a positive integer.");
  const stepCount = bodyIr.overlays.stepCount;
  const navigation = createBeamerFrameNavigationSnapshot(
    document,
    frameIndex,
    context.navigationModel
  );
  const chromeFrame = { ...frame };
  if (frame.title && resolveBeamerOverlaySpanVisibility(bodyIr.overlays, frame.title.contentSpan, step) === "removed") delete chromeFrame.title;
  if (frame.subtitle && resolveBeamerOverlaySpanVisibility(bodyIr.overlays, frame.subtitle.contentSpan, step) === "removed") delete chromeFrame.subtitle;
  const metadata = beamerMetadataWithDefaultDate(document);
  const diagnostics: Diagnostic[] = [
    ...document.diagnostics,
    ...theme.diagnostics,
  ];
  diagnostics.push(...bodyIr.diagnostics, ...context.references.diagnostics);
  // beamerbasemisc.sty redefines \includegraphics without a star: TeX reads
  // `*` as the filename. The preview keeps graphicx's clip meaning.
  for (const control of context.syntax.controlsIn(frame.bodySpan)) {
    if (control.name === "includegraphics" && control.starSpan) diagnostics.push({ severity: "warning", code: "beamer-includegraphics-star",
      message: "Beamer's \\includegraphics has no star form; LaTeX reads the star as the file name. Use the clip option instead.", span: control.span });
  }
  const inheritedMacroDeclarations = [...macroBindings.values()].some(binding => /\\(?:newcommand|renewcommand|providecommand|def|let)\b/u.test(binding.kind === "text" ? binding.value : binding.body));
  const references: BeamerReferenceContext = {
    ambientTextAt: createBeamerAmbientText(source),
    compilationDate: context.compilationDate,
    tocSections: document.sections,
    currentSectionId: frame.sectionId,
    ...context.references, step, theme, renderDiagnostics: diagnostics,
    scopedTheme: createBeamerScopedTheme(document, theme, frame.bodySpan),
    macroBindingsAt: offset => offset >= frame.bodySpan.from && (inheritedMacroDeclarations || /\\(?:newcommand|renewcommand|providecommand|def|let)\b/u.test(source.slice(frame.bodySpan.from, offset)))
      ? context.macroBindingsAt(offset) : macroBindings,
    tikzLayer: beamerTikzLayerState(source) === "ours",
    overlayPictures: beamerOverlayPicturesIn({ source, syntax: context.syntax }, frame.bodySpan),
    paragraphPaint: new Map(),
    layoutFailures: new Map(),
    itemActionCommitsParagraph: (mapped, sourceEnd) => beamerItemActionCommitsParagraph(mapped, sourceEnd, bodyIr.overlays.items, bodyIr.overlays.commands),
    crampedLists: shrink != null || (frame.options?.entries.some(entry => entry.key === "squeeze") ?? false),
    ...(allowFrameBreaks != null ? { continuationBreaks: collectBeamerContinuationBreaks(context.syntax, frame) } : {}),
    footnotes: buildBeamerFrameFootnotes(document, context.syntax, frame, context.overlaysByFrameId, step, theme.templates.block.id.includes("/rounded")),
    tableRegisters: parseSimpleTexTabularRegisters(source.slice(document.preamble.span.from, document.preamble.span.to)),
    arrayPackage: context.syntax.controlsIn(document.preamble.span).some(control => {
      if (control.name !== "usepackage" && control.name !== "RequirePackage") return false;
      const optional = context.syntax.argumentAfter(control.span.to, "optional", document.preamble.span.to);
      const names = context.syntax.argumentAfter(optional?.span.to ?? control.span.to, "required", document.preamble.span.to);
      return names?.complete === true && source.slice(names.contentSpan.from, names.contentSpan.to).split(",").some(name => name.trim() === "array");
    }),
  };
  references.inlineFlow = [];
  references.blockThemeAt = createBeamerAmbientBlockTheme(source, offset => references.scopedTheme?.at(offset) ?? theme);
  references.frameLayout = { paperHeight: page.page.height, textHeight: page.page.height,
    plain: frame.options?.plain ?? false, metadata };
  const metadataMeasurements: { value: NonNullable<BeamerFrameModel["title"]>; role: BeamerThemeFontRole; width: number }[] = [];
  const planChrome = () => planBeamerFrameChrome({
    document: { ...document, preamble: { ...document.preamble, metadata } },
    frame: chromeFrame,
    frameIndex: (params.frameCounter?.beforeFrame ?? frameIndex) + (frame.options?.noFrameNumbering ? -1 : allowFrameBreaks == null ? 0 : continuationIndex - 1),
    totalFrames: params.frameCounter?.totalFrames ?? document.frames.length,
    navigation,
    step,
    page,
    theme,
    measureTemplateTextWidth: (text, role) => {
      const measured = layoutParagraph({ mapped: createGeneratedMappedText(text, "Beamer template measurement", frame.span),
        sourceSpan: frame.span, paragraphId: `${frame.id}:${role}:width`, role: "body",
        bounds: { x: 0, y: 0, width: 10000, height: 0 }, font: theme.fonts[role], alignment: "left", macroBindings,
        references: { ...references, renderDiagnostics: [] }, paperWidth: page.page.width });
      return Number(measured?.layout.report.lines[0]?.naturalWidth ?? 0);
    },
    measureFrameHeading: (value, role, width, struts) => {
      if (/\\begin\s*\{(?:columns|block|alertblock|exampleblock)\}/u.test(value.value) && !metadataMeasurements.some(request => request.value.contentSpan.from === value.contentSpan.from && request.width === width)) metadataMeasurements.push({ value, role, width });
      const projection = projectBeamerOverlayText(createIdentityMappedText(source.slice(value.contentSpan.from, value.contentSpan.to), value.contentSpan.from),
        value.contentSpan, { ...bodyIr.overlays, pauses: [] }, step);
      const mapped = concatMappedText([createGeneratedMappedText((struts?.start ?? "\\strut") + " {", "Beamer heading strut", value.span),
        projection.mapped, createGeneratedMappedText("}" + (struts?.end ?? "\\strut"), "Beamer heading strut", value.span)]);
      const font = theme.fonts[role];
      const measured = layoutParagraph({ mapped, sourceSpan: value.contentSpan, paragraphId: `${frame.id}:${role}:measure`, role,
        bounds: { x: 0, y: 0, width, height: 0 }, font, alignment: "left", macroBindings,
        initialBaselineSkipPt: struts?.baselineSkipPt ?? font.lineHeightPt,
        references: { ...references, renderDiagnostics: [] }, ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}), paperWidth: page.page.width });
      return measured ? { firstHeight: paragraphStartingMaterialHeight(measured), extent: paragraphMaterialExtent(measured),
        endingDepth: paragraphEndingMaterialDepth(measured), baselineSkip: paragraphStartingBaselineSkip(measured, font.lineHeightPt),
        xHeight: fontXHeightPt(font) } : null;
    },
    measureSidebarMetadata: (value, role, width) => {
      const measured = layoutParagraph({ mapped: createIdentityMappedText(value.value, value.contentSpan.from), sourceSpan: value.contentSpan,
        paragraphId: `${frame.id}:${role}:measure`, role: "body", bounds: { x: 0, y: 0, width, height: 0 }, font: theme.fonts[role],
        alignment: "center", disableAutomaticHyphenation: true, macroBindings, references: { ...references, renderDiagnostics: [] }, paperWidth: page.page.width });
      return measured ? { firstHeight: paragraphStartingMaterialHeight(measured), extent: paragraphMaterialExtent(measured), endingDepth: paragraphEndingMaterialDepth(measured) } : null;
    },
  });
  let chrome = planChrome();
  for (const request of metadataMeasurements) {
    const { scopedTheme: _scopedTheme, ...headerReferences } = references;
    const font = theme.fonts[request.role];
    await prepareInlineFlow({ source, frame: { ...frame, bodySpan: request.value.contentSpan },
      bodyIr: { ...bodyIr, children: [], span: request.value.contentSpan },
      theme: { ...theme, fonts: { ...theme.fonts, "normal-text": font, "block-body": font } },
      references: headerReferences, macroBindings, textWidth: page.textArea.width, paperWidth: page.page.width,
      leftSidebarWidth: page.frameArea.x, overlays: bodyIr.overlays, step, diagnostics,
      ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
      ...(params.work !== undefined ? { work: params.work } : {}),
    });
  }
  if (metadataMeasurements.length) chrome = planChrome();
  const extractedPictures = new Set<number>();
  const collectExtracted = (nodes: readonly (BeamerFrameBodyNode | BeamerColumnFlowNode)[]): void => {
    for (const node of nodes) {
      if (node.kind === "tikzpicture") extractedPictures.add(node.root.span.from);
      else if (node.kind === "columns") for (const column of node.columns) collectExtracted(column.children);
      else if (node.kind === "block" || node.kind === "theorem") collectExtracted(node.children);
    }
  };
  collectExtracted(bodyIr.children);
  const picturePaintOwners: BeamerPicturePaintOwner[] = [];
  const inlinePictures: BeamerInlinePicture[] = [];
  for (const root of frame.children) {
    if (extractedPictures.has(root.span.from) || references.overlayPictures?.some(p => p.span.from === root.span.from)) continue;
    const visibility = resolveBeamerOverlaySpanVisibility(bodyIr.overlays, root.span, step);
    if (visibility === "removed") continue;
    const tikz = await prepareEmbeddedTikz({ source, theme, node: { kind: "tikzpicture", id: root.id, span: root.span, root, horizontalAlignment: "left" },
      width: Number.POSITIVE_INFINITY, bodyFont: theme.fonts["normal-text"], diagnostics, visibility, overlays: bodyIr.overlays, step,
      ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
      ...(params.work !== undefined ? {work:params.work} : {}) });
    if (tikz) inlinePictures.push({span:root.span,tikz});
  }
  references.inlinePictures = inlinePictures;
  const items: BeamerFrameLayoutItem[] = [];
  const spacing: BeamerSpacingLayout[] = [];
  const paragraphs: BeamerParagraphLayout[] = [];
  const embeddedTikz: BeamerEmbeddedTikzLayout[] = [];
  const modelBuilder = createSvgModelBuilder();
  const pageBackground =
    resolveBeamerThemeColor(theme, "background canvas").bg ?? "#ffffff";

  items.push({
    id: `${frame.id}:background`,
    kind: "background",
    sourceSpan: frame.span,
    bounds: page.page,
    parentId: null,
  });
  modelBuilder.addPart({
    basePartId: `${frame.id}:background`,
    sourceId: frame.id,
    elementId: null,
    markup: rectMarkup(page.page, pageBackground),
  });
  const footnoteInsertion = prepareFrameFootnoteInsertion({
    source, frame, references, theme, textWidth: page.textArea.width,
    paperWidth: page.page.width, macroBindings, overlays: bodyIr.overlays, step,
    ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
  });
  const availableContentBounds: BeamerRect = {
    x: page.textArea.x,
    y: frame.options?.plain ? chrome.frameTitleInset : chrome.topInset,
    width: shrink ? beamerFrameShrinkWidth(page.textArea.width, shrink) : page.textArea.width,
    height: Math.max(
      0,
      page.page.height - (frame.options?.plain ? chrome.frameTitleInset + chrome.bottomInset : chrome.topInset + chrome.bottomInset) - (allowFrameBreaks == null ? footnoteInsertion.height : 0)
    ),
  };
  let contentBounds = availableContentBounds;
  let bodyTransform: BeamerPaintTransform | undefined;
  const bodyModelBuilder = createSvgModelBuilder();
  references.frameLayout = { paperHeight: page.page.height, textHeight: page.page.height - chrome.headlineInset - chrome.bottomInset,
    plain: frame.options?.plain ?? false, metadata };
  await prepareInlineFlow({ source, frame, bodyIr, theme, references, macroBindings,
    textWidth: availableContentBounds.width, paperWidth: page.page.width, leftSidebarWidth: page.frameArea.x,
    overlays: bodyIr.overlays, step, diagnostics,
    ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
    ...(params.work !== undefined ? { work: params.work } : {}),
  });
  const preparedFrameFlow = await prepareFrameFlow({
    source,
    children: bodyIr.children,
    textWidth: availableContentBounds.width,
    paperWidth: page.page.width,
    leftSidebarWidth: page.frameArea.x,
    paperHeight: page.page.height,
    textHeight: page.page.height - chrome.headlineInset - chrome.bottomInset,
    plain: frame.options?.plain ?? false,
    availableHeight: allowFrameBreaks == null && !shrink
      ? Math.max(0, availableContentBounds.height - (frame.options?.alignment === "top" ? TOP_ALIGNED_FRAME_SKIP_PT : 0))
      : Number.POSITIVE_INFINITY,
    diagnostics,
    theme,
    metadata,
    macroBindings,
    references,
    overlays: bodyIr.overlays,
    step,
    ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
    ...(params.work !== undefined ? { work: params.work } : {}),
  });
  const continuationPages = allowFrameBreaks == null ? null : splitBeamerFrameContinuations({
    flow: preparedFrameFlow, baselineSkip: theme.fonts["normal-text"].lineHeightPt,
    plain: frame.options?.plain ?? false, factor: allowFrameBreaks,
    paperHeight: page.page.height, textHeight: page.page.height - chrome.headlineInset - chrome.bottomInset,
    titleHeight: chrome.frameTitleInset, alignment: frame.options?.alignment ?? "center",
    footnoteHeight: footnoteInsertion.height, breaks: requireDefined(references.continuationBreaks, "Expected an internal render value"),
    plainExitHeight: frame.options?.plain ? chrome.bottomInset : 0,
  });
  const continuationCount = continuationPages?.length ?? 1;
  if (continuationIndex > continuationCount) throw new RangeError(`Beamer continuation page ${continuationIndex} is outside the frame's ${continuationCount} pages.`);
  renderChrome({ chrome, theme, items, paragraphs, modelBuilder, macroBindings, references,
    ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}), paperWidth: page.page.width,
    overlays: bodyIr.overlays, step,
    ...(continuationPages ? { continuationSuffix: beamerContinuationTitleSuffix(document, continuationIndex, continuationCount) } : {}),
  });
  const bodyItemStart = items.length;
  const bodyParagraphStart = paragraphs.length;
  if (preparedFrameFlow.length > 0) {
    const rigidPositioned = positionPreparedFrameFlow(
      preparedFrameFlow,
      theme.fonts["normal-text"].lineHeightPt,
      0,
      // beamerbaseframe.sty issues \nointerlineskip after its initial
      // empty vbox on plain frames, before the first authored material.
      frame.options?.plain ? null : 0
    );
    const verticalPacking = resolveFrameVerticalPacking(
      availableContentBounds,
      rigidPositioned.extent,
      preparedFrameFlow,
      shrink ? "top" : frame.options?.alignment ?? "center",
      theme.options["symmetric-frame-center"] === true
    );
    const positioned = continuationPages?.[continuationIndex - 1] ?? positionPreparedFrameFlow(
      preparedFrameFlow,
      theme.fonts["normal-text"].lineHeightPt,
      shrink ? 0 : verticalPacking.fillUnit,
      frame.options?.plain ? null : 0
    );
    const shrinkTopSkip = shrink && frame.options?.alignment === "top" ? TOP_ALIGNED_FRAME_SKIP_PT : 0;
    const frameBlockTop = availableContentBounds.y + (continuationPages ? 0 : shrink ? shrinkTopSkip : verticalPacking.topOffset);
    if (shrink) {
      bodyTransform = beamerFrameBodyTransform(beamerFrameShrinkScale(shrink, rigidPositioned.extent, availableContentBounds.height - shrinkTopSkip),
        { x: availableContentBounds.x, y: frameBlockTop });
    }
    for (const placement of positioned.items) {
      if (params.work) await params.work.checkpoint();
      if (
        placement.item.visibility === "hidden" &&
        !["block", "paragraph", "columns", "tikzpicture"].includes(placement.item.kind)
      ) {
        continue;
      }
      if (placement.item.kind === "title-page") {
        emitPreparedTitlePage({
          prepared: placement.item.titlePage,
          fillUnit: verticalPacking.fillUnit,
          x: availableContentBounds.x,
          y: frameBlockTop + placement.contentTop,
          items,
          paragraphs,
          modelBuilder: bodyModelBuilder,
          theme,
        });
      } else if (placement.item.kind === "paragraph") {
        emitFrameParagraph({
          prepared: placement.item,
          x: availableContentBounds.x,
          y: frameBlockTop + placement.contentTop,
          items,
          paragraphs,
          modelBuilder: bodyModelBuilder,
          theme,
        });
      } else if (placement.item.kind === "columns") {
        await emitPreparedColumns({
          prepared: placement.item,
          referenceY: frameBlockTop + placement.referenceY,
          spacing,
          bounds: availableContentBounds,
          paperWidth: page.page.width,
          items,
          paragraphs,
          embeddedTikz,
          modelBuilder: bodyModelBuilder,
          theme,
          ...(params.work !== undefined ? { work: params.work } : {}),
        });
      } else if (placement.item.kind === "contents") {
        const contents = placement.item.contents;
        for (const row of contents.rows) {
          const y = frameBlockTop + placement.contentTop + row.top + row.fillWeight * verticalPacking.fillUnit;
          const x = availableContentBounds.x;
          const emit = (paragraph: LaidParagraph, px: number, py: number, color: string) => {
            positionParagraphLayout(paragraph.layout, svgPoint(pt(px), pt(py)));
            paragraphs.push(paragraph.layout);
            items.push({ id: paragraph.layout.paragraphId, kind: "text", sourceSpan: paragraph.layout.sourceSpan,
              bounds: paragraph.layout.bounds, parentId: contents.node.id, paragraphId: paragraph.layout.paragraphId });
            bodyModelBuilder.addPart({ basePartId: paragraph.layout.paragraphId, sourceId: paragraph.layout.paragraphId, elementId: null,
              markup: paragraphMarkup(paragraph.svgBody, px, py, color) });
          };
          emit(row.paragraph, x + row.x, y, textColor(theme, row.colorRole));
          const top = frameBlockTop + placement.contentTop + row.fillWeight * verticalPacking.fillUnit;
          if (row.marker) {
            const id = `${row.paragraph.layout.paragraphId}:marker`;
            items.push({ id, kind: "list-marker", sourceSpan: row.paragraph.layout.sourceSpan,
              bounds: { ...row.marker.bounds, x: x + row.marker.bounds.x, y: top + row.marker.bounds.y }, parentId: contents.node.id });
            bodyModelBuilder.addPart({ basePartId: id, sourceId: id, elementId: null, markup: `<g transform="translate(${x} ${top})">${row.marker.markup}</g>` });
          }
          if (row.number) emit(row.number.paragraph, x + row.number.x, top + row.number.top, textColor(theme, "section number projected text"));
        }
      } else if (placement.item.kind === "tikzpicture") {
        const tikz = placement.item.tikz;
        const x = tikz.horizontalAlignment === "center"
          ? availableContentBounds.x +
            (availableContentBounds.width - tikz.width) / 2
          : availableContentBounds.x + (tikz.horizontalAlignment === "right" ? availableContentBounds.width - tikz.width : 0);
        emitEmbeddedTikz({
          tikz,
          x,
          y:
            frameBlockTop +
            placement.contentTop +
            placement.item.contentInsetTop,
          parentId: null,
          items,
          embeddedTikz,
          modelBuilder: bodyModelBuilder,
        });
      } else if (placement.item.kind === "unsupported") {
        emitUnsupportedPlaceholder({
          placeholder: placement.item.placeholder,
          x: availableContentBounds.x,
          y: frameBlockTop + placement.contentTop,
          parentId: null,
          items,
          modelBuilder: bodyModelBuilder,
        });
      } else if (placement.item.kind === "vertical-space") {
        const item = placement.item;
        spacing.push({ command: item.node.command, sourceSpan: item.node.span, sizePt: item.height,
          ...(item.relativeUnitPt !== undefined ? { relativeUnitPt: item.relativeUnitPt } : {}),
          bounds: { x: availableContentBounds.x, y: frameBlockTop + placement.contentTop,
            width: availableContentBounds.width, height: item.height } });
      } else {
        await emitPreparedBlock({
          spacing, embeddedTikz, paperWidth: page.page.width,
          ...(params.work !== undefined ? { work: params.work } : {}),
          prepared: placement.item.block,
          x: availableContentBounds.x,
          y: frameBlockTop + placement.contentTop,
          parentId: null,
          items,
          paragraphs,
          modelBuilder: bodyModelBuilder,
          theme,
          visibility:
            placement.item.visibility === "hidden" ? "hidden" : "visible",
        });
      }
    }
    const visualTop = Math.min(
      ...positioned.items.map((placement) => placement.visualTop)
    );
    const visualBottom = Math.max(
      ...positioned.items.map((placement) => placement.visualBottom)
    );
    contentBounds = {
      ...availableContentBounds,
      y: frameBlockTop + visualTop,
      height: Math.max(0, visualBottom - visualTop),
    };
  } else if (
    bodyIr.children.some((node) =>
      resolveBeamerOverlaySpanVisibility(bodyIr.overlays, node.span, step) === "visible" &&
      hasProjectedContent(source, node.span, bodyIr.overlays, step, references)
    )
  ) {
    const message = "This Beamer frame body could not be laid out.";
    const placeholder = prepareUnsupportedPlaceholder(
      source,
      { id: `${frame.id}:unsupported-body`, span: frame.bodySpan, message },
      availableContentBounds.width
    );
    emitUnsupportedPlaceholder({
      placeholder,
      x: availableContentBounds.x,
      y: availableContentBounds.y,
      parentId: null,
      items,
      modelBuilder: bodyModelBuilder,
    });
    diagnostics.push({
      severity: "warning",
      code: "beamer-render-unsupported-body",
      message,
      span: frame.bodySpan,
    });
  }

  // Emitting an external container can append paragraphs that themselves
  // own structural boxes. Visit the growing list so arbitrary nesting paints.
  for (const paragraph of paragraphs) {
    for (const external of references.inlineFlow ?? []) {
      const box = paragraph.vlistLayout.boxReport.items.find(item => item.hboxRole?.kind === "external-flow" && item.sourceSpan?.start === external.span.from && item.sourceSpan.end === external.span.to);
      if (!box) continue;
      const visibility = external.item.visibility === "hidden" || paragraph.hiddenSourceSpans?.some(span => span.from <= external.span.from && external.span.to <= span.to) ? "hidden" : "visible";
      const local = createSvgModelBuilder();
      const x = paragraph.role === "frame-title" || paragraph.role === "frame-subtitle" ? page.frameArea.x : paragraph.bounds.x;
      const y = paragraph.bounds.y + Number(box.y);
      const item = external.item;
      if (item.kind === "block") await emitPreparedBlock({ prepared: item.block, x, y,
        parentId: paragraph.paragraphId, visibility, items, paragraphs, spacing, embeddedTikz, modelBuilder: local,
        theme, paperWidth: page.page.width, ...(params.work !== undefined ? { work: params.work } : {}) });
      else await emitPreparedColumns({ prepared: item, visibility, referenceY: y + item.box.height,
        bounds: { x, y, width: external.width, height: item.box.height + item.box.depth },
        items, paragraphs, spacing, embeddedTikz, modelBuilder: local, theme,
        paperWidth: page.page.width, ...(params.work !== undefined ? { work: params.work } : {}) });
      const id = item.node.id;
      const markup = local.build({ viewBox: page.page, defs: [], diagnostics: [] }).parts.map(part => part.markup).join("");
      (paragraph.role === "frame-title" || paragraph.role === "frame-subtitle" ? modelBuilder : bodyModelBuilder).addPart({ basePartId: id, sourceId: id, elementId: null, markup });
      picturePaintOwners.push({ paragraphId: paragraph.paragraphId, span: external.span, sourceId: id });
    }
  }
  for (const picture of inlinePictures) {
    for (const paragraph of paragraphs.slice(bodyParagraphStart)) {
      const origin = beamerOverlayPictureOrigin(paragraph, paragraph.bounds, picture.span);
      if (!origin) continue;
      picturePaintOwners.push({ paragraphId: paragraph.paragraphId, span: picture.span, sourceId: picture.tikz.id });
      emitEmbeddedTikz({ tikz: picture.tikz, x: origin.x, y: origin.y - picture.tikz.height,
        parentId: items.find(item => item.paragraphId === paragraph.paragraphId)?.parentId ?? null,
        items, embeddedTikz, modelBuilder: bodyModelBuilder });
      break;
    }
  }
  const bodyItemEnd = items.length;
  const bodyParagraphEnd = paragraphs.length;
  const bodyModel = bodyModelBuilder.build({ viewBox: page.page, defs: [], diagnostics: [] });
  const transformMarkup = bodyTransform ? `matrix(${bodyTransform.map(fmt).join(" ")})` : null;
  for (const part of bodyModel.parts) {
    const markup = transformMarkup ? `<g transform="${transformMarkup}">${part.markup}</g>` : part.markup;
    modelBuilder.addExistingPart({ ...part, markup, fingerprint: markup });
  }

  if (continuationIndex === continuationCount) emitFrameFootnoteInsertion({
    prepared: footnoteInsertion,
    x: page.textArea.x,
    y: page.page.height - chrome.bottomInset - footnoteInsertion.height,
    width: page.textArea.width,
    items, paragraphs, modelBuilder, theme,
  });
  spacing.push(...collectBeamerParagraphSpacing(paragraphs, items));
  const graphics = collectBeamerGraphicsLayout(paragraphs, items);
  if (bodyTransform) {
    const bodyParagraphIds = new Set(paragraphs.slice(bodyParagraphStart, bodyParagraphEnd).map(paragraph => paragraph.paragraphId));
    for (const item of items.slice(bodyItemStart, bodyItemEnd)) item.bounds = transformBeamerRect(bodyTransform, item.bounds);
    for (const paragraph of paragraphs.slice(bodyParagraphStart, bodyParagraphEnd)) {
      paragraph.transformedLayout = { intrinsicBounds: { ...paragraph.bounds }, paintTransform: bodyTransform };
      paragraph.bounds = transformBeamerRect(bodyTransform, paragraph.bounds);
      for (const span of [...paragraph.editableTextSpans, ...paragraph.atomicRenderSpans]) {
        span.hitBounds = span.hitBounds.map(rect => {
          const transformed = transformBeamerRect(bodyTransform, rect);
          return svgRect(transformed.x, transformed.y, transformed.width, transformed.height);
        });
      }
      if (paragraph.links) paragraph.links = paragraph.links.map(link => ({ ...link, bounds: {
        x: link.bounds.x * bodyTransform[0], y: link.bounds.y * bodyTransform[3],
        width: link.bounds.width * bodyTransform[0], height: link.bounds.height * bodyTransform[3],
      } }));
    }
    for (const tikz of embeddedTikz) {
      tikz.transformedLayout = { intrinsicBounds: { ...tikz.bounds }, paintTransform: bodyTransform };
      tikz.bounds = transformBeamerRect(bodyTransform, tikz.bounds);
    }
    for (const graphic of graphics.filter(graphic => bodyParagraphIds.has(graphic.paragraphId))) {
      graphic.bounds = transformBeamerRect(bodyTransform, graphic.bounds);
      graphic.baselineY = transformBeamerPoint(bodyTransform, { x: 0, y: graphic.baselineY }).y;
      const item = items.find(item => item.id === graphic.itemId);
      if (item) item.bounds = graphic.bounds;
    }
    for (const entry of spacing.filter(entry => frame.bodySpan.from <= entry.sourceSpan.from && entry.sourceSpan.to <= frame.bodySpan.to)) {
      const origin = transformBeamerPoint(bodyTransform, entry.bounds);
      entry.bounds = { ...origin, width: entry.bounds.width * bodyTransform[0], height: entry.bounds.height * bodyTransform[3] };
      entry.sizePt *= bodyTransform[3];
      if (entry.relativeUnitPt != null) entry.relativeUnitPt *= bodyTransform[3];
    }
    contentBounds = transformBeamerRect(bodyTransform, contentBounds);
  }
  await emitBeamerOverlayPictures({
    overlays: bodyIr.overlays, step,
    picturePaintOwners,
    context: { source, syntax: context.syntax },
    frameId: frame.id,
    frameIndex,
    bodySpan: frame.bodySpan,
    paragraphs: paragraphs.slice(bodyParagraphStart, bodyParagraphEnd),
    bodyTransform,
    page: page.page,
    font: theme.fonts["normal-text"],
    diagnostics,
    items,
    embeddedTikz,
    modelBuilder,
    ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
    ...(params.drawingLayer !== undefined ? { drawingLayer: params.drawingLayer } : {}),
    ...(params.work !== undefined ? { work: params.work } : {}),
  });
  const model = interleaveBeamerPicturePaint(modelBuilder.build({
    viewBox: page.page,
    defs: [],
    diagnostics: diagnostics.map((diagnostic) => ({
      code: diagnostic.code ?? "beamer-render",
      message: diagnostic.message,
    })),
  }), picturePaintOwners, references.paragraphPaint ?? new Map());
  // The body parser labels picture roots with span-local ids; the document
  // root ids (`frame:i:tikzpicture:j`, nested figure addressing) come from
  // the scan model. Rebind each published picture item to the scan child
  // whose begin token it contains.
  for (const item of items) {
    if (item.kind !== "tikzpicture" || item.overlayPicture) {
      continue;
    }
    const child = frame.children.find(
      (candidate) =>
        item.sourceSpan.from <= candidate.beginSpan.from &&
        candidate.beginSpan.to <= item.sourceSpan.to
    );
    if (child) item.rootId = child.id;
    else delete item.rootId;
  }
  const editScopes = collectBeamerEditScopes(frame, bodyIr, document.preamble.metadata);
  const inlineScopes = collectBeamerEditScopes(frame, { ...bodyIr, children: (references.inlineFlow ?? []).map(box => box.item.node) });
  for (const scope of inlineScopes) if (scope.kind === "column" && !editScopes.some(existing => existing.span.from === scope.span.from && existing.span.to === scope.span.to)) editScopes.push(scope);
  const recovery = collectBeamerRecovery(source, editScopes);
  diagnostics.push(...beamerRecoveryDiagnostics(recovery));
  const layout: BeamerFrameLayout = {
    coordinateSystem: {
      unit: "tex-pt",
      origin: "top-left",
      yAxis: "down",
    },
    frameId: frame.id,
    frameIndex,
    step,
    stepCount,
    ...(continuationPages ? { continuation: { index: continuationIndex, count: continuationCount } } : {}),
    page,
    contentBounds,
    ...(bodyTransform ? { bodyTransform } : {}),
    items,
    paragraphs,
    graphics,
    spacing,
    embeddedTikz,
    overlayBranches: bodyIr.overlays.commands.flatMap((command) => command.branches.map((branch) => ({
      span: branch.contentSpan,
      visible: resolveBeamerOverlaySpanVisibility(bodyIr.overlays, branch.contentSpan, step) === "visible",
    }))),
    editScopes,
    ...(recovery.closers.length > 0 || recovery.strays.length > 0 ? { recovery } : {}),
  };

  params.work?.options.signal?.throwIfAborted();
  return {
    document,
    frame,
    layout,
    svg: {
      svg: serializeSvgModel(model),
      viewBox: model.viewBox,
      model,
      diagnostics: model.diagnostics,
    },
    diagnostics,
  };
}

function collectBeamerGraphicsLayout(
  paragraphs: readonly BeamerParagraphLayout[],
  items: BeamerFrameLayoutItem[]
): BeamerGraphicsLayout[] {
  const paragraphItemById = new Map(
    items
      .filter((item) => item.paragraphId)
      .map((item) => [requireDefined(item.paragraphId, "Expected an internal render value"), item])
  );
  const graphics: BeamerGraphicsLayout[] = [];
  for (const paragraph of paragraphs) {
    const paragraphItem = paragraphItemById.get(paragraph.paragraphId);
    for (const placement of paragraph.vlistLayout.graphicsPlacements) {
      const sourceSpan = {
        from: Number(placement.sourceSpan.start),
        to: Number(placement.sourceSpan.end),
      };
      const hidden =
        paragraphItem?.visibility === "hidden" ||
        paragraph.hiddenSourceSpans?.some((span) =>
          span.from <= sourceSpan.from && span.to >= sourceSpan.to
        ) === true;
      const graphic: BeamerGraphicsLayout = {
        itemId: placement.id,
        paragraphId: paragraph.paragraphId,
        lineIndex: placement.lineIndex,
        sourceSpan,
        filenameSpan: {
          from: Number(placement.filenameSpan.start),
          to: Number(placement.filenameSpan.end),
        },
        bounds: {
          x: paragraph.bounds.x + Number(placement.bounds.x),
          y: paragraph.bounds.y + Number(placement.bounds.y),
          width: Number(placement.bounds.width),
          height: Number(placement.bounds.height),
        },
        baselineY: paragraph.bounds.y + Number(placement.baselineY),
        asset: placement.asset,
        options: placement.options,
        caretPolicy: placement.caretPolicy,
        visibility: hidden ? "hidden" : "visible",
        ...(placement.crop
          ? {
              crop: {
                x: Number(placement.crop.x),
                y: Number(placement.crop.y),
                width: Number(placement.crop.width),
                height: Number(placement.crop.height),
                clip: placement.crop.clip,
              },
            }
          : {}),
      };
      graphics.push(graphic);
      items.push({
        id: graphic.itemId,
        kind: "graphics",
        sourceSpan: graphic.sourceSpan,
        bounds: graphic.bounds,
        parentId: paragraph.paragraphId,
        visibility: graphic.visibility,
      });
      if (paragraphItem) {
        paragraphItem.childIds = [
          ...(paragraphItem.childIds ?? []),
          graphic.itemId,
        ];
      }
    }
  }
  return graphics;
}

/**
 * Render every overlay page emitted by one source frame, in Beamer page
 * order. A frame without overlay material yields exactly one page.
 */
export async function renderBeamerFramePages(
  source: string,
  options: RenderBeamerFramePagesOptions = {}
): Promise<RenderBeamerFramePagesResult> {
  return prepareBeamerDocument(source).renderFramePages(options);
}

function renderChrome(params: {
  chrome: BeamerFrameChromePlan;
  theme: ResolvedBeamerTheme;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  graphicsResolver?: DocumentGraphicsResolver;
  paperWidth: number;
  continuationSuffix?: string;
  overlays: BeamerOverlayModel;
  step: number;
}): void {
  const { chrome, theme, items, paragraphs, modelBuilder } = params;
  for (const primitive of chrome.primitives) {
    if (primitive.kind === "fill") {
      const color = resolveBeamerThemeColor(theme, primitive.colorRole);
      modelBuilder.addPart({
        basePartId: primitive.id,
        sourceId: primitive.id,
        elementId: null,
        markup: rectMarkup(
          primitive.bounds,
          primitive.paint === "foreground"
            ? color.fg ?? color.bg ?? "transparent"
            : color.bg ?? color.fg ?? "transparent",
          primitive.id
        ),
      });
      items.push({
        id: primitive.id,
        kind: primitive.id.includes(":frame-title:")
          ? "frame-title"
          : "background",
        sourceSpan: primitive.sourceSpan,
        bounds: primitive.bounds,
        parentId: null,
        ...(primitive.id.endsWith(":progress") ? { traceAsRule: false }
          : primitive.id.endsWith(":progress-background") ? { traceAsRule: true } : {}),
      });
      continue;
    }

    if (primitive.kind === "vector") {
      modelBuilder.addPart({
        basePartId: primitive.id,
        sourceId: primitive.id,
        elementId: null,
        markup: vectorTemplateMarkup(primitive, theme),
      });
      items.push({
        id: primitive.id,
        kind: primitive.layoutKind,
        sourceSpan: primitive.sourceSpan,
        bounds: primitive.bounds,
        parentId: null,
      });
      continue;
    }

    const isFrameHeading = primitive.fontRole === "frame-title" || primitive.fontRole === "frame-subtitle";
    const projection = isFrameHeading ? projectBeamerOverlayText(
      mappedTemplateText(primitive), primitive.sourceSpan,
      // An authored body pause does not cover the separately built title box.
      { ...params.overlays, pauses: params.overlays.pauses.filter(pause =>
        primitive.sourceSpan.from <= pause.span.from && pause.span.to <= primitive.sourceSpan.to) },
      params.step
    ) : { mapped: mappedTemplateText(primitive), hiddenSourceSpans: [] };
    const templateMapped = primitive.unbreakable ? concatMappedText([
      createGeneratedMappedText("\\mbox{", "Beamer short metadata hbox", primitive.sourceSpan), projection.mapped,
      createGeneratedMappedText("}", "Beamer short metadata hbox", primitive.sourceSpan),
    ]) : projection.mapped;
    let mapped = primitive.fontRole === "frame-title" && params.continuationSuffix != null
      ? concatMappedText([projection.mapped, createGeneratedMappedText(params.continuationSuffix, "Beamer continuation title", primitive.sourceSpan)])
      : templateMapped;
    if (isFrameHeading && params.references.inlineFlow?.some(box => primitive.sourceSpan.from <= box.span.from && box.span.to <= primitive.sourceSpan.to)) {
      mapped = concatMappedText([createGeneratedMappedText("\\strut {", "Beamer structural heading strut", primitive.sourceSpan), mapped,
        createGeneratedMappedText("}\\strut", "Beamer structural heading strut", primitive.sourceSpan)]);
    }
    const font = theme.fonts[primitive.fontRole];
    const laid = layoutParagraph({
      mapped,
      sourceSpan: primitive.sourceSpan,
      paragraphId: primitive.id,
      role: paragraphRole(primitive.fontRole),
      bounds: primitive.bounds,
      font,
      colorResolver: beamerAlertColorResolver(theme),
      alignment: primitive.alignment,
      ...(primitive.baselineSkipPt !== undefined ? { initialBaselineSkipPt: primitive.baselineSkipPt } : {}),
      ...(primitive.justify !== undefined ? { justify: primitive.justify } : {}),
      ...(primitive.interwordSpacePt !== undefined ? { interwordSpacePt: primitive.interwordSpacePt } : {}),
      ...(primitive.disableAutomaticHyphenation !== undefined ? { disableAutomaticHyphenation: primitive.disableAutomaticHyphenation } : {}),
      macroBindings: params.macroBindings,
      references: params.references,
      ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
      paperWidth: params.paperWidth,
      hiddenSourceSpans: projection.hiddenSourceSpans,
    });
    if (!laid) {
      continue;
    }
    const y = primitive.baselineY == null
      ? verticallyAlignedParagraphY(primitive, laid.height)
      : primitive.baselineY - firstLineBaselineOffset(laid);
    positionParagraphLayout(
      laid.layout,
      svgPoint(pt(primitive.bounds.x), pt(y))
    );
    paragraphs.push(laid.layout);
    items.push({
      id: primitive.id,
      kind: primitive.id.includes(":frame-title:")
        ? "frame-title"
        : "text",
      sourceSpan: primitive.sourceSpan,
      bounds: laid.layout.bounds,
      parentId: null,
      paragraphId: primitive.id,
    });
    modelBuilder.addPart({
      basePartId: primitive.id,
      sourceId: primitive.id,
      elementId: null,
      markup: paragraphMarkup(
        laid.svgBody,
        primitive.bounds.x,
        y,
        textColor(theme, primitive.colorRole)
      ),
    });
  }
}

function verticallyAlignedParagraphY(
  primitive: Extract<BeamerTemplatePrimitive, { kind: "text" }>,
  paragraphHeight: number
): number {
  const freeHeight = Math.max(0, primitive.bounds.height - paragraphHeight);
  return primitive.bounds.y +
    (primitive.verticalAlignment === "bottom"
      ? freeHeight
      : primitive.verticalAlignment === "center"
        ? freeHeight / 2
        : 0);
}

function firstLineBaselineOffset(paragraph: LaidParagraph): number {
  const firstLine = paragraph.layout.report.lines[0];
  if (!firstLine) {
    return 0;
  }
  const placement = paragraph.layout.vlistLayout.linePlacements.find(
    (candidate) => candidate.lineIndex === firstLine.lineIndex
  );
  return Number(placement?.y ?? 0) + Number(firstLine.ascent);
}

type PreparedFootnoteInsertion = {
  height: number;
  notes: readonly { paragraph: LaidParagraph; top: number; visibility: BeamerOverlayVisibility }[];
};

function prepareFrameFootnoteInsertion(params: {
  source: string;
  frame: BeamerFrameModel;
  references: BeamerReferenceContext;
  theme: ResolvedBeamerTheme;
  textWidth: number;
  paperWidth: number;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  overlays: BeamerOverlayModel;
  step: number;
  graphicsResolver?: DocumentGraphicsResolver;
}): PreparedFootnoteInsertion {
  const font = { ...params.theme.fonts["normal-text"], sizePt: 9, lineHeightPt: 11, series: "medium", shape: "upright" } as const;
  const notes: Array<PreparedFootnoteInsertion["notes"][number]> = [];
  let height = 0;
  let previousDepth: number | null = null;
  for (const note of params.references.footnotes?.values() ?? []) {
    const enclosingVisibility = resolveBeamerOverlaySpanVisibility(params.overlays, note.span, params.step);
    const spec = params.references.specs.get(note.span.from);
    const visibility = enclosingVisibility === "removed" ? "removed" : spec && !beamerOverlaySpecContains(spec, params.step) ? "hidden" : enclosingVisibility;
    if (visibility === "removed") continue;
    const projection = projectBeamerOverlayText(createIdentityMappedText(params.source.slice(note.bodySpan.from, note.bodySpan.to), note.bodySpan.from), note.bodySpan, params.overlays, params.step);
    const paragraph = layoutParagraph({
      mapped: beamerFootnoteTextMapped(params.source, note, font, projection.mapped), sourceSpan: note.span,
      paragraphId: `${params.frame.id}:footnote:${note.span.from}`, role: "footnote",
      bounds: { x: 0, y: 0, width: params.textWidth, height: 0 }, font,
      alignment: "left", references: params.references, macroBindings: params.macroBindings,
      hiddenSourceSpans: visibility === "hidden" ? [...projection.hiddenSourceSpans, note.span] : projection.hiddenSourceSpans,
      ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}), paperWidth: params.paperWidth,
    });
    if (!paragraph) {
      params.references.renderDiagnostics.push({ severity: "warning", code: "beamer-render-unsupported-footnote", message: "This frame footnote's content could not be laid out.", span: note.bodySpan });
      continue;
    }
    // Each invocation opens a new vbox, then unboxes the earlier notes.
    // Unboxing retains that new box's ignored prevdepth, so no interline
    // glue is inserted between separate footnote paragraphs.
    notes.push({ paragraph, top: height, visibility });
    height += paragraphMaterialExtent(paragraph);
    previousDepth = paragraphEndingMaterialDepth(paragraph);
  }
  // The frame vbox fixes its height; the final footnote strut's depth is
  // outside that height, just as in \unvbox\beamer@footins.
  return { notes, height: Math.max(0, height - (previousDepth ?? 0)) };
}

function emitFrameFootnoteInsertion(params: {
  prepared: PreparedFootnoteInsertion;
  x: number;
  y: number;
  width: number;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  theme: ResolvedBeamerTheme;
}): void {
  if (!params.prepared.notes.length) return;
  const owner = requireArrayValue(params.prepared.notes, 0).paragraph.layout;
  const color = textColor(params.theme, "footnote");
  const bounds = { x: params.x, y: params.y - 3, width: .4 * params.width, height: .4 };
  params.items.push({ id: `${owner.paragraphId}:rule:background`, kind: "text", sourceSpan: owner.sourceSpan, bounds, parentId: null });
  params.modelBuilder.addPart({ basePartId: `${owner.paragraphId}:rule`, sourceId: owner.paragraphId, elementId: null, markup: rectMarkup(bounds, color) });
  for (const { paragraph, top, visibility } of params.prepared.notes) {
    positionParagraphLayout(paragraph.layout, svgPoint(pt(params.x), pt(params.y + top)), paragraph.height);
    params.paragraphs.push(paragraph.layout);
    params.items.push({ id: paragraph.layout.paragraphId, kind: "text", sourceSpan: paragraph.layout.sourceSpan, bounds: paragraph.layout.bounds, paragraphId: paragraph.layout.paragraphId, parentId: null, visibility: visibility === "hidden" ? "hidden" : "visible" });
    params.modelBuilder.addPart({ basePartId: paragraph.layout.paragraphId, sourceId: paragraph.layout.paragraphId, elementId: null, markup: paragraphMarkup(paragraph.svgBody, params.x, params.y + top, color) });
  }
}

async function prepareInlineFlow(params: {
  source: string; frame: BeamerFrameModel; bodyIr: BeamerFrameBodyIr; theme: ResolvedBeamerTheme;
  references: BeamerReferenceContext; macroBindings: ReadonlyMap<string, MacroBinding>;
  textWidth: number; paperWidth: number; leftSidebarWidth: number; overlays: BeamerOverlayModel;
  step: number; diagnostics: Diagnostic[]; graphicsResolver?: DocumentGraphicsResolver; work?: BeamerRenderWork;
  resolvePendingLabels?: boolean;
}): Promise<void> {
  params.references.inlineFlowItemLabels ??= new Map();
  params.references.inlineFlowLabelState ??= { revision: 0 };
  const context = createBeamerSyntaxContext(params.source);
  const extracted = new Set<number>();
  const collect = (nodes: readonly (BeamerFrameBodyNode | BeamerColumnFlowNode)[]) => {
    for (const node of nodes) {
      if (node.kind === "columns") { extracted.add(node.span.from); for (const column of node.columns) collect(column.children); }
      else if (node.kind === "block" || node.kind === "theorem") { extracted.add(node.span.from); collect(node.children); }
    }
  };
  collect(params.bodyIr.children);
  const environments = [...matchTexSyntaxEnvironments(context.syntax).values()];
  const candidates = environments.filter(env => ["block", "alertblock", "exampleblock", "columns"].includes(env.name) &&
    env.begin.span.from >= params.frame.bodySpan.from && env.end.span.to <= params.frame.bodySpan.to && !extracted.has(env.begin.span.from))
    .sort((a, b) => (a.end.span.to - a.begin.span.from) - (b.end.span.to - b.begin.span.from));
  for (const env of candidates) {
    if (params.work) await params.work.checkpoint();
    const span = { from: env.begin.span.from, to: env.end.span.to };
    const ir = parseBeamerFrameBody({ source: params.source, syntax: context.syntax,
      frame: { ...params.frame, id: `${params.frame.id}:inline:${span.from}`, span, bodySpan: span }, overlays: params.overlays });
    const ancestors = environments.filter(parent => parent.begin.span.from < span.from && parent.end.span.to > span.to).sort((a, b) => a.begin.span.from - b.begin.span.from);
    let width = params.textWidth;
    for (const parent of ancestors) {
      if (parent.name === "column") {
        const optional = beamerOptionalArgumentAfter(context, parent.begin.span.to, parent.contentSpan.to);
        const dimension = beamerRequiredArgumentAfter(context, optional?.span.to ?? parent.begin.span.to, parent.contentSpan.to);
        if (dimension) width = requireDefined(resolveBeamerColumnWidth(dimension.value, width, params.paperWidth), "Expected a supported enclosing column width");
      }
    }
    const inherited = params.references.ambientTextAt?.(span.from) ?? "";
    const theme = ambientTextTheme(params.references.scopedTheme?.at(span.from) ?? params.theme, inherited);
    const flow = await prepareFrameFlow({ ...params, children: ir.children, theme, textWidth: width,
      ...requireDefined(params.references.frameLayout, "Expected enclosing frame geometry"), availableHeight: Number.POSITIVE_INFINITY });
    const item = flow.find(item => item.kind === "block" || item.kind === "columns");
    if (item?.kind === "block" || item?.kind === "columns") {
      const labelTargetOffset = environments.filter(child => ["itemize", "enumerate", "description", "center", "flushleft", "flushright"].includes(child.name) &&
        child.begin.span.from > span.from && child.end.span.to < span.to && resolveBeamerOverlaySpanVisibility(params.overlays, child.begin.span, params.step) !== "removed")
        .sort((a, b) => a.begin.span.from - b.begin.span.from)[0]?.begin.span.from;
      const replacement = { span, item, width, ...(labelTargetOffset !== undefined ? { labelTargetOffset } : {}) };
      const index = params.references.inlineFlow?.findIndex(box => box.span.from === span.from) ?? -1;
      if (index >= 0 && params.references.inlineFlow) params.references.inlineFlow[index] = replacement;
      else params.references.inlineFlow?.push(replacement);
    }
  }
  if (params.resolvePendingLabels !== false && params.references.inlineFlow?.some(box => box.labelTargetOffset !== undefined)) {
    for (let attempt = 0; attempt <= candidates.length; attempt++) {
      const revision = params.references.inlineFlowLabelState.revision;
      await prepareFrameFlow({ ...params, children: params.bodyIr.children, textWidth: params.textWidth,
        theme: params.theme, diagnostics: [], ...requireDefined(params.references.frameLayout, "Expected enclosing frame geometry"), availableHeight: Number.POSITIVE_INFINITY });
      if (params.references.inlineFlowLabelState.revision === revision) break;
      if (attempt === candidates.length) throw new Error("Deferred Beamer item label transfer did not stabilize");
      await prepareInlineFlow({ ...params, resolvePendingLabels: false });
    }
  }
}

async function prepareFrameFlow(params: {
  source: string;
  children: readonly BeamerFrameBodyNode[];
  textWidth: number;
  paperWidth: number;
  leftSidebarWidth: number;
  paperHeight: number;
  textHeight: number;
  plain: boolean;
  availableHeight: number;
  diagnostics: Diagnostic[];
  theme: ResolvedBeamerTheme;
  metadata: Partial<
    Record<BeamerMetadataFieldName, BeamerMetadataFieldModel>
  >;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  overlays: BeamerOverlayModel;
  step: number;
  graphicsResolver?: DocumentGraphicsResolver;
  work?: BeamerRenderWork;
}): Promise<PreparedFrameFlowItem[]> {
  const result: PreparedFrameFlowItem[] = [];
  const bodyFont = params.theme.fonts["normal-text"];
  const listProfile = beamerListLayoutProfile(params.theme, params.references.crampedLists);
  for (const node of params.children) {
    if (params.work) await params.work.checkpoint();
    const nodeTheme = ambientTextTheme(params.theme, params.references.ambientTextAt?.(node.span.from) ?? "");
    const bodyFont = nodeTheme.fonts["normal-text"];
    const listProfile = beamerListLayoutProfile(nodeTheme, params.references.crampedLists);
    const visibility = resolveBeamerOverlaySpanVisibility(
      params.overlays,
      node.span,
      params.step
    );
    if (visibility === "removed") {
      continue;
    }
    if (node.kind === "contents") {
      const unsupportedOptions = (node.options?.value ?? "").split(",").map(value => value.trim()).filter(value => value && !["hideallsubsections", "hideothersubsections"].includes(value));
      if (unsupportedOptions.length) params.diagnostics.push({ severity: "warning", code: "beamer-contents-unsupported-options",
        message: `Unsupported contents options: ${unsupportedOptions.join(", ")}. Only default section/subsection contents and hide-all/other-subsection filters are implemented.`, span: node.options?.span ?? node.span });
      result.push({ kind: "contents", visibility, contents: prepareBeamerContents({ node, sections: params.references.tocSections ?? [],
        currentSectionId: params.references.currentSectionId ?? null, theme: nodeTheme, width: params.textWidth,
        layout: (mapped, font, width, id) => layoutParagraph({ mapped, font, sourceSpan: node.span, paragraphId: id, role: "body",
          bounds: { x: 0, y: 0, width, height: 0 }, alignment: "left", macroBindings: params.macroBindings,
          references: params.references, paperWidth: params.paperWidth }),
      }) });
      continue;
    }
    if (node.kind === "title-page") {
      result.push({
        kind: "title-page",
        visibility,
        titlePage: runBeamerRenderOperation(params.work, () => prepareTitlePage({
          node,
          width: params.textWidth,
          theme: nodeTheme,
          metadata: params.metadata,
          macroBindings: params.macroBindings,
          references: params.references,
          ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
          paperWidth: params.paperWidth,
          paperHeight: params.paperHeight,
          textHeight: params.textHeight,
          plain: params.plain,
        })),
      });
      continue;
    }
    if (node.kind === "paragraph") {
      const paragraph = runBeamerRenderOperation(params.work, () => prepareFrameParagraph({
        source: params.source,
        node,
        textWidth: params.textWidth,
        bodyFont,
        listProfile,
        macroBindings: params.macroBindings,
        references: params.references,
        overlays: params.overlays,
        step: params.step,
        ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
        colorResolver: beamerAlertColorResolver(nodeTheme),
        paperWidth: params.paperWidth,
      }));
      if (paragraph) {
        result.push(paragraph);
      } else if (hasProjectedContent(params.source, node.span, params.overlays, params.step, params.references)) {
        const placeholder = prepareUnsupportedPlaceholder(
          params.source,
          { ...node, message: params.references.layoutFailures?.get(node.span.from) ?? "This content could not be laid out." },
          params.textWidth
        );
        result.push({
          kind: "unsupported",
          visibility,
          placeholder,
          height: placeholder.height,
        });
        params.diagnostics.push({
          severity: "warning",
          code: "beamer-render-unsupported-flow-node",
          message: placeholder.message,
          span: node.span,
        });
      }
      continue;
    }
    if (node.kind === "vertical-space") {
      result.push({
        kind: "vertical-space",
        visibility,
        node,
        ...measureVerticalSpace(node, bodyFont),
      });
      continue;
    }
    if (node.kind === "columns") {
      if (node.columns.length === 0) {
        params.diagnostics.push({
          severity: "warning",
          code: "beamer-render-empty-columns",
          message: "The columns environment has no renderable columns.",
          span: node.span,
        });
        continue;
      }
      // Retain the existing asynchronous column schedule, including warnings
      // produced before an earlier column's embedded picture completes. Each
      // column shares the frame budget and checks the same cancellation signal.
      const columns = await Promise.all(node.columns.map(column => prepareColumnContent({
        source: params.source,
        column,
        textWidth: params.textWidth,
        diagnostics: params.diagnostics,
        theme: nodeTheme,
        macroBindings: params.macroBindings,
        references: params.references,
        leftSidebarWidth: params.leftSidebarWidth,
        overlays: params.overlays,
        step: params.step,
        ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
        paperWidth: params.paperWidth,
        ...(params.work !== undefined ? { work: params.work } : {}),
      })));
      result.push({
        kind: "columns",
        baselineSkip: bodyFont.lineHeightPt,
        visibility,
        node,
        columns,
        box: {
          height: Math.max(0, ...columns.map((column) => column.box.height)),
          depth: Math.max(0, ...columns.map((column) => column.box.depth)),
        },
      });
      continue;
    }
    if (node.kind === "tikzpicture") {
      const tikz = await prepareEmbeddedTikz({
        source: params.source,
        theme: nodeTheme,
        node,
        width: params.textWidth,
        overlays: params.overlays, step: params.step,
        bodyFont,
        diagnostics: params.diagnostics,
        visibility,
        ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
        ...(params.work !== undefined ? { work: params.work } : {}),
      });
      if (tikz) {
        const surroundingGlue = node.span.from !== node.root.span.from
          ? {
              top: beamerTrivlistSpacing(nodeTheme),
              bottom: beamerTrivlistSpacing(nodeTheme),
            }
          : {
              top: { naturalPt: 0, shrinkPt: 0 },
              bottom: { naturalPt: 0, shrinkPt: 0 },
            };
        const centerSkip = surroundingGlue.top.naturalPt;
        result.push({
          kind: "tikzpicture",
          visibility,
          node,
          tikz,
          naturalHeight:
            tikz.height +
            surroundingGlue.top.naturalPt +
            surroundingGlue.bottom.naturalPt,
          boxHeight: tikz.height + centerSkip,
          contentInsetTop: centerSkip,
          endingDepth: 0,
          surroundingGlue,
        });
      }
      continue;
    }
    if (node.kind === "block" || node.kind === "theorem") {
      const block = await runBeamerRenderOperation(params.work, () => prepareBlock({
        source: params.source,
        node,
        width: params.textWidth,
        leftSidebarWidth: params.leftSidebarWidth,
        theme: nodeTheme,
        macroBindings: params.macroBindings,
        references: params.references,
        overlays: params.overlays,
        step: params.step,
        ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
        paperWidth: params.paperWidth,
        diagnostics: params.diagnostics,
        ...(params.work !== undefined ? { work: params.work } : {}),
      }));
      if (block) {
        result.push({
          kind: "block",
          visibility,
          node,
          block,
          naturalHeight: block.naturalHeight,
          boxHeight: block.flowBoxHeight,
          endingDepth: block.endingDepth,
        });
      }
      continue;
    }
    params.diagnostics.push({
      severity: "warning",
      code: "beamer-render-unsupported-flow-node",
      message: node.message,
      span: node.span,
    });
    const placeholder = prepareUnsupportedPlaceholder(params.source, node, params.textWidth);
    result.push({
      kind: "unsupported",
      visibility,
      placeholder,
      height: placeholder.height,
    });
  }
  return shrinkFrameParagraphGlueToAvailableHeight(result, {
    source: params.source,
    textWidth: params.textWidth,
    availableHeight: params.availableHeight,
    bodyFont,
    listProfile,
    macroBindings: params.macroBindings,
    references: params.references,
    overlays: params.overlays,
    step: params.step,
    ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
    colorResolver: beamerAlertColorResolver(params.theme),
    paperWidth: params.paperWidth,
    ...(params.work !== undefined ? { work: params.work } : {}),
  });
}

function prepareTitlePage(params: {
  node: BeamerTitlePageBodyNode;
  width: number;
  theme: ResolvedBeamerTheme;
  metadata: Partial<Record<BeamerMetadataFieldName, BeamerMetadataFieldModel>>;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  graphicsResolver?: DocumentGraphicsResolver;
  paperWidth: number;
  paperHeight: number;
  textHeight: number;
  plain: boolean;
}): PreparedTitlePage {
  const plan = planBeamerTitlePageTemplate(params.theme);
  const normal = params.theme.fonts["normal-text"];
  const modern = plan.style === "metropolis" || plan.style === "moloch";
  const centered = !modern && plan.style !== "inmargin";
  const text: PreparedTitlePage["text"][number][] = [];
  const boxes: PreparedTitlePage["boxes"][number][] = [];
  const measure = (field: BeamerMetadataFieldName): LaidParagraph | null => {
    const value = params.metadata[field]?.value;
    if (!value) return null;
    const baseFont = field === "titlegraphic" ? normal : params.theme.fonts[field];
    const font = plan.style === "metropolis" && field !== "titlegraphic"
      ? { ...baseFont, lineHeightPt: baseFont.lineHeightPt * 1.15 } : baseFont;
    // colorbox's sep is part of the left/right skips, not extra box width.
    // Its center skips have infinite stretch while retaining normal word glue.
    const mapped = value.contentSpan.from === value.contentSpan.to
      ? createGeneratedMappedText(value.value, "Beamer default date", params.node.span)
      : createIdentityMappedText(value.value, value.contentSpan.from);
    return layoutParagraph({
      mapped,
      sourceSpan: value.contentSpan, paragraphId: `${params.node.id}:${field}`, role: field,
      bounds: { x: 0, y: 0, width: params.width - (field === "titlegraphic" ? 0 : 2 * plan.paddingPt), height: 0 },
      font, alignment: centered ? "center" : "left", spaceGlueProfile: "font", centerWithInfiniteGlue: centered,
      colorResolver: beamerAlertColorResolver(params.theme), macroBindings: params.macroBindings,
      references: params.references,
      ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
      paperWidth: params.paperWidth, textWidth: params.width,
    });
  };
  const paragraphs = new Map((["title", "subtitle", "author", "institute", "date", "titlegraphic"] as const)
    .map(field => [field, measure(field)]));
  const get = (field: BeamerMetadataFieldName) => paragraphs.get(field) ?? null;
  const extent = (paragraph: LaidParagraph | null) => paragraph ? paragraphLineExtent(paragraph) : 0;
  const firstHeight = (paragraph: LaidParagraph | null) => paragraph ? firstLineBaselineOffset(paragraph) : 0;
  const lastDepth = (paragraph: LaidParagraph | null) => paragraph ? paragraphLastLineDepth(paragraph) : 0;
  const add = (field: BeamerMetadataFieldName, top: number, x = field === "titlegraphic" ? 0 : plan.paddingPt, fillWeight = 0) => {
    const paragraph = get(field);
    if (paragraph) text.push({ paragraph, top, x, colorRole: field, fillWeight });
  };
  const interline = (baselineSkip: number, previousDepth: number, height: number) => {
    const skip = baselineSkip - previousDepth - height;
    return skip >= 0 ? skip : 1;
  };
  const title = get("title"), subtitle = get("subtitle");
  let cursor = 0;
  if (modern) {
    // The two modern themes use fixed-height minipages, with their own
    // internal fil glue, rather than the default colorbox/vfill stack.
    const moloch = plan.style === "moloch";
    let previousDepth: number | null = moloch ? 0 : null;
    const append = (field: BeamerMetadataFieldName, before = 0, after = 0) => {
      const paragraph = get(field);
      if (!paragraph) return;
      const font = field === "titlegraphic" ? normal : params.theme.fonts[field];
      cursor += before;
      if (previousDepth !== null) cursor += interline(font.lineHeightPt * (!moloch && field !== "title" ? 1.15 : 1), previousDepth, firstHeight(paragraph));
      add(field, cursor, 0);
      cursor += extent(paragraph) + after;
      previousDepth = lastDepth(paragraph);
    };
    if (moloch) append("titlegraphic", 0, normal.sizePt);
    append("title", 0, params.theme.fonts.title.sizePt * (moloch ? .2 : .5));
    append("subtitle", moloch ? params.theme.fonts.subtitle.sizePt * .1 : 0, params.theme.fonts.subtitle.sizePt * (moloch ? .2 : .5));
    // Metropolis wraps authored subtitles in its formatter macro, so even
    // an empty argument passes the template's \ifx test and retains its skip.
    if (!moloch && !subtitle && params.metadata.subtitle && params.theme.appliedComponents.some(component =>
      component.kind === "font-theme" && component.name.toLowerCase() === "metropolis" &&
      (component.source?.span.from ?? Number.POSITIVE_INFINITY) < (params.metadata.subtitle?.span.from ?? 0))) cursor += params.theme.fonts.subtitle.sizePt * .5;
    cursor += interline(normal.lineHeightPt, previousDepth ?? 0, .4);
    boxes.push({ bounds: { x: 0, y: cursor, width: params.width, height: .4 }, colorRole: "title separator", rounded: false });
    cursor += .4 + (moloch ? normal.sizePt * .8 : 0);
    previousDepth = 0;
    append("author", moloch ? 0 : params.theme.fonts.author.sizePt * 2, params.theme.fonts.author.sizePt * (moloch ? .5 : .25));
    if (moloch) {
      append("institute", 0, params.theme.fonts.institute.sizePt);
      append("date");
    } else {
      append("date");
      append("institute", 3 * TEX_POINTS_PER_CM / 10);
    }
    const height = moloch ? params.textHeight : params.paperHeight;
    const trailing = moloch ? 0 : TEX_POINTS_PER_CM / 10;
    if (moloch) cursor += normal.lineHeightPt - previousDepth;
    const offset = Math.max(0, height - cursor - trailing) * (moloch ? 3.618 / 5.618 : .5) +
      (params.plain ? (moloch ? (params.paperHeight - height) / 2 : 0) : 1);
    for (const entry of text) entry.top += offset;
    for (const box of boxes) box.bounds.y += offset;
    if (!moloch) add("titlegraphic", 2 * normal.sizePt, 0);
    return { node: params.node, plan, width: params.width, text, boxes,
      naturalHeight: height, leadingFillWeight: 0, trailingFillWeight: 0 };
  }
  if (plan.style === "inmargin") {
    let previousDepth = 0;
    const appendBlock = (field: "title" | "author" | "institute" | "date", fillWeight: number) => {
      const paragraph = get(field);
      if (!paragraph && field !== "title") return;
      const label = { title: "", author: "Who?", institute: "From?", date: "When?" }[field];
      const labelWidth = params.paperWidth * .25 - 3 * fontXHeightPt(normal);
      const indicator = label ? layoutParagraph({
        mapped: createGeneratedMappedText(label, "Beamer inmargin titlepage indicator", params.node.span),
        sourceSpan: params.node.span, paragraphId: `${params.node.id}:${field}:indicator`, role: "block-title",
        bounds: { x: 0, y: 0, width: labelWidth, height: 0 }, font: params.theme.fonts["block-title"], alignment: "right",
        references: params.references,
      }) : null;
      cursor += 6;
      const height = Math.max(firstHeight(paragraph), firstHeight(indicator));
      const baseline = cursor + interline(normal.lineHeightPt, previousDepth, height) + height;
      add(field, baseline - firstHeight(paragraph), 0, fillWeight);
      if (indicator) text.push({ paragraph: indicator, x: -labelWidth - 2.5 * fontXHeightPt(normal),
        top: baseline - firstHeight(indicator), colorRole: "block title", fillWeight });
      let depth = Math.max(lastDepth(indicator), extent(paragraph) - firstHeight(paragraph));
      if (field === "title" && subtitle) {
        const subtitleBaseline = baseline + lastDepth(paragraph) + firstHeight(subtitle) +
          interline(params.theme.fonts.subtitle.lineHeightPt, lastDepth(paragraph), firstHeight(subtitle));
        add("subtitle", subtitleBaseline - firstHeight(subtitle), 0);
        depth = Math.max(depth, subtitleBaseline - baseline + extent(subtitle) - firstHeight(subtitle));
      }
      cursor = baseline + depth + 3;
      previousDepth = depth;
    };
    appendBlock("title", 0);
    for (const field of ["author", "institute", "date"] as const) appendBlock(field, 1);
    return { node: params.node, plan, width: params.width, text, boxes,
      naturalHeight: cursor, leadingFillWeight: 0, trailingFillWeight: 1 };
  }
  // An empty vbox precedes the leading vfill. The following title colorbox
  // exceeds baselineskip, so TeX inserts lineskip before its outer hbox.
  cursor = normal.lineHeightPt + 1;
  const rounded = plan.style === "rounded";
  const roundedBefore = rounded ? 4 * TEX_POINTS_PER_BP + 2.5 : 0;
  const roundedAfter = rounded ? (plan.shadow ? 4 : 2) * TEX_POINTS_PER_BP + .5 : 0;
  const boxTop = cursor;
  cursor += roundedBefore + plan.paddingPt;
  add("title", cursor);
  cursor += extent(title);
  if (subtitle) {
    cursor += params.theme.fonts.title.sizePt * .25 +
      interline(params.theme.fonts.subtitle.lineHeightPt, lastDepth(title), firstHeight(subtitle));
    add("subtitle", cursor);
    cursor += extent(subtitle);
  }
  cursor += plan.paddingPt + roundedAfter;
  boxes.push({ bounds: { x: -plan.outerBleedPt, y: boxTop, width: params.width + 2 * plan.outerBleedPt, height: cursor - boxTop }, colorRole: "title", rounded });
  cursor += normal.sizePt;
  for (const field of ["author", "institute", "date"] as const) {
    const paragraph = get(field);
    const fieldRounded = plan.templateId.startsWith("beamer/title-page/rounded") &&
      resolveBeamerThemeColor(params.theme, field).bg !== undefined;
    const bleed = fieldRounded ? 4 * TEX_POINTS_PER_BP : 0;
    cursor += interline(normal.lineHeightPt, 0,
      (fieldRounded ? 4 * TEX_POINTS_PER_BP + 2.5 : 0) + 2 * plan.paddingPt + extent(paragraph));
    const top = cursor;
    if (fieldRounded) cursor += 4 * TEX_POINTS_PER_BP + 2.5;
    add(field, cursor + plan.paddingPt);
    cursor += 2 * plan.paddingPt + extent(paragraph);
    if (fieldRounded) cursor += (plan.templateId.endsWith("-shadow") ? 4 : 2) * TEX_POINTS_PER_BP + .5;
    boxes.push({ bounds: { x: -bleed, y: top, width: params.width + 2 * bleed, height: cursor - top }, colorRole: field, rounded: fieldRounded });
  }
  cursor += normal.sizePt * .5;
  const graphic = get("titlegraphic");
  if (graphic) {
    cursor += interline(normal.lineHeightPt, 0, firstHeight(graphic));
    add("titlegraphic", cursor);
    cursor += extent(graphic);
  }
  return { node: params.node, plan, width: params.width, text, boxes,
    naturalHeight: cursor, leadingFillWeight: 1, trailingFillWeight: 1 };
}

function prepareFrameParagraph(params: {
  source: string;
  node: BeamerParagraphBodyNode;
  textWidth: number;
  bodyFont: BeamerThemeFont;
  listProfile: TexListLayoutProfile;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  overlays: BeamerOverlayModel;
  step: number;
  targetHeight?: number;
  graphicsResolver?: DocumentGraphicsResolver;
  colorResolver?: NodeTextColorResolver;
  paperWidth: number;
}): Extract<PreparedFrameFlowItem, { kind: "paragraph" }> | null {
  const paragraphSource = params.source.slice(
    params.node.span.from,
    params.node.span.to
  );
  const projection = projectBeamerOverlayText(
    createIdentityMappedText(
      paragraphSource,
      params.node.span.from
    ),
    params.node.span,
    params.overlays,
    params.step
  );
  const overprintMapped = projectBeamerOverprints({ mapped: projection.mapped, sourceSpan: params.node.span, overlays: params.overlays, step: params.step,
    width: raw => raw === undefined ? params.textWidth : resolveBeamerColumnWidth(raw, params.textWidth, params.paperWidth),
    measure: (mapped, width) => {
      const measured = layoutParagraph({ mapped, sourceSpan: params.node.span, paragraphId: `${params.node.id}:overprint-measure`, role: "body", bounds: { x: 0, y: 0, width, height: 0 }, font: params.bodyFont,
        ...(params.colorResolver !== undefined ? { colorResolver: params.colorResolver } : {}), alignment: "left", listProfile: params.listProfile, macroBindings: params.macroBindings, references: params.references, ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}), paperWidth: params.paperWidth });
      if (!measured) return null;
      const height = paragraphStartingMaterialHeight(measured);
      return { height, depth: paragraphMaterialExtent(measured) - height };
    },
  });
  const paragraph = layoutParagraph({
    mapped: overprintMapped,
    sourceSpan: params.node.span,
    paragraphId: params.node.id,
    role: "body",
    bounds: { x: 0, y: 0, width: params.textWidth, height: 0 },
    font: params.bodyFont,
    ...(params.colorResolver !== undefined ? { colorResolver: params.colorResolver } : {}),
    alignment: params.node.alignment ?? "left",
    listProfile: params.listProfile,
    macroBindings: params.macroBindings,
    references: params.references,
    ...(params.targetHeight !== undefined ? { targetHeight: params.targetHeight } : {}),
    hiddenSourceSpans: projection.hiddenSourceSpans,
    ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
    paperWidth: params.paperWidth,
  });
  if (!paragraph) {
    return null;
  }
  const projectedSource = projection.mapped.text;
  const trivlistTopsep = params.listProfile.trivlistTopsepPt ?? 9;
  const trailingTrivlistSkip = trailingBeamerTrivlistSkip(projectedSource, trivlistTopsep);
  const trailingListSkip = trailingScopedBeamerListSkip(projection.mapped, params.references, params.bodyFont);
  const trailingListShrink = trailingListSkip > 0
    ? BEAMER_LIST_LAYOUT_PROFILE.topsepShrinkPtByDepth?.[0] ?? 0
    : 0;
  const namedSize = activeBeamerNamedSize(projectedSource, params.references.theme);
  return {
    kind: "paragraph",
    visibility: resolveBeamerOverlaySpanVisibility(
      params.overlays,
      params.node.span,
      params.step
    ),
    node: params.node,
    paragraph,
    naturalHeight:
      paragraphMaterialExtent(paragraph) + trailingTrivlistSkip + trailingListSkip,
    boxHeight: paragraphStartingMaterialHeight(paragraph),
    startingBaselineSkip:
      paragraphStartingBaselineSkip(paragraph, namedSize?.lineHeightPt ?? params.bodyFont.lineHeightPt),
    leadingAdjustment: leadingBeamerTrivlistAdjustment(
      paragraphSource,
      paragraph,
      trivlistTopsep
    ),
    endingDepth: paragraphEndingMaterialDepth(paragraph),
    trailingListGlue: {
      naturalPt: trailingListSkip,
      shrinkPt: trailingListShrink,
    },
    trailingVerticalSpacePreviousDepth:
      previousDepthBeforeTrailingVerticalSpace(paragraph),
  };
}

async function shrinkFrameParagraphGlueToAvailableHeight(
  flow: readonly PreparedFrameFlowItem[],
  params: {
    source: string;
    textWidth: number;
    availableHeight: number;
    bodyFont: BeamerThemeFont;
    listProfile: TexListLayoutProfile;
    macroBindings: ReadonlyMap<string, MacroBinding>;
    references: BeamerReferenceContext;
    overlays: BeamerOverlayModel;
    step: number;
    graphicsResolver?: DocumentGraphicsResolver;
    colorResolver?: NodeTextColorResolver;
    paperWidth: number;
    work?: BeamerRenderWork;
  }
): Promise<PreparedFrameFlowItem[]> {
  const fitted = [...flow];
  for (let index = 0; index < fitted.length; index += 1) {
    if (params.work) await params.work.checkpoint();
    const item = fitted[index];
    const next = fitted[index + 1];
    if (item?.kind !== "paragraph" || next?.kind !== "tikzpicture") {
      continue;
    }
    fitted[index] = cancelTrailingDisplayGlueBeforeCenteredTikz(
      item,
      next
    );
    fitted[index + 1] = suppressCenteredTikzTopGlueAfterNormalDisplay(
      item,
      next
    );
  }
  // beamerbaseframesize.sty packs the assembled frame into
  // `\vbox to\textheight`. If the material is overfull, ordinary-order glue
  // inside the frame body (notably display skips) receives the box's shrink
  // setting. Our frame flow keeps source-contiguous prose in a reusable VList,
  // so re-run those VLists against the remaining frame height.
  const overflow = Math.max(
    0,
    positionPreparedFrameFlow(
      fitted,
      params.bodyFont.lineHeightPt
    ).extent - params.availableHeight
  );
  if (overflow === 0) {
    return fitted;
  }
  const shrinkable: Array<{
    index: number;
    item: Extract<PreparedFrameFlowItem, { kind: "paragraph" }>;
    maximumShrink: number;
    paragraphMaximumShrink: number;
  }> = [];
  for (let index = 0; index < fitted.length; index += 1) {
    if (params.work) await params.work.checkpoint();
    const item = fitted[index];
    if (item?.kind !== "paragraph") {
      continue;
    }
    const rawFullyShrunk = runBeamerRenderOperation(params.work, () => prepareFrameParagraph({
      ...params,
      node: item.node,
      targetHeight: 0,
    }));
    if (!rawFullyShrunk) {
      continue;
    }
    const fullyShrunk = cancelTrailingDisplayGlueBeforeCenteredTikz(
      rawFullyShrunk,
      fitted[index + 1]
    );
    shrinkable.push({
      index,
      item,
      maximumShrink: Math.max(
        0,
        item.naturalHeight - fullyShrunk.naturalHeight
      ) + item.trailingListGlue.shrinkPt,
      paragraphMaximumShrink: Math.max(
        0,
        item.paragraph.height - rawFullyShrunk.paragraph.height
      ),
    });
  }
  const totalShrink = shrinkable.reduce(
    (sum, candidate) => sum + candidate.maximumShrink,
    0
  ) + fitted.reduce(
    (sum, item) =>
      sum +
      (item.kind === "tikzpicture"
        ? item.surroundingGlue.top.shrinkPt +
          item.surroundingGlue.bottom.shrinkPt
        : 0),
    0
  );
  const ratio = totalShrink > 0
    ? Math.min(overflow / totalShrink, 1)
    : 0;
  for (const candidate of shrinkable) {
    if (params.work) await params.work.checkpoint();
    const targetHeight =
      candidate.item.paragraph.height -
      candidate.paragraphMaximumShrink * ratio;
    const rawRelaid = runBeamerRenderOperation(params.work, () => prepareFrameParagraph({
      ...params,
      node: candidate.item.node,
      targetHeight,
    }));
    if (!rawRelaid) {
      continue;
    }
    const relaid = cancelTrailingDisplayGlueBeforeCenteredTikz(
      rawRelaid,
      fitted[candidate.index + 1]
    );
    const index = candidate.index;
    fitted[index] = {
      ...relaid,
      naturalHeight:
        relaid.naturalHeight -
        relaid.trailingListGlue.shrinkPt * ratio,
    };
  }
  for (let index = 0; index < fitted.length; index += 1) {
    const item = fitted[index];
    if (item?.kind !== "tikzpicture") {
      continue;
    }
    const topSkip = Math.max(
      0,
      item.surroundingGlue.top.naturalPt -
        item.surroundingGlue.top.shrinkPt * ratio
    );
    const bottomSkip = Math.max(
      0,
      item.surroundingGlue.bottom.naturalPt -
        item.surroundingGlue.bottom.shrinkPt * ratio
    );
    fitted[index] = {
      ...item,
      naturalHeight: item.tikz.height + topSkip + bottomSkip,
      boxHeight: item.tikz.height + topSkip,
      contentInsetTop: topSkip,
    };
  }
  return fitted;
}

function cancelTrailingDisplayGlueBeforeCenteredTikz(
  paragraph: Extract<PreparedFrameFlowItem, { kind: "paragraph" }>,
  next: PreparedFrameFlowItem | undefined
): Extract<PreparedFrameFlowItem, { kind: "paragraph" }> {
  if (
    next?.kind !== "tikzpicture" ||
    next.surroundingGlue.bottom.naturalPt === 0
  ) {
    return paragraph;
  }
  const trailing = paragraph.paragraph.layout.vlistLayout.boxReport.items.at(-1);
  if (
    trailing?.itemKind !== "glue" ||
    trailing.glue?.origin?.kind !== "display-math-boundary" ||
    trailing.glue.origin.side !== "below" ||
    trailing.glue.origin.variant !== "short"
  ) {
    return paragraph;
  }
  // LaTeX's center environment is a trivlist. Its opening \addvspace and
  // negative list glues cancel an immediately preceding \belowdisplayskip;
  // the center \topsep remains. Keep the display VList intact for source and
  // box reporting, but omit that canceled terminal glue from the assembled
  // frame extent. Applying this at every trial height also removes the
  // canceled glue's shrink capacity from the enclosing frame vbox.
  return {
    ...paragraph,
    naturalHeight: Math.max(0, paragraph.naturalHeight - trailing.height),
  };
}

function suppressCenteredTikzTopGlueAfterNormalDisplay(
  paragraph: Extract<PreparedFrameFlowItem, { kind: "paragraph" }>,
  tikz: Extract<PreparedFrameFlowItem, { kind: "tikzpicture" }>
): Extract<PreparedFrameFlowItem, { kind: "tikzpicture" }> {
  if (tikz.surroundingGlue.top.naturalPt === 0) {
    return tikz;
  }
  const trailing = paragraph.paragraph.layout.vlistLayout.boxReport.items.at(-1);
  if (
    trailing?.itemKind !== "glue" ||
    trailing.glue?.origin?.kind !== "display-math-boundary" ||
    trailing.glue.origin.side !== "below" ||
    trailing.glue.origin.variant === "short"
  ) {
    return tikz;
  }
  // When the normal \belowdisplayskip is larger than center's \topsep,
  // LaTeX's opening \addvspace keeps the display skip and contributes no
  // separate top glue. The closing topsep remains below the environment.
  return {
    ...tikz,
    naturalHeight:
      tikz.naturalHeight - tikz.surroundingGlue.top.naturalPt,
    boxHeight: tikz.boxHeight - tikz.surroundingGlue.top.naturalPt,
    contentInsetTop: 0,
    surroundingGlue: {
      ...tikz.surroundingGlue,
      top: { naturalPt: 0, shrinkPt: 0 },
    },
  };
}

async function prepareBlock(params: Parameters<typeof prepareBlockWithTheme>[0]): Promise<PreparedBlock | null> {
  const theme = ambientTextTheme(params.references.blockThemeAt?.(params.node.span.from) ?? params.references.scopedTheme?.at(params.node.span.from) ?? params.theme,
    params.references.ambientTextAt?.(params.node.span.from) ?? "");
  const block = await prepareBlockWithTheme({ ...params, theme, references: { ...params.references, theme } });
  return block ? { ...block, theme } : null;
}

async function prepareBlockWithTheme(params: {
  source: string;
  node: BeamerBlockBodyNode | BeamerTheoremBodyNode;
  width: number;
  leftSidebarWidth: number;
  theme: ResolvedBeamerTheme;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  overlays: BeamerOverlayModel;
  step: number;
  graphicsResolver?: DocumentGraphicsResolver;
  paperWidth: number;
  diagnostics: Diagnostic[];
  work?: BeamerRenderWork;
}): Promise<PreparedBlock | null> {
  if (params.node.kind === "block" && params.node.packageBox === "tcolorbox") return prepareTcolorbox(params);
  const plan = planBeamerBlockTemplate({
    environment: params.node.kind === "theorem"
      ? params.node.blockEnvironment
      : params.node.environment,
    theme: params.theme,
  });
  const titleFont = params.theme.fonts[plan.titleFontRole];
  const theoremTitleFont =
    params.node.kind === "theorem" &&
    params.node.theoremTemplate === "ams-style"
      ? params.node.theoremStyle === "remark"
        ? { ...titleFont, shape: "italic" as const }
        : { ...titleFont, series: "bold" as const }
      : titleFont;
  const blockTitleLayoutFont = plan.style === "inmargin"
    ? {
        ...theoremTitleFont,
        // The title vtop is opened in \normalsize; the starred Beamer font
        // switch changes the glyph face/size without replacing that vtop's
        // normal-text baseline grid.
        lineHeightPt: params.theme.fonts["normal-text"].lineHeightPt,
      }
    : theoremTitleFont;
  const normalXHeight = fontXHeightPt(params.theme.fonts["normal-text"]);
  const inMarginTitleWidth = Math.max(
    0,
    params.leftSidebarWidth - 3 * normalXHeight
  );
  const titleProjection = params.node.kind === "theorem"
    ? {
        mapped: params.node.titleMapped,
        hiddenSourceSpans: [],
      }
    : projectBeamerOverlayText(
        createIdentityMappedText(
          params.node.title.value,
          params.node.title.contentSpan.from
        ),
        params.node.title.contentSpan,
        params.overlays,
        params.step
      );
  const title = layoutParagraph({
    mapped: titleProjection.mapped,
    sourceSpan: params.node.title.contentSpan,
    paragraphId: `${params.node.id}:title`,
    role: "block-title",
    bounds: {
      x: 0,
      y: 0,
      width: plan.style === "inmargin"
        ? inMarginTitleWidth
        : params.width,
      height: 0,
    },
    font: blockTitleLayoutFont,
    colorResolver: beamerAlertColorResolver(params.theme),
    alignment: plan.style === "inmargin" ? "right" : "left",
    disableAutomaticHyphenation: plan.style === "inmargin",
    macroBindings: params.macroBindings,
    references: params.references,
    hiddenSourceSpans: titleProjection.hiddenSourceSpans,
    ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
    paperWidth: params.paperWidth,
    textWidth: params.width,
    columnWidth: params.width,
  });
  if (!title) {
    return null;
  }
  const theoremBodyFont =
    params.node.kind === "theorem" &&
    params.node.theoremStyle === "plain" &&
    params.node.theoremTemplate !== "normal-font"
      ? {
          ...params.theme.fonts[plan.bodyFontRole],
          shape: "italic" as const,
        }
      : params.theme.fonts[plan.bodyFontRole];
  const layoutBody = (node: BeamerParagraphBodyNode, paragraphId: string) => {
    const bodyProjection = projectBeamerOverlayText(
      createIdentityMappedText(params.source.slice(node.span.from, node.span.to), node.span.from),
      node.span,
      params.overlays,
      params.step
    );
    return layoutParagraph({
        mapped: bodyProjection.mapped,
        sourceSpan: node.span,
        paragraphId,
        role: "block-body",
        bounds: { x: 0, y: 0, width: params.width, height: 0 },
        font: theoremBodyFont,
        mathFont: params.theme.fonts[plan.bodyFontRole],
        colorResolver: beamerAlertColorResolver(params.theme),
        alignment: "left",
        disableAutomaticHyphenation: true,
        // Lists inside blocks use the same theme templates (margins,
        // markers) as frame-level lists.
        listProfile: { ...beamerListLayoutProfile(params.theme, params.references.crampedLists), suppressInitialTopsep: plan.style !== "default" },
        macroBindings: params.macroBindings,
        references: params.references,
        hiddenSourceSpans: bodyProjection.hiddenSourceSpans,
        ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
        paperWidth: params.paperWidth,
      });
  };
  // Keep supported block bodies in one paragraph so their list/display glue
  // stays in the shared text layout. Split only around opaque environments.
  const onlyChild = params.node.children.length === 1 ? params.node.children[0] : null;
  const body = onlyChild?.kind === "paragraph"
    ? layoutBody(onlyChild, `${params.node.id}:body`)
    : null;
  let bodyFlow: PreparedBlock["bodyFlow"] = null;
  if (!body && params.node.children.some(child => child.kind !== "paragraph" && child.kind !== "unsupported")) {
    const flow = await prepareFrameFlow({ source: params.source, children: params.node.children,
      textWidth: params.width, paperWidth: params.paperWidth, leftSidebarWidth: params.leftSidebarWidth,
      ...requireDefined(params.references.frameLayout, "Expected the enclosing frame geometry"),
      availableHeight: Number.POSITIVE_INFINITY, diagnostics: params.diagnostics,
      theme: { ...params.theme, fonts: { ...params.theme.fonts, "normal-text": theoremBodyFont } },
      macroBindings: params.macroBindings, references: params.references, overlays: params.overlays, step: params.step,
      ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
      ...(params.work !== undefined ? { work: params.work } : {}),
    });
    const positioned = positionPreparedFrameFlow(flow, theoremBodyFont.lineHeightPt);
    const first = positioned.items[0];
    // Keep the negative head skip of T columns. Their visual top can be
    // above the physical hbox that establishes this body's reference.
    const origin = first?.item.kind === "columns" ? first.referenceY - first.item.box.height : first?.contentTop ?? 0;
    bodyFlow = { extent: positioned.extent - origin, items: positioned.items.map(item => ({ ...item,
      contentTop: item.contentTop - origin, referenceY: item.referenceY - origin,
      visualTop: item.visualTop - origin, visualBottom: item.visualBottom - origin })) };
  } else if (!body && params.node.children.length > 0) {
    const flow: PreparedFrameFlowItem[] = [];
    for (const child of params.node.children) {
      const visibility = resolveBeamerOverlaySpanVisibility(params.overlays, child.span, params.step);
      if (visibility === "removed") continue;
      if (child.kind === "paragraph") {
        const paragraph = onlyChild ? null : layoutBody(child, `${child.id}:body`);
        if (paragraph) {
          flow.push({
            kind: "paragraph", visibility, node: child, paragraph,
            naturalHeight: paragraphLineExtent(paragraph),
            boxHeight: paragraphStartingMaterialHeight(paragraph),
            startingBaselineSkip: theoremBodyFont.lineHeightPt,
            leadingAdjustment: 0,
            endingDepth: paragraphEndingMaterialDepth(paragraph),
            trailingListGlue: { naturalPt: 0, shrinkPt: 0 },
            trailingVerticalSpacePreviousDepth: null,
          });
          continue;
        }
        if (!hasProjectedContent(params.source, child.span, params.overlays, params.step, params.references)) continue;
      }
      const message = child.kind === "unsupported"
        ? child.message
        : "This block content could not be laid out in the preview.";
      params.diagnostics.push({
        severity: "warning", code: "beamer-render-unsupported-flow-node",
        message, span: child.span,
      });
      const placeholder = prepareUnsupportedPlaceholder(params.source, { ...child, message }, params.width);
      flow.push({ kind: "unsupported", visibility, placeholder, height: placeholder.height });
    }
    if (flow.length > 0) {
      const positioned = positionPreparedFrameFlow(flow, theoremBodyFont.lineHeightPt);
      const origin = requireArrayValue(positioned.items, 0).contentTop;
      bodyFlow = {
        extent: positioned.extent - origin,
        items: positioned.items.map(item => ({
          ...item, contentTop: item.contentTop - origin,
          referenceY: item.referenceY - origin,
          visualTop: item.visualTop - origin, visualBottom: item.visualBottom - origin,
        })),
      };
    }
  }
  const firstFlowItem = bodyFlow?.items[0]?.item;
  const firstBody = body ?? (firstFlowItem?.kind === "paragraph" ? firstFlowItem.paragraph : null);
  const terminalBodyFlow = bodyFlow?.items.at(-1)?.item;
  // Rounded bodies end a minipage, whose terminal unskip removes the last
  // list/block skip. Intermediate body items retain that glue.
  const terminalBodySkip = plan.style === "rounded"
    ? terminalBodyFlow?.kind === "paragraph" ? terminalBodyFlow.trailingListGlue.naturalPt
      : terminalBodyFlow?.kind === "block" ? terminalBodyFlow.block.plan.geometry.afterSkipPt : 0
    : 0;
  const bodyExtent = body ? (plan.style === "default"
    ? paragraphMaterialExtent(body) + trailingScopedBeamerListSkip(createIdentityMappedText(params.source.slice(params.node.bodySpan.from, params.node.bodySpan.to), params.node.bodySpan.from), params.references, theoremBodyFont)
    : paragraphLineExtent(body)) : (bodyFlow?.extent ?? 0) - terminalBodySkip;
  const titleLine = title.layout.report.lines[0];
  const titleAscent = Number(titleLine?.ascent ?? firstLineBaselineOffset(title));
  const titleDepth = Number(titleLine?.descent ?? 0);
  const geometry = plan.geometry;
  if (plan.style === "inmargin") {
    const titleFirstBaseline = firstLineBaselineOffset(title);
    const bodyFirstBaseline = firstBody ? firstLineBaselineOffset(firstBody) : 0;
    const hboxHeight = Math.max(titleFirstBaseline, bodyFirstBaseline);
    const titleTop =
      geometry.beforeSkipPt + hboxHeight - titleFirstBaseline;
    const bodyParagraphTop =
      geometry.beforeSkipPt + hboxHeight - bodyFirstBaseline;
    const contentBottom = Math.max(
      titleTop + paragraphLineExtent(title),
      bodyParagraphTop + bodyExtent
    );
    const naturalHeight =
      contentBottom +
      geometry.boxBottomSkipPt;
    const referenceY = geometry.beforeSkipPt + hboxHeight;
    return {
      node: params.node,
      plan,
      width: params.width,
      title,
      body,
      bodyFlow,
      titleXOffset:
        -params.leftSidebarWidth + 0.5 * normalXHeight,
      titleTop,
      titleAscent,
      titleDepth,
      titleBackgroundHeight: 0,
      bodyBackgroundTop: bodyParagraphTop,
      bodyParagraphTop,
      bodyBackgroundHeight: 0,
      backgroundTop: bodyParagraphTop,
      backgroundBottom: naturalHeight,
      naturalHeight,
      flowBoxHeight: hboxHeight,
      // The closing \smallskip does not clear TeX's \prevdepth: it remains
      // the depth of the hbox containing the two vtops.
      endingDepth: Math.max(0, contentBottom - referenceY),
    };
  }
  const backgroundTop =
    geometry.beforeSkipPt +
    Math.max(0, geometry.outerBleedPt - geometry.roundedTopInsetPt);
  const titleBackgroundHeight =
    titleAscent +
    Math.max(titleDepth, geometry.titleDepthFloorPt) +
    geometry.titleExtraHeightPt;
  const bodyBackgroundTop =
    backgroundTop +
    titleBackgroundHeight +
    geometry.transitionHeightPt;
  const titleBoxExtent =
    titleAscent + Math.max(titleDepth, geometry.titleDepthFloorPt);
  const bodyBaselineInset =
    firstBody && geometry.bodyFirstBaselineSkipPt != null
      ? (geometry.bodyFirstBaselineSkipPt - paragraphStartingMaterialHeight(firstBody) >= 0
          ? geometry.bodyFirstBaselineSkipPt - paragraphStartingMaterialHeight(firstBody)
          : 1) + geometry.bodyInitialVSkipEx * fontXHeightPt(params.theme.fonts[plan.bodyFontRole])
      : geometry.bodyTopPaddingPt;
  const lastFlowItem = bodyFlow?.items.at(-1)?.item;
  const bodyEndingDepth = body ? paragraphEndingMaterialDepth(body)
    : lastFlowItem?.kind === "columns" ? lastFlowItem.box.depth
    : lastFlowItem?.kind === "paragraph" ? paragraphEndingMaterialDepth(lastFlowItem.paragraph)
    : lastFlowItem?.kind === "block" ? lastFlowItem.endingDepth : 0;
  const bodyBoxHeight = bodyBaselineInset + bodyExtent - bodyEndingDepth;
  const titleBodyInterline = params.theme.fonts[plan.bodyFontRole].lineHeightPt - (geometry.titleExtraHeightPt > 0 ? 0 : titleDepth) - bodyBoxHeight;
  const titleBodyGap = plan.style === "default" && geometry.flowBoxHeight === "title-ascent"
    ? titleBodyInterline >= 0 ? titleBodyInterline : 1
    : geometry.titleBodyGapPt;
  const bodyParagraphTop =
    geometry.beforeSkipPt +
    geometry.boxTopSkipPt +
    titleBoxExtent +
    (geometry.flowBoxHeight === "title-ascent" ? geometry.titleExtraHeightPt : 0) +
    titleBodyGap +
    bodyBaselineInset;
  const bodyBackgroundHeight =
    bodyBaselineInset +
    bodyExtent +
    geometry.bodyExtraHeightPt;
  const backgroundBottom = bodyBackgroundTop + bodyBackgroundHeight;
  const naturalHeight =
    bodyParagraphTop +
    bodyExtent +
    geometry.bodyBottomRaisePt +
    geometry.boxBottomSkipPt;
  return {
    node: params.node,
    plan,
    width: params.width,
    title,
    body,
    bodyFlow,
    titleXOffset: 0,
    titleTop: backgroundTop + geometry.roundedTopInsetPt,
    titleAscent,
    titleDepth,
    titleBackgroundHeight,
    bodyBackgroundTop,
    bodyParagraphTop,
    bodyBackgroundHeight,
    backgroundTop,
    backgroundBottom,
    naturalHeight,
    flowBoxHeight:
      geometry.flowBoxHeight === "title-ascent"
        ? titleAscent + geometry.roundedTopInsetPt
        : naturalHeight,
    endingDepth:
      geometry.flowEndingDepth === "body-last-line"
        ? body ? paragraphLastLineDepth(body) : bodyEndingDepth
        : 0,
  };
}

function prepareTcolorbox(params: Parameters<typeof prepareBlock>[0]): PreparedBlock | null {
  const node = params.node;
  if (node.kind !== "block") return null;
  const font = params.theme.fonts["normal-text"];
  const { plan, diagnostics } = resolveTcolorboxPlan({ source: params.source,
    options: parseTcolorboxOptions(params.source, node.options, node.beginSpan),
    dimensions: { linewidth: texLength(params.width), textwidth: texLength(params.width), columnwidth: texLength(params.width),
      paperwidth: texLength(params.paperWidth), em: texLength(font.sizePt), ex: texLength(fontXHeightPt(font)) },
    baselineSkipPt: font.lineHeightPt });
  params.diagnostics.push(...diagnostics);
  if (!plan) return null;
  const measure = (span: Span, role: "block-title" | "block-body", width: number) => {
    const projection = projectBeamerOverlayText(createIdentityMappedText(params.source.slice(span.from, span.to), span.from), span, params.overlays, params.step);
    return layoutParagraph({ mapped: projectTcolorboxFontDeclaration(projection.mapped, role === "block-title" ? plan.fontTitle : plan.fontUpper),
      sourceSpan: span, paragraphId: `${node.id}:${role === "block-title" ? "title" : "body"}`, role,
      bounds: { x: 0, y: 0, width, height: 0 }, font, alignment: "left",
      initialBaselineSkipPt: font.lineHeightPt,
      listProfile: { ...beamerListLayoutProfile(params.theme, params.references.crampedLists), suppressInitialTopsep: true },
      macroBindings: params.macroBindings, references: params.references, hiddenSourceSpans: projection.hiddenSourceSpans,
      ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}), colorResolver: beamerAlertColorResolver(params.theme),
      paperWidth: params.paperWidth, textWidth: params.width, columnWidth: params.width });
  };
  const title = plan.title.value ? measure(plan.title.contentSpan, "block-title", plan.titleWidthPt) : null;
  const body = measure(node.bodySpan, "block-body", plan.bodyWidthPt);
  const geometry = measureTcolorboxGeometry(plan, title ? paragraphLineExtent(title) : 0, body ? paragraphLineExtent(body) : 0);
  const blockPlan = planBeamerBlockTemplate({ environment: "block", theme: params.theme });
  return { node, plan: { ...blockPlan, geometry: { ...blockPlan.geometry, beforeSkipPt: 0, afterSkipPt: plan.afterSkipPt,
    outerBleedPt: 0, shadowExtentPt: 0 } }, packageBox: { plan, geometry },
    width: plan.widthPt, title, body, bodyFlow: null, titleXOffset: plan.titleXPt,
    titleTop: geometry.titleTopPt, titleAscent: title ? paragraphStartingMaterialHeight(title) : 0,
    titleDepth: title ? paragraphEndingMaterialDepth(title) : 0, titleBackgroundHeight: geometry.interiorTopPt,
    bodyBackgroundTop: geometry.interiorTopPt, bodyParagraphTop: geometry.bodyTopPt, bodyBackgroundHeight: geometry.interiorBottomPt - geometry.interiorTopPt,
    backgroundTop: 0, backgroundBottom: geometry.heightPt, naturalHeight: geometry.heightPt,
    flowBoxHeight: geometry.heightPt, endingDepth: plan.afterBalanced ? .3 * font.lineHeightPt : 0 };
}

async function emitPreparedBlock(params: {
  prepared: PreparedBlock;
  x: number;
  y: number;
  parentId: string | null;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  theme: ResolvedBeamerTheme;
  visibility?: "visible" | "hidden";
  spacing: BeamerSpacingLayout[];
  embeddedTikz: BeamerEmbeddedTikzLayout[];
  paperWidth: number;
  work?: BeamerRenderWork;
}): Promise<void> {
  const block = params.prepared;
  params = { ...params, theme: block.theme ?? params.theme };
  if (block.packageBox) {
    emitPreparedTcolorbox(params);
    return;
  }
  if (!block.title) return;
  const geometry = block.plan.geometry;
  const outerBounds = {
    x: params.x - geometry.outerBleedPt,
    y: params.y + block.backgroundTop,
    width: block.width + 2 * geometry.outerBleedPt,
    height:
      block.backgroundBottom -
      block.backgroundTop +
      geometry.shadowExtentPt,
  };
  const titleColor = resolveBeamerThemeColor(
    params.theme,
    block.plan.titleColorRole
  );
  const bodyColor = resolveBeamerThemeColor(
    params.theme,
    block.plan.bodyColorRole
  );
  if (block.plan.style === "default" && titleColor.bg) {
    params.items.push({
      id: `${block.node.id}:title:background`,
      kind: "background",
      sourceSpan: block.node.title.span,
      bounds: {
        x: outerBounds.x,
        y: params.y + block.backgroundTop,
        width: outerBounds.width,
        height: block.titleBackgroundHeight,
      },
      parentId: block.node.id,
      ...(params.visibility !== undefined ? { visibility: params.visibility } : {}),
    });
  }
  if (block.plan.style === "default" && bodyColor.bg) {
    params.items.push({
      id: `${block.node.id}:body:background`,
      kind: "background",
      sourceSpan: block.node.span,
      bounds: {
        x: outerBounds.x,
        y: params.y + block.bodyBackgroundTop,
        width: outerBounds.width,
        height: block.bodyBackgroundHeight,
      },
      parentId: block.node.id,
      ...(params.visibility !== undefined ? { visibility: params.visibility } : {}),
    });
  }
  params.modelBuilder.addPart({
    basePartId: `${block.node.id}:chrome`,
    sourceId: block.node.id,
    elementId: null,
    markup: overlayVisibilityMarkup(
      blockChromeMarkup({
        block,
        x: params.x,
        y: params.y,
        titleFill: titleColor.bg ?? "transparent",
        bodyFill: bodyColor.bg ?? "transparent",
      }),
      params.visibility
    ),
  });

  const titleX = params.x + block.titleXOffset;
  const titleY = params.y + block.titleTop;
  if (params.visibility === "hidden") {
    block.title.layout.visibility = "hidden";
    block.title.layout.hiddenSourceSpans = [block.node.span];
  }
  positionParagraphLayout(
    block.title.layout,
    svgPoint(pt(titleX), pt(titleY))
  );
  params.paragraphs.push(block.title.layout);
  params.items.push({
    id: block.title.layout.paragraphId,
    kind: "text",
    sourceSpan: block.title.layout.sourceSpan,
    bounds: block.title.layout.bounds,
    parentId: block.node.id,
    paragraphId: block.title.layout.paragraphId,
    ...(params.visibility !== undefined ? { visibility: params.visibility } : {}),
  });
  params.modelBuilder.addPart({
    basePartId: block.title.layout.paragraphId,
    sourceId: block.title.layout.paragraphId,
    elementId: null,
    markup: overlayVisibilityMarkup(
      paragraphMarkup(
        block.title.svgBody,
        titleX,
        titleY,
        titleColor.fg ?? textColor(params.theme, "normal text")
      ),
      params.visibility
    ),
  });

  const childIds = [block.title.layout.paragraphId];
  const paragraphCount = block.body ? 1 : (block.bodyFlow?.items.filter(p => p.item.kind === "paragraph").length ?? 0);
  const emitBody = (entry: { paragraph: LaidParagraph; top: number; visibility: "visible" | "hidden" }, bodyIndex: number) => {
    const body = entry.paragraph;
    const visibility = params.visibility === "hidden" || entry.visibility === "hidden" ? "hidden" : "visible";
    const bodyY = params.y + block.bodyParagraphTop + entry.top;
    if (visibility === "hidden") {
      body.layout.visibility = "hidden";
      body.layout.hiddenSourceSpans = [body.layout.sourceSpan];
    }
    positionParagraphLayout(
      body.layout,
      svgPoint(pt(params.x), pt(bodyY)),
      paragraphLineExtent(body)
    );
    params.paragraphs.push(body.layout);
    childIds.push(body.layout.paragraphId);
    params.items.push({
      id: body.layout.paragraphId,
      kind: "text",
      sourceSpan: body.layout.sourceSpan,
      bounds: body.layout.bounds,
      parentId: block.node.id,
      paragraphId: body.layout.paragraphId,
      visibility,
    });
    for (const marker of body.listMarkers) {
      params.items.push({
        id: marker.id,
        kind: "list-marker",
        sourceSpan: marker.sourceSpan ?? body.layout.sourceSpan,
        bounds: {
          x: params.x + marker.bounds.x,
          y: bodyY + marker.bounds.y,
          width: marker.bounds.width,
          height: marker.bounds.height,
        },
        parentId: body.layout.paragraphId,
        traceAsGlyph: marker.traceAsGlyph,
        visibility: visibility === "hidden" ? "hidden" : marker.visibility,
      });
    }
    params.modelBuilder.addPart({
      basePartId: body.layout.paragraphId,
      sourceId: body.layout.paragraphId,
      elementId: null,
      markup: overlayVisibilityMarkup(
        paragraphMarkup(
          body.svgBody,
          params.x,
          bodyY,
          bodyColor.fg ?? textColor(params.theme, "normal text")
        ),
        visibility
      ),
    });
    if (block.node.kind === "theorem" && block.node.qed && bodyIndex === paragraphCount - 1) {
      const qedRects = proofQedRectangles({
        block: { ...block, body },
        bodyY,
        x: params.x,
        fontSizePt: params.theme.fonts[block.plan.bodyFontRole].sizePt,
      });
      const qedColor =
        resolveBeamerThemeColor(params.theme, "qed symbol").fg ??
        textColor(params.theme, "normal text");
      for (const [index, bounds] of qedRects.entries()) {
        const id = `${block.node.id}:qed:${index}:background`;
        childIds.push(id);
        params.items.push({
          id,
          kind: "background",
          sourceSpan: block.node.endSpan,
          bounds,
          parentId: block.node.id,
          ...(params.visibility !== undefined ? { visibility: params.visibility } : {}),
        });
      }
      params.modelBuilder.addPart({
        basePartId: `${block.node.id}:qed`,
        sourceId: block.node.id,
        elementId: null,
        markup: overlayVisibilityMarkup(
          qedRects.map((bounds) => rectMarkup(bounds, qedColor)).join(""),
          params.visibility
        ),
      });
    }
  };
  let paragraphIndex = 0;
  if (block.body) emitBody({ paragraph: block.body, top: 0, visibility: "visible" }, paragraphIndex++);
  for (const placement of block.bodyFlow?.items ?? []) {
    const item = placement.item;
    if (params.work) await params.work.checkpoint();
    if (item.kind === "paragraph") {
      emitBody({ paragraph: item.paragraph, top: placement.contentTop,
        visibility: item.visibility === "hidden" ? "hidden" : "visible" }, paragraphIndex++);
      continue;
    }
    if ((params.visibility === "hidden" || item.visibility === "hidden") && !["block", "columns", "tikzpicture"].includes(item.kind)) continue;
    if (item.kind === "unsupported") {
      emitUnsupportedPlaceholder({ placeholder: item.placeholder, x: params.x,
        y: params.y + block.bodyParagraphTop + placement.contentTop, parentId: block.node.id,
        items: params.items, modelBuilder: params.modelBuilder });
      childIds.push(item.placeholder.id);
    } else if (item.kind === "columns") {
      await emitPreparedColumns({ prepared: item, visibility: params.visibility ?? "visible", referenceY: params.y + block.bodyParagraphTop + placement.referenceY,
        spacing: params.spacing, bounds: { x: params.x, y: params.y + block.bodyParagraphTop, width: block.width, height: block.bodyBackgroundHeight },
        paperWidth: params.paperWidth, items: params.items, paragraphs: params.paragraphs,
        embeddedTikz: params.embeddedTikz, modelBuilder: params.modelBuilder, theme: params.theme,
        ...(params.work !== undefined ? { work: params.work } : {}) });
      childIds.push(item.node.id);
    } else if (item.kind === "block") {
      await emitPreparedBlock({ ...params, prepared: item.block, x: params.x,
        y: params.y + block.bodyParagraphTop + placement.contentTop, parentId: block.node.id, visibility: params.visibility === "hidden" || item.visibility === "hidden" ? "hidden" : "visible" });
      childIds.push(item.node.id);
    } else if (item.kind === "tikzpicture") {
      // Reuse paragraph-owned picture painting so source ownership and ordered
      // paint splitting remain identical to ordinary block text.
      const x = params.x + (item.tikz.horizontalAlignment === "center" ? (block.width - item.tikz.width) / 2 : item.tikz.horizontalAlignment === "right" ? block.width - item.tikz.width : 0);
      const y = params.y + block.bodyParagraphTop + placement.contentTop + item.contentInsetTop;
      emitEmbeddedTikz({ tikz: item.tikz, x, y, parentId: block.node.id,
        items: params.items, embeddedTikz: params.embeddedTikz, modelBuilder: params.modelBuilder });
    }
  }


  params.items.push({
    id: block.node.id,
    kind: "block",
    sourceSpan: block.node.span,
    bounds: outerBounds,
    parentId: params.parentId,
    childIds,
    ...(params.visibility !== undefined ? { visibility: params.visibility } : {}),
  });
}

function emitPreparedTcolorbox(params: Parameters<typeof emitPreparedBlock>[0]): void {
  const block = params.prepared;
  if (!block.packageBox) return;
  const { plan, geometry } = block.packageBox;
  const hidden = params.visibility === "hidden";
  const childIds: string[] = [];
  params.modelBuilder.addPart({ basePartId: `${block.node.id}:background`, sourceId: block.node.id, elementId: null,
    markup: overlayVisibilityMarkup(`<g transform="translate(${params.x} ${params.y})">${emitTcolorboxBackground(plan, geometry)}</g>`, hidden ? "hidden" : "visible") });
  for (const [paragraph, dx, dy, color] of [
    [block.title, plan.titleXPt, geometry.titleTopPt, plan.titleColor],
    [block.body, plan.bodyXPt, geometry.bodyTopPt, plan.textColor],
  ] as const) {
    if (!paragraph) continue;
    const x = params.x + dx, y = params.y + dy;
    if (hidden) { paragraph.layout.visibility = "hidden"; paragraph.layout.hiddenSourceSpans = [paragraph.layout.sourceSpan]; }
    positionParagraphLayout(paragraph.layout, svgPoint(pt(x), pt(y)), paragraphLineExtent(paragraph));
    params.paragraphs.push(paragraph.layout);
    childIds.push(paragraph.layout.paragraphId);
    params.items.push({ id: paragraph.layout.paragraphId, kind: "text", sourceSpan: paragraph.layout.sourceSpan,
      bounds: paragraph.layout.bounds, parentId: block.node.id, paragraphId: paragraph.layout.paragraphId, ...(params.visibility !== undefined ? { visibility: params.visibility } : {}) });
    for (const marker of paragraph.listMarkers) params.items.push({ id: marker.id, kind: "list-marker",
      sourceSpan: marker.sourceSpan ?? paragraph.layout.sourceSpan,
      bounds: { ...marker.bounds, x: x + marker.bounds.x, y: y + marker.bounds.y },
      parentId: paragraph.layout.paragraphId, traceAsGlyph: marker.traceAsGlyph, visibility: hidden ? "hidden" : marker.visibility });
    params.modelBuilder.addPart({ basePartId: paragraph.layout.paragraphId, sourceId: paragraph.layout.paragraphId, elementId: null,
      markup: overlayVisibilityMarkup(paragraphMarkup(paragraph.svgBody, x, y, color), hidden ? "hidden" : "visible") });
  }
  params.items.push({ id: block.node.id, kind: "block", sourceSpan: block.node.span,
    bounds: { x: params.x, y: params.y, width: plan.widthPt, height: geometry.heightPt }, parentId: params.parentId,
    childIds, ...(params.visibility !== undefined ? { visibility: params.visibility } : {}) });
}

function overlayVisibilityMarkup(
  markup: string,
  visibility: "visible" | "hidden" | undefined
): string {
  return visibility === "hidden"
    ? `<g visibility="hidden">${markup}</g>`
    : markup;
}

function proofQedRectangles(params: {
  block: PreparedBlock;
  bodyY: number;
  x: number;
  fontSizePt: number;
}): BeamerRect[] {
  const body = params.block.body;
  if (!body) {
    return [];
  }
  const lastLine = body.layout.report.lines.at(-1);
  const placement = lastLine
    ? body.layout.vlistLayout.linePlacements.find(
        (candidate) => candidate.lineIndex === lastLine.lineIndex
      )
    : null;
  const baselineY =
    params.bodyY +
    Number(placement?.y ?? 0) +
    Number(lastLine?.ascent ?? 0);
  const rulePt = 0.4;
  const symbolHeight = 0.675 * params.fontSizePt;
  const innerWidth = 0.6 * params.fontSizePt;
  const symbolBoxWidth = 0.77778 * params.fontSizePt;
  const left = params.x + params.block.width - symbolBoxWidth +
    (symbolBoxWidth - innerWidth - 2 * rulePt) / 2;
  const innerLeft = left + rulePt;
  const right = innerLeft + innerWidth;
  const top = baselineY - symbolHeight;
  return [
    { x: left, y: top, width: rulePt, height: symbolHeight },
    { x: innerLeft, y: top, width: innerWidth, height: rulePt },
    {
      x: innerLeft,
      y: baselineY - rulePt,
      width: innerWidth,
      height: rulePt,
    },
    { x: right, y: top, width: rulePt, height: symbolHeight },
  ];
}

function blockChromeMarkup(params: {
  block: PreparedBlock;
  x: number;
  y: number;
  titleFill: string;
  bodyFill: string;
}): string {
  const { block } = params;
  if (block.plan.style === "inmargin") {
    return (
      `<g data-beamer-block-template="${escapeAttribute(block.plan.templateId)}" />`
    );
  }
  const geometry = block.plan.geometry;
  const left = params.x - geometry.outerBleedPt;
  const right = params.x + block.width + geometry.outerBleedPt;
  const top = params.y + block.backgroundTop;
  const titleBottom = top + block.titleBackgroundHeight;
  const bodyTop = params.y + block.bodyBackgroundTop;
  const bottom = params.y + block.backgroundBottom;
  const radius = geometry.cornerRadiusPt;
  const gradientId = `${block.node.id}:transition`.replace(
    /[^A-Za-z0-9_-]/gu,
    "-"
  );
  const filterId = `${block.node.id}:shadow`.replace(
    /[^A-Za-z0-9_-]/gu,
    "-"
  );
  const titlePath =
    `M${fmt(left)} ${fmt(titleBottom)}V${fmt(top + radius)}` +
    `Q${fmt(left)} ${fmt(top)} ${fmt(left + radius)} ${fmt(top)}` +
    `H${fmt(right - radius)}` +
    `Q${fmt(right)} ${fmt(top)} ${fmt(right)} ${fmt(top + radius)}` +
    `V${fmt(titleBottom)}Z`;
  const bodyPath =
    `M${fmt(left)} ${fmt(bodyTop)}V${fmt(bottom - radius)}` +
    `Q${fmt(left)} ${fmt(bottom)} ${fmt(left + radius)} ${fmt(bottom)}` +
    `H${fmt(right - radius)}` +
    `Q${fmt(right)} ${fmt(bottom)} ${fmt(right)} ${fmt(bottom - radius)}` +
    `V${fmt(bodyTop)}Z`;
  const shadow = block.plan.shadow
    ? beamerRoundedShadowMarkup({
        id: filterId,
        left,
        top,
        right,
        bottom,
      })
    : "";
  return (
    `<g data-beamer-block-template="${block.plan.templateId}">` +
    `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${params.titleFill}" />` +
    `<stop offset="1" stop-color="${params.bodyFill}" />` +
    `</linearGradient></defs>` +
    shadow +
    `<path d="${titlePath}" fill="${params.titleFill}" />` +
    `<path d="M${fmt(left)} ${fmt(titleBottom)}H${fmt(right)}V${fmt(bodyTop)}H${fmt(left)}Z" fill="url(#${gradientId})" />` +
    `<path d="${bodyPath}" fill="${params.bodyFill}" />` +
    `</g>`
  );
}

function emitPreparedTitlePage(params: {
  prepared: PreparedTitlePage;
  x: number;
  y: number;
  fillUnit: number;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  theme: ResolvedBeamerTheme;
}): void {
  const page = params.prepared;
  for (const [index, box] of page.boxes.entries()) {
    const color = resolveBeamerThemeColor(params.theme, box.colorRole);
    const fill = box.colorRole === "title separator" ? color.fg : color.bg;
    if (!fill) continue;
    const bounds = { ...box.bounds, x: params.x + box.bounds.x, y: params.y + box.bounds.y };
    const id = `${page.node.id}:${box.colorRole}:background`;
    if (!box.rounded && box.colorRole !== "title separator") params.items.push({ id, kind: "background", sourceSpan: page.node.span, bounds, parentId: page.node.id });
    params.modelBuilder.addPart({ basePartId: `${page.node.id}:chrome:${index}`, sourceId: page.node.id, elementId: null,
      markup: titlePageChromeMarkup({ id, bounds, templateId: page.plan.templateId,
        style: box.rounded ? "rounded" : "colorbox", fill, shadow: box.rounded && page.plan.templateId.endsWith("-shadow") }) });
  }
  // Retain a template marker even when all colorboxes are transparent.
  params.modelBuilder.addPart({ basePartId: `${page.node.id}:template`, sourceId: page.node.id, elementId: null,
    markup: `<g data-beamer-title-page-template="${escapeAttribute(page.plan.templateId)}" />` });
  const childIds: string[] = [];
  for (const entry of page.text) {
    const { paragraph } = entry;
    const x = params.x + entry.x;
    const y = params.y + entry.top + entry.fillWeight * params.fillUnit;
    positionParagraphLayout(paragraph.layout, svgPoint(pt(x), pt(y)), paragraphLineExtent(paragraph));
    params.paragraphs.push(paragraph.layout);
    childIds.push(paragraph.layout.paragraphId);
    params.items.push({ id: paragraph.layout.paragraphId, kind: "text", sourceSpan: paragraph.layout.sourceSpan,
      bounds: paragraph.layout.bounds, parentId: page.node.id, paragraphId: paragraph.layout.paragraphId });
    params.modelBuilder.addPart({ basePartId: paragraph.layout.paragraphId, sourceId: paragraph.layout.paragraphId, elementId: null,
      markup: paragraphMarkup(paragraph.svgBody, x, y, textColor(params.theme, entry.colorRole)) });
  }
  params.items.push({ id: page.node.id, kind: "title-page", sourceSpan: page.node.span,
    bounds: { x: params.x - page.plan.outerBleedPt, y: params.y,
      width: page.width + 2 * page.plan.outerBleedPt, height: page.naturalHeight + (page.plan.style === "inmargin" ? params.fillUnit : 0) },
    parentId: null, childIds });
}

function titlePageChromeMarkup(params: {
  id: string;
  bounds: BeamerRect;
  templateId: string;
  style: "colorbox" | "rounded";
  fill: string;
  shadow: boolean;
}): string {
  const { bounds } = params;
  if (params.style === "colorbox") {
    return (
      `<g data-beamer-title-page-template="${escapeAttribute(params.templateId)}">` +
      rectMarkup(bounds, params.fill) +
      `</g>`
    );
  }
  const radius = 4;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const outline =
    `M${fmt(bounds.x + radius)} ${fmt(bounds.y)}` +
    `H${fmt(right - radius)}` +
    `Q${fmt(right)} ${fmt(bounds.y)} ${fmt(right)} ${fmt(bounds.y + radius)}` +
    `V${fmt(bottom - radius)}` +
    `Q${fmt(right)} ${fmt(bottom)} ${fmt(right - radius)} ${fmt(bottom)}` +
    `H${fmt(bounds.x + radius)}` +
    `Q${fmt(bounds.x)} ${fmt(bottom)} ${fmt(bounds.x)} ${fmt(bottom - radius)}` +
    `V${fmt(bounds.y + radius)}` +
    `Q${fmt(bounds.x)} ${fmt(bounds.y)} ${fmt(bounds.x + radius)} ${fmt(bounds.y)}Z`;
  const shadowId = `${params.id}:shadow`.replace(
    /[^A-Za-z0-9_-]/gu,
    "-"
  );
  const shadow = params.shadow
    ? beamerRoundedShadowMarkup({
        id: shadowId,
        left: bounds.x,
        top: bounds.y,
        right,
        bottom,
      })
    : "";
  return (
    `<g data-beamer-title-page-template="${escapeAttribute(params.templateId)}">` +
    shadow +
    `<path d="${outline}" fill="${params.fill}" />` +
    `</g>`
  );
}

function emitFrameParagraph(params: {
  prepared: Extract<PreparedFrameFlowItem, { kind: "paragraph" }>;
  x: number;
  y: number;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  theme: ResolvedBeamerTheme;
}): void {
  const laid = params.prepared.paragraph;
  const visibility = params.prepared.visibility === "hidden" ? "hidden" : "visible";
  if (visibility === "hidden") { laid.layout.visibility = "hidden"; laid.layout.hiddenSourceSpans = [laid.layout.sourceSpan]; }
  positionParagraphLayout(
    laid.layout,
    svgPoint(pt(params.x), pt(params.y)),
    params.prepared.naturalHeight
  );
  params.paragraphs.push(laid.layout);
  params.items.push({
    id: laid.layout.paragraphId,
    kind: "text",
    sourceSpan: laid.layout.sourceSpan,
    bounds: laid.layout.bounds,
    parentId: null,
    paragraphId: laid.layout.paragraphId,
    visibility,
  });
  for (const marker of laid.listMarkers) {
    params.items.push({
      id: marker.id,
      kind: "list-marker",
      sourceSpan: marker.sourceSpan ?? laid.layout.sourceSpan,
      bounds: {
        x: params.x + marker.bounds.x,
        y: params.y + marker.bounds.y,
        width: marker.bounds.width,
        height: marker.bounds.height,
      },
      parentId: laid.layout.paragraphId,
      traceAsGlyph: marker.traceAsGlyph,
      visibility: visibility === "hidden" ? "hidden" : marker.visibility,
    });
  }
  params.modelBuilder.addPart({
    basePartId: laid.layout.paragraphId,
    sourceId: laid.layout.paragraphId,
    elementId: null,
    markup: overlayVisibilityMarkup(paragraphMarkup(
      laid.svgBody,
      params.x,
      params.y,
      textColor(params.theme, "normal text")
    ), visibility),
  });
}

async function emitPreparedColumns(params: {
  prepared: Extract<PreparedFrameFlowItem, { kind: "columns" }>;
  referenceY: number;
  spacing: BeamerSpacingLayout[];
  bounds: BeamerRect;
  paperWidth: number;
  items: BeamerFrameLayoutItem[];
  paragraphs: BeamerParagraphLayout[];
  embeddedTikz: BeamerEmbeddedTikzLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  theme: ResolvedBeamerTheme;
  work?: BeamerRenderWork;
  visibility?: "visible" | "hidden";
}): Promise<void> {
  const prepared = params.prepared.columns;
  const covered = params.visibility === "hidden" || params.prepared.visibility === "hidden";
  const columnTops = prepared.map(
    (column) => params.referenceY - column.box.referenceFromContentTop
  );
  const visualTop = Math.min(...columnTops);
  const visualBottom = Math.max(
    ...prepared.map(
      (column, index) => requireArrayValue(columnTops, index) + column.naturalHeight
    )
  );
  const positions = resolveBeamerColumnPositions({
    ...(params.prepared.node.options?.value !== undefined ? { options: params.prepared.node.options.value } : {}),
    widths: prepared.map(column => column.width),
    textWidth: params.bounds.width,
    paperWidth: params.paperWidth,
    textLeft: params.bounds.x,
    leftMargin: params.theme.dimensions.textMarginLeftPt,
    rightMargin: params.theme.dimensions.textMarginRightPt,
  });
  const columnsId = params.prepared.node.id;
  const columnChildIds: string[] = [];
  for (const [index, preparedColumn] of prepared.entries()) {
    const x = requireArrayValue(positions, index);
    const columnId = preparedColumn.column.id;
    const childIds: string[] = [];
    const columnTop = requireArrayValue(columnTops, index);
    let flowY = columnTop;
    columnChildIds.push(columnId);
    for (const [flowIndex, flowItem] of preparedColumn.flow.entries()) {
      if (params.work) await params.work.checkpoint();
      if (
        flowItem.visibility === "hidden" &&
        !["block", "paragraph", "columns", "tikzpicture"].includes(flowItem.kind)
      ) {
        flowY += columnFlowAdvance(
          flowItem,
          preparedColumn.flow[flowIndex + 1] != null
        );
        continue;
      }
      if (flowItem.kind === "paragraph" || flowItem.kind === "block" || flowItem.kind === "columns") flowY += flowItem.leadingSkipPt ?? 0;
      if (flowItem.kind === "vertical-space") {
        params.spacing.push({ command: flowItem.node.command, sourceSpan: flowItem.node.span,
          sizePt: flowItem.height, ...(flowItem.relativeUnitPt !== undefined ? { relativeUnitPt: flowItem.relativeUnitPt } : {}),
          bounds: { x, y: flowY, width: preparedColumn.width, height: flowItem.height } });
        flowY += flowItem.height;
      } else if (flowItem.kind === "paragraph") {
        const laid = flowItem.paragraph;
        const visibility = covered || flowItem.visibility === "hidden" ? "hidden" : "visible";
        if (visibility === "hidden") { laid.layout.visibility = "hidden"; laid.layout.hiddenSourceSpans = [laid.layout.sourceSpan]; }
        positionParagraphLayout(
          laid.layout,
          svgPoint(pt(x), pt(flowY)),
          flowItem.advanceHeight
        );
        params.paragraphs.push(laid.layout);
        childIds.push(laid.layout.paragraphId);
        params.items.push({
          id: laid.layout.paragraphId,
          kind: "text",
          sourceSpan: laid.layout.sourceSpan,
          bounds: laid.layout.bounds,
          parentId: columnId,
          paragraphId: laid.layout.paragraphId,
          visibility,
        });
        for (const marker of laid.listMarkers) {
          params.items.push({
            id: marker.id,
            kind: "list-marker",
            sourceSpan: marker.sourceSpan ?? laid.layout.sourceSpan,
            bounds: {
              x: x + marker.bounds.x,
              y: flowY + marker.bounds.y,
              width: marker.bounds.width,
              height: marker.bounds.height,
            },
            parentId: laid.layout.paragraphId,
            traceAsGlyph: marker.traceAsGlyph,
            visibility: visibility === "hidden" ? "hidden" : marker.visibility,
          });
        }
        params.modelBuilder.addPart({
          basePartId: laid.layout.paragraphId,
          sourceId: laid.layout.paragraphId,
          elementId: null,
          markup: overlayVisibilityMarkup(paragraphMarkup(
            laid.svgBody,
            x,
            flowY,
            textColor(params.theme, "normal text")
          ), visibility),
        });
        flowY +=
          flowItem.advanceHeight +
          (preparedColumn.flow[flowIndex + 1]
            ? flowItem.trailingSkipPt
            : 0);
      } else if (flowItem.kind === "block") {
        await emitPreparedBlock({
          spacing: params.spacing, embeddedTikz: params.embeddedTikz, paperWidth: params.paperWidth,
          ...(params.work !== undefined ? { work: params.work } : {}),
          prepared: flowItem.block,
          x,
          y: flowY,
          parentId: columnId,
          items: params.items,
          paragraphs: params.paragraphs,
          modelBuilder: params.modelBuilder,
          theme: params.theme,
          visibility:
            covered || flowItem.visibility === "hidden" ? "hidden" : "visible",
        });
        childIds.push(flowItem.block.node.id);
        flowY +=
          flowItem.height +
          (preparedColumn.flow[flowIndex + 1]
            ? flowItem.block.plan.geometry.afterSkipPt
            : 0);
      } else if (flowItem.kind === "columns") {
        await emitPreparedColumns({ ...params, prepared: flowItem, visibility: covered ? "hidden" : "visible",
          referenceY: flowY + flowItem.box.height,
          bounds: { x, y: flowY, width: preparedColumn.width, height: flowItem.height } });
        childIds.push(flowItem.node.id);
        flowY += flowItem.height;
      } else if (flowItem.kind === "unsupported") {
        emitUnsupportedPlaceholder({
          placeholder: flowItem.placeholder,
          x,
          y: flowY,
          parentId: columnId,
          items: params.items,
          modelBuilder: params.modelBuilder,
        });
        childIds.push(flowItem.placeholder.id);
        flowY += flowItem.height;
      } else {
        emitEmbeddedTikz({
          tikz: covered ? { ...flowItem, visibility: "hidden" } : flowItem,
          x: x + (flowItem.horizontalAlignment === "center" ? (preparedColumn.width - flowItem.width) / 2 : flowItem.horizontalAlignment === "right" ? preparedColumn.width - flowItem.width : 0),
          y: flowY,
          parentId: columnId,
          items: params.items,
          embeddedTikz: params.embeddedTikz,
          modelBuilder: params.modelBuilder,
        });
        childIds.push(flowItem.id);
        flowY += flowItem.height;
      }
    }
    params.items.push({
      id: columnId,
      kind: "column",
      sourceSpan: preparedColumn.column.span,
      bounds: {
        x,
        y: columnTop,
        width: preparedColumn.width,
        height: preparedColumn.naturalHeight,
      },
      parentId: columnsId,
      childIds,
    });
  }
  params.items.push({
    id: columnsId,
    kind: "columns",
    sourceSpan: params.prepared.node.span,
    bounds: {
      x: params.bounds.x,
      y: visualTop,
      width: params.bounds.width,
      height: Math.max(0, visualBottom - visualTop),
    },
    parentId: null,
    childIds: columnChildIds,
  });
}

function columnFlowAdvance(
  item: PreparedColumnFlowItem,
  hasNext: boolean
): number {
  if (item.kind === "paragraph") {
    return (item.leadingSkipPt ?? 0) + item.advanceHeight + (hasNext ? item.trailingSkipPt : 0);
  }
  if (item.kind === "block") {
    return (item.leadingSkipPt ?? 0) + item.height + (hasNext ? item.block.plan.geometry.afterSkipPt : 0);
  }
  return (item.kind === "columns" ? item.leadingSkipPt ?? 0 : 0) + item.height;
}

async function prepareColumnContent(params: {
  source: string;
  column: BeamerColumnBodyNode;
  textWidth: number;
  diagnostics: Diagnostic[];
  theme: ResolvedBeamerTheme;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  leftSidebarWidth: number;
  overlays: BeamerOverlayModel;
  step: number;
  graphicsResolver?: DocumentGraphicsResolver;
  paperWidth: number;
  work?: BeamerRenderWork;
}): Promise<PreparedColumnContent> {
  const {
    source,
    column,
    textWidth,
    diagnostics,
    theme,
    macroBindings,
    references,
  } = params;
  const width = resolveBeamerColumnWidth(column.width.value, textWidth, params.paperWidth) ?? textWidth;
  const flow: PreparedColumnFlowItem[] = [];
  const bodyFont = ambientTextTheme(theme, references.ambientTextAt?.(column.bodySpan.from) ?? "").fonts["normal-text"];
  const listProfile = beamerListLayoutProfile(theme, references.crampedLists);
  let previousDepth: number | undefined;

  for (const node of column.children) {
    if (params.work) await params.work.checkpoint();
    const prepared = await prepareColumnFlowNode({
      source,
      node,
      width,
      bodyFont,
      theme,
      diagnostics,
      listProfile,
      ...(node.kind === "list" && previousDepth !== undefined ? { initialPreviousDepth: previousDepth } : {}),
      macroBindings,
      references,
      leftSidebarWidth: params.leftSidebarWidth,
      overlays: params.overlays,
      step: params.step,
      ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
      paperWidth: params.paperWidth,
      ...(params.work !== undefined ? { work: params.work } : {}),
      // T's \colheadskip ships the leading empty line before \vskip-1ex.
      // A first display selects short skips without another baseline skip.
      firstInColumn: flow.length === 0,
      ...(column.alignment === "T" && flow.length === 0 ? { leadingDisplayBaselineSkipPt: 0 } : {}),
    });
    if (prepared) {
      const previous = flow.at(-1);
      if (prepared.kind === "block" && prepared.block.packageBox) {
        const spacing = tcolorboxSurroundingSpacing(prepared.block.packageBox.plan, {
          baselineSkipPt: bodyFont.lineHeightPt, previousDepthPt: previousDepth ?? null,
        });
        // \addvspace replaces T's negative -1ex lastskip before applying the
        // box skip. The column's \leavevmode has already cleared minipage mode.
        prepared.leadingSkipPt = spacing.beforePt + (flow.length === 0 && column.alignment === "T" && !prepared.block.packageBox.plan.noBeforeAfter ? fontXHeightPt(bodyFont) : 0);
      } else if ((previousDepth != null || (flow.length === 0 && column.alignment !== "T" && prepared.kind === "block")) &&
          (prepared.kind === "block" || (prepared.kind === "paragraph" && previous?.kind === "block"))) {
        // column's \leavevmode starts an empty line before a leading block's
        // \par. Its depth is zero, so normal baseline glue precedes the first
        // title box. T columns clear that depth with \nointerlineskip instead.
        const nextHeight = prepared.kind === "block"
          ? prepared.block.flowBoxHeight : paragraphStartingMaterialHeight(prepared.paragraph);
        const interline = bodyFont.lineHeightPt - (previousDepth ?? 0) - nextHeight;
        prepared.leadingSkipPt = (prepared.leadingSkipPt ?? 0) + (interline < 0 ? 1 : interline);
      }
      flow.push(prepared);
      if (prepared.kind === "paragraph") {
        previousDepth = paragraphLastLineDepth(prepared.paragraph);
      } else if (prepared.kind === "tikzpicture" || prepared.kind === "unsupported") {
        previousDepth = 0;
      } else if (prepared.kind === "columns") {
        const glue = bodyFont.lineHeightPt - (previousDepth ?? 0) - prepared.box.height;
        prepared.leadingSkipPt = previousDepth == null && column.alignment === "T" ? 0 : glue < 0 ? 1 : glue;
        previousDepth = prepared.box.depth;
      } else if (prepared.kind === "block") {
        previousDepth = prepared.block.endingDepth;
      }
    }
  }

  const terminal = flow.at(-1);
  if (terminal?.kind === "paragraph") {
    const last = terminal.paragraph.layout.vlistLayout.boxReport.items.at(-1);
    // Only endminipage removes the terminal skip. Intermediate paragraphs
    // retain below-display and structural glue before following flow boxes.
    if (last?.itemKind === "glue") terminal.advanceHeight -= Number(last.height);
  }
  const naturalHeight = flow.reduce(
    (height, item, index) =>
      height + ((item.kind === "paragraph" || item.kind === "block" || item.kind === "columns") ? item.leadingSkipPt ?? 0 : 0) +
      (item.kind === "paragraph"
        ? item.advanceHeight +
          (flow[index + 1] ? item.trailingSkipPt : 0)
        : item.kind === "block" &&
            item.block.plan.style === "inmargin" &&
            !flow[index + 1]
          // TeX drops the terminal \smallskip glue when the in-margin block's
          // vtop becomes the final material in a column minipage.
          ? item.height - item.block.plan.geometry.boxBottomSkipPt
          : item.height) +
      (item.kind === "block" && flow[index + 1]
        ? item.block.plan.geometry.afterSkipPt
        : 0),
    0
  );
  return {
    column,
    width,
    flow,
    naturalHeight,
    box: measureColumnVerticalBox(
      column.alignment,
      flow,
      naturalHeight,
      bodyFont
    ),
  };
}

async function prepareColumnFlowNode(params: {
  source: string;
  node: BeamerColumnFlowNode;
  width: number;
  bodyFont: BeamerThemeFont;
  theme: ResolvedBeamerTheme;
  diagnostics: Diagnostic[];
  listProfile: TexListLayoutProfile;
  initialPreviousDepth?: number;
  leadingDisplayBaselineSkipPt?: number;
  firstInColumn?: boolean;
  macroBindings: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  leftSidebarWidth: number;
  overlays: BeamerOverlayModel;
  step: number;
  graphicsResolver?: DocumentGraphicsResolver;
  paperWidth: number;
  work?: BeamerRenderWork;
}): Promise<PreparedColumnFlowItem | null> {
  const {
    source,
    node,
    width,
    bodyFont,
    theme,
    diagnostics,
    listProfile,
    initialPreviousDepth,
    macroBindings,
    references,
    leftSidebarWidth,
    overlays,
    step,
    graphicsResolver,
    paperWidth,
  } = params;
  const visibility = resolveBeamerOverlaySpanVisibility(
    overlays,
    node.span,
    step
  );
  if (visibility === "removed") {
    return null;
  }
  if (node.kind === "columns") {
    const flow = await prepareFrameFlow({ source, children: [node], textWidth: width, paperWidth,
      leftSidebarWidth, theme, macroBindings, references, overlays, step, diagnostics,
      ...requireDefined(references.frameLayout, "Expected the enclosing frame geometry"),
      availableHeight: Number.POSITIVE_INFINITY,
      ...(graphicsResolver !== undefined ? { graphicsResolver } : {}),
      ...(params.work !== undefined ? { work: params.work } : {}),
    });
    const columns = flow.find(item => item.kind === "columns");
    return columns?.kind === "columns" ? { ...columns, height: columns.box.height + columns.box.depth } : null;
  }
  if (node.kind === "vertical-space") {
    return {
      kind: "vertical-space",
      visibility,
      node,
      ...measureVerticalSpace(node, bodyFont),
    };
  }
  if (node.kind === "block" || node.kind === "theorem") {
    const block = await runBeamerRenderOperation(params.work, () => prepareBlock({
      source,
      node,
      width,
      leftSidebarWidth,
      theme,
      macroBindings,
      references,
      overlays,
      step,
      ...(graphicsResolver !== undefined ? { graphicsResolver } : {}),
      paperWidth,
      diagnostics,
      ...(params.work !== undefined ? { work: params.work } : {}),
    }));
    return block
      ? { kind: "block", visibility, block, height: block.naturalHeight }
      : null;
  }
  if (node.kind === "paragraph" || node.kind === "list") {
    const text = source.slice(node.span.from, node.span.to);
    const projection = projectBeamerOverlayText(
      createIdentityMappedText(text, node.span.from),
      node.span,
      overlays,
      step
    );
    const layoutParams = {
      mapped: projection.mapped,
      sourceSpan: node.span,
      paragraphId: node.id,
      role: "body" as const,
      bounds: { x: 0, y: 0, width, height: 0 },
      font: bodyFont,
      colorResolver: beamerAlertColorResolver(theme),
      alignment: node.kind === "paragraph" ? node.alignment ?? "left" : "left",
      ...(initialPreviousDepth !== undefined ? { initialPreviousDepth } : {}),
      ...(params.leadingDisplayBaselineSkipPt !== undefined ? { leadingDisplayBaselineSkipPt: params.leadingDisplayBaselineSkipPt } : {}),
      listProfile,
      macroBindings,
      references,
      hiddenSourceSpans: projection.hiddenSourceSpans,
      ...(graphicsResolver !== undefined ? { graphicsResolver } : {}),
      paperWidth,
    };
    let paragraph = runBeamerRenderOperation(params.work, () => layoutParagraph(layoutParams));
    const firstMaterial = paragraph?.layout.vlistLayout.boxReport.items.find(item => item.itemKind !== "glue" && item.itemKind !== "penalty" && item.itemKind !== "vbox");
    const startsWithDisplay = firstMaterial?.hboxRole?.kind === "display-empty-line" && firstMaterial.hboxRole.position === "before-display";
    if (paragraph && params.firstInColumn && startsWithDisplay && params.leadingDisplayBaselineSkipPt !== 0) {
      paragraph = runBeamerRenderOperation(params.work, () => layoutParagraph({ ...layoutParams, leadingDisplayBaselineSkipPt: 0 }));
    }
    if (!paragraph) {
      if (!hasProjectedContent(source, node.span, overlays, step, references)) {
        return null;
      }
      const placeholder = prepareUnsupportedPlaceholder(
        source,
        { ...node, message: params.references.layoutFailures?.get(node.span.from) ?? "This content could not be laid out." },
        width
      );
      diagnostics.push({
        severity: "warning",
        code: "beamer-render-unsupported-flow-node",
        message: placeholder.message,
        span: node.span,
      });
      return {
        kind: "unsupported",
        visibility,
        placeholder,
        height: placeholder.height,
      };
    }
    return {
      kind: "paragraph",
      visibility,
      paragraph,
      startsWithVerticalEnvironment: startsWithDisplay || /^\s*\\begin\s*\{(?:center|flushleft|flushright|itemize|enumerate|description)\}/u.test(projection.mapped.text),
      replacesColumnHeadSkip: /^\s*\\begin\s*\{(?:center|flushleft|flushright)\}/u.test(projection.mapped.text) &&
        !paragraph.layout.vlistLayout.boxReport.items.some(item => item.role?.kind === "trivlist" && item.role.noParList),
      leadingSkipPt: leadingBeamerTrivlistAdjustment(projection.mapped.text, paragraph, params.listProfile.trivlistTopsepPt) +
        // A column minipage starts with \leavevmode. A leading trivlist ends
        // that empty line, then inserts normal interline glue before its first box.
        (initialPreviousDepth === undefined && params.leadingDisplayBaselineSkipPt !== 0 && /^\s*\\begin\s*\{(?:center|flushleft|flushright|itemize|enumerate|description)\}/u.test(projection.mapped.text)
          ? (() => {
              const baseline = firstMaterial?.hboxRole?.kind === "external-flow"
                ? firstMaterial.hboxRole.baselineSkipPt ?? paragraphStartingBaselineSkip(paragraph, bodyFont.lineHeightPt)
                : paragraphStartingBaselineSkip(paragraph, bodyFont.lineHeightPt);
              const skip = Math.round((baseline - paragraphStartingMaterialHeight(paragraph)) * 65_536) / 65_536;
              return skip >= 0 ? skip : 1;
            })() : 0),
      // A plain TeX paragraph contributes its line hboxes, not the TikZ-node
      // strut carried by the shared text frontend's enclosing vlist. Lists,
      // on the other hand, intentionally carry their vertical list glue.
      advanceHeight: node.kind === "paragraph" ? paragraphMaterialExtent(paragraph) : paragraph.height,
      // minipage's terminal \unskip drops the final trivlist skip; retain it
      // only when another flow item follows, as for the list's trailing glue.
      trailingSkipPt: node.kind === "list" ? trailingScopedBeamerListSkip(projection.mapped, params.references, params.bodyFont)
        : trailingBeamerTrivlistSkip(projection.mapped.text, params.listProfile.trivlistTopsepPt),
    };
  }
  if (node.kind === "unsupported") {
    diagnostics.push({
      severity: "warning",
      code: "beamer-render-unsupported-flow-node",
      message: node.message,
      span: node.span,
    });
    const placeholder = prepareUnsupportedPlaceholder(source, node, width);
    return {
      kind: "unsupported",
      visibility,
      placeholder,
      height: placeholder.height,
    };
  }
  return prepareEmbeddedTikz({
    overlays, step,
    source, theme,
    node,
    width,
    bodyFont,
    diagnostics,
    visibility,
    ...(graphicsResolver !== undefined ? { graphicsResolver } : {}),
    ...(params.work !== undefined ? { work: params.work } : {}),
  });
}

/** Covered paths still contribute their PGF geometry but do not paint. */
function beamerTikzPaintModel(rendered: RenderTikzToSvgResult, overlays: BeamerOverlayModel, step: number) {
  const hiddenIds = new Set(rendered.semantic.scene.elements.filter(element =>
    resolveBeamerOverlaySpanVisibility(overlays, element.sourceRef.sourceSpan, step) === "hidden").map(element => element.id));
  return hiddenIds.size === 0 ? rendered.svg.model : {
    ...rendered.svg.model,
    parts: rendered.svg.model.parts.filter(part => !part.elementId || !hiddenIds.has(part.elementId)),
  };
}

async function prepareEmbeddedTikz(params: {
  source: string;
  theme?: ResolvedBeamerTheme;
  overlays: BeamerOverlayModel;
  step: number;
  node: Extract<BeamerColumnFlowNode | BeamerFrameBodyNode, {
    kind: "tikzpicture";
  }>;
  width: number;
  bodyFont: BeamerThemeFont;
  diagnostics: Diagnostic[];
  visibility: BeamerOverlayVisibility;
  graphicsResolver?: DocumentGraphicsResolver;
  work?: BeamerRenderWork;
}): Promise<Extract<PreparedColumnFlowItem, {
  kind: "tikzpicture";
}> | null> {
  const textEngine = await createTexNodeTextEngine({
    mathFontProfile: createBeamerTexMathFontProfile(params.bodyFont),
  });
  const rendered = await renderTikzToSvgAsync(
    maskTikzPictureSource(projectBeamerTikzSource(params.source, params.node.root.span, params.overlays, params.step), params.node.root.span),
    {
      textEngine,
      parse: { includeContextDefinitions: true },
      evaluate: { initialFont: beamerTikzFontCommand(params.bodyFont),
        namedFontSizes: Object.fromEntries(beamerNamedFontSizes(params.theme).map(([name, size]) => [name, size])) },
      ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
      ...(params.work?.options !== undefined ? { cooperative: params.work.options } : {}),
      // A TikZ picture contributes its natural PGF bounding box to the
      // surrounding TeX hbox. The standalone renderer's presentation padding
      // is useful for an isolated SVG, but it is not part of that box.
      svg: { padding: 0 },
    }
  );
  const model = beamerTikzPaintModel(rendered, params.overlays, params.step);
  const visibleParts = new Set(model.parts);
  const coveredModel = { ...rendered.svg.model, parts: rendered.svg.model.parts.filter(part => !visibleParts.has(part)) };
  const empty = rendered.semantic.scene.elements.length === 0 && !rendered.semantic.scene.bounds;
  const viewBox = empty ? { x: 0, y: 0, width: 1, height: 1 } : rendered.svg.viewBox;
  const scale = Math.min(1, params.width / Math.max(viewBox.width, 1));
  for (const diagnostic of [
    ...rendered.parse.diagnostics,
    ...rendered.semantic.diagnostics,
  ]) {
    params.diagnostics.push({
      severity: diagnostic.severity,
      ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {}),
      message: diagnostic.message,
      span: params.node.root.span,
    });
  }
  return {
    kind: "tikzpicture",
    visibility: params.visibility,
    id: params.node.id,
    sourceSpan: params.node.span,
    horizontalAlignment: params.node.horizontalAlignment,
    width: empty ? 0 : viewBox.width * scale,
    height: empty ? 0 : viewBox.height * scale,
    model,
    coveredModel,
    viewBox,
  };
}

/**
 * TikZ `overlay` pictures in the frame body. TeX set each as an empty box in
 * its paragraph (projectBeamerOverlayPictureBoxes); the picture is drawn from
 * that box's place, over the page, and with `remember picture` its
 * `current page` node is the page.
 */
async function emitBeamerOverlayPictures(params: {
  context: BeamerSyntaxContext;
  picturePaintOwners: BeamerPicturePaintOwner[];
  overlays: BeamerOverlayModel;
  step: number;
  frameId: string;
  frameIndex: number;
  bodySpan: Span;
  paragraphs: readonly BeamerParagraphLayout[];
  bodyTransform: BeamerPaintTransform | undefined;
  page: BeamerRect;
  font: BeamerThemeFont;
  diagnostics: Diagnostic[];
  items: BeamerFrameLayoutItem[];
  embeddedTikz: BeamerEmbeddedTikzLayout[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
  graphicsResolver?: DocumentGraphicsResolver;
  drawingLayer?: string;
  work?: BeamerRenderWork;
}): Promise<void> {
  const pictures = beamerOverlayPicturesIn(params.context, params.bodySpan);
  if (pictures.length === 0) return;
  const textEngine = await createTexNodeTextEngine({
    mathFontProfile: createBeamerTexMathFontProfile(params.font),
  });
  for (const [index, picture] of pictures.entries()) {
    const paragraph = params.paragraphs.find((candidate) =>
      candidate.report.lines.some((line) => line.segments.some((segment) => Number(segment.sourceStartRaw) === picture.span.from))
    );
    if (!paragraph || paragraph.hiddenSourceSpans?.some((span) => span.from <= picture.span.from && picture.span.to <= span.to)) {
      continue;
    }
    const intrinsic = beamerOverlayPictureOrigin(paragraph, paragraph.transformedLayout?.intrinsicBounds ?? paragraph.bounds, picture.span);
    if (!intrinsic) continue;
    // A shrunk body scales its boxes; the picture is drawn at its box's place.
    const origin = params.bodyTransform ? transformBeamerPoint(params.bodyTransform, intrinsic) : intrinsic;
    const rootId = formatDocumentRootId({ kind: "beamer-frame-tikz", frameIndex: params.frameIndex, index, layer: true });
    params.picturePaintOwners.push({ paragraphId: paragraph.paragraphId, span: picture.span, sourceId: `${params.frameId}:overlay-picture:${index}` });
    if (rootId === params.drawingLayer) {
      // Its editor paints it; an empty group keeps its place in the page's order.
      emitEmbeddedTikz({
        tikz: { kind: "tikzpicture", visibility: "visible", id: `${params.frameId}:overlay-picture:${index}`, sourceSpan: picture.span,
          horizontalAlignment: "left", width: 0, height: 0, viewBox: { x: 0, y: 0, width: 1, height: 1 },
          model: { viewBox: { x: 0, y: 0, width: 1, height: 1 }, defs: [], defsFingerprint: "", parts: [], diagnostics: [] } },
        x: origin.x, y: origin.y, parentId: null, items: params.items, embeddedTikz: params.embeddedTikz, modelBuilder: params.modelBuilder,
      });
      Object.assign(requireArrayValue(params.items, params.items.length - 1), { overlayPicture: true, rootId });
      requireArrayValue(params.embeddedTikz, params.embeddedTikz.length - 1).overlay = { rootId, origin, rememberPicture: picture.rememberPicture, elements: [], sourceOffset: 0 };
      continue;
    }
    const rendered = await renderTikzToSvgAsync(
      maskTikzPictureSource(projectBeamerTikzSource(params.context.source, picture.span, params.overlays, params.step), picture.span),
      {
        textEngine,
        parse: { includeContextDefinitions: true },
        ...(params.graphicsResolver !== undefined ? { graphicsResolver: params.graphicsResolver } : {}),
        ...(params.work?.options !== undefined ? { cooperative: params.work.options } : {}),
        svg: { padding: 0 },
        // With `remember picture`, PGF knows where the picture is on the page;
        // without, `current page` takes the picture's origin for the page's corner.
        evaluate: {
          initialFont: beamerTikzFontCommand(params.font),
          ...(picture.tikzLayer && { pictureOptions: BEAMER_TIKZ_LAYER_OPTIONS }),
          currentPage: picture.rememberPicture
            ? { minX: -origin.x, minY: origin.y - params.page.height, maxX: params.page.width - origin.x, maxY: origin.y }
            : { minX: 0, minY: 0, maxX: params.page.width, maxY: params.page.height },
        },
      }
    );
    for (const diagnostic of [...rendered.parse.diagnostics, ...rendered.semantic.diagnostics]) {
      params.diagnostics.push({ severity: diagnostic.severity, ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {}), message: diagnostic.message, span: picture.span });
    }
    const viewBox = rendered.svg.viewBox;
    // The picture's origin, world (0, 0), is at SVG (0, 2·y + height) of its view box.
    emitEmbeddedTikz({
      tikz: {
        kind: "tikzpicture",
        visibility: "visible",
        id: `${params.frameId}:overlay-picture:${index}`,
        sourceSpan: picture.span,
        horizontalAlignment: "left",
        width: viewBox.width,
        height: viewBox.height,
        model: beamerTikzPaintModel(rendered, params.overlays, params.step),
        viewBox,
      },
      x: origin.x + viewBox.x,
      y: origin.y - viewBox.y - viewBox.height,
      parentId: null,
      items: params.items,
      embeddedTikz: params.embeddedTikz,
      modelBuilder: params.modelBuilder,
    });
    Object.assign(requireArrayValue(params.items, params.items.length - 1), { overlayPicture: true, rootId });
    requireArrayValue(params.embeddedTikz, params.embeddedTikz.length - 1).overlay = {
      rootId,
      origin,
      rememberPicture: picture.rememberPicture,
      elements: rendered.semantic.scene.elements.filter(element => resolveBeamerOverlaySpanVisibility(params.overlays, element.sourceRef.sourceSpan, params.step) === "visible"),
      sourceOffset: 0,
    };
  }
}

function measureColumnVerticalBox(
  alignment: BeamerColumnAlignment,
  flow: readonly PreparedColumnFlowItem[],
  naturalHeight: number,
  font: BeamerThemeFont
): ColumnVerticalBox {
  if (alignment === "T") {
    const xHeight = flow[0]?.kind === "paragraph" && flow[0].replacesColumnHeadSkip ? 0 : fontXHeightPt(font);
    // beamerbaseframecomponents.sty selects a top-aligned minipage and emits
    // `\vskip-1ex\nointerlineskip`. The artificial leading empty line gives
    // the vtop zero height; the content can therefore protrude above its
    // reference line while only the remainder contributes to its depth.
    return {
      height: 0,
      depth: Math.max(0, naturalHeight - xHeight),
      referenceFromContentTop: xHeight,
    };
  }

  if (alignment === "bottom") {
    // minipage[b] is a vbox: its reference is the final baseline, and its
    // last box keeps its depth. Aligning geometric bottoms loses descenders.
    const last = flow.at(-1);
    const depth = last?.kind === "paragraph" ? paragraphEndingMaterialDepth(last.paragraph)
      : last?.kind === "block" ? last.block.endingDepth : last?.kind === "columns" ? last.box.depth : 0;
    return {
      height: naturalHeight - depth,
      depth,
      referenceFromContentTop: naturalHeight - depth,
    };
  }

  if (alignment === "center") {
    // LaTeX's `minipage[c]` lowers through `\@iiiparbox` to `\vcenter`.
    // TeX centers the total box extent on the active math axis rather than
    // splitting height/depth geometrically around the reference line.
    const mathAxis =
      Number(defaultTexMathFontProfile.parameters.axisHeight) * font.sizePt;
    const height = naturalHeight / 2 + mathAxis;
    return {
      height,
      depth: naturalHeight - height,
      referenceFromContentTop: height,
    };
  }

  // A leading Beamer block starts with \par after column's \leavevmode.
  // Its empty first line gives a top-aligned minipage zero height; the block
  // follows below that reference. Ordinary prose shares the initial line.
  const first = flow[0];
  const firstReference = first?.kind === "columns" || (first?.kind === "block" && !first.block.packageBox) ||
    (first?.kind === "paragraph" && first.startsWithVerticalEnvironment)
    ? 0 : firstFlowReferenceFromTop(flow);
  return {
    height: firstReference,
    depth: Math.max(0, naturalHeight - firstReference),
    referenceFromContentTop: firstReference,
  };
}

function firstFlowReferenceFromTop(
  flow: readonly PreparedColumnFlowItem[]
): number {
  let offset = 0;
  for (const item of flow) {
    if (item.kind === "paragraph" || item.kind === "block") offset += item.leadingSkipPt ?? 0;
    if (item.kind === "vertical-space") {
      offset += item.height;
      continue;
    }
    if (item.kind === "tikzpicture" || item.kind === "unsupported") {
      return offset + item.height;
    }
    if (item.kind === "block") {
      return offset + item.height;
    }
    if (item.kind === "columns") return offset + item.box.height;
    const firstLine = item.paragraph.layout.report.lines[0];
    if (!firstLine) {
      offset += item.advanceHeight;
      continue;
    }
    const placement = item.paragraph.layout.vlistLayout.linePlacements.find(
      (candidate) => candidate.lineIndex === firstLine.lineIndex
    );
    return offset + Number(placement?.y ?? 0) + Number(firstLine.ascent);
  }
  return offset;
}

function paragraphLineExtent(paragraph: LaidParagraph): number {
  let bottom = 0;
  for (const line of paragraph.layout.report.lines) {
    const placement = paragraph.layout.vlistLayout.linePlacements.find(
      (candidate) => candidate.lineIndex === line.lineIndex
    );
    bottom = Math.max(
      bottom,
      Number(placement?.y ?? 0) +
        Number(line.ascent) +
        Number(line.descent)
    );
  }
  for (const item of paragraph.layout.vlistLayout.boxReport.items) {
    if (item.itemKind === "display-math" || item.hboxRole?.kind === "display-align-row" || item.hboxRole?.kind === "display-empty-line") {
      bottom = Math.max(bottom, Number(item.y + item.height + item.depth));
    }
  }
  const visitExternal = (items: typeof paragraph.layout.vlistLayout.items): void => {
    for (const item of items) {
      if (item.item.kind === "hbox" && item.item.role?.kind === "external-flow") bottom = Math.max(bottom, Number(item.y) + Number(item.item.advance ?? item.metrics.height + item.metrics.depth));
      if (item.children) visitExternal(item.children);
    }
  };
  visitExternal(paragraph.layout.vlistLayout.items);
  // Block bodies are minipages: \endminipage removes the terminal display
  // skip with \unskip. The final painted equation still contributes its box.
  return bottom || paragraphMaterialExtent(paragraph);
}

function paragraphMaterialExtent(paragraph: LaidParagraph): number {
  const last = paragraph.layout.vlistLayout.items.at(-1);
  if (!last) return 0;
  // The root's synthetic strut baseline can exceed a short line's actual
  // bottom. Frame flow advances by the material, not that baseline floor.
  return Number(last.y + (last.item.kind === "glue" && last.item.size < 0
    ? last.item.size : last.metrics.height + last.metrics.depth));
}

function fontXHeightPt(font: BeamerThemeFont): number {
  const fontSize = texLength(font.sizePt);
  const profile = createBeamerTexTextFontProfile(font);
  const resolved = profile.resolveTextFont(
    profile.defaultFontState,
    fontSize,
    profile.metricProvider
  );
  // TeX rounds fractional Lua font parameters when assigning a dimension.
  return Math.round(Number(resolved.atPt) * resolved.data.fontdimen.xheight * 65_536) / 65_536;
}

function positionParagraphLayout(
  layout: BeamerParagraphLayout,
  origin: SvgPoint,
  height = layout.bounds.height
): void {
  layout.bounds = {
    ...layout.bounds,
    x: Number(origin.x),
    y: Number(origin.y),
    height,
  };
  layout.editableTextSpans = collectBeamerEditableTextSpans(
    layout.paragraphId,
    layout.role,
    layout.report,
    layout.vlistLayout,
    layout.sourceSpan,
    layout.bounds,
    (layout.hiddenSourceSpans ?? []).concat(layout.readOnlySourceSpans ?? [])
  );
  layout.atomicRenderSpans = collectBeamerAtomicRenderSpans(
    layout.paragraphId,
    layout.role,
    layout.report,
    layout.vlistLayout,
    layout.sourceSpan,
    layout.bounds,
    layout.hiddenSourceSpans ?? [],
    layout.macroArgumentRuns ?? []
  );
}

/**
 * Layout color resolvers keyed by alerted-text color: `\alert{...}` in any
 * frame text resolves through this alias to the theme's "alerted text"
 * foreground. Memoized so resolver identity is stable across paragraphs
 * of one render (and across renders of an unchanged theme).
 */
const beamerAlertColorResolvers = new Map<string, NodeTextColorResolver>();

function beamerAlertColorResolver(theme: ResolvedBeamerTheme): NodeTextColorResolver {
  const color = resolveBeamerThemeColor(theme, "alerted text").fg ?? "#ff0000";
  let resolver = beamerAlertColorResolvers.get(color);
  if (!resolver) {
    resolver = {
      cacheKey: `beamer-alert:${color}`,
      resolve: (name) => (name === TEX_ALERT_COLOR_ALIAS ? color : null),
    };
    beamerAlertColorResolvers.set(color, resolver);
  }
  return resolver;
}

function projectBeamerAlertWeight(mapped: MappedText, owner: Span): MappedText {
  if (!mapped.text.includes("\\alert")) return mapped;
  const syntax = createBeamerSyntaxContext(mapped.text).syntax;
  const insertions: number[] = [];
  for (const control of syntax.controls) {
    if (control.name !== "alert") continue;
    let node = syntax.tree.resolveInner(control.span.from + 1, 1);
    let math = false;
    while (node.parent) { if (["InlineMath", "DisplayMath", "MathEnvironment"].includes(node.name)) math = true; node = node.parent; }
    const body = syntax.argumentAfter(control.span.to, "required", mapped.text.length);
    if (body && !math) insertions.push(body.contentSpan.from);
  }
  const parts: MappedText[] = [];
  let cursor = 0;
  for (const position of insertions.sort((a, b) => a - b)) {
    parts.push(sliceMappedText(mapped, cursor, position), createGeneratedMappedText("\\bfseries ", "Beamer dove alert weight", owner));
    cursor = position;
  }
  parts.push(sliceMappedText(mapped, cursor, mapped.text.length));
  return concatMappedText(parts);
}

function layoutParagraph(params: {
  mapped: MappedText;
  sourceSpan: Span;
  paragraphId: string;
  role: BeamerParagraphLayout["role"];
  bounds: BeamerRect;
  font: BeamerThemeFont;
  mathFont?: BeamerThemeFont;
  alignment: "left" | "center" | "right";
  spaceGlueProfile?: "font" | "font-fixed";
  centerWithInfiniteGlue?: boolean;
  justify?: boolean;
  interwordSpacePt?: number;
  initialBaselineSkipPt?: number;
  initialPreviousDepth?: number;
  leadingDisplayBaselineSkipPt?: number;
  listProfile?: TexListLayoutProfile;
  disableAutomaticHyphenation?: boolean;
  macroBindings?: ReadonlyMap<string, MacroBinding>;
  references: BeamerReferenceContext;
  targetHeight?: number;
  hiddenSourceSpans?: readonly Span[];
  graphicsResolver?: DocumentGraphicsResolver;
  colorResolver?: NodeTextColorResolver;
  paperWidth?: number;
  textWidth?: number;
  columnWidth?: number;
}): LaidParagraph | null {
  const ambient = params.role === "body" || params.role === "block-body" ? params.references.ambientTextAt?.(params.sourceSpan.from) : "";
  if (ambient) params = { ...params, mapped: concatMappedText([
    createGeneratedMappedText((params.alignment !== "left" ? ambient.replace(/\\(?:centering|raggedleft|raggedright)\b/gu, "") : ambient) + " ", "Inherited TeX text declarations", params.sourceSpan), params.mapped,
  ]) };
  if (params.references.scopedTheme) params = { ...params, mapped: params.references.scopedTheme.project(params.mapped) };
  params = { ...params, mapped: projectBeamerOverlayPictureBoxes(projectBeamerSpeakerNotes(params.mapped), params.references.tikzLayer === true, params.references.overlayPictures) };
  params = { ...params, mapped: projectBeamerInlinePictures(params.mapped, params.references.inlinePictures) };
  // A size declaration preceding the list is an ambient font selection,
  // not an empty paragraph (and must apply to its generated labels too).
  const leadingSize = activeBeamerNamedSize(params.mapped.text, params.references.theme);
  if (leadingSize && new RegExp(`^\\s*\\\\${leadingSize.command}\\s*\\\\begin\\s*\\{thebibliography\\}`, "u").test(params.mapped.text)) {
    params = {
      ...params,
      font: { ...params.font, sizePt: leadingSize.sizePt, lineHeightPt: leadingSize.lineHeightPt },
      mapped: replaceBeamerNamedSize(params.mapped, leadingSize.pattern, "", "Beamer ambient bibliography size"),
    };
  }
  const fontSize = texLength(params.font.sizePt);
  const profile = createBeamerTexTextFontProfile(params.font);
  const metricProvider = params.interwordSpacePt == null
    ? computerModernTexMetricProvider
    : fixedInterwordMetricProvider(
      computerModernTexMetricProvider,
      params.interwordSpacePt
    );
  const textFontProfile = metricProvider === profile.metricProvider
    ? profile
    : { ...profile, metricProvider };
  const resolvedFont = textFontProfile.resolveTextFont(
    textFontProfile.defaultFontState,
    fontSize,
    metricProvider
  );
  const alignment = params.justify ? "justified" :
    params.alignment === "center"
      ? "center"
      : params.alignment === "right"
        ? "ragged-left"
        : "ragged-right";
  params = { ...params, mapped: projectBeamerPreformatted(params.mapped, params.references.source, params.references.renderDiagnostics, params.references.theme, params.font) };
  const visibleMacros = params.references.macroBindingsAt?.(params.sourceSpan.from) ?? params.macroBindings;
  let mapped = visibleMacros ? expandBeamerLocalMacros(params.mapped, visibleMacros).mapped : params.mapped;
  if (params.role === "body" && params.alignment !== "left") {
    // A declaration carried across an extracted picture retains LaTeX's
    // infinite margin glue, rather than generic finite alignment skips.
    const prefixEnd = /^(?:\s|%[^\n]*(?:\n|$)|\\(?:par|relax)(?![A-Za-z@]))*/u.exec(mapped.text)?.[0].length ?? 0;
    mapped = concatMappedText([
      sliceMappedText(mapped, 0, prefixEnd),
      createGeneratedMappedText(params.alignment === "center" ? "\\centering " : "\\raggedleft ", "Beamer inherited paragraph alignment", params.sourceSpan),
      sliceMappedText(mapped, prefixEnd, mapped.text.length),
    ]);
  }
  mapped = projectBeamerInlineFlow(mapped, params.references.inlineFlow ?? []);
  mapped = projectBeamerDateRegisters(mapped, params.references.compilationDate);
  if (params.references.theme?.options["alert-bold"] === true) mapped = projectBeamerAlertWeight(mapped, params.sourceSpan);
  mapped = projectBeamerScientificNotation(mapped, params.references.renderDiagnostics, params.references.source);
  const namedSize = activeBeamerNamedSize(mapped.text, params.references.theme);
  const namedSizes = beamerNamedFontSizes(params.references.theme);
  mapped = projectBeamerSpeakerNotes(mapped);
  mapped = projectBeamerFootnotes(mapped, params.references.footnotes, {
    ...params.font,
    sizePt: namedSize?.sizePt ?? params.font.sizePt,
    lineHeightPt: namedSize?.lineHeightPt ?? params.font.lineHeightPt,
  });
  mapped = projectBeamerContinuationBreaks(mapped, params.references.continuationBreaks);
  const graphicsResolver = beamerBibliographyGraphicsResolver(params.graphicsResolver);
  mapped = projectBeamerCaptions(mapped, params.references.source, params.references.theme, {
    widthPt: params.bounds.width,
    diagnostics: params.references.renderDiagnostics,
    measure: tex => layoutSimpleTexParagraph(tex, {
      width: texLength(10000), font: resolvedFont, metricProvider, textFontProfile,
      alignment: "ragged-right", graphicsResolver,
      mathBoxProvider: createTexDerivedInlineMathBoxProvider({ baseAtPt: fontSize, fontProfile: createBeamerTexMathFontProfile(params.mathFont ?? params.font) }),
    }).report?.lines[0]?.naturalWidth ?? 0,
  });
  const referenceProjection = projectBeamerReferences(mapped, params.references, (widestLabel, sourceStart) =>
    beamerBibliographyStyle({
      source: params.references.source, sourceStart, ...(params.references.theme !== undefined ? { theme: params.references.theme } : {}),
      widestLabel, fontSizePt: namedSize?.sizePt ?? params.font.sizePt,
      layoutFontSizePt: params.font.sizePt,
      measure: (tex) => {
        const prefix = namedSize ? `\\fontsize{${namedSize.sizePt}pt}{${namedSize.lineHeightPt}pt}\\selectfont ` : "";
        const measured = layoutSimpleTexParagraph(prefix + tex, {
          width: texLength(10000), font: resolvedFont, metricProvider, textFontProfile,
          alignment: "ragged-right", graphicsResolver,
          mathBoxProvider: createTexDerivedInlineMathBoxProvider({ baseAtPt: fontSize, fontProfile: createBeamerTexMathFontProfile(params.mathFont ?? params.font) }),
        });
        return measured.report?.lines[0]?.naturalWidth ?? 0;
      },
    })
  );
  mapped = referenceProjection.mapped;
  mapped = projectBeamerOverlayAreas(mapped, {
    dimension: raw => resolveBeamerColumnWidth(raw, params.bounds.width, params.paperWidth ?? params.bounds.width),
    firstHeight: (body, width) => {
      const measured = layoutParagraph({ ...params, mapped: body, alignment: "left", bounds: { ...params.bounds, width } });
      return measured ? paragraphStartingMaterialHeight(measured) : null;
    },
  });
  const descriptionLabelWidths = beamerDescriptionLabelWidths(mapped.text, (tex) => {
    const prefix = namedSize ? `\\fontsize{${namedSize.sizePt}pt}{${namedSize.lineHeightPt}pt}\\selectfont ` : "";
    return layoutSimpleTexParagraph(prefix + tex, {
      width: texLength(10000), font: resolvedFont, metricProvider, textFontProfile,
      alignment: "ragged-right", graphicsResolver,
      mathBoxProvider: createTexDerivedInlineMathBoxProvider({ baseAtPt: fontSize, fontProfile: createBeamerTexMathFontProfile(params.mathFont ?? params.font) }),
    }).report?.lines[0]?.naturalWidth ?? 0;
  });
  const normalDisplayProfile = beamerDisplayMathProfile(params.references.theme);
  const blockDisplayProfile = { ...normalDisplayProfile };
  // A minipage starts the display from an empty paragraph at its top.
  // It selects the short display skip, without a frame-leading baseline.
  blockDisplayProfile.leadingDisplay = { emptyLineBaselineSkipPt: 0 };
  const layoutOptions = {
    boxesClearingPendingItemLabels: beamerBoxesClearingPendingItemLabels(mapped, params.references.inlineFlow ?? []),
    inheritedItemLabels: [...(params.references.inlineFlowItemLabels?.values() ?? [])].filter(transfer => mapped.sourceMap.charOrigins.some(origin => origin.kind === "direct" && origin.from === transfer.targetOffset)).flatMap(transfer => transfer.labels),
    commitPostDisplayParagraph: (sourceEnd: number) => params.references.itemActionCommitsParagraph?.(mapped, sourceEnd) ?? false,
    namedFontSizes: Object.fromEntries(namedSizes.map(([name, sizePt, baselineSkipPt]) => [name, { sizePt, baselineSkipPt }])),
    resolveBlockBox: (box: SimpleTexBoxBlockItem): readonly TexVListItem[] | undefined => {
      const origin = mapped.sourceMap.charOrigins[box.sourceStart];
      const external = origin?.kind === "direct" ? params.references.inlineFlow?.find(item => item.span.from === origin.from && Math.abs(item.width - params.bounds.width) < .001) ?? params.references.inlineFlow?.find(item => item.span.from === origin.from) : undefined;
      if (!external) return undefined;
      if (box.consumedItemLabels?.length && external.labelTargetOffset !== undefined && params.references.inlineFlowItemLabels) {
        const transfer = { targetOffset: external.labelTargetOffset, labels: box.consumedItemLabels.map(label => {
          const owner = label.itemCommandSpan ? projectInputRange(mapped.sourceMap, label.itemCommandSpan.start, label.itemCommandSpan.end) : undefined;
          return { ...label, fontDepth: (label.fontDepth ?? label.depth) + (params.references.ambientTextAt?.itemDepthAt?.(params.sourceSpan.from) ?? 0), ...(owner?.kind === "source-range" ? { originalItemCommandSpan: { start: owner.from, end: owner.to } } : {}) };
        }) };
        if (JSON.stringify(params.references.inlineFlowItemLabels.get(external.span.from)) !== JSON.stringify(transfer)) {
          params.references.inlineFlowItemLabels.set(external.span.from, transfer);
          if (params.references.inlineFlowLabelState) params.references.inlineFlowLabelState.revision += 1;
        }
      }
      const item = external.item;
      const height = item.kind === "block" ? item.block.flowBoxHeight : item.box.height;
      const depth = item.kind === "block" ? item.block.endingDepth : item.box.depth;
      const advance = item.kind === "block" ? item.block.naturalHeight : item.box.height + item.box.depth;
      const after = item.kind === "block" ? item.block.plan.geometry.afterSkipPt : 0;
      return [{ kind: "hbox", role: { kind: "external-flow", ...(box.consumedItemLabels ? { pendingListBoundaries: box.consumedItemLabels } : {}), baselineSkipPt: texLength(ambientTextTheme(requireDefined(params.references.theme, "Expected Beamer font context"), params.references.ambientTextAt?.(external.span.from) ?? "").fonts["normal-text"].lineHeightPt) }, sourceSpan: { start: box.sourceStart, end: box.sourceEnd },
        advance: texLength(advance), box: { metrics: { width: texLength(0), height: texLength(height), depth: texLength(depth) }, renderItems: [] } },
        ...(after ? [{ kind: "glue" as const, size: texLength(after), origin: { kind: "external-flow-after" as const } }] : [])];
    },
    paragraphId: params.paragraphId,
    width: texLength(params.bounds.width),
    ...(params.targetHeight !== undefined ? { height: params.targetHeight } : {}),
    alignment,
    font: resolvedFont,
    metricProvider,
    textFontProfile,
    tikzTextWidthNode: false,
    // beamer.cls installs `\raggedright`, and the rounded block templates issue
    // it again. LaTeX implements that as `\rightskip 0pt plus 1fil`, so loose
    // lines consume margin glue while near-full lines retain the font's finite
    // interword stretch and shrink for line-breaking.
    ...(params.alignment === "left" && !params.justify
      ? { rightskipStretch: Number.POSITIVE_INFINITY }
      : {}),
    spaceGlueProfile: params.spaceGlueProfile ?? (
      params.alignment === "left" ||
        /\\(?:begin\s*\{\s*center\s*\}|centering)(?![A-Za-z@])/u.test(
          mapped.text
        )
        ? "font"
        : params.role === "block-body"
          ? "font"
          : "font-fixed"),
    fallbackPolicy: "placeholder",
    mathBoxProvider: createTexDerivedInlineMathBoxProvider({
      baseAtPt: fontSize,
      fontProfile: createBeamerTexMathFontProfile(
        params.mathFont ?? params.font
      ),
    }),
    baselineSkip: params.initialBaselineSkipPt ?? params.font.lineHeightPt,
    tabularProfile: {
      ...(params.references.arrayPackage !== undefined ? { arrayPackage: params.references.arrayPackage } : {}),
      ...(params.references.tableRegisters !== undefined ? { registers: params.references.tableRegisters } : {}),
      baselineSkipPt: params.font.lineHeightPt,
      booktabsFontSizePt: params.references.theme?.fonts["normal-text"].sizePt ?? params.font.sizePt,
      booktabsXHeightPt: fontXHeightPt(params.references.theme?.fonts["normal-text"] ?? params.font),
    },
    ...(params.initialPreviousDepth !== undefined ? { initialPreviousDepth: params.initialPreviousDepth } : {}),
    listProfile: {
      ...(params.listProfile ?? BEAMER_LIST_LAYOUT_PROFILE),
      fontDepthOffset: params.references.ambientTextAt?.itemDepthAt?.(params.sourceSpan.from) ?? 0,
      ...(params.listProfile?.bodyFontSizePtByDepth ? {
        bodyFontSizePtByDepth: params.listProfile.bodyFontSizePtByDepth.slice(params.references.ambientTextAt?.itemDepthAt?.(params.sourceSpan.from) ?? 0),
      } : {}),
      ...(params.listProfile?.bodyBaselineSkipPtByDepth ? {
        bodyBaselineSkipPtByDepth: params.listProfile.bodyBaselineSkipPtByDepth.slice(params.references.ambientTextAt?.itemDepthAt?.(params.sourceSpan.from) ?? 0),
      } : {}),
      ...(params.listProfile?.bodyDisplaySkipCommandByDepth ? {
        bodyDisplaySkipCommandByDepth: params.listProfile.bodyDisplaySkipCommandByDepth.slice(params.references.ambientTextAt?.itemDepthAt?.(params.sourceSpan.from) ?? 0),
      } : {}),
      ...(referenceProjection.bibliographyMargins !== undefined ? { bibliographyMargins: referenceProjection.bibliographyMargins } : {}),
      ...(descriptionLabelWidths.size > 0 ? { descriptionLabelWidths } : {}),
      bibliographyParsepPt: (leadingSize?.command ?? namedSize?.command) === "small"
        ? 3
        : (leadingSize?.command ?? namedSize?.command) === "footnotesize" ? 2 : 0,
    },
    displayMathProfile: params.role === "block-body"
      ? blockDisplayProfile
      : params.leadingDisplayBaselineSkipPt != null
        ? { ...normalDisplayProfile, leadingDisplay: {
            emptyLineBaselineSkipPt: params.leadingDisplayBaselineSkipPt,
          } }
        : normalDisplayProfile,
    ...(params.disableAutomaticHyphenation ? { hyphenator: { hyphenate: () => [] } } : {}),
    graphicsResolver,
    ...(params.colorResolver !== undefined ? { colorResolver: params.colorResolver } : {}),
    dimensionContext: {
      linewidth: texLength(params.bounds.width),
      textwidth: texLength(params.textWidth ?? params.bounds.width),
      columnwidth: texLength(params.columnWidth ?? params.bounds.width),
      paperwidth: texLength(params.paperWidth ?? params.bounds.width),
    },
  } as const;
  let result = layoutSimpleTexParagraph(mapped.text, {
    ...layoutOptions,
    ...(params.centerWithInfiniteGlue ? { alignment: "ragged-right" as const, rightskipStretch: Number.POSITIVE_INFINITY } : {}),
  });
  if (
    (!result.supported || params.centerWithInfiniteGlue) &&
    (alignment === "ragged-left" || alignment === "center")
  ) {
    // A short right-aligned or centered template line in a wide Beamer color
    // box can exhaust the finite alignment skips used by the generic
    // breaker. A ragged-right retry finds the symmetric feasible line
    // breaks; place those lines against the right edge or center, matching
    // TeX's template-level \hfill and \centering fil skips.
    const leftAligned = params.centerWithInfiniteGlue ? result : layoutSimpleTexParagraph(mapped.text, {
      ...layoutOptions,
      alignment: "ragged-right",
    });
    if (
      leftAligned.supported &&
      leftAligned.report &&
      leftAligned.vlistLayout
    ) {
      const width = texLength(params.bounds.width);
      const report = {
        ...leftAligned.report,
        alignment:
          alignment === "center"
            ? ("center" as const)
            : ("ragged-left" as const),
        lines: leftAligned.report.lines.map((line) => {
          const xStart = texLineX(
            alignment === "center"
              ? (width - line.width) / 2
              : width - line.width
          );
          const delta = xStart - line.xStart;
          return {
            ...line,
            xStart,
            xEnd: texLineX(xStart + line.width),
            segments: line.segments.map((segment) => ({
              ...segment,
              x: texLineX(segment.x + delta),
              ...(segment.caretStops ? { caretStops: segment.caretStops.map((stop) =>
                texLineX(stop + delta)
              ) } : {}),
              ...(segment.mathConstructRanges ? { mathConstructRanges: segment.mathConstructRanges.map(
                (range) => ({
                  ...range,
                  xStart: texLineX(range.xStart + delta),
                  xEnd: texLineX(range.xEnd + delta),
                })
              ) } : {}),
              ...(segment.mathCaretEntries ? { mathCaretEntries: segment.mathCaretEntries.map((entry) => ({
                ...entry,
                x: texLineX(entry.x + delta),
                hitBounds: {
                  ...entry.hitBounds,
                  xStart: texLineX(entry.hitBounds.xStart + delta),
                  xEnd: texLineX(entry.hitBounds.xEnd + delta),
                },
              })) } : {}),
              ...(segment.mathBreakpoints ? { mathBreakpoints: segment.mathBreakpoints.map(
                (breakpoint) => ({
                  ...breakpoint,
                  x: texLineX(breakpoint.x + delta),
                })
              ) } : {}),
            })),
          };
        }),
      };
      result = {
        ...leftAligned,
        report,
        vlistLayout: {
          ...leftAligned.vlistLayout,
          graphicsPlacements: collectTexGraphicsPlacements(
            [report],
            leftAligned.vlistLayout.linePlacements
          ),
          reports: leftAligned.vlistLayout.reports.map((candidate) =>
            "paragraphId" in candidate &&
            candidate.paragraphId === report.paragraphId
              ? report
              : candidate
          ),
        },
      };
    }
  }
  if (!result.supported || !result.report || !result.vlistLayout) {
    params.references.layoutFailures?.set(params.sourceSpan.from, result.fallbackReason ?? result.errors.join("; "));
    return null;
  }
  const links = layoutBeamerLinks(referenceProjection, result.report, result.vlistLayout, params.hiddenSourceSpans ?? []);
  const documentResult = {
    ...result,
    report: remapParagraphLayoutReportSourceMap(result.report, mapped.sourceMap),
    vlistLayout: remapTexVListLayoutSourceMap(result.vlistLayout, mapped.sourceMap),
    listStructure: remapSimpleTexListStructureSourceMap(result.listStructure, mapped.sourceMap),
  };
  // Pending labels execute where their first paragraph starts, which can be
  // inside covered content even when the owning item command is outside it.
  const coveredLabels = documentResult.vlistLayout.boxReport.items.filter(item => {
    const role = item.hboxRole;
    if (role?.kind !== "list-label" || role.consumerOffset === undefined) return false;
    const offset = role.consumerOffset;
    return params.hiddenSourceSpans?.some(span => span.from <= offset && offset < span.to);
  });
  if (coveredLabels.length) params = { ...params, hiddenSourceSpans: [
    ...params.hiddenSourceSpans ?? [],
    ...coveredLabels.flatMap(item => item.hboxRole?.kind === "list-label" ?
      [item.hboxRole.itemCommandSpan, item.sourceSpan].filter(span => span !== undefined).map(span => ({ from: span.start, to: span.end })) : []),
  ] };
  const height =
    documentResult.vlistLayout.metrics.height + documentResult.vlistLayout.metrics.depth;
  const macroArgumentRuns = collectMappedMacroArgumentRuns(mapped).filter((run) =>
    !isStyleMacroInvocation(params.references.source, run.invocationSpan, params.macroBindings)
  );
  const readOnlySourceSpans = macroArgumentRuns.map((run) => run.span);
  const listStructure: BeamerListTopology[] = (documentResult.listStructure ?? []).flatMap((list) => list.name === "bibliography" ? [] : [{
    environment: list.name,
    beginSpan: { from: list.beginSpan.from, to: list.beginSpan.to },
    endSpan: { from: list.endSpan.from, to: list.endSpan.to },
    depth: list.depth,
    items: list.items.map((item) => ({
      commandSpan: { from: item.commandSpan.from, to: item.commandSpan.to },
      ...(item.labelSpan
        ? { labelSpan: { from: item.labelSpan.from, to: item.labelSpan.to } }
        : {}),
      contentSpan: { from: item.contentSpan.from, to: item.contentSpan.to },
      itemIndex: item.itemIndex,
    })),
  }]);
  const svgOptions = {
    lineHeightPt: texLength(params.font.lineHeightPt),
    vlistLayout: documentResult.vlistLayout,
    metricProvider, textFontProfile, baseFontSizePt: fontSize, alignment,
  } as const;
  const renderPaint = (range?: Span, paintUnmapped = true): string => hideOverlayPaintInSvg(
    renderTexParagraphSvgBody(documentResult.report, { ...svgOptions,
      ...(range ? { paintSourceRange: range, paintUnmapped } : {}) }), params.hiddenSourceSpans ?? []);
  const svgBody = renderPaint();
  const pictures = [...(params.references.overlayPictures ?? []), ...(params.references.inlinePictures ?? []), ...(params.references.inlineFlow ?? [])];
  if (pictures.some(picture => params.sourceSpan.from <= picture.span.from && picture.span.to <= params.sourceSpan.to)) {
    params.references.paragraphPaint ??= new Map();
    params.references.paragraphPaint.set(params.paragraphId, { sourceSpan: params.sourceSpan, whole: svgBody, render: renderPaint });
  }
  return {
    height,
    layout: {
      links,
      paragraphId: params.paragraphId,
      role: params.role,
      sourceSpan: params.sourceSpan,
      bounds: {
        ...params.bounds,
        height,
      },
      report: documentResult.report,
      vlistLayout: documentResult.vlistLayout,
      editableTextSpans: collectBeamerEditableTextSpans(
        params.paragraphId,
        params.role,
        documentResult.report,
        documentResult.vlistLayout,
        params.sourceSpan,
        null,
        (params.hiddenSourceSpans ?? []).concat(readOnlySourceSpans)
      ),
      atomicRenderSpans: collectBeamerAtomicRenderSpans(
        params.paragraphId,
        params.role,
        documentResult.report,
        documentResult.vlistLayout,
        params.sourceSpan,
        null,
        params.hiddenSourceSpans ?? [],
        macroArgumentRuns
      ),
      ...(params.hiddenSourceSpans?.length
        ? { hiddenSourceSpans: params.hiddenSourceSpans }
        : {}),
      ...(readOnlySourceSpans.length
        ? { readOnlySourceSpans }
        : {}),
      ...(macroArgumentRuns.length
        ? { macroArgumentRuns }
        : {}),
      ...(listStructure.length ? { listStructure } : {}),
    },
    svgBody,
    listMarkers: documentResult.vlistLayout.boxReport.items
      .filter((item) =>
        item.hboxRole?.kind === "list-label" &&
        item.hboxRole.labelKind === "default"
      )
      .flatMap((item) => {
        const role = item.hboxRole;
        if (role?.kind !== "list-label") {
          return [];
        }
        // Same fallback the layout itself uses: block bodies omit an
        // explicit profile but still lay out (and paint) default markers.
        const listProfile = params.listProfile ?? BEAMER_LIST_LAYOUT_PROFILE;
        const labelOwner = documentResult.vlistLayout.boxReport.items.filter(candidate =>
          candidate.listItem?.label && candidate.path.length < item.path.length &&
          candidate.path.every((value, index) => item.path[index] === value)
        ).at(-1);
        const labelContent = labelOwner?.listItem?.label?.content;
        const marker = labelContent?.kind === "marker" ? labelContent.marker :
          role.listKind === "itemize"
            ? listProfile.itemizeMarkersByDepth?.[
                Math.max(
                  0,
                  Math.min(
                    role.labelDepth - 1,
                    listProfile.itemizeMarkersByDepth.length - 1
                  )
                )
              ]
            : role.listKind === "enumerate"
              ? listProfile.resolveEnumerateMarker?.(
                  role.itemIndex,
                  role.labelDepth
                )
              : undefined;
        if (!marker) {
          return [];
        }
        const actualPaint = role.markerPaint;
        const paint = marker.paintBoundsEm;
        const atPt = Number(resolvedFont.atPt);
        return [{
          id: `${params.paragraphId}:marker:${item.path.join("-")}`,
          ...(role.itemCommandSpan
            ? {
                sourceSpan: {
                  from: role.itemCommandSpan.start,
                  to: role.itemCommandSpan.end,
                },
              }
            : {}),
          traceAsGlyph: actualPaint?.traceAsGlyph ?? marker.traceAsGlyph ?? marker.glyph != null,
          visibility: role.itemCommandSpan && sourceSpanIsHidden(
            { from: role.itemCommandSpan.start, to: role.itemCommandSpan.end }, params.hiddenSourceSpans ?? [])
            ? "hidden"
            : "visible",
          bounds: {
            x: Number(item.x) + (actualPaint?.x ?? (paint?.x ?? 0) * atPt),
            y: Number(item.y) + (actualPaint?.y ?? (paint?.y ?? 0) * atPt),
            width: actualPaint?.width ?? (paint?.width ?? marker.widthEm) * atPt,
            height: actualPaint?.height ??
              (paint?.height ??
                marker.heightEm + marker.depthEm) * atPt,
          },
        }];
      }),
  };
}

const EDITABLE_BEAMER_PARAGRAPH_ROLES =
  new Set<BeamerParagraphLayout["role"]>([
    "frame-title",
    "body",
    "block-title",
    "block-body",
    "footnote",
    "title",
    "subtitle",
    "author",
    "institute",
    "date",
  ]);

function collectBeamerEditableTextSpans(
  paragraphId: string,
  role: BeamerParagraphLayout["role"],
  report: BeamerParagraphLayout["report"],
  vlistLayout: BeamerParagraphLayout["vlistLayout"],
  paragraphSpan: Span,
  paragraphBounds: BeamerRect | null,
  hiddenSourceSpans: readonly Span[]
): BeamerParagraphLayout["editableTextSpans"] {
  if (!EDITABLE_BEAMER_PARAGRAPH_ROLES.has(role)) {
    return [];
  }
  const candidates = report.lines.flatMap((line) => {
    const placement = vlistLayout.linePlacements.find(
      (candidate) => candidate.lineIndex === line.lineIndex
    );
    const y = (paragraphBounds?.y ?? 0) + Number(placement?.y ?? 0);
    return line.segments.flatMap((segment) => {
      const isDirectText = segment.kind === "text" || segment.kind === "space";
      const isMathIsland = segment.kind === "math";
      if (
        (!isDirectText && !isMathIsland) ||
        segment.role === "list-label" ||
        segment.sourceRangePolicy !== "caret" ||
        segment.sourceStartRaw == null ||
        segment.sourceEndRaw == null
      ) {
        return [];
      }
      const from = Math.max(paragraphSpan.from, Number(segment.sourceStartRaw));
      const to = Math.min(paragraphSpan.to, Number(segment.sourceEndRaw));
      if (
        to <= from ||
        hiddenSourceSpans.some((hidden) => from < hidden.to && hidden.from < to)
      ) {
        return [];
      }
      return [{
        from,
        to,
        kind: isMathIsland ? ("math" as const) : ("text" as const),
        hitBounds: paragraphBounds
          ? [svgRect(
              paragraphBounds.x + Number(segment.x),
              y,
              Math.max(0.5, Number(segment.width)),
              Math.max(1, Number(line.ascent) + Number(line.descent))
            )]
          : [],
      }];
    });
  });

  // Display math lives in vlist boxes, not paragraph report segments: each
  // display block publishes a math hit span over its content range.
  const displayMathCandidates = vlistLayout.boxReport.items.flatMap((item) => {
    if (!item.displayMath) {
      return [];
    }
    const from = Math.max(paragraphSpan.from, item.displayMath.contentStart);
    const to = Math.min(paragraphSpan.to, item.displayMath.contentEnd);
    if (
      to <= from ||
      hiddenSourceSpans.some((hidden) => from < hidden.to && hidden.from < to)
    ) {
      return [];
    }
    return [{
      from,
      to,
      kind: "math" as const,
      hitBounds: paragraphBounds
        ? [svgRect(
            paragraphBounds.x + Number(item.x),
            paragraphBounds.y + Number(item.y),
            Math.max(0.5, Number(item.width)),
            Math.max(1, Number(item.totalHeight))
          )]
        : [],
    }];
  });

  const allCandidates = [...candidates, ...displayMathCandidates]
    .sort((left, right) => left.from - right.from || left.to - right.to);

  const merged: Array<Span & { kind: "text" | "math"; hitBounds: SvgRect[] }> = [];
  for (const candidate of allCandidates) {
    const previous = merged.at(-1);
    if (candidate.kind === previous?.kind && candidate.from <= previous.to) {
      previous.to = Math.max(previous.to, candidate.to);
      previous.hitBounds.push(...candidate.hitBounds);
    } else {
      merged.push({
        from: candidate.from,
        to: candidate.to,
        kind: candidate.kind,
        hitBounds: [...candidate.hitBounds],
      });
    }
  }
  return merged.map(({ hitBounds, kind, ...span }, index) => ({
    id: `${paragraphId}:editable:${index}`,
    span,
    kind,
    hitBounds,
  }));
}

/**
 * Rendered output whose source is not directly editable: segments with a
 * macro or select source-range policy (each output glyph reports the full
 * invocation span, so same-span candidates merge into one atom), plus
 * rendered macro-argument output, which selects its invocation's span.
 * Hidden overlay material ("generated" policy) publishes nothing.
 */
function collectBeamerAtomicRenderSpans(
  paragraphId: string,
  role: BeamerParagraphLayout["role"],
  report: BeamerParagraphLayout["report"],
  vlistLayout: BeamerParagraphLayout["vlistLayout"],
  paragraphSpan: Span,
  paragraphBounds: BeamerRect | null,
  hiddenSourceSpans: readonly Span[],
  macroArgumentRuns: NonNullable<BeamerParagraphLayout["macroArgumentRuns"]> = []
): BeamerParagraphLayout["atomicRenderSpans"] {
  if (!EDITABLE_BEAMER_PARAGRAPH_ROLES.has(role)) {
    return [];
  }
  const candidates = report.lines.flatMap((line) => {
    const placement = vlistLayout.linePlacements.find(
      (candidate) => candidate.lineIndex === line.lineIndex
    );
    const y = (paragraphBounds?.y ?? 0) + Number(placement?.y ?? 0);
    return line.segments.flatMap((segment) => {
      const isAtomicPolicy =
        segment.sourceRangePolicy === "macro" ||
        segment.sourceRangePolicy === "select";
      const isArgumentCandidate =
        !isAtomicPolicy &&
        segment.sourceRangePolicy === "caret" &&
        (segment.kind === "text" || segment.kind === "space");
      if (
        (!isAtomicPolicy && !isArgumentCandidate) ||
        segment.role === "list-label" ||
        segment.sourceStartRaw == null ||
        segment.sourceEndRaw == null
      ) {
        return [];
      }
      const from = Math.max(paragraphSpan.from, Number(segment.sourceStartRaw));
      const to = Math.min(paragraphSpan.to, Number(segment.sourceEndRaw));
      if (
        to <= from ||
        hiddenSourceSpans.some((hidden) => from < hidden.to && hidden.from < to)
      ) {
        return [];
      }
      // Argument output maps caret-precisely into the argument source, but
      // an argument can render any number of times, so direct editing stays
      // off; clicking it selects the whole invocation instead.
      let atomFrom = from;
      let atomTo = to;
      if (isArgumentCandidate) {
        const run = macroArgumentRuns.find(
          (candidate) => from < candidate.span.to && candidate.span.from < to
        );
        if (!run) {
          return [];
        }
        atomFrom = Math.max(paragraphSpan.from, run.invocationSpan.from);
        atomTo = Math.min(paragraphSpan.to, run.invocationSpan.to);
        if (atomTo <= atomFrom) {
          return [];
        }
      }
      return [{
        from: atomFrom,
        to: atomTo,
        hitBounds: paragraphBounds
          ? [svgRect(
              paragraphBounds.x + Number(segment.x),
              y,
              Math.max(0.5, Number(segment.width)),
              Math.max(1, Number(line.ascent) + Number(line.descent))
            )]
          : [],
      }];
    });
  }).sort((left, right) => left.from - right.from || left.to - right.to);

  const merged: Array<Span & { hitBounds: SvgRect[] }> = [];
  for (const candidate of candidates) {
    const previous = merged.at(-1);
    if (previous && candidate.from <= previous.to) {
      previous.to = Math.max(previous.to, candidate.to);
      previous.hitBounds.push(...candidate.hitBounds);
    } else {
      merged.push({
        from: candidate.from,
        to: candidate.to,
        hitBounds: [...candidate.hitBounds],
      });
    }
  }
  return merged.map(({ hitBounds, ...span }, index) => ({
    id: `${paragraphId}:atom:${index}`,
    span,
    hitBounds,
  }));
}

/**
 * K1: a style macro's argument (`\ee{…}` for `\newcommand{\ee}[1]{\textcolor{c}{#1}}`)
 * is edited like `\textbf`'s content, so it is neither read-only nor part
 * of an atomic invocation.
 */
function isStyleMacroInvocation(
  source: string,
  invocation: Span,
  bindings: ReadonlyMap<string, MacroBinding> | undefined
): boolean {
  const name = /^\\[A-Za-z@]+/u.exec(source.slice(invocation.from, invocation.to))?.[0];
  const binding = name ? bindings?.get(name) : undefined;
  return binding != null && classifyMacro(binding).kind === "style";
}

function collectMappedMacroArgumentRuns(
  mapped: MappedText
): NonNullable<BeamerParagraphLayout["macroArgumentRuns"]>[number][] {
  const runs: NonNullable<BeamerParagraphLayout["macroArgumentRuns"]>[number][] = [];
  for (const origin of mapped.sourceMap.charOrigins) {
    if (origin.kind !== "macro-argument" || origin.to <= origin.from) {
      continue;
    }
    const previous = runs.at(-1);
    if (
      previous &&
      origin.from <= previous.span.to &&
      previous.invocationSpan.from === origin.invocation.from &&
      previous.invocationSpan.to === origin.invocation.to
    ) {
      previous.span = {
        from: previous.span.from,
        to: Math.max(previous.span.to, origin.to),
      };
    } else {
      runs.push({
        span: { from: origin.from, to: origin.to },
        invocationSpan: {
          from: origin.invocation.from,
          to: origin.invocation.to,
        },
      });
    }
  }
  return runs;
}

function replaceBeamerNamedSize(mapped: MappedText, pattern: RegExp, replacement: string, reason: string): MappedText {
  const parts: MappedText[] = [];
  let cursor = 0;
  for (const match of mapped.text.matchAll(new RegExp(pattern.source, pattern.flags))) {
    const end = match.index + match[0].length;
    parts.push(sliceMappedText(mapped, cursor, match.index));
    const owner = projectInputRange(mapped.sourceMap, match.index, end);
    parts.push(createGeneratedMappedText(replacement, reason, owner.kind === "source-range"
      ? { from: owner.from, to: owner.to } : undefined));
    cursor = end;
  }
  parts.push(sliceMappedText(mapped, cursor, mapped.text.length));
  return concatMappedText(parts);
}

function ambientTextTheme(theme: ResolvedBeamerTheme, text: string): ResolvedBeamerTheme {
  if (!text) return theme;
  const size = activeBeamerNamedSize(text, theme);
  const font = { ...theme.fonts["normal-text"], ...(size ? { sizePt: size.sizePt, lineHeightPt: size.lineHeightPt } : {}) };
  for (const command of text.matchAll(/\\(rmfamily|sffamily|ttfamily|bfseries|mdseries|itshape|upshape|slshape|normalfont)\b/gu)) {
    const name = command[1];
    if (name === "rmfamily" || name === "sffamily" || name === "ttfamily") font.family = name === "rmfamily" ? "serif" : name === "ttfamily" ? "monospace" : "sans";
    else if (name === "bfseries" || name === "mdseries") font.series = name === "bfseries" ? "bold" : "medium";
    else if (name === "itshape" || name === "upshape" || name === "slshape") font.shape = name === "itshape" ? "italic" : name === "slshape" ? "slanted" : "upright";
  }
  return { ...theme, fonts: { ...theme.fonts, "normal-text": font,
    "block-body": { ...theme.fonts["block-body"], ...(size ? { sizePt: size.sizePt, lineHeightPt: size.lineHeightPt } : {}) } } };
}

function activeBeamerNamedSize(source: string, theme?: ResolvedBeamerTheme): {
  command: string;
  pattern: RegExp;
  sizePt: number;
  lineHeightPt: number;
} | null {
  let selected:
    | {
        command: string;
        pattern: RegExp;
        sizePt: number;
        lineHeightPt: number;
        index: number;
      }
    | null = null;
  for (const [command, sizePt, lineHeightPt] of beamerNamedFontSizes(theme)) {
    const pattern = new RegExp(String.raw`\\${command}(?![A-Za-z@])`, "gu");
    for (const match of source.matchAll(pattern)) {
      if (selected == null || match.index > selected.index) {
        selected = { command, pattern, sizePt, lineHeightPt, index: match.index };
      }
    }
  }
  return selected && {
    command: selected.command,
    pattern: selected.pattern,
    sizePt: selected.sizePt,
    lineHeightPt: selected.lineHeightPt,
  };
}

function fixedInterwordMetricProvider(
  base: TexMetricProvider,
  spacePt: number
): TexMetricProvider {
  return {
    resolveFont(options) {
      const font = base.resolveFont(options);
      return {
        ...font,
        data: {
          ...font.data,
          fontdimen: {
            ...font.data.fontdimen,
            space: spacePt / Number(font.atPt),
            stretch: 0,
            shrink: 0,
            extraspace: 0,
          },
        },
      };
    },
    shapeText(text, font, options) {
      return base.shapeText(text, font, options);
    },
  };
}

function mappedTemplateText(primitive: Extract<
  BeamerTemplatePrimitive,
  { kind: "text" }
>): MappedText {
  if (primitive.source.kind === "mapped") {
    return createIdentityMappedText(
      primitive.source.value.value,
      primitive.source.value.contentSpan.from
    );
  }
  return createGeneratedMappedText(
    primitive.source.text,
    "Beamer template-generated text",
    primitive.source.sourceSpan
  );
}

function measureVerticalSpace(
  node: Extract<BeamerFrameBodyNode, { kind: "vertical-space" }>, font: BeamerThemeFont
): { height: number; relativeUnitPt?: number } {
  if (node.command !== "vspace") {
    return { height: { smallskip: 3, medskip: 6, bigskip: 12 }[node.command] };
  }
  const dimension = parseTexDimensionExpression(node.value.value);
  if (dimension?.kind === "absolute") return { height: dimension.value };
  if (dimension?.kind === "contextual" && (dimension.reference === "em" || dimension.reference === "ex")) {
    const relativeUnitPt = dimension.reference === "em" ? font.sizePt : fontXHeightPt(font);
    return { height: dimension.factor * relativeUnitPt, relativeUnitPt };
  }
  return { height: 0 };
}

function resolveFrameVerticalPacking(
  available: BeamerRect,
  rigidContentHeight: number,
  flow: readonly PreparedFrameFlowItem[],
  alignment: "top" | "center" | "bottom",
  symmetricCenter = false
): { topOffset: number; fillUnit: number } {
  const freeHeight = Math.max(
    0,
    available.height - rigidContentHeight
  );
  const internalFillWeight = flow.reduce(
    (sum, item) =>
      sum +
      (item.kind === "title-page"
        ? item.titlePage.leadingFillWeight +
          item.titlePage.trailingFillWeight
        : item.kind === "contents" ? item.contents.fillWeight : 0),
    0
  );
  if (alignment === "top") {
    // beamerbaseframe.sty gives top-aligned frames a natural .2cm top skip;
    // their finite stretch is dominated by the bottom `1fill`. Its natural
    // size remains present even when the frame is overfull (there is no shrink).
    const topOffset = TOP_ALIGNED_FRAME_SKIP_PT;
    return {
      topOffset,
      fillUnit:
        internalFillWeight > 0
          ? Math.max(0, freeHeight - topOffset) /
            (1 + internalFillWeight)
          : 0,
    };
  }
  if (alignment === "bottom") {
    const totalWeight = 1 + internalFillWeight;
    const fillUnit = totalWeight > 0 ? freeHeight / totalWeight : 0;
    return { topOffset: fillUnit, fillUnit };
  }
  // Beamer's default `c` frame uses 1fill above and 1.5fill below, so the
  // title page's own leading/trailing `\vfill` glues compete at the same
  // infinite order with the frame glues.
  const totalWeight = (symmetricCenter ? 2 : 2.5) + internalFillWeight;
  const fillUnit = totalWeight > 0 ? freeHeight / totalWeight : 0;
  return { topOffset: fillUnit, fillUnit };
}


/**
 * The font a TikZ picture in Beamer text starts with, as a `font=` value. It
 * inherits the surrounding frame font before its root options execute; the
 * embedded renderer starts from a standalone 10pt context, so this projects
 * the complete resolved Beamer role, not just its family.
 */
export function beamerTikzFontCommand(font: BeamerThemeFont): string {
  const family =
    font.family === "sans"
      ? String.raw`\sffamily`
      : font.family === "monospace"
        ? String.raw`\ttfamily`
        : String.raw`\rmfamily`;
  const series =
    font.series === "bold" ? String.raw`\bfseries` : String.raw`\mdseries`;
  const shape =
    font.shape === "italic"
      ? String.raw`\itshape`
      : font.shape === "slanted"
        ? String.raw`\slshape`
        : String.raw`\upshape`;
  return `\\fontsize{${fmt(font.sizePt)}pt}{${fmt(font.lineHeightPt)}pt}` +
    String.raw`\selectfont` +
    family +
    series +
    shape;
}

function hideOverlayPaintInSvg(
  markup: string,
  hiddenSpans: readonly Span[]
): string {
  if (hiddenSpans.length === 0) {
    return markup;
  }
  return markup.replace(
    /<(path|g)\b([^>]*\bdata-source-start="(\d+)"[^>]*\bdata-source-end="(\d+)"[^>]*)>/gu,
    (whole, tag: string, attributes: string, fromRaw: string, toRaw: string) => {
      if (!sourceSpanIsHidden(
        { from: Number(fromRaw), to: Number(toRaw) },
        hiddenSpans
      )) {
        return whole;
      }
      const selfClosing = attributes.trimEnd().endsWith("/");
      const visibleAttributes = selfClosing
        ? attributes.replace(/\/\s*$/u, "")
        : attributes;
      return `<${tag}${visibleAttributes} visibility="hidden"${selfClosing ? " /" : ""}>`;
    }
  );
}

function sourceSpanIsHidden(
  span: Span,
  hiddenSpans: readonly Span[]
): boolean {
  return hiddenSpans.some((hidden) =>
    span.from < hidden.to && span.to > hidden.from
  );
}

function paragraphRole(
  fontRole: BeamerThemeFontRole
): BeamerParagraphLayout["role"] {
  if (fontRole === "frame-title") {
    return "frame-title";
  }
  if (fontRole === "frame-subtitle") {
    return "frame-subtitle";
  }
  if (
    fontRole === "headline" ||
    fontRole === "section-in-head-foot" ||
    fontRole === "subsection-in-head-foot" ||
    fontRole === "title-in-sidebar" ||
    fontRole === "author-in-sidebar" ||
    fontRole === "section-in-sidebar" ||
    fontRole === "subsection-in-sidebar"
  ) {
    return "headline";
  }
  return fontRole === "footline" ? "footline" : "body";
}

function hasProjectedContent(
  source: string,
  span: Span,
  overlays: BeamerOverlayModel,
  step: number,
  references: BeamerReferenceContext
): boolean {
  const projected = projectBeamerOverlayText(
    createIdentityMappedText(source.slice(span.from, span.to), span.from),
    span,
    overlays,
    step
  );
  return projectBeamerReferences(projectBeamerSpeakerNotes(references.scopedTheme?.project(projected.mapped) ?? projected.mapped), references).mapped.text
    .replace(/%[^\n]*/gu, "").replace(/\\color(?:\s*\[[^\]]*\])?\s*\{[^{}]*\}/gu, "").replace(/\\(?:par|relax|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge|rmfamily|sffamily|ttfamily|bfseries|mdseries|itshape|upshape|slshape|normalfont|centering|raggedleft|raggedright)(?![A-Za-z@])/gu, "").replace(/[{}\s]/gu, "").length > 0;
}

function emitUnsupportedPlaceholder(params: {
  placeholder: BeamerUnsupportedPlaceholder;
  x: number;
  y: number;
  parentId: string | null;
  items: BeamerFrameLayoutItem[];
  modelBuilder: ReturnType<typeof createSvgModelBuilder>;
}): void {
  const { placeholder } = params;
  const bounds = {
    x: params.x,
    y: params.y,
    width: placeholder.width,
    height: placeholder.height,
  };
  params.items.push({
    id: placeholder.id,
    kind: "unsupported",
    sourceSpan: placeholder.sourceSpan,
    bounds,
    parentId: params.parentId,
    message: placeholder.message,
  });
  params.modelBuilder.addPart({
    basePartId: placeholder.id,
    sourceId: placeholder.id,
    elementId: null,
    markup: unsupportedPlaceholderMarkup(placeholder, bounds),
  });
}

/** Closing list glue uses the registers captured in the list's active size. */
function trailingScopedBeamerListSkip(mapped: MappedText, references: BeamerReferenceContext, font: BeamerThemeFont): number {
  const end = [...mapped.text.matchAll(/\\end\s*\{(?:itemize|enumerate|description)\}/gu)].at(-1);
  if (!end) return 0;
  const origin = mapped.sourceMap.charOrigins[end.index];
  const active = references.theme ? ambientTextTheme(references.theme,
    references.ambientTextAt?.(origin?.kind === "direct" ? origin.from : 0) ?? "").fonts["normal-text"] : font;
  const skip = beamerListSizeOverrides(references.theme).find(entry => Math.abs(entry.fontSizePt - active.sizePt) < .001)?.topsepPt ?? 3;
  return trailingBeamerListSkip(mapped.text, skip);
}
