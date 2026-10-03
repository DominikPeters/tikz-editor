import type { RenderBeamerFrameResult } from "../../packages/core/src/beamer/types.js";
import type { NativeBeamerPageTrace, OracleBeamerPageTrace } from "./beamer-frame-compare.mjs";
export interface BeamerPaintComparison {
  readonly tolerance: number;
  readonly samples: readonly { readonly id: string; readonly maxChannelDelta: number }[];
}
export function blockPaintProbes(render: RenderBeamerFrameResult, native: NativeBeamerPageTrace, oracle: Pick<OracleBeamerPageTrace, "glyphs">): { id: string; x: number; y: number }[];
export function compareBlockPaint(render: RenderBeamerFrameResult, native: NativeBeamerPageTrace, oracle: OracleBeamerPageTrace, nativePng: string, oraclePng: string, width: number, height: number): BeamerPaintComparison;
export function paintContractFailures(paint?: BeamerPaintComparison | null): string[];
