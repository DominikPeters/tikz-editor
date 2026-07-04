import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { RiArrowRightSLine } from "@remixicon/react";
import { useShallow } from "zustand/react/shallow";
import { NODE_SHAPE_OPTIONS, type NodeShapePresetId } from "tikz-editor/edit/inspector";
import { useProjectNamedColorSwatches } from "../../project-named-colors";
import { useEditorStore } from "../../store/store";
import type { ToolMode } from "../../store/types";
import { ColorPicker } from "../ColorPicker";
import { GENERATED_NODE_SHAPE_PREVIEWS } from "../generated-node-shape-previews";
import { ToolbarPopupSection, ToolbarPopupVisualChoiceGrid } from "../ToolbarToolPopup";
import { TOOL_BUTTONS, TOOL_COLOR_OPTIONS, type ToolButtonDef } from "../tool-config";
import css from "./IpadToolPalette.module.css";

export type PaletteEdge = "top" | "bottom" | "left" | "right";
export type PaletteCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type PaletteDock =
  | { kind: "edge"; edge: PaletteEdge }
  | { kind: "corner"; corner: PaletteCorner };

type PalettePopup = "shape" | "more" | null;
type MoreExpandSection = "matrix" | "bucket" | null;
type AddShapePresetId = Exclude<NodeShapePresetId, "custom">;

const HIDDEN_TOOL_MODES: ReadonlySet<ToolMode> = new Set(["magnify", "addMatrix", "addBezier", "addGrid", "addBucket"]);
const VISIBLE_TOOLS: readonly ToolButtonDef[] = TOOL_BUTTONS.filter((tool) => !HIDDEN_TOOL_MODES.has(tool.mode));
const OVERFLOW_TOOLS: readonly ToolButtonDef[] = TOOL_BUTTONS.filter(
  (tool) => tool.mode !== "magnify" && HIDDEN_TOOL_MODES.has(tool.mode)
);

const BUTTON_SIZE = 44;
const BUTTON_GAP = 2;
const PALETTE_PADDING = 6;
const GRIP_SIZE = 22;
const EDGE_MARGIN = 12;
const PUCK_SIZE = 56;
const CORNER_CAPTURE_DISTANCE = 150;
const TAP_SLOP = 8;
const MOMENTUM_SECONDS = 0.42;
const MOMENTUM_MAX_DISTANCE = 900;
const DOCK_STORAGE_KEY = "tikz-editor-ipad-tool-palette-dock";
const SAFE_AREA_BOTTOM_CSS_VALUE = "var(--ipad-safe-area-bottom, env(safe-area-inset-bottom, 0px))";

const EXPANDED_MAIN =
  (PALETTE_PADDING * 2) +
  GRIP_SIZE +
  ((VISIBLE_TOOLS.length + 1) * BUTTON_SIZE) +
  ((VISIBLE_TOOLS.length + 1) * BUTTON_GAP);
const EXPANDED_CROSS = BUTTON_SIZE + (PALETTE_PADDING * 2);

const SHAPE_POPUP_CHOICES = NODE_SHAPE_OPTIONS.map((option) => ({
  id: option.value,
  label: option.label,
  previewSvg: GENERATED_NODE_SHAPE_PREVIEWS[option.value] ?? null
}));

const MATRIX_PICKER_MAX_COLUMNS = 10;
const MATRIX_PICKER_MAX_ROWS = 8;

type Rect = { x: number; y: number; width: number; height: number };
type DragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  samples: Array<{ t: number; x: number; y: number }>;
};

function readStoredDock(): PaletteDock {
  const fallback: PaletteDock = { kind: "edge", edge: "bottom" };
  if (typeof localStorage === "undefined") {
    return fallback;
  }
  try {
    const stored = localStorage.getItem(DOCK_STORAGE_KEY);
    if (!stored) {
      return fallback;
    }
    const parsed = JSON.parse(stored) as PaletteDock;
    if (parsed.kind === "edge" && ["top", "bottom", "left", "right"].includes(parsed.edge)) {
      return parsed;
    }
    if (parsed.kind === "corner" && ["top-left", "top-right", "bottom-left", "bottom-right"].includes(parsed.corner)) {
      return parsed;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function storeDock(dock: PaletteDock): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(dock));
  } catch {
    // Persistence is nice-to-have; docking still works for the session.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function parseCssPixelValue(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function readSafeAreaBottom(): number {
  if (typeof document === "undefined") {
    return 0;
  }
  const direct = parseCssPixelValue(getComputedStyle(document.documentElement).getPropertyValue("--ipad-safe-area-bottom"));
  if (direct != null) {
    return direct;
  }
  if (!document.body) {
    return 0;
  }
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingBottom = SAFE_AREA_BOTTOM_CSS_VALUE;
  document.body.append(probe);
  const resolved = parseCssPixelValue(getComputedStyle(probe).paddingBottom) ?? 0;
  probe.remove();
  return resolved;
}

function restRect(dock: PaletteDock, parentWidth: number, parentHeight: number, safeAreaBottom: number): Rect {
  const bottomEdgeMargin = EDGE_MARGIN + safeAreaBottom;
  if (dock.kind === "corner") {
    const x = dock.corner.endsWith("left") ? EDGE_MARGIN : parentWidth - PUCK_SIZE - EDGE_MARGIN;
    const y = dock.corner.startsWith("top") ? EDGE_MARGIN : parentHeight - PUCK_SIZE - bottomEdgeMargin;
    return { x, y, width: PUCK_SIZE, height: PUCK_SIZE };
  }
  const horizontal = dock.edge === "top" || dock.edge === "bottom";
  const width = horizontal ? EXPANDED_MAIN : EXPANDED_CROSS;
  const height = horizontal ? EXPANDED_CROSS : EXPANDED_MAIN;
  const x = dock.edge === "left"
    ? EDGE_MARGIN
    : dock.edge === "right"
      ? parentWidth - width - EDGE_MARGIN
      : clamp((parentWidth - width) / 2, EDGE_MARGIN, parentWidth - width - EDGE_MARGIN);
  const y = dock.edge === "top"
    ? EDGE_MARGIN
    : dock.edge === "bottom"
      ? parentHeight - height - bottomEdgeMargin
      : clamp((parentHeight - height) / 2, EDGE_MARGIN, parentHeight - height - bottomEdgeMargin);
  return { x, y, width, height };
}

function dockForProjectedPoint(
  x: number,
  y: number,
  parentWidth: number,
  parentHeight: number,
  safeAreaBottom: number
): PaletteDock {
  const bottomEdgeY = parentHeight - safeAreaBottom;
  const corners: Array<{ corner: PaletteCorner; cx: number; cy: number }> = [
    { corner: "top-left", cx: 0, cy: 0 },
    { corner: "top-right", cx: parentWidth, cy: 0 },
    { corner: "bottom-left", cx: 0, cy: bottomEdgeY },
    { corner: "bottom-right", cx: parentWidth, cy: bottomEdgeY }
  ];
  for (const candidate of corners) {
    const distance = Math.hypot(x - candidate.cx, y - candidate.cy);
    if (distance <= CORNER_CAPTURE_DISTANCE) {
      return { kind: "corner", corner: candidate.corner };
    }
  }
  const edgeDistances: Array<{ edge: PaletteEdge; distance: number }> = [
    { edge: "top", distance: y },
    { edge: "bottom", distance: bottomEdgeY - y },
    { edge: "left", distance: x },
    { edge: "right", distance: parentWidth - x }
  ];
  edgeDistances.sort((a, b) => a.distance - b.distance);
  return { kind: "edge", edge: edgeDistances[0].edge };
}

function expandedDockFromCorner(corner: PaletteCorner): PaletteDock {
  return { kind: "edge", edge: corner.startsWith("top") ? "top" : "bottom" };
}

export function IpadToolPalette({
  toolMode,
  onSelectTool,
  onDockChange
}: {
  toolMode: ToolMode;
  onSelectTool: (mode: ToolMode) => void;
  onDockChange?: (dock: PaletteDock) => void;
}) {
  const paletteRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dock, setDock] = useState<PaletteDock>(readStoredDock);
  const [parentSize, setParentSize] = useState<{ width: number; height: number } | null>(null);
  const [safeAreaBottom, setSafeAreaBottom] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [openPopup, setOpenPopup] = useState<PalettePopup>(null);
  const [moreExpand, setMoreExpand] = useState<MoreExpandSection>(null);
  const [matrixDragSize, setMatrixDragSize] = useState<{ rows: number; columns: number } | null>(null);
  const {
    selectedAddShape,
    selectedAddMatrixRows,
    selectedAddMatrixColumns,
    bucketFillColor,
    dispatch
  } = useEditorStore(useShallow((s) => ({
    selectedAddShape: s.selectedAddShape,
    selectedAddMatrixRows: s.selectedAddMatrixRows,
    selectedAddMatrixColumns: s.selectedAddMatrixColumns,
    bucketFillColor: s.bucketFillColor,
    dispatch: s.dispatch
  })));
  const projectNamedColorSwatches = useProjectNamedColorSwatches();

  const applyDock = useCallback((nextDock: PaletteDock) => {
    setDock(nextDock);
    storeDock(nextDock);
    onDockChange?.(nextDock);
  }, [onDockChange]);

  useEffect(() => {
    onDockChange?.(dock);
    // Announce the restored dock once on mount; applyDock covers later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const parent = paletteRef.current?.parentElement;
    if (!parent) {
      return;
    }
    const syncSize = () => {
      const rect = parent.getBoundingClientRect();
      setParentSize({ width: rect.width, height: rect.height });
      setSafeAreaBottom(readSafeAreaBottom());
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(parent);
    window.visualViewport?.addEventListener("resize", syncSize);
    window.addEventListener("orientationchange", syncSize);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", syncSize);
      window.removeEventListener("orientationchange", syncSize);
    };
  }, []);

  useEffect(() => {
    if (!openPopup) {
      setMoreExpand(null);
      return;
    }

    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Node | null;
      if (!target || paletteRef.current?.contains(target)) {
        return;
      }
      setOpenPopup(null);
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => { window.removeEventListener("pointerdown", onPointerDown); };
  }, [openPopup]);

  const isMini = dock.kind === "corner";
  const rest = parentSize ? restRect(dock, parentSize.width, parentSize.height, safeAreaBottom) : null;
  const frame: Rect | null = dragging && dragPosition
    ? { x: dragPosition.x, y: dragPosition.y, width: PUCK_SIZE, height: PUCK_SIZE }
    : rest;
  const layout = dock.kind === "edge" && (dock.edge === "left" || dock.edge === "right") ? "vertical" : "horizontal";
  const state = dragging ? "puck" : isMini ? "mini" : "expanded";
  const popupPlace = dock.kind === "edge"
    ? dock.edge === "bottom" ? "above" : dock.edge === "top" ? "below" : dock.edge === "left" ? "side-right" : "side-left"
    : "above";

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const palette = paletteRef.current;
    const parent = palette?.parentElement;
    if (!palette || !parent) {
      return;
    }
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a routing optimization; the window listeners below cover the drag.
    }
    const parentRect = parent.getBoundingClientRect();
    const pointerX = event.clientX - parentRect.left;
    const pointerY = event.clientY - parentRect.top;
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
      samples: [{ t: performance.now(), x: pointerX, y: pointerY }]
    };
    setOpenPopup(null);
    setSettling(false);
    setDragging(true);
    setDragPosition({ x: pointerX - PUCK_SIZE / 2, y: pointerY - PUCK_SIZE / 2 });
  }, []);

  const moveDragTo = useCallback((pointerId: number, clientX: number, clientY: number) => {
    const drag = dragRef.current;
    const parent = paletteRef.current?.parentElement;
    if (!parent || drag?.pointerId !== pointerId) {
      return;
    }
    const parentRect = parent.getBoundingClientRect();
    const pointerX = clientX - parentRect.left;
    const pointerY = clientY - parentRect.top;
    if (Math.hypot(clientX - drag.startClientX, clientY - drag.startClientY) > TAP_SLOP) {
      drag.moved = true;
    }
    const now = performance.now();
    drag.samples.push({ t: now, x: pointerX, y: pointerY });
    while (drag.samples.length > 2 && now - drag.samples[0].t > 120) {
      drag.samples.shift();
    }
    setDragPosition({ x: pointerX - PUCK_SIZE / 2, y: pointerY - PUCK_SIZE / 2 });
  }, []);

  const finishDrag = useCallback((pointerId: number) => {
    const drag = dragRef.current;
    const parent = paletteRef.current?.parentElement;
    if (drag?.pointerId !== pointerId) {
      return;
    }
    dragRef.current = null;
    setDragging(false);
    setDragPosition(null);
    if (!parent) {
      return;
    }

    if (!drag.moved) {
      setSettling(true);
      if (dock.kind === "corner") {
        applyDock(expandedDockFromCorner(dock.corner));
      }
      return;
    }

    const parentRect = parent.getBoundingClientRect();
    const last = drag.samples[drag.samples.length - 1];
    const first = drag.samples[0];
    const dt = Math.max(last.t - first.t, 1) / 1000;
    const velocityX = (last.x - first.x) / dt;
    const velocityY = (last.y - first.y) / dt;
    const momentumX = clamp(velocityX * MOMENTUM_SECONDS, -MOMENTUM_MAX_DISTANCE, MOMENTUM_MAX_DISTANCE);
    const momentumY = clamp(velocityY * MOMENTUM_SECONDS, -MOMENTUM_MAX_DISTANCE, MOMENTUM_MAX_DISTANCE);
    const projectedX = clamp(last.x + momentumX, 0, parentRect.width);
    const bottomEdgeY = Math.max(0, parentRect.height - safeAreaBottom);
    const projectedY = clamp(last.y + momentumY, 0, bottomEdgeY);
    setSettling(true);
    applyDock(dockForProjectedPoint(projectedX, projectedY, parentRect.width, parentRect.height, safeAreaBottom));
  }, [applyDock, dock, safeAreaBottom]);

  const moveDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    moveDragTo(event.pointerId, event.clientX, event.clientY);
  }, [moveDragTo]);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishDrag(event.pointerId);
  }, [finishDrag]);

  useEffect(() => {
    if (!dragging) {
      return;
    }

    function onPointerMove(event: PointerEvent): void {
      event.preventDefault();
      moveDragTo(event.pointerId, event.clientX, event.clientY);
    }

    function onPointerEnd(event: PointerEvent): void {
      finishDrag(event.pointerId);
    }

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [dragging, finishDrag, moveDragTo]);

  const selectTool = useCallback((mode: ToolMode) => {
    setOpenPopup(null);
    onSelectTool(mode);
  }, [onSelectTool]);

  const onToolTap = useCallback((tool: ToolButtonDef) => {
    if (tool.mode === "addShape") {
      if (toolMode === "addShape") {
        setOpenPopup((current) => (current === "shape" ? null : "shape"));
        return;
      }
      setOpenPopup(null);
      dispatch({ type: "SET_TOOL_MODE", mode: "addShape" });
      return;
    }
    selectTool(tool.mode);
  }, [dispatch, selectTool, toolMode]);

  const selectShapePreset = useCallback((id: string) => {
    dispatch({ type: "SET_ADD_SHAPE_PRESET", value: id as AddShapePresetId });
    dispatch({ type: "SET_TOOL_MODE", mode: "addShape" });
    setOpenPopup(null);
  }, [dispatch]);

  const commitMatrixSize = useCallback((rows: number, columns: number) => {
    dispatch({ type: "SET_ADD_MATRIX_PRESET", rows, columns });
    dispatch({ type: "SET_TOOL_MODE", mode: "addMatrix" });
    setMatrixDragSize(null);
    setOpenPopup(null);
  }, [dispatch]);

  const activeOverflowTool = OVERFLOW_TOOLS.find((tool) => tool.mode === toolMode) ?? null;
  const MoreFaceIcon = activeOverflowTool?.icon ?? null;
  const ActiveToolIcon = (TOOL_BUTTONS.find((tool) => tool.mode === toolMode) ?? TOOL_BUTTONS[0]).icon;

  const matrixPreviewRows = matrixDragSize?.rows ?? selectedAddMatrixRows;
  const matrixPreviewColumns = matrixDragSize?.columns ?? selectedAddMatrixColumns;

  const matrixCellFromPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>): { rows: number; columns: number } | null => {
    const grid = event.currentTarget;
    const rect = grid.getBoundingClientRect();
    const cellWidth = rect.width / MATRIX_PICKER_MAX_COLUMNS;
    const cellHeight = rect.height / MATRIX_PICKER_MAX_ROWS;
    const columns = clamp(Math.ceil((event.clientX - rect.left) / cellWidth), 1, MATRIX_PICKER_MAX_COLUMNS);
    const rows = clamp(Math.ceil((event.clientY - rect.top) / cellHeight), 1, MATRIX_PICKER_MAX_ROWS);
    return { rows, columns };
  }, []);

  const style: CSSProperties | undefined = frame
    ? {
        left: Math.round(frame.x),
        top: Math.round(frame.y),
        width: Math.round(frame.width),
        height: Math.round(frame.height),
        borderRadius: Math.round(Math.min(frame.width, frame.height) / 2)
      }
    : undefined;

  const gripHandlers = {
    onPointerDown: beginDrag,
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag
  };

  return (
    <nav
      ref={paletteRef}
      className={css.palette}
      style={style}
      aria-label="Drawing tools"
      data-state={state}
      data-layout={layout}
      data-dragging={dragging ? "true" : "false"}
      data-settling={settling && !dragging ? "true" : "false"}
      data-measured={frame ? "true" : "false"}
      data-select="chrome"
      data-testid="ipad-tool-palette"
      onTransitionEnd={() => { setSettling(false); }}
      {...(isMini && !dragging ? gripHandlers : {})}
    >
      <div className={css.tools}>
        <button
          type="button"
          className={css.grip}
          aria-label="Move tools"
          title="Move tools"
          data-testid="ipad-tool-palette-drag-handle"
          {...gripHandlers}
        >
          <span className={css.gripBar} aria-hidden />
        </button>
        {VISIBLE_TOOLS.map((tool) => {
          const Icon = tool.icon;
          const active = toolMode === tool.mode;
          const hasOptions = tool.mode === "addShape";
          const toolButton = (
            <button
              key={hasOptions ? undefined : tool.mode}
              type="button"
              className={[
                css.toolButton,
                active ? css.toolButtonActive : "",
                tool.separatorBefore ? css.toolButtonSeparated : ""
              ].filter(Boolean).join(" ")}
              aria-label={tool.label}
              title={tool.title}
              aria-pressed={active}
              aria-haspopup={hasOptions ? "dialog" : undefined}
              aria-expanded={hasOptions ? openPopup === "shape" : undefined}
              onClick={() => { onToolTap(tool); }}
              data-testid={`ipad-tool-${tool.mode}`}
            >
              <Icon size={24} />
              {hasOptions ? <span className={css.toolCaret} aria-hidden /> : null}
            </button>
          );
          if (!hasOptions) {
            return toolButton;
          }
          return (
            <div key={tool.mode} className={css.popupHost}>
              {toolButton}
              {openPopup === "shape" ? (
                <div
                  className={css.popup}
                  data-place={popupPlace}
                  data-anchor="center"
                  role="dialog"
                  aria-label="Shape choices"
                  data-testid="ipad-tool-popup-addShape"
                >
                  <ToolbarPopupSection title="Shape">
                    <ToolbarPopupVisualChoiceGrid
                      choices={SHAPE_POPUP_CHOICES}
                      selectedId={selectedAddShape}
                      onSelect={selectShapePreset}
                      testIdPrefix="ipad-toolbar-shape-choice"
                    />
                  </ToolbarPopupSection>
                </div>
              ) : null}
            </div>
          );
        })}
        <div className={css.popupHost}>
          <button
            type="button"
            className={[
              css.toolButton,
              css.toolButtonSeparated,
              activeOverflowTool ? css.toolButtonActive : "",
              openPopup === "more" ? css.toolButtonActive : ""
            ].filter(Boolean).join(" ")}
            aria-label="More tools"
            title="More tools"
            aria-haspopup="dialog"
            aria-expanded={openPopup === "more"}
            onClick={() => {
              setMatrixDragSize(null);
              setOpenPopup((current) => (current === "more" ? null : "more"));
            }}
            data-testid="ipad-tool-more"
          >
            {MoreFaceIcon ? <MoreFaceIcon size={24} /> : <MoreDotsIcon />}
            <span className={css.toolCaret} aria-hidden />
          </button>
          {openPopup === "more" ? (
            <div
              className={css.popup}
              data-place={popupPlace}
              data-anchor="end"
              role="dialog"
              aria-label="More tools"
              data-testid="ipad-tool-popup-more"
            >
          <div className={css.moreList}>
            {OVERFLOW_TOOLS.map((tool) => {
              const Icon = tool.icon;
              const active = toolMode === tool.mode;
              const expandable = tool.mode === "addMatrix" || tool.mode === "addBucket";
              const expanded =
                (tool.mode === "addMatrix" && moreExpand === "matrix") ||
                (tool.mode === "addBucket" && moreExpand === "bucket");
              return (
                <div key={tool.mode}>
                  <button
                    type="button"
                    className={[css.moreItem, active ? css.moreItemActive : ""].filter(Boolean).join(" ")}
                    aria-pressed={active}
                    onClick={() => {
                      if (tool.mode === "addMatrix") {
                        setMoreExpand((current) => (current === "matrix" ? null : "matrix"));
                        return;
                      }
                      if (tool.mode === "addBucket") {
                        setMoreExpand((current) => (current === "bucket" ? null : "bucket"));
                        return;
                      }
                      selectTool(tool.mode);
                    }}
                    data-testid={`ipad-tool-${tool.mode}`}
                  >
                    <span className={css.moreItemIcon}><Icon size={22} /></span>
                    <span className={css.moreItemLabel}>{tool.label}</span>
                    {expandable ? (
                      <RiArrowRightSLine
                        size={18}
                        className={[css.moreItemChevron, expanded ? css.moreItemChevronOpen : ""].filter(Boolean).join(" ")}
                        aria-hidden
                      />
                    ) : null}
                  </button>
                  {tool.mode === "addMatrix" && expanded ? (
                    <div className={css.moreExpand}>
                      <div
                        className={css.matrixPicker}
                        role="grid"
                        aria-label="Matrix size"
                        data-testid="ipad-matrix-picker-grid"
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId);
                          setMatrixDragSize(matrixCellFromPointer(event));
                        }}
                        onPointerMove={(event) => {
                          if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                            return;
                          }
                          setMatrixDragSize(matrixCellFromPointer(event));
                        }}
                        onPointerUp={(event) => {
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            event.currentTarget.releasePointerCapture(event.pointerId);
                          }
                          const size = matrixCellFromPointer(event);
                          if (size) {
                            commitMatrixSize(size.rows, size.columns);
                          }
                        }}
                        onPointerCancel={() => { setMatrixDragSize(null); }}
                      >
                        {Array.from({ length: MATRIX_PICKER_MAX_ROWS }, (_, rowIndex) => rowIndex + 1).map((row) => (
                          <div key={row} className={css.matrixPickerRow} role="row">
                            {Array.from({ length: MATRIX_PICKER_MAX_COLUMNS }, (_, columnIndex) => columnIndex + 1).map((column) => (
                              <span
                                key={`${row}-${column}`}
                                className={[
                                  css.matrixPickerCell,
                                  row <= matrixPreviewRows && column <= matrixPreviewColumns
                                    ? css.matrixPickerCellSelected
                                    : ""
                                ].filter(Boolean).join(" ")}
                                role="gridcell"
                                aria-label={`${row} rows by ${column} columns`}
                                aria-selected={row <= matrixPreviewRows && column <= matrixPreviewColumns}
                                data-testid={`ipad-matrix-picker-cell-${row}-${column}`}
                              />
                            ))}
                          </div>
                        ))}
                        <div className={css.matrixPickerCaption}>
                          {matrixPreviewColumns} × {matrixPreviewRows}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {tool.mode === "addBucket" && expanded ? (
                    <div className={css.moreExpand}>
                      <ColorPicker
                        ariaLabel="Bucket fill color"
                        value={bucketFillColor}
                        syntaxValue={bucketFillColor}
                        options={TOOL_COLOR_OPTIONS}
                        namedColorSwatches={projectNamedColorSwatches}
                        onChange={(nextValue) => {
                          dispatch({ type: "SET_BUCKET_FILL_COLOR", value: nextValue });
                          dispatch({ type: "SET_TOOL_MODE", mode: "addBucket" });
                          setOpenPopup(null);
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className={css.puckFace} aria-hidden>
        <ActiveToolIcon size={26} />
      </div>
    </nav>
  );
}

function MoreDotsIcon() {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}
