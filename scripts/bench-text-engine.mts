/**
 * Benchmark the node-text engine measure() hot path.
 *
 * The editor re-measures a label on every keystroke (each edit produces a new
 * cache key), so the number that matters is the COLD measure() latency per
 * unique string. Warm (cache-hit) latency is reported for reference.
 *
 * Usage:
 *   npx tsx scripts/bench-text-engine.mts                 # native simple-TeX path
 *   npx tsx scripts/bench-text-engine.mts --force-mathjax # MathJax fallback path
 *   npx tsx scripts/bench-text-engine.mts --json out.json # also write JSON results
 *
 * Run the two arms in separate processes: the engine is a module singleton and
 * its render cache would otherwise leak entries between arms.
 */

import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const forceMathJax = argv.includes("--force-mathjax");
const jsonIndex = argv.indexOf("--json");
const jsonPath = jsonIndex >= 0 ? argv[jsonIndex + 1] ?? null : null;
const samplesIndex = argv.indexOf("--samples");
const SAMPLES = samplesIndex >= 0 ? Number(argv[samplesIndex + 1]) : 40;
const onlyIndex = argv.indexOf("--only");
const only = onlyIndex >= 0 ? argv[onlyIndex + 1] ?? null : null;

if (forceMathJax) {
  (globalThis as { __TIKZ_EDITOR_FORCE_MATHJAX_TEXT__?: boolean }).__TIKZ_EDITOR_FORCE_MATHJAX_TEXT__ = true;
}

const { createMathJaxNodeTextEngine } = await import(
  "../packages/core/src/text/mathjax-engine.js"
);

type BenchCase = {
  name: string;
  /** `{i}` is replaced with a zero-padded counter so every sample is a cold cache miss of identical shape. */
  template: string;
  textWidthPt: number | null;
  mode?: "text" | "math";
  alignment?: "ragged-right" | "ragged-left" | "center" | "justified";
};

const CASES: BenchCase[] = [
  { name: "tiny word", template: "n{i}", textWidthPt: null },
  { name: "short label", template: "state q{i}", textWidthPt: null },
  { name: "inline math short", template: "$x_{{i}}$", textWidthPt: null },
  { name: "inline math", template: "cost $O(n \\log n) + {i}$", textWidthPt: null },
  { name: "styled text", template: "\\textbf{server {i}} node", textWidthPt: null },
  {
    name: "sentence (natural width)",
    template: "The quick brown fox {i} jumps over the lazy dog near the river bank.",
    textWidthPt: null,
  },
  {
    name: "paragraph wrapped 150pt",
    template:
      "Consider a weighted directed graph {i} whose vertices represent voters and whose " +
      "edges encode delegation choices; we study the complexity of finding an " +
      "assignment that maximizes total welfare subject to rationality constraints.",
    textWidthPt: 150,
  },
  {
    name: "paragraph wrapped 150pt + math",
    template:
      "For every $\\varepsilon > 0$ there is an integer {i} such that the mechanism is " +
      "$\\varepsilon$-approximately strategyproof and runs in $O(n^2 \\log n)$ time on " +
      "profiles with $n$ voters and $m$ alternatives.",
    textWidthPt: 150,
  },
  {
    name: "explicit multiline",
    template: "first line {i}\\\\second line\\\\third and final line",
    textWidthPt: null,
  },
  // Matrix-of-math-nodes cells reach the engine as `$...$` text since the
  // semantic layer desugars mode:"math" (see resolveNodeLayout); keep a raw
  // math-mode case too — it exercises the engine's MathJax compatibility path.
  { name: "matrix math cell", template: "$\\sum_{k=1}^{n} k^2 + {i}$", textWidthPt: null },
  { name: "math mode label (raw)", template: "\\sum_{k=1}^{n} k^2 + {i}", textWidthPt: null, mode: "math" },
];

function instantiate(template: string, i: number): string {
  return template.replaceAll("{i}", String(i % 90 + 10));
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const initStart = performance.now();
const engine = await createMathJaxNodeTextEngine();
const initMs = performance.now() - initStart;

// Warm up JIT + MathJax dynamic font loading on strings outside the sample space.
for (const benchCase of CASES) {
  for (let w = 0; w < 3; w += 1) {
    engine.measure({
      text: instantiate(benchCase.template, 900 + w).replaceAll(/\d+/g, (d) => `${d}${w}`),
      mode: benchCase.mode ?? "text",
      textWidthPt: benchCase.textWidthPt,
      ...(benchCase.alignment ? { alignment: benchCase.alignment } : {}),
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10,
    });
  }
}
await engine.flushPending?.();

type CaseResult = {
  name: string;
  samples: number;
  nulls: number;
  coldMs: { min: number; median: number; mean: number; p95: number; max: number };
  warmMs: { median: number };
};

const results: CaseResult[] = [];

const activeCases = only ? CASES.filter((c) => c.name.includes(only)) : CASES;
for (const benchCase of activeCases) {
  const cold: number[] = [];
  let nulls = 0;
  const requests: Parameters<typeof engine.measure>[0][] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    requests.push({
      text: instantiate(benchCase.template, i),
      mode: benchCase.mode ?? "text",
      textWidthPt: benchCase.textWidthPt,
      ...(benchCase.alignment ? { alignment: benchCase.alignment } : {}),
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10,
    });
  }
  for (const request of requests) {
    const t0 = performance.now();
    const metrics = engine.measure(request);
    const t1 = performance.now();
    cold.push(t1 - t0);
    if (!metrics) nulls += 1;
  }
  // Warm pass: identical strings now hit the render cache.
  const warm: number[] = [];
  for (const request of requests) {
    const t0 = performance.now();
    engine.measure(request);
    const t1 = performance.now();
    warm.push(t1 - t0);
  }
  cold.sort((a, b) => a - b);
  warm.sort((a, b) => a - b);
  results.push({
    name: benchCase.name,
    samples: SAMPLES,
    nulls,
    coldMs: {
      min: cold[0],
      median: quantile(cold, 0.5),
      mean: cold.reduce((s, v) => s + v, 0) / cold.length,
      p95: quantile(cold, 0.95),
      max: cold[cold.length - 1],
    },
    warmMs: { median: quantile(warm, 0.5) },
  });
}

const arm = forceMathJax ? "mathjax-fallback" : "native-simple-tex";
const fmt = (v: number) => v.toFixed(3).padStart(9);

console.log(`\narm: ${arm}   engine init: ${initMs.toFixed(0)} ms   samples/case: ${SAMPLES}`);
console.log(
  "case".padEnd(34) +
    "min".padStart(9) +
    "median".padStart(10) +
    "mean".padStart(10) +
    "p95".padStart(10) +
    "max".padStart(10) +
    "warm".padStart(9) +
    "  nulls"
);
for (const r of results) {
  console.log(
    r.name.padEnd(34) +
      fmt(r.coldMs.min) +
      fmt(r.coldMs.median).padStart(10) +
      fmt(r.coldMs.mean).padStart(10) +
      fmt(r.coldMs.p95).padStart(10) +
      fmt(r.coldMs.max).padStart(10) +
      fmt(r.warmMs.median) +
      (r.nulls > 0 ? `  ${r.nulls}` : "")
  );
}

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify({ arm, initMs, samples: SAMPLES, results }, null, 2));
  console.log(`\nwrote ${jsonPath}`);
}
