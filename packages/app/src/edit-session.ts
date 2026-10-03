import type { EditorAction, EditorState } from "./store/types";
import type { EditActionResult } from "@tikz-editor/core/edit/actions";
import { patchesMatchSourceTransition } from "@tikz-editor/core/edit/source-patches";

type SessionState = Pick<EditorState, "documents" | "activeDocumentId">;
export type DocumentEditSession = {
  documentId: string;
  activeRootId: string | null;
  baseSource: string;
  latestSource: string;
  latestRevision: number;
  changedSourceIds: string[] | null;
};

export function beginDocumentEdit(state: SessionState, changedSourceIds: string[] | null = null): DocumentEditSession {
  const doc = state.documents[state.activeDocumentId];
  return { documentId: doc.id, activeRootId: doc.activeRootId, baseSource: doc.source,
    latestSource: doc.source, latestRevision: doc.sourceRevision, changedSourceIds };
}

export function ownsDocumentEdit(session: DocumentEditSession, state: SessionState): boolean {
  const doc = state.documents[session.documentId];
  return !!doc && doc.source === session.latestSource && doc.sourceRevision === session.latestRevision;
}

export function canContinueDocumentEdit(session: DocumentEditSession, state: SessionState): boolean {
  return state.activeDocumentId === session.documentId &&
    state.documents[session.documentId]?.activeRootId === session.activeRootId && ownsDocumentEdit(session, state);
}

/** Called only around synchronous edits after checking ownership. */
export function trackDocumentEdit(session: DocumentEditSession, state: SessionState): void {
  const doc = state.documents[session.documentId];
  if (doc) {
    session.latestSource = doc.source;
    session.latestRevision = doc.sourceRevision;
  }
}

/** Cancelling a preview may restore its inactive tab, but never an intervening edit. */
export function restoreDocumentEdit(
  session: DocumentEditSession, getState: () => SessionState, dispatch: (action: EditorAction) => void,
  preview?: Pick<Extract<EditActionResult, { kind: "success" | "partial" }>, "newSource" | "patches" | "identityMoves">
): boolean {
  if (!ownsDocumentEdit(session, getState())) return false;
  if (preview && (preview.newSource !== session.latestSource ||
    !patchesMatchSourceTransition(session.baseSource, session.latestSource, preview.patches))) return false;
  dispatch({ type: "SET_SOURCE_TRANSIENT", documentId: session.documentId,
    source: session.baseSource, expectedSource: session.latestSource, expectedSourceRevision: session.latestRevision,
    changedSourceIds: session.changedSourceIds,
    patches: preview?.patches.map(patch => ({ oldSpan: patch.newSpan, newSpan: patch.oldSpan,
      replacement: session.baseSource.slice(patch.oldSpan.from, patch.oldSpan.to) })),
    identityMoves: preview?.identityMoves?.map(move => ({ oldSpan: move.newSpan, newSpan: move.oldSpan })) });
  trackDocumentEdit(session, getState());
  return session.latestSource === session.baseSource;
}
