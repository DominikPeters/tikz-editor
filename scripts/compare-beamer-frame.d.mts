import type { Diagnostic } from "../packages/core/src/diagnostics/types.js";
import type { BeamerStructuralComparison } from "./lib/beamer-frame-compare.mjs";
import type { BeamerPaintProbe } from "./lib/beamer-paint-compare.mjs";
export type BeamerCoreRenderer = {
  prepareBeamerDocument: typeof import("../packages/core/src/beamer/index.js").prepareBeamerDocument;
  computerModernTexMetricProvider: typeof import("../packages/core/src/text/tex/index.js").computerModernTexMetricProvider;
};
export function loadCoreRenderer(): Promise<BeamerCoreRenderer>;
export function rasterizeSvg(inputPath: string, outputPath: string, width: number, height: number): void;
export function rasterizePdfPage(inputPath: string, outputPath: string, pageNumber: number, width: number, height: number): void;
export function structuralContractFailures(summary: BeamerStructuralComparison["summary"]): string[];
export function compareBeamerFrame(options: {
  inputPath: string; frameNumber: number; pageNumber?: number; outDir: string; name?: string;
  width: number; themeVariant?: Readonly<Record<string, string>>; sourceDir?: string; texRoot?: string;
  structuralOnly?: boolean; pdfOnly?: boolean; assertStructural?: boolean;
  paintProbes?: readonly BeamerPaintProbe[];
  paintImages?: boolean;
  paintColors?: readonly { color: string; visible: readonly boolean[] }[];
}, runtime?: { source?: string; coreRenderer?: BeamerCoreRenderer }): Promise<{
  report: {
    input: { pageCount: number; compiledPage: number; frameNumber: number };
    oracle: { report: string; page: { pageCount: number } };
    renderer: { diagnostics: readonly Diagnostic[] };
    structural: BeamerStructuralComparison;
    artifacts: Readonly<Record<string, string>>;
  };
  reportPath: string;
  runDir: string;
}>;
