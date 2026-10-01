import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseTexFuzzBundle,
  replayTexFuzzCase,
  texFuzzSourceUsesUnsupportedLiteral,
} from "../packages/tex-fuzz/dist/index.js";
import { runTexFuzzNativeCases } from "./lib/tex-fuzz-native-runner.mjs";
import { commandExists, runBatchedTexSupportOracle } from "./lib/tex-fuzz-oracle.mjs";

const path = process.argv[2];
if (!path) {
  throw new Error("Usage: node scripts/replay-tex-fuzz.mjs <bundle.json>");
}
const bundle = parseTexFuzzBundle(readFileSync(resolve(path), "utf8"));
const caseData = replayTexFuzzCase(bundle.minimizedCase ?? bundle.case);
const code = bundle.observation.fingerprint.code;
const [native] = await runTexFuzzNativeCases([caseData], {
  timeoutMs: bundle.observation.detail?.timeoutMs,
  checks: () => ({ boundary: true, metamorphic: code.startsWith("metamorphic-"),
    history: code.startsWith("engine-history-"), churnRequests: bundle.observation.detail?.churnRequests ?? 0,
    ...bundle.observation.detail?.checks }),
});
const hardFindings = native.observations;
const result = { source: caseData.source, hardFindings: hardFindings.length, differential: null };
if (code === "math-glyph-trace" && commandExists("lualatex")) {
  const { compareTexFuzzMathOracle } = await import("./lib/tex-fuzz-math-oracle.mjs");
  const comparison = compareTexFuzzMathOracle(caseData, { tolerance: bundle.observation.detail?.tolerance });
  result.differential = { compared: comparison.compared, reproduces: comparison.observation !== null };
} else if (bundle.observation.fingerprint.resultClass === "differential" && commandExists("lualatex")) {
  const oursSupported = !texFuzzSourceUsesUnsupportedLiteral(caseData.source);
  const oracle = runBatchedTexSupportOracle([{ id: "replay", source: caseData.source }]);
  result.differential = {
    oursSupported,
    oracleSupported: oracle.observations[0]?.supported === true,
    reproduces: oursSupported !== (oracle.observations[0]?.supported === true),
  };
}
console.log(JSON.stringify(result, null, 2));
if (hardFindings.length > 0 || result.differential?.reproduces === false) {
  process.exitCode = 1;
}
