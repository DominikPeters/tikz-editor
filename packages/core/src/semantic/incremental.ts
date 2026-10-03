import { finishWork, runCooperatively, type CooperativeWorkOptions } from "./cooperative-work.js";
import type { Span, TikzFigure } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import {
  applyStatementEffectSummary,
  listContextRequiredLibraries,
  listContextSymbolDependencyEdges,
  listContextUnresolvedSymbols,
  currentFrame,
  requireContextLibrary,
  restoreSemanticContext,
  retargetEditHandlesSourceFingerprint,
  snapshotSemanticContext,
  type SemanticContextSnapshot,
  type SemanticStatementEffectSummary
} from "./context.js";
import { collectGeometryInvalidation, replaceSourceDependencies } from "./dependencies.js";
import {
  collectNodeAnchorTargets,
  computeBounds,
  createSemanticEvaluationRun,
  evaluateSemanticStatementByIndex,
  finalizeSemanticEvaluationRun,
  rememberGeometryCheckpoints,
  type EvaluateTikzResult
} from "./evaluate.js";
import { inferRequiredTikzLibraries } from "./required-tikz-libraries.js";
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
import { computeMinimalReplacementPatch } from "../edit/patch.js";
import { patchesMatchSourceTransition } from "../edit/source-patches.js";
import { createSceneSourceBinder, createSourceSpanResolver } from "./source-bindings.js";

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
    const statefulGraphicsState = resolveContainsStatefulGraphicsState(input.source, hints, cached);

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
    if (fallback) {
      const full = yield* evaluateFullyAndCache(
        run,
        statementIds,
        fallback
      );
      if (version === runVersion) cached = full.cached;
      return full.output;
    }

    const previous = cached!;
    const suppliedPatches = hints.sourcePatches as readonly SourcePatch[] | undefined;
    const patches = suppliedPatches?.every(patch => patch.oldSpan && patch.newSpan) &&
      patchesMatchSourceTransition(previous.source, run.source, suppliedPatches)
      ? suppliedPatches : [computeMinimalReplacementPatch(previous.source, run.source)];
    const resolveSpan = createSourceSpanResolver(patches);

    const changedSourceIds = normalizeChangedSourceIds(hints.changedSourceIds ?? []);
    // Children inherit a changed scope's options. Include their resource users
    // in invalidation too, including paths outside the scope that use its nodes.
    for (const sourceId of changedSourceIds.slice()) {
      const index = previous.sourceStatementFirstIndexBySourceId.get(sourceId);
      if (index == null || run.scopeSteps.get(run.expandedFigureBody[index]) !== "enter") continue;
      const scopeId = run.expandedFigureBody[index].id;
      for (let i = index + 1; i < statementCount; i++) {
        if (run.expandedFigureBody[i].id === `${scopeId}:leave`) break;
        changedSourceIds.push(previous.statementFragments[i].sourceId);
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
      const statement = run.expandedFigureBody[index];
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

    const startCheckpoint = preparedCheckpoints.checkpointsBeforeStatement.get(restoreIndex)!;

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
        return selective.output;
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
          return suffix.output;
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
      return suffix.output;
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
    statementFragments.push(createStatementFragment(evaluated, run.context.sourceFingerprint));
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
    containsStatefulGraphicsState: containsStatefulGraphicsState(run.source),
    statementIds,
    statementFragments,
    editHandles: semantic.editHandles,
    checkpointInterval,
    checkpointCache: { kind: "captured", checkpointsBeforeStatement },
    dependencies: semantic.dependencies,
    sourceStatementFirstIndexBySourceId: mapSourceStatementFirstIndices(semantic.sourceStatementFirstIndexBySourceId),
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

  restoreSemanticContext(run.context, startCheckpoint, {
    editHandleSource: previous.editHandles
  });

  const nextFragments = yield* bindFragmentsToCurrentSource(run, previous.statementFragments.slice(0, restoreIndex), resolveSpan);
  run.context.editHandles = nextFragments.flatMap(fragment => fragment.editHandles);
  run.diagnostics.length = run.baseDiagnosticsCount;
  for (const fragment of nextFragments) run.diagnostics.push(...fragment.diagnostics);
  const checkpointsBeforeStatement = cloneCheckpointsBefore(
    previousCheckpoints.checkpointsBeforeStatement,
    restoreIndex
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
    nextFragments[statementIndex] = createStatementFragment(evaluated, run.context.sourceFingerprint);
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
        fallbackReason,
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

  restoreSemanticContext(run.context, startCheckpoint, {
    editHandleSource: previous.editHandles
  });
  retargetEditHandlesSourceFingerprint(run.context.editHandles, run.context.sourceFingerprint);
  run.diagnostics.length = run.baseDiagnosticsCount;

  const nextFragments = previous.statementFragments.slice();
  const checkpointsBeforeStatement = cloneCheckpointsBefore(
    previousCheckpoints.checkpointsBeforeStatement,
    restoreIndex
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
    nextFragments[statementIndex] = createStatementFragment(evaluated, run.context.sourceFingerprint);
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

  for (let statementIndex = corridorEndIndex + 1; statementIndex < statementCount; statementIndex += 1) {
    const fragment = previous.statementFragments[statementIndex];
    if (shouldCaptureCheckpoint(statementIndex, checkpointInterval)) {
      checkpointsBeforeStatement.set(
        statementIndex,
        snapshotSemanticContext(run.context, { editHandlesMode: "length" })
      );
    }
    if (fragment.effectSummary.entersScope) {
      // Resolve the unchanged scope options against the current enclosing frame.
      // Its graphical children can still reuse their recorded effects/geometry.
      nextFragments[statementIndex] = createStatementFragment(evaluateSemanticStatementByIndex(run, statementIndex), run.context.sourceFingerprint);
    } else {
      applyStatementEffectSummary(run.context, fragment.effectSummary, { sourceId: fragment.sourceId });
      run.context.editHandles.push(...fragment.editHandles);
      mergeFeatureUsage(run.featureUsage, fragment.featureUsage);
    }
    yield;
  }
  const finalFeatureUsage = cloneFeatureUsage(run.featureUsage);
  checkpointsBeforeStatement.set(
    statementCount,
    snapshotSemanticContext(run.context, { editHandlesMode: "length" })
  );

  const currentFragments = yield* bindFragmentsToCurrentSource(run, nextFragments, resolveSpan);
  const recomputedSourceIds = new Set(currentFragments
    .slice(restoreIndex, corridorEndIndex + 1)
    .map((fragment) => fragment.sourceId));
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
    sourceStatementFirstIndexBySourceId: previous.sourceStatementFirstIndexBySourceId
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
        checkpointCount: checkpointsBeforeStatement.size
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
    }
  };
}

function assembleSelectiveSemanticResult(args: {
  run: ReturnType<typeof createSemanticEvaluationRun>;
  fragments: readonly SemanticStatementFragment[];
  featureUsage: FeatureUsage;
  dependencies: EvaluateTikzResult["dependencies"];
  sourceStatementFirstIndexBySourceId: ReadonlyMap<string, number>;
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
  const scene: SceneFigure = {
    kind: "SceneFigure",
    span: run.figure.span,
    requiredTikzLibraries: inferRequiredTikzLibraries({
      featureUsage: finalFeatureUsage,
      elements
    }),
    layers: [{ name: MAIN_SCENE_LAYER, order: 0 }],
    elements,
    bounds: computeBounds(elements),
    hasStatefulGraphicsState:
      finalFeatureUsage.path_clipping === "used-supported" || finalFeatureUsage.use_as_bounding_box === "used-supported"
  };
  for (const libraryName of scene.requiredTikzLibraries) {
    requireContextLibrary(run.context, libraryName, null);
  }
  scene.requiredTikzLibraries = listContextRequiredLibraries(run.context);

  const result: EvaluateTikzResult = {
    scene,
    diagnostics,
    featureUsage: finalFeatureUsage,
    editHandles,
    nodeAnchorTargets: collectNodeAnchorTargets(run.context),
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
  sourceFingerprint: string
): SemanticStatementFragment {
  return {
    statementId: evaluated.statementId,
    sourceId: evaluated.sourceId,
    sourceSpan: { ...evaluated.sourceSpan },
    sourceFingerprint,
    elements: evaluated.elements,
    editHandles: evaluated.editHandles,
    diagnostics: evaluated.diagnostics,
    effectSummary: evaluated.effectSummary,
    featureUsage: evaluated.featureUsage
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

function containsStatefulGraphicsState(source: string): boolean {
  return (
    /\\clip\b/.test(source) ||
    /\\useasboundingbox\b/.test(source) ||
    /\[\s*clip(?:[\],])/m.test(source) ||
    /use as bounding box/.test(source) ||
    /on background layer/.test(source) ||
    /show background (?:rectangle|grid|top|bottom|left|right)/.test(source) ||
    /\b(?:framed|gridded|tight background|loose background)\b/.test(source) ||
    /\b(?:inner|outer) frame (?:xsep|ysep|sep)\b/.test(source)
  );
}

function resolveContainsStatefulGraphicsState(
  source: string,
  hints: IncrementalSemanticHints,
  previous: CachedSemanticRun | null
): boolean {
  if (!previous || previous.containsStatefulGraphicsState) {
    return containsStatefulGraphicsState(source);
  }
  const patches = hints.sourcePatches;
  if (!patches || patches.length === 0) {
    return containsStatefulGraphicsState(source);
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
    return containsStatefulGraphicsStateToken(source.slice(from, to));
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
  statementIndexExclusive: number
): Map<number, T> {
  const cloned = new Map<number, T>();
  for (const [checkpointIndex, value] of checkpoints) {
    if (checkpointIndex >= statementIndexExclusive) {
      continue;
    }
    cloned.set(checkpointIndex, value);
  }
  return cloned;
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
    mergeFeatureUsage(usage, fragments[index].featureUsage);
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

/** Eagerly bind compact source metadata; never clone the reusable geometry. */
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
    current.push({ ...fragment, sourceSpan, sourceFingerprint, elements,
      editHandles: fragment.editHandles.map(binder.handle),
      diagnostics: binder.metadata(fragment.diagnostics) });
    yield;
  }
  return current;
}
