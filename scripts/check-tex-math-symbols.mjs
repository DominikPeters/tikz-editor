import { compareFormula } from "./compare-tex-math.mjs";
import { loadTexFuzzModules } from "./lib/tex-fuzz-loader.mjs";

const { TEX_FUZZ_MATH_SYMBOL_ORACLE_FORMULAS, TEX_FUZZ_MATH_LAYOUT_ORACLE_FORMULAS } = await loadTexFuzzModules();
const formulas = [...TEX_FUZZ_MATH_SYMBOL_ORACLE_FORMULAS, ...TEX_FUZZ_MATH_LAYOUT_ORACLE_FORMULAS];
const failures = formulas
  .map(formula => compareFormula(formula, 0.01))
  .filter(result => !result.ok);
console.log(JSON.stringify({ cases: formulas.length, failed: failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
