import type { Stack } from "@lezer/lr";
import { MathEnvironmentWord } from "./tex-parser.terms.js";

const MATH_ENVIRONMENT_NAMES = new Set([
  "math", "displaymath", "equation", "align", "alignat", "aligned", "alignedat", "gather", "gathered",
  "flalign", "multline", "split", "cases", "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix",
  "smallmatrix", "array",
]);

export function mathEnvironmentName(word: string, stack: Stack): number {
  return MATH_ENVIRONMENT_NAMES.has(word) && stack.canShift(MathEnvironmentWord) ? MathEnvironmentWord : -1;
}
