import type { BeamerSyntaxContext } from "../packages/core/src/beamer/syntax.js";
import type { BeamerFrameModel } from "../packages/core/src/beamer/types.js";

export interface ReviewedFrameIdentity {
  readonly repository: string;
  readonly path: string;
  readonly frame: number;
}
export interface ReviewCandidate extends ReviewedFrameIdentity {
  readonly deckId: string;
  readonly complete: boolean;
  readonly features: readonly string[];
  readonly sourceBytes: number;
}
export function reviewedFrameKey(frame: ReviewedFrameIdentity): string;
export function featuresForFrame(context: BeamerSyntaxContext, frame: BeamerFrameModel): {
  features: string[];
  commands: string[];
  environments: string[];
};
export function selectDiverseFrames<T extends ReviewCandidate>(frames: readonly T[], limit?: number, maxPerDeck?: number, maxPerRepository?: number, excluded?: ReadonlySet<string>): (T & { selectionScore: number })[];
