/** Opt-in independent TeX predicate for the shared balanced-source reducer. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanBeamerDocument } from "../../packages/core/src/beamer/index.js";
import { compareBeamerFrame, loadCoreRenderer, structuralContractFailures } from "../../scripts/compare-beamer-frame.mjs";
import { priorityOracleFailures } from "../../scripts/lib/beamer-priority-contracts.mjs";
import { beamerFailureKey, materializeBeamerEdits, reduceBeamerEditSequence, sourceHash, type BeamerEditSequence } from "./beamer-edit-fuzz.js";
import type { FuzzRunResult } from "./compute-fuzz.js";

describe.runIf(process.env.BEAMER_FIDELITY_REDUCE_INPUT)("independent LuaLaTeX failure reduction", () => {
  it("reduces a structural mismatch while retaining valid TeX and its witness", async () => {
    const input = process.env.BEAMER_FIDELITY_REDUCE_INPUT!, anchor = process.env.BEAMER_FIDELITY_REDUCE_ANCHOR!;
    const out = process.env.BEAMER_FIDELITY_REDUCE_OUT!;
    const witness = process.env.BEAMER_FIDELITY_REDUCE_WITNESS ?? anchor;
    mkdirSync(out, { recursive: true });
    const source = readFileSync(input, "utf8"), core = await loadCoreRenderer();
    const initial: BeamerEditSequence = { formatVersion: 1, probeVersion: 2, seed: 0, family: "independent-TeX", source, actions: [] };
    writeFileSync(join(out, "original.tex"), source);
    let trial = 0;
    const trials: Array<{ id: string; sourceSha256: string; valid: boolean; key?: string; error?: string }> = [];
    const run = async (sequence: BeamerEditSequence): Promise<FuzzRunResult> => {
      const text = materializeBeamerEdits(sequence).finalSource;
      const document = scanBeamerDocument(text);
      const frames = document.frames.map((frame, index) => ({ index, text: text.slice(frame.span.from, frame.span.to) })).filter(frame => frame.text.includes(anchor));
      const empty = { failure: null, comparisons: 0, reach: {} };
      if (document.diagnostics.length || frames.length !== 1) return empty;
      const frame = frames[0], frameNumber = frame.index + 1;
      const id = `trial-${String(trial++).padStart(4, "0")}`;
      const path = join(out, id + ".tex"); writeFileSync(path, text);
      const entry: typeof trials[number] = { id, sourceSha256: sourceHash(text), valid: false }; trials.push(entry);
      try {
        const { report, runDir } = await compareBeamerFrame({ inputPath: path, frameNumber, pageNumber: 1, outDir: out, name: id,
          width: 1600, themeVariant: {}, sourceDir: dirname(input), structuralOnly: true, pdfOnly: true, assertStructural: false }, { source: text, coreRenderer: core });
        const oracle = JSON.parse(readFileSync(join(runDir, report.oracle.report), "utf8"));
        if (oracle.input.sha256 !== sourceHash(text) || priorityOracleFailures(oracle, { pages: report.input.pageCount, oracleText: [witness] }).length || report.renderer.diagnostics.length) return empty;
        entry.valid = true;
        const mismatch = structuralContractFailures(report.structural.summary)[0];
        if (!mismatch) return { ...empty, comparisons: 1 };
        const field = mismatch.split("=")[0];
        const failure = { opIndex: 0, op: { kind: "render" as const, doc: 0 }, what: "LuaLaTeX structural contract",
          request: { id, source: text, activeRootId: `frame:${frame.index}`, deckStep: 1 }, differences: [`${field}: ${mismatch}`] };
        entry.key = beamerFailureKey(failure);
        return { failure, comparisons: 1, reach: {} };
      } catch (error) { entry.error = String(error); return empty; }
      finally { writeFileSync(join(out, "trials.json"), JSON.stringify(trials, null, 2) + "\n"); }
    };
    const reduced = await reduceBeamerEditSequence(initial, { run,
      // The independent predicate above already requires valid TeX, source
      // identity, visible witnesses and the same mismatch category. Literal
      // native output can be the bug itself; the warm/cold reducer's default
      // no-literal acceptance guard would prevent reducing those failures.
      acceptSource: async () => true,
      budget: Number(process.env.BEAMER_FIDELITY_REDUCE_BUDGET ?? 32), onProgress: progress => {
      writeFileSync(join(out, "reduced.tex"), progress.sequence.source);
      writeFileSync(join(out, "reduction.json"), JSON.stringify(progress, null, 2) + "\n");
    } });
    writeFileSync(join(out, "reduced.tex"), reduced.sequence.source);
    writeFileSync(join(out, "reduction.json"), JSON.stringify(reduced, null, 2) + "\n");
    expect(reduced.sequence.source.length).toBeLessThanOrEqual(source.length);
    console.log(`[beamer-fidelity-reduce] ${source.length} → ${reduced.sequence.source.length} chars; ${reduced.attempts} trials; ${reduced.key}`);
  }, 86_400_000);
});
