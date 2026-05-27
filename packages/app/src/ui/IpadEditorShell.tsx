import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiCloseLine,
  RiCodeLine,
  RiDraggable,
  RiDownloadCloudLine,
  RiFileAddLine,
  RiFolderOpenLine,
  RiFullscreenLine,
  RiLayoutRightLine,
  RiPaletteLine,
  RiSave3Line,
  RiSettings3Line,
  RiShareForwardLine,
  RiStackLine,
  RiZoomInLine,
  RiZoomOutLine
} from "@remixicon/react";
import { useShallow } from "zustand/react/shallow";
import type { SvgRenderModel } from "tikz-editor/svg";
import { NODE_SHAPE_OPTIONS, type NodeShapePresetId } from "tikz-editor/edit/inspector";
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
import { TabStrip } from "./TabStrip";
import { GENERATED_NODE_SHAPE_PREVIEWS } from "./generated-node-shape-previews";
import { ToolbarPopupSection, ToolbarPopupVisualChoiceGrid } from "./ToolbarToolPopup";
import { resolveToolbarToolMode, TOOL_BUTTONS } from "./tool-config";
import css from "./IpadEditorShell.module.css";

type RightSidebarTab = "inspector" | "objects" | "styles";
type AddShapePresetId = Exclude<NodeShapePresetId, "custom">;
type ToolPopupMode = "addShape" | "addMatrix";
type ToolPopupPlacement = "left" | "right" | "above" | "below";
type ToolPaletteLayout = "vertical" | "horizontal";
type ToolPaletteEdge = "top" | "bottom" | null;
type ToolPalettePosition = { x: number; y: number };
type ToolPaletteDragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  parentWidth: number;
  parentHeight: number;
  paletteWidth: number;
  paletteHeight: number;
  lastPosition: ToolPalettePosition;
};

type IconComponent = typeof RiFileAddLine;

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
const IPAD_TOOL_BUTTONS = TOOL_BUTTONS.filter((tool) => tool.mode !== "magnify");
const DEFAULT_TOOL_PALETTE_POSITION: ToolPalettePosition = { x: 12, y: 96 };
const TOOL_PALETTE_POSITION_STORAGE_KEY = "tikz-editor-ipad-tool-palette-position";
const TOOL_PALETTE_MARGIN = 12;
const TOOL_PALETTE_EDGE_SWITCH_DISTANCE = 84;
const TOOL_PALETTE_BUTTON_SIZE = 44;
const TOOL_PALETTE_GAP = 4;
const TOOL_PALETTE_PADDING = 5;
const TOOL_PALETTE_VERTICAL_COLUMNS = 2;
const TOOL_PALETTE_VERTICAL_HANDLE_HEIGHT = 24;
const TOOL_PALETTE_HORIZONTAL_HANDLE_WIDTH = 32;
const MATRIX_PICKER_MAX_COLUMNS = 10;
const MATRIX_PICKER_MAX_ROWS = 8;
const SHAPE_POPUP_CHOICES = NODE_SHAPE_OPTIONS.map((option) => ({
  id: option.value,
  label: option.label,
  previewSvg: GENERATED_NODE_SHAPE_PREVIEWS[option.value] ?? null
}));

function coerceRightSidebarTab(tab: RightSidebarTab | "assistant"): RightSidebarTab {
  return tab === "assistant" ? "inspector" : tab;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampToolPalettePosition(
  position: ToolPalettePosition,
  bounds: Pick<ToolPaletteDragState, "parentWidth" | "parentHeight" | "paletteWidth" | "paletteHeight">
): ToolPalettePosition {
  const maxX = Math.max(TOOL_PALETTE_MARGIN, bounds.parentWidth - bounds.paletteWidth - TOOL_PALETTE_MARGIN);
  const maxY = Math.max(TOOL_PALETTE_MARGIN, bounds.parentHeight - bounds.paletteHeight - TOOL_PALETTE_MARGIN);
  return {
    x: clampNumber(position.x, TOOL_PALETTE_MARGIN, maxX),
    y: clampNumber(position.y, TOOL_PALETTE_MARGIN, maxY)
  };
}

function getToolPaletteDimensions(layout: ToolPaletteLayout): Pick<ToolPaletteDragState, "paletteWidth" | "paletteHeight"> {
  if (layout === "horizontal") {
    const itemCount = IPAD_TOOL_BUTTONS.length + 1;
    return {
      paletteWidth:
        (TOOL_PALETTE_PADDING * 2) +
        TOOL_PALETTE_HORIZONTAL_HANDLE_WIDTH +
        (IPAD_TOOL_BUTTONS.length * TOOL_PALETTE_BUTTON_SIZE) +
        ((itemCount - 1) * TOOL_PALETTE_GAP),
      paletteHeight: (TOOL_PALETTE_PADDING * 2) + TOOL_PALETTE_BUTTON_SIZE
    };
  }

  const toolRows = Math.ceil(IPAD_TOOL_BUTTONS.length / TOOL_PALETTE_VERTICAL_COLUMNS);
  return {
    paletteWidth:
      (TOOL_PALETTE_PADDING * 2) +
      (TOOL_PALETTE_VERTICAL_COLUMNS * TOOL_PALETTE_BUTTON_SIZE) +
      ((TOOL_PALETTE_VERTICAL_COLUMNS - 1) * TOOL_PALETTE_GAP),
    paletteHeight:
      (TOOL_PALETTE_PADDING * 2) +
      TOOL_PALETTE_VERTICAL_HANDLE_HEIGHT +
      (toolRows * TOOL_PALETTE_BUTTON_SIZE) +
      (toolRows * TOOL_PALETTE_GAP)
  };
}

function resolveToolPaletteEdgeForPointer(clientY: number, parentTop: number, parentHeight: number): ToolPaletteEdge {
  const pointerY = clientY - parentTop;
  if (pointerY <= TOOL_PALETTE_EDGE_SWITCH_DISTANCE) {
    return "top";
  }
  if (pointerY >= parentHeight - TOOL_PALETTE_EDGE_SWITCH_DISTANCE) {
    return "bottom";
  }
  return null;
}

function resolveToolPaletteEdgeForPosition(
  position: ToolPalettePosition,
  layout: ToolPaletteLayout,
  parentHeight: number
): ToolPaletteEdge {
  if (position.y <= TOOL_PALETTE_EDGE_SWITCH_DISTANCE) {
    return "top";
  }

  const dimensions = getToolPaletteDimensions(layout);
  if (position.y + dimensions.paletteHeight >= parentHeight - TOOL_PALETTE_EDGE_SWITCH_DISTANCE) {
    return "bottom";
  }

  return null;
}

function pinToolPaletteToEdge(
  position: ToolPalettePosition,
  edge: ToolPaletteEdge,
  parentHeight: number,
  paletteHeight: number
): ToolPalettePosition {
  if (edge === "top") {
    return { ...position, y: TOOL_PALETTE_MARGIN };
  }
  if (edge === "bottom") {
    return {
      ...position,
      y: Math.max(TOOL_PALETTE_MARGIN, parentHeight - paletteHeight - TOOL_PALETTE_MARGIN)
    };
  }
  return position;
}

function readStoredToolPalettePosition(): ToolPalettePosition {
  if (typeof localStorage === "undefined") {
    return DEFAULT_TOOL_PALETTE_POSITION;
  }
  try {
    const stored = localStorage.getItem(TOOL_PALETTE_POSITION_STORAGE_KEY);
    if (!stored) {
      return DEFAULT_TOOL_PALETTE_POSITION;
    }
    const parsed = JSON.parse(stored) as Partial<ToolPalettePosition>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") {
      return DEFAULT_TOOL_PALETTE_POSITION;
    }
    return { x: parsed.x, y: parsed.y };
  } catch {
    return DEFAULT_TOOL_PALETTE_POSITION;
  }
}

function storeToolPalettePosition(position: ToolPalettePosition): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(TOOL_PALETTE_POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Local storage can be unavailable in restricted web views; movement still works for the session.
  }
}

export function IpadEditorShell({
  commandRuntime,
  repeatPreviewModel,
  onRequestCloseDocument,
  updateChip = null
}: IpadEditorShellProps) {
  const didNormalizeInitialLayout = useRef(false);
  const {
    activeDocument,
    activeDocumentId,
    tabOrder,
    toolMode,
    selectedElementIds,
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
    activeDocument: s.documents[s.activeDocumentId] ?? null,
    activeDocumentId: s.activeDocumentId,
    tabOrder: s.tabOrder,
    toolMode: s.toolMode,
    selectedElementIds: s.selectedElementIds,
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

  const runCommand = useCallback((commandId: AppMenuCommandId) => {
    commandRuntime.runCommand(commandId, "platform");
  }, [commandRuntime]);

  const activeRightTab = coerceRightSidebarTab(rightSidebarTab);
  const rightPanelOpen = showInspectorPanel || showObjectsPanel || showStylesPanel;
  const activeRightPanelLabel = RIGHT_PANEL_LABELS[activeRightTab];
  const figureCount = snapshot.figures.length;
  const hasMultipleFigures = figureCount > 1;
  const showFigureStrip = hasMultipleFigures && showFiguresPanel;
  const zoomPercent = canvasFitToContentScale ? `${Math.round(canvasFitToContentScale * 100)}%` : "Fit";
  const statusText = pendingRequestId
    ? "Rendering"
    : canvasStatusHint ?? `${selectedElementIds.size} selected`;

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

  const toggleFigures = useCallback(() => {
    syncLayout({ figuresVisible: hasMultipleFigures ? !showFiguresPanel : false });
  }, [hasMultipleFigures, showFiguresPanel, syncLayout]);

  const setToolMode = useCallback((nextMode: ToolMode) => {
    dispatch({ type: "SET_TOOL_MODE", mode: resolveToolbarToolMode(toolMode, nextMode) });
  }, [dispatch, toolMode]);

  return (
    <div className={css.shell} data-testid="ipad-editor-shell">
      <header className={css.topBar} data-select="chrome">
        <div className={css.commandCluster}>
          <CommandButton
            commandRuntime={commandRuntime}
            commandId={APP_MENU_COMMAND_IDS.NEW_DOCUMENT}
            label="New"
            icon={RiFileAddLine}
            onRun={runCommand}
          />
          <CommandButton
            commandRuntime={commandRuntime}
            commandId={APP_MENU_COMMAND_IDS.OPEN_DOCUMENT}
            label="Open"
            icon={RiFolderOpenLine}
            onRun={runCommand}
          />
          <CommandButton
            commandRuntime={commandRuntime}
            commandId={APP_MENU_COMMAND_IDS.SAVE_DOCUMENT}
            label="Save"
            icon={RiSave3Line}
            onRun={runCommand}
          />
          <ToggleButton
            label="Source"
            icon={RiCodeLine}
            active={showSourcePanel}
            disabled={!commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_SOURCE_PANEL]?.enabled}
            onClick={toggleSourcePanel}
          />
          {hasMultipleFigures ? (
            <ToggleButton
              label="Figures"
              icon={RiFullscreenLine}
              active={showFiguresPanel}
              onClick={toggleFigures}
            />
          ) : null}
        </div>

        <div className={css.documentCluster}>
          <div className={css.documentTitle}>
            <span className={css.documentName}>{activeDocument?.title ?? "Untitled"}</span>
            {activeDocument?.dirty ? <span className={css.dirtyDot} aria-label="Unsaved changes" /> : null}
          </div>
        </div>

        <div className={css.commandCluster}>
          <CommandButton
            commandRuntime={commandRuntime}
            commandId={APP_MENU_COMMAND_IDS.UNDO}
            label="Undo"
            icon={RiArrowGoBackLine}
            onRun={runCommand}
          />
          <CommandButton
            commandRuntime={commandRuntime}
            commandId={APP_MENU_COMMAND_IDS.REDO}
            label="Redo"
            icon={RiArrowGoForwardLine}
            onRun={runCommand}
          />
          <CommandButton
            commandRuntime={commandRuntime}
            commandId={APP_MENU_COMMAND_IDS.ZOOM_OUT}
            label="Zoom out"
            icon={RiZoomOutLine}
            onRun={runCommand}
          />
          <CommandButton
            commandRuntime={commandRuntime}
            commandId={APP_MENU_COMMAND_IDS.ZOOM_IN}
            label="Zoom in"
            icon={RiZoomInLine}
            onRun={runCommand}
          />
          <CommandButton
            commandRuntime={commandRuntime}
            commandId={APP_MENU_COMMAND_IDS.FIT_TO_CONTENT}
            label={zoomPercent}
            icon={RiFullscreenLine}
            onRun={runCommand}
            showLabel
          />
        </div>

        <div className={css.commandCluster}>
          <ToggleButton
            label="Inspector"
            icon={RiLayoutRightLine}
            active={rightPanelOpen}
            disabled={
              !commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_INSPECTOR_PANEL]?.enabled &&
              !commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_OBJECTS_PANEL]?.enabled &&
              !commandRuntime.bindings[APP_MENU_COMMAND_IDS.TOGGLE_STYLES_PANEL]?.enabled
            }
            onClick={toggleRightPanel}
          />
          <CommandButton
            commandRuntime={commandRuntime}
            commandId={APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD}
            label="Export"
            icon={RiDownloadCloudLine}
            onRun={runCommand}
          />
          <CommandButton
            commandRuntime={commandRuntime}
            commandId={APP_MENU_COMMAND_IDS.EXPORT_SVG_COPY}
            label="Share"
            icon={RiShareForwardLine}
            onRun={runCommand}
          />
          <CommandButton
            commandRuntime={commandRuntime}
            commandId={APP_MENU_COMMAND_IDS.OPEN_SETTINGS}
            label="Settings"
            icon={RiSettings3Line}
            onRun={runCommand}
          />
          {updateChip ? (
            <button type="button" className={css.updateButton} onClick={updateChip.onClick}>
              {updateChip.version}
            </button>
          ) : null}
        </div>
      </header>

      <div className={css.tabsRow} data-select="chrome">
        <TabStrip onRequestCloseDocument={onRequestCloseDocument} />
      </div>

      <div
        className={css.workspace}
        data-source-visible={showSourcePanel ? "true" : "false"}
        data-right-panel-visible={rightPanelOpen ? "true" : "false"}
      >
        <main className={css.stage}>
          {showFigureStrip ? (
            <div className={css.figureStrip}>
              <FigureNavigator />
            </div>
          ) : null}
          <div
            className={[
              css.editorSurface,
              showSourcePanel ? css.editorSurfaceWithSource : "",
              rightPanelOpen ? css.editorSurfaceWithRight : ""
            ].filter(Boolean).join(" ")}
          >
            {showSourcePanel ? (
              <PanelFrame kind="source">
                <SourcePanel />
              </PanelFrame>
            ) : null}
            <PanelFrame kind="canvas">
              <>
                <CanvasPanel repeatPreviewModel={repeatPreviewModel} />
                <FloatingToolPalette
                  toolMode={toolMode}
                  onSelectTool={setToolMode}
                />
              </>
            </PanelFrame>
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

        <div className={css.statusPill} data-select="chrome">
          <span>{statusText}</span>
          <span>{tabOrder.length} tab{tabOrder.length === 1 ? "" : "s"}</span>
          <span>{activeDocumentId.slice(0, 6)}</span>
        </div>
      </div>
    </div>
  );
}

function CommandButton({
  commandRuntime,
  commandId,
  label,
  icon: Icon,
  showLabel = false,
  onRun
}: {
  commandRuntime: EditorCommandRuntime;
  commandId: AppMenuCommandId;
  label: string;
  icon: IconComponent;
  showLabel?: boolean;
  onRun: (commandId: AppMenuCommandId) => void;
}) {
  const binding = commandRuntime.bindings[commandId];
  const disabled = !binding?.enabled;
  const checked = binding?.checked === true;
  return (
    <button
      type="button"
      className={[css.iconButton, checked ? css.iconButtonChecked : "", showLabel ? css.iconButtonLabeled : ""]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={checked || undefined}
      onClick={() => { onRun(commandId); }}
    >
      <Icon size={22} aria-hidden />
      {showLabel ? <span>{label}</span> : null}
    </button>
  );
}

function ToggleButton({
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
      className={[css.toggleButton, active ? css.toggleButtonActive : ""].filter(Boolean).join(" ")}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon size={18} aria-hidden />
      <span>{label}</span>
    </button>
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

function FloatingToolPalette({
  toolMode,
  onSelectTool
}: {
  toolMode: ToolMode;
  onSelectTool: (mode: ToolMode) => void;
}) {
  const paletteRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<ToolPaletteDragState | null>(null);
  const [palettePosition, setPalettePosition] = useState<ToolPalettePosition>(readStoredToolPalettePosition);
  const [paletteLayout, setPaletteLayout] = useState<ToolPaletteLayout>("vertical");
  const [isDragging, setIsDragging] = useState(false);
  const [openToolPopup, setOpenToolPopup] = useState<ToolPopupMode | null>(null);
  const [popupPlacement, setPopupPlacement] = useState<ToolPopupPlacement>("right");
  const [matrixHoverSize, setMatrixHoverSize] = useState<{ rows: number; columns: number } | null>(null);
  const {
    selectedAddShape,
    selectedAddMatrixRows,
    selectedAddMatrixColumns,
    dispatch
  } = useEditorStore(useShallow((s) => ({
    selectedAddShape: s.selectedAddShape,
    selectedAddMatrixRows: s.selectedAddMatrixRows,
    selectedAddMatrixColumns: s.selectedAddMatrixColumns,
    dispatch: s.dispatch
  })));
  const matrixPreviewRows = matrixHoverSize?.rows ?? selectedAddMatrixRows;
  const matrixPreviewColumns = matrixHoverSize?.columns ?? selectedAddMatrixColumns;

  const normalizePalettePlacement = useCallback((
    position: ToolPalettePosition,
    layout: ToolPaletteLayout
  ): { position: ToolPalettePosition; layout: ToolPaletteLayout } => {
    const palette = paletteRef.current;
    const parent = palette?.parentElement;
    if (!palette || !parent) {
      return { position, layout };
    }
    const parentRect = parent.getBoundingClientRect();
    const edge = resolveToolPaletteEdgeForPosition(position, layout, parentRect.height);
    const nextLayout: ToolPaletteLayout = edge ? "horizontal" : "vertical";
    const dimensions = getToolPaletteDimensions(nextLayout);
    const pinnedPosition = pinToolPaletteToEdge(position, edge, parentRect.height, dimensions.paletteHeight);
    return {
      layout: nextLayout,
      position: clampToolPalettePosition(pinnedPosition, {
        parentWidth: parentRect.width,
        parentHeight: parentRect.height,
        ...dimensions
      })
    };
  }, []);

  useEffect(() => {
    if (isDragging) {
      return;
    }
    const normalized = normalizePalettePlacement(palettePosition, paletteLayout);
    if (normalized.layout !== paletteLayout) {
      setPaletteLayout(normalized.layout);
    }
    if (normalized.position.x !== palettePosition.x || normalized.position.y !== palettePosition.y) {
      setPalettePosition(normalized.position);
      storeToolPalettePosition(normalized.position);
    }
  }, [isDragging, normalizePalettePlacement, paletteLayout, palettePosition]);

  useEffect(() => {
    function onResize(): void {
      setPalettePosition((current) => {
        const normalized = normalizePalettePlacement(current, paletteLayout);
        setPaletteLayout(normalized.layout);
        storeToolPalettePosition(normalized.position);
        return normalized.position;
      });
    }

    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); };
  }, [normalizePalettePlacement, paletteLayout]);

  useEffect(() => {
    if (!openToolPopup) {
      return;
    }

    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Node | null;
      if (!target || paletteRef.current?.contains(target)) {
        return;
      }
      setOpenToolPopup(null);
      setMatrixHoverSize(null);
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => { window.removeEventListener("pointerdown", onPointerDown); };
  }, [openToolPopup]);

  const resolvePopupPlacement = useCallback((): ToolPopupPlacement => {
    const palette = paletteRef.current;
    const parent = palette?.parentElement;
    if (!palette || !parent) {
      return "right";
    }
    const parentRect = parent.getBoundingClientRect();
    const paletteRect = palette.getBoundingClientRect();
    if (paletteLayout === "horizontal") {
      return paletteRect.top - parentRect.top > parentRect.height / 2 ? "above" : "below";
    }
    return paletteRect.left - parentRect.left > parentRect.width / 2 ? "left" : "right";
  }, [paletteLayout]);

  const toggleToolPopup = useCallback((mode: ToolPopupMode) => {
    setPopupPlacement(resolvePopupPlacement());
    setMatrixHoverSize(null);
    setOpenToolPopup((current) => (current === mode ? null : mode));
  }, [resolvePopupPlacement]);

  const beginPaletteDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const palette = paletteRef.current;
    const parent = palette?.parentElement;
    if (!palette || !parent) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const parentRect = parent.getBoundingClientRect();
    const paletteRect = palette.getBoundingClientRect();
    const origin = {
      x: paletteRect.left - parentRect.left,
      y: paletteRect.top - parentRect.top
    };
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      parentWidth: parentRect.width,
      parentHeight: parentRect.height,
      ...getToolPaletteDimensions(paletteLayout),
      lastPosition: origin
    };
    setOpenToolPopup(null);
    setMatrixHoverSize(null);
    setIsDragging(true);
  }, [paletteLayout]);

  const updatePaletteDrag = useCallback((pointerId: number, clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== pointerId) {
      return;
    }
    const parent = paletteRef.current?.parentElement;
    const parentRect = parent?.getBoundingClientRect();
    const edge = parentRect
      ? resolveToolPaletteEdgeForPointer(clientY, parentRect.top, parentRect.height)
      : null;
    const nextLayout: ToolPaletteLayout = edge ? "horizontal" : "vertical";
    const dimensions = getToolPaletteDimensions(nextLayout);
    const rawPosition = {
      x: drag.originX + clientX - drag.startClientX,
      y: drag.originY + clientY - drag.startClientY
    };
    const next = clampToolPalettePosition(
      pinToolPaletteToEdge(rawPosition, edge, drag.parentHeight, dimensions.paletteHeight),
      {
        parentWidth: drag.parentWidth,
        parentHeight: drag.parentHeight,
        ...dimensions
      }
    );
    drag.lastPosition = next;
    setPaletteLayout(nextLayout);
    setPalettePosition(next);
  }, []);

  const finishPaletteDrag = useCallback((pointerId: number) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== pointerId) {
      return;
    }
    dragRef.current = null;
    setIsDragging(false);
    storeToolPalettePosition(drag.lastPosition);
  }, []);

  const movePalette = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    updatePaletteDrag(event.pointerId, event.clientX, event.clientY);
  }, [updatePaletteDrag]);

  const endPaletteDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishPaletteDrag(event.pointerId);
  }, [finishPaletteDrag]);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    function onPointerMove(event: PointerEvent): void {
      event.preventDefault();
      updatePaletteDrag(event.pointerId, event.clientX, event.clientY);
    }

    function onPointerEnd(event: PointerEvent): void {
      finishPaletteDrag(event.pointerId);
    }

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [finishPaletteDrag, isDragging, updatePaletteDrag]);

  const selectShape = useCallback((id: string) => {
    dispatch({ type: "SET_ADD_SHAPE_PRESET", value: id as AddShapePresetId });
    dispatch({ type: "SET_TOOL_MODE", mode: "addShape" });
    setOpenToolPopup(null);
  }, [dispatch]);

  const selectMatrix = useCallback((rows: number, columns: number) => {
    dispatch({ type: "SET_ADD_MATRIX_PRESET", rows, columns });
    dispatch({ type: "SET_TOOL_MODE", mode: "addMatrix" });
    setMatrixHoverSize(null);
    setOpenToolPopup(null);
  }, [dispatch]);

  const renderToolPopup = () => {
    if (openToolPopup === "addShape") {
      return (
        <div
          className={[
            css.toolPopup,
            popupPlacement === "left" ? css.toolPopupLeft : "",
            popupPlacement === "above" ? css.toolPopupAbove : "",
            popupPlacement === "below" ? css.toolPopupBelow : ""
          ].filter(Boolean).join(" ")}
          role="dialog"
          aria-label="Shape choices"
          data-testid="ipad-tool-popup-addShape"
        >
          <ToolbarPopupSection title="Shape">
            <ToolbarPopupVisualChoiceGrid
              choices={SHAPE_POPUP_CHOICES}
              selectedId={selectedAddShape}
              onSelect={selectShape}
              testIdPrefix="ipad-toolbar-shape-choice"
            />
          </ToolbarPopupSection>
        </div>
      );
    }
    if (openToolPopup === "addMatrix") {
      const isSelected = (row: number, column: number): boolean =>
        row <= matrixPreviewRows && column <= matrixPreviewColumns;
      return (
        <div
          className={[
            css.toolPopup,
            css.matrixToolPopup,
            popupPlacement === "left" ? css.toolPopupLeft : "",
            popupPlacement === "above" ? css.toolPopupAbove : "",
            popupPlacement === "below" ? css.toolPopupBelow : ""
          ]
            .filter(Boolean)
            .join(" ")}
          role="dialog"
          aria-label="Matrix choices"
          data-testid="ipad-tool-popup-addMatrix"
        >
          <ToolbarPopupSection title={`Matrix (${matrixPreviewColumns} x ${matrixPreviewRows})`}>
            <div
              className={css.matrixPicker}
              role="grid"
              aria-label="Matrix size"
              data-testid="ipad-matrix-picker-grid"
              onPointerLeave={() => { setMatrixHoverSize(null); }}
            >
              {Array.from({ length: MATRIX_PICKER_MAX_ROWS }, (_, rowIndex) => rowIndex + 1).map((row) => (
                <div key={row} className={css.matrixPickerRow} role="row">
                  {Array.from({ length: MATRIX_PICKER_MAX_COLUMNS }, (_, columnIndex) => columnIndex + 1).map((column) => (
                    <button
                      key={`${row}-${column}`}
                      type="button"
                      className={[
                        css.matrixPickerCell,
                        isSelected(row, column) ? css.matrixPickerCellSelected : ""
                      ].filter(Boolean).join(" ")}
                      role="gridcell"
                      aria-label={`${row} rows by ${column} columns`}
                      aria-selected={isSelected(row, column)}
                      data-testid={`ipad-matrix-picker-cell-${row}-${column}`}
                      onPointerEnter={() => { setMatrixHoverSize({ rows: row, columns: column }); }}
                      onFocus={() => { setMatrixHoverSize({ rows: row, columns: column }); }}
                      onClick={() => { selectMatrix(row, column); }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </ToolbarPopupSection>
        </div>
      );
    }
    return null;
  };

  return (
    <nav
      ref={paletteRef}
      className={css.toolPalette}
      style={{ left: palettePosition.x, top: palettePosition.y }}
      aria-label="Drawing tools"
      data-dragging={isDragging ? "true" : "false"}
      data-layout={paletteLayout}
      data-select="chrome"
      data-testid="ipad-tool-palette"
    >
      <button
        type="button"
        className={css.toolPaletteHandle}
        aria-label="Move tools"
        title="Move tools"
        style={{ touchAction: "none" }}
        onPointerDown={beginPaletteDrag}
        onPointerMove={movePalette}
        onPointerUp={endPaletteDrag}
        onPointerCancel={endPaletteDrag}
        data-testid="ipad-tool-palette-drag-handle"
      >
        <RiDraggable size={18} aria-hidden />
      </button>
      {IPAD_TOOL_BUTTONS.map((tool) => {
        const Icon = tool.icon;
        const active = toolMode === tool.mode;
        const popupMode = tool.mode === "addShape" || tool.mode === "addMatrix" ? tool.mode : null;
        const popupOpen = popupMode != null && openToolPopup === popupMode;
        return (
          <button
            key={tool.mode}
            type="button"
            className={[
              css.toolButton,
              active || popupOpen ? css.toolButtonActive : "",
              popupMode ? css.toolButtonWithPopup : "",
              tool.separatorBefore ? css.toolButtonSeparated : ""
            ].filter(Boolean).join(" ")}
            aria-label={tool.label}
            title={tool.title}
            aria-pressed={active || popupOpen}
            aria-haspopup={popupMode ? "dialog" : undefined}
            aria-expanded={popupMode ? popupOpen : undefined}
            onClick={() => {
              if (popupMode) {
                toggleToolPopup(popupMode);
                return;
              }
              setOpenToolPopup(null);
              setMatrixHoverSize(null);
              onSelectTool(tool.mode);
            }}
          >
            <Icon size={24} />
          </button>
        );
      })}
      {renderToolPopup()}
    </nav>
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
