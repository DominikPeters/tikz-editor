import type { EditParseOptions } from "@tikz-editor/core/edit/parse-options";
import type { EditAnalysisView } from "@tikz-editor/core/edit/analysis";
import type { SessionSnapshot } from "./compute";
import {
  getSharedEditAnalysisSession,
  getSharedEditAnalysisView
} from "./edit-analysis-manager";
import { buildSnapshotEditSourceFingerprint } from "./source-identity";
import { parseWindowRootId } from "./root-inventory";

export type EditParseOptionsOverrides = Omit<
  EditParseOptions,
  "activeFigureId" | "analysisSession" | "analysisView" | "sourceFingerprint"
>;

type BuildEditParseOptionsBase = {
  documentId?: string | null;
  sourceRevision?: number | null;
  source: string;
  activeRootId?: string | null;
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
  if (input.snapshot.overlayLayer?.pageCoordinates && input.snapshot.parseResult) {
    input = { ...input, activeRootId: input.snapshot.parseResult.activeFigureId };
  }
  const activeRootId = parseWindowRootId(
    input.activeRootId,
    input.snapshot.figures.length
  );
  const options: EditParseOptions = {
    activeFigureId: activeRootId,
    ...(input.snapshot.overlayLayer && input.snapshot.parseResult && (input.source === input.snapshot.source || input.source === input.snapshot.parseResult.source)
      ? { preparedParse: { source: input.source, activeFigureId: activeRootId, result: input.snapshot.parseResult } } : {}),
    ...input.overrides,
    sourceFingerprint: buildSnapshotEditSourceFingerprint({
      documentId: input.documentId,
      sourceRevision: input.sourceRevision,
      sourceLength: input.source.length,
      sourceRefs: input.snapshot.editHandles.map((handle) => handle.sourceRef)
    })
  };
  if (input.analysis !== "shared") return options;
  // Analysed on first use: the command runtime builds these options at every
  // render, and in a deck, which has no TikZ parse to prime the analysis
  // from, analysing would parse the whole document as TikZ each time.
  let analysisView: EditAnalysisView | undefined;
  const view = (): EditAnalysisView => analysisView ??= getSharedEditAnalysisView({
    documentId: input.documentId ?? "",
    sourceRevision: input.sourceRevision ?? 0,
    source: input.source,
    activeRootId,
    snapshot: input.snapshot
  });
  return Object.defineProperties(options, {
    analysisView: { enumerable: true, get: view },
    analysisSession: { enumerable: true, get: () => { view(); return getSharedEditAnalysisSession(); } }
  });
}
