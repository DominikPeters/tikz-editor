#!/usr/bin/env node
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateBeamerFuzzCases } from "./lib/beamer-fuzz-cases.mjs";
import { EDIT_FIELDS, generateBeamerEditSequence, withEditProbes } from "./lib/beamer-edit-sequences.mjs";
import { fuzzHash, openBeamerFuzzCorpus, mutateBeamerCorpusSequence, validateEditSequence } from "./lib/beamer-fuzz-corpus.mjs";
import { BEAMER_COVERAGE_SCOPE, readFuzzCoverage, summarizeFuzzCoverage } from "./lib/fuzz-coverage.mjs";
import { runFuzzProcess } from "./lib/fuzz-process.mjs";
const { values } = parseArgs({ options: {
  seed: { type: "string", default: "20261106" }, cases: { type: "string", default: "128" }, steps: { type: "string", default: "48" },
  "out-dir": { type: "string", default: "artifacts/beamer-edit-fuzz" }, replay: { type: "string" },
  "reduce-budget": { type: "string", default: "48" }, "max-failures": { type: "string", default: "5" },
  "case-timeout-ms": { type: "string", default: "180000" }, "reduction-timeout-ms": { type: "string", default: "300000" },
  "heap-mb": { type: "string", default: "1536" }, corpus: { type: "string", default: "artifacts/beamer-edit-corpus" },
  "corpus-replays": { type: "string", default: "4" }, mutations: { type: "string", default: "16" },
} });
for (const name of ["seed", "cases", "steps", "reduce-budget", "max-failures", "case-timeout-ms", "reduction-timeout-ms", "heap-mb", "corpus-replays", "mutations"]) {
  const number = Number(values[name]);
  if (!Number.isSafeInteger(number) || number < (["seed", "steps", "reduce-budget", "corpus-replays", "mutations"].includes(name) ? 0 : 1)) throw new Error(`Invalid --${name}`);
  values[name] = number;
}
const root = process.cwd(), out = resolve(values["out-dir"]);
if (existsSync(join(out, "report.json"))) throw new Error(`Refusing to overwrite an existing campaign: ${out}`);
mkdirSync(out, { recursive: true });
const read = path => { if (statSync(path).size > 64 * 1024 * 1024) throw new Error(`Oversized input: ${path}`); return JSON.parse(readFileSync(path, "utf8")); };
const write = (path, data) => { writeFileSync(path + ".tmp", JSON.stringify(data, null, 2) + "\n"); renameSync(path + ".tmp", path); };
const implementation = createHash("sha256");
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (/\.(?:tsx?|json)$/u.test(entry.name)) implementation.update(path + "\0").update(readFileSync(path)).update("\0");
  }
}
visit("packages/core/src"); visit("packages/app/src");
const implementationSha256 = implementation.digest("hex");
const harnessFiles = ["scripts/fuzz-beamer-edits.mjs", "scripts/lib/beamer-edit-sequences.mjs", "scripts/lib/beamer-fuzz-corpus.mjs", "scripts/lib/fuzz-coverage.mjs", "scripts/lib/fuzz-process.mjs", "scripts/lib/beamer-fuzz-cases.mjs", "scripts/lib/beamer-fuzz-broad.mjs", "test/differential/beamer-edit-campaign.spec.ts", "test/differential/beamer-edit-fuzz.ts", "test/differential/compute-fuzz.ts", "test/differential/compute-instances.ts", "vitest.config.ts", "package-lock.json"];
const harnessSha256 = fuzzHash(Buffer.concat(harnessFiles.map(path => readFileSync(path))));
const profile = { schema: 1, implementationSha256, harnessSha256, node: process.version, v8: process.versions.v8,
  vitest: read("node_modules/vitest/package.json").version, coverageV8: read("node_modules/@vitest/coverage-v8/package.json").version, scope: BEAMER_COVERAGE_SCOPE };
const namespace = fuzzHash(JSON.stringify(profile));
const corpus = openBeamerFuzzCorpus(resolve(values.corpus), namespace);
const initial = corpus.active().sort((a, b) => Number(a.measured) - Number(b.measured) || Number(a.status === "passed") - Number(b.status === "passed") || a.id.localeCompare(b.id));
const jobs = values.replay ? [{ sequence: validateEditSequence(read(resolve(values.replay))), origin: "replay" }]
  : [...initial.slice(0, values["corpus-replays"]).map(entry => ({ sequence: entry.sequence, origin: "corpus-replay", parent: entry.id })),
    ...generateBeamerFuzzCases({ seed: values.seed, cases: Math.max(33, values.cases) }).slice(0, values.cases).map((entry, index) => ({
      sequence: generateBeamerEditSequence(withEditProbes(entry.source), entry.fixture.family, (values.seed + index * 7919) >>> 0, values.steps), origin: "fresh" })),
    ...Array.from({ length: values.mutations }, (_, mutation) => ({ origin: "mutation", mutation }))];
const controller = new AbortController();
const interrupt = () => controller.abort(); process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
const hit = new Set(), all = new Set(), reach = {}, edits = {}, results = [], coverageFailures = [];
const limits = { caseTimeoutMs: values["case-timeout-ms"], reductionTimeoutMs: values["reduction-timeout-ms"], heapMb: values["heap-mb"], memoryLimitKind: "V8 old-space per Node isolate; not total RSS or native tool memory", workers: 1 };
const report = { formatVersion: 2, status: "running", seed: values.seed, profile, namespace, limits, plannedCases: jobs.length,
  corpusDirectory: resolve(values.corpus), initialCorpus: initial.map(entry => entry.id), results, reach, edits, comparisons: 0, coverageFailures };
function save() {
  report.sourceCoverage = summarizeFuzzCoverage(hit, all);
  report.corpus = { archived: corpus.entries.length, active: corpus.active().length, features: new Set(corpus.entries.flatMap(entry => entry.features)).size };
  report.completed = results.filter(entry => entry.status !== "running").length; report.passed = results.filter(entry => entry.status === "passed").length;
  write(join(out, "report.json"), report);
}
save();
try {
  for (const [index, job] of jobs.entries()) {
    if (controller.signal.aborted) break;
    if (job.origin === "mutation") {
      const parents = corpus.active().filter(entry => entry.status === "passed" && entry.measured);
      if (!parents.length) { coverageFailures.push("No measured passing corpus parent available for mutation"); break; }
      const parent = parents[(values.seed + job.mutation) % parents.length];
      job.sequence = mutateBeamerCorpusSequence(parent.sequence, (values.seed + 1000003 + job.mutation * 7919) >>> 0);
      job.parent = parent.id;
      if (!job.sequence) { coverageFailures.push("Corpus parent has no mutable source edits"); break; }
    }
    const id = `case-${String(index).padStart(4, "0")}`, directory = join(out, id);
    mkdirSync(directory, { recursive: true });
    const input = join(directory, "input.json"); write(input, job.sequence); writeFileSync(join(directory, "input.tex"), job.sequence.source);
    const entry = { id, origin: job.origin, parent: job.parent, sequenceSha256: fuzzHash(JSON.stringify(job.sequence)), status: "running", input };
    results.push(entry); save();
    const worker = join(directory, "worker"); mkdirSync(worker, { recursive: true });
    const env = { ...process.env, BEAMER_EDIT_FUZZ_REPLAY: input, BEAMER_EDIT_FUZZ_OUT: worker, BEAMER_EDIT_FUZZ_SKIP_REDUCTION: "1",
      BEAMER_EDIT_FUZZ_COVERAGE_DIRECTORY: join(worker, "coverage") };
    entry.process = await runFuzzProcess(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=1", "--pool=forks", "test/differential/beamer-edit-campaign.spec.ts"], {
      cwd: root, timeoutMs: limits.caseTimeoutMs, heapMb: limits.heapMb, logPath: join(directory, "worker.log"), env, signal: controller.signal });
    const child = existsSync(join(worker, "report.json")) ? read(join(worker, "report.json")) : null;
    const result = child?.results?.[0];
    entry.status = entry.process.status === "completed" && child?.status === "complete" && result?.status === "passed" ? "passed"
      : entry.process.status === "failed" && child?.status === "complete" && ["mismatch", "error"].includes(result?.status) ? result.status
      : ["completed", "failed"].includes(entry.process.status) ? "harness-error" : entry.process.status;
    entry.key = result?.key;
    if (child) {
      report.comparisons += child.comparisons ?? 0;
      for (const [key, value] of Object.entries(child.reach ?? {})) reach[key] = (reach[key] ?? 0) + value;
      for (const [key, value] of Object.entries(child.edits ?? {})) edits[key] = (edits[key] ?? 0) + value;
      if (child.implementationSha256 !== implementationSha256) { entry.status = "harness-error"; entry.error = "Implementation changed during campaign"; }
      if (child.coverageFailures?.length) { entry.status = "harness-error"; entry.error = child.coverageFailures.join("; "); }
    }
    let features = [];
    try {
      const coverage = readFuzzCoverage(read(join(worker, "coverage", "coverage-final.json")), root);
      features = coverage.hit;
      entry.newFeatures = features.filter(key => !hit.has(key)).length;
      for (const key of coverage.all) all.add(key);
      for (const key of features) hit.add(key);
    } catch (error) {
      entry.coverageError = String(error);
      if (entry.status === "passed") entry.status = "harness-error";
    }
    const corpusHit = new Set(corpus.entries.flatMap(item => item.features));
    entry.newCorpusFeatures = features.filter(key => !corpusHit.has(key)).length;
    if (entry.status !== "passed" || entry.newCorpusFeatures || job.origin === "corpus-replay") corpus.remember(job.sequence, {
      features, status: entry.status, failureKey: entry.key, limits, artifact: directory,
    });
    save();
    if (entry.status === "mismatch" && values["reduce-budget"] > 0 && !controller.signal.aborted) {
      const reduction = join(directory, "reduction"); mkdirSync(reduction, { recursive: true });
      entry.reductionProcess = await runFuzzProcess(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=1", "--pool=forks", "test/differential/beamer-edit-campaign.spec.ts"], {
        cwd: root, timeoutMs: limits.reductionTimeoutMs, heapMb: limits.heapMb, logPath: join(directory, "reduction.log"), signal: controller.signal,
        env: { ...env, BEAMER_EDIT_FUZZ_OUT: reduction, BEAMER_EDIT_FUZZ_COVERAGE_DIRECTORY: "", BEAMER_EDIT_FUZZ_SKIP_REDUCTION: "", BEAMER_EDIT_FUZZ_REDUCE_BUDGET: String(values["reduce-budget"]) },
      });
      save();
    }
    console.log(`[beamer-edit-fuzz] ${index + 1}/${jobs.length} ${job.origin} ${job.sequence.family}: ${entry.status}; ${entry.newFeatures ?? 0} new source features; ${report.comparisons} comparisons`);
    if (results.filter(item => item.status !== "passed").length >= values["max-failures"]) break;
  }
  if (!values.replay && results.length === jobs.length && results.every(entry => entry.status === "passed")) {
    if (values.steps >= EDIT_FIELDS.length) for (const field of EDIT_FIELDS) if (!(edits[field] > 0)) coverageFailures.push(`No effective ${field} edit`);
    if (values.cases >= 33) for (const key of ["deck:claimed", "deck:prewarm", "race", "layer:shown", "parse:incremental", "semantic:incremental:selective", "suffix:skipped", "patches:rebased", "layer:slide-layout-reused"]) if (!(reach[key] > 0)) coverageFailures.push(`No ${key} reached`);
  }
  if (!hit.size && results.every(entry => entry.status === "passed")) coverageFailures.push("No measured target coverage");
  report.status = controller.signal.aborted ? "interrupted" : results.length < jobs.length ? "stopped" : results.some(entry => entry.status !== "passed") || coverageFailures.length ? "failed" : "complete";
} catch (error) { report.status = controller.signal.aborted ? "interrupted" : "harness-error"; report.error = String(error); }
finally { report.finishedAt = new Date().toISOString(); save(); process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); }
process.exitCode = report.status === "complete" ? 0 : 1;
