#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const { values } = parseArgs({ options: { input: { type: "string" }, anchor: { type: "string" }, witness: { type: "string" },
  "out-dir": { type: "string", default: "artifacts/beamer-fidelity-reduction" }, budget: { type: "string", default: "32" } } });
if (!values.input || !values.anchor) throw new Error("Require --input and --anchor (unique source text in the failing frame; --witness may specify separate visible text).");
if (!Number.isSafeInteger(Number(values.budget)) || Number(values.budget) < 0) throw new Error("Invalid --budget");
const out = resolve(values["out-dir"]);
if (existsSync(out)) throw new Error(`Refusing to overwrite an existing reduction: ${out}`);
mkdirSync(out, { recursive: true });
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=1", "test/differential/beamer-fidelity-reduction.spec.ts"], {
  stdio: "inherit", env: { ...process.env, BEAMER_FIDELITY_REDUCE_INPUT: resolve(values.input), BEAMER_FIDELITY_REDUCE_ANCHOR: values.anchor, BEAMER_FIDELITY_REDUCE_WITNESS: values.witness ?? values.anchor,
    BEAMER_FIDELITY_REDUCE_OUT: out, BEAMER_FIDELITY_REDUCE_BUDGET: values.budget },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
