import { caseFromTexFuzzAst } from "./generate.js";
import { sameTexFuzzFingerprint } from "./fingerprint.js";
import type {
  TexFuzzCase,
  TexFuzzNode,
  TexFuzzObservation,
} from "./model.js";

export interface TexFuzzShrinkBudget {
  readonly maxCandidates?: number;
  readonly maxOracleEvaluations?: number;
  readonly maxTimeMs?: number;
}

export interface TexFuzzShrinkResult {
  readonly minimizedCase: TexFuzzCase;
  readonly candidatesEvaluated: number;
  readonly oracleEvaluations: number;
  readonly termination: "minimal" | "candidate-budget" | "oracle-budget" | "time-budget";
}

export type TexFuzzShrinkPredicate = (
  candidates: readonly TexFuzzCase[],
  context: TexFuzzShrinkPredicateContext
) => Promise<TexFuzzShrinkBatchResult>;

export interface TexFuzzShrinkPredicateContext {
  /** The most oracle evaluations this batch may spend. Local evaluations are unlimited by this field. */
  readonly maxOracleEvaluations: number;
}

export interface TexFuzzShrinkBatchEvaluation {
  readonly observations: readonly (TexFuzzObservation | null)[];
  /** Actual external-oracle work. Pure local predicates report zero. */
  readonly oracleEvaluations: number;
  /** Set when more oracle work was required but disallowed by the supplied context. */
  readonly oracleBudgetExhausted?: boolean;
}

/** A bare observation array is retained for compatibility and denotes local-only evaluation. */
export type TexFuzzShrinkBatchResult =
  | readonly (TexFuzzObservation | null)[]
  | TexFuzzShrinkBatchEvaluation;

function isShrinkBatchEvaluation(result: TexFuzzShrinkBatchResult): result is TexFuzzShrinkBatchEvaluation {
  return !Array.isArray(result);
}

function replaceAt(nodes: readonly TexFuzzNode[], index: number, replacements: readonly TexFuzzNode[]): readonly TexFuzzNode[] {
  return [...nodes.slice(0, index), ...replacements, ...nodes.slice(index + 1)];
}

function nodeCandidates(node: TexFuzzNode): readonly TexFuzzNode[] {
  const candidates: TexFuzzNode[] = [];
  if (node.kind === "text" && node.value !== "x") {
    candidates.push({ kind: "text", value: "x" });
  }
  if (node.kind === "math" && node.content !== "x") {
    candidates.push({ kind: "math", content: "x" });
  }
  if ("children" in node) {
    if (node.children.length === 1) {
      candidates.push(node.children[0]);
    }
    for (let index = 0; index < node.children.length; index += 1) {
      if (node.children.length > 1) {
        const without = node.children.filter((_, childIndex) => childIndex !== index);
        candidates.push({ ...node, children: without });
      }
      for (const childCandidate of nodeCandidates(node.children[index])) {
        candidates.push({ ...node, children: replaceAt(node.children, index, [childCandidate]) });
      }
    }
  }
  return candidates;
}

function rawStringCandidates(caseData: TexFuzzCase): readonly TexFuzzCase[] {
  if (caseData.mutations.length === 0) {
    return [];
  }
  const offsets = new Set<number>([0]);
  const source = caseData.source;
  for (let divisor = 2; divisor <= source.length; divisor *= 2) {
    offsets.add(Math.floor(source.length / divisor));
  }
  for (let offset = Math.max(0, source.length - 8); offset < source.length; offset += 1) {
    offsets.add(offset);
  }
  return [...offsets]
    .filter((offset) => offset < source.length)
    .map((offset) => ({
      ...caseData,
      source: source.slice(0, offset),
      sourceMap: caseData.sourceMap
        .filter((span) => span.start <= offset)
        .map((span) => ({ ...span, end: Math.min(span.end, offset) })),
      mutations: [...caseData.mutations, { kind: "truncate" as const, offset }],
    }));
}

export function texFuzzShrinkCandidates(caseData: TexFuzzCase): readonly TexFuzzCase[] {
  const candidates: TexFuzzCase[] = [];
  for (let index = 0; index < caseData.ast.length; index += 1) {
    if (caseData.ast.length > 1) {
      candidates.push(caseFromTexFuzzAst(caseData.ast.filter((_, itemIndex) => itemIndex !== index), {
        seed: caseData.seed,
        profile: caseData.profile,
      }));
    }
    for (const candidate of nodeCandidates(caseData.ast[index])) {
      candidates.push(caseFromTexFuzzAst(replaceAt(caseData.ast, index, [candidate]), {
        seed: caseData.seed,
        profile: caseData.profile,
      }));
    }
  }
  candidates.push(...rawStringCandidates(caseData));
  const unique = new Map(
    candidates
      .filter((candidate) => candidate.source.length < caseData.source.length)
      .map((candidate) => [candidate.source, candidate])
  );
  return [...unique.values()].sort((left, right) => left.source.length - right.source.length || left.source.localeCompare(right.source));
}

export async function shrinkTexFuzzCase(
  original: TexFuzzCase,
  expected: TexFuzzObservation,
  predicate: TexFuzzShrinkPredicate,
  budget: TexFuzzShrinkBudget = {}
): Promise<TexFuzzShrinkResult> {
  const started = Date.now();
  const maxCandidates = budget.maxCandidates ?? 500;
  const maxOracleEvaluations = budget.maxOracleEvaluations ?? Number.POSITIVE_INFINITY;
  const maxTimeMs = budget.maxTimeMs ?? 30_000;
  let current = original;
  let candidatesEvaluated = 0;
  let oracleEvaluations = 0;

  while (true) {
    if (Date.now() - started >= maxTimeMs) {
      return { minimizedCase: current, candidatesEvaluated, oracleEvaluations, termination: "time-budget" };
    }
    const candidates = texFuzzShrinkCandidates(current);
    if (candidates.length === 0) {
      return { minimizedCase: current, candidatesEvaluated, oracleEvaluations, termination: "minimal" };
    }
    const remainingCandidates = maxCandidates - candidatesEvaluated;
    if (remainingCandidates <= 0) {
      return { minimizedCase: current, candidatesEvaluated, oracleEvaluations, termination: "candidate-budget" };
    }
    const remainingOracle = Math.max(0, maxOracleEvaluations - oracleEvaluations);
    const batch = candidates.slice(0, remainingCandidates);
    const result = await predicate(batch, { maxOracleEvaluations: remainingOracle });
    const observations = isShrinkBatchEvaluation(result) ? result.observations : result;
    const batchOracleEvaluations = isShrinkBatchEvaluation(result) ? result.oracleEvaluations : 0;
    if (observations.length !== batch.length) {
      throw new Error(`Shrink predicate returned ${observations.length} observations for ${batch.length} candidates.`);
    }
    if (!Number.isSafeInteger(batchOracleEvaluations) || batchOracleEvaluations < 0) {
      throw new Error(`Shrink predicate returned invalid oracle evaluation count ${batchOracleEvaluations}.`);
    }
    if (batchOracleEvaluations > remainingOracle) {
      throw new Error(
        `Shrink predicate spent ${batchOracleEvaluations} oracle evaluations with only ${remainingOracle} remaining.`
      );
    }
    candidatesEvaluated += batch.length;
    oracleEvaluations += batchOracleEvaluations;
    const preservedIndex = observations.findIndex((observation) =>
      observation !== null && sameTexFuzzFingerprint(observation.fingerprint, expected.fingerprint)
    );
    if (preservedIndex < 0) {
      if (batch.length < candidates.length) {
        return { minimizedCase: current, candidatesEvaluated, oracleEvaluations, termination: "candidate-budget" };
      }
      if (isShrinkBatchEvaluation(result) && result.oracleBudgetExhausted) {
        return { minimizedCase: current, candidatesEvaluated, oracleEvaluations, termination: "oracle-budget" };
      }
      if (
        batchOracleEvaluations > 0
        && batchOracleEvaluations === remainingOracle
        && Number.isFinite(maxOracleEvaluations)
      ) {
        return { minimizedCase: current, candidatesEvaluated, oracleEvaluations, termination: "oracle-budget" };
      }
      return { minimizedCase: current, candidatesEvaluated, oracleEvaluations, termination: "minimal" };
    }
    current = batch[preservedIndex];
  }
}
