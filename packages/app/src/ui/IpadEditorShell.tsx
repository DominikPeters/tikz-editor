import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import {
  RiCloseLine,
  RiLayoutRightLine,
  RiPaletteLine,
  RiStackLine,
  RiSubtractLine,
  RiAddLine,
  RiAspectRatioLine
} from "@remixicon/react";
import { useShallow } from "zustand/react/shallow";
import type { SvgRenderModel } from "tikz-editor/svg";
import { APP_MENU_COMMAND_IDS, type AppMenuCommandId } from "../app-menu";
import { useEditorStore } from "../store/store";
import type { ToolMode } from "../store/types";
import { CanvasPanel } from "./CanvasPanel";
import type { EditorCommandRuntime } from "./editor-command-runtime";
import { FigureNavigator } from "./FigureNavigator";
import { InspectorPanel } from "./InspectorPanel";
import { ObjectsPanel } from "./ObjectsPanel";
import { SourcePanel } from "./SourcePanel";
import { StylesPanel } from "./StylesPanel";
import { IpadNavBar } from "./ipad/IpadNavBar";
import { IpadMenu, IpadMenuItem, IpadPopover } from "./ipad/IpadPopover";
import { IpadToolPalette, type PaletteDock } from "./ipad/IpadToolPalette";
import { isCodeMirrorEventTarget } from "./editor-commands";
import { requestSourceAccessoryCommand, type SourceAccessoryCommandDetail } from "./source-sync";
import { resolveToolbarToolMode } from "./tool-config";
import css from "./IpadEditorShell.module.css";

type RightSidebarTab = "inspector" | "objects" | "styles";
type PanelResizeSide = "source" | "right";
type PanelResizeState = {
  pointerId: number;
  startClientX: number;
  surfaceWidth: number;
  startSourceWidth: number;
  startRightWidth: number;
};

type IconComponent = typeof RiCloseLine;

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
  figuresVisible: boolean;
  assistantVisible: boolean;
  activeRightTab: RightSidebarTab;
}>;

const RIGHT_PANEL_LABELS: Record<RightSidebarTab, string> = {
  inspector: "Inspector",
  objects: "Objects",
  styles: "Styles"
};
const SOURCE_PANEL_WIDTH_STORAGE_KEY = "tikz-editor-ipad-source-panel-width";
const RIGHT_PANEL_WIDTH_STORAGE_KEY = "tikz-editor-ipad-right-panel-width";
const DEFAULT_SOURCE_PANEL_WIDTH = 360;
const DEFAULT_RIGHT_PANEL_WIDTH = 360;
const MIN_SOURCE_PANEL_WIDTH = 220;
const MIN_RIGHT_PANEL_WIDTH = 280;
const MIN_CANVAS_COLUMN_WIDTH = 320;
const PANEL_RESIZE_HANDLE_WIDTH = 8;
const COMPACT_WORKSPACE_WIDTH = 920;
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

function coerceRightSidebarTab(tab: RightSidebarTab | "assistant"): RightSidebarTab {
  return tab === "assistant" ? "inspector" : tab;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readStoredPanelWidth(key: string, fallback: number): number {
  if (typeof localStorage === "undefined") {
    return fallback;
  }
  const stored = Number(localStorage.getItem(key));
  return Number.isFinite(stored) && stored > 0 ? stored : fallback;
}

function storePanelWidth(key: string, width: number): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // Width persistence is nice-to-have; resizing still works in-memory.
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

function clampPanelWidth(width: number, min: number, max: number): number {
  return clampNumber(width, min, Math.max(min, max));
}

export function IpadEditorShell({
  commandRuntime,
  repeatPreviewModel,
  onRequestCloseDocument,
  updateChip = null
}: IpadEditorShellProps) {
  const didNormalizeInitialLayout = useRef(false);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const panelResizeRef = useRef<PanelResizeState | null>(null);
  const wasCompactWorkspaceRef = useRef(false);
  const [sourcePanelWidth, setSourcePanelWidth] = useState(() =>
    readStoredPanelWidth(SOURCE_PANEL_WIDTH_STORAGE_KEY, DEFAULT_SOURCE_PANEL_WIDTH)
  );
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    readStoredPanelWidth(RIGHT_PANEL_WIDTH_STORAGE_KEY, DEFAULT_RIGHT_PANEL_WIDTH)
  );
  const [panelResizeSide, setPanelResizeSide] = useState<PanelResizeSide | null>(null);
  const {
    toolMode,
    pendingRequestId,
    snapshot,
    canvasFitToContentScale,
    canvasStatusHint,
    showSourcePanel,
    showInspectorPanel,
    showObjectsPanel,
    showStylesPanel,
    showFiguresPanel,
    showAssistantPanel,
    rightSidebarTab,
    dispatch
  } = useEditorStore(useShallow((s) => ({
    toolMode: s.toolMode,
    pendingRequestId: s.pendingRequestId,
    snapshot: s.snapshot,
    canvasFitToContentScale: s.canvasFitToContentScale,
    canvasStatusHint: s.canvasStatusHint,
    showSourcePanel: s.showSourcePanel,
    showInspectorPanel: s.showInspectorPanel,
    showObjectsPanel: s.showObjectsPanel,
    showStylesPanel: s.showStylesPanel,
    showFiguresPanel: s.showFiguresPanel,
    showAssistantPanel: s.showAssistantPanel,
    rightSidebarTab: s.rightSidebarTab,
    dispatch: s.dispatch
  })));

  const syncLayout = useCallback((patch: LayoutPatch) => {
    dispatch({
      type: "SYNC_LAYOUT_STATE",
      sourceVisible: patch.sourceVisible ?? showSourcePanel,
      inspectorVisible: patch.inspectorVisible ?? showInspectorPanel,
      objectsVisible: patch.objectsVisible ?? showObjectsPanel,
      stylesVisible: patch.stylesVisible ?? showStylesPanel,
      figuresVisible: patch.figuresVisible ?? showFiguresPanel,
      assistantVisible: false,
      activeRightTab: patch.activeRightTab ?? coerceRightSidebarTab(rightSidebarTab)
    });
  }, [
    dispatch,
    rightSidebarTab,
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
      figuresVisible: false,
      assistantVisible: false,
      activeRightTab: "inspector"
    });
  }, [
    dispatch,
    rightSidebarTab,
    showAssistantPanel,
    showFiguresPanel,
    showInspectorPanel,
    showObjectsPanel,
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
      activeRightTab: coerceRightSidebarTab(rightSidebarTab)
    });
  }, [
    dispatch,
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

  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [paletteDock, setPaletteDock] = useState<PaletteDock>({ kind: "edge", edge: "bottom" });
  const closeZoomMenu = useCallback(() => { setZoomMenuOpen(false); }, []);
  const toggleZoomMenu = useCallback(() => { setZoomMenuOpen((open) => !open); }, []);
  const runZoomCommand = useCallback((commandId: AppMenuCommandId) => {
    setZoomMenuOpen(false);
    commandRuntime.runCommand(commandId, "platform");
  }, [commandRuntime]);

  const activeRightTab = coerceRightSidebarTab(rightSidebarTab);
  const rightPanelOpen = showInspectorPanel || showObjectsPanel || showStylesPanel;
  const activeRightPanelLabel = RIGHT_PANEL_LABELS[activeRightTab];
  const figureCount = snapshot.figures.length;
  const hasMultipleFigures = figureCount > 1;
  const showFigureStrip = hasMultipleFigures && showFiguresPanel;
  const zoomPercent = canvasFitToContentScale ? `${Math.round(canvasFitToContentScale * 100)}%` : "Fit";
  const statusText = pendingRequestId ? "Rendering…" : canvasStatusHint;

  const toggleSourcePanel = useCallback(() => {
    syncLayout({ sourceVisible: !showSourcePanel });
  }, [showSourcePanel, syncLayout]);

  const setRightPanelTab = useCallback((tab: RightSidebarTab) => {
    syncLayout({
      inspectorVisible: tab === "inspector",
      objectsVisible: tab === "objects",
      stylesVisible: tab === "styles",
      activeRightTab: tab
    });
  }, [syncLayout]);

  const toggleRightPanel = useCallback(() => {
    if (rightPanelOpen) {
      syncLayout({
        inspectorVisible: false,
        objectsVisible: false,
        stylesVisible: false,
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
      activeRightTab
    });
  }, [activeRightTab, syncLayout]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }

    const syncCompactState = () => {
      const isCompact = workspace.getBoundingClientRect().width < COMPACT_WORKSPACE_WIDTH;
      if (isCompact && !wasCompactWorkspaceRef.current && (showSourcePanel || rightPanelOpen)) {
        syncLayout({
          sourceVisible: false,
          inspectorVisible: false,
          objectsVisible: false,
          stylesVisible: false,
          activeRightTab
        });
      }
      wasCompactWorkspaceRef.current = isCompact;
    };

    syncCompactState();
    const observer = new ResizeObserver(syncCompactState);
    observer.observe(workspace);
    return () => { observer.disconnect(); };
  }, [activeRightTab, rightPanelOpen, showSourcePanel, syncLayout]);

  const toggleFigures = useCallback(() => {
    syncLayout({ figuresVisible: hasMultipleFigures ? !showFiguresPanel : false });
  }, [hasMultipleFigures, showFiguresPanel, syncLayout]);

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
        if (key === "f" && hasMultipleFigures) {
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
  }, [dispatch, hasMultipleFigures, toggleFigures, toggleRightPanel, toggleSourcePanel]);

  const updatePanelResize = useCallback((pointerId: number, clientX: number) => {
    const resize = panelResizeRef.current;
    if (resize?.pointerId !== pointerId) {
      return;
    }
    const handleSpace =
      (showSourcePanel ? PANEL_RESIZE_HANDLE_WIDTH : 0) +
      (rightPanelOpen ? PANEL_RESIZE_HANDLE_WIDTH : 0);
    const availablePanelSpace = Math.max(
      MIN_SOURCE_PANEL_WIDTH + MIN_RIGHT_PANEL_WIDTH,
      resize.surfaceWidth - MIN_CANVAS_COLUMN_WIDTH - handleSpace
    );
    const deltaX = clientX - resize.startClientX;

    if (resize.pointerId === pointerId && panelResizeSide === "source") {
      const maxSourceWidth = rightPanelOpen
        ? availablePanelSpace - rightPanelWidth
        : resize.surfaceWidth - MIN_CANVAS_COLUMN_WIDTH - handleSpace;
      const nextWidth = clampPanelWidth(
        resize.startSourceWidth + deltaX,
        MIN_SOURCE_PANEL_WIDTH,
        maxSourceWidth
      );
      setSourcePanelWidth(nextWidth);
      return;
    }

    if (resize.pointerId === pointerId && panelResizeSide === "right") {
      const maxRightWidth = showSourcePanel
        ? availablePanelSpace - sourcePanelWidth
        : resize.surfaceWidth - MIN_CANVAS_COLUMN_WIDTH - handleSpace;
      const nextWidth = clampPanelWidth(
        resize.startRightWidth - deltaX,
        MIN_RIGHT_PANEL_WIDTH,
        maxRightWidth
      );
      setRightPanelWidth(nextWidth);
    }
  }, [panelResizeSide, rightPanelOpen, rightPanelWidth, showSourcePanel, sourcePanelWidth]);

  const finishPanelResize = useCallback((pointerId: number) => {
    const resize = panelResizeRef.current;
    if (resize?.pointerId !== pointerId) {
      return;
    }
    panelResizeRef.current = null;
    setPanelResizeSide(null);
    storePanelWidth(SOURCE_PANEL_WIDTH_STORAGE_KEY, sourcePanelWidth);
    storePanelWidth(RIGHT_PANEL_WIDTH_STORAGE_KEY, rightPanelWidth);
  }, [rightPanelWidth, sourcePanelWidth]);

  const beginPanelResize = useCallback((side: PanelResizeSide, event: ReactPointerEvent<HTMLButtonElement>) => {
    const surface = editorSurfaceRef.current;
    if (!surface) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panelResizeRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      surfaceWidth: surface.getBoundingClientRect().width,
      startSourceWidth: sourcePanelWidth,
      startRightWidth: rightPanelWidth
    };
    setPanelResizeSide(side);
  }, [rightPanelWidth, sourcePanelWidth]);

  const movePanelResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    updatePanelResize(event.pointerId, event.clientX);
  }, [updatePanelResize]);

  const endPanelResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishPanelResize(event.pointerId);
  }, [finishPanelResize]);

  useEffect(() => {
    if (!panelResizeSide) {
      return;
    }

    function onPointerMove(event: PointerEvent): void {
      event.preventDefault();
      updatePanelResize(event.pointerId, event.clientX);
    }

    function onPointerEnd(event: PointerEvent): void {
      finishPanelResize(event.pointerId);
    }

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [finishPanelResize, panelResizeSide, updatePanelResize]);

  const editorSurfaceStyle = {
    "--ipad-source-panel-width": `${Math.round(sourcePanelWidth)}px`,
    "--ipad-right-panel-width": `${Math.round(rightPanelWidth)}px`
  } as CSSProperties;

  return (
    <div className={css.shell} data-testid="ipad-editor-shell">
      <IpadNavBar
        commandRuntime={commandRuntime}
        onRequestCloseDocument={onRequestCloseDocument}
        showSourcePanel={showSourcePanel}
        onToggleSource={toggleSourcePanel}
        sourceToggleEnabled={commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SOURCE_PANEL]?.enabled === true}
        inspectorOpen={rightPanelOpen}
        onToggleInspector={toggleRightPanel}
        inspectorToggleEnabled={
          commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_INSPECTOR_PANEL]?.enabled === true ||
          commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_OBJECTS_PANEL]?.enabled === true ||
          commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_STYLES_PANEL]?.enabled === true
        }
        hasMultipleFigures={hasMultipleFigures}
        showFiguresPanel={showFiguresPanel}
        onToggleFigures={toggleFigures}
        updateChip={updateChip}
      />

      <div
        ref={workspaceRef}
        className={css.workspace}
        data-source-visible={showSourcePanel ? "true" : "false"}
        data-right-panel-visible={rightPanelOpen ? "true" : "false"}
      >
        {showFigureStrip ? (
          <div className={css.figureStrip} data-select="chrome">
            <FigureNavigator />
          </div>
        ) : null}
        <main className={css.stage}>
          <div
            ref={editorSurfaceRef}
            style={editorSurfaceStyle}
            className={[
              css.editorSurface,
              showSourcePanel ? css.editorSurfaceWithSource : "",
              rightPanelOpen ? css.editorSurfaceWithRight : ""
            ].filter(Boolean).join(" ")}
          >
            {showSourcePanel ? (
              <PanelFrame kind="source">
                <div className={css.sourcePanelStack}>
                  <div className={css.sourcePanelContent}>
                    <SourcePanel />
                  </div>
                  <SourceAccessoryBar />
                </div>
              </PanelFrame>
            ) : null}
            {showSourcePanel ? (
              <PanelResizeHandle
                side="source"
                isActive={panelResizeSide === "source"}
                value={sourcePanelWidth}
                onPointerDown={beginPanelResize}
                onPointerMove={movePanelResize}
                onPointerUp={endPanelResize}
              />
            ) : null}
            <PanelFrame kind="canvas">
              <CanvasPanel repeatPreviewModel={repeatPreviewModel} />
            </PanelFrame>
            {rightPanelOpen ? (
              <PanelResizeHandle
                side="right"
                isActive={panelResizeSide === "right"}
                value={rightPanelWidth}
                onPointerDown={beginPanelResize}
                onPointerMove={movePanelResize}
                onPointerUp={endPanelResize}
              />
            ) : null}
            {rightPanelOpen ? (
              <aside className={css.rightPanel} aria-label={activeRightPanelLabel}>
                <div className={css.rightPanelHeader} data-select="chrome">
                  <div className={css.rightPanelTabs} role="tablist" aria-label="Right panel">
                    <PanelTabButton
                      label="Inspector"
                      icon={RiLayoutRightLine}
                      active={activeRightTab === "inspector"}
                      disabled={!commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_INSPECTOR_PANEL]?.enabled}
                      onClick={() => { setRightPanelTab("inspector"); }}
                    />
                    <PanelTabButton
                      label="Objects"
                      icon={RiStackLine}
                      active={activeRightTab === "objects"}
                      disabled={!commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_OBJECTS_PANEL]?.enabled}
                      onClick={() => { setRightPanelTab("objects"); }}
                    />
                    <PanelTabButton
                      label="Styles"
                      icon={RiPaletteLine}
                      active={activeRightTab === "styles"}
                      disabled={!commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_STYLES_PANEL]?.enabled}
                      onClick={() => { setRightPanelTab("styles"); }}
                    />
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
                <div className={css.rightPanelBody}>
                  <RightPanel activeTab={activeRightTab} />
                </div>
              </aside>
            ) : null}
          </div>
        </main>

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
            paletteDock.kind === "corner" && paletteDock.corner === "bottom-left" ? css.zoomChipRaised : ""
          ].filter(Boolean).join(" ")}
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
                {zoomPercent}
              </button>
            }
          >
            <IpadMenu ariaLabel="Zoom">
              <IpadMenuItem
                label="Zoom In"
                icon={<RiAddLine size={18} />}
                disabled={!commandRuntime.bindings[APP_MENU_COMMAND_IDS.ZOOM_IN]?.enabled}
                onSelect={() => { runZoomCommand(APP_MENU_COMMAND_IDS.ZOOM_IN); }}
              />
              <IpadMenuItem
                label="Zoom Out"
                icon={<RiSubtractLine size={18} />}
                disabled={!commandRuntime.bindings[APP_MENU_COMMAND_IDS.ZOOM_OUT]?.enabled}
                onSelect={() => { runZoomCommand(APP_MENU_COMMAND_IDS.ZOOM_OUT); }}
              />
              <IpadMenuItem
                label="Fit to Content"
                icon={<RiAspectRatioLine size={18} />}
                disabled={!commandRuntime.bindings[APP_MENU_COMMAND_IDS.FIT_TO_CONTENT]?.enabled}
                onSelect={() => { runZoomCommand(APP_MENU_COMMAND_IDS.FIT_TO_CONTENT); }}
              />
            </IpadMenu>
          </IpadPopover>
        </div>
      </div>
    </div>
  );
}

function PanelResizeHandle({
  side,
  isActive,
  value,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: {
  side: PanelResizeSide;
  isActive: boolean;
  value: number;
  onPointerDown: (side: PanelResizeSide, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const label = side === "source" ? "Resize Source" : "Resize Inspector";
  return (
    <button
      type="button"
      className={[
        css.panelResizeHandle,
        side === "source" ? css.sourceResizeHandle : css.rightResizeHandle,
        isActive ? css.panelResizeHandleActive : ""
      ].filter(Boolean).join(" ")}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={side === "source" ? MIN_SOURCE_PANEL_WIDTH : MIN_RIGHT_PANEL_WIDTH}
      aria-valuenow={Math.round(value)}
      title={label}
      data-active={isActive ? "true" : "false"}
      style={{ touchAction: "none" }}
      onPointerDown={(event) => { onPointerDown(side, event); }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

const SOURCE_ACCESSORY_ITEMS: Array<{ label: string; detail: SourceAccessoryCommandDetail }> = [
  { label: "Undo", detail: { command: "undo" } },
  { label: "Redo", detail: { command: "redo" } },
  { label: "Outdent", detail: { command: "outdent" } },
  { label: "Indent", detail: { command: "indent" } },
  { label: "\\", detail: { command: "insert", text: "\\" } },
  { label: "{ }", detail: { command: "insert", text: "{}", cursorOffset: 1 } },
  { label: ";", detail: { command: "insert", text: ";" } },
  { label: "$ $", detail: { command: "insert", text: "$$", cursorOffset: 1 } },
  { label: "%", detail: { command: "comment" } }
];

function SourceAccessoryBar() {
  return (
    <div className={css.sourceAccessoryBar} data-select="chrome" aria-label="Source editing controls">
      {SOURCE_ACCESSORY_ITEMS.map((item) => (
        <button
          key={`${item.label}-${item.detail.command}`}
          type="button"
          className={css.sourceAccessoryButton}
          onClick={() => { requestSourceAccessoryCommand(item.detail); }}
          aria-label={item.label}
          title={item.label}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function PanelTabButton({
  label,
  icon: Icon,
  active,
  disabled = false,
  onClick
}: {
  label: string;
  icon: IconComponent;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      className={[css.panelTab, active ? css.panelTabActive : ""].filter(Boolean).join(" ")}
      disabled={disabled}
      aria-selected={active}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon size={18} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

function PanelFrame({
  kind,
  children
}: {
  kind: "canvas" | "source";
  children: ReactNode;
}) {
  return <section className={[css.panelFrame, css[`${kind}Frame`]].join(" ")}>{children}</section>;
}

function RightPanel({ activeTab }: { activeTab: RightSidebarTab }) {
  switch (activeTab) {
    case "objects":
      return <ObjectsPanel />;
    case "styles":
      return <StylesPanel />;
    case "inspector":
    default:
      return <InspectorPanel />;
  }
}
