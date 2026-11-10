import { compareFormula } from "../compare-tex-math.mjs";
import { caseFromTexFuzzAst } from "../../packages/tex-fuzz/dist/index.js";

/** Keep generated math syntax intact when selecting the richer glyph/rule oracle. */
export function texFuzzMathOracleCases(cases, limit) {
  const selected = new Map();
  const visit = (nodes, owner) => {
    for (const node of nodes) {
      if (selected.size >= limit) return;
      if (node.kind === "math" || node.kind === "display-math") {
        // Keep display style while normalizing away equation/align wrappers;
        // this oracle compares one math list, not display-environment layout.
        const mathNode = node.kind === "display-math"
          ? { ...node, delimiter: "bracket" } : node;
        const caseData = caseFromTexFuzzAst([mathNode],
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
  const source = caseData.source;
  const display = source.startsWith(String.raw`\[`) && source.endsWith(String.raw`\]`) || source.startsWith("$$") && source.endsWith("$$");
  const paren = source.startsWith(String.raw`\(`) && source.endsWith(String.raw`\)`);
  const inline = paren || source.startsWith("$") && source.endsWith("$") && !source.startsWith("$$");
  const delimiterLength = display || paren ? 2 : 1;
  if ((!display && !inline) || source.length <= 2 * delimiterLength) {
    return { compared: false, observation: null };
  }
  const formula = (display ? String.raw`\displaystyle ` : "") + source.slice(delimiterLength, -delimiterLength);
  const tolerance = options.tolerance ?? 0.03;
  const result = (options.compare ?? compareFormula)(formula, tolerance, { timeoutMs: options.timeoutMs, latexRelease: options.latexRelease });
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
