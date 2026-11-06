export const BEAMER_COVERAGE_SCOPE: readonly string[];
export interface FuzzSourceCoverage { kind: string; files: string[]; hit: string[]; all: string[] }
export function readFuzzCoverage(data: Record<string, unknown>, root: string): FuzzSourceCoverage;
export function summarizeFuzzCoverage(hit: Set<string>, all: Set<string>): Record<string, { covered: number; total: number; percent: number | null }>;
export interface FuzzCorpusCoverageEntry { id: string; status: string; features: string[]; size: number }
export function distillFuzzCorpus<T extends FuzzCorpusCoverageEntry>(entries: readonly T[]): T[];
