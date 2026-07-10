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
type ClipboardEvent as ReactClipboardEvent,
type DragEvent as ReactDragEvent,
type KeyboardEvent as ReactKeyboardEvent,
type MouseEvent as ReactMouseEvent,
type PointerEvent as ReactPointerEvent,
type SyntheticEvent as ReactSyntheticEvent
} from "react";
import { clientPoint as makeClientPoint,svgPoint as makeSvgPoint,worldPoint as makeWorldPoint,pt,px,svgBounds,viewportPoint } from "tikz-editor/coords/index";
import {
ADORNMENT_EDIT_NOOP_REASON,
PATH_ATTACHED_NODE_EDIT_NOOP_REASON,
PROPERTY_WRITE_CLEANUP_NOOP_REASON,
applyEditAction,
preflightPositionNodeRelativeToAction,
type EditAction,
type EditActionResult
} from "tikz-editor/edit/actions";
import { PT_PER_CM,formatNumber } from "tikz-editor/edit/format";
import {
makeForeachTemplateTargetId,
resolvePropertyTargetFromParseResult
} from "tikz-editor/edit/property-target";
import type { SnapLine } from "tikz-editor/edit/snapping";
import { renderTikzToSvg } from "tikz-editor/render/index";
import type {
EditHandlePositioningContext,
NodeAnchorTarget,
SceneElement
} from "tikz-editor/semantic/types";
import type { SvgRenderModel } from "tikz-editor/svg";
import type { SvgDiffHints, SvgViewBox } from "tikz-editor/svg/index";
import {
getKnuthPlassCaretFromPoint,
getKnuthPlassLineRangeFromPoint
} from "tikz-editor/text/knuth-plass";
import { createMathJaxNodeTextEngine,getActiveMathJaxOutputJax } from "tikz-editor/text/mathjax-engine";
import type { NodeTextEngine,NodeTextLayoutKind } from "tikz-editor/text/types";
import { useShallow } from "zustand/react/shallow";
import type { AppMenuCommandId } from "../../app-menu";
import { buildCanvasContextMenuDefinition } from "../../context-menu";
import { getSharedEditAnalysisSession,getSharedEditAnalysisView } from "../../edit-analysis-manager";
import { getActiveEditorPlatform } from "../../platform/current";
import { GRID_SIZE_MINOR_TARGET_PX } from "../../settings/types";
import { useSettingsStore } from "../../settings/useSettingsStore";
import { buildSnapshotEditSourceFingerprint } from "../../source-identity";
import { useEditorStore } from "../../store/store";
import type { CanvasDragKind,CanvasTransform } from "../../store/types";
import { resolveBucketFillEdit } from "./bucket-fill";
import { recordDragPatchModeFullReason } from "./drag-patch-mode-debug";
import {
INITIAL_CANVAS_TEXT_EDIT_STATE,
isCanvasTextInputIntentType,
reduceCanvasTextEdit,
type CanvasTextEditAction
} from "./canvas-text-edit-machine";
import { CanvasPanelView } from "./CanvasPanelView";
import { useCanvasContextMenuController,useCanvasContextMenuState } from "./useCanvasContextMenus";
import {
appendFreehandToolPoint,
generateFreehandToolSource
} from "./freehand-tool";
import {
clamp,
clientToSvgPoint,
viewportToSvgPoint,
viewportToWorldPoint,
worldToSvgPoint
} from "./geometry";
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
makeMergeKey,
mapPointToRectRegionLocal,
preferredNodeBoundsForSource,
previewArrowPoints,
rectHitRegionsForTargetId,
resolveRectHitRegionContentBox
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
clampSnapDebugOverlayRect,
summarizeSnapContextForDebug,
summarizeSnapLinesForDebug,
toDebugPoint,
type SnapDebugContextSummary,
type SnapDebugLineSummary,
type SnapDebugOverlayRect,
type SnapDebugPoint
} from "./snap-debug";
import { createSourceRenderOffsetMap } from "./text-offset-map";
import { applyTextMeasureFont,collectLogicalLineRanges,createVisualTextLayout,resolveVisualLineLeft } from "./text-visual-layout";
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
SnapDebugLogInput,
SourceBoundsMap,
StateSetter
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
import { useCanvasTextEditingEffects } from "./useCanvasTextEditingEffects";
import { useCanvasToolInteractions } from "./useCanvasToolInteractions";
import { useCanvasViewportEffects } from "./useCanvasViewportEffects";
import { useCanvasViewportPersistence } from "./useCanvasViewportPersistence";
import { useBucketFillPreview,type BucketPreviewSession } from "./useBucketFillPreview";
import type { ClientPoint,SvgBounds,ViewportPoint,WorldPoint } from "../coords/types";
import { useEditorCommandRuntime,type CommandOrigin } from "../editor-command-runtime";
import { isMacLikePlatform } from "../key-labels";
import {
formatEquationText,
type EquationNodeTarget
} from "../equation-utils";

type TextEditCaretOverlay = {
  left: number;
  top: number;
  height: number;
};

const EquationModal = lazy(async () => {
  const mod = await import("../EquationModal");
  return { default: mod.EquationModal };
});

type SnapDebugOverlayState = {
  atIso: string;
  phase: string;
  note: string | null;
  snapshotMatchesSource: boolean;
  dragKind: DragState["kind"] | null;
  rawPoint: SnapDebugPoint | null;
  rawDelta: SnapDebugPoint | null;
  snappedPoint: SnapDebugPoint | null;
  snappedDelta: SnapDebugPoint | null;
  offset: SnapDebugPoint | null;
  context: SnapDebugContextSummary | null;
  lineCount: number;
  lineSummary: SnapDebugLineSummary[];
};

const EMPTY_GUIDES: GuidesState = { vertical: [], horizontal: [] };

function canvasFigureContextKey(documentId: string, figureId: string | null): string {
  return `${documentId}::${figureId ?? "none"}`;
}

type SnapDebugOverlayDragState =
  | {
      kind: "move";
      startClient: ClientPoint;
      startLeft: number;
      startTop: number;
    }
  | {
      kind: "resize";
      startClient: ClientPoint;
      startWidth: number;
      startHeight: number;
    };

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
const TEXT_CARET_OVERLAY_EPSILON_PX = 0.25;
const TEXTAREA_CARET_MIRROR_STYLE_PROPERTIES = [
  "box-sizing",
  "direction",
  "width",
  "height",
  "overflow-x",
  "overflow-y",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font",
  "font-family",
  "font-feature-settings",
  "font-kerning",
  "font-optical-sizing",
  "font-size",
  "font-stretch",
  "font-style",
  "font-variant",
  "font-variant-ligatures",
  "font-weight",
  "letter-spacing",
  "line-height",
  "tab-size",
  "text-align",
  "text-indent",
  "text-rendering",
  "text-transform",
  "word-spacing"
] as const;

function resolveTextareaLineHeightPx(textarea: HTMLTextAreaElement): number {
  const computed = textarea.ownerDocument.defaultView?.getComputedStyle(textarea);
  if (!computed) {
    return 16;
  }
  const lineHeight = Number.parseFloat(computed.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) {
    return lineHeight;
  }
  const fontSize = Number.parseFloat(computed.fontSize);
  if (Number.isFinite(fontSize) && fontSize > 0) {
    return fontSize * 1.2;
  }
  return 16;
}

function resolveTextareaCaretClientRect(textarea: HTMLTextAreaElement, offset: number): DOMRect | null {
  const documentRef = textarea.ownerDocument;
  const windowRef = documentRef.defaultView;
  if (!windowRef) {
    return null;
  }
  const computed = windowRef.getComputedStyle(textarea);
  const textareaRect = textarea.getBoundingClientRect();
  const mirror = documentRef.createElement("div");
  const marker = documentRef.createElement("span");
  const boundedOffset = clamp(offset, 0, textarea.value.length);
  const beforeCaret = textarea.value.slice(0, boundedOffset);
  const afterCaret = textarea.value.slice(boundedOffset);

  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.wordBreak = "break-word";
  mirror.style.overflowWrap = "break-word";
  mirror.style.overflow = "hidden";
  mirror.style.left = `${textareaRect.left}px`;
  mirror.style.top = `${textareaRect.top}px`;
  for (const property of TEXTAREA_CARET_MIRROR_STYLE_PROPERTIES) {
    mirror.style.setProperty(property, computed.getPropertyValue(property));
  }

  marker.style.display = "inline-block";
  marker.style.width = "0";
  marker.style.height = `${resolveTextareaLineHeightPx(textarea)}px`;
  marker.style.padding = "0";
  marker.style.border = "0";
  marker.style.margin = "0";
  marker.style.verticalAlign = "text-bottom";

  try {
    mirror.append(beforeCaret, marker, afterCaret);
    documentRef.body.append(mirror);
    const markerRect = marker.getBoundingClientRect();
    if (!Number.isFinite(markerRect.left) || !Number.isFinite(markerRect.top)) {
      return null;
    }
    const height = Math.max(1, markerRect.height || resolveTextareaLineHeightPx(textarea));
    return new windowRef.DOMRect(
      markerRect.left - textarea.scrollLeft,
      markerRect.top - textarea.scrollTop,
      1,
      height
    );
  } finally {
    mirror.remove();
  }
}

type TextSelectionDragMode = "char" | "word" | "line";

type TextLineRange = {
  start: number;
  end: number;
};

function resolveTextSelectionModeFromClickCount(clickCount: number): TextSelectionDragMode {
  if (clickCount >= 3) {
    return "line";
  }
  if (clickCount === 2) {
    return "word";
  }
  return "char";
}

function resolveWordSelectionRange(
  text: string,
  offset: number
): { start: number; end: number } {
  const boundedOffset = clamp(offset, 0, text.length);
  if (text.length === 0) {
    return { start: boundedOffset, end: boundedOffset };
  }

  let pivot = boundedOffset;
  if (pivot >= text.length) {
    pivot = text.length - 1;
  } else if (pivot > 0) {
    const currentChar = text[pivot] ?? "";
    const previousChar = text[pivot - 1] ?? "";
    if (/\s/.test(currentChar) && !/\s/.test(previousChar)) {
      pivot -= 1;
    }
  }

  const pivotChar = text[pivot] ?? "";
  const isWhitespaceRun = /\s/.test(pivotChar);
  let start = pivot;
  let end = pivot + 1;
  while (start > 0) {
    const previousChar = text[start - 1] ?? "";
    if ((/\s/.test(previousChar)) !== isWhitespaceRun) {
      break;
    }
    start -= 1;
  }
  while (end < text.length) {
    const nextChar = text[end] ?? "";
    if ((/\s/.test(nextChar)) !== isWhitespaceRun) {
      break;
    }
    end += 1;
  }
  return { start, end };
}

function resolveLogicalLineRangeForOffset(text: string, offset: number): TextLineRange {
  const boundedOffset = clamp(offset, 0, text.length);
  const ranges = collectLogicalLineRanges(text);
  const pivot = text.length === 0 ? 0 : Math.min(Math.max(0, boundedOffset), text.length - 1);
  for (const range of ranges) {
    if (pivot >= range.start && pivot < range.end) {
      return range;
    }
  }
  return ranges[ranges.length - 1] ?? { start: 0, end: text.length };
}

function resolveTextSelectionRangeForMode(
  text: string,
  mode: TextSelectionDragMode,
  offset: number,
  lineRange: TextLineRange | null = null
): TextLineRange {
  const boundedOffset = clamp(offset, 0, text.length);
  if (mode === "char") {
    return { start: boundedOffset, end: boundedOffset };
  }
  if (mode === "word") {
    return resolveWordSelectionRange(text, boundedOffset);
  }
  return lineRange ?? resolveLogicalLineRangeForOffset(text, boundedOffset);
}

function resolveTextSelectionRangeForDrag(
  text: string,
  mode: TextSelectionDragMode,
  anchorOffset: number,
  focusOffset: number,
  anchorLineRange: TextLineRange | null = null,
  focusLineRange: TextLineRange | null = null
): TextLineRange {
  const anchorRange = resolveTextSelectionRangeForMode(text, mode, anchorOffset, anchorLineRange);
  const focusRange = resolveTextSelectionRangeForMode(text, mode, focusOffset, focusLineRange);
  return {
    start: Math.min(anchorRange.start, focusRange.start),
    end: Math.max(anchorRange.end, focusRange.end)
  };
}

let fallbackTextMeasureContext: CanvasRenderingContext2D | null | undefined;

function getFallbackTextMeasureContext(): CanvasRenderingContext2D | null {
  if (fallbackTextMeasureContext !== undefined) {
    return fallbackTextMeasureContext;
  }
  if (typeof document === "undefined") {
    fallbackTextMeasureContext = null;
    return fallbackTextMeasureContext;
  }
  const canvas = document.createElement("canvas");
  fallbackTextMeasureContext = canvas.getContext("2d");
  return fallbackTextMeasureContext;
}

function applyFallbackMeasureFont(ctx: CanvasRenderingContext2D | null, target: EditableTextTarget): void {
  applyTextMeasureFont(ctx, target.style);
}

function estimateTextOffsetFromClient(
  target: EditableTextTarget,
  clientPoint: ClientPoint,
  interactionSvgElement: SVGSVGElement | null,
  viewportRef: { current: HTMLDivElement | null },
  svgResult: { viewBox: SvgViewBox } | null,
  canvasTransform: CanvasTransform
): number {
  const contentBox = resolveRectHitRegionContentBox(target.region);
  const svgPoint = clientToSvgPoint(clientPoint, interactionSvgElement) ?? (() => {
    const viewportPoint = viewportPointFromClient(clientPoint, viewportRef.current);
    return svgResult
      ? viewportToSvgPoint(viewportPoint, canvasTransform, svgResult.viewBox)
      : makeSvgPoint(pt(clientPoint.x), pt(clientPoint.y));
  })();
  const localPoint = mapPointToRectRegionLocal(svgPoint, target.region);
  const ctx = getFallbackTextMeasureContext();
  applyFallbackMeasureFont(ctx, target);
  const layout = createVisualTextLayout(
    target.text,
    target.renderSourceText ?? target.text,
    (text) => {
      if (!ctx) {
        return Number.NaN;
      }
      return ctx.measureText(text).width;
    },
    { syntax: target.usesMathJax ? "mathjax" : "plain" }
  );
  const ranges = layout.sourceLineRanges;

  const yRatio =
    contentBox.height <= 1e-6
      ? 0
      : clamp((localPoint.y - contentBox.y) / contentBox.height, 0, 0.999999);
  const lineIndex = Math.min(
    ranges.length - 1,
    Math.max(0, Math.floor(yRatio * ranges.length))
  );
  const lineWidth = layout.getLineWidth(lineIndex);
  const lineLeft = resolveVisualLineLeft(contentBox.width, lineWidth, target.style.textAlign);
  const localLineX = localPoint.x - contentBox.x - lineLeft;
  return layout.resolveSourceOffsetFromLineX(lineIndex, localLineX);
}

function estimateTextLineRangeFromClient(
  target: EditableTextTarget,
  clientPoint: ClientPoint,
  interactionSvgElement: SVGSVGElement | null,
  viewportRef: { current: HTMLDivElement | null },
  svgResult: { viewBox: SvgViewBox } | null,
  canvasTransform: CanvasTransform
): TextLineRange {
  const ranges = collectLogicalLineRanges(target.text);
  if (ranges.length === 0) {
    return { start: 0, end: 0 };
  }
  if (ranges.length === 1) {
    return ranges[0];
  }

  const contentBox = resolveRectHitRegionContentBox(target.region);
  const svgPoint = clientToSvgPoint(clientPoint, interactionSvgElement) ?? (() => {
    const viewportPoint = viewportPointFromClient(clientPoint, viewportRef.current);
    return svgResult
      ? viewportToSvgPoint(viewportPoint, canvasTransform, svgResult.viewBox)
      : makeSvgPoint(pt(clientPoint.x), pt(clientPoint.y));
  })();
  const localPoint = mapPointToRectRegionLocal(svgPoint, target.region);
  const yRatio =
    contentBox.height <= 1e-6
      ? 0
      : clamp((localPoint.y - contentBox.y) / contentBox.height, 0, 0.999999);
  const index = Math.min(ranges.length - 1, Math.max(0, Math.floor(yRatio * ranges.length)));
  return ranges[index] ?? ranges[ranges.length - 1];
}

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
    activeFigureId,
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
    activeFigureId: s.activeFigureId,
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
  const { gridSize, handleSizePx, zoomSpeed, snapHapticsEnabled, mathJaxFont } = useSettingsStore(useShallow((s) => ({
    gridSize: s.settings.canvas.gridSize,
    handleSizePx: s.settings.canvas.handleSizePx,
    zoomSpeed: s.settings.canvas.zoomSpeed,
    snapHapticsEnabled: s.settings.canvas.snapHapticsEnabled,
    mathJaxFont: s.settings.rendering.mathJaxFont
  })));
  const gridMinorTargetPx = GRID_SIZE_MINOR_TARGET_PX[gridSize];

  const baseSvgResult = snapshot.svg;
  const baseSvgModel = snapshot.svgModel;
  const [warning, setWarning] = useState<string | null>(null);
  const [dragTooltip, setDragTooltip] = useState<DragTooltipState | null>(null);
  const dragTooltipBoundaryRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const [dragCursorLock, setDragCursorLock] = useState<string | null>(null);
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);
  const [snapDebug, setSnapDebug] = useState<SnapDebugOverlayState | null>(null);
  const [snapDebugRect, setSnapDebugRect] = useState<SnapDebugOverlayRect>({
    left: 10,
    top: 10,
    width: 460,
    height: 220
  });
  const activeGuideFigureKey = canvasFigureContextKey(activeDocumentId, activeFigureId);
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
  const [canvasTextEditState, setCanvasTextEditState] = useState(INITIAL_CANVAS_TEXT_EDIT_STATE);
  const canvasTextEditStateRef = useRef(INITIAL_CANVAS_TEXT_EDIT_STATE);
  const textEditingSession = canvasTextEditState.session;
  const textSelectionOverlay = canvasTextEditState.selectionOverlay;
  const [pendingAdornmentTextEditTargetId, setPendingAdornmentTextEditTargetId] = useState<string | null>(null);
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
  useLayoutEffect(() => {
    canvasTextEditStateRef.current = canvasTextEditState;
  }, [canvasTextEditState]);

  const dispatchCanvasTextEditAction = useCallback((action: CanvasTextEditAction) => {
    const reduced = reduceCanvasTextEdit(canvasTextEditStateRef.current, action);
    canvasTextEditStateRef.current = reduced.state;
    setCanvasTextEditState(reduced.state);
    for (const effect of reduced.effects) {
      if (effect.type !== "apply_source_patch") {
        continue;
      }
      dispatch({
        type: "APPLY_EDIT_ACTION",
        action: {
          kind: "updateNodeText",
          elementId: effect.sourceId,
          text: effect.nextText
        },
        historyMergeKey: effect.historyMergeKey,
        precomputedResult: {
          kind: "success",
          newSource: effect.nextSource,
          patches: [
            {
              oldSpan: effect.previousSpan,
              newSpan: effect.changedSpan,
              replacement: effect.replacement
            }
          ],
          changedSourceIds: [effect.sourceId]
        }
      });
    }
  }, [dispatch]);

  const closeTextEditingSession = useCallback(() => {
    dispatchCanvasTextEditAction({ type: "session_close" });
  }, [dispatchCanvasTextEditAction]);

  const activeCanvasTextEditSourceId = textEditingSession?.sourceId ?? null;
  useEffect(() => {
    dispatch({ type: "SET_ACTIVE_CANVAS_TEXT_EDIT", sourceId: activeCanvasTextEditSourceId });
    return () => {
      dispatch({ type: "SET_ACTIVE_CANVAS_TEXT_EDIT", sourceId: null });
    };
  }, [activeCanvasTextEditSourceId, dispatch]);

  const editParseOptions = useMemo(
    () => ({
      activeFigureId:
        activeFigureId ?? (snapshot.figures.length > 1 ? null : undefined),
      analysisView: getSharedEditAnalysisView({
        documentId: activeDocumentId,
        sourceRevision,
        source,
        activeFigureId,
        snapshot
      }),
      analysisSession: getSharedEditAnalysisSession()
    }),
    [activeDocumentId, activeFigureId, snapshot, source, sourceRevision]
  );

  const canvasCommandStateRef = useRef<{
    source: string;
    selectedElementIds: ReadonlySet<string>;
    sceneElements: readonly SceneElement[];
    viewBox: SvgViewBox | null;
    editParseOptions: typeof editParseOptions;
  } | null>(null);
  canvasCommandStateRef.current = {
    source,
    selectedElementIds,
    sceneElements: snapshot.scene?.elements ?? [],
    viewBox: svgResult?.viewBox ?? null,
    editParseOptions
  };
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
    setPendingAdornmentTextEditTargetId(result.pendingTextTargetId);
  }, [contextMenuContextRef, dispatch]);
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
  const previousCanvasContextKeyRef = useRef(canvasFigureContextKey(activeDocumentId, activeFigureId));
  const pendingAddedSelectionRef = useRef<PendingAddedSelection | null>(null);
  const canvasTransformRef = useRef(canvasTransform);
  const selectedElementIdsRef = useRef(selectedElementIds);
  const svgResultRef = useRef(svgResult);
  const sourceBoundsSvgRef = useRef<SourceBoundsMap>(new Map<string, SvgBounds>());
  const liveResizeFramesRef = useRef(new Map<string, ReturnType<typeof resolveResizeFrameForSource>>());
  const previousViewBoxRef = useRef<SvgViewBox | null>(null);
  const guideDragRef = useRef<GuideDragState | null>(null);
  const snapDebugDragRef = useRef<SnapDebugOverlayDragState | null>(null);
  const textEngineRef = useRef<NodeTextEngine | null>(null);
  const svgLayerHostRef = useRef<HTMLDivElement | null>(null);
  const appliedPathAttachedNodePreviewRef = useRef<Array<{ element: SVGElement; transform: string | null }>>([]);
  const textEditTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textEditPopupRef = useRef<HTMLDivElement | null>(null);
  const [textEditPopupHeight, setTextEditPopupHeight] = useState<number | null>(null);
  const [textEditCaretOverlay, setTextEditCaretOverlay] = useState<TextEditCaretOverlay | null>(null);
  const supportsFieldSizing = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");
  const textEditTextareaSizing = useMemo(() => {
    if (!textEditingSession || supportsFieldSizing) {
      return null;
    }

    const lines = textEditingSession.text.split(/\r?\n/);
    return {
      rows: Math.max(1, lines.length)
    };
  }, [supportsFieldSizing, textEditingSession]);
  const textSelectionDragRef = useRef<{
    pointerId: number;
    sourceId: string;
    sceneTextId: string;
    anchorOffset: number;
    mode: TextSelectionDragMode;
    anchorLineRange: TextLineRange | null;
  } | null>(null);
  const pendingTextEditPasteRef = useRef<string | null>(null);
  const pendingTextEditInsertTextRef = useRef<string | null>(null);

  useEffect(() => {
    if (!textEditingSession) {
      pendingTextEditPasteRef.current = null;
      pendingTextEditInsertTextRef.current = null;
    }
  }, [textEditingSession]);

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

  // Cache viewport boundary once on drag-start, clear on drag-end (avoids getBoundingClientRect per frame)
  if (dragTooltip && !dragTooltipBoundaryRef.current && viewportRef.current) {
    const r = viewportRef.current.getBoundingClientRect();
    dragTooltipBoundaryRef.current = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  } else if (!dragTooltip) {
    dragTooltipBoundaryRef.current = null;
  }

  const setActiveCanvasDragKind = useCallback(
    (kind: CanvasDragKind | null) => {
      dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind });
    },
    [dispatch]
  );

  const setDragState = useCallback(
    (next: DragState | null) => {
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
    const nextContextKey = canvasFigureContextKey(activeDocumentId, activeFigureId);
    if (previousCanvasContextKeyRef.current === nextContextKey) {
      return;
    }
    previousCanvasContextKeyRef.current = nextContextKey;

    pathDraftRef.current = null;
    freehandDraftRef.current = null;
    textSelectionDragRef.current = null;
    const pendingTouch = pendingTouchViewportRef.current;
    if (pendingTouch) {
      clearTimeout(pendingTouch.timer);
      pendingTouchViewportRef.current = null;
    }
    guideDragRef.current = null;
    document.body.classList.remove("is-dragging-guide-horizontal");
    document.body.classList.remove("is-dragging-guide-vertical");

    closeTextEditingSession();
    clearPendingNodePositionTargetPick();
    setPathDraft(null);
    setFreehandDraft(null);
    setPathSegmentDraft(null);
    setToolDraft(null);
    setBezierBendDraft(null);
    setPendingBezier(null);
    setMarqueeDraft(null);
    setMagnifierState(null);
    setPendingAdornmentTextEditTargetId(null);
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
    activeFigureId,
    clearPendingNodePositionTargetPick,
    closeTextEditingSession,
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
      setSnapDebug(nextSnapDebug);
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

  const onSnapDebugMovePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      snapDebugDragRef.current = {
        kind: "move",
        startClient: makeClientPoint(px(event.clientX), px(event.clientY)),
        startLeft: snapDebugRect.left,
        startTop: snapDebugRect.top
      };
      document.body.classList.add("is-dragging-snap-debug");
      event.preventDefault();
      event.stopPropagation();
    },
    [snapDebugRect.left, snapDebugRect.top]
  );

  const onSnapDebugResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      snapDebugDragRef.current = {
        kind: "resize",
        startClient: makeClientPoint(px(event.clientX), px(event.clientY)),
        startWidth: snapDebugRect.width,
        startHeight: snapDebugRect.height
      };
      document.body.classList.add("is-resizing-snap-debug");
      event.preventDefault();
      event.stopPropagation();
    },
    [snapDebugRect.height, snapDebugRect.width]
  );

  useEffect(() => {
    let cancelled = false;
    void createMathJaxNodeTextEngine({ font: mathJaxFont })
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
  }, [mathJaxFont]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = snapDebugDragRef.current;
      if (!drag) {
        return;
      }

      if (viewportSize.width <= 0 || viewportSize.height <= 0) {
        return;
      }

      if (drag.kind === "move") {
        setSnapDebugRect((current) =>
          clampSnapDebugOverlayRect(
            {
              ...current,
              left: drag.startLeft + (event.clientX - drag.startClient.x),
              top: drag.startTop + (event.clientY - drag.startClient.y)
            },
            viewportSize.width,
            viewportSize.height
          )
        );
        return;
      }

      setSnapDebugRect((current) =>
        clampSnapDebugOverlayRect(
            {
              ...current,
            width: drag.startWidth + (event.clientX - drag.startClient.x),
            height: drag.startHeight + (event.clientY - drag.startClient.y)
            },
          viewportSize.width,
          viewportSize.height
        )
      );
    }

    function clearSnapDebugDragState() {
      if (!snapDebugDragRef.current) {
        return;
      }
      snapDebugDragRef.current = null;
      document.body.classList.remove("is-dragging-snap-debug");
      document.body.classList.remove("is-resizing-snap-debug");
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", clearSnapDebugDragState);
    window.addEventListener("pointercancel", clearSnapDebugDragState);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", clearSnapDebugDragState);
      window.removeEventListener("pointercancel", clearSnapDebugDragState);
      clearSnapDebugDragState();
    };
  }, [viewportSize.height, viewportSize.width]);

  useEffect(() => {
    if (!showDevPanel) {
      return;
    }
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }
    setSnapDebugRect((current) =>
      clampSnapDebugOverlayRect(current, viewportSize.width, viewportSize.height)
    );
  }, [showDevPanel, viewportSize.height, viewportSize.width]);

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
  const pendingNodePositionTargetStatusBySourceId = useMemo(() => {
    const statusBySourceId = new Map<string, NodePositionTargetStatus>();
    if (!pendingNodePositionTargetPick || pendingNodePositionTargetAnchors.length === 0) {
      return statusBySourceId;
    }
    const sourceFingerprint = buildSnapshotEditSourceFingerprint({
      documentId: activeDocumentId,
      sourceRevision,
      sourceLength: source.length,
      sourceRefs: snapshot.editHandles.map((handle) => handle.sourceRef)
    });
    for (const anchor of pendingNodePositionTargetAnchors) {
      const targetSourceId = anchor.nodeSourceId?.trim();
      if (!targetSourceId) {
        continue;
      }
      const action: EditAction = {
        kind: "positionNodeRelativeTo",
        nodeId: pendingNodePositionTargetPick.nodeSourceId,
        targetNodeName: anchor.nodeName,
        targetNodeSourceId: targetSourceId
      };
      const preflight = preflightPositionNodeRelativeToAction(source, action, {
        evaluateOptions: { sourceFingerprint, textEngine: activeTextEngine },
        parseOptions: { ...editParseOptions, propertyWriteMode: "drag-frame", sourceFingerprint }
      });
      const { result } = preflight;
      if (result.kind === "success" || result.kind === "partial") {
        statusBySourceId.set(targetSourceId, {
          anchor,
          action,
          result,
          preview: preflight.preview,
          usable: true,
          reason: null
        });
        continue;
      }
      const rawReason = result.kind === "unsupported" ? result.reason : result.message;
      statusBySourceId.set(targetSourceId, {
        anchor,
        action,
        result,
        preview: null,
        usable: false,
        reason: formatNodePositionTargetFailureReason({
          rawReason,
          currentNodeSourceId: pendingNodePositionTargetPick.nodeSourceId,
          target: anchor,
          snapshot
        })
      });
    }
    return statusBySourceId;
  }, [
    activeDocumentId,
    activeTextEngine,
    editParseOptions,
    pendingNodePositionTargetAnchors,
    pendingNodePositionTargetPick,
    snapshot,
    source,
    sourceRevision
  ]);

  const pendingNodePositionHitRegionCursorByTargetId = useMemo(() => {
    if (!pendingNodePositionTargetPick) {
      return;
    }
    const cursorByTargetId = new Map<string, string>();
    for (const [sourceId, status] of pendingNodePositionTargetStatusBySourceId) {
      cursorByTargetId.set(sourceId, status.usable ? "pointer" : "not-allowed");
    }
    return cursorByTargetId;
  }, [pendingNodePositionTargetPick, pendingNodePositionTargetStatusBySourceId]);

  const pendingNodePositionEffectiveHoverSourceId = pendingNodePositionTargetPick
    ? pendingNodePositionAnchorHoverSourceId ?? hoveredElementId
    : null;

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

  const nodePositionTargetTooltip = useMemo(() => {
    if (!pendingNodePositionTargetPick || !pendingNodePositionEffectiveHoverSourceId || !svgResult) {
      return null;
    }
    const status = pendingNodePositionTargetStatusBySourceId.get(pendingNodePositionEffectiveHoverSourceId);
    if (!status || status.usable || !status.reason) {
      return null;
    }
    const viewportRect = viewportRef.current?.getBoundingClientRect();
    if (!viewportRect) {
      return null;
    }
    const svg = worldToSvgPoint(status.anchor.world, svgResult.viewBox);
    return {
      content: status.reason,
      anchor: {
        x: viewportRect.left + canvasTransform.translateX + (svg.x - svgResult.viewBox.x) * canvasTransform.scale,
        y: viewportRect.top + canvasTransform.translateY + (svg.y - svgResult.viewBox.y) * canvasTransform.scale
      }
    };
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
    hitRegions,
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

  canvasTransformRef.current = canvasTransform;
  selectedElementIdsRef.current = selectedElementIds;
  svgResultRef.current = svgResult;
  fitToContentModeActiveRef.current = fitToContentModeActive;
  sourceBoundsSvgRef.current = sourceBoundsSvg;
  liveResizeFramesRef.current = resizeFramesBySource;

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
    activeFigureId,
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
    (action: EditAction, historyMergeKey?: string, sourceOverride?: string): ApplyActionFeedback => {
      const sourceForEdit = sourceOverride ?? source;
      const sourceFingerprint = buildSnapshotEditSourceFingerprint({
        documentId: activeDocumentId,
        sourceRevision,
        sourceLength: sourceForEdit.length,
        sourceRefs: snapshot.editHandles.map((handle) => handle.sourceRef)
      });
      const result = applyEditAction(sourceForEdit, snapshot.editHandles, action, {
        evaluateOptions: { sourceFingerprint, textEngine: textEngineRef.current },
        parseOptions: { ...editParseOptions, propertyWriteMode: "drag-frame", sourceFingerprint }
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
    [activeDocumentId, dispatch, editParseOptions, source, sourceRevision, snapshot.editHandles]
  );
  applyActionWithFeedbackRef.current = applyActionWithFeedback;

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
          sceneText.textRenderInfo?.mode === "mathjax"
            ? sceneText.textRenderInfo.renderSourceText
            : sourceSlice,
        usesMathJax: sceneText.textRenderInfo?.mode === "mathjax",
        paragraphId:
          sceneText.textRenderInfo?.mode === "mathjax"
            ? sceneText.textRenderInfo.paragraphId
            : null,
        layoutKind:
          sceneText.textRenderInfo?.mode === "mathjax"
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
    [sceneTextByRegionKey, snapshot.parseResult, snapshot.scene, source, sourceBoundsSvg, svgResult]
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

  const resolveRenderedMathTextElement = useCallback((target: EditableTextTarget): SVGSVGElement | null => {
    const host = svgLayerHostRef.current;
    if (!host) {
      return null;
    }
    const candidates = Array.from(host.querySelectorAll<SVGSVGElement>('svg[data-text-renderer="mathjax"]'));
    for (const candidate of candidates) {
      if (candidate.getAttribute("data-scene-text-id") === target.sceneTextId) {
        return candidate;
      }
    }
    for (const candidate of candidates) {
      if (candidate.getAttribute("data-paragraph-id") === target.paragraphId) {
        return candidate;
      }
    }
    for (const candidate of candidates) {
      if (candidate.getAttribute("data-source-id") === target.sourceId) {
        return candidate;
      }
    }
    return null;
  }, []);

  const resolveTextOffsetFromClient = useCallback(
    async (target: EditableTextTarget, clientPoint: ClientPoint): Promise<number | null> => {
      if (target.isForeachTemplateEdit) {
        return null;
      }
      const outputJax = getActiveMathJaxOutputJax();
      const containerElement = resolveRenderedMathTextElement(target);
      const requiresParagraphGeometry = target.usesMathJax && target.layoutKind !== "single-line";
      if (!target.paragraphId || !outputJax || !containerElement) {
        if (requiresParagraphGeometry) {
          console.error("[canvas-text-edit] Missing paragraph geometry for multiline MathJax hit-testing.", {
            sourceId: target.sourceId,
            paragraphId: target.paragraphId,
            layoutKind: target.layoutKind
          });
          return null;
        }
        return estimateTextOffsetFromClient(
          target,
          clientPoint,
          interactionSvgRef.current,
          viewportRef,
          svgResult,
          canvasTransform
        );
      }
      const result = await getKnuthPlassCaretFromPoint(outputJax, {
        paragraphId: target.paragraphId,
        sourceText: target.renderSourceText,
        containerElement,
        clientPoint
      });
      if (!result.ok || result.offset == null) {
        return null;
      }
      const offsetMap = createSourceRenderOffsetMap(target.text, target.renderSourceText);
      return clamp(offsetMap.renderToSource(result.offset), 0, target.text.length);
    },
    [
      canvasTransform,
      resolveRenderedMathTextElement,
      svgResult,
      viewportRef
    ]
  );

  const resolveTextLineRangeFromClient = useCallback(
    async (target: EditableTextTarget, clientPoint: ClientPoint): Promise<TextLineRange | null> => {
      if (target.isForeachTemplateEdit) {
        return null;
      }
      const outputJax = getActiveMathJaxOutputJax();
      const containerElement = resolveRenderedMathTextElement(target);
      const requiresParagraphGeometry = target.usesMathJax && target.layoutKind !== "single-line";
      if (target.paragraphId && outputJax && containerElement) {
        const result = await getKnuthPlassLineRangeFromPoint(outputJax, {
          paragraphId: target.paragraphId,
          sourceText: target.renderSourceText,
          containerElement,
          clientPoint
        });
        if (result.ok && result.lineStartOffset != null && result.lineEndOffset != null) {
          const offsetMap = createSourceRenderOffsetMap(target.text, target.renderSourceText);
          const start = clamp(offsetMap.renderToSource(result.lineStartOffset), 0, target.text.length);
          const end = clamp(offsetMap.renderToSource(result.lineEndOffset), 0, target.text.length);
          return {
            start: Math.min(start, end),
            end: Math.max(start, end)
          };
        }
      }
      if (requiresParagraphGeometry) {
        console.error("[canvas-text-edit] Missing paragraph geometry for multiline MathJax line-range resolution.", {
          sourceId: target.sourceId,
          paragraphId: target.paragraphId,
          layoutKind: target.layoutKind
        });
        return null;
      }
      return estimateTextLineRangeFromClient(
        target,
        clientPoint,
        interactionSvgRef.current,
        viewportRef,
        svgResult,
        canvasTransform
      );
    },
    [
      canvasTransform,
      interactionSvgRef,
      resolveRenderedMathTextElement,
      svgResult,
      viewportRef
    ]
  );

  const startTextEditingSession = useCallback(
    (
      target: EditableTextTarget,
      selectionStart: number,
      selectionEnd: number,
      historyMergeKey?: string
    ) => {
      dispatchCanvasTextEditAction({
        type: "start_session",
        target,
        source,
        selectionStart,
        selectionEnd,
        historyMergeKey: historyMergeKey ?? makeMergeKey("canvas-text-edit", target.sourceId, Date.now())
      });
    },
    [dispatchCanvasTextEditAction, source]
  );

  const beginCanvasTextInteraction = useCallback(
    (event: ReactPointerEvent<SVGElement>, target: EditableTextTarget) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.button !== 0) {
        return;
      }
      suppressNextBackgroundClickRef.current = true;
      if (target.isForeachTemplateEdit) {
        event.preventDefault();
        startTextEditingSession(
          target,
          0,
          target.text.length,
          textEditingSession?.sourceId === target.sourceId ? textEditingSession.historyMergeKey : undefined
        );
        return;
      }
      const requestRevision = canvasTextEditState.asyncRequestRevision + 1;
      const baseInputRevision = canvasTextEditState.inputRevision;
      const existingHistoryMergeKey =
        textEditingSession?.sourceId === target.sourceId ? textEditingSession.historyMergeKey : undefined;
      const clickCount = event.detail >= 2 ? event.detail : 1;
      const mode = resolveTextSelectionModeFromClickCount(clickCount);
      const clientPoint = makeClientPoint(px(event.clientX), px(event.clientY));
      const requiresParagraphGeometry = target.usesMathJax && target.layoutKind !== "single-line";
      const provisionalOffset = requiresParagraphGeometry
        ? 0
        : estimateTextOffsetFromClient(
            target,
            clientPoint,
            interactionSvgRef.current,
            viewportRef,
            svgResult,
            canvasTransform
          );
      const provisionalLineRange = mode === "line"
        ? resolveLogicalLineRangeForOffset(target.text, provisionalOffset)
        : null;
      const provisionalSelection = resolveTextSelectionRangeForMode(
        target.text,
        mode,
        provisionalOffset,
        provisionalLineRange
      );
      dispatchCanvasTextEditAction({
        type: "pointer_down_provisional",
        target,
        source,
        pointerId: event.pointerId,
        selectionStart: provisionalSelection.start,
        selectionEnd: provisionalSelection.end,
        anchorOffset: provisionalOffset,
        mode,
        anchorLineRange: provisionalLineRange,
        historyMergeKey: existingHistoryMergeKey ?? makeMergeKey("canvas-text-edit", target.sourceId, Date.now())
      });
      textSelectionDragRef.current = {
        pointerId: event.pointerId,
        sourceId: target.sourceId,
        sceneTextId: target.sceneTextId,
        anchorOffset: provisionalOffset,
        mode,
        anchorLineRange: provisionalLineRange
      };
      const pointerId = event.pointerId;
      const pointerCaptureTarget = event.currentTarget;
      const offsetPromise = resolveTextOffsetFromClient(target, clientPoint);
      const lineRangePromise = mode === "line"
        ? resolveTextLineRangeFromClient(target, clientPoint)
        : Promise.resolve<TextLineRange | null>(null);
      void Promise.all([offsetPromise, lineRangePromise]).then(([offset, lineRange]) => {
        const resolvedOffset = offset == null ? provisionalOffset : clamp(offset, 0, target.text.length);
        const resolvedLineRange = mode === "line"
          ? (
              lineRange
                ? {
                    start: clamp(lineRange.start, 0, target.text.length),
                    end: clamp(lineRange.end, 0, target.text.length)
                  }
                : provisionalLineRange
            )
          : null;
        const selection = resolveTextSelectionRangeForMode(
          target.text,
          mode,
          resolvedOffset,
          resolvedLineRange
        );
        dispatchCanvasTextEditAction({
          type: "pointer_resolved",
          requestRevision,
          baseInputRevision,
          sourceId: target.sourceId,
          sceneTextId: target.sceneTextId,
          pointerId,
          selectionStart: selection.start,
          selectionEnd: selection.end,
          anchorOffset: resolvedOffset,
          anchorLineRange: resolvedLineRange
        });
        if (textSelectionDragRef.current?.pointerId === pointerId) {
          textSelectionDragRef.current = {
            pointerId,
            sourceId: target.sourceId,
            sceneTextId: target.sceneTextId,
            anchorOffset: resolvedOffset,
            mode,
            anchorLineRange: resolvedLineRange
          };
        }
        try {
          pointerCaptureTarget.setPointerCapture(pointerId);
        } catch {
          // Ignore pointer capture failures; the window listeners still complete the drag.
        }
      });
    },
    [
      canvasTransform,
      canvasTextEditState.asyncRequestRevision,
      canvasTextEditState.inputRevision,
      dispatchCanvasTextEditAction,
      interactionSvgRef,
      resolveTextLineRangeFromClient,
      resolveTextOffsetFromClient,
      source,
      startTextEditingSession,
      svgResult,
      textEditingSession,
      viewportRef
    ]
  );

  const dispatchTextEditBeforeInputIntent = useCallback(
    (nativeEvent: InputEvent, textarea: HTMLTextAreaElement) => {
      if (typeof nativeEvent.inputType !== "string") {
        return;
      }
      const inputType = nativeEvent.inputType;
      const isSupported = isCanvasTextInputIntentType(inputType);
      if (isSupported) {
        nativeEvent.preventDefault();
      }
      nativeEvent.stopPropagation();
      let data = nativeEvent.data;
      if (inputType === "insertFromDrop" && data == null) {
        data = nativeEvent.dataTransfer?.getData("text/plain") ?? null;
      }
      if (inputType === "insertText" && data == null) {
        data = pendingTextEditInsertTextRef.current;
      }
      if (inputType === "insertFromPaste" && data == null) {
        data = pendingTextEditPasteRef.current;
      }
      if (inputType === "insertFromPaste") {
        pendingTextEditPasteRef.current = null;
      }
      pendingTextEditInsertTextRef.current = null;
      dispatchCanvasTextEditAction({
        type: "textarea_input_intent",
        inputType,
        data,
        selectionStart: textarea.selectionStart ?? 0,
        selectionEnd: textarea.selectionEnd ?? 0
      });
    },
    [dispatchCanvasTextEditAction]
  );

  const handleTextEditTextareaSelect = useCallback((event: ReactSyntheticEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    dispatchCanvasTextEditAction({
      type: "textarea_selection",
      selectionStart: textarea.selectionStart ?? 0,
      selectionEnd: textarea.selectionEnd ?? 0
    });
  }, [dispatchCanvasTextEditAction]);

  const stopTextEditTextareaClipboardPropagation = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
  }, []);

  const handleTextEditTextareaPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    pendingTextEditPasteRef.current = event.clipboardData.getData("text/plain");
  }, []);

  const handleTextEditTextareaDrop = useCallback((event: ReactDragEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const textarea = event.currentTarget;
    dispatchCanvasTextEditAction({
      type: "textarea_input_intent",
      inputType: "insertFromDrop",
      data: event.dataTransfer.getData("text/plain"),
      selectionStart: textarea.selectionStart ?? 0,
      selectionEnd: textarea.selectionEnd ?? 0
    });
  }, [dispatchCanvasTextEditAction]);

  const handleTextEditTextareaKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      textSelectionDragRef.current = null;
      dispatchCanvasTextEditAction({ type: "session_close" });
      return;
    }

    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const lowerKey = event.key.toLowerCase();
      let historyIntent: "historyUndo" | "historyRedo" | null = null;
      if (lowerKey === "z") {
        historyIntent = event.shiftKey ? "historyRedo" : "historyUndo";
      } else if (lowerKey === "y" && !event.shiftKey) {
        historyIntent = "historyRedo";
      }
      if (historyIntent) {
        pendingTextEditInsertTextRef.current = null;
        event.preventDefault();
        event.stopPropagation();
        const textarea = event.currentTarget;
        dispatchCanvasTextEditAction({
          type: "textarea_input_intent",
          inputType: historyIntent,
          data: null,
          selectionStart: textarea.selectionStart ?? 0,
          selectionEnd: textarea.selectionEnd ?? 0
        });
        return;
      }
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      pendingTextEditInsertTextRef.current = null;
      event.stopPropagation();
      return;
    }
    pendingTextEditInsertTextRef.current = event.key.length === 1 ? event.key : null;
  }, [dispatchCanvasTextEditAction]);

  const handleTextEditPopupPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  useLayoutEffect(() => {
    const textarea = textEditTextareaRef.current;
    if (!textEditingSession || !textarea) {
      return;
    }
    const handleBeforeInput = (event: Event) => {
      const inputEvent = event as InputEvent;
      if (typeof inputEvent.inputType !== "string") {
        return;
      }
      dispatchTextEditBeforeInputIntent(inputEvent, textarea);
    };
    textarea.addEventListener("beforeinput", handleBeforeInput);
    return () => { textarea.removeEventListener("beforeinput", handleBeforeInput); };
  }, [dispatchTextEditBeforeInputIntent, textEditingSession]);

  useEffect(() => {
    const textarea = textEditTextareaRef.current;
    if (!textEditingSession || !textarea) {
      return;
    }
    if (document.activeElement !== textarea) {
      textarea.focus({ preventScroll: true });
    }
    const start = clamp(textEditingSession.selectionStart, 0, textEditingSession.text.length);
    const end = clamp(textEditingSession.selectionEnd, 0, textEditingSession.text.length);
    if (textarea.selectionStart !== start || textarea.selectionEnd !== end) {
      textarea.setSelectionRange(start, end);
    }
  }, [textEditingSession]);

  useEffect(() => {
    const textarea = textEditTextareaRef.current;
    if (!textEditingSession?.isForeachTemplateEdit || !textarea || textEditPopupHeight == null) {
      return;
    }
    if (document.activeElement !== textarea) {
      textarea.focus({ preventScroll: true });
    }
  }, [textEditingSession, textEditPopupHeight]);

  useEffect(() => {
    const textarea = textEditTextareaRef.current;
    if (!textEditingSession || !textarea) {
      return;
    }
    const syncSelectionFromTextarea = () => {
      dispatchCanvasTextEditAction({
        type: "textarea_selection",
        selectionStart: textarea.selectionStart ?? 0,
        selectionEnd: textarea.selectionEnd ?? 0
      });
    };
    const handleDocumentSelectionChange = () => {
      if (document.activeElement === textarea) {
        syncSelectionFromTextarea();
      }
    };
    textarea.addEventListener("select", syncSelectionFromTextarea);
    textarea.addEventListener("mouseup", syncSelectionFromTextarea);
    document.addEventListener("selectionchange", handleDocumentSelectionChange);
    return () => {
      textarea.removeEventListener("select", syncSelectionFromTextarea);
      textarea.removeEventListener("mouseup", syncSelectionFromTextarea);
      document.removeEventListener("selectionchange", handleDocumentSelectionChange);
    };
  }, [dispatchCanvasTextEditAction, textEditingSession]);

  useLayoutEffect(() => {
    const textarea = textEditTextareaRef.current;
    if (!textEditingSession || !textarea) {
      setTextEditCaretOverlay(null);
      return;
    }
    if (textEditingSession.selectionStart !== textEditingSession.selectionEnd) {
      setTextEditCaretOverlay(null);
      return;
    }
    const syncTextEditCaretOverlay = () => {
      const currentTextarea = textEditTextareaRef.current;
      if (!currentTextarea) {
        setTextEditCaretOverlay(null);
        return;
      }
      const caretOffset = clamp(
        textEditingSession.selectionStart,
        0,
        textEditingSession.text.length
      );
      const measuredRect = resolveTextareaCaretClientRect(currentTextarea, caretOffset);
      if (!measuredRect) {
        setTextEditCaretOverlay(null);
        return;
      }
      const textareaRect = currentTextarea.getBoundingClientRect();
      const rawLeft = measuredRect.left - textareaRect.left;
      const rawTop = measuredRect.top - textareaRect.top;
      const minLeft = 0;
      const maxLeft = textareaRect.width;
      const height = Math.max(1, Math.min(measuredRect.height, textareaRect.height));
      const minTop = 0;
      const maxTop = textareaRect.height - height;
      const nextOverlay = {
        left: clamp(rawLeft, minLeft, maxLeft),
        top: clamp(rawTop, minTop, maxTop),
        height
      };
      setTextEditCaretOverlay((current) => {
        if (
          current &&
          Math.abs(current.left - nextOverlay.left) <= TEXT_CARET_OVERLAY_EPSILON_PX &&
          Math.abs(current.top - nextOverlay.top) <= TEXT_CARET_OVERLAY_EPSILON_PX &&
          Math.abs(current.height - nextOverlay.height) <= TEXT_CARET_OVERLAY_EPSILON_PX
        ) {
          return current;
        }
        return nextOverlay;
      });
    };

    syncTextEditCaretOverlay();
    textarea.addEventListener("focus", syncTextEditCaretOverlay);
    textarea.addEventListener("input", syncTextEditCaretOverlay);
    textarea.addEventListener("select", syncTextEditCaretOverlay);
    textarea.addEventListener("keyup", syncTextEditCaretOverlay);
    textarea.addEventListener("mouseup", syncTextEditCaretOverlay);
    textarea.addEventListener("scroll", syncTextEditCaretOverlay, { passive: true });
    const windowRef = textarea.ownerDocument.defaultView;
    windowRef?.addEventListener("resize", syncTextEditCaretOverlay);
    return () => {
      textarea.removeEventListener("focus", syncTextEditCaretOverlay);
      textarea.removeEventListener("input", syncTextEditCaretOverlay);
      textarea.removeEventListener("select", syncTextEditCaretOverlay);
      textarea.removeEventListener("keyup", syncTextEditCaretOverlay);
      textarea.removeEventListener("mouseup", syncTextEditCaretOverlay);
      textarea.removeEventListener("scroll", syncTextEditCaretOverlay);
      windowRef?.removeEventListener("resize", syncTextEditCaretOverlay);
    };
  }, [textEditingSession, textEditPopupHeight]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = textSelectionDragRef.current;
      if (drag?.pointerId !== event.pointerId) {
        return;
      }
      if (event.pointerType === "mouse" && event.buttons === 0) {
        textSelectionDragRef.current = null;
        return;
      }
      const target = resolveEditableTextTargetById(drag.sourceId, drag.sceneTextId);
      if (!target) {
        textSelectionDragRef.current = null;
        return;
      }
      const requestRevision = canvasTextEditStateRef.current.asyncRequestRevision;
      const baseInputRevision = canvasTextEditStateRef.current.inputRevision;
      const clientPoint = makeClientPoint(px(event.clientX), px(event.clientY));
      const offsetPromise = resolveTextOffsetFromClient(target, clientPoint);
      const lineRangePromise = drag.mode === "line"
        ? resolveTextLineRangeFromClient(target, clientPoint)
        : Promise.resolve<TextLineRange | null>(null);
      void Promise.all([offsetPromise, lineRangePromise]).then(([offset, focusLineRange]) => {
        const resolvedOffset = offset == null ? drag.anchorOffset : clamp(offset, 0, target.text.length);
        const selection = resolveTextSelectionRangeForDrag(
          target.text,
          drag.mode,
          drag.anchorOffset,
          resolvedOffset,
          drag.anchorLineRange,
          focusLineRange
        );
        dispatchCanvasTextEditAction({
          type: "drag_resolved",
          requestRevision,
          baseInputRevision,
          sourceId: target.sourceId,
          sceneTextId: target.sceneTextId,
          selectionStart: selection.start,
          selectionEnd: selection.end
        });
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = textSelectionDragRef.current;
      if (drag?.pointerId !== event.pointerId) {
        return;
      }
      textSelectionDragRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [
    dispatchCanvasTextEditAction,
    resolveEditableTextTargetById,
    resolveTextLineRangeFromClient,
    resolveTextOffsetFromClient
  ]);

  useEffect(() => {
    if (!textEditingSession) {
      return;
    }
    const handleGlobalPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (viewportRef.current?.contains(target)) {
        return;
      }
      textSelectionDragRef.current = null;
      dispatchCanvasTextEditAction({ type: "session_close" });
    };
    window.addEventListener("pointerdown", handleGlobalPointerDown, true);
    return () => { window.removeEventListener("pointerdown", handleGlobalPointerDown, true); };
  }, [dispatchCanvasTextEditAction, textEditingSession]);

  const handleNodePositionTargetPick = useCallback(
    (targetId: string): boolean => {
      if (!pendingNodePositionTargetPick) {
        return false;
      }
      const target = pendingNodePositionTargetAnchors.find((anchor) => anchor.nodeSourceId === targetId);
      if (!target?.nodeSourceId) {
        return true;
      }
      const status = pendingNodePositionTargetStatusBySourceId.get(target.nodeSourceId);
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
    svgResult,
    toolMode,
    selectedElementIds,
    suppressNextBackgroundClickRef,
    viewportRef,
    beginCanvasTextInteraction,
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
        activeFigureId,
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
    activeFigureId,
    parseOptions: editParseOptions,
    onNodePositionTargetPick: handleNodePositionTargetPick
  });

  const {
    onHandlePointerDown,
    onResizeHandlePointerDown,
    onRotateHandlePointerDown
  } = useCanvasHandleInteractions({
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
      onBackgroundClick(event);
    },
    [clearPendingNodePositionTargetPick, onBackgroundClick, pendingNodePositionTargetPick]
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
    canvasTransform,
    canvasTransformRef,
    selectedElementIds,
    selectedElementIdsRef,
    svgResult,
    svgResultRef,
    fitToContentModeActive,
    fitToContentModeActiveRef,
    sourceBoundsSvg,
    sourceBoundsSvgRef,
    resizeFramesBySource,
    liveResizeFramesRef,
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
    activeFigureId,
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
    if (showDevPanel) {
      return;
    }
    snapDebugDragRef.current = null;
    document.body.classList.remove("is-dragging-snap-debug");
    document.body.classList.remove("is-resizing-snap-debug");
    setSnapDebug(null);
  }, [showDevPanel]);

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

  useCanvasTextEditingEffects({
    toolMode,
    textEditingSession,
    textEditAsyncRequestRevision: canvasTextEditState.asyncRequestRevision,
    dispatchCanvasTextEditAction,
    selectedElementIds,
    resolveEditableTextTargetById,
    resolveRenderedMathTextElement,
    viewportRef,
    pendingAdornmentTextEditTargetId,
    snapshot,
    source,
    sourceRevision,
    startTextEditingSession,
    setPendingAdornmentTextEditTargetId,
    canvasTransform,
    svgResult
  });

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

  const dragControllerConfig = useMemo(() => ({
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
  const textEditPopup = useMemo(() => {
    if (!textEditingSession || !svgResult) {
      return null;
    }
    const minPadding = 12;
    const popupGap = 10;
    const popupChromeWidth = 14;
    const popupHeight = textEditPopupHeight ?? 0;
    const contentBox = resolveRectHitRegionContentBox(textEditingSession.region);
    const popupAnchorBox = textEditingSession.popupAnchorBox;
    const sourceBounds = popupAnchorBox ? undefined : sourceBoundsSvg.get(textEditingSession.sourceId);
    const anchorLeft = popupAnchorBox?.minX ?? sourceBounds?.minX ?? contentBox.x;
    const anchorRight = popupAnchorBox?.maxX ?? sourceBounds?.maxX ?? (contentBox.x + contentBox.width);
    const anchorTop = popupAnchorBox?.minY ?? sourceBounds?.minY ?? contentBox.y;
    const anchorBottom = popupAnchorBox?.maxY ?? sourceBounds?.maxY ?? (contentBox.y + contentBox.height);
    const leftEdge =
      canvasTransform.translateX + (anchorLeft - svgResult.viewBox.x) * canvasTransform.scale;
    const rightEdge =
      canvasTransform.translateX + (anchorRight - svgResult.viewBox.x) * canvasTransform.scale;
    const topEdge =
      canvasTransform.translateY + (anchorTop - svgResult.viewBox.y) * canvasTransform.scale;
    const bottomEdge =
      canvasTransform.translateY + (anchorBottom - svgResult.viewBox.y) * canvasTransform.scale;
    const centerX = (leftEdge + rightEdge) / 2;
    const nodeWidthPx = rightEdge - leftEdge;
    const contentWidthPx = Math.max(contentBox.width * canvasTransform.scale, 1);
    const maxWidth = clamp(Math.round(nodeWidthPx + 80), 160, viewportSize.width - minPadding * 2);
    const textareaWidth = clamp(
      Math.round(contentWidthPx),
      48,
      Math.max(48, maxWidth - popupChromeWidth)
    );
    let top = bottomEdge + popupGap;
    if (top + popupHeight > viewportSize.height - minPadding) {
      top = topEdge - popupHeight - popupGap;
    }
    return {
      centerX: clamp(centerX, minPadding + maxWidth / 2, viewportSize.width - minPadding - maxWidth / 2),
      top: clamp(top, minPadding, Math.max(minPadding, viewportSize.height - popupHeight - minPadding)),
      maxWidth,
      textareaWidth
    };
  }, [
    canvasTransform.scale,
    canvasTransform.translateX,
    canvasTransform.translateY,
    svgResult,
    sourceBoundsSvg,
    textEditingSession,
    textEditPopupHeight,
    viewportSize.height,
    viewportSize.width
  ]);

  useLayoutEffect(() => {
    const textarea = textEditTextareaRef.current;
    if (!textarea) {
      return;
    }
    if (!textEditingSession || supportsFieldSizing) {
      textarea.style.height = "";
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.ceil(textarea.scrollHeight)}px`;
  }, [supportsFieldSizing, textEditingSession, textEditPopup?.textareaWidth]);

  useLayoutEffect(() => {
    if (!textEditingSession || !textEditPopup) {
      setTextEditPopupHeight(null);
      return;
    }

    const popup = textEditPopupRef.current;
    if (!popup) {
      return;
    }

    const nextHeight = Math.ceil(popup.getBoundingClientRect().height);
    setTextEditPopupHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
  }, [textEditingSession, textEditPopup]);

  const hideNativeTextEditCaret =
    textEditingSession != null &&
    textEditingSession.selectionStart === textEditingSession.selectionEnd &&
    textEditCaretOverlay != null;

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
        onCanvasContextMenu={onCanvasContextMenu}
        rulers={rulers}
        LEFT_RULER_DRAG_SOURCE_WIDTH_PX={LEFT_RULER_DRAG_SOURCE_WIDTH_PX}
        toolMode={toolMode}
        viewportRef={viewportRef}
        onViewportKeyDown={onViewportKeyDown}
        onViewportCopy={onViewportCopy}
        onViewportCut={onViewportCut}
        onViewportPaste={onViewportPaste}
        onViewportDragOver={onViewportDragOver}
        onViewportDrop={onViewportDrop}
        onBackgroundClick={handleBackgroundClick}
        onViewportPointerDown={onViewportPointerDown}
        onViewportPointerUp={onViewportPointerUp}
        svgResult={svgResult}
        noActiveFigure={snapshot.figures.length > 0 && snapshot.activeFigureId == null}
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
        onElementContextMenu={onElementContextMenu}
        onElementDoubleClick={onElementDoubleClick}
        onHoverChange={(id: string | null) => { dispatch({ type: "SET_HOVERED_ELEMENT", id }); }}
        nodePositionLinks={nodePositionLinks}
        marqueeBounds={marqueeBounds}
        selectionBoxes={selectionBoxes}
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
        dragTooltipBoundary={dragTooltipBoundaryRef.current}
        warning={warning}
        copyWarningToClipboard={copyWarningToClipboard}
        onWarningBarKeyDown={onWarningBarKeyDown}
        textEditingSession={textEditingSession}
        textEditPopup={textEditPopup}
        textEditPopupHeight={textEditPopupHeight}
        textEditPopupRef={textEditPopupRef}
        textEditTextareaSizing={textEditTextareaSizing}
        textEditTextareaRef={textEditTextareaRef}
        textEditCaretOverlay={textEditCaretOverlay}
        hideNativeTextEditCaret={hideNativeTextEditCaret}
        onTextEditPopupPointerDown={handleTextEditPopupPointerDown}
        onTextEditTextareaSelect={handleTextEditTextareaSelect}
        onTextEditTextareaCopy={stopTextEditTextareaClipboardPropagation}
        onTextEditTextareaCut={stopTextEditTextareaClipboardPropagation}
        onTextEditTextareaPaste={handleTextEditTextareaPaste}
        onTextEditTextareaDrop={handleTextEditTextareaDrop}
        onTextEditTextareaKeyDown={handleTextEditTextareaKeyDown}
        selectionHint={canvasSelectionHint}
        showDevPanel={false}
        snapDebugRect={snapDebugRect}
        onSnapDebugMovePointerDown={onSnapDebugMovePointerDown}
        snapDebug={snapDebug}
        onSnapDebugResizePointerDown={onSnapDebugResizePointerDown}
        magnifierState={magnifierState}
        RULER_SIZE={RULER_SIZE}
      />
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
