#!/usr/bin/env node
// @ts-check

import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: {
  duration: { type: "string", default: "3600" },
  rounds: { type: "string", default: "1" },
  parallel: { type: "string", default: "1" },
  seed: { type: "string", default: String(Date.now() >>> 0) },
  output: { type: "string" },
  help: { type: "boolean", short: "h" },
} });

/** @typedef {{ args: string[], env?: NodeJS.ProcessEnv }} Job */
/** @typedef {{ kind: string, seed: number, directory: string, command: [string, ...string[]], env: NodeJS.ProcessEnv, cwd: string }} Batch */
/** @typedef {{ code: number | null, signal: NodeJS.Signals | null, error?: string }} ProcessResult */
/** @typedef {{ round: number, seconds: number, batches: number, failures: number, suites: string[], completed: boolean }} RoundResult */

/** @param {"duration" | "rounds" | "parallel" | "seed"} name
 * @param {number} min */
function integer(name, min, max = Number.MAX_SAFE_INTEGER) {
  const input = values[name] ?? "";
  const value = Number(input);
  if (!/^\d+$/u.test(input) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

/** @param {string} file @param {unknown} value */
function saveJson(file, value) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, file);
}

/** @param {Record<string, string | number | boolean | undefined>} options */
function flags(options) {
  return Object.entries(options).flatMap(([name, value]) =>
    value === false || value === undefined ? [] : value === true ? [`--${name}`] : [`--${name}`, String(value)]);
}

const vitest = ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=1", "--pool=forks"];
/** @type {Record<string, string[]>} */
const editingSuites = {
  keystrokes: ["test/editing/keystroke-fuzz.spec.ts"],
  store: ["test/differential/store-fuzz.spec.ts"],
  "pointer-paint": ["test/paint-toggle-fuzz.spec.ts", "test/pointer-invariant/pointer-invariant.spec.ts"],
  compute: ["test/differential/compute-differential.spec.ts"],
  syntax: ["test/differential/syntax-reparse.spec.ts"],
};
const texSuites = ["oracle", "aggressive", "malformed", "document", "math-parser"];
const beamerSuites = ["beamer-images", "beamer-intricate", "beamer-broad"];
const texEnvironment = Object.fromEntries(
  ["TEXMFHOME", "TEXMFVAR", "TEXMFCACHE", "TEXINPUTS"].flatMap(name =>
    process.env[name] === undefined ? [] : [[name, process.env[name]]])
);

/** @param {string} kind @param {number} seed @param {string} directory @param {number} index @returns {Job} */
function editingJob(kind, seed, directory, index) {
  if (kind.startsWith("beamer-")) {
    const profile = kind.slice("beamer-".length);
    return { args: ["scripts/fuzz-beamer-edits.mjs", ...flags({
      profile: profile === "broad" ? false : profile,
      cases: profile === "broad" ? 33 : 8,
      steps: 14,
      seed,
      "corpus-replays": profile === "images" ? 2 : 0,
      mutations: 1,
      "case-timeout-ms": 600_000,
      "max-failures": 3,
      "out-dir": resolve(directory, "campaign"),
    })] };
  }
  const files = editingSuites[kind];
  if (!files) throw new Error(`Unknown editing suite: ${kind}`);
  return {
    args: [...vitest, ...files],
    env: Object.fromEntries(Object.entries({
      KEYSTROKE_FUZZ_SEED: seed,
      KEYSTROKE_FUZZ_CASES: index === 0 ? 10_000 : 5_000,
      STORE_FUZZ_SEED: seed, STORE_FUZZ_CASES: 24, STORE_FUZZ_STEPS: 60, STORE_FUZZ_VERBOSE: 1,
      PAINT_TOGGLE_FUZZ_SEED: seed, PAINT_TOGGLE_FUZZ_CASES: 600, POINTER_FUZZ_FULL: 1, POINTER_FUZZ_SEED: seed,
      COMPUTE_FUZZ_SEED: seed, COMPUTE_FUZZ_CASES: 22, COMPUTE_FUZZ_STEPS: 24, COMPUTE_FUZZ_VERBOSE: 1,
      SYNTAX_FUZZ_SEED: seed, SYNTAX_FUZZ_CASES: 36,
    }).map(([key, value]) => [key, String(value)])),
  };
}

/** @param {string} kind @param {number} seed @param {string} directory @param {boolean} calibrated @param {boolean} churnChecked @returns {Job} */
function texJob(kind, seed, directory, calibrated, churnChecked) {
  if (kind === "math-parser") {
    return { args: ["scripts/fuzz-tex-math.mjs", ...flags({
      "parser-only": true, cases: 10_000, seed, "random-source-offset": true,
    })] };
  }
  const oracle = kind === "oracle";
  const common = {
    seed,
    profile: oracle ? "document" : kind,
    "coverage-format": "compact",
    "engine-churn-requests": churnChecked ? 0 : 4100,
    out: resolve(directory, "bundle.json"),
    "coverage-out": resolve(directory, "coverage.json"),
    "artifacts-dir": resolve(directory, "findings"),
  };
  const options = oracle ? {
    cases: 100, "supported-cases": 32, "supported-max-attempts": 4096,
    "skip-support-self-check": calibrated,
    "oracle-sample-cases": 64, "oracle-geometry-policy": "fail",
    "math-oracle-cases": calibrated ? 32 : 64, "math-oracle-policy": "fail",
  } : {
    cases: kind === "aggressive" ? 1000 : 500, "no-oracle": true,
    "malformed-cases": 100, "prefix-base-cases": 4, "prefix-limit-per-case": 128,
    "metamorphic-cases": 64, "projection-control-cases": 64,
    "supported-cases": 64, "supported-max-attempts": 8192,
    "boundary-cases": 64, "engine-history-cases": 12,
  };
  return { args: ["scripts/run-tex-fuzz.mjs", ...flags({ ...common, ...options })] };
}

async function run() {
  const duration = integer("duration", 1, 86_400);
  const rounds = integer("rounds", 1, 100);
  const parallel = integer("parallel", 1, rounds);
  const seed = integer("seed", 0, 0xffffffff);
  const output = values.output ? resolve(values.output)
    : resolve(root, "artifacts", "fuzz-soak", new Date().toISOString().replaceAll(":", "-"));
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output);
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  /** @type {{ seed: number, duration: number, rounds: number, parallel: number, startedAt: string, revision: string | null, active: Record<string, Batch>, results: RoundResult[], status?: string }} */
  const summary = {
    seed, duration, rounds, parallel, startedAt: new Date().toISOString(),
    revision: git.status === 0 ? git.stdout.trim() : null,
    active: {}, results: [],
  };
  const summaryPath = resolve(output, "summary.json");
  const save = () => saveJson(summaryPath, summary);
  /** @type {Set<import("node:child_process").ChildProcess>} */
  const children = new Set();
  let nextRound = 1;
  let interrupted = false;
  let failed = false;
  let stopTime = Infinity;
  /** @type {NodeJS.Timeout | undefined} */
  let forceStop;
  const stop = () => {
    interrupted = true;
    for (const child of children) signalGroup(child, "SIGTERM");
    forceStop ??= setTimeout(() => {
      for (const child of children) signalGroup(child, "SIGKILL");
    }, 5000);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  save();
  console.log(`Fuzz soak seed ${seed}, results in ${output}`);

  /** @param {number} round @param {number} roundStart @param {"tex" | "editing"} laneName @param {string[]} suites */
  async function lane(round, roundStart, laneName, suites) {
    let calibrated = false;
    let churnChecked = false;
    const batches = [];
    for (let index = 0; !failed && !interrupted && performance.now() - roundStart < duration * 1000; index++) {
      const kind = suites[index % suites.length];
      if (!kind) throw new Error(`No suites configured for ${laneName}`);
      const caseSeed = (seed + round * 10_000_000 + index * 10_007) >>> 0;
      const directory = resolve(output, `round-${round}`, `${laneName}-${String(index).padStart(3, "0")}`);
      mkdirSync(directory, { recursive: true });
      const job = laneName === "tex" ? texJob(kind, caseSeed, directory, calibrated, churnChecked)
        : editingJob(kind, caseSeed, directory, index);
      /** @type {Batch["command"]} */
      const command = [process.execPath, ...job.args];
      const batch = { kind, seed: caseSeed, directory, command, env: { ...texEnvironment, ...job.env }, cwd: root };
      saveJson(resolve(directory, "command.json"), batch);
      const key = `${round}:${laneName}`;
      summary.active[key] = batch;
      save();
      const result = await runBatch(batch, children, kind.startsWith("beamer-") ? 45 : 20);
      delete summary.active[key];
      const passed = result.code === 0 && !result.timedOut;
      if (!passed) {
        failed = true;
        stopTime = Math.min(stopTime, performance.now());
      }
      if (laneName === "tex" && passed) {
        if (kind === "oracle") calibrated = true;
        if (kind !== "math-parser") churnChecked = true;
      }
      batches.push({ ...batch, ...result, passed });
      console.log(`Round ${round} ${kind} seed ${caseSeed}: ${passed ? "passed" : "failed"} (${result.seconds.toFixed(1)}s)`);
    }
    return batches;
  }

  async function worker() {
    while (!failed && !interrupted && nextRound <= rounds) {
      const round = nextRound++;
      const started = performance.now();
      const [tex, editing] = await Promise.all([
        lane(round, started, "tex", texSuites),
        lane(round, started, "editing", [...Object.keys(editingSuites), ...beamerSuites]),
      ]);
      const seconds = (performance.now() - started) / 1000;
      const batches = [...tex, ...editing];
      const failures = batches.filter(batch => !batch.passed).length;
      const result = {
        round, seconds, batches: batches.length, failures,
        suites: [...new Set(batches.map(batch => batch.kind))].sort(),
        completed: !interrupted && stopTime - started >= duration * 1000 && seconds >= duration && failures === 0,
      };
      summary.results.push(result);
      saveJson(resolve(output, `round-${round}`, "results.json"), { ...result, jobs: batches });
      save();
    }
  }

  try {
    await Promise.all(Array.from({ length: parallel }, worker));
  } finally {
    clearTimeout(forceStop);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    summary.results.sort((a, b) => a.round - b.round);
  }
  summary.status = interrupted ? "interrupted" : failed ? "failed" : "completed";
  save();
  if (interrupted || failed) process.exitCode = 1;
}

/** @param {import("node:child_process").ChildProcess} child @param {NodeJS.Signals} signal */
function signalGroup(child, signal) {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

/** @param {Batch} batch @param {Set<import("node:child_process").ChildProcess>} children @param {number} timeoutMinutes */
async function runBatch(batch, children, timeoutMinutes) {
  const started = performance.now();
  const log = openSync(resolve(batch.directory, "output.log"), "w");
  const [file, ...args] = batch.command;
  const child = spawn(file, args, {
    cwd: batch.cwd,
    env: { ...process.env, ...batch.env },
    detached: process.platform !== "win32",
    stdio: ["ignore", log, log],
  });
  children.add(child);
  let timedOut = false;
  /** @type {NodeJS.Timeout | undefined} */
  let killTimer;
  const timeout = setTimeout(() => {
    timedOut = true;
    signalGroup(child, "SIGTERM");
    killTimer = setTimeout(() => signalGroup(child, "SIGKILL"), 5000);
  }, timeoutMinutes * 60_000);
  try {
    /** @type {ProcessResult} */
    const result = await new Promise(resolve => {
      child.once("error", error => resolve({ code: null, signal: null, error: error.message }));
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    return { ...result, timedOut, seconds: (performance.now() - started) / 1000 };
  } finally {
    clearTimeout(timeout);
    clearTimeout(killTimer);
    children.delete(child);
    closeSync(log);
  }
}

if (values.help) {
  console.log(`Usage: npm run fuzz:soak -- [options]
  --duration <seconds>  Time to start new batches in each round (default 3600)
  --rounds <count>      Number of independent rounds (default 1)
  --parallel <count>    Rounds to run at once, two processes each (default 1)
  --seed <integer>      Base seed, recorded in summary.json
  --output <directory>  New directory for batch commands, logs, and summary`);
} else {
  await run();
}
