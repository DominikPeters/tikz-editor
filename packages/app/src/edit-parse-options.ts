import type { EditParseOptions } from "@tikz-editor/core/edit/parse-options";
import type { EditAnalysisView } from "@tikz-editor/core/edit/analysis";
import type { SessionSnapshot } from "./compute";
import {
  getSharedEditAnalysisSession,
  getSharedEditAnalysisView
} from "./edit-analysis-manager";
import { buildSnapshotEditSourceFingerprint } from "./source-identity";

export type EditParseOptionsOverrides = Omit<
  EditParseOptions,
  "activeFigureId" | "analysisSession" | "analysisView" | "sourceFingerprint"
>;

type BuildEditParseOptionsBase = {
  documentId?: string | null;
  sourceRevision?: number | null;
  source: string;
  activeFigureId?: string | null;
  snapshot: SessionSnapshot;
  overrides?: EditParseOptionsOverrides;
};

export type BuildEditParseOptionsInput = BuildEditParseOptionsBase & {
  analysis: "shared" | "none";
};

export function buildEditParseOptions(
  input: BuildEditParseOptionsBase & { analysis: "shared" }
): EditParseOptions & { analysisView: EditAnalysisView };
export function buildEditParseOptions(
  input: BuildEditParseOptionsBase & { analysis: "none" }
): EditParseOptions;

/**
 * Builds the parse options shared by app edit entry points.
 *
 * Shared analysis is opt-in so pure layers such as the store reducer can use
 * the same figure/fingerprint recipe without mutating the analysis cache.
 */
export function buildEditParseOptions(input: BuildEditParseOptionsInput): EditParseOptions {
  const activeFigureId =
    input.activeFigureId ?? (input.snapshot.figures.length > 1 ? null : undefined);
  const sharedAnalysis = input.analysis === "shared"
    ? {
        analysisView: getSharedEditAnalysisView({
          documentId: input.documentId ?? "",
          sourceRevision: input.sourceRevision ?? 0,
          source: input.source,
          activeFigureId,
          snapshot: input.snapshot
        }),
        analysisSession: getSharedEditAnalysisSession()
      }
    : {};

  return {
    activeFigureId,
    ...sharedAnalysis,
    ...input.overrides,
    sourceFingerprint: buildSnapshotEditSourceFingerprint({
      documentId: input.documentId,
      sourceRevision: input.sourceRevision,
      sourceLength: input.source.length,
      sourceRefs: input.snapshot.editHandles.map((handle) => handle.sourceRef)
    })
  };
}
