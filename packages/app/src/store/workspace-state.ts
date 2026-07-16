import type {
  CanvasTransform,
  DocumentFileRef,
  DocumentSession,
  EditorState,
  ExternalChangeStatus,
  FileRevision,
  WorkspaceEphemeralState,
  WorkspacePersistedState
} from "./types";
import { makeEmptySnapshot } from "../compute";

export const DEFAULT_SOURCE = String.raw`\begin{tikzpicture}
\end{tikzpicture}`;

export const WORKSPACE_VERSION = 3;

export const DEFAULT_CANVAS_TRANSFORM: CanvasTransform = {
  translateX: 0,
  translateY: 0,
  scale: 1
};

export type WorkspaceSeedDocument = {
  id: string;
  title: string;
  source: string;
  activeFigureId?: string | null;
  savedSource?: string;
  fileRef?: DocumentFileRef | null;
  diskRevision?: FileRevision | null;
  lastKnownDiskSource?: string | null;
  externalChangeStatus?: ExternalChangeStatus;
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

function createDocumentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `doc-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function readDocument(
  documents: Record<string, DocumentSession>,
  documentId: string
): DocumentSession | undefined {
  return (documents as Partial<Record<string, DocumentSession>>)[documentId];
}

function hasDocument(documents: Record<string, DocumentSession>, documentId: string): boolean {
  return readDocument(documents, documentId) !== undefined;
}

export function createDocumentSession(params: {
  source: string;
  title?: string;
  activeFigureId?: string | null;
  fileRef?: DocumentFileRef | null;
  diskRevision?: FileRevision | null;
  lastKnownDiskSource?: string | null;
  externalChangeStatus?: ExternalChangeStatus;
  assistantThreadId?: string | null;
  assistantWorkspacePath?: string | null;
  assistantFigurePath?: string | null;
  assistantPreviewPath?: string | null;
}): DocumentSession {
  const trimmedTitle = params.title?.trim();
  const title = trimmedTitle === undefined || trimmedTitle.length === 0 ? "Untitled" : trimmedTitle;
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
    lastEditPatchBaseRevision: null,
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
    diskRevision: params.diskRevision ?? null,
    lastKnownDiskSource: params.lastKnownDiskSource ?? null,
    externalChangeStatus: params.externalChangeStatus ?? "none",
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

export function createUntitledDocumentSession(title = "Untitled 1"): DocumentSession {
  return createDocumentSession({ source: DEFAULT_SOURCE, title });
}

export function createInitialWorkspaceState(): WorkspacePersistedState {
  const first = createUntitledDocumentSession();
  return {
    workspaceVersion: WORKSPACE_VERSION,
    documents: { [first.id]: first },
    tabOrder: [first.id],
    activeDocumentId: first.id,
    recentDocumentIds: [first.id]
  };
}

export function hydrateWorkspaceStateFromSeed(seed: WorkspaceSeed): WorkspacePersistedState {
  const docs: Record<string, DocumentSession> = {};
  for (const raw of seed.documents) {
    const doc = createDocumentSession({
      source: raw.source,
      title: raw.title,
      activeFigureId: raw.activeFigureId ?? null,
      fileRef: raw.fileRef ?? null,
      diskRevision: raw.diskRevision ?? null,
      lastKnownDiskSource: raw.lastKnownDiskSource ?? null,
      externalChangeStatus: raw.externalChangeStatus ?? "none",
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

  const tabOrder = seed.tabOrder.filter((id) => hasDocument(docs, id));
  const fallbackOrder = tabOrder.length > 0 ? tabOrder : Object.keys(docs);
  if (fallbackOrder.length === 0) {
    return createInitialWorkspaceState();
  }
  const activeDocumentId = hasDocument(docs, seed.activeDocumentId) ? seed.activeDocumentId : fallbackOrder[0];
  const seededRecents = seed.recentDocumentIds.filter((id) => hasDocument(docs, id));
  const normalizedRecents = seededRecents.length > 0 ? seededRecents : [activeDocumentId];
  return {
    workspaceVersion: WORKSPACE_VERSION,
    documents: docs,
    tabOrder: fallbackOrder,
    activeDocumentId,
    recentDocumentIds: normalizedRecents
  };
}

function normalizeWorkspaceActiveDocument(workspace: WorkspacePersistedState): WorkspacePersistedState {
  if (hasDocument(workspace.documents, workspace.activeDocumentId)) {
    return workspace;
  }
  const fallbackId = workspace.tabOrder.find((id) => hasDocument(workspace.documents, id));
  if (fallbackId) {
    return {
      ...workspace,
      activeDocumentId: fallbackId,
      tabOrder: workspace.tabOrder.filter((id) => hasDocument(workspace.documents, id))
    };
  }
  const replacement = createUntitledDocumentSession();
  return {
    ...workspace,
    documents: { [replacement.id]: replacement },
    tabOrder: [replacement.id],
    activeDocumentId: replacement.id,
    recentDocumentIds: [replacement.id]
  };
}

export function projectState(workspace: WorkspacePersistedState, ui: WorkspaceEphemeralState): EditorState {
  const normalizedWorkspace = normalizeWorkspaceActiveDocument(workspace);
  const active = normalizedWorkspace.documents[normalizedWorkspace.activeDocumentId];
  return {
    source: active.source,
    sourceRevision: active.sourceRevision,
    activeFigureId: active.activeFigureId,
    snapshot: active.snapshot,
    pendingRequestId: active.pendingRequestId,
    lastEditChangedSourceIds: active.lastEditChangedSourceIds,
    lastEditChangeToken: active.lastEditChangeToken,
    lastEditPatches: active.lastEditPatches,
    lastEditPatchBaseRevision: active.lastEditPatchBaseRevision,
    lastEditWarningMessage: active.lastEditWarningMessage,
    lastEditWarningToken: active.lastEditWarningToken,
    history: active.history,
    historyIndex: active.historyIndex,
    selectedElementIds: active.selectedElementIds,
    focusedScopeId: active.focusedScopeId,
    activeHandleId: active.activeHandleId,
    activeDocumentId: normalizedWorkspace.activeDocumentId,
    tabOrder: normalizedWorkspace.tabOrder,
    documents: normalizedWorkspace.documents,
    workspaceVersion: normalizedWorkspace.workspaceVersion,
    recentDocumentIds: normalizedWorkspace.recentDocumentIds,
    toolMode: ui.toolMode,
    activeAddonTemplateId: ui.activeAddonTemplateId,
    canvasTransform: ui.canvasTransform,
    hoveredElementId: ui.hoveredElementId,
    activeCanvasDragKind: ui.activeCanvasDragKind,
    activeSourceScrubSourceId: ui.activeSourceScrubSourceId,
    activeCanvasTextEditSourceId: ui.activeCanvasTextEditSourceId,
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
    fitToContentModeActive: ui.fitToContentModeActive,
    canvasFitToContentScale: ui.canvasFitToContentScale,
    zoomRequestToken: ui.zoomRequestToken,
    zoomRequestDirection: ui.zoomRequestDirection,
    zoomScaleRequestToken: ui.zoomScaleRequestToken,
    zoomScaleRequestValue: ui.zoomScaleRequestValue,
    canvasStatusHint: ui.canvasStatusHint,
    showSourcePanel: ui.showSourcePanel,
    showInspectorPanel: ui.showInspectorPanel,
    showObjectsPanel: ui.showObjectsPanel,
    showStylesPanel: ui.showStylesPanel,
    showFiguresPanel: ui.showFiguresPanel,
    showAssistantPanel: ui.showAssistantPanel,
    rightSidebarTab: ui.rightSidebarTab,
    showDevPanel: ui.showDevPanel,
    developerLogs: ui.developerLogs,
    snapDebug: ui.snapDebug
  };
}

export function workspaceStateFromEditorState(state: EditorState): WorkspacePersistedState {
  return {
    workspaceVersion: state.workspaceVersion,
    documents: state.documents,
    tabOrder: state.tabOrder,
    activeDocumentId: state.activeDocumentId,
    recentDocumentIds: state.recentDocumentIds
  };
}

export function uiStateFromEditorState(state: EditorState): WorkspaceEphemeralState {
  return {
    toolMode: state.toolMode,
    activeAddonTemplateId: state.activeAddonTemplateId,
    canvasTransform: state.canvasTransform,
    hoveredElementId: state.hoveredElementId,
    activeCanvasDragKind: state.activeCanvasDragKind,
    activeSourceScrubSourceId: state.activeSourceScrubSourceId,
    activeCanvasTextEditSourceId: state.activeCanvasTextEditSourceId,
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
    fitToContentModeActive: state.fitToContentModeActive,
    canvasFitToContentScale: state.canvasFitToContentScale,
    zoomRequestToken: state.zoomRequestToken,
    zoomRequestDirection: state.zoomRequestDirection,
    zoomScaleRequestToken: state.zoomScaleRequestToken,
    zoomScaleRequestValue: state.zoomScaleRequestValue,
    canvasStatusHint: state.canvasStatusHint,
    showSourcePanel: state.showSourcePanel,
    showInspectorPanel: state.showInspectorPanel,
    showObjectsPanel: state.showObjectsPanel,
    showStylesPanel: state.showStylesPanel,
    showAssistantPanel: state.showAssistantPanel,
    showFiguresPanel: state.showFiguresPanel,
    rightSidebarTab: state.rightSidebarTab,
    showDevPanel: state.showDevPanel,
    developerLogs: state.developerLogs,
    snapDebug: state.snapDebug
  };
}
