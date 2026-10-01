import { compareFormula } from "../compare-tex-math.mjs";
import { caseFromTexFuzzAst } from "../../packages/tex-fuzz/dist/index.js";

/** Keep generated math syntax intact when selecting the richer glyph/rule oracle. */
export function texFuzzMathOracleCases(cases, limit) {
  const selected = new Map();
  const visit = (nodes, owner) => {
    for (const node of nodes) {
      if (selected.size >= limit) return;
      if (node.kind === "math" || node.kind === "display-math") {
        const caseData = caseFromTexFuzzAst([node.body
          ? { kind: "math", body: node.body } : { kind: "math", content: node.content }],
        { seed: owner.seed, profile: owner.profile });
        selected.set(caseData.source, caseData);
      } else if ("children" in node) visit(node.children, owner);
    }
  };
  for (const caseData of cases) {
    visit(caseData.ast, caseData);
    if (selected.size >= limit) break;
  }
  return [...selected.values()];
}

/** Return shared findings rather than unstructured standalone-script diagnostics. */
export function compareTexFuzzMathOracle(caseData, options = {}) {
  if (!caseData.source.startsWith("$") || !caseData.source.endsWith("$") || caseData.source.length < 3) {
    return { compared: false, observation: null };
  }
  const formula = caseData.source.slice(1, -1);
  const tolerance = options.tolerance ?? 0.03;
  const result = (options.compare ?? compareFormula)(formula, tolerance, { timeoutMs: options.timeoutMs });
  const comparable = result.ours.supported && !result.mismatches.some((message) => message.startsWith("TeX oracle failed:"));
  if (result.ok) return { compared: true, observation: null };
  return { compared: comparable, observation: {
    fingerprint: { version: 1, resultClass: "differential", code: "math-glyph-trace",
      firstDivergentLayer: result.mismatches[0]?.includes("glyph") ? "glyphs" : "geometry",
      featureTags: caseData.features, mode: "math", structuralLocus: "math-trace",
      oracleEnvironmentFamily: "lualatex" },
    detail: { formula, tolerance, comparable, mismatches: result.mismatches },
  } };
}
