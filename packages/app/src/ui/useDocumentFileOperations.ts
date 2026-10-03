import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { getActiveEditorPlatform } from "../platform/current";
import { useEditorStore } from "../store/store";
import { decideLinkedFileRefresh, isLinkedFileRef, sameDocumentFileRef, type LinkedTextWriteResult } from "../linked-file-sync";
import type { DocumentFileRef, DocumentSession, EditorAction } from "../store/types";
import type { FileConflictDecision } from "./FileConflictModal";

type SaveMode = "save" | "save-as";
type PendingConflict = {
  documentId: string;
  title: string;
  fileRef: DocumentFileRef | null;
  resolve: (decision: FileConflictDecision) => void;
};
type SaveRequest = {
  mode: SaveMode;
  source: string;
  fileRef: DocumentFileRef | null;
  promise: Promise<boolean>;
};

export function useDocumentFileOperations({ dispatch, showMessage }: {
  dispatch: (action: EditorAction) => void;
  showMessage: (title: string, message: string, kind?: "info" | "warning" | "error") => Promise<void>;
}) {
  const [conflicts, setConflicts] = useState<PendingConflict[]>([]);
  const conflictsRef = useRef<PendingConflict[]>([]);
  const savesRef = useRef(new Map<string, SaveRequest>());
  const readsRef = useRef(new Map<string, { fileRef: DocumentFileRef }>());
  const activeRef = useRef(true);

  useLayoutEffect(() => {
    activeRef.current = true;
    const reads = readsRef.current;
    const unsubscribe = useEditorStore.subscribe((state) => {
      for (const [id, read] of readsRef.current) {
        if (!sameDocumentFileRef(state.documents[id]?.fileRef ?? null, read.fileRef)) {
          readsRef.current.delete(id);
        }
      }
      for (const conflict of conflictsRef.current) {
        const doc = state.documents[conflict.documentId];
        if (!doc || !sameDocumentFileRef(doc.fileRef, conflict.fileRef)) conflict.resolve("cancel");
      }
    });
    return () => {
      activeRef.current = false;
      unsubscribe();
      reads.clear();
      for (const conflict of conflictsRef.current) conflict.resolve("cancel");
    };
  }, []);

  const readLinkedDocument = useCallback(async (
    doc: DocumentSession, reason: "restore" | "focus" | "tab" | "save", duringSave = false
  ): Promise<void> => {
    const readLinkedText = getActiveEditorPlatform().files?.readLinkedText;
    if (!doc.fileRef || !isLinkedFileRef(doc.fileRef) || !readLinkedText ||
        (!duringSave && savesRef.current.has(doc.id))) return;
    const request = { fileRef: doc.fileRef };
    readsRef.current.set(doc.id, request);
    const currentOwner = () => {
      const current = useEditorStore.getState().documents[doc.id];
      return activeRef.current && readsRef.current.get(doc.id) === request && current &&
        sameDocumentFileRef(current.fileRef, request.fileRef) ? current : null;
    };
    try {
      const result = await readLinkedText(request.fileRef);
      const current = currentOwner();
      if (!current) return;
      const decision = decideLinkedFileRefresh(current, result);
      if (decision.kind === "reload") {
        dispatch({ type: "REPLACE_DOCUMENT_SOURCE_FROM_DISK", documentId: doc.id,
          source: decision.source, fileRef: decision.fileRef, diskRevision: decision.revision });
      } else if (decision.kind === "mark-status") {
        dispatch({ type: "SET_DOCUMENT_LINKED_FILE_STATUS", documentId: doc.id,
          externalChangeStatus: decision.externalChangeStatus,
          diskRevision: decision.externalChangeStatus === "changed" ? undefined : decision.revision,
          lastKnownDiskSource: decision.externalChangeStatus === "changed" ? undefined : decision.source });
      } else if (duringSave && result.status === "ok" && result.source === current.lastKnownDiskSource) {
        // Save As adopts a new binding before this read; initialize only its disk metadata.
        dispatch({ type: "SET_DOCUMENT_LINKED_FILE_STATUS", documentId: doc.id,
          externalChangeStatus: "none", diskRevision: result.revision, lastKnownDiskSource: result.source });
      }
    } catch (error) {
      if (!currentOwner()) return;
      console.info(`[tikz-editor] Linked file ${reason} check failed.`, error);
      dispatch({ type: "SET_DOCUMENT_LINKED_FILE_STATUS", documentId: doc.id, externalChangeStatus: "error" });
    } finally {
      if (readsRef.current.get(doc.id) === request) readsRef.current.delete(doc.id);
    }
  }, [dispatch]);

  const applyLinkedReadDecision = useCallback((doc: DocumentSession, reason: "restore" | "focus" | "tab" | "save") => {
    void readLinkedDocument(doc, reason);
  }, [readLinkedDocument]);

  const requestConflictDecision = useCallback((doc: DocumentSession): Promise<FileConflictDecision> => {
    return new Promise((finish) => {
      let settled = false;
      const conflict: PendingConflict = {
        documentId: doc.id, title: doc.title, fileRef: doc.fileRef,
        resolve: (decision) => {
          if (settled) return;
          settled = true;
          conflictsRef.current = conflictsRef.current.filter((entry) => entry !== conflict);
          if (activeRef.current) setConflicts(conflictsRef.current);
          finish(decision);
        }
      };
      conflictsRef.current = [...conflictsRef.current, conflict];
      setConflicts(conflictsRef.current);
    });
  }, []);

  const performSave = useCallback(async function performSave(
    documentId: string, mode: SaveMode, forceOverwrite = false
  ): Promise<boolean> {
    const doc = useEditorStore.getState().documents[documentId];
    const files = getActiveEditorPlatform().files;
    if (!activeRef.current || !doc || !files?.saveText) return false;
    // A refresh started before this write cannot overwrite its eventual baseline.
    readsRef.current.delete(documentId);
    const stillOwnsBinding = () => {
      const current = useEditorStore.getState().documents[documentId];
      return activeRef.current && current && sameDocumentFileRef(current.fileRef, doc.fileRef) ? current : null;
    };
    try {
      if (mode === "save" && doc.fileRef && isLinkedFileRef(doc.fileRef) && files.writeLinkedText) {
        const result: LinkedTextWriteResult = await files.writeLinkedText(doc.fileRef, doc.source,
          forceOverwrite ? null : doc.diskRevision);
        if (!stillOwnsBinding()) return false;
        if (result.status === "saved") {
          dispatch({ type: "MARK_DOCUMENT_SAVED", documentId, savedSource: doc.source,
            fileRef: result.fileRef, diskRevision: result.revision, lastKnownDiskSource: doc.source });
          return true;
        }
        if (result.status === "changed-on-disk") {
          dispatch({ type: "SET_DOCUMENT_LINKED_FILE_STATUS", documentId, externalChangeStatus: "changed" });
          const decision = await requestConflictDecision(doc);
          const current = stillOwnsBinding();
          if (!current) return false;
          if (decision === "reload") {
            if (current.sourceRevision !== doc.sourceRevision) {
              await showMessage("File Changed on Disk", "The document was edited while the conflict dialog was open. Its newer edits were kept.", "warning");
              return false;
            }
            dispatch({ type: "REPLACE_DOCUMENT_SOURCE_FROM_DISK", documentId,
              source: result.source, fileRef: result.fileRef, diskRevision: result.revision });
          } else if (decision === "save-anyway") {
            return await performSave(documentId, "save", true);
          } else if (decision === "save-as") {
            return await performSave(documentId, "save-as");
          }
          return false;
        }
        const status = result.status === "missing" || result.status === "permission-needed" ? result.status : "error";
        dispatch({ type: "SET_DOCUMENT_LINKED_FILE_STATUS", documentId, externalChangeStatus: status });
        if (result.status === "failed") await showMessage("Save Failed", result.reason ?? "Could not save the linked file.", "error");
        return false;
      }

      const result = await files.saveText(doc.source, { mode, fileRef: doc.fileRef,
        suggestedName: doc.fileRef?.name ?? "tikz-document.tex" });
      if (!stillOwnsBinding()) return false;
      if (result.status === "saved") {
        dispatch({ type: "MARK_DOCUMENT_SAVED", documentId, savedSource: doc.source,
          fileRef: result.fileRef, diskRevision: null, lastKnownDiskSource: doc.source });
        const current = useEditorStore.getState().documents[documentId];
        if (current) await readLinkedDocument(current, "save", true);
        return activeRef.current && !!useEditorStore.getState().documents[documentId];
      }
      if (result.status === "failed") await showMessage("Save Failed", result.reason ?? "Save failed.", "error");
      return false;
    } catch (error) {
      if (stillOwnsBinding()) await showMessage("Save Failed", error instanceof Error ? error.message : "Save failed.", "error");
      return false;
    }
  }, [dispatch, readLinkedDocument, requestConflictDecision, showMessage]);

  const saveDocument = useCallback((documentId: string, mode: SaveMode): Promise<boolean> => {
    const doc = useEditorStore.getState().documents[documentId];
    if (!doc || !activeRef.current) return Promise.resolve(false);
    const previous = savesRef.current.get(documentId);
    if (previous?.mode === mode && previous.source === doc.source &&
        sameDocumentFileRef(previous.fileRef, doc.fileRef)) return previous.promise;
    // A queued save captures current contents when it actually reaches the writer.
    const run = () => performSave(documentId, mode);
    const promise = previous ? previous.promise.then(run, run) : run();
    const request = { mode, source: doc.source, fileRef: doc.fileRef, promise };
    savesRef.current.set(documentId, request);
    const cleanup = () => {
      if (savesRef.current.get(documentId) === request) savesRef.current.delete(documentId);
    };
    void promise.then(cleanup, cleanup);
    return promise;
  }, [performSave]);

  return { applyLinkedReadDecision, saveDocument, pendingFileConflict: conflicts[0] ?? null };
}
