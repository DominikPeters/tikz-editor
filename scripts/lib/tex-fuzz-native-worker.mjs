import { parentPort } from "node:worker_threads";
import {
  classifyTexFuzzNativeSupport, checkTexFuzzHardInvariants, checkTexFuzzBoundaryInvariants, checkTexFuzzEngineHistory,
  checkTexFuzzMetamorphicInvariants, createTexFuzzFreshEngine,
} from "../../packages/tex-fuzz/dist/index.js";

import { layoutSimpleTexParagraph } from "../../packages/core/dist/text/tex/index.js";
import { compareTexFuzzMathOracle } from "./tex-fuzz-math-oracle.mjs";

let engine;
parentPort.on("message", async ({ caseData, checks }) => {
  const started = performance.now();
  try {
    const finish = (result) => parentPort.postMessage({ observations: [], ...result, elapsedMs: performance.now() - started });
    if (checks.support) { finish({ support: classifyTexFuzzNativeSupport(caseData) }); return; }
    if (checks.paragraphWidth !== undefined) {
      const result = layoutSimpleTexParagraph(caseData.source, {
        width: checks.paragraphWidth, alignment: "justified", hyphenator: { hyphenate: () => [] },
      });
      finish({ paragraphReport: result.report }); return;
    }
    if (checks.mathOracle) {
      finish({ mathOracle: compareTexFuzzMathOracle(caseData, checks.mathOracle) }); return;
    }
    const observations = checkTexFuzzHardInvariants(caseData);
    if (checks.boundary) observations.push(...checkTexFuzzBoundaryInvariants(caseData));
    const metamorphic = checks.metamorphic ? checkTexFuzzMetamorphicInvariants(caseData) : undefined;
    if (metamorphic) observations.push(...metamorphic.findings);
    if (checks.history) {
      engine ??= await createTexFuzzFreshEngine();
      observations.push(...await checkTexFuzzEngineHistory(caseData, { engine, churnRequests: checks.churnRequests ?? 0 }));
    }
    parentPort.postMessage({ observations, metamorphic, elapsedMs: performance.now() - started });
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.stack : String(error), elapsedMs: performance.now() - started });
  }
});
