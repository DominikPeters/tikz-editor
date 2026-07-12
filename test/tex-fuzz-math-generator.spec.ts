import { describe, expect, it } from "vitest";
import { parseTexMath } from "@tikz-editor/core/text/tex/math/index.js";
import { replayTexFuzzCase } from "../packages/tex-fuzz/src/case-format.js";
import { measureTexFuzzCoverage } from "../packages/tex-fuzz/src/coverage.js";
import { TEX_FUZZ_FEATURE_DEFINITIONS } from "../packages/tex-fuzz/src/features.js";
import { generateTexFuzzCase } from "../packages/tex-fuzz/src/generate.js";
import {
  generateTexMathFuzzCase,
  generateTexMathFuzzTexCase,
} from "../packages/tex-fuzz/src/generate-math.js";
import { applyTexFuzzMutations, printTexFuzzAst } from "../packages/tex-fuzz/src/print.js";

describe("adversarial TeX math generator", () => {
  it("is deterministic and produces bounded valid parser inputs", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const first = generateTexMathFuzzCase(seed, { depth: 4 });
      expect(generateTexMathFuzzCase(seed, { depth: 4 })).toEqual(first);
      expect(first.source.length).toBeLessThan(20_000);
      const parsed = parseTexMath(first.source);
      expect(parsed.list.sourceSpan).toEqual({ start: 0, end: first.source.length });
      expect(first.choices.length).toBeGreaterThan(0);
    }
  });

  it("generates varied structural feature combinations", () => {
    const features = new Set(
      Array.from({ length: 500 }, (_, seed) => generateTexMathFuzzCase(seed).features).flat()
    );
    expect([...features]).toEqual(expect.arrayContaining([
      "math.fraction",
      "math.radical",
      "math.script",
      "math.accent.widehat",
      "math.accent.widetilde",
      "math.alphabet.mathbb",
      "math.alphabet.mathfrak",
      "math.alphabet.boldsymbol",
      "math.stackrel",
      "math.matrix",
      "math.xarrow",
    ]));
  });

  it("records deterministic malformed damage", () => {
    const cases = Array.from({ length: 100 }, (_, seed) => generateTexMathFuzzCase(seed, { malformed: true }));
    expect(cases.every((item) => item.malformed)).toBe(true);
    expect(new Set(cases.map((item) => item.source)).size).toBeGreaterThan(80);
    for (const item of cases) {
      expect(() => parseTexMath(item.source)).not.toThrow();
    }
  });

  it("embeds recursive math in the versioned shared case with nested source spans", () => {
    const caseData = generateTexMathFuzzTexCase(31, { depth: 5 });
    expect(generateTexMathFuzzTexCase(31, { depth: 5 })).toEqual(caseData);
    expect(caseData.source).toBe(printTexFuzzAst(caseData.ast).source);
    expect(caseData.sourceMap.some((span) => span.kind.startsWith("math."))).toBe(true);
    expect(caseData.sourceMap.every((span) =>
      span.start >= 0 && span.end >= span.start && span.end <= caseData.source.length
    )).toBe(true);

    const roundTrip = JSON.parse(JSON.stringify(caseData)) as typeof caseData;
    expect(replayTexFuzzCase(roundTrip)).toEqual(caseData);
    expect(caseData.features.every((feature) => TEX_FUZZ_FEATURE_DEFINITIONS[feature] !== undefined)).toBe(true);
    const coverage = measureTexFuzzCoverage([caseData]);
    expect(coverage.nodeKindCounts.math).toBe(1);
    expect(Object.keys(coverage.nodeKindCounts).some((kind) => kind !== "math")).toBe(true);
  });

  it("records malformed math as replayable source mutations", () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const caseData = generateTexMathFuzzTexCase(seed, { malformed: true });
      const validSource = printTexFuzzAst(caseData.ast).source;
      expect(caseData.mutations.length).toBe(1);
      expect(applyTexFuzzMutations(validSource, caseData.mutations)).toBe(caseData.source);
      expect(generateTexMathFuzzTexCase(seed, { malformed: true })).toEqual(caseData);
    }
  });

  it("uses recursive math nodes in general shared generation", () => {
    const generated = Array.from({ length: 100 }, (_, seed) =>
      generateTexFuzzCase(seed, { profile: "aggressive", depth: 4, size: 8 })
    );
    const mathNodes = generated.flatMap((caseData) => caseData.ast).filter((node) => node.kind === "math");
    expect(mathNodes.length).toBeGreaterThan(0);
    expect(mathNodes.every((node) => node.body !== undefined)).toBe(true);
    expect(generated.some((caseData) => caseData.features.includes("math.node.fraction"))).toBe(true);
  });
});
