import {
  useEffect,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from "react";
import type { AppMenuCommandId } from "../../app-menu";
import type { CanvasContextMenuDefinition } from "../../context-menu";
import type { EditorPlatform } from "../../platform/types";
import type { CanvasTransform, ToolMode } from "../../store/types";
import type { ResizeRole } from "@tikz-editor/core/edit/actions";
import type { EditHandle } from "@tikz-editor/core/semantic/types";
import type { SvgDiffHints, SvgRenderModel } from "@tikz-editor/core/svg/index";
import type { SnapLine } from "@tikz-editor/core/edit/snapping";
import { CanvasSVGLayer } from "./CanvasSVGLayer";
import {
  CurveControlOverlay,
  HandleOverlay,
  HitRegionLayer,
  NodeAnchorOverlay,
  NodePositionLinkOverlay,
  SelectionDragLayer,
  SelectionOverlay,
  SnapOverlay,
  ToolPreviewOverlay,
  type ToolPreview
} from "./overlays";
import type {
  AdornmentConnectorDisplay,
  AdornmentHighlightBox,
  CanvasContextMenuState,
  CanvasSnapshot,
  DragTooltipState,
  HandleDisplay,
  MagnifierState,
  NodeAnchorOverlayState,
  NodePositionLinkDisplay,
  SelectionBoxDisplay,
  TextSelectionOverlay,
  TextSelectionOverlayBox
} from "./types";
import type { SvgBounds, WorldPoint } from "../coords/types";
import { fmt, worldToSvgY, type RulerTick, type VisibleRanges } from "./geometry";
import { CanvasContextMenu } from "../CanvasContextMenu";
import { RenderedTooltip } from "../RenderedTooltip";
import type { CommandBindings, CommandOrigin } from "../editor-command-runtime";
import type { GridLines } from "./useCanvasGuidesAndRulers";
import type { GuideOrientation } from "./types";
import type { HitRegion } from "./hit-regions";
import type { CurveControlLine } from "./curve-controls";
import { CanvasTextEditPopup, type CanvasTextEditViewModel } from "./CanvasTextEditPopup";
import css from "./CanvasPanel.module.css";

const MAGNIFIER_DIAMETER_PX = 300;
const MAGNIFIER_SCALE = 2.25;
const TEXT_CARET_BLINK_PERIOD_MS = 1000;
const TEXT_CARET_BLINK_VISIBLE_MS = TEXT_CARET_BLINK_PERIOD_MS / 2;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type CanvasPanelViewProps = {
  prefersNonBlinkingTextInsertionIndicator: boolean;
  showRulers: boolean;
  viewportSize: { width: number; height: number };
  topRulerRef: RefObject<SVGSVGElement | null>;
  leftRulerRef: RefObject<SVGSVGElement | null>;
  onTopRulerPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onLeftRulerPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onCanvasContextMenu: (event: ReactMouseEvent<SVGElement | HTMLDivElement>) => void;
  rulers: { topTicks: RulerTick[]; leftTicks: RulerTick[] };
  LEFT_RULER_DRAG_SOURCE_WIDTH_PX: number;
  toolMode: ToolMode;
  viewportRef: RefObject<HTMLDivElement | null>;
  onViewportKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onViewportCopy: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  onViewportCut: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  onViewportPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  onViewportDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onViewportDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  onBackgroundClick: (event: ReactMouseEvent<HTMLDivElement | SVGSVGElement>) => void;
  onViewportPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onViewportPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  svgResult: CanvasSnapshot["svg"];
  noActiveFigure: boolean;
  assistantLockReason: string | null;
  snapshot: CanvasSnapshot;
  svgModel: SvgRenderModel | null;
  svgLayerHostRef: RefObject<HTMLDivElement | null>;
  canvasTransform: CanvasTransform;
  showTransparencyGrid: boolean;
  showDocumentBounds: boolean;
  svgDiffHints: SvgDiffHints | undefined;
  forceSvgReplaceAll: boolean;
  onSvgPatchFallback: (reason: "replaceDefs" | "replaceAll" | "patch-failure") => void;
  repeatPreviewModel: SvgRenderModel | null;
  interactionSvgRef: RefObject<SVGSVGElement | null>;
  onInteractionPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onInteractionPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onInteractionLostPointerCapture: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onInteractionPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onInteractionPointerEnter: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onInteractionPointerLeave: (event: ReactPointerEvent<SVGSVGElement>) => void;
  gridLines: GridLines | null;
  gridMinorStrokeWidth: number;
  gridMajorStrokeWidth: number;
  gridAxisStrokeWidth: number;
  visibleRanges: VisibleRanges | null;
  showGuides: boolean;
  renderedGuides: { vertical: number[]; horizontal: number[] };
  guideStrokeWidth: number;
  guideHitStrokeWidth: number;
  onGuidePointerDown: (event: ReactPointerEvent<SVGLineElement>, orientation: GuideOrientation, value: number) => void;
  snapLines: readonly SnapLine[];
  snapSourceNames: ReadonlyMap<string, string>;
  snapStrokeWidth: number;
  snapCrossSize: number;
  toolPreview: ToolPreview | null;
  handleStrokeWidth: number;
  previewArrowPoints: (x1: number, y1: number, x2: number, y2: number, size: number) => string;
  hitRegions: readonly HitRegion[];
  hoveredElementId: string | null;
  editableTextRegionKeys: ReadonlySet<string>;
  draggableSourceIds: ReadonlySet<string>;
  hitRegionCursorByTargetId?: ReadonlyMap<string, string>;
  onElementPointerDown: (event: ReactPointerEvent<SVGElement>, targetId: string, region?: HitRegion) => void;
  onElementContextMenu: (event: ReactMouseEvent<SVGElement>, sourceId: string, region?: HitRegion, handleId?: string | null) => void;
  onElementDoubleClick: (event: ReactMouseEvent<SVGElement>, targetId: string, region?: HitRegion) => void;
  onHoverChange: (id: string | null) => void;
  nodePositionLinks: readonly NodePositionLinkDisplay[];
  marqueeBounds: SvgBounds | null;
  selectionBoxes: readonly SelectionBoxDisplay[];
  adornmentHighlightBoxes: readonly AdornmentHighlightBox[];
  selectedAdornmentConnectors: readonly AdornmentConnectorDisplay[];
  selectionStrokeWidth: number;
  textSelectionOverlay: TextSelectionOverlay | null;
  selectionDragStrokeWidth: number;
  matrixSelectionSourceIds: ReadonlySet<string>;
  curveControlLines: readonly CurveControlLine[];
  curveControlStrokeWidth: number;
  nodeAnchorOverlay: NodeAnchorOverlayState | null;
  onNodeAnchorPointerDown?: (event: ReactPointerEvent<SVGCircleElement>, targetId: string) => void;
  onNodeAnchorClick?: (event: ReactMouseEvent<SVGCircleElement>, targetId: string) => void;
  onNodeAnchorHoverChange?: (targetId: string | null) => void;
  nodePositionTargetTooltip: { content: string; anchor: { x: number; y: number } } | null;
  handleHalfSize: number;
  handleDisplays: readonly HandleDisplay[];
  onHandlePointerDown: (event: ReactPointerEvent<SVGElement>, handle: EditHandle) => void;
  onResizeHandlePointerDown: (event: ReactPointerEvent<SVGElement>, sourceId: string, role: ResizeRole, cursor: string) => void;
  onRotateHandlePointerDown: (
    event: ReactPointerEvent<SVGElement>,
    sourceId: string,
    centerWorld: WorldPoint,
    centerPivotWorld: WorldPoint,
    cursor: string
  ) => void;
  platform: EditorPlatform;
  contextMenuState: CanvasContextMenuState | null;
  commandRuntimeBindings: CommandBindings;
  contextMenuDefinition: CanvasContextMenuDefinition;
  onContextMenuClose: () => void;
  onContextMenuCommandRun: (commandId: AppMenuCommandId, origin: CommandOrigin) => void;
  dragTooltip: DragTooltipState | null;
  dragTooltipBoundary: { left: number; top: number; right: number; bottom: number } | null;
  warning: string | null;
  copyWarningToClipboard: () => void;
  onWarningBarKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  canvasTextEdit: CanvasTextEditViewModel;
  selectionHint: string | null;
  RULER_SIZE: number;
  magnifierState: MagnifierState | null;
};

export function CanvasPanelView(props: CanvasPanelViewProps) {
  const {
    showRulers,
    viewportSize,
    topRulerRef,
    leftRulerRef,
    onTopRulerPointerDown,
    onLeftRulerPointerDown,
    onCanvasContextMenu,
    rulers,
    LEFT_RULER_DRAG_SOURCE_WIDTH_PX,
    toolMode,
    viewportRef,
    onViewportKeyDown,
    onViewportCopy,
    onViewportCut,
    onViewportPaste,
    onViewportDragOver,
    onViewportDrop,
    onBackgroundClick,
    onViewportPointerDown,
    onViewportPointerUp,
    svgResult,
    noActiveFigure,
    assistantLockReason,
    snapshot,
    svgModel,
    svgLayerHostRef,
    canvasTransform,
    showTransparencyGrid,
    showDocumentBounds,
    svgDiffHints,
    forceSvgReplaceAll,
    onSvgPatchFallback,
    repeatPreviewModel,
    interactionSvgRef,
    onInteractionPointerDown,
    onInteractionPointerUp,
    onInteractionLostPointerCapture,
    onInteractionPointerMove,
    onInteractionPointerEnter,
    onInteractionPointerLeave,
    gridLines,
    gridMinorStrokeWidth,
    gridMajorStrokeWidth,
    gridAxisStrokeWidth,
    visibleRanges,
    showGuides,
    renderedGuides,
    guideStrokeWidth,
    guideHitStrokeWidth,
    onGuidePointerDown,
    snapLines,
    snapSourceNames,
    snapStrokeWidth,
    snapCrossSize,
    toolPreview,
    handleStrokeWidth,
    previewArrowPoints,
    hitRegions,
    hoveredElementId,
    editableTextRegionKeys,
    draggableSourceIds,
    hitRegionCursorByTargetId,
    onElementPointerDown,
    onElementContextMenu,
    onElementDoubleClick,
    onHoverChange,
    nodePositionLinks,
    marqueeBounds,
    selectionBoxes,
    adornmentHighlightBoxes,
    selectedAdornmentConnectors,
    selectionStrokeWidth,
    textSelectionOverlay,
    selectionDragStrokeWidth,
    matrixSelectionSourceIds,
    curveControlLines,
    curveControlStrokeWidth,
    nodeAnchorOverlay,
    onNodeAnchorPointerDown,
    onNodeAnchorClick,
    onNodeAnchorHoverChange,
    nodePositionTargetTooltip,
    handleHalfSize,
    handleDisplays,
    onHandlePointerDown,
    onResizeHandlePointerDown,
    onRotateHandlePointerDown,
    platform,
    contextMenuState,
    commandRuntimeBindings,
    contextMenuDefinition,
    onContextMenuClose,
    onContextMenuCommandRun,
    dragTooltip,
    dragTooltipBoundary,
    warning,
    copyWarningToClipboard,
    onWarningBarKeyDown,
    canvasTextEdit,
    selectionHint,
    RULER_SIZE,
    magnifierState
  } = props;

  const viewportCursorClass = toolMode === "magnify" ? css.viewportMagnify : toolMode === "select" ? "" : css.viewportTool;
  const interactionCursorClass = toolMode === "magnify" ? css.interactionLayerMagnify : toolMode === "select" ? "" : css.interactionLayerTool;
  const magnifierRadius = MAGNIFIER_DIAMETER_PX / 2;
  const magnifierVisible = toolMode === "magnify" && magnifierState != null && svgResult != null && viewportSize.width > 0 && viewportSize.height > 0;
  const magnifierLeft = magnifierVisible
    ? Math.max(0, Math.min(viewportSize.width - MAGNIFIER_DIAMETER_PX, magnifierState.center.x - magnifierRadius))
    : 0;
  const magnifierTop = magnifierVisible
    ? Math.max(0, Math.min(viewportSize.height - MAGNIFIER_DIAMETER_PX, magnifierState.center.y - magnifierRadius))
    : 0;
  const textEditingSession = canvasTextEdit.session;
  const textCaretBlinkKey =
    textEditingSession && textEditingSession.selectionStart === textEditingSession.selectionEnd
      ? `${textEditingSession.sourceId}:${textEditingSession.selectionStart}:${textEditingSession.selectionEnd}:${textEditingSession.text}`
      : null;
  const [textCaretBlinkVisible, setTextCaretBlinkVisible] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const shouldBlinkTextCaret = !props.prefersNonBlinkingTextInsertionIndicator && !prefersReducedMotion;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const updatePreference = () => {
      setPrefersReducedMotion(query.matches);
    };
    updatePreference();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", updatePreference);
      return () => {
        query.removeEventListener("change", updatePreference);
      };
    }
    query.addListener(updatePreference);
    return () => {
      query.removeListener(updatePreference);
    };
  }, []);

  useEffect(() => {
    setTextCaretBlinkVisible(true);
    if (!textCaretBlinkKey || !shouldBlinkTextCaret) {
      return;
    }

    let visible = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const scheduleNextBlink = () => {
      timeoutId = setTimeout(() => {
        visible = !visible;
        setTextCaretBlinkVisible(visible);
        scheduleNextBlink();
      }, TEXT_CARET_BLINK_VISIBLE_MS);
    };

    scheduleNextBlink();
    return () => {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
    };
  }, [shouldBlinkTextCaret, textCaretBlinkKey]);

  return (
    <div className={css.panel}>
      <div className={[css.canvasGrid, showRulers ? "" : css.canvasGridNoRulers].filter(Boolean).join(" ")}>
        {showRulers ? <div className={css.rulerCorner} data-select="chrome">cm</div> : null}

        {showRulers ? (
          <div className={css.topRulerSlot} data-select="chrome">
            <svg
              ref={topRulerRef}
              className={css.topRuler}
              data-testid="canvas-top-ruler"
              data-select="chrome"
              viewBox={`0 0 ${Math.max(1, viewportSize.width)} ${RULER_SIZE}`}
              preserveAspectRatio="none"
              onPointerDown={onTopRulerPointerDown}
              onContextMenu={onCanvasContextMenu}
            >
              <line x1={0} y1={RULER_SIZE - 0.5} x2={viewportSize.width} y2={RULER_SIZE - 0.5} className={css.rulerAxis} />
              {rulers.topTicks.map((tick, index) => (
                <g key={`top-${index}`} transform={`translate(${tick.viewportPos},0)`}>
                  <line
                    x1={0}
                    y1={RULER_SIZE}
                    x2={0}
                    y2={tick.major ? 5 : 11}
                    className={tick.major ? css.rulerTickMajor : css.rulerTickMinor}
                  />
                  {tick.label && (
                    <text className={css.rulerLabel} x={2} y={10}>
                      {tick.label}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
        ) : null}

        {showRulers ? (
          <div className={css.leftRulerSlot} data-select="chrome">
            <svg
              ref={leftRulerRef}
              className={css.leftRuler}
              data-testid="canvas-left-ruler"
              data-select="chrome"
              viewBox={`0 0 ${RULER_SIZE} ${Math.max(1, viewportSize.height)}`}
              preserveAspectRatio="none"
              onPointerDown={onLeftRulerPointerDown}
              onContextMenu={onCanvasContextMenu}
            >
              <line x1={RULER_SIZE - 0.5} y1={0} x2={RULER_SIZE - 0.5} y2={viewportSize.height} className={css.rulerAxis} />
              {rulers.leftTicks.map((tick, index) => (
                <g key={`left-${index}`} transform={`translate(0,${tick.viewportPos})`}>
                  <line
                    x1={RULER_SIZE}
                    y1={0}
                    x2={tick.major ? 5 : 11}
                    y2={0}
                    className={tick.major ? css.rulerTickMajor : css.rulerTickMinor}
                  />
                  {tick.label && (
                    <text className={css.rulerLabel} x={1} y={-2}>
                      {tick.label}
                    </text>
                  )}
                </g>
              ))}
              <rect
                x={RULER_SIZE - LEFT_RULER_DRAG_SOURCE_WIDTH_PX}
                y={0}
                width={LEFT_RULER_DRAG_SOURCE_WIDTH_PX}
                height={Math.max(1, viewportSize.height)}
                className={css.leftRulerGuideStrip}
                fill="transparent"
              />
            </svg>
          </div>
        ) : null}

        <div
          className={[css.viewport, viewportCursorClass].filter(Boolean).join(" ")}
          ref={viewportRef}
          data-canvas-viewport="true"
          data-testid="canvas-viewport"
          tabIndex={0}
          onKeyDown={onViewportKeyDown}
          onCopy={onViewportCopy}
          onCut={onViewportCut}
          onPaste={onViewportPaste}
          onDragOver={onViewportDragOver}
          onDrop={onViewportDrop}
          onClick={onBackgroundClick}
          onPointerDown={onViewportPointerDown}
          onPointerUp={onViewportPointerUp}
          onContextMenu={(event) => {
            if (event.defaultPrevented) {
              return;
            }
            if (svgResult && event.target !== event.currentTarget) {
              return;
            }
            onCanvasContextMenu(event);
          }}
        >
          {assistantLockReason ? <div className={css.lockOverlay} data-testid="canvas-lock-overlay" data-select="text">{assistantLockReason}</div> : null}
          {!svgResult ? (
            <div className={css.noSvg} data-testid="canvas-no-svg" data-select="text">
              {noActiveFigure ? "Select a figure to edit." : (snapshot.source ? "Computing…" : "No source")}
            </div>
          ) : (
            <div
              className={css.worldStage}
              data-testid="canvas-world-stage"
              data-canvas-translate-x={canvasTransform.translateX}
              data-canvas-translate-y={canvasTransform.translateY}
              data-canvas-scale={canvasTransform.scale}
              style={{
                width: svgResult.viewBox.width * canvasTransform.scale,
                height: svgResult.viewBox.height * canvasTransform.scale,
                transform: `translate(${canvasTransform.translateX}px, ${canvasTransform.translateY}px)`
              }}
            >
              <CanvasSVGLayer
                model={svgModel}
                diffHints={svgDiffHints}
                forceReplaceAll={forceSvgReplaceAll}
                showTransparencyGrid={showTransparencyGrid}
                showDocumentBounds={showDocumentBounds}
                onFallback={onSvgPatchFallback}
                hostRef={svgLayerHostRef}
              />

              {repeatPreviewModel ? (
                <svg
                  className={css.repeatPreviewLayer}
                  data-testid="canvas-repeat-preview-layer"
                  viewBox={`${repeatPreviewModel.viewBox.x} ${repeatPreviewModel.viewBox.y} ${repeatPreviewModel.viewBox.width} ${repeatPreviewModel.viewBox.height}`}
                  aria-hidden="true"
                >
                  <defs dangerouslySetInnerHTML={{ __html: repeatPreviewModel.defs.join("") }} />
                  <g
                    className={css.repeatPreviewContent}
                    dangerouslySetInnerHTML={{ __html: repeatPreviewModel.parts.map((part) => part.markup).join("") }}
                  />
                </svg>
              ) : null}

              <svg
                ref={interactionSvgRef}
                className={[css.interactionLayer, interactionCursorClass].filter(Boolean).join(" ")}
                data-testid="canvas-interaction-layer"
                viewBox={`${svgResult.viewBox.x} ${svgResult.viewBox.y} ${svgResult.viewBox.width} ${svgResult.viewBox.height}`}
                onClick={onBackgroundClick}
                onPointerDown={onInteractionPointerDown}
                onPointerUp={onInteractionPointerUp}
                onPointerCancel={onInteractionPointerUp}
                onLostPointerCapture={onInteractionLostPointerCapture}
                onPointerMove={onInteractionPointerMove}
                onPointerEnter={onInteractionPointerEnter}
                onPointerLeave={onInteractionPointerLeave}
                onContextMenu={onCanvasContextMenu}
              >
                {gridLines && (
                  <g className={css.gridOverlay}>
                    {gridLines.verticalMinor.map((x: number) => (
                      <line
                        key={`v-min-${x}`}
                        x1={x}
                        x2={x}
                        y1={gridLines.yMin}
                        y2={gridLines.yMax}
                        className={css.gridMinor}
                        strokeWidth={gridMinorStrokeWidth}
                      />
                    ))}
                    {gridLines.verticalMajor.map((x: number) => (
                      <line
                        key={`v-maj-${x}`}
                        x1={x}
                        x2={x}
                        y1={gridLines.yMin}
                        y2={gridLines.yMax}
                        className={css.gridMajor}
                        strokeWidth={gridMajorStrokeWidth}
                      />
                    ))}
                    {gridLines.horizontalMinor.map((y: number) => (
                      <line
                        key={`h-min-${y}`}
                        x1={visibleRanges?.worldMinX ?? svgResult.viewBox.x}
                        x2={visibleRanges?.worldMaxX ?? (svgResult.viewBox.x + svgResult.viewBox.width)}
                        y1={y}
                        y2={y}
                        className={css.gridMinor}
                        strokeWidth={gridMinorStrokeWidth}
                      />
                    ))}
                    {gridLines.horizontalMajor.map((y: number) => (
                      <line
                        key={`h-maj-${y}`}
                        x1={visibleRanges?.worldMinX ?? svgResult.viewBox.x}
                        x2={visibleRanges?.worldMaxX ?? (svgResult.viewBox.x + svgResult.viewBox.width)}
                        y1={y}
                        y2={y}
                        className={css.gridMajor}
                        strokeWidth={gridMajorStrokeWidth}
                      />
                    ))}
                    {gridLines.verticalAxisX != null && (
                      <line
                        key="v-axis-0"
                        x1={gridLines.verticalAxisX}
                        x2={gridLines.verticalAxisX}
                        y1={gridLines.yMin}
                        y2={gridLines.yMax}
                        className={css.gridAxis}
                        strokeWidth={gridAxisStrokeWidth}
                      />
                    )}
                    {gridLines.horizontalAxisY != null && (
                      <line
                        key="h-axis-0"
                        x1={visibleRanges?.worldMinX ?? svgResult.viewBox.x}
                        x2={visibleRanges?.worldMaxX ?? (svgResult.viewBox.x + svgResult.viewBox.width)}
                        y1={gridLines.horizontalAxisY}
                        y2={gridLines.horizontalAxisY}
                        className={css.gridAxis}
                        strokeWidth={gridAxisStrokeWidth}
                      />
                    )}
                  </g>
                )}

                {showGuides && (renderedGuides.vertical.length > 0 || renderedGuides.horizontal.length > 0) && (
                  <g className={css.guideOverlay}>
                    {renderedGuides.vertical.map((x: number) => (
                      <g key={`guide-v-${fmt(x)}`}>
                        <line
                          data-testid="canvas-guide-vertical"
                          x1={x}
                          x2={x}
                          y1={visibleRanges?.svgMinY ?? svgResult.viewBox.y}
                          y2={visibleRanges?.svgMaxY ?? (svgResult.viewBox.y + svgResult.viewBox.height)}
                          className={css.guideLine}
                          strokeWidth={guideStrokeWidth}
                        />
                        <line
                          x1={x}
                          x2={x}
                          y1={visibleRanges?.svgMinY ?? svgResult.viewBox.y}
                          y2={visibleRanges?.svgMaxY ?? (svgResult.viewBox.y + svgResult.viewBox.height)}
                          className={`${css.guideHitLine} ${css.guideLineVertical}`}
                          strokeWidth={guideHitStrokeWidth}
                          onPointerDown={(event) => { onGuidePointerDown(event, "vertical", x); }}
                        />
                      </g>
                    ))}
                    {renderedGuides.horizontal.map((worldY: number) => {
                      const y = worldToSvgY(worldY, svgResult.viewBox);
                      return (
                        <g key={`guide-h-${fmt(worldY)}`}>
                          <line
                            data-testid="canvas-guide-horizontal"
                            x1={visibleRanges?.worldMinX ?? svgResult.viewBox.x}
                            x2={visibleRanges?.worldMaxX ?? (svgResult.viewBox.x + svgResult.viewBox.width)}
                            y1={y}
                            y2={y}
                            className={css.guideLine}
                            strokeWidth={guideStrokeWidth}
                          />
                          <line
                            x1={visibleRanges?.worldMinX ?? svgResult.viewBox.x}
                            x2={visibleRanges?.worldMaxX ?? (svgResult.viewBox.x + svgResult.viewBox.width)}
                            y1={y}
                            y2={y}
                            className={`${css.guideHitLine} ${css.guideLineHorizontal}`}
                            strokeWidth={guideHitStrokeWidth}
                            onPointerDown={(event) => { onGuidePointerDown(event, "horizontal", worldY); }}
                          />
                        </g>
                      );
                    })}
                  </g>
                )}

                <SnapOverlay
                  snapLines={snapLines}
                  sourceNames={snapSourceNames}
                  viewBox={svgResult.viewBox}
                  scale={canvasTransform.scale}
                  snapStrokeWidth={snapStrokeWidth}
                  snapCrossSize={snapCrossSize}
                />

                <ToolPreviewOverlay
                  toolPreview={toolPreview}
                  scale={canvasTransform.scale}
                  handleStrokeWidth={handleStrokeWidth}
                  previewArrowPoints={previewArrowPoints}
                />

                <HitRegionLayer
                  hitRegions={hitRegions}
                  hoveredElementId={hoveredElementId}
                  toolMode={toolMode}
                  editableTextRegionKeys={editableTextRegionKeys}
                  draggableSourceIds={draggableSourceIds}
                  cursorByTargetId={hitRegionCursorByTargetId}
                  onElementPointerDown={onElementPointerDown}
                  onElementContextMenu={onElementContextMenu}
                  onElementDoubleClick={onElementDoubleClick}
                  onHoverChange={onHoverChange}
                />

                <NodePositionLinkOverlay
                  links={nodePositionLinks}
                  viewBox={svgResult.viewBox}
                />

                <SelectionOverlay
                  marqueeBounds={marqueeBounds}
                  selectionBoxes={selectionBoxes}
                  adornmentHighlightBoxes={adornmentHighlightBoxes}
                  adornmentConnectors={selectedAdornmentConnectors}
                  selectionStrokeWidth={selectionStrokeWidth}
                />

                <SelectionDragLayer
                  toolMode={toolMode}
                  selectionBoxes={selectionBoxes}
                  dragStrokeWidth={selectionDragStrokeWidth}
                  draggableSourceIds={matrixSelectionSourceIds}
                  onElementPointerDown={onElementPointerDown}
                  onElementContextMenu={onElementContextMenu}
                  onElementDoubleClick={onElementDoubleClick}
                />

                <CurveControlOverlay
                  lines={curveControlLines}
                  viewBox={svgResult.viewBox}
                  strokeWidth={curveControlStrokeWidth}
                />

                <NodeAnchorOverlay
                  anchorOverlay={nodeAnchorOverlay}
                  viewBox={svgResult.viewBox}
                  strokeWidth={handleStrokeWidth}
                  radius={handleHalfSize}
                  onAnchorPointerDown={
                    onNodeAnchorPointerDown
                      ? (event, anchor) => {
                          if (anchor.nodeSourceId) {
                            onNodeAnchorPointerDown(event, anchor.nodeSourceId);
                          }
                        }
                      : undefined
                  }
                  onAnchorClick={
                    onNodeAnchorClick
                      ? (event, anchor) => {
                          if (anchor.nodeSourceId) {
                            onNodeAnchorClick(event, anchor.nodeSourceId);
                          }
                        }
                      : undefined
                  }
                  onAnchorHoverChange={
                    onNodeAnchorHoverChange
                      ? (anchor) => { onNodeAnchorHoverChange(anchor?.nodeSourceId ?? null); }
                      : undefined
                  }
                />

                {toolMode === "select" && (
                  <HandleOverlay
                    handleDisplays={handleDisplays}
                    handleHalfSize={handleHalfSize}
                    handleStrokeWidth={handleStrokeWidth}
                    onHandlePointerDown={onHandlePointerDown}
                    onElementPointerDown={onElementPointerDown}
                    onElementContextMenu={onElementContextMenu}
                    onResizeHandlePointerDown={onResizeHandlePointerDown}
                    onRotateHandlePointerDown={onRotateHandlePointerDown}
                  />
                )}
              </svg>
            </div>
          )}

          {textSelectionOverlay ? (
            <div className={css.textSelectionViewportOverlay} aria-hidden="true" data-testid="canvas-text-selection-overlay">
              {textSelectionOverlay.rects.map((rect: TextSelectionOverlayBox, index: number) => {
                const width = rect.bounds.maxX - rect.bounds.minX;
                const height = rect.bounds.maxY - rect.bounds.minY;
                const hasRotatedPlacement = Number.isFinite(rect.rotationDeg) && rect.center != null;
                return (
                  <div
                    key={`${textSelectionOverlay.sourceId}:rect:${index}:${rect.bounds.minX}:${rect.bounds.minY}:${rect.bounds.maxX}:${rect.bounds.maxY}:${rect.center?.x ?? ""}:${rect.center?.y ?? ""}:${rect.rotationDeg ?? ""}`}
                    className={css.textSelectionViewportRect}
                    data-testid="canvas-text-selection-rect"
                    style={{
                      left: hasRotatedPlacement ? rect.center!.x : rect.bounds.minX,
                      top: hasRotatedPlacement ? rect.center!.y : rect.bounds.minY,
                      width,
                      height,
                      transform: hasRotatedPlacement ? `translate(-50%, -50%) rotate(${rect.rotationDeg}deg)` : undefined,
                      transformOrigin: "center"
                    }}
                  />
                );
              })}
              {textSelectionOverlay.caret ? (
                (() => {
                  const caret = textSelectionOverlay.caret;
                  const hasRotatedPlacement = Number.isFinite(caret.rotationDeg) && caret.center != null;
                  const height = caret.bounds.maxY - caret.bounds.minY;
                  return (
                    <div
                      className={[
                        css.textSelectionViewportCaret,
                        props.prefersNonBlinkingTextInsertionIndicator ? css.textCaretNoBlink : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-testid="canvas-text-selection-caret"
                      style={{
                        left: hasRotatedPlacement ? caret.center!.x : caret.bounds.minX,
                        top: hasRotatedPlacement ? caret.center!.y : caret.bounds.minY,
                        height,
                        animation: "none",
                        opacity: textCaretBlinkVisible ? 1 : 0,
                        transform: hasRotatedPlacement
                          ? `translate(-50%, -50%) rotate(${caret.rotationDeg}deg)`
                          : undefined,
                        transformOrigin: "center"
                      }}
                    />
                  );
                })()
              ) : null}
            </div>
          ) : null}

          {canvasTextEdit.popup ? (
            <CanvasTextEditPopup
              model={canvasTextEdit.popup}
              prefersNonBlinkingTextInsertionIndicator={props.prefersNonBlinkingTextInsertionIndicator}
              caretBlinkVisible={textCaretBlinkVisible}
            />
          ) : null}

          {magnifierVisible ? (
            <div
              className={css.magnifierOverlay}
              data-testid="canvas-magnifier-shell"
              style={{
                left: magnifierLeft,
                top: magnifierTop,
                width: MAGNIFIER_DIAMETER_PX,
                height: MAGNIFIER_DIAMETER_PX
              }}
            >
              <div
                className={css.magnifierContent}
                style={{
                  width: viewportSize.width,
                  height: viewportSize.height,
                  transform: `translate(${magnifierRadius - magnifierState.center.x * MAGNIFIER_SCALE}px, ${magnifierRadius - magnifierState.center.y * MAGNIFIER_SCALE}px) scale(${MAGNIFIER_SCALE})`
                }}
              >
                <div
                  className={css.worldStage}
                  style={{
                    width: svgResult.viewBox.width * canvasTransform.scale,
                    height: svgResult.viewBox.height * canvasTransform.scale,
                    transform: `translate(${canvasTransform.translateX}px, ${canvasTransform.translateY}px)`
                  }}
                >
                  <CanvasSVGLayer
                    model={svgModel}
                    diffHints={svgDiffHints}
                    forceReplaceAll={forceSvgReplaceAll}
                    showTransparencyGrid={showTransparencyGrid}
                    showDocumentBounds={showDocumentBounds}
                    onFallback={onSvgPatchFallback}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {platform.menu?.usesNativeContextMenus ? null : (
            <CanvasContextMenu
              open={contextMenuState != null}
              anchor={{
                x: contextMenuState?.anchor.x ?? 0,
                y: contextMenuState?.anchor.y ?? 0
              }}
              target={contextMenuState?.target ?? "canvas-empty"}
              bindings={commandRuntimeBindings}
              definition={contextMenuDefinition}
              containerRef={viewportRef}
              onClose={onContextMenuClose}
              onCommandRun={onContextMenuCommandRun}
            />
          )}

          {dragTooltip ? (
            <RenderedTooltip
              open
              anchor={dragTooltip.anchor}
              boundary={dragTooltipBoundary}
              content={
                <div
                  className={[
                    css.dragTooltipContent,
                    dragTooltip.rows.every((row) => row.label === "X" || row.label === "Y") ? css.dragTooltipContentCompact : ""
                  ].filter(Boolean).join(" ")}
                  data-testid="canvas-drag-tooltip"
                  data-drag-tooltip-kind={dragTooltip.kind}
                  data-select="text"
                >
                  {dragTooltip.rows.map((row) => (
                    <div
                      key={`${row.label}:${row.value}`}
                      className={css.dragTooltipRow}
                      data-testid="canvas-drag-tooltip-row"
                    >
                      <span className={css.dragTooltipLabel}>{row.label}:</span>
                      <span className={css.dragTooltipValue}>{row.value}</span>
                    </div>
                  ))}
                </div>
              }
              className={css.dragTooltip}
              data-testid="canvas-drag-tooltip-shell"
            />
          ) : null}

          {nodePositionTargetTooltip ? (
            <RenderedTooltip
              content={nodePositionTargetTooltip.content}
              open
              anchor={nodePositionTargetTooltip.anchor}
              data-testid="node-position-target-tooltip"
            />
          ) : null}

          {warning && (
            <RenderedTooltip content="Click to copy message" block>
              <div
                className={css.warningBar}
                data-select="text"
                onClick={copyWarningToClipboard}
                onKeyDown={onWarningBarKeyDown}
                role="button"
                tabIndex={0}
                aria-label="Warning message. Click to copy."
                data-testid="canvas-warning-message"
              >
                {warning}
              </div>
            </RenderedTooltip>
          )}
          {selectionHint && !warning ? (
            <div className={css.selectionHint} data-testid="canvas-selection-hint" data-select="text">
              {selectionHint}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
