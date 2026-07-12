import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  checkTexFuzzHardInvariants,
  checkTexFuzzMetamorphicInvariants,
  differentialCanaryCase,
  differentialSupportFingerprint,
  generateFullySupportedTexFuzzCases,
  generateTexFuzzCase,
  generateTexFuzzEditSequence,
  measureTexFuzzCoverage,
  planTexFuzzArtifacts,
  projectTexFuzzCaseToParagraph,
  texFuzzParagraphOracleWidth,
  sameTexFuzzFingerprint,
  serializeTexFuzzBundle,
  runTexFuzzEditSequence,
  shrinkTexFuzzCase,
  texFuzzMalformedMutations,
  texFuzzPrefixDamageCases,
  texFuzzSourceUsesUnsupportedLiteral,
  texFuzzRegistryDrift,
} from "../packages/tex-fuzz/dist/index.js";
import {
  calibrateBatchedTexSupportOracle,
  commandExists,
  runBatchedTexSupportOracleAsync,
  selectTexFuzzEscalation,
} from "./lib/tex-fuzz-oracle.mjs";
import {
  compareTexFuzzParagraphGeometry,
  runBatchedTexParagraphOracle,
} from "./lib/tex-fuzz-paragraph-oracle.mjs";

const { values } = parseArgs({
  options: {
    cases: { type: "string", default: "100" },
    seed: { type: "string", default: "20260711" },
    profile: { type: "string", default: "aggressive" },
    out: { type: "string", default: "artifacts/tex-fuzz/vertical-slice.json" },
    "coverage-out": { type: "string", default: "artifacts/tex-fuzz/coverage.json" },
    "artifacts-dir": { type: "string", default: "artifacts/tex-fuzz/findings" },
    "oracle-cache-dir": { type: "string", default: "artifacts/tex-fuzz/oracle-cache" },
    "oracle-workers": { type: "string", default: "2" },
    "no-oracle": { type: "boolean", default: false },
    "stateful-cases": { type: "string", default: "25" },
    "malformed-cases": { type: "string", default: "0" },
    "prefix-base-cases": { type: "string", default: "0" },
    "prefix-limit-per-case": { type: "string", default: "64" },
    "metamorphic-cases": { type: "string", default: "0" },
    "projection-control-cases": { type: "string", default: "32" },
    "supported-cases": { type: "string", default: "16" },
    "supported-max-attempts": { type: "string", default: "2048" },
    "oracle-sample-cases": { type: "string", default: "64" },
    "oracle-geometry-policy": { type: "string", default: "diagnostic" },
  },
});
const count = Number(values.cases);
const seed = Number(values.seed);
const statefulCount = Number(values["stateful-cases"]);
const oracleWorkers = Number(values["oracle-workers"]);
const malformedCount = Number(values["malformed-cases"]);
const prefixBaseCount = Number(values["prefix-base-cases"]);
const prefixLimitPerCase = Number(values["prefix-limit-per-case"]);
const metamorphicCount = Number(values["metamorphic-cases"]);
const projectionControlCount = Number(values["projection-control-cases"]);
const supportedCount = Number(values["supported-cases"]);
const supportedMaximumAttempts = Number(values["supported-max-attempts"]);
const oracleSampleCount = Number(values["oracle-sample-cases"]);
const oracleGeometryPolicy = values["oracle-geometry-policy"];
const profiles = new Set(["vertical-slice", "canary", "aggressive", "supported-aggressive", "document", "malformed"]);
if (!profiles.has(values.profile)) {
  throw new Error(`Unknown --profile ${values.profile}.`);
}
const profile = values.profile;
if (!Number.isSafeInteger(count) || count <= 0 || !Number.isSafeInteger(seed)
  || !Number.isSafeInteger(statefulCount) || statefulCount < 0
  || !Number.isSafeInteger(oracleWorkers) || oracleWorkers < 1
  || !Number.isSafeInteger(malformedCount) || malformedCount < 0
  || !Number.isSafeInteger(prefixBaseCount) || prefixBaseCount < 0
  || !Number.isSafeInteger(prefixLimitPerCase) || prefixLimitPerCase < 1
  || !Number.isSafeInteger(metamorphicCount) || metamorphicCount < 0
  || !Number.isSafeInteger(projectionControlCount) || projectionControlCount < 0
  || !Number.isSafeInteger(supportedCount) || supportedCount < 0
  || !Number.isSafeInteger(supportedMaximumAttempts) || supportedMaximumAttempts < supportedCount
  || !Number.isSafeInteger(oracleSampleCount) || oracleSampleCount < 0
  || !["diagnostic", "fail"].includes(oracleGeometryPolicy)) {
  throw new Error("Case counts and --seed must be valid integers; --oracle-workers and --prefix-limit-per-case must be positive.");
}

const drift = texFuzzRegistryDrift();
if (drift.missing.length > 0 || drift.staleExclusions.length > 0) {
  throw new Error(`TeX fuzz registry drift: ${JSON.stringify(drift)}`);
}

/** @type {Record<string, number>} */
const adaptiveFeatureCounts = {};
/** @type {import("../packages/tex-fuzz/dist/index.js").TexFuzzCase[]} */
const validGenerated = [];
for (let index = 0; index < count; index += 1) {
  const caseData = generateTexFuzzCase(seed + index, {
    profile,
    coverageFeedback: index === 0 ? undefined : adaptiveFeatureCounts,
  });
  const profileMutations = profile === "malformed" ? texFuzzMalformedMutations(caseData) : [];
  const selected = profileMutations[index % Math.max(1, profileMutations.length)]?.case ?? caseData;
  validGenerated.push(selected);
  for (const feature of caseData.features) {
    adaptiveFeatureCounts[feature] = (adaptiveFeatureCounts[feature] ?? 0) + 1;
  }
}

const supportedLane = generateFullySupportedTexFuzzCases(seed + count, {
  count: supportedCount,
  maximumAttempts: supportedMaximumAttempts,
});
const supportedGenerated = [...supportedLane.cases];

const malformedGenerated = Array.from({ length: malformedCount }, (_, index) => {
  const base = validGenerated[index % validGenerated.length];
  const mutations = texFuzzMalformedMutations(base);
  return mutations[index % Math.max(1, mutations.length)]?.case ?? base;
});
const prefixGenerated = validGenerated.slice(0, Math.min(prefixBaseCount, validGenerated.length)).flatMap((base) => {
  const prefixes = texFuzzPrefixDamageCases(base);
  if (prefixes.length <= prefixLimitPerCase) return prefixes;
  const denominator = Math.max(1, prefixLimitPerCase - 1);
  return Array.from({ length: prefixLimitPerCase }, (_, index) =>
    prefixes[Math.floor(index * (prefixes.length - 1) / denominator)]
  );
});
const generated = [...validGenerated, ...supportedGenerated, ...malformedGenerated, ...prefixGenerated];
const projectionControls = validGenerated
  .slice(0, Math.min(projectionControlCount, validGenerated.length))
  .map(projectTexFuzzCaseToParagraph);
const metamorphicCandidates = [...supportedGenerated, ...validGenerated];
const metamorphicRuns = metamorphicCandidates.slice(0, Math.min(metamorphicCount, metamorphicCandidates.length)).map((caseData) => ({
  caseData,
  run: checkTexFuzzMetamorphicInvariants(caseData),
}));
const hardFindingRecords = [...[...generated, ...projectionControls].flatMap((caseData) =>
  checkTexFuzzHardInvariants(caseData).map((observation) => ({ caseData, observation }))
), ...metamorphicRuns.flatMap(({ caseData, run }) =>
  run.findings.map((observation) => ({ caseData, observation }))
)];
const hardFindings = hardFindingRecords.map(({ observation }) => observation);
if (hardFindingRecords.length > 0) {
  const bundles = [];
  // One renderer mutation can produce the same diagnostic at hundreds of
  // line/segment loci. Preserve every observation, but shrink one
  // representative per diagnostic class so triage cost remains bounded.
  const representatives = new Map(hardFindingRecords.map((record) => [
    `${record.observation.fingerprint.resultClass}:${record.observation.fingerprint.code}`,
    record,
  ]));
  for (const { caseData, observation } of representatives.values()) {
    const shrink = await shrinkTexFuzzCase(caseData, observation, (candidates) => Promise.resolve(
      candidates.map((candidate) => checkTexFuzzHardInvariants(candidate).find((finding) =>
        sameTexFuzzFingerprint(finding.fingerprint, observation.fingerprint)
      ) ?? null)
    ), { maxCandidates: 500, maxOracleEvaluations: 0, maxTimeMs: 10_000 });
    bundles.push({
      case: caseData,
      minimizedCase: shrink.minimizedCase,
      observation,
      shrink: {
        candidatesEvaluated: shrink.candidatesEvaluated,
        oracleEvaluations: shrink.oracleEvaluations,
        termination: shrink.termination,
      },
    });
  }
  const artifactRoot = resolve(values["artifacts-dir"]);
  const environment = {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    runner: "native-hard-invariants-v1",
  };
  const artifactPlan = planTexFuzzArtifacts(bundles, environment);
  mkdirSync(artifactRoot, { recursive: true });
  for (const planned of artifactPlan.bundles) {
    const bundlePath = resolve(artifactRoot, planned.witness.bundlePath);
    mkdirSync(dirname(bundlePath), { recursive: true });
    writeFileSync(bundlePath, `${JSON.stringify(planned.storedBundle, null, 2)}\n`, "utf8");
  }
  writeFileSync(resolve(artifactRoot, "manifest.json"), `${JSON.stringify(artifactPlan.manifest, null, 2)}\n`, "utf8");
  throw new Error(
    `Generated cases violated ${hardFindings.length} hard invariants; minimized replay artifacts are in ${artifactRoot}.`
  );
}

/**
 * @param {{ readonly source: string, readonly unsupportedLiteral: boolean }} left
 * @param {{ readonly source: string, readonly unsupportedLiteral: boolean }} right
 */
function equalEditState(left, right) {
  return left.source === right.source && left.unsupportedLiteral === right.unsupportedLiteral;
}

let statefulSteps = 0;
for (let index = 0; index < Math.min(statefulCount, generated.length); index += 1) {
  const initialCase = generated[index];
  const secondaryCase = generated[(index + 1) % generated.length];
  const sequence = generateTexFuzzEditSequence(initialCase, seed + index);
  const run = await runTexFuzzEditSequence([
    { id: "node-a", case: initialCase },
    { id: "node-b", case: secondaryCase },
  ], sequence, {
    compute: ({ source }) => ({
      value: {
        source,
        unsupportedLiteral: texFuzzSourceUsesUnsupportedLiteral(source),
      },
      stages: { parser: { status: "fresh" } },
    }),
    equal: equalEditState,
  });
  statefulSteps += run.steps.length;
}

let bundle;
let oracleSummary = { available: false };
if (!values["no-oracle"] && commandExists("lualatex")) {
  const canary = differentialCanaryCase();
  const calibrationCases = [canary, ...generated.slice(0, 3)].map((item, index) => ({ id: `cal-${index}`, source: item.source }));
  const calibration = calibrateBatchedTexSupportOracle(calibrationCases);
  if (!calibration.ok) {
    throw new Error(`Batched oracle isolation calibration failed for ${calibration.mismatches.join(", ")}.`);
  }
  const expected = { fingerprint: differentialSupportFingerprint(canary) };
  const oursSupported = !texFuzzSourceUsesUnsupportedLiteral(canary.source);
  const oracleOptions = {
    batchSize: 64,
    workers: oracleWorkers,
    cacheDir: resolve(values["oracle-cache-dir"]),
  };
  const initialOracle = await runBatchedTexSupportOracleAsync(
    [{ id: "canary", source: canary.source }],
    oracleOptions
  );
  const oracleSupported = initialOracle.observations[0]?.supported === true;
  if (oursSupported === oracleSupported) {
    throw new Error("Differential support-classification canary did not diverge.");
  }
  const shrink = await shrinkTexFuzzCase(canary, expected, async (candidates, context) => {
    // A failed batch can require at most 2n-1 compilations when recursively
    // bisected to individual cases. Restrict the attempted prefix so oracle
    // work can never exceed the shrinker's remaining external-work budget.
    const attemptedCount = Math.min(candidates.length, Math.floor((context.maxOracleEvaluations + 1) / 2));
    const attempted = candidates.slice(0, attemptedCount);
    if (attempted.length === 0) {
      return {
        observations: candidates.map(() => null),
        oracleEvaluations: 0,
        oracleBudgetExhausted: true,
      };
    }
    const oracle = await runBatchedTexSupportOracleAsync(
      attempted.map((item, index) => ({ id: `shrink-${index}`, source: item.source })),
      oracleOptions
    );
    const observations = attempted.map((candidate, index) => {
      const candidateOurs = !texFuzzSourceUsesUnsupportedLiteral(candidate.source);
      const candidateOracle = oracle.observations[index]?.supported === true;
      return candidateOurs !== candidateOracle ? { fingerprint: differentialSupportFingerprint(candidate) } : null;
    });
    return {
      observations: [...observations, ...candidates.slice(attempted.length).map(() => null)],
      oracleEvaluations: oracle.stats.compilations,
      oracleBudgetExhausted: attempted.length < candidates.length,
    };
  }, { maxCandidates: 200, maxOracleEvaluations: 200, maxTimeMs: 30_000 });
  bundle = {
    case: canary,
    minimizedCase: shrink.minimizedCase,
    observation: expected,
    oracleEnvironment: initialOracle.environment,
    shrink: {
      candidatesEvaluated: shrink.candidatesEvaluated,
      oracleEvaluations: shrink.oracleEvaluations,
      termination: shrink.termination,
    },
  };
  oracleSummary = {
    available: true,
    calibrationCompilations: calibration.batched.stats.compilations + calibration.reversed.stats.compilations + calibration.standalone.length,
    initialCompileMs: Number(initialOracle.stats.elapsedMs.toFixed(1)),
    cacheHits: initialOracle.stats.cacheHits,
    shrinkCandidates: shrink.candidatesEvaluated,
    minimizedSource: shrink.minimizedCase.source,
  };

  const core = await import("../packages/core/dist/text/tex/index.js");
  const projected = selectTexFuzzEscalation(
    validGenerated.map((caseData, index) => ({
      id: `generated-${index}`,
      source: caseData.source,
      caseData: projectTexFuzzCaseToParagraph(caseData),
    })),
    { controlSampleSize: Math.min(oracleSampleCount, validGenerated.length), seed }
  );
  const paragraphInputs = projected.map(({ id, caseData }) => ({
    id,
    source: caseData.source,
    width: texFuzzParagraphOracleWidth(caseData),
  }));
  const paragraphOracle = runBatchedTexParagraphOracle(paragraphInputs, {
    batchSize: 64,
    cacheDir: resolve(values["oracle-cache-dir"], "paragraph"),
  });
  let paragraphCompared = 0;
  const paragraphFindings = projected.flatMap(({ id, caseData }, index) => {
    const paragraphWidth = texFuzzParagraphOracleWidth(caseData);
    const tex = paragraphOracle.observations[index];
    const ours = core.layoutSimpleTexParagraph(caseData.source, {
      width: paragraphWidth,
      alignment: "justified",
      hyphenator: { hyphenate: () => [] },
    });
    if (!tex?.supported || !ours.report) return [];
    paragraphCompared += 1;
    const comparison = compareTexFuzzParagraphGeometry(ours.report, tex);
    if (comparison.matches) return [];
    const code = comparison.code;
    return [{
      id,
      caseData,
      observation: {
        fingerprint: {
          version: 1,
          resultClass: "differential",
          code,
          firstDivergentLayer: code === "paragraph-space-width" ? "geometry" : "lines",
          featureTags: ["text.literal"],
          mode: "text",
          structuralLocus: `paragraph/width-${paragraphWidth}`,
          oracleEnvironmentFamily: "lualatex",
        },
        detail: comparison,
      },
    }];
  });
  oracleSummary = {
    ...oracleSummary,
    generatedParagraphSample: projected.length,
    generatedParagraphCompared: paragraphCompared,
    generatedParagraphFindings: paragraphFindings.length,
    paragraphCompilations: paragraphOracle.stats.compilations,
    paragraphCacheHits: paragraphOracle.stats.cacheHits,
  };
  if (oracleGeometryPolicy === "fail" && paragraphCompared !== projected.length) {
    throw new Error(`Only ${paragraphCompared}/${projected.length} generated paragraph cases reached a comparable oracle result.`);
  }
  if (paragraphFindings.length > 0) {
    const differentialRoot = resolve(values["artifacts-dir"], "paragraph-differential");
    /** @type {Map<string, import("../packages/tex-fuzz/dist/index.js").TexFuzzCase>} */
    const minimizedByCode = new Map();
    for (const finding of new Map(paragraphFindings.map((item) => [
      item.observation.fingerprint.code,
      item,
    ])).values()) {
      const shrunk = await shrinkTexFuzzCase(
        finding.caseData,
        finding.observation,
        (candidates, context) => {
          const attemptedCount = Math.min(candidates.length, Math.floor((context.maxOracleEvaluations + 1) / 2));
          const attempted = candidates.slice(0, attemptedCount);
          if (attempted.length === 0) {
            return Promise.resolve({ observations: candidates.map(() => null), oracleEvaluations: 0, oracleBudgetExhausted: true });
          }
          const inputs = attempted.map((candidate, index) => ({
            id: `shrink-paragraph-${index}`,
            source: candidate.source,
            width: texFuzzParagraphOracleWidth(candidate),
          }));
          const texBatch = runBatchedTexParagraphOracle(inputs, {
            batchSize: 64,
            cacheDir: resolve(values["oracle-cache-dir"], "paragraph"),
          });
          const observations = attempted.map((candidate, index) => {
            const candidateWidth = texFuzzParagraphOracleWidth(candidate);
            const tex = texBatch.observations[index];
            const ours = core.layoutSimpleTexParagraph(candidate.source, {
              width: candidateWidth,
              alignment: "justified",
              hyphenator: { hyphenate: () => [] },
            });
            if (!tex?.supported || !ours.report) return null;
            const comparison = compareTexFuzzParagraphGeometry(ours.report, tex);
            return !comparison.matches && comparison.code === finding.observation.fingerprint.code
              ? { fingerprint: finding.observation.fingerprint, detail: comparison }
              : null;
          });
          return Promise.resolve({
            observations: [...observations, ...candidates.slice(attempted.length).map(() => null)],
            oracleEvaluations: texBatch.stats.compilations,
            oracleBudgetExhausted: attempted.length < candidates.length,
          });
        },
        { maxCandidates: 200, maxOracleEvaluations: 64, maxTimeMs: 20_000 }
      );
      minimizedByCode.set(finding.observation.fingerprint.code, shrunk.minimizedCase);
    }
    const differentialBundles = paragraphFindings.map(({ caseData, observation }) => ({
      case: caseData,
      minimizedCase: minimizedByCode.get(observation.fingerprint.code),
      observation,
      oracleEnvironment: paragraphOracle.environment,
    }));
    const differentialPlan = planTexFuzzArtifacts(differentialBundles, paragraphOracle.environment);
    mkdirSync(differentialRoot, { recursive: true });
    for (const planned of differentialPlan.bundles) {
      const bundlePath = resolve(differentialRoot, planned.witness.bundlePath);
      mkdirSync(dirname(bundlePath), { recursive: true });
      writeFileSync(bundlePath, `${JSON.stringify(planned.storedBundle, null, 2)}\n`, "utf8");
    }
    writeFileSync(resolve(differentialRoot, "manifest.json"), `${JSON.stringify(differentialPlan.manifest, null, 2)}\n`, "utf8");
    if (oracleGeometryPolicy === "fail") {
      throw new Error(`${paragraphFindings.length} generated paragraph differential findings require triage; see ${differentialRoot}.`);
    }
  }
}

const output = {
  schemaVersion: 1,
  seed,
  cases: count,
  profile,
  hardFindings: hardFindings.length,
  stateful: { cases: Math.min(statefulCount, generated.length), steps: statefulSteps },
  generatedKinds: {
    valid: validGenerated.length,
    fullySupported: supportedGenerated.length,
    malformed: malformedGenerated.length,
    prefixes: prefixGenerated.length,
    projectionControls: projectionControls.length,
  },
  supportedGeneration: supportedLane.stats,
  metamorphic: {
    cases: metamorphicRuns.length,
    pairs: metamorphicRuns.reduce((sum, item) => sum + item.run.pairCount, 0),
    checks: metamorphicRuns.reduce((sum, item) => sum + item.run.checks, 0),
    findings: metamorphicRuns.reduce((sum, item) => sum + item.run.findings.length, 0),
  },
  drift,
  oracle: oracleSummary,
  bundle,
};
const coverage = measureTexFuzzCoverage(generated);
const outPath = resolve(values.out);
const coveragePath = resolve(values["coverage-out"]);
mkdirSync(resolve(outPath, ".."), { recursive: true });
mkdirSync(resolve(coveragePath, ".."), { recursive: true });
writeFileSync(outPath, bundle ? serializeTexFuzzBundle(bundle) : `${JSON.stringify(output, null, 2)}\n`, "utf8");
writeFileSync(coveragePath, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ...output,
  bundle: bundle ? { minimizedSource: bundle.minimizedCase?.source, shrink: bundle.shrink } : undefined,
  coverage: {
    path: coveragePath,
    features: Object.keys(coverage.featureCounts).length,
    pairs: Object.keys(coverage.featurePairCounts).length,
    triples: Object.keys(coverage.featureTripleCounts).length,
    maximumDepths: coverage.maximumDepthCounts,
  },
}, null, 2));
