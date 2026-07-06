import type { SessionSnapshot } from "./compute";
import {
  createEditAnalysisSession,
  type EditAnalysisSession,
  type EditAnalysisView
} from "tikz-editor/edit/analysis";

export type EditAnalysisKey = {
  documentId: string;
  sourceRevision: number;
  activeFigureId: string | null;
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
  activeFigureId: string | null;
  snapshot: SessionSnapshot;
}): EditAnalysisView {
  const analysisSource = params.snapshot.source === params.source
    ? params.source
    : params.snapshot.source;
  const key: EditAnalysisKey = {
    documentId: params.documentId,
    sourceRevision: params.sourceRevision,
    activeFigureId: params.activeFigureId
  };

  if (
    cachedEntry?.key.documentId !== key.documentId ||
    cachedEntry.key.activeFigureId !== key.activeFigureId
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
  if (
    params.snapshot.parseResult?.activeFigureId === params.activeFigureId &&
    cachedEntry.primedSnapshotRevision !== params.snapshot.revision
  ) {
    session.primeFromParse(params.snapshot.parseResult, params.snapshot.source, {
      activeFigureId: params.activeFigureId ?? params.snapshot.parseResult.activeFigureId
    });
    cachedEntry.primedSnapshotRevision = params.snapshot.revision;
  }

  return session.ensure(analysisSource, {
    activeFigureId: params.activeFigureId
  });
}

export function getSharedEditAnalysisSession(): EditAnalysisSession | null {
  return cachedEntry?.session ?? null;
}

export function resetSharedEditAnalysisManager(): void {
  cachedEntry?.session.reset();
  cachedEntry = null;
}
