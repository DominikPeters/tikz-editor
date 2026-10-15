import type { DocumentSession, DocumentSessions, WorkspacePersistedState } from "./types";

/** Use only where the caller requires an existing session, such as the active document. */
export function requireDocumentSession(documents: DocumentSessions, documentId: string): DocumentSession {
  const document = documents[documentId];
  if (!document) throw new Error(`Missing document session: ${documentId}`);
  return document;
}

export function getActiveDocument(state: Pick<WorkspacePersistedState, "documents" | "activeDocumentId">): DocumentSession {
  return requireDocumentSession(state.documents, state.activeDocumentId);
}

export function listDocumentSessions(documents: DocumentSessions): DocumentSession[] {
  return Object.values(documents).filter((document): document is DocumentSession => document !== undefined);
}
