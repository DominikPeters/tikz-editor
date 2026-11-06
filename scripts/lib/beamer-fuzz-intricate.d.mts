import type { BeamerFuzzCase } from "./beamer-fuzz-cases.mjs";
export const INTRICATE_FAMILIES: readonly string[];
export function generateIntricateBeamerCases(options: { seed: number; cases: number; offset?: number }): BeamerFuzzCase[];
