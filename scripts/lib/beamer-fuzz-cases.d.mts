export const BEAMER_FUZZ_GENERATOR_VERSION: number;
export const BEAMER_FUZZ_SMOKE_FAMILIES: readonly string[];
export const BEAMER_FUZZ_FAMILIES: readonly string[];
export type BeamerFuzzCase = {
  id: string;
  source: string;
  fixture: {
    id: string; file: string; frame: number; family: string; pages: number;
    choices: { alignment: string; spec: string; width: number; height: number; fontSize?: number; aspectRatio?: number; theme?: string; columnMode?: string; columnWidth?: number; shape?: string; transform?: string; label?: string; blockKind?: string; environment?: string; year?: number; month?: number; day?: number };
    paintColors?: { color: string; visible: boolean[] }[];
    oracleText: string[];
  };
};
export function generateBeamerFuzzCases(options?: { seed?: number; cases?: number; profile?: "smoke" | "broad" }): BeamerFuzzCase[];
