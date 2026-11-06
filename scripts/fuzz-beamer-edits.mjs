#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { values } = parseArgs({ options: {
  seed: { type: "string", default: "20261106" }, cases: { type: "string", default: "128" }, steps: { type: "string", default: "48" },
  "out-dir": { type: "string", default: "artifacts/beamer-edit-fuzz" }, replay: { type: "string" },
  "reduce-budget": { type: "string", default: "48" }, "max-failures": { type: "string", default: "5" },
} });
for (const name of ["seed", "cases", "steps", "reduce-budget", "max-failures"]) {
  const number = Number(values[name]);
  if (!Number.isSafeInteger(number) || number < (name === "seed" || name === "reduce-budget" ? 0 : 1)) throw new Error(`Invalid --${name}`);
}
const out = resolve(values["out-dir"]);
if (existsSync(resolve(out, "report.json"))) throw new Error(`Refusing to overwrite an existing campaign: ${out}`);
mkdirSync(out, { recursive: true });
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=1", "test/differential/beamer-edit-campaign.spec.ts"], {
  stdio: "inherit", env: { ...process.env,
    BEAMER_EDIT_FUZZ_OUT: out, BEAMER_EDIT_FUZZ_SEED: values.seed, BEAMER_EDIT_FUZZ_CASES: values.cases,
    BEAMER_EDIT_FUZZ_STEPS: values.steps, BEAMER_EDIT_FUZZ_REDUCE_BUDGET: values["reduce-budget"],
    BEAMER_EDIT_FUZZ_MAX_FAILURES: values["max-failures"], BEAMER_EDIT_FUZZ_REPLAY: values.replay ? resolve(values.replay) : "",
  },
});
const reportPath = resolve(out, "report.json");
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : { status: "startup-error" };
if (report.status === "running") report.status = "interrupted";
report.exitCode = result.status; report.signal = result.signal; report.finishedAt = new Date().toISOString();
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
