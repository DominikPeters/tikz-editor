import { describe, expect, it } from "vitest";
import { layoutSimpleTexParagraph, createTexDerivedInlineMathBoxProvider } from "@tikz-editor/core/text/tex/index.js";
import { caseFromTexFuzzAst, texFuzzBoundaryWidths, checkTexFuzzBoundaryInvariants,
  checkTexFuzzMetamorphicInvariants, generateFullySupportedTexFuzzCases } from "@tikz-editor/tex-fuzz";

describe("measured TeX fuzz boundaries", () => {
  it("probes both sides of measured prose and math widths", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha $\frac{x}{y}$ Omega`, {
      width: 480, mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    const widths = texFuzzBoundaryWidths(result.report!);
    expect(widths.length).toBeGreaterThanOrEqual(6);
    for (let index = 0; index < widths.length; index += 3) {
      expect(widths[index + 1] - widths[index]).toBeCloseTo(1 / 1024, 8);
      expect(widths[index + 2] - widths[index + 1]).toBeCloseTo(1 / 1024, 8);
    }
  });

  it("checks generated supported cases around their actual thresholds and under source shifts", () => {
    for (const caseData of generateFullySupportedTexFuzzCases(79_001, { count: 16 }).cases) {
      expect(checkTexFuzzBoundaryInvariants(caseData), caseData.source).toEqual([]);
      expect(checkTexFuzzMetamorphicInvariants(caseData, { widths: [48, 160] }).findings, caseData.source).toEqual([]);
    }
  }, 30_000);

  it("preserves a mixed document's paint and attribution after a leading comment", () => {
    const caseData = caseFromTexFuzzAst([
      { kind: "text", value: "Before" }, { kind: "paragraph-break", command: "par" },
      { kind: "display-math", delimiter: "bracket", body: { kind: "script", base: { kind: "atom", value: "x" }, superscript: { kind: "atom", value: "2" } } },
      { kind: "environment", name: "quote", children: [{ kind: "text", value: "After" }] },
    ], { profile: "document" });
    expect(checkTexFuzzBoundaryInvariants(caseData)).toEqual([]);
    expect(checkTexFuzzMetamorphicInvariants(caseData, { widths: [48, 160] }).findings).toEqual([]);
  });
});
