import { describe, expect, it } from "vitest";
import {
  differentialCanaryCase, differentialSupportFingerprint, generateTexFuzzCase,
  makeTexFuzzStoredBundle, parseTexFuzzArtifactManifest, parseTexFuzzBundle,
  parseTexFuzzStoredBundle, planTexFuzzArtifacts, replayTexFuzzCase,
  type TexFuzzMathNode, type TexFuzzNode, type TexFuzzReplayBundle,
} from "@tikz-editor/tex-fuzz";

function bundle(): TexFuzzReplayBundle {
  const caseData = differentialCanaryCase();
  return { case: caseData, observation: { fingerprint: differentialSupportFingerprint(caseData) } };
}
const pt = { amount: 2, unit: "pt" } as const;
const atom = { kind: "atom", value: "x" } as const;

const mathVariants: readonly TexFuzzMathNode[] = [
  atom, { kind: "group", body: atom }, { kind: "sequence", items: [atom], operators: [] },
  { kind: "fraction", command: "dfrac", numerator: atom, denominator: atom },
  { kind: "radical", degree: atom, body: atom },
  { kind: "script", base: atom, subscript: atom, superscript: atom },
  { kind: "accent", command: "widehat", body: atom },
  { kind: "alphabet", command: "boldsymbol", body: atom },
  { kind: "line", command: "overbrace", body: atom },
  { kind: "left-right", left: "(", right: ")", body: atom },
  { kind: "operator", command: "sum", script: atom }, { kind: "stackrel", above: atom, body: atom },
  { kind: "xarrow", command: "xrightarrow", below: atom, above: atom },
  { kind: "matrix", environment: "pmatrix", cells: [[atom]] },
  { kind: "text", command: "text", value: "word" },
];
const nodeVariants: readonly TexFuzzNode[] = [
  { kind: "text", value: "text" }, { kind: "space", nonBreaking: false }, { kind: "group", children: [] },
  { kind: "font", command: "textbf", children: [] }, { kind: "font-declaration", command: "bfseries", children: [] },
  { kind: "style-declaration", command: "Huge", children: [] },
  { kind: "style-declaration", command: "color", color: "teal", children: [] },
  { kind: "style-declaration", command: "fontsize", size: pt, baselineSkip: pt, children: [] },
  { kind: "color", color: "red", children: [] }, { kind: "math", content: "legacy" },
  ...mathVariants.map(body => ({ kind: "math", body }) as const),
  { kind: "display-math", delimiter: "align-star", content: "a&=b" },
  { kind: "display-math", delimiter: "bracket", body: atom }, { kind: "accent", command: "'", base: "a" },
  { kind: "line-break", command: "\\", starred: true, leading: pt },
  { kind: "line-break", command: "newline" }, { kind: "line-break", command: "linebreak", priority: 3 },
  { kind: "box", command: "mbox", children: [] },
  { kind: "box", command: "framebox", width: pt, alignment: "r", children: [] },
  { kind: "box", command: "colorbox", backgroundColor: "blue", children: [] },
  { kind: "box", command: "fcolorbox", frameColor: "red", backgroundColor: "blue", children: [] },
  { kind: "dimension-box", command: "smash", children: [] },
  { kind: "raisebox", lift: pt, height: pt, depth: pt, children: [] },
  { kind: "transform-box", command: "rotatebox", angle: 90, children: [] },
  { kind: "transform-box", command: "scalebox", scale: 2, verticalScale: 3, children: [] },
  { kind: "transform-box", command: "resizebox", width: pt, height: "!", totalHeight: true, children: [] },
  { kind: "transform-box", command: "reflectbox", children: [] }, { kind: "rule", raise: pt, width: pt, height: pt },
  { kind: "tabular", columns: ["l", "r"], position: "t", cells: [[], []] },
  { kind: "paragraph-break", command: "blank-line" }, { kind: "noindent" }, { kind: "alignment", command: "centering" },
  { kind: "environment", name: "itemize", children: [] }, { kind: "item", label: [] },
  { kind: "vertical-glue", command: "smallskip" }, { kind: "vertical-glue", command: "vspace", size: pt, starred: true },
  { kind: "vertical-glue", command: "vskip", size: pt }, { kind: "penalty", value: 100 },
  { kind: "vertical-rule", width: pt, height: pt, depth: pt },
  { kind: "document-box", command: "parbox", width: pt, height: pt, position: "t", innerPosition: "s", children: [] },
  { kind: "document-box", command: "minipage", width: pt, position: "b", children: [] },
  { kind: "oracle-command", command: "TeX" },
];

describe("TeX fuzz replay validation", () => {
  it("accepts every node variant, recursive math, and legacy raw math content", () => {
    const original = bundle();
    const replay = { ...original, case: { ...original.case, ast: nodeVariants } };
    expect(parseTexFuzzBundle(JSON.stringify(replay))).toEqual(replay);
  });

  it("retains deterministic generated choices and intentionally malformed source", () => {
    for (const profile of ["vertical-slice", "canary", "aggressive", "document", "malformed"] as const) {
      for (let seed = 0; seed < 30; seed++) {
        const caseData = generateTexFuzzCase(seed, { profile, depth: 3, size: 3 });
        const replay = { case: caseData, observation: { fingerprint: differentialSupportFingerprint(caseData) } };
        const serialized = JSON.stringify(replay);
        const parsed = parseTexFuzzBundle(serialized);
        expect(JSON.stringify(parsed)).toBe(serialized);
        expect(parsed.case.choices).toEqual(caseData.choices);
      }
    }
    const original = bundle().case;
    const malformed = { ...original, source: String.raw`\frac{a}{$`, profile: "malformed", mutations: [{ kind: "truncate", offset: 9 }] };
    expect(replayTexFuzzCase(malformed)).toEqual(malformed);
  });

  it("rejects invalid case metadata, nested nodes, maps, choices, and mutations", () => {
    const original = bundle();
    const invalidCases = [null, [], { ...original.case, schemaVersion: 2 },
      { ...original.case, generatorVersion: null }, { ...original.case, seed: "1" },
      { ...original.case, profile: "unknown" }, { ...original.case, source: null },
      { ...original.case, ast: [{ kind: "font", command: "bogus", children: [] }] },
      { ...original.case, ast: [{ kind: "group", children: [null] }] },
      { ...original.case, ast: [{ kind: "math", content: "x", body: atom }] },
      { ...original.case, ast: [{ kind: "math", body: { kind: "fraction", command: "frac", numerator: atom } }] },
      { ...original.case, ast: [{ kind: "raisebox", lift: { amount: 2, unit: "bogus" }, children: [] }] },
      { ...original.case, ast: [{ kind: "line-break", command: "linebreak", priority: 9 }] },
      { ...original.case, sourceMap: [{ path: "root/0", kind: "unknown", start: 0, end: 1 }] },
      { ...original.case, choices: [{ path: "root/0", upperExclusive: 3, value: "1" }] },
      { ...original.case, features: ["unknown.feature"] },
      { ...original.case, mutations: [{ kind: "replace", start: 0, end: 1 }] },
    ];
    for (const invalid of invalidCases) {
      expect(() => parseTexFuzzBundle(JSON.stringify({ ...original, case: invalid }))).toThrow();
      expect(() => replayTexFuzzCase(invalid)).toThrow();
    }
  });

  it("rejects malformed observations and every optional replay structure", () => {
    const original = bundle();
    for (const observation of [null, {}, { fingerprint: {} },
      { fingerprint: { ...original.observation.fingerprint, mode: "bogus" } },
      { fingerprint: { ...original.observation.fingerprint, featureTags: [1] } },
      { fingerprint: { ...original.observation.fingerprint, severityBucket: "huge" } },
      { ...original.observation, detail: [] },
    ]) expect(() => parseTexFuzzBundle(JSON.stringify({ ...original, observation }))).toThrow();
    for (const extra of [{ minimizedCase: {} }, { oracleEnvironment: { engine: 3 } },
      { shrink: { candidatesEvaluated: 1, oracleEvaluations: 2, termination: "bogus" } }]) {
      expect(() => parseTexFuzzBundle(JSON.stringify({ ...original, ...extra }))).toThrow();
    }
  });

  it("rejects malformed manifest fingerprints, environments, and witness metadata", () => {
    const plan = planTexFuzzArtifacts([bundle()], { engine: "test" });
    const finding = plan.manifest.findings[0];
    const witness = finding?.witnesses[0];
    if (!finding || !witness) throw new Error("Expected planned witness");
    for (const manifest of [
      { ...plan.manifest, oracleEnvironment: { engine: false } },
      { ...plan.manifest, findings: [{ ...finding, fingerprint: { ...finding.fingerprint, featureTags: null } }] },
      { ...plan.manifest, findings: [{ ...finding, witnesses: [{ ...witness, minimizedSourceHash: 4 }] }] },
      { ...plan.manifest, findings: [{ ...finding, witnesses: [{ ...witness, bundlePath: "../escape.json" }] }] },
    ]) expect(() => parseTexFuzzArtifactManifest(JSON.stringify(manifest))).toThrow();
  });

  it("validates continuation budgets and every remaining replay case", () => {
    const original = bundle();
    const continuation = { candidatesEvaluated: 2, oracleEvaluations: 1, elapsedMs: 2, candidateBudgetRemaining: 3, oracleBudgetRemaining: 4, timeBudgetMsRemaining: 5, remainingCandidates: [original.case] };
    const stored = makeTexFuzzStoredBundle(original, continuation);
    expect(parseTexFuzzStoredBundle(JSON.stringify(stored))).toEqual(stored);
    for (const invalid of [null, { ...continuation, timeBudgetMsRemaining: -1 },
      { ...continuation, oracleBudgetRemaining: "4" }, { ...continuation, remainingCandidates: [{}] }]) {
      expect(() => parseTexFuzzStoredBundle(JSON.stringify({ ...stored, shrinkContinuation: invalid }))).toThrow();
    }
  });
});
