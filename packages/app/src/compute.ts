import type { Statement } from "tikz-editor/ast/types";
import {
  createIncrementalParseSession,
  type IncrementalParseSession,
  type IncrementalParseStats,
  type ParseTikzResult
} from "tikz-editor/parser/index";
import {
  collectGeometryInvalidation,
  createIncrementalSemanticSession,
  type IncrementalSemanticSession,
  type IncrementalSemanticStats,
  type IncrementalSemanticTrigger,
  type EvaluateTikzResult
} from "tikz-editor/semantic/index";
import { emitSvg, type EmitSvgOptions, type EmitSvgResult, type SvgRenderModel } from "tikz-editor/svg/index";
import type { SvgViewBox } from "tikz-editor/svg/types";
import type { EditHandle, SceneFigure } from "tikz-editor/semantic/types";
import { renderTikzToSvgAsync, type RenderDiagnostic } from "tikz-editor/render/index";
import type { NodeTextEngine } from "tikz-editor/text/types";
import type { MathJaxFont } from "tikz-editor/text/mathjax-engine";
import type { SourcePatch } from "tikz-editor/edit/types";
import { resolveFigureBoundsState } from "tikz-editor/edit/figure-bounds";
import { recordProfilingComputeTiming } from "tikz-editor/profiling";
import { buildSourceRevisionFingerprint } from "./source-identity";

/**
 * A plain-data snapshot of a fully evaluated TikZ document.
 * Structured-clone compatible — ready for Web Worker transfer.
 */
export type SessionSnapshot = {
  source: string;
  revision: number;
  figures: ParseTikzResult["figures"];
  activeFigureId: string | null;
  editHandles: EditHandle[];
  scene: SceneFigure | null;
  svg: EmitSvgResult | null;
  svgModel: SvgRenderModel | null;
  parseResult: ParseTikzResult | null;
  semanticResult: EvaluateTikzResult | null;
  incremental: SessionSnapshotIncrementalInfo | null;
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
  activeFigureId?: string | null;
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
let textEnginePromise: Promise<NodeTextEngine | null> | null = null;
let hasResolvedTextEngine = false;
let resolvedTextEngine: NodeTextEngine | null = null;

function resolveSvgPadding(source: string, activeFigureId: string | null | undefined): number {
  try {
    return resolveFigureBoundsState(source, { activeFigureId }).mode === "fixed" ? 0 : 18;
  } catch {
    return 18;
  }
}
let currentMathJaxFont: MathJaxFont = "mathjax-newcm";
let previousSvgModel: SvgRenderModel | null = null;
let incrementalWarmSource: string | null = null;

export function makeEmptySnapshot(source: string = ""): SessionSnapshot {
  return {
    source,
    revision: 0,
    figures: [],
    activeFigureId: null,
    editHandles: [],
    scene: null,
    svg: null,
    svgModel: null,
    parseResult: null,
    semanticResult: null,
    incremental: null
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
        request.activeFigureId,
        changedSourceIds,
        patches,
        request.patchBaseRevision ?? null,
        trigger,
        sourceFingerprint,
        request.renderViewBox ?? null
      );
      const snapshot: SessionSnapshot = {
        source: request.source,
        revision,
        figures: result.parse.figures,
        activeFigureId: result.parse.activeFigureId,
        editHandles: result.semantic.editHandles,
        scene: result.semantic.scene,
        svg: result.svg,
        svgModel: result.svg.model,
        parseResult: result.parse,
        semanticResult: result.semantic,
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
    const maybeTextEngine = getOptionalTextEngine();
    const textEngine = maybeTextEngine instanceof Promise ? await maybeTextEngine : maybeTextEngine;
    phases.textEngine = performance.now() - phaseStartedAt;
    phaseStartedAt = performance.now();
    const result = await renderTikzToSvgAsync(request.source, {
      parse: {
        recover: true,
        activeFigureId: request.activeFigureId,
        includeContextDefinitions: true
      },
      evaluate: { sourceFingerprint },
      svg: { padding: resolveSvgPadding(request.source, request.activeFigureId) },
      textEngine
    });
    phases.render = performance.now() - phaseStartedAt;
    // Non-drag requests currently bypass the incremental session.
    // Reset to avoid reusing stale cached prefixes on the next drag.
    incrementalSemanticSession?.reset();
    incrementalWarmSource = request.source;
    phaseStartedAt = performance.now();
    const parseSession = getIncrementalParseSession();
    parseSession.prime(result.parse, {
      activeFigureId: request.activeFigureId ?? result.parse.activeFigureId,
      includeContextDefinitions: true,
      sourceRevision: request.sourceRevision ?? null
    });
    phases.primeParse = performance.now() - phaseStartedAt;
    phaseStartedAt = performance.now();
    const semanticSession = getIncrementalSemanticSession();
    semanticSession.evaluate({
      figure: result.parse.figure,
      source: request.source,
      options: { sourceFingerprint, textEngine },
      hints: { trigger: "other" }
    });
    phases.primeSemantic = performance.now() - phaseStartedAt;
    previousSvgModel = result.svg.model;

    const snapshot: SessionSnapshot = {
      source: request.source,
      revision,
      figures: result.parse.figures,
      activeFigureId: result.parse.activeFigureId,
      editHandles: result.semantic.editHandles,
      scene: result.semantic.scene,
      svg: result.svg,
      svgModel: result.svg.model,
      parseResult: result.parse,
      semanticResult: result.semantic,
      incremental: null
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
      activeFigureId: null,
      editHandles: [],
      scene: null,
      svg: null,
      svgModel: null,
      parseResult: null,
      semanticResult: null,
      incremental: null
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

async function computeSnapshotIncremental(
  source: string,
  sourceRevision: number | null,
  activeFigureId: string | null | undefined,
  changedSourceIds: string[],
  patches: SourcePatch[],
  patchBaseRevision: number | null,
  trigger: Extract<IncrementalSemanticTrigger, "drag-element" | "drag-handle">,
  sourceFingerprint: string | undefined,
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
  const maybeTextEngine = getOptionalTextEngine();
  const textEngine = maybeTextEngine instanceof Promise ? await maybeTextEngine : maybeTextEngine;
  phases.textEngine = performance.now() - phaseStartedAt;
  phaseStartedAt = performance.now();
  const parseSession = getIncrementalParseSession();
  const parseIncremental = parseSession.evaluate({
    source,
    sourceRevision,
    activeFigureId,
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
    options: { sourceFingerprint, textEngine },
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
      options: { sourceFingerprint, textEngine },
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
    const mathJaxAffectedSourceIds = collectMathJaxTextSourceIdsByCacheKeys(semanticResult, flushedPendingTextKeys);
    affectedSourceIdsForReuse = mergeSourceIds(dependencyAffectedSourceIds, mathJaxAffectedSourceIds);
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

function collectMathJaxTextSourceIdsByCacheKeys(
  semanticResult: EvaluateTikzResult,
  changedCacheKeys: readonly string[]
): string[] {
  if (changedCacheKeys.length === 0) {
    return [];
  }
  const changed = new Set(changedCacheKeys);
  const sourceIds = new Set<string>();
  for (const element of semanticResult.scene.elements) {
    if (element.kind !== "Text" || element.textRenderInfo?.mode !== "mathjax") {
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

export function setMathJaxFont(font: MathJaxFont): void {
  if (font === currentMathJaxFont) return;
  currentMathJaxFont = font;
  textEnginePromise = null;
  hasResolvedTextEngine = false;
  resolvedTextEngine = null;
}

function getOptionalTextEngine(): NodeTextEngine | null | Promise<NodeTextEngine | null> {
  if (hasResolvedTextEngine) {
    return resolvedTextEngine;
  }
  if (!textEnginePromise) {
    const font = currentMathJaxFont;
    textEnginePromise = (async () => {
      try {
        const { createMathJaxNodeTextEngine } = await import("tikz-editor/text/mathjax-engine");
        return await createMathJaxNodeTextEngine({ font });
      } catch {
        return null;
      }
    })().then((engine) => {
      if (font === currentMathJaxFont) {
        hasResolvedTextEngine = true;
        resolvedTextEngine = engine;
      }
      return engine;
    });
  }
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
