import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  RiAddLine,
  RiAspectRatioLine,
  RiCloseLine,
  RiPushpinFill,
  RiPushpinLine,
  RiSubtractLine
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
const RIGHT_PANEL_TABS: readonly RightSidebarTab[] = ["inspector", "objects", "styles"];
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

function coerceRightSidebarTab(tab: RightSidebarTab | "assistant"): RightSidebarTab {
  return tab === "assistant" ? "inspector" : tab;
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
  const [paletteDock, setPaletteDock] = useState<PaletteDock>({ kind: "edge", edge: "bottom" });
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

  const toggleSourcePinned = useCallback(() => {
    setSourcePinned((pinned) => {
      storeSourcePinned(!pinned);
      return !pinned;
    });
  }, []);

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

  const sourceDocked = showSourcePanel && sourcePinned;
  const sourceOverlay = showSourcePanel && !sourcePinned;

  const sourceSurface = (
    <div className={css.sourcePanelStack}>
      <div className={css.sourceHeader} data-select="chrome">
        <span className={css.sourceHeaderTitle}>Source</span>
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
        <SourcePanel />
      </div>
      <SourceAccessoryBar />
    </div>
  );

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
        style={{ "--ipad-source-col": `${Math.round(sourceColumnWidth)}px` } as CSSProperties}
        data-source-visible={showSourcePanel ? "true" : "false"}
        data-source-pinned={sourcePinned ? "true" : "false"}
        data-right-panel-visible={rightPanelOpen ? "true" : "false"}
        data-figures-visible={showFigureStrip ? "true" : "false"}
      >
        {showFigureStrip ? (
          <div className={css.figureStrip} data-select="chrome">
            <FigureNavigator />
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
          <section className={css.canvasFrame}>
            <CanvasPanel repeatPreviewModel={repeatPreviewModel} />
          </section>
        </main>

        {sourceOverlay ? (
          <section className={css.sourceDrawer} aria-label="Source" data-testid="ipad-source-drawer">
            {sourceSurface}
          </section>
        ) : null}

        {rightPanelOpen ? (
          <aside className={css.floatingPanel} aria-label={activeRightPanelLabel} data-testid="ipad-floating-panel">
            <div className={css.floatingPanelHeader} data-select="chrome">
              <div className={css.segmentedControl} role="tablist" aria-label="Right panel">
                {RIGHT_PANEL_TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    className={[css.segment, activeRightTab === tab ? css.segmentActive : ""].filter(Boolean).join(" ")}
                    aria-selected={activeRightTab === tab}
                    disabled={!commandRuntime.bindings[RIGHT_PANEL_TAB_COMMANDS[tab]]?.enabled}
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
              : ""
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

const RIGHT_PANEL_TAB_COMMANDS: Record<RightSidebarTab, AppMenuCommandId> = {
  inspector: APP_MENU_COMMAND_IDS.TOGGLE_INSPECTOR_PANEL,
  objects: APP_MENU_COMMAND_IDS.TOGGLE_OBJECTS_PANEL,
  styles: APP_MENU_COMMAND_IDS.TOGGLE_STYLES_PANEL
};

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
