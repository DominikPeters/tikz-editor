import { describe, expect, it } from "vitest";
import {
  caseFromTexFuzzAst,
  checkTexFuzzHardInvariants,
  classifyTexFuzzNativeSupport,
  differentialCanaryCase,
  differentialSupportFingerprint,
  generateTexFuzzCase,
  parseTexFuzzBundle,
  serializeTexFuzzBundle,
  shrinkTexFuzzCase,
  texFuzzShrinkCandidates,
  texFuzzRegistryDrift,
} from "@tikz-editor/tex-fuzz";
import {
  calibrateBatchedTexSupportOracle,
  commandExists,
  runBatchedTexSupportOracle,
} from "../scripts/lib/tex-fuzz-oracle.mjs";

const runOracleIntegration = process.env.TEX_FUZZ_ORACLE_TESTS === "1" && commandExists("lualatex");

describe("adversarial TeX fuzz kernel vertical slice", () => {
  it("has no drift against the production TeX registries", () => {
    expect(texFuzzRegistryDrift()).toEqual({ missing: [], staleExclusions: [] });
  });

  it("is byte-deterministic and records every integer decision", () => {
    const first = generateTexFuzzCase(20260711, { depth: 4, size: 8 });
    const second = generateTexFuzzCase(20260711, { depth: 4, size: 8 });
    expect(second).toEqual(first);
    expect(first.choices.length).toBeGreaterThan(10);
    expect(first.choices.every((choice) =>
      Number.isSafeInteger(choice.value) && choice.value >= 0 && choice.value < choice.upperExclusive
    )).toBe(true);
  });

  it("keeps generated and parsed source ranges in bounds", () => {
    for (let seed = 0; seed < 10; seed += 1) {
      expect(checkTexFuzzHardInvariants(generateTexFuzzCase(seed))).toEqual([]);
    }
  }, 15_000);

  it("serializes replay bundles independently of generator weights", () => {
    const caseData = differentialCanaryCase();
    const bundle = {
      case: caseData,
      observation: { fingerprint: differentialSupportFingerprint(caseData) },
    };
    expect(parseTexFuzzBundle(serializeTexFuzzBundle(bundle))).toEqual(bundle);
  });

  it("prints, attributes, replays, and shrinks valid tabular cells", () => {
    const caseData = caseFromTexFuzzAst([{
      kind: "tabular",
      columns: ["l", "r"],
      position: "t",
      cells: [
        [{ kind: "text", value: "Alpha" }, { kind: "text", value: "7" }],
        [{ kind: "font", command: "textbf", children: [{ kind: "text", value: "Beta" }] }, { kind: "text", value: "42" }],
      ],
    }]);
    expect(caseData.source).toBe(String.raw`\begin{tabular}[t]{lr}Alpha&7\\\textbf{Beta}&42\end{tabular}`);
    const cell = caseData.sourceMap.find((span) => span.path === "root/0/cells/1/1/0");
    expect(caseData.source.slice(cell!.start, cell!.end)).toBe("42");
    expect(classifyTexFuzzNativeSupport(caseData)).toEqual({ supported: true, reason: "fully-supported" });
    expect(checkTexFuzzHardInvariants(caseData)).toEqual([]);
    const bundle = { case: caseData, observation: { fingerprint: differentialSupportFingerprint(caseData) } };
    expect(parseTexFuzzBundle(serializeTexFuzzBundle(bundle))).toEqual(bundle);
    const candidates = texFuzzShrinkCandidates(caseData);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.source.length).toBeLessThan(caseData.source.length);
      expect(checkTexFuzzHardInvariants(candidate)).toEqual([]);
    }
  });

  it("shrinks against a stable hard-invariant fingerprint", async () => {
    const caseData = caseFromTexFuzzAst([
      { kind: "text", value: "Alpha" },
      { kind: "group", children: [{ kind: "oracle-command", command: "TeX" }] },
      { kind: "text", value: "Omega" },
    ]);
    const observation = {
      fingerprint: {
        version: 1 as const,
        resultClass: "hard-invariant" as const,
        code: "vertical-slice-canary",
        featureTags: ["oracle.supported-command" as const],
        mode: "text" as const,
        structuralLocus: "oracle-command",
      },
    };
    const result = await shrinkTexFuzzCase(caseData, observation, async (candidates) =>
      candidates.map((candidate) => candidate.source.includes("\\TeX") ? observation : null)
    );
    expect(result.minimizedCase.source).toBe("\\TeX{}");
    expect(result.termination).toBe("minimal");
  });

  it.runIf(runOracleIntegration)("isolates, calibrates, and bisects batched LuaLaTeX cases", () => {
    const valid = [
      { id: "a", source: "Alpha" },
      { id: "b", source: "\\textbf{Beta}" },
    ];
    const calibration = calibrateBatchedTexSupportOracle(valid);
    expect(calibration).toMatchObject({ ok: true, mismatches: [] });

    const withFailure = runBatchedTexSupportOracle([
      valid[0],
      { id: "bad", source: "\\tikzEditorDefinitelyUndefined" },
      valid[1],
    ]);
    expect(withFailure.observations.map((item) => [item.id, item.supported])).toEqual([
      ["a", true],
      ["bad", false],
      ["b", true],
    ]);
    expect(withFailure.stats.bisectedFailures).toBeGreaterThan(0);
  }, 30_000);

  it.runIf(runOracleIntegration)("compiles a generated small table with LuaLaTeX", () => {
    const generated = Array.from({ length: 25 }, (_, seed) =>
      generateTexFuzzCase(seed, { profile: "aggressive", depth: 5, size: 8 })
    );
    const findTable = (nodes: typeof generated[number]["ast"]): typeof generated[number]["ast"][number] | undefined => {
      for (const node of nodes) {
        if (node.kind === "tabular") return node;
        if ("children" in node) {
          const table = findTable(node.children);
          if (table) return table;
        }
      }
      return undefined;
    };
    const table = generated.map((caseData) => findTable(caseData.ast)).find((node) => node !== undefined);
    expect(table).toBeDefined();
    const source = caseFromTexFuzzAst([table!]).source;
    const result = runBatchedTexSupportOracle([{ id: "tabular", source }]);
    expect(result.observations.map((item) => [item.id, item.supported])).toEqual([["tabular", true]]);
  }, 30_000);
});
