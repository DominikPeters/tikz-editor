import { applyEditAction } from "tikz-editor/edit/actions";
import type { EditActionResult } from "tikz-editor/edit/actions";
import type {
  CanvasTransform,
  DocumentFileRef,
  DocumentSession,
  EditorAction,
  EditorState,
  HistoryEntry,
  WorkspaceEphemeralState,
  WorkspacePersistedState
} from "./types";
import { makeEmptySnapshot } from "../compute";
import type { AssistantItem } from "../platform/types";
import { deriveSingleSourcePatch } from "./source-patch-diff";

export const DEFAULT_SOURCE = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \draw (-3,-3) rectangle (3,3);

  \draw (-2.5, 2.5) -- (2.5, 2.5);

  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1.5, -0.5) {B};
  \node[draw] (C) at (0, 1.5) {C};
  \draw (A) edge (B)
        (B) edge (C)
        (C) edge (A);
\end{tikzpicture}`;

const WORKSPACE_VERSION = 3;
export { WORKSPACE_VERSION };
const FREEHAND_SMOOTHING_MIN_PX = 4;
const FREEHAND_SMOOTHING_MAX_PX = 32;
const DEFAULT_FREEHAND_SMOOTHING_PX = 16;
const DEFAULT_BUCKET_FILL_COLOR = "blue!60";
const DEFAULT_ADD_SHAPE_PRESET = "rectangle";
const DEFAULT_ADD_MATRIX_ROWS = 2;
const DEFAULT_ADD_MATRIX_COLUMNS = 2;
const DEFAULT_CREATION_STROKE_COLOR = "black";
const DEFAULT_CREATION_FILL_COLOR = "none";

export const DEFAULT_CANVAS_TRANSFORM: CanvasTransform = {
  translateX: 0,
  translateY: 0,
  scale: 1
};

function createDocumentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `doc-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function createDocumentSession(params: {
  source: string;
  title?: string;
  activeFigureId?: string | null;
  fileRef?: DocumentFileRef | null;
  assistantThreadId?: string | null;
  assistantWorkspacePath?: string | null;
  assistantFigurePath?: string | null;
  assistantPreviewPath?: string | null;
}): DocumentSession {
  const title = params.title?.trim() || "Untitled";
  return {
    id: createDocumentId(),
    title,
    source: params.source,
    sourceRevision: 0,
    activeFigureId: params.activeFigureId ?? null,
    hasInitializedFigureSelection: false,
    snapshot: makeEmptySnapshot(params.source),
    pendingRequestId: null,
    lastEditChangedSourceIds: null,
    lastEditChangeToken: 0,
    lastEditPatches: null,
    lastEditWarningMessage: null,
    lastEditWarningToken: 0,
    history: [],
    historyIndex: -1,
    selectedElementIds: new Set(),
    focusedScopeId: null,
    activeHandleId: null,
    fileRef: params.fileRef ?? null,
    savedSource: params.source,
    dirty: false,
    assistantThreadId: params.assistantThreadId ?? null,
    assistantWorkspacePath: params.assistantWorkspacePath ?? null,
    assistantFigurePath: params.assistantFigurePath ?? null,
    assistantPreviewPath: params.assistantPreviewPath ?? null,
    assistantItems: [],
    assistantPendingApprovals: [],
    assistantTurnStatus: "idle",
    assistantCurrentTurnId: null,
    assistantLockReason: null,
    assistantLastSourceRevision: null,
    assistantError: null
  };
}

function initialUiState(): WorkspaceEphemeralState {
  return {
    toolMode: "select",
    canvasTransform: DEFAULT_CANVAS_TRANSFORM,
    hoveredElementId: null,
    activeCanvasDragKind: null,
    activeSourceScrubSourceId: null,
    showGrid: true,
    showTransparencyGrid: false,
    snapModes: {
      grid: true,
      guides: true,
      points: true,
      gaps: true
    },
    showRulers: true,
    showGuides: true,
    showDocumentBounds: true,
    freehandSmoothingPx: DEFAULT_FREEHAND_SMOOTHING_PX,
    bucketFillColor: DEFAULT_BUCKET_FILL_COLOR,
    selectedAddShape: DEFAULT_ADD_SHAPE_PRESET,
    selectedAddMatrixRows: DEFAULT_ADD_MATRIX_ROWS,
    selectedAddMatrixColumns: DEFAULT_ADD_MATRIX_COLUMNS,
    creationStrokeColor: DEFAULT_CREATION_STROKE_COLOR,
    creationFillColor: DEFAULT_CREATION_FILL_COLOR,
    fitToContentRequestToken: 0,
    zoomRequestToken: 0,
    zoomRequestDirection: null,
    showSourcePanel: true,
    showInspectorPanel: true,
    showObjectsPanel: true,
    showStylesPanel: true,
    showFiguresPanel: false,
    showAssistantPanel: false,
    rightSidebarTab: "inspector",
    showDevPanel: false
  };
}

function initialWorkspaceState(): WorkspacePersistedState {
  const first = createDocumentSession({ source: DEFAULT_SOURCE, title: "Untitled 1" });
  return {
    workspaceVersion: WORKSPACE_VERSION,
    documents: { [first.id]: first },
    tabOrder: [first.id],
    activeDocumentId: first.id,
    recentDocumentIds: [first.id]
  };
}

export type WorkspaceSeedDocument = {
  id: string;
  title: string;
  source: string;
  activeFigureId?: string | null;
  savedSource?: string;
  fileRef?: DocumentFileRef | null;
  assistantThreadId?: string | null;
  assistantWorkspacePath?: string | null;
  assistantFigurePath?: string | null;
  assistantPreviewPath?: string | null;
};

export type WorkspaceSeed = {
  workspaceVersion: number;
  documents: WorkspaceSeedDocument[];
  tabOrder: string[];
  activeDocumentId: string;
  recentDocumentIds: string[];
};

function initialWorkspaceStateFromSeed(seed: WorkspaceSeed): WorkspacePersistedState {
  const docs: Record<string, DocumentSession> = {};
  for (const raw of seed.documents) {
    const doc = createDocumentSession({
      source: raw.source,
      title: raw.title,
      activeFigureId: raw.activeFigureId ?? null,
      fileRef: raw.fileRef ?? null,
      assistantThreadId: raw.assistantThreadId ?? null,
      assistantWorkspacePath: raw.assistantWorkspacePath ?? null,
      assistantFigurePath: raw.assistantFigurePath ?? null,
      assistantPreviewPath: raw.assistantPreviewPath ?? null
    });
    doc.id = raw.id;
    doc.savedSource = raw.savedSource ?? raw.source;
    doc.dirty = doc.source !== doc.savedSource;
    docs[doc.id] = doc;
  }

  const tabOrder = seed.tabOrder.filter((id) => docs[id]);
  const fallbackOrder = tabOrder.length > 0 ? tabOrder : Object.keys(docs);
  if (fallbackOrder.length === 0) {
    return initialWorkspaceState();
  }
  const activeDocumentId = docs[seed.activeDocumentId] ? seed.activeDocumentId : fallbackOrder[0]!;
  const seededRecents = seed.recentDocumentIds.filter((id) => docs[id]);
  const normalizedRecents = seededRecents.length > 0 ? seededRecents : [activeDocumentId];
  return {
    workspaceVersion: WORKSPACE_VERSION,
    documents: docs,
    tabOrder: fallbackOrder,
    activeDocumentId,
    recentDocumentIds: normalizedRecents
  };
}

function resolveActiveDocument(workspace: WorkspacePersistedState): DocumentSession {
  const active = workspace.documents[workspace.activeDocumentId];
  if (active) {
    return active;
  }
  const fallbackId = workspace.tabOrder[0];
  if (fallbackId && workspace.documents[fallbackId]) {
    return workspace.documents[fallbackId]!;
  }
  const created = createDocumentSession({ source: DEFAULT_SOURCE, title: "Untitled 1" });
  workspace.documents[created.id] = created;
  workspace.tabOrder = [created.id];
  workspace.activeDocumentId = created.id;
  return created;
}

function projectState(workspace: WorkspacePersistedState, ui: WorkspaceEphemeralState): EditorState {
  const active = resolveActiveDocument(workspace);
  return {
    source: active.source,
    sourceRevision: active.sourceRevision,
    activeFigureId: active.activeFigureId,
    snapshot: active.snapshot,
    pendingRequestId: active.pendingRequestId,
    lastEditChangedSourceIds: active.lastEditChangedSourceIds,
    lastEditChangeToken: active.lastEditChangeToken,
    lastEditPatches: active.lastEditPatches,
    lastEditWarningMessage: active.lastEditWarningMessage,
    lastEditWarningToken: active.lastEditWarningToken,
    history: active.history,
    historyIndex: active.historyIndex,
    selectedElementIds: active.selectedElementIds,
    focusedScopeId: active.focusedScopeId,
    activeHandleId: active.activeHandleId,
    activeDocumentId: workspace.activeDocumentId,
    tabOrder: workspace.tabOrder,
    documents: workspace.documents,
    workspaceVersion: workspace.workspaceVersion,
    recentDocumentIds: workspace.recentDocumentIds,
    toolMode: ui.toolMode,
    canvasTransform: ui.canvasTransform,
    hoveredElementId: ui.hoveredElementId,
    activeCanvasDragKind: ui.activeCanvasDragKind,
    activeSourceScrubSourceId: ui.activeSourceScrubSourceId,
    showGrid: ui.showGrid,
    showTransparencyGrid: ui.showTransparencyGrid,
    snapModes: ui.snapModes,
    showRulers: ui.showRulers,
    showGuides: ui.showGuides,
    showDocumentBounds: ui.showDocumentBounds,
    freehandSmoothingPx: ui.freehandSmoothingPx,
    bucketFillColor: ui.bucketFillColor,
    selectedAddShape: ui.selectedAddShape,
    selectedAddMatrixRows: ui.selectedAddMatrixRows,
    selectedAddMatrixColumns: ui.selectedAddMatrixColumns,
    creationStrokeColor: ui.creationStrokeColor,
    creationFillColor: ui.creationFillColor,
    fitToContentRequestToken: ui.fitToContentRequestToken,
    zoomRequestToken: ui.zoomRequestToken,
    zoomRequestDirection: ui.zoomRequestDirection,
    showSourcePanel: ui.showSourcePanel,
    showInspectorPanel: ui.showInspectorPanel,
    showObjectsPanel: ui.showObjectsPanel,
    showStylesPanel: ui.showStylesPanel,
    showFiguresPanel: ui.showFiguresPanel,
    showAssistantPanel: ui.showAssistantPanel,
    rightSidebarTab: ui.rightSidebarTab,
    showDevPanel: ui.showDevPanel
  };
}

function workspaceStateFromEditorState(state: EditorState): WorkspacePersistedState {
  return {
    workspaceVersion: state.workspaceVersion,
    documents: state.documents,
    tabOrder: state.tabOrder,
    activeDocumentId: state.activeDocumentId,
    recentDocumentIds: state.recentDocumentIds
  };
}

function uiStateFromEditorState(state: EditorState): WorkspaceEphemeralState {
  return {
    toolMode: state.toolMode,
    canvasTransform: state.canvasTransform,
    hoveredElementId: state.hoveredElementId,
    activeCanvasDragKind: state.activeCanvasDragKind,
    activeSourceScrubSourceId: state.activeSourceScrubSourceId,
    showGrid: state.showGrid,
    showTransparencyGrid: state.showTransparencyGrid,
    snapModes: state.snapModes,
    showRulers: state.showRulers,
    showGuides: state.showGuides,
    showDocumentBounds: state.showDocumentBounds,
    freehandSmoothingPx: state.freehandSmoothingPx,
    bucketFillColor: state.bucketFillColor,
    selectedAddShape: state.selectedAddShape,
    selectedAddMatrixRows: state.selectedAddMatrixRows,
    selectedAddMatrixColumns: state.selectedAddMatrixColumns,
    creationStrokeColor: state.creationStrokeColor,
    creationFillColor: state.creationFillColor,
    fitToContentRequestToken: state.fitToContentRequestToken,
    zoomRequestToken: state.zoomRequestToken,
    zoomRequestDirection: state.zoomRequestDirection,
    showSourcePanel: state.showSourcePanel,
    showInspectorPanel: state.showInspectorPanel,
    showObjectsPanel: state.showObjectsPanel,
    showStylesPanel: state.showStylesPanel,
    showFiguresPanel: state.showFiguresPanel,
    showAssistantPanel: state.showAssistantPanel,
    rightSidebarTab: state.rightSidebarTab,
    showDevPanel: state.showDevPanel
  };
}

function actionLabel(kind: HistoryEntry["kind"]): string {
  switch (kind) {
    case "move": return "Moved element";
    case "move-handle": return "Edited handle";
    case "path-edit": return "Edited path";
    case "set-property": return "Changed property";
    case "add-element": return "Added element";
    case "delete": return "Deleted element";
    case "resize": return "Resized element";
    case "reorder": return "Reordered elements";
    case "align": return "Aligned elements";
    case "distribute": return "Distributed elements";
  }
}

function applyEditWarningToDocument(doc: DocumentSession, message: string | null): DocumentSession {
  const shouldEmit = message != null;
  const shouldClear = message == null && doc.lastEditWarningMessage != null;
  if (!shouldEmit && !shouldClear) {
    return doc;
  }
  return {
    ...doc,
    lastEditWarningMessage: message,
    lastEditWarningToken: doc.lastEditWarningToken + 1
  };
}

function updateDocument(
  workspace: WorkspacePersistedState,
  documentId: string,
  updater: (doc: DocumentSession) => DocumentSession
): WorkspacePersistedState {
  const current = workspace.documents[documentId];
  if (!current) {
    return workspace;
  }
  const next = updater(current);
  if (next === current) {
    return workspace;
  }
  return {
    ...workspace,
    documents: {
      ...workspace.documents,
      [documentId]: next
    }
  };
}

function rememberRecentDocument(workspace: WorkspacePersistedState, documentId: string): WorkspacePersistedState {
  if (!workspace.documents[documentId]) {
    return workspace;
  }
  const nextRecents = [
    documentId,
    ...workspace.recentDocumentIds.filter((id) => id !== documentId && workspace.documents[id])
  ].slice(0, 24);
  return {
    ...workspace,
    recentDocumentIds: nextRecents
  };
}

function activeDocumentIdFromAction(state: EditorState, documentId?: string): string {
  return documentId ?? state.activeDocumentId;
}

function mergeAssistantItem(items: AssistantItem[], nextItem: AssistantItem): AssistantItem[] {
  const index = items.findIndex((item) => item.id === nextItem.id);
  if (index < 0) {
    return [...items, nextItem];
  }
  const merged = [...items];
  merged[index] = { ...merged[index], ...nextItem };
  return merged;
}

function appendAssistantDelta(item: AssistantItem, deltaType: string, delta: string): AssistantItem {
  if (item.type === "agentMessage" && deltaType === "item/agentMessage/delta") {
    return { ...item, text: `${item.text ?? ""}${delta}` };
  }
  if (item.type === "plan" && deltaType === "item/plan/delta") {
    return { ...item, text: `${item.text ?? ""}${delta}` };
  }
  if (item.type === "reasoning") {
    if (deltaType === "item/reasoning/summaryTextDelta") {
      return { ...item, summary: `${item.summary ?? ""}${delta}` };
    }
    if (deltaType === "item/reasoning/textDelta") {
      return { ...item, content: `${item.content ?? ""}${delta}` };
    }
  }
  if (item.type === "commandExecution" && deltaType === "item/commandExecution/outputDelta") {
    return { ...item, aggregatedOutput: `${item.aggregatedOutput ?? ""}${delta}` };
  }
  return item;
}

export function makeInitialState(seed?: WorkspaceSeed): EditorState {
  const workspace = seed ? initialWorkspaceStateFromSeed(seed) : initialWorkspaceState();
  return projectState(workspace, initialUiState());
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const previousWorkspace = workspaceStateFromEditorState(state);
  const previousUi = uiStateFromEditorState(state);
  let workspace = previousWorkspace;
  let ui = previousUi;
  const activeId = state.activeDocumentId;

  const projectedActive = workspace.documents[activeId];
  if (
    projectedActive &&
    (
      projectedActive.source !== state.source ||
      projectedActive.activeFigureId !== state.activeFigureId ||
      projectedActive.snapshot !== state.snapshot ||
      projectedActive.pendingRequestId !== state.pendingRequestId ||
      projectedActive.lastEditChangedSourceIds !== state.lastEditChangedSourceIds ||
      projectedActive.lastEditChangeToken !== state.lastEditChangeToken ||
      projectedActive.lastEditPatches !== state.lastEditPatches ||
      projectedActive.lastEditWarningMessage !== state.lastEditWarningMessage ||
      projectedActive.lastEditWarningToken !== state.lastEditWarningToken ||
      projectedActive.history !== state.history ||
      projectedActive.historyIndex !== state.historyIndex ||
      projectedActive.selectedElementIds !== state.selectedElementIds ||
      projectedActive.focusedScopeId !== state.focusedScopeId ||
      projectedActive.activeHandleId !== state.activeHandleId
    )
  ) {
    workspace = updateDocument(workspace, activeId, (doc) => ({
      ...doc,
      source: state.source,
      activeFigureId: state.activeFigureId,
      snapshot: state.snapshot,
      pendingRequestId: state.pendingRequestId,
      lastEditChangedSourceIds: state.lastEditChangedSourceIds,
      lastEditChangeToken: state.lastEditChangeToken,
      lastEditPatches: state.lastEditPatches,
      lastEditWarningMessage: state.lastEditWarningMessage,
      lastEditWarningToken: state.lastEditWarningToken,
      history: state.history,
      historyIndex: state.historyIndex,
      selectedElementIds: state.selectedElementIds,
      focusedScopeId: state.focusedScopeId,
      activeHandleId: state.activeHandleId
    }));
  }

  switch (action.type) {
    case "NEW_DOCUMENT": {
      const untitledCount = Object.values(workspace.documents).filter((doc) => doc.fileRef == null).length + 1;
      const next = createDocumentSession({
        source: action.source ?? DEFAULT_SOURCE,
        title: action.title ?? `Untitled ${untitledCount}`
      });
      workspace = {
        ...workspace,
        documents: { ...workspace.documents, [next.id]: next },
        tabOrder: [...workspace.tabOrder, next.id],
        activeDocumentId: next.id
      };
      workspace = rememberRecentDocument(workspace, next.id);
      break;
    }

    case "SWITCH_DOCUMENT": {
      if (!workspace.documents[action.documentId]) {
        return state;
      }
      workspace = {
        ...workspace,
        activeDocumentId: action.documentId
      };
      workspace = rememberRecentDocument(workspace, action.documentId);
      break;
    }

    case "SET_ACTIVE_FIGURE": {
      const documentId = activeDocumentIdFromAction(state, action.documentId);
      workspace = updateDocument(workspace, documentId, (doc) =>
        doc.activeFigureId === action.figureId
          ? doc
          : {
              ...doc,
              activeFigureId: action.figureId,
              hasInitializedFigureSelection: true
            }
      );
      break;
    }

    case "REORDER_TABS": {
      const fromIndex = workspace.tabOrder.indexOf(action.fromId);
      const toIndex = workspace.tabOrder.indexOf(action.toId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) break;
      const next = [...workspace.tabOrder];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, action.fromId);
      workspace = { ...workspace, tabOrder: next };
      break;
    }

    case "CLOSE_DOCUMENT": {
      const closeId = action.documentId ?? workspace.activeDocumentId;
      if (!workspace.documents[closeId]) {
        return state;
      }
      const nextOrder = workspace.tabOrder.filter((id) => id !== closeId);
      const nextDocs = { ...workspace.documents };
      delete nextDocs[closeId];
      if (nextOrder.length === 0) {
        const replacement = createDocumentSession({ source: DEFAULT_SOURCE, title: "Untitled 1" });
        workspace = {
          ...workspace,
          documents: { [replacement.id]: replacement },
          tabOrder: [replacement.id],
          activeDocumentId: replacement.id,
          recentDocumentIds: [replacement.id]
        };
        break;
      }
      const nextActiveId =
        workspace.activeDocumentId === closeId
          ? nextOrder[Math.max(0, workspace.tabOrder.indexOf(closeId) - 1)] ?? nextOrder[0]!
          : workspace.activeDocumentId;
      workspace = {
        ...workspace,
        documents: nextDocs,
        tabOrder: nextOrder,
        activeDocumentId: nextActiveId,
        recentDocumentIds: workspace.recentDocumentIds.filter((id) => id !== closeId && nextDocs[id])
      };
      workspace = rememberRecentDocument(workspace, nextActiveId);
      break;
    }

    case "CLOSE_ALL_DOCUMENTS": {
      const replacement = createDocumentSession({ source: DEFAULT_SOURCE, title: "Untitled 1" });
      workspace = {
        ...workspace,
        documents: { [replacement.id]: replacement },
        tabOrder: [replacement.id],
        activeDocumentId: replacement.id,
        recentDocumentIds: [replacement.id]
      };
      break;
    }

    case "MARK_DOCUMENT_SAVED": {
      const documentId = activeDocumentIdFromAction(state, action.documentId);
      workspace = updateDocument(workspace, documentId, (doc) => ({
        ...doc,
        savedSource: doc.source,
        dirty: false,
        fileRef: action.fileRef ?? doc.fileRef,
        title: (action.fileRef ?? doc.fileRef)?.name ?? doc.title
      }));
      break;
    }

    case "CODE_EDITED": {
      const documentId = activeId;
      workspace = updateDocument(workspace, documentId, (doc) => {
        if (doc.assistantLockReason) {
          return doc;
        }
        if (action.source === doc.source) {
          return doc;
        }
        const scrubChangedSourceIds = ui.activeSourceScrubSourceId ? [ui.activeSourceScrubSourceId] : null;
        const scrubPatches = ui.activeSourceScrubSourceId
          ? deriveSingleSourcePatch(doc.source, action.source)
          : null;
        return {
          ...doc,
          source: action.source,
          sourceRevision: doc.sourceRevision + 1,
          activeFigureId: doc.activeFigureId,
          lastEditChangedSourceIds: scrubChangedSourceIds,
          lastEditChangeToken: doc.lastEditChangeToken + 1,
          lastEditPatches: scrubPatches,
          lastEditWarningMessage: null,
          lastEditWarningToken:
            doc.lastEditWarningMessage != null
              ? doc.lastEditWarningToken + 1
              : doc.lastEditWarningToken,
          history: [],
          historyIndex: -1,
          activeHandleId: null,
          dirty: action.source !== doc.savedSource
        };
      });
      break;
    }

    case "COMPUTE_REQUESTED": {
      const documentId = activeDocumentIdFromAction(state, action.documentId);
      workspace = updateDocument(workspace, documentId, (doc) => ({ ...doc, pendingRequestId: action.requestId }));
      break;
    }

    case "SNAPSHOT_READY": {
      const documentId = activeDocumentIdFromAction(state, action.documentId);
      workspace = updateDocument(workspace, documentId, (doc) => {
        const isCurrentPendingRequest = action.requestId === doc.pendingRequestId;
        const canApplyIntermediateDragSnapshot =
          !isCurrentPendingRequest &&
          ui.activeCanvasDragKind != null &&
          action.snapshot.source !== doc.snapshot.source;
        if (!isCurrentPendingRequest && !canApplyIntermediateDragSnapshot) {
          return doc;
        }
        const previousFigureCount = doc.snapshot.figures.length;
        const validFigureIds = new Set(action.snapshot.figures.map((figure) => figure.id));
        let nextActiveFigureId = doc.activeFigureId;
        let hasInitializedFigureSelection = doc.hasInitializedFigureSelection;
        if (nextActiveFigureId && !validFigureIds.has(nextActiveFigureId)) {
          nextActiveFigureId = null;
          hasInitializedFigureSelection = true;
        }
        const shouldAutoSelectFirst =
          (!hasInitializedFigureSelection && !nextActiveFigureId && action.snapshot.figures.length > 0) ||
          (!nextActiveFigureId &&
            action.snapshot.figures.length >= 2 &&
            action.snapshot.figures.length > previousFigureCount);
        if (shouldAutoSelectFirst) {
          nextActiveFigureId = action.snapshot.figures[0]!.id;
          hasInitializedFigureSelection = true;
        }
        return {
          ...doc,
          snapshot: action.snapshot,
          activeFigureId: nextActiveFigureId,
          hasInitializedFigureSelection,
          pendingRequestId: isCurrentPendingRequest ? null : doc.pendingRequestId,
          activeHandleId:
            doc.activeHandleId && action.snapshot.editHandles.some((handle) => handle.id === doc.activeHandleId)
              ? doc.activeHandleId
              : null
        };
      });
      break;
    }

    case "SET_RIGHT_SIDEBAR_TAB":
      if (ui.rightSidebarTab === action.tab) {
        return state;
      }
      ui = { ...ui, rightSidebarTab: action.tab, showInspectorPanel: true };
      break;

    case "ASSISTANT_THREAD_READY": {
      const documentId = activeDocumentIdFromAction(state, action.documentId);
      workspace = updateDocument(workspace, documentId, (doc) => ({
        ...doc,
        assistantThreadId: action.threadId,
        assistantWorkspacePath: action.workspacePath,
        assistantFigurePath: action.figurePath,
        assistantPreviewPath: action.previewPath,
        assistantError: null
      }));
      break;
    }

    case "ASSISTANT_THREAD_LOADED": {
      const documentId = activeDocumentIdFromAction(state, action.documentId);
      workspace = updateDocument(workspace, documentId, (doc) => ({
        ...doc,
        assistantThreadId: action.state.threadId,
        assistantWorkspacePath: action.state.workspacePath,
        assistantFigurePath: action.state.figurePath,
        assistantPreviewPath: action.state.previewPath,
        assistantItems: action.state.items,
        assistantError: null
      }));
      break;
    }

    case "ASSISTANT_TURN_STATUS": {
      const documentId = activeDocumentIdFromAction(state, action.documentId);
      workspace = updateDocument(workspace, documentId, (doc) => ({
        ...doc,
        assistantTurnStatus: action.status,
        assistantCurrentTurnId: action.turnId ?? (action.status === "idle" ? null : doc.assistantCurrentTurnId),
        assistantLockReason:
          action.status === "starting" || action.status === "inProgress"
            ? "Assistant is editing this figure."
            : null,
        assistantError: action.error ?? (action.status === "failed" ? doc.assistantError : doc.assistantError)
      }));
      break;
    }

    case "ASSISTANT_ITEM_STARTED":
    case "ASSISTANT_ITEM_UPDATED":
    case "ASSISTANT_ITEM_COMPLETED": {
      const documentId = activeDocumentIdFromAction(state, action.documentId);
      const item = action.item;
      workspace = updateDocument(workspace, documentId, (doc) => ({
        ...doc,
        assistantItems: mergeAssistantItem(
          item.type === "userMessage"
            ? doc.assistantItems.filter((entry) => !entry.id.startsWith("optimistic-user-message:"))
            : doc.assistantItems,
          item
        )
      }));
      break;
    }

    case "ASSISTANT_ITEM_DELTA": {
      const documentId = activeDocumentIdFromAction(state, action.documentId);
      workspace = updateDocument(workspace, documentId, (doc) => {
        const index = doc.assistantItems.findIndex((item) => item.id === action.itemId);
        if (index < 0) {
          return doc;
        }
        const nextItems = [...doc.assistantItems];
        nextItems[index] = appendAssistantDelta(nextItems[index]!, action.deltaType, action.delta);
        return {
          ...doc,
          assistantItems: nextItems
        };
      });
      break;
    }

    case "ASSISTANT_APPROVAL_REQUESTED": {
      const documentId = activeDocumentIdFromAction(state, action.documentId);
      workspace = updateDocument(workspace, documentId, (doc) => ({
        ...doc,
        assistantPendingApprovals: [
          ...doc.assistantPendingApprovals.filter((approval) => approval.requestId !== action.approval.requestId),
          action.approval
        ]
      }));
      break;
    }

    case "ASSISTANT_APPROVAL_CLEARED": {
      const documentId = activeDocumentIdFromAction(state, action.documentId);
      workspace = updateDocument(workspace, documentId, (doc) => ({
        ...doc,
        assistantPendingApprovals: doc.assistantPendingApprovals.filter((approval) => approval.requestId !== action.requestId)
      }));
      break;
    }

    case "ASSISTANT_SOURCE_UPDATED": {
      const documentId = activeDocumentIdFromAction(state, action.documentId);
      workspace = updateDocument(workspace, documentId, (doc) => {
        if (doc.assistantLastSourceRevision === action.revisionToken || doc.source === action.source) {
          return {
            ...doc,
            assistantLastSourceRevision: action.revisionToken
          };
        }
        const truncated = doc.history.slice(0, doc.historyIndex + 1);
        const mergeKey = action.historyMergeKey ?? "assistant-turn";
        const lastIndex = truncated.length - 1;
        const lastEntry = truncated[lastIndex];
        const nextEntry: HistoryEntry = {
          kind: "set-property",
          label: "AI assistant edit",
          mergeKey,
          forward: [],
          backward: [],
          sourceBefore: lastEntry?.mergeKey === mergeKey ? lastEntry.sourceBefore : doc.source,
          sourceAfter: action.source
        };
        const nextHistory =
          lastEntry?.mergeKey === mergeKey
            ? [...truncated.slice(0, -1), nextEntry]
            : [...truncated, nextEntry];
        return {
          ...doc,
          source: action.source,
          sourceRevision: doc.sourceRevision + 1,
          lastEditChangedSourceIds: null,
          lastEditChangeToken: doc.lastEditChangeToken + 1,
          lastEditPatches: null,
          lastEditWarningMessage: null,
          lastEditWarningToken:
            doc.lastEditWarningMessage != null
              ? doc.lastEditWarningToken + 1
              : doc.lastEditWarningToken,
          history: nextHistory,
          historyIndex: nextHistory.length - 1,
          activeHandleId: null,
          dirty: action.source !== doc.savedSource,
          assistantLastSourceRevision: action.revisionToken,
          assistantError: null
        };
      });
      break;
    }

    case "ASSISTANT_SET_ERROR": {
      const documentId = activeDocumentIdFromAction(state, action.documentId);
      workspace = updateDocument(workspace, documentId, (doc) => ({
        ...doc,
        assistantError: action.message
      }));
      break;
    }

    case "APPLY_EDIT_ACTION": {
      const documentId = activeId;
      const activeDoc = workspace.documents[documentId];
      if (!activeDoc) {
        return state;
      }
      if (activeDoc.assistantLockReason) {
        return state;
      }
      let result: EditActionResult;
      if (
        action.precomputedResult != null &&
        (action.precomputedSource == null || action.precomputedSource === activeDoc.source)
      ) {
        result = action.precomputedResult;
      } else {
        result = applyEditAction(
          activeDoc.source,
          activeDoc.snapshot.editHandles,
          action.action,
          {
            parseOptions: {
              activeFigureId:
                activeDoc.activeFigureId == null
                  ? (activeDoc.snapshot.figures.length > 1 ? null : undefined)
                  : activeDoc.activeFigureId,
              indentSize: action.parseOptions?.indentSize
            }
          }
        );
      }

      if (result.kind !== "success" && result.kind !== "partial") {
        const message =
          result.kind === "unsupported"
            ? `Edit action skipped: ${result.reason}`
            : `Edit action failed: ${result.message}`;
        workspace = updateDocument(workspace, documentId, (doc) => applyEditWarningToDocument(doc, message));
        break;
      }

      const actionWarning = result.kind === "partial" ? result.reason : null;
      const incrementalChangedSourceIds =
        action.action.kind === "movePathAttachedNode"
          ? null
          : (result.changedSourceIds ?? null);
      const incrementalPatches =
        action.action.kind === "movePathAttachedNode"
          ? null
          : result.patches;

      if (result.newSource === activeDoc.source) {
        if (actionWarning) {
          workspace = updateDocument(workspace, documentId, (doc) => applyEditWarningToDocument(doc, actionWarning));
          break;
        }
        return state;
      }

      const nextSelection: ReadonlySet<string> = result.selectedSourceIds
        ? new Set<string>(result.selectedSourceIds)
        : activeDoc.selectedElementIds;
      const nextFocusedScopeId =
        result.selectedSourceIds && result.selectedSourceIds.length === 0 &&
        (action.action.kind === "deleteElement" ||
          action.action.kind === "deleteElements" ||
          action.action.kind === "deleteAdornment")
          ? null
          : activeDoc.focusedScopeId;
      const recordInHistory = action.recordInHistory ?? true;

      if (!recordInHistory) {
        workspace = updateDocument(workspace, documentId, (doc) => ({
          ...doc,
          source: result.newSource,
          sourceRevision: doc.sourceRevision + 1,
          lastEditChangedSourceIds: incrementalChangedSourceIds,
          lastEditChangeToken: doc.lastEditChangeToken + 1,
          lastEditPatches: incrementalPatches,
          lastEditWarningMessage: actionWarning,
          lastEditWarningToken:
            actionWarning != null || doc.lastEditWarningMessage != null
              ? doc.lastEditWarningToken + 1
              : doc.lastEditWarningToken,
          selectedElementIds: nextSelection,
          focusedScopeId: nextFocusedScopeId,
          activeHandleId: null,
          dirty: result.newSource !== doc.savedSource
        }));
        break;
      }

      const historyKind: HistoryEntry["kind"] =
        action.action.kind === "moveElement" || action.action.kind === "moveElements" ? "move" :
        action.action.kind === "moveHandle" || action.action.kind === "connectHandle" || action.action.kind === "moveAdornment" ? "move-handle" :
        action.action.kind === "splitPath" || action.action.kind === "joinPaths" || action.action.kind === "toggleClosedPath" ||
        action.action.kind === "deletePathPoint" || action.action.kind === "setPathPointKind" ? "path-edit" :
        action.action.kind === "setProperty" || action.action.kind === "updateNodeText" ? "set-property" :
        action.action.kind === "alignElements" ? "align" :
        action.action.kind === "distributeElements" ? "distribute" :
        action.action.kind === "reorderElements" ? "reorder" :
        action.action.kind === "groupElements" ? "add-element" :
        action.action.kind === "ungroupElements" ? "delete" :
        action.action.kind === "addElement" || action.action.kind === "addNodeAdornment" ? "add-element" :
        action.action.kind === "duplicateElements" || action.action.kind === "pasteStatements" || action.action.kind === "duplicateAdornment" ? "add-element" :
        action.action.kind === "deleteElement" || action.action.kind === "deleteElements" || action.action.kind === "deleteAdornment" ? "delete" :
        "resize";

      const truncated = activeDoc.history.slice(0, activeDoc.historyIndex + 1);
      const mergeKey = action.historyMergeKey;
      const lastIndex = truncated.length - 1;
      const lastEntry = truncated[lastIndex];

      if (
        mergeKey &&
        lastEntry &&
        lastEntry.mergeKey === mergeKey &&
        lastEntry.kind === historyKind
      ) {
        const nextHistory = [...truncated];
        nextHistory[lastIndex] = {
          ...lastEntry,
          label: actionLabel(historyKind),
          forward: result.patches,
          sourceAfter: result.newSource
        };
        workspace = updateDocument(workspace, documentId, (doc) => ({
          ...doc,
          source: result.newSource,
          sourceRevision: doc.sourceRevision + 1,
          lastEditChangedSourceIds: incrementalChangedSourceIds,
          lastEditChangeToken: doc.lastEditChangeToken + 1,
          lastEditPatches: incrementalPatches,
          lastEditWarningMessage: actionWarning,
          lastEditWarningToken:
            actionWarning != null || doc.lastEditWarningMessage != null
              ? doc.lastEditWarningToken + 1
              : doc.lastEditWarningToken,
          selectedElementIds: nextSelection,
          focusedScopeId: nextFocusedScopeId,
          activeHandleId: null,
          history: nextHistory,
          historyIndex: lastIndex,
          dirty: result.newSource !== doc.savedSource
        }));
        break;
      }

      const entry: HistoryEntry = {
        kind: historyKind,
        label: actionLabel(historyKind),
        mergeKey,
        forward: result.patches,
        backward: result.patches,
        sourceBefore: activeDoc.source,
        sourceAfter: result.newSource
      };

      workspace = updateDocument(workspace, documentId, (doc) => ({
        ...doc,
        source: result.newSource,
        sourceRevision: doc.sourceRevision + 1,
        lastEditChangedSourceIds: incrementalChangedSourceIds,
        lastEditChangeToken: doc.lastEditChangeToken + 1,
        lastEditPatches: incrementalPatches,
        lastEditWarningMessage: actionWarning,
        lastEditWarningToken:
          actionWarning != null || doc.lastEditWarningMessage != null
            ? doc.lastEditWarningToken + 1
            : doc.lastEditWarningToken,
        selectedElementIds: nextSelection,
        focusedScopeId: nextFocusedScopeId,
        activeHandleId: null,
        history: [...truncated, entry],
        historyIndex: truncated.length,
        dirty: result.newSource !== doc.savedSource
      }));
      break;
    }

    case "SET_SOURCE_TRANSIENT": {
      workspace = updateDocument(workspace, activeId, (doc) => {
        if (doc.assistantLockReason) {
          return doc;
        }
        if (action.source === doc.source) {
          return doc;
        }
        return {
          ...doc,
          source: action.source,
          sourceRevision: doc.sourceRevision + 1,
          lastEditChangedSourceIds: action.changedSourceIds ?? null,
          lastEditChangeToken: doc.lastEditChangeToken + 1,
          lastEditPatches: null,
          lastEditWarningMessage: null,
          lastEditWarningToken:
            doc.lastEditWarningMessage != null
              ? doc.lastEditWarningToken + 1
              : doc.lastEditWarningToken,
          activeHandleId: null,
          dirty: action.source !== doc.savedSource
        };
      });
      break;
    }

    case "UNDO": {
      const doc = workspace.documents[activeId];
      if (!doc || doc.historyIndex < 0) {
        return state;
      }
      const entry = doc.history[doc.historyIndex];
      if (!entry) {
        return state;
      }
      workspace = updateDocument(workspace, activeId, (current) => ({
        ...current,
        source: entry.sourceBefore,
        sourceRevision: current.sourceRevision + 1,
        lastEditChangedSourceIds: null,
        lastEditChangeToken: current.lastEditChangeToken + 1,
        lastEditPatches: null,
        lastEditWarningMessage: null,
        lastEditWarningToken:
          current.lastEditWarningMessage != null
            ? current.lastEditWarningToken + 1
            : current.lastEditWarningToken,
        historyIndex: current.historyIndex - 1,
        dirty: entry.sourceBefore !== current.savedSource
      }));
      break;
    }

    case "REDO": {
      const doc = workspace.documents[activeId];
      if (!doc || doc.historyIndex >= doc.history.length - 1) {
        return state;
      }
      const entry = doc.history[doc.historyIndex + 1];
      if (!entry) {
        return state;
      }
      workspace = updateDocument(workspace, activeId, (current) => ({
        ...current,
        source: entry.sourceAfter,
        sourceRevision: current.sourceRevision + 1,
        lastEditChangedSourceIds: null,
        lastEditChangeToken: current.lastEditChangeToken + 1,
        lastEditPatches: null,
        lastEditWarningMessage: null,
        lastEditWarningToken:
          current.lastEditWarningMessage != null
            ? current.lastEditWarningToken + 1
            : current.lastEditWarningToken,
        historyIndex: current.historyIndex + 1,
        dirty: entry.sourceAfter !== current.savedSource
      }));
      break;
    }

    case "SELECT": {
      workspace = updateDocument(workspace, activeId, (doc) => {
        if (action.additive) {
          const next = new Set(doc.selectedElementIds);
          if (next.has(action.id)) {
            next.delete(action.id);
          } else {
            next.add(action.id);
          }
          return { ...doc, selectedElementIds: next, activeHandleId: null };
        }
        if (doc.selectedElementIds.size === 1 && doc.selectedElementIds.has(action.id)) {
          return doc;
        }
        return { ...doc, selectedElementIds: new Set([action.id]), activeHandleId: null };
      });
      break;
    }

    case "SELECT_RANGE": {
      workspace = updateDocument(workspace, activeId, (doc) => ({
        ...doc,
        selectedElementIds: new Set(action.ids),
        activeHandleId: null
      }));
      break;
    }

    case "CLEAR_SELECTION": {
      workspace = updateDocument(workspace, activeId, (doc) => {
        if (
          doc.selectedElementIds.size === 0 &&
          doc.activeHandleId == null &&
          (action.preserveFocusedScope || doc.focusedScopeId == null)
        ) {
          return doc;
        }
        return {
          ...doc,
          selectedElementIds: new Set(),
          activeHandleId: null,
          focusedScopeId: action.preserveFocusedScope ? doc.focusedScopeId : null
        };
      });
      break;
    }

    case "SET_FOCUSED_SCOPE": {
      workspace = updateDocument(workspace, activeId, (doc) =>
        doc.focusedScopeId === action.scopeId ? doc : { ...doc, focusedScopeId: action.scopeId }
      );
      break;
    }

    case "SET_ACTIVE_HANDLE": {
      workspace = updateDocument(workspace, activeId, (doc) =>
        doc.activeHandleId === action.handleId ? doc : { ...doc, activeHandleId: action.handleId }
      );
      break;
    }

    case "SET_TOOL_MODE":
      if (workspace.documents[activeId]?.assistantLockReason) return state;
      if (ui.toolMode === action.mode) return state;
      ui = { ...ui, toolMode: action.mode };
      break;

    case "SET_CANVAS_TRANSFORM":
      ui = { ...ui, canvasTransform: action.transform };
      break;

    case "SET_HOVERED_ELEMENT":
      if (ui.hoveredElementId === action.id) return state;
      ui = { ...ui, hoveredElementId: action.id };
      break;

    case "SET_ACTIVE_CANVAS_DRAG":
      if (ui.activeCanvasDragKind === action.kind) return state;
      ui = { ...ui, activeCanvasDragKind: action.kind };
      break;

    case "SET_FREEHAND_SMOOTHING": {
      const nextValue = Math.max(
        FREEHAND_SMOOTHING_MIN_PX,
        Math.min(FREEHAND_SMOOTHING_MAX_PX, Math.round(action.value))
      );
      if (ui.freehandSmoothingPx === nextValue) return state;
      ui = { ...ui, freehandSmoothingPx: nextValue };
      break;
    }

    case "SET_BUCKET_FILL_COLOR": {
      const nextValue = action.value.trim().toLowerCase();
      if (nextValue.length === 0 || ui.bucketFillColor === nextValue) return state;
      ui = { ...ui, bucketFillColor: nextValue };
      break;
    }

    case "SET_ADD_SHAPE_PRESET":
      if (ui.selectedAddShape === action.value) return state;
      ui = { ...ui, selectedAddShape: action.value };
      break;

    case "SET_ADD_MATRIX_PRESET": {
      const rows = Math.max(1, Math.floor(action.rows));
      const columns = Math.max(1, Math.floor(action.columns));
      if (ui.selectedAddMatrixRows === rows && ui.selectedAddMatrixColumns === columns) {
        return state;
      }
      ui = {
        ...ui,
        selectedAddMatrixRows: rows,
        selectedAddMatrixColumns: columns
      };
      break;
    }

    case "SET_CREATION_STROKE_COLOR": {
      const nextValue = action.value.trim().toLowerCase();
      if (nextValue.length === 0 || ui.creationStrokeColor === nextValue) return state;
      ui = { ...ui, creationStrokeColor: nextValue };
      break;
    }

    case "SET_CREATION_FILL_COLOR": {
      const nextValue = action.value.trim().toLowerCase();
      if (ui.creationFillColor === nextValue) return state;
      ui = { ...ui, creationFillColor: nextValue };
      break;
    }

    case "SET_ACTIVE_SOURCE_SCRUB":
      if (ui.activeSourceScrubSourceId === action.sourceId) return state;
      ui = { ...ui, activeSourceScrubSourceId: action.sourceId };
      break;

    case "TOGGLE_CANVAS_AID":
      if (action.aid === "grid") {
        ui = { ...ui, showGrid: !ui.showGrid };
      } else if (action.aid === "rulers") {
        ui = { ...ui, showRulers: !ui.showRulers };
      } else if (action.aid === "guides") {
        ui = { ...ui, showGuides: !ui.showGuides };
      } else if (action.aid === "transparencyGrid") {
        ui = { ...ui, showTransparencyGrid: !ui.showTransparencyGrid };
      } else {
        ui = { ...ui, showDocumentBounds: !ui.showDocumentBounds };
      }
      break;

    case "TOGGLE_SNAP_MODE":
      ui = {
        ...ui,
        snapModes: {
          ...ui.snapModes,
          [action.mode]: !ui.snapModes[action.mode]
        }
      };
      break;

    case "REQUEST_FIT_TO_CONTENT":
      ui = { ...ui, fitToContentRequestToken: ui.fitToContentRequestToken + 1 };
      break;

    case "REQUEST_ZOOM":
      ui = {
        ...ui,
        zoomRequestToken: ui.zoomRequestToken + 1,
        zoomRequestDirection: action.direction
      };
      break;

    case "SYNC_LAYOUT_STATE":
      ui = {
        ...ui,
        showSourcePanel: action.sourceVisible,
        showInspectorPanel: action.inspectorVisible,
        showObjectsPanel: action.objectsVisible,
        showStylesPanel: action.stylesVisible,
        showFiguresPanel: action.figuresVisible,
        showAssistantPanel: action.assistantVisible,
        rightSidebarTab: action.activeRightTab,
      };
      break;

    case "TOGGLE_PANEL":
      ui = action.panel === "source"
        ? { ...ui, showSourcePanel: !ui.showSourcePanel }
        : { ...ui, showInspectorPanel: !ui.showInspectorPanel };
      break;

    case "TOGGLE_DEV_PANEL":
      ui = { ...ui, showDevPanel: !ui.showDevPanel };
      break;
  }

  if (workspace === previousWorkspace && ui === previousUi) {
    return state;
  }
  return projectState(workspace, ui);
}
