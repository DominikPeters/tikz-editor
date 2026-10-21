import { performance } from "node:perf_hooks";
import type { NodeTextEngine, NodeTextMeasureRequest, NodeTextMetrics, NodeTextRenderPayload } from "../../packages/core/src/text/types.js";

export type BenchSample = { index: number; token: string };
export type BenchStep = {
  request: NodeTextMeasureRequest;
  expected?: "native" | "literal" | "null";
  cache?: "miss" | "hit";
  requiredSvg?: readonly string[];
};
export type TextEngineBenchCase = {
  name: string;
  group: string;
  mode: "cold" | "sequence" | "layout-reuse" | "cache-churn";
  engine?: "beamer";
  steps(sample: BenchSample): readonly BenchStep[];
};

export type TimingSummary = { count: number; min: number; median: number; mean: number; p95: number; max: number };
export type TextEngineBenchResult = {
  name: string;
  group: string;
  mode: TextEngineBenchCase["mode"];
  engine: string;
  samples: number;
  operations: number;
  native: number;
  literals: number;
  nulls: number;
  setupMs: number;
  inputLength: { min: number; max: number };
  measureMs: TimingSummary;
  coldMs: TimingSummary | null;
  editMs: TimingSummary | null;
  layoutReuseMs: TimingSummary | null;
  revisitMs: TimingSummary | null;
  warmMs: TimingSummary | null;
};

export function parseBenchOptions(argv: readonly string[]) {
  const options = { samples: 40, only: "", group: "", jsonPath: "", help: false, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "--list") {
      options[flag === "--help" ? "help" : "list"] = true;
      continue;
    }
    if (!["--samples", "--only", "--group", "--json"].includes(flag)) {
      throw new Error(`Unknown benchmark option: ${flag}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--samples") {
      const samples = Number(value);
      if (!Number.isSafeInteger(samples) || samples < 1) {
        throw new Error("--samples must be a positive safe integer.");
      }
      options.samples = samples;
    } else if (flag === "--only") options.only = value;
    else if (flag === "--group") options.group = value;
    else options.jsonPath = value;
  }
  return options;
}

/** Fixed-length numeric tokens, including three disjoint warm-up samples. */
export function benchSample(index: number, samples: number, caseIndex: number): BenchSample {
  const digits = Math.max(2, String(samples + 2).length);
  return { index, token: `${String(caseIndex).padStart(2, "0")}${String(index).padStart(digits, "0")}` };
}

export function summarizeTimings(values: readonly number[]): TimingSummary | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (q: number) => {
    const position = (sorted.length - 1) * q;
    const lo = Math.floor(position);
    const hi = Math.ceil(position);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
  };
  return {
    count: sorted.length, min: sorted[0], median: quantile(0.5), p95: quantile(0.95),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    max: sorted[sorted.length - 1],
  };
}

/** Checks are outside the timed measure() call, including SVG fallback checks. */
export function checkBenchOutcome(
  engine: NodeTextEngine, step: BenchStep, metrics: NodeTextMetrics | null, context: string
): NodeTextRenderPayload | null {
  const expected = step.expected ?? "native";
  if (expected === "null") {
    if (metrics !== null) throw new Error(`${context}: expected rejected/empty input, received metrics.`);
    return null;
  }
  if (!metrics) throw new Error(`${context}: expected ${expected} rendering, received null.`);
  if (![metrics.width, metrics.height, metrics.baselineY, metrics.midLineY].every(Number.isFinite) ||
      metrics.width < 0 || metrics.height < 0) {
    throw new Error(`${context}: invalid geometry.`);
  }
  const payload = engine.renderFromCache(metrics.cacheKey);
  if (!payload?.body) throw new Error(`${context}: missing SVG payload.`);
  const literal = payload.body.includes("data-tex-literal=");
  if (literal !== (expected === "literal")) {
    throw new Error(`${context}: expected ${expected} rendering, ${literal ? "found a literal fallback" : "found native SVG"}.`);
  }
  for (const marker of step.requiredSvg ?? []) {
    if (!payload.body.includes(marker)) throw new Error(`${context}: missing SVG marker ${marker}.`);
  }
  return payload;
}

export function runTextEngineBenchCase(
  engine: NodeTextEngine, benchCase: TextEngineBenchCase, samples: number, caseIndex = 0
): TextEngineBenchResult {
  // Build requests/source maps/resolvers before timing. Sequence steps are in
  // source order; this also avoids timing string generation as text layout.
  const requests = Array.from({ length: samples }, (_, index) =>
    benchCase.steps(benchSample(index, samples, caseIndex))
  );
  const setupStart = performance.now();
  const warmupKeys = new Set<string>();
  for (let index = samples; index < samples + 3; index += 1) {
    for (const step of benchCase.steps(benchSample(index, samples, caseIndex))) {
      const metrics = engine.measure(step.request);
      checkBenchOutcome(engine, step, metrics, `${benchCase.name} warm-up`);
      if (metrics) warmupKeys.add(metrics.cacheKey);
    }
  }

  if (benchCase.mode === "cache-churn") {
    // Current render/layout capacities are 2048/512. Prime the probes, then
    // overflow both caches. Verify eviction so capacity changes cannot silently
    // turn this into a cache-hit benchmark. Setup is reported separately.
    const probeKeys: string[] = [];
    for (const steps of requests) {
      for (const step of steps) {
        const metrics = engine.measure(step.request);
        checkBenchOutcome(engine, step, metrics, `${benchCase.name} cache prime`);
        if (metrics) probeKeys.push(metrics.cacheKey);
      }
    }
    const baseRequest = requests[0][0].request;
    for (let index = 0; index < 2304; index += 1) {
      const step = { request: { ...baseRequest, text: `Churn fill ${caseIndex} ${index}` } };
      checkBenchOutcome(engine, step, engine.measure(step.request), `${benchCase.name} cache fill`);
    }
    if (probeKeys.some((key) => engine.renderFromCache(key) !== null)) {
      throw new Error(`${benchCase.name}: probes were not evicted; update the churn working set.`);
    }
  }
  const setupMs = performance.now() - setupStart;
  const measured: number[] = [];
  const misses: number[] = [];
  const revisits: number[] = [];
  const warm: number[] = [];
  let native = 0;
  let literals = 0;
  let nulls = 0;
  let minLength = Infinity;
  let maxLength = 0;
  const seenKeys = new Set(warmupKeys);
  for (const [sampleIndex, steps] of requests.entries()) {
    // Keep payload identities only within a sequence, so undo checks can prove
    // reuse without retaining an entire benchmark's SVG strings in memory.
    const sequencePayloads = new Map<string, NodeTextRenderPayload>();
    for (const [stepIndex, step] of steps.entries()) {
      const context = `${benchCase.name} sample ${sampleIndex} step ${stepIndex}`;
      minLength = Math.min(minLength, step.request.text.length);
      maxLength = Math.max(maxLength, step.request.text.length);
      const start = performance.now();
      const metrics = engine.measure(step.request);
      const elapsed = performance.now() - start;
      const payload = checkBenchOutcome(engine, step, metrics, context);
      measured.push(elapsed);
      if (!metrics || !payload) {
        nulls += 1;
        misses.push(elapsed);
        continue;
      }
      if (step.expected === "literal") literals += 1;
      else native += 1;
      if (step.cache === "hit") {
        if (sequencePayloads.get(metrics.cacheKey) !== payload) {
          throw new Error(`${context}: expected a cached revisit of an earlier step.`);
        }
        revisits.push(elapsed);
      } else {
        if (seenKeys.has(metrics.cacheKey)) throw new Error(`${context}: cold request repeated a cache key.`);
        misses.push(elapsed);
        seenKeys.add(metrics.cacheKey);
        sequencePayloads.set(metrics.cacheKey, payload);
        // Immediate repeat keeps warm samples hot even for --samples > 2048.
        // For sequences this repeat happens after every new edit, before the
        // next edit; revisits remain separate from these reference timings.
        const warmStart = performance.now();
        const warmMetrics = engine.measure(step.request);
        warm.push(performance.now() - warmStart);
        if (warmMetrics?.cacheKey !== metrics.cacheKey || engine.renderFromCache(metrics.cacheKey) !== payload) {
          throw new Error(`${context}: immediate repeat did not reuse the render cache.`);
        }
      }
    }
  }
  const measureMs = summarizeTimings(measured);
  if (!measureMs) throw new Error(`${benchCase.name}: no measurement steps.`);
  return {
    name: benchCase.name, group: benchCase.group, mode: benchCase.mode,
    engine: benchCase.engine ?? "default", samples, operations: measured.length,
    native, literals, nulls, setupMs, inputLength: { min: minLength, max: maxLength },
    measureMs,
    coldMs: benchCase.mode === "cold" || benchCase.mode === "cache-churn" ? summarizeTimings(misses) : null,
    editMs: benchCase.mode === "sequence" ? summarizeTimings(misses) : null,
    layoutReuseMs: benchCase.mode === "layout-reuse" ? summarizeTimings(misses) : null,
    revisitMs: summarizeTimings(revisits), warmMs: summarizeTimings(warm),
  };
}
