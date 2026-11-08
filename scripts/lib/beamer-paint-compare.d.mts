import type { RenderBeamerFrameResult } from "../../packages/core/src/beamer/types.js";
import type { NativeBeamerPageTrace, OracleBeamerPageTrace } from "./beamer-frame-compare.mjs";
export interface BeamerPaintComparison {
  readonly tolerance: number;
  readonly samples: readonly { readonly id: string; readonly maxChannelDelta: number }[];
}
export interface BeamerPaintProbe {
  readonly id: string;
  /** SVG page coordinates in TeX points. */
  readonly x: number;
  readonly y: number;
}
export function blockPaintProbes(render: RenderBeamerFrameResult, native: NativeBeamerPageTrace, oracle: Pick<OracleBeamerPageTrace, "glyphs">): { id: string; x: number; y: number }[];
export function compareBlockPaint(render: RenderBeamerFrameResult, native: NativeBeamerPageTrace, oracle: OracleBeamerPageTrace, nativePng: string, oraclePng: string, width: number, height: number, additionalProbes?: readonly BeamerPaintProbe[], paintImages?: boolean): BeamerPaintComparison;
export function paintContractFailures(paint?: BeamerPaintComparison | null): string[];

export interface BeamerColorMaskComparison {
  readonly color: string;
  readonly nativePixels: number;
  readonly oraclePixels: number;
  readonly disagreement: number;
  readonly relativeDifference: number;
  readonly edgeTolerancePx: number;
  readonly interiorDisagreement: number;
}
export function compareColorPixels(native: Uint8Array, oracle: Uint8Array, color: string, width?: number): BeamerColorMaskComparison;
export function compareColorMasks(nativePng: string, oraclePng: string, width: number, height: number, colors?: readonly { readonly color: string }[]): BeamerColorMaskComparison[];
