import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  APP_MENU_COMMAND_IDS,
  APP_MENU_DEFINITION,
  filterAppMenuDefinitionForTarget,
  type AppMenuPlatformTarget
} from "../app-menu";
import { useEditorStore } from "../store/store";
import { useWorkspaceListStore } from "../store/workspace-list-store";
import { computeSnapshot, makeEmptySnapshot, setMathJaxFont, type ComputeRequest, type ComputeResponse } from "../compute";
import { applyEditAction } from "tikz-editor/edit/actions";
import { getRepeatSelectionEligibility } from "tikz-editor/edit/actions/repeat";
import { collectSourceWorldBounds } from "tikz-editor/edit/snapping";
import { PT_PER_CM } from "tikz-editor/edit/format";
import { pt, worldPoint } from "tikz-editor/coords";
import { emitSvgModel, type SvgRenderModel } from "tikz-editor/svg";
import type { SceneFigure } from "tikz-editor/semantic/types";
import { createMinimalTikzSourceArtifact } from "tikz-editor/export/index";
import { installAppProfilingRecorder, readAppProfilingSnapshot, resetAppProfilingSession } from "../profiling";
import { AppMenuBar } from "./AppMenuBar";
import { Toolbar } from "./Toolbar";
import { DockLayout } from "./DockLayout";
import { StatusBar } from "./StatusBar";
import { isCodeMirrorEventTarget } from "./editor-commands";
import { useEditorCommandRuntime } from "./editor-command-runtime";
import { toolModeFromShortcut } from "./tool-config";
import { createSingleFlightScheduler } from "./compute-scheduler";
import { computeTrigger } from "./compute-trigger";
import { buildRepeatPreviewScene } from "./repeat-preview";
import { useSettingsStore } from "../settings/useSettingsStore";
import { getActiveEditorPlatform } from "../platform/current";
import css from "./App.module.css";
import "./variables.css";
import { TabStrip } from "./TabStrip";
import type { UnsavedChangesDecision } from "./UnsavedChangesModal";
import type { FileConflictDecision } from "./FileConflictModal";
import { collectDirtyDocumentIdsForIntent, type CloseIntent } from "./close-guard";
import { OPEN_EXAMPLE_CATALOG, type TikzOpenExample } from "./examples/open-example-catalog";
import type { EmitSvgResult } from "tikz-editor/svg/index";
import type { AssistantEvent, UpdateInfo, UpdateInstallProgress } from "../platform/types";
import { resolveOpenedFileForDocument, dataTransferHasFilePayload } from "./svg-import";
import type { AssistantComposerImageAttachment } from "./assistant-image-attachments";
import { formatEquationText, type EquationNodeTarget } from "./equation-utils";
import { useDebouncedEffect } from "./hooks/useDebouncedEffect";
import { decideLinkedFileRefresh, isLinkedFileRef, type LinkedTextWriteResult } from "../linked-file-sync";
import type { DocumentFileRef, DocumentSession, FileRevision } from "../store/types";
import { createArxivVirtualFileName, type ArxivPaperSession, type ArxivTikzCandidate } from "../arxiv-source";
import "./selection.css";

const DevPanel = lazy(async () => {
  const mod = await import("./DevPanel");
  return { default: mod.DevPanel };
});

const OpenExampleModal = lazy(async () => {
  const mod = await import("./OpenExampleModal");
  return { default: mod.OpenExampleModal };
});

const OpenFromArxivModal = lazy(async () => {
  const mod = await import("./OpenFromArxivModal");
  return { default: mod.OpenFromArxivModal };
});

const SettingsModal = lazy(async () => {
  const mod = await import("./SettingsModal");
  return { default: mod.SettingsModal };
});

const SvgExportModal = lazy(async () => {
  const mod = await import("./SvgExportModal");
  return { default: mod.SvgExportModal };
});

const PngExportModal = lazy(async () => {
  const mod = await import("./PngExportModal");
  return { default: mod.PngExportModal };
});

const TikzJaxModal = lazy(async () => {
  const mod = await import("./TikzJaxModal");
  return { default: mod.TikzJaxModal };
});

const UnsavedChangesModal = lazy(async () => {
  const mod = await import("./UnsavedChangesModal");
  return { default: mod.UnsavedChangesModal };
});

const FileConflictModal = lazy(async () => {
  const mod = await import("./FileConflictModal");
  return { default: mod.FileConflictModal };
});

const EquationModal = lazy(async () => {
  const mod = await import("./EquationModal");
  return { default: mod.EquationModal };
});

const RepeatModal = lazy(async () => {
  const mod = await import("./RepeatModal");
  return { default: mod.RepeatModal };
});

const SaveWorkspaceModal = lazy(async () => {
  const mod = await import("./SaveWorkspaceModal");
  return { default: mod.SaveWorkspaceModal };
});

const ManageWorkspacesModal = lazy(async () => {
  const mod = await import("./ManageWorkspacesModal");
  return { default: mod.ManageWorkspacesModal };
});

const UpdateModal = lazy(async () => {
  const mod = await import("./UpdateModal");
  return { default: mod.UpdateModal };
});

const AboutModal = lazy(async () => {
  const mod = await import("./AboutModal");
  return { default: mod.AboutModal };
});

let startupUpdateCheckStarted = false;

function menuTargetFromPlatformId(platformId: string): AppMenuPlatformTarget {
  if (platformId.startsWith("desktop")) {
    if (typeof navigator !== "undefined") {
      if (/(mac|iphone|ipad)/i.test(navigator.platform)) {
        return "desktop-macos";
      }
      if (/win/i.test(navigator.platform)) {
        return "desktop-windows";
      }
    }
    return "desktop-linux";
  }
  return "web";
}

function desktopOsFromPlatformId(platformId: string): "windows" | "macos" | "other" | null {
  if (!platformId.startsWith("desktop")) {
    return null;
  }
  if (typeof navigator === "undefined") {
    return "other";
  }
  if (/(mac|iphone|ipad)/i.test(navigator.platform)) {
    return "macos";
  }
  if (/win/i.test(navigator.platform)) {
    return "windows";
  }
  return "other";
}

function isCanvasViewportFocused(): boolean {
  return (
    document.activeElement instanceof HTMLElement &&
    document.activeElement.closest("[data-canvas-viewport=\"true\"]") != null
  );
}

function isEditableShortcutTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

function selectAllInEditableTarget(target: HTMLElement): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    target.select();
    return true;
  }
  if (target.isContentEditable) {
    const selection = window.getSelection();
    if (!selection) {
      return false;
    }
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }
  return false;
}

type RepeatModalState = {
  documentId: string;
  source: string;
  activeFigureId: string | null;
  selectedSourceIds: string[];
  selectionWidthPt: number;
  selectionHeightPt: number;
  columns: number;
  rows: number;
  horizontalStepPt: number;
  verticalStepPt: number;
};

type UpdateModalPhase =
  | { status: "idle" }
  | { status: "installing"; downloadedBytes: number; contentLength?: number }
  | { status: "failed"; message: string };

type PendingFileConflict = {
  documentId: string;
  title: string;
  remoteSource: string;
  remoteRevision: FileRevision;
  remoteFileRef: DocumentFileRef;
  resolve: (decision: FileConflictDecision) => void;
};

function linkedFilePathKey(fileRef: DocumentFileRef | null | undefined): string | null {
  return fileRef?.provider === "desktop-fs" && typeof fileRef.path === "string" && fileRef.path.trim().length > 0
    ? fileRef.path
    : null;
}

export function App() {
  const {
    source,
    sourceRevision,
    snapshot,
    activeFigureId,
    selectedElementIds,
    activeDocumentId,
    documents,
    tabOrder,
    toolMode,
    lastEditChangedSourceIds,
    lastEditPatches,
    lastEditPatchBaseRevision,
    activeCanvasDragKind,
    activeSourceScrubSourceId,
    dispatch
  } = useEditorStore(useShallow((s) => ({
    source: s.source,
    sourceRevision: s.sourceRevision,
    snapshot: s.snapshot,
    activeFigureId: s.activeFigureId,
    selectedElementIds: s.selectedElementIds,
    activeDocumentId: s.activeDocumentId,
    documents: s.documents,
    tabOrder: s.tabOrder,
    toolMode: s.toolMode,
    lastEditChangedSourceIds: s.lastEditChangedSourceIds,
    lastEditPatches: s.lastEditPatches,
    lastEditPatchBaseRevision: s.lastEditPatchBaseRevision,
    activeCanvasDragKind: s.activeCanvasDragKind,
    activeSourceScrubSourceId: s.activeSourceScrubSourceId,
    dispatch: s.dispatch
  })));
  const { uiFontSizePx, colorScheme, canvasInvert, mathJaxFont } = useSettingsStore(useShallow((s) => ({
    uiFontSizePx: s.settings.general.uiFontSizePx,
    colorScheme: s.settings.general.colorScheme,
    canvasInvert: s.settings.general.canvasInvert,
    mathJaxFont: s.settings.rendering.mathJaxFont
  })));
  const platform = getActiveEditorPlatform();
  const menuTarget = menuTargetFromPlatformId(platform.id);
  const menuDefinition = useMemo(() => filterAppMenuDefinitionForTarget(APP_MENU_DEFINITION, menuTarget), [menuTarget]);
  const [showOpenExampleModal, setShowOpenExampleModal] = useState(false);
  const [showOpenFromArxivModal, setShowOpenFromArxivModal] = useState(false);
  const [openFromArxivSession, setOpenFromArxivSession] = useState<ArxivPaperSession>({
    input: "",
    paper: null,
    selectedCandidateId: null
  });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showSaveWorkspaceModal, setShowSaveWorkspaceModal] = useState(false);
  const [showManageWorkspacesModal, setShowManageWorkspacesModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateDismissedForSession, setUpdateDismissedForSession] = useState(false);
  const [updateCheckBusy, setUpdateCheckBusy] = useState(false);
  const [updateModalPhase, setUpdateModalPhase] = useState<UpdateModalPhase>({ status: "idle" });
  const userWorkspaces = useWorkspaceListStore((s) => s.userWorkspaces);
  const [isDragOver, setIsDragOver] = useState(false);
  const isDesktop = platform.id.startsWith("desktop");
  const [equationModalState, setEquationModalState] = useState<
    | { mode: "insert" }
    | { mode: "edit"; target: EquationNodeTarget }
    | null
  >(null);
  const [repeatModalState, setRepeatModalState] = useState<RepeatModalState | null>(null);
  const [repeatPreviewModel, setRepeatPreviewModel] = useState<SvgRenderModel | null>(null);
  const [insertEquationDraft, setInsertEquationDraft] = useState("");
  const [compiledPictureSource, setCompiledPictureSource] = useState<{
    source: string;
    activeFigureId: string | null;
  } | null>(null);
  const [svgExportSvgResult, setSvgExportSvgResult] = useState<EmitSvgResult | null>(null);
  const [pngExportSvgResult, setPngExportSvgResult] = useState<EmitSvgResult | null>(null);
  const [pendingAutoFit, setPendingAutoFit] = useState(false);
  const [pendingClose, setPendingClose] = useState<{ intent: CloseIntent; dirtyDocumentIds: string[] } | null>(null);
  const [pendingFileConflict, setPendingFileConflict] = useState<PendingFileConflict | null>(null);
  const requestCloseIntentRef = useRef<(intent: CloseIntent) => void>(() => {});
  const computeSchedulerRef = useRef<ReturnType<typeof createSingleFlightScheduler<ComputeRequest, ComputeResponse>> | null>(null);
  const dragRenderViewBoxRef = useRef<ComputeRequest["renderViewBox"]>(null);
  const updateCheckPromiseRef = useRef<Promise<UpdateInfo | null> | null>(null);
  const sourceRef = useRef(source);
  const snapshotRef = useRef(snapshot);
  const activeDocumentIdRef = useRef(activeDocumentId);
  const documentsRef = useRef(documents);
  const linkedWatchTimersRef = useRef<Map<string, number>>(new Map());
  const pendingBackgroundLinkedPathsRef = useRef<Set<string>>(new Set());
  const linkedFileWatchSignature = useMemo(
    () =>
      Object.values(documents)
        .map((doc) => linkedFilePathKey(doc.fileRef))
        .filter((path): path is string => path != null)
        .sort()
        .join("\n"),
    [documents]
  );

  function executeCloseIntent(intent: CloseIntent): void {
    if (intent.kind === "close-document") {
      dispatch({ type: "CLOSE_DOCUMENT", documentId: intent.documentId });
      return;
    }
    if (intent.kind === "close-all") {
      dispatch({ type: "CLOSE_ALL_DOCUMENTS" });
      return;
    }
    void getActiveEditorPlatform().window?.close?.();
  }

  function requestCloseIntent(intent: CloseIntent): void {
    const dirtyDocumentIds = collectDirtyDocumentIdsForIntent(intent, documents, tabOrder);
    if (dirtyDocumentIds.length === 0) {
      executeCloseIntent(intent);
      return;
    }
    const confirmNative = getActiveEditorPlatform().window?.confirmUnsavedChanges;
    if (confirmNative) {
      const titles = dirtyDocumentIds.map((id) => documents[id]?.title ?? "Untitled");
      const message =
        titles.length === 1
          ? `The document "${titles[0]}" has unsaved changes.`
          : `${titles.length} documents have unsaved changes.`;
      void confirmNative(message).then((decision) => {
        void handleUnsavedDecision(decision, { intent, dirtyDocumentIds });
      });
      return;
    }
    setPendingClose({ intent, dirtyDocumentIds });
  }

  requestCloseIntentRef.current = requestCloseIntent;

  const showNativeMessage = useCallback(async (
    title: string,
    message: string,
    kind: "info" | "warning" | "error" = "info"
  ): Promise<void> => {
    const showMessage = getActiveEditorPlatform().window?.showMessage;
    if (typeof showMessage === "function") {
      await showMessage({ title, message, kind });
      return;
    }
    const alertFn = (globalThis as { alert?: (message?: string) => void }).alert;
    if (typeof alertFn === "function") {
      alertFn(message);
    }
  }, []);

  const applyLinkedReadDecision = useCallback((doc: DocumentSession, reason: "restore" | "focus" | "tab" | "save") => {
    const readLinkedText = getActiveEditorPlatform().files?.readLinkedText;
    if (!doc.fileRef || !isLinkedFileRef(doc.fileRef) || typeof readLinkedText !== "function") {
      return;
    }
    void readLinkedText(doc.fileRef).then((result) => {
      const currentDoc = documentsRef.current[doc.id];
      if (!currentDoc) {
        return;
      }
      const decision = decideLinkedFileRefresh(currentDoc, result);
      if (decision.kind === "reload") {
        dispatch({
          type: "REPLACE_DOCUMENT_SOURCE_FROM_DISK",
          documentId: doc.id,
          source: decision.source,
          fileRef: decision.fileRef,
          diskRevision: decision.revision
        });
        return;
      }
      if (decision.kind === "mark-status") {
        dispatch({
          type: "SET_DOCUMENT_LINKED_FILE_STATUS",
          documentId: doc.id,
          externalChangeStatus: decision.externalChangeStatus,
          diskRevision: decision.externalChangeStatus === "changed" ? undefined : decision.revision,
          lastKnownDiskSource: decision.externalChangeStatus === "changed" ? undefined : decision.source
        });
      }
    }).catch((error: unknown) => {
      console.info(`[tikz-editor] Linked file ${reason} check failed.`, error);
      dispatch({
        type: "SET_DOCUMENT_LINKED_FILE_STATUS",
        documentId: doc.id,
        externalChangeStatus: "error"
      });
    });
  }, [dispatch]);

  const initializeLinkedBaseline = useCallback(async (
    documentId: string,
    sourceForDocument: string,
    fileRef: DocumentFileRef | null
  ): Promise<void> => {
    const readLinkedText = getActiveEditorPlatform().files?.readLinkedText;
    if (!fileRef || !isLinkedFileRef(fileRef) || typeof readLinkedText !== "function") {
      return;
    }
    const result = await readLinkedText(fileRef);
    if (result.status !== "ok") {
      dispatch({
        type: "SET_DOCUMENT_LINKED_FILE_STATUS",
        documentId,
        externalChangeStatus:
          result.status === "missing" || result.status === "permission-needed" ? result.status : "error"
      });
      return;
    }
    dispatch({
      type: "MARK_DOCUMENT_SAVED",
      documentId,
      fileRef: result.fileRef,
      diskRevision: result.revision,
      lastKnownDiskSource: result.source ?? sourceForDocument
    });
  }, [dispatch]);

  const requestFileConflictDecision = useCallback((
    doc: DocumentSession,
    conflict: Extract<LinkedTextWriteResult, { status: "changed-on-disk" }>
  ): Promise<FileConflictDecision> => {
    return new Promise((resolve) => {
      setPendingFileConflict({
        documentId: doc.id,
        title: doc.title,
        remoteSource: conflict.source,
        remoteRevision: conflict.revision,
        remoteFileRef: conflict.fileRef,
        resolve
      });
    });
  }, []);

  const saveDocument = useCallback(async (
    documentId: string,
    mode: "save" | "save-as",
    options: { forceOverwrite?: boolean } = {}
  ): Promise<boolean> => {
    const doc = documentsRef.current[documentId];
    if (!doc) {
      return false;
    }
    const files = getActiveEditorPlatform().files;
    if (!files?.saveText) {
      return false;
    }

    if (
      mode === "save" &&
      doc.fileRef &&
      isLinkedFileRef(doc.fileRef) &&
      typeof files.writeLinkedText === "function"
    ) {
      const result = await files.writeLinkedText(
        doc.fileRef,
        doc.source,
        options.forceOverwrite ? null : doc.diskRevision
      );
      if (result.status === "saved") {
        dispatch({
          type: "MARK_DOCUMENT_SAVED",
          documentId,
          fileRef: result.fileRef,
          diskRevision: result.revision,
          lastKnownDiskSource: doc.source
        });
        return true;
      }
      if (result.status === "changed-on-disk") {
        dispatch({
          type: "SET_DOCUMENT_LINKED_FILE_STATUS",
          documentId,
          externalChangeStatus: "changed"
        });
        const decision = await requestFileConflictDecision(doc, result);
        setPendingFileConflict(null);
        if (decision === "reload") {
          dispatch({
            type: "REPLACE_DOCUMENT_SOURCE_FROM_DISK",
            documentId,
            source: result.source,
            fileRef: result.fileRef,
            diskRevision: result.revision
          });
          return false;
        }
        if (decision === "save-anyway") {
          return await saveDocument(documentId, "save", { forceOverwrite: true });
        }
        if (decision === "save-as") {
          return await saveDocument(documentId, "save-as");
        }
        return false;
      }
      const status =
        result.status === "missing" || result.status === "permission-needed" ? result.status : "error";
      dispatch({ type: "SET_DOCUMENT_LINKED_FILE_STATUS", documentId, externalChangeStatus: status });
      if (result.status === "failed") {
        await showNativeMessage("Save Failed", result.reason ?? "Could not save the linked file.", "error");
      }
      return false;
    }

    const result = await files.saveText(doc.source, {
      mode,
      fileRef: doc.fileRef,
      suggestedName: doc.fileRef?.name ?? "tikz-document.tex"
    });
    if (result.status === "saved") {
      dispatch({ type: "MARK_DOCUMENT_SAVED", documentId, fileRef: result.fileRef });
      await initializeLinkedBaseline(documentId, doc.source, result.fileRef);
      return true;
    }
    if (result.status === "failed") {
      await showNativeMessage("Save Failed", result.reason ?? "Save failed.", "error");
    }
    return false;
  }, [dispatch, initializeLinkedBaseline, requestFileConflictDecision, showNativeMessage]);

  const runUpdateCheck = useCallback(async (): Promise<UpdateInfo | null> => {
    const updates = getActiveEditorPlatform().updates;
    if (!updates) {
      return null;
    }
    if (updateCheckPromiseRef.current) {
      return await updateCheckPromiseRef.current;
    }
    setUpdateCheckBusy(true);
    const promise = updates.checkForUpdate();
    updateCheckPromiseRef.current = promise;
    try {
      const update = await promise;
      setAvailableUpdate(update);
      if (update) {
        setUpdateDismissedForSession(false);
      }
      return update;
    } finally {
      updateCheckPromiseRef.current = null;
      setUpdateCheckBusy(false);
    }
  }, []);

  const handleManualUpdateCheck = useCallback(async (): Promise<void> => {
    try {
      const update = await runUpdateCheck();
      if (update) {
        setUpdateModalPhase({ status: "idle" });
        setShowUpdateModal(true);
        return;
      }
      await showNativeMessage("TikZ Editor", "You're up to date.", "info");
    } catch (error) {
      await showNativeMessage(
        "Update Check Failed",
        error instanceof Error ? error.message : String(error),
        "error"
      );
    }
  }, [runUpdateCheck, showNativeMessage]);

  const handleOpenExampleCommand = useCallback(() => {
    setShowOpenExampleModal(true);
  }, []);
  const handleOpenFromArxivCommand = useCallback(() => {
    setShowOpenFromArxivModal(true);
  }, []);
  const handleOpenSvgExportCommand = useCallback((svgResult: EmitSvgResult) => {
    setSvgExportSvgResult(svgResult);
  }, []);
  const handleOpenPngExportCommand = useCallback((svgResult: EmitSvgResult) => {
    setPngExportSvgResult(svgResult);
  }, []);
  const handleShowCompiledPictureCommand = useCallback(() => {
    setCompiledPictureSource({
      source,
      activeFigureId
    });
  }, [activeFigureId, source]);
  const handleOpenSettingsCommand = useCallback(() => {
    setShowSettingsModal(true);
  }, []);
  const handleCheckForUpdatesCommand = useCallback(() => {
    void handleManualUpdateCheck();
  }, [handleManualUpdateCheck]);
  const handleOpenInsertEquationCommand = useCallback(() => {
    setEquationModalState({ mode: "insert" });
  }, []);
  const handleOpenEditEquationCommand = useCallback((target: EquationNodeTarget) => {
    setEquationModalState({ mode: "edit", target });
  }, []);
  const handleOpenRepeatCommand = useCallback(() => {
    const nextState = resolveRepeatModalState({
      source,
      activeFigureId,
      selectedElementIds,
      scene: snapshot.scene,
      documentId: activeDocumentId
    });
    if (nextState) {
      setRepeatModalState(nextState);
    }
  }, [activeDocumentId, activeFigureId, selectedElementIds, snapshot.scene, source]);
  const handleFocusAssistantCommand = useCallback(() => {
    dispatch({ type: "SET_RIGHT_SIDEBAR_TAB", tab: "assistant" });
  }, [dispatch]);
  const handleRequestCloseDocumentCommand = useCallback((documentId: string) => {
    requestCloseIntentRef.current({ kind: "close-document", documentId });
  }, []);
  const handleRequestCloseAllDocumentsCommand = useCallback(() => {
    requestCloseIntentRef.current({ kind: "close-all" });
  }, []);
  const handleRequestQuitAppCommand = useCallback(() => {
    requestCloseIntentRef.current({ kind: "window-close" });
  }, []);
  const handleRequestSaveDocumentCommand = useCallback((documentId: string, mode: "save" | "save-as") => {
    void saveDocument(documentId, mode);
  }, [saveDocument]);
  const handleOpenSaveWorkspaceCommand = useCallback(() => {
    setShowSaveWorkspaceModal(true);
  }, []);
  const handleOpenManageWorkspacesCommand = useCallback(() => {
    setShowManageWorkspacesModal(true);
  }, []);
  const handleShowAboutCommand = useCallback(() => {
    setShowAboutModal(true);
  }, []);

  const commandRuntime = useEditorCommandRuntime({
    onOpenExample: handleOpenExampleCommand,
    onOpenFromArxiv: handleOpenFromArxivCommand,
    onOpenSvgExport: handleOpenSvgExportCommand,
    onOpenPngExport: handleOpenPngExportCommand,
    onShowCompiledPicture: handleShowCompiledPictureCommand,
    onOpenSettings: handleOpenSettingsCommand,
    onCheckForUpdates: handleCheckForUpdatesCommand,
    updateCheckBusy: updateCheckBusy || updateModalPhase.status === "installing",
    onOpenInsertEquation: handleOpenInsertEquationCommand,
    onOpenEditEquation: handleOpenEditEquationCommand,
    onOpenRepeat: handleOpenRepeatCommand,
    onFocusAssistant: handleFocusAssistantCommand,
    onRequestCloseDocument: handleRequestCloseDocumentCommand,
    onRequestCloseAllDocuments: handleRequestCloseAllDocumentsCommand,
    onRequestQuitApp: handleRequestQuitAppCommand,
    onRequestSaveDocument: handleRequestSaveDocumentCommand,
    onOpenSaveWorkspace: handleOpenSaveWorkspaceCommand,
    onOpenManageWorkspaces: handleOpenManageWorkspacesCommand,
    onShowAbout: handleShowAboutCommand
  });
  const commandRuntimeRef = useRef(commandRuntime);
  const toolModeRef = useRef(toolMode);
  commandRuntimeRef.current = commandRuntime;
  toolModeRef.current = toolMode;

  useEffect(() => {
    const apply = (dark: boolean) => {
      document.documentElement.dataset.colorScheme = dark ? "dark" : "light";
      if (dark && canvasInvert) {
        document.documentElement.dataset.canvasInvert = "true";
      } else {
        delete document.documentElement.dataset.canvasInvert;
      }
      void platform.window?.setTheme?.(colorScheme === "system" ? null : dark ? "dark" : "light");
    };
    if (colorScheme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches);
      const handler = (e: MediaQueryListEvent) => { apply(e.matches); };
      mq.addEventListener("change", handler);
      return () => { mq.removeEventListener("change", handler); };
    } else {
      apply(colorScheme === "dark");
    }
  }, [canvasInvert, colorScheme, platform.window]);

  useEffect(() => {
    if (!platform.updates || startupUpdateCheckStarted) {
      return;
    }
    startupUpdateCheckStarted = true;
    void runUpdateCheck().catch((error: unknown) => {
      if (typeof console !== "undefined" && typeof console.info === "function") {
        console.info("[tikz-editor] Startup update check failed.", error);
      }
    });
  }, [platform.updates, runUpdateCheck]);

  useEffect(() => {
    const desktopOs = desktopOsFromPlatformId(platform.id);
    if (desktopOs) {
      document.documentElement.dataset.desktopOs = desktopOs;
      return;
    }
    delete document.documentElement.dataset.desktopOs;
  }, [platform.id]);

  useEffect(() => {
    sourceRef.current = source;
    snapshotRef.current = snapshot;
    activeDocumentIdRef.current = activeDocumentId;
    documentsRef.current = documents;
  }, [activeDocumentId, documents, snapshot, source]);

  useEffect(() => {
    for (const doc of Object.values(documentsRef.current)) {
      applyLinkedReadDecision(doc, "restore");
    }
  }, [applyLinkedReadDecision]);

  useEffect(() => {
    const checkActiveDocument = () => {
      const doc = documentsRef.current[activeDocumentIdRef.current];
      if (doc) {
        applyLinkedReadDecision(doc, "focus");
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkActiveDocument();
      }
    };
    window.addEventListener("focus", checkActiveDocument);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", checkActiveDocument);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [applyLinkedReadDecision]);

  useEffect(() => {
    const doc = documentsRef.current[activeDocumentId];
    const pathKey = linkedFilePathKey(doc?.fileRef);
    if (pathKey) {
      pendingBackgroundLinkedPathsRef.current.delete(pathKey);
    }
    if (doc) {
      applyLinkedReadDecision(doc, "tab");
    }
  }, [activeDocumentId, applyLinkedReadDecision]);

  useEffect(() => {
    const sync = getActiveEditorPlatform().files?.syncLinkedFileWatches;
    if (typeof sync !== "function") {
      return;
    }
    const fileRefs = Object.values(documentsRef.current)
      .map((doc) => doc.fileRef)
      .filter((fileRef): fileRef is DocumentFileRef => Boolean(fileRef && linkedFilePathKey(fileRef)));
    void sync(fileRefs);
    return () => {
      void sync([]);
    };
  }, [linkedFileWatchSignature]);

  useEffect(() => {
    const bind = getActiveEditorPlatform().files?.bindLinkedFileChange;
    if (typeof bind !== "function") {
      return;
    }
    const timers = linkedWatchTimersRef.current;
    const pendingBackgroundPaths = pendingBackgroundLinkedPathsRef.current;
    const unbind = bind((fileRef) => {
      const pathKey = linkedFilePathKey(fileRef);
      if (!pathKey) {
        return;
      }
      const existing = timers.get(pathKey);
      if (existing != null) {
        window.clearTimeout(existing);
      }
      const timer = window.setTimeout(() => {
        timers.delete(pathKey);
        const docsForPath = Object.values(documentsRef.current).filter((doc) => linkedFilePathKey(doc.fileRef) === pathKey);
        const activeDoc = docsForPath.find((doc) => doc.id === activeDocumentIdRef.current);
        if (activeDoc) {
          applyLinkedReadDecision(activeDoc, "focus");
          return;
        }
        if (docsForPath.length > 0) {
          pendingBackgroundPaths.add(pathKey);
        }
      }, 350);
      timers.set(pathKey, timer);
    });
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
      pendingBackgroundPaths.clear();
      if (typeof unbind === "function") {
        unbind();
      }
    };
  }, [applyLinkedReadDecision]);

  useEffect(() => {
    if (!repeatModalState) {
      setRepeatPreviewModel(null);
      return;
    }
    if (repeatModalState.documentId !== activeDocumentId || repeatModalState.source !== source) {
      setRepeatModalState(null);
      setRepeatPreviewModel(null);
    }
  }, [activeDocumentId, repeatModalState, source]);

  useEffect(() => {
    if (!repeatModalState) {
      setRepeatPreviewModel(null);
      return;
    }
    if (!snapshot.svg?.viewBox) {
      setRepeatPreviewModel(null);
      return;
    }

    const action = {
      kind: "repeatElements" as const,
      elementIds: repeatModalState.selectedSourceIds,
      columns: repeatModalState.columns,
      rows: repeatModalState.rows,
      horizontalStep: repeatModalState.horizontalStepPt,
      verticalStep: repeatModalState.verticalStepPt
    };
    const result = applyEditAction(repeatModalState.source, [], action, {
      parseOptions: repeatModalState.activeFigureId == null ? {} : { activeFigureId: repeatModalState.activeFigureId }
    });
    if (result.kind !== "success" && result.kind !== "partial") {
      setRepeatPreviewModel(null);
      return;
    }
    const previewGroupSpan = result.patches[0]?.newSpan;
    if (!previewGroupSpan) {
      setRepeatPreviewModel(null);
      return;
    }

    let cancelled = false;
    void computeSnapshot({
      id: crypto.randomUUID(),
      source: result.newSource,
      activeFigureId: repeatModalState.activeFigureId
    }).then((response) => {
      if (cancelled) {
        return;
      }
      const previewScene = buildRepeatPreviewScene(response.snapshot.scene, previewGroupSpan);
      if (!previewScene || previewScene.elements.length === 0) {
        setRepeatPreviewModel(null);
        return;
      }
      setRepeatPreviewModel(
        emitSvgModel(previewScene, {
          padding: 18,
          viewBox: snapshot.svg!.viewBox
        })
      );
    }).catch(() => {
      if (!cancelled) {
        setRepeatPreviewModel(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [repeatModalState, snapshot.svg]);

  useEffect(() => {
    const scheduler = createSingleFlightScheduler<ComputeRequest, ComputeResponse>({
      run: (request) => computeSnapshot(request),
      onStart: (request) => {
        if ((request.kind ?? "render") === "prewarm") {
          return;
        }
        dispatch({ type: "COMPUTE_REQUESTED", requestId: request.id, documentId: request.documentId });
      },
      onSuccess: (_request, response) => {
        if ((_request.kind ?? "render") === "prewarm") {
          return;
        }
        dispatch({
          type: "SNAPSHOT_READY",
          requestId: response.id,
          snapshot: response.snapshot,
          documentId: response.documentId
        });
      },
      onError: (request) => {
        if ((request.kind ?? "render") === "prewarm") {
          return;
        }
        dispatch({
          type: "SNAPSHOT_READY",
          requestId: request.id,
          snapshot: makeEmptySnapshot(request.source),
          documentId: request.documentId
        });
      }
    });
    computeSchedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      computeSchedulerRef.current = null;
    };
  }, [dispatch]);

  // ── Compute pipeline ─────────────────────────────────────────────────────────
  // Keep at most one in-flight compute; while in-flight, coalesce to the latest source.
  const changedSourceIds = useMemo(
    () => lastEditChangedSourceIds ?? (activeSourceScrubSourceId ? [activeSourceScrubSourceId] : null),
    [activeSourceScrubSourceId, lastEditChangedSourceIds]
  );
  const trigger = computeTrigger(activeCanvasDragKind, activeSourceScrubSourceId);
  const isDragComputeTrigger = trigger === "drag-element" || trigger === "drag-handle";
  if (isDragComputeTrigger && !dragRenderViewBoxRef.current && snapshot.svg?.viewBox) {
    dragRenderViewBoxRef.current = snapshot.svg.viewBox;
  } else if (!isDragComputeTrigger) {
    dragRenderViewBoxRef.current = null;
  }
  const renderViewBox = isDragComputeTrigger ? dragRenderViewBoxRef.current ?? null : null;
  const typingComputeDelay = trigger === "other" && changedSourceIds == null
    ? (source.length > 80_000 ? 220 : 120)
    : null;

  useEffect(() => {
    const scheduler = computeSchedulerRef.current;
    if (!scheduler || typingComputeDelay != null) {
      return;
    }
    setMathJaxFont(mathJaxFont);
    scheduler.schedule({
      id: crypto.randomUUID(),
      documentId: activeDocumentId,
      kind: "render",
      source,
      sourceRevision,
      activeFigureId,
      changedSourceIds,
      patches: lastEditPatches ? [...lastEditPatches] : null,
      patchBaseRevision: lastEditPatchBaseRevision,
      trigger,
      renderViewBox
    });
  }, [activeDocumentId, activeFigureId, changedSourceIds, dispatch, lastEditPatchBaseRevision, lastEditPatches, mathJaxFont, renderViewBox, source, sourceRevision, trigger, typingComputeDelay]);

  useDebouncedEffect(() => {
    const scheduler = computeSchedulerRef.current;
    if (!scheduler || typingComputeDelay == null) {
      return;
    }
    setMathJaxFont(mathJaxFont);
    scheduler.schedule({
      id: crypto.randomUUID(),
      documentId: activeDocumentId,
      kind: "render",
      source,
      sourceRevision,
      activeFigureId,
      changedSourceIds,
      patches: lastEditPatches ? [...lastEditPatches] : null,
      patchBaseRevision: lastEditPatchBaseRevision,
      trigger
    });
  }, typingComputeDelay, [activeDocumentId, activeFigureId, changedSourceIds, dispatch, lastEditPatchBaseRevision, lastEditPatches, mathJaxFont, source, sourceRevision, trigger, typingComputeDelay]);

  useEffect(() => {
    let prewarmTimer: number | null = null;

    const clearPrewarmTimer = () => {
      if (prewarmTimer == null) {
        return;
      }
      window.clearTimeout(prewarmTimer);
      prewarmTimer = null;
    };

    const isPrewarmable = (state: ReturnType<typeof useEditorStore.getState>, hoveredElementId: string | null): hoveredElementId is string => (
      state.activeCanvasDragKind == null &&
      state.activeSourceScrubSourceId == null &&
      state.pendingRequestId == null &&
      hoveredElementId != null &&
      state.snapshot.source === state.source
    );

    const scheduleFromState = (state: ReturnType<typeof useEditorStore.getState>) => {
      const hoveredElementId = state.hoveredElementId;
      clearPrewarmTimer();
      if (!isPrewarmable(state, hoveredElementId)) {
        return;
      }
      prewarmTimer = window.setTimeout(() => {
        prewarmTimer = null;
        const latest = useEditorStore.getState();
        if (latest.hoveredElementId !== hoveredElementId || !isPrewarmable(latest, hoveredElementId)) {
          return;
        }
        const scheduler = computeSchedulerRef.current;
        if (!scheduler) {
          return;
        }
        scheduler.schedule({
          id: crypto.randomUUID(),
          documentId: latest.activeDocumentId,
          kind: "prewarm",
          source: latest.source,
          activeFigureId: latest.activeFigureId,
          changedSourceIds: [hoveredElementId],
          trigger: "drag-element"
        });
      }, 120);
    };

    scheduleFromState(useEditorStore.getState());
    const unsubscribe = useEditorStore.subscribe(scheduleFromState);
    return () => {
      clearPrewarmTimer();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!platform.assistant?.bindEvents) {
      return;
    }
    const assistantApi = platform.assistant;
    const bindAssistantEvents = assistantApi.bindEvents!;

    async function respondToDynamicTool(event: Extract<AssistantEvent, { type: "dynamic-tool-call" }>): Promise<void> {
      const doc = documentsRef.current[event.documentId];
      if (!doc) {
        return;
      }
      const sourceForDoc = event.documentId === activeDocumentIdRef.current ? sourceRef.current : doc.source;
      const snapshotForDoc = event.documentId === activeDocumentIdRef.current ? snapshotRef.current : doc.snapshot;
      const args = (event.arguments ?? {}) as Record<string, unknown>;

      const respond = async (success: boolean, text: string, imageUrl?: string) => {
        const contentItems: unknown[] = [{ type: "inputText", text }];
        if (imageUrl) contentItems.push({ type: "inputImage", imageUrl });
        await assistantApi.respondToDynamicToolCall?.({
          documentId: event.documentId,
          requestId: event.requestId,
          result: { success, contentItems }
        });
      };

      // ── Resolve snapshot for figure_index (if provided) ─────────────
      // figure_index is 1-indexed; omit or 0 to use the active figure.
      const figureIndexArg = typeof args.figure_index === "number" ? args.figure_index : 0;
      let targetSnapshot = snapshotForDoc;
      let targetFigureId = snapshotForDoc.activeFigureId;
      if (figureIndexArg > 0 && snapshotForDoc.figures.length > 1) {
        const idx = figureIndexArg - 1;
        if (idx < 0 || idx >= snapshotForDoc.figures.length) {
          await respond(false, `Invalid figure_index ${figureIndexArg}. Document has ${snapshotForDoc.figures.length} figure(s).`);
          return;
        }
        const requestedFigId = snapshotForDoc.figures[idx].id;
        if (requestedFigId !== snapshotForDoc.activeFigureId) {
          try {
            const result = await computeSnapshot({
              id: crypto.randomUUID(),
              documentId: event.documentId,
              kind: "render",
              source: sourceForDoc,
              activeFigureId: requestedFigId,
              changedSourceIds: null,
              patches: null,
              trigger: "other"
            });
            targetSnapshot = result.snapshot;
            targetFigureId = requestedFigId;
          } catch {
            await respond(false, `Failed to compute snapshot for figure ${figureIndexArg}.`);
            return;
          }
        }
      }

      // ── get_diagnostics ───────────────────────────────────────────────
      if (event.tool === "get_diagnostics") {
        const { buildDiagnosticsText: buildDiag } = await import("./assistant-tool-handlers");
        const text = buildDiag(sourceForDoc, targetSnapshot);
        await respond(true, text === null || text.length === 0 ? "No diagnostics — source parses cleanly." : text);
        return;
      }

      // ── get_element_list ──────────────────────────────────────────────
      if (event.tool === "get_element_list") {
        const { buildElementList } = await import("./assistant-tool-handlers");
        await respond(true, buildElementList(sourceForDoc, targetSnapshot));
        return;
      }

      // ── get_node_anchors ──────────────────────────────────────────────
      if (event.tool === "get_node_anchors") {
        const { buildNodeAnchors } = await import("./assistant-tool-handlers");
        const nodeName = typeof args.node_name === "string" ? args.node_name : "";
        await respond(true, buildNodeAnchors(targetSnapshot, nodeName));
        return;
      }

      // ── get_bounds ────────────────────────────────────────────────────
      if (event.tool === "get_bounds") {
        const { buildBoundsText } = await import("./assistant-tool-handlers");
        await respond(true, buildBoundsText(targetSnapshot));
        return;
      }

      // ── get_latest_preview_png ────────────────────────────────────────
      const hasOverlayCode = typeof args.overlay_code === "string" && args.overlay_code.length > 0;
      const hasGrid = args.show_grid != null;
      const hasZoom = args.zoom_region != null;

      let svgToRender = targetSnapshot.svg;
      let sourceMatches = targetSnapshot.source === sourceForDoc;

      // If overlay_code is requested, re-render with modified source
      if (hasOverlayCode && sourceMatches) {
        try {
          const { injectOverlayCode } = await import("./assistant-tool-handlers");
          const targetFig = targetSnapshot.figures.find((f) => f.id === targetFigureId);
          const modifiedSource = injectOverlayCode(sourceForDoc, args.overlay_code as string, targetFig?.span);
          const result = await computeSnapshot({
            id: crypto.randomUUID(),
            documentId: event.documentId,
            kind: "render",
            source: modifiedSource,
            activeFigureId: targetFigureId,
            changedSourceIds: null,
            patches: null,
            trigger: "other"
          });
          svgToRender = result.snapshot.svg;
          sourceMatches = true;
        } catch {
          await respond(false, "Failed to render with overlay code.");
          return;
        }
      }

      if (!svgToRender || !sourceMatches) {
        await respond(false, "Preview could not be rendered.");
        return;
      }

      try {
        const { applyPreviewEnhancements } = await import("./assistant-tool-handlers");
        const { renderPngExport } = await import("./export-commands");

        let enhancedSvg = svgToRender;
        if (hasGrid || hasZoom) {
          enhancedSvg = applyPreviewEnhancements(svgToRender, {
            showGrid: hasGrid ? (args.show_grid as { spacing?: number; color?: string }) : undefined,
            zoomRegion: hasZoom ? (args.zoom_region as { min_x: number; min_y: number; max_x: number; max_y: number }) : undefined
          });
        }

        const rendered = await renderPngExport(enhancedSvg, { dpi: 144, transparentBackground: false });
        const pngBase64 = await blobToBase64(rendered.blob);
        const dataUrl = `data:${rendered.artifact.mimeType};base64,${pngBase64}`;

        let description = "Rendered an updated PNG preview";
        if (hasOverlayCode) description += " with overlay code";
        if (hasGrid) description += " with coordinate grid";
        if (hasZoom) {
          const z = args.zoom_region as { min_x: number; min_y: number; max_x: number; max_y: number };
          description += ` zoomed to (${z.min_x},${z.min_y})–(${z.max_x},${z.max_y})`;
        }
        description += ".";

        await respond(true, description, dataUrl);
      } catch (error) {
        await respond(false, error instanceof Error ? error.message : String(error));
      }
    }

    const unbind = bindAssistantEvents((event) => {
      switch (event.type) {
        case "thread-ready":
          dispatch({
            type: "ASSISTANT_THREAD_READY",
            documentId: event.documentId,
            threadId: event.thread.threadId,
            workspacePath: event.thread.workspacePath,
            figurePath: event.thread.figurePath,
            previewPath: event.thread.previewPath
          });
          break;
        case "account-updated":
        case "login-completed":
        case "rate-limits-updated":
          break;
        case "thread-state":
          dispatch({ type: "ASSISTANT_THREAD_LOADED", documentId: event.documentId, state: event.state });
          break;
        case "turn-status":
          dispatch({
            type: "ASSISTANT_TURN_STATUS",
            documentId: event.documentId,
            status: event.status,
            turnId: event.turnId ?? null,
            error: event.error ?? null
          });
          break;
        case "item-started":
          dispatch({ type: "ASSISTANT_ITEM_STARTED", documentId: event.documentId, item: event.item });
          break;
        case "item-updated":
          dispatch({ type: "ASSISTANT_ITEM_UPDATED", documentId: event.documentId, item: event.item });
          break;
        case "item-completed":
          dispatch({ type: "ASSISTANT_ITEM_COMPLETED", documentId: event.documentId, item: event.item });
          break;
        case "item-delta":
          dispatch({
            type: "ASSISTANT_ITEM_DELTA",
            documentId: event.documentId,
            itemId: event.itemId,
            deltaType: event.deltaType,
            delta: event.delta
          });
          break;
        case "approval-requested":
          dispatch({ type: "ASSISTANT_APPROVAL_REQUESTED", documentId: event.documentId, approval: event.approval });
          break;
        case "approval-cleared":
          dispatch({ type: "ASSISTANT_APPROVAL_CLEARED", documentId: event.documentId, requestId: event.requestId });
          break;
        case "source-updated":
          dispatch({
            type: "ASSISTANT_SOURCE_UPDATED",
            documentId: event.documentId,
            source: event.source,
            revisionToken: event.revisionToken,
            historyMergeKey: `assistant-turn:${event.documentId}`
          });
          break;
        case "dynamic-tool-call":
          void respondToDynamicTool(event);
          break;
        case "error":
          dispatch({ type: "ASSISTANT_SET_ERROR", documentId: event.documentId, message: event.message });
          break;
      }
    });

    return typeof unbind === "function" ? unbind : undefined;
  }, [dispatch, platform.assistant]);

  const buildCurrentPreviewBase64 = useCallback(async (
    sourceForDoc: string,
    snapshotForDoc: ComputeResponse["snapshot"]
  ): Promise<string | null> => {
    if (!snapshotForDoc.svg || snapshotForDoc.source !== sourceForDoc) {
      return null;
    }
    const { renderPngExport } = await import("./export-commands");
    const rendered = await renderPngExport(snapshotForDoc.svg, { dpi: 144, transparentBackground: false });
    return await blobToBase64(rendered.blob);
  }, []);

  const handleAssistantPrompt = useCallback(async (
    prompt: string,
    model: string | null,
    attachments: AssistantComposerImageAttachment[]
  ): Promise<void> => {
    const documentId = activeDocumentIdRef.current;
    const currentDocument = documentsRef.current[documentId];
    const currentSource = currentDocument?.source ?? sourceRef.current;
    const currentSnapshot = currentDocument?.snapshot ?? snapshotRef.current;
    const { buildFigureContext: buildFigCtx, buildDiagnosticsText: buildDiag } = await import("./assistant-tool-handlers");
    const figureContext = buildFigCtx(currentSource, currentSnapshot);
    const diagnosticsText = buildDiag(currentSource, currentSnapshot);
    const pastedImages = await Promise.all(
      attachments.map(async (attachment) => ({
        base64: await blobToBase64(attachment.blob),
        mimeType: attachment.mimeType,
        fileName: attachment.fileName
      }))
    );
    const optimisticImageContent = pastedImages.map((image) => ({
      type: "image" as const,
      url: `data:${image.mimeType};base64,${image.base64}`
    }));
    dispatch({ type: "SET_RIGHT_SIDEBAR_TAB", tab: "assistant" });
    const isSteeringActiveTurn =
      currentDocument?.assistantTurnStatus === "starting" || currentDocument?.assistantTurnStatus === "inProgress";
    if (!isSteeringActiveTurn) {
      dispatch({ type: "ASSISTANT_TURN_STATUS", documentId, status: "starting", turnId: null });
    }
    dispatch({
      type: "ASSISTANT_ITEM_STARTED",
      documentId,
      item: {
        type: "userMessage",
        id: `optimistic-user-message:${documentId}:${Date.now()}`,
        content: [
          { type: "text", text: prompt },
          ...optimisticImageContent
        ]
      }
    });
    try {
      const assistant = getActiveEditorPlatform().assistant;
      if (isSteeringActiveTurn) {
        await assistant?.steerTurn?.({
          documentId,
          prompt,
          pastedImages: pastedImages.length > 0 ? pastedImages : undefined
        });
        return;
      }
      const thread = await assistant?.ensureDocumentThread?.({
        documentId,
        source: currentSource,
        threadId: currentDocument?.assistantThreadId ?? null,
        workspacePath: currentDocument?.assistantWorkspacePath ?? null,
        figurePath: currentDocument?.assistantFigurePath ?? null,
        previewPath: currentDocument?.assistantPreviewPath ?? null
      });
      if (thread) {
        dispatch({
          type: "ASSISTANT_THREAD_READY",
          documentId,
          threadId: thread.threadId,
          workspacePath: thread.workspacePath,
          figurePath: thread.figurePath,
          previewPath: thread.previewPath
        });
      }
      const pngBase64 = await buildCurrentPreviewBase64(currentSource, currentSnapshot);
      await assistant?.startTurn?.({
        documentId,
        prompt,
        source: currentSource,
        pngBase64,
        pastedImages: pastedImages.length > 0 ? pastedImages : undefined,
        threadId: thread?.threadId ?? currentDocument?.assistantThreadId ?? null,
        workspacePath: thread?.workspacePath ?? currentDocument?.assistantWorkspacePath ?? null,
        figurePath: thread?.figurePath ?? currentDocument?.assistantFigurePath ?? null,
        previewPath: thread?.previewPath ?? currentDocument?.assistantPreviewPath ?? null,
        model,
        figureContext,
        diagnosticsText
      });
    } catch (error) {
      if (!isSteeringActiveTurn) {
        dispatch({
          type: "ASSISTANT_TURN_STATUS",
          documentId,
          status: "failed",
          turnId: null,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      dispatch({
        type: "ASSISTANT_SET_ERROR",
        documentId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }, [buildCurrentPreviewBase64, dispatch]);

  const handleInterruptAssistantTurn = useCallback(async (): Promise<void> => {
    const documentId = activeDocumentIdRef.current;
    try {
      await getActiveEditorPlatform().assistant?.interruptTurn?.({ documentId });
    } catch (error) {
      dispatch({
        type: "ASSISTANT_SET_ERROR",
        documentId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }, [dispatch]);

  const handleAssistantNewChat = useCallback((): void => {
    dispatch({ type: "ASSISTANT_NEW_CHAT", documentId: activeDocumentIdRef.current });
  }, [dispatch]);

  useEffect(() => {
    const unbind = platform.menu?.bindCommandHandler?.((commandId) => {
      commandRuntimeRef.current.runCommand(commandId, "platform");
    });
    return typeof unbind === "function" ? unbind : undefined;
  }, [platform.menu]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      installAppProfilingRecorder();
    }
    const globalLike = globalThis as typeof globalThis & {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        setSource: (nextSource: string) => void;
        getSource: () => string;
        getSourceRevision: () => number;
        getSnapshotSource: () => string;
        getPendingRequestId: () => string | null;
        getMenuDefinition: () => typeof menuDefinition;
        getCommandState: (commandId: string) => { enabled: boolean; known: boolean };
        runCommand: (commandId: string) => boolean;
        selectFirstFigure: () => void;
        selectAllElements: () => void;
        selectSourceIds: (sourceIds: string[]) => void;
        clearSelection: () => void;
        getSelectedSourceIds: () => string[];
        getSceneSourceIds: () => string[];
        getActiveFigureId: () => string | null;
        getFigureCount: () => number;
        getActiveCanvasDragKind: () => string | null;
        getCanvasTransform: () => { translateX: number; translateY: number; scale: number };
        setCanvasTransform: (transform: { translateX: number; translateY: number; scale: number }) => void;
        getSceneTextDebug: () => Array<{
          sourceId: string;
          sceneTextId: string;
          text: string;
          renderSourceText: string | null;
          paragraphId: string | null;
          layoutKind: string | null;
        }>;
        resetProfilingSession: (label?: string | null) => void;
        getProfilingSnapshot: () => ReturnType<typeof readAppProfilingSnapshot>;
      };
    };
    globalLike.__TIKZ_EDITOR_APP_TEST_API__ = {
      setSource: (nextSource) => {
        dispatch({ type: "CODE_EDITED", source: nextSource });
      },
      getSource: () => {
        return useEditorStore.getState().source;
      },
      getSourceRevision: () => {
        return useEditorStore.getState().sourceRevision;
      },
      getSnapshotSource: () => {
        return snapshotRef.current.source;
      },
      getPendingRequestId: () => {
        return useEditorStore.getState().pendingRequestId;
      },
      getMenuDefinition: () => {
        return menuDefinition;
      },
      getCommandState: (commandId) => {
        const binding = commandRuntimeRef.current.bindings[commandId as keyof typeof commandRuntimeRef.current.bindings];
        return {
          enabled: binding?.enabled ?? false,
          known: binding != null
        };
      },
      runCommand: (commandId) => {
        return commandRuntimeRef.current.runCommand(commandId as keyof typeof commandRuntimeRef.current.bindings, "platform");
      },
      selectFirstFigure: () => {
        const firstFigureId = snapshotRef.current.figures[0]?.id ?? null;
        dispatch({ type: "SET_ACTIVE_FIGURE", figureId: firstFigureId });
      },
      selectAllElements: () => {
        const ids = Array.from(
          new Set(
            (snapshotRef.current.scene?.elements ?? []).map((element) => element.sourceRef.sourceId)
          )
        );
        dispatch({ type: "SELECT_RANGE", ids });
      },
      selectSourceIds: (sourceIds) => {
        dispatch({ type: "SELECT_RANGE", ids: sourceIds });
      },
      clearSelection: () => {
        dispatch({ type: "CLEAR_SELECTION" });
      },
      getSelectedSourceIds: () => {
        return [...useEditorStore.getState().selectedElementIds];
      },
      getSceneSourceIds: () => {
        const sourceIds = new Set<string>();
        for (const element of snapshotRef.current.scene?.elements ?? []) {
          sourceIds.add(element.sourceRef.sourceId);
          if (element.matrixCell) {
            sourceIds.add(element.matrixCell.matrixSourceId);
            sourceIds.add(element.matrixCell.cellSourceId);
          }
          if (element.treeChild) {
            sourceIds.add(element.treeChild.treeRootSourceId);
            sourceIds.add(element.treeChild.parentSourceId);
            sourceIds.add(element.treeChild.childSourceId);
          }
        }
        return [...sourceIds];
      },
      getActiveFigureId: () => {
        return useEditorStore.getState().activeFigureId;
      },
      getFigureCount: () => {
        return useEditorStore.getState().snapshot.figures.length;
      },
      getActiveCanvasDragKind: () => {
        return useEditorStore.getState().activeCanvasDragKind;
      },
      getCanvasTransform: () => {
        const transform = useEditorStore.getState().canvasTransform;
        return {
          translateX: transform.translateX,
          translateY: transform.translateY,
          scale: transform.scale
        };
      },
      setCanvasTransform: (transform) => {
        dispatch({ type: "SET_FIT_TO_CONTENT_MODE", active: false });
        requestAnimationFrame(() => {
          dispatch({ type: "SET_CANVAS_TRANSFORM", transform });
        });
      },
      getSceneTextDebug: () => {
        const elements = snapshotRef.current.scene?.elements ?? [];
        return elements
          .filter((element): element is Extract<(typeof elements)[number], { kind: "Text" }> => element.kind === "Text")
          .map((element) => ({
            sourceId: element.sourceRef.sourceId,
            sceneTextId: element.id,
            text: element.text,
            renderSourceText: element.textRenderInfo?.mode === "mathjax" ? element.textRenderInfo.renderSourceText : null,
            paragraphId: element.textRenderInfo?.mode === "mathjax" ? element.textRenderInfo.paragraphId : null,
            layoutKind: element.textRenderInfo?.mode === "mathjax" ? element.textRenderInfo.layoutKind : null
          }));
      },
      resetProfilingSession: (label) => {
        resetAppProfilingSession(label ?? null);
      },
      getProfilingSnapshot: () => {
        return readAppProfilingSnapshot();
      }
    };
    return () => {
      delete globalLike.__TIKZ_EDITOR_APP_TEST_API__;
    };
  }, [dispatch, menuDefinition]);

  useEffect(() => {
    const unbind = getActiveEditorPlatform().files?.bindOpenRequest?.((opened) => {
      void (async () => {
        const resolved = await resolveOpenedFileForDocument(opened);
        if (resolved.kind === "failure") {
          const alertFn = (globalThis as { alert?: (message?: string) => void }).alert;
          if (typeof alertFn === "function") {
            alertFn(resolved.message);
          }
          return;
        }
        dispatch({ type: "NEW_DOCUMENT", source: resolved.source, title: resolved.title });
        dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: resolved.fileRef });
      })();
    });
    return typeof unbind === "function" ? unbind : undefined;
  }, [dispatch]);

  useEffect(() => {
    const unbind = getActiveEditorPlatform().window?.bindCloseRequest?.(() => {
      requestCloseIntentRef.current({ kind: "window-close" });
    });
    return typeof unbind === "function" ? unbind : undefined;
  }, []);

  useEffect(() => {
    getActiveEditorPlatform().window?.setDocumentState?.({
      title: platform.id.startsWith("desktop") ? "TikZ Editor" : "TikZ Editor Web",
      dirty: snapshot.source !== source
    });
  }, [platform.id, snapshot.source, source]);

  useEffect(() => {
    if (!pendingAutoFit) {
      return;
    }
    if (snapshot.source !== source) {
      return;
    }
    dispatch({ type: "REQUEST_FIT_TO_CONTENT" });
    setPendingAutoFit(false);
  }, [dispatch, pendingAutoFit, snapshot.source, source]);

  const nativeMenuCommandState = useMemo(() => {
    const entries = Object.entries(commandRuntime.bindings).map(([commandId, binding]) => {
      const state = { enabled: binding.enabled, checked: binding.checked };
      return [commandId, state] as const;
    });
    return {
      commandStates: Object.fromEntries(entries) as Record<keyof typeof commandRuntime.bindings, { enabled: boolean; checked?: boolean }>,
      signature: entries.map(([commandId, state]) =>
        `${commandId}:${state.enabled ? "1" : "0"}:${state.checked === true ? "1" : "0"}`
      ).join("|")
    };
  }, [commandRuntime]);
  const nativeMenuCommandStatesRef = useRef(nativeMenuCommandState.commandStates);
  useEffect(() => {
    nativeMenuCommandStatesRef.current = nativeMenuCommandState.commandStates;
  }, [nativeMenuCommandState.commandStates]);
  const workspaceSignature = useMemo(
    () => userWorkspaces.map((ws) => `${ws.id}:${ws.name}`).join("|"),
    [userWorkspaces]
  );

  useEffect(() => {
    const sync = platform.menu?.syncNativeMenu;
    if (typeof sync !== "function") {
      return;
    }
    void sync({
      definition: menuDefinition,
      commandStates: nativeMenuCommandStatesRef.current,
      workspaceSignature
    });
  }, [menuDefinition, nativeMenuCommandState.signature, platform.menu, workspaceSignature]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) {
        return;
      }

      const runtime = commandRuntimeRef.current;
      const currentToolMode = toolModeRef.current;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && key === "f") {
        if (runtime.runCommand(APP_MENU_COMMAND_IDS.FORMAT_TIKZ, "shortcut")) {
          e.preventDefault();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && key === "a") {
        if (runtime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_ASSISTANT_PANEL, "shortcut")) {
          e.preventDefault();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "n") {
        runtime.runCommand(APP_MENU_COMMAND_IDS.NEW_DOCUMENT, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "w") {
        runtime.runCommand(APP_MENU_COMMAND_IDS.CLOSE_DOCUMENT, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "s") {
        runtime.runCommand(APP_MENU_COMMAND_IDS.SAVE_DOCUMENT, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "o") {
        runtime.runCommand(APP_MENU_COMMAND_IDS.OPEN_DOCUMENT, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "0") {
        if (runtime.runCommand(APP_MENU_COMMAND_IDS.FIT_TO_CONTENT, "shortcut")) {
          e.preventDefault();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === ",") {
        if (runtime.runCommand(APP_MENU_COMMAND_IDS.OPEN_SETTINGS, "shortcut")) {
          e.preventDefault();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === "=" || key === "+")) {
        if (runtime.runCommand(APP_MENU_COMMAND_IDS.ZOOM_IN, "shortcut")) {
          e.preventDefault();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "-") {
        if (runtime.runCommand(APP_MENU_COMMAND_IDS.ZOOM_OUT, "shortcut")) {
          e.preventDefault();
        }
        return;
      }

      // Ctrl+Shift+D: toggle dev panel
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "d") {
        runtime.runCommand(APP_MENU_COMMAND_IDS.TOGGLE_DEV_PANEL, "shortcut");
        e.preventDefault();
        return;
      }

      // Ctrl/Cmd+Shift+E: edit equation when possible, otherwise insert equation.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && key === "e") {
        const edited = runtime.runCommand(APP_MENU_COMMAND_IDS.EDIT_EQUATION, "shortcut");
        if (!edited) {
          runtime.runCommand(APP_MENU_COMMAND_IDS.INSERT_EQUATION, "shortcut");
        }
        e.preventDefault();
        return;
      }

      const target = e.target;
      const activeElement = document.activeElement;
      const inCodeMirror = isCodeMirrorEventTarget(target) || isCodeMirrorEventTarget(activeElement);
      if (inCodeMirror) return;

      // Keep browser/field-native behavior for editable fields outside CM.
      const editableShortcutTarget = isEditableShortcutTarget(target)
        ? target
        : (isEditableShortcutTarget(activeElement) ? activeElement : null);
      if (editableShortcutTarget) {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "a") {
          if (selectAllInEditableTarget(editableShortcutTarget)) {
            e.preventDefault();
          }
        }
        return;
      }
      const canvasShortcutContext = isCanvasViewportFocused();

      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === "escape" && currentToolMode !== "select") {
        dispatch({ type: "SET_TOOL_MODE", mode: "select" });
        e.preventDefault();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const hasTextSelection = Boolean(window.getSelection()?.toString().trim());

        if (!e.shiftKey && key === "a") {
          if (!canvasShortcutContext) {
            return;
          }
          const ids = Array.from(
            new Set(
              (snapshotRef.current.scene?.elements ?? []).map((element) => element.sourceRef.sourceId)
            )
          );
          dispatch({ type: "SELECT_RANGE", ids });
          e.preventDefault();
          return;
        }

        if (!e.shiftKey && key === "c") {
          // If canvas is focused, let the native copy event fire there.
          if (canvasShortcutContext) {
            return;
          }
          // If there's a text selection anywhere, let native copy work for it.
          if (hasTextSelection) {
            return;
          }
          // Otherwise, if canvas elements are selected, copy them directly.
          if (runtime.runCommand(APP_MENU_COMMAND_IDS.COPY, "shortcut")) {
            e.preventDefault();
          }
          return;
        }

        if (!e.shiftKey && key === "x") {
          // If canvas is focused, let the native cut event fire there.
          if (canvasShortcutContext) {
            return;
          }
          // If there's a text selection anywhere, let native cut work for it.
          if (hasTextSelection) {
            return;
          }
          // Otherwise, if canvas elements are selected, cut them directly.
          if (runtime.runCommand(APP_MENU_COMMAND_IDS.CUT, "shortcut")) {
            e.preventDefault();
          }
          return;
        }

        if (!e.shiftKey && key === "v") {
          // If canvas is focused, let the native paste event fire there (supports DataTransfer).
          if (canvasShortcutContext) {
            return;
          }
          // Otherwise, paste directly via async clipboard API.
          if (runtime.runCommand(APP_MENU_COMMAND_IDS.PASTE, "shortcut")) {
            e.preventDefault();
          }
          return;
        }

        if (!e.shiftKey && key === "d") {
          if (!canvasShortcutContext) {
            return;
          }
          runtime.runCommand(APP_MENU_COMMAND_IDS.DUPLICATE, "shortcut");
          e.preventDefault();
          return;
        }

        if (!e.shiftKey && key === "g") {
          if (!canvasShortcutContext) {
            return;
          }
          runtime.runCommand(APP_MENU_COMMAND_IDS.GROUP, "shortcut");
          e.preventDefault();
          return;
        }

        if (e.shiftKey && key === "g") {
          if (!canvasShortcutContext) {
            return;
          }
          runtime.runCommand(APP_MENU_COMMAND_IDS.UNGROUP, "shortcut");
          e.preventDefault();
          return;
        }
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const shortcutMode = toolModeFromShortcut(key);
        if (shortcutMode) {
          dispatch({ type: "SET_TOOL_MODE", mode: shortcutMode });
          e.preventDefault();
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === "z") {
        runtime.runCommand(APP_MENU_COMMAND_IDS.UNDO, "shortcut");
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && key === "z") || (!e.shiftKey && key === "y"))) {
        runtime.runCommand(APP_MENU_COMMAND_IDS.REDO, "shortcut");
        e.preventDefault();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [dispatch]);

  const appStyle = {
    "--app-ui-font-size": `${uiFontSizePx}px`,
    "--app-ui-scale": `${uiFontSizePx / 11}`
  } as CSSProperties;

  const loadExampleIntoEditor = (example: TikzOpenExample) => {
    dispatch({ type: "NEW_DOCUMENT", source: example.source, title: example.title });
    setShowOpenExampleModal(false);
    setPendingAutoFit(true);
  };

  const loadArxivCandidateIntoEditor = (candidate: ArxivTikzCandidate) => {
    const fileName = createArxivVirtualFileName(candidate);
    const minimalSource = createMinimalTikzSourceArtifact({
      source: candidate.contextualSource,
      activeFigureId: "figure:0"
    });
    dispatch({ type: "NEW_DOCUMENT", source: minimalSource.text, title: fileName });
    dispatch({
      type: "MARK_DOCUMENT_SAVED",
      fileRef: {
        kind: "virtual",
        name: fileName,
        provider: "download"
      }
    });
    setShowOpenFromArxivModal(false);
    setPendingAutoFit(true);
  };

  async function handleUnsavedDecision(
    decision: UnsavedChangesDecision,
    ctx?: { intent: CloseIntent; dirtyDocumentIds: string[] }
  ): Promise<void> {
    const closeCtx = ctx ?? pendingClose;
    if (!closeCtx) {
      return;
    }
    if (decision === "cancel") {
      setPendingClose(null);
      return;
    }
    if (decision === "discard") {
      setPendingClose(null);
      executeCloseIntent(closeCtx.intent);
      return;
    }

    for (const documentId of closeCtx.dirtyDocumentIds) {
      const doc = documents[documentId];
      if (!doc?.dirty) {
        continue;
      }
      const saved = await saveDocument(documentId, "save");
      if (saved) {
        continue;
      }
      setPendingClose(null);
      return;
    }
    setPendingClose(null);
    executeCloseIntent(closeCtx.intent);
  }

  function handleUpdateLater(): void {
    setShowUpdateModal(false);
    setUpdateDismissedForSession(true);
    setUpdateModalPhase({ status: "idle" });
  }

  function handleUpdateModalClose(): void {
    setShowUpdateModal(false);
    setUpdateModalPhase({ status: "idle" });
  }

  async function handleInstallUpdate(): Promise<void> {
    const updates = getActiveEditorPlatform().updates;
    if (!updates || !availableUpdate) {
      return;
    }
    setUpdateModalPhase({ status: "installing", downloadedBytes: 0 });
    let downloadedBytes = 0;
    try {
      await updates.installUpdate((progress: UpdateInstallProgress) => {
        if (progress.type === "started") {
          downloadedBytes = 0;
          setUpdateModalPhase({
            status: "installing",
            downloadedBytes,
            contentLength: progress.contentLength
          });
          return;
        }
        if (progress.type === "progress") {
          downloadedBytes += progress.chunkLength;
          setUpdateModalPhase((current) => ({
            status: "installing",
            downloadedBytes,
            contentLength: current.status === "installing" ? current.contentLength : undefined
          }));
          return;
        }
        setUpdateModalPhase((current) => ({
          status: "installing",
          downloadedBytes,
          contentLength: current.status === "installing" ? current.contentLength : undefined
        }));
      });
      await updates.relaunch();
    } catch (error) {
      setUpdateModalPhase({
        status: "failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  function isDroppableFile(file: File): boolean {
    const name = file.name.toLowerCase();
    return name.endsWith(".tex") || name.endsWith(".tikz") || name.endsWith(".svg") || name.endsWith(".ipe");
  }

  function onAppDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!dataTransferHasFilePayload(e.dataTransfer)) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!isDesktop) {
      setIsDragOver(true);
    }
  }

  function onAppDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Only clear when leaving the app root entirely
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
      return;
    }
    setIsDragOver(false);
  }

  async function onAppDrop(e: React.DragEvent<HTMLDivElement>) {
    setIsDragOver(false);
    const file = Array.from(e.dataTransfer.files).find(isDroppableFile);
    if (!file) {
      return;
    }
    e.preventDefault();
    const source = await file.text();
    const opened = { source, fileRef: { kind: "virtual" as const, name: file.name } };
    const resolved = await resolveOpenedFileForDocument(opened);
    if (resolved.kind === "failure") {
      return;
    }
    dispatch({ type: "NEW_DOCUMENT", source: resolved.source, title: resolved.title });
    dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: resolved.fileRef });
  }

  return (
    <div
      className={css.app}
      style={appStyle}
      onDragOver={onAppDragOver}
      onDragLeave={onAppDragLeave}
      onDrop={(e) => { void onAppDrop(e); }}
    >
      {platform.menu?.usesNativeMenuBar ? null : (
        <AppMenuBar
          definition={menuDefinition}
          bindings={commandRuntime.bindings}
        />
      )}
      <Toolbar
        updateChip={
          availableUpdate && !showUpdateModal && !updateDismissedForSession
            ? {
                version: availableUpdate.version,
                onClick: () => {
                  setUpdateModalPhase({ status: "idle" });
                  setShowUpdateModal(true);
                }
              }
            : null
        }
      />
      <TabStrip
        onRequestCloseDocument={(documentId) => {
          requestCloseIntent({ kind: "close-document", documentId });
        }}
      />
      <div className={css.body}>
        <DockLayout
          repeatPreviewModel={repeatPreviewModel}
          onSubmitPrompt={handleAssistantPrompt}
          onInterruptTurn={handleInterruptAssistantTurn}
          onNewChat={handleAssistantNewChat}
        />
      </div>
      <StatusBar />
      <Suspense fallback={null}>
        <DevPanel />
      </Suspense>
      {showOpenExampleModal ? (
        <Suspense fallback={null}>
          <OpenExampleModal
            examples={OPEN_EXAMPLE_CATALOG}
            onClose={() => { setShowOpenExampleModal(false); }}
            onSelectExample={loadExampleIntoEditor}
          />
        </Suspense>
      ) : null}
      {showOpenFromArxivModal ? (
        <Suspense fallback={null}>
          <OpenFromArxivModal
            session={openFromArxivSession}
            onSessionChange={setOpenFromArxivSession}
            onClose={() => { setShowOpenFromArxivModal(false); }}
            onOpenCandidate={loadArxivCandidateIntoEditor}
          />
        </Suspense>
      ) : null}
      {compiledPictureSource !== null ? (
        <Suspense fallback={null}>
          <TikzJaxModal
            source={compiledPictureSource.source}
            activeFigureId={compiledPictureSource.activeFigureId}
            onClose={() => { setCompiledPictureSource(null); }}
            latex={platform.latex}
            showOpenInNewTab={!platform.id.startsWith("desktop")}
            showLogToggle={platform.id.startsWith("desktop")}
          />
        </Suspense>
      ) : null}
      {showSettingsModal ? (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => { setShowSettingsModal(false); }} />
        </Suspense>
      ) : null}
      {equationModalState ? (
        <Suspense fallback={null}>
          <EquationModal
            mode={equationModalState.mode}
            initialLatex={equationModalState.mode === "edit" ? equationModalState.target.latex : insertEquationDraft}
            onValueChange={(latex) => {
              if (equationModalState.mode === "insert") {
                setInsertEquationDraft(latex);
              }
            }}
            onClose={() => { setEquationModalState(null); }}
            onConfirm={(latex) => {
              if (equationModalState.mode === "insert") {
                const text = formatEquationText(latex, "inline-dollar");
                dispatch({
                  type: "APPLY_EDIT_ACTION",
	                  action: {
	                    kind: "addElement",
	                    template: {
	                      kind: "node",
	                      text
	                    },
	                    at: worldPoint(pt(0), pt(0))
	                  }
	                });
                setInsertEquationDraft("");
                setEquationModalState(null);
                return;
              }

              dispatch({
                type: "APPLY_EDIT_ACTION",
                action: {
                  kind: "updateNodeText",
                  elementId: equationModalState.target.sourceId,
                  text: formatEquationText(latex, equationModalState.target.delimiter)
                }
              });
              setEquationModalState(null);
            }}
          />
        </Suspense>
      ) : null}
      {repeatModalState ? (
        <Suspense fallback={null}>
          <RepeatModal
            columns={repeatModalState.columns}
            rows={repeatModalState.rows}
            horizontalStepCm={repeatModalState.horizontalStepPt / PT_PER_CM}
            verticalStepCm={repeatModalState.verticalStepPt / PT_PER_CM}
            horizontalGapCm={(repeatModalState.horizontalStepPt - repeatModalState.selectionWidthPt) / PT_PER_CM}
            verticalGapCm={(repeatModalState.verticalStepPt - repeatModalState.selectionHeightPt) / PT_PER_CM}
            selectionWidthCm={repeatModalState.selectionWidthPt / PT_PER_CM}
            selectionHeightCm={repeatModalState.selectionHeightPt / PT_PER_CM}
            onColumnsChange={(columns) => {
              setRepeatModalState((current) => current == null ? current : {
                ...current,
                columns: clampRepeatCount(columns)
              });
            }}
            onRowsChange={(rows) => {
              setRepeatModalState((current) => current == null ? current : {
                ...current,
                rows: clampRepeatCount(rows)
              });
            }}
            onHorizontalStepChange={(horizontalStepCm) => {
              setRepeatModalState((current) => current == null ? current : {
                ...current,
                horizontalStepPt: numericInputToPt(horizontalStepCm)
              });
            }}
            onVerticalStepChange={(verticalStepCm) => {
              setRepeatModalState((current) => current == null ? current : {
                ...current,
                verticalStepPt: numericInputToPt(verticalStepCm)
              });
            }}
            onClose={() => {
              setRepeatModalState(null);
              setRepeatPreviewModel(null);
            }}
            onConfirm={() => {
              const action = {
                kind: "repeatElements" as const,
                elementIds: repeatModalState.selectedSourceIds,
                columns: repeatModalState.columns,
                rows: repeatModalState.rows,
                horizontalStep: repeatModalState.horizontalStepPt,
                verticalStep: repeatModalState.verticalStepPt
              };
              const precomputedResult = applyEditAction(repeatModalState.source, [], action, {
                parseOptions: repeatModalState.activeFigureId == null ? {} : { activeFigureId: repeatModalState.activeFigureId }
              });
              if (precomputedResult.kind !== "success" && precomputedResult.kind !== "partial") {
                return;
              }
              dispatch({
                type: "APPLY_EDIT_ACTION",
                action,
                precomputedResult
              });
              setRepeatModalState(null);
              setRepeatPreviewModel(null);
            }}
          />
        </Suspense>
      ) : null}
      {svgExportSvgResult ? (
        <Suspense fallback={null}>
          <SvgExportModal
            svgResult={svgExportSvgResult}
            onClose={() => { setSvgExportSvgResult(null); }}
          />
        </Suspense>
      ) : null}
      {pngExportSvgResult ? (
        <Suspense fallback={null}>
          <PngExportModal
            svgResult={pngExportSvgResult}
            onClose={() => { setPngExportSvgResult(null); }}
          />
        </Suspense>
      ) : null}
      {pendingClose ? (
        <Suspense fallback={null}>
          <UnsavedChangesModal
            documentTitles={pendingClose.dirtyDocumentIds.map((id) => documents[id]?.title ?? "Untitled")}
            onChoose={(decision) => {
              void handleUnsavedDecision(decision);
            }}
          />
        </Suspense>
      ) : null}
      {pendingFileConflict ? (
        <Suspense fallback={null}>
          <FileConflictModal
            documentTitle={pendingFileConflict.title}
            onChoose={(decision) => {
              pendingFileConflict.resolve(decision);
            }}
          />
        </Suspense>
      ) : null}
      {showSaveWorkspaceModal ? (
        <Suspense fallback={null}>
          <SaveWorkspaceModal onClose={() => { setShowSaveWorkspaceModal(false); }} />
        </Suspense>
      ) : null}
      {showManageWorkspacesModal ? (
        <Suspense fallback={null}>
          <ManageWorkspacesModal onClose={() => { setShowManageWorkspacesModal(false); }} />
        </Suspense>
      ) : null}
      {showAboutModal ? (
        <Suspense fallback={null}>
          <AboutModal onClose={() => { setShowAboutModal(false); }} />
        </Suspense>
      ) : null}
      {showUpdateModal && availableUpdate ? (
        <Suspense fallback={null}>
          <UpdateModal
            update={availableUpdate}
            phase={updateModalPhase}
            isWindows={desktopOsFromPlatformId(platform.id) === "windows"}
            onInstall={() => {
              void handleInstallUpdate();
            }}
            onClose={handleUpdateModalClose}
            onLater={handleUpdateLater}
          />
        </Suspense>
      ) : null}
      {isDragOver ? (
        <div className={css.dropOverlay}>Drop to open</div>
      ) : null}
    </div>
  );
}

function resolveRepeatModalState(input: {
  source: string;
  activeFigureId: string | null;
  selectedElementIds: ReadonlySet<string>;
  scene: SceneFigure | null;
  documentId: string;
}): RepeatModalState | null {
  if (!input.scene) {
    return null;
  }
  const selectedSourceIds = [...input.selectedElementIds];
  const eligibility = getRepeatSelectionEligibility(
    input.source,
    selectedSourceIds,
    input.activeFigureId == null ? {} : { activeFigureId: input.activeFigureId }
  );
  if (eligibility.kind !== "eligible") {
    return null;
  }

  const boundsBySource = collectSourceWorldBounds(input.scene.elements);
  let selectionBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const ref of eligibility.refs) {
    const bounds = boundsBySource.get(ref.id);
    if (!bounds) {
      continue;
    }
    selectionBounds = selectionBounds == null
      ? { ...bounds }
      : {
          minX: Math.min(selectionBounds.minX, bounds.minX),
          minY: Math.min(selectionBounds.minY, bounds.minY),
          maxX: Math.max(selectionBounds.maxX, bounds.maxX),
          maxY: Math.max(selectionBounds.maxY, bounds.maxY)
        };
  }
  if (!selectionBounds) {
    return null;
  }

  const selectionWidthPt = Math.max(0, selectionBounds.maxX - selectionBounds.minX);
  const selectionHeightPt = Math.max(0, selectionBounds.maxY - selectionBounds.minY);
  return {
    documentId: input.documentId,
    source: input.source,
    activeFigureId: input.activeFigureId,
    selectedSourceIds: eligibility.refs.map((ref) => ref.id),
    selectionWidthPt,
    selectionHeightPt,
    columns: 2,
    rows: 1,
    horizontalStepPt: selectionWidthPt,
    verticalStepPt: selectionHeightPt
  };
}

function clampRepeatCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function numericInputToPt(valueCm: number): number {
  if (!Number.isFinite(valueCm)) {
    return 0;
  }
  return valueCm * PT_PER_CM;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}
