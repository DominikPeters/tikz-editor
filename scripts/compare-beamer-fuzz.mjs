#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { BEAMER_FUZZ_GENERATOR_VERSION, generateBeamerFuzzCases } from "./lib/beamer-fuzz-cases.mjs";
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
for (const c of cases) writeFileSync(join(fixtureRoot, c.fixture.file), c.source);
const manifest = join(fixtureRoot, "cases.json");
const hash = source => createHash("sha256").update(source).digest("hex");
const coverage = {
  cases: cases.length,
  uniqueSources: new Set(cases.map(c => hash(c.source))).size,
  pages: cases.reduce((sum, c) => sum + c.fixture.pages, 0),
  families: Object.fromEntries([...new Set(cases.map(c => c.fixture.family))].sort().map(family => [family, cases.filter(c => c.fixture.family === family).length])),
  documentAxes: Object.fromEntries(["fontSize", "aspectRatio", "theme"].map(axis => [axis, [...new Set(cases.map(c => c.fixture.choices?.[axis]).filter(value => value !== undefined))]])),
};
const generatorSha256 = hash(["beamer-fuzz-cases.mjs", "beamer-fuzz-broad.mjs"].map(file => readFileSync(new URL(`./lib/${file}`, import.meta.url), "utf8")).join("\n"));
writeFileSync(join(root, "coverage.json"), JSON.stringify({ generatorSha256, ...coverage }, null, 2) + "\n");
writeFileSync(manifest, JSON.stringify({
  formatVersion: 1,
  generatorVersion: values.profile === "smoke" ? 1 : BEAMER_FUZZ_GENERATOR_VERSION,
  generatorSha256,
  coverage,
  profile: values.profile,
  title: `Beamer fuzz seed ${values.seed}`,
  seed: Number(values.seed),
  fidelity: cases.map(c => c.fixture),
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
