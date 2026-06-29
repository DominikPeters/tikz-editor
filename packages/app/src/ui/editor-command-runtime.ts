import { useMemo, useRef } from "react";
import { APP_MENU_COMMAND_IDS, type AppMenuCommandId } from "../app-menu";
import { getDockLayoutHandle } from "./DockLayout";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import type { EditAnalysisView } from "tikz-editor/edit/analysis";
import type { EmitSvgResult } from "tikz-editor/svg/index";
import type { SessionSnapshot } from "../compute";
import { getSharedEditAnalysisView } from "../edit-analysis-manager";
import { getActiveEditorPlatform } from "../platform/current";
import type { AppSettings } from "../settings/types";
import { useSettingsStore } from "../settings/useSettingsStore";
import { buildSnapshotEditSourceFingerprint } from "../source-identity";
import { useEditorStore } from "../store/store";
import type { DocumentFileRef, EditorAction, SnapModes, ToolMode } from "../store/types";
import { getToolCapabilityStatus } from "./capabilities";
import { resolveEquationNodeTargetFromSelection, type EquationNodeTarget } from "./equation-utils";
import {
  actionAvailability,
  addTreeChild,
  addTreeSibling,
  addMatrixColumnAtEnd,
  addMatrixRowAtEnd,
  canAddMatrixColumnAtEnd,
  canAddMatrixRowAtEnd,
  canCopySelection,
  canCutSelection,
  canDeleteSelection,
  canDuplicateSelection,
  canFlattenForeachSelection,
  canRepeatSelection,
  canInsertMatrixColumnLeft,
  canInsertMatrixColumnRight,
  canInsertMatrixRowAbove,
  canInsertMatrixRowBelow,
  canPasteSelection,
  canRemoveMatrixColumn,
  canRemoveMatrixRow,
  canTransposeMatrix,
  alignSelection,
  canAddTreeChild,
  canAddTreeSibling,
  deleteSelectedPathPoint,
  flipSelection,
  copySelection,
  cutSelection,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  flattenForeachSelection,
  openRepeatSelection,
  groupSelection,
  joinSelectedPaths,
  pasteSelectionFromSystemClipboard,
  reorderSelection,
  reverseSelectedPath,
  rotateSelection,
  insertMatrixColumnLeft,
  insertMatrixColumnRight,
  insertMatrixRowAbove,
  insertMatrixRowBelow,
  removeMatrixColumn,
  removeMatrixRow,
  transposeMatrix,
  ungroupSelection,
  setSelectedPathClosed,
  setSelectedPathPointKind,
  splitSelectedPath
} from "./editor-commands";

import { requestSourceFormat } from "./source-sync";
import { resolveOpenedFileForDocument, resolveOpenedPowerPointForDocument } from "./svg-import";
import { resolveNodePositioningContextMenuAction } from "./canvas-panel/node-positioning-context-action";

export type CommandOrigin = "menu" | "shortcut" | "context-menu" | "platform";

export type CommandBinding = {
  enabled: boolean;
  checked?: boolean;
  run: (origin: CommandOrigin) => void | Promise<void>;
};

export type CommandBindings = Record<AppMenuCommandId, CommandBinding>;

type Dispatch = (action: EditorAction) => void;

type RuntimeInput = {
  source: string;
  activeFigureId: string | null;
  sourceRevision?: number;
  editAnalysisView: EditAnalysisView | null;
  snapshot: SessionSnapshot;
  toolMode: ToolMode;
  selectedElementIds: ReadonlySet<string>;
  activeHandleId: string | null;
  historyIndex: number;
  historyLength: number;
  activeDocumentId: string;
  tabCount: number;
  dirty: boolean;
  fileRef: DocumentFileRef | null;
  fitToContentModeActive: boolean;
  showGrid: boolean;
  showTransparencyGrid: boolean;
  snapModes: SnapModes;
  snapHapticsEnabled: boolean;
  showRulers: boolean;
  showGuides: boolean;
  showDocumentBounds: boolean;
  showSourcePanel: boolean;
  showInspectorPanel: boolean;
  showObjectsPanel: boolean;
  showStylesPanel: boolean;
  showFiguresPanel: boolean;
  showAssistantPanel: boolean;
  rightSidebarTab: "inspector" | "objects" | "styles" | "assistant";
  assistantAvailable: boolean;
  showDevPanel: boolean;
  indentSize?: 2 | 4;
  updateCanvasSettings: (patch: Partial<AppSettings["canvas"]>) => void;
  dispatch: Dispatch;
  onOpenExample?: () => void;
  onOpenFromArxiv?: () => void;
  onOpenSvgExport?: (svgResult: EmitSvgResult) => void;
  onOpenPngExport?: (svgResult: EmitSvgResult) => void;
  onRequestCloseDocument?: (documentId: string) => void;
  onRequestCloseAllDocuments?: () => void;
  onRequestQuitApp?: () => void;
  onRequestSaveDocument?: (documentId: string, mode: "save" | "save-as") => void | Promise<void>;
  onAddNodeAdornment?: (kind: "label" | "pin") => void;
  onPositionNodeRelativeTo?: () => void;
  onConvertNodePositionToAbsolute?: () => void;
  onShowCompiledPicture?: () => void;
  onOpenSettings?: () => void;
  onFocusAssistant?: () => void;
  onOpenInsertEquation?: () => void;
  onOpenEditEquation?: (target: EquationNodeTarget) => void;
  onOpenRepeat?: () => void;
  onOpenSaveWorkspace?: () => void;
  onOpenManageWorkspaces?: () => void;
  onCheckForUpdates?: () => void | Promise<void>;
  onShowAbout?: () => void;
  updateCheckBusy?: boolean;
};

export type EditorCommandRuntime = {
  bindings: CommandBindings;
  runCommand: (commandId: AppMenuCommandId, origin: CommandOrigin) => boolean;
};

const PGF_TIKZ_MANUAL_URL = "https://tikz.dev";
const GITHUB_REPOSITORY_URL = "https://github.com/DominikPeters/tikz-editor";
const GITHUB_ISSUES_URL = "https://github.com/DominikPeters/tikz-editor/issues";

export function createEditorCommandRuntime(input: RuntimeInput): EditorCommandRuntime {
  const {
    source,
    activeFigureId,
    sourceRevision,
    editAnalysisView,
    snapshot,
    toolMode,
    selectedElementIds,
    activeHandleId,
    historyIndex,
    historyLength,
    activeDocumentId,
    tabCount,
    dirty,
    fileRef,
    fitToContentModeActive,
    showGrid,
    showTransparencyGrid,
    snapModes,
    snapHapticsEnabled,
    showRulers,
    showGuides,
    showDocumentBounds,
    showSourcePanel,
    showInspectorPanel,
    showObjectsPanel,
    showStylesPanel,
    showFiguresPanel,
    showAssistantPanel,
    rightSidebarTab,
    assistantAvailable,
    showDevPanel,
    indentSize,
    updateCanvasSettings,
    dispatch,
    onOpenExample,
    onOpenFromArxiv,
    onOpenSvgExport,
    onOpenPngExport,
    onRequestCloseDocument,
    onRequestCloseAllDocuments,
    onRequestQuitApp,
    onRequestSaveDocument,
    onAddNodeAdornment,
    onPositionNodeRelativeTo,
    onConvertNodePositionToAbsolute,
    onShowCompiledPicture,
    onOpenSettings,
    onFocusAssistant,
    onOpenInsertEquation,
    onOpenEditEquation,
    onOpenRepeat,
    onOpenSaveWorkspace,
    onOpenManageWorkspaces,
    onCheckForUpdates,
    onShowAbout,
    updateCheckBusy
  } = input;
  const parseOptions = {
    activeFigureId,
    analysisView: editAnalysisView,
    indentSize: indentSize ?? 2,
    sourceFingerprint: buildSnapshotEditSourceFingerprint({
      documentId: activeDocumentId,
      sourceRevision,
      sourceLength: source.length,
      sourceRefs: snapshot.editHandles.map((handle) => handle.sourceRef)
    })
  };

  const commandContext = {
    source,
    activeFigureId,
    parseOptions,
    figureCount: snapshot.figures?.length ?? 0,
    snapshotSource: snapshot.source,
    scene: snapshot.scene,
    editHandles: snapshot.editHandles,
    selectedElementIds,
    activeHandleId,
    dispatch
  };

  const availability = actionAvailability(commandContext);
  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < historyLength - 1;
  const canExport = snapshot.svg != null;
  const canOpen = typeof getActiveEditorPlatform().files?.openText === "function";
  const canOpenBinary = typeof getActiveEditorPlatform().files?.openBinary === "function";
  const canSave = typeof getActiveEditorPlatform().files?.saveText === "function";
  const canOpenExternalUrl = typeof getActiveEditorPlatform().window?.openExternalUrl === "function";
  const openExternalUrlCommand = (url: string): void => {
    const openExternalUrl = getActiveEditorPlatform().window?.openExternalUrl;
    if (typeof openExternalUrl !== "function") {
      return;
    }
    void openExternalUrl(url);
  };
  const canCheckForUpdates =
    typeof getActiveEditorPlatform().updates?.checkForUpdate === "function" &&
    typeof getActiveEditorPlatform().updates?.installUpdate === "function" &&
    typeof getActiveEditorPlatform().updates?.relaunch === "function";
  const isMacDesktop =
    getActiveEditorPlatform().id.startsWith("desktop") &&
    typeof navigator !== "undefined" &&
    /(mac|iphone|ipad)/i.test(navigator.platform);

  const insertBinding = (mode: ToolMode): CommandBinding => {
    const capability = getToolCapabilityStatus(mode);
    return {
      enabled: capability.status !== "unsupported",
      checked: toolMode === mode,
      run: () => { dispatch({ type: "SET_TOOL_MODE", mode }); }
    };
  };

  const runSvgExport = () => {
    if (!snapshot.svg) {
      return;
    }
    onOpenSvgExport?.(snapshot.svg);
  };

  const runSvgCopy = () => {
    if (!snapshot.svg) {
      return;
    }
    void import("./export-commands").then((mod) => mod.copySvgMarkup(snapshot.svg!));
  };

  const runPdfDownload = () => {
    if (!snapshot.svg) {
      return;
    }
    void import("./export-commands").then((mod) => mod.exportPdfDownload(snapshot.svg!, { fileName: "tikz-export.pdf" }));
  };

  const runPngExport = () => {
    if (!snapshot.svg) {
      return;
    }
    onOpenPngExport?.(snapshot.svg);
  };

  const runStandaloneLatexDownload = () => {
    if (!snapshot.semanticResult) {
      return;
    }
    void import("./export-commands").then((mod) => mod.exportStandaloneLatexDownload(source, activeFigureId, {
      fileName: "tikz-export.tex"
    }));
  };

  const runOpenDocument = (options: { requireSvg?: boolean; requireIpe?: boolean; addToRecent?: boolean } = {}) => {
    const openText = getActiveEditorPlatform().files?.openText;
    if (!openText) {
      return;
    }
    void openText({ addToRecent: options.addToRecent ?? true }).then(async (opened) => {
      if (!opened) {
        return;
      }
      const resolved = await resolveOpenedFileForDocument(opened, {
        requireSvg: options.requireSvg,
        requireIpe: options.requireIpe
      });
      if (resolved.kind === "failure") {
        const alertFn = (globalThis as { alert?: (message?: string) => void }).alert;
        if (typeof alertFn === "function") {
          alertFn(resolved.message);
        }
        return;
      }
      dispatch({ type: "NEW_DOCUMENT", source: resolved.source, title: resolved.title });
      dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: resolved.fileRef });
    });
  };

  const runImportPowerPoint = () => {
    const openBinary = getActiveEditorPlatform().files?.openBinary;
    if (!openBinary) {
      return;
    }
    void openBinary({ addToRecent: false }).then(async (opened) => {
      if (!opened) {
        return;
      }
      const resolved = await resolveOpenedPowerPointForDocument(opened);
      if (resolved.kind === "failure") {
        const alertFn = (globalThis as { alert?: (message?: string) => void }).alert;
        if (typeof alertFn === "function") {
          alertFn(resolved.message);
        }
        return;
      }
      dispatch({ type: "NEW_DOCUMENT", source: resolved.source, title: resolved.title });
      dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: resolved.fileRef });
    });
  };

  const singleSelectedId = selectedElementIds.size === 1 ? [...selectedElementIds][0] ?? null : null;
  const canAddAdornment =
    singleSelectedId != null &&
    (() => {
      const resolved = resolvePropertyTarget(source, singleSelectedId, parseOptions);
      return (
        resolved.kind === "found" &&
        (resolved.target.kind === "node-item" ||
          (resolved.target.kind === "path-statement" && resolved.target.pathCommand === "node"))
      );
    })();
  const nodePositioningAction = singleSelectedId
    ? resolveNodePositioningContextMenuAction({
        source,
        sourceId: singleSelectedId,
        snapshot,
        parseOptions
      })
    : null;
  const equationTarget = resolveEquationNodeTargetFromSelection(source, selectedElementIds, parseOptions);
  const canTreeAddChild = canAddTreeChild(commandContext);
  const canTreeAddSibling = canAddTreeSibling(commandContext);
  const canMatrixAddRowEnd = canAddMatrixRowAtEnd(commandContext);
  const canMatrixAddColumnEnd = canAddMatrixColumnAtEnd(commandContext);
  const canMatrixInsertRowAbove = canInsertMatrixRowAbove(commandContext);
  const canMatrixInsertRowBelow = canInsertMatrixRowBelow(commandContext);
  const canMatrixInsertColumnLeft = canInsertMatrixColumnLeft(commandContext);
  const canMatrixInsertColumnRight = canInsertMatrixColumnRight(commandContext);
  const canMatrixTranspose = canTransposeMatrix(commandContext);
  const canMatrixRemoveRow = canRemoveMatrixRow(commandContext);
  const canMatrixRemoveColumn = canRemoveMatrixColumn(commandContext);
  const dispatchLayoutFallback = (
    patch: Partial<{
      sourceVisible: boolean;
      inspectorVisible: boolean;
      objectsVisible: boolean;
      stylesVisible: boolean;
      figuresVisible: boolean;
      assistantVisible: boolean;
      activeRightTab: "inspector" | "objects" | "styles" | "assistant";
    }>
  ) => {
    dispatch({
      type: "SYNC_LAYOUT_STATE",
      sourceVisible: patch.sourceVisible ?? showSourcePanel,
      inspectorVisible: patch.inspectorVisible ?? showInspectorPanel,
      objectsVisible: patch.objectsVisible ?? showObjectsPanel,
      stylesVisible: patch.stylesVisible ?? showStylesPanel,
      figuresVisible: patch.figuresVisible ?? showFiguresPanel,
      assistantVisible: patch.assistantVisible ?? showAssistantPanel,
      activeRightTab: patch.activeRightTab ?? rightSidebarTab
    });
  };

  const bindings: CommandBindings = {
    [APP_MENU_COMMAND_IDS.NEW_DOCUMENT]: {
      enabled: true,
      run: () => { dispatch({ type: "NEW_DOCUMENT" }); }
    },
    [APP_MENU_COMMAND_IDS.OPEN_DOCUMENT]: {
      enabled: canOpen,
      run: () => { runOpenDocument(); }
    },
    [APP_MENU_COMMAND_IDS.OPEN_FROM_ARXIV]: {
      enabled: typeof getActiveEditorPlatform().files?.fetchArxivSource === "function" && onOpenFromArxiv != null,
      run: () => onOpenFromArxiv?.()
    },
    [APP_MENU_COMMAND_IDS.IMPORT_IPE]: {
      enabled: canOpen,
      run: () => { runOpenDocument({ requireIpe: true, addToRecent: false }); }
    },
    [APP_MENU_COMMAND_IDS.IMPORT_POWERPOINT]: {
      enabled: canOpenBinary,
      run: () => { runImportPowerPoint(); }
    },
    [APP_MENU_COMMAND_IDS.IMPORT_SVG]: {
      enabled: canOpen,
      run: () => { runOpenDocument({ requireSvg: true, addToRecent: false }); }
    },
    [APP_MENU_COMMAND_IDS.CLEAR_RECENT_FILES]: {
      enabled: typeof getActiveEditorPlatform().files?.clearRecentFiles === "function",
      run: () => {
        void getActiveEditorPlatform().files?.clearRecentFiles?.();
      }
    },
    [APP_MENU_COMMAND_IDS.SAVE_DOCUMENT]: {
      enabled: canSave,
      run: () => {
        if (onRequestSaveDocument) {
          void onRequestSaveDocument(activeDocumentId, "save");
          return;
        }
        const saveText = getActiveEditorPlatform().files?.saveText;
        if (!saveText) {
          return;
        }
        void saveText(source, {
          suggestedName: fileRef?.name ?? "tikz-document.tex",
          fileRef,
          mode: "save"
        }).then((result) => {
          if (result.status !== "saved") {
            return;
          }
          dispatch({
            type: "MARK_DOCUMENT_SAVED",
            documentId: activeDocumentId,
            fileRef: result.fileRef
          });
        });
      }
    },
    [APP_MENU_COMMAND_IDS.SAVE_DOCUMENT_AS]: {
      enabled: canSave,
      run: () => {
        if (onRequestSaveDocument) {
          void onRequestSaveDocument(activeDocumentId, "save-as");
          return;
        }
        const saveText = getActiveEditorPlatform().files?.saveText;
        if (!saveText) {
          return;
        }
        void saveText(source, {
          suggestedName: fileRef?.name ?? "tikz-document.tex",
          fileRef,
          mode: "save-as"
        }).then((result) => {
          if (result.status !== "saved") {
            return;
          }
          dispatch({
            type: "MARK_DOCUMENT_SAVED",
            documentId: activeDocumentId,
            fileRef: result.fileRef
          });
        });
      }
    },
    [APP_MENU_COMMAND_IDS.CLOSE_DOCUMENT]: {
      enabled: tabCount > 0,
      run: () => {
        if (onRequestCloseDocument) {
          onRequestCloseDocument(activeDocumentId);
          return;
        }
        dispatch({ type: "CLOSE_DOCUMENT", documentId: activeDocumentId });
      }
    },
    [APP_MENU_COMMAND_IDS.CLOSE_ALL_DOCUMENTS]: {
      enabled: tabCount > 1 || dirty,
      run: () => {
        if (onRequestCloseAllDocuments) {
          onRequestCloseAllDocuments();
          return;
        }
        dispatch({ type: "CLOSE_ALL_DOCUMENTS" });
      }
    },
    [APP_MENU_COMMAND_IDS.QUIT_APP]: {
      enabled: onRequestQuitApp != null || typeof getActiveEditorPlatform().window?.close === "function",
      run: () => {
        if (onRequestQuitApp) {
          onRequestQuitApp();
          return;
        }
        void getActiveEditorPlatform().window?.close?.();
      }
    },
    [APP_MENU_COMMAND_IDS.OPEN_EXAMPLE]: {
      enabled: onOpenExample != null,
      run: () => onOpenExample?.()
    },
    [APP_MENU_COMMAND_IDS.SHOW_COMPILED_PICTURE]: {
      enabled: onShowCompiledPicture != null,
      run: () => onShowCompiledPicture?.()
    },
    [APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD]: {
      enabled: canExport && onOpenSvgExport != null,
      run: runSvgExport
    },
    [APP_MENU_COMMAND_IDS.EXPORT_STANDALONE_LATEX_DOWNLOAD]: {
      enabled: snapshot.semanticResult != null,
      run: runStandaloneLatexDownload
    },
    [APP_MENU_COMMAND_IDS.EXPORT_SVG_COPY]: {
      enabled: canExport,
      run: runSvgCopy
    },
    [APP_MENU_COMMAND_IDS.EXPORT_PDF_DOWNLOAD]: {
      enabled: canExport,
      run: runPdfDownload
    },
    [APP_MENU_COMMAND_IDS.EXPORT_PNG_DOWNLOAD]: {
      enabled: canExport && onOpenPngExport != null,
      run: runPngExport
    },
    [APP_MENU_COMMAND_IDS.UNDO]: {
      enabled: canUndo,
      run: () => { dispatch({ type: "UNDO" }); }
    },
    [APP_MENU_COMMAND_IDS.REDO]: {
      enabled: canRedo,
      run: () => { dispatch({ type: "REDO" }); }
    },
    [APP_MENU_COMMAND_IDS.FORMAT_TIKZ]: {
      enabled: showSourcePanel,
      run: (origin) => {
        requestSourceFormat({ reason: origin === "shortcut" ? "shortcut" : "menu" });
      }
    },
    [APP_MENU_COMMAND_IDS.CUT]: {
      enabled: canCutSelection(commandContext),
      run: () => {
        void cutSelection(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.COPY]: {
      enabled: canCopySelection(commandContext),
      run: () => {
        void copySelection(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.PASTE]: {
      enabled: canPasteSelection(commandContext),
      run: () => {
        void pasteSelectionFromSystemClipboard(commandContext).then((result) => {
          if (result.kind !== "failure" || result.reason === "empty") {
            return;
          }
          const alertFn = (globalThis as { alert?: (message?: string) => void }).alert;
          if (typeof alertFn === "function") {
            alertFn("Clipboard access was blocked. Focus the canvas and press Cmd/Ctrl+V to paste.");
          }
        });
      }
    },
    [APP_MENU_COMMAND_IDS.DELETE]: {
      enabled: canDeleteSelection(commandContext),
      run: () => {
        deleteSelection(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.TREE_ADD_CHILD]: {
      enabled: canTreeAddChild,
      run: () => {
        addTreeChild(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_BEFORE]: {
      enabled: canTreeAddSibling,
      run: () => {
        addTreeSibling(commandContext, "before");
      }
    },
    [APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_AFTER]: {
      enabled: canTreeAddSibling,
      run: () => {
        addTreeSibling(commandContext, "after");
      }
    },
    [APP_MENU_COMMAND_IDS.MATRIX_ADD_ROW_END]: {
      enabled: canMatrixAddRowEnd,
      run: () => {
        addMatrixRowAtEnd(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.MATRIX_ADD_COLUMN_END]: {
      enabled: canMatrixAddColumnEnd,
      run: () => {
        addMatrixColumnAtEnd(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_ABOVE]: {
      enabled: canMatrixInsertRowAbove,
      run: () => {
        insertMatrixRowAbove(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_BELOW]: {
      enabled: canMatrixInsertRowBelow,
      run: () => {
        insertMatrixRowBelow(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_LEFT]: {
      enabled: canMatrixInsertColumnLeft,
      run: () => {
        insertMatrixColumnLeft(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_RIGHT]: {
      enabled: canMatrixInsertColumnRight,
      run: () => {
        insertMatrixColumnRight(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.MATRIX_TRANSPOSE]: {
      enabled: canMatrixTranspose,
      run: () => {
        transposeMatrix(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.MATRIX_REMOVE_ROW]: {
      enabled: canMatrixRemoveRow,
      run: () => {
        removeMatrixRow(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.MATRIX_REMOVE_COLUMN]: {
      enabled: canMatrixRemoveColumn,
      run: () => {
        removeMatrixColumn(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.DUPLICATE]: {
      enabled: canDuplicateSelection(commandContext),
      run: () => {
        duplicateSelection(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.REPEAT]: {
      enabled: canRepeatSelection(commandContext),
      run: () => {
        openRepeatSelection(commandContext, onOpenRepeat);
      }
    },
    [APP_MENU_COMMAND_IDS.FLATTEN_FOREACH]: {
      enabled: canFlattenForeachSelection(commandContext),
      run: () => {
        flattenForeachSelection(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.GROUP]: {
      enabled: availability.group.enabled,
      run: () => {
        groupSelection(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.UNGROUP]: {
      enabled: availability.ungroup.enabled,
      run: () => {
        ungroupSelection(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.ROTATE_LEFT_90]: {
      enabled: availability["transform-rotateLeft90"].enabled,
      run: () => {
        rotateSelection(commandContext, "left");
      }
    },
    [APP_MENU_COMMAND_IDS.ROTATE_RIGHT_90]: {
      enabled: availability["transform-rotateRight90"].enabled,
      run: () => {
        rotateSelection(commandContext, "right");
      }
    },
    [APP_MENU_COMMAND_IDS.FLIP_HORIZONTAL]: {
      enabled: availability["transform-flipHorizontal"].enabled,
      run: () => {
        flipSelection(commandContext, "horizontal");
      }
    },
    [APP_MENU_COMMAND_IDS.FLIP_VERTICAL]: {
      enabled: availability["transform-flipVertical"].enabled,
      run: () => {
        flipSelection(commandContext, "vertical");
      }
    },
    [APP_MENU_COMMAND_IDS.SEND_TO_BACK]: {
      enabled: availability["reorder-sendToBack"].enabled,
      run: () => {
        reorderSelection(commandContext, "sendToBack");
      }
    },
    [APP_MENU_COMMAND_IDS.SEND_BACKWARD]: {
      enabled: availability["reorder-sendBackward"].enabled,
      run: () => {
        reorderSelection(commandContext, "sendBackward");
      }
    },
    [APP_MENU_COMMAND_IDS.BRING_FORWARD]: {
      enabled: availability["reorder-bringForward"].enabled,
      run: () => {
        reorderSelection(commandContext, "bringForward");
      }
    },
    [APP_MENU_COMMAND_IDS.BRING_TO_FRONT]: {
      enabled: availability["reorder-bringToFront"].enabled,
      run: () => {
        reorderSelection(commandContext, "bringToFront");
      }
    },
    [APP_MENU_COMMAND_IDS.ALIGN_LEFT]: {
      enabled: availability["align-left"].enabled,
      run: () => {
        alignSelection(commandContext, "left");
      }
    },
    [APP_MENU_COMMAND_IDS.ALIGN_CENTER]: {
      enabled: availability["align-center"].enabled,
      run: () => {
        alignSelection(commandContext, "center");
      }
    },
    [APP_MENU_COMMAND_IDS.ALIGN_RIGHT]: {
      enabled: availability["align-right"].enabled,
      run: () => {
        alignSelection(commandContext, "right");
      }
    },
    [APP_MENU_COMMAND_IDS.ALIGN_TOP]: {
      enabled: availability["align-top"].enabled,
      run: () => {
        alignSelection(commandContext, "top");
      }
    },
    [APP_MENU_COMMAND_IDS.ALIGN_MIDDLE]: {
      enabled: availability["align-middle"].enabled,
      run: () => {
        alignSelection(commandContext, "middle");
      }
    },
    [APP_MENU_COMMAND_IDS.ALIGN_BOTTOM]: {
      enabled: availability["align-bottom"].enabled,
      run: () => {
        alignSelection(commandContext, "bottom");
      }
    },
    [APP_MENU_COMMAND_IDS.DISTRIBUTE_HORIZONTAL]: {
      enabled: availability["distribute-horizontal"].enabled,
      run: () => {
        distributeSelection(commandContext, "horizontal");
      }
    },
    [APP_MENU_COMMAND_IDS.DISTRIBUTE_VERTICAL]: {
      enabled: availability["distribute-vertical"].enabled,
      run: () => {
        distributeSelection(commandContext, "vertical");
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_SPLIT]: {
      enabled: availability["path-split"].enabled,
      run: () => {
        splitSelectedPath(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_JOIN]: {
      enabled: availability["path-join"].enabled,
      run: () => {
        joinSelectedPaths(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_REVERSE]: {
      enabled: availability["path-reverse"].enabled,
      run: () => {
        reverseSelectedPath(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_CLOSE]: {
      enabled: availability["path-close"].enabled,
      run: () => {
        setSelectedPathClosed(commandContext, true);
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_OPEN]: {
      enabled: availability["path-open"].enabled,
      run: () => {
        setSelectedPathClosed(commandContext, false);
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_DELETE_POINT]: {
      enabled: availability["path-delete-point"].enabled,
      run: () => {
        deleteSelectedPathPoint(commandContext);
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_POINT_CORNER]: {
      enabled: availability["path-point-corner"].enabled,
      run: () => {
        setSelectedPathPointKind(commandContext, "corner");
      }
    },
    [APP_MENU_COMMAND_IDS.PATH_POINT_SMOOTH]: {
      enabled: availability["path-point-smooth"].enabled,
      run: () => {
        setSelectedPathPointKind(commandContext, "smooth");
      }
    },
    [APP_MENU_COMMAND_IDS.INSERT_NODE]: insertBinding("addNode"),
    [APP_MENU_COMMAND_IDS.INSERT_MATRIX]: insertBinding("addMatrix"),
    [APP_MENU_COMMAND_IDS.INSERT_SHAPE]: insertBinding("addShape"),
    [APP_MENU_COMMAND_IDS.INSERT_PATH]: insertBinding("addPath"),
    [APP_MENU_COMMAND_IDS.INSERT_FREEHAND]: insertBinding("addFreehand"),
    [APP_MENU_COMMAND_IDS.INSERT_LINE]: insertBinding("addLine"),
    [APP_MENU_COMMAND_IDS.INSERT_ARROW]: insertBinding("addArrow"),
    [APP_MENU_COMMAND_IDS.INSERT_BEZIER]: insertBinding("addBezier"),
    [APP_MENU_COMMAND_IDS.INSERT_GRID]: insertBinding("addGrid"),
    [APP_MENU_COMMAND_IDS.INSERT_RECT]: insertBinding("addRect"),
    [APP_MENU_COMMAND_IDS.INSERT_ELLIPSE]: insertBinding("addEllipse"),
    [APP_MENU_COMMAND_IDS.INSERT_CIRCLE]: insertBinding("addCircle"),
    [APP_MENU_COMMAND_IDS.INSERT_EQUATION]: {
      enabled: onOpenInsertEquation != null,
      run: () => onOpenInsertEquation?.()
    },
    [APP_MENU_COMMAND_IDS.EDIT_EQUATION]: {
      enabled: equationTarget != null && onOpenEditEquation != null,
      run: () => {
        if (!equationTarget) {
          return;
        }
        onOpenEditEquation?.(equationTarget);
      }
    },
    [APP_MENU_COMMAND_IDS.ADD_LABEL]: {
      enabled: canAddAdornment && onAddNodeAdornment != null,
      run: () => onAddNodeAdornment?.("label")
    },
    [APP_MENU_COMMAND_IDS.ADD_PIN]: {
      enabled: canAddAdornment && onAddNodeAdornment != null,
      run: () => onAddNodeAdornment?.("pin")
    },
    [APP_MENU_COMMAND_IDS.NODE_POSITION_RELATIVE_TO]: {
      enabled: nodePositioningAction === "position-relative" && onPositionNodeRelativeTo != null,
      run: () => onPositionNodeRelativeTo?.()
    },
    [APP_MENU_COMMAND_IDS.NODE_CONVERT_TO_ABSOLUTE]: {
      enabled: nodePositioningAction === "convert-absolute" && onConvertNodePositionToAbsolute != null,
      run: () => onConvertNodePositionToAbsolute?.()
    },
    [APP_MENU_COMMAND_IDS.FIT_TO_CONTENT]: {
      enabled: snapshot.svg != null,
      checked: fitToContentModeActive,
      run: () => {
        if (fitToContentModeActive) {
          dispatch({ type: "SET_FIT_TO_CONTENT_MODE", active: false });
          return;
        }
        dispatch({ type: "REQUEST_FIT_TO_CONTENT" });
      }
    },
    [APP_MENU_COMMAND_IDS.ZOOM_IN]: {
      enabled: snapshot.svg != null,
      run: () => { dispatch({ type: "REQUEST_ZOOM", direction: "in" }); }
    },
    [APP_MENU_COMMAND_IDS.ZOOM_OUT]: {
      enabled: snapshot.svg != null,
      run: () => { dispatch({ type: "REQUEST_ZOOM", direction: "out" }); }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_GRID]: {
      enabled: true,
      checked: showGrid,
      run: () => { dispatch({ type: "TOGGLE_CANVAS_AID", aid: "grid" }); }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_TRANSPARENCY_GRID]: {
      enabled: true,
      checked: showTransparencyGrid,
      run: () => { dispatch({ type: "TOGGLE_CANVAS_AID", aid: "transparencyGrid" }); }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_INFINITE_CANVAS]: {
      enabled: true,
      checked: !showDocumentBounds,
      run: () => { dispatch({ type: "TOGGLE_CANVAS_AID", aid: "documentBounds" }); }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GRID]: {
      enabled: true,
      checked: snapModes.grid,
      run: () => { dispatch({ type: "TOGGLE_SNAP_MODE", mode: "grid" }); }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GUIDES]: {
      enabled: true,
      checked: snapModes.guides,
      run: () => { dispatch({ type: "TOGGLE_SNAP_MODE", mode: "guides" }); }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_POINTS]: {
      enabled: true,
      checked: snapModes.points,
      run: () => { dispatch({ type: "TOGGLE_SNAP_MODE", mode: "points" }); }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_GAPS]: {
      enabled: true,
      checked: snapModes.gaps,
      run: () => { dispatch({ type: "TOGGLE_SNAP_MODE", mode: "gaps" }); }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_SNAP_HAPTICS]: {
      enabled: isMacDesktop,
      checked: snapHapticsEnabled,
      run: () => { updateCanvasSettings({ snapHapticsEnabled: !snapHapticsEnabled }); }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_RULERS]: {
      enabled: true,
      checked: showRulers,
      run: () => { dispatch({ type: "TOGGLE_CANVAS_AID", aid: "rulers" }); }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_GUIDES]: {
      enabled: true,
      checked: showGuides,
      run: () => { dispatch({ type: "TOGGLE_CANVAS_AID", aid: "guides" }); }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_SOURCE_PANEL]: {
      enabled: true,
      checked: showSourcePanel,
      run: () => {
        const handle = getDockLayoutHandle();
        if (handle) handle.togglePanel("source");
        else dispatch({ type: "TOGGLE_PANEL", panel: "source" });
      }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_INSPECTOR_PANEL]: {
      enabled: true,
      checked: showInspectorPanel,
      run: () => {
        const handle = getDockLayoutHandle();
        if (handle) handle.togglePanel("inspector");
        else dispatch({ type: "TOGGLE_PANEL", panel: "inspector" });
      }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_OBJECTS_PANEL]: {
      enabled: true,
      checked: showObjectsPanel,
      run: () => {
        const handle = getDockLayoutHandle();
        if (handle) {
          handle.togglePanel("objects");
          return;
        }
        dispatchLayoutFallback({
          objectsVisible: !showObjectsPanel,
          activeRightTab: !showObjectsPanel ? "objects" : rightSidebarTab
        });
      }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_STYLES_PANEL]: {
      enabled: true,
      checked: showStylesPanel,
      run: () => {
        const handle = getDockLayoutHandle();
        if (handle) {
          handle.togglePanel("styles");
          return;
        }
        dispatchLayoutFallback({
          stylesVisible: !showStylesPanel,
          activeRightTab: !showStylesPanel ? "styles" : rightSidebarTab
        });
      }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_FIGURES_PANEL]: {
      enabled: true,
      checked: showFiguresPanel,
      run: () => {
        const handle = getDockLayoutHandle();
        if (handle) {
          handle.togglePanel("figure-navigator");
          return;
        }
        dispatchLayoutFallback({ figuresVisible: !showFiguresPanel });
      }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_ASSISTANT_PANEL]: {
      enabled: assistantAvailable,
      checked: showAssistantPanel,
      run: () => {
        const handle = getDockLayoutHandle();
        if (handle) {
          handle.togglePanel("assistant");
          return;
        }
        onFocusAssistant?.();
        dispatchLayoutFallback({
          assistantVisible: !showAssistantPanel,
          activeRightTab: !showAssistantPanel ? "assistant" : rightSidebarTab
        });
      }
    },
    [APP_MENU_COMMAND_IDS.TOGGLE_DEV_PANEL]: {
      enabled: true,
      checked: showDevPanel,
      run: () => { dispatch({ type: "TOGGLE_DEV_PANEL" }); }
    },
    [APP_MENU_COMMAND_IDS.SAVE_WORKSPACE_AS]: {
      enabled: onOpenSaveWorkspace != null,
      run: () => onOpenSaveWorkspace?.()
    },
    [APP_MENU_COMMAND_IDS.MANAGE_WORKSPACES]: {
      enabled: onOpenManageWorkspaces != null,
      run: () => onOpenManageWorkspaces?.()
    },
    [APP_MENU_COMMAND_IDS.OPEN_SETTINGS]: {
      enabled: onOpenSettings != null,
      run: () => onOpenSettings?.()
    },
    [APP_MENU_COMMAND_IDS.CHECK_FOR_UPDATES]: {
      enabled: canCheckForUpdates && !updateCheckBusy,
      run: () => onCheckForUpdates?.()
    },
    [APP_MENU_COMMAND_IDS.SHOW_ABOUT]: {
      enabled: onShowAbout != null,
      run: () => onShowAbout?.()
    },
    [APP_MENU_COMMAND_IDS.OPEN_PGF_TIKZ_MANUAL]: {
      enabled: canOpenExternalUrl,
      run: () => {
        openExternalUrlCommand(PGF_TIKZ_MANUAL_URL);
      }
    },
    [APP_MENU_COMMAND_IDS.OPEN_GITHUB_REPOSITORY]: {
      enabled: canOpenExternalUrl,
      run: () => {
        openExternalUrlCommand(GITHUB_REPOSITORY_URL);
      }
    },
    [APP_MENU_COMMAND_IDS.OPEN_GITHUB_ISSUES]: {
      enabled: canOpenExternalUrl,
      run: () => {
        openExternalUrlCommand(GITHUB_ISSUES_URL);
      }
    }
  };

  return {
    bindings,
    runCommand: (commandId, origin) => {
      const binding = bindings[commandId];
      if (!binding?.enabled) {
        return false;
      }
      void binding.run(origin);
      return true;
    }
  };
}

export function useEditorCommandRuntime(
  options: {
    onOpenExample?: () => void;
    onOpenFromArxiv?: () => void;
    onOpenSvgExport?: (svgResult: EmitSvgResult) => void;
    onOpenPngExport?: (svgResult: EmitSvgResult) => void;
    onRequestCloseDocument?: (documentId: string) => void;
    onRequestCloseAllDocuments?: () => void;
    onRequestQuitApp?: () => void;
    onRequestSaveDocument?: (documentId: string, mode: "save" | "save-as") => void | Promise<void>;
    onAddNodeAdornment?: (kind: "label" | "pin") => void;
    onPositionNodeRelativeTo?: () => void;
    onConvertNodePositionToAbsolute?: () => void;
    onShowCompiledPicture?: () => void;
    onOpenSettings?: () => void;
    onFocusAssistant?: () => void;
    onOpenInsertEquation?: () => void;
    onOpenEditEquation?: (target: EquationNodeTarget) => void;
    onOpenRepeat?: () => void;
    onOpenSaveWorkspace?: () => void;
    onOpenManageWorkspaces?: () => void;
    onCheckForUpdates?: () => void | Promise<void>;
    onShowAbout?: () => void;
    updateCheckBusy?: boolean;
    activeHandleIdOverride?: string | null;
  } = {}
): EditorCommandRuntime {
  const source = useEditorStore((s) => s.source);
  const activeFigureId = useEditorStore((s) => s.activeFigureId);
  const sourceRevision = useEditorStore((s) => s.sourceRevision);
  const snapshot = useEditorStore((s) => s.snapshot);
  const toolMode = useEditorStore((s) => s.toolMode);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const activeHandleId = useEditorStore((s) => s.activeHandleId);
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const historyIndex = useEditorStore((s) => s.historyIndex);
  const historyLength = useEditorStore((s) => s.history.length);
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const tabCount = useEditorStore((s) => s.tabOrder.length);
  const dirty = useEditorStore((s) => s.documents[s.activeDocumentId]?.dirty ?? false);
  const fileRef = useEditorStore((s) => s.documents[s.activeDocumentId]?.fileRef ?? null);
  const fitToContentModeActive = useEditorStore((s) => s.fitToContentModeActive);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showTransparencyGrid = useEditorStore((s) => s.showTransparencyGrid);
  const snapModes = useEditorStore((s) => s.snapModes);
  const snapHapticsEnabled = useSettingsStore((s) => s.settings.canvas.snapHapticsEnabled);
  const showRulers = useEditorStore((s) => s.showRulers);
  const showGuides = useEditorStore((s) => s.showGuides);
  const showDocumentBounds = useEditorStore((s) => s.showDocumentBounds);
  const showSourcePanel = useEditorStore((s) => s.showSourcePanel);
  const showInspectorPanel = useEditorStore((s) => s.showInspectorPanel);
  const showObjectsPanel = useEditorStore((s) => s.showObjectsPanel);
  const showStylesPanel = useEditorStore((s) => s.showStylesPanel);
  const showFiguresPanel = useEditorStore((s) => s.showFiguresPanel);
  const showAssistantPanel = useEditorStore((s) => s.showAssistantPanel);
  const rightSidebarTab = useEditorStore((s) => s.rightSidebarTab);
  const showDevPanel = useEditorStore((s) => s.showDevPanel);
  const indentSize = useSettingsStore((s) => s.settings.editor.indentSize);
  const updateCanvasSettings = useSettingsStore((s) => s.updateCanvasSettings);
  const dispatch = useEditorStore((s) => s.dispatch);
  const assistantAvailable = typeof getActiveEditorPlatform().assistant?.startTurn === "function";
  const effectiveActiveHandleId = options.activeHandleIdOverride !== undefined
    ? options.activeHandleIdOverride
    : activeHandleId;
  const liveCommandInputs = useMemo(
    () => ({
      source,
      activeFigureId,
      sourceRevision,
      snapshot,
      selectedElementIds,
      activeHandleId: effectiveActiveHandleId
    }),
    [activeFigureId, effectiveActiveHandleId, selectedElementIds, snapshot, source, sourceRevision]
  );
  const frozenCommandInputsRef = useRef(liveCommandInputs);
  const snapshotMatchesSource = snapshot.source === source;
  if (!activeCanvasDragKind && snapshotMatchesSource) {
    frozenCommandInputsRef.current = liveCommandInputs;
  }
  const effectiveCommandInputs = activeCanvasDragKind || !snapshotMatchesSource
    ? frozenCommandInputsRef.current
    : liveCommandInputs;
  const editAnalysisView = useMemo(
    () =>
      getSharedEditAnalysisView({
        documentId: activeDocumentId,
        sourceRevision: effectiveCommandInputs.sourceRevision,
        source: effectiveCommandInputs.source,
        activeFigureId: effectiveCommandInputs.activeFigureId,
        snapshot: effectiveCommandInputs.snapshot
      }),
    [
      activeDocumentId,
      effectiveCommandInputs.activeFigureId,
      effectiveCommandInputs.snapshot,
      effectiveCommandInputs.source,
      effectiveCommandInputs.sourceRevision
    ]
  );

  return useMemo(
    () =>
      createEditorCommandRuntime({
        source: effectiveCommandInputs.source,
        activeFigureId: effectiveCommandInputs.activeFigureId,
        sourceRevision: effectiveCommandInputs.sourceRevision,
        editAnalysisView,
        snapshot: effectiveCommandInputs.snapshot,
        toolMode,
        selectedElementIds: effectiveCommandInputs.selectedElementIds,
        activeHandleId: effectiveCommandInputs.activeHandleId,
        historyIndex,
        historyLength,
        activeDocumentId,
        tabCount,
        dirty,
        fileRef,
        fitToContentModeActive,
        showGrid,
        showTransparencyGrid,
        snapModes,
        snapHapticsEnabled,
        showRulers,
        showGuides,
        showDocumentBounds,
        showSourcePanel,
        showInspectorPanel,
        showObjectsPanel,
        showStylesPanel,
        showFiguresPanel,
        showAssistantPanel,
        rightSidebarTab,
        assistantAvailable,
        showDevPanel,
        indentSize,
        updateCanvasSettings,
        dispatch,
        onOpenExample: options.onOpenExample,
        onOpenFromArxiv: options.onOpenFromArxiv,
        onOpenSvgExport: options.onOpenSvgExport,
        onOpenPngExport: options.onOpenPngExport,
        onRequestCloseDocument: options.onRequestCloseDocument,
        onRequestCloseAllDocuments: options.onRequestCloseAllDocuments,
        onRequestQuitApp: options.onRequestQuitApp,
        onRequestSaveDocument: options.onRequestSaveDocument,
        onAddNodeAdornment: options.onAddNodeAdornment,
        onPositionNodeRelativeTo: options.onPositionNodeRelativeTo,
        onConvertNodePositionToAbsolute: options.onConvertNodePositionToAbsolute,
        onShowCompiledPicture: options.onShowCompiledPicture,
        onOpenSettings: options.onOpenSettings,
        onCheckForUpdates: options.onCheckForUpdates,
        onShowAbout: options.onShowAbout,
        updateCheckBusy: options.updateCheckBusy,
        onFocusAssistant: options.onFocusAssistant,
        onOpenInsertEquation: options.onOpenInsertEquation,
        onOpenEditEquation: options.onOpenEditEquation,
        onOpenRepeat: options.onOpenRepeat,
        onOpenSaveWorkspace: options.onOpenSaveWorkspace,
        onOpenManageWorkspaces: options.onOpenManageWorkspaces
      }),
    [
      editAnalysisView,
      effectiveCommandInputs,
      toolMode,
      historyIndex,
      historyLength,
      activeDocumentId,
      tabCount,
      dirty,
      fileRef,
      fitToContentModeActive,
      showGrid,
      showTransparencyGrid,
      snapModes,
      snapHapticsEnabled,
      showRulers,
      showGuides,
      showDocumentBounds,
      showSourcePanel,
      showInspectorPanel,
      showObjectsPanel,
      showStylesPanel,
      showFiguresPanel,
      showAssistantPanel,
      rightSidebarTab,
      assistantAvailable,
      showDevPanel,
      indentSize,
      updateCanvasSettings,
      dispatch,
      options.onOpenExample,
      options.onOpenFromArxiv,
      options.onOpenSvgExport,
      options.onOpenPngExport,
      options.onRequestCloseDocument,
      options.onRequestCloseAllDocuments,
      options.onRequestQuitApp,
      options.onRequestSaveDocument,
      options.onAddNodeAdornment,
      options.onPositionNodeRelativeTo,
      options.onConvertNodePositionToAbsolute,
      options.onShowCompiledPicture,
      options.onOpenSettings,
      options.onCheckForUpdates,
      options.onShowAbout,
      options.updateCheckBusy,
      options.onFocusAssistant,
      options.onOpenInsertEquation,
      options.onOpenEditEquation,
      options.onOpenManageWorkspaces,
      options.onOpenRepeat,
      options.onOpenSaveWorkspace
    ]
  );
}
