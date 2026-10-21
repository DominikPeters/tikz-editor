import type { Diagnostic } from "../../packages/core/src/diagnostics/types.js";
import type { DocumentGraphicsResolver } from "../../packages/core/src/graphics/types.js";

export interface CorpusEntry {
  repository: string;
  path: string;
  root: string;
  inputPath: string;
  commit?: string;
  license?: string;
}

export interface CorpusPage {
  status: string;
  frame?: number;
  step?: number;
  title?: string;
  error?: string;
  svg?: string;
  preview?: string;
  comparisonReport?: string;
  oracleLog?: string;
  renderer?: { diagnostics: Diagnostic[] };
  structuralFailures?: string[];
  normalizedRmse?: number | null;
}

export interface CorpusDeck {
  entry: CorpusEntry;
  status: string;
  frameCount?: number;
  error?: string;
  assets?: { status: string }[];
  inputs?: { status: string }[];
  pages: CorpusPage[];
}

export interface CorpusSummary {
  decks: number;
  framesDiscovered: number;
  pagesAttempted: number;
  pagesRendered: number;
  pagesWithoutDiagnostics: number;
  pagesCompared: number;
  structuralMatches: number;
  deckStatuses: Record<string, number>;
  pageStatuses: Record<string, number>;
  assetStatuses: Record<string, number>;
  inputStatuses: Record<string, number>;
  repositories: Record<string, { decks: number; frames: number; rendered: number; compared: number }>;
  diagnostics: { code: string; severity: string; occurrences: number; pages: number; example: string }[];
}

export function sampleIndices(count: number, sample?: number | "all"): number[];
export function corpusEntries(indexPath: string): CorpusEntry[];
export function loadCorpusSource(inputPath: string, expandInputs?: boolean): {
  source: string;
  inputs: { fromFile: string; filename: string; status: string; resolvedPath?: string }[];
  dependencies: { path: string; sha256: string }[];
};
export function sha256(value: string | Uint8Array): string;
export function entryId(entry: CorpusEntry): string;
export function corpusGraphicsResolver(source: string, inputPath: string, assetDir: string): {
  resolver: DocumentGraphicsResolver;
  report(): { filename: string; page: number; path?: string; status: string; reason?: string }[];
};
export function summarizeCorpus(decks: CorpusDeck[]): CorpusSummary;
export function writeJson(path: string, value: unknown): void;
export function corpusGallery(report: {
  summary: CorpusSummary;
  options: { mode: string; expandInputs: boolean };
  decks: CorpusDeck[];
}): string;
