import { describe, expect, it } from "vitest";
import { beamerCorpusScopes } from "./beamer-corpus.js";
import { corpusStarts, runCampaign } from "./fuzz/keystroke-fuzz.js";

/**
 * Random keystrokes on every scope of the Beamer fixtures, checked after
 * every key against the editing contracts (see fuzz/keystroke-fuzz.ts).
 * KEYSTROKE_FUZZ_CASES and KEYSTROKE_FUZZ_SEED scale and vary the run.
 */
const CASES = Number(process.env.KEYSTROKE_FUZZ_CASES ?? 150);
const SEED = Number(process.env.KEYSTROKE_FUZZ_SEED ?? 20261009);

const fuzzStarts = corpusStarts(beamerCorpusScopes());

describe("keystroke fuzzing", () => {
  it(`keeps the editing contracts over ${CASES} random key sequences`, () => {
    const result = runCampaign({ starts: fuzzStarts, seed: SEED, cases: CASES, length: 24 });
    expect(result.failures.join("\n\n")).toBe("");
    // The generator must keep reaching edits, or the run proves little.
    expect(result.edits).toBeGreaterThan(CASES * 4);
  }, 300_000);
});
