import { describe, expect, it } from "vitest";
import {
  classifyTexFuzzNativeSupport,
  classifyTexFuzzLayoutResultSupport,
  caseFromTexFuzzAst,
  generateFullySupportedTexFuzzCases,
  TexFuzzSupportedQuotaError,
} from "../packages/tex-fuzz/src/index.js";
import { texLength } from "../packages/core/src/text/tex/coordinates.js";

describe("support-aware TeX fuzz generation", () => {
  it("rejects literal-degraded output even when the top-level result claims support", () => {
    const degraded = caseFromTexFuzzAst([
      { kind: "text", value: "Alpha" },
      { kind: "oracle-command", command: "TeX" },
      { kind: "text", value: "Beta" },
    ]);
    expect(classifyTexFuzzNativeSupport(degraded)).toMatchObject({
      supported: false,
      reason: "literal-degradation",
      width: 48,
    });
  });

  it("rejects noncanonical and externally-fallback report markers", () => {
    const canonical = {
      supported: true,
      fallbackReason: null,
      errors: [],
      shapedRuns: new Map(),
      report: {
        paragraphId: "mutation",
        width: texLength(160),
        alignment: "ragged-right" as const,
        layoutMode: "wrap" as const,
        lines: [],
        runs: [],
        errors: [],
        internalMode: "degraded" as const,
        internalDegradeReason: "mutation",
        externalFallbackUsed: true,
        linebreakingMode: "feasible" as const,
      },
    };
    expect(classifyTexFuzzLayoutResultSupport(canonical, 160)).toMatchObject({
      supported: false,
      reason: "degraded-report",
      detail: "mutation",
    });
  });

  it("is deterministic, including rejection statistics", () => {
    const first = generateFullySupportedTexFuzzCases(20_260_712, { count: 12 });
    const replay = generateFullySupportedTexFuzzCases(20_260_712, { count: 12 });
    expect(replay).toEqual(first);
  });

  it("fills the quota with distinct, genuinely generated, fully supported cases", () => {
    const result = generateFullySupportedTexFuzzCases(20_260_712, { count: 16 });
    expect(result.cases).toHaveLength(16);
    expect(new Set(result.cases.map((caseData) => caseData.source))).toHaveLength(16);
    expect(result.cases.every((caseData) => caseData.profile === "supported-aggressive")).toBe(true);
    expect(result.cases.every((caseData) => classifyTexFuzzNativeSupport(caseData).supported)).toBe(true);
    expect(result.stats.distinctFeatureCount).toBeGreaterThanOrEqual(60);
    expect(result.cases.some((caseData) => caseData.features.includes("math.inline"))).toBe(true);
    expect(result.cases.some((caseData) => caseData.features.some((feature) => feature.startsWith("box.")))).toBe(true);
    expect(result.cases.some((caseData) => caseData.features.some((feature) => feature.startsWith("text.font")))).toBe(true);
  });

  it("fails explicitly with auditable statistics when its bounded budget is exhausted", () => {
    expect.assertions(4);
    try {
      generateFullySupportedTexFuzzCases(1, { count: 1, maximumAttempts: 1 });
    } catch (error) {
      expect(error).toBeInstanceOf(TexFuzzSupportedQuotaError);
      const quotaError = error as TexFuzzSupportedQuotaError;
      expect(quotaError.stats).toMatchObject({ requested: 1, accepted: 0, attempts: 1, maximumAttempts: 1 });
      expect(quotaError.stats.rejectedUnsupported).toBe(1);
      expect(quotaError.message).toContain("0/1");
    }
  });
});
