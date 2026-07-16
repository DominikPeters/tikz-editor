import type { SessionSnapshot } from "../compute";
import type { EditAction, EditActionResult } from "@tikz-editor/core/edit/actions";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import type { NodeShapePresetId } from "@tikz-editor/core/edit/inspector";
import type {
  AssistantItem,
  AssistantPendingApproval,
  AssistantThreadState,
  AssistantTurnStatus
} from "../platform/types";

export type ToolMode =
  | "select"
  | "magnify"
  | "addBucket"
  | "addNode"
  | "addMatrix"
  | "addShape"
  | "addPath"
  | "addFreehand"
  | "addLine"
  | "addGrid"
  | "addRect"
  | "addEllipse"
  | "addCircle"
  | "addArrow"
  | "addBezier"
  | "addonTemplate";
export type CanvasDragKind = "element" | "resize" | "rotate" | "handle" | "pan" | "marquee" | "tool-create";
export type CanvasAid = "grid" | "rulers" | "guides" | "transparencyGrid" | "documentBounds";
export type SnapMode = "grid" | "guides" | "points" | "gaps";

export type SnapModes = {
  grid: boolean;
  guides: boolean;
  points: boolean;
  gaps: boolean;
};

export type ZoomRequestDirection = "in" | "out";

export type DeveloperLogEntry = {
  id: string;
  atIso: string;
  source: "compute" | "editing" | "snap" | "ui";
  level: "info" | "warning" | "error";
  message: string;
  data?: unknown;
};

export type DeveloperSnapDebugState = {
  atIso: string;
  phase: string;
  note: string | null;
  snapshotMatchesSource: boolean;
  dragKind: string | null;
  rawPoint: unknown;
  rawDelta: unknown;
  snappedPoint: unknown;
  snappedDelta: unknown;
  offset: unknown;
  context: unknown;
  lineCount: number;
  lineSummary: unknown[];
};

export type CanvasTransform = {
  translateX: number;
  translateY: number;
  scale: number;
};

export type HistoryEntry = {
  kind:
    | "move"
    | "move-handle"
    | "path-edit"
    | "set-property"
    | "add-element"
    | "delete"
    | "resize"
    | "reorder"
    | "align"
    | "distribute"
    | "flatten-foreach";
  label: string;
  /** Optional key used to coalesce drag updates into one undo step. */
  mergeKey?: string;
  /** Patches to apply to go forward (redo). */
  forward: SourcePatch[];
  /** Source before the action (for full undo). */
  sourceBefore: string;
  /** Source after the action (for full redo). */
  sourceAfter: string;
  /** Selection before the action, when the edit action originated from WYSIWYG state. */
  selectedElementIdsBefore?: string[];
  /** Selection after the action, when the edit action originated from WYSIWYG state. */
  selectedElementIdsAfter?: string[];
};

export type DocumentFileRef = {
  kind: "virtual" | "file" | "browser-file";
  name: string;
  handleId?: string;
  path?: string;
  provider?: "browser-fsa" | "download" | "desktop-fs";
};

export type FileRevision = {
  mtimeMs?: number;
  size?: number;
  hash: string;
};

export type ExternalChangeStatus = "none" | "changed" | "missing" | "permission-needed" | "error";

export type DocumentSession = {
  id: string;
  title: string;
  source: string;
  sourceRevision: number;
  activeFigureId: string | null;
  hasInitializedFigureSelection: boolean;
  snapshot: SessionSnapshot;
  pendingRequestId: string | null;
  lastEditChangedSourceIds: string[] | null;
  lastEditChangeToken: number;
  /** Source patches from the most recent WYSIWYG edit action (for surgical CodeMirror updates). */
  lastEditPatches: ReadonlyArray<{ oldSpan: { from: number; to: number }; newSpan: { from: number; to: number }; replacement: string }> | null;
  /** Source revision that `lastEditPatches` are based on. */
  lastEditPatchBaseRevision: number | null;
  /** Last warning surfaced by edit-action dispatch (unsupported/error/partial fallback). */
  lastEditWarningMessage: string | null;
  /** Monotonic token bumped when warning message changes or re-emits. */
  lastEditWarningToken: number;
  history: HistoryEntry[];
  historyIndex: number;
  selectedElementIds: ReadonlySet<string>;
  focusedScopeId: string | null;
  activeHandleId: string | null;
  fileRef: DocumentFileRef | null;
  savedSource: string;
  dirty: boolean;
  diskRevision: FileRevision | null;
  lastKnownDiskSource: string | null;
  externalChangeStatus: ExternalChangeStatus;
  assistantThreadId: string | null;
  assistantWorkspacePath: string | null;
  assistantFigurePath: string | null;
  assistantPreviewPath: string | null;
  assistantItems: AssistantItem[];
  assistantPendingApprovals: AssistantPendingApproval[];
  assistantTurnStatus: AssistantTurnStatus;
  assistantCurrentTurnId: string | null;
  assistantLockReason: string | null;
  assistantLastSourceRevision: string | null;
  assistantError: string | null;
};

export type WorkspacePersistedState = {
  workspaceVersion: number;
  documents: Record<string, DocumentSession>;
  tabOrder: string[];
  activeDocumentId: string;
  recentDocumentIds: string[];
};

export type WorkspaceEphemeralState = {
  // ── canvas slice ─────────────────────────────────────────────────────────────
  toolMode: ToolMode;
  activeAddonTemplateId: string | null;
  canvasTransform: CanvasTransform;
  hoveredElementId: string | null;
  activeCanvasDragKind: CanvasDragKind | null;
  /** Source id currently being edited via source-number scrubbing. */
  activeSourceScrubSourceId: string | null;
  /** Source id currently being edited through the canvas text popup. */
  activeCanvasTextEditSourceId: string | null;
  showGrid: boolean;
  showTransparencyGrid: boolean;
  snapModes: SnapModes;
  showRulers: boolean;
  showGuides: boolean;
  showDocumentBounds: boolean;
  freehandSmoothingPx: number;
  bucketFillColor: string;
  selectedAddShape: Exclude<NodeShapePresetId, "custom">;
  selectedAddMatrixRows: number;
  selectedAddMatrixColumns: number;
  creationStrokeColor: string;
  creationFillColor: string;
  /** Monotonic token used to request a fit-to-content operation from CanvasPanel. */
  fitToContentRequestToken: number;
  /** Whether the canvas is tracking content bounds as the view changes. */
  fitToContentModeActive: boolean;
  /** Current canvas scale produced by fit-to-content, when measurable. */
  canvasFitToContentScale: number | null;
  /** Monotonic token used to request zoom operations from CanvasPanel. */
  zoomRequestToken: number;
  zoomRequestDirection: ZoomRequestDirection | null;
  /** Monotonic token used to request an absolute canvas zoom scale. */
  zoomScaleRequestToken: number;
  zoomScaleRequestValue: number | null;
  canvasStatusHint: string | null;

  // ── layout slice ─────────────────────────────────────────────────────────────
  showSourcePanel: boolean;
  showInspectorPanel: boolean;
  showObjectsPanel: boolean;
  showStylesPanel: boolean;
  showFiguresPanel: boolean;
  showAssistantPanel: boolean;
  rightSidebarTab: "inspector" | "objects" | "styles" | "assistant";

  // ── debug ─────────────────────────────────────────────────────────────────────
  showDevPanel: boolean;
  developerLogs: DeveloperLogEntry[];
  snapDebug: DeveloperSnapDebugState | null;
};

export type EditorState = {
  // ── document slice ──────────────────────────────────────────────────────────
  source: string;
  sourceRevision: number;
  activeFigureId: string | null;
  snapshot: SessionSnapshot;
  /** Request ID of the most recently triggered compute; null if up-to-date. */
  pendingRequestId: string | null;
  /** Latest edit-derived source ids changed by WYSIWYG actions (used for drag invalidation hints). */
  lastEditChangedSourceIds: string[] | null;
  /** Monotonic token incremented when `lastEditChangedSourceIds` is updated. */
  lastEditChangeToken: number;
  /** Source patches from the most recent WYSIWYG edit action (for surgical CodeMirror updates). */
  lastEditPatches: ReadonlyArray<{ oldSpan: { from: number; to: number }; newSpan: { from: number; to: number }; replacement: string }> | null;
  /** Source revision that `lastEditPatches` are based on. */
  lastEditPatchBaseRevision: number | null;
  /** Last warning surfaced by edit-action dispatch (unsupported/error/partial fallback). */
  lastEditWarningMessage: string | null;
  /** Monotonic token bumped when warning message changes or re-emits. */
  lastEditWarningToken: number;

  // ── history slice ────────────────────────────────────────────────────────────
  /** WYSIWYG undo history (code edits use CodeMirror's built-in history). */
  history: HistoryEntry[];
  /** Points to the last applied entry; -1 means nothing to undo. */
  historyIndex: number;

  // ── selection slice ──────────────────────────────────────────────────────────
  selectedElementIds: ReadonlySet<string>;
  focusedScopeId: string | null;
  activeHandleId: string | null;
  activeDocumentId: string;
  tabOrder: string[];
  documents: Record<string, DocumentSession>;
  workspaceVersion: number;
  recentDocumentIds: string[];

  // ── canvas slice ─────────────────────────────────────────────────────────────
  toolMode: ToolMode;
  activeAddonTemplateId: string | null;
  canvasTransform: CanvasTransform;
  hoveredElementId: string | null;
  activeCanvasDragKind: CanvasDragKind | null;
  /** Source id currently being edited via source-number scrubbing. */
  activeSourceScrubSourceId: string | null;
  /** Source id currently being edited through the canvas text popup. */
  activeCanvasTextEditSourceId: string | null;
  showGrid: boolean;
  showTransparencyGrid: boolean;
  snapModes: SnapModes;
  showRulers: boolean;
  showGuides: boolean;
  showDocumentBounds: boolean;
  freehandSmoothingPx: number;
  bucketFillColor: string;
  selectedAddShape: Exclude<NodeShapePresetId, "custom">;
  selectedAddMatrixRows: number;
  selectedAddMatrixColumns: number;
  creationStrokeColor: string;
  creationFillColor: string;
  /** Monotonic token used to request a fit-to-content operation from CanvasPanel. */
  fitToContentRequestToken: number;
  /** Whether the canvas is tracking content bounds as the view changes. */
  fitToContentModeActive: boolean;
  /** Current canvas scale produced by fit-to-content, when measurable. */
  canvasFitToContentScale: number | null;
  /** Monotonic token used to request zoom operations from CanvasPanel. */
  zoomRequestToken: number;
  zoomRequestDirection: ZoomRequestDirection | null;
  /** Monotonic token used to request an absolute canvas zoom scale. */
  zoomScaleRequestToken: number;
  zoomScaleRequestValue: number | null;
  canvasStatusHint: string | null;

  // ── layout slice ─────────────────────────────────────────────────────────────
  showSourcePanel: boolean;
  showInspectorPanel: boolean;
  showObjectsPanel: boolean;
  showStylesPanel: boolean;
  showFiguresPanel: boolean;
  showAssistantPanel: boolean;
  rightSidebarTab: "inspector" | "objects" | "styles" | "assistant";

  // ── debug ─────────────────────────────────────────────────────────────────────
  showDevPanel: boolean;
  developerLogs: DeveloperLogEntry[];
  snapDebug: DeveloperSnapDebugState | null;
};

export type EditorAction =
  // Document
  | { type: "CODE_EDITED"; source: string }
  | { type: "SET_ACTIVE_FIGURE"; figureId: string | null; documentId?: string }
  | { type: "NEW_DOCUMENT"; source?: string; title?: string }
  | { type: "SWITCH_DOCUMENT"; documentId: string }
  | { type: "CLOSE_DOCUMENT"; documentId?: string }
  | { type: "CLOSE_ALL_DOCUMENTS" }
  | {
      type: "MARK_DOCUMENT_SAVED";
      documentId?: string;
      fileRef?: DocumentFileRef | null;
      diskRevision?: FileRevision | null;
      lastKnownDiskSource?: string | null;
    }
  | {
      type: "REPLACE_DOCUMENT_SOURCE_FROM_DISK";
      documentId?: string;
      source: string;
      fileRef?: DocumentFileRef | null;
      diskRevision: FileRevision;
    }
  | {
      type: "SET_DOCUMENT_LINKED_FILE_STATUS";
      documentId?: string;
      externalChangeStatus: ExternalChangeStatus;
      diskRevision?: FileRevision | null;
      lastKnownDiskSource?: string | null;
    }
  | {
      type: "APPLY_EDIT_ACTION";
      action: EditAction;
      historyMergeKey?: string;
      parseOptions?: {
        indentSize?: 2 | 4;
        propertyWriteMode?: "commit" | "preview" | "drag-frame" | "drag-end";
      };
      /** False for transient UI previews that should not affect undo/redo history. */
      recordInHistory?: boolean;
      precomputedSource?: string;
      precomputedResult?: Extract<EditActionResult, { kind: "success" | "partial" }>;
    }
  | {
      type: "SET_SOURCE_TRANSIENT";
      documentId?: string;
      source: string;
      changedSourceIds?: string[] | null;
    }
  | { type: "COMPUTE_REQUESTED"; requestId: string; documentId?: string }
  | { type: "SNAPSHOT_READY"; requestId: string; snapshot: SessionSnapshot; documentId?: string }
  | { type: "REORDER_TABS"; fromId: string; toId: string }
  | { type: "SET_RIGHT_SIDEBAR_TAB"; tab: "inspector" | "objects" | "styles" | "assistant" }
  | {
      type: "ASSISTANT_THREAD_READY";
      documentId?: string;
      threadId: string;
      workspacePath: string;
      figurePath: string;
      previewPath: string;
    }
  | { type: "ASSISTANT_THREAD_LOADED"; documentId?: string; state: AssistantThreadState }
  | { type: "ASSISTANT_NEW_CHAT"; documentId?: string }
  | { type: "ASSISTANT_TURN_STATUS"; documentId?: string; status: AssistantTurnStatus; turnId?: string | null; error?: string | null }
  | { type: "ASSISTANT_ITEM_STARTED"; documentId?: string; item: AssistantItem }
  | { type: "ASSISTANT_ITEM_UPDATED"; documentId?: string; item: AssistantItem }
  | { type: "ASSISTANT_ITEM_COMPLETED"; documentId?: string; item: AssistantItem }
  | { type: "ASSISTANT_ITEM_DELTA"; documentId?: string; itemId: string; deltaType: string; delta: string }
  | { type: "ASSISTANT_APPROVAL_REQUESTED"; documentId?: string; approval: AssistantPendingApproval }
  | { type: "ASSISTANT_APPROVAL_CLEARED"; documentId?: string; requestId: string }
  | {
      type: "ASSISTANT_SOURCE_UPDATED";
      documentId?: string;
      source: string;
      revisionToken: string;
      historyMergeKey?: string;
    }
  | { type: "ASSISTANT_SET_ERROR"; documentId?: string; message: string | null }
  // History
  | { type: "UNDO" }
  | { type: "REDO" }
  // Selection
  | { type: "SELECT"; id: string; additive: boolean }
  | { type: "SELECT_RANGE"; ids: string[] }
  | { type: "CLEAR_SELECTION"; preserveFocusedScope?: boolean }
  | { type: "SET_FOCUSED_SCOPE"; scopeId: string | null }
  | { type: "SET_ACTIVE_HANDLE"; handleId: string | null }
  // Canvas
  | { type: "SET_TOOL_MODE"; mode: ToolMode; addonTemplateId?: string | null }
  | { type: "SET_CANVAS_TRANSFORM"; transform: CanvasTransform }
  | { type: "SET_HOVERED_ELEMENT"; id: string | null }
  | { type: "SET_ACTIVE_CANVAS_DRAG"; kind: CanvasDragKind | null }
  | { type: "SET_ACTIVE_CANVAS_TEXT_EDIT"; sourceId: string | null }
  | { type: "SET_FREEHAND_SMOOTHING"; value: number }
  | { type: "SET_BUCKET_FILL_COLOR"; value: string }
  | { type: "SET_ADD_SHAPE_PRESET"; value: Exclude<NodeShapePresetId, "custom"> }
  | { type: "SET_ADD_MATRIX_PRESET"; rows: number; columns: number }
  | { type: "SET_CREATION_STROKE_COLOR"; value: string }
  | { type: "SET_CREATION_FILL_COLOR"; value: string }
  | { type: "SET_ACTIVE_SOURCE_SCRUB"; sourceId: string | null }
  | { type: "TOGGLE_CANVAS_AID"; aid: CanvasAid }
  | { type: "TOGGLE_SNAP_MODE"; mode: SnapMode }
  | { type: "REQUEST_FIT_TO_CONTENT" }
  | { type: "SET_FIT_TO_CONTENT_MODE"; active: boolean }
  | { type: "SET_CANVAS_FIT_TO_CONTENT_SCALE"; scale: number | null }
  | { type: "REQUEST_ZOOM"; direction: ZoomRequestDirection }
  | { type: "REQUEST_ZOOM_SCALE"; scale: number }
  | { type: "SET_CANVAS_STATUS_HINT"; hint: string | null }
  // Layout
  | { type: "TOGGLE_PANEL"; panel: "source" | "inspector" }
  | { type: "SYNC_LAYOUT_STATE"; sourceVisible: boolean; inspectorVisible: boolean; objectsVisible: boolean; stylesVisible: boolean; figuresVisible: boolean; assistantVisible: boolean; activeRightTab: "inspector" | "objects" | "styles" | "assistant" }
  // Debug
  | { type: "TOGGLE_DEV_PANEL" }
  | { type: "SET_SNAP_DEBUG"; snapDebug: DeveloperSnapDebugState | null; log?: DeveloperLogEntry }
  | { type: "PUSH_DEVELOPER_LOG"; log: DeveloperLogEntry }
  | { type: "CLEAR_DEVELOPER_LOGS" };
