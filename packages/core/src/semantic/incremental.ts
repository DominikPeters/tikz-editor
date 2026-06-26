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
import { collectGeometryInvalidation } from "./dependencies.js";
import {
  collectNodeAnchorTargets,
  computeBounds,
  createSemanticEvaluationRun,
  evaluateSemanticStatementByIndex,
  finalizeSemanticEvaluationRun,
  type EvaluateTikzResult
} from "./evaluate.js";
import { inferRequiredTikzLibraries } from "./required-tikz-libraries.js";
import type {
  EditHandle,
  EvaluateOptions,
  FeatureUsage,
  SceneElement,
  SceneFigure
} from "./types.js";
import { MAIN_SCENE_LAYER } from "./types.js";

export type IncrementalSemanticTrigger = "drag-element" | "drag-handle" | "other";
export type IncrementalSemanticReplayMode = "full" | "suffix" | "selective";

export type IncrementalSemanticHints = {
  changedSourceIds?: readonly string[];
  sourcePatches?: readonly {
    newSpan?: Span;
    replacement: string;
  }[];
  trigger?: IncrementalSemanticTrigger;
};

export type IncrementalSemanticFallbackReason =
  | "non-drag-trigger"
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
};

type CachedSemanticRun = {
  source: string;
  containsStatefulGraphicsState: boolean;
  statementIds: string[];
  statementFragments: SemanticStatementFragment[];
  editHandles: readonly EditHandle[];
  checkpointInterval: number;
  checkpointsBeforeStatement: Map<number, SemanticContextSnapshot>;
  featureUsageBeforeStatement: Map<number, FeatureUsage>;
  dependencies: EvaluateTikzResult["dependencies"];
  sourceStatementFirstIndexBySourceId: Map<string, number>;
  finalFeatureUsage: FeatureUsage;
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
  let cached: CachedSemanticRun | null = null;

  const evaluate = (
    input: IncrementalSemanticEvaluateInput
  ): IncrementalSemanticEvaluateResult => {
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
      const full = evaluateFullyAndCache(run, statementIds, "stateful-graphics-state");
      cached = full.cached;
      return full.output;
    }

    const fallback = decideFallbackReason(hints, cached, statementIds);
    if (fallback) {
      const full = evaluateFullyAndCache(run, statementIds, fallback);
      cached = full.cached;
      return full.output;
    }

    const previous = cached!;

    const changedSourceIds = normalizeChangedSourceIds(hints.changedSourceIds ?? []);
    const invalidation = collectGeometryInvalidation(previous.dependencies, {
      changedSourceIds
    });
    if (invalidation.reachedOpaque) {
      const full = evaluateFullyAndCache(run, statementIds, "opaque-dependency");
      cached = full.cached;
      return full.output;
    }

    const affectedStatementIndices = invalidation.affectedSourceIds
      .map((sourceId) => previous.sourceStatementFirstIndexBySourceId.get(sourceId) ?? null)
      .filter((index): index is number => index != null && index >= 0 && index < statementCount);
    if (affectedStatementIndices.length === 0) {
      const full = evaluateFullyAndCache(run, statementIds, "unmapped-affected-source");
      cached = full.cached;
      return full.output;
    }

    const checkpointInterval = previous.checkpointInterval;
    const earliestAffectedIndex = Math.min(...affectedStatementIndices);
    const restoreIndex = findCheckpointIndexAtOrBefore(
      previous.checkpointsBeforeStatement,
      earliestAffectedIndex
    );
    if (restoreIndex == null) {
      const full = evaluateFullyAndCache(run, statementIds, "checkpoint-missing");
      cached = full.cached;
      return full.output;
    }

    const startCheckpoint = previous.checkpointsBeforeStatement.get(restoreIndex)!;
    const startFeatureUsage = previous.featureUsageBeforeStatement.get(restoreIndex);
    if (!startFeatureUsage) {
      const full = evaluateFullyAndCache(run, statementIds, "feature-checkpoint-missing");
      cached = full.cached;
      return full.output;
    }

    const selectivePlan = planSelectiveReplay(previous.statementFragments, restoreIndex, affectedStatementIndices);
    if (selectivePlan) {
      try {
        const selective = evaluateSelectively({
          run,
          previous,
          statementIds,
          restoreIndex,
          corridorEndIndex: selectivePlan.corridorEndIndex,
          affectedStatementCount: selectivePlan.affectedStatementCount,
          checkpointInterval,
          startCheckpoint,
          startFeatureUsage
        });
        cached = selective.cached;
        return selective.output;
      } catch {
        try {
          const suffix = evaluateIncrementalSuffix({
            run: createSemanticEvaluationRun(input.figure, input.source, options),
            previous,
            statementIds,
            restoreIndex,
            checkpointInterval,
            startCheckpoint,
            startFeatureUsage,
            affectedStatementCount: new Set(affectedStatementIndices).size,
            fallbackReason: "selective-replay-error"
          });
          cached = suffix.cached;
          return suffix.output;
        } catch {
          const full = evaluateFullyAndCache(
            createSemanticEvaluationRun(input.figure, input.source, options),
            statementIds,
            "runtime-error"
          );
          cached = full.cached;
          return full.output;
        }
      }
    }

    try {
      const suffix = evaluateIncrementalSuffix({
        run,
        previous,
        statementIds,
        restoreIndex,
        checkpointInterval,
        startCheckpoint,
        startFeatureUsage,
        affectedStatementCount: new Set(affectedStatementIndices).size
      });
      cached = suffix.cached;
      return suffix.output;
    } catch {
      const full = evaluateFullyAndCache(
        createSemanticEvaluationRun(input.figure, input.source, options),
        statementIds,
        "runtime-error"
      );
      cached = full.cached;
      return full.output;
    }
  };

  return {
    evaluate,
    reset: () => {
      cached = null;
    }
  };
}

function evaluateFullyAndCache(
  run: ReturnType<typeof createSemanticEvaluationRun>,
  statementIds: string[],
  fallbackReason: IncrementalSemanticFallbackReason
): {
  output: IncrementalSemanticEvaluateResult;
  cached: CachedSemanticRun;
} {
  const statementCount = run.expandedFigureBody.length;
  const checkpointInterval = DEFAULT_CHECKPOINT_INTERVAL;
  const statementFragments: SemanticStatementFragment[] = [];
  const checkpointsBeforeStatement = new Map<number, SemanticContextSnapshot>();
  const featureUsageBeforeStatement = new Map<number, FeatureUsage>();

  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    if (shouldCaptureCheckpoint(statementIndex, checkpointInterval)) {
      checkpointsBeforeStatement.set(
        statementIndex,
        snapshotSemanticContext(run.context, { editHandlesMode: "length" })
      );
      featureUsageBeforeStatement.set(statementIndex, cloneFeatureUsage(run.featureUsage));
    }
    const evaluated = evaluateSemanticStatementByIndex(run, statementIndex);
    statementFragments.push(createStatementFragment(evaluated));
  }
  checkpointsBeforeStatement.set(
    statementCount,
    snapshotSemanticContext(run.context, { editHandlesMode: "length" })
  );
  featureUsageBeforeStatement.set(statementCount, cloneFeatureUsage(run.featureUsage));

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
    checkpointsBeforeStatement,
    featureUsageBeforeStatement,
    dependencies: semantic.dependencies,
    sourceStatementFirstIndexBySourceId: mapSourceStatementFirstIndices(semantic.sourceStatementFirstIndexBySourceId),
    finalFeatureUsage: cloneFeatureUsage(semantic.featureUsage)
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
        fallbackReason
      }
    },
    cached: nextCached
  };
}

function evaluateIncrementalSuffix(args: {
  run: ReturnType<typeof createSemanticEvaluationRun>;
  previous: CachedSemanticRun;
  statementIds: string[];
  restoreIndex: number;
  checkpointInterval: number;
  startCheckpoint: SemanticContextSnapshot;
  startFeatureUsage: FeatureUsage;
  affectedStatementCount: number;
  fallbackReason?: IncrementalSemanticFallbackReason;
}): {
  output: IncrementalSemanticEvaluateResult;
  cached: CachedSemanticRun;
} {
  const {
    run,
    previous,
    statementIds,
    restoreIndex,
    checkpointInterval,
    startCheckpoint,
    startFeatureUsage,
    affectedStatementCount,
    fallbackReason
  } = args;
  const statementCount = run.expandedFigureBody.length;

  restoreSemanticContext(run.context, startCheckpoint, {
    editHandleSource: previous.editHandles
  });
  retargetEditHandlesSourceFingerprint(run.context.editHandles, run.context.sourceFingerprint);
  assignFeatureUsage(run.featureUsage, startFeatureUsage);
  run.diagnostics.length = run.baseDiagnosticsCount;
  for (let index = 0; index < restoreIndex; index += 1) {
    run.diagnostics.push(...previous.statementFragments[index].diagnostics);
  }

  const nextFragments = previous.statementFragments.slice(0, restoreIndex);
  const checkpointsBeforeStatement = cloneCheckpointsBefore(
    previous.checkpointsBeforeStatement,
    restoreIndex
  );
  const featureUsageBeforeStatement = cloneCheckpointsBefore(
    previous.featureUsageBeforeStatement,
    restoreIndex
  );

  for (let statementIndex = restoreIndex; statementIndex < statementCount; statementIndex += 1) {
    if (shouldCaptureCheckpoint(statementIndex, checkpointInterval)) {
      checkpointsBeforeStatement.set(
        statementIndex,
        snapshotSemanticContext(run.context, { editHandlesMode: "length" })
      );
      featureUsageBeforeStatement.set(statementIndex, cloneFeatureUsage(run.featureUsage));
    }
    const evaluated = evaluateSemanticStatementByIndex(run, statementIndex);
    nextFragments[statementIndex] = createStatementFragment(evaluated);
  }
  checkpointsBeforeStatement.set(
    statementCount,
    snapshotSemanticContext(run.context, { editHandlesMode: "length" })
  );
  featureUsageBeforeStatement.set(statementCount, cloneFeatureUsage(run.featureUsage));

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
        fallbackReason
      }
    },
    cached: {
      source: run.source,
      containsStatefulGraphicsState: previous.containsStatefulGraphicsState,
      statementIds,
      statementFragments: nextFragments,
      editHandles: semantic.editHandles,
      checkpointInterval,
      checkpointsBeforeStatement,
      featureUsageBeforeStatement,
      dependencies: semantic.dependencies,
      sourceStatementFirstIndexBySourceId: mapSourceStatementFirstIndices(semantic.sourceStatementFirstIndexBySourceId),
      finalFeatureUsage: cloneFeatureUsage(semantic.featureUsage)
    }
  };
}

function evaluateSelectively(args: {
  run: ReturnType<typeof createSemanticEvaluationRun>;
  previous: CachedSemanticRun;
  statementIds: string[];
  restoreIndex: number;
  corridorEndIndex: number;
  affectedStatementCount: number;
  checkpointInterval: number;
  startCheckpoint: SemanticContextSnapshot;
  startFeatureUsage: FeatureUsage;
}): {
  output: IncrementalSemanticEvaluateResult;
  cached: CachedSemanticRun;
} {
  const {
    run,
    previous,
    statementIds,
    restoreIndex,
    corridorEndIndex,
    affectedStatementCount,
    checkpointInterval,
    startCheckpoint,
    startFeatureUsage
  } = args;
  const statementCount = run.expandedFigureBody.length;

  restoreSemanticContext(run.context, startCheckpoint, {
    editHandleSource: previous.editHandles
  });
  retargetEditHandlesSourceFingerprint(run.context.editHandles, run.context.sourceFingerprint);
  assignFeatureUsage(run.featureUsage, startFeatureUsage);
  run.diagnostics.length = run.baseDiagnosticsCount;

  const nextFragments = previous.statementFragments.slice();
  const checkpointsBeforeStatement = cloneCheckpointsBefore(
    previous.checkpointsBeforeStatement,
    restoreIndex
  );
  const featureUsageBeforeStatement = cloneCheckpointsBefore(
    previous.featureUsageBeforeStatement,
    restoreIndex
  );

  for (let statementIndex = restoreIndex; statementIndex <= corridorEndIndex; statementIndex += 1) {
    if (shouldCaptureCheckpoint(statementIndex, checkpointInterval)) {
      checkpointsBeforeStatement.set(
        statementIndex,
        snapshotSemanticContext(run.context, { editHandlesMode: "length" })
      );
      featureUsageBeforeStatement.set(statementIndex, cloneFeatureUsage(run.featureUsage));
    }
    const evaluated = evaluateSemanticStatementByIndex(run, statementIndex);
    nextFragments[statementIndex] = createStatementFragment(evaluated);
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
      featureUsageBeforeStatement.set(
        statementIndex,
        cloneFeatureUsage(previous.featureUsageBeforeStatement.get(statementIndex) ?? previous.finalFeatureUsage)
      );
    }
    applyStatementEffectSummary(run.context, fragment.effectSummary, {
      sourceId: fragment.sourceId
    });
  }
  const finalFeatureUsage = mergeFeatureUsageAfterSelectiveReplay(
    previous.finalFeatureUsage,
    startFeatureUsage,
    run.featureUsage
  );
  checkpointsBeforeStatement.set(
    statementCount,
    snapshotSemanticContext(run.context, { editHandlesMode: "length" })
  );
  featureUsageBeforeStatement.set(statementCount, cloneFeatureUsage(finalFeatureUsage));

  const currentFragments = materializeFragmentsForCache(
    previous.source,
    run.source,
    nextFragments,
    run.context.sourceFingerprint
  );
  const suffixSourceIds = currentFragments
    .slice(corridorEndIndex + 1)
    .map((fragment) => fragment.sourceId);
  const recomputedSourceIds = currentFragments
    .slice(restoreIndex, corridorEndIndex + 1)
    .map((fragment) => fragment.sourceId);
  const dependencies = mergeSelectiveDependencies(
    run.context.dependencyBuilder.build(),
    previous.dependencies,
    suffixSourceIds,
    recomputedSourceIds
  );

  const semantic = assembleSelectiveSemanticResult({
    run,
    previousSource: run.source,
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
        affectedStatementCount
      }
    },
    cached: {
      source: run.source,
      containsStatefulGraphicsState: previous.containsStatefulGraphicsState,
      statementIds,
      statementFragments: currentFragments,
      editHandles: semantic.editHandles,
      checkpointInterval,
      checkpointsBeforeStatement,
      featureUsageBeforeStatement,
      dependencies: semantic.dependencies,
      sourceStatementFirstIndexBySourceId: mapSourceStatementFirstIndices(semantic.sourceStatementFirstIndexBySourceId),
      finalFeatureUsage: cloneFeatureUsage(semantic.featureUsage)
    }
  };
}

function assembleSelectiveSemanticResult(args: {
  run: ReturnType<typeof createSemanticEvaluationRun>;
  previousSource: string;
  fragments: readonly SemanticStatementFragment[];
  featureUsage: FeatureUsage;
  dependencies: EvaluateTikzResult["dependencies"];
  sourceStatementFirstIndexBySourceId: ReadonlyMap<string, number>;
}): EvaluateTikzResult {
  const { run, previousSource, fragments, featureUsage, dependencies, sourceStatementFirstIndexBySourceId } = args;
  const sourceFingerprint = run.context.sourceFingerprint;
  const elements: SceneElement[] = [];
  const editHandles: EditHandle[] = [];
  const diagnostics = run.diagnostics.slice(0, run.baseDiagnosticsCount);

  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index];
    const currentSourceSpan =
      locateCurrentSpan(previousSource, run.source, fragment.sourceSpan)
      ?? run.sourceStatementSpanById.get(fragment.sourceId)
      ?? fragment.sourceSpan;
    const materialized = materializeFragmentForCurrentSource(
      fragment,
      currentSourceSpan,
      run.source,
      sourceFingerprint
    );
    elements.push(...materialized.elements);
    editHandles.push(...materialized.editHandles);
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

  return {
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
}

function createStatementFragment(
  evaluated: ReturnType<typeof evaluateSemanticStatementByIndex>
): SemanticStatementFragment {
  return {
    statementId: evaluated.statementId,
    sourceId: evaluated.sourceId,
    sourceSpan: { ...evaluated.sourceSpan },
    sourceFingerprint: evaluated.elements[0]?.sourceRef.sourceFingerprint ?? evaluated.editHandles[0]?.sourceRef.sourceFingerprint ?? "",
    elements: evaluated.elements,
    editHandles: evaluated.editHandles,
    diagnostics: evaluated.diagnostics,
    effectSummary: evaluated.effectSummary
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
  const trigger = hints.trigger ?? "other";
  if (trigger !== "drag-element" && trigger !== "drag-handle") {
    return "non-drag-trigger";
  }
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

function assignFeatureUsage(target: FeatureUsage, source: FeatureUsage): void {
  for (const key of Object.keys(target)) {
    target[key] = source[key] ?? target[key];
  }
}

function mergeFeatureUsageAfterSelectiveReplay(
  previousFinal: FeatureUsage,
  replayStart: FeatureUsage,
  replayCurrent: FeatureUsage
): FeatureUsage {
  const merged = cloneFeatureUsage(previousFinal);
  for (const key of Object.keys(merged)) {
    const current = replayCurrent[key];
    if (current == null || current === replayStart[key]) {
      continue;
    }
    merged[key] = current;
  }
  return merged;
}

function mergeSelectiveDependencies(
  rebuilt: EvaluateTikzResult["dependencies"],
  previous: EvaluateTikzResult["dependencies"],
  suffixSourceIds: readonly string[],
  recomputedSourceIds: readonly string[]
): EvaluateTikzResult["dependencies"] {
  const recomputedSourceIdSet = new Set(recomputedSourceIds);
  if (suffixSourceIds.length === 0 && previous.nodes.length === 0) {
    return rebuilt;
  }

  const nodesById = new Map(rebuilt.nodes.map((node) => [node.id, node]));
  const edgesByKey = new Map(rebuilt.edges.map((edge) => [dependencyEdgeKey(edge), edge]));
  const previousNodeById = new Map(previous.nodes.map((node) => [node.id, node]));

  for (const node of previous.nodes) {
    if (node.kind === "source" && !recomputedSourceIdSet.has(node.sourceId)) {
      nodesById.set(node.id, node);
    }
  }

  for (const edge of previous.edges) {
    const fromNode = previousNodeById.get(edge.from);
    const toNode = previousNodeById.get(edge.to);
    const touchesRecomputedSource =
      (fromNode?.kind === "source" && recomputedSourceIdSet.has(fromNode.sourceId)) ||
      (toNode?.kind === "source" && recomputedSourceIdSet.has(toNode.sourceId));
    if (touchesRecomputedSource) {
      continue;
    }
    const touchesSuffixSource =
      (fromNode?.kind === "source" && !recomputedSourceIdSet.has(fromNode.sourceId)) ||
      (toNode?.kind === "source" && !recomputedSourceIdSet.has(toNode.sourceId));
    if (!touchesSuffixSource) {
      continue;
    }
    const resourceNode = fromNode?.kind === "resource" ? fromNode : toNode?.kind === "resource" ? toNode : null;
    if (resourceNode) {
      nodesById.set(resourceNode.id, resourceNode);
    }
    edgesByKey.set(dependencyEdgeKey(edge), edge);
  }

  return {
    nodes: [...nodesById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edgesByKey.values()].sort((left, right) => {
      const leftKey = dependencyEdgeKey(left);
      const rightKey = dependencyEdgeKey(right);
      return leftKey.localeCompare(rightKey);
    })
  };
}

function dependencyEdgeKey(edge: EvaluateTikzResult["dependencies"]["edges"][number]): string {
  return `${edge.category}\u0000${edge.relation}\u0000${edge.from}\u0000${edge.to}`;
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

function retargetElementsSourceFingerprint(
  elements: SceneElement[],
  sourceFingerprint: string
): SceneElement[] {
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (!element || element.sourceRef.sourceFingerprint === sourceFingerprint) {
      continue;
    }
    elements[index] = {
      ...element,
      layer: element.layer || MAIN_SCENE_LAYER,
      sourceRef: {
        ...element.sourceRef,
        sourceFingerprint
      }
    };
  }
  return elements;
}

function retargetHandlesSourceFingerprint(
  handles: EditHandle[],
  sourceFingerprint: string
): EditHandle[] {
  for (let index = 0; index < handles.length; index += 1) {
    const handle = handles[index];
    if (!handle || handle.sourceRef.sourceFingerprint === sourceFingerprint) {
      continue;
    }
    handles[index] = {
      ...handle,
      sourceRef: {
        ...handle.sourceRef,
        sourceFingerprint
      }
    };
  }
  return handles;
}

function materializeFragmentForCurrentSource(
  fragment: SemanticStatementFragment,
  currentSourceSpan: Span,
  source: string,
  sourceFingerprint: string
): Pick<SemanticStatementFragment, "elements" | "editHandles"> {
  if (fragment.sourceFingerprint === sourceFingerprint) {
    return {
      elements: fragment.elements,
      editHandles: fragment.editHandles
    };
  }

  const delta = currentSourceSpan.from - fragment.sourceSpan.from;
  const elements = structuredClone(fragment.elements);
  shiftSpansDeep(elements, delta);
  retargetElementsSourceFingerprint(elements, sourceFingerprint);

  const editHandles = structuredClone(fragment.editHandles);
  shiftSpansDeep(editHandles, delta);
  retargetHandlesSourceFingerprint(editHandles, sourceFingerprint);
  for (let index = 0; index < editHandles.length; index += 1) {
    const handle = editHandles[index];
    if (!handle) {
      continue;
    }
    editHandles[index] = {
      ...handle,
      sourceText: source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to)
    };
  }
  return {
    elements,
    editHandles
  };
}

function materializeFragmentsForCache(
  previousSource: string,
  currentSource: string,
  fragments: readonly SemanticStatementFragment[],
  sourceFingerprint: string
): SemanticStatementFragment[] {
  return fragments.map((fragment) => {
    const currentSourceSpan =
      locateCurrentSpan(previousSource, currentSource, fragment.sourceSpan)
      ?? fragment.sourceSpan;
    if (fragment.sourceFingerprint === sourceFingerprint) {
      return {
        ...fragment,
        sourceSpan: { ...currentSourceSpan }
      };
    }

    const materialized = materializeFragmentForCurrentSource(
      fragment,
      currentSourceSpan,
      currentSource,
      sourceFingerprint
    );
    const diagnostics = structuredClone(fragment.diagnostics);
    shiftSpansDeep(diagnostics, currentSourceSpan.from - fragment.sourceSpan.from);
    return {
      ...fragment,
      sourceSpan: { ...currentSourceSpan },
      sourceFingerprint,
      elements: materialized.elements,
      editHandles: materialized.editHandles,
      diagnostics
    };
  });
}

function locateCurrentSpan(previousSource: string, currentSource: string, previousSpan: Span): Span | null {
  const text = previousSource.slice(previousSpan.from, previousSpan.to);
  if (text.length === 0) {
    return null;
  }
  const exact = currentSource.indexOf(text, Math.max(0, previousSpan.from - 32));
  if (exact >= 0) {
    return { from: exact, to: exact + text.length };
  }
  const fallback = currentSource.indexOf(text);
  return fallback >= 0 ? { from: fallback, to: fallback + text.length } : null;
}

function shiftSpansDeep<T>(value: T, delta: number): T {
  if (delta === 0) {
    return value;
  }
  shiftSpanObjectsInPlace(value, delta, new WeakSet<object>());
  return value;
}

function shiftSpanObjectsInPlace(
  value: unknown,
  delta: number,
  visited: WeakSet<object>
): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (visited.has(value)) {
    return;
  }
  visited.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      shiftSpanObjectsInPlace(entry, delta, visited);
    }
    return;
  }
  if (isSpanLike(value)) {
    value.from += delta;
    value.to += delta;
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "identityRef" || (key === "rawOptions" && hasGeneratedStyleSourceRef(value))) {
      continue;
    }
    shiftSpanObjectsInPlace(entry, delta, visited);
  }
}

function hasGeneratedStyleSourceRef(value: object): boolean {
  const sourceRef = (value as { sourceRef?: { identityRef?: unknown } }).sourceRef;
  return sourceRef?.identityRef != null;
}

function isSpanLike(value: object): value is Span {
  return (
    "from" in value &&
    "to" in value &&
    typeof (value as { from?: unknown }).from === "number" &&
    typeof (value as { to?: unknown }).to === "number" &&
    Object.keys(value).every((key) => key === "from" || key === "to")
  );
}
