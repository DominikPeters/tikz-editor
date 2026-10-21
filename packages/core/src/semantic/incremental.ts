import { requireDefined } from "../utils/invariants.js";
import { requireArrayValue } from "../utils/collections.js";
import { finishWork, runCooperatively, type CooperativeWorkOptions } from "./cooperative-work.js";
import type { Span, TikzFigure } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import {
  applyStatementEffectSummary,
  listContextRequiredLibraries,
  listContextSymbolDependencyEdges,
  listContextUnresolvedSymbols,
  currentFrame,
  extendPictureBounds,
  requireContextLibrary,
  restoreSemanticContext,
  retargetEditHandlesSourceFingerprint,
  snapshotSemanticContext,
  type ProvenanceOptionList,
  type SemanticContextFrame,
  type SemanticContextSnapshot,
  type SemanticStatementEffectSummary
} from "./context.js";
import type { StyleChainEntry, StyleSourceRef } from "./style-chain.js";
import { collectGeometryInvalidation, replaceSourceDependencies } from "./dependencies.js";
import { restoreSemanticSymbolUses, type SemanticSymbolResolver, type SemanticSymbolResolverState } from "./symbol-resolver.js";
import {
  collectNodeAnchorTargets,
  computeBounds,
  createSemanticEvaluationRun,
  evaluateSemanticStatementByIndex,
  finalizeSemanticEvaluationRun,
  markOpaqueDependencySources,
  rememberGeometryCheckpoints,
  type EvaluateTikzResult
} from "./evaluate.js";
import { inferRequiredTikzLibraries } from "./required-tikz-libraries.js";
import { captureSiteContext, type StatementEntryContext } from "./site-context.js";
import { mergeFeatureUsage } from "./feature-usage.js";
import type {
  EditHandle,
  EvaluateOptions,
  FeatureUsage,
  SceneElement,
  SceneFigure
} from "./types.js";
import { MAIN_SCENE_LAYER } from "./types.js";
import type { SourcePatch } from "../edit/types.js";
import type { WorldBounds } from "../coords/points.js";
import { documentDiffPatch } from "../edit/patch.js";
import { patchesMatchSourceTransition } from "../edit/source-patches.js";
import { createSceneSourceBinder, createSourceSpanResolver, sceneSourceExtent } from "./source-bindings.js";

export type IncrementalSemanticTrigger = "drag-element" | "drag-handle" | "other";
export type IncrementalSemanticReplayMode = "full" | "suffix" | "selective";
export type IncrementalSemanticCheckpointPreparation =
  | "captured-during-evaluation"
  | "reused";

export type IncrementalSemanticHints = {
  changedSourceIds?: readonly string[];
  sourcePatches?: readonly {
    oldSpan?: Span;
    newSpan?: Span;
    replacement: string;
  }[];
  trigger?: IncrementalSemanticTrigger;
};

export type IncrementalSemanticFallbackReason =
  | "missing-changed-source-ids"
  | "no-previous-cache"
  | "statement-structure-changed"
  | "stateful-graphics-state"
  | "opaque-dependency"
  | "unmapped-affected-source"
  | "checkpoint-missing"
  | "feature-checkpoint-missing"
  | "restore-failed"
  | "selective-replay-error"
  | "runtime-error";

export type IncrementalSemanticStats = {
  strategy: "full" | "incremental";
  replayMode?: IncrementalSemanticReplayMode;
  recomputeFromStatementIndex: number | null;
  recomputedStatementCount: number;
  reusedStatementCount: number;
  corridorEndStatementIndex?: number | null;
  affectedStatementCount?: number;
  fallbackReason?: IncrementalSemanticFallbackReason;
  checkpointPreparation?: IncrementalSemanticCheckpointPreparation;
  checkpointCount?: number;
  /** Whether a selective replay applied the reused statements' effects one by one, or took the previous run's state after them. */
  suffixReplay?: "replayed" | "skipped";
};

export type IncrementalSemanticEvaluateInput = {
  figure: TikzFigure;
  source: string;
  options?: EvaluateOptions;
  hints?: IncrementalSemanticHints;
};

export type IncrementalSemanticEvaluateResult = {
  semantic: EvaluateTikzResult;
  stats: IncrementalSemanticStats;
  /**
   * The statements the previous run's dependencies tied to the changed ones,
   * for an incremental run. A statement that stops depending on a changed one
   * (its node renamed away from the reference) is tied to it only there.
   */
  invalidatedSourceIds?: readonly string[];
};

export type IncrementalSemanticSession = {
  evaluate: (input: IncrementalSemanticEvaluateInput) => IncrementalSemanticEvaluateResult;
  evaluateAsync: (input: IncrementalSemanticEvaluateInput, work: CooperativeWorkOptions) => Promise<IncrementalSemanticEvaluateResult>;
  fork: () => IncrementalSemanticSession;
  reset: () => void;
};

type SemanticStatementFragment = {
  statementId: string;
  sourceId: string;
  sourceSpan: Span;
  sourceFingerprint: string;
  elements: SceneElement[];
  editHandles: EditHandle[];
  diagnostics: Diagnostic[];
  effectSummary: SemanticStatementEffectSummary;
  featureUsage: FeatureUsage;
  /** The random number generator's seed after the statement, which a replay of its effects does not advance. */
  mathRandomSeed: number;
  /** Holds every source location in the elements and diagnostics: while it stands, they stand. */
  sourceExtent: Span;
  /** Valid exactly as long as the reused elements are: both depend on the state the statement starts from. */
  entryContext: StatementEntryContext;
};

type CapturedSemanticCheckpoints = {
  kind: "captured";
  checkpointsBeforeStatement: Map<number, SemanticContextSnapshot>;
};

type SemanticCheckpointCache = CapturedSemanticCheckpoints;

type CachedSemanticRun = {
  source: string;
  containsStatefulGraphicsState: boolean;
  statementIds: string[];
  statementFragments: SemanticStatementFragment[];
  editHandles: readonly EditHandle[];
  checkpointInterval: number;
  checkpointCache: SemanticCheckpointCache;
  dependencies: EvaluateTikzResult["dependencies"];
  sourceStatementFirstIndexBySourceId: Map<string, number>;
  nodeAnchorTargets: EvaluateTikzResult["nodeAnchorTargets"];
};

type SelectiveReplayPlan = {
  restoreIndex: number;
  corridorEndIndex: number;
  affectedStatementCount: number;
};

const DEFAULT_CHECKPOINT_INTERVAL = 8;

export function createIncrementalSemanticSession(
  defaultOptions: EvaluateOptions = {}
): IncrementalSemanticSession {
  return createSession(defaultOptions, null);
}

function createSession(defaultOptions: EvaluateOptions, initial: CachedSemanticRun | null): IncrementalSemanticSession {
  let cached = initial;
  let version = 0;

  function* evaluate(input: IncrementalSemanticEvaluateInput): Generator<void, IncrementalSemanticEvaluateResult, void> {
    const runVersion = ++version;
    const options: EvaluateOptions = {
      ...defaultOptions,
      ...input.options
    };
    const run = createSemanticEvaluationRun(input.figure, input.source, options);
    const statementCount = run.expandedFigureBody.length;
    const statementIds = run.expandedFigureBody.map((statement) => statement.id);
    const hints = input.hints ?? {};
    const statefulGraphicsState = resolveContainsStatefulGraphicsState(input.source, hints, cached, input.figure);

    if (statefulGraphicsState) {
      const full = yield* evaluateFullyAndCache(
        run,
        statementIds,
        "stateful-graphics-state"
      );
      if (version === runVersion) cached = full.cached;
      return full.output;
    }

    const fallback = decideFallbackReason(hints, cached, statementIds);
    // Only text around the picture changed: every evaluated statement stands,
    // moved. Restore the end of the last run and rebind it to the new source.
    const moved = fallback === "missing-changed-source-ids" && cached ? movedOnlyPatches(cached, run, input, statementIds) : null;
    const endCheckpoint = moved && cached?.checkpointCache.checkpointsBeforeStatement.get(statementCount);
    if (moved && endCheckpoint) {
      try {
        const shifted = yield* evaluateIncrementalSuffix({
          run,
          previous: requireDefined(cached, "Expected an internal incremental value"),
          resolveSpan: createSourceSpanResolver(moved),
          statementIds,
          restoreIndex: statementCount,
          checkpointInterval: requireDefined(cached, "Expected an internal incremental value").checkpointInterval,
          previousCheckpoints: requireDefined(cached, "Expected an internal incremental value").checkpointCache,
          startCheckpoint: endCheckpoint,
          affectedStatementCount: 0,
          checkpointPreparation: "reused"
        });
        if (version === runVersion) cached = shifted.cached;
        return shifted.output;
      } catch {
        // Evaluate in full below.
      }
    }
    if (fallback) {
      const full = yield* evaluateFullyAndCache(
        run,
        statementIds,
        fallback
      );
      if (version === runVersion) cached = full.cached;
      return full.output;
    }

    const previous = requireDefined(cached, "Expected an internal incremental value");
    const suppliedPatches = hints.sourcePatches;
    const patches = suppliedPatches?.every((patch): patch is SourcePatch => patch.oldSpan !== undefined && patch.newSpan !== undefined) &&
      patchesMatchSourceTransition(previous.source, run.source, suppliedPatches)
      ? suppliedPatches : [documentDiffPatch(previous.source, run.source)];
    const resolveSpan = createSourceSpanResolver(patches);

    const changedSourceIds = normalizeChangedSourceIds(hints.changedSourceIds ?? []);
    // Children inherit a changed scope's options. Include their resource users
    // in invalidation too, including paths outside the scope that use its nodes.
    for (const sourceId of changedSourceIds.slice()) {
      const index = previous.sourceStatementFirstIndexBySourceId.get(sourceId);
      if (index == null || run.scopeSteps.get(requireArrayValue(run.expandedFigureBody, index)) !== "enter") continue;
      const scopeId = requireArrayValue(run.expandedFigureBody, index).id;
      for (let i = index + 1; i < statementCount; i++) {
        if (requireArrayValue(run.expandedFigureBody, i).id === `${scopeId}:leave`) break;
        changedSourceIds.push(requireArrayValue(previous.statementFragments, i).sourceId);
      }
    }
    const invalidation = collectGeometryInvalidation(previous.dependencies, {
      changedSourceIds
    });
    if (invalidation.reachedOpaque) {
      const full = yield* evaluateFullyAndCache(
        run,
        statementIds,
        "opaque-dependency"
      );
      if (version === runVersion) cached = full.cached;
      return full.output;
    }

    const affectedStatementIndices = invalidation.affectedSourceIds
      .map((sourceId) => previous.sourceStatementFirstIndexBySourceId.get(sourceId) ?? null)
      .filter((index): index is number => index != null && index >= 0 && index < statementCount);
    // Changing scope options or their dependencies affects every statement in
    // the scope, even when those statements consume no named resources directly.
    for (const index of affectedStatementIndices.slice()) {
      const statement = requireArrayValue(run.expandedFigureBody, index);
      if (run.scopeSteps.get(statement) !== "enter") continue;
      const end = run.expandedFigureBody.findIndex((candidate, i) => i > index && candidate.id === `${statement.id}:leave`);
      for (let i = index + 1; i <= end; i++) affectedStatementIndices.push(i);
    }
    if (affectedStatementIndices.length === 0) {
      const full = yield* evaluateFullyAndCache(
        run,
        statementIds,
        "unmapped-affected-source"
      );
      if (version === runVersion) cached = full.cached;
      return full.output;
    }

    const checkpointInterval = previous.checkpointInterval;
    const checkpointPreparation = "reused" as const;
    const preparedCheckpoints = previous.checkpointCache;
    const earliestAffectedIndex = Math.min(...affectedStatementIndices);
    const restoreIndex = findCheckpointIndexAtOrBefore(
      preparedCheckpoints.checkpointsBeforeStatement,
      earliestAffectedIndex
    );
    if (restoreIndex == null) {
      const full = yield* evaluateFullyAndCache(
        run,
        statementIds,
        "checkpoint-missing"
      );
      if (version === runVersion) cached = full.cached;
      return full.output;
    }

    const startCheckpoint = requireDefined(preparedCheckpoints.checkpointsBeforeStatement.get(restoreIndex), "Expected an internal incremental value");

    const selectivePlan = planSelectiveReplay(previous.statementFragments, restoreIndex, affectedStatementIndices);
    if (selectivePlan) {
      try {
        const selective = yield* evaluateSelectively({
          run,
          previous,
          resolveSpan,
          statementIds,
          restoreIndex,
          corridorEndIndex: selectivePlan.corridorEndIndex,
          affectedStatementCount: selectivePlan.affectedStatementCount,
          checkpointInterval,
          previousCheckpoints: preparedCheckpoints,
          startCheckpoint,
          checkpointPreparation
        });
        if (version === runVersion) cached = selective.cached;
        return { ...selective.output, invalidatedSourceIds: invalidation.affectedSourceIds };
      } catch {
        try {
          const suffix = yield* evaluateIncrementalSuffix({
            run: createSemanticEvaluationRun(input.figure, input.source, options),
            previous,
            resolveSpan,
            statementIds,
            restoreIndex,
            checkpointInterval,
            previousCheckpoints: preparedCheckpoints,
            startCheckpoint,
            affectedStatementCount: new Set(affectedStatementIndices).size,
            fallbackReason: "selective-replay-error",
            checkpointPreparation
          });
          if (version === runVersion) cached = suffix.cached;
          return { ...suffix.output, invalidatedSourceIds: invalidation.affectedSourceIds };
        } catch {
          const full = yield* evaluateFullyAndCache(
            createSemanticEvaluationRun(input.figure, input.source, options),
            statementIds,
            "runtime-error"
          );
          if (version === runVersion) cached = full.cached;
          return full.output;
        }
      }
    }

    try {
      const suffix = yield* evaluateIncrementalSuffix({
        run,
        previous,
        resolveSpan,
        statementIds,
        restoreIndex,
        checkpointInterval,
        previousCheckpoints: preparedCheckpoints,
        startCheckpoint,
        affectedStatementCount: new Set(affectedStatementIndices).size,
        checkpointPreparation
      });
      if (version === runVersion) cached = suffix.cached;
      return { ...suffix.output, invalidatedSourceIds: invalidation.affectedSourceIds };
    } catch {
      const full = yield* evaluateFullyAndCache(
        createSemanticEvaluationRun(input.figure, input.source, options),
        statementIds,
        "runtime-error"
      );
      if (version === runVersion) cached = full.cached;
      return full.output;
    }
  };

  return {
    evaluate: input => finishWork(evaluate(input)),
    evaluateAsync: (input, work) => runCooperatively(evaluate(input), work),
    fork: () => createSession(defaultOptions, cached),
    reset: () => {
      version++;
      cached = null;
    }
  };
}

function* evaluateFullyAndCache(
  run: ReturnType<typeof createSemanticEvaluationRun>,
  statementIds: string[],
  fallbackReason: IncrementalSemanticFallbackReason
): Generator<void, {
  output: IncrementalSemanticEvaluateResult;
  cached: CachedSemanticRun;
}, void> {
  const statementCount = run.expandedFigureBody.length;
  const checkpointInterval = Math.max(DEFAULT_CHECKPOINT_INTERVAL, Math.ceil(statementCount / 128));
  const statementFragments: SemanticStatementFragment[] = [];
  const checkpointsBeforeStatement = new Map<number, SemanticContextSnapshot>();
  run.captureGeometryCheckpoints = false;
  run.geometryCheckpoints = checkpointsBeforeStatement;

  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    if (shouldCaptureCheckpoint(statementIndex, checkpointInterval)) {
      checkpointsBeforeStatement.set(
        statementIndex,
        snapshotSemanticContext(run.context, { editHandlesMode: "length" })
      );
    }
    const evaluated = evaluateSemanticStatementByIndex(run, statementIndex);
    statementFragments.push(createStatementFragment(evaluated, run.context));
    yield;
  }
  checkpointsBeforeStatement.set(
    statementCount,
    snapshotSemanticContext(run.context, { editHandlesMode: "length" })
  );

  const semantic = finalizeSemanticEvaluationRun(
    run,
    statementFragments.map((fragment) => fragment.elements)
  );
  const nextCached: CachedSemanticRun = {
    source: run.source,
    containsStatefulGraphicsState: containsStatefulGraphicsState(run.source, run.figure),
    statementIds,
    statementFragments,
    editHandles: semantic.editHandles,
    checkpointInterval,
    checkpointCache: { kind: "captured", checkpointsBeforeStatement },
    dependencies: semantic.dependencies,
    sourceStatementFirstIndexBySourceId: mapSourceStatementFirstIndices(semantic.sourceStatementFirstIndexBySourceId),
    nodeAnchorTargets: semantic.nodeAnchorTargets,
  };
  return {
    output: {
      semantic,
      stats: {
        strategy: "full",
        replayMode: "full",
        recomputeFromStatementIndex: null,
        recomputedStatementCount: statementCount,
        reusedStatementCount: 0,
        corridorEndStatementIndex: null,
        affectedStatementCount: statementCount,
        fallbackReason,
        checkpointPreparation: "captured-during-evaluation",
        checkpointCount: checkpointsBeforeStatement.size
      }
    },
    cached: nextCached
  };
}

function* evaluateIncrementalSuffix(args: {
  run: ReturnType<typeof createSemanticEvaluationRun>;
  previous: CachedSemanticRun;
  resolveSpan: (span: Span) => Span;
  statementIds: string[];
  restoreIndex: number;
  checkpointInterval: number;
  previousCheckpoints: CapturedSemanticCheckpoints;
  startCheckpoint: SemanticContextSnapshot;
  affectedStatementCount: number;
  fallbackReason?: IncrementalSemanticFallbackReason;
  checkpointPreparation: IncrementalSemanticCheckpointPreparation;
}): Generator<void, {
  output: IncrementalSemanticEvaluateResult;
  cached: CachedSemanticRun;
}, void> {
  const {
    run,
    previous,
    resolveSpan,
    statementIds,
    restoreIndex,
    checkpointInterval,
    previousCheckpoints,
    startCheckpoint,
    affectedStatementCount,
    fallbackReason,
    checkpointPreparation
  } = args;
  const statementCount = run.expandedFigureBody.length;
  const bindCheckpoint = createCheckpointBinder(run, resolveSpan);

  restoreSemanticContext(run.context, bindCheckpoint(startCheckpoint), {
    editHandleSource: previous.editHandles
  });

  const nextFragments = yield* bindFragmentsToCurrentSource(run, previous.statementFragments.slice(0, restoreIndex), resolveSpan);
  run.context.editHandles = nextFragments.flatMap(fragment => fragment.editHandles);
  run.diagnostics.length = run.baseDiagnosticsCount;
  for (const fragment of nextFragments) run.diagnostics.push(...fragment.diagnostics);
  // The reused prefix is not evaluated again, so the final result takes its entry contexts from the fragments.
  for (const [index, fragment] of nextFragments.entries()) run.statementEntryContexts[index] = fragment.entryContext;
  const checkpointsBeforeStatement = cloneCheckpointsBefore(
    previousCheckpoints.checkpointsBeforeStatement,
    restoreIndex,
    bindCheckpoint
  );
  yield* restorePrefixFeatureUsage(run.featureUsage, previous.statementFragments, restoreIndex);
  run.captureGeometryCheckpoints = false;
  run.geometryCheckpoints = checkpointsBeforeStatement;

  for (let statementIndex = restoreIndex; statementIndex < statementCount; statementIndex += 1) {
    if (shouldCaptureCheckpoint(statementIndex, checkpointInterval)) {
      checkpointsBeforeStatement.set(
        statementIndex,
        snapshotSemanticContext(run.context, { editHandlesMode: "length" })
      );
    }
    const evaluated = evaluateSemanticStatementByIndex(run, statementIndex);
    nextFragments[statementIndex] = createStatementFragment(evaluated, run.context);
    yield;
  }
  checkpointsBeforeStatement.set(
    statementCount,
    snapshotSemanticContext(run.context, { editHandlesMode: "length" })
  );

  const semantic = finalizeSemanticEvaluationRun(
    run,
    nextFragments.map((fragment) => fragment.elements)
  );
  return {
    output: {
      semantic,
      stats: {
        strategy: "incremental",
        replayMode: "suffix",
        recomputeFromStatementIndex: restoreIndex,
        recomputedStatementCount: statementCount - restoreIndex,
        reusedStatementCount: restoreIndex,
        corridorEndStatementIndex: statementCount - 1,
        affectedStatementCount,
        ...(fallbackReason === undefined ? {} : { fallbackReason: fallbackReason }),
        checkpointPreparation,
        checkpointCount: checkpointsBeforeStatement.size
      }
    },
    cached: {
      source: run.source,
      containsStatefulGraphicsState: previous.containsStatefulGraphicsState,
      statementIds,
      statementFragments: nextFragments,
      editHandles: semantic.editHandles,
      checkpointInterval,
      checkpointCache: {
        kind: "captured",
        checkpointsBeforeStatement
      },
      dependencies: semantic.dependencies,
      sourceStatementFirstIndexBySourceId: mapSourceStatementFirstIndices(semantic.sourceStatementFirstIndexBySourceId),
      nodeAnchorTargets: semantic.nodeAnchorTargets,
    }
  };
}

function* evaluateSelectively(args: {
  run: ReturnType<typeof createSemanticEvaluationRun>;
  previous: CachedSemanticRun;
  resolveSpan: (span: Span) => Span;
  statementIds: string[];
  restoreIndex: number;
  corridorEndIndex: number;
  affectedStatementCount: number;
  checkpointInterval: number;
  previousCheckpoints: CapturedSemanticCheckpoints;
  startCheckpoint: SemanticContextSnapshot;
  checkpointPreparation: IncrementalSemanticCheckpointPreparation;
}): Generator<void, {
  output: IncrementalSemanticEvaluateResult;
  cached: CachedSemanticRun;
}, void> {
  const {
    run,
    previous,
    resolveSpan,
    statementIds,
    restoreIndex,
    corridorEndIndex,
    affectedStatementCount,
    checkpointInterval,
    previousCheckpoints,
    startCheckpoint,
    checkpointPreparation
  } = args;
  const statementCount = run.expandedFigureBody.length;
  const bindCheckpoint = createCheckpointBinder(run, resolveSpan);

  restoreSemanticContext(run.context, bindCheckpoint(startCheckpoint), {
    editHandleSource: previous.editHandles
  });
  retargetEditHandlesSourceFingerprint(run.context.editHandles, run.context.sourceFingerprint);
  run.diagnostics.length = run.baseDiagnosticsCount;

  const nextFragments = previous.statementFragments.slice();
  const checkpointsBeforeStatement = cloneCheckpointsBefore(
    previousCheckpoints.checkpointsBeforeStatement,
    restoreIndex,
    bindCheckpoint
  );
  yield* restorePrefixFeatureUsage(run.featureUsage, previous.statementFragments, restoreIndex);
  run.captureGeometryCheckpoints = false;
  run.geometryCheckpoints = checkpointsBeforeStatement;

  for (let statementIndex = restoreIndex; statementIndex <= corridorEndIndex; statementIndex += 1) {
    if (shouldCaptureCheckpoint(statementIndex, checkpointInterval)) {
      checkpointsBeforeStatement.set(
        statementIndex,
        snapshotSemanticContext(run.context, { editHandlesMode: "length" })
      );
    }
    const evaluated = evaluateSemanticStatementByIndex(run, statementIndex);
    nextFragments[statementIndex] = createStatementFragment(evaluated, run.context);
    yield;
  }
  const previousCorridorHandleCount = countFragmentEditHandles(
    previous.statementFragments,
    0,
    corridorEndIndex + 1
  );
  if (run.context.editHandles.length !== previousCorridorHandleCount) {
    throw new Error("Selective replay changed the edit-handle count before the reused suffix");
  }
  // The corridor drew a different count of random numbers: those the reused
  // statements drew would all change.
  if (run.context.mathRandom.getSeed() !== previous.statementFragments[corridorEndIndex]?.mathRandomSeed) {
    throw new Error("Selective replay changed the random numbers of the reused suffix");
  }

  const previousFinal = previousCheckpoints.checkpointsBeforeStatement.get(statementCount);
  const suffixReplay = previousFinal
    && corridorEndIndex + 1 < statementCount
    && corridorEffectsStand(previous.statementFragments, nextFragments, restoreIndex, corridorEndIndex)
    && corridorSymbolUsesStand(run.context.symbolResolver, previousFinal.symbolResolverState, nextFragments, restoreIndex, corridorEndIndex)
    ? "skipped" : "replayed";
  if (suffixReplay === "skipped") {
    // The corridor left what the rest of the picture reads as it was: it
    // produced and consumed the same names and looked up the same symbols. So
    // the previous run's state after the last statement stands, as do its
    // checkpoints past the corridor, but for the bounds drawn so far.
    const editHandles = run.context.editHandles;
    for (let statementIndex = corridorEndIndex + 1; statementIndex < statementCount; statementIndex += 1) {
      const fragment = requireArrayValue(previous.statementFragments, statementIndex);
      const checkpoint = previousCheckpoints.checkpointsBeforeStatement.get(statementIndex);
      if (checkpoint) checkpointsBeforeStatement.set(statementIndex, withPictureBounds(bindCheckpoint(checkpoint), run.context.pictureBounds));
      extendPictureBounds(run.context, fragment.effectSummary.extendsPictureBounds);
      editHandles.push(...fragment.editHandles);
      mergeFeatureUsage(run.featureUsage, fragment.featureUsage);
    }
    const pictureBounds = run.context.pictureBounds;
    restoreSemanticContext(run.context, bindCheckpoint(requireDefined(previousFinal, "Expected an internal incremental value")), { editHandleSource: previous.editHandles });
    run.context.pictureBounds = pictureBounds;
    run.context.editHandles = editHandles;
    checkpointsBeforeStatement.set(statementCount, withPictureBounds(bindCheckpoint(requireDefined(previousFinal, "Expected an internal incremental value")), pictureBounds));
    yield;
  } else {
    const reusedSourceIds = new Set<string>();
    for (let statementIndex = corridorEndIndex + 1; statementIndex < statementCount; statementIndex += 1) {
      const fragment = requireArrayValue(previous.statementFragments, statementIndex);
      if (shouldCaptureCheckpoint(statementIndex, checkpointInterval)) {
        checkpointsBeforeStatement.set(
          statementIndex,
          snapshotSemanticContext(run.context, { editHandlesMode: "length" })
        );
      }
      if (fragment.effectSummary.entersScope) {
        // Resolve the unchanged scope options against the current enclosing frame.
        // Its graphical children can still reuse their recorded effects/geometry.
        nextFragments[statementIndex] = createStatementFragment(evaluateSemanticStatementByIndex(run, statementIndex), run.context);
      } else {
        // Dependencies are recorded per evaluated statement: a foreach iteration
        // under its own id, not the foreach it came from (as withDependencySource).
        applyStatementEffectSummary(run.context, fragment.effectSummary, { sourceId: fragment.statementId, elementSourceId: fragment.sourceId });
        run.context.mathRandom.setSeed(fragment.mathRandomSeed);
        run.context.editHandles.push(...fragment.editHandles);
        mergeFeatureUsage(run.featureUsage, fragment.featureUsage);
        reusedSourceIds.add(fragment.statementId);
      }
      yield;
    }
    // The effect summaries replay what reused statements define, not what they
    // look up: take their macro, style and library uses from the previous run.
    if (previousFinal) restoreSemanticSymbolUses(run.context.symbolResolver, previousFinal.symbolResolverState, reusedSourceIds);
    checkpointsBeforeStatement.set(
      statementCount,
      snapshotSemanticContext(run.context, { editHandlesMode: "length" })
    );
  }
  const finalFeatureUsage = cloneFeatureUsage(run.featureUsage);

  const currentFragments = yield* bindFragmentsToCurrentSource(run, nextFragments, resolveSpan);
  const recomputed = currentFragments.slice(restoreIndex, corridorEndIndex + 1);
  const recomputedSourceIds = new Set(recomputed.map((fragment) => fragment.statementId));
  // A full evaluation marks sources whose elements came from macros or
  // foreach loops as opaque, which later edits must re-evaluate in full.
  markOpaqueDependencySources(recomputed.flatMap((fragment) => fragment.elements), run.context);
  const dependencies = replaceSourceDependencies(
    previous.dependencies,
    run.context.dependencyBuilder.buildForSources(recomputedSourceIds),
    recomputedSourceIds
  );

  const semantic = assembleSelectiveSemanticResult({
    run,
    fragments: currentFragments,
    featureUsage: finalFeatureUsage,
    dependencies,
    sourceStatementFirstIndexBySourceId: previous.sourceStatementFirstIndexBySourceId,
    // The named nodes and coordinates are the previous run's.
    nodeAnchorTargets: suffixReplay === "skipped" ? previous.nodeAnchorTargets : null
  });

  return {
    output: {
      semantic,
      stats: {
        strategy: "incremental",
        replayMode: "selective",
        recomputeFromStatementIndex: restoreIndex,
        recomputedStatementCount: corridorEndIndex - restoreIndex + 1,
        reusedStatementCount: statementCount - (corridorEndIndex - restoreIndex + 1),
        corridorEndStatementIndex: corridorEndIndex,
        affectedStatementCount,
        checkpointPreparation,
        checkpointCount: checkpointsBeforeStatement.size,
        suffixReplay
      }
    },
    cached: {
      source: run.source,
      containsStatefulGraphicsState: previous.containsStatefulGraphicsState,
      statementIds,
      statementFragments: currentFragments,
      editHandles: semantic.editHandles,
      checkpointInterval,
      checkpointCache: {
        kind: "captured",
        checkpointsBeforeStatement
      },
      dependencies: semantic.dependencies,
      sourceStatementFirstIndexBySourceId: mapSourceStatementFirstIndices(semantic.sourceStatementFirstIndexBySourceId),
      nodeAnchorTargets: semantic.nodeAnchorTargets,
    }
  };
}

function assembleSelectiveSemanticResult(args: {
  run: ReturnType<typeof createSemanticEvaluationRun>;
  fragments: readonly SemanticStatementFragment[];
  featureUsage: FeatureUsage;
  dependencies: EvaluateTikzResult["dependencies"];
  sourceStatementFirstIndexBySourceId: ReadonlyMap<string, number>;
  nodeAnchorTargets: EvaluateTikzResult["nodeAnchorTargets"] | null;
}): EvaluateTikzResult {
  const { run, fragments, featureUsage, dependencies, sourceStatementFirstIndexBySourceId } = args;
  const elements: SceneElement[] = [];
  const editHandles: EditHandle[] = [];
  const diagnostics = run.diagnostics.slice(0, run.baseDiagnosticsCount);

  for (const fragment of fragments) {
    elements.push(...fragment.elements);
    editHandles.push(...fragment.editHandles);
    diagnostics.push(...fragment.diagnostics);
  }

  const finalFeatureUsage = cloneFeatureUsage(featureUsage);
  const colorAliases = new Map(currentFrame(run.context).colorAliases);
  const optionalBounds1 = run.context.pictureBounds ?? computeBounds(elements);
  const scene: SceneFigure = {
    kind: "SceneFigure",
    span: run.figure.span,
    requiredTikzLibraries: inferRequiredTikzLibraries({
      featureUsage: finalFeatureUsage,
      elements
    }),
    layers: [{ name: MAIN_SCENE_LAYER, order: 0 }],
    elements,
    // As a full evaluation: clipping and `use as bounding box` paths bound the picture, not all of its elements.
    ...(optionalBounds1 === undefined ? {} : { bounds: optionalBounds1 }),
    hasStatefulGraphicsState:
      finalFeatureUsage.path_clipping === "used-supported" || finalFeatureUsage.use_as_bounding_box === "used-supported",
    ...(run.rootTransform ? { rootTransform: run.rootTransform } : {})
  };
  for (const libraryName of scene.requiredTikzLibraries) {
    requireContextLibrary(run.context, libraryName, null);
  }
  scene.requiredTikzLibraries = listContextRequiredLibraries(run.context);

  const result: EvaluateTikzResult = {
    // The run ends at the last statement, replayed or restored from the previous run's final state.
    siteContexts: {
      statementEntries: fragments.map(fragment => fragment.entryContext),
      figureEnd: captureSiteContext(currentFrame(run.context))
    },
    scene,
    diagnostics,
    featureUsage: finalFeatureUsage,
    editHandles,
    nodeAnchorTargets: args.nodeAnchorTargets ?? collectNodeAnchorTargets(run.context),
    dependencies,
    sourceStatementFirstIndexBySourceId: unmapSourceStatementFirstIndices(sourceStatementFirstIndexBySourceId),
    colorAliases,
    symbolDependencyEdges: listContextSymbolDependencyEdges(run.context),
    unresolvedSymbols: listContextUnresolvedSymbols(run.context)
  };
  rememberGeometryCheckpoints(result, run.geometryCheckpoints);
  return result;
}

function createStatementFragment(
  evaluated: ReturnType<typeof evaluateSemanticStatementByIndex>,
  context: { sourceFingerprint: string; mathRandom: { getSeed(): number } }
): SemanticStatementFragment {
  return {
    statementId: evaluated.statementId,
    sourceId: evaluated.sourceId,
    sourceSpan: { ...evaluated.sourceSpan },
    sourceFingerprint: context.sourceFingerprint,
    mathRandomSeed: context.mathRandom.getSeed(),
    elements: evaluated.elements,
    editHandles: evaluated.editHandles,
    diagnostics: evaluated.diagnostics,
    effectSummary: evaluated.effectSummary,
    featureUsage: evaluated.featureUsage,
    sourceExtent: sceneSourceExtent(evaluated.elements, evaluated.diagnostics, evaluated.sourceSpan),
    entryContext: evaluated.entryContext
  };
}

function planSelectiveReplay(
  fragments: readonly SemanticStatementFragment[],
  restoreIndex: number,
  affectedStatementIndices: readonly number[]
): SelectiveReplayPlan | null {
  const uniqueAffected = [...new Set(affectedStatementIndices)].sort((left, right) => left - right);
  if (uniqueAffected.length === 0) {
    return null;
  }
  const corridorEndIndex = uniqueAffected[uniqueAffected.length - 1] ?? restoreIndex;
  for (let statementIndex = corridorEndIndex + 1; statementIndex < fragments.length; statementIndex += 1) {
    const fragment = fragments[statementIndex];
    if (!fragment) {
      return null;
    }
    if (!isSuffixFragmentSelectiveSafe(fragment)) {
      return null;
    }
  }
  return {
    restoreIndex,
    corridorEndIndex,
    affectedStatementCount: uniqueAffected.length
  };
}

function isSuffixFragmentSelectiveSafe(
  fragment: SemanticStatementFragment
): boolean {
  const { effectSummary } = fragment;
  if (effectSummary.opaqueReasons.includes("macro-origin")) {
    return false;
  }
  return (
    effectSummary.suffixSkipKind === "safe" ||
    effectSummary.suffixSkipKind === "scope-safe" ||
    effectSummary.suffixSkipKind === "foreach-origin-safe"
  );
}

/**
 * Whether the corridor's statements, evaluated again, did to the context what
 * they did in the previous run, but for the bounds they drew and where they
 * left the current point (which the next statement replaces).
 */
function corridorEffectsStand(
  previous: readonly SemanticStatementFragment[],
  next: readonly SemanticStatementFragment[],
  fromIndex: number,
  toIndex: number
): boolean {
  for (let index = fromIndex; index <= toIndex; index += 1) {
    const before = requireArrayValue(previous, index);
    const after = requireArrayValue(next, index);
    if (before.statementId !== after.statementId) return false;
    const left = before.effectSummary;
    const right = after.effectSummary;
    if (
      !isSuffixFragmentSelectiveSafe(after)
      || left.suffixSkipKind !== right.suffixSkipKind
      || Boolean(left.entersScope) !== Boolean(right.entersScope)
      || Boolean(left.exitsScope) !== Boolean(right.exitsScope)
      || left.requiresSequentialContext !== right.requiresSequentialContext
      // Named path elements carry the source they were bound to.
      || left.appendsNamedPaths.length > 0
      || right.appendsNamedPaths.length > 0
      || !sameEffects(left, right)
    ) {
      return false;
    }
  }
  return true;
}

function sameEffects(left: SemanticStatementEffectSummary, right: SemanticStatementEffectSummary): boolean {
  const effects = (summary: SemanticStatementEffectSummary) => JSON.stringify([
    summary.producesNamedCoordinates,
    summary.producesNamedNodeGeometries,
    summary.producesNamedPaths,
    summary.consumesNamedResources,
    summary.addsNamedNodeSetMembers,
    summary.producesNamedCoordinateRewriteHandles,
    summary.opaqueReasons
  ]);
  return effects(left) === effects(right);
}

/** Whether the corridor's statements looked up the same macros, styles, colours and libraries as in the previous run. */
function corridorSymbolUsesStand(
  resolver: SemanticSymbolResolver,
  previous: SemanticSymbolResolverState,
  fragments: readonly SemanticStatementFragment[],
  fromIndex: number,
  toIndex: number
): boolean {
  const consumers = new Set<string>();
  for (let index = fromIndex; index <= toIndex; index += 1) consumers.add(requireArrayValue(fragments, index).statementId);
  const uses = (
    edges: Iterable<{ consumerStatementId: string; providerStatementId: string; kind: string; name: string }>,
    unresolved: Iterable<{ consumerStatementId: string; kind: string; name: string }>
  ) => {
    const keys: string[] = [];
    for (const edge of edges) {
      if (consumers.has(edge.consumerStatementId)) keys.push(`${edge.consumerStatementId}\u0000${edge.providerStatementId}\u0000${edge.kind}\u0000${edge.name}`);
    }
    for (const entry of unresolved) {
      if (consumers.has(entry.consumerStatementId)) keys.push(`${entry.consumerStatementId}\u0000\u0000${entry.kind}\u0000${entry.name}`);
    }
    return keys.sort().join("\u0001");
  };
  return uses(resolver.dependencyEdges.values(), resolver.unresolvedSymbols.values())
    === uses(previous.dependencyEdges, previous.unresolvedSymbols);
}

function withPictureBounds(checkpoint: SemanticContextSnapshot, pictureBounds: WorldBounds | null): SemanticContextSnapshot {
  return { ...checkpoint, pictureBounds: pictureBounds ? { ...pictureBounds } : null };
}

function countFragmentEditHandles(
  fragments: readonly SemanticStatementFragment[],
  fromIndex: number,
  toIndex: number
): number {
  let count = 0;
  for (let index = fromIndex; index < toIndex; index += 1) {
    count += fragments[index]?.editHandles.length ?? 0;
  }
  return count;
}

/**
 * The patches between the last run's source and this one when they touch
 * neither the picture nor any statement it evaluates (its context
 * definitions included), else null.
 */
function movedOnlyPatches(
  previous: CachedSemanticRun,
  run: ReturnType<typeof createSemanticEvaluationRun>,
  input: IncrementalSemanticEvaluateInput,
  statementIds: readonly string[]
): readonly SourcePatch[] | null {
  if (previous.source === input.source || !sameStatementIds(previous.statementIds, statementIds)) return null;
  const supplied = input.hints?.sourcePatches;
  const patches = supplied?.length && supplied.every((patch): patch is SourcePatch => patch.oldSpan !== undefined && patch.newSpan !== undefined) &&
    patchesMatchSourceTransition(previous.source, input.source, supplied)
    ? supplied : [documentDiffPatch(previous.source, input.source)];
  const touches = (left: Span, right: Span) => left.from <= right.to && right.from <= left.to;
  const spans = [input.figure.span, ...run.sourceStatementSpanById.values()];
  return patches.some(patch => spans.some(span => touches(patch.newSpan, span))) ? null : patches;
}

function decideFallbackReason(
  hints: IncrementalSemanticHints,
  cached: CachedSemanticRun | null,
  statementIds: readonly string[]
): IncrementalSemanticFallbackReason | null {
  if (!hints.changedSourceIds || hints.changedSourceIds.length === 0) {
    return "missing-changed-source-ids";
  }
  if (!cached) {
    return "no-previous-cache";
  }
  if (!sameStatementIds(cached.statementIds, statementIds)) {
    return "statement-structure-changed";
  }
  return null;
}

function sameStatementIds(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function containsStatefulGraphicsState(source: string, figure?: TikzFigure): boolean {
  // A picture-wide overlay flag is constant across its statements. Checkpoints
  // already retain that inherited state. Per-path/scope overlay changes still
  // require a full replay to rebuild the picture's bounding-box state.
  for (const entry of figure?.options?.entries ?? []) {
    if (entry.kind !== "unknown" && entry.key.trim().replace(/^\/tikz\//u, "") === "overlay") {
      source = source.slice(0, entry.span.from) + " ".repeat(entry.span.to - entry.span.from) + source.slice(entry.span.to);
    }
  }
  return (
    /\\clip\b/.test(source) ||
    /\\useasboundingbox\b/.test(source) ||
    /\[\s*clip(?:[\],])/m.test(source) ||
    /use as bounding box/.test(source) ||
    /\boverlay\b/.test(source) ||
    /on background layer/.test(source) ||
    /show background (?:rectangle|grid|top|bottom|left|right)/.test(source) ||
    /\b(?:framed|gridded|tight background|loose background)\b/.test(source) ||
    /\b(?:inner|outer) frame (?:xsep|ysep|sep)\b/.test(source)
  );
}

function resolveContainsStatefulGraphicsState(
  source: string,
  hints: IncrementalSemanticHints,
  previous: CachedSemanticRun | null,
  figure: TikzFigure
): boolean {
  if (!previous || previous.containsStatefulGraphicsState) {
    return containsStatefulGraphicsState(source, figure);
  }
  const patches = hints.sourcePatches;
  if (!patches || patches.length === 0) {
    return containsStatefulGraphicsState(source, figure);
  }
  return patches.some((patch) => {
    if (containsStatefulGraphicsStateToken(patch.replacement)) {
      return true;
    }
    if (!patch.newSpan) {
      return false;
    }
    const from = Math.max(0, patch.newSpan.from - 32);
    const to = Math.min(source.length, patch.newSpan.to + 32);
    return containsStatefulGraphicsState(source, figure) && containsStatefulGraphicsStateToken(source.slice(from, to));
  });
}

function containsStatefulGraphicsStateToken(source: string): boolean {
  return containsStatefulGraphicsState(source);
}

function shouldCaptureCheckpoint(
  statementIndex: number,
  checkpointInterval: number
): boolean {
  if (statementIndex === 0) {
    return true;
  }
  return statementIndex % checkpointInterval === 0;
}

function findCheckpointIndexAtOrBefore(
  checkpoints: ReadonlyMap<number, unknown>,
  statementIndex: number
): number | null {
  if (checkpoints.has(statementIndex)) {
    return statementIndex;
  }

  let best: number | null = null;
  for (const index of checkpoints.keys()) {
    if (index > statementIndex) {
      continue;
    }
    if (best == null || index > best) {
      best = index;
    }
  }
  return best;
}

function cloneCheckpointsBefore<T>(
  checkpoints: ReadonlyMap<number, T>,
  statementIndexExclusive: number,
  bind: (checkpoint: T) => T
): Map<number, T> {
  const cloned = new Map<number, T>();
  for (const [checkpointIndex, value] of checkpoints) {
    if (checkpointIndex >= statementIndexExclusive) {
      continue;
    }
    cloned.set(checkpointIndex, bind(value));
  }
  return cloned;
}

/**
 * Scopes open at a checkpoint can enclose the change, so the source
 * locations in its frames move like those of reused fragments, and a kept
 * checkpoint must be moved at every run, not only when restored. Frames
 * inside an expansion also carry the expansion's own locations, which stay.
 */
function createCheckpointBinder(
  run: ReturnType<typeof createSemanticEvaluationRun>,
  resolveSpan: (span: Span) => Span
): (checkpoint: SemanticContextSnapshot) => SemanticContextSnapshot {
  const binder = createSceneSourceBinder(resolveSpan, run.context.sourceFingerprint);
  const authored = (sourceRef: Pick<StyleSourceRef, "sourceId"> & { sourceKind?: string } | undefined) =>
    sourceRef != null && (sourceRef.sourceKind === "figure-options" || run.sourceStatementSpanById.has(sourceRef.sourceId));
  const chain = (entries: StyleChainEntry[]) => {
    const bound = entries.map(entry => {
      if (!entry.sourceRef || !authored(entry.sourceRef)) return entry;
      return { ...entry, sourceRef: binder.metadata(entry.sourceRef), rawOptions: binder.metadata(entry.rawOptions) };
    });
    return bound.every((entry, index) => entry.sourceRef === requireArrayValue(entries, index).sourceRef && entry.rawOptions === requireArrayValue(entries, index).rawOptions)
      ? entries : bound;
  };
  const provenance = (lists: ProvenanceOptionList[]) => {
    const bound = lists.map(list => authored(list.sourceRef) ? { ...list, sourceRef: binder.metadata(list.sourceRef) } : list);
    return bound.every((list, index) => list.sourceRef === requireArrayValue(lists, index).sourceRef) ? lists : bound;
  };
  const frame = (current: SemanticContextFrame): SemanticContextFrame => {
    const next: SemanticContextFrame = {
      ...current,
      styleChain: chain(current.styleChain),
      clipChain: current.clipChain.map(clip => authored(clip.sourceRef) ? { ...clip, sourceRef: binder.metadata(clip.sourceRef) } : clip),
      everyPathStyles: provenance(current.everyPathStyles),
      everyNodeStyles: provenance(current.everyNodeStyles),
      everyTextNodePartStyles: provenance(current.everyTextNodePartStyles),
      everyFitStyles: provenance(current.everyFitStyles),
      everyPicStyles: provenance(current.everyPicStyles),
      everyShapeNodeStyles: new Map([...current.everyShapeNodeStyles].map(([shape, lists]) => [shape, provenance(lists)])),
      treeEveryChildStyles: provenance(current.treeEveryChildStyles),
      treeEveryChildNodeStyles: provenance(current.treeEveryChildNodeStyles),
      treeLevelStyleTemplateLayers: provenance(current.treeLevelStyleTemplateLayers),
      treeLevelStyleLayers: current.treeLevelStyleLayers.map(level => ({ ...level, layers: provenance(level.layers) }))
    };
    return next;
  };
  const bound = new WeakMap<SemanticContextSnapshot, SemanticContextSnapshot>();
  return (checkpoint) => {
    let result = bound.get(checkpoint);
    if (!result) {
      result = { ...checkpoint, stack: checkpoint.stack.map(frame) };
      bound.set(checkpoint, result);
    }
    return result;
  };
}

function cloneFeatureUsage(featureUsage: FeatureUsage): FeatureUsage {
  return { ...featureUsage };
}

function* restorePrefixFeatureUsage(
  usage: FeatureUsage,
  fragments: readonly SemanticStatementFragment[],
  statementIndexExclusive: number
): Generator<void, void, void> {
  // The new run supplies current figure/preamble usage, including foreach scans.
  for (let index = 0; index < statementIndexExclusive; index += 1) {
    mergeFeatureUsage(usage, requireArrayValue(fragments, index).featureUsage);
    yield;
  }
}

function mapSourceStatementFirstIndices(
  source: Record<string, number>
): Map<string, number> {
  const mapped = new Map<string, number>();
  for (const [sourceId, index] of Object.entries(source)) {
    if (!Number.isInteger(index) || index < 0) {
      continue;
    }
    mapped.set(sourceId, index);
  }
  return mapped;
}

function unmapSourceStatementFirstIndices(
  source: ReadonlyMap<string, number>
): Record<string, number> {
  return Object.fromEntries([...source.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function normalizeChangedSourceIds(
  sourceIds: readonly string[]
): string[] {
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

/**
 * Eagerly bind compact source metadata; never clone the reusable geometry.
 * Edit handles name the source revision, so they are bound for every new
 * source; elements only when their source locations move.
 */
function* bindFragmentsToCurrentSource(
  run: ReturnType<typeof createSemanticEvaluationRun>,
  fragments: readonly SemanticStatementFragment[],
  resolveSpan: (span: Span) => Span
): Generator<void, SemanticStatementFragment[], void> {
  const sourceFingerprint = run.context.sourceFingerprint;
  const binder = createSceneSourceBinder(resolveSpan, sourceFingerprint);
  const current: SemanticStatementFragment[] = [];
  for (const fragment of fragments) {
    if (fragment.sourceFingerprint === sourceFingerprint) { current.push(fragment); continue; }
    const editHandles = fragment.editHandles.map(binder.handle);
    const sourceExtent = resolveSpan(fragment.sourceExtent);
    if (sourceExtent === fragment.sourceExtent) {
      current.push({ ...fragment, sourceFingerprint, editHandles });
      continue;
    }
    const mappedSpan = resolveSpan(fragment.sourceSpan);
    // The AST is authoritative for authored statement boundaries. Expansion
    // fragments use their mapped attribution spans instead of synthetic spans.
    const sourceSpan = run.sourceStatementSpanById.get(fragment.sourceId) ?? mappedSpan;
    const delta = mappedSpan.from - fragment.sourceSpan.from;
    const elements = fragment.elements.map(element => {
      const bound = binder.element(element);
      if (bound.kind === "Text" && bound.textRenderInfo?.mode === "tex" && delta !== 0) {
        const info = bound.textRenderInfo;
        const rebased = run.context.textEngine?.rebaseSource?.(info.cacheKey, delta);
        if (!rebased) throw new Error("Text source projection requires semantic replay");
        bound.textRenderInfo = { ...info, cacheKey: rebased.cacheKey, paragraphId: rebased.paragraphId,
          ...(rebased.renderKey && { renderKey: rebased.renderKey }),
          ...(rebased.graphicsPlacements?.length ? { graphicsPlacements: rebased.graphicsPlacements } : {}) };
      }
      return bound;
    });
    current.push({ ...fragment, sourceSpan, sourceFingerprint, sourceExtent, elements, editHandles,
      diagnostics: binder.metadata(fragment.diagnostics) });
    yield;
  }
  return current;
}
