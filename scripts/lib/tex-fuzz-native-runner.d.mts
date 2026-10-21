import type { ParagraphLayoutReport } from "../../packages/core/src/text/knuth-plass/index.js";
import type { TexFuzzCase, TexFuzzObservation, TexFuzzMetamorphicRun, TexFuzzSupportClassification } from "../../packages/tex-fuzz/src/index.js";
export interface TexFuzzNativeChecks {
  readonly support?: boolean;
  readonly paragraphWidth?: number;
  readonly mathOracle?: { readonly timeoutMs: number };
  readonly boundary?: boolean;
  readonly metamorphic?: boolean;
  readonly history?: boolean;
  readonly churnRequests?: number;
}
export interface TexFuzzNativeRecord {
  readonly caseData: TexFuzzCase;
  readonly observations: readonly TexFuzzObservation[];
  readonly elapsedMs: number;
  readonly checks?: TexFuzzNativeChecks;
  readonly support?: TexFuzzSupportClassification;
  readonly paragraphReport?: ParagraphLayoutReport | null;
  readonly mathOracle?: { readonly compared: boolean; readonly observation: TexFuzzObservation | null };
  readonly metamorphic?: TexFuzzMetamorphicRun;
}
export interface TexFuzzNativeOptions {
  readonly timeoutMs?: number;
  readonly workerUrl?: URL;
  readonly signal?: AbortSignal;
}
export function createTexFuzzNativeRunner(options?: TexFuzzNativeOptions): {
  runCase(caseData: TexFuzzCase, checks?: TexFuzzNativeChecks, signal?: AbortSignal): Promise<TexFuzzNativeRecord>;
  close(): Promise<void>;
};
export function runTexFuzzNativeCases(cases: readonly TexFuzzCase[], options?: TexFuzzNativeOptions & {
  readonly checks?: (caseData: TexFuzzCase, index: number) => TexFuzzNativeChecks;
}): Promise<readonly TexFuzzNativeRecord[]>;
