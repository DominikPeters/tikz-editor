#!/usr/bin/env node
// Recheck every state against saved independent TeX traces. This does not
// replace live raster/paint checks; it makes structural failure triage cheap.
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { loadCoreRenderer, structuralContractFailures } from "./compare-beamer-frame.mjs";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces } from "./lib/beamer-frame-compare.mjs";
import { priorityOracleFailures } from "./lib/beamer-priority-contracts.mjs";

const { values } = parseArgs({ options: { run: { type: "string" }, out: { type: "string" } } });
if (!values.run || !values.out) throw Error("Require --run and --out");
const root = resolve(values.run), out = resolve(values.out);
mkdirSync(out, { recursive: true });
const read = path => JSON.parse(readFileSync(path, "utf8"));
const saved = read(join(root, "report.json"));
if (saved.status !== "complete") throw Error("Require a complete saved campaign");
const sourceFingerprint = () => {
  const hash = createHash("sha256");
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else { hash.update(path); hash.update(readFileSync(path)); }
    }
  };
  visit("packages/core/src");
  hash.update(readFileSync("scripts/lib/beamer-frame-compare.mjs"));
  return hash.digest("hex");
};
const fingerprint = sourceFingerprint();
const core = await loadCoreRenderer(), cache = new Map();
if (sourceFingerprint() !== fingerprint) throw Error("Sources changed during build; rerun against a stable tree");
const report = { kind: "saved-independent-structural-replay", sourceRun: root,
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceFingerprint: fingerprint,
  status: "running", results: [], passed: 0, failed: 0, states: 0 };
const save = () => writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
save();
for (const entry of saved.results) {
  const result = { id: entry.id, fixture: entry.fixture, states: [], failures: [] };
  for (const snapshot of entry.snapshots) {
    try {
    const path = resolve(root, snapshot.report), previous = read(path), directory = dirname(path);
    const source = readFileSync(join(directory, previous.input.materializedPath ?? "input.tex"), "utf8");
    const hash = createHash("sha256").update(source).digest("hex");
    const oracle = read(join(directory, previous.oracle.report));
    if (oracle.input.sha256 !== hash) throw Error(`Source identity mismatch: ${entry.id}`);
    const invalid = priorityOracleFailures(oracle, entry.fixture);
    if (invalid.length) throw Error(`Invalid reference ${entry.id}: ${invalid.join(", ")}`);
    let prepared = cache.get(hash);
    if (!prepared) { prepared = core.prepareBeamerDocument(source); cache.set(hash, prepared); }
    const page = await prepared.renderFrame({ frameIndex: previous.input.frameNumber - 1, step: snapshot.page });
    const comparison = compareBeamerPageTraces(buildNativeBeamerPageTrace(page, core.computerModernTexMetricProvider), read(join(directory, "oracle-page-trace.json")));
    const failures = structuralContractFailures(comparison.summary);
    const state = { page: snapshot.page, sourceSha256: hash, summary: comparison.summary,
      diagnostics: page.diagnostics, literal: page.svg.svg.includes("data-tex-literal="), failures };
    const target = join(out, entry.id + "-" + snapshot.page); mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "comparison.json"), JSON.stringify(comparison, null, 2) + "\n");
    writeFileSync(join(target, "renderer.svg"), page.svg.svg);
    result.states.push(state); report.states++;
    result.failures.push(...failures.map(failure => `State ${snapshot.page}: ${failure}`));
    if (page.diagnostics.length) result.failures.push(`State ${snapshot.page}: renderer diagnostics`);
    if (state.literal) result.failures.push(`State ${snapshot.page}: literal native output`);
    } catch (error) {
      result.states.push({ page: snapshot.page, status: "error", error: String(error.stack ?? error) });
      result.failures.push(`State ${snapshot.page}: ${error.message ?? error}`);
      report.states++;
    }
  }
  if (result.states.length !== entry.fixture.pages) result.failures.push("Missing states");
  result.status = result.failures.length ? "mismatch" : "passed";
  report[result.status === "passed" ? "passed" : "failed"]++;
  report.results.push(result); save();
  console.log(`${result.id}: ${result.status}`);
}
report.endingSourceFingerprint = sourceFingerprint();
report.status = report.endingSourceFingerprint === fingerprint ? "complete" : "invalidated-by-source-change";
save();
if (report.status !== "complete") process.exitCode = 2;
else if (report.failed) process.exitCode = 1;
console.log(`${report.passed} passed, ${report.failed} failed, ${report.states} states`);
