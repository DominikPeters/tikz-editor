import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateBeamerFuzzCases } from "../../scripts/lib/beamer-fuzz-cases.mjs";
import { FUZZ_GRAPHICS_ASSET_SHA256, stageFuzzGraphicsAssets } from "../../scripts/lib/fuzz-graphics-assets.mjs";
import { EDIT_FIELDS, beamerFailureKey, generateBeamerEditSequence, materializeBeamerEdits, reduceBeamerEditSequence,
  runBeamerEditSequence, sourceHash, withEditProbes, type BeamerEditSequence } from "./beamer-edit-fuzz.js";
import type { FuzzReach } from "./compute-fuzz.js";

const numeric = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
describe("generated Beamer edit differential campaign", () => {
  it("matches a cold instance across edits, cache claims, races and history", async () => {
    const seed = numeric("BEAMER_EDIT_FUZZ_SEED", 20261106), count = numeric("BEAMER_EDIT_FUZZ_CASES", 2), steps = numeric("BEAMER_EDIT_FUZZ_STEPS", 14);
    const out = process.env.BEAMER_EDIT_FUZZ_OUT ?? mkdtempSync(join(tmpdir(), "beamer-edit-fuzz-"));
    mkdirSync(out, { recursive: true });
    stageFuzzGraphicsAssets(out);
    const write = (file: string, value: unknown) => { const path = join(out, file); writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n"); renameSync(path + ".tmp", path); };
    const replay = process.env.BEAMER_EDIT_FUZZ_REPLAY;
    const cases = replay ? [JSON.parse(readFileSync(replay, "utf8")) as BeamerEditSequence]
      : generateBeamerFuzzCases({ seed, cases: Math.max(33, count) }).slice(0, count).map((entry, index) => generateBeamerEditSequence(withEditProbes(entry.source), entry.fixture.family, (seed + index * 7919) >>> 0, steps));
    if (cases.some(sequence => sequence.formatVersion !== 1 || typeof sequence.source !== "string" || !Array.isArray(sequence.actions) ||
        ![undefined, 1, 2].includes(sequence.probeVersion))) {
      throw new Error("Replay requires a saved case.json or case.reduced.json with a supported format/probe version.");
    }
    const coverageFailures: string[] = [];
    const reach: FuzzReach = {}, edits: Record<string, number> = {}, families: Record<string, number> = {};
    let comparisons = 0;
    const results: Array<{ id: string; status: string; comparisons: number; sourceSha256: string; sequenceSha256: string; key?: string; reduction?: { attempts: number; accepted: number; beforeActions: number; afterActions: number; beforeChars: number; afterChars: number; budgetExhausted: boolean }; error?: string }> = [];
    const fingerprint = createHash("sha256");
    for (const path of ["test/differential/beamer-edit-fuzz.ts", "test/differential/compute-fuzz.ts", "test/differential/compute-instances.ts", "test/differential/graphics-platform.ts", "packages/tex-fuzz/src/graphics.ts", "scripts/lib/fuzz-graphics-assets.mjs", "scripts/lib/beamer-fuzz-broad.mjs", "scripts/lib/beamer-fuzz-cases.mjs", "scripts/lib/beamer-fuzz-intricate.mjs", "scripts/lib/beamer-fuzz-images.mjs", "scripts/lib/beamer-edit-sequences.mjs"]) fingerprint.update(readFileSync(path));
    const harnessSha256 = fingerprint.digest("hex");
    const implementation = createHash("sha256");
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(directory, entry.name);
        const sourceFile = /\.(?:tsx?|json)$/u.test(entry.name);
        if (entry.isDirectory()) visit(path);
        else if (sourceFile) implementation.update(path + "\0").update(readFileSync(path)).update("\0");
      }
    };
    visit("packages/core/src"); visit("packages/app/src");
    const implementationSha256 = implementation.digest("hex");
    const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const report = (status: string) => ({ formatVersion: 1, status, seed: replay ? cases[0].seed : seed, plannedCases: cases.length, steps: replay ? cases[0].actions.filter(action => action.kind === "set").length : steps, harnessSha256, implementationSha256, graphicsAssetsSha256: FUZZ_GRAPHICS_ASSET_SHA256, gitHead,
      completed: results.length, passed: results.filter(r => r.status === "passed").length, failed: results.filter(r => r.status === "mismatch").length,
      errors: results.filter(r => r.status === "error").length, comparisons, reach, edits, families, coverageFailures, results });
    write("report.json", report("running"));
    for (const [index, sequence] of cases.entries()) {
      const id = `case-${String(index).padStart(4, "0")}`, materialized = materializeBeamerEdits(sequence);
      write(`${id}.json`, sequence);
      write(`${id}.ops.json`, { documents: [{ label: sequence.family, source: sequence.source }], ops: materialized.ops });
      writeFileSync(join(out, `${id}.tex`), sequence.source);
      const result = await runBeamerEditSequence(sequence);
      comparisons += result.comparisons;
      for (const [key, value] of Object.entries(result.reach)) reach[key] = (reach[key] ?? 0) + value;
      // Count only edits actually reached before the first failure.
      const reached = materializeBeamerEdits({ ...sequence, actions: sequence.actions.slice(0, result.failure ? materialized.opActions[result.failure.opIndex] + 1 : undefined) });
      for (const [key, value] of Object.entries(reached.effectiveEdits)) edits[key] = (edits[key] ?? 0) + value;
      families[sequence.family] = (families[sequence.family] ?? 0) + 1;
      const entry: typeof results[number] = { id, status: result.failure ? result.failure.what === "threw" ? "error" : "mismatch" : "passed", comparisons: result.comparisons,
        sourceSha256: sourceHash(sequence.source), sequenceSha256: sourceHash(JSON.stringify(sequence, null, 2) + "\n") };
      results.push(entry);
      write("report.json", report("running"));
      if (result.failure) {
        write(`${id}.failure.json`, result.failure);
        writeFileSync(join(out, `${id}.failing-state.tex`), result.failure.request.source);
        entry.key = beamerFailureKey(result.failure);
        if (entry.status === "mismatch" && process.env.BEAMER_EDIT_FUZZ_SKIP_REDUCTION !== "1") {
          try {
            const reduced = await reduceBeamerEditSequence(sequence, { budget: numeric("BEAMER_EDIT_FUZZ_REDUCE_BUDGET", 48), onProgress: progress => {
              write(`${id}.reduced.json`, progress.sequence); write(`${id}.reduction.json`, progress);
            } });
            write(`${id}.reduced.json`, reduced.sequence); write(`${id}.reduction.json`, reduced);
            writeFileSync(join(out, `${id}.reduced.tex`), reduced.sequence.source);
            writeFileSync(join(out, `${id}.reduced-failing-state.tex`), reduced.failure.request.source);
            entry.reduction = { attempts: reduced.attempts, accepted: reduced.accepted, beforeActions: sequence.actions.length, afterActions: reduced.sequence.actions.length,
              beforeChars: sequence.source.length, afterChars: reduced.sequence.source.length, budgetExhausted: reduced.budgetExhausted };
          } catch (error) { entry.error = `Reduction failed: ${String(error)}`; }
        }
      }
      write("report.json", report("running"));
      console.log(`[beamer-edit-fuzz] ${index + 1}/${cases.length} ${sequence.family}: ${entry.status}; ${comparisons} comparisons`);
      if (results.filter(r => r.status !== "passed").length >= numeric("BEAMER_EDIT_FUZZ_MAX_FAILURES", 5)) break;
    }
    const complete = results.length === cases.length;
    if (complete && !results.some(r => r.status !== "passed")) {
      if (comparisons < (replay ? 1 : cases.length + 1)) coverageFailures.push("No effective differential comparisons");
      if (!replay && steps >= EDIT_FIELDS.length) for (const field of EDIT_FIELDS) if (!(edits[field] > 0)) coverageFailures.push(`No effective ${field} edit`);
      if (!replay && cases.length >= 33) for (const key of ["deck:claimed", "deck:prewarm", "race", "layer:shown", "parse:incremental", "semantic:incremental:selective", "suffix:skipped", "patches:rebased", "layer:slide-layout-reused"]) {
        if (!(reach[key] > 0)) coverageFailures.push(`No ${key} reached`);
      }
    }
    write("report.json", report(complete ? "complete" : "stopped-at-failure-limit"));
    expect(results.filter(r => r.status !== "passed"), `Failures saved in ${out}`).toEqual([]);
    expect(complete).toBe(true);
    expect(coverageFailures, `Coverage failures saved in ${out}`).toEqual([]);
    if (!process.env.BEAMER_EDIT_FUZZ_OUT) rmSync(out, { recursive: true, force: true });
  }, 86_400_000);
});
