export const BEAMER_FUZZ_GENERATOR_VERSION: number;
export const BEAMER_FUZZ_SMOKE_FAMILIES: readonly string[];
export const INTRICATE_FAMILIES: readonly string[];
export const BEAMER_FUZZ_FAMILIES: readonly string[];
export type BeamerFuzzCase = {
  id: string;
  source: string;
  additionalFixtures?: BeamerFuzzCase["fixture"][];
  fixture: {
    id: string; file: string; frame: number; family: string; pages: number; paintImages?: boolean; imagesByPage?: number[];
    choices: { images?: { filename: string; options: string[]; source: string }[]; alignment: string; spec: string; width: number; height: number; fontSize?: number; aspectRatio?: number; theme?: string; columnMode?: string; columnWidth?: number; shape?: string; transform?: string; label?: string; blockKind?: string; environment?: string; year?: number; month?: number; day?: number; grammar?: { version: number; seed: number; index: number; maxDepth: number; budget: number; nodes: number; depth: number; frameCount: number; macroPlan: { initialUnit: string; localUnit: string; initialStyle: string; localStyle: string; chainDepth: number; coefficient: number; stages: { frame: number; unit: string; witness: string }[] }; features: Record<string, number>; pairs: string[]; tree: unknown } };
    paintColors?: { color: string; visible: boolean[] }[];
    oracleText: string[]; oracleTextByPage?: string[][];
  };
};
export function generateBeamerFuzzCases(options?: { seed?: number; cases?: number; profile?: "smoke" | "broad" | "intricate" | "controls" | "images" }): BeamerFuzzCase[];
