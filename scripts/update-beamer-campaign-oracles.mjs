#!/usr/bin/env node
// Pin only independently compiled TeX traces from a fully passing live run.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileSha256 } from "./lib/beamer-frame-oracle.mjs";
const run = resolve(process.argv[2] ?? "artifacts/beamer-fidelity-campaign/wave1");
const manifestPath = resolve("test/fixtures/beamer/fidelity-campaign/cases.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const report = JSON.parse(readFileSync(join(run, "report.json"), "utf8"));
if (report.status !== "complete" || report.failed || report.results.length !== manifest.fidelity.length || report.manifestSha256 !== fileSha256(manifestPath)) {
  throw new Error("Require a complete passing campaign run of the current manifest.");
}
for (const fixture of manifest.fidelity) {
  const result = report.results.find(result => result.id === fixture.id);
  const input = join(dirname(manifestPath), fixture.file);
  if (result?.status !== "passed" || result.sourceSha256 !== fileSha256(input)) throw new Error(`Missing or stale TeX evidence: ${fixture.id}`);
  const pages = result.snapshots.map(snapshot => {
    const trace = JSON.parse(readFileSync(join(dirname(join(run, snapshot.report)), "oracle-page-trace.json"), "utf8"));
    // Box trees aid live diagnosis; the offline contract consumes glyphs and rules.
    return { ...trace, boxes: [] };
  });
  const snapshot = { sourceSha256: result.sourceSha256, engine: "LuaLaTeX / TeX Live 2025", provenance: "compare:beamer-campaign, valid content witnesses and matching page counts", pages };
  writeFileSync(input.replace(/\.tex$/u, ".oracle.json"), JSON.stringify(snapshot, null, 2) + "\n");
}
console.log(`Pinned ${manifest.fidelity.length} independent TeX traces.`);
