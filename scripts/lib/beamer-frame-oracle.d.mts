import type {
  BeamerDocumentModel,
  BeamerFrameModel,
} from "../../packages/core/src/beamer/types.js";

export const BEAMER_FRAME_ORACLE_VERSION: number;
export const SP_PER_TEX_POINT: number;

export interface BeamerProbePageTrace {
  readonly pageNumber: number;
  readonly metadata: Readonly<Record<string, string>>;
  readonly dimensions: Readonly<
    Record<string, { readonly sp: number; readonly texPt: number }>
  >;
}

export interface BeamerStructuredTextLine {
  readonly text: string;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly baseline: { readonly x: number; readonly y: number } | null;
  readonly font: {
    readonly name: string | null;
    readonly size: number | null;
    readonly weight: string | null;
    readonly style: string | null;
  } | null;
}

export function beamerProbeInstrumentation(): string;
export function buildBeamerFrameProbeSource(
  source: string,
  document: BeamerDocumentModel,
  frameIndex: number
): { readonly frame: BeamerFrameModel; readonly source: string };
export function parseBeamerProbeLog(log: string): {
  readonly pages: readonly BeamerProbePageTrace[];
};
export function parsePdfInfo(output: string): {
  readonly pageCount: number;
  readonly widthPdfPt: number;
  readonly heightPdfPt: number;
  readonly description: string | null;
  readonly rotation: number;
};
export function parseBeamerClassVersion(source: string): {
  readonly date: string;
  readonly version: string;
  readonly description: string;
} | null;
export function summarizeMutoolStructuredText(value: unknown): {
  readonly pages: readonly {
    readonly pageNumber: number;
    readonly textBounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    } | null;
    readonly lines: readonly BeamerStructuredTextLine[];
  }[];
};
export function fileSha256(path: string): string;
export function firstVersionLine(output: unknown): string;
