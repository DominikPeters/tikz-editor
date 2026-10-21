import type { BeamerDocumentModel } from "../../packages/core/src/beamer/types.js";
import type { BeamerDeckCounterContext } from "./beamer-frame-oracle.mjs";

export function instrumentBeamerDeckCounters(source: string, document: BeamerDocumentModel): string;
export function parseBeamerDeckCounters(log: string, navSource: string, frameCount: number): BeamerDeckCounterContext;
export function collectBeamerDeckContext(options: {
  source: string; document: BeamerDocumentModel; inputPath: string;
  sourceDir?: string; texRoot?: string | null; cacheDir: string;
}): BeamerDeckCounterContext & { cacheDirectory: string; cached: boolean };
