import type { CooperativeWorkOptions } from "@tikz-editor/core/semantic/cooperative-work";
import { maskTikzPictureSource } from "@tikz-editor/core/document/masking";
import type { Statement } from "@tikz-editor/core/ast/types";
import {
  createIncrementalParseSession,
  type IncrementalParseSession,
  type IncrementalParseStats,
  type ParseTikzResult
} from "@tikz-editor/core/parser/index";
import {
  collectGeometryInvalidation,
  createIncrementalSemanticSession,
  type IncrementalSemanticSession,
  type IncrementalSemanticStats,
  type IncrementalSemanticTrigger,
  type EvaluateTikzResult
} from "@tikz-editor/core/semantic/index";
import { emitSvg, serializeSvgModel, type EmitSvgOptions, type EmitSvgResult, type SvgRenderModel } from "@tikz-editor/core/svg/index";
import type { SvgViewBox } from "@tikz-editor/core/svg/types";
import type { EditHandle, SceneFigure } from "@tikz-editor/core/semantic/types";
import { renderTikzToSvgAsync, createRenderNodeTextValidator, type RenderDiagnostic } from "@tikz-editor/core/render/index";
import type { NodeTextEngine } from "@tikz-editor/core/text/types";
import type { TextLayoutContext } from "@tikz-editor/core/text/layout-context";
import { runTextRenderOperation, retainSceneTextLayout } from "@tikz-editor/core/text/render-scope";
import { patchesMatchSourceTransition } from "@tikz-editor/core/edit/source-patches";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import { resolveFigureBoundsFromFigure } from "@tikz-editor/core/edit/figure-bounds";
import { recordProfilingComputeTiming } from "@tikz-editor/core/profiling";
import { texGlyphOutlineGeneration, texGlyphOutlinesLoading, withTexGlyphOutlines } from "@tikz-editor/core/text/tex/fonts/glyph-outlines";
import { detectDocumentKind } from "@tikz-editor/core/document/kind";
import { formatDocumentRootId, parseDocumentRootId, type DocumentRootRef } from "@tikz-editor/core/document/root-id";
import { createBeamerSyntaxContext } from "@tikz-editor/core/beamer/syntax";
import {
  beamerDrawingLayerInsertions,
  beamerOverlayPicturesIn,
  BEAMER_TIKZ_LAYER_OPTIONS,
  type BeamerOverlayPicture,
  beamerTikzLayerPreambleInsertion,
  beamerTikzFontCommand,
  createBeamerTexMathFontProfile,
  prepareBeamerDocument,
  resolveBeamerTheme,
  scanBeamerDocument,
  type BeamerDocumentModel,
  type BeamerFrameLayout,
  type PreparedBeamerDocument
} from "@tikz-editor/core/beamer/index";
import { createTexNodeTextEngine } from "@tikz-editor/core/text/tex-node-text-engine";
import { sameSyntaxTree } from "@tikz-editor/core/text/tex/syntax-index";
import type { Diagnostic } from "@tikz-editor/core/diagnostics/types";
import { translationMatrix } from "@tikz-editor/core/semantic/transform";
import type { EvaluateOptions } from "@tikz-editor/core/semantic/types";
import { composeOverlayPage, undrawnLayerPageStands } from "./beamer-overlay-page";
import { insertDrawingLayer, pageDrawingLayerRootId, type DrawingLayerInsertion } from "./drawing-layer";
import { prepareDocumentGraphicsContext, getImageAssetCacheGeneration, type PreparedDocumentGraphicsContext } from "./image-asset-cache";
import { getActiveEditorPlatformGeneration } from "./platform/current";
import { BoundedLru } from "./bounded-lru";
import { buildSourceRevisionFingerprint } from "./source-identity";
import type { DocumentFileRef } from "./store/types";

/**
 * An atomic snapshot of a fully evaluated document and its local text layouts.
 */
export type SessionSnapshot = {
  source: string;
  revision: number;
  figures: ParseTikzResult["figures"];
  activeRootId: string | null;
  editHandles: EditHandle[];
  scene: SceneFigure | null;
  svg: EmitSvgResult | null;
  svgModel: SvgRenderModel | null;
  parseResult: ParseTikzResult | null;
  semanticResult: EvaluateTikzResult | null;
  /** Local report owner. Worker receivers must reconstruct their report registries. */
  textLayoutContext?: TextLayoutContext | null;
  /**
   * Identifies the path-free graphics preview bundle prepared for this
   * document revision. Thumbnail workers register the bundle separately.
   */
  graphicsPreviewBundleKey?: string | null;
  incremental: SessionSnapshotIncrementalInfo | null;
  /** Present for Beamer decks; an overlay may additionally supply editing geometry. */
  deck: DeckSnapshot | null;
  /** Present for a drawing layer (an overlay picture root), edited in place on its slide. */
  overlayLayer?: OverlayLayerSnapshot | null;
};

/**
 * A drawing layer: a TikZ `overlay` picture on a slide. The tikz fields hold
 * the picture's editing geometry. Slide snapshots use page coordinates and
 * retain the deck; legacy standalone layer requests use picture coordinates.
 */
export type OverlayLayerSnapshot = {
  rootId: string;
  frameIndex: number;
  step: number;
  /** The slide without this picture: an SVG of the page; null on a slide, which paints itself. */
  backdropSvg: string | null;
  /** The picture's origin on the page (pt, y down). */
  origin: { x: number; y: number };
  /** What the picture is evaluated with: the page for `current page`, and the font of the text around it. */
  evaluate: Required<Pick<EvaluateOptions, "currentPage" | "initialFont">> & Pick<EvaluateOptions, "initialTransform" | "pictureOptions">;
  /** Its geometry is expressed in slide coordinates. */
  pageCoordinates?: boolean;
  requestedRootId?: string | null;
  /**
   * A layer the frame does not have yet: the snapshot shows the source with
   * this inserted (its spans count in that source), and the first drawing
   * inserts it.
   */
  insertion: DrawingLayerInsertion | null;
};

/** One frame of a deck's root inventory, in render order. */
export type DeckFrameSummary = {
  id: string;
  frameIndex: number;
  span: { from: number; to: number };
  title: string | null;
  stepCount: number;
};

/** The rendered page for the active frame at one overlay step. */
export type DeckActiveFrame = {
  frameId: string;
  frameIndex: number;
  /** 1-based, clamped to the frame's step count. */
  step: number;
  stepCount: number;
  svg: string;
  svgModel: SvgRenderModel;
  viewBox: SvgViewBox;
  layout: BeamerFrameLayout;
  /** Interpretation environment for canvas editing (user macros, theorem names). */
  editingEnvironment: ReturnType<PreparedBeamerDocument["frameEditingEnvironment"]>;
};

export type DeckSnapshot = {
  /** Opaque, clone-safe freshness fence for the complete SVG/layout pair. */
  cacheEpoch?: number;
  frames: DeckFrameSummary[];
  /** The scanned deck this render used, which the slides panel shares. */
  document: BeamerDocumentModel;
  activeFrame: DeckActiveFrame | null;
  diagnostics: Diagnostic[];
  /**
   * False when the deck's structure may not be the one a fresh parse gives:
   * a reparse of text with syntax errors can recover from them differently.
   */
  exactParse?: boolean;
};

export type SessionSnapshotIncrementalInfo = {
  trigger: IncrementalSemanticTrigger;
  deckLayoutReused?: boolean;
  changedSourceIds: string[];
  parseStrategy: IncrementalParseStats["strategy"];
  parseFallbackReason: IncrementalParseStats["fallbackReason"];
  parsePatchApplication: IncrementalParseStats["patchApplication"];
  reparsedStatementCount: number;
  parserReusedStatementCount: number;
  strategy: IncrementalSemanticStats["strategy"];
  replayMode?: IncrementalSemanticStats["replayMode"];
  suffixReplay?: IncrementalSemanticStats["suffixReplay"];
  fallbackReason: IncrementalSemanticStats["fallbackReason"];
  recomputeFromStatementIndex: number | null;
  recomputedStatementCount: number;
  reusedStatementCount: number;
  corridorEndStatementIndex?: number | null;
  affectedStatementCount?: number;
};

export type ComputeRequest = {
  /** UUID identifying this request; used to discard stale responses. */
  id: string;
  documentId?: string;
  source: string;
  sourceRevision?: number | null;
  documentFileRef?: DocumentFileRef | null;
  activeRootId?: string | null;
  drawingLayerRootId?: string | null;
  includeDrawingLayer?: boolean;
  /** Requested overlay step for deck mode; clamped to the frame's steps. */
  deckStep?: number | null;
  changedSourceIds?: string[] | null;
  patches?: SourcePatch[] | null;
  patchBaseRevision?: number | null;
  trigger?: IncrementalSemanticTrigger;
  /** UI scheduling cause, separate from the incremental evaluator's drag hint. */
  schedulingTrigger?: string;
  kind?: "render" | "prewarm";
  /** Source-editor renders infer changed statements against the last completed parse. */
  inferSourceChanges?: boolean;
  renderViewBox?: SvgViewBox | null;
  /**
   * Span of an active canvas text-editing session. Structure is parsed with
   * this span neutralized so momentarily-invalid TeX (unmatched braces etc.)
   * cannot reshape the document while the user types; the span's real text
   * still feeds node text rendering.
   */
  textEditMaskSpan?: { from: number; to: number } | null;
  /**
   * Parse a deck afresh if its current parse is not exact, as the app asks
   * once typing pauses (see `DeckSnapshot.exactParse`).
   */
  exactParse?: boolean;
};

export type ComputeResponse = {
  /** Matches the request id. */
  id: string;
  documentId?: string;
  snapshot: SessionSnapshot;
  diagnostics: RenderDiagnostic[];
};

let revisionCounter = 0;
let textEnginePromise: Promise<NodeTextEngine> | null = null;
let resolvedTextEngine: NodeTextEngine | null = null;

function resolveSvgPadding(parse: ParseTikzResult): number {
  return resolveFigureBoundsFromFigure(parse.figure).mode === "fixed" ? 0 : 18;
}

function computeSvgOptions(parse: ParseTikzResult, viewBox: SvgViewBox | null | undefined): EmitSvgOptions {
  return { padding: resolveSvgPadding(parse), textSourceCoordinates: "layout", viewBox: viewBox ?? undefined };
}
type ComputeCache = {
  documentId?: string;
  semantic: IncrementalSemanticSession;
  parse: IncrementalParseSession;
  svg: SvgRenderModel | null;
  text: TextLayoutContext | null;
  warmSource: string | null;
  graphicsResolverCacheKey: string | null;
  /** Text in the cache was rendered under this glyph outline generation. */
  outlineGeneration: number;
  renderContextKey?: string;
  /** The last page laid out with a drawing layer undrawn (drawingLayerPage). */
  overlayPage?: { source: string; contextKey: string; frame: DeckActiveFrame; rootId: string; span: { from: number; to: number }; rememberPicture: boolean };
};
type TikzRenderContext = {
  key: string;
  textEngine: NodeTextEngine;
  graphicsContext: PreparedDocumentGraphicsContext;
  evaluate: EvaluateOptions;
  padding: number;
  startedAt: number;
  structuralMasks?: readonly { from: number; to: number }[];
  deckLayoutReused?: boolean;
};
let committedCache: ComputeCache | null = null;

export function makeEmptySnapshot(source: string = ""): SessionSnapshot {
  return {
    source,
    revision: 0,
    figures: [],
    activeRootId: null,
    editHandles: [],
    scene: null,
    svg: null,
    svgModel: null,
    parseResult: null,
    semanticResult: null,
    textLayoutContext: null,
    graphicsPreviewBundleKey: null,
    incremental: null,
    deck: null
  };
}

/**
 * Compute a full SessionSnapshot for the given source.
 * Evaluation optionally yields between batches. Only a completed request may
 * publish its parser, semantic, SVG and text-layout baseline together.
 */
export async function computeSnapshot(request: ComputeRequest, work?: CooperativeWorkOptions): Promise<ComputeResponse> {
  cancelDeckPrewarm();
  // Text using a font whose glyph outlines had not loaded yet renders blank;
  // once they arrive, render again from scratch (an older outline generation
  // invalidates every cache, so incremental hints no longer apply).
  return withTexGlyphOutlines((attempt) => computeSnapshotOnce(attempt === 0 ? request
    : { ...request, changedSourceIds: null, patches: null, patchBaseRevision: null, inferSourceChanges: false }, work));
}

async function computeSnapshotOnce(request: ComputeRequest, work?: CooperativeWorkOptions): Promise<ComputeResponse> {
  const revision = ++revisionCounter;
  const outlineGeneration = texGlyphOutlineGeneration();
  const committed = committedCache;
  const previous = committed && committed.documentId === request.documentId && committed.outlineGeneration === outlineGeneration ? committed : null;
  const cache: ComputeCache = {
    outlineGeneration,
    renderContextKey: previous?.renderContextKey,
    overlayPage: previous?.overlayPage,
    documentId: request.documentId,
    semantic: previous?.semantic.fork() ?? createIncrementalSemanticSession(),
    parse: previous?.parse.fork() ?? createIncrementalParseSession(),
    svg: previous?.svg ?? null,
    text: previous?.text ?? null,
    warmSource: previous?.warmSource ?? null,
    graphicsResolverCacheKey: previous?.graphicsResolverCacheKey ?? null
  };
  work?.signal?.throwIfAborted();
  const result = await computeSnapshotWithCache(request, revision, cache, work);
  work?.signal?.throwIfAborted();
  // Concurrent previews/exports may finish out of order. Only the newest run
  // can become the baseline; every caller still receives its own full result.
  if (revision === revisionCounter) committedCache = cache;
  return result;
}

async function computeSnapshotWithCache(request: ComputeRequest, revision: number, cache: ComputeCache, work?: CooperativeWorkOptions, renderContext?: TikzRenderContext): Promise<ComputeResponse> {
  const requestKind = request.kind ?? "render";
  const computeStartedAt = renderContext?.startedAt ?? performance.now();

  try {
    const beamerDocument = !renderContext && detectDocumentKind(request.source) === "beamer";
    if (!beamerDocument && cache.renderContextKey !== renderContext?.key) {
      cache.semantic.reset(); cache.parse.reset(); cache.svg = null; cache.text = null; cache.warmSource = null;
      cache.renderContextKey = renderContext?.key;
    }
    if (beamerDocument) {
      const rootRef = request.activeRootId
        ? parseDocumentRootId(request.activeRootId)
        : null;
      if (rootRef?.kind === "beamer-frame-tikz" && rootRef.layer) {
        const layer = await computeOverlayLayerSnapshot(request, revision, requestKind, computeStartedAt, rootRef, cache, work);
        if (layer) {
          return layer;
        }
      } else if (rootRef?.kind === "beamer-frame-tikz") {
        const nested = await computeNestedTikzSnapshot(
          request,
          revision,
          requestKind,
          computeStartedAt,
          rootRef,
          work
        );
        if (nested) {
          return nested;
        }
        // The addressed picture no longer exists (edited away): fall back
        // to the deck so the app can recover to the owning frame.
      }
      return await computeDeckSnapshot(request, revision, requestKind, computeStartedAt, cache, work);
    }
    const trigger = request.trigger ?? "other";
    const changedSourceIds = normalizeChangedSourceIds(request.changedSourceIds ?? []);
    const patches = normalizePatches(request.patches ?? []);
    const sourceFingerprint = buildSourceRevisionFingerprint({
      documentId: request.documentId,
      sourceRevision: request.sourceRevision,
      sourceLength: request.source.length
    });
    if (requestKind === "prewarm" && cache.warmSource === request.source) {
      return {
        id: request.id,
        documentId: request.documentId,
        snapshot: makeEmptySnapshot(request.source),
        diagnostics: []
      };
    }
    const inferChangedSource = request.inferSourceChanges && cache.warmSource !== null && cache.warmSource !== request.source;
    if ((!request.textEditMaskSpan || renderContext) && (changedSourceIds.length > 0 || inferChangedSource)) {
      const result = await computeSnapshotIncremental(
        request.source,
        request.sourceRevision ?? null,
        request.activeRootId,
        changedSourceIds,
        patches,
        request.patchBaseRevision ?? null,
        trigger,
        sourceFingerprint,
        request.documentFileRef ?? null,
        request.renderViewBox ?? null,
        request.inferSourceChanges ?? false,
        cache,
        work,
        renderContext
      );
      const snapshot: SessionSnapshot = {
        source: request.source,
        revision,
        figures: result.parse.figures,
        activeRootId: result.parse.activeFigureId,
        editHandles: result.semantic.editHandles,
        scene: result.semantic.scene,
        svg: result.svg,
        svgModel: result.svg.model,
        parseResult: result.parse,
        semanticResult: result.semantic,
        textLayoutContext: result.textLayoutContext,
        graphicsPreviewBundleKey: result.graphicsPreviewBundleKey,
        deck: null,
        incremental: {
          trigger,
          changedSourceIds: result.changedSourceIds,
          parseStrategy: result.parseStats.strategy,
          parseFallbackReason: result.parseStats.fallbackReason,
          parsePatchApplication: result.parseStats.patchApplication,
          reparsedStatementCount: result.parseStats.reparsedStatementCount,
          parserReusedStatementCount: result.parseStats.reusedStatementCount,
          strategy: result.semanticStats.strategy,
          replayMode: result.semanticStats.replayMode,
          suffixReplay: result.semanticStats.suffixReplay,
          fallbackReason: result.semanticStats.fallbackReason,
          recomputeFromStatementIndex: result.semanticStats.recomputeFromStatementIndex,
          recomputedStatementCount: result.semanticStats.recomputedStatementCount,
          reusedStatementCount: result.semanticStats.reusedStatementCount,
          corridorEndStatementIndex: result.semanticStats.corridorEndStatementIndex,
          affectedStatementCount: result.semanticStats.affectedStatementCount
        }
      };
      recordProfilingComputeTiming({
        requestId: request.id,
        kind: requestKind,
        trigger: request.schedulingTrigger ?? trigger,
        durationMs: performance.now() - computeStartedAt,
        changedSourceCount: result.changedSourceIds.length,
        incremental: true,
        deckLayoutReused: renderContext?.deckLayoutReused,
        parseStrategy: result.parseStats.strategy,
        parseFallbackReason: result.parseStats.fallbackReason ?? null,
        parsePatchApplication: result.parseStats.patchApplication ?? null,
        parsePatchBaseRevision: request.patchBaseRevision ?? null,
        sourceRevision: request.sourceRevision ?? null,
        semanticStrategy: result.semanticStats.strategy,
        semanticFallbackReason: result.semanticStats.fallbackReason ?? null,
        recomputedStatementCount: result.semanticStats.recomputedStatementCount,
        reusedStatementCount: result.semanticStats.reusedStatementCount,
        phaseDurationsMs: result.phaseDurationsMs
      });
      return {
        id: request.id,
        documentId: request.documentId,
        snapshot,
        diagnostics: result.renderDiagnostics
      };
    }

    const phases: Record<string, number> = {};
    let phaseStartedAt = performance.now();
    const maybeTextEngine = renderContext?.textEngine ?? getTextEngine();
    const textEngine = maybeTextEngine instanceof Promise ? await maybeTextEngine : maybeTextEngine;
    phases.textEngine = performance.now() - phaseStartedAt;
    // Full renders also seed the incremental cache. Route their one semantic
    // evaluation through the session instead of evaluating again after render.
    // Ordinary masked renders use an isolated session. Overlay sessions track
    // structural masks alongside the source, so node typing can remain incremental.
    const semanticSession = request.textEditMaskSpan && !renderContext ? createIncrementalSemanticSession() : cache.semantic;
    semanticSession.reset();
    phaseStartedAt = performance.now();
    const graphicsContext = renderContext?.graphicsContext ?? await prepareDocumentGraphicsContext({
      source: request.source,
      documentFileRef: request.documentFileRef ?? null
    });
    const graphicsResolver = graphicsContext.resolver;
    phases.imageAssets = performance.now() - phaseStartedAt;
    phaseStartedAt = performance.now();
    const textEditMaskSpan = request.textEditMaskSpan ?? null;
    const result = await renderTikzToSvgAsync(request.source, {
      parse: {
        recover: true,
        activeFigureId: request.activeRootId,
        includeContextDefinitions: true,
        structuralMasks: textEditMaskSpan ? [textEditMaskSpan] : undefined
      },
      evaluate: { ...renderContext?.evaluate, sourceFingerprint, graphicsResolver },
      cooperative: work,
      semanticEvaluatorAsync: async (figure, source, options, scopedWork) =>
        (await semanticSession.evaluateAsync({ figure, source, options, hints: { trigger: "other" } }, scopedWork)).semantic,
      semanticEvaluator: (figure, source, options) =>
        semanticSession.evaluate({
          figure,
          source,
          options,
          hints: { trigger: "other" }
        }).semantic,
      svgOptionsFromParse: (parse) => ({ ...computeSvgOptions(parse, request.renderViewBox), ...(renderContext && { padding: renderContext.padding }) }),
      textEngine
    });
    phases.render = performance.now() - phaseStartedAt;
    cache.warmSource = request.source;
    phaseStartedAt = performance.now();
    if (!textEditMaskSpan || renderContext) {
      // Overlay parses retain their masks in the session. Ordinary masked
      // renders leave the pre-edit parse, evaluation and SVG baseline intact.
      const parseSession = cache.parse;
      parseSession.prime(result.parse, {
        activeFigureId: request.activeRootId ?? result.parse.activeFigureId,
        includeContextDefinitions: true,
        structuralMasks: renderContext?.structuralMasks,
        sourceRevision: request.sourceRevision ?? null
      });
      cache.svg = result.svg.model;
      cache.graphicsResolverCacheKey = graphicsResolver.cacheKey;
    }
    phases.primeParse = performance.now() - phaseStartedAt;
    cache.text = result.textLayoutContext;

    const snapshot: SessionSnapshot = {
      source: request.source,
      revision,
      figures: result.parse.figures,
      activeRootId: result.parse.activeFigureId,
      editHandles: result.semantic.editHandles,
      scene: result.semantic.scene,
      svg: result.svg,
      svgModel: result.svg.model,
      parseResult: result.parse,
      semanticResult: result.semantic,
      textLayoutContext: result.textLayoutContext,
      graphicsPreviewBundleKey: graphicsContext.previewBundle.cacheKey,
      incremental: null,
      deck: null
    };
    recordProfilingComputeTiming({
      requestId: request.id,
      kind: requestKind,
      trigger: request.schedulingTrigger ?? trigger,
      durationMs: performance.now() - computeStartedAt,
      changedSourceCount: changedSourceIds.length,
      incremental: false,
      deckLayoutReused: renderContext?.deckLayoutReused,
      phaseDurationsMs: phases
    });

    return {
      id: request.id,
      documentId: request.documentId,
      snapshot,
      diagnostics: result.renderDiagnostics
    };
  } catch (error) {
    work?.signal?.throwIfAborted();
    cache.semantic.reset();
    cache.parse.reset();
    cache.warmSource = null;
    cache.svg = null;
    cache.text = null;
    cache.graphicsResolverCacheKey = null;
    const snapshot: SessionSnapshot = {
      source: request.source,
      revision,
      figures: [],
      activeRootId: null,
      editHandles: [],
      scene: null,
      svg: null,
      svgModel: null,
      parseResult: null,
      semanticResult: null,
      textLayoutContext: null,
      graphicsPreviewBundleKey: null,
      incremental: null,
      deck: null
    };

    return {
      id: request.id,
      documentId: request.documentId,
      snapshot,
      diagnostics: [
        {
          code: "compute-error",
          message: error instanceof Error ? error.message : String(error),
          severity: "error"
        }
      ]
    };
  }
}

/**
 * Document-level deck state shared across frame/step renders of one source
 * revision. Invalidated when the source or the graphics-resolver identity
 * changes; rendered pages are memoized per (frame, step).
 */
type DeckComputeSession = {
  contextKey: string;
  epoch: number;
  source: string;
  resolverCacheKey: string;
  structuralMaskKey: string;
  prepared: PreparedBeamerDocument;
  /** Whether `prepared` has the structure a fresh parse gives. */
  parseExact: boolean;
  frames: DeckFrameSummary[];
  graphicsContext: PreparedDocumentGraphicsContext;
  renderedPages: BoundedLru<string, DeckActiveFrame>;
};

let deckComputeSession: DeckComputeSession | null = null;
let deckCacheEpoch = 0;
let deckPrewarmController: AbortController | null = null;
export const DECK_PAGE_CACHE_LIMIT = 32;
export const DECK_PAGE_CACHE_BYTE_LIMIT = 32 * 1024 * 1024;

export function deckPageCacheStats(): { pages: number; estimatedBytes: number } {
  return { pages: deckComputeSession?.renderedPages.size ?? 0, estimatedBytes: deckComputeSession?.renderedPages.retainedBytes ?? 0 };
}

function deckContextKey(request: ComputeRequest, includeRevision = true, includeMask = true): string {
  const file = request.documentFileRef;
  return JSON.stringify([request.documentId ?? null, includeRevision ? request.sourceRevision ?? null : null,
    file ? [file.kind, file.provider, file.path, file.handleId, file.name] : null,
    getImageAssetCacheGeneration(), getActiveEditorPlatformGeneration(), texGlyphOutlineGeneration(),
    includeMask ? request.textEditMaskSpan?.from ?? null : null, includeMask ? request.textEditMaskSpan?.to ?? null : null]);
}

function matchingDeckSession(request: ComputeRequest): DeckComputeSession | null {
  const session = deckComputeSession;
  if (request.exactParse && !session?.parseExact) return null;
  return session?.source === request.source && session.contextKey === deckContextKey(request) ? session : null;
}

function requestedDeckPage(session: DeckComputeSession, request: ComputeRequest): { index: number; step: number; key: string } | null {
  const ref = request.activeRootId ? parseDocumentRootId(request.activeRootId) : null;
  if (ref?.kind !== "beamer-frame") return null;
  const frame = session.frames[ref.index];
  if (!frame || frame.id !== request.activeRootId) return null;
  const step = Math.min(Math.max(1, request.deckStep ?? 1), Math.max(1, frame.stepCount));
  return { index: ref.index, step, key: `${ref.index}:${step}` };
}

export function isDeckSnapshotCurrent(snapshot: SessionSnapshot, request: ComputeRequest): boolean {
  const session = matchingDeckSession(request);
  if (session && snapshot.source === request.source && snapshot.deck?.cacheEpoch === session.epoch &&
    request.activeRootId === null && snapshot.activeRootId === null && snapshot.deck.activeFrame === null) return true;
  const page = session && requestedDeckPage(session, request);
  const frame = snapshot.deck?.activeFrame;
  return !!(session && page && frame && snapshot.source === request.source &&
    snapshot.deck?.cacheEpoch === session.epoch && frame.frameId === request.activeRootId && frame.step === page.step &&
    frame.layout.frameId === frame.frameId && frame.layout.step === frame.step &&
    (!request.includeDrawingLayer || snapshot.overlayLayer?.pageCoordinates === true ||
      !frame.layout.embeddedTikz.some(entry => entry.overlay)) &&
    // Without a layer asked for, the one shown is the page's default, never one still to come.
    (request.drawingLayerRootId ? snapshot.overlayLayer?.rootId === request.drawingLayerRootId
      : !snapshot.overlayLayer || (!snapshot.overlayLayer.insertion && snapshot.overlayLayer.rootId === pageDrawingLayerRootId(frame.layout))));
}

function deckSnapshot(session: DeckComputeSession, frame: DeckActiveFrame, revision: number): SessionSnapshot {
  return { ...makeEmptySnapshot(session.source), revision, activeRootId: frame.frameId,
    graphicsPreviewBundleKey: session.graphicsContext.previewBundle.cacheKey,
    deck: { cacheEpoch: session.epoch, frames: session.frames, document: session.prepared.document,
      activeFrame: frame, diagnostics: session.prepared.document.diagnostics, exactParse: session.parseExact } };
}

/** Only completed pages in the exact current render context can be published. */
export function claimCachedDeckSnapshot(request: ComputeRequest): SessionSnapshot | null {
  const started = performance.now();
  const session = matchingDeckSession(request);
  const page = session && requestedDeckPage(session, request);
  const frame = page && session?.renderedPages.get(page.key);
  // A page prewarmed while outlines load may have blank glyphs; render it afresh.
  if (!session || !frame || texGlyphOutlinesLoading()) return null;
  cancelDeckPrewarm();
  const snapshot = deckSnapshot(session, frame, ++revisionCounter);
  recordProfilingComputeTiming({ requestId: request.id, kind: "render", trigger: request.schedulingTrigger ?? "cached-navigation",
    durationMs: performance.now() - started, phaseDurationsMs: { cachedNavigation: performance.now() - started } });
  return snapshot;
}

export function cancelDeckPrewarm(): void {
  deckPrewarmController?.abort(); deckPrewarmController = null;
}

/** Warm at most two neighbors. Never publishes UI state or advances foreground revisions. */
export async function prewarmDeckNeighbors(request: ComputeRequest, work: CooperativeWorkOptions): Promise<void> {
  cancelDeckPrewarm();
  const session = matchingDeckSession(request);
  const page = session && requestedDeckPage(session, request);
  if (!session || !page || request.textEditMaskSpan) return;
  const controller = new AbortController(); deckPrewarmController = controller;
  const abort = () => { controller.abort(); };
  work.signal?.addEventListener("abort", abort, { once: true });
  if (work.signal?.aborted) controller.abort();
  try {
    for (const index of [page.index + 1, page.index - 1]) {
      controller.signal.throwIfAborted();
      if (deckComputeSession !== session || matchingDeckSession(request) !== session) return;
      if (!session.frames[index] || session.renderedPages.get(`${index}:1`)) continue;
      const rendered = await renderDeckPage(session, index, 1, { ...work, budgetMs: Math.min(work.budgetMs ?? 4, 4), signal: controller.signal,
        yieldControl: async () => {
          await work.yieldControl();
          if (matchingDeckSession(request) !== session) controller.abort();
          controller.signal.throwIfAborted();
        } });
      controller.signal.throwIfAborted();
      if (deckComputeSession !== session || matchingDeckSession(request) !== session) return;
      session.renderedPages.set(`${index}:1`, rendered.frame, rendered.bytes);
      // Keep the visible page hot so idle work cannot evict it first.
      session.renderedPages.get(page.key);
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    work.signal?.removeEventListener("abort", abort);
    if (deckPrewarmController === controller) deckPrewarmController = null;
  }
}

/**
 * Beamer's paragraph reports retain font resolvers used while laying out the
 * page. The active-frame snapshot only publishes the resulting geometry, so
 * omit those executable helpers at the worker boundary while preserving the
 * report/vlist data consumed by canvas hit testing.
 */
function makeBeamerLayoutCloneSafe(layout: BeamerFrameLayout): { layout: BeamerFrameLayout; bytes: number } {
  const copies = new WeakMap<object, object>();
  let bytes = 0;

  const copy = (value: unknown): unknown => {
    if (typeof value === "function" || typeof value === "symbol") {
      return undefined;
    }
    if (value === null || typeof value !== "object") {
      bytes += typeof value === "string" ? value.length * 2 : 8;
      return value;
    }
    const cached = copies.get(value);
    if (cached) {
      return cached;
    }
    if (Array.isArray(value)) {
      bytes += 24 + value.length * 8;
      const result: unknown[] = [];
      copies.set(value, result);
      for (const entry of value) {
        result.push(copy(entry));
      }
      return result;
    }
    const result: Record<string, unknown> = {};
    bytes += 48 + Object.keys(value).length * 16;
    copies.set(value, result);
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry !== "function" && typeof entry !== "symbol") {
        result[key] = copy(entry);
      }
    }
    return result;
  };

  const result = copy(layout) as BeamerFrameLayout;
  return { layout: result, bytes };
}

async function renderDeckPage(session: DeckComputeSession, frameIndex: number, step: number, work?: CooperativeWorkOptions, drawingLayer?: string) {
  const result = await session.prepared.renderFrame({ frameIndex, step,
    graphicsResolver: session.graphicsContext.resolver, cooperative: work, drawingLayer });
  work?.signal?.throwIfAborted();
  const clone = makeBeamerLayoutCloneSafe(result.layout);
  const frame: DeckActiveFrame = { frameId: result.frame.id, frameIndex, step, stepCount: result.layout.stepCount,
    svg: result.svg.svg, svgModel: result.svg.model, viewBox: result.svg.viewBox, layout: clone.layout,
    editingEnvironment: session.prepared.frameEditingEnvironment(frameIndex) };
  const bytes = clone.bytes + (frame.svg.length + frame.svgModel.parts.reduce((sum, part) => sum + part.markup.length, 0)) * 2;
  return { frame, bytes };
}

/**
 * The page with a drawing layer left undrawn, for its own render to paint
 * (composeOverlayPage): the last one while it stands (undrawnLayerPageStands),
 * else laid out again. Null when the layer is not on this step.
 */
async function drawingLayerPage(session: DeckComputeSession, cache: ComputeCache, request: ComputeRequest, frameIndex: number, step: number,
  rootId: string, picture: BeamerOverlayPicture, work?: CooperativeWorkOptions): Promise<{ frame: DeckActiveFrame; reused: boolean } | null> {
  const contextKey = deckContextKey(request, false, false);
  const mask = request.textEditMaskSpan;
  const reusable = !mask || (picture.span.from <= mask.from && mask.to <= picture.span.to);
  const previous = cache.overlayPage;
  if (previous && reusable && previous.rootId === rootId && previous.contextKey === contextKey &&
    previous.frame.frameIndex === frameIndex && previous.frame.step === step && previous.frame.stepCount === session.frames[frameIndex].stepCount &&
    previous.rememberPicture === picture.rememberPicture && undrawnLayerPageStands(previous, request.source, picture.span)) {
    return { frame: previous.frame, reused: true };
  }
  const { frame } = await renderDeckPage(session, frameIndex, step, work, rootId);
  if (!frame.layout.embeddedTikz.some((entry) => entry.overlay?.rootId === rootId)) return null;
  cache.overlayPage = reusable
    ? { source: request.source, contextKey, frame, rootId, span: picture.span, rememberPicture: picture.rememberPicture }
    : undefined;
  return { frame, reused: false };
}

function resolveDeckFrameIndex(
  frames: readonly DeckFrameSummary[],
  activeRootId: string | null | undefined
): number | null {
  if (frames.length === 0) {
    return null;
  }
  if (activeRootId === null) {
    return null;
  }
  if (activeRootId === undefined) {
    return 0;
  }
  const ref = parseDocumentRootId(activeRootId);
  const requested =
    ref?.kind === "beamer-frame" || ref?.kind === "beamer-frame-tikz"
      ? ref.kind === "beamer-frame"
        ? ref.index
        : ref.frameIndex
      : null;
  return requested != null && requested >= 0 && requested < frames.length
    ? requested
    : null;
}

async function computeDeckSnapshot(
  request: ComputeRequest,
  revision: number,
  requestKind: "render" | "prewarm",
  computeStartedAt: number,
  cache: ComputeCache,
  work?: CooperativeWorkOptions
): Promise<ComputeResponse> {
  if (requestKind === "prewarm") {
    // Deck mode has no drag-prewarm path; hover prewarming is a tikz
    // incremental-session concern.
    return {
      id: request.id,
      documentId: request.documentId,
      snapshot: makeEmptySnapshot(request.source),
      diagnostics: []
    };
  }
  const contextKey = deckContextKey(request);
  const graphicsContext = await prepareDocumentGraphicsContext({
    source: request.source,
    documentFileRef: request.documentFileRef ?? null
  });
  work?.signal?.throwIfAborted();
  const graphicsResolver = graphicsContext.resolver;
  const structuralMask = request.textEditMaskSpan ?? null;
  const structuralMaskKey = structuralMask
    ? `${structuralMask.from}:${structuralMask.to}`
    : "";
  let session: DeckComputeSession;
  const sameContext = deckComputeSession?.source === request.source &&
    deckComputeSession.contextKey === contextKey &&
    deckComputeSession.resolverCacheKey === graphicsResolver.cacheKey &&
    deckComputeSession.structuralMaskKey === structuralMaskKey;
  // Parsed afresh, a deck whose structure is unchanged keeps its rendered pages.
  const exact = sameContext && request.exactParse && !deckComputeSession!.parseExact
    ? prepareBeamerDocument(request.source, { structuralMasks: structuralMask ? [structuralMask] : undefined, exactSyntax: true })
    : null;
  if (exact && sameSyntaxTree(exact.syntax.tree, deckComputeSession!.prepared.syntax.tree)) {
    session = { ...deckComputeSession!, parseExact: true, renderedPages: deckComputeSession!.renderedPages.fork() };
  } else if (!sameContext || exact) {
    // Any earlier document reparses correctly: what changed is found by diffing.
    const prepared = exact ?? prepareBeamerDocument(request.source, {
      structuralMasks: structuralMask ? [structuralMask] : undefined,
      previousSyntax: deckComputeSession?.prepared.syntax,
      exactSyntax: request.exactParse
    });
    session = {
      contextKey, epoch: ++deckCacheEpoch, graphicsContext,
      source: request.source,
      resolverCacheKey: graphicsResolver.cacheKey,
      structuralMaskKey,
      prepared,
      parseExact: prepared.syntax.exact,
      frames: prepared.document.frames.map((frame, frameIndex) => ({
        id: frame.id,
        frameIndex,
        span: { from: frame.span.from, to: frame.span.to },
        title: frame.title?.value ?? null,
        stepCount: prepared.frameStepCount(frameIndex)
      })),
      renderedPages: new BoundedLru(DECK_PAGE_CACHE_LIMIT, DECK_PAGE_CACHE_BYTE_LIMIT)
    };
  } else {
    // A suspended render owns its page writes. Aborted or older requests must
    // not replace the newest completed deck baseline, even for the same source.
    session = { ...deckComputeSession!, renderedPages: deckComputeSession!.renderedPages.fork() };
  }
  const frameIndex = resolveDeckFrameIndex(session.frames, request.activeRootId);
  let activeFrame: DeckActiveFrame | null = null;
  let deckLayoutReused = false;
  /** The drawing layer the page leaves undrawn, painted from its own render below. */
  let paintedLayer: string | null = null;
  let virtualLayer: string | null = null;
  let plainPage: (() => Promise<DeckActiveFrame>) | null = null;
  if (frameIndex != null) {
    const stepCount = session.frames[frameIndex].stepCount;
    const step = Math.min(Math.max(1, request.deckStep ?? 1), Math.max(1, stepCount));
    const pageKey = `${frameIndex}:${step}`;
    // Pages as TeX draws them, every picture included; thumbnails and claims share them.
    plainPage = async () => {
      const cached = session.renderedPages.get(pageKey);
      if (cached) return cached;
      const rendered = await renderDeckPage(session, frameIndex, step, work);
      session.renderedPages.set(pageKey, rendered.frame, rendered.bytes);
      return rendered.frame;
    };
    if (!request.includeDrawingLayer) {
      activeFrame = await plainPage();
    } else {
      const pictures = beamerOverlayPicturesIn({ source: request.source, syntax: session.prepared.syntax }, session.prepared.document.frames[frameIndex].bodySpan);
      const requested = parseDocumentRootId(request.drawingLayerRootId ?? "");
      const asked = requested?.kind === "beamer-frame-tikz" && requested.layer && requested.frameIndex === frameIndex ? requested : null;
      if (asked?.index === pictures.length) virtualLayer = formatDocumentRootId(asked);
      const candidates: string[] = asked && asked.index < pictures.length ? [formatDocumentRootId(asked)] : [];
      // Otherwise the layer a drawing tool would pick on the page as drawn.
      const fallback = async () => virtualLayer ? null : pageDrawingLayerRootId((await plainPage!()).layout);
      if (candidates.length === 0) {
        const rootId = await fallback();
        if (rootId) candidates.push(rootId);
      }
      for (const rootId of candidates) {
        const index = parseDocumentRootId(rootId)!;
        const picture = index.kind === "beamer-frame-tikz" ? pictures[index.index] : undefined;
        if (!picture) continue;
        const layered = await drawingLayerPage(session, cache, request, frameIndex, step, rootId, picture, work);
        if (layered) {
          activeFrame = layered.frame;
          deckLayoutReused = layered.reused;
          paintedLayer = rootId;
          break;
        }
        // Not on this step: the page's own default, if another.
        const other = await fallback();
        if (other && other !== rootId && !candidates.includes(other)) candidates.push(other);
      }
      activeFrame ??= await plainPage();
    }
  }
  work?.signal?.throwIfAborted();
  const snapshot: SessionSnapshot = {
    source: request.source,
    revision,
    figures: [],
    activeRootId: activeFrame?.frameId ?? null,
    editHandles: [],
    scene: null,
    svg: null,
    svgModel: null,
    parseResult: null,
    semanticResult: null,
    textLayoutContext: null,
    graphicsPreviewBundleKey: graphicsContext.previewBundle.cacheKey,
    incremental: null,
    deck: {
      cacheEpoch: session.epoch,
      frames: session.frames,
      document: session.prepared.document,
      activeFrame,
      diagnostics: session.prepared.document.diagnostics,
      exactParse: session.parseExact
    }
  };
  if (activeFrame && request.includeDrawingLayer && (paintedLayer || virtualLayer)) {
    const ref = parseDocumentRootId((paintedLayer ?? virtualLayer)!) as Extract<DocumentRootRef, { kind: "beamer-frame-tikz" }>;
    const layer = await computeOverlayLayerSnapshot(request, revision, requestKind, computeStartedAt, ref, cache, work, true,
      { frame: activeFrame, graphicsContext, prepared: session.prepared, deckLayoutReused });
    if (layer && paintedLayer) {
      if (layer.snapshot.incremental) layer.snapshot.incremental.deckLayoutReused = deckLayoutReused;
      activeFrame = composeOverlayPage(activeFrame, layer.snapshot, layer.diagnostics);
    } else if (paintedLayer) {
      // The page left the layer undrawn; without its render, show the page as drawn.
      activeFrame = await plainPage!();
    }
    snapshot.deck!.activeFrame = activeFrame;
    if (layer) Object.assign(snapshot, layer.snapshot, { deck: snapshot.deck, activeRootId: activeFrame.frameId });
  }
  work?.signal?.throwIfAborted();
  if (revision === revisionCounter) deckComputeSession = session;
  if (!snapshot.overlayLayer) recordProfilingComputeTiming({
    requestId: request.id,
    kind: requestKind,
    trigger: request.schedulingTrigger ?? request.trigger ?? "other",
    durationMs: performance.now() - computeStartedAt,
    changedSourceCount: 0,
    incremental: false
  });
  return {
    id: request.id,
    documentId: request.documentId,
    snapshot,
    diagnostics: snapshot.deck?.diagnostics.map((diagnostic) => ({
      code: diagnostic.code ?? "beamer",
      message: diagnostic.message,
      severity: diagnostic.severity
    })) ?? []
  };
}

/**
 * Scan cache for nested-picture renders: one entry, keyed by source. The
 * nested branch rescans per source revision to track the picture span as
 * it grows and shrinks under editing; the scan is much cheaper than the
 * TikZ render that follows it.
 */
let nestedScanSession: {
  source: string;
  document: ReturnType<typeof scanBeamerDocument>;
} | null = null;


/**
 * Nested TikZ figure editing (design/beamer-canvas-editing.md, "Nested
 * TikZ figure editing"): with a `beamer-frame-tikz` root active, run the
 * plain TikZ pipeline over the full-length source with everything outside
 * the picture span masked to spaces (newlines preserved). Every span in
 * the resulting parse/scene/edit-handle data is an absolute offset into
 * the REAL source, so tikz edit actions, undo, and the source panel work
 * unmodified. Returns null when the addressed picture does not exist so
 * the caller can fall back to the deck.
 *
 * Surrounding definitions retain their scope and absolute spans. Ordinary
 * embedded-picture editing still uses a full TikZ render (no incremental session).
 */
async function computeNestedTikzSnapshot(
  request: ComputeRequest,
  revision: number,
  requestKind: "render" | "prewarm",
  computeStartedAt: number,
  ref: Extract<DocumentRootRef, { kind: "beamer-frame-tikz" }>,
  work?: CooperativeWorkOptions
): Promise<ComputeResponse | null> {
  if (requestKind === "prewarm") {
    return {
      id: request.id,
      documentId: request.documentId,
      snapshot: makeEmptySnapshot(request.source),
      diagnostics: []
    };
  }
  if (nestedScanSession?.source !== request.source) {
    nestedScanSession = {
      source: request.source,
      document: scanBeamerDocument(request.source)
    };
  }
  const document = nestedScanSession.document;
  const picture = document.frames[ref.frameIndex]?.children[ref.index];
  if (!picture) {
    return null;
  }
  const graphicsContext = await prepareDocumentGraphicsContext({
    source: request.source,
    documentFileRef: request.documentFileRef ?? null
  });
  const theme = resolveBeamerTheme(document);
  const textEngine = await createTexNodeTextEngine({
    mathFontProfile: createBeamerTexMathFontProfile(theme.fonts["normal-text"])
  });
  work?.signal?.throwIfAborted();
  const masked = maskTikzPictureSource(request.source, picture.span);
  const result = await renderTikzToSvgAsync(masked, {
    parse: { recover: true, includeContextDefinitions: true },
    evaluate: { graphicsResolver: graphicsContext.resolver, initialFont: beamerTikzFontCommand(theme.fonts["normal-text"]) },
    svgOptionsFromParse: (parse) => computeSvgOptions(parse, request.renderViewBox),
    textEngine,
    cooperative: work
  });
  const snapshot: SessionSnapshot = {
    source: request.source,
    revision,
    figures: result.parse.figures,
    activeRootId: result.parse.activeFigureId,
    editHandles: result.semantic.editHandles,
    scene: result.semantic.scene,
    svg: result.svg,
    svgModel: result.svg.model,
    parseResult: result.parse,
    semanticResult: result.semantic,
    textLayoutContext: result.textLayoutContext,
    graphicsPreviewBundleKey: graphicsContext.previewBundle.cacheKey,
    incremental: null,
    deck: null
  };
  recordProfilingComputeTiming({
    requestId: request.id,
    kind: requestKind,
    trigger: request.schedulingTrigger ?? request.trigger ?? "other",
    durationMs: performance.now() - computeStartedAt,
    changedSourceCount: 0,
    incremental: false
  });
  return {
    id: request.id,
    documentId: request.documentId,
    snapshot,
    diagnostics: result.renderDiagnostics
  };
}

type OverlayLayerPlacement = {
  /** The picture in the rendered source. */
  span: { from: number; to: number };
  origin: { x: number; y: number };
  rememberPicture: boolean;
  backdropSvg: string | null;
  page: { width: number; height: number };
  initialFont: string;
};

/**
 * Where a layer's picture is and what is under it. Neither depends on what
 * the picture draws (TeX sets it as an empty box), so they are kept under
 * the source with the picture left out. Geometry-only drags reuse its
 * placement and the slide's text layout.
 */
const overlayLayerPlacements = new BoundedLru<string, OverlayLayerPlacement>(8, 8 * 1024 * 1024);
async function renderLayerFrame(source: string, frameIndex: number, step: number, graphicsContext: PreparedDocumentGraphicsContext, work?: CooperativeWorkOptions) {
  const prepared = deckComputeSession?.source === source ? deckComputeSession.prepared : prepareBeamerDocument(source);
  const stepCount = prepared.frameStepCount(frameIndex);
  return prepared.renderFrame({ frameIndex, step: Math.min(Math.max(1, step), Math.max(1, stepCount)),
    graphicsResolver: graphicsContext.resolver, cooperative: work });
}

/** Where a frame's new layer goes, by source and frame. */
const overlayLayerInsertions = new BoundedLru<string, DrawingLayerInsertion | null>(8, 1024 * 1024);

/** Where a frame sets its paragraphs, by id: what an inserted layer must leave alone. */
function frameTextGeometry(layout: BeamerFrameLayout): Map<string, string> {
  return new Map(layout.paragraphs.map((paragraph) => [paragraph.paragraphId,
    [paragraph.bounds.x, paragraph.bounds.y, paragraph.bounds.width, paragraph.bounds.height].map((value) => value.toFixed(3)).join(",")]));
}

/** The paragraphs that were there stay where they were (the layer may add its own). */
function keepsTextGeometry(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): boolean {
  return [...before].every(([id, bounds]) => after.get(id) === bounds);
}

/**
 * The first insertion that, on every step, moves none of the frame's text and
 * shows the layer; else the last (a paragraph of its own).
 */
async function chooseLayerInsertion(source: string, frameIndex: number, step: number, rootId: string, prepared: PreparedBeamerDocument,
  graphicsContext: PreparedDocumentGraphicsContext, work?: CooperativeWorkOptions) {
  const document = prepared.document.source === source ? prepared.document : scanBeamerDocument(source);
  const frame = document.frames[frameIndex];
  if (!frame) return null;
  // Only the preamble and the frame's own text decide; offsets keep relative to the frame.
  const key = `${frameIndex}:${step}:${graphicsContext.resolver.cacheKey}:${source.slice(document.preamble.span.from, document.preamble.span.to)}\u0000` +
    source.slice(frame.span.from, frame.span.to);
  if (overlayLayerInsertions.has(key)) {
    const kept = overlayLayerInsertions.get(key);
    return kept ? { ...kept, at: kept.at + frame.span.from } : null;
  }
  const candidates: DrawingLayerInsertion[] = beamerDrawingLayerInsertions(createBeamerSyntaxContext(source), frame.bodySpan)
    .map(({ definesLayer, ...candidate }) => ({ ...candidate, preamble: beamerTikzLayerPreambleInsertion(source, definesLayer === true) }));
  const stepCount = Math.max(1, (prepared.document.source === source ? prepared : prepareBeamerDocument(source)).frameStepCount(frameIndex));
  // Every step of an ordinary frame; of a long build, its ends and the step shown.
  const allSteps = stepCount <= 8 ? Array.from({ length: stepCount }, (_, index) => index + 1) : [...new Set([1, step, stepCount])];
  const baselines = new Map<number, Map<string, string>>();
  const baseline = async (at: number) => {
    if (!baselines.has(at)) baselines.set(at, frameTextGeometry((await renderLayerFrame(source, frameIndex, at, graphicsContext, work)).layout));
    return baselines.get(at)!;
  };
  let chosen = candidates.at(-1) ?? null;
  candidates: for (const candidate of candidates.slice(0, -1)) {
    const inserted = insertDrawingLayer(source, candidate);
    // A tikzlayer is TeX-checked to move no text and, at the top level after an
    // \onslide<1-> reset, to show on every step: the step shown suffices. The
    // joins of a plain picture depend on what precedes them: every step.
    const steps = candidate.text.includes("\\begin{tikzlayer}") ? [step] : allSteps;
    for (const at of steps) {
      const layout = (await renderLayerFrame(inserted, frameIndex, at, graphicsContext, work)).layout;
      if (!keepsTextGeometry(await baseline(at), frameTextGeometry(layout)) || !layout.embeddedTikz.some(entry => entry.overlay?.rootId === rootId)) continue candidates;
    }
    chosen = candidate;
    break;
  }
  overlayLayerInsertions.set(key, chosen && { ...chosen, at: chosen.at - frame.span.from }, key.length * 2);
  return chosen;
}

/**
 * A drawing layer (`frame:i:overlay:j`): the frame's j-th overlay picture,
 * edited in place on its slide. Like a nested figure, the picture renders
 * through the TikZ pipeline over the masked source, so spans stay absolute;
 * in addition its page is known (`current page`), its view box is the page
 * in its own coordinates, and the slide under it comes along as a backdrop.
 * The next layer can still be created: it renders as
 * if inserted where `chooseLayerInsertion` puts it. Returns null when the
 * layer cannot be placed, so the caller falls back to the deck.
 */
async function computeOverlayLayerSnapshot(
  request: ComputeRequest,
  revision: number,
  requestKind: "render" | "prewarm",
  computeStartedAt: number,
  ref: Extract<DocumentRootRef, { kind: "beamer-frame-tikz" }>,
  cache: ComputeCache,
  work?: CooperativeWorkOptions,
  pageCoordinates = false,
  pageContext?: { frame: DeckActiveFrame; graphicsContext: PreparedDocumentGraphicsContext; prepared: PreparedBeamerDocument; deckLayoutReused: boolean }
): Promise<ComputeResponse | null> {
  if (requestKind === "prewarm") {
    return { id: request.id, documentId: request.documentId, snapshot: makeEmptySnapshot(request.source), diagnostics: [] };
  }
  const source = request.source;
  const prepared = pageContext?.prepared ?? (deckComputeSession?.source === source ? deckComputeSession.prepared : prepareBeamerDocument(source));
  // The deck's own scan and syntax index, when they are this source's: a
  // fresh parse of the whole document per drag frame is most of a layer edit.
  const own = prepared.document.source === source;
  const document = own ? prepared.document : scanBeamerDocument(source);
  const context = own ? { source, syntax: prepared.syntax } : createBeamerSyntaxContext(source);
  const frame = document.frames[ref.frameIndex];
  if (!frame) return null;
  const graphicsContext = pageContext?.graphicsContext ?? await prepareDocumentGraphicsContext({ source, documentFileRef: request.documentFileRef ?? null });
  const step = Math.min(Math.max(1, request.deckStep ?? 1), Math.max(1, prepared.frameStepCount(ref.frameIndex)));
  const pictures = beamerOverlayPicturesIn(context, frame.bodySpan);
  let insertion: DrawingLayerInsertion | null = null;
  if (ref.index >= pictures.length) {
    if (ref.index !== pictures.length) return null;
    insertion = await chooseLayerInsertion(source, ref.frameIndex, step, formatDocumentRootId(ref), prepared, graphicsContext, work);
    if (!insertion) return null;
  }
  const working = insertion ? insertDrawingLayer(source, insertion) : source;
  const picture = insertion
    ? beamerOverlayPicturesIn(createBeamerSyntaxContext(working), scanBeamerDocument(working).frames[ref.frameIndex]?.bodySpan ?? frame.bodySpan)[ref.index]
    : pictures[ref.index];
  if (!picture) return null;
  // On a slide its place is read off the page just laid out. Otherwise from a
  // layout kept by the source outside the picture (the backdrop's offsets
  // after it move with its length) and the text-edit mask.
  const placementKey = `${ref.frameIndex}:${ref.index}:${step}:${picture.rememberPicture}:${pageCoordinates}:${graphicsContext.resolver.cacheKey}:` +
    `${request.textEditMaskSpan?.from ?? ""}-${request.textEditMaskSpan?.to ?? ""}:` +
    working.slice(0, picture.span.from) + `\u0000${pageCoordinates ? "" : picture.span.to - picture.span.from}\u0000` + working.slice(picture.span.to);
  const onPage = !insertion && pageContext ? pageContext.frame : null;
  let placement = onPage ? undefined : overlayLayerPlacements.get(placementKey);
  if (!placement) {
    const rendered = onPage
      ? { layout: onPage.layout, svg: { model: onPage.svgModel } }
      : await renderLayerFrame(working, ref.frameIndex, step, graphicsContext, work);
    const layerRootId = formatDocumentRootId(ref);
    const entry = rendered.layout.embeddedTikz.find((candidate) => candidate.overlay?.rootId === layerRootId);
    if (!entry?.overlay) return null;
    const model = rendered.svg.model;
    placement = {
      span: picture.span,
      origin: entry.overlay.origin,
      rememberPicture: entry.overlay.rememberPicture,
      backdropSvg: pageCoordinates ? null
        : serializeSvgModel({ ...model, parts: model.parts.filter((part) => part.sourceId !== entry.itemId && !part.partId.startsWith(`${entry.itemId}/`)) }),
      page: { width: rendered.layout.page.page.width, height: rendered.layout.page.page.height },
      initialFont: beamerTikzFontCommand(resolveBeamerTheme(document).fonts["normal-text"])
    };
    if (!onPage) overlayLayerPlacements.set(placementKey, placement, placementKey.length * 2 + (placement.backdropSvg?.length ?? 0) * 2);
  }
  const { origin, page } = placement;
  // With `remember picture`, PGF knows where the picture is on the page;
  // without, `current page` takes the picture's origin for the page's corner.
  const currentPage = pageCoordinates
    ? placement.rememberPicture
      ? { minX: 0, minY: 0, maxX: page.width, maxY: page.height }
      : { minX: origin.x, minY: page.height - origin.y, maxX: origin.x + page.width, maxY: 2 * page.height - origin.y }
    : placement.rememberPicture
    ? { minX: -origin.x, minY: origin.y - page.height, maxX: page.width - origin.x, maxY: origin.y }
    : { minX: 0, minY: 0, maxX: page.width, maxY: page.height };
  const evaluate = { currentPage, initialFont: placement.initialFont,
    ...(picture.tikzLayer && { pictureOptions: BEAMER_TIKZ_LAYER_OPTIONS }),
    ...(pageCoordinates ? { initialTransform: translationMatrix(origin.x, page.height - origin.y) } : {}) };
  const theme = resolveBeamerTheme(document);
  const textEngine = await createTexNodeTextEngine({
    mathFontProfile: createBeamerTexMathFontProfile(theme.fonts["normal-text"])
  });
  work?.signal?.throwIfAborted();
  // The page in the picture's SVG coordinates (y = 2·viewBox.y + height − world y):
  // the slide's canvas transform then shows the picture where it is on the slide.
  const viewBox = { x: pageCoordinates ? 0 : -origin.x, y: pageCoordinates ? 0 : origin.y - page.height, width: page.width, height: page.height };
  const masked = maskTikzPictureSource(working, picture.span);
  const patches = cache.warmSource && request.patches && patchesMatchSourceTransition(cache.warmSource, masked, request.patches)
    ? request.patches : null;
  // Text being edited on the slide beside the picture is no part of it.
  const mask = request.textEditMaskSpan;
  const pictureMask = mask && picture.span.from <= mask.from && mask.to <= picture.span.to ? mask : null;
  const result = await computeSnapshotWithCache({ ...request, source: masked, activeRootId: "figure:0", renderViewBox: viewBox, textEditMaskSpan: pictureMask,
    // Preserve exact statement patches when they also reconstruct the masked
    // source. Coalesced/virtual edits infer their transition from the baseline.
    patches, patchBaseRevision: patches ? request.patchBaseRevision : null, inferSourceChanges: true }, revision, cache, work, {
    key: JSON.stringify([formatDocumentRootId(ref), step, pageCoordinates, evaluate, graphicsContext.resolver.cacheKey]),
    textEngine, graphicsContext, evaluate, padding: 0, startedAt: computeStartedAt,
    structuralMasks: pictureMask ? [pictureMask] : undefined,
    deckLayoutReused: pageContext?.deckLayoutReused
  });
  result.snapshot.source = source;
  result.snapshot.overlayLayer = { rootId: formatDocumentRootId(ref), frameIndex: ref.frameIndex, step,
    backdropSvg: placement.backdropSvg, origin, evaluate, insertion, pageCoordinates,
    requestedRootId: request.drawingLayerRootId ?? null };
  return result;
}

async function computeSnapshotIncremental(
  source: string,
  sourceRevision: number | null,
  activeRootId: string | null | undefined,
  changedSourceIds: string[],
  patches: SourcePatch[],
  patchBaseRevision: number | null,
  trigger: IncrementalSemanticTrigger,
  sourceFingerprint: string | undefined,
  documentFileRef: DocumentFileRef | null,
  renderViewBox: SvgViewBox | null,
  inferChanges: boolean,
  cache: ComputeCache,
  work?: CooperativeWorkOptions,
  renderContext?: TikzRenderContext
): Promise<{
  parse: ParseTikzResult;
  changedSourceIds: string[];
  semantic: EvaluateTikzResult;
  svg: EmitSvgResult;
  parseStats: IncrementalParseStats;
  semanticStats: IncrementalSemanticStats;
  renderDiagnostics: RenderDiagnostic[];
  phaseDurationsMs: Record<string, number>;
  graphicsPreviewBundleKey: string;
  textLayoutContext: TextLayoutContext | null;
}> {
  const phases: Record<string, number> = {};
  let phaseStartedAt = performance.now();
  const maybeTextEngine = renderContext?.textEngine ?? getTextEngine();
  const textEngine = maybeTextEngine instanceof Promise ? await maybeTextEngine : maybeTextEngine;
  phases.textEngine = performance.now() - phaseStartedAt;
  phaseStartedAt = performance.now();
  const graphicsContext = renderContext?.graphicsContext ?? await prepareDocumentGraphicsContext({
    source,
    documentFileRef
  });
  const graphicsResolver = graphicsContext.resolver;
  if (cache.graphicsResolverCacheKey !== graphicsResolver.cacheKey) {
    cache.semantic.reset();
    cache.svg = null;
    cache.text = null;
  }
  cache.graphicsResolverCacheKey = graphicsResolver.cacheKey;
  const textScope = textEngine.createRenderScope?.(cache.text);
  phases.imageAssets = performance.now() - phaseStartedAt;
  phaseStartedAt = performance.now();
  work?.signal?.throwIfAborted();
  const parseSession = cache.parse;
  const parseIncremental = parseSession.evaluate({
    source,
    sourceRevision,
    activeFigureId: activeRootId,
    includeContextDefinitions: true,
    structuralMasks: renderContext?.structuralMasks,
    patches,
    patchBaseRevision,
    changedSourceIds,
    trigger,
    inferChanges,
    nodeTextValidator: createRenderNodeTextValidator(source, textEngine)
  });
  // The parser may have rebased coalesced edits. All downstream consumers must
  // use that same transition, rather than the last queued keystroke/frame.
  if (parseIncremental.changes) {
    patches = parseIncremental.changes.patches;
    changedSourceIds = parseIncremental.changes.changedSourceIds;
  }
  phases.parse = performance.now() - phaseStartedAt;
  const parseResult = parseIncremental.parse;
  phaseStartedAt = performance.now();
  const session = cache.semantic;
  const evaluate = (input: Parameters<IncrementalSemanticSession["evaluate"]>[0]) => work
    ? session.evaluateAsync(input, { ...work, run: operation => runTextRenderOperation(textScope, operation) })
    : runTextRenderOperation(textScope, () => session.evaluate(input));
  // A parser fallback may include changes outside the supplied edit targets.
  // Rebuild semantics and SVG in that case instead of trusting narrower hints.
  if (parseIncremental.stats.strategy === "full") session.reset();
  phases.getSemanticSession = performance.now() - phaseStartedAt;
  let reusePreviousModel = cache.svg;

  phaseStartedAt = performance.now();
  let incremental = await evaluate({
    figure: parseResult.figure,
    source: parseResult.source,
    options: { ...renderContext?.evaluate, sourceFingerprint, textEngine, graphicsResolver },
    hints: {
      changedSourceIds,
      sourcePatches: patches,
      trigger
    }
  });
  work?.signal?.throwIfAborted();
  phases.semantic = performance.now() - phaseStartedAt;
  let semanticResult = incremental.semantic;
  let incrementalStats = incremental.stats;
  phaseStartedAt = performance.now();
  let affectedSourceIdsForReuse = collectSvgReuseAffectedSourceIds(
    parseResult,
    semanticResult,
    changedSourceIds,
    collectGeometryInvalidation
  );
  phases.geometryInvalidation = performance.now() - phaseStartedAt;

  phaseStartedAt = performance.now();
  let svgResult = runTextRenderOperation(textScope, () => emitSvg(semanticResult.scene, {
    ...computeSvgOptions(parseResult, renderViewBox),
    ...(renderContext && { padding: renderContext.padding }),
    textEngine,
    reuse: incrementalStats.strategy === "incremental" ? buildSvgReuseHints(reusePreviousModel, affectedSourceIdsForReuse) : undefined
  }));
  phases.emitSvg = performance.now() - phaseStartedAt;
  reusePreviousModel = svgResult.model;

  phaseStartedAt = performance.now();
  const flushedPendingTextKeys = await textEngine?.flushPending?.();
  work?.signal?.throwIfAborted();
  phases.flushText = performance.now() - phaseStartedAt;
  if (flushedPendingTextKeys && flushedPendingTextKeys.length > 0) {
    phaseStartedAt = performance.now();
    incremental = await evaluate({
      figure: parseResult.figure,
      source: parseResult.source,
      options: { ...renderContext?.evaluate, sourceFingerprint, textEngine, graphicsResolver },
      hints: {
        changedSourceIds,
        sourcePatches: patches,
        trigger
      }
    });
    work?.signal?.throwIfAborted();
    phases.semanticAfterTextFlush = performance.now() - phaseStartedAt;
    semanticResult = incremental.semantic;
    incrementalStats = incremental.stats;
    phaseStartedAt = performance.now();
    const dependencyAffectedSourceIds = collectSvgReuseAffectedSourceIds(
      parseResult,
      semanticResult,
      changedSourceIds,
      collectGeometryInvalidation
    );
    const texAffectedSourceIds = collectTexTextSourceIdsByCacheKeys(semanticResult, flushedPendingTextKeys);
    affectedSourceIdsForReuse = mergeSourceIds(dependencyAffectedSourceIds, texAffectedSourceIds);
    phases.geometryInvalidationAfterTextFlush = performance.now() - phaseStartedAt;
    phaseStartedAt = performance.now();
    svgResult = runTextRenderOperation(textScope, () => emitSvg(semanticResult.scene, {
      ...computeSvgOptions(parseResult, renderViewBox),
    ...(renderContext && { padding: renderContext.padding }),
      textEngine,
      reuse: incrementalStats.strategy === "incremental" ? buildSvgReuseHints(reusePreviousModel, affectedSourceIdsForReuse) : undefined
    }));
    phases.emitSvgAfterTextFlush = performance.now() - phaseStartedAt;
    reusePreviousModel = svgResult.model;
  }

  cache.svg = reusePreviousModel;
  retainSceneTextLayout(textScope, semanticResult.scene);
  cache.text = textScope?.layoutContext ?? textEngine.layoutContext ?? null;
  cache.warmSource = source;

  return {
    parse: parseResult,
    changedSourceIds,
    semantic: semanticResult,
    svg: svgResult,
    parseStats: parseIncremental.stats,
    semanticStats: incrementalStats,
    renderDiagnostics: [],
    phaseDurationsMs: phases,
    graphicsPreviewBundleKey: graphicsContext.previewBundle.cacheKey,
    textLayoutContext: cache.text
  };
}

function collectTexTextSourceIdsByCacheKeys(
  semanticResult: EvaluateTikzResult,
  changedCacheKeys: readonly string[]
): string[] {
  if (changedCacheKeys.length === 0) {
    return [];
  }
  const changed = new Set(changedCacheKeys);
  const sourceIds = new Set<string>();
  for (const element of semanticResult.scene.elements) {
    if (element.kind !== "Text" || element.textRenderInfo?.mode !== "tex") {
      continue;
    }
    if (!changed.has(element.textRenderInfo.cacheKey)) {
      continue;
    }
    sourceIds.add(element.sourceRef.sourceId);
  }
  return [...sourceIds].sort();
}

function mergeSourceIds(left: string[] | null, right: string[] | null): string[] | null {
  if ((!left || left.length === 0) && (!right || right.length === 0)) {
    return null;
  }
  const merged = new Set<string>();
  for (const sourceId of left ?? []) {
    merged.add(sourceId);
  }
  for (const sourceId of right ?? []) {
    merged.add(sourceId);
  }
  return [...merged].sort();
}

function collectSvgReuseAffectedSourceIds(
  parseResult: ParseTikzResult,
  semanticResult: EvaluateTikzResult,
  changedSourceIds: string[],
  collectGeometryInvalidation: (
    graph: EvaluateTikzResult["dependencies"],
    query: { changedSourceIds: readonly string[] }
  ) => { affectedSourceIds: string[]; reachedOpaque: boolean }
): string[] | null {
  const generatedDescendantSourceIds = collectGeneratedDescendantSourceIdsForChangedSources(
    semanticResult.scene.elements,
    changedSourceIds
  );
  const changedSourceIdsForInvalidation =
    generatedDescendantSourceIds.length > 0
      ? [...new Set([...changedSourceIds, ...generatedDescendantSourceIds])]
      : changedSourceIds;
  const invalidation = collectGeometryInvalidation(semanticResult.dependencies, {
    changedSourceIds: changedSourceIdsForInvalidation
  });
  if (invalidation.reachedOpaque) {
    return null;
  }
  const dependencyAffectedSourceIds = mergeSourceIds(
    invalidation.affectedSourceIds,
    generatedDescendantSourceIds
  );
  if (!dependencyAffectedSourceIds || dependencyAffectedSourceIds.length === 0) {
    return null;
  }

  const scopeDescendantSourceIds = collectNestedScopeSourceIds(parseResult.figure.body, changedSourceIds);
  const affectedStatementSourceIds = mergeSourceIds(dependencyAffectedSourceIds, scopeDescendantSourceIds) ?? dependencyAffectedSourceIds;
  return mergeSourceIds(
    mergeSourceIds(affectedStatementSourceIds, collectGeneratedDescendantSourceIdsForChangedSources(
      semanticResult.scene.elements,
      affectedStatementSourceIds
    )),
    collectNodeSourceIdsOfStatements(parseResult.figure.body, affectedStatementSourceIds)
  );
}

/**
 * Nodes on a path (`-- node {a}`, edge labels) have their own source ids, but
 * move with the statement: its line width or coordinates place them.
 */
function collectNodeSourceIdsOfStatements(statements: readonly Statement[], statementIds: readonly string[]): string[] {
  const wanted = new Set(statementIds);
  const nodeIds: string[] = [];
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as { kind?: unknown; id?: unknown };
    if (record.kind === "Node" && typeof record.id === "string") nodeIds.push(record.id);
    for (const [key, entry] of Object.entries(value)) {
      if (key !== "span" && !key.endsWith("Span")) collect(entry);
    }
  };
  const visit = (list: readonly Statement[]): void => {
    for (const statement of list) {
      if (wanted.has(statement.id)) collect(statement);
      else if (statement.kind === "Scope") visit(statement.body);
    }
  };
  visit(statements);
  return nodeIds;
}

function collectNestedScopeSourceIds(
  statements: readonly Statement[],
  changedSourceIds: readonly string[]
): string[] | null {
  if (changedSourceIds.length === 0 || statements.length === 0) {
    return null;
  }

  const changedSourceIdSet = new Set(changedSourceIds);
  const nestedSourceIds = new Set<string>();

  const collectStatementIds = (statement: Statement): void => {
    nestedSourceIds.add(statement.id);
    if (statement.kind !== "Scope") {
      return;
    }
    for (const nested of statement.body) {
      collectStatementIds(nested);
    }
  };

  const visit = (statement: Statement): void => {
    if (statement.kind !== "Scope") {
      return;
    }
    if (changedSourceIdSet.has(statement.id)) {
      collectStatementIds(statement);
      return;
    }
    for (const nested of statement.body) {
      visit(nested);
    }
  };

  for (const statement of statements) {
    visit(statement);
  }

  if (nestedSourceIds.size === 0) {
    return null;
  }
  return [...nestedSourceIds].sort();
}

function collectGeneratedDescendantSourceIdsForChangedSources(
  elements: readonly EvaluateTikzResult["scene"]["elements"][number][],
  changedSourceIds: readonly string[]
): string[] {
  if (elements.length === 0 || changedSourceIds.length === 0) {
    return [];
  }
  const changed = new Set(changedSourceIds);
  const descendants = new Set<string>();
  for (const element of elements) {
    // Generated tree paths have their own source IDs but are recomputed with
    // the authored root statement, including nested children and adornments.
    const treeChild = element.treeChild;
    if (treeChild && changed.has(treeChild.treeRootSourceId)) {
      descendants.add(element.sourceRef.sourceId);
      descendants.add(treeChild.childSourceId);
    }
    const matrixSourceId = element.matrixCell?.matrixSourceId?.trim();
    if (!matrixSourceId || !changed.has(matrixSourceId)) {
      continue;
    }
    descendants.add(element.sourceRef.sourceId);
    const cellSourceId = element.matrixCell?.cellSourceId?.trim();
    if (cellSourceId) {
      descendants.add(cellSourceId);
    }
  }
  return [...descendants];
}

function buildSvgReuseHints(
  previousModel: SvgRenderModel | null,
  affectedSourceIds: string[] | null
): EmitSvgOptions["reuse"] | undefined {
  if (!previousModel || !affectedSourceIds || affectedSourceIds.length === 0) {
    return undefined;
  }
  return {
    previousModel,
    affectedSourceIds
  };
}

function getTextEngine(): NodeTextEngine | Promise<NodeTextEngine> {
  if (resolvedTextEngine) {
    return resolvedTextEngine;
  }
  textEnginePromise ??= (async () => {
    const { createTexNodeTextEngine } = await import(
      "@tikz-editor/core/text/tex-node-text-engine"
    );
    return await createTexNodeTextEngine();
  })().then((engine) => {
    resolvedTextEngine = engine;
    return engine;
  });
  return textEnginePromise;
}

function normalizeChangedSourceIds(sourceIds: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const sourceId of sourceIds) {
    const normalized = sourceId.trim();
    if (normalized.length === 0) {
      continue;
    }
    unique.add(normalized);
  }
  return [...unique];
}

function normalizePatches(patches: readonly SourcePatch[]): SourcePatch[] {
  return patches.map((patch) => ({
    oldSpan: { ...patch.oldSpan },
    newSpan: { ...patch.newSpan },
    replacement: patch.replacement
  }));
}
