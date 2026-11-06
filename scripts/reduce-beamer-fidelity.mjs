#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runFuzzProcess } from "./lib/fuzz-process.mjs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { values } = parseArgs({ options: { input: { type: "string" }, anchor: { type: "string" }, witness: { type: "string" },
  "out-dir": { type: "string", default: "artifacts/beamer-fidelity-reduction" }, budget: { type: "string", default: "32" }, "timeout-ms": { type: "string", default: "600000" }, "heap-mb": { type: "string", default: "1536" } } });
if (!values.input || !values.anchor) throw new Error("Require --input and --anchor (unique source text in the failing frame; --witness may specify separate visible text).");
for (const key of ["budget", "timeout-ms", "heap-mb"]) if (!Number.isSafeInteger(Number(values[key])) || Number(values[key]) < (key === "budget" ? 0 : 1)) throw new Error(`Invalid --${key}`);
const out = resolve(values["out-dir"]);
if (existsSync(out)) throw new Error(`Refusing to overwrite an existing reduction: ${out}`);
mkdirSync(out, { recursive: true });
const controller = new AbortController();
const interrupt = () => controller.abort(); process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
const result = await runFuzzProcess(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--maxWorkers=1", "test/differential/beamer-fidelity-reduction.spec.ts"], {
  timeoutMs: Number(values["timeout-ms"]), heapMb: Number(values["heap-mb"]), logPath: resolve(out, "worker.log"), signal: controller.signal, env: { ...process.env, BEAMER_FIDELITY_REDUCE_INPUT: resolve(values.input), BEAMER_FIDELITY_REDUCE_ANCHOR: values.anchor, BEAMER_FIDELITY_REDUCE_WITNESS: values.witness ?? values.anchor,
    BEAMER_FIDELITY_REDUCE_OUT: out, BEAMER_FIDELITY_REDUCE_BUDGET: values.budget },
});
process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
writeFileSync(resolve(out, "process.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`Fidelity reduction ${result.status}; inspect ${out}`);
process.exitCode = result.status === "completed" ? 0 : 1;
