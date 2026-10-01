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
import { emitSvg, type EmitSvgOptions, type EmitSvgResult, type SvgRenderModel } from "@tikz-editor/core/svg/index";
import type { SvgViewBox } from "@tikz-editor/core/svg/types";
import type { EditHandle, SceneFigure } from "@tikz-editor/core/semantic/types";
import { renderTikzToSvgAsync, type RenderDiagnostic } from "@tikz-editor/core/render/index";
import type { NodeTextEngine } from "@tikz-editor/core/text/types";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import { resolveFigureBoundsState } from "@tikz-editor/core/edit/figure-bounds";
import { recordProfilingComputeTiming } from "@tikz-editor/core/profiling";
import { detectDocumentKind } from "@tikz-editor/core/document/kind";
import { parseDocumentRootId, type DocumentRootRef } from "@tikz-editor/core/document/root-id";
import {
  createBeamerTexMathFontProfile,
  prepareBeamerDocument,
  resolveBeamerTheme,
  scanBeamerDocument,
  type BeamerFrameLayout,
  type PreparedBeamerDocument
} from "@tikz-editor/core/beamer/index";
import { createTexNodeTextEngine } from "@tikz-editor/core/text/tex-node-text-engine";
import type { Diagnostic } from "@tikz-editor/core/diagnostics/types";
import { prepareDocumentGraphicsContext } from "./image-asset-cache";
import { buildSourceRevisionFingerprint } from "./source-identity";
import type { DocumentFileRef } from "./store/types";

/**
 * A plain-data snapshot of a fully evaluated TikZ document.
 * Structured-clone compatible — ready for Web Worker transfer.
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
  /**
   * Identifies the path-free graphics preview bundle prepared for this
   * document revision. Thumbnail workers register the bundle separately.
   */
  graphicsPreviewBundleKey?: string | null;
  incremental: SessionSnapshotIncrementalInfo | null;
  /** Present for Beamer decks; the tikz fields above stay empty. */
  deck: DeckSnapshot | null;
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
};

export type DeckSnapshot = {
  frames: DeckFrameSummary[];
  activeFrame: DeckActiveFrame | null;
  diagnostics: Diagnostic[];
};

export type SessionSnapshotIncrementalInfo = {
  trigger: IncrementalSemanticTrigger;
  changedSourceIds: string[];
  parseStrategy: IncrementalParseStats["strategy"];
  parseFallbackReason: IncrementalParseStats["fallbackReason"];
  parsePatchApplication: IncrementalParseStats["patchApplication"];
  reparsedStatementCount: number;
  parserReusedStatementCount: number;
  strategy: IncrementalSemanticStats["strategy"];
  replayMode?: IncrementalSemanticStats["replayMode"];
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
  /** Requested overlay step for deck mode; clamped to the frame's steps. */
  deckStep?: number | null;
  changedSourceIds?: string[] | null;
  patches?: SourcePatch[] | null;
  patchBaseRevision?: number | null;
  trigger?: IncrementalSemanticTrigger;
  kind?: "render" | "prewarm";
  renderViewBox?: SvgViewBox | null;
  /**
   * Span of an active canvas text-editing session. Structure is parsed with
   * this span neutralized so momentarily-invalid TeX (unmatched braces etc.)
   * cannot reshape the document while the user types; the span's real text
   * still feeds node text rendering.
   */
  textEditMaskSpan?: { from: number; to: number } | null;
};

export type ComputeResponse = {
  /** Matches the request id. */
  id: string;
  documentId?: string;
  snapshot: SessionSnapshot;
  diagnostics: RenderDiagnostic[];
};

let revisionCounter = 0;
let incrementalSemanticSession: IncrementalSemanticSession | null = null;
let incrementalParseSession: IncrementalParseSession | null = null;
let textEnginePromise: Promise<NodeTextEngine> | null = null;
let resolvedTextEngine: NodeTextEngine | null = null;

function resolveSvgPadding(source: string, activeRootId: string | null | undefined): number {
  try {
    return resolveFigureBoundsState(source, { activeFigureId: activeRootId }).mode === "fixed" ? 0 : 18;
  } catch {
    return 18;
  }
}
let previousSvgModel: SvgRenderModel | null = null;
let incrementalWarmSource: string | null = null;

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
    graphicsPreviewBundleKey: null,
    incremental: null,
    deck: null
  };
}

/**
 * Compute a full SessionSnapshot for the given source.
 * Phase 0: synchronous implementation wrapped in a Promise.
 * The interface is designed so a Web Worker can be swapped in later.
 */
export async function computeSnapshot(request: ComputeRequest): Promise<ComputeResponse> {
  const revision = ++revisionCounter;
  const requestKind = request.kind ?? "render";
  const computeStartedAt = performance.now();

  try {
    if (detectDocumentKind(request.source) === "beamer") {
      const rootRef = request.activeRootId
        ? parseDocumentRootId(request.activeRootId)
        : null;
      if (rootRef?.kind === "beamer-frame-tikz") {
        const nested = await computeNestedTikzSnapshot(
          request,
          revision,
          requestKind,
          computeStartedAt,
          rootRef
        );
        if (nested) {
          return nested;
        }
        // The addressed picture no longer exists (edited away): fall back
        // to the deck so the app can recover to the owning frame.
      }
      return await computeDeckSnapshot(request, revision, requestKind, computeStartedAt);
    }
    const trigger = request.trigger ?? "other";
    const changedSourceIds = normalizeChangedSourceIds(request.changedSourceIds ?? []);
    const patches = normalizePatches(request.patches ?? []);
    const sourceFingerprint = buildSourceRevisionFingerprint({
      documentId: request.documentId,
      sourceRevision: request.sourceRevision,
      sourceLength: request.source.length
    });
    if (requestKind === "prewarm" && incrementalWarmSource === request.source) {
      return {
        id: request.id,
        documentId: request.documentId,
        snapshot: makeEmptySnapshot(request.source),
        diagnostics: []
      };
    }
    if (changedSourceIds.length > 0) {
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
        request.renderViewBox ?? null
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
        graphicsPreviewBundleKey: result.graphicsPreviewBundleKey,
        deck: null,
        incremental: {
          trigger,
          changedSourceIds,
          parseStrategy: result.parseStats.strategy,
          parseFallbackReason: result.parseStats.fallbackReason,
          parsePatchApplication: result.parseStats.patchApplication,
          reparsedStatementCount: result.parseStats.reparsedStatementCount,
          parserReusedStatementCount: result.parseStats.reusedStatementCount,
          strategy: result.semanticStats.strategy,
          replayMode: result.semanticStats.replayMode,
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
        trigger,
        durationMs: performance.now() - computeStartedAt,
        changedSourceCount: changedSourceIds.length,
        incremental: true,
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
    const maybeTextEngine = getTextEngine();
    const textEngine = maybeTextEngine instanceof Promise ? await maybeTextEngine : maybeTextEngine;
    phases.textEngine = performance.now() - phaseStartedAt;
    // Full renders also seed the incremental cache. Route their one semantic
    // evaluation through the session instead of evaluating again after render.
    incrementalSemanticSession?.reset();
    const semanticSession = getIncrementalSemanticSession();
    phaseStartedAt = performance.now();
    const graphicsContext = await prepareDocumentGraphicsContext({
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
      evaluate: { sourceFingerprint, graphicsResolver },
      semanticEvaluator: (figure, source, options) =>
        semanticSession.evaluate({
          figure,
          source,
          options,
          hints: { trigger: "other" }
        }).semantic,
      svg: { padding: resolveSvgPadding(request.source, request.activeRootId) },
      textEngine
    });
    phases.render = performance.now() - phaseStartedAt;
    incrementalWarmSource = request.source;
    phaseStartedAt = performance.now();
    if (!textEditMaskSpan) {
      // A masked parse must not seed the drag-incremental cache; the session
      // ending clears the mask and triggers an unmasked render that primes.
      const parseSession = getIncrementalParseSession();
      parseSession.prime(result.parse, {
        activeFigureId: request.activeRootId ?? result.parse.activeFigureId,
        includeContextDefinitions: true,
        sourceRevision: request.sourceRevision ?? null
      });
    }
    phases.primeParse = performance.now() - phaseStartedAt;
    previousSvgModel = result.svg.model;

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
      graphicsPreviewBundleKey: graphicsContext.previewBundle.cacheKey,
      incremental: null,
      deck: null
    };
    recordProfilingComputeTiming({
      requestId: request.id,
      kind: requestKind,
      trigger,
      durationMs: performance.now() - computeStartedAt,
      changedSourceCount: changedSourceIds.length,
      incremental: false,
      phaseDurationsMs: phases
    });

    return {
      id: request.id,
      documentId: request.documentId,
      snapshot,
      diagnostics: result.renderDiagnostics
    };
  } catch (error) {
    incrementalSemanticSession?.reset();
    incrementalParseSession?.reset();
    incrementalWarmSource = null;
    previousSvgModel = null;
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
  source: string;
  sourceRevision: number | null;
  resolverCacheKey: string;
  structuralMaskKey: string;
  prepared: PreparedBeamerDocument;
  frames: DeckFrameSummary[];
  renderedPages: Map<string, DeckActiveFrame>;
};

let deckComputeSession: DeckComputeSession | null = null;

/**
 * Beamer's paragraph reports retain font resolvers used while laying out the
 * page. The active-frame snapshot only publishes the resulting geometry, so
 * omit those executable helpers at the worker boundary while preserving the
 * report/vlist data consumed by canvas hit testing.
 */
function makeBeamerLayoutCloneSafe(layout: BeamerFrameLayout): BeamerFrameLayout {
  const copies = new WeakMap<object, object>();

  const copy = (value: unknown): unknown => {
    if (typeof value === "function" || typeof value === "symbol") {
      return undefined;
    }
    if (value === null || typeof value !== "object") {
      return value;
    }
    const cached = copies.get(value);
    if (cached) {
      return cached;
    }
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      copies.set(value, result);
      for (const entry of value) {
        result.push(copy(entry));
      }
      return result;
    }
    const result: Record<string, unknown> = {};
    copies.set(value, result);
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry !== "function" && typeof entry !== "symbol") {
        result[key] = copy(entry);
      }
    }
    return result;
  };

  return copy(layout) as BeamerFrameLayout;
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
  computeStartedAt: number
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
  const graphicsContext = await prepareDocumentGraphicsContext({
    source: request.source,
    documentFileRef: request.documentFileRef ?? null
  });
  const graphicsResolver = graphicsContext.resolver;
  const structuralMask = request.textEditMaskSpan ?? null;
  const structuralMaskKey = structuralMask
    ? `${structuralMask.from}:${structuralMask.to}`
    : "";
  if (
    deckComputeSession?.source !== request.source ||
    deckComputeSession.resolverCacheKey !== graphicsResolver.cacheKey ||
    deckComputeSession.structuralMaskKey !== structuralMaskKey
  ) {
    const previousPrepared = deckComputeSession?.prepared;
    const canIncrementallyParse =
      request.patches != null &&
      request.patches.length > 0 &&
      request.patchBaseRevision != null &&
      deckComputeSession?.sourceRevision === request.patchBaseRevision;
    const prepared = prepareBeamerDocument(request.source, {
      structuralMasks: structuralMask ? [structuralMask] : undefined,
      previousSyntaxTree:
        canIncrementallyParse && previousPrepared
          ? previousPrepared.syntaxTree
          : undefined,
      syntaxPatches: canIncrementallyParse
        ? request.patches ?? undefined
        : undefined
    });
    deckComputeSession = {
      source: request.source,
      sourceRevision: request.sourceRevision ?? null,
      resolverCacheKey: graphicsResolver.cacheKey,
      structuralMaskKey,
      prepared,
      frames: prepared.document.frames.map((frame, frameIndex) => ({
        id: frame.id,
        frameIndex,
        span: { from: frame.span.from, to: frame.span.to },
        title: frame.title?.value ?? null,
        stepCount: prepared.frameStepCount(frameIndex)
      })),
      renderedPages: new Map()
    };
  }
  const session = deckComputeSession;
  const frameIndex = resolveDeckFrameIndex(session.frames, request.activeRootId);
  let activeFrame: DeckActiveFrame | null = null;
  if (frameIndex != null) {
    const stepCount = session.frames[frameIndex].stepCount;
    const step = Math.min(Math.max(1, request.deckStep ?? 1), Math.max(1, stepCount));
    const pageKey = `${frameIndex}:${step}`;
    const cached = session.renderedPages.get(pageKey);
    if (cached) {
      activeFrame = cached;
    } else {
      const result = await session.prepared.renderFrame({
        frameIndex,
        step,
        graphicsResolver
      });
      activeFrame = {
        frameId: result.frame.id,
        frameIndex,
        step,
        stepCount: result.layout.stepCount,
        svg: result.svg.svg,
        svgModel: result.svg.model,
        viewBox: result.svg.viewBox,
        layout: makeBeamerLayoutCloneSafe(result.layout)
      };
      session.renderedPages.set(pageKey, activeFrame);
    }
  }

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
    graphicsPreviewBundleKey: graphicsContext.previewBundle.cacheKey,
    incremental: null,
    deck: {
      frames: session.frames,
      activeFrame,
      diagnostics: session.prepared.document.diagnostics
    }
  };
  recordProfilingComputeTiming({
    requestId: request.id,
    kind: requestKind,
    trigger: request.trigger ?? "other",
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

function maskSourceOutsideSpan(source: string, span: { from: number; to: number }): string {
  const blank = (text: string): string => text.replace(/[^\n]/gu, " ");
  return (
    blank(source.slice(0, span.from)) +
    source.slice(span.from, span.to) +
    blank(source.slice(span.to))
  );
}

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
 * Known v1 limits (doc, "Preamble context"): preamble definitions are
 * masked (undefined styles/colors surface as diagnostics), text renders
 * with the default text family rather than the theme's, and drags take
 * the full-render path (no incremental session).
 */
async function computeNestedTikzSnapshot(
  request: ComputeRequest,
  revision: number,
  requestKind: "render" | "prewarm",
  computeStartedAt: number,
  ref: Extract<DocumentRootRef, { kind: "beamer-frame-tikz" }>
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
  const masked = maskSourceOutsideSpan(request.source, picture.span);
  const result = await renderTikzToSvgAsync(masked, {
    parse: { recover: true, includeContextDefinitions: true },
    evaluate: { graphicsResolver: graphicsContext.resolver },
    svg: { padding: resolveSvgPadding(masked, null) },
    textEngine
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
    graphicsPreviewBundleKey: graphicsContext.previewBundle.cacheKey,
    incremental: null,
    deck: null
  };
  recordProfilingComputeTiming({
    requestId: request.id,
    kind: requestKind,
    trigger: request.trigger ?? "other",
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
  renderViewBox: SvgViewBox | null
): Promise<{
  parse: ParseTikzResult;
  semantic: EvaluateTikzResult;
  svg: EmitSvgResult;
  parseStats: IncrementalParseStats;
  semanticStats: IncrementalSemanticStats;
  renderDiagnostics: RenderDiagnostic[];
  phaseDurationsMs: Record<string, number>;
  graphicsPreviewBundleKey: string;
}> {
  const phases: Record<string, number> = {};
  let phaseStartedAt = performance.now();
  const maybeTextEngine = getTextEngine();
  const textEngine = maybeTextEngine instanceof Promise ? await maybeTextEngine : maybeTextEngine;
  phases.textEngine = performance.now() - phaseStartedAt;
  phaseStartedAt = performance.now();
  const graphicsContext = await prepareDocumentGraphicsContext({
    source,
    documentFileRef
  });
  const graphicsResolver = graphicsContext.resolver;
  phases.imageAssets = performance.now() - phaseStartedAt;
  phaseStartedAt = performance.now();
  const parseSession = getIncrementalParseSession();
  const parseIncremental = parseSession.evaluate({
    source,
    sourceRevision,
    activeFigureId: activeRootId,
    includeContextDefinitions: true,
    patches,
    patchBaseRevision,
    changedSourceIds,
    trigger
  });
  phases.parse = performance.now() - phaseStartedAt;
  const parseResult = parseIncremental.parse;
  const svgPadding = resolveSvgPadding(parseResult.source, parseResult.activeFigureId);
  phaseStartedAt = performance.now();
  const session = getIncrementalSemanticSession();
  // A parser fallback may include changes outside the supplied edit targets.
  // Rebuild semantics and SVG in that case instead of trusting narrower hints.
  if (parseIncremental.stats.strategy === "full") session.reset();
  phases.getSemanticSession = performance.now() - phaseStartedAt;
  let reusePreviousModel = previousSvgModel;

  phaseStartedAt = performance.now();
  let incremental = session.evaluate({
    figure: parseResult.figure,
    source: parseResult.source,
    options: { sourceFingerprint, textEngine, graphicsResolver },
    hints: {
      changedSourceIds,
      sourcePatches: patches,
      trigger
    }
  });
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
  let svgResult = emitSvg(semanticResult.scene, {
    padding: svgPadding,
    textEngine,
    viewBox: renderViewBox ?? undefined,
    reuse: incrementalStats.strategy === "incremental" ? buildSvgReuseHints(reusePreviousModel, affectedSourceIdsForReuse) : undefined
  });
  phases.emitSvg = performance.now() - phaseStartedAt;
  reusePreviousModel = svgResult.model;

  phaseStartedAt = performance.now();
  const flushedPendingTextKeys = await textEngine?.flushPending?.();
  phases.flushText = performance.now() - phaseStartedAt;
  if (flushedPendingTextKeys && flushedPendingTextKeys.length > 0) {
    phaseStartedAt = performance.now();
    incremental = session.evaluate({
      figure: parseResult.figure,
      source: parseResult.source,
      options: { sourceFingerprint, textEngine, graphicsResolver },
      hints: {
        changedSourceIds,
        sourcePatches: patches,
        trigger
      }
    });
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
    svgResult = emitSvg(semanticResult.scene, {
      padding: svgPadding,
      textEngine,
      viewBox: renderViewBox ?? undefined,
      reuse: incrementalStats.strategy === "incremental" ? buildSvgReuseHints(reusePreviousModel, affectedSourceIdsForReuse) : undefined
    });
    phases.emitSvgAfterTextFlush = performance.now() - phaseStartedAt;
    reusePreviousModel = svgResult.model;
  }

  previousSvgModel = reusePreviousModel;
  incrementalWarmSource = source;

  return {
    parse: parseResult,
    semantic: semanticResult,
    svg: svgResult,
    parseStats: parseIncremental.stats,
    semanticStats: incrementalStats,
    renderDiagnostics: [],
    phaseDurationsMs: phases,
    graphicsPreviewBundleKey: graphicsContext.previewBundle.cacheKey
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
  const matrixDescendantSourceIds = collectMatrixDescendantSourceIdsForChangedSources(
    semanticResult.scene.elements,
    changedSourceIds
  );
  const changedSourceIdsForInvalidation =
    matrixDescendantSourceIds.length > 0
      ? [...new Set([...changedSourceIds, ...matrixDescendantSourceIds])]
      : changedSourceIds;
  const invalidation = collectGeometryInvalidation(semanticResult.dependencies, {
    changedSourceIds: changedSourceIdsForInvalidation
  });
  if (invalidation.reachedOpaque) {
    return null;
  }
  const dependencyAffectedSourceIds = mergeSourceIds(
    invalidation.affectedSourceIds,
    matrixDescendantSourceIds
  );
  if (!dependencyAffectedSourceIds || dependencyAffectedSourceIds.length === 0) {
    return null;
  }

  const scopeDescendantSourceIds = collectNestedScopeSourceIds(parseResult.figure.body, changedSourceIds);
  return mergeSourceIds(dependencyAffectedSourceIds, scopeDescendantSourceIds);
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

function collectMatrixDescendantSourceIdsForChangedSources(
  elements: readonly EvaluateTikzResult["scene"]["elements"][number][],
  changedSourceIds: readonly string[]
): string[] {
  if (elements.length === 0 || changedSourceIds.length === 0) {
    return [];
  }
  const changed = new Set(changedSourceIds);
  const descendants = new Set<string>();
  for (const element of elements) {
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

function getIncrementalSemanticSession(): IncrementalSemanticSession {
  if (incrementalSemanticSession) {
    return incrementalSemanticSession;
  }
  incrementalSemanticSession = createIncrementalSemanticSession();
  return incrementalSemanticSession;
}

function getIncrementalParseSession(): IncrementalParseSession {
  if (incrementalParseSession) {
    return incrementalParseSession;
  }
  incrementalParseSession = createIncrementalParseSession();
  return incrementalParseSession;
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
