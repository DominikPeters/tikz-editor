import { describe, expect, it } from "vitest";
import {
  adaptTexFuzzWeights,
  caseFromTexFuzzAst,
  generateTexFuzzCase,
  measureTexFuzzCoverage,
  mergeTexFuzzCoverage,
  normalizeTexFuzzWeights,
  pickWeightedTexFuzzValue,
  sampleTexFuzzProfileBudget,
  TEX_FUZZ_FEATURE_DEFINITIONS,
  TEX_FUZZ_EXPLICIT_EXCLUSIONS,
  TEX_FUZZ_PROFILES,
  texFuzzCombinationKey,
  texFuzzRegistryAccounting,
  TexFuzzRandom,
} from "@tikz-editor/tex-fuzz";

describe("TeX fuzz semantic coverage", () => {
  it("keeps production registry accounting exhaustive and reviewable", () => {
    const accounting = texFuzzRegistryAccounting();
    expect(accounting.missing).toEqual([]);
    expect(accounting.staleExclusions).toEqual([]);
    expect(new Set([...accounting.generated, ...accounting.excluded])).toEqual(new Set(accounting.production));
    expect(accounting.generated).toContain("font-command:textbf");
    expect(accounting.generated).toContain("font-command:texttt");
    expect(accounting.generated).toContain("control-kind:environment-boundary");
    expect(accounting.generated).toContain("display-delimiter:flalign");
    expect(accounting.generated).toContain("display-delimiter:flalign-star");
    expect(accounting.excluded).toEqual([
      "control-kind:unsupported-command",
      "inline-kind:includegraphics",
      "inline-kind:literal",
    ]);
    expect(Object.keys(TEX_FUZZ_EXPLICIT_EXCLUSIONS)).toHaveLength(3);
  });

  it("defines every feature reached by aggressive and document generation", () => {
    for (const profile of ["aggressive", "document"] as const) {
      for (let seed = 0; seed < 25; seed += 1) {
        for (const feature of generateTexFuzzCase(seed, { profile }).features) {
          expect(TEX_FUZZ_FEATURE_DEFINITIONS[feature], `${profile} feature ${feature}`).toBeDefined();
        }
      }
    }
  }, 15_000);

  it("counts feature combinations, generic node depth, boundaries, and Unicode", () => {
    const composed = caseFromTexFuzzAst([
      {
        kind: "font",
        command: "textbf",
        children: [{ kind: "group", children: [{ kind: "text", value: "café" }] }],
      },
      { kind: "math", content: "Ω_i" },
    ]);
    const decomposed = {
      features: ["future.feature", "text.literal"],
      ast: [{ kind: "future-node", children: [] }],
      source: "cafe\u0301",
    };
    const coverage = measureTexFuzzCoverage([composed, decomposed]);

    expect(coverage.caseCount).toBe(2);
    expect(coverage.featureCounts["text.literal"]).toBe(2);
    expect(coverage.featurePairCounts[texFuzzCombinationKey(["math.inline", "text.bold"])]).toBe(1);
    expect(coverage.featureTripleCounts[texFuzzCombinationKey(["math.inline", "text.bold", "text.group"])]).toBe(1);
    expect(coverage.nodeKindCounts["future-node"]).toBe(1);
    expect(coverage.nodeDepthCounts["text@2"]).toBe(1);
    expect(coverage.maximumDepthCounts["2"]).toBe(1);
    expect(coverage.boundaryCounts["children:future-node:empty"]).toBe(1);
    expect(coverage.boundaryCounts["token:control-sequence"]).toBeGreaterThan(0);
    expect(coverage.unicodeBlockCounts["Greek and Coptic"]).toBe(1);
    expect(coverage.unicodeBlockCounts["Combining Diacritical Marks"]).toBe(1);
    expect(coverage.unicodeNormalizationCounts.NFC).toBe(1);
    expect(coverage.unicodeNormalizationCounts.NFD).toBe(1);
  });

  it("merges independently measured reports without changing their keys", () => {
    const first = measureTexFuzzCoverage([{ features: ["a"], ast: [], source: "x" }]);
    const second = measureTexFuzzCoverage([{ features: ["a", "b"], ast: [], source: "β" }]);
    const merged = mergeTexFuzzCoverage([first, second]);
    expect(merged.caseCount).toBe(2);
    expect(merged.featureCounts).toEqual({ a: 2, b: 1 });
    expect(merged.featurePairCounts).toEqual({ '["a","b"]': 1 });
  });
});

describe("TeX fuzz integer profiles", () => {
  it("normalizes floating configuration deterministically with an exact sum", () => {
    const weights = normalizeTexFuzzWeights({ b: 0.25, a: 0.25, c: 0.5 }, 11);
    expect(weights).toEqual({ a: 3, b: 3, c: 5 });
    expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBe(11);
    expect(Object.values(TEX_FUZZ_PROFILES["vertical-slice"].weights).reduce((sum, weight) => sum + weight, 0))
      .toBe(10_000);
    for (const profile of Object.values(TEX_FUZZ_PROFILES)) {
      expect(Object.values(profile.weights).reduce((sum, weight) => sum + weight, 0), profile.id).toBe(10_000);
    }
    expect(TEX_FUZZ_PROFILES.document.weights["document.environment.itemize"]).toBeGreaterThan(0);
    expect(TEX_FUZZ_PROFILES.aggressive.weights["document.environment.itemize"]).toBeUndefined();
    expect(TEX_FUZZ_PROFILES.malformed.weights["text.line-break"])
      .toBeGreaterThan(TEX_FUZZ_PROFILES["vertical-slice"].weights["text.line-break"] ?? 0);
  });

  it("selects only through recorded integer decisions", () => {
    const first = new TexFuzzRandom(17);
    const second = new TexFuzzRandom(17);
    const choices = [{ value: "a", weight: 2 }, { value: "b", weight: 7 }] as const;
    expect(pickWeightedTexFuzzValue(first, "feature", choices)).toBe(pickWeightedTexFuzzValue(second, "feature", choices));
    expect(first.choices()).toEqual([{ path: "feature", upperExclusive: 9, value: first.choices()[0].value }]);
  });

  it("boosts unseen features using integer-only adaptive weights", () => {
    const adapted = adaptTexFuzzWeights({ seen: 100, unseen: 100 }, { seen: 99 }, { noveltyBudget: 10, scale: 1000 });
    expect(adapted.unseen).toBeGreaterThan(adapted.seen);
    expect(adapted.seen + adapted.unseen).toBe(1000);
    expect(Object.values(adapted).every(Number.isSafeInteger)).toBe(true);
  });

  it("uses profile weights for generated node selection", () => {
    let canaryOracleCases = 0;
    let aggressiveOracleCases = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      if (generateTexFuzzCase(seed, { profile: "canary", depth: 2, size: 3 }).features.includes("oracle.supported-command")) {
        canaryOracleCases += 1;
      }
      if (generateTexFuzzCase(seed, { profile: "aggressive", depth: 2, size: 3 }).features.includes("oracle.supported-command")) {
        aggressiveOracleCases += 1;
      }
    }
    expect(canaryOracleCases).toBeGreaterThan(200);
    expect(aggressiveOracleCases).toBe(0);
  });

  it("feeds accumulated coverage back into deterministic generation", () => {
    const observedLineBreaks = { "text.line-break": 100_000 };
    let baselineLineBreakCases = 0;
    let adaptedLineBreakCases = 0;
    for (let seed = 0; seed < 500; seed += 1) {
      if (generateTexFuzzCase(seed, { profile: "aggressive", depth: 3, size: 4 }).features.includes("text.line-break")) {
        baselineLineBreakCases += 1;
      }
      const first = generateTexFuzzCase(seed, {
        profile: "aggressive",
        depth: 3,
        size: 4,
        coverageFeedback: observedLineBreaks,
      });
      const replay = generateTexFuzzCase(seed, {
        profile: "aggressive",
        depth: 3,
        size: 4,
        coverageFeedback: observedLineBreaks,
      });
      expect(replay).toEqual(first);
      if (first.features.includes("text.line-break")) adaptedLineBreakCases += 1;
    }
    expect(adaptedLineBreakCases).toBeLessThan(baselineLineBreakCases / 2);
  });

  it("samples deterministic bounded budgets with a reachable long tail", () => {
    const distribution = TEX_FUZZ_PROFILES.aggressive.size;
    const samples = Array.from({ length: 500 }, (_, seed) =>
      sampleTexFuzzProfileBudget(new TexFuzzRandom(seed), "size", distribution)
    );
    const replay = Array.from({ length: 500 }, (_, seed) =>
      sampleTexFuzzProfileBudget(new TexFuzzRandom(seed), "size", distribution)
    );
    expect(replay).toEqual(samples);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...samples)).toBeLessThanOrEqual(distribution.maximum);
    expect(samples.some((size) => size <= distribution.typical)).toBe(true);
    expect(samples.some((size) => size > distribution.typical * 2)).toBe(true);
  });
});
