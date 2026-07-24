import type { SessionSnapshot } from "./compute";
import {
  createEditAnalysisSession,
  type EditAnalysisSession,
  type EditAnalysisView
} from "@tikz-editor/core/edit/analysis";
import { rootKey } from "./root-key";

type CachedEntry = {
  rootKey: string;
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
  const key = rootKey(params.documentId, params.activeRootId);

  if (cachedEntry?.rootKey !== key) {
    cachedEntry = {
      rootKey: key,
      session: createEditAnalysisSession(),
      primedSnapshotRevision: null
    };
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
