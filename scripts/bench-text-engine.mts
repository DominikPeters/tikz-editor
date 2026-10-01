/**
 * Native TeX measure() benchmarks. See design/text-engine-benchmarks.md.
 *
 *   npm run bench:text-engine
 *   npm run bench:text-engine -- --group math --samples 100 --json /tmp/text-bench.json
 *   npm run bench:text-engine -- --list
 */
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { parseBenchOptions, runTextEngineBenchCase } from "./lib/text-engine-bench.js";
import { TEXT_ENGINE_BENCH_CASES, beamerBenchMathProfile } from "./lib/text-engine-bench-cases.js";

const options = parseBenchOptions(process.argv.slice(2));
if (options.help) {
  console.log(`Usage: npm run bench:text-engine -- [options]
  --samples <n>     Independent requests or edit sequences per case (default 40)
  --only <text>     Filter case names (case insensitive)
  --group <name>    Filter a feature group; see --list
  --list            List matching cases without initializing the engine
  --json <path>     Write timings, workload metadata, and environment to JSON
  --help            Show this help`);
  process.exit(0);
}

const activeCases = TEXT_ENGINE_BENCH_CASES.map((benchCase, index) => ({ benchCase, index }))
  .filter(({ benchCase }) =>
    (!options.only || benchCase.name.toLowerCase().includes(options.only.toLowerCase())) &&
    (!options.group || benchCase.group === options.group)
  );
if (activeCases.length === 0) {
  throw new Error("No benchmark cases match the filters. Use --list to see available cases.");
}
if (options.list) {
  for (const { benchCase } of activeCases) {
    console.log(`${benchCase.group.padEnd(12)} ${benchCase.mode.padEnd(13)} ${benchCase.name}`);
  }
  process.exit(0);
}

const { createTexNodeTextEngine } = await import("../packages/core/src/text/tex-node-text-engine.js");
const initStart = performance.now();
const defaultEngine = await createTexNodeTextEngine();
const initMs = performance.now() - initStart;
const engineInitMs: Record<string, number> = { default: initMs };
let beamerEngine: typeof defaultEngine | undefined;
if (activeCases.some(({ benchCase }) => benchCase.engine === "beamer")) {
  const start = performance.now();
  beamerEngine = await createTexNodeTextEngine({ mathFontProfile: beamerBenchMathProfile });
  engineInitMs.beamer = performance.now() - start;
}

console.log(`\narm: native-tex   engine init: ${initMs.toFixed(1)} ms   samples/case: ${options.samples}`);
console.log("Times in ms. Misses, edit revisits, and immediate cache hits are measured separately.");
console.log(
  "case".padEnd(48) + "mode".padEnd(14) +
  "miss p50".padStart(10) + "p95".padStart(10) + "revisit".padStart(10) + "warm p50".padStart(10) + "  outcomes"
);
const results = [];
for (const { benchCase, index } of activeCases) {
  const engine = benchCase.engine === "beamer" ? beamerEngine : defaultEngine;
  if (!engine) throw new Error("Beamer benchmark engine was not initialized.");
  const result = runTextEngineBenchCase(engine, benchCase, options.samples, index);
  results.push(result);
  const misses = result.coldMs ?? result.editMs ?? result.layoutReuseMs;
  console.log(
    result.name.padEnd(48) + result.mode.padEnd(14) +
    (misses?.median.toFixed(3) ?? "—").padStart(10) +
    (misses?.p95.toFixed(3) ?? "—").padStart(10) +
    (result.revisitMs?.median.toFixed(3) ?? "—").padStart(10) +
    (result.warmMs?.median.toFixed(3) ?? "—").padStart(10) +
    `  native=${result.native} literal=${result.literals} null=${result.nulls}`
  );
}

if (options.jsonPath) {
  writeFileSync(options.jsonPath, JSON.stringify({
    schemaVersion: 2,
    arm: "native-tex",
    measuredAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    initMs,
    engineInitMs,
    samples: options.samples,
    filters: { only: options.only, group: options.group },
    results,
  }, null, 2) + "\n");
  console.log(`\nwrote ${options.jsonPath}`);
}
