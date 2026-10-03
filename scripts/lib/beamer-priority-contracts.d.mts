import type { RenderBeamerFrameResult } from "../../packages/core/src/beamer/types.js";
import type { NativeBeamerPageTrace, BeamerStructuralComparison } from "./beamer-frame-compare.mjs";

export interface PriorityFixture {
  readonly id: string;
  readonly file: string;
  readonly frame: number;
  readonly family: string;
  readonly pages: number;
  readonly images?: number;
  readonly oracleText?: readonly string[];
  readonly oracleTextByPage?: readonly (readonly string[])[];
}
export function priorityFidelityFailures(report: {
  readonly input: { readonly overlayStepCount: number };
  readonly oracle: { readonly page: { readonly pageCount: number } };
  readonly structural: { readonly summary: BeamerStructuralComparison["summary"] } | null;
}, fixture: Pick<PriorityFixture, "pages" | "images">, imageCount?: number): string[];
export function priorityOracleFailures(oracle: {
  readonly pdf: { readonly pageCount: number };
  readonly pageTrace: { readonly pages: readonly { readonly glyphs: readonly { readonly code: number }[] }[] };
}, fixture: Pick<PriorityFixture, "pages" | "oracleText" | "oracleTextByPage">): string[];
export function unsupportedCodeFailures(options: {
  readonly source: string;
  readonly span: { readonly from: number; readonly to: number };
  readonly render: RenderBeamerFrameResult;
  readonly trace: NativeBeamerPageTrace;
  readonly requiredText: readonly string[];
}): string[];
