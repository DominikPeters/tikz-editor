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
import {
  detectDocumentKind,
  parseDocumentRootId,
  prepareBeamerDocument
} from "@tikz-editor/core";
import type { PreparedBeamerDocument } from "@tikz-editor/core/beamer/index";
import type { Diagnostic } from "@tikz-editor/core/diagnostics/types";
import { prepareDocumentGraphicsResolver } from "./image-asset-cache";
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
};

export type DeckSnapshot = {
  frames: DeckFrameSummary[];
  activeFrame: DeckActiveFrame | null;
  diagnostics: Diagnostic[];
};

export type SessionSnapshotIncrementalInfo = {
  trigger: Extract<IncrementalSemanticTrigger, "drag-element" | "drag-handle">;
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
      return await computeDeckSnapshot(request, revision, requestKind, computeStartedAt);
    }
    const trigger = request.trigger ?? "other";
    const changedSourceIds = normalizeChangedSourceIds(request.changedSourceIds ?? []);
    const patches = normalizePatches(request.patches ?? []);
    const isDragTrigger = trigger === "drag-element" || trigger === "drag-handle";
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
    if (isDragTrigger && changedSourceIds.length > 0) {
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
    const graphicsResolver = await prepareDocumentGraphicsResolver({
      source: request.source,
      documentFileRef: request.documentFileRef ?? null
    });
    phases.imageAssets = performance.now() - phaseStartedAt;
    phaseStartedAt = performance.now();
    const result = await renderTikzToSvgAsync(request.source, {
      parse: {
        recover: true,
        activeFigureId: request.activeRootId,
        includeContextDefinitions: true
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
    const parseSession = getIncrementalParseSession();
    parseSession.prime(result.parse, {
      activeFigureId: request.activeRootId ?? result.parse.activeFigureId,
      includeContextDefinitions: true,
      sourceRevision: request.sourceRevision ?? null
    });
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
  resolverCacheKey: string;
  prepared: PreparedBeamerDocument;
  frames: DeckFrameSummary[];
  renderedPages: Map<string, DeckActiveFrame>;
};

let deckComputeSession: DeckComputeSession | null = null;

function resolveDeckFrameIndex(
  frames: readonly DeckFrameSummary[],
  activeRootId: string | null | undefined
): number | null {
  if (frames.length === 0) {
    return null;
  }
  const ref = activeRootId != null ? parseDocumentRootId(activeRootId) : null;
  const requested =
    ref?.kind === "beamer-frame" || ref?.kind === "beamer-frame-tikz"
      ? ref.kind === "beamer-frame"
        ? ref.index
        : ref.frameIndex
      : null;
  // Unknown or absent selections fall back to the first frame, mirroring
  // the tikz parse-window default.
  return requested != null && requested >= 0 && requested < frames.length
    ? requested
    : 0;
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
  const graphicsResolver = await prepareDocumentGraphicsResolver({
    source: request.source,
    documentFileRef: request.documentFileRef ?? null
  });
  if (
    deckComputeSession?.source !== request.source ||
    deckComputeSession.resolverCacheKey !== graphicsResolver.cacheKey
  ) {
    const prepared = prepareBeamerDocument(request.source);
    deckComputeSession = {
      source: request.source,
      resolverCacheKey: graphicsResolver.cacheKey,
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
        viewBox: result.svg.viewBox
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

async function computeSnapshotIncremental(
  source: string,
  sourceRevision: number | null,
  activeRootId: string | null | undefined,
  changedSourceIds: string[],
  patches: SourcePatch[],
  patchBaseRevision: number | null,
  trigger: Extract<IncrementalSemanticTrigger, "drag-element" | "drag-handle">,
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
}> {
  const phases: Record<string, number> = {};
  let phaseStartedAt = performance.now();
  const maybeTextEngine = getTextEngine();
  const textEngine = maybeTextEngine instanceof Promise ? await maybeTextEngine : maybeTextEngine;
  phases.textEngine = performance.now() - phaseStartedAt;
  phaseStartedAt = performance.now();
  const graphicsResolver = await prepareDocumentGraphicsResolver({
    source,
    documentFileRef
  });
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
    reuse: buildSvgReuseHints(reusePreviousModel, affectedSourceIdsForReuse)
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
      reuse: buildSvgReuseHints(reusePreviousModel, affectedSourceIdsForReuse)
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
    phaseDurationsMs: phases
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
