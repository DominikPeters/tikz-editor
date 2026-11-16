import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FuzzDocument } from "./compute-fuzz.js";
import { describeStoreFailure, generateStoreOps, runStoreOps, shrinkStoreOps, type StoreOp } from "./store-fuzz.js";

// Scale with STORE_FUZZ_CASES / STORE_FUZZ_STEPS / STORE_FUZZ_SEED.
const CASES = Number(process.env.STORE_FUZZ_CASES ?? 6);
const STEPS = Number(process.env.STORE_FUZZ_STEPS ?? 40);
const SEED = Number(process.env.STORE_FUZZ_SEED ?? 1);

const fixture = (path: string): FuzzDocument => ({ label: path, source: readFileSync(`test/fixtures/${path}`, "utf8") });

const DOCUMENT_SETS: FuzzDocument[][] = [
  [fixture("differential/node-graph.tex")],
  [fixture("multi-figure-basic.tex")],
  [fixture("shapes-new.tex"), fixture("differential/mixed-deck.tex")],
  [fixture("multi-figure-paper.tex")],
  [fixture("differential/mixed-deck.tex"), fixture("multi-figure-basic.tex")]
];

// Injected storage failures are logged by the store; keep the output readable.
beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => {}); });

describe("store fuzzing", () => {
  it("compares settled output independently of the exact-parse strategy flag", async () => {
    const result = await runStoreOps(DOCUMENT_SETS[2], [
      { kind: "type", r: [0.1965145436115563, 0.5689504337497056, 0.9634498390369117, 0.8825881793163717] },
      { kind: "settle", r: [0.06091256928630173, 0.13419591402634978, 0.9016162764746696, 0.9940589244943112] }
    ]);
    expect(result.failure).toBeNull();
  });

  it("keeps the store's invariants under interleaved edits, renders, saves and faults", async () => {
    const counts: Record<string, number> = {};
    for (let index = 0; index < CASES; index += 1) {
      const seed = SEED * 1000 + index;
      const documents = DOCUMENT_SETS[index % DOCUMENT_SETS.length];
      const ops = generateStoreOps(seed, STEPS);
      const result = await runStoreOps(documents, ops);
      for (const [key, value] of Object.entries(result.counts)) counts[key] = (counts[key] ?? 0) + value;
      if (result.failure) {
        const shrunk = await shrinkStoreOps(documents, ops);
        throw new Error(describeStoreFailure(documents, seed, shrunk.ops, shrunk.failure));
      }
    }
    if (process.env.STORE_FUZZ_VERBOSE) console.log(counts);
  }, 900_000);
});

// STORE_FUZZ_REPLAY=file.json replays {"documents": [fixture paths], "ops": [...]}.
describe.runIf(process.env.STORE_FUZZ_REPLAY)("store fuzz replay", () => {
  it("replays the recorded operations", async () => {
    const recorded = JSON.parse(readFileSync(process.env.STORE_FUZZ_REPLAY!, "utf8")) as { documents: string[]; ops: StoreOp[] };
    const documents = recorded.documents.map(fixture);
    const result = await runStoreOps(documents, recorded.ops);
    if (result.failure) throw new Error(describeStoreFailure(documents, 0, recorded.ops, result.failure));
  }, 600_000);
});
