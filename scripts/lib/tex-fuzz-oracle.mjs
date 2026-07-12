import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { TexFuzzDiskCache, texFuzzCacheKey } from "./tex-fuzz-cache.mjs";
import { texOracleEnv } from "./tex-oracle.mjs";

const execFileAsync = promisify(execFile);
export const TEX_FUZZ_ORACLE_RUNNER_VERSION = "batched-support-v2";
const DEFAULT_PREAMBLE = String.raw`\usepackage{xcolor}
\usepackage{amsmath,amssymb}`;

/** @typedef {{ readonly id: string, readonly token: string, readonly source: string }} NormalizedOracleCase */
/** @typedef {{ readonly id?: string, readonly source: string }} OracleCase */
/** @typedef {{ readonly engine?: string, readonly timeoutMs?: number, readonly batchSize?: number, readonly workers?: number, readonly cacheDir?: string, readonly layer?: string, readonly preamble?: string, readonly signal?: AbortSignal }} OracleOptions */
/** @typedef {{ readonly id: string, readonly supported: boolean, readonly widthSp?: number, readonly heightSp?: number, readonly depthSp?: number, readonly error?: string }} OracleObservation */

/** @param {readonly NormalizedOracleCase[]} cases @param {string} preamble */
function oracleDocument(cases, preamble) {
  const bodies = cases.map(({ token, source }) => String.raw`
\begingroup
\typeout{TFZ-BEGIN ${token}}
\ifnum\tfzsentinel=1701\else\errmessage{TFZ isolation sentinel corrupted before ${token}}\fi
\setbox\tfzbox=\hbox{${source}}
\typeout{TFZ-RESULT ${token} \number\wd\tfzbox\space \number\ht\tfzbox\space \number\dp\tfzbox}
\endgroup
\ifnum\tfzsentinel=1701\else\errmessage{TFZ isolation sentinel corrupted after ${token}}\fi`).join("\n");
  return String.raw`\documentclass{article}
${preamble}
\pagestyle{empty}
\newbox\tfzbox
\newcount\tfzsentinel
\tfzsentinel=1701
\begin{document}
${bodies}
\end{document}
`;
}

/** @param {string} log @param {readonly NormalizedOracleCase[]} cases */
function parseLog(log, cases) {
  /** @type {Map<string, OracleObservation>} */
  const observations = new Map();
  for (const match of log.matchAll(/^TFZ-RESULT (c\d+) (-?\d+) (-?\d+) (-?\d+)$/gm)) {
    const item = cases.find(({ token }) => token === match[1]);
    if (item) observations.set(item.token, { id: item.id, supported: true, widthSp: Number(match[2]), heightSp: Number(match[3]), depthSp: Number(match[4]) });
  }
  if (observations.size !== cases.length) throw new Error(`Oracle emitted ${observations.size} of ${cases.length} results.`);
  return cases.map(({ token }) => observations.get(token));
}

/** @param {readonly NormalizedOracleCase[]} cases @param {{ engine: string, timeoutMs: number, preamble: string, signal?: AbortSignal }} options */
function runOneBatch(cases, options) {
  const directory = mkdtempSync(join(tmpdir(), "tikz-tex-fuzz-oracle-"));
  const started = performance.now();
  try {
    writeFileSync(join(directory, "oracle.tex"), oracleDocument(cases, options.preamble), "utf8");
    execFileSync(options.engine, ["--interaction=batchmode", "--halt-on-error", "--draftmode", "oracle.tex"], {
      cwd: directory, env: texOracleEnv(), stdio: "ignore", timeout: options.timeoutMs, maxBuffer: 20 * 1024 * 1024,
    });
    return { ok: true, elapsedMs: performance.now() - started, observations: parseLog(readFileSync(join(directory, "oracle.log"), "utf8"), cases) };
  } catch (error) {
    return { ok: false, elapsedMs: performance.now() - started, error: error instanceof Error ? error.message : String(error) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

/** @param {readonly NormalizedOracleCase[]} cases @param {{ engine: string, timeoutMs: number, preamble: string, signal?: AbortSignal }} options */
async function runOneBatchAsync(cases, options) {
  const directory = mkdtempSync(join(tmpdir(), "tikz-tex-fuzz-oracle-"));
  const started = performance.now();
  try {
    writeFileSync(join(directory, "oracle.tex"), oracleDocument(cases, options.preamble), "utf8");
    await execFileAsync(options.engine, ["--interaction=batchmode", "--halt-on-error", "--draftmode", "oracle.tex"], {
      cwd: directory, env: texOracleEnv(), timeout: options.timeoutMs, maxBuffer: 20 * 1024 * 1024, signal: options.signal,
    });
    return { ok: true, elapsedMs: performance.now() - started, observations: parseLog(readFileSync(join(directory, "oracle.log"), "utf8"), cases) };
  } catch (error) {
    return { ok: false, elapsedMs: performance.now() - started, error: error instanceof Error ? error.message : String(error) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

/** @template T @param {readonly T[]} items @param {number} size */
export function partitionTexFuzzBatches(items, size) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("batchSize must be a positive integer");
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

/** Ordered bounded async map. @template T,U @param {readonly T[]} items @param {number} workers @param {(item: T, index: number) => Promise<U>} visit */
export async function mapTexFuzzWorkers(items, workers, visit) {
  if (!Number.isInteger(workers) || workers < 1) throw new RangeError("workers must be a positive integer");
  /** @type {U[]} */ const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await visit(items[index], index);
    }
  }));
  return results;
}

/** @param {string} command */
export function commandExists(command) { return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0; }

/** @param {string} [engine] */
export function texFuzzOracleEnvironment(engine = "lualatex") {
  /** @param {string} command @param {readonly string[]} args */
  const firstLine = (command, args) => {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.status !== 0) return "unavailable";
    return (String(result.stdout || result.stderr).split(/\r?\n/)[0] || "unknown").trim();
  };
  return {
    engine,
    engineBanner: firstLine(engine, ["--version"]),
    kpsewhich: firstLine("kpsewhich", ["--version"]),
    dvisvgm: firstLine("dvisvgm", ["--version"]),
    pdftocairo: firstLine("pdftocairo", ["-v"]),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    runnerVersion: TEX_FUZZ_ORACLE_RUNNER_VERSION,
  };
}

/** @param {readonly OracleCase[]} cases */
function normalize(cases) {
  return cases.map((item, index) => ({ id: item.id ?? `case-${index}`, token: `c${index}`, source: item.source }));
}

/** @param {OracleObservation} observation */
function cachedObservation(observation) {
  const { id: _id, ...value } = observation;
  return value;
}

/** @param {readonly OracleCase[]} cases @param {OracleOptions} [options] */
export function runBatchedTexSupportOracle(cases, options = {}) {
  options.signal?.throwIfAborted();
  const engine = options.engine ?? "lualatex", timeoutMs = options.timeoutMs ?? 30_000;
  const preamble = options.preamble ?? DEFAULT_PREAMBLE, layer = options.layer ?? "support";
  const environment = { ...texFuzzOracleEnvironment(engine), timeoutMs: String(timeoutMs) }, normalized = normalize(cases);
  const cache = options.cacheDir ? new TexFuzzDiskCache(options.cacheDir) : undefined;
  const stats = { compilations: 0, elapsedMs: 0, bisectedFailures: 0, cacheHits: 0, cacheMisses: 0, cacheWrites: 0, batches: 0 };
  /** @type {Map<string, OracleObservation>} */ const found = new Map();
  const misses = normalized.filter((item) => {
    if (!cache) return true;
    const key = texFuzzCacheKey({ source: item.source, preamble, layer, environment });
    const value = cache.get(key);
    if (value && typeof value === "object") { stats.cacheHits++; found.set(item.token, { id: item.id, ...value }); return false; }
    stats.cacheMisses++; return true;
  });
  /** @param {readonly NormalizedOracleCase[]} batch @returns {OracleObservation[]} */
  const execute = (batch) => {
    options.signal?.throwIfAborted();
    stats.compilations++; const result = runOneBatch(batch, { engine, timeoutMs, preamble }); stats.elapsedMs += result.elapsedMs;
    if (result.ok) return result.observations;
    if (batch.length === 1) return [{ id: batch[0].id, supported: false, error: result.error }];
    stats.bisectedFailures++; const middle = Math.floor(batch.length / 2); return [...execute(batch.slice(0, middle)), ...execute(batch.slice(middle))];
  };
  for (const batch of partitionTexFuzzBatches(misses, options.batchSize ?? Math.max(1, misses.length))) {
    stats.batches++; execute(batch).forEach((observation, index) => {
      const item = batch[index]; found.set(item.token, observation);
      if (cache) { cache.set(texFuzzCacheKey({ source: item.source, preamble, layer, environment }), cachedObservation(observation)); stats.cacheWrites++; }
    });
  }
  return { observations: normalized.map(({ token }) => found.get(token)), stats, environment };
}

/** Async worker-pool variant; result order always matches input order. @param {readonly OracleCase[]} cases @param {OracleOptions} [options] */
export async function runBatchedTexSupportOracleAsync(cases, options = {}) {
  options.signal?.throwIfAborted();
  const engine = options.engine ?? "lualatex", timeoutMs = options.timeoutMs ?? 30_000;
  const preamble = options.preamble ?? DEFAULT_PREAMBLE, layer = options.layer ?? "support";
  const environment = { ...texFuzzOracleEnvironment(engine), timeoutMs: String(timeoutMs) }, normalized = normalize(cases);
  const cache = options.cacheDir ? new TexFuzzDiskCache(options.cacheDir) : undefined;
  const stats = { compilations: 0, elapsedMs: 0, bisectedFailures: 0, cacheHits: 0, cacheMisses: 0, cacheWrites: 0, batches: 0 };
  /** @type {Map<string, OracleObservation>} */ const found = new Map();
  const misses = normalized.filter((item) => {
    if (!cache) return true;
    const key = texFuzzCacheKey({ source: item.source, preamble, layer, environment }); const value = cache.get(key);
    if (value && typeof value === "object") { stats.cacheHits++; found.set(item.token, { id: item.id, ...value }); return false; }
    stats.cacheMisses++; return true;
  });
  /** @param {readonly NormalizedOracleCase[]} batch @returns {Promise<OracleObservation[]>} */
  const execute = async (batch) => {
    stats.compilations++; const result = await runOneBatchAsync(batch, { engine, timeoutMs, preamble, signal: options.signal }); stats.elapsedMs += result.elapsedMs;
    options.signal?.throwIfAborted();
    if (result.ok) return result.observations;
    if (batch.length === 1) return [{ id: batch[0].id, supported: false, error: result.error }];
    stats.bisectedFailures++; const middle = Math.floor(batch.length / 2);
    return [...await execute(batch.slice(0, middle)), ...await execute(batch.slice(middle))];
  };
  const batches = partitionTexFuzzBatches(misses, options.batchSize ?? Math.max(1, misses.length)); stats.batches = batches.length;
  const batchResults = await mapTexFuzzWorkers(batches, options.workers ?? 1, execute);
  batches.forEach((batch, batchIndex) => batchResults[batchIndex].forEach((observation, index) => {
    const item = batch[index]; found.set(item.token, observation);
    if (cache) { cache.set(texFuzzCacheKey({ source: item.source, preamble, layer, environment }), cachedObservation(observation)); stats.cacheWrites++; }
  }));
  return { observations: normalized.map(({ token }) => found.get(token)), stats, environment };
}

/** @param {readonly OracleCase[]} cases @param {OracleOptions} [options] */
export function calibrateBatchedTexSupportOracle(cases, options = {}) {
  const withoutCache = { ...options, cacheDir: undefined };
  const batched = runBatchedTexSupportOracle(cases, withoutCache), reversed = runBatchedTexSupportOracle([...cases].reverse(), withoutCache);
  const standalone = cases.map((item) => runBatchedTexSupportOracle([item], withoutCache).observations[0]);
  /** @param {OracleObservation | undefined} observation */
  const signature = (observation) => JSON.stringify({ supported: observation?.supported, widthSp: observation?.widthSp, heightSp: observation?.heightSp, depthSp: observation?.depthSp });
  const reversedById = new Map(reversed.observations.map((item) => [item.id, item])), standaloneById = new Map(standalone.map((item) => [item.id, item]));
  const mismatches = batched.observations.flatMap((item) => signature(item) === signature(reversedById.get(item.id)) && signature(item) === signature(standaloneById.get(item.id)) ? [] : [item.id]);
  return { ok: mismatches.length === 0, mismatches, batched, reversed, standalone };
}

/**
 * Select findings plus a deterministic diversity control sample for expensive oracle layers.
 * @template {{ readonly id: string, readonly source: string }} T
 * @param {readonly T[]} cases
 * @param {{ findingIds?: readonly string[], controlSampleSize?: number, seed?: string | number }} [options]
 * @returns {T[]}
 */
export function selectTexFuzzEscalation(cases, options = {}) {
  const findings = new Set(options.findingIds ?? []), sampleSize = Math.max(0, options.controlSampleSize ?? 0);
  const selected = cases.filter((item) => findings.has(item.id));
  const remaining = cases.filter((item) => !findings.has(item.id)).map((item) => ({ item, score: texFuzzCacheKey({ source: `${options.seed ?? 0}\0${item.id}`, preamble: "", layer: "sample", environment: {} }) }));
  remaining.sort((a, b) => a.score.localeCompare(b.score) || a.item.id.localeCompare(b.item.id));
  return [...selected, ...remaining.slice(0, sampleSize).map(({ item }) => item)];
}
