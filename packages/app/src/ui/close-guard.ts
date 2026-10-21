import type { DocumentSessions } from "../store/types";

export type CloseIntent =
  | { kind: "close-document"; documentId: string }
  | { kind: "close-all" }
  | { kind: "window-close" };

export type SaveStatus = "saved" | "cancelled" | "failed";

export function collectDirtyDocumentIdsForIntent(
  intent: CloseIntent,
  documents: DocumentSessions,
  tabOrder: string[]
): string[] {
  if (intent.kind === "close-document") {
    const doc = documents[intent.documentId];
    return doc?.dirty ? [intent.documentId] : [];
  }
  return tabOrder.filter((id) => documents[id]?.dirty);
}

export function summarizeSaveStatuses(statuses: SaveStatus[]): SaveStatus {
  if (statuses.includes("failed")) {
    return "failed";
  }
  if (statuses.includes("cancelled")) {
    return "cancelled";
  }
  return "saved";
}
