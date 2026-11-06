import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { distillFuzzCorpus, readFuzzCoverage, summarizeFuzzCoverage } from "../scripts/lib/fuzz-coverage.mjs";
import { openBeamerFuzzCorpus, mutateBeamerCorpusSequence, validateEditSequence } from "../scripts/lib/beamer-fuzz-corpus.mjs";
import { generateBeamerEditSequence, withEditProbes } from "../scripts/lib/beamer-edit-sequences.mjs";
import { materializeBeamerEdits } from "./differential/beamer-edit-fuzz.js";
const recipe = () => generateBeamerEditSequence(withEditProbes(String.raw`\documentclass[10pt,aspectratio=43]{beamer}
\usepackage{tikz}\begin{document}\begin{frame}Hello\end{frame}\end{document}`), "corpus-test", 42, 14);

describe("measured source coverage", () => {
  it("maps hit and unhit source locations, excludes helpers, and rejects missing coverage", () => {
    const root = process.cwd(), location = { start: { line: 7, column: 1 }, end: { line: 8, column: 2 } };
    const data = { b: { 0: [0, 3] }, branchMap: { 0: { locations: [location, location] } }, f: { 0: 1 }, fnMap: { 0: { decl: location } }, s: { 0: 0 }, statementMap: { 0: location } };
    const coverage = readFuzzCoverage({ [join(root, "packages/app/src/compute.ts")]: data, [join(root, "scripts/helper.ts")]: data }, root);
    expect(coverage.files).toEqual(["packages/app/src/compute.ts"]);
    expect(summarizeFuzzCoverage(new Set(coverage.hit), new Set(coverage.all))).toEqual({
      branches: { covered: 1, total: 2, percent: 50 }, functions: { covered: 1, total: 1, percent: 100 }, statements: { covered: 0, total: 1, percent: 0 },
    });
    expect(() => readFuzzCoverage({}, root)).toThrow("No target coverage");
    expect(() => readFuzzCoverage({ [join(root, "packages/app/src/compute.ts")]: { ...data, branchMap: {} } }, root)).toThrow("Missing branch map");
  });
  it("distills redundant inputs while preserving the feature union and every failure", () => {
    const entries = [
      { id: "large", status: "passed", size: 100, features: ["a", "b"] },
      { id: "small", status: "passed", size: 2, features: ["a", "b"] },
      { id: "other", status: "passed", size: 10, features: ["c"] },
      { id: "failure", status: "timeout", size: 100, features: [] },
    ];
    const active = distillFuzzCorpus(entries);
    expect(active.map(entry => entry.id)).toEqual(["failure", "small", "other"]);
    expect(new Set(active.flatMap(entry => entry.features))).toEqual(new Set(entries.flatMap(entry => entry.features)));
  });
});

describe("persistent edit corpus", () => {
  it("reloads immutable inputs, isolates implementation coverage, and merges independent observations", () => {
    const directory = mkdtempSync(join(tmpdir(), "beamer-corpus-"));
    try {
      const a = openBeamerFuzzCorpus(directory, "build-a"), b = openBeamerFuzzCorpus(directory, "build-a"), sequence = recipe();
      const first = a.remember(sequence, { status: "passed", features: ["a", "b"] });
      b.remember(sequence, { status: "passed", features: ["c"] });
      const loaded = openBeamerFuzzCorpus(directory, "build-a");
      expect(loaded.entries).toHaveLength(1);
      expect(loaded.entries[0].features).toEqual(["a", "b", "c"]);
      loaded.remember(sequence, { status: "timeout", features: [], limits: { heapMb: 64 } });
      loaded.remember(sequence, { status: "passed", features: ["a"] });
      expect(openBeamerFuzzCorpus(directory, "build-a").entries[0].status).toBe("timeout");
      const nextBuild = openBeamerFuzzCorpus(directory, "build-b");
      expect(nextBuild.entries[0]).toMatchObject({ id: first.id, features: [], measured: false, status: "unmeasured" });
      expect(nextBuild.entries[0].sequence).toEqual(sequence);
      expect(readdirSync(join(directory, "entries"))).toHaveLength(1);
      const path = join(directory, "entries", first.id + ".json");
      const corrupt = JSON.parse(readFileSync(path, "utf8")); corrupt.source += "corrupt"; writeFileSync(path, JSON.stringify(corrupt));
      expect(() => openBeamerFuzzCorpus(directory, "build-a")).toThrow("Corrupt corpus recipe");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("reproducibly mutates semantic actions and keeps them materializable", () => {
    const parent = recipe(), before = JSON.stringify(parent);
    for (let seed = 0; seed < 40; seed++) {
      const child = mutateBeamerCorpusSequence(parent, seed)!;
      expect(child).toEqual(mutateBeamerCorpusSequence(parent, seed));
      expect(child).not.toEqual(parent);
      expect(materializeBeamerEdits(child).effectiveEdits).not.toEqual({});
      expect(() => validateEditSequence(child)).not.toThrow();
    }
    expect(JSON.stringify(parent)).toBe(before);
    expect(() => validateEditSequence({ ...parent, actions: [{ kind: "set", field: "unknown" }] })).toThrow("Invalid edit action");
  });
});
