import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import {
  RiAddLine,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiAspectRatioLine,
  RiCloseLine,
  RiFullscreenExitLine,
  RiIndentDecrease,
  RiIndentIncrease,
  RiPushpinFill,
  RiPushpinLine,
  RiSubtractLine
} from "@remixicon/react";
import { useShallow } from "zustand/react/shallow";
import type { SvgRenderModel } from "@tikz-editor/core/svg";
import { APP_MENU_COMMAND_IDS, type AppMenuCommandId } from "../app-menu";
import { useEditorStore } from "../store/store";
import type { ToolMode } from "../store/types";
import { CanvasPanel } from "./canvas-panel/CanvasPanel";
import type { EditorCommandRuntime } from "./editor-command-runtime";
import { RootNavigator } from "./RootNavigator";
import { insertSlideAfterCurrent } from "../presentation/NewSlideButton";
import { InAppPresentationHost } from "../presentation/InAppPresentation";
import { hasMultipleRoots, snapshotRoots } from "../root-inventory";
import { InspectorPanelSwitch } from "./inspector-panel/InspectorPanelSwitch";
import { ObjectsPanel } from "./objects-panel/ObjectsPanel";
import { SourcePanel } from "./source-panel/SourcePanel";
import { StylesPanel } from "./StylesPanel";
import { BuildsPanel } from "./builds-panel/BuildsPanel";
import { IpadDocumentGallery } from "./ipad/IpadDocumentGallery";
import { IpadNavBar } from "./ipad/IpadNavBar";
import { IpadMenu, IpadMenuItem, IpadPopover } from "./ipad/IpadPopover";
import { IpadToolPalette, paletteFitInsets, type PaletteDock } from "./ipad/IpadToolPalette";
import { useSourceFloat } from "./ipad/useSourceFloat";
import { isCodeMirrorEventTarget } from "./editor-commands";
import {
  getSourceEditorHistorySnapshot,
  requestSourceAccessoryCommand,
  subscribeSourceEditorHistory,
  type SourceAccessoryCommandDetail
} from "./source-sync";
import { resolveToolbarToolMode } from "./tool-config";
import { ACTUAL_SIZE_SCALE, zoomPercentForScale } from "./canvas-zoom";
import css from "./IpadEditorShell.module.css";

type RightSidebarTab = "inspector" | "objects" | "styles" | "builds";

type IpadEditorShellProps = {
  commandRuntime: EditorCommandRuntime;
  repeatPreviewModel: SvgRenderModel | null;
  onRequestCloseDocument: (documentId: string) => void;
  updateChip?: { version: string; onClick: () => void } | null;
};

type LayoutPatch = Partial<{
  sourceVisible: boolean;
  inspectorVisible: boolean;
  objectsVisible: boolean;
  stylesVisible: boolean;
  buildsVisible: boolean;
  figuresVisible: boolean;
  assistantVisible: boolean;
  activeRightTab: RightSidebarTab;
}>;

const RIGHT_PANEL_LABELS: Record<RightSidebarTab, string> = {
  inspector: "Inspector",
  objects: "Objects",
  styles: "Styles",
  builds: "Overlays"
};
const RIGHT_PANEL_TABS: readonly RightSidebarTab[] = ["inspector", "objects", "styles", "builds"];
const SOURCE_PINNED_STORAGE_KEY = "tikz-editor-ipad-source-pinned";
const SOURCE_WIDTH_STORAGE_KEY = "tikz-editor-ipad-source-width";
const DEFAULT_SOURCE_COLUMN_WIDTH = 420;
const MIN_SOURCE_COLUMN_WIDTH = 260;
const MAX_SOURCE_COLUMN_WIDTH = 640;
const MAX_SOURCE_COLUMN_FRACTION = 0.6;
const IPAD_NUMBERED_TOOL_SHORTCUTS: Record<string, ToolMode> = {
  "1": "select",
  "2": "addNode",
  "3": "addShape",
  "4": "addLine",
  "5": "addArrow",
  "6": "addPath",
  "7": "addFreehand",
  "8": "addRect",
  "9": "addEllipse",
  "0": "addCircle"
};

// The iPad shell has no assistant panel yet; a slide's overlays exist only in decks.
function coerceRightSidebarTab(tab: RightSidebarTab | "assistant", deck: boolean): RightSidebarTab {
  return tab === "assistant" || (tab === "builds" && !deck) ? "inspector" : tab;
}

function readStoredSourceWidth(): number {
  if (typeof localStorage === "undefined") {
    return DEFAULT_SOURCE_COLUMN_WIDTH;
  }
  const stored = Number(localStorage.getItem(SOURCE_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(stored)) {
    return DEFAULT_SOURCE_COLUMN_WIDTH;
  }
  return Math.min(Math.max(stored, MIN_SOURCE_COLUMN_WIDTH), MAX_SOURCE_COLUMN_WIDTH);
}

function storeSourceWidth(width: number): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(SOURCE_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Persistence is nice-to-have; resizing still works for the session.
  }
}

function readStoredSourcePinned(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }
  return localStorage.getItem(SOURCE_PINNED_STORAGE_KEY) === "true";
}

function storeSourcePinned(pinned: boolean): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(SOURCE_PINNED_STORAGE_KEY, pinned ? "true" : "false");
  } catch {
    // Persistence is nice-to-have; pinning still works for the session.
  }
}

function isTextEditingShortcutTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (!element) {
    return false;
  }
  return (
    isCodeMirrorEventTarget(element) ||
    element.closest("input, textarea, select, [contenteditable='true']") != null
  );
}

export function IpadEditorShell({
  commandRuntime,
  repeatPreviewModel,
  onRequestCloseDocument,
  updateChip = null
}: IpadEditorShellProps) {
  const didNormalizeInitialLayout = useRef(false);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const sourceResizeRef = useRef<{ pointerId: number; startClientX: number; startWidth: number } | null>(null);
  const [sourcePinned, setSourcePinned] = useState(readStoredSourcePinned);
  const [sourceColumnWidth, setSourceColumnWidth] = useState(readStoredSourceWidth);
  const [sourceResizing, setSourceResizing] = useState(false);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [documentGalleryOpen, setDocumentGalleryOpen] = useState(false);
  const [paletteDock, setPaletteDock] = useState<PaletteDock>({ kind: "edge", edge: "bottom" });
  const [rightPanelInset, setRightPanelInset] = useState(0);
  // Which history the nav bar's Undo and Redo act on: the source editor's
  // typing history once the user works there, the document's after a canvas touch.
  const [historySurface, setHistorySurface] = useState<"document" | "source">("document");
  const sourceEditorHistory = useSyncExternalStore(
    subscribeSourceEditorHistory,
    getSourceEditorHistorySnapshot,
    getSourceEditorHistorySnapshot
  );
  const {
    toolMode,
    pendingRequestId,
    snapshot,
    canvasStatusHint,
    showSourcePanel,
    showInspectorPanel,
    showObjectsPanel,
    showStylesPanel,
    showBuildsPanel,
    showFiguresPanel,
    showAssistantPanel,
    rightSidebarTab,
    showRulers,
    documentKind,
    activeDocumentId,
    dispatch
  } = useEditorStore(useShallow((s) => ({
    toolMode: s.toolMode,
    pendingRequestId: s.pendingRequestId,
    snapshot: s.snapshot,
    canvasStatusHint: s.canvasStatusHint,
    showSourcePanel: s.showSourcePanel,
    showInspectorPanel: s.showInspectorPanel,
    showObjectsPanel: s.showObjectsPanel,
    showStylesPanel: s.showStylesPanel,
    showBuildsPanel: s.showBuildsPanel,
    showFiguresPanel: s.showFiguresPanel,
    showAssistantPanel: s.showAssistantPanel,
    rightSidebarTab: s.rightSidebarTab,
    showRulers: s.showRulers,
    documentKind: s.documentKind,
    activeDocumentId: s.activeDocumentId,
    dispatch: s.dispatch
  })));

  const syncLayout = useCallback((patch: LayoutPatch) => {
    dispatch({
      type: "SYNC_LAYOUT_STATE",
      sourceVisible: patch.sourceVisible ?? showSourcePanel,
      inspectorVisible: patch.inspectorVisible ?? showInspectorPanel,
      objectsVisible: patch.objectsVisible ?? showObjectsPanel,
      stylesVisible: patch.stylesVisible ?? showStylesPanel,
      buildsVisible: patch.buildsVisible ?? showBuildsPanel,
      figuresVisible: patch.figuresVisible ?? showFiguresPanel,
      assistantVisible: false,
      activeRightTab: patch.activeRightTab ?? coerceRightSidebarTab(rightSidebarTab, documentKind === "beamer")
    });
  }, [
    dispatch,
    documentKind,
    rightSidebarTab,
    showBuildsPanel,
    showFiguresPanel,
    showInspectorPanel,
    showObjectsPanel,
    showSourcePanel,
    showStylesPanel
  ]);

  useEffect(() => {
    if (didNormalizeInitialLayout.current) {
      return;
    }
    didNormalizeInitialLayout.current = true;
    const looksLikeDesktopDefault =
      showSourcePanel &&
      showInspectorPanel &&
      showObjectsPanel &&
      showStylesPanel &&
      !showFiguresPanel &&
      !showAssistantPanel &&
      rightSidebarTab === "inspector";
    if (!looksLikeDesktopDefault) {
      return;
    }
    dispatch({
      type: "SYNC_LAYOUT_STATE",
      sourceVisible: false,
      inspectorVisible: false,
      objectsVisible: false,
      stylesVisible: false,
      buildsVisible: false,
      figuresVisible: false,
      assistantVisible: false,
      activeRightTab: "inspector"
    });
    // Rulers read as desktop chrome on a touch canvas; the ⋯ menu brings them back.
    if (showRulers) {
      dispatch({ type: "TOGGLE_CANVAS_AID", aid: "rulers" });
    }
  }, [
    dispatch,
    rightSidebarTab,
    showAssistantPanel,
    showFiguresPanel,
    showInspectorPanel,
    showObjectsPanel,
    showRulers,
    showSourcePanel,
    showStylesPanel
  ]);

  useEffect(() => {
    if (!showAssistantPanel && rightSidebarTab !== "assistant") {
      return;
    }
    dispatch({
      type: "SYNC_LAYOUT_STATE",
      sourceVisible: showSourcePanel,
      inspectorVisible: showInspectorPanel,
      objectsVisible: showObjectsPanel,
      stylesVisible: showStylesPanel,
      figuresVisible: showFiguresPanel,
      assistantVisible: false,
      activeRightTab: coerceRightSidebarTab(rightSidebarTab, documentKind === "beamer")
    });
  }, [
    dispatch,
    documentKind,
    rightSidebarTab,
    showAssistantPanel,
    showFiguresPanel,
    showInspectorPanel,
    showObjectsPanel,
    showSourcePanel,
    showStylesPanel
  ]);

  useEffect(() => {
    if (toolMode !== "magnify") {
      return;
    }
    dispatch({ type: "SET_TOOL_MODE", mode: "select" });
  }, [dispatch, toolMode]);

  const closeZoomMenu = useCallback(() => { setZoomMenuOpen(false); }, []);
  const toggleZoomMenu = useCallback(() => { setZoomMenuOpen((open) => !open); }, []);
  const runZoomCommand = useCallback((commandId: AppMenuCommandId) => {
    setZoomMenuOpen(false);
    commandRuntime.runCommand(commandId, "platform");
  }, [commandRuntime]);
  // Fit is a mode to return to, not a toggle: choosing it again keeps it.
  const fitToContent = useCallback(() => {
    setZoomMenuOpen(false);
    dispatch({ type: "REQUEST_FIT_TO_CONTENT" });
  }, [dispatch]);
  const fitToContentModeActive = useEditorStore((s) => s.fitToContentModeActive);
  const zoomToActualSize = useCallback(() => {
    setZoomMenuOpen(false);
    dispatch({ type: "REQUEST_ZOOM_SCALE", scale: ACTUAL_SIZE_SCALE });
  }, [dispatch]);

  const deckMode = documentKind === "beamer";
  const activeRightTab = coerceRightSidebarTab(rightSidebarTab, deckMode);
  const rightPanelOpen = showInspectorPanel || showObjectsPanel || showStylesPanel || (deckMode && showBuildsPanel);
  const rightPanelTabs = deckMode ? RIGHT_PANEL_TABS : RIGHT_PANEL_TABS.filter((tab) => tab !== "builds");
  const activeRightPanelLabel = RIGHT_PANEL_LABELS[activeRightTab];
  const hasMultipleFigures = hasMultipleRoots(snapshotRoots(snapshot).length);
  const deckLocked = useEditorStore(s => !!s.documents[s.activeDocumentId]?.assistantLockReason);
  // A deck lists its slides even while it has only one.
  const navigatorAvailable = deckMode || hasMultipleFigures;
  const showFigureStrip = navigatorAvailable && showFiguresPanel;
  // In landscape the navigator is a column docked on the left, as in Keynote;
  // in portrait, where the slide leaves room above it, a strip along the top.
  const landscape = useLandscape();
  const navigatorDocked = showFigureStrip && landscape;

  // Decks open with their slides showing, as on the desktop.
  const deckNavigatorShownForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deckMode || deckNavigatorShownForRef.current === activeDocumentId) return;
    deckNavigatorShownForRef.current = activeDocumentId;
    // From the store as it is now: the initial-layout pass above may have
    // just closed panels this render's values still show open.
    const current = useEditorStore.getState();
    if (current.showFiguresPanel) return;
    dispatch({
      type: "SYNC_LAYOUT_STATE",
      sourceVisible: current.showSourcePanel,
      inspectorVisible: current.showInspectorPanel,
      objectsVisible: current.showObjectsPanel,
      stylesVisible: current.showStylesPanel,
      figuresVisible: true,
      assistantVisible: false,
      activeRightTab: coerceRightSidebarTab(current.rightSidebarTab, true)
    });
  }, [activeDocumentId, deckMode, dispatch]);
  const statusText = pendingRequestId ? "Rendering…" : canvasStatusHint;

  const toggleSourcePanel = useCallback(() => {
    syncLayout({ sourceVisible: !showSourcePanel });
  }, [showSourcePanel, syncLayout]);

  const toggleSourcePinned = useCallback(() => {
    setSourcePinned((pinned) => {
      storeSourcePinned(!pinned);
      return !pinned;
    });
  }, []);

  const dockSourcePanel = useCallback((width: number) => {
    const columnWidth = Math.min(Math.max(width, MIN_SOURCE_COLUMN_WIDTH), MAX_SOURCE_COLUMN_WIDTH);
    setSourceColumnWidth(columnWidth);
    storeSourceWidth(columnWidth);
    setSourcePinned(true);
    storeSourcePinned(true);
  }, []);

  const undockSourcePanel = useCallback(() => {
    setSourcePinned(false);
    storeSourcePinned(false);
  }, []);

  const sourceLineCount = useMemo(() => snapshot.source.split("\n").length, [snapshot.source]);

  const sourceFloat = useSourceFloat({
    workspaceRef,
    visible: showSourcePanel,
    pinned: sourcePinned,
    lineCount: sourceLineCount,
    onDock: dockSourcePanel,
    onUndock: undockSourcePanel
  });

  // Move the zoom chip out from underneath the floating source panel when the
  // panel covers the bottom-left corner of the workspace.
  const floatRect = showSourcePanel && !sourcePinned ? sourceFloat.rect : null;
  const floatWorkspace = sourceFloat.workspaceSize;
  const zoomChipShiftLeft =
    floatRect && floatWorkspace &&
    floatRect.x < 200 &&
    floatRect.y + floatRect.height > floatWorkspace.height - 140
      ? Math.round(Math.min(floatRect.x + floatRect.width + 12, floatWorkspace.width - 100))
      : null;

  const moveSourceResizeTo = useCallback((pointerId: number, clientX: number) => {
    const resize = sourceResizeRef.current;
    const workspace = workspaceRef.current;
    if (!workspace || resize?.pointerId !== pointerId) {
      return;
    }
    const maxWidth = Math.min(
      MAX_SOURCE_COLUMN_WIDTH,
      workspace.getBoundingClientRect().width * MAX_SOURCE_COLUMN_FRACTION
    );
    const nextWidth = Math.min(
      Math.max(resize.startWidth + clientX - resize.startClientX, MIN_SOURCE_COLUMN_WIDTH),
      Math.max(MIN_SOURCE_COLUMN_WIDTH, maxWidth)
    );
    setSourceColumnWidth(nextWidth);
  }, []);

  const finishSourceResize = useCallback((pointerId: number) => {
    if (sourceResizeRef.current?.pointerId !== pointerId) {
      return;
    }
    sourceResizeRef.current = null;
    setSourceResizing(false);
    setSourceColumnWidth((width) => {
      storeSourceWidth(width);
      return width;
    });
  }, []);

  const beginSourceResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a routing optimization; the window listeners below cover the drag.
    }
    sourceResizeRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: sourceColumnWidth
    };
    setSourceResizing(true);
  }, [sourceColumnWidth]);

  useEffect(() => {
    if (!sourceResizing) {
      return;
    }

    function onPointerMove(event: PointerEvent): void {
      event.preventDefault();
      moveSourceResizeTo(event.pointerId, event.clientX);
    }

    function onPointerEnd(event: PointerEvent): void {
      finishSourceResize(event.pointerId);
    }

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [finishSourceResize, moveSourceResizeTo, sourceResizing]);

  const setRightPanelTab = useCallback((tab: RightSidebarTab) => {
    syncLayout({
      inspectorVisible: tab === "inspector",
      objectsVisible: tab === "objects",
      stylesVisible: tab === "styles",
      buildsVisible: tab === "builds",
      activeRightTab: tab
    });
  }, [syncLayout]);

  const toggleRightPanel = useCallback(() => {
    if (rightPanelOpen) {
      syncLayout({
        inspectorVisible: false,
        objectsVisible: false,
        stylesVisible: false,
        buildsVisible: false,
        activeRightTab
      });
      return;
    }
    setRightPanelTab(activeRightTab);
  }, [activeRightTab, rightPanelOpen, setRightPanelTab, syncLayout]);

  const closeRightPanel = useCallback(() => {
    syncLayout({
      inspectorVisible: false,
      objectsVisible: false,
      stylesVisible: false,
      buildsVisible: false,
      activeRightTab
    });
  }, [activeRightTab, syncLayout]);

  const toggleFigures = useCallback(() => {
    syncLayout({ figuresVisible: navigatorAvailable ? !showFiguresPanel : false });
  }, [navigatorAvailable, showFiguresPanel, syncLayout]);

  const setToolMode = useCallback((nextMode: ToolMode) => {
    dispatch({ type: "SET_TOOL_MODE", mode: resolveToolbarToolMode(toolMode, nextMode) });
  }, [dispatch, toolMode]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || isTextEditingShortcutTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      const commandOrControl = event.metaKey || event.ctrlKey;
      if (!commandOrControl) {
        return;
      }

      if (event.altKey && !event.shiftKey) {
        if (key === "s") {
          toggleSourcePanel();
          event.preventDefault();
          return;
        }
        if (key === "i") {
          toggleRightPanel();
          event.preventDefault();
          return;
        }
        if (key === "f" && navigatorAvailable) {
          toggleFigures();
          event.preventDefault();
          return;
        }
      }

      if (!event.altKey && !event.shiftKey) {
        const shortcutMode = IPAD_NUMBERED_TOOL_SHORTCUTS[key];
        if (shortcutMode) {
          dispatch({ type: "SET_TOOL_MODE", mode: shortcutMode });
          event.preventDefault();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [dispatch, navigatorAvailable, toggleFigures, toggleRightPanel, toggleSourcePanel]);

  // How far the floating right panel reaches into the workspace from its right edge.
  const measureRightPanel = useCallback((panel: HTMLElement | null) => {
    if (!panel) {
      return;
    }
    const measure = () => {
      const workspace = workspaceRef.current;
      if (!workspace) {
        return;
      }
      setRightPanelInset(Math.max(0, workspace.getBoundingClientRect().right - panel.getBoundingClientRect().left));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      setRightPanelInset(0);
    };
  }, []);

  const paletteInsets = useMemo(() => paletteFitInsets(paletteDock), [paletteDock]);
  const fitInsetRight = Math.max(rightPanelOpen ? rightPanelInset : 0, paletteInsets.right);
  const fitInsetBottom = paletteInsets.bottom;
  const fitInsets = useMemo(
    () => ({ top: 0, right: fitInsetRight, bottom: fitInsetBottom, left: 0 }),
    [fitInsetBottom, fitInsetRight]
  );

  const sourceDocked = showSourcePanel && sourcePinned;
  const sourceOverlay = showSourcePanel && !sourcePinned;

  // Stable elements so per-frame drag re-renders of the shell skip these subtrees.
  const sourcePanelElement = useMemo(() => <SourcePanel />, []);
  const canvasPanelElement = useMemo(
    () => <CanvasPanel repeatPreviewModel={repeatPreviewModel} fitInsets={fitInsets} />,
    [fitInsets, repeatPreviewModel]
  );

  const sourceSurface = (
    <div
      className={css.sourcePanelStack}
      onFocus={() => { setHistorySurface("source"); }}
      onPointerDownCapture={() => { setHistorySurface("source"); }}
    >
      <div
        className={css.sourceHeader}
        data-select="chrome"
        data-testid="ipad-source-header"
        onPointerDown={sourceFloat.onHeaderPointerDown}
      >
        <span className={css.sourceHeaderTitle}>Source</span>
        <span className={css.sourceHeaderGrip} aria-hidden />
        <div className={css.sourceHeaderActions}>
          <button
            type="button"
            className={css.compactIconButton}
            onClick={toggleSourcePinned}
            aria-label={sourcePinned ? "Unpin source panel" : "Pin source panel"}
            title={sourcePinned ? "Unpin (float over canvas)" : "Pin (split with canvas)"}
            aria-pressed={sourcePinned}
            data-testid="ipad-source-pin"
          >
            {sourcePinned ? <RiPushpinFill size={18} aria-hidden /> : <RiPushpinLine size={18} aria-hidden />}
          </button>
          <button
            type="button"
            className={css.compactIconButton}
            onClick={toggleSourcePanel}
            aria-label="Close source panel"
            title="Close source panel"
            data-testid="ipad-source-close"
          >
            <RiCloseLine size={18} aria-hidden />
          </button>
        </div>
      </div>
      <div className={css.sourcePanelContent}>
        {sourcePanelElement}
      </div>
      <SourceAccessoryBar />
    </div>
  );

  return (
    <div className={css.shell} data-testid="ipad-editor-shell">
      <IpadNavBar
        commandRuntime={commandRuntime}
        onRequestCloseDocument={onRequestCloseDocument}
        documentsOpen={documentGalleryOpen}
        onShowDocuments={() => { setDocumentGalleryOpen(true); }}
        showSourcePanel={showSourcePanel}
        onToggleSource={toggleSourcePanel}
        sourceToggleEnabled={commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SOURCE_PANEL].enabled === true}
        inspectorOpen={rightPanelOpen}
        onToggleInspector={toggleRightPanel}
        inspectorToggleEnabled={
          commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_INSPECTOR_PANEL].enabled === true ||
          commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_OBJECTS_PANEL].enabled === true ||
          commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_STYLES_PANEL].enabled === true
        }
        navigatorLabel={navigatorAvailable ? (deckMode ? "Slides" : "Figures") : null}
        showFiguresPanel={showFigureStrip}
        onToggleFigures={toggleFigures}
        sourceHistory={showSourcePanel && historySurface === "source" ? sourceEditorHistory : null}
        updateChip={updateChip}
      />

      <div
        ref={workspaceRef}
        className={css.workspace}
        style={{ ["--ipad-source-col" as string]: `${Math.round(sourceColumnWidth)}px` }}
        data-source-visible={showSourcePanel ? "true" : "false"}
        data-source-pinned={sourcePinned ? "true" : "false"}
        data-right-panel-visible={rightPanelOpen ? "true" : "false"}
        data-figures-visible={showFigureStrip && !navigatorDocked ? "true" : "false"}
        data-navigator={navigatorDocked ? "left" : "none"}
        data-palette-dock={paletteDock.kind === "edge" ? paletteDock.edge : "corner"}
      >
        {showFigureStrip ? (
          <div
            className={navigatorDocked ? css.navigatorColumn : css.figureStrip}
            data-select="chrome"
            data-testid="ipad-navigator"
          >
            <RootNavigator vertical={navigatorDocked} />
            {deckMode ? (
              <button
                type="button"
                className={css.navigatorAdd}
                aria-label="New Slide"
                title="New Slide"
                disabled={deckLocked}
                onClick={insertSlideAfterCurrent}
                data-testid="ipad-new-slide"
              >
                <RiAddLine size={20} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}

        <main className={[css.stage, sourceDocked ? css.stageSplit : ""].filter(Boolean).join(" ")}>
          {sourceDocked ? (
            <>
              <section
                className={css.sourceColumn}
                aria-label="Source"
                style={{ width: `min(${Math.round(sourceColumnWidth)}px, ${MAX_SOURCE_COLUMN_FRACTION * 100}%)` }}
              >
                {sourceSurface}
              </section>
              <button
                type="button"
                className={css.splitDivider}
                role="separator"
                aria-label="Resize source panel"
                aria-orientation="vertical"
                aria-valuemin={MIN_SOURCE_COLUMN_WIDTH}
                aria-valuemax={MAX_SOURCE_COLUMN_WIDTH}
                aria-valuenow={Math.round(sourceColumnWidth)}
                title="Resize source panel"
                data-active={sourceResizing ? "true" : "false"}
                data-testid="ipad-source-resize"
                onPointerDown={beginSourceResize}
              >
                <span className={css.splitDividerBar} aria-hidden />
              </button>
            </>
          ) : null}
          <section
            className={css.canvasFrame}
            onPointerDownCapture={() => { setHistorySurface("document"); }}
          >
            {canvasPanelElement}
          </section>
        </main>

        {sourceOverlay && sourceFloat.dockPreview ? (
          <div
            className={css.dockPreviewZone}
            style={{
              width: Math.round(Math.min(
                sourceColumnWidth,
                (sourceFloat.workspaceSize?.width ?? sourceColumnWidth) * MAX_SOURCE_COLUMN_FRACTION
              ))
            }}
            aria-hidden
            data-testid="ipad-source-dock-preview"
          />
        ) : null}

        {sourceOverlay && sourceFloat.rect ? (
          <section
            className={css.sourceDrawer}
            aria-label="Source"
            data-testid="ipad-source-drawer"
            data-dragging={sourceFloat.dragging ? "true" : "false"}
            data-settling={sourceFloat.settling && !sourceFloat.dragging && !sourceFloat.resizing ? "true" : "false"}
            style={{
              left: Math.round(sourceFloat.rect.x),
              top: Math.round(sourceFloat.rect.y),
              width: Math.round(sourceFloat.rect.width),
              height: Math.round(sourceFloat.rect.height)
            }}
            onTransitionEnd={sourceFloat.onSettled}
          >
            {sourceSurface}
            <button
              type="button"
              className={css.floatResizeHandle}
              aria-label="Resize source panel"
              title="Resize source panel"
              data-testid="ipad-source-float-resize"
              onPointerDown={sourceFloat.onResizePointerDown}
            />
          </section>
        ) : null}

        {rightPanelOpen ? (
          <aside
            ref={measureRightPanel}
            className={css.floatingPanel}
            aria-label={activeRightPanelLabel}
            data-testid="ipad-floating-panel"
          >
            <div className={css.floatingPanelHeader} data-select="chrome">
              <div className={css.segmentedControl} role="tablist" aria-label="Right panel">
                {rightPanelTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    className={[css.segment, activeRightTab === tab ? css.segmentActive : ""].filter(Boolean).join(" ")}
                    aria-selected={activeRightTab === tab}
                    disabled={!commandRuntime.bindings[RIGHT_PANEL_TAB_COMMANDS[tab]].enabled}
                    onClick={() => { setRightPanelTab(tab); }}
                    data-testid={`ipad-panel-tab-${tab}`}
                  >
                    {RIGHT_PANEL_LABELS[tab]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={css.compactIconButton}
                onClick={closeRightPanel}
                aria-label={`Close ${activeRightPanelLabel}`}
                title={`Close ${activeRightPanelLabel}`}
              >
                <RiCloseLine size={20} aria-hidden />
              </button>
            </div>
            <div className={css.floatingPanelBody}>
              <RightPanel activeTab={activeRightTab} />
            </div>
          </aside>
        ) : null}

        <IpadToolPalette
          toolMode={toolMode}
          onSelectTool={setToolMode}
          onDockChange={setPaletteDock}
        />

        {statusText ? (
          <div className={css.hintChip} data-select="chrome" aria-live="polite">
            {statusText}
          </div>
        ) : null}

        <div
          className={[
            css.zoomChip,
            (paletteDock.kind === "corner" && paletteDock.corner === "bottom-left" && !showSourcePanel) ||
            (paletteDock.kind === "edge" && paletteDock.edge === "bottom" && showSourcePanel)
              ? css.zoomChipRaised
              : "",
            zoomMenuOpen ? css.zoomChipMenuOpen : ""
          ].filter(Boolean).join(" ")}
          style={zoomChipShiftLeft != null ? { left: zoomChipShiftLeft } : undefined}
          data-select="chrome"
        >
          <IpadPopover
            open={zoomMenuOpen}
            onClose={closeZoomMenu}
            align="start"
            direction="up"
            ariaLabel="Zoom"
            testId="ipad-zoom-popover"
            trigger={
              <button
                type="button"
                className={css.zoomChipButton}
                aria-label="Zoom"
                title="Zoom"
                aria-haspopup="dialog"
                aria-expanded={zoomMenuOpen}
                onClick={toggleZoomMenu}
                data-testid="ipad-zoom-button"
              >
                <ZoomChipLabel />
              </button>
            }
          >
            <IpadMenu ariaLabel="Zoom">
              <IpadMenuItem
                label="Zoom In"
                icon={<RiAddLine size={18} />}
                disabled={!commandRuntime.bindings[APP_MENU_COMMAND_IDS.ZOOM_IN].enabled}
                onSelect={() => { runZoomCommand(APP_MENU_COMMAND_IDS.ZOOM_IN); }}
              />
              <IpadMenuItem
                label="Zoom Out"
                icon={<RiSubtractLine size={18} />}
                disabled={!commandRuntime.bindings[APP_MENU_COMMAND_IDS.ZOOM_OUT].enabled}
                onSelect={() => { runZoomCommand(APP_MENU_COMMAND_IDS.ZOOM_OUT); }}
              />
              <IpadMenuItem
                label="Actual Size"
                icon={<RiFullscreenExitLine size={18} />}
                onSelect={zoomToActualSize}
              />
              <IpadMenuItem
                label={deckMode ? "Fit Slide" : "Fit to Content"}
                icon={<RiAspectRatioLine size={18} />}
                checked={fitToContentModeActive}
                disabled={!commandRuntime.bindings[APP_MENU_COMMAND_IDS.FIT_TO_CONTENT].enabled}
                onSelect={fitToContent}
              />
            </IpadMenu>
          </IpadPopover>
          {deckMode && !fitToContentModeActive ? (
            <button
              type="button"
              className={css.fitChipButton}
              onClick={fitToContent}
              aria-label="Fit Slide"
              title="Fit Slide"
              data-testid="ipad-fit-button"
            >
              <RiAspectRatioLine size={18} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      <IpadDocumentGallery
        open={documentGalleryOpen}
        onClose={() => { setDocumentGalleryOpen(false); }}
        commandRuntime={commandRuntime}
        onRequestCloseDocument={onRequestCloseDocument}
      />
      <InAppPresentationHost />
    </div>
  );
}

const RIGHT_PANEL_TAB_COMMANDS: Record<RightSidebarTab, AppMenuCommandId> = {
  inspector: APP_MENU_COMMAND_IDS.TOGGLE_INSPECTOR_PANEL,
  objects: APP_MENU_COMMAND_IDS.TOGGLE_OBJECTS_PANEL,
  styles: APP_MENU_COMMAND_IDS.TOGGLE_STYLES_PANEL,
  builds: APP_MENU_COMMAND_IDS.TOGGLE_BUILDS_PANEL
};

type SourceAccessoryItem = {
  label: string;
  detail: SourceAccessoryCommandDetail;
  icon?: ReactNode;
  keycap?: string;
};

// Undo and Redo act on the source editor's own history, which the nav bar's
// document-level undo does not cover while typing.
const SOURCE_ACCESSORY_GROUPS: ReadonlyArray<readonly SourceAccessoryItem[]> = [
  [
    { label: "Undo", detail: { command: "undo" }, icon: <RiArrowGoBackLine size={18} aria-hidden /> },
    { label: "Redo", detail: { command: "redo" }, icon: <RiArrowGoForwardLine size={18} aria-hidden /> }
  ],
  [
    { label: "Outdent", detail: { command: "outdent" }, icon: <RiIndentDecrease size={18} aria-hidden /> },
    { label: "Indent", detail: { command: "indent" }, icon: <RiIndentIncrease size={18} aria-hidden /> },
    { label: "Toggle comment", detail: { command: "comment" }, keycap: "%" }
  ],
  [
    { label: "Backslash", detail: { command: "insert", text: "\\" }, keycap: "\\" },
    { label: "Braces", detail: { command: "insert", text: "{}", cursorOffset: 1 }, keycap: "{ }" },
    { label: "Brackets", detail: { command: "insert", text: "[]", cursorOffset: 1 }, keycap: "[ ]" },
    { label: "Parentheses", detail: { command: "insert", text: "()", cursorOffset: 1 }, keycap: "( )" },
    { label: "Math", detail: { command: "insert", text: "$$", cursorOffset: 1 }, keycap: "$ $" },
    { label: "Semicolon", detail: { command: "insert", text: ";" }, keycap: ";" }
  ]
];

function SourceAccessoryBar() {
  return (
    <div className={css.sourceAccessoryBar} data-select="chrome" aria-label="Source editing controls">
      {SOURCE_ACCESSORY_GROUPS.map((group, groupIndex) => (
        <div key={groupIndex} className={css.sourceAccessoryGroup}>
          {group.map((item) => (
            <button
              key={item.label}
              type="button"
              className={[css.sourceAccessoryButton, item.keycap ? css.sourceAccessoryKeycap : ""].filter(Boolean).join(" ")}
              // Keep focus (and the software keyboard) in the editor.
              onMouseDown={(event) => { event.preventDefault(); }}
              onClick={() => { requestSourceAccessoryCommand(item.detail); }}
              aria-label={item.label}
              title={item.label}
            >
              {item.icon ?? item.keycap}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// Subscribes on its own so pinch and pan frames re-render only the label.
function ZoomChipLabel() {
  const scale = useEditorStore((s) => s.canvasTransform.scale);
  return <>{zoomPercentForScale(scale)}%</>;
}

function RightPanel({ activeTab }: { activeTab: RightSidebarTab }) {
  switch (activeTab) {
    case "objects":
      return <ObjectsPanel />;
    case "styles":
      return <StylesPanel />;
    case "builds":
      return <BuildsPanel />;
    case "inspector":
    default:
      return <InspectorPanelSwitch />;
  }
}

const LANDSCAPE_QUERY = "(orientation: landscape)";

function subscribeOrientation(onChange: () => void): () => void {
  const query = window.matchMedia(LANDSCAPE_QUERY);
  query.addEventListener("change", onChange);
  return () => { query.removeEventListener("change", onChange); };
}

function useLandscape(): boolean {
  return useSyncExternalStore(
    subscribeOrientation,
    () => window.matchMedia(LANDSCAPE_QUERY).matches,
    () => false
  );
}
