export interface TexFuzzOracleInput { readonly id?: string; readonly source: string; }
export interface TexFuzzOracleObservation {
  readonly id: string; readonly supported: boolean; readonly widthSp?: number;
  readonly heightSp?: number; readonly depthSp?: number; readonly error?: string;
}
export interface TexFuzzOracleStats {
  readonly compilations: number; readonly elapsedMs: number; readonly bisectedFailures: number;
  readonly cacheHits: number; readonly cacheMisses: number; readonly cacheWrites: number; readonly batches: number;
}
export interface TexFuzzOracleRun {
  readonly observations: readonly TexFuzzOracleObservation[];
  readonly stats: TexFuzzOracleStats;
  readonly environment: Readonly<Record<string, string>>;
}
export interface TexFuzzOracleOptions {
  readonly engine?: string; readonly timeoutMs?: number; readonly batchSize?: number; readonly workers?: number;
  readonly cacheDir?: string; readonly layer?: string; readonly preamble?: string; readonly signal?: AbortSignal;
}
export const TEX_FUZZ_ORACLE_RUNNER_VERSION: string;
export function commandExists(command: string): boolean;
export function texFuzzOracleEnvironment(engine?: string): Readonly<Record<string, string>>;
export function partitionTexFuzzBatches<T>(items: readonly T[], size: number): readonly (readonly T[])[];
export function mapTexFuzzWorkers<T, U>(items: readonly T[], workers: number, visit: (item: T, index: number) => Promise<U>): Promise<readonly U[]>;
export function runBatchedTexSupportOracle(cases: readonly TexFuzzOracleInput[], options?: TexFuzzOracleOptions): TexFuzzOracleRun;
export function runBatchedTexSupportOracleAsync(cases: readonly TexFuzzOracleInput[], options?: TexFuzzOracleOptions): Promise<TexFuzzOracleRun>;
export function calibrateBatchedTexSupportOracle(cases: readonly TexFuzzOracleInput[], options?: TexFuzzOracleOptions): {
  readonly ok: boolean; readonly mismatches: readonly string[]; readonly batched: TexFuzzOracleRun;
  readonly reversed: TexFuzzOracleRun; readonly standalone: readonly TexFuzzOracleObservation[];
};
export function selectTexFuzzEscalation<T extends { readonly id: string; readonly source: string }>(cases: readonly T[], options?: {
  readonly findingIds?: readonly string[]; readonly controlSampleSize?: number; readonly seed?: string | number;
}): readonly T[];
