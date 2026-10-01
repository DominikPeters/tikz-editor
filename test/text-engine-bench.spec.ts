import { describe, expect, it } from "vitest";
import type { NodeTextEngine, NodeTextRenderPayload } from "../packages/core/src/text/types.js";
import { createTexNodeTextEngine } from "../packages/core/src/text/tex-node-text-engine.js";
import { TEXT_ENGINE_BENCH_CASES, beamerBenchMathProfile, textBenchRequest } from "../scripts/lib/text-engine-bench-cases.js";
import { benchSample, checkBenchOutcome, parseBenchOptions, runTextEngineBenchCase } from "../scripts/lib/text-engine-bench.js";

/** A tiny bounded cache makes a delayed warm pass fail without a large test. */
function stubEngine(capacity = 2, body = '<g data-tex-linebox="true"/>'): NodeTextEngine {
  const cache = new Map<string, NodeTextRenderPayload>();
  return {
    validate: () => null,
    measure(request) {
      const cacheKey = request.text;
      let payload = cache.get(cacheKey);
      if (!payload) {
        payload = { cacheKey, body, viewBox: { x: 0, y: 0, width: 1, height: 1 }, graphicsPlacements: [] };
      }
      cache.delete(cacheKey);
      cache.set(cacheKey, payload);
      if (cache.size > capacity) cache.delete(cache.keys().next().value!);
      return { cacheKey, width: 1, height: 1, baselineY: 0, midLineY: 0, paragraphId: null, renderSourceText: request.text };
    },
    renderFromCache: (key) => cache.get(key) ?? null,
  };
}

describe("text engine benchmark integrity", () => {
  it("keeps more than 90 cold samples distinct, fixed length, and disjoint from warm-up", () => {
    const tokens = Array.from({ length: 2503 }, (_, index) => benchSample(index, 2500, 3).token);
    expect(new Set(tokens).size).toBe(2503);
    expect(new Set(tokens.map((token) => token.length)).size).toBe(1);
    expect(tokens[90]).not.toBe(tokens[0]);
    expect(benchSample(0, 2500, 4).token).not.toBe(tokens[0]);
  });

  it("keeps every warm measurement hot beyond cache capacity", () => {
    const result = runTextEngineBenchCase(stubEngine(), TEXT_ENGINE_BENCH_CASES[0], 100);
    expect(result.coldMs?.count).toBe(100);
    expect(result.warmMs?.count).toBe(100);
    expect(result.native).toBe(100);
    expect(result.nulls).toBe(0);
  });

  it("rejects a cold fixture that reuses a warm-up key", () => {
    expect(() => runTextEngineBenchCase(stubEngine(), {
      name: "invalid constant", group: "test", mode: "cold",
      steps: () => [{ request: textBenchRequest("constant") }],
    }, 2)).toThrow("cold request repeated a cache key");
  });

  it("rejects unexpected literal fallback, nulls, and missing feature markers", () => {
    const step = { request: textBenchRequest("test") };
    const literal = stubEngine(2, '<g data-tex-literal="malformed-input"/>');
    expect(() => checkBenchOutcome(literal, step, literal.measure(step.request), "test"))
      .toThrow("found a literal fallback");
    expect(() => checkBenchOutcome(literal, step, null, "test")).toThrow("received null");
    const native = stubEngine();
    expect(() => checkBenchOutcome(native, { ...step, requiredSvg: ['data-tex-inline-math="true"'] }, native.measure(step.request), "test"))
      .toThrow("missing SVG marker");
  });

  it("separates new edits from cached undo/redo revisits", () => {
    const result = runTextEngineBenchCase(stubEngine(100), {
      name: "edits", group: "test", mode: "sequence",
      steps: ({ token }) => [
        { request: textBenchRequest(token) },
        { request: textBenchRequest(token + "x") },
        { request: textBenchRequest(token), cache: "hit" },
      ],
    }, 3);
    expect(result.operations).toBe(9);
    expect(result.editMs?.count).toBe(6);
    expect(result.revisitMs?.count).toBe(3);
    expect(result.warmMs?.count).toBe(6);
    expect(result.coldMs).toBeNull();
  });

  it("rejects invalid or incomplete CLI options", () => {
    for (const value of ["0", "-1", "1.5", "NaN", "Infinity"]) {
      expect(() => parseBenchOptions(["--samples", value])).toThrow("positive safe integer");
    }
    expect(() => parseBenchOptions(["--json"])).toThrow("Missing value");
    expect(() => parseBenchOptions(["--only", "--list"])).toThrow("Missing value");
    expect(() => parseBenchOptions(["--unknown"])).toThrow("Unknown benchmark option");
  });

  it("renders every fixture through its declared native, literal, or rejection path", async () => {
    const engine = await createTexNodeTextEngine();
    const beamer = await createTexNodeTextEngine({ mathFontProfile: beamerBenchMathProfile });
    for (const [index, benchCase] of TEXT_ENGINE_BENCH_CASES.entries()) {
      const target = benchCase.engine === "beamer" ? beamer : engine;
      for (const step of benchCase.steps(benchSample(0, 2, index))) {
        checkBenchOutcome(target, step, target.measure(step.request), benchCase.name);
      }
    }
    expect(new Set(TEXT_ENGINE_BENCH_CASES.map((benchCase) => benchCase.name)).size)
      .toBe(TEXT_ENGINE_BENCH_CASES.length);
  });
});
