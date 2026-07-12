export interface TexFuzzParagraphOracleCase {
  readonly id: string;
  readonly source: string;
  readonly width: number;
}
export interface TexFuzzParagraphOracleLine {
  readonly index: number;
  readonly widthSp: number;
  readonly glueSet: number;
  readonly glueSign: number;
  readonly text: string;
  readonly interwordWidthsSp: readonly number[];
}
export interface TexFuzzParagraphOracleObservation {
  readonly id: string;
  readonly supported: boolean;
  readonly lines: readonly TexFuzzParagraphOracleLine[];
  readonly error?: string;
}
export declare const TEX_FUZZ_PARAGRAPH_ORACLE_VERSION: string;
export declare function compareTexFuzzParagraphGeometry(
  report: { readonly lines: readonly { readonly segments: readonly { readonly kind: string; readonly text?: string; readonly width: number }[] }[] },
  tex: TexFuzzParagraphOracleObservation
): {
  readonly matches: boolean;
  readonly code: "paragraph-space-width" | "paragraph-line-text";
  readonly maxSpaceDeltaSp: number;
  readonly oursLines: readonly unknown[];
  readonly texLines: readonly unknown[];
};
export declare function runBatchedTexParagraphOracle(
  cases: readonly TexFuzzParagraphOracleCase[],
  options?: { readonly engine?: string; readonly timeoutMs?: number; readonly batchSize?: number; readonly cacheDir?: string }
): {
  readonly observations: readonly (TexFuzzParagraphOracleObservation | undefined)[];
  readonly stats: Readonly<Record<string, number>>;
  readonly environment: Readonly<Record<string, string>>;
};
