/**
 * Compare the old per-byte encoder with the current application encoder.
 *
 * Run from the repository root:
 *   node --expose-gc --import tsx scripts/benchmark-import-encoding.mjs
 *   node --expose-gc --import tsx scripts/benchmark-import-encoding.mjs --bytes 8MiB --runs 3
 *
 * Heap deltas are sampled immediately after encoding and after explicit GC,
 * relative to a GC-clean starting point for each sample.
 * The immediate sample includes surviving temporary allocations; it is a useful
 * allocation proxy, not a measurement of true peak memory or browser memory.
 */
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { graphicBytesBase64 } from "../packages/app/src/imported-graphics.ts";

const { values } = parseArgs({
  options: {
    bytes: { type: "string", default: "8MiB" },
    runs: { type: "string", default: "3" },
    help: { type: "boolean", short: "h" },
  },
});
if (values.help) {
  console.log("node --expose-gc --import tsx scripts/benchmark-import-encoding.mjs [--bytes 8MiB] [--runs 3]");
  process.exit(0);
}
if (typeof global.gc !== "function") throw new Error("Run Node with --expose-gc (see --help).");

const inputBytes = parseBytes(values.bytes);
const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer.");

/** @type {{ baseline: ReturnType<typeof sample>[], current: ReturnType<typeof sample>[] }} */
const samples = { baseline: [], current: [] };
for (let run = 0; run < runs; run++) {
  for (const mode of /** @type {const} */ (["baseline", "current"])) {
    samples[mode].push(sample(mode, inputBytes));
  }
}
const reference = samples.baseline[0];
for (const result of [...samples.baseline, ...samples.current]) {
  if (result.outputBytes !== reference.outputBytes || result.sha256 !== reference.sha256) {
    throw new Error("Encoders produced different output.");
  }
}
const fields = /** @type {const} */ (["durationMs", "heapDeltaBeforeGcBytes", "heapDeltaAfterGcBytes"]);
/** @param {number[]} items */
const median = (items) => {
  const sorted = [...items].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const summaries = Object.fromEntries(Object.entries(samples).map(([mode, results]) => [mode,
  Object.fromEntries(fields.map((field) => [field, median(results.map((result) => result[field]))]))]));
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, inputBytes, runs,
  note: "GC before each sample; immediate post-encoding and post-GC heap samples, not true peak memory or browser measurements.",
  outputMatches: true, medians: summaries, samples }, null, 2));

/** @param {string} raw */
function parseBytes(raw) {
  const match = /^(\d+)(KiB|MiB|GiB)?$/i.exec(raw);
  if (!match) throw new Error("--bytes must be an integer, optionally followed by KiB, MiB or GiB.");
  const scale = { kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3 }[match[2]?.toLowerCase()] ?? 1;
  const bytes = Number(match[1]) * scale;
  if (!Number.isSafeInteger(bytes)) throw new Error("--bytes exceeds the safe integer range.");
  return bytes;
}

/** @param {ArrayBuffer} bytes */
function baselineEncoder(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** @param {"baseline" | "current"} mode @param {number} byteCount */
function sample(mode, byteCount) {
  const input = new Uint8Array(byteCount);
  for (let index = 0; index < input.length; index++) input[index] = index % 256;
  global.gc();
  const before = process.memoryUsage();
  const started = performance.now();
  const encoded = (mode === "baseline" ? baselineEncoder : graphicBytesBase64)(input.buffer);
  const durationMs = performance.now() - started;
  const immediate = process.memoryUsage();
  global.gc();
  const collected = process.memoryUsage();
  return { durationMs,
    heapDeltaBeforeGcBytes: immediate.heapUsed - before.heapUsed,
    heapDeltaAfterGcBytes: collected.heapUsed - before.heapUsed,
    // Keep the output alive across both samples and check byte-for-byte parity
    // without writing multi-megabyte base64 strings into the report.
    outputBytes: encoded.length,
    sha256: createHash("sha256").update(encoded).digest("hex"),
  };
}
