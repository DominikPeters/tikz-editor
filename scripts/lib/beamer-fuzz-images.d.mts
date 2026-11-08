import type { BeamerFuzzCase } from "./beamer-fuzz-cases.mjs";
export const IMAGE_FAMILIES: readonly string[];
export function imageProduction(random: (maximum: number) => number): { filename: string; options: string[]; source: string };
export function generateImageBeamerCases(options: { seed: number; cases: number }): BeamerFuzzCase[];
