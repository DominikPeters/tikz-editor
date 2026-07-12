import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  differentialCanaryCase,
  differentialSupportFingerprint,
  loadStoredTexFuzzFailures,
  makeTexFuzzStoredBundle,
  parseTexFuzzBundle,
  parseTexFuzzArtifactManifest,
  parseTexFuzzStoredBundle,
  planTexFuzzArtifacts,
  planTexFuzzRebaseline,
  serializeTexFuzzBundle,
  texFuzzFindingId,
  type TexFuzzArtifactFinding,
  type TexFuzzArtifactManifest,
  type TexFuzzReplayBundle,
} from "@tikz-editor/tex-fuzz";

function bundle(sourceSuffix = ""): TexFuzzReplayBundle {
  const caseData = differentialCanaryCase();
  const nextCase = sourceSuffix === "" ? caseData : {
    ...caseData,
    source: `${caseData.source}${sourceSuffix}`,
  };
  return {
    case: nextCase,
    observation: { fingerprint: differentialSupportFingerprint(nextCase) },
  };
}

function finding(id: string, witnesses: readonly string[]): TexFuzzArtifactFinding {
  const template = bundle().observation.fingerprint;
  return {
    findingId: id,
    fingerprint: template,
    witnesses: witnesses.map((witnessId) => ({
      witnessId,
      bundleHash: witnessId.padEnd(64, "0"),
      bundlePath: `bundles/${id}/${witnessId}.json`,
      sourceHash: witnessId.padEnd(64, "1"),
    })),
  };
}

function manifest(findings: readonly TexFuzzArtifactFinding[]): TexFuzzArtifactManifest {
  return { schemaVersion: 1, oracleEnvironment: { engine: "LuaHBTeX 1.21" }, findings };
}

describe("TeX fuzz artifacts", () => {
  it("keeps the legacy replay-bundle parser compatible", () => {
    const legacy = bundle();
    expect(parseTexFuzzBundle(serializeTexFuzzBundle(legacy))).toEqual(legacy);
  });

  it("derives finding IDs from normalized fingerprints", () => {
    const fingerprint = bundle().observation.fingerprint;
    expect(texFuzzFindingId({ ...fingerprint, featureTags: [...fingerprint.featureTags].reverse() }))
      .toBe(texFuzzFindingId(fingerprint));
  });

  it("groups equal fingerprints while retaining distinct replay witnesses", () => {
    const plan = planTexFuzzArtifacts([bundle(), bundle(" tail"), bundle()], { engine: "LuaHBTeX 1.21" });
    expect(plan.manifest.findings).toHaveLength(1);
    expect(plan.manifest.findings[0]?.witnesses).toHaveLength(2);
    expect(plan.bundles).toHaveLength(2);
    expect(plan.bundles.every(({ witness }) =>
      witness.bundlePath.startsWith(`bundles/${plan.manifest.findings[0]?.findingId}/`)
    )).toBe(true);
  });

  it("rejects manifests whose finding identity was edited by hand", () => {
    const plan = planTexFuzzArtifacts([bundle()], { engine: "LuaHBTeX 1.21" });
    const edited = {
      ...plan.manifest,
      findings: [{ ...plan.manifest.findings[0], findingId: "tf1-not-the-content-id" }],
    };
    expect(() => parseTexFuzzArtifactManifest(JSON.stringify(edited))).toThrow(/identity/);
  });

  it("round-trips resumable shrinking metadata", () => {
    const original = bundle();
    const stored = makeTexFuzzStoredBundle(original, {
      candidatesEvaluated: 20,
      oracleEvaluations: 4,
      elapsedMs: 250,
      candidateBudgetRemaining: 80,
      oracleBudgetRemaining: 16,
      timeBudgetMsRemaining: 750,
      remainingCandidates: [original.case],
    });
    expect(parseTexFuzzStoredBundle(JSON.stringify(stored)).shrinkContinuation)
      .toEqual(stored.shrinkContinuation);
  });

  it("loads content-addressed failures only under an exact oracle environment", () => {
    const environment = { engine: "LuaHBTeX 1.21", fontSet: "texlive-2026" };
    const plan = planTexFuzzArtifacts([bundle()], environment);
    const root = mkdtempSync(join(tmpdir(), "tex-fuzz-artifacts-"));
    const manifestPath = join(root, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(plan.manifest));
    for (const { storedBundle, witness } of plan.bundles) {
      const path = join(root, witness.bundlePath);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, JSON.stringify(storedBundle));
    }
    expect(loadStoredTexFuzzFailures(manifestPath, environment)).toHaveLength(1);
    expect(() => loadStoredTexFuzzFailures(manifestPath, { ...environment, engine: "other" }))
      .toThrow(/exactly match/);
  });

  it("plans reviewed unchanged, remapped, split, merged, resolved, and new findings", () => {
    const oldManifest = manifest([
      finding("same", ["w0"]),
      finding("renamed-old", ["w1"]),
      finding("split-old", ["w2", "w3"]),
      finding("merge-a", ["w4"]),
      finding("merge-b", ["w5"]),
      finding("gone", ["w6"]),
    ]);
    const newManifest = manifest([
      finding("same", ["w0"]),
      finding("renamed-new", ["w1"]),
      finding("split-a", ["w2"]),
      finding("split-b", ["w3"]),
      finding("merged", ["w4", "w5"]),
      finding("new", ["w7"]),
    ]);
    const plan = planTexFuzzRebaseline(oldManifest, newManifest);
    expect(plan.unchanged).toHaveLength(1);
    expect(plan.remapped).toHaveLength(1);
    expect(plan.split[0]).toMatchObject({ oldFindingIds: ["split-old"], newFindingIds: ["split-a", "split-b"] });
    expect(plan.merged[0]).toMatchObject({ oldFindingIds: ["merge-a", "merge-b"], newFindingIds: ["merged"] });
    expect(plan.resolved).toEqual(["gone"]);
    expect(plan.new).toEqual(["new"]);
  });
});
