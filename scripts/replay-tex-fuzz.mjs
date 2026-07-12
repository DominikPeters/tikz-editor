import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkTexFuzzHardInvariants,
  parseTexFuzzBundle,
  replayTexFuzzCase,
  texFuzzSourceUsesUnsupportedLiteral,
} from "../packages/tex-fuzz/dist/index.js";
import { commandExists, runBatchedTexSupportOracle } from "./lib/tex-fuzz-oracle.mjs";

const path = process.argv[2];
if (!path) {
  throw new Error("Usage: node scripts/replay-tex-fuzz.mjs <bundle.json>");
}
const bundle = parseTexFuzzBundle(readFileSync(resolve(path), "utf8"));
const caseData = replayTexFuzzCase(bundle.minimizedCase ?? bundle.case);
const hardFindings = checkTexFuzzHardInvariants(caseData);
const result = { source: caseData.source, hardFindings: hardFindings.length, differential: null };
if (bundle.observation.fingerprint.resultClass === "differential" && commandExists("lualatex")) {
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
