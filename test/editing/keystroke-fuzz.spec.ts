import { describe, expect, it } from "vitest";
import { beamerCorpusScopes } from "./beamer-corpus.js";
import { runCampaign, type FuzzStart } from "./fuzz/keystroke-fuzz.js";

/**
 * Random keystrokes on every scope of the Beamer fixtures, checked after
 * every key against the editing contracts (see fuzz/keystroke-fuzz.ts).
 * KEYSTROKE_FUZZ_CASES and KEYSTROKE_FUZZ_SEED scale and vary the run.
 */
const CASES = Number(process.env.KEYSTROKE_FUZZ_CASES ?? 150);
const SEED = Number(process.env.KEYSTROKE_FUZZ_SEED ?? 20261009);

export const fuzzStarts: FuzzStart[] = beamerCorpusScopes().map((scope) => ({
  label: `${scope.file} frame ${scope.frameIndex + 1} ${scope.kind}`,
  text: scope.text,
  commands: scope.commands,
  title: scope.kind === "frame-title",
}));

describe("keystroke fuzzing", () => {
  it(`keeps the editing contracts over ${CASES} random key sequences`, () => {
    const result = runCampaign({ starts: fuzzStarts, seed: SEED, cases: CASES, length: 24 });
    expect(result.failures.join("\n\n")).toBe("");
    // The generator must keep reaching edits, or the run proves little.
    expect(result.edits).toBeGreaterThan(CASES * 4);
  }, 300_000);
});
