import { create } from "zustand";
import { editorReducer, makeInitialState } from "./reducer";
import type { DocumentFileRef, DocumentSession, EditorAction, EditorState, WorkspacePersistedState } from "./types";
import { loadWorkspaceSeed, saveWorkspace } from "./workspace-storage";
import { workspaceStateFromEditorState } from "./workspace-state";
import { claimCachedDeckSnapshot, cancelDeckPrewarm } from "../compute";
import { rootKey } from "../root-key";

const HIGH_FREQUENCY_WORKSPACE_SAVE_DELAY_MS = 1000;

export type EditorStore = EditorState & {
  dispatch: (action: EditorAction) => void;
};

export const useEditorStore = create<EditorStore>((set) => ({
  ...makeInitialState(loadWorkspaceSeed() ?? undefined),
  dispatch: (action: EditorAction) => { set((state) => {
    let next = editorReducer(state, action);
    if (next.source !== state.source || next.activeDocumentId !== state.activeDocumentId ||
      next.activeRootId !== state.activeRootId || next.deckStepByRootKey !== state.deckStepByRootKey ||
      next.activeCanvasDragKind != null || next.activeSourceScrubSourceId != null ||
      next.activeCanvasTextEditSourceId != null || next.activeInspectorEditDocumentId != null) cancelDeckPrewarm();
    const navigated = next.activeDocumentId !== state.activeDocumentId || next.activeRootId !== state.activeRootId ||
      (next.deckStepByRootKey[rootKey(next.activeDocumentId, next.activeRootId)] ?? 1) !==
      (state.deckStepByRootKey[rootKey(state.activeDocumentId, state.activeRootId)] ?? 1);
    if ((action.type === "SET_ACTIVE_ROOT" || action.type === "SELECT_DECK_SLIDES" || action.type === "SET_DECK_STEP" ||
      action.type === "SWITCH_DOCUMENT") && navigated && next.documentKind === "beamer" &&
      next.activeCanvasDragKind == null && next.activeSourceScrubSourceId == null &&
      next.activeCanvasTextEditSourceId == null && next.activeInspectorEditDocumentId == null) {
      const requestId = crypto.randomUUID();
      const doc = next.documents[next.activeDocumentId];
      const snapshot = claimCachedDeckSnapshot({ id: requestId, documentId: doc.id, source: doc.source,
        sourceRevision: doc.sourceRevision, documentFileRef: doc.fileRef, activeRootId: doc.activeRootId,
        deckStep: next.deckStepByRootKey[rootKey(doc.id, doc.activeRootId)] ?? 1,
        schedulingTrigger: action.type === "SET_DECK_STEP" ? "overlay-step" : action.type === "SWITCH_DOCUMENT" ? "document-switch" : "root-switch" });
      if (snapshot) {
        // These reducers run within one Zustand update: no observer can see
        // the new root paired with the old frame's SVG or editing geometry.
        next = editorReducer(next, { type: "COMPUTE_REQUESTED", requestId, documentId: doc.id });
        next = editorReducer(next, { type: "SNAPSHOT_READY", requestId, documentId: doc.id, snapshot });
      }
    }
    if (shouldSaveWorkspace(state, next)) {
      const workspaceState = workspaceStateFromEditorState(next);
      if (shouldDebounceWorkspaceSave(action, state, next)) {
        scheduleWorkspaceSave(workspaceState);
      } else {
        persistWorkspaceNow(workspaceState);
      }
    }
    return next;
  }); }
}));

function shouldSaveWorkspace(previous: EditorState, next: EditorState): boolean {
  return (
    previous.workspaceVersion !== next.workspaceVersion ||
    previous.tabOrder !== next.tabOrder ||
    previous.activeDocumentId !== next.activeDocumentId ||
    previous.recentDocumentIds !== next.recentDocumentIds ||
    persistedDocumentsChanged(previous.documents, next.documents)
  );
}

function shouldDebounceWorkspaceSave(action: EditorAction, previous: EditorState, next: EditorState): boolean {
  if (action.type === "CODE_EDITED" || action.type === "SET_SOURCE_TRANSIENT") {
    return true;
  }
  if (action.type === "APPLY_EDIT_ACTION") {
    return (
      action.recordInHistory === false ||
      action.parseOptions?.propertyWriteMode === "drag-frame" ||
      action.parseOptions?.propertyWriteMode === "drag-end" ||
      previous.activeCanvasDragKind != null ||
      next.activeCanvasDragKind != null ||
      previous.activeSourceScrubSourceId != null ||
      next.activeSourceScrubSourceId != null
    );
  }
  return false;
}

function persistedDocumentsChanged(
  previous: Record<string, DocumentSession>,
  next: Record<string, DocumentSession>
): boolean {
  const previousIds = Object.keys(previous);
  const nextIds = Object.keys(next);
  if (previousIds.length !== nextIds.length) {
    return true;
  }
  for (const id of nextIds) {
    const previousDoc = (previous as Partial<Record<string, DocumentSession>>)[id];
    const nextDoc = (next as Partial<Record<string, DocumentSession>>)[id];
    if (!previousDoc || !nextDoc || persistedDocumentChanged(previousDoc, nextDoc)) {
      return true;
    }
  }
  return false;
}

function persistedDocumentChanged(previous: DocumentSession, next: DocumentSession): boolean {
  return (
    previous.id !== next.id ||
    previous.title !== next.title ||
    previous.source !== next.source ||
    previous.activeRootId !== next.activeRootId ||
    previous.savedSource !== next.savedSource ||
    fileRefChanged(previous.fileRef, next.fileRef) ||
    fileRevisionChanged(previous.diskRevision, next.diskRevision) ||
    previous.lastKnownDiskSource !== next.lastKnownDiskSource ||
    previous.externalChangeStatus !== next.externalChangeStatus ||
    previous.assistantThreadId !== next.assistantThreadId ||
    previous.assistantWorkspacePath !== next.assistantWorkspacePath ||
    previous.assistantFigurePath !== next.assistantFigurePath ||
    previous.assistantPreviewPath !== next.assistantPreviewPath
  );
}

function fileRefChanged(previous: DocumentFileRef | null, next: DocumentFileRef | null): boolean {
  if (previous === next) {
    return false;
  }
  if (!previous || !next) {
    return true;
  }
  return (
    previous.kind !== next.kind ||
    previous.name !== next.name ||
    previous.handleId !== next.handleId ||
    previous.path !== next.path ||
    previous.provider !== next.provider
  );
}

function fileRevisionChanged(
  previous: DocumentSession["diskRevision"],
  next: DocumentSession["diskRevision"]
): boolean {
  if (previous === next) {
    return false;
  }
  if (!previous || !next) {
    return true;
  }
  return previous.hash !== next.hash || previous.mtimeMs !== next.mtimeMs || previous.size !== next.size;
}

let pendingWorkspaceSaveState: WorkspacePersistedState | null = null;
let pendingWorkspaceSaveTimer: number | null = null;
let hasBeforeUnloadSaveHandler = false;

function persistWorkspaceNow(state: WorkspacePersistedState): void {
  clearPendingWorkspaceSaveTimer();
  pendingWorkspaceSaveState = null;
  saveWorkspace(state);
}

function scheduleWorkspaceSave(state: WorkspacePersistedState): void {
  if (typeof window === "undefined") {
    saveWorkspace(state);
    return;
  }
  pendingWorkspaceSaveState = state;
  ensureBeforeUnloadSaveHandler();
  clearPendingWorkspaceSaveTimer();
  pendingWorkspaceSaveTimer = window.setTimeout(flushPendingWorkspaceSave, HIGH_FREQUENCY_WORKSPACE_SAVE_DELAY_MS);
}

export function flushPendingWorkspaceSave(): void {
  const state = pendingWorkspaceSaveState;
  clearPendingWorkspaceSaveTimer();
  pendingWorkspaceSaveState = null;
  if (state) {
    saveWorkspace(state);
  }
}

function clearPendingWorkspaceSaveTimer(): void {
  if (pendingWorkspaceSaveTimer == null) {
    return;
  }
  if (typeof window !== "undefined") {
    window.clearTimeout(pendingWorkspaceSaveTimer);
  }
  pendingWorkspaceSaveTimer = null;
}

function ensureBeforeUnloadSaveHandler(): void {
  if (hasBeforeUnloadSaveHandler || typeof window === "undefined") {
    return;
  }
  window.addEventListener("beforeunload", flushPendingWorkspaceSave);
  window.addEventListener("pagehide", flushPendingWorkspaceSave);
  hasBeforeUnloadSaveHandler = true;
}
