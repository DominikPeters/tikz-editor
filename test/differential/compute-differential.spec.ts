import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { coldCompute, compareResponses, describeFailure, generateOps, runOps, shrinkOps, type FuzzDocument, type FuzzOp, type FuzzReach } from "./compute-fuzz.js";
import { freshComputeModule } from "./compute-instances.js";

// Scale with COMPUTE_FUZZ_CASES / COMPUTE_FUZZ_STEPS / COMPUTE_FUZZ_SEED.
const CASES = Number(process.env.COMPUTE_FUZZ_CASES ?? 10);
const STEPS = Number(process.env.COMPUTE_FUZZ_STEPS ?? 24);
const SEED = Number(process.env.COMPUTE_FUZZ_SEED ?? 1);

const fixture = (path: string): FuzzDocument => ({ label: path, source: readFileSync(`test/fixtures/${path}`, "utf8") });

const DOCUMENT_SETS: FuzzDocument[][] = [
  [fixture("differential/node-graph.tex")],
  [fixture("multi-figure-basic.tex")],
  [fixture("differential/mixed-deck.tex")],
  [fixture("multi-figure-paper.tex")],
  [fixture("shapes-new.tex"), fixture("differential/mixed-deck.tex")],
  [fixture("differential/mixed-deck.tex"), fixture("beamer/hello_world_beamer.tex")],
  [fixture("beamer/overlay_conformance_beamer.tex")]
];

// Shortcuts the default budget must reach; without them a clean run means little.
const REQUIRED_REACH: [string, (reach: FuzzReach) => number][] = [
  ["incremental parses", (reach) => reach["parse:incremental"] ?? 0],
  ["incremental evaluations", (reach) => Object.entries(reach).filter(([key]) => key.startsWith("semantic:incremental")).reduce((sum, [, count]) => sum + count, 0)],
  ["patches applied directly", (reach) => reach["patches:direct"] ?? 0],
  ["patches rebased over skipped revisions", (reach) => reach["patches:rebased"] ?? 0],
  ["deck pages kept or claimed from the cache", (reach) => (reach["deck:current"] ?? 0) + (reach["deck:claimed"] ?? 0)],
  ["racing renders", (reach) => reach.race ?? 0]
];

describe("compute differential fuzzing", () => {
  it("renders a request identically in two fresh instances", async () => {
    for (const documents of DOCUMENT_SETS.slice(0, 2)) {
      const request = { id: "determinism", documentId: "doc-0", source: documents[0].source, sourceRevision: 0 };
      const other = await (await freshComputeModule()).computeSnapshot(request);
      expect(compareResponses(await coldCompute(request), other)).toEqual([]);
    }
  });

  it("matches a cold render after every request the app would send", async () => {
    const reach: FuzzReach = {};
    for (let index = 0; index < CASES; index += 1) {
      // Each document set runs gentle (even seed) and then wild (odd seed).
      const seed = SEED * 1000 + index;
      const documents = DOCUMENT_SETS[Math.floor(index / 2) % DOCUMENT_SETS.length];
      const ops = await generateOps(documents, seed, STEPS);
      const result = await runOps(documents, ops);
      for (const [key, value] of Object.entries(result.reach)) reach[key] = (reach[key] ?? 0) + value;
      if (result.failure) {
        const shrunk = await shrinkOps(documents, ops);
        throw new Error(describeFailure(documents, seed, shrunk.ops, shrunk.failure));
      }
    }
    if (process.env.COMPUTE_FUZZ_VERBOSE) console.log(reach);
    for (const [name, measure] of REQUIRED_REACH) expect(measure(reach), `the fuzzer reached no ${name}`).toBeGreaterThan(0);
  }, 600_000);
});

// COMPUTE_FUZZ_REPLAY=file.json replays {"documents": [fixture paths], "ops": [...]}.
describe.runIf(process.env.COMPUTE_FUZZ_REPLAY)("compute differential replay", () => {
  it("replays the recorded operations", async () => {
    const recorded = JSON.parse(readFileSync(process.env.COMPUTE_FUZZ_REPLAY!, "utf8")) as { documents: string[]; ops: FuzzOp[] };
    const documents = recorded.documents.map(fixture);
    const result = await runOps(documents, recorded.ops);
    if (result.failure) throw new Error(describeFailure(documents, 0, recorded.ops, result.failure));
  }, 600_000);
});
