import { beginDocumentEdit } from "../../edit-session";
import { executeDocumentEdit } from "../../edit-execution";
import type { SchedulePropertyCleanup } from "../useDeferredPropertyCleanup";
import { createEditGeometrySession, type EditGeometrySession } from "@tikz-editor/core/edit/geometry-session";
import { buildSelectionRects } from "../builds-panel/build-selection";
import {
Suspense,
lazy,
memo,
useCallback,
useEffect,
useLayoutEffect,
useMemo,
useRef,
useState,
type KeyboardEvent as ReactKeyboardEvent,
type MouseEvent as ReactMouseEvent,
type PointerEvent as ReactPointerEvent
} from "react";
import { worldPoint as makeWorldPoint,pt,px,svgBounds,viewportPoint } from "@tikz-editor/core/coords/index";
import {
ADORNMENT_EDIT_NOOP_REASON,
PATH_ATTACHED_NODE_EDIT_NOOP_REASON,
PROPERTY_WRITE_CLEANUP_NOOP_REASON,
preflightPositionNodeRelativeToAction,
type EditAction,
type EditActionResult
} from "@tikz-editor/core/edit/actions";
import { PT_PER_CM,formatNumber } from "@tikz-editor/core/edit/format";
import {
makeForeachTemplateTargetId,
resolvePropertyTargetFromParseResult
} from "@tikz-editor/core/edit/property-target";
import type { SnapLine } from "@tikz-editor/core/edit/snapping";
import {
  beamerObjectAtOffset,
  beamerObjectDuplicationPatch,
  buildBeamerCaretStopDomain,
  buildBeamerObjectIndex,
  resolveBeamerEditScopeAt,
  type BeamerCaretDomain,
  type BeamerObjectNode
} from "@tikz-editor/core/beamer/index";
import { renderTikzToSvg } from "@tikz-editor/core/render/index";
import type {
EditHandlePositioningContext,
NodeAnchorTarget,
SceneElement
} from "@tikz-editor/core/semantic/types";
import type { SvgRenderModel } from "@tikz-editor/core/svg";
import type { SvgDiffHints, SvgViewBox } from "@tikz-editor/core/svg/index";
import { createTexNodeTextEngine } from "@tikz-editor/core/text/tex-node-text-engine";
import { createTextLayoutContext } from "@tikz-editor/core/text/layout-context";
import type { NodeTextEngine,NodeTextLayoutKind } from "@tikz-editor/core/text/types";
import { useShallow } from "zustand/react/shallow";
import type { AppMenuCommandId } from "../../app-menu";
import { buildCanvasContextMenuDefinition } from "../../context-menu";
import { buildEditParseOptions } from "../../edit-parse-options";
import { getActiveEditorPlatform } from "../../platform/current";
import { GRID_SIZE_MINOR_TARGET_PX } from "../../settings/types";
import { useSettingsStore } from "../../settings/useSettingsStore";
import { useEditorStore } from "../../store/store";
import type { CanvasDragKind,CanvasTransform } from "../../store/types";
import { resolveBucketFillEdit } from "./bucket-fill";
import { rootKey } from "../../root-key";
import { formatDocumentRootId, parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import { maskSourceOutsideSpan } from "@tikz-editor/core/document/masking";
import { recordDragPatchModeFullReason } from "./drag-patch-mode-debug";
import { DeckResizeOverlay } from "./DeckResizeOverlay";
import { CanvasPanelView } from "./CanvasPanelView";
import { useDeckOverlayContextMenu } from "./useDeckOverlayContextMenu";
import { useCanvasContextMenuController,useCanvasContextMenuState } from "./useCanvasContextMenus";
import {
appendFreehandToolPoint,
generateFreehandToolSource
} from "./freehand-tool";
import {
clamp,
viewportToWorldPoint,
worldToSvgPoint
} from "./geometry";
import type { Span } from "@tikz-editor/core/ast/types";
import type { HitRegion } from "./hit-regions";
import {
pickClosestSourceId
} from "./interaction-helpers";
import { resolveNodeAdornmentContextAction } from "./node-adornment-context-action";
import { collectRelativePositionTargetAnchors } from "./node-positioning-context-action";
import {
canvasDragKindFromDragState,
collectNewSourceIds,
collectSourceBounds,
dragCursorForState,
preferredNodeBoundsForSource,
previewArrowPoints,
rectHitRegionsForTargetId
} from "./panel-helpers";
import {
appendPathToolSegmentFromGesture,
generateAppendSegmentSource,
generatePathToolSource,
pathToolCurrentPoint,
pathToolHasDrawableSegments,
undoLastPathToolSegment,
type PathToolGestureSegment
} from "./path-tool";
import { collectDensePathSourceIds, resolvePathSelectionHint } from "./path-selection-hint";
import type { resolveResizeFrameForSource } from "./resize-frames";
import { isSvgPointWithinScopeBounds } from "./scope-overlay";
import {
summarizeSnapContextForDebug,
summarizeSnapLinesForDebug,
toDebugPoint
} from "./snap-debug";
import type {
ApplyActionFeedback,
CanvasSnapshot,
DragState,
DragTooltipState,
EditableTextTarget,
FreehandToolDraft,
GuideDragState,
GuidePreview,
GuidesState,
MagnifierState,
NodeAnchorOverlayState,
NodePositionLinkDisplay,
PathToolDraft,
PendingAddedSelection,
PendingBezier,
PendingTouchViewport,
ScopeParagraphRef,
SnapDebugLogInput,
SourceBoundsMap,
StateSetter,
TextEditingSession
} from "./types";
import { useCanvasDerivedState } from "./useCanvasDerivedState";
import { useCanvasDragController } from "./useCanvasDragController";
import { useCanvasElementInteractions } from "./useCanvasElementInteractions";
import { useCanvasGuideEffects } from "./useCanvasGuideEffects";
import { useCanvasGuidesAndRulers } from "./useCanvasGuidesAndRulers";
import { useCanvasHandleInteractions } from "./useCanvasHandleInteractions";
import { useCanvasKeyboardClipboard } from "./useCanvasKeyboardClipboard";
import { useCanvasSelectionDerivedState } from "./useCanvasSelectionDerivedState";
import { useCanvasSelectionInteractions } from "./useCanvasSelectionInteractions";
import { useCanvasSvgPatchInvalidation } from "./useCanvasSvgPatchInvalidation";
import { useCanvasTextEditSession } from "./useCanvasTextEditSession";
import { useCanvasToolInteractions } from "./useCanvasToolInteractions";
import { useCanvasViewportEffects } from "./useCanvasViewportEffects";
import { useCanvasViewportPersistence } from "./useCanvasViewportPersistence";
import { useBucketFillPreview,type BucketPreviewSession } from "./useBucketFillPreview";
import type { ClientPoint,SvgBounds,ViewportPoint,WorldPoint } from "../coords/types";
import { getDockLayoutHandle } from "../DockLayout";
import { useEditorCommandRuntime,type CommandOrigin } from "../editor-command-runtime";
import { isMacLikePlatform } from "../key-labels";
import {
formatEquationText,
type EquationNodeTarget
} from "../equation-utils";

const EquationModal = lazy(async () => {
  const mod = await import("../EquationModal");
  return { default: mod.EquationModal };
});

const EMPTY_GUIDES: GuidesState = { vertical: [], horizontal: [] };


const RULER_SIZE = 24;
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const NUDGE_STEP_PT = 0.05 * PT_PER_CM;
const NUDGE_STEP_SHIFT_PT = 0.25 * PT_PER_CM;
const ROTATE_HANDLE_OFFSET_PX = 24;
const LEFT_RULER_DRAG_SOURCE_WIDTH_PX = 12;
const RESIZE_NOOP_REASON = "Resize would not change node constraints.";
const CANVAS_DRAG_CURSOR_LOCK_CLASS = "is-dragging-canvas-cursor-lock";
const IMPORTED_SVG_TARGET_RATIO = 0.3;
const IMPORTED_SVG_MIN_SCALE = 0.2;
const IMPORTED_SVG_MAX_SCALE = 3;

const DESKTOP_SVG_CLIPBOARD_FORMATS = [
  "image/svg+xml",
  "public.svg-image",
  "com.microsoft.image-svg-xml"
] as const;
const DESKTOP_KEYNOTE_CLIPBOARD_FORMATS = [
  "com.apple.apps.content-language.canvas-object-1.0"
] as const;
const DESKTOP_POWERPOINT_GVML_CLIPBOARD_FORMATS = [
  "com.microsoft.Art--GVML-ClipFormat"
] as const;
const DESKTOP_TIKZ_CLIPBOARD_FORMATS = [
  "web application/x-tikz-editor+json",
  "application/x-tikz-editor+json",
  "com.tikzeditor.tikz-json"
] as const;

type NodePositionTargetStatus = {
  anchor: NodeAnchorTarget;
  action: EditAction;
  result: EditActionResult;
  preview: { currentAnchor: WorldPoint; targetAnchor: WorldPoint } | null;
  usable: boolean;
  reason: string | null;
};

function formatNodePositionTargetFailureReason(input: {
  rawReason: string;
  currentNodeSourceId: string;
  target: NodeAnchorTarget;
  snapshot: CanvasSnapshot;
}): string {
  if (!input.rawReason.toLowerCase().includes("negative positioning distance")) {
    return `Cannot position relative to ${input.target.nodeName}: ${input.rawReason}`;
  }

  const currentAnchors = collectBasicNodeAnchors(input.snapshot, input.currentNodeSourceId);
  const targetAnchors = input.target.nodeSourceId
    ? collectBasicNodeAnchors(input.snapshot, input.target.nodeSourceId)
    : null;
  if (!currentAnchors || !targetAnchors) {
    return `Cannot position relative to ${input.target.nodeName}: this placement would require a negative positioning distance.`;
  }

  const horizontalOverlap = intervalsOverlap(
    currentAnchors.west.world.x,
    currentAnchors.east.world.x,
    targetAnchors.west.world.x,
    targetAnchors.east.world.x
  );
  const verticalOverlap = intervalsOverlap(
    currentAnchors.south.world.y,
    currentAnchors.north.world.y,
    targetAnchors.south.world.y,
    targetAnchors.north.world.y
  );

  if (horizontalOverlap && verticalOverlap) {
    return `Cannot position relative to ${input.target.nodeName}: the node boxes overlap, so a one-option relative placement would need a negative distance.`;
  }
  if (verticalOverlap) {
    return `Cannot position relative to ${input.target.nodeName}: the nodes overlap vertically, so a diagonal placement would need a negative vertical distance.`;
  }
  if (horizontalOverlap) {
    return `Cannot position relative to ${input.target.nodeName}: the nodes overlap horizontally, so a diagonal placement would need a negative horizontal distance.`;
  }

  return `Cannot position relative to ${input.target.nodeName}: this placement would require a negative positioning distance.`;
}

function collectBasicNodeAnchors(snapshot: CanvasSnapshot, sourceId: string): {
  north: NodeAnchorTarget;
  south: NodeAnchorTarget;
  east: NodeAnchorTarget;
  west: NodeAnchorTarget;
} | null {
  const anchors = new Map<string, NodeAnchorTarget>();
  for (const anchor of snapshot.semanticResult?.nodeAnchorTargets ?? []) {
    if (anchor.nodeSourceId === sourceId) {
      anchors.set(anchor.anchor, anchor);
    }
  }
  const north = anchors.get("north");
  const south = anchors.get("south");
  const east = anchors.get("east");
  const west = anchors.get("west");
  return north && south && east && west ? { north, south, east, west } : null;
}

function resolveNodePositionLinkEndpoints(
  context: EditHandlePositioningContext,
  direction: string
): { from: WorldPoint; to: WorldPoint } {
  const anchors = context.anchorOffsetsByDirection?.[direction];
  if (!anchors) {
    return { from: context.currentCenter, to: context.targetCenter };
  }
  return {
    from: worldPointWithOffset(context.currentCenter, anchors.currentAnchor),
    to: worldPointWithOffset(context.targetCenter, anchors.targetAnchor)
  };
}

function worldPointWithOffset(center: WorldPoint, offset: WorldPoint): WorldPoint {
  return makeWorldPoint(pt(center.x + offset.x), pt(center.y + offset.y));
}

function intervalsOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  const leftMin = Math.min(a0, a1);
  const leftMax = Math.max(a0, a1);
  const rightMin = Math.min(b0, b1);
  const rightMax = Math.max(b0, b1);
  return leftMin < rightMax && rightMin < leftMax;
}

const DOCUMENT_BOUNDS_OFF_MIN_PADDING_WORLD = 200;
function viewportPointFromClient(clientPoint: ClientPoint, viewport: HTMLDivElement | null): ViewportPoint {
  const rect = viewport?.getBoundingClientRect();
  return viewportPoint(
    px(rect ? clientPoint.x - rect.left : clientPoint.x),
    px(rect ? clientPoint.y - rect.top : clientPoint.y)
  );
}

function resolveFallbackTextLayoutKind(text: string, hasFixedWidth: boolean | undefined, isMatrixCell: boolean): NodeTextLayoutKind {
  if (isMatrixCell) {
    return "matrix-cell";
  }
  if (/\\\\(?:\[[^\]]*\])?/.test(text)) {
    return "explicit-multiline";
  }
  if (hasFixedWidth) {
    return "wrapped";
  }
  return "single-line";
}

function expandSvgViewBox(
  viewBox: SvgViewBox,
  viewportSize: { width: number; height: number },
  scale: number
): SvgViewBox {
  const safeScale = Math.max(scale, 1e-3);
  const viewportWorldExtent = Math.max(viewportSize.width, viewportSize.height) / safeScale;
  const padding = Math.max(DOCUMENT_BOUNDS_OFF_MIN_PADDING_WORLD, viewportWorldExtent * 2);
  return {
    x: viewBox.x - padding,
    y: viewBox.y - padding,
    width: viewBox.width + padding * 2,
    height: viewBox.height + padding * 2
  };
}

function mergeBoundsList(boundsList: readonly SvgBounds[]): SvgBounds | null {
  if (boundsList.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const bounds of boundsList) {
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return svgBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

function boundsMaxDimension(bounds: SvgBounds): number {
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

function formatScopeScale(scale: number): number {
  return Number(scale.toFixed(3));
}

function computeAutoScaleForImportedTikz(
  importedTikzSource: string,
  currentScene: { elements: SceneElement[] } | null,
  currentViewBox: SvgViewBox | null
): number | null {
  if (!currentScene || !currentViewBox || currentScene.elements.length === 0) {
    return null;
  }

  const currentBounds = mergeBoundsList([...collectSourceBounds(currentScene.elements, currentViewBox).values()]);
  if (!currentBounds) {
    return null;
  }
  const currentDimension = boundsMaxDimension(currentBounds);
  if (!Number.isFinite(currentDimension) || currentDimension <= 1e-6) {
    return null;
  }

  let importedRendered: ReturnType<typeof renderTikzToSvg>;
  try {
    importedRendered = renderTikzToSvg(importedTikzSource);
  } catch {
    return null;
  }

  const importedBounds = mergeBoundsList(
    [...collectSourceBounds(importedRendered.semantic.scene.elements, importedRendered.svg.viewBox).values()]
  );
  if (!importedBounds) {
    return null;
  }
  const importedDimension = boundsMaxDimension(importedBounds);
  if (!Number.isFinite(importedDimension) || importedDimension <= 1e-6) {
    return null;
  }

  const targetDimension = currentDimension * IMPORTED_SVG_TARGET_RATIO;
  const rawScale = targetDimension / importedDimension;
  const clampedScale = clamp(rawScale, IMPORTED_SVG_MIN_SCALE, IMPORTED_SVG_MAX_SCALE);
  if (!Number.isFinite(clampedScale) || Math.abs(clampedScale - 1) < 0.05) {
    return null;
  }
  return formatScopeScale(clampedScale);
}

export const CanvasPanel = memo(function CanvasPanel({
  repeatPreviewModel = null
}: {
  repeatPreviewModel?: SvgRenderModel | null;
}) {
  const platform = getActiveEditorPlatform();
  const [prefersNonBlinkingTextInsertionIndicator, setPrefersNonBlinkingTextInsertionIndicator] = useState(false);
  const {
    assistantLockReason,
    source,
    activeRootId,
    documentKind,
    activeDocumentId,
    tabOrder,
    sourceRevision,
    snapshot,
    toolMode,
    selectedElementIds,
    focusedScopeId,
    hoveredElementId,
    activeCanvasDragKind,
    activeSourceScrubSourceId,
    deckObjectSelection,
    lastEditChangedSourceIds,
    lastEditChangeToken,
    lastEditWarningMessage,
    lastEditWarningToken,
    canvasTransform,
    fitToContentRequestToken,
    fitToContentModeActive,
    zoomRequestToken,
    zoomRequestDirection,
    zoomScaleRequestToken,
    zoomScaleRequestValue,
    showGrid,
    showTransparencyGrid,
    snapModes,
    freehandSmoothingPx,
    bucketFillColor,
    selectedAddShape,
    selectedAddMatrixRows,
    selectedAddMatrixColumns,
    creationStrokeColor,
    creationFillColor,
    showRulers,
    showGuides,
    showDocumentBounds,
    showDevPanel,
    dispatch
  } = useEditorStore(useShallow((s) => ({
    assistantLockReason: s.documents[s.activeDocumentId]?.assistantLockReason ?? null,
    source: s.source,
    activeRootId: s.activeRootId,
    documentKind: s.documentKind,
    activeDocumentId: s.activeDocumentId,
    tabOrder: s.tabOrder,
    sourceRevision: s.sourceRevision,
    snapshot: s.snapshot,
    toolMode: s.toolMode,
    selectedElementIds: s.selectedElementIds,
    focusedScopeId: s.focusedScopeId,
    hoveredElementId: s.hoveredElementId,
    activeCanvasDragKind: s.activeCanvasDragKind,
    activeSourceScrubSourceId: s.activeSourceScrubSourceId,
    deckObjectSelection: s.deckObjectSelection,
    lastEditChangedSourceIds: s.lastEditChangedSourceIds,
    lastEditChangeToken: s.lastEditChangeToken,
    lastEditWarningMessage: s.documents[s.activeDocumentId]?.lastEditWarningMessage ?? null,
    lastEditWarningToken: s.documents[s.activeDocumentId]?.lastEditWarningToken ?? 0,
    canvasTransform: s.canvasTransform,
    fitToContentRequestToken: s.fitToContentRequestToken,
    fitToContentModeActive: s.fitToContentModeActive,
    zoomRequestToken: s.zoomRequestToken,
    zoomRequestDirection: s.zoomRequestDirection,
    zoomScaleRequestToken: s.zoomScaleRequestToken,
    zoomScaleRequestValue: s.zoomScaleRequestValue,
    showGrid: s.showGrid,
    showTransparencyGrid: s.showTransparencyGrid,
    snapModes: s.snapModes,
    freehandSmoothingPx: s.freehandSmoothingPx,
    bucketFillColor: s.bucketFillColor,
    selectedAddShape: s.selectedAddShape,
    selectedAddMatrixRows: s.selectedAddMatrixRows,
    selectedAddMatrixColumns: s.selectedAddMatrixColumns,
    creationStrokeColor: s.creationStrokeColor,
    creationFillColor: s.creationFillColor,
    showRulers: s.showRulers,
    showGuides: s.showGuides,
    showDocumentBounds: s.showDocumentBounds,
    showDevPanel: s.showDevPanel,
    dispatch: s.dispatch
  })));
  const { gridSize, handleSizePx, zoomSpeed, snapHapticsEnabled, textEditPlacement } = useSettingsStore(useShallow((s) => ({
    gridSize: s.settings.canvas.gridSize,
    handleSizePx: s.settings.canvas.handleSizePx,
    zoomSpeed: s.settings.canvas.zoomSpeed,
    snapHapticsEnabled: s.settings.canvas.snapHapticsEnabled,
    textEditPlacement: s.settings.canvas.textEditPlacement
  })));
  const gridMinorTargetPx = GRID_SIZE_MINOR_TARGET_PX[gridSize];

  // Deck mode: the canvas shows the active frame's rendered page through the
  // same SVG pipeline. Scene and edit handles are empty, so tikz
  // interactions are inert; the reducer additionally rejects edit actions.
  const deckActiveFrame = snapshot.deck?.activeFrame ?? null;
  const deckBuildSelection = useEditorStore((s) => s.deckBuildSelection);
  const deckBuildSelectionRects = useMemo(() => {
    if (!deckActiveFrame || !deckBuildSelection || snapshot.source !== source ||
      deckBuildSelection.documentId !== activeDocumentId ||
      deckBuildSelection.frameId !== deckActiveFrame.frameId ||
      deckBuildSelection.step !== deckActiveFrame.step ||
      deckBuildSelection.sourceRevision !== sourceRevision) return [];
    return buildSelectionRects(deckActiveFrame.layout, source, deckBuildSelection.contentSpans);
  }, [activeDocumentId, deckActiveFrame, deckBuildSelection, snapshot.source, source, sourceRevision]);
  const deckTextLayoutContext = useMemo(() => {
    if (!deckActiveFrame) {
      return null;
    }
    const paragraphs = deckActiveFrame.layout.paragraphs;
    const reports = paragraphs.map((paragraph) => paragraph.report);
    const layouts = paragraphs.map((paragraph) => ({
      paragraphId: paragraph.paragraphId,
      layout: paragraph.vlistLayout
    }));
    const layoutsByParagraph = new Map(layouts.map((entry) => [entry.paragraphId, entry.layout]));
    return createTextLayoutContext({
      getParagraphReports: () => reports,
      getVListLayouts: () => layouts,
      getVListLayout: (paragraphId) => layoutsByParagraph.get(paragraphId) ?? null,
    });
  }, [deckActiveFrame]);
  const textLayoutContext =
    deckTextLayoutContext ?? snapshot.textLayoutContext ?? null;
  const deckSvgResult = useMemo(
    () =>
      deckActiveFrame
        ? {
            svg: deckActiveFrame.svg,
            viewBox: deckActiveFrame.viewBox,
            model: deckActiveFrame.svgModel,
            diagnostics: []
          }
        : null,
    [deckActiveFrame]
  );
  const baseSvgResult = deckSvgResult ?? snapshot.svg;
  const baseSvgModel = deckActiveFrame?.svgModel ?? snapshot.svgModel;
  const [warning, setWarning] = useState<string | null>(null);
  const [dragTooltip, setDragTooltip] = useState<DragTooltipState | null>(null);
  const [dragTooltipBoundary, setDragTooltipBoundary] = useState<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);
  const [nodePositionTargetTooltip, setNodePositionTargetTooltip] = useState<{
    content: string;
    anchor: { x: number; y: number };
  } | null>(null);
  const [dragCursorLock, setDragCursorLock] = useState<string | null>(null);
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);
  const activeGuideFigureKey = rootKey(activeDocumentId, activeRootId);
  const [guidesByFigureKey, setGuidesByFigureKey] = useState(() => new Map<string, GuidesState>());
  const guides = guidesByFigureKey.get(activeGuideFigureKey) ?? EMPTY_GUIDES;
  const setGuides = useCallback<StateSetter<GuidesState>>(
    (update) => {
      setGuidesByFigureKey((current) => {
        const previous = current.get(activeGuideFigureKey) ?? EMPTY_GUIDES;
        const next = typeof update === "function" ? update(previous) : update;
        if (next === previous) {
          return current;
        }
        const updated = new Map(current);
        updated.set(activeGuideFigureKey, next);
        return updated;
      });
    },
    [activeGuideFigureKey]
  );
  const [guidePreview, setGuidePreview] = useState<GuidePreview | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const svgResult = useMemo(() => {
    if (!baseSvgResult || showDocumentBounds) {
      return baseSvgResult;
    }
    return {
      ...baseSvgResult,
      viewBox: expandSvgViewBox(baseSvgResult.viewBox, viewportSize, canvasTransform.scale)
    };
  }, [baseSvgResult, canvasTransform.scale, showDocumentBounds, viewportSize]);
  const svgModel = useMemo(() => {
    if (!baseSvgModel || !svgResult) {
      return baseSvgModel;
    }
    if (baseSvgModel.viewBox === svgResult.viewBox) {
      return baseSvgModel;
    }
    return {
      ...baseSvgModel,
      viewBox: svgResult.viewBox
    };
  }, [baseSvgModel, svgResult]);
  const [toolCursorWorld, setToolCursorWorld] = useState<WorldPoint | null>(null);
  const [magnifierState, setMagnifierState] = useState<MagnifierState | null>(null);
  const [pathDraft, setPathDraft] = useState<PathToolDraft | null>(null);
  const [freehandDraft, setFreehandDraft] = useState<FreehandToolDraft | null>(null);
  const [pathSegmentDraft, setPathSegmentDraft] = useState<Extract<DragState, { kind: "tool-path-segment" }> | null>(null);
  const [toolDraft, setToolDraft] = useState<Extract<DragState, { kind: "tool-create" }> | null>(null);
  const [bezierBendDraft, setBezierBendDraft] = useState<Extract<DragState, { kind: "tool-bezier-bend" }> | null>(null);
  const [pendingBezier, setPendingBezier] = useState<PendingBezier | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<Extract<DragState, { kind: "marquee" }> | null>(null);
  const [nodeAnchorOverlay, setNodeAnchorOverlay] = useState<NodeAnchorOverlayState | null>(null);
  const [pendingNodePositionTargetPick, setPendingNodePositionTargetPick] = useState<{ nodeSourceId: string } | null>(null);
  const suppressNodeAnchorClickRef = useRef(false);
  const [pendingNodePositionAnchorHoverSourceId, setPendingNodePositionAnchorHoverSourceId] = useState<string | null>(null);
  const [activeTextEngine, setActiveTextEngine] = useState<NodeTextEngine | null>(null);
  const [pathAttachedNodePreview, setPathAttachedNodePreview] = useState<{ sourceId: string; dx: number; dy: number } | null>(null);
  const [dragPatchMode, setDragPatchMode] = useState<"partial" | "full">("partial");
  const contextMenus = useCanvasContextMenuState();
  const { contextMenuState, setContextMenuState, contextMenuContextRef, contextMenuHandleIdOverride } = contextMenus;
  const [equationModalTarget, setEquationModalTarget] = useState<EquationNodeTarget | null>(null);
  const [expandedDensePathSourceId, setExpandedDensePathSourceId] = useState<string | null>(null);
  const fitToContentModeActiveRef = useRef(fitToContentModeActive);
  const applyActionWithFeedbackRef = useRef<((
    action: EditAction,
    historyMergeKey?: string,
    sourceOverride?: string
  ) => ApplyActionFeedback) | null>(null);
  const clearPendingNodePositionTargetPick = useCallback(() => {
    suppressNodeAnchorClickRef.current = false;
    setPendingNodePositionTargetPick(null);
    setPendingNodePositionAnchorHoverSourceId(null);
    setNodeAnchorOverlay(null);
  }, []);
  const setFitToContentModeActive = useCallback(
    (active: boolean) => {
      fitToContentModeActiveRef.current = active;
      dispatch({ type: "SET_FIT_TO_CONTENT_MODE", active });
    },
    [dispatch]
  );
  const bucketPreviewSessionRef = useRef<BucketPreviewSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const accessibility = platform.accessibility;
    if (!accessibility) {
      setPrefersNonBlinkingTextInsertionIndicator(false);
      return () => {};
    }

    const prefersPromise = accessibility.prefersNonBlinkingTextInsertionIndicator?.();
    if (prefersPromise) {
      void prefersPromise
        .then((value) => {
          if (!cancelled && typeof value === "boolean") {
            setPrefersNonBlinkingTextInsertionIndicator(value);
          }
        })
        .catch(() => {});
    }

    const bindResult = accessibility.bindPrefersNonBlinkingTextInsertionIndicatorChange?.((value) => {
      if (!cancelled) {
        setPrefersNonBlinkingTextInsertionIndicator(value);
      }
    });
    if (bindResult) {
      void Promise.resolve(bindResult)
        .then((nextUnlisten) => {
          if (!cancelled) {
            unlisten = nextUnlisten ?? null;
          } else {
            nextUnlisten?.();
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [platform.accessibility]);
  /**
   * Nested figure mode (design doc, "Nested TikZ figure editing"): a
   * beamer document whose active root addresses an embedded tikzpicture
   * renders through the plain tikz pipeline over the masked snapshot; the
   * deck layers above are inert because `snapshot.deck` is null. Entry
   * and exit just swap the active root — viewport persistence gives the
   * figure its own auto-fit slot and restores the deck view on return.
   */
  const nestedFigureRef = useMemo(() => {
    const ref = activeRootId ? parseDocumentRootId(activeRootId) : null;
    return ref?.kind === "beamer-frame-tikz" ? ref : null;
  }, [activeRootId]);
  const isNestedFigureMode =
    nestedFigureRef != null && documentKind === "beamer" && snapshot.deck == null;
  /** The parsed picture's span while nested — the maskable region. */
  const nestedFigureSpan = useMemo(() => {
    if (!isNestedFigureMode) {
      return null;
    }
    const figure =
      snapshot.figures.find((candidate) => candidate.id === snapshot.activeRootId) ??
      (snapshot.figures.length > 0 ? snapshot.figures[0] : null);
    return figure?.span ?? null;
  }, [isNestedFigureMode, snapshot]);

  const editParseOptions = useMemo(
    () =>
      buildEditParseOptions({
        documentId: activeDocumentId,
        sourceRevision,
        // Nested figure edits parse the masked document (statement ids and
        // spans then match the snapshot's edit handles exactly) under the
        // snapshot's own tikz root id.
        source: nestedFigureSpan ? maskSourceOutsideSpan(source, nestedFigureSpan) : source,
        activeRootId: nestedFigureSpan ? snapshot.activeRootId : activeRootId,
        snapshot,
        analysis: "shared"
      }),
    [activeDocumentId, activeRootId, nestedFigureSpan, snapshot, source, sourceRevision]
  );

  const canvasCommandStateRef = useRef<{
    source: string;
    selectedElementIds: ReadonlySet<string>;
    sceneElements: readonly SceneElement[];
    viewBox: SvgViewBox | null;
    editParseOptions: typeof editParseOptions;
  } | null>(null);
  useLayoutEffect(() => {
    canvasCommandStateRef.current = {
      source,
      selectedElementIds,
      sceneElements: snapshot.scene?.elements ?? [],
      viewBox: svgResult?.viewBox ?? null,
      editParseOptions
    };
  });
  const dispatchCanvasTransform = useCallback(
    (transform: CanvasTransform) => {
      if (
        Math.abs(transform.translateX - canvasTransform.translateX) < 1e-9 &&
        Math.abs(transform.translateY - canvasTransform.translateY) < 1e-9 &&
        Math.abs(transform.scale - canvasTransform.scale) < 1e-9
      ) {
        return;
      }
      dispatch({ type: "SET_CANVAS_TRANSFORM", transform });
    },
    [canvasTransform.scale, canvasTransform.translateX, canvasTransform.translateY, dispatch]
  );

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const topRulerRef = useRef<SVGSVGElement | null>(null);
  const leftRulerRef = useRef<SVGSVGElement | null>(null);
  const interactionSvgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressNextBackgroundClickRef = useRef(false);
  const pathDraftRef = useRef<PathToolDraft | null>(null);
  const freehandDraftRef = useRef<FreehandToolDraft | null>(null);
  const previousCanvasContextKeyRef = useRef(rootKey(activeDocumentId, activeRootId));
  const pendingAddedSelectionRef = useRef<PendingAddedSelection | null>(null);
  const canvasTransformRef = useRef(canvasTransform);
  const selectedElementIdsRef = useRef(selectedElementIds);
  const svgResultRef = useRef(svgResult);
  const sourceBoundsSvgRef = useRef<SourceBoundsMap>(new Map<string, SvgBounds>());
  const liveResizeFramesRef = useRef(new Map<string, ReturnType<typeof resolveResizeFrameForSource>>());
  const previousViewBoxRef = useRef<SvgViewBox | null>(null);
  const guideDragRef = useRef<GuideDragState | null>(null);
  const textEngineRef = useRef<NodeTextEngine | null>(null);
  const svgLayerHostRef = useRef<HTMLDivElement | null>(null);
  const appliedPathAttachedNodePreviewRef = useRef<Array<{ element: SVGElement; transform: string | null }>>([]);

  useEffect(() => {
    for (const entry of appliedPathAttachedNodePreviewRef.current) {
      if (entry.transform == null) {
        entry.element.removeAttribute("transform");
      } else {
        entry.element.setAttribute("transform", entry.transform);
      }
    }
    appliedPathAttachedNodePreviewRef.current = [];

    if (!pathAttachedNodePreview) {
      return;
    }
    const host = svgLayerHostRef.current;
    if (!host) {
      return;
    }
    const selector = `[data-source-id='${pathAttachedNodePreview.sourceId.replace(/'/g, "\\'")}']`;
    const elements = Array.from(host.querySelectorAll<SVGElement>(selector));
    if (elements.length === 0) {
      return;
    }
    appliedPathAttachedNodePreviewRef.current = elements.map((element) => {
      const transform = element.getAttribute("transform");
      const previewTransform =
        `translate(${formatNumber(pathAttachedNodePreview.dx)} ${formatNumber(pathAttachedNodePreview.dy)})` +
        (transform ? ` ${transform}` : "");
      element.setAttribute("transform", previewTransform);
      return { element, transform };
    });
  }, [pathAttachedNodePreview, snapshot.source]);
  const pendingTouchViewportRef = useRef<PendingTouchViewport | null>(null);

  const dragTooltipVisible = dragTooltip != null;
  useLayoutEffect(() => {
    if (!dragTooltipVisible) {
      setDragTooltipBoundary(null);
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const rect = viewport.getBoundingClientRect();
    setDragTooltipBoundary({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }, [dragTooltipVisible]);

  const setActiveCanvasDragKind = useCallback(
    (kind: CanvasDragKind | null) => {
      dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind });
    },
    [dispatch]
  );

  const setDragState = useCallback(
    (next: DragState | null) => {
      if (next && "latestSource" in next) next.editSession = beginDocumentEdit(useEditorStore.getState());
      dragRef.current = next;
      if (!next) {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
      }
      setDragCursorLock(dragCursorForState(next));
      setActiveCanvasDragKind(canvasDragKindFromDragState(next));
    },
    [setActiveCanvasDragKind]
  );

  useEffect(() => {
    pathDraftRef.current = pathDraft;
  }, [pathDraft]);

  useLayoutEffect(() => {
    const nextContextKey = rootKey(activeDocumentId, activeRootId);
    if (previousCanvasContextKeyRef.current === nextContextKey) {
      return;
    }
    previousCanvasContextKeyRef.current = nextContextKey;

    pathDraftRef.current = null;
    freehandDraftRef.current = null;
    const pendingTouch = pendingTouchViewportRef.current;
    if (pendingTouch) {
      clearTimeout(pendingTouch.timer);
      pendingTouchViewportRef.current = null;
    }
    guideDragRef.current = null;
    document.body.classList.remove("is-dragging-guide-horizontal");
    document.body.classList.remove("is-dragging-guide-vertical");

    clearPendingNodePositionTargetPick();
    setPathDraft(null);
    setFreehandDraft(null);
    setPathSegmentDraft(null);
    setToolDraft(null);
    setBezierBendDraft(null);
    setPendingBezier(null);
    setMarqueeDraft(null);
    setMagnifierState(null);
    setPathAttachedNodePreview(null);
    setExpandedDensePathSourceId(null);
    setToolCursorWorld(null);
    setNodeAnchorOverlay(null);
    setSnapLines([]);
    setGuidePreview(null);
    setContextMenuState(null);
    setWarning(null);
    dispatch({ type: "SET_HOVERED_ELEMENT", id: null });
    if (dragRef.current) {
      setDragState(null);
    }
  }, [
    activeDocumentId,
    activeRootId,
    clearPendingNodePositionTargetPick,
    dispatch,
    setContextMenuState,
    setDragState
  ]);

  useEffect(() => {
    freehandDraftRef.current = freehandDraft;
  }, [freehandDraft]);

  const logSnapDebug = useCallback(
    (input: SnapDebugLogInput) => {
      if (!showDevPanel) {
        return;
      }

      const lines = input.lines ?? [];
      const nextSnapDebug = {
        atIso: new Date().toISOString(),
        phase: input.phase,
        note: input.note ?? null,
        snapshotMatchesSource: input.snapshotMatchesSource,
        dragKind: input.dragKind,
        rawPoint: toDebugPoint(input.rawPoint),
        rawDelta: toDebugPoint(input.rawDelta),
        snappedPoint: toDebugPoint(input.snappedPoint),
        snappedDelta: toDebugPoint(input.snappedDelta),
        offset: toDebugPoint(input.offset),
        context: summarizeSnapContextForDebug(input.context),
        lineCount: lines.length,
        lineSummary: summarizeSnapLinesForDebug(lines)
      };
      dispatch({
        type: "SET_SNAP_DEBUG",
        snapDebug: nextSnapDebug,
        log: {
          id: `snap:${nextSnapDebug.atIso}:${nextSnapDebug.phase}`,
          atIso: nextSnapDebug.atIso,
          source: "snap",
          level: input.note ? "warning" : "info",
          message: input.note ? `${input.phase}: ${input.note}` : input.phase,
          data: {
            dragKind: nextSnapDebug.dragKind,
            snapshotMatchesSource: nextSnapDebug.snapshotMatchesSource,
            lineCount: nextSnapDebug.lineCount,
            context: nextSnapDebug.context
          }
        }
      });
    },
    [dispatch, showDevPanel]
  );

  const performSnapHapticFeedback = useCallback(() => {
    if (!snapHapticsEnabled) {
      return;
    }
    if (!platform.id.startsWith("desktop")) {
      return;
    }
    if (!isMacLikePlatform()) {
      return;
    }
    void platform.haptics?.performSnapFeedback?.();
  }, [platform, snapHapticsEnabled]);

  useEffect(() => {
    let cancelled = false;
    void createTexNodeTextEngine()
      .then((engine) => {
        if (!cancelled) {
          textEngineRef.current = engine;
          setActiveTextEngine(engine);
        }
      })
      .catch(() => {
        if (!cancelled) {
          textEngineRef.current = null;
          setActiveTextEngine(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const densePathSourceIds = useMemo(() => {
    return collectDensePathSourceIds(snapshot.scene?.elements);
  }, [snapshot.scene]);

  const collapsedDensePathSourceIds = useMemo(() => {
    const collapsed = new Set<string>();
    if (toolMode !== "select") {
      return collapsed;
    }
    for (const sourceId of selectedElementIds) {
      if (densePathSourceIds.has(sourceId) && sourceId !== expandedDensePathSourceId) {
        collapsed.add(sourceId);
      }
    }
    return collapsed;
  }, [densePathSourceIds, expandedDensePathSourceId, selectedElementIds, toolMode]);

  const pathSelectionHint = useMemo(() => {
    if (
      warning != null ||
      toolMode !== "select" ||
      activeCanvasDragKind != null ||
      activeSourceScrubSourceId != null ||
      snapshot.source !== source
    ) {
      return null;
    }
    return resolvePathSelectionHint({
      source,
      selectedElementIds,
      editHandles: snapshot.editHandles,
      elements: snapshot.scene?.elements,
      collapsedDensePathSourceIds,
      parseOptions: editParseOptions
    });
  }, [
    activeCanvasDragKind,
    activeSourceScrubSourceId,
    collapsedDensePathSourceIds,
    editParseOptions,
    selectedElementIds,
    snapshot.editHandles,
    snapshot.scene,
    snapshot.source,
    source,
    toolMode,
    warning
  ]);

  const pendingNodePositionTargetAnchors = useMemo(
    () =>
      collectRelativePositionTargetAnchors({
        snapshot,
        sourceId: pendingNodePositionTargetPick?.nodeSourceId ?? null
      }),
    [pendingNodePositionTargetPick?.nodeSourceId, snapshot]
  );
  const pendingNodePositionEffectiveHoverSourceId = pendingNodePositionTargetPick
    ? pendingNodePositionAnchorHoverSourceId ?? hoveredElementId
    : null;
  const prepareEditGeometry = useCallback(() => {
    if (!snapshot.parseResult || !snapshot.semanticResult || snapshot.source !== source) return;
    return createEditGeometrySession({
      source: nestedFigureSpan ? maskSourceOutsideSpan(source, nestedFigureSpan) : source,
      parsed: snapshot.parseResult,
      semantic: snapshot.semanticResult
    }, { textEngine: textEngineRef.current }, editParseOptions);
  }, [snapshot, source, nestedFigureSpan, editParseOptions]);

  const resolvePendingNodePositionTargetStatus = useMemo(() => {
    if (!pendingNodePositionTargetPick) {
      return null;
    }
    const statusBySourceId = new Map<string, NodePositionTargetStatus>();
    const { sourceFingerprint } = editParseOptions;
    return (anchor: NodeAnchorTarget): NodePositionTargetStatus | null => {
      const targetSourceId = anchor.nodeSourceId?.trim();
      if (!targetSourceId) {
        return null;
      }
      const cached = statusBySourceId.get(targetSourceId);
      if (cached) {
        return cached;
      }
      const action: EditAction = {
        kind: "positionNodeRelativeTo",
        nodeId: pendingNodePositionTargetPick.nodeSourceId,
        targetNodeName: anchor.nodeName,
        targetNodeSourceId: targetSourceId
      };
      const preflight = preflightPositionNodeRelativeToAction(source, action, {
        geometry: prepareEditGeometry(),
        evaluateOptions: { sourceFingerprint, textEngine: activeTextEngine },
        parseOptions: { ...editParseOptions, propertyWriteMode: "drag-frame", sourceFingerprint }
      });
      const { result } = preflight;
      const status: NodePositionTargetStatus =
        result.kind === "success" || result.kind === "partial"
          ? {
              anchor,
              action,
              result,
              preview: preflight.preview,
              usable: true,
              reason: null
            }
          : {
              anchor,
              action,
              result,
              preview: null,
              usable: false,
              reason: formatNodePositionTargetFailureReason({
                rawReason: result.kind === "unsupported" ? result.reason : result.message,
                currentNodeSourceId: pendingNodePositionTargetPick.nodeSourceId,
                target: anchor,
                snapshot
              })
            };
      statusBySourceId.set(targetSourceId, status);
      return status;
    };
  }, [
    prepareEditGeometry,
    activeTextEngine,
    editParseOptions,
    pendingNodePositionTargetPick,
    snapshot,
    source
  ]);
  const pendingNodePositionTargetStatusBySourceId = useMemo(() => {
    const statusBySourceId = new Map<string, NodePositionTargetStatus>();
    if (!pendingNodePositionEffectiveHoverSourceId || !resolvePendingNodePositionTargetStatus) {
      return statusBySourceId;
    }
    const hoveredAnchor = pendingNodePositionTargetAnchors.find(
      (anchor) => anchor.nodeSourceId === pendingNodePositionEffectiveHoverSourceId
    );
    if (hoveredAnchor?.nodeSourceId) {
      const status = resolvePendingNodePositionTargetStatus(hoveredAnchor);
      if (status) {
        statusBySourceId.set(hoveredAnchor.nodeSourceId, status);
      }
    }
    return statusBySourceId;
  }, [
    pendingNodePositionEffectiveHoverSourceId,
    pendingNodePositionTargetAnchors,
    resolvePendingNodePositionTargetStatus
  ]);

  const pendingNodePositionHitRegionCursorByTargetId = useMemo(() => {
    if (!pendingNodePositionTargetPick) {
      return;
    }
    const cursorByTargetId = new Map<string, string>();
    for (const anchor of pendingNodePositionTargetAnchors) {
      if (anchor.nodeSourceId) {
        const status = pendingNodePositionTargetStatusBySourceId.get(anchor.nodeSourceId);
        cursorByTargetId.set(anchor.nodeSourceId, status?.usable === false ? "not-allowed" : "pointer");
      }
    }
    return cursorByTargetId;
  }, [
    pendingNodePositionTargetAnchors,
    pendingNodePositionTargetPick,
    pendingNodePositionTargetStatusBySourceId
  ]);

  const pendingNodePositionAnchorOverlay = useMemo<NodeAnchorOverlayState | null>(() => {
    if (!pendingNodePositionTargetPick || pendingNodePositionTargetAnchors.length === 0) {
      return null;
    }
    const hoveredStatus = pendingNodePositionEffectiveHoverSourceId
      ? pendingNodePositionTargetStatusBySourceId.get(pendingNodePositionEffectiveHoverSourceId)
      : null;
    const anchorStateBySourceId = new Map<string, { disabled?: boolean }>();
    for (const [sourceId, status] of pendingNodePositionTargetStatusBySourceId) {
      anchorStateBySourceId.set(sourceId, {
        disabled: !status.usable
      });
    }
    return {
      visibleAnchors: pendingNodePositionTargetAnchors,
      snappedAnchor: hoveredStatus?.usable ? hoveredStatus.anchor : null,
      anchorStateBySourceId,
      radiusScale: 1.45
    };
  }, [
    pendingNodePositionEffectiveHoverSourceId,
    pendingNodePositionTargetAnchors,
    pendingNodePositionTargetPick,
    pendingNodePositionTargetStatusBySourceId
  ]);

  useLayoutEffect(() => {
    if (!pendingNodePositionTargetPick || !pendingNodePositionEffectiveHoverSourceId || !svgResult) {
      setNodePositionTargetTooltip(null);
      return;
    }
    const status = pendingNodePositionTargetStatusBySourceId.get(pendingNodePositionEffectiveHoverSourceId);
    if (!status || status.usable || !status.reason) {
      setNodePositionTargetTooltip(null);
      return;
    }
    const viewportRect = viewportRef.current?.getBoundingClientRect();
    if (!viewportRect) {
      setNodePositionTargetTooltip(null);
      return;
    }
    const svg = worldToSvgPoint(status.anchor.world, svgResult.viewBox);
    setNodePositionTargetTooltip({
      content: status.reason,
      anchor: {
        x: viewportRect.left + canvasTransform.translateX + (svg.x - svgResult.viewBox.x) * canvasTransform.scale,
        y: viewportRect.top + canvasTransform.translateY + (svg.y - svgResult.viewBox.y) * canvasTransform.scale
      }
    });
  }, [
    canvasTransform.scale,
    canvasTransform.translateX,
    canvasTransform.translateY,
    pendingNodePositionEffectiveHoverSourceId,
    pendingNodePositionTargetPick,
    pendingNodePositionTargetStatusBySourceId,
    svgResult
  ]);

  const nodePositionLinks = useMemo<NodePositionLinkDisplay[]>(() => {
    const links: NodePositionLinkDisplay[] = [];
    for (const handle of snapshot.editHandles) {
      if (
        handle.handleType !== "node-positioning" ||
        !selectedElementIds.has(handle.sourceRef.sourceId)
      ) {
        continue;
      }
      const targetCenterAnchor = snapshot.semanticResult?.nodeAnchorTargets.find(
        (anchor) =>
          anchor.anchor === "center" &&
          anchor.nodeName === handle.positioningContext.targetNodeName
      );
      const endpoints = resolveNodePositionLinkEndpoints(
        handle.positioningContext,
        handle.positioningContext.direction
      );
      links.push({
        key: `selected:${handle.id}`,
        sourceId: handle.sourceRef.sourceId,
        targetSourceId: targetCenterAnchor?.nodeSourceId,
        from: endpoints.from,
        to: endpoints.to
      });
    }

    if (pendingNodePositionTargetPick && pendingNodePositionEffectiveHoverSourceId) {
      const status = pendingNodePositionTargetStatusBySourceId.get(pendingNodePositionEffectiveHoverSourceId);
      if (status?.usable && status.preview) {
        links.push({
          key: `pending:${pendingNodePositionTargetPick.nodeSourceId}:${status.anchor.nodeSourceId ?? status.anchor.nodeName}`,
          sourceId: pendingNodePositionTargetPick.nodeSourceId,
          targetSourceId: status.anchor.nodeSourceId,
          from: status.preview.currentAnchor,
          to: status.preview.targetAnchor
        });
      }
    }

    return links;
  }, [
    pendingNodePositionEffectiveHoverSourceId,
    pendingNodePositionTargetPick,
    pendingNodePositionTargetStatusBySourceId,
    selectedElementIds,
    snapshot
  ]);

  const nodePositionSelectionHint = pendingNodePositionTargetPick
    ? "Select a named node to position relative to. Esc cancels."
    : null;
  const canvasSelectionHint = nodePositionSelectionHint ?? pathSelectionHint;

  useEffect(() => {
    if (!pendingNodePositionTargetPick) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const isUndo =
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "z";
      if (event.key !== "Escape" && !isUndo) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      clearPendingNodePositionTargetPick();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => { window.removeEventListener("keydown", handleKeyDown, true); };
  }, [clearPendingNodePositionTargetPick, pendingNodePositionTargetPick]);

  useEffect(() => {
    dispatch({ type: "SET_CANVAS_STATUS_HINT", hint: canvasSelectionHint });
  }, [canvasSelectionHint, dispatch]);

  useEffect(() => {
    return () => {
      dispatch({ type: "SET_CANVAS_STATUS_HINT", hint: null });
    };
  }, [dispatch]);

  const {
    nodeAnchorTargets,
    matrixCellAnchorHints,
    dragCapability,
    directManipulationDisabledReasonBySourceId,
    draggableSourceIds,
    sceneTextByRegionKey,
    sourceBoundsSvg,
    matrixSelectionSourceIds,
    resizeFramesBySource,
    selectionBoxes,
    selectedAdornmentConnectors,
    adornmentHighlightBoxes,
    curveControlLines,
    marqueeBounds,
    handleDisplays,
    hitRegions: sceneHitRegions,
    visibleRanges,
    viewportWorldBounds,
    scopeOverlay
  } = useCanvasSelectionDerivedState({
    snapshot,
    selectedElementIds,
    collapsedDensePathSourceIds,
    svgResult,
    canvasTransform,
    marqueeDraft,
    toolMode,
    viewportSize,
    ROTATE_HANDLE_OFFSET_PX
  });

  // One editing session per Beamer edit scope: hit regions and targets are
  // grouped by the scope owning each directly-authored run, per
  // design/beamer-canvas-editing.md.
  const deckEditing = useMemo(() => {
    type DeckParagraph = NonNullable<typeof deckActiveFrame>["layout"]["paragraphs"][number];
    type DeckScopeEntry = {
      scope: NonNullable<typeof deckActiveFrame>["layout"]["editScopes"][number];
      scopeParagraphs: ScopeParagraphRef[];
      maskRanges: Span[];
      anchorBounds: SvgBounds | null;
    };
    const scopesById = new Map<string, DeckScopeEntry>();
    const paragraphById = new Map<string, DeckParagraph>();
    const regions: HitRegion[] = [];
    const atomSpanByRegionKey = new Map<string, Span>();
    const layout = deckActiveFrame?.layout;
    if (!layout) {
      return { scopesById, paragraphById, regions, atomSpanByRegionKey };
    }
    const editScopes = layout.editScopes ?? [];
    for (const scope of editScopes) {
      scopesById.set(scope.id, {
        scope,
        scopeParagraphs: [],
        maskRanges: [],
        anchorBounds: null
      });
    }
    for (const paragraph of layout.paragraphs) {
      paragraphById.set(paragraph.paragraphId, paragraph);
      // Chrome text (headline/footline) can mirror preamble metadata spans;
      // it never participates in editing sessions.
      if (paragraph.role === "headline" || paragraph.role === "footline") {
        continue;
      }
      const scope = resolveBeamerEditScopeAt(editScopes, paragraph.sourceSpan.from);
      if (!scope || paragraph.sourceSpan.to > scope.span.to) {
        continue;
      }
      const entry = scopesById.get(scope.id);
      if (!entry) {
        continue;
      }
      entry.scopeParagraphs.push({
        paragraphId: paragraph.paragraphId,
        sourceSpan: paragraph.sourceSpan,
        bounds: paragraph.bounds
      });
      entry.anchorBounds = entry.anchorBounds
        ? svgBounds(
            pt(Math.min(entry.anchorBounds.minX, paragraph.bounds.x)),
            pt(Math.min(entry.anchorBounds.minY, paragraph.bounds.y)),
            pt(Math.max(entry.anchorBounds.maxX, paragraph.bounds.x + paragraph.bounds.width)),
            pt(Math.max(entry.anchorBounds.maxY, paragraph.bounds.y + paragraph.bounds.height))
          )
        : svgBounds(
            pt(paragraph.bounds.x),
            pt(paragraph.bounds.y),
            pt(paragraph.bounds.x + paragraph.bounds.width),
            pt(paragraph.bounds.y + paragraph.bounds.height)
          );
      const pushRegion = (key: string, bounds: { x: number; y: number; width: number; height: number }) => {
        regions.push({
          shape: "rect",
          key,
          sourceId: scope.id,
          targetId: scope.id,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          cx: bounds.x + bounds.width / 2,
          cy: bounds.y + bounds.height / 2,
          rotation: 0,
          interactionMode: "text",
          pointerMode: "fill",
          sceneTextKey: paragraph.paragraphId,
          contentWidth: bounds.width,
          contentHeight: bounds.height
        });
      };
      for (const editable of paragraph.editableTextSpans) {
        // Math islands are click-into targets, but only structure-free
        // prose runs are safe to mask during edits.
        if (editable.kind === "text") {
          entry.maskRanges.push(editable.span);
        }
        editable.hitBounds.forEach((bounds, index) => {
          pushRegion(`deck-text:${editable.id}:${index}`, bounds);
        });
      }
      // Atomic renders (macro output) select their invocation span.
      for (const atom of paragraph.atomicRenderSpans ?? []) {
        atom.hitBounds.forEach((bounds, index) => {
          const key = `deck-atom:${atom.id}:${index}`;
          atomSpanByRegionKey.set(key, atom.span);
          pushRegion(key, bounds);
        });
      }
    }
    // Frame-level atoms: embedded tikzpictures and graphics select their
    // whole source span in the enclosing scope's session.
    const frameAtoms = [
      ...layout.embeddedTikz.map((tikz) => ({
        id: tikz.itemId,
        span: tikz.sourceSpan,
        bounds: tikz.bounds,
        visible: true
      })),
      ...layout.graphics.map((graphics) => ({
        id: graphics.itemId,
        span: graphics.sourceSpan,
        bounds: graphics.bounds,
        visible: graphics.visibility === "visible"
      }))
    ];
    for (const atom of frameAtoms) {
      if (!atom.visible) {
        continue;
      }
      const scope = resolveBeamerEditScopeAt(editScopes, atom.span.from);
      const entry = scope ? scopesById.get(scope.id) : undefined;
      if (!scope || !entry) {
        continue;
      }
      // Atom-only scopes (e.g. a drawing-only frame body) have no rendered
      // paragraphs; the atom itself anchors the session surface.
      const anchorParagraph = entry.scopeParagraphs[0]?.paragraphId;
      entry.anchorBounds ??= svgBounds(
        pt(atom.bounds.x),
        pt(atom.bounds.y),
        pt(atom.bounds.x + atom.bounds.width),
        pt(atom.bounds.y + atom.bounds.height)
      );
      const key = `deck-atom:${atom.id}`;
      atomSpanByRegionKey.set(key, atom.span);
      regions.push({
        shape: "rect",
        key,
        sourceId: scope.id,
        targetId: scope.id,
        x: atom.bounds.x,
        y: atom.bounds.y,
        width: atom.bounds.width,
        height: atom.bounds.height,
        cx: atom.bounds.x + atom.bounds.width / 2,
        cy: atom.bounds.y + atom.bounds.height / 2,
        rotation: 0,
        interactionMode: "text",
        pointerMode: "fill",
        ...(anchorParagraph ? { sceneTextKey: anchorParagraph } : {}),
        contentWidth: atom.bounds.width,
        contentHeight: atom.bounds.height
      });
    }
    return { scopesById, paragraphById, regions, atomSpanByRegionKey };
  }, [deckActiveFrame]);

  // Object-layer topology (design doc "Object layer"): selectable structural
  // nodes for the active frame. Built against the snapshot's own source so
  // node spans always match the rendered layout; object edits additionally
  // require the snapshot to be current (`snapshot.source === source`).
  const deckObjectIndex = useMemo(() => {
    const layout = deckActiveFrame?.layout;
    if (!layout) {
      return null;
    }
    return buildBeamerObjectIndex({
      items: layout.items,
      paragraphs: layout.paragraphs,
      source: snapshot.source
    });
  }, [deckActiveFrame, snapshot.source]);

  const deckSelectedObject = useMemo(() => {
    if (!deckObjectSelection || !deckObjectIndex || !deckActiveFrame) {
      return null;
    }
    if (
      deckObjectSelection.documentId !== activeDocumentId ||
      deckObjectSelection.frameId !== deckActiveFrame.frameId
    ) {
      return null;
    }
    return deckObjectIndex.byId.get(deckObjectSelection.objectId) ?? null;
  }, [activeDocumentId, deckActiveFrame, deckObjectIndex, deckObjectSelection]);

  const selectDeckObject = useCallback(
    (objectId: string | null) => {
      if (!deckActiveFrame || snapshot.source !== source) {
        return;
      }
      const placeholder = deckActiveFrame.layout.items.find((item) =>
        item.id === objectId && item.kind === "unsupported"
      );
      if (placeholder) {
        if (!useEditorStore.getState().showSourcePanel) {
          const dock = getDockLayoutHandle();
          if (dock) {
            dock.togglePanel("source");
          } else {
            dispatch({ type: "TOGGLE_PANEL", panel: "source" });
          }
        }
        // Clear first so clicking the same card triggers source selection again.
        dispatch({
          type: "SET_DECK_OBJECT_SELECTION",
          frameId: deckActiveFrame.frameId,
          objectId: null
        });
      }
      dispatch({
        type: "SET_DECK_OBJECT_SELECTION",
        frameId: deckActiveFrame.frameId,
        objectId
      });
    },
    [deckActiveFrame, dispatch, snapshot.source, source]
  );


  /**
   * Esc ladder rung 1 (session → object): select the innermost object
   * containing the caret when the session closes on Escape, and move
   * keyboard focus to the viewport for the remaining rungs.
   */
  const handleCanvasSessionEscape = useCallback(
    (session: TextEditingSession, caretDocumentOffset: number) => {
      if (deckObjectIndex && session.isScopeSession && snapshot.source === source) {
        const node = beamerObjectAtOffset(deckObjectIndex, caretDocumentOffset);
        if (node) {
          selectDeckObject(node.id);
        }
      }
      viewportRef.current?.focus({ preventScroll: true });
    },
    [deckObjectIndex, selectDeckObject, snapshot.source, source, viewportRef]
  );

  // Click targets for the object layer. Container chrome (blocks, columns)
  // sits UNDER the text regions — clicking text always yields a caret —
  // while non-text renders (graphics, embedded tikz, list markers) sit on
  // top and select their object.
  const deckObjectRegions = useMemo(() => {
    const under: HitRegion[] = [];
    const over: HitRegion[] = [];
    const layout = deckActiveFrame?.layout;
    if (!layout || !deckObjectIndex) {
      return { under, over };
    }
    const regionFor = (
      node: BeamerObjectNode,
      key: string,
      bounds: { x: number; y: number; width: number; height: number }
    ): HitRegion => ({
      shape: "rect",
      key,
      sourceId: node.id,
      targetId: node.id,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      cx: bounds.x + bounds.width / 2,
      cy: bounds.y + bounds.height / 2,
      rotation: 0,
      pointerMode: "fill",
      deckObjectId: node.id
    });
    for (const node of deckObjectIndex.nodes) {
      if (node.kind === "block" || node.kind === "columns" || node.kind === "column") {
        under.push(regionFor(node, `deck-object:${node.id}`, node.bounds));
      } else if (node.kind === "graphics" || node.kind === "tikzpicture" || node.kind === "unsupported") {
        over.push(regionFor(node, `deck-object:${node.id}`, node.bounds));
      }
    }
    for (const item of layout.items) {
      if (item.kind !== "list-marker" || item.visibility === "hidden") {
        continue;
      }
      const objectId = deckObjectIndex.objectIdByMarkerId.get(item.id);
      const node = objectId ? deckObjectIndex.byId.get(objectId) : undefined;
      if (!node) {
        continue;
      }
      over.push(regionFor(node, `deck-object-marker:${item.id}`, item.bounds));
    }
    return { under, over };
  }, [deckActiveFrame, deckObjectIndex]);

  const hitRegions = useMemo<HitRegion[]>(() => {
    if (!deckActiveFrame) {
      return sceneHitRegions;
    }
    return [
      ...sceneHitRegions,
      ...deckObjectRegions.under,
      ...deckEditing.regions,
      ...deckObjectRegions.over
    ];
  }, [deckActiveFrame, deckEditing, deckObjectRegions, sceneHitRegions]);

  // Rendered caret-stop domains for canvas-focus arrow motion, built lazily
  // per scope from the same layout the hit regions come from and cached
  // until the frame layout changes.
  const deckCaretDomainCache = useMemo(
    () => new Map<string, BeamerCaretDomain | null>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cache identity tracks the layout inputs
    [deckEditing, source]
  );
  const resolveDeckCaretDomain = useCallback((scopeId: string): BeamerCaretDomain | null => {
    const cached = deckCaretDomainCache.get(scopeId);
    if (cached !== undefined) {
      return cached;
    }
    const entry = deckEditing.scopesById.get(scopeId);
    if (!entry) {
      deckCaretDomainCache.set(scopeId, null);
      return null;
    }
    const paragraphs = entry.scopeParagraphs
      .map((ref) => deckEditing.paragraphById.get(ref.paragraphId))
      .filter((paragraph): paragraph is NonNullable<typeof paragraph> => paragraph != null);
    const domain = paragraphs.length
      ? buildBeamerCaretStopDomain({ paragraphs, source })
      : null;
    deckCaretDomainCache.set(scopeId, domain);
    return domain;
  }, [deckCaretDomainCache, deckEditing, source]);

  useLayoutEffect(() => {
    canvasTransformRef.current = canvasTransform;
    selectedElementIdsRef.current = selectedElementIds;
    svgResultRef.current = svgResult;
    fitToContentModeActiveRef.current = fitToContentModeActive;
    sourceBoundsSvgRef.current = sourceBoundsSvg;
    liveResizeFramesRef.current = resizeFramesBySource;
  });

  const {
    snapGuideInput,
    snapSettingsPatch,
    renderedGuides,
    rulers,
    gridLines,
    resolveGuideFromClient,
    isPointerOverGuideDeleteZone,
    onGuidePointerDown,
    onTopRulerPointerDown,
    onLeftRulerPointerDown
  } = useCanvasGuidesAndRulers({
    showGuides,
    guides,
    guidePreview,
    snapModes,
    gridMinorTargetPx,
    canvasTransform,
    svgResult,
    visibleRanges,
    showGrid,
    viewportRef,
    svgResultRef,
    canvasTransformRef,
    guideDragRef,
    setGuidePreview,
    LEFT_RULER_DRAG_SOURCE_WIDTH_PX
  });

  const { toolPreview } = useCanvasDerivedState({
    svgResult,
    toolMode,
    toolDraft,
    toolCursorWorld,
    selectedAddShape,
    freehandDraft,
    freehandSmoothingPx,
    pathDraft,
    pathSegmentDraft,
    pendingBezier,
    bezierBendDraft,
    canvasTransform
  });

  const { maxZoomScale } = useCanvasViewportPersistence({
    baseSvgResult,
    svgResult,
    viewportSize,
    dispatch,
    dispatchCanvasTransform,
    activeDocumentId,
    activeRootId,
    tabOrder,
    canvasTransform,
    fitToContentModeActive,
    fitToContentModeActiveRef,
    setFitToContentModeActive,
    viewportRef,
    canvasTransformRef,
    fitToContentRequestToken,
    zoomRequestToken,
    zoomRequestDirection,
    zoomScaleRequestToken,
    zoomScaleRequestValue,
    activeCanvasDragKind,
    activeSourceScrubSourceId,
    snapshotSource: snapshot.source,
    source,
    lastEditChangeToken,
    MIN_SCALE,
    MAX_SCALE
  });

  const copyWarningToClipboard = useCallback(() => {
    if (!warning) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }
    void navigator.clipboard.writeText(warning);
  }, [warning]);

  const onWarningBarKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      copyWarningToClipboard();
    },
    [copyWarningToClipboard]
  );

  const applyActionWithFeedback = useCallback(
    (action: EditAction, historyMergeKey?: string, sourceOverride?: string, geometry?: EditGeometrySession): ApplyActionFeedback => {
      const sourceForEdit = sourceOverride ?? source;
      const result = executeDocumentEdit({ documentId: activeDocumentId, source: sourceForEdit, sourceRevision, activeRootId, snapshot }, action, {
        geometry,
        parseOptions: { ...editParseOptions, propertyWriteMode: "drag-frame" },
        evaluateOptions: { textEngine: textEngineRef.current },
        nestedFigureSpan: nestedFigureSpan ? { from: nestedFigureSpan.from,
          to: nestedFigureSpan.to + (sourceForEdit.length - source.length) } : null
      });

      if (result.kind === "success" || result.kind === "partial") {
        if (result.kind === "partial") {
          const skippedCount = result.skippedHandles.length;
          setWarning(`${result.reason} (${skippedCount} handle${skippedCount === 1 ? "" : "s"} skipped)`);
        }

        const sourceChanged = result.newSource !== sourceForEdit;
        if (sourceChanged) {
          dispatch({
            type: "APPLY_EDIT_ACTION",
            action,
            historyMergeKey,
            precomputedSource: sourceForEdit,
            precomputedResult: result
          });
        }
        return { sourceChanged, newSource: sourceChanged ? result.newSource : undefined };
      }

      if (result.kind === "unsupported") {
        if (action.kind === "resizeElement" && result.reason === RESIZE_NOOP_REASON) {
          return { sourceChanged: false };
        }
        if (action.kind === "moveAdornment" && result.reason === ADORNMENT_EDIT_NOOP_REASON) {
          return { sourceChanged: false };
        }
        if (action.kind === "movePathAttachedNode" && result.reason === PATH_ATTACHED_NODE_EDIT_NOOP_REASON) {
          return { sourceChanged: false };
        }
        if (action.kind === "cleanupPropertyWrites" && result.reason === PROPERTY_WRITE_CLEANUP_NOOP_REASON) {
          return { sourceChanged: false };
        }
        setWarning(result.reason);
      } else {
        setWarning(result.message);
      }

      return { sourceChanged: false };
    },
    [activeDocumentId, activeRootId, dispatch, editParseOptions, nestedFigureSpan, source, sourceRevision, snapshot]
  );
  useLayoutEffect(() => {
    applyActionWithFeedbackRef.current = applyActionWithFeedback;
  });

  const queueSelectionForAddedElement = useCallback(
    (preferredWorld: WorldPoint, preferredSourceId?: string) => {
      const beforeIds = new Set<string>();
      for (const element of snapshot.scene?.elements ?? []) {
        beforeIds.add(element.sourceRef.sourceId);
      }
      pendingAddedSelectionRef.current = { beforeIds, preferredWorld, preferredSourceId };
    },
    [snapshot.scene]
  );

  const commitPathToolSegment = useCallback((segment: PathToolGestureSegment) => {
    setPathDraft((previousDraft) => {
      if (!previousDraft) {
        return previousDraft;
      }
      return appendPathToolSegmentFromGesture(previousDraft, segment);
    });
    setPathSegmentDraft(null);
    setToolCursorWorld(segment.endWorld);
  }, []);

  const undoTransientCanvasStep = useCallback(() => {
    const draft = pathDraftRef.current;
    if (draft) {
      const nextDraft = draft.segments.length > 0 ? undoLastPathToolSegment(draft) : null;
      pathDraftRef.current = nextDraft;
      setPathDraft(nextDraft);
      setPathSegmentDraft(null);
      setToolCursorWorld(nextDraft ? pathToolCurrentPoint(nextDraft) : null);
      setNodeAnchorOverlay(null);
      setSnapLines([]);
      if (dragRef.current?.kind === "tool-path-segment") {
        setDragState(null);
      }
      return true;
    }

    const activeDrag = dragRef.current;
    const hasBezierDraft =
      pendingBezier != null ||
      bezierBendDraft != null ||
      toolDraft?.toolMode === "addBezier" ||
      activeDrag?.kind === "tool-bezier-bend" ||
      (activeDrag?.kind === "tool-create" && activeDrag.toolMode === "addBezier");
    if (hasBezierDraft) {
      setPendingBezier(null);
      setBezierBendDraft(null);
      setToolDraft(null);
      setToolCursorWorld(null);
      setNodeAnchorOverlay(null);
      setSnapLines([]);
      if (
        activeDrag?.kind === "tool-bezier-bend" ||
        (activeDrag?.kind === "tool-create" && activeDrag.toolMode === "addBezier")
      ) {
        setDragState(null);
      }
      return true;
    }

    if (pendingNodePositionTargetPick) {
      clearPendingNodePositionTargetPick();
      setToolCursorWorld(null);
      setSnapLines([]);
      return true;
    }

    return false;
  }, [
    bezierBendDraft,
    clearPendingNodePositionTargetPick,
    pendingBezier,
    pendingNodePositionTargetPick,
    setDragState,
    toolDraft
  ]);

  const appendFreehandSamplePoint = useCallback((point: WorldPoint): WorldPoint[] | null => {
    let nextPoints: WorldPoint[] | null = null;
    setFreehandDraft((previousDraft) => {
      if (!previousDraft) {
        return previousDraft;
      }
      const nextDraft = appendFreehandToolPoint(previousDraft, point);
      nextPoints = nextDraft.points;
      return nextDraft;
    });
    return nextPoints;
  }, []);

  const finalizeFreehandDraft = useCallback((overridePoints?: WorldPoint[]) => {
    const baseDraft = freehandDraftRef.current;
    const draft =
      baseDraft && overridePoints
        ? {
            ...baseDraft,
            points: overridePoints.map((point) => ({ ...point }))
          }
        : baseDraft;
    setNodeAnchorOverlay(null);
    setSnapLines([]);
    if (dragRef.current?.kind === "tool-freehand") {
      setDragState(null);
    }

    if (!draft) {
      setFreehandDraft(null);
      setToolCursorWorld(null);
      dispatch({ type: "SET_TOOL_MODE", mode: "select" });
      return;
    }

    const snippet = generateFreehandToolSource(draft, canvasTransform.scale, freehandSmoothingPx, {
      strokeColor: creationStrokeColor
    });
    if (snippet) {
      const firstPoint = draft.points[0];
      const lastPoint = draft.points[draft.points.length - 1];
      queueSelectionForAddedElement(
        makeWorldPoint(
          pt((firstPoint.x + lastPoint.x) / 2),
          pt((firstPoint.y + lastPoint.y) / 2)
        )
      );
      const ok = applyActionWithFeedback({
        kind: "pasteStatements",
        snippets: [snippet],
        delta: makeWorldPoint(pt(0), pt(0))
      });
      if (!ok.sourceChanged) {
        pendingAddedSelectionRef.current = null;
      }
    } else {
      pendingAddedSelectionRef.current = null;
    }

    setFreehandDraft(null);
    setToolCursorWorld(null);
    dispatch({ type: "SET_TOOL_MODE", mode: "select" });
  }, [applyActionWithFeedback, canvasTransform.scale, creationStrokeColor, dispatch, freehandSmoothingPx, queueSelectionForAddedElement, setDragState]);

  const finalizePathDraft = useCallback(
    (closed: boolean) => {
      const draft = pathDraftRef.current;
      setPathSegmentDraft(null);
      setNodeAnchorOverlay(null);
      setSnapLines([]);
      if (dragRef.current?.kind === "tool-path-segment") {
        setDragState(null);
      }

      if (!draft || !pathToolHasDrawableSegments(draft)) {
        setPathDraft(null);
        setToolCursorWorld(null);
        dispatch({ type: "SET_TOOL_MODE", mode: "select" });
        return;
      }

      if (draft.appendTarget) {
        const segSource = generateAppendSegmentSource(draft);
        if (!segSource) {
          setPathDraft(null);
          setToolCursorWorld(null);
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          return;
        }
        const ok = applyActionWithFeedback({
          kind: "appendToPath",
          elementId: draft.appendTarget.elementId,
          end: draft.appendTarget.end,
          segmentSource: segSource
        });
        if (!ok.sourceChanged) {
          pendingAddedSelectionRef.current = null;
        }
      } else {
        const snippet = generatePathToolSource(draft, { closed, strokeColor: creationStrokeColor });
        if (!snippet) {
          setPathDraft(null);
          setToolCursorWorld(null);
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          return;
        }
        const ok = applyActionWithFeedback({
          kind: "pasteStatements",
          snippets: [snippet],
          delta: makeWorldPoint(pt(0), pt(0))
        });
        if (!ok.sourceChanged) {
          pendingAddedSelectionRef.current = null;
        }
      }

      setPathDraft(null);
      setToolCursorWorld(null);
      dispatch({ type: "SET_TOOL_MODE", mode: "select" });
    },
    [applyActionWithFeedback, creationStrokeColor, dispatch, setDragState]
  );

  

  const resolveEditableTextTarget = useCallback(
    (targetId: string, region: HitRegion | undefined): EditableTextTarget | null => {
      if (region?.shape !== "rect" || region.interactionMode === "move") {
        return null;
      }
      const deckScopeEntry = deckEditing.scopesById.get(targetId);
      if (deckScopeEntry) {
        const { scope } = deckScopeEntry;
        const text = source.slice(scope.span.from, scope.span.to);
        if (!text) {
          return null;
        }
        // Atom-only scopes (e.g. a drawing-only frame body) resolve without
        // a rendered paragraph: the session opens on the scope buffer with
        // the atom span selected, and there is no canvas caret geometry.
        const paragraph =
          (region.sceneTextKey
            ? deckEditing.paragraphById.get(region.sceneTextKey)
            : undefined) ??
          (deckScopeEntry.scopeParagraphs[0]
            ? deckEditing.paragraphById.get(deckScopeEntry.scopeParagraphs[0].paragraphId)
            : undefined);
        const layoutSourceText = paragraph
          ? source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to)
          : text;
        if (!layoutSourceText) {
          return null;
        }
        const firstTextSegment = paragraph?.report.lines
          .flatMap((line) => line.segments)
          .find((segment) =>
            (segment.kind === "text" || segment.kind === "space") &&
            segment.fontAtPt != null
          );
        const textAlign =
          paragraph?.report.alignment === "center"
            ? "center"
            : paragraph?.report.alignment === "ragged-left"
              ? "right"
              : paragraph?.report.alignment === "justified"
                ? "justify"
                : "left";
        return {
          sourceId: scope.id,
          sceneTextId: paragraph?.paragraphId ?? scope.id,
          sourceSpan: scope.span,
          text,
          structuralMaskRanges: deckScopeEntry.maskRanges,
          scopeParagraphs: deckScopeEntry.scopeParagraphs,
          atomicSelectionSpan: deckEditing.atomSpanByRegionKey.get(region.key),
          layoutSourceSpan: paragraph?.sourceSpan ?? scope.span,
          layoutSourceText,
          renderSourceText: layoutSourceText,
          usesTex: true,
          paragraphId: paragraph?.paragraphId ?? null,
          // Scope buffers always resolve carets through paragraph geometry;
          // the single-line estimate path assumes plain text.
          layoutKind: "wrapped",
          style: {
            fontSize: Number(firstTextSegment?.fontAtPt ?? 11),
            fontStyle: "normal",
            fontWeight: "normal",
            fontFamily: "sans",
            textAlign
          },
          totalWidth: paragraph?.bounds.width ?? region.width,
          region,
          editMode: "default",
          popupAnchorBox: deckScopeEntry.anchorBounds ?? undefined
        };
      }
      const sceneText = sceneTextByRegionKey.get(region.sceneTextKey ?? region.key);
      if (!sceneText) {
        return null;
      }
      let sourceSpan = sceneText.matrixCell?.textSpan ?? sceneText.textSourceSpan ?? sceneText.sourceRef.sourceSpan;
      let isForeachTemplateEdit = false;
      const foreachOrigin = sceneText.origin;
      if (
        snapshot.parseResult &&
        foreachOrigin &&
        foreachOrigin.foreachStack.length > 0 &&
        foreachOrigin.foreachTemplateLocalTargetId &&
        sceneText.sourceRef.sourceId.startsWith("foreach:")
      ) {
        const nestedLoopLocalIds = foreachOrigin.foreachStack.slice(1).map((frame) => frame.loopId);
        const templateTargetId = makeForeachTemplateTargetId(
          sceneText.sourceRef.sourceId,
          foreachOrigin.foreachTemplateLocalTargetId,
          nestedLoopLocalIds
        );
        const resolvedTemplate = resolvePropertyTargetFromParseResult(source, snapshot.parseResult, templateTargetId);
        if (
          resolvedTemplate.kind === "found" &&
          resolvedTemplate.target.textSpan &&
          resolvedTemplate.target.textSpan.to > resolvedTemplate.target.textSpan.from
        ) {
          sourceSpan = resolvedTemplate.target.textSpan;
          isForeachTemplateEdit = true;
        }
      }
      if (sourceSpan.to <= sourceSpan.from) {
        return null;
      }
      const sourceSlice = source.slice(sourceSpan.from, sourceSpan.to);
      if (sourceSlice.length === 0) {
        return null;
      }
      const textBlockWidth = sceneText.textBlockWidth ?? region.width;
      if (!(Number.isFinite(textBlockWidth) && textBlockWidth > 0)) {
        return null;
      }
      const popupAnchorWidth =
        sceneText.nodeVisualWidth != null && Number.isFinite(sceneText.nodeVisualWidth) && sceneText.nodeVisualWidth > 0
          ? sceneText.nodeVisualWidth
          : (region.contentWidth ?? region.width);
      const popupAnchorHeight =
        sceneText.nodeVisualHeight != null && Number.isFinite(sceneText.nodeVisualHeight) && sceneText.nodeVisualHeight > 0
          ? sceneText.nodeVisualHeight
          : (region.contentHeight ?? region.height);
      const preferredBounds =
        snapshot.scene && svgResult
          ? preferredNodeBoundsForSource(
              snapshot.scene.elements,
              targetId,
              svgResult.viewBox,
              sourceBoundsSvg.get(targetId) ?? null
            )
          : sourceBoundsSvg.get(targetId) ?? null;
      return {
        sourceId: targetId,
        sceneTextId: sceneText.id,
        sourceSpan,
        text: sourceSlice,
        renderSourceText:
          sceneText.textRenderInfo?.mode === "tex"
            ? sceneText.textRenderInfo.renderSourceText
            : sourceSlice,
        usesTex: sceneText.textRenderInfo?.mode === "tex",
        paragraphId:
          sceneText.textRenderInfo?.mode === "tex"
            ? sceneText.textRenderInfo.paragraphId
            : null,
        layoutKind:
          sceneText.textRenderInfo?.mode === "tex"
            ? sceneText.textRenderInfo.layoutKind
            : resolveFallbackTextLayoutKind(sourceSlice, sceneText.textHasFixedWidth, !!sceneText.matrixCell),
        style: sceneText.style,
        totalWidth: textBlockWidth,
        region,
        isForeachTemplateEdit,
        popupAnchorBox: preferredBounds
          ? svgBounds(pt(preferredBounds.minX), pt(preferredBounds.minY), pt(preferredBounds.maxX), pt(preferredBounds.maxY))
          : svgBounds(
              pt(region.cx - popupAnchorWidth / 2),
              pt(region.cy - popupAnchorHeight / 2),
              pt(region.cx + popupAnchorWidth / 2),
              pt(region.cy + popupAnchorHeight / 2)
            )
      };
    },
    [deckEditing, sceneTextByRegionKey, snapshot.parseResult, snapshot.scene, source, sourceBoundsSvg, svgResult]
  );

  const editableTextRegionKeys = useMemo(() => {
    const keys = new Set<string>();
    if (toolMode !== "select") {
      return keys;
    }
    for (const region of hitRegions) {
      if (region.shape === "rect" && region.interactionMode === "move") {
        continue;
      }
      if (resolveEditableTextTarget(region.targetId, region)) {
        keys.add(region.key);
      }
    }
    return keys;
  }, [hitRegions, resolveEditableTextTarget, toolMode]);

  const resolveEditableTextTargetById = useCallback(
    (targetId: string, preferredSceneTextId?: string | null): EditableTextTarget | null => {
      const candidates: EditableTextTarget[] = [];
      for (const region of rectHitRegionsForTargetId(hitRegions, targetId)) {
        const target = resolveEditableTextTarget(targetId, region);
        if (target) {
          candidates.push(target);
        }
      }
      if (candidates.length === 0) {
        return null;
      }
      if (preferredSceneTextId) {
        const preferred = candidates.find((candidate) => candidate.sceneTextId === preferredSceneTextId);
        if (preferred) {
          return preferred;
        }
      }
      return candidates[0] ?? null;
    },
    [hitRegions, resolveEditableTextTarget]
  );

  const {
    textEditingSession,
    textSelectionOverlay,
    view: canvasTextEditView,
    beginCanvasTextInteraction,
    closeTextEditingSession,
    requestAdornmentTextEdit,
    startTextEditingSession
  } = useCanvasTextEditSession({
    contextKey: rootKey(activeDocumentId, activeRootId),
    source,
    sourceRevision,
    snapshot,
    toolMode,
    selectedElementIds,
    canvasTransform,
    svgResult,
    viewportSize,
    sourceBoundsSvg,
    viewportRef,
    interactionSvgRef,
    svgLayerHostRef,
    suppressNextBackgroundClickRef,
    resolveEditableTextTargetById,
    resolveDeckCaretDomain,
    onCanvasSessionEscape: handleCanvasSessionEscape,
    textLayoutContext,
    textEditPlacement,
    dispatch
  });

  const enterNestedFigure = useCallback(
    (node: BeamerObjectNode): boolean => {
      if (node.kind !== "tikzpicture" || !node.rootId) {
        return false;
      }
      closeTextEditingSession();
      selectDeckObject(null);
      dispatch({ type: "SET_ACTIVE_ROOT", rootId: node.rootId });
      return true;
    },
    [closeTextEditingSession, dispatch, selectDeckObject]
  );

  const exitNestedFigure = useCallback(() => {
    if (!nestedFigureRef) {
      return;
    }
    closeTextEditingSession();
    dispatch({
      type: "SET_ACTIVE_ROOT",
      rootId: formatDocumentRootId({
        kind: "beamer-frame",
        index: nestedFigureRef.frameIndex
      })
    });
  }, [closeTextEditingSession, dispatch, nestedFigureRef]);

  const nestedFigureBreadcrumb = useMemo(
    () =>
      isNestedFigureMode && nestedFigureRef
        ? {
            slideLabel: `Slide ${nestedFigureRef.frameIndex + 1}`,
            figureLabel: `Figure ${nestedFigureRef.index + 1}`,
            onExit: exitNestedFigure
          }
        : null,
    [exitNestedFigure, isNestedFigureMode, nestedFigureRef]
  );

  /**
   * Enter/F2 drill-in: reopen a text session inside the selected object —
   * at its first rendered caret stop, with the whole atom span selected
   * for graphics — while embedded tikzpictures enter the nested figure
   * editor instead.
   */
  const openDeckObjectTextSession = useCallback(
    (node: BeamerObjectNode) => {
      if (node.kind === "unsupported") {
        selectDeckObject(node.id);
        return;
      }
      const layout = deckActiveFrame?.layout;
      if (!layout) {
        return;
      }
      const scope = resolveBeamerEditScopeAt(layout.editScopes ?? [], node.sourceSpan.from);
      if (!scope) {
        return;
      }
      const target = resolveEditableTextTargetById(scope.id);
      if (!target) {
        return;
      }
      const clampLocal = (offset: number): number =>
        Math.min(Math.max(offset - target.sourceSpan.from, 0), target.text.length);
      if (node.kind === "graphics" || node.kind === "tikzpicture") {
        startTextEditingSession(
          target,
          clampLocal(node.sourceSpan.from),
          clampLocal(node.sourceSpan.to)
        );
        return;
      }
      const domain = resolveDeckCaretDomain(scope.id);
      let offset =
        node.kind === "item" && node.listItem
          ? node.listItem.item.contentSpan.from
          : node.sourceSpan.from;
      const within = domain?.offsets.find(
        (candidate) => candidate >= offset && candidate <= node.sourceSpan.to
      );
      if (within != null) {
        offset = within;
      }
      const local = clampLocal(offset);
      startTextEditingSession(target, local, local);
    },
    [deckActiveFrame, resolveDeckCaretDomain, resolveEditableTextTargetById, selectDeckObject, startTextEditingSession]
  );

  // A duplicate's copy only exists after the frame re-renders; remember the
  // inserted span and reselect the object that appears inside it.
  const pendingDeckReselectRef = useRef<{
    frameId: string;
    kind: BeamerObjectNode["kind"];
    span: Span;
  } | null>(null);

  const applyDeckObjectEdit = useCallback(
    (mode: "delete" | "duplicate", node: BeamerObjectNode) => {
      if (!deckActiveFrame || !deckObjectIndex) {
        return;
      }
      if (snapshot.source !== source) {
        // The layout (and the object index derived from it) lags behind the
        // source; refuse rather than patch through stale spans. (The reducer
        // repeats this guard; failing silently here avoids a warning toast
        // for a keypress that raced a reconcile.)
        return;
      }
      if (mode === "duplicate") {
        // The action recomputes this patch deterministically; it is built
        // here only for the reselect span of the not-yet-rendered copy.
        const patch = beamerObjectDuplicationPatch(source, node);
        if (!patch || patch.edits.length === 0) {
          return;
        }
        if (patch.selectSpan) {
          pendingDeckReselectRef.current = {
            frameId: deckActiveFrame.frameId,
            kind: node.kind,
            span: patch.selectSpan
          };
        }
      }
      dispatch({
        type: "APPLY_EDIT_ACTION",
        action: {
          kind: mode === "delete" ? "deckDeleteObject" : "deckDuplicateObject",
          frameId: deckActiveFrame.frameId,
          objectId: node.id
        }
      });
      if (mode === "delete") {
        selectDeckObject(null);
      }
    },
    [deckActiveFrame, deckObjectIndex, dispatch, selectDeckObject, snapshot.source, source]
  );

  useEffect(() => {
    const pending = pendingDeckReselectRef.current;
    if (!pending || !deckObjectIndex || !deckActiveFrame) {
      return;
    }
    if (snapshot.source !== source || deckActiveFrame.frameId !== pending.frameId) {
      return;
    }
    pendingDeckReselectRef.current = null;
    // Items' topology spans run through the next `\item`/`\end` token, past
    // the inserted copy, so match on the span START falling inside it.
    const node = deckObjectIndex.nodes.find(
      (candidate) =>
        candidate.kind === pending.kind &&
        candidate.sourceSpan.from >= pending.span.from &&
        candidate.sourceSpan.from < pending.span.to
    );
    selectDeckObject(node ? node.id : null);
  }, [deckActiveFrame, deckObjectIndex, selectDeckObject, snapshot.source, source]);

  /**
   * Viewport keys while a deck object is selected: Esc walks up the parent
   * chain and finally clears, Enter/F2 drills back into text, Delete
   * removes the object, Cmd/Ctrl+D duplicates it.
   */
  const handleDeckObjectViewportKey = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): boolean => {
      if (!deckSelectedObject) {
        return false;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA"
      ) {
        return false;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        selectDeckObject(deckSelectedObject.parentId);
        return true;
      }
      if (event.key === "Enter" || event.key === "F2") {
        event.preventDefault();
        // Embedded tikzpictures enter the nested figure editor; other
        // objects (or a picture without a root id) drill into text.
        if (!enterNestedFigure(deckSelectedObject)) {
          openDeckObjectTextSession(deckSelectedObject);
        }
        return true;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        applyDeckObjectEdit("delete", deckSelectedObject);
        return true;
      }
      if (
        event.key.toLowerCase() === "d" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        applyDeckObjectEdit("duplicate", deckSelectedObject);
        return true;
      }
      return false;
    },
    [applyDeckObjectEdit, deckSelectedObject, enterNestedFigure, openDeckObjectTextSession, selectDeckObject]
  );

  const deckObjectSelectionBox = useMemo(() => {
    if (!deckSelectedObject) {
      return null;
    }
    const pad = 1.5;
    return {
      objectId: deckSelectedObject.id,
      kind: deckSelectedObject.kind,
      x: deckSelectedObject.bounds.x - pad,
      y: deckSelectedObject.bounds.y - pad,
      width: deckSelectedObject.bounds.width + pad * 2,
      height: deckSelectedObject.bounds.height + pad * 2
    };
  }, [deckSelectedObject]);

  const handleAddNodeAdornmentCommand = useCallback((kind: "label" | "pin") => {
    const state = canvasCommandStateRef.current;
    if (!state) {
      return;
    }
    const result = resolveNodeAdornmentContextAction({
      source: state.source,
      clickedTargetId: contextMenuContextRef.current.clickedTargetId,
      selectedTargetId: state.selectedElementIds.size === 1 ? [...state.selectedElementIds][0] ?? null : null,
      clickedWorld: contextMenuContextRef.current.clickedWorld,
      sceneElements: state.sceneElements,
      viewBox: state.viewBox,
      adornmentKind: kind,
      text: kind === "pin" ? "Pin" : "Label",
      parseOptions: state.editParseOptions
    });
    if (result.kind !== "ready") {
      return;
    }
    dispatch({
      type: "APPLY_EDIT_ACTION",
      action: result.action
    });
    requestAdornmentTextEdit(result.pendingTextTargetId);
  }, [contextMenuContextRef, dispatch, requestAdornmentTextEdit]);
  const handlePositionNodeRelativeToCommand = useCallback(() => {
    const state = canvasCommandStateRef.current;
    const selectedSourceId = state?.selectedElementIds.size === 1 ? [...state.selectedElementIds][0] ?? null : null;
    if (!selectedSourceId) {
      return;
    }
    closeTextEditingSession();
    clearPendingNodePositionTargetPick();
    setPendingNodePositionTargetPick({ nodeSourceId: selectedSourceId });
  }, [clearPendingNodePositionTargetPick, closeTextEditingSession]);
  const handleConvertNodePositionToAbsoluteCommand = useCallback(() => {
    const state = canvasCommandStateRef.current;
    const selectedSourceId = state?.selectedElementIds.size === 1 ? [...state.selectedElementIds][0] ?? null : null;
    const applyActionWithFeedback = applyActionWithFeedbackRef.current;
    if (!selectedSourceId || !applyActionWithFeedback) {
      return;
    }
    applyActionWithFeedback({
      kind: "convertNodePositionToAbsolute",
      nodeId: selectedSourceId
    });
    clearPendingNodePositionTargetPick();
  }, [clearPendingNodePositionTargetPick]);
  const handleOpenEditEquationCommand = useCallback((target: EquationNodeTarget) => {
    setEquationModalTarget(target);
  }, []);

  const commandRuntime = useEditorCommandRuntime({
    onAddNodeAdornment: handleAddNodeAdornmentCommand,
    onPositionNodeRelativeTo: handlePositionNodeRelativeToCommand,
    onConvertNodePositionToAbsolute: handleConvertNodePositionToAbsoluteCommand,
    onOpenEditEquation: handleOpenEditEquationCommand,
    activeHandleIdOverride: contextMenuHandleIdOverride
  });

  const handleNodePositionTargetPick = useCallback(
    (targetId: string): boolean => {
      if (!pendingNodePositionTargetPick) {
        return false;
      }
      const target = pendingNodePositionTargetAnchors.find((anchor) => anchor.nodeSourceId === targetId);
      if (!target?.nodeSourceId) {
        return true;
      }
      const status =
        pendingNodePositionTargetStatusBySourceId.get(target.nodeSourceId) ??
        resolvePendingNodePositionTargetStatus?.(target) ??
        null;
      if (status && !status.usable) {
        return true;
      }
      const action: EditAction = status?.action ?? {
        kind: "positionNodeRelativeTo",
        nodeId: pendingNodePositionTargetPick.nodeSourceId,
        targetNodeName: target.nodeName,
        targetNodeSourceId: target.nodeSourceId
      };
      if (status?.result.kind === "success" || status?.result.kind === "partial") {
        if (status.result.kind === "partial") {
          const skippedCount = status.result.skippedHandles.length;
          setWarning(`${status.result.reason} (${skippedCount} handle${skippedCount === 1 ? "" : "s"} skipped)`);
        }
        dispatch({
          type: "APPLY_EDIT_ACTION",
          action,
          precomputedSource: source,
          precomputedResult: status.result
        });
      } else {
        applyActionWithFeedback(action);
      }
      clearPendingNodePositionTargetPick();
      return true;
    },
    [
      applyActionWithFeedback,
      clearPendingNodePositionTargetPick,
      dispatch,
      pendingNodePositionTargetAnchors,
      pendingNodePositionTargetPick,
      pendingNodePositionTargetStatusBySourceId,
      resolvePendingNodePositionTargetStatus,
      source
    ]
  );

  const handleNodeAnchorPointerDown = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>, targetId: string) => {
      if (!handleNodePositionTargetPick(targetId)) {
        return;
      }
      suppressNodeAnchorClickRef.current = true;
      window.setTimeout(() => {
        suppressNodeAnchorClickRef.current = false;
      }, 0);
      event.preventDefault();
      event.stopPropagation();
      suppressNextBackgroundClickRef.current = true;
    },
    [handleNodePositionTargetPick, suppressNextBackgroundClickRef]
  );

  // Tauri/macOS can drop the first pointerdown after a native context menu closes.
  // Keep click as a fallback, but suppress it when pointerdown already handled the pick.
  const handleNodeAnchorClick = useCallback(
    (event: ReactMouseEvent<SVGCircleElement>, targetId: string) => {
      if (suppressNodeAnchorClickRef.current) {
        suppressNodeAnchorClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!handleNodePositionTargetPick(targetId)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      suppressNextBackgroundClickRef.current = true;
    },
    [handleNodePositionTargetPick, suppressNextBackgroundClickRef]
  );

  const { onElementPointerDown, onElementDoubleClick } = useCanvasElementInteractions({
    prepareEditGeometry,
    nestedFigureSpan,
    svgResult,
    toolMode,
    selectedElementIds,
    suppressNextBackgroundClickRef,
    viewportRef,
    beginCanvasTextInteraction,
    onDeckObjectSelect: selectDeckObject,
    onDeckObjectActivate: (objectId: string) => {
      const node = deckObjectIndex?.byId.get(objectId);
      if (!node || !enterNestedFigure(node)) {
        selectDeckObject(objectId);
      }
    },
    closeTextEditingSession,
    interactionSvgRef,
    dispatch,
    draggableSourceIds,
    directManipulationDisabledReasonBySourceId,
    snapshot,
    source,
    setWarning,
    onBucketFillRegion: (region: HitRegion | undefined) => {
      const resolution = resolveBucketFillEdit({
        sourceId: region?.sourceId ?? "",
        colorToken: bucketFillColor,
        source: bucketPreviewSessionRef.current?.baseSource ?? source,
        elements: snapshot.scene?.elements ?? [],
        editHandles: snapshot.editHandles,
        activeRootId,
        figureCount: snapshot.figures.length,
        propertyWriteMode: "commit"
      });

      if (resolution.kind !== "ready") {
        if (resolution.reason !== "setProperty would not change the source.") {
          setWarning(resolution.reason ?? "This item cannot be filled.");
        }
        return;
      }

      if (resolution.result.kind === "partial") {
        const skippedCount = resolution.result.skippedHandles.length;
        setWarning(`${resolution.result.reason} (${skippedCount} handle${skippedCount === 1 ? "" : "s"} skipped)`);
      }

      dispatch({
        type: "APPLY_EDIT_ACTION",
        action: resolution.action,
        precomputedResult: resolution.result
      });
      bucketPreviewSessionRef.current = null;
    },
    setSnapLines,
    logSnapDebug,
    snapGuideInput,
    snapSettingsPatch,
    canvasTransform,
    viewportWorldBounds,
    setDragState,
    resolveEditableTextTarget,
    densePathSourceIds,
    expandedDensePathSourceId,
    setExpandedDensePathSourceId,
    scopeOverlay,
    focusedScopeId,
    applyActionWithFeedback,
    activeRootId,
    parseOptions: editParseOptions,
    onNodePositionTargetPick: handleNodePositionTargetPick
  });

  const {
    onHandlePointerDown,
    onResizeHandlePointerDown,
    onRotateHandlePointerDown
  } = useCanvasHandleInteractions({
    scopeOverlay,
    prepareEditGeometry,
    nodeAnchorTargets,
    matrixCellAnchorHints,
    svgResult,
    toolMode,
    viewportRef,
    dispatch,
    closeTextEditingSession,
    setNodeAnchorOverlay,
    selectedElementIds,
    dragCapability,
    directManipulationDisabledReasonBySourceId,
    snapshot,
    source,
    nestedFigureSpan,
    parseOptions: editParseOptions,
    setWarning,
    setSnapLines,
    logSnapDebug,
    snapGuideInput,
    snapSettingsPatch,
    canvasTransform,
    viewportWorldBounds,
    resizeFramesBySource,
    setDragState,
    interactionSvgRef
  });

  const resolveWorldFromViewportClient = useCallback(
    (clientPoint: ClientPoint): WorldPoint | null => {
      if (!svgResult) {
        return null;
      }
      const viewport = viewportRef.current;
      if (!viewport) {
        return null;
      }
      return viewportToWorldPoint(
        viewportPointFromClient(clientPoint, viewport),
        canvasTransform,
        svgResult.viewBox
      );
    },
    [canvasTransform, svgResult]
  );

  const startMarqueeSelection = useCallback(
    (pointerId: number, clientPoint: ClientPoint, additiveSelection: boolean): boolean => {
      const world = resolveWorldFromViewportClient(clientPoint);
      if (!world) {
        if (!additiveSelection) {
          dispatch({ type: "CLEAR_SELECTION" });
        }
        return false;
      }

      if (
        !additiveSelection &&
        svgResult &&
        focusedScopeId != null &&
        !isSvgPointWithinScopeBounds(focusedScopeId, worldToSvgPoint(world, svgResult.viewBox), scopeOverlay)
      ) {
        dispatch({ type: "SET_FOCUSED_SCOPE", scopeId: null });
      }

      dispatch({ type: "SET_HOVERED_ELEMENT", id: null });
      const nextMarquee: Extract<DragState, { kind: "marquee" }> = {
        kind: "marquee",
        pointerId,
        startWorld: world,
        currentWorld: world,
        additive: additiveSelection,
        baseSelectedIds: additiveSelection ? [...selectedElementIds] : []
      };
      setDragState(nextMarquee);
      setMarqueeDraft(nextMarquee);
      setSnapLines([]);
      logSnapDebug({
        phase: "marquee-start",
        snapshotMatchesSource: snapshot.source === source,
        dragKind: "marquee",
        rawPoint: world,
        lines: []
      });
      return true;
    },
    [
      dispatch,
      focusedScopeId,
      logSnapDebug,
      resolveWorldFromViewportClient,
      selectedElementIds,
      svgResult,
      setDragState,
      scopeOverlay,
      snapshot.source,
      source
    ]
  );

  const { openCanvasContextMenuAt } = useCanvasContextMenuController({
    state: contextMenus,
    platform,
    commandBindings: commandRuntime.bindings,
    source,
    snapshot,
    toolMode,
    selectedElementIds,
    focusedScopeId,
    scopeOverlay,
    svgResult,
    canvasTransform,
    editParseOptions,
    viewportRef,
    dispatch
  });

  const deckOverlayMenu = useDeckOverlayContextMenu({
    index: deckObjectIndex, selected: deckSelectedObject, frame: deckActiveFrame,
    viewportRef, svgRef: interactionSvgRef, bindings: commandRuntime.bindings,
    closeText: closeTextEditingSession, editObject: applyDeckObjectEdit,
  });

  const { onElementContextMenu, onCanvasContextMenu } = useCanvasSelectionInteractions({
    openCanvasContextMenuAt,
    closeTextEditingSession,
    selectedElementIds,
    scopeOverlay,
    focusedScopeId,
    snapshot,
    svgResult,
    interactionSvgRef,
    canvasTransform
  });

  const {
    onBackgroundClick,
    onViewportPointerDown,
    onViewportPointerUp,
    onInteractionPointerDown,
    onInteractionPointerUp,
    onInteractionLostPointerCapture,
    onInteractionPointerMove,
    onInteractionPointerLeave,
    onInteractionPointerEnter
  } = useCanvasToolInteractions({
    viewportRef,
    toolMode,
    closeTextEditingSession,
    startMarqueeSelection,
    pendingTouchViewportRef,
    suppressNextBackgroundClickRef,
    svgResult,
    setDragState,
    canvasTransform,
    interactionSvgRef,
    pendingBezier,
    snapshot,
    source,
    setWarning,
    setSnapLines,
    setDragTooltip,
    logSnapDebug,
    snapGuideInput,
    snapSettingsPatch,
    viewportWorldBounds,
    nodeAnchorTargets,
    matrixCellAnchorHints,
    toolCursorWorld,
    setToolCursorWorld,
    setPathDraft,
    setPathSegmentDraft,
    setToolDraft,
    setBezierBendDraft,
    setPendingBezier,
    setNodeAnchorOverlay,
    setFreehandDraft,
    setMagnifierState,
    setDragCursorLock,
    pathDraftRef,
    finalizePathDraft,
    queueSelectionForAddedElement,
    applyActionWithFeedback,
    pendingAddedSelectionRef,
    dispatch,
    selectedAddMatrixRows,
    selectedAddMatrixColumns,
    creationStrokeColor,
    pathDraft,
    pathSegmentDraft,
    dragRef,
    toolDraft,
    bezierBendDraft,
    freehandDraft,
    parseOptions: editParseOptions,
    magnifierState
  });

  const handleBackgroundClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement | SVGSVGElement>) => {
      if (pendingNodePositionTargetPick && event.target === event.currentTarget) {
        event.preventDefault();
        clearPendingNodePositionTargetPick();
        return;
      }
      // Clear the deck object selection only for genuine background clicks:
      // the handler fires on both the interaction svg and the viewport, and
      // clicks on hit regions bubble here with a mismatched target (their
      // suppression ref is consumed by the first of the two invocations).
      if (
        deckSelectedObject &&
        event.target === event.currentTarget &&
        !suppressNextBackgroundClickRef.current
      ) {
        selectDeckObject(null);
      }
      onBackgroundClick(event);
    },
    [
      clearPendingNodePositionTargetPick,
      deckSelectedObject,
      onBackgroundClick,
      pendingNodePositionTargetPick,
      selectDeckObject,
      suppressNextBackgroundClickRef
    ]
  );

  const {
    onViewportKeyDown,
    onViewportPaste,
    onViewportDragOver,
    onViewportDrop,
    onViewportCopy,
    onViewportCut
  } = useCanvasKeyboardClipboard({
    contextMenuState,
    setContextMenuState,
    toolMode,
    finalizePathDraft,
    undoTransientCanvasStep,
    setWarning,
    setFreehandDraft,
    dragRef,
    setDragState,
    dispatch,
    setToolCursorWorld,
    setSnapLines,
    setToolDraft,
    setBezierBendDraft,
    setPendingBezier,
    textEditingSession,
    closeTextEditingSession,
    setMarqueeDraft,
    selectedElementIds,
    applyActionWithFeedback,
    snapshot,
    source,
    logSnapDebug,
    NUDGE_STEP_PT,
    NUDGE_STEP_SHIFT_PT,
    platform,
    DESKTOP_TIKZ_CLIPBOARD_FORMATS,
    DESKTOP_SVG_CLIPBOARD_FORMATS,
    DESKTOP_KEYNOTE_CLIPBOARD_FORMATS,
    DESKTOP_POWERPOINT_GVML_CLIPBOARD_FORMATS,
    computeAutoScaleForImportedTikz
  });

  useCanvasViewportEffects({
    dragRef,
    pendingTouchViewportRef,
    setDragState,
    setToolDraft,
    setToolCursorWorld,
    viewportRef,
    setViewportSize,
    canvasTransformRef,
    svgResult,
    svgResultRef,
    fitToContentModeActiveRef,
    previousViewBoxRef,
    dispatchCanvasTransform,
    zoomSpeed,
    MIN_SCALE,
    MAX_SCALE: maxZoomScale,
    setFitToContentModeActive
  });

  useCanvasGuideEffects({
    guideDragRef,
    setGuidePreview,
    resolveGuideFromClient,
    isPointerOverGuideDeleteZone,
    setGuides,
    showGuides
  });

  useBucketFillPreview({
    toolMode,
    hoveredElementId,
    bucketFillColor,
    source,
    snapshot,
    activeDocumentId,
    activeRootId,
    dispatch,
    bucketPreviewSessionRef
  });

  useEffect(() => {
    if (!lastEditWarningMessage) {
      return;
    }
    setWarning(lastEditWarningMessage);
  }, [lastEditWarningMessage, lastEditWarningToken]);

  useEffect(() => {
    if (!warning) return;

    const timer = window.setTimeout(() => { setWarning(null); }, 3200);
    return () => { window.clearTimeout(timer); };
  }, [warning]);

  useEffect(() => {
    if (toolMode === "magnify") {
      return;
    }
    if (magnifierState != null) {
      setMagnifierState(null);
    }
    if (dragCursorLock === "none") {
      setDragCursorLock(null);
    }
  }, [dragCursorLock, magnifierState, setDragCursorLock, setMagnifierState, toolMode]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const body = document.body;
    body.classList.remove(CANVAS_DRAG_CURSOR_LOCK_CLASS);
    body.style.removeProperty("--canvas-drag-cursor");

    if (!dragCursorLock) {
      return;
    }

    body.classList.add(CANVAS_DRAG_CURSOR_LOCK_CLASS);
    body.style.setProperty("--canvas-drag-cursor", dragCursorLock);
    return () => {
      body.classList.remove(CANVAS_DRAG_CURSOR_LOCK_CLASS);
      body.style.removeProperty("--canvas-drag-cursor");
    };
  }, [dragCursorLock]);

  useEffect(() => {
    if (snapshot.source === source) {
      return;
    }
    // Source changes caused by an active drag's own applies must not wipe the
    // overlay (the next pointermove overwrites it anyway); only external edits
    // invalidate the lines.
    if (dragRef.current) {
      return;
    }
    setSnapLines([]);
  }, [snapshot.source, source]);

  const dragAffectedSourceIds = useCanvasSvgPatchInvalidation({
    activeCanvasDragKind,
    dragPatchMode,
    setDragPatchMode,
    lastEditChangeToken,
    lastEditChangedSourceIds,
    selectedElementIds,
    snapshot
  });

  useEffect(() => {
    if (toolMode !== "select") {
      setExpandedDensePathSourceId(null);
      return;
    }
    setExpandedDensePathSourceId((current) => {
      if (!current) {
        return current;
      }
      if (!selectedElementIds.has(current)) {
        return null;
      }
      if (!densePathSourceIds.has(current)) {
        return null;
      }
      return current;
    });
  }, [densePathSourceIds, selectedElementIds, toolMode]);

  useEffect(() => {
    if (toolMode === "select") {
      setPathDraft(null);
      setFreehandDraft(null);
      setPathSegmentDraft(null);
      setToolDraft(null);
      setBezierBendDraft(null);
      setPendingBezier(null);
      setToolCursorWorld(null);
      setSnapLines([]);
      if (
        dragRef.current?.kind === "tool-create" ||
        dragRef.current?.kind === "tool-bezier-bend" ||
        dragRef.current?.kind === "tool-path-segment" ||
        dragRef.current?.kind === "tool-freehand"
      ) {
        setDragState(null);
      }
      return;
    }

    if (toolMode !== "addPath") {
      setPathDraft(null);
      setPathSegmentDraft(null);
      if (dragRef.current?.kind === "tool-path-segment") {
        setDragState(null);
      }
    }

    if (toolMode !== "addFreehand") {
      setFreehandDraft(null);
      if (dragRef.current?.kind === "tool-freehand") {
        setDragState(null);
      }
    }

    if (toolMode !== "addBezier") {
      setPendingBezier(null);
      setBezierBendDraft(null);
      if (dragRef.current?.kind === "tool-bezier-bend") {
        setDragState(null);
      }
    }

    closeTextEditingSession();
    if (dragRef.current?.kind === "marquee") {
      setDragState(null);
      setMarqueeDraft(null);
    }
  }, [closeTextEditingSession, setDragState, toolMode]);

  useEffect(() => {
    const pending = pendingAddedSelectionRef.current;
    if (!pending) {
      return;
    }
    if (snapshot.source !== source) {
      return;
    }

    const sceneElements = snapshot.scene?.elements ?? [];
    const newSourceIds = collectNewSourceIds(sceneElements, pending.beforeIds);
    pendingAddedSelectionRef.current = null;
    if (newSourceIds.length === 0) {
      return;
    }

    let inferredMatrixSourceId: string | null = null;
    for (const sourceId of newSourceIds) {
      const marker = ":matrix-cell:";
      const markerIndex = sourceId.indexOf(marker);
      if (markerIndex <= 0) {
        continue;
      }
      const parentId = sourceId.slice(0, markerIndex);
      if (newSourceIds.includes(parentId)) {
        inferredMatrixSourceId = parentId;
        break;
      }
    }

    const selectedId = pending.preferredSourceId && newSourceIds.includes(pending.preferredSourceId)
      ? pending.preferredSourceId
      : inferredMatrixSourceId ?? (
          newSourceIds.length === 1
            ? newSourceIds[0]
            : pickClosestSourceId(sceneElements, newSourceIds, pending.preferredWorld)
        );

    dispatch({ type: "SELECT", id: selectedId, additive: false });
  }, [dispatch, snapshot.scene, snapshot.source, source]);

  const schedulePropertyCleanup = useCallback<SchedulePropertyCleanup>((cleanupSource, elementIds, historyMergeKey) => {
    dispatch({ type: "QUEUE_PROPERTY_CLEANUP", documentId: activeDocumentId, historyMergeKey,
      task: { source: cleanupSource, elementIds, activeFigureId: editParseOptions.activeFigureId,
        nestedFigureSpan: nestedFigureSpan ? { from: nestedFigureSpan.from, to: nestedFigureSpan.to + cleanupSource.length - source.length } : null }
    });
  }, [activeDocumentId, dispatch, editParseOptions.activeFigureId, nestedFigureSpan, source.length]);
  const dragControllerConfig = useMemo(() => ({
    schedulePropertyCleanup,
    applyActionWithFeedback,
    dispatch,
    dispatchCanvasTransform,
    logSnapDebug,
    queueSelectionForAddedElement,
    snapshotSource: snapshot.source,
    snapshotScene: snapshot.scene,
    snapshotEditHandles: snapshot.editHandles,
    nodeAnchorTargets,
    matrixCellAnchorHints,
    source,
    svgResult,
    dragRef,
    suppressNextBackgroundClickRef,
    svgResultRef,
    interactionSvgRef,
    liveResizeFramesRef,
    selectedElementIdsRef,
    sourceBoundsSvgRef,
    scopeOverlay,
    pendingAddedSelectionRef,
    setDragState,
    setSnapLines,
    setToolDraft,
    setBezierBendDraft,
    setPathSegmentDraft,
    commitPathToolSegment,
    appendFreehandSamplePoint,
    finalizeFreehandDraft,
    setPendingBezier,
    setToolCursorWorld,
    setMarqueeDraft,
    setNodeAnchorOverlay,
    setDragTooltip,
    setWarning,
    setPathAttachedNodePreview,
    selectedAddShape,
    creationStrokeColor,
    creationFillColor,
    onSnapFeedback: performSnapHapticFeedback
  }), [
    schedulePropertyCleanup,
    applyActionWithFeedback,
    appendFreehandSamplePoint,
    commitPathToolSegment,
    creationFillColor,
    creationStrokeColor,
    dispatch,
    dispatchCanvasTransform,
    dragRef,
    finalizeFreehandDraft,
    interactionSvgRef,
    liveResizeFramesRef,
    logSnapDebug,
    matrixCellAnchorHints,
    nodeAnchorTargets,
    pendingAddedSelectionRef,
    performSnapHapticFeedback,
    queueSelectionForAddedElement,
    scopeOverlay,
    selectedAddShape,
    selectedElementIdsRef,
    setBezierBendDraft,
    setDragState,
    setDragTooltip,
    setMarqueeDraft,
    setNodeAnchorOverlay,
    setPathAttachedNodePreview,
    setPathSegmentDraft,
    setPendingBezier,
    setSnapLines,
    setToolCursorWorld,
    setToolDraft,
    setWarning,
    snapshot.editHandles,
    snapshot.scene,
    snapshot.source,
    source,
    sourceBoundsSvgRef,
    suppressNextBackgroundClickRef,
    svgResult,
    svgResultRef
  ]);

  useCanvasDragController(dragControllerConfig);

  useEffect(() => () => { setActiveCanvasDragKind(null); }, [setActiveCanvasDragKind]);

  useEffect(() => {
    if (activeCanvasDragKind == null) {
      setPathAttachedNodePreview(null);
    }
  }, [activeCanvasDragKind]);

  const svgDiffHints = useMemo<SvgDiffHints | undefined>(() => {
    if (!activeCanvasDragKind || dragPatchMode !== "partial") {
      return;
    }
    if (!dragAffectedSourceIds || dragAffectedSourceIds.length === 0) {
      return;
    }
    return {
      affectedSourceIds: dragAffectedSourceIds
    };
  }, [activeCanvasDragKind, dragAffectedSourceIds, dragPatchMode]);

  const forceSvgReplaceAll = activeCanvasDragKind != null && dragPatchMode === "full";

  const onSvgPatchFallback = useCallback(
    (reason: "replaceDefs" | "replaceAll" | "patch-failure") => {
      if (!activeCanvasDragKind) {
        return;
      }
      recordDragPatchModeFullReason("svg-patch-fallback", {
        activeCanvasDragKind,
        reason
      });
      setDragPatchMode("full");
      if (reason === "patch-failure") {
        setWarning("SVG patching invariant failed; using full updates for this drag.");
      }
    },
    [activeCanvasDragKind]
  );

  const handleHalfSize = (handleSizePx / 2) / Math.max(canvasTransform.scale, 1e-3);
  const handleStrokeWidth = 1.2 / Math.max(canvasTransform.scale, 1e-3);
  const curveControlStrokeWidth = 1.1 / Math.max(canvasTransform.scale, 1e-3);
  const selectionStrokeWidth = 1.1 / Math.max(canvasTransform.scale, 1e-3);
  const selectionDragStrokeWidth = 12 / Math.max(canvasTransform.scale, 1e-3);
  const gridMinorStrokeWidth = 0.6 / Math.max(canvasTransform.scale, 1e-3);
  const gridMajorStrokeWidth = 0.9 / Math.max(canvasTransform.scale, 1e-3);
  const gridAxisStrokeWidth = 1.1 / Math.max(canvasTransform.scale, 1e-3);
  const guideStrokeWidth = 1 / Math.max(canvasTransform.scale, 1e-3);
  const guideHitStrokeWidth = 12 / Math.max(canvasTransform.scale, 1e-3);
  const snapStrokeWidth = 1 / Math.max(canvasTransform.scale, 1e-3);
  const snapCrossSize = 3 / Math.max(canvasTransform.scale, 1e-3);
  const snapSourceNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const target of snapshot.semanticResult?.nodeAnchorTargets ?? []) {
      if (target.nodeSourceId && !names.has(target.nodeSourceId)) {
        names.set(target.nodeSourceId, target.nodeName);
      }
    }
    return names;
  }, [snapshot.semanticResult?.nodeAnchorTargets]);
  const contextMenuDefinition = useMemo(
    () =>
      buildCanvasContextMenuDefinition({
        includeEditEquationForSingleNode: contextMenuState?.includeEditEquationForSingleNode ?? false,
        nodePositioningAction: contextMenuState?.nodePositioningAction ?? null,
        includePathSubmenuForSingleSelection: contextMenuState?.includePathSubmenuForSingleSelection ?? false,
        includeFlattenForeach: contextMenuState?.includeFlattenForeach ?? false,
        includeMatrixMultiInsertRowAbove: contextMenuState?.includeMatrixMultiInsertRowAbove ?? false,
        includeMatrixMultiInsertRowBelow: contextMenuState?.includeMatrixMultiInsertRowBelow ?? false,
        includeMatrixMultiRemoveRow: contextMenuState?.includeMatrixMultiRemoveRow ?? false,
        includeMatrixMultiInsertColumnLeft: contextMenuState?.includeMatrixMultiInsertColumnLeft ?? false,
        includeMatrixMultiInsertColumnRight: contextMenuState?.includeMatrixMultiInsertColumnRight ?? false,
        includeMatrixMultiRemoveColumn: contextMenuState?.includeMatrixMultiRemoveColumn ?? false
      }),
    [
      contextMenuState?.includeEditEquationForSingleNode,
      contextMenuState?.nodePositioningAction,
      contextMenuState?.includePathSubmenuForSingleSelection,
      contextMenuState?.includeFlattenForeach,
      contextMenuState?.includeMatrixMultiInsertRowAbove,
      contextMenuState?.includeMatrixMultiInsertRowBelow,
      contextMenuState?.includeMatrixMultiRemoveRow,
      contextMenuState?.includeMatrixMultiInsertColumnLeft,
      contextMenuState?.includeMatrixMultiInsertColumnRight,
      contextMenuState?.includeMatrixMultiRemoveColumn
    ]
  );

  return (
    <>
      <CanvasPanelView
        prefersNonBlinkingTextInsertionIndicator={prefersNonBlinkingTextInsertionIndicator}
        showRulers={showRulers}
        viewportSize={viewportSize}
        topRulerRef={topRulerRef}
        leftRulerRef={leftRulerRef}
        onTopRulerPointerDown={onTopRulerPointerDown}
        onLeftRulerPointerDown={onLeftRulerPointerDown}
        onCanvasContextMenu={(event) => { if (!deckOverlayMenu.onContextMenu(event)) onCanvasContextMenu(event); }}
        rulers={rulers}
        LEFT_RULER_DRAG_SOURCE_WIDTH_PX={LEFT_RULER_DRAG_SOURCE_WIDTH_PX}
        toolMode={toolMode}
        viewportRef={viewportRef}
        onViewportKeyDown={(event) => {
          if (deckSelectedObject && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
            event.preventDefault();
            const rect = viewportRef.current?.getBoundingClientRect();
            deckOverlayMenu.openForObject(deckSelectedObject, (rect?.left ?? 0) + 24, (rect?.top ?? 0) + 24);
            return;
          }
          if (handleDeckObjectViewportKey(event)) {
            return;
          }
          if (
            event.key === "Escape" &&
            isNestedFigureMode &&
            toolMode === "select" &&
            selectedElementIds.size === 0
          ) {
            // Top rung of the nested-figure Esc ladder: with nothing left
            // to deselect, Esc returns to the owning slide.
            event.preventDefault();
            exitNestedFigure();
            return;
          }
          if (deckActiveFrame && deckActiveFrame.stepCount > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            const delta = event.key === "ArrowRight" ? 1 : -1;
            const nextStep = Math.min(
              Math.max(1, deckActiveFrame.step + delta),
              deckActiveFrame.stepCount
            );
            if (nextStep !== deckActiveFrame.step) {
              dispatch({ type: "SET_DECK_STEP", rootId: deckActiveFrame.frameId, step: nextStep });
            }
            return;
          }
          onViewportKeyDown(event);
        }}
        onViewportCopy={onViewportCopy}
        onViewportCut={onViewportCut}
        onViewportPaste={onViewportPaste}
        onViewportDragOver={onViewportDragOver}
        onViewportDrop={onViewportDrop}
        onBackgroundClick={handleBackgroundClick}
        onViewportPointerDown={onViewportPointerDown}
        onViewportPointerUp={onViewportPointerUp}
        svgResult={svgResult}
        noActiveFigure={snapshot.figures.length > 0 && snapshot.activeRootId == null}
        assistantLockReason={assistantLockReason}
        snapshot={snapshot}
        svgModel={svgModel}
        svgLayerHostRef={svgLayerHostRef}
        canvasTransform={canvasTransform}
        showTransparencyGrid={showTransparencyGrid}
        showDocumentBounds={showDocumentBounds}
        svgDiffHints={svgDiffHints}
        forceSvgReplaceAll={forceSvgReplaceAll}
        onSvgPatchFallback={onSvgPatchFallback}
        repeatPreviewModel={repeatPreviewModel}
        interactionSvgRef={interactionSvgRef}
        onInteractionPointerDown={onInteractionPointerDown}
        onInteractionPointerUp={onInteractionPointerUp}
        onInteractionLostPointerCapture={onInteractionLostPointerCapture}
        onInteractionPointerMove={onInteractionPointerMove}
        onInteractionPointerEnter={onInteractionPointerEnter}
        onInteractionPointerLeave={onInteractionPointerLeave}
        gridLines={gridLines}
        gridMinorStrokeWidth={gridMinorStrokeWidth}
        gridMajorStrokeWidth={gridMajorStrokeWidth}
        gridAxisStrokeWidth={gridAxisStrokeWidth}
        visibleRanges={visibleRanges}
        showGuides={showGuides}
        renderedGuides={renderedGuides}
        guideStrokeWidth={guideStrokeWidth}
        guideHitStrokeWidth={guideHitStrokeWidth}
        onGuidePointerDown={onGuidePointerDown}
        snapLines={snapLines}
        snapSourceNames={snapSourceNames}
        snapStrokeWidth={snapStrokeWidth}
        snapCrossSize={snapCrossSize}
        toolPreview={toolPreview}
        handleStrokeWidth={handleStrokeWidth}
        previewArrowPoints={previewArrowPoints}
        hitRegions={hitRegions}
        hoveredElementId={hoveredElementId}
        editableTextRegionKeys={editableTextRegionKeys}
        draggableSourceIds={draggableSourceIds}
        hitRegionCursorByTargetId={pendingNodePositionHitRegionCursorByTargetId}
        onElementPointerDown={onElementPointerDown}
        onElementContextMenu={(event, id, region, handle) => {
          if (!deckOverlayMenu.onContextMenu(event, region)) onElementContextMenu(event, id, region, handle);
        }}
        onElementDoubleClick={onElementDoubleClick}
        onHoverChange={(id: string | null) => { dispatch({ type: "SET_HOVERED_ELEMENT", id }); }}
        nodePositionLinks={nodePositionLinks}
        marqueeBounds={marqueeBounds}
        selectionBoxes={selectionBoxes}
        deckObjectSelectionBox={deckObjectSelectionBox}
        deckResizeOverlay={<DeckResizeOverlay source={snapshot.source} layout={deckActiveFrame?.layout ?? null}
          index={deckObjectIndex} selected={deckSelectedObject} scale={canvasTransform.scale}
          svgRef={interactionSvgRef} closeText={closeTextEditingSession} />}
        deckBuildSelectionRects={deckBuildSelectionRects}
        adornmentHighlightBoxes={adornmentHighlightBoxes}
        selectedAdornmentConnectors={selectedAdornmentConnectors}
        selectionStrokeWidth={selectionStrokeWidth}
        textSelectionOverlay={textSelectionOverlay}
        selectionDragStrokeWidth={selectionDragStrokeWidth}
        matrixSelectionSourceIds={matrixSelectionSourceIds}
        curveControlLines={curveControlLines}
        curveControlStrokeWidth={curveControlStrokeWidth}
        nodeAnchorOverlay={pendingNodePositionAnchorOverlay ?? nodeAnchorOverlay}
        onNodeAnchorPointerDown={pendingNodePositionTargetPick ? handleNodeAnchorPointerDown : undefined}
        onNodeAnchorClick={pendingNodePositionTargetPick ? handleNodeAnchorClick : undefined}
        onNodeAnchorHoverChange={
          pendingNodePositionTargetPick
            ? setPendingNodePositionAnchorHoverSourceId
            : undefined
        }
        nodePositionTargetTooltip={nodePositionTargetTooltip}
        handleHalfSize={handleHalfSize}
        handleDisplays={handleDisplays}
        onHandlePointerDown={onHandlePointerDown}
        onResizeHandlePointerDown={onResizeHandlePointerDown}
        onRotateHandlePointerDown={onRotateHandlePointerDown}
        platform={platform}
        contextMenuState={contextMenuState}
        commandRuntimeBindings={commandRuntime.bindings}
        contextMenuDefinition={contextMenuDefinition}
        onContextMenuClose={() => { setContextMenuState(null); }}
        onContextMenuCommandRun={(commandId: AppMenuCommandId, origin: CommandOrigin) => {
          commandRuntime.runCommand(commandId, origin);
          setContextMenuState(null);
        }}
        dragTooltip={dragTooltip}
        dragTooltipBoundary={dragTooltipBoundary}
        warning={warning}
        copyWarningToClipboard={copyWarningToClipboard}
        onWarningBarKeyDown={onWarningBarKeyDown}
        canvasTextEdit={canvasTextEditView}
        selectionHint={canvasSelectionHint}
        magnifierState={magnifierState}
        deckStepper={
          deckActiveFrame && deckActiveFrame.stepCount > 1
            ? {
                step: deckActiveFrame.step,
                stepCount: deckActiveFrame.stepCount,
                onStepChange: (step: number) => {
                  dispatch({ type: "SET_DECK_STEP", rootId: deckActiveFrame.frameId, step });
                }
              }
            : null
        }
        nestedFigureBreadcrumb={nestedFigureBreadcrumb}
        RULER_SIZE={RULER_SIZE}
      />
      {deckOverlayMenu.menu}
      {equationModalTarget ? (
        <Suspense fallback={null}>
          <EquationModal
            mode="edit"
            initialLatex={equationModalTarget.latex}
            onClose={() => { setEquationModalTarget(null); }}
            onConfirm={(latex) => {
              dispatch({
                type: "APPLY_EDIT_ACTION",
                action: {
                  kind: "updateNodeText",
                  elementId: equationModalTarget.sourceId,
                  text: formatEquationText(latex, equationModalTarget.delimiter)
                }
              });
              setEquationModalTarget(null);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
});
