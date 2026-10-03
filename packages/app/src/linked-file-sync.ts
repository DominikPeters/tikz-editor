import type { DocumentFileRef, DocumentSession, ExternalChangeStatus, FileRevision } from "./store/types";

export type LinkedTextReadResult =
  | { status: "ok"; source: string; revision: FileRevision; fileRef: DocumentFileRef }
  | { status: "missing" }
  | { status: "permission-needed" }
  | { status: "failed"; reason?: string };

export type LinkedTextWriteResult =
  | { status: "saved"; revision: FileRevision; fileRef: DocumentFileRef }
  | { status: "changed-on-disk"; source: string; revision: FileRevision; fileRef: DocumentFileRef }
  | { status: "missing" }
  | { status: "permission-needed" }
  | { status: "failed"; reason?: string };

export type LinkedFileRefreshDecision =
  | { kind: "no-change" }
  | { kind: "reload"; source: string; revision: FileRevision; fileRef: DocumentFileRef }
  | {
      kind: "mark-status";
      externalChangeStatus: ExternalChangeStatus;
      revision?: FileRevision | null;
      source?: string | null;
    };

export function hashTextForRevision(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function revisionForText(text: string, metadata: { mtimeMs?: number; size?: number } = {}): FileRevision {
  return {
    ...metadata,
    hash: hashTextForRevision(text)
  };
}

export function revisionsMatch(left: FileRevision | null | undefined, right: FileRevision | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return left.hash === right.hash && left.mtimeMs === right.mtimeMs && left.size === right.size;
}

export function isLinkedFileRef(fileRef: DocumentFileRef | null | undefined): fileRef is DocumentFileRef {
  return fileRef?.provider === "desktop-fs" || (fileRef?.kind === "browser-file" && fileRef.provider === "browser-fsa");
}

/** File ownership ignores presentation names for handles/paths that identify a file. */
export function sameDocumentFileRef(left: DocumentFileRef | null, right: DocumentFileRef | null): boolean {
  if (!left || !right) return left === right;
  return left.kind === right.kind && left.provider === right.provider &&
    left.handleId === right.handleId && left.path === right.path &&
    (left.handleId != null || left.path != null || left.name === right.name);
}

export function decideLinkedFileRefresh(doc: DocumentSession, readResult: LinkedTextReadResult): LinkedFileRefreshDecision {
  if (!isLinkedFileRef(doc.fileRef)) {
    return { kind: "no-change" };
  }

  if (readResult.status === "missing") {
    return { kind: "mark-status", externalChangeStatus: "missing" };
  }
  if (readResult.status === "permission-needed") {
    return { kind: "mark-status", externalChangeStatus: "permission-needed" };
  }
  if (readResult.status === "failed") {
    return { kind: "mark-status", externalChangeStatus: "error" };
  }

  const diskChanged =
    doc.lastKnownDiskSource != null
      ? readResult.source !== doc.lastKnownDiskSource
      : !revisionsMatch(doc.diskRevision, readResult.revision);
  if (!diskChanged) {
    if (doc.externalChangeStatus === "changed" && doc.dirty) {
      return { kind: "no-change" };
    }
    if (doc.externalChangeStatus === "none") {
      return { kind: "no-change" };
    }
    return {
      kind: "mark-status",
      externalChangeStatus: "none",
      revision: readResult.revision,
      source: readResult.source
    };
  }

  if (!doc.dirty) {
    return {
      kind: "reload",
      source: readResult.source,
      revision: readResult.revision,
      fileRef: readResult.fileRef
    };
  }

  return {
    kind: "mark-status",
    externalChangeStatus: "changed",
    revision: readResult.revision,
    source: readResult.source
  };
}
