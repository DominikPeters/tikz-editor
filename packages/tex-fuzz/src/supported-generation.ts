import {
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph,
} from "@tikz-editor/core/text/tex/index.js";
import { generateTexFuzzCase } from "./generate.js";
import type { TexFuzzCase, TexFuzzFeatureId } from "./model.js";

const noHyphenation = { hyphenate: (): number[] => [] };

export const TEX_FUZZ_SUPPORTED_GENERATION_WIDTHS = [48, 160, 480] as const;

export interface TexFuzzSupportClassification {
  readonly supported: boolean;
  readonly reason:
    | "fully-supported"
    | "fallback"
    | "unsupported"
    | "missing-report"
    | "literal-degradation"
    | "degraded-report"
    | "layout-errors"
    | "layout-exception";
  readonly width?: number;
  readonly detail?: string;
}

type TexFuzzLayoutResult = ReturnType<typeof layoutSimpleTexParagraph>;

/** Distinguishes a canonical native report from partial/literal degradation. */
export function classifyTexFuzzLayoutResultSupport(
  result: TexFuzzLayoutResult,
  width: number
): TexFuzzSupportClassification {
  if (!result.supported) return { supported: false, reason: "unsupported", width };
  if (result.fallbackReason !== null) {
    return { supported: false, reason: "fallback", width, detail: result.fallbackReason };
  }
  if (!result.report) return { supported: false, reason: "missing-report", width };
  const literal = result.report.lines.flatMap((line) => line.segments)
    .find((segment) => segment.literal !== undefined)?.literal;
  if (literal) {
    return {
      supported: false,
      reason: "literal-degradation",
      width,
      detail: literal.detail ? `${literal.reason}: ${literal.detail}` : literal.reason,
    };
  }
  if (result.report.internalMode !== "canonical"
    || result.report.internalDegradeReason !== null
    || result.report.externalFallbackUsed) {
    return {
      supported: false,
      reason: "degraded-report",
      width,
      detail: result.report.internalDegradeReason
        ?? (result.report.externalFallbackUsed ? "external fallback used" : result.report.internalMode),
    };
  }
  const errors = [...result.errors, ...result.report.errors];
  if (errors.length > 0) {
    return { supported: false, reason: "layout-errors", width, detail: errors.join("; ") };
  }
  return { supported: true, reason: "fully-supported" };
}

/**
 * Production support classification used by support-aware generation.
 * A case is accepted only when the renderer handles it without fallback at
 * every hard-invariant width, so the quota cannot be filled with cases whose
 * interesting branch disappears at a convenient single width.
 */
export function classifyTexFuzzNativeSupport(caseData: TexFuzzCase): TexFuzzSupportClassification {
  const mathBoxProvider = createTexDerivedInlineMathBoxProvider();
  for (const width of TEX_FUZZ_SUPPORTED_GENERATION_WIDTHS) {
    try {
      const result = layoutSimpleTexParagraph(caseData.source, {
        width,
        fallbackPolicy: "placeholder",
        hyphenator: noHyphenation,
        mathBoxProvider,
      });
      const classification = classifyTexFuzzLayoutResultSupport(result, width);
      if (!classification.supported) return classification;
    } catch (error) {
      return {
        supported: false,
        reason: "layout-exception",
        width,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { supported: true, reason: "fully-supported" };
}

export interface TexFuzzSupportedGenerationStats {
  readonly requested: number;
  readonly accepted: number;
  readonly attempts: number;
  readonly maximumAttempts: number;
  readonly rejectedUnsupported: number;
  readonly rejectedDuplicate: number;
  readonly distinctFeatureCount: number;
  readonly featureCounts: Readonly<Partial<Record<TexFuzzFeatureId, number>>>;
}

export interface TexFuzzSupportedGenerationResult {
  readonly cases: readonly TexFuzzCase[];
  readonly stats: TexFuzzSupportedGenerationStats;
}

export class TexFuzzSupportedQuotaError extends Error {
  readonly stats: TexFuzzSupportedGenerationStats;

  constructor(stats: TexFuzzSupportedGenerationStats) {
    super(`Generated ${stats.accepted}/${stats.requested} fully supported adversarial cases after ${stats.attempts}/${stats.maximumAttempts} attempts.`);
    this.name = "TexFuzzSupportedQuotaError";
    this.stats = stats;
  }
}

/**
 * Deterministically rejection-samples genuinely generated, fully supported
 * adversarial cases. Accepted feature counts feed back into subsequent
 * generation, favoring underrepresented syntax rather than merely filling the
 * quota with the easiest common shape.
 */
export function generateFullySupportedTexFuzzCases(
  seed: number,
  options: {
    readonly count: number;
    readonly maximumAttempts?: number;
    readonly adaptiveNoveltyBudget?: number;
  }
): TexFuzzSupportedGenerationResult {
  const { count } = options;
  const maximumAttempts = options.maximumAttempts ?? Math.max(256, count * 128);
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(count) || count < 0
    || !Number.isSafeInteger(maximumAttempts) || maximumAttempts < count) {
    throw new RangeError("Supported generation requires a safe seed, non-negative count, and maximumAttempts >= count.");
  }
  const cases: TexFuzzCase[] = [];
  const sources = new Set<string>();
  const featureCounts: Partial<Record<TexFuzzFeatureId, number>> = {};
  let rejectedUnsupported = 0;
  let rejectedDuplicate = 0;
  let attempts = 0;
  while (cases.length < count && attempts < maximumAttempts) {
    const candidate = generateTexFuzzCase(seed + attempts, {
      profile: "supported-aggressive",
      coverageFeedback: attempts === 0 ? undefined : featureCounts,
      adaptiveNoveltyBudget: options.adaptiveNoveltyBudget,
    });
    attempts += 1;
    if (!classifyTexFuzzNativeSupport(candidate).supported) {
      rejectedUnsupported += 1;
      continue;
    }
    if (sources.has(candidate.source)) {
      rejectedDuplicate += 1;
      continue;
    }
    sources.add(candidate.source);
    cases.push(candidate);
    for (const feature of candidate.features) featureCounts[feature] = (featureCounts[feature] ?? 0) + 1;
  }
  const stats: TexFuzzSupportedGenerationStats = {
    requested: count,
    accepted: cases.length,
    attempts,
    maximumAttempts,
    rejectedUnsupported,
    rejectedDuplicate,
    distinctFeatureCount: Object.keys(featureCounts).length,
    featureCounts,
  };
  if (cases.length !== count) throw new TexFuzzSupportedQuotaError(stats);
  return { cases, stats };
}
