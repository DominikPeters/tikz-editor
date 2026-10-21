import type { RenderBeamerFrameResult } from "../../packages/core/src/beamer/types.js";

export interface BeamerReviewSignals {
  readonly flags: readonly string[];
  readonly literalSegments: number;
  readonly paintedFallbacks: readonly { readonly reason: string; readonly from: number | null; readonly to: number | null }[];
  readonly imageElements: number;
  readonly expectedGraphics: number;
}
export function beamerReviewSignals(render: RenderBeamerFrameResult, options?: {
  readonly expectedGraphics?: number;
  readonly assets?: readonly { readonly status: string }[];
}): BeamerReviewSignals;
