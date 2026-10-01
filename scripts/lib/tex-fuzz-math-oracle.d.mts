import type { TexFuzzCase, TexFuzzObservation } from "../../packages/tex-fuzz/src/index.js";
export function texFuzzMathOracleCases(cases: readonly TexFuzzCase[], limit: number): readonly TexFuzzCase[];
export function compareTexFuzzMathOracle(caseData: TexFuzzCase, options?: {
  readonly tolerance?: number;
  readonly timeoutMs?: number;
  readonly compare?: (formula: string, tolerance: number) => {
    readonly ok: boolean; readonly mismatches: readonly string[]; readonly ours: { readonly supported: boolean };
  };
}): { readonly compared: boolean; readonly observation: TexFuzzObservation | null };
