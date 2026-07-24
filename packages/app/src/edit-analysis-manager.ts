import type { SessionSnapshot } from "./compute";
import {
  createEditAnalysisSession,
  type EditAnalysisSession,
  type EditAnalysisView
} from "@tikz-editor/core/edit/analysis";

export type EditAnalysisKey = {
  documentId: string;
  sourceRevision: number;
  activeRootId: string | null | undefined;
};

type CachedEntry = {
  key: EditAnalysisKey;
  session: EditAnalysisSession;
  primedSnapshotRevision: number | null;
};

let cachedEntry: CachedEntry | null = null;

export function getSharedEditAnalysisView(params: {
  documentId: string;
  sourceRevision: number;
  source: string;
  activeRootId: string | null | undefined;
  snapshot: SessionSnapshot;
}): EditAnalysisView {
  const analysisSource = params.snapshot.source === params.source
    ? params.source
    : params.snapshot.source;
  const key: EditAnalysisKey = {
    documentId: params.documentId,
    sourceRevision: params.sourceRevision,
    activeRootId: params.activeRootId
  };

  if (
    cachedEntry?.key.documentId !== key.documentId ||
    cachedEntry.key.activeRootId !== key.activeRootId
  ) {
    cachedEntry = {
      key,
      session: createEditAnalysisSession(),
      primedSnapshotRevision: null
    };
  } else {
    cachedEntry.key = key;
  }

  const session = cachedEntry.session;
  const snapshotParseResult = params.snapshot.parseResult;
  if (
    snapshotParseResult != null &&
    snapshotParseResult.activeFigureId === params.activeRootId &&
    cachedEntry.primedSnapshotRevision !== params.snapshot.revision
  ) {
    session.primeFromParse(snapshotParseResult, params.snapshot.source, {
      activeFigureId: params.activeRootId ?? snapshotParseResult.activeFigureId
    });
    cachedEntry.primedSnapshotRevision = params.snapshot.revision;
  }

  return session.ensure(analysisSource, {
    activeFigureId: params.activeRootId
  });
}

export function getSharedEditAnalysisSession(): EditAnalysisSession | null {
  return cachedEntry?.session ?? null;
}

export function resetSharedEditAnalysisManager(): void {
  cachedEntry?.session.reset();
  cachedEntry = null;
}
