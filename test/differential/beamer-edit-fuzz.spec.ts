import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateBeamerFuzzCases } from "../../scripts/lib/beamer-fuzz-cases.mjs";
import { scanBeamerDocument } from "../../packages/core/src/beamer/index.js";
import { EDIT_FIELDS, beamerSourceCandidates, beamerFailureKey, generateBeamerEditSequence, materializeBeamerEdits, reduceBeamerEditSequence,
  runBeamerEditSequence, withEditProbes, type BeamerEditSequence } from "./beamer-edit-fuzz.js";
import { freshComputeModule } from "./compute-instances.js";
import type { FuzzFailure, FuzzRunResult } from "./compute-fuzz.js";

const base = generateBeamerFuzzCases({ seed: 20261106, cases: 33 })[0];
const sequence = (steps = 13) => generateBeamerEditSequence(withEditProbes(base.source), base.fixture.family, 20261106, steps);
describe("Beamer semantic edit recipes", () => {
  it("replays deterministically and edits every field without malformed TeX", () => {
    for (const entry of generateBeamerFuzzCases({ seed: 20261107, cases: 33 })) {
      const source = withEditProbes(entry.source), first = generateBeamerEditSequence(source, entry.fixture.family, 20261107, 32);
      expect(first).toEqual(generateBeamerEditSequence(source, entry.fixture.family, 20261107, 32));
      const materialized = materializeBeamerEdits(first);
      for (const field of EDIT_FIELDS) expect(materialized.effectiveEdits[field], field).toBeGreaterThan(0);
      expect(scanBeamerDocument(materialized.finalSource).diagnostics).toEqual([]);
      expect(scanBeamerDocument(materialized.finalSource).frames).toHaveLength(3);
      expect(materialized.finalSource).toContain(String.raw`\newcommand{\editprobetext}{`);
    }
  });

  it("retains the frozen compilation calendar while reducing source", () => {
    const source = sequence().source;
    const candidates = beamerSourceCandidates(source);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) expect(candidate).toContain(String.raw`\year=2026\month=11\day=6`);
  });

  it("rematerializes offsets when an earlier edit is removed", () => {
    const full = sequence();
    const trimmed = { ...full, actions: full.actions.filter(action => action.kind !== "set" || action.field !== "text") };
    const materialized = materializeBeamerEdits(trimmed);
    expect(materialized.effectiveEdits.text).toBeUndefined();
    expect(materialized.effectiveEdits.width).toBeGreaterThan(0);
    expect(scanBeamerDocument(materialized.finalSource).diagnostics).toEqual([]);
    expect(materialized.finalSource).toContain("EditAlpha");
  });

  it("does not retarget a deleted drawing probe to a different picture", () => {
    const input = sequence();
    const source = beamerSourceCandidates(input.source).find(candidate => candidate.includes("% edit-bounds") && !candidate.includes("remember picture,overlay"))!;
    expect(source).toBeDefined();
    const materialized = materializeBeamerEdits({ ...input, source, actions: [
      { kind: "set", field: "width", value: "4.5", mode: "typing", render: true },
      { kind: "set", field: "bounds-width", value: "0.01", mode: "typing", render: true },
    ] });
    expect(materialized.effectiveEdits.width).toBeUndefined();
    expect(materialized.effectiveEdits["bounds-width"]).toBe(1);
    const unmarked = source.replace(/% edit-(?:bounds|overlay|layer-probe)\n/gu, "");
    expect(materializeBeamerEdits({ ...input, source: unmarked, actions: [
      { kind: "set", field: "width", value: "4.5", mode: "typing", render: true },
    ] }).effectiveEdits.width).toBeUndefined();
  });

  it("reaches selective replay and skipped suffixes in its explicit cache probe", async () => {
    const input = sequence(0);
    const result = await runBeamerEditSequence(input);
    expect(result.failure).toBeNull();
    expect(result.reach["semantic:incremental:selective"] ?? 0).toBeGreaterThan(0);
    expect(result.reach["suffix:skipped"] ?? 0).toBeGreaterThan(0);
  }, 30_000);

  it("loads real PNG, JPEG and PDF pages during warm/cold image edit comparisons", async () => {
    const cases = generateBeamerFuzzCases({ seed: 20261108, cases: 8, profile: "images" });
    for (const index of [0, 1, 6]) {
      const entry = cases[index];
      const input = generateBeamerEditSequence(withEditProbes(entry.source), entry.fixture.family, 20261108, 2);
      const result = await runBeamerEditSequence(input);
      expect(result.failure, entry.id).toBeNull();
      expect(result.reach["graphics:resolved"], entry.id).toBeGreaterThan(0);
    }
  }, 60_000);

  it("detects stale SVG reuse and preserves its failure while reducing", async () => {
    const factory = async () => {
      const module = await freshComputeModule();
      let previous: Awaited<ReturnType<typeof module.computeSnapshot>> | undefined;
      let source: string | undefined;
      return { ...module, computeSnapshot: (async (request, options) => {
        const response = await module.computeSnapshot(request, options);
        const old = previous; const changed = source !== undefined && source !== request.source;
        previous = response; source = request.source;
        return changed && old?.snapshot.svg ? { ...response, snapshot: { ...response.snapshot, svg: old.snapshot.svg } } : response;
      }) as typeof module.computeSnapshot };
    };
    const input = sequence(3), first = await runBeamerEditSequence(input, factory);
    expect(first.failure).not.toBeNull();
    expect(first.failure?.what).not.toBe("threw");
    const reduced = await reduceBeamerEditSequence(input, { factory, budget: 14 });
    expect(reduced.key).toBe(beamerFailureKey(first.failure!));
    expect(reduced.sequence.actions.length).toBeLessThan(input.actions.length);
    const verified = await runBeamerEditSequence(reduced.sequence, factory);
    expect(beamerFailureKey(verified.failure!)).toBe(reduced.key);
  }, 60_000);

  it("reduces balanced source structure while retaining the same witness", async () => {
    const input = sequence(13);
    const run = async (candidate: BeamerEditSequence): Promise<FuzzRunResult> => {
      const present = candidate.actions.some(action => action.kind === "set" && action.field === "width") && candidate.source.includes("rectangle (1,0.6)");
      const failure: FuzzFailure | null = present ? { opIndex: 0, op: { kind: "render", doc: 0 }, what: "render", request: { id: "fake", source: candidate.source }, differences: [".snapshot.svg.svg: differs"] } : null;
      return { failure, comparisons: 1, reach: {} };
    };
    const reduced = await reduceBeamerEditSequence(input, { run, budget: 64, acceptSource: async () => true });
    expect(reduced.sequence.source.length).toBeLessThan(input.source.length);
    expect(reduced.sequence.actions).toHaveLength(1);
    expect(reduced.sequence.actions[0]).toMatchObject({ kind: "set", field: "width" });
    expect(scanBeamerDocument(reduced.sequence.source).diagnostics).toEqual([]);
    expect((await run(reduced.sequence)).failure).not.toBeNull();
  });

  it("accepts valid plain-frame paint during source reduction", async () => {
    const input = { ...sequence(0), actions: [{ kind: "render" as const }] };
    const run = async (candidate: BeamerEditSequence): Promise<FuzzRunResult> => ({ comparisons: 1, reach: {},
      failure: candidate.source.includes("EditNeighbor") && candidate.actions.length ? { opIndex: 0, op: { kind: "render", doc: 0 }, what: "render",
        request: { id: "plain-frame", documentId: "reduce-page", source: candidate.source, sourceRevision: 0, activeRootId: "frame:0", deckStep: 1 },
        differences: [".snapshot.deck.activeFrame.svg: differs"] } : null });
    const reduced = await reduceBeamerEditSequence(input, { run, budget: 40 });
    expect(reduced.sequence.source.length).toBeLessThan(input.source.length);
    expect(reduced.accepted).toBeGreaterThan(0);
  }, 30_000);

  it("rejects failure drift and honors the reduction budget", async () => {
    const original = sequence(2);
    const failure = (path: string): FuzzFailure => ({ opIndex: 0, op: { kind: "render", doc: 0 }, what: "render", request: { id: "test", source: original.source }, differences: [`${path}: expected 1, got 2`] });
    const first = failure(".snapshot.svg.svg");
    let calls = 0;
    const run = async (candidate: BeamerEditSequence): Promise<FuzzRunResult> => {
      calls++;
      return { comparisons: 1, reach: {}, failure: candidate.actions.length === original.actions.length ? first : failure(".diagnostics.length") };
    };
    const reduced = await reduceBeamerEditSequence(original, { budget: 3, run });
    expect(reduced.sequence).toEqual(original);
    expect(reduced.attempts).toBe(3);
    expect(reduced.budgetExhausted).toBe(true);
    expect(calls).toBe(5); // Original, three trials, independent final verification.
  });
});

describe.runIf(process.env.BEAMER_EDIT_FUZZ_AUDIT)("saved Beamer edit recipes", () => {
  it("rematerializes the exact recorded operations across probe versions", () => {
    const root = process.env.BEAMER_EDIT_FUZZ_AUDIT!;
    for (const name of ["pilot", "long-a", "long-b", "long-c"]) {
      const directory = join(root, name);
      const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8")) as { results: { id: string }[] };
      for (const result of report.results) {
        const recipe = JSON.parse(readFileSync(join(directory, result.id + ".json"), "utf8")) as BeamerEditSequence;
        const recorded = JSON.parse(readFileSync(join(directory, result.id + ".ops.json"), "utf8")) as { ops: unknown[] };
        expect(materializeBeamerEdits(recipe).ops, `${name}/${result.id}`).toEqual(recorded.ops);
      }
    }
  });
});
