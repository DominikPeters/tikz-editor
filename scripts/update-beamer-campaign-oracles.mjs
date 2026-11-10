#!/usr/bin/env node
// Save compiled TeX traces as regression-test reference data.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
const run = resolve(process.argv[2] ?? "artifacts/beamer-fidelity-campaign/wave1");
const manifestPath = resolve(process.argv[3] ?? "test/fixtures/beamer/fidelity-campaign/cases.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const report = JSON.parse(readFileSync(join(run, "report.json"), "utf8"));
for (const fixture of manifest.fidelity) {
  const result = report.results.find(result => result.id === fixture.id);
  const input = join(dirname(manifestPath), fixture.file);
  if (result?.snapshots?.length !== fixture.pages) throw new Error(`Missing TeX pages: ${fixture.id}`);
  const pages = result.snapshots.map(snapshot => {
    const trace = JSON.parse(readFileSync(join(dirname(join(run, snapshot.report)), "oracle-page-trace.json"), "utf8"));
    // Box trees aid live diagnosis; the offline contract consumes glyphs and rules.
    return { ...trace, boxes: [] };
  });
  const comparison = JSON.parse(readFileSync(join(run, result.snapshots[0].report), "utf8"));
  const oracle = JSON.parse(readFileSync(join(dirname(join(run, result.snapshots[0].report)), comparison.oracle.report), "utf8"));
  const date = /^(\d+)-(\d+)-(\d+)$/u.exec(oracle.tex.selectedPage.metadata.compilationDate ?? "");
  if (!date) throw new Error(`Missing TeX compilation date: ${fixture.id}`);
  const compilationDate = { year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) };
  const snapshot = { engine: oracle.environment.engineBanner, compilationDate, pages };
  writeFileSync(input.replace(/\.tex$/u, ".oracle.json"), JSON.stringify(snapshot, null, 2) + "\n");
}
console.log(`Saved ${manifest.fidelity.length} TeX reference files.`);
