#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { BEAMER_FUZZ_GENERATOR_VERSION, generateBeamerFuzzCases } from "./lib/beamer-fuzz-cases.mjs";
import { stageFuzzGraphicsAssets } from "./lib/fuzz-graphics-assets.mjs";
const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "20261105" },
    cases: { type: "string", default: "48" },
    profile: { type: "string", default: "broad" },
    "out-dir": { type: "string", default: "artifacts/beamer-fuzz" },
    "generate-only": { type: "boolean", default: false },
  },
});
const root = resolve(values["out-dir"]);
const fixtureRoot = join(root, "cases");
const cases = generateBeamerFuzzCases({
  seed: Number(values.seed),
  cases: Number(values.cases),
  profile: values.profile,
});
mkdirSync(fixtureRoot, { recursive: true });
stageFuzzGraphicsAssets(fixtureRoot);
for (const c of cases) writeFileSync(join(fixtureRoot, c.fixture.file), c.source);
const manifest = join(fixtureRoot, "cases.json");
const coverage = {
  cases: cases.length,
  frames: cases.reduce((sum, c) => sum + 1 + (c.additionalFixtures?.length ?? 0), 0),
  uniqueSources: new Set(cases.map(c => c.source)).size,
  pages: cases.reduce((sum, c) => sum + c.fixture.pages + (c.additionalFixtures ?? []).reduce((n, frame) => n + frame.pages, 0), 0),
  families: Object.fromEntries([...new Set(cases.map(c => c.fixture.family))].sort().map(family => [family, cases.filter(c => c.fixture.family === family).length])),
  structural: {
    recursiveCases: cases.filter(c => c.fixture.choices?.grammar).length,
    nodeCounts: cases.flatMap(c => c.fixture.choices?.grammar ? [c.fixture.choices.grammar.nodes] : []),
    depths: [...new Set(cases.flatMap(c => c.fixture.choices?.grammar ? [c.fixture.choices.grammar.depth] : []))].sort(),
    features: [...new Set(cases.flatMap(c => Object.keys(c.fixture.choices?.grammar?.features ?? {})))].sort(),
    interactions: [...new Set(cases.flatMap(c => c.fixture.choices?.grammar?.pairs ?? []))].sort(),
  },
  documentAxes: Object.fromEntries(["fontSize", "aspectRatio", "theme"].map(axis => [axis, [...new Set(cases.map(c => c.fixture.choices?.[axis]).filter(value => value !== undefined))]])),
};
writeFileSync(join(root, "coverage.json"), JSON.stringify(coverage, null, 2) + "\n");
writeFileSync(manifest, JSON.stringify({
  formatVersion: 1,
  generatorVersion: values.profile === "smoke" ? 1 : values.profile === "controls" ? 2 : BEAMER_FUZZ_GENERATOR_VERSION,
  coverage,
  profile: values.profile,
  title: `Beamer fuzz seed ${values.seed}`,
  seed: Number(values.seed),
  fidelity: cases.flatMap(c => [c.fixture, ...(c.additionalFixtures ?? [])]),
  recognition: [],
}, null, 2) + "\n");
console.log(`Generated ${cases.length} replayable Beamer cases: ${manifest}`);
if (!values["generate-only"]) {
  const result = spawnSync(process.execPath, [
    "scripts/compare-beamer-priorities.mjs", "--manifest", manifest,
    "--out-dir", join(root, "comparison"),
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
