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
  type ChangeEvent as ReactChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent as ReactSyntheticEvent
} from "react";
import { useShallow } from "zustand/react/shallow";
import type { AppMenuCommandId } from "../app-menu";
import { buildCanvasContextMenuDefinition, type CanvasContextMenuTarget } from "../context-menu";
import { collectGeometryInvalidation } from "tikz-editor/semantic/index";
import {
  ADORNMENT_EDIT_NOOP_REASON,
  PATH_ATTACHED_NODE_EDIT_NOOP_REASON,
  applyEditAction,
  type EditAction,
  type ResizeRole
} from "tikz-editor/edit/actions";
import { formatNumber } from "tikz-editor/edit/format";
import { createMathJaxNodeTextEngine, getActiveMathJaxOutputJax } from "tikz-editor/text/mathjax-engine";
import {
  getKnuthPlassCaretFromPoint,
  getKnuthPlassLineRangeFromPoint,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects
} from "tikz-editor/text/knuth-plass";
import {
  buildSnapContext,
  collectSelectionGeometry,
  snapKeyboardNudge,
  snapToolPointer,
  type SnapLine
} from "tikz-editor/edit/snapping";
import type { NodeTextEngine, NodeTextLayoutKind } from "tikz-editor/text/types";
import type { Statement } from "tikz-editor/ast/types";
import { PT_PER_CM } from "tikz-editor/edit/format";
import { replaceSpan } from "tikz-editor/edit/patch";
import { resolveEligibleExplicitPath } from "tikz-editor/edit/path-editing";
import {
  makeForeachTemplateTargetId,
  resolvePropertyTarget,
  resolvePropertyTargetFromParseResult
} from "tikz-editor/edit/property-target";
import {
  EditHandle,
  NodeAnchorTarget,
  Point,
  SceneElement,
  ScenePath,
  SceneText
} from "tikz-editor/semantic/types";
import { renderTikzToSvg } from "tikz-editor/render/index";
import { type SvgDiffHints, type SvgViewBox } from "tikz-editor/svg/index";
import type { SvgRenderModel } from "tikz-editor/svg";
import { getSharedEditAnalysisView, getSharedEditAnalysisSession } from "../edit-analysis-manager";
import { useEditorStore } from "../store/store";
import type { CanvasDragKind, CanvasTransform } from "../store/types";
import { getActiveEditorPlatform } from "../platform/current";
import { buildHitRegions, type HitRegion } from "./canvas-panel/hit-regions";
import { computeDragCapability } from "./canvas-panel/drag-capability";
import { deriveCurveControlLines } from "./canvas-panel/curve-controls";
import { resolveBucketFillEdit } from "./canvas-panel/bucket-fill";
import { resolveEndpointAnchorSnap } from "./canvas-panel/endpoint-anchor-snap";
import {
  boundsFromPoints,
  collectSourceIdsInBounds,
  pickClosestSourceId,
  resolveBezierControlsFromBend
} from "./canvas-panel/interaction-helpers";
import { useCanvasDragController } from "./canvas-panel/useCanvasDragController";
import type {
  ApplyActionFeedback,
  Bounds,
  DragState,
  DragTooltipState,
  EditableTextTarget,
  FreehandToolDraft,
  GuideDragState,
  GuidePreview,
  GuidesState,
  NodeAnchorOverlayState,
  PendingTouchViewport,
  PendingAddedSelection,
  PendingBezier,
  PathToolDraft,
  SelectionBounds,
  SnapDebugLogInput,
  TextEditingSession,
  TextSelectionOverlay
} from "./canvas-panel/types";
import {
  buildValueSequence,
  buildTicks,
  clamp,
  clientToSvgPoint,
  clientToWorldPoint,
  computeVisibleRanges,
  distanceSquared,
  fmt,
  isMultipleOfStep,
  resizeCursorForVector,
  resolveOverlayGridSteps,
  rotatePointAroundCenter,
  toViewportXFromWorld,
  toViewportYFromWorld,
  vectorLengthSquared,
  viewportToSvgPoint,
  viewportToWorldPoint,
  worldToSvgPoint,
  worldToSvgY,
  type RulerTick,
  type VisibleRanges
} from "./canvas-panel/geometry";
import {
  clampSnapDebugOverlayRect,
  summarizeSnapContextForDebug,
  summarizeSnapLinesForDebug,
  toDebugPoint,
  type SnapDebugContextSummary,
  type SnapDebugLineSummary,
  type SnapDebugOverlayRect,
  type SnapDebugPoint
} from "./canvas-panel/snap-debug";
import {
  CurveControlOverlay,
  HandleOverlay,
  HitRegionLayer,
  NodeAnchorOverlay,
  SelectionDragLayer,
  SelectionOverlay,
  SnapOverlay,
  ToolPreviewOverlay
} from "./canvas-panel/overlays";
import { resolveCanvasContextMenuTarget } from "./canvas-panel/context-menu-target";
import { resolveNodeAdornmentContextAction } from "./canvas-panel/node-adornment-context-action";
import {
  appendPathToolSegmentFromGesture,
  createPathToolDraft,
  generateAppendSegmentSource,
  generatePathToolSource,
  pathToolCanClose,
  pathToolCloseRadiusWorld,
  pathToolCurrentPoint,
  pathToolHasDrawableSegments,
  pathToolShouldClose,
  type PathToolGestureSegment
} from "./canvas-panel/path-tool";
import {
  appendFreehandToolPoint,
  createFreehandToolDraft,
  generateFreehandToolSource,
  resolveFreehandPreviewSegments
} from "./canvas-panel/freehand-tool";
import {
  RESIZE_FRAME_CORNER_ROLES,
  resolveResizeFrameForSource
} from "./canvas-panel/resize-frames";
import { angleDeg, resolveRotateHandlePosition } from "./canvas-panel/rotate-handle";
import {
  isToolCreateMode,
  type ToolCreateMode
} from "./tool-config";
import { CanvasContextMenu } from "./CanvasContextMenu";
import { useEditorCommandRuntime } from "./editor-command-runtime";
import { CanvasPanelView } from "./canvas-panel/CanvasPanelView";
import { useCanvasDerivedState } from "./canvas-panel/useCanvasDerivedState";
import { useCanvasGuidesAndRulers } from "./canvas-panel/useCanvasGuidesAndRulers";
import { useCanvasSelectionInteractions } from "./canvas-panel/useCanvasSelectionInteractions";
import { useCanvasToolInteractions } from "./canvas-panel/useCanvasToolInteractions";
import { useCanvasHandleInteractions } from "./canvas-panel/useCanvasHandleInteractions";
import { useCanvasKeyboardClipboard } from "./canvas-panel/useCanvasKeyboardClipboard";
import { useCanvasElementInteractions } from "./canvas-panel/useCanvasElementInteractions";
import { useCanvasGuideEffects } from "./canvas-panel/useCanvasGuideEffects";
import { useCanvasViewportEffects } from "./canvas-panel/useCanvasViewportEffects";
import { useCanvasTextEditingEffects } from "./canvas-panel/useCanvasTextEditingEffects";
import { createSourceRenderOffsetMap } from "./canvas-panel/text-offset-map";
import { useCanvasSelectionDerivedState } from "./canvas-panel/useCanvasSelectionDerivedState";
import {
  isWorldPointWithinScopeBounds,
  resolveFocusedScopeIdForSelection
} from "./canvas-panel/scope-overlay";
import {
  copySelection,
  copySelectionToClipboardData,
  cutSelection,
  cutSelectionToClipboardData,
  pasteSelectionFromPayload,
  pasteSelectionFromClipboardData,
  pasteSnippetsWithOffset
} from "./editor-commands";
import {
  formatEquationText,
  resolveEquationNodeTarget,
  type EquationNodeTarget
} from "./equation-utils";
import { parseClipboardPayloadJson } from "./editor-clipboard";
import {
  buildScopeWrappedSnippet,
  convertSvgToScopeSnippet,
  dataTransferHasFilePayload,
  findSvgFileInDataTransfer
} from "./svg-import";
import {
  buildAnchoredGridPreviewLines,
  canvasDragKindFromDragState,
  caretStrokeWidthInSvg,
  collectMatrixStatementSourceIds,
  collectNewSourceIds,
  collectSelectionBounds,
  collectSourceBounds,
  dragCursorForState,
  ellipseAspectRatioForSource,
  getHandleCursor,
  isPointInsideRect,
  isPointInsideRectHitRegionContentBox,
  mapPointToRectRegionLocal,
  makeMergeKey,
  preferredNodeBoundsForSource,
  previewArrowPoints,
  rectHitRegionsForTargetId,
  resolveAdornmentOwnerBoundaryPoint,
  resolveBoundsEdgePointToward,
  resolveRectHitRegionContentBox,
  removeGuideValue,
  findPathStatementById,
  resolveRotateDegreesFromOptions,
  resolveGridResizeSnapForHandleDrag,
  resolveScenePathShapeHint,
  resizeCursorForRole,
  selectNudgeAnchorHandle,
  selectionAnchorRatioFromPoint,
  sourceHasSingleResizablePathShape,
  upsertGuideValue
} from "./canvas-panel/panel-helpers";
import { useSettingsStore } from "../settings/useSettingsStore";
import { GRID_SIZE_MINOR_TARGET_PX } from "../settings/types";
import { RenderedTooltip } from "./RenderedTooltip";
import css from "./CanvasPanel.module.css";

type DiagnosticRow = {
  severity: "error" | "warning";
  message: string;
  code?: string;
  source: "parse" | "semantic";
};


type HandleDisplay =
  | {
      key: string;
      x: number;
      y: number;
      cursor: string;
      kind: "move-handle";
      handle: EditHandle;
    }
  | {
      key: string;
      x: number;
      y: number;
      cursor: string;
      kind: "move-element";
      elementId: string;
    }
  | {
      key: string;
      x: number;
      y: number;
      cursor: string;
      kind: "resize-element";
      elementId: string;
      role: ResizeRole;
      rotationDeg: number;
    }
  | {
      key: string;
      x: number;
      y: number;
      anchorX: number;
      anchorY: number;
      centerWorld: Point;
      cursor: string;
      kind: "rotate-element";
      elementId: string;
    };

type GridLines = {
  verticalMinor: number[];
  verticalMajor: number[];
  horizontalMinor: number[];
  horizontalMajor: number[];
  yMin: number;
  yMax: number;
};

type ToolPreview =
  | { kind: "cursor"; x: number; y: number }
  | { kind: "node"; x: number; y: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; arrow: boolean }
  | { kind: "bezier"; x1: number; y1: number; c1x: number; c1y: number; c2x: number; c2y: number; x2: number; y2: number }
  | {
      kind: "complex-path";
      startX: number;
      startY: number;
      closeCandidate: boolean;
      canClose: boolean;
      segments: Array<
        | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
        | { kind: "bezier"; x1: number; y1: number; c1x: number; c1y: number; c2x: number; c2y: number; x2: number; y2: number }
      >;
    }
  | {
      kind: "freehand";
      segments: Array<
        | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
        | { kind: "bezier"; x1: number; y1: number; c1x: number; c1y: number; c2x: number; c2y: number; x2: number; y2: number }
      >;
    }
  | { kind: "grid"; x: number; y: number; width: number; height: number; verticalLines: number[]; horizontalLines: number[] }
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "circle"; cx: number; cy: number; r: number };

type BucketPreviewSession = {
  sourceId: string;
  colorToken: string;
  baseSource: string;
  previewSource: string;
};

type CanvasContextMenuState = {
  target: CanvasContextMenuTarget;
  anchorX: number;
  anchorY: number;
  handleIdOverride?: string | null;
  includeEditEquationForSingleNode?: boolean;
  includeMatrixMultiRemoveRow?: boolean;
  includeMatrixMultiRemoveColumn?: boolean;
  includeMatrixMultiInsertRowAbove?: boolean;
  includeMatrixMultiInsertRowBelow?: boolean;
  includeMatrixMultiInsertColumnLeft?: boolean;
  includeMatrixMultiInsertColumnRight?: boolean;
};

type PendingNativeContextMenuRequest = {
  clientX: number;
  clientY: number;
  clickedSourceId: string;
  clickedHandleId: string | null;
};

type TextEditCaretOverlay = {
  left: number;
  top: number;
  height: number;
};

const NATIVE_CONTEXT_MENU_SELECT_DELAY_MS = 75;

const EquationModal = lazy(async () => {
  const mod = await import("./EquationModal");
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

type SnapDebugOverlayDragState =
  | {
      kind: "move";
      startClientX: number;
      startClientY: number;
      startLeft: number;
      startTop: number;
    }
  | {
      kind: "resize";
      startClientX: number;
      startClientY: number;
      startWidth: number;
      startHeight: number;
    };

const RULER_SIZE = 24;
const FIT_PADDING = 44;
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const NUDGE_STEP_PT = 0.05 * PT_PER_CM;
const NUDGE_STEP_SHIFT_PT = 0.25 * PT_PER_CM;
const ROTATE_HANDLE_OFFSET_PX = 24;
const TOOL_PREVIEW_CIRCLE_RADIUS_PT = 0.8 * PT_PER_CM;
const TOOL_PREVIEW_GRID_STEP_PT = PT_PER_CM;
const TOOL_PREVIEW_GRID_MAX_LINES = 120;
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
const DENSE_PATH_SEGMENT_THRESHOLD = 7;
const DOCUMENT_BOUNDS_OFF_MIN_PADDING_WORLD = 200;
const TEXT_CARET_OVERLAY_EPSILON_PX = 0.25;

type FigureViewportState = {
  transform: CanvasTransform;
  fitToContentModeActive: boolean;
};

function hasCaretPositionSupport(documentRef: Document): boolean {
  const candidate = documentRef as Document & { caretPositionFromPoint?: unknown };
  return typeof candidate.caretPositionFromPoint === "function";
}

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
  mirror.style.boxSizing = computed.boxSizing;
  mirror.style.left = `${textareaRect.left}px`;
  mirror.style.top = `${textareaRect.top}px`;
  mirror.style.width = `${textareaRect.width}px`;
  mirror.style.height = `${textareaRect.height}px`;
  mirror.style.border = computed.border;
  mirror.style.padding = computed.padding;
  mirror.style.font = computed.font;
  mirror.style.letterSpacing = computed.letterSpacing;
  mirror.style.lineHeight = computed.lineHeight;
  mirror.style.textAlign = computed.textAlign;
  mirror.style.tabSize = computed.tabSize;
  mirror.style.textIndent = computed.textIndent;
  mirror.style.textTransform = computed.textTransform;
  mirror.style.textRendering = computed.textRendering;
  mirror.style.direction = computed.direction;
  mirror.style.fontKerning = computed.fontKerning;
  mirror.style.fontVariantLigatures = computed.fontVariantLigatures;

  marker.textContent = afterCaret.length > 0 ? afterCaret : " ";

  try {
    mirror.append(beforeCaret, marker);
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

function refineCaretClientRectWithCaretPosition(
  textarea: HTMLTextAreaElement,
  fallbackRect: DOMRect
): DOMRect {
  const documentRef = textarea.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { getClientRect?: () => DOMRect } | null;
  };
  if (typeof documentRef.caretPositionFromPoint !== "function") {
    return fallbackRect;
  }

  const probeX = fallbackRect.left + 1;
  const probeY = fallbackRect.top + Math.max(1, fallbackRect.height / 2);
  const caretPosition = documentRef.caretPositionFromPoint(probeX, probeY);
  const refinedRect = caretPosition?.getClientRect?.();
  if (!refinedRect) {
    return fallbackRect;
  }
  if (!Number.isFinite(refinedRect.left) || !Number.isFinite(refinedRect.top)) {
    return fallbackRect;
  }

  const textareaRect = textarea.getBoundingClientRect();
  if (
    refinedRect.left < textareaRect.left - 1 ||
    refinedRect.left > textareaRect.right + 1 ||
    refinedRect.top < textareaRect.top - 1 ||
    refinedRect.top > textareaRect.bottom + 1
  ) {
    return fallbackRect;
  }
  const height = Math.max(1, refinedRect.height || resolveTextareaLineHeightPx(textarea));
  return new DOMRect(refinedRect.left, refinedRect.top, 1, height);
}

type TextSelectionDragMode = "char" | "word" | "line";

type TextLineRange = {
  start: number;
  end: number;
};

function makeFigureViewportKey(documentId: string, figureId: string | null): string {
  return `${documentId}::${figureId ?? "__none__"}`;
}

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

function collectLogicalLineRanges(text: string): TextLineRange[] {
  if (text.length === 0) {
    return [{ start: 0, end: 0 }];
  }
  const ranges: TextLineRange[] = [];
  let start = 0;
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] === "\r") {
      const next = text[cursor + 1] === "\n" ? cursor + 2 : cursor + 1;
      ranges.push({ start, end: cursor });
      start = next;
      cursor = next;
      continue;
    }
    if (text[cursor] === "\n") {
      ranges.push({ start, end: cursor });
      start = cursor + 1;
      cursor += 1;
      continue;
    }
    if (text[cursor] === "\\" && text[cursor + 1] === "\\") {
      let next = cursor + 2;
      if (text[next] === "*") {
        next += 1;
      }
      while (next < text.length && /\s/.test(text[next] ?? "")) {
        next += 1;
      }
      if (text[next] === "[") {
        let bracketCursor = next + 1;
        while (bracketCursor < text.length && text[bracketCursor] !== "]") {
          bracketCursor += 1;
        }
        if (bracketCursor < text.length) {
          next = bracketCursor + 1;
        }
      }
      ranges.push({ start, end: cursor });
      start = next;
      cursor = next;
      continue;
    }
    cursor += 1;
  }
  ranges.push({ start, end: text.length });
  return ranges;
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

function estimateTextOffsetFromClient(
  target: EditableTextTarget,
  clientX: number,
  clientY: number,
  interactionSvgElement: SVGSVGElement | null,
  viewportRef: { current: HTMLDivElement | null },
  svgResult: { viewBox: SvgViewBox } | null,
  canvasTransform: CanvasTransform
): number {
  const contentBox = resolveRectHitRegionContentBox(target.region);
  const svgPoint = clientToSvgPoint(clientX, clientY, interactionSvgElement) ?? (() => {
    const viewportRect = viewportRef.current?.getBoundingClientRect();
    const localViewportX = viewportRect ? clientX - viewportRect.left : clientX;
    const localViewportY = viewportRect ? clientY - viewportRect.top : clientY;
    return svgResult
      ? viewportToSvgPoint(localViewportX, localViewportY, canvasTransform, svgResult.viewBox)
      : { x: clientX, y: clientY };
  })();
  const localPoint = mapPointToRectRegionLocal(svgPoint, target.region);
  const xRatio =
    contentBox.width <= 1e-6
      ? 1
      : clamp((localPoint.x - contentBox.x) / contentBox.width, 0, 1);
  return clamp(Math.round(xRatio * target.text.length), 0, target.text.length);
}

function estimateTextLineRangeFromClient(
  target: EditableTextTarget,
  clientX: number,
  clientY: number,
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
    return ranges[0]!;
  }

  const contentBox = resolveRectHitRegionContentBox(target.region);
  const svgPoint = clientToSvgPoint(clientX, clientY, interactionSvgElement) ?? (() => {
    const viewportRect = viewportRef.current?.getBoundingClientRect();
    const localViewportX = viewportRect ? clientX - viewportRect.left : clientX;
    const localViewportY = viewportRect ? clientY - viewportRect.top : clientY;
    return svgResult
      ? viewportToSvgPoint(localViewportX, localViewportY, canvasTransform, svgResult.viewBox)
      : { x: clientX, y: clientY };
  })();
  const localPoint = mapPointToRectRegionLocal(svgPoint, target.region);
  const yRatio =
    contentBox.height <= 1e-6
      ? 0
      : clamp((localPoint.y - contentBox.y) / contentBox.height, 0, 0.999999);
  const index = Math.min(ranges.length - 1, Math.max(0, Math.floor(yRatio * ranges.length)));
  return ranges[index] ?? ranges[ranges.length - 1]!;
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

function mergeBoundsList(boundsList: readonly Bounds[]): Bounds | null {
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
  return { minX, minY, maxX, maxY };
}

function boundsMaxDimension(bounds: Bounds): number {
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
    zoomRequestToken,
    zoomRequestDirection,
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
    zoomRequestToken: s.zoomRequestToken,
    zoomRequestDirection: s.zoomRequestDirection,
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
  const parseDiags = snapshot.parseResult?.diagnostics;
  const semanticDiags = snapshot.semanticResult?.diagnostics;

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
  const [guides, setGuides] = useState<GuidesState>({ vertical: [], horizontal: [] });
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
  const [toolCursorWorld, setToolCursorWorld] = useState<Point | null>(null);
  const [magnifierState, setMagnifierState] = useState<{ pointerId: number; x: number; y: number } | null>(null);
  const [pathDraft, setPathDraft] = useState<PathToolDraft | null>(null);
  const [freehandDraft, setFreehandDraft] = useState<FreehandToolDraft | null>(null);
  const [pathSegmentDraft, setPathSegmentDraft] = useState<Extract<DragState, { kind: "tool-path-segment" }> | null>(null);
  const [toolDraft, setToolDraft] = useState<Extract<DragState, { kind: "tool-create" }> | null>(null);
  const [bezierBendDraft, setBezierBendDraft] = useState<Extract<DragState, { kind: "tool-bezier-bend" }> | null>(null);
  const [pendingBezier, setPendingBezier] = useState<PendingBezier | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<Extract<DragState, { kind: "marquee" }> | null>(null);
  const [nodeAnchorOverlay, setNodeAnchorOverlay] = useState<NodeAnchorOverlayState | null>(null);
  const [textSelectionOverlay, setTextSelectionOverlay] = useState<TextSelectionOverlay | null>(null);
  const [textEditingSession, setTextEditingSession] = useState<TextEditingSession | null>(null);
  const [pendingAdornmentTextEditTargetId, setPendingAdornmentTextEditTargetId] = useState<string | null>(null);
  const [pathAttachedNodePreview, setPathAttachedNodePreview] = useState<{ sourceId: string; dx: number; dy: number } | null>(null);
  const [dragPatchMode, setDragPatchMode] = useState<"partial" | "full">("partial");
  const [dragAffectedSourceIds, setDragAffectedSourceIds] = useState<string[] | null>(null);
  const [contextMenuState, setContextMenuState] = useState<CanvasContextMenuState | null>(null);
  const [equationModalTarget, setEquationModalTarget] = useState<EquationNodeTarget | null>(null);
  const [pendingNativeContextMenuRequest, setPendingNativeContextMenuRequest] =
    useState<PendingNativeContextMenuRequest | null>(null);
  const [fitToContentModeActive, setFitToContentModeActive] = useState(true);
  const [expandedDensePathSourceId, setExpandedDensePathSourceId] = useState<string | null>(null);
  const bucketPreviewSessionRef = useRef<BucketPreviewSession | null>(null);
  const contextMenuContextRef = useRef<{ clickedTargetId: string | null; clickedWorld: Point | null }>({
    clickedTargetId: null,
    clickedWorld: null
  });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const accessibility = platform.accessibility;
    if (!accessibility) {
      setPrefersNonBlinkingTextInsertionIndicator(false);
      return () => undefined;
    }

    const prefersPromise = accessibility.prefersNonBlinkingTextInsertionIndicator?.();
    if (prefersPromise) {
      void prefersPromise
        .then((value) => {
          if (!cancelled && typeof value === "boolean") {
            setPrefersNonBlinkingTextInsertionIndicator(value);
          }
        })
        .catch(() => undefined);
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
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [platform.accessibility]);
  const pendingNativeContextMenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textEditingSessionRef = useRef<TextEditingSession | null>(null);
  useLayoutEffect(() => {
    textEditingSessionRef.current = textEditingSession;
  }, [textEditingSession]);

  const contextMenuHandleIdOverride =
    pendingNativeContextMenuRequest?.clickedHandleId ?? contextMenuState?.handleIdOverride;
  const editParseOptions = useMemo(
    () => ({
      activeFigureId:
        activeFigureId == null
          ? (snapshot.figures.length > 1 ? null : undefined)
          : activeFigureId,
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

  const commandRuntime = useEditorCommandRuntime({
    onAddNodeAdornment: (kind) => {
      const result = resolveNodeAdornmentContextAction({
        source,
        clickedTargetId: contextMenuContextRef.current.clickedTargetId,
        selectedTargetId: selectedElementIds.size === 1 ? [...selectedElementIds][0] ?? null : null,
        clickedWorld: contextMenuContextRef.current.clickedWorld,
        sceneElements: snapshot.scene?.elements ?? [],
        viewBox: svgResult?.viewBox ?? null,
        adornmentKind: kind,
        text: kind === "pin" ? "Pin" : "Label",
        parseOptions: editParseOptions
      });
      if (result.kind !== "ready") {
        return;
      }
      dispatch({
        type: "APPLY_EDIT_ACTION",
        action: result.action
      });
      setPendingAdornmentTextEditTargetId(result.pendingTextTargetId);
    },
    onOpenEditEquation: (target) => {
      setEquationModalTarget(target);
    },
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

  const showNativeContextMenu = useCallback(
    (
      target: CanvasContextMenuTarget,
      options: {
        includeEditEquationForSingleNode?: boolean;
        includeMatrixMultiRemoveRow?: boolean;
        includeMatrixMultiRemoveColumn?: boolean;
        includeMatrixMultiInsertRowAbove?: boolean;
        includeMatrixMultiInsertRowBelow?: boolean;
        includeMatrixMultiInsertColumnLeft?: boolean;
        includeMatrixMultiInsertColumnRight?: boolean;
      } = {}
    ) => {
      const definition = buildCanvasContextMenuDefinition({
        includeEditEquationForSingleNode: options.includeEditEquationForSingleNode,
        includeMatrixMultiRemoveRow: options.includeMatrixMultiRemoveRow,
        includeMatrixMultiRemoveColumn: options.includeMatrixMultiRemoveColumn,
        includeMatrixMultiInsertRowAbove: options.includeMatrixMultiInsertRowAbove,
        includeMatrixMultiInsertRowBelow: options.includeMatrixMultiInsertRowBelow,
        includeMatrixMultiInsertColumnLeft: options.includeMatrixMultiInsertColumnLeft,
        includeMatrixMultiInsertColumnRight: options.includeMatrixMultiInsertColumnRight
      });
      void platform.menu?.showNativeContextMenu?.({
        items: definition[target],
        commandStates: commandRuntime.bindings
      });
    },
    [commandRuntime.bindings, platform.menu]
  );

  const resolveIncludeEditEquationForSingleNode = useCallback(
    (target: CanvasContextMenuTarget, sourceId: string | null): boolean => {
      if ((target !== "selection-single-node" && target !== "selection-single-node-tree") || !sourceId) {
        return false;
      }
      return resolveEquationNodeTarget(source, sourceId, editParseOptions) != null;
    },
    [editParseOptions, source]
  );

  const resolveMatrixMultiContextMenuOptions = useCallback(
    (target: CanvasContextMenuTarget, sourceIds: ReadonlySet<string>) => {
      if (target !== "selection-multi") {
        return {
          includeMatrixMultiInsertRowAbove: false,
          includeMatrixMultiInsertRowBelow: false,
          includeMatrixMultiRemoveRow: false,
          includeMatrixMultiInsertColumnLeft: false,
          includeMatrixMultiInsertColumnRight: false,
          includeMatrixMultiRemoveColumn: false
        };
      }

      let matrixSourceId: string | null = null;
      let row: number | null = null;
      let column: number | null = null;

      for (const sourceId of sourceIds) {
        const resolved = resolvePropertyTarget(source, sourceId, editParseOptions);
        if (resolved.kind !== "found" || resolved.target.kind !== "matrix-cell") {
          return {
            includeMatrixMultiInsertRowAbove: false,
            includeMatrixMultiInsertRowBelow: false,
            includeMatrixMultiRemoveRow: false,
            includeMatrixMultiInsertColumnLeft: false,
            includeMatrixMultiInsertColumnRight: false,
            includeMatrixMultiRemoveColumn: false
          };
        }
        const currentMatrixSourceId = resolved.target.matrixSourceId?.trim() ?? "";
        const currentRow = resolved.target.row ?? 0;
        const currentColumn = resolved.target.column ?? 0;
        if (!currentMatrixSourceId || currentRow <= 0 || currentColumn <= 0) {
          return {
            includeMatrixMultiInsertRowAbove: false,
            includeMatrixMultiInsertRowBelow: false,
            includeMatrixMultiRemoveRow: false,
            includeMatrixMultiInsertColumnLeft: false,
            includeMatrixMultiInsertColumnRight: false,
            includeMatrixMultiRemoveColumn: false
          };
        }
        if (matrixSourceId == null) {
          matrixSourceId = currentMatrixSourceId;
          row = currentRow;
          column = currentColumn;
          continue;
        }
        if (matrixSourceId !== currentMatrixSourceId) {
          return {
            includeMatrixMultiInsertRowAbove: false,
            includeMatrixMultiInsertRowBelow: false,
            includeMatrixMultiRemoveRow: false,
            includeMatrixMultiInsertColumnLeft: false,
            includeMatrixMultiInsertColumnRight: false,
            includeMatrixMultiRemoveColumn: false
          };
        }
        if (row !== null && row !== currentRow) {
          row = null;
        }
        if (column !== null && column !== currentColumn) {
          column = null;
        }
      }

      return {
        includeMatrixMultiInsertRowAbove: row != null,
        includeMatrixMultiInsertRowBelow: row != null,
        includeMatrixMultiRemoveRow: row != null,
        includeMatrixMultiInsertColumnLeft: column != null,
        includeMatrixMultiInsertColumnRight: column != null,
        includeMatrixMultiRemoveColumn: column != null
      };
    },
    [editParseOptions, source]
  );

  useEffect(() => {
    if (!platform.menu?.usesNativeContextMenus || !pendingNativeContextMenuRequest) {
      return;
    }
    if (!selectedElementIds.has(pendingNativeContextMenuRequest.clickedSourceId)) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const resolution = resolveCanvasContextMenuTarget({
      source,
      toolMode,
      clickedSourceId: pendingNativeContextMenuRequest.clickedSourceId,
      selectedElementIds,
      parseOptions: editParseOptions
    });

    contextMenuContextRef.current = {
      clickedTargetId: pendingNativeContextMenuRequest.clickedSourceId,
      clickedWorld:
        svgResult
          ? viewportToWorldPoint(
              pendingNativeContextMenuRequest.clientX - rect.left,
              pendingNativeContextMenuRequest.clientY - rect.top,
              canvasTransform,
              svgResult.viewBox
            )
          : null
    };

    if (pendingNativeContextMenuTimeoutRef.current) {
      clearTimeout(pendingNativeContextMenuTimeoutRef.current);
    }
    dispatch({ type: "SET_ACTIVE_HANDLE", handleId: pendingNativeContextMenuRequest.clickedHandleId });

    const nativeEffectiveTarget =
      pendingNativeContextMenuRequest.clickedHandleId
      && (resolution.target === "selection-single" || resolution.target === "selection-single-tree")
        ? (resolution.target === "selection-single-tree"
            ? "selection-single-path-point-tree"
            : "selection-single-path-point") as CanvasContextMenuTarget
        : resolution.target;
    const includeEditEquationForSingleNode = resolveIncludeEditEquationForSingleNode(
      nativeEffectiveTarget,
      pendingNativeContextMenuRequest.clickedSourceId
    );
    const matrixMultiOptions = resolveMatrixMultiContextMenuOptions(nativeEffectiveTarget, selectedElementIds);

    pendingNativeContextMenuTimeoutRef.current = setTimeout(() => {
      pendingNativeContextMenuTimeoutRef.current = null;
      showNativeContextMenu(nativeEffectiveTarget, {
        includeEditEquationForSingleNode,
        includeMatrixMultiRemoveRow: matrixMultiOptions.includeMatrixMultiRemoveRow,
        includeMatrixMultiRemoveColumn: matrixMultiOptions.includeMatrixMultiRemoveColumn,
        includeMatrixMultiInsertRowAbove: matrixMultiOptions.includeMatrixMultiInsertRowAbove,
        includeMatrixMultiInsertRowBelow: matrixMultiOptions.includeMatrixMultiInsertRowBelow,
        includeMatrixMultiInsertColumnLeft: matrixMultiOptions.includeMatrixMultiInsertColumnLeft,
        includeMatrixMultiInsertColumnRight: matrixMultiOptions.includeMatrixMultiInsertColumnRight
      });
      setPendingNativeContextMenuRequest(null);
      viewport.focus({ preventScroll: true });
    }, NATIVE_CONTEXT_MENU_SELECT_DELAY_MS);

    return () => {
      if (pendingNativeContextMenuTimeoutRef.current) {
        clearTimeout(pendingNativeContextMenuTimeoutRef.current);
        pendingNativeContextMenuTimeoutRef.current = null;
      }
    };
  }, [
    canvasTransform,
    pendingNativeContextMenuRequest,
    selectedElementIds,
    resolveIncludeEditEquationForSingleNode,
    resolveMatrixMultiContextMenuOptions,
    showNativeContextMenu,
    source,
    svgResult,
    toolMode
  ]);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const topRulerRef = useRef<SVGSVGElement | null>(null);
  const leftRulerRef = useRef<SVGSVGElement | null>(null);
  const interactionSvgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressNextBackgroundClickRef = useRef(false);
  const pathDraftRef = useRef<PathToolDraft | null>(null);
  const freehandDraftRef = useRef<FreehandToolDraft | null>(null);
  const pendingAddedSelectionRef = useRef<PendingAddedSelection | null>(null);
  const canvasTransformRef = useRef(canvasTransform);
  const selectedElementIdsRef = useRef(selectedElementIds);
  const svgResultRef = useRef(svgResult);
  const fitToContentModeActiveRef = useRef(fitToContentModeActive);
  const sourceBoundsSvgRef = useRef(new Map<string, Bounds>());
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
  const canUseCustomTextEditCaret = typeof document !== "undefined" && hasCaretPositionSupport(document);
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
  const textSelectionRequestIdRef = useRef(0);
  const pendingTouchViewportRef = useRef<PendingTouchViewport | null>(null);
  const viewportStateByFigureKeyRef = useRef(new Map<string, FigureViewportState>());
  const visitedFigureKeysRef = useRef(new Set<string>());
  const previousFigureViewportKeyRef = useRef<string | null>(null);
  const pendingFirstVisitAutoFitKeyRef = useRef<string | null>(null);

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

  useEffect(() => {
    freehandDraftRef.current = freehandDraft;
  }, [freehandDraft]);

  const logSnapDebug = useCallback(
    (input: SnapDebugLogInput) => {
      if (!showDevPanel) {
        return;
      }

      const lines = input.lines ?? [];
      setSnapDebug({
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
      });
    },
    [showDevPanel]
  );

  const performSnapHapticFeedback = useCallback(() => {
    if (!snapHapticsEnabled) {
      return;
    }
    if (!platform.id.startsWith("desktop")) {
      return;
    }
    if (typeof navigator === "undefined" || !/(mac|iphone|ipad)/i.test(navigator.platform)) {
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
        startClientX: event.clientX,
        startClientY: event.clientY,
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
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWidth: snapDebugRect.width,
        startHeight: snapDebugRect.height
      };
      document.body.classList.add("is-resizing-snap-debug");
      event.preventDefault();
      event.stopPropagation();
    },
    [snapDebugRect.height, snapDebugRect.width]
  );

  const diagnostics = useMemo(() => {
    const result: DiagnosticRow[] = [];
    if (parseDiags) {
      for (const d of parseDiags) {
        result.push({ ...d, source: "parse" });
      }
    }
    if (semanticDiags) {
      for (const d of semanticDiags) {
        result.push({ ...d, source: "semantic" });
      }
    }
    return result;
  }, [parseDiags, semanticDiags]);

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warnCount = diagnostics.filter((d) => d.severity === "warning").length;

  useEffect(() => {
    let cancelled = false;
    void createMathJaxNodeTextEngine({ font: mathJaxFont })
      .then((engine) => {
        if (!cancelled) {
          textEngineRef.current = engine;
        }
      })
      .catch(() => {
        if (!cancelled) {
          textEngineRef.current = null;
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
              left: drag.startLeft + (event.clientX - drag.startClientX),
              top: drag.startTop + (event.clientY - drag.startClientY)
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
            width: drag.startWidth + (event.clientX - drag.startClientX),
            height: drag.startHeight + (event.clientY - drag.startClientY)
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
    const dense = new Set<string>();
    for (const element of snapshot.scene?.elements ?? []) {
      if (element.kind !== "Path" || element.shapeHint != null) {
        continue;
      }
      let segmentCount = 0;
      for (const command of element.commands) {
        if (command.kind === "L" || command.kind === "C" || command.kind === "A") {
          segmentCount += 1;
        }
      }
      if (segmentCount >= DENSE_PATH_SEGMENT_THRESHOLD) {
        dense.add(element.sourceRef.sourceId);
      }
    }
    return dense;
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
    if (warning || toolMode !== "select") return null;
    if (selectedElementIds.size !== 1) return null;
    const sourceId = [...selectedElementIds][0]!;
    const isNodeSource = snapshot.editHandles.some(
      (handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "node-position"
    );
    if (isNodeSource) return null;
    const element = snapshot.scene?.elements.find((e) => e.sourceRef.sourceId === sourceId);
    if (!element || element.kind !== "Path") return null;
    const resolved = resolveEligibleExplicitPath(source, sourceId, editParseOptions);
    if (resolved.kind !== "eligible") return null;
    if (resolved.analysis.segments.length === 0) return null;
    if (collapsedDensePathSourceIds.has(sourceId)) return "Double-click path to edit points.";
    // dense paths that are expanded are also eligible for add-point hint
    return "Double-click path to add a point.";
  }, [warning, toolMode, collapsedDensePathSourceIds, selectedElementIds, densePathSourceIds, snapshot.editHandles, snapshot.scene, editParseOptions, source]);

  const {
    nodeAnchorTargets,
    matrixCellAnchorHints,
    dragCapability,
    directManipulationDisabledReasonBySourceId,
    draggableSourceIds,
    sceneTextByRegionKey,
    sourceBoundsSvg,
    interactionBoundsSvgBySource,
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

  const fitToContent = useCallback((): boolean => {
    const fitViewBox = baseSvgResult?.viewBox ?? svgResult?.viewBox;
    if (!fitViewBox || !viewportRef.current) return false;

    const viewportWidth = viewportRef.current.clientWidth;
    const viewportHeight = viewportRef.current.clientHeight;

    if (
      viewportWidth <= 0 ||
      viewportHeight <= 0 ||
      fitViewBox.width <= 0 ||
      fitViewBox.height <= 0
    ) {
      return false;
    }

    const availableWidth = Math.max(1, viewportWidth - FIT_PADDING * 2);
    const availableHeight = Math.max(1, viewportHeight - FIT_PADDING * 2);

    const scale = clamp(
      Math.min(availableWidth / fitViewBox.width, availableHeight / fitViewBox.height),
      MIN_SCALE,
      MAX_SCALE
    );

    const translateX = (viewportWidth - fitViewBox.width * scale) / 2;
    const translateY = (viewportHeight - fitViewBox.height * scale) / 2;

    dispatchCanvasTransform({ translateX, translateY, scale });
    return true;
  }, [baseSvgResult, dispatchCanvasTransform, svgResult]);

  const activeFigureViewportKey = useMemo(
    () => makeFigureViewportKey(activeDocumentId, activeFigureId),
    [activeDocumentId, activeFigureId]
  );

  useEffect(() => {
    const openDocuments = new Set(tabOrder);
    for (const key of viewportStateByFigureKeyRef.current.keys()) {
      const delimiter = key.indexOf("::");
      const documentId = delimiter >= 0 ? key.slice(0, delimiter) : key;
      if (!openDocuments.has(documentId)) {
        viewportStateByFigureKeyRef.current.delete(key);
        visitedFigureKeysRef.current.delete(key);
        if (pendingFirstVisitAutoFitKeyRef.current === key) {
          pendingFirstVisitAutoFitKeyRef.current = null;
        }
      }
    }
  }, [tabOrder]);

  useEffect(() => {
    const pendingAutoFit = pendingFirstVisitAutoFitKeyRef.current === activeFigureViewportKey;
    if (previousFigureViewportKeyRef.current === activeFigureViewportKey && !pendingAutoFit) {
      return;
    }

    const previousKey = previousFigureViewportKeyRef.current;
    if (previousKey && previousKey !== activeFigureViewportKey) {
      const previousTransform = canvasTransformRef.current;
      viewportStateByFigureKeyRef.current.set(previousKey, {
        transform: {
          translateX: previousTransform.translateX,
          translateY: previousTransform.translateY,
          scale: previousTransform.scale
        },
        fitToContentModeActive: fitToContentModeActiveRef.current
      });
      visitedFigureKeysRef.current.add(previousKey);
    }

    const savedState = viewportStateByFigureKeyRef.current.get(activeFigureViewportKey);
    if (savedState) {
      pendingFirstVisitAutoFitKeyRef.current = null;
      if (fitToContentModeActiveRef.current !== savedState.fitToContentModeActive) {
        setFitToContentModeActive(savedState.fitToContentModeActive);
      }
      dispatchCanvasTransform(savedState.transform);
      previousFigureViewportKeyRef.current = activeFigureViewportKey;
      return;
    }

    const hasVisited = visitedFigureKeysRef.current.has(activeFigureViewportKey);
    if (!hasVisited || pendingAutoFit) {
      visitedFigureKeysRef.current.add(activeFigureViewportKey);
      if (!fitToContentModeActiveRef.current) {
        setFitToContentModeActive(true);
      }
      const didFit = fitToContent();
      previousFigureViewportKeyRef.current = activeFigureViewportKey;
      if (didFit) {
        pendingFirstVisitAutoFitKeyRef.current = null;
      } else {
        pendingFirstVisitAutoFitKeyRef.current = activeFigureViewportKey;
      }
      return;
    }

    pendingFirstVisitAutoFitKeyRef.current = null;
    previousFigureViewportKeyRef.current = activeFigureViewportKey;
  }, [activeFigureViewportKey, dispatchCanvasTransform, fitToContent]);

  const handledFitRequestRef = useRef(0);
  useEffect(() => {
    if (fitToContentRequestToken <= 0) {
      return;
    }
    if (fitToContentRequestToken === handledFitRequestRef.current) {
      return;
    }
    handledFitRequestRef.current = fitToContentRequestToken;
    if (!fitToContentModeActiveRef.current) {
      setFitToContentModeActive(true);
    }
    fitToContent();
  }, [fitToContent, fitToContentRequestToken]);

  const handledZoomRequestRef = useRef(0);
  useEffect(() => {
    if (zoomRequestToken <= 0) {
      return;
    }
    if (zoomRequestToken === handledZoomRequestRef.current) {
      return;
    }
    handledZoomRequestRef.current = zoomRequestToken;
    if (!zoomRequestDirection || !svgResult || !viewportRef.current) {
      return;
    }

    const currentTransform = canvasTransformRef.current;
    const centerX = viewportRef.current.clientWidth / 2;
    const centerY = viewportRef.current.clientHeight / 2;
    const zoomFactor = zoomRequestDirection === "in" ? 1.15 : 1 / 1.15;
    const nextScale = clamp(currentTransform.scale * zoomFactor, MIN_SCALE, MAX_SCALE);
    if (Math.abs(nextScale - currentTransform.scale) < 1e-9) {
      return;
    }

    const svgPoint = viewportToSvgPoint(centerX, centerY, currentTransform, svgResult.viewBox);
    const translateX = centerX - (svgPoint.x - svgResult.viewBox.x) * nextScale;
    const translateY = centerY - (svgPoint.y - svgResult.viewBox.y) * nextScale;

    if (fitToContentModeActiveRef.current) {
      setFitToContentModeActive(false);
    }
    dispatchCanvasTransform({ translateX, translateY, scale: nextScale });
  }, [
    MAX_SCALE,
    MIN_SCALE,
    canvasTransformRef,
    dispatchCanvasTransform,
    fitToContentModeActiveRef,
    setFitToContentModeActive,
    svgResult,
    zoomRequestDirection,
    zoomRequestToken
  ]);

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
    (action: EditAction, historyMergeKey?: string): ApplyActionFeedback => {
      const result = applyEditAction(source, snapshot.editHandles, action, {
        evaluateOptions: { textEngine: textEngineRef.current },
        parseOptions: editParseOptions
      });

      if (result.kind === "success" || result.kind === "partial") {
        if (result.kind === "partial") {
          const skippedCount = result.skippedHandles.length;
          setWarning(`${result.reason} (${skippedCount} handle${skippedCount === 1 ? "" : "s"} skipped)`);
        }

        const sourceChanged = result.newSource !== source;
        if (sourceChanged) {
          dispatch({
            type: "APPLY_EDIT_ACTION",
            action,
            historyMergeKey,
            precomputedSource: source,
            precomputedResult: result
          });
        }
        return { sourceChanged };
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
        setWarning(result.reason);
      } else {
        setWarning(result.message);
      }

      return { sourceChanged: false };
    },
    [dispatch, editParseOptions, source, snapshot.editHandles]
  );

  const queueSelectionForAddedElement = useCallback(
    (preferredWorld: Point, preferredSourceId?: string) => {
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

  const appendFreehandSamplePoint = useCallback((point: Point): Point[] | null => {
    let nextPoints: Point[] | null = null;
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

  const finalizeFreehandDraft = useCallback((overridePoints?: Point[]) => {
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

    const snippet = generateFreehandToolSource(draft, canvasTransform.scale, freehandSmoothingPx);
    if (snippet) {
      const firstPoint = draft.points[0]!;
      const lastPoint = draft.points[draft.points.length - 1]!;
      queueSelectionForAddedElement({
        x: (firstPoint.x + lastPoint.x) / 2,
        y: (firstPoint.y + lastPoint.y) / 2
      });
      const ok = applyActionWithFeedback({
        kind: "pasteStatements",
        snippets: [snippet],
        delta: { x: 0, y: 0 }
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
  }, [applyActionWithFeedback, canvasTransform.scale, dispatch, freehandSmoothingPx, queueSelectionForAddedElement, setDragState]);

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
        const snippet = generatePathToolSource(draft, { closed });
        if (!snippet) {
          setPathDraft(null);
          setToolCursorWorld(null);
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          return;
        }
        const ok = applyActionWithFeedback({
          kind: "pasteStatements",
          snippets: [snippet],
          delta: { x: 0, y: 0 }
        });
        if (!ok.sourceChanged) {
          pendingAddedSelectionRef.current = null;
        }
      }

      setPathDraft(null);
      setToolCursorWorld(null);
      dispatch({ type: "SET_TOOL_MODE", mode: "select" });
    },
    [applyActionWithFeedback, dispatch, setDragState]
  );

  

  const resolveEditableTextTarget = useCallback(
    (targetId: string, region: HitRegion | undefined): EditableTextTarget | null => {
      if (!region || region.shape !== "rect" || region.interactionMode === "move") {
        return null;
      }
      const sceneText = sceneTextByRegionKey.get(region.sceneTextKey ?? region.key);
      if (!sceneText) {
        return null;
      }
      let sourceSpan = sceneText.matrixCell?.textSpan ?? sceneText.textSourceSpan ?? sceneText.sourceRef.sourceSpan;
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
      return {
        sourceId: targetId,
        sceneTextId: sceneText.id,
        sourceSpan,
        text: sourceSlice,
        renderSourceText:
          sceneText.textRenderInfo?.mode === "mathjax"
            ? sceneText.textRenderInfo.renderSourceText
            : sourceSlice,
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
        popupAnchorBox: {
          x: region.cx - popupAnchorWidth / 2,
          y: region.cy - popupAnchorHeight / 2,
          width: popupAnchorWidth,
          height: popupAnchorHeight
        }
      };
    },
    [sceneTextByRegionKey, snapshot.parseResult, source]
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
      if (candidate.getAttribute("data-paragraph-id") === target.paragraphId) {
        return candidate;
      }
    }
    for (const candidate of candidates) {
      if (
        candidate.getAttribute("data-scene-text-id") === target.sceneTextId ||
        candidate.getAttribute("data-source-id") === target.sourceId
      ) {
        return candidate;
      }
    }
    return null;
  }, []);

  const resolveTextOffsetFromClient = useCallback(
    async (target: EditableTextTarget, clientX: number, clientY: number): Promise<number | null> => {
      const outputJax = getActiveMathJaxOutputJax();
      const containerElement = resolveRenderedMathTextElement(target);
      if (!target.paragraphId || !outputJax || !containerElement) {
        return estimateTextOffsetFromClient(
          target,
          clientX,
          clientY,
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
        clientX,
        clientY
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
    async (target: EditableTextTarget, clientX: number, clientY: number): Promise<TextLineRange | null> => {
      const outputJax = getActiveMathJaxOutputJax();
      const containerElement = resolveRenderedMathTextElement(target);
      if (target.paragraphId && outputJax && containerElement) {
        const result = await getKnuthPlassLineRangeFromPoint(outputJax, {
          paragraphId: target.paragraphId,
          sourceText: target.renderSourceText,
          containerElement,
          clientX,
          clientY
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
      return estimateTextLineRangeFromClient(
        target,
        clientX,
        clientY,
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
      const boundedStart = clamp(Math.floor(selectionStart), 0, target.text.length);
      const boundedEnd = clamp(Math.floor(selectionEnd), 0, target.text.length);
      const normalizedStart = Math.min(boundedStart, boundedEnd);
      const normalizedEnd = Math.max(boundedStart, boundedEnd);
      setTextEditingSession({
        sourceId: target.sourceId,
        sceneTextId: target.sceneTextId,
        sourceSpan: target.sourceSpan,
        workingSource: source,
        text: target.text,
        selectionStart: normalizedStart,
        selectionEnd: normalizedEnd,
        historyMergeKey: historyMergeKey ?? makeMergeKey("canvas-text-edit", target.sourceId, Date.now()),
        paragraphId: target.paragraphId,
        renderSourceText: target.renderSourceText,
        layoutKind: target.layoutKind,
        region: target.region,
        popupAnchorBox: target.popupAnchorBox
      });
    },
    [source]
  );

  const beginCanvasTextInteraction = useCallback(
    (event: ReactPointerEvent<SVGElement>, target: EditableTextTarget) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.button !== 0) {
        return;
      }
      suppressNextBackgroundClickRef.current = true;
      textSelectionRequestIdRef.current += 1;
      const requestId = textSelectionRequestIdRef.current;
      const existingHistoryMergeKey =
        textEditingSession?.sourceId === target.sourceId ? textEditingSession.historyMergeKey : undefined;
      const clickCount = event.detail >= 2 ? event.detail : 1;
      const mode = resolveTextSelectionModeFromClickCount(clickCount);
      const provisionalOffset = estimateTextOffsetFromClient(
        target,
        event.clientX,
        event.clientY,
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
      startTextEditingSession(target, provisionalSelection.start, provisionalSelection.end, existingHistoryMergeKey);
      textSelectionDragRef.current = {
        pointerId: event.pointerId,
        sourceId: target.sourceId,
        sceneTextId: target.sceneTextId,
        anchorOffset: provisionalOffset,
        mode,
        anchorLineRange: provisionalLineRange
      };
      const offsetPromise = resolveTextOffsetFromClient(target, event.clientX, event.clientY);
      const lineRangePromise = mode === "line"
        ? resolveTextLineRangeFromClient(target, event.clientX, event.clientY)
        : Promise.resolve<TextLineRange | null>(null);
      void Promise.all([offsetPromise, lineRangePromise]).then(([offset, lineRange]) => {
        if (requestId !== textSelectionRequestIdRef.current) {
          return;
        }
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
        setTextEditingSession((current) =>
          current && current.sourceId === target.sourceId
            ? current.selectionStart === provisionalSelection.start &&
              current.selectionEnd === provisionalSelection.end
              ? {
                  ...current,
                  selectionStart: selection.start,
                  selectionEnd: selection.end
                }
              : current
            : current
        );
        if (textSelectionDragRef.current?.pointerId === event.pointerId) {
          textSelectionDragRef.current = {
            pointerId: event.pointerId,
            sourceId: target.sourceId,
            sceneTextId: target.sceneTextId,
            anchorOffset: resolvedOffset,
            mode,
            anchorLineRange: resolvedLineRange
          };
        }
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Ignore pointer capture failures; the window listeners still complete the drag.
        }
      });
    },
    [
      canvasTransform,
      interactionSvgRef,
      resolveTextLineRangeFromClient,
      resolveTextOffsetFromClient,
      setTextEditingSession,
      startTextEditingSession,
      svgResult,
      textEditingSession,
      viewportRef
    ]
  );

  const applyTextEditingUpdate = useCallback(
    (nextText: string, nextSelectionStart: number, nextSelectionEnd: number) => {
      const current = textEditingSessionRef.current;
      if (!current) {
        return;
      }
      const boundedStart = clamp(Math.floor(nextSelectionStart), 0, nextText.length);
      const boundedEnd = clamp(Math.floor(nextSelectionEnd), 0, nextText.length);
      const updated = replaceSpan(current.workingSource, current.sourceSpan, nextText);
      dispatch({
        type: "APPLY_EDIT_ACTION",
        action: {
          kind: "updateNodeText",
          elementId: current.sourceId,
          text: nextText
        },
        historyMergeKey: current.historyMergeKey,
        precomputedResult: {
          kind: "success",
          newSource: updated.source,
          patches: [
            {
              oldSpan: current.sourceSpan,
              newSpan: updated.changedSpan,
              replacement: nextText
            }
          ]
        }
      });
      setTextEditingSession({
        ...current,
        sourceSpan: updated.changedSpan,
        workingSource: updated.source,
        text: nextText,
        selectionStart: boundedStart,
        selectionEnd: boundedEnd
      });
    },
    [dispatch]
  );

  const handleTextEditTextareaChange = useCallback(
    (event: ReactChangeEvent<HTMLTextAreaElement>) => {
      applyTextEditingUpdate(
        event.currentTarget.value,
        event.currentTarget.selectionStart ?? 0,
        event.currentTarget.selectionEnd ?? 0
      );
    },
    [applyTextEditingUpdate]
  );

  const handleTextEditTextareaSelect = useCallback((event: ReactSyntheticEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    setTextEditingSession((current) =>
      current
        ? {
            ...current,
            selectionStart: clamp(textarea.selectionStart ?? 0, 0, current.text.length),
            selectionEnd: clamp(textarea.selectionEnd ?? 0, 0, current.text.length)
          }
        : current
    );
  }, []);

  const stopTextEditTextareaClipboardPropagation = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
  }, []);

  const handleTextEditTextareaKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      textSelectionDragRef.current = null;
      setTextEditingSession(null);
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (event.key !== "Backspace" && event.key !== "Delete") {
      return;
    }

    const textarea = event.currentTarget;
    const value = textarea.value;
    const rawStart = textarea.selectionStart ?? 0;
    const rawEnd = textarea.selectionEnd ?? rawStart;
    const start = clamp(Math.min(rawStart, rawEnd), 0, value.length);
    const end = clamp(Math.max(rawStart, rawEnd), 0, value.length);

    let nextText = value;
    let nextCaret = start;

    if (start !== end) {
      nextText = `${value.slice(0, start)}${value.slice(end)}`;
      nextCaret = start;
    } else if (event.key === "Backspace" && start > 0) {
      nextText = `${value.slice(0, start - 1)}${value.slice(start)}`;
      nextCaret = start - 1;
    } else if (event.key === "Delete" && start < value.length) {
      nextText = `${value.slice(0, start)}${value.slice(start + 1)}`;
      nextCaret = start;
    } else {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    applyTextEditingUpdate(nextText, nextCaret, nextCaret);
  }, [applyTextEditingUpdate]);

  const handleTextEditPopupPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

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
    if (!textEditingSession || !textarea) {
      return;
    }
    const syncSelectionFromTextarea = () => {
      setTextEditingSession((current) => {
        if (!current) {
          return current;
        }
        const nextStart = clamp(textarea.selectionStart ?? 0, 0, current.text.length);
        const nextEnd = clamp(textarea.selectionEnd ?? 0, 0, current.text.length);
        if (current.selectionStart === nextStart && current.selectionEnd === nextEnd) {
          return current;
        }
        return {
          ...current,
          selectionStart: nextStart,
          selectionEnd: nextEnd
        };
      });
    };
    const handleDocumentSelectionChange = () => {
      if (document.activeElement === textarea) {
        syncSelectionFromTextarea();
      }
    };
    textarea.addEventListener("select", syncSelectionFromTextarea);
    textarea.addEventListener("keyup", syncSelectionFromTextarea);
    textarea.addEventListener("mouseup", syncSelectionFromTextarea);
    document.addEventListener("selectionchange", handleDocumentSelectionChange);
    return () => {
      textarea.removeEventListener("select", syncSelectionFromTextarea);
      textarea.removeEventListener("keyup", syncSelectionFromTextarea);
      textarea.removeEventListener("mouseup", syncSelectionFromTextarea);
      document.removeEventListener("selectionchange", handleDocumentSelectionChange);
    };
  }, [textEditingSession]);

  useLayoutEffect(() => {
    const textarea = textEditTextareaRef.current;
    const popup = textEditPopupRef.current;
    if (!textEditingSession || !textarea || !popup) {
      setTextEditCaretOverlay(null);
      return;
    }
    if (textEditingSession.selectionStart !== textEditingSession.selectionEnd) {
      setTextEditCaretOverlay(null);
      return;
    }
    if (!hasCaretPositionSupport(textarea.ownerDocument)) {
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
      const refinedRect = refineCaretClientRectWithCaretPosition(currentTextarea, measuredRect);
      const textareaRect = currentTextarea.getBoundingClientRect();
      const rawLeft = refinedRect.left - textareaRect.left;
      const rawTop = refinedRect.top - textareaRect.top;
      const minLeft = 0;
      const maxLeft = textareaRect.width;
      const height = Math.max(1, Math.min(refinedRect.height, textareaRect.height));
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
      if (!drag || drag.pointerId !== event.pointerId) {
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
      textSelectionRequestIdRef.current += 1;
      const requestId = textSelectionRequestIdRef.current;
      const offsetPromise = resolveTextOffsetFromClient(target, event.clientX, event.clientY);
      const lineRangePromise = drag.mode === "line"
        ? resolveTextLineRangeFromClient(target, event.clientX, event.clientY)
        : Promise.resolve<TextLineRange | null>(null);
      void Promise.all([offsetPromise, lineRangePromise]).then(([offset, focusLineRange]) => {
        if (requestId !== textSelectionRequestIdRef.current) {
          return;
        }
        const resolvedOffset = offset == null ? drag.anchorOffset : clamp(offset, 0, target.text.length);
        const selection = resolveTextSelectionRangeForDrag(
          target.text,
          drag.mode,
          drag.anchorOffset,
          resolvedOffset,
          drag.anchorLineRange,
          focusLineRange
        );
        setTextEditingSession((current) =>
          current && current.sourceId === target.sourceId && current.sceneTextId === target.sceneTextId
            ? {
                ...current,
                selectionStart: clamp(selection.start, 0, current.text.length),
                selectionEnd: clamp(selection.end, 0, current.text.length)
              }
            : current
        );
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = textSelectionDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
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
  }, [resolveEditableTextTargetById, resolveTextLineRangeFromClient, resolveTextOffsetFromClient]);

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
      setTextEditingSession(null);
    };
    window.addEventListener("pointerdown", handleGlobalPointerDown, true);
    return () => window.removeEventListener("pointerdown", handleGlobalPointerDown, true);
  }, [textEditingSession]);

  const { onElementPointerDown, onElementDoubleClick } = useCanvasElementInteractions({
    svgResult,
    toolMode,
    selectedElementIds,
    viewportRef,
    beginCanvasTextInteraction,
    setTextEditingSession,
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
        figureCount: snapshot.figures.length
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
    parseOptions: editParseOptions
  });

  const {
    onHandlePointerDown,
    onResizeHandlePointerDown,
    onRotateHandlePointerDown,
    resolveRotateWriteTargetId
  } = useCanvasHandleInteractions({
    svgResult,
    toolMode,
    viewportRef,
    dispatch,
    setTextEditingSession,
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
    (clientX: number, clientY: number): Point | null => {
      if (!svgResult) {
        return null;
      }
      const viewport = viewportRef.current;
      if (!viewport) {
        return null;
      }
      const rect = viewport.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      return viewportToWorldPoint(localX, localY, canvasTransform, svgResult.viewBox);
    },
    [canvasTransform, svgResult]
  );

  const startMarqueeSelection = useCallback(
    (pointerId: number, clientX: number, clientY: number, additiveSelection: boolean): boolean => {
      const world = resolveWorldFromViewportClient(clientX, clientY);
      if (!world) {
        if (!additiveSelection) {
          dispatch({ type: "CLEAR_SELECTION" });
        }
        return false;
      }

      if (
        !additiveSelection &&
        focusedScopeId != null &&
        !isWorldPointWithinScopeBounds(focusedScopeId, world, scopeOverlay)
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
      setDragState,
      scopeOverlay,
      snapshot.source,
      source
    ]
  );

  const openCanvasContextMenuAt = useCallback(
    (clientX: number, clientY: number, clickedSourceId: string | null, clickedHandleId: string | null = null) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const resolution = resolveCanvasContextMenuTarget({
        source,
        toolMode,
        clickedSourceId,
        selectedElementIds,
        parseOptions: editParseOptions
      });

      if (resolution.selectionAction.kind === "clear") {
        if (selectedElementIds.size > 0 || focusedScopeId != null) {
          dispatch({ type: "CLEAR_SELECTION" });
        }
        if (clickedHandleId != null) {
          dispatch({ type: "SET_ACTIVE_HANDLE", handleId: clickedHandleId });
        }
      } else if (resolution.selectionAction.kind === "select-only") {
        if (platform.menu?.usesNativeContextMenus) {
          setPendingNativeContextMenuRequest({
            clientX,
            clientY,
            clickedSourceId: resolution.selectionAction.sourceId,
            clickedHandleId
          });
          dispatch({ type: "SET_ACTIVE_HANDLE", handleId: clickedHandleId });
          dispatch({ type: "SELECT", id: resolution.selectionAction.sourceId, additive: false });
          dispatch({
            type: "SET_FOCUSED_SCOPE",
            scopeId: resolveFocusedScopeIdForSelection(resolution.selectionAction.sourceId, scopeOverlay)
          });
          viewport.focus({ preventScroll: true });
          return;
        }
        dispatch({ type: "SET_ACTIVE_HANDLE", handleId: clickedHandleId });
        dispatch({ type: "SELECT", id: resolution.selectionAction.sourceId, additive: false });
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(resolution.selectionAction.sourceId, scopeOverlay)
        });
      } else {
        dispatch({ type: "SET_ACTIVE_HANDLE", handleId: clickedHandleId });
      }

      contextMenuContextRef.current = {
        clickedTargetId: clickedSourceId,
        clickedWorld:
          svgResult
            ? viewportToWorldPoint(clientX - rect.left, clientY - rect.top, canvasTransform, svgResult.viewBox)
            : null
      };

      const effectiveTarget =
        clickedHandleId && (resolution.target === "selection-single" || resolution.target === "selection-single-tree")
          ? (resolution.target === "selection-single-tree"
              ? "selection-single-path-point-tree"
              : "selection-single-path-point") as CanvasContextMenuTarget
          : resolution.target;
      const equationSourceId = resolution.selectionAction.kind === "select-only"
        ? resolution.selectionAction.sourceId
        : clickedSourceId ?? (selectedElementIds.size === 1 ? [...selectedElementIds][0] ?? null : null);
      const includeEditEquationForSingleNode = resolveIncludeEditEquationForSingleNode(effectiveTarget, equationSourceId);
      const matrixMultiOptions = resolveMatrixMultiContextMenuOptions(effectiveTarget, selectedElementIds);

      const nextContextMenuState: CanvasContextMenuState = {
        target: effectiveTarget,
        anchorX: clientX - rect.left,
        anchorY: clientY - rect.top,
        handleIdOverride: clickedHandleId,
        includeEditEquationForSingleNode,
        includeMatrixMultiInsertRowAbove: matrixMultiOptions.includeMatrixMultiInsertRowAbove,
        includeMatrixMultiInsertRowBelow: matrixMultiOptions.includeMatrixMultiInsertRowBelow,
        includeMatrixMultiRemoveRow: matrixMultiOptions.includeMatrixMultiRemoveRow,
        includeMatrixMultiInsertColumnLeft: matrixMultiOptions.includeMatrixMultiInsertColumnLeft,
        includeMatrixMultiInsertColumnRight: matrixMultiOptions.includeMatrixMultiInsertColumnRight,
        includeMatrixMultiRemoveColumn: matrixMultiOptions.includeMatrixMultiRemoveColumn
      };

      if (platform.menu?.usesNativeContextMenus) {
        if (clickedHandleId && clickedSourceId) {
          setPendingNativeContextMenuRequest({
            clientX,
            clientY,
            clickedSourceId,
            clickedHandleId
          });
          viewport.focus({ preventScroll: true });
          return;
        }
        showNativeContextMenu(effectiveTarget, {
          includeEditEquationForSingleNode,
          includeMatrixMultiInsertRowAbove: matrixMultiOptions.includeMatrixMultiInsertRowAbove,
          includeMatrixMultiInsertRowBelow: matrixMultiOptions.includeMatrixMultiInsertRowBelow,
          includeMatrixMultiRemoveRow: matrixMultiOptions.includeMatrixMultiRemoveRow,
          includeMatrixMultiInsertColumnLeft: matrixMultiOptions.includeMatrixMultiInsertColumnLeft,
          includeMatrixMultiInsertColumnRight: matrixMultiOptions.includeMatrixMultiInsertColumnRight,
          includeMatrixMultiRemoveColumn: matrixMultiOptions.includeMatrixMultiRemoveColumn
        });
        viewport.focus({ preventScroll: true });
        return;
      }

      setContextMenuState(nextContextMenuState);
      viewport.focus({ preventScroll: true });
    },
    [
      canvasTransform,
      dispatch,
      focusedScopeId,
      platform.menu?.usesNativeContextMenus,
      scopeOverlay,
      selectedElementIds,
      resolveIncludeEditEquationForSingleNode,
      resolveMatrixMultiContextMenuOptions,
      showNativeContextMenu,
      source,
      svgResult,
      toolMode
    ]
  );

  const { onElementContextMenu, onCanvasContextMenu } = useCanvasSelectionInteractions({
    openCanvasContextMenuAt,
    setTextEditingSession,
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
    setTextEditingSession,
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
    logSnapDebug,
    snapGuideInput,
    snapSettingsPatch,
    viewportWorldBounds,
    nodeAnchorTargets,
    matrixCellAnchorHints,
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
    dispatchCanvasTransform,
    selectedAddShape,
    selectedAddMatrixRows,
    selectedAddMatrixColumns,
    pathDraft,
    pathSegmentDraft,
    dragRef,
    toolDraft,
    bezierBendDraft,
    freehandDraft,
    parseOptions: editParseOptions,
    magnifierState
  });

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
    setTextEditingSession,
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
    activeCanvasDragKind,
    setDragPatchMode,
    dispatchCanvasTransform,
    zoomSpeed,
    MIN_SCALE,
    MAX_SCALE,
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

  useEffect(() => {
    const current = bucketPreviewSessionRef.current;
    if (toolMode !== "addBucket" || !hoveredElementId) {
      if (current && source !== current.baseSource) {
        dispatch({
          type: "SET_SOURCE_TRANSIENT",
          source: current.baseSource,
          changedSourceIds: [current.sourceId]
        });
      }
      bucketPreviewSessionRef.current = null;
      return;
    }

    const baseSource = current?.baseSource ?? source;
    const resolution = resolveBucketFillEdit({
      sourceId: hoveredElementId,
      colorToken: bucketFillColor,
      source: baseSource,
      elements: snapshot.scene?.elements ?? [],
      editHandles: snapshot.editHandles,
      activeFigureId,
      figureCount: snapshot.figures.length
    });

    if (resolution.kind !== "ready") {
      if (current && source !== current.baseSource) {
        dispatch({
          type: "SET_SOURCE_TRANSIENT",
          source: current.baseSource,
          changedSourceIds: [current.sourceId]
        });
      }
      bucketPreviewSessionRef.current = null;
      return;
    }

    const nextPreviewSource = resolution.result.newSource;
    if (
      current &&
      current.sourceId === hoveredElementId &&
      current.colorToken === bucketFillColor &&
      current.previewSource === nextPreviewSource &&
      source === nextPreviewSource
    ) {
      return;
    }

    dispatch({
      type: "SET_SOURCE_TRANSIENT",
      source: nextPreviewSource,
      changedSourceIds: [hoveredElementId]
    });
    bucketPreviewSessionRef.current = {
      sourceId: hoveredElementId,
      colorToken: bucketFillColor,
      baseSource,
      previewSource: nextPreviewSource
    };
  }, [activeFigureId, bucketFillColor, dispatch, hoveredElementId, snapshot.editHandles, snapshot.figures.length, snapshot.scene, source, toolMode]);

  useEffect(() => {
    if (!lastEditWarningMessage) {
      return;
    }
    setWarning(lastEditWarningMessage);
  }, [lastEditWarningMessage, lastEditWarningToken]);

  useEffect(() => {
    if (!warning) return;

    const timer = window.setTimeout(() => setWarning(null), 3200);
    return () => window.clearTimeout(timer);
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
    setSnapLines([]);
  }, [snapshot.source, source]);

  useEffect(() => {
    if (activeCanvasDragKind) {
      return;
    }
    setDragPatchMode("partial");
    setDragAffectedSourceIds(null);
  }, [activeCanvasDragKind]);

  useEffect(() => {
    if (!activeCanvasDragKind || dragPatchMode === "full") {
      return;
    }
    if (
      activeCanvasDragKind === "element" &&
      [...selectedElementIds].some((sourceId) =>
        snapshot.editHandles.some(
          (handle) =>
            handle.sourceRef.sourceId === sourceId &&
            handle.kind === "node-position" &&
            handle.pathAttachmentContext != null
        )
      )
    ) {
      setDragPatchMode("full");
      setDragAffectedSourceIds(null);
      return;
    }
    const dependencies = snapshot.semanticResult?.dependencies;
    if (!dependencies) {
      return;
    }
    const changedSourceIds = lastEditChangedSourceIds;
    if (!changedSourceIds || changedSourceIds.length === 0) {
      setDragAffectedSourceIds(null);
      return;
    }

    const matrixDescendantSourceIds = collectMatrixDescendantSourceIdsForChangedSources(
      snapshot.scene?.elements ?? [],
      changedSourceIds
    );
    const changedSourceIdsForInvalidation =
      matrixDescendantSourceIds.length > 0
        ? [...new Set([...changedSourceIds, ...matrixDescendantSourceIds])]
        : changedSourceIds;
    const invalidation = collectGeometryInvalidation(dependencies, {
      changedSourceIds: changedSourceIdsForInvalidation
    });
    if (invalidation.reachedOpaque) {
      setDragPatchMode("full");
      setDragAffectedSourceIds(null);
      return;
    }
    const affectedSourceIds = mergeSourceIdLists(
      mergeSourceIdLists(
        invalidation.affectedSourceIds,
        matrixDescendantSourceIds
      ),
      [...selectedElementIds]
    );
    setDragAffectedSourceIds(affectedSourceIds.length > 0 ? affectedSourceIds : null);
  }, [
    activeCanvasDragKind,
    dragPatchMode,
    lastEditChangeToken,
    lastEditChangedSourceIds,
    selectedElementIds,
    snapshot.scene,
    snapshot.semanticResult
  ]);

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

    setTextEditingSession(null);
    if (dragRef.current?.kind === "marquee") {
      setDragState(null);
      setMarqueeDraft(null);
    }
  }, [setDragState, toolMode]);

  useCanvasTextEditingEffects({
    toolMode,
    textEditingSession,
    setTextEditingSession,
    selectedElementIds,
    resolveEditableTextTargetById,
    resolveRenderedMathTextElement,
    viewportRef,
    setTextSelectionOverlay,
    pendingAdornmentTextEditTargetId,
    snapshot,
    source,
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
      : inferredMatrixSourceId
        ? inferredMatrixSourceId
      : (
          newSourceIds.length === 1
            ? newSourceIds[0]!
            : pickClosestSourceId(sceneElements, newSourceIds, pending.preferredWorld)
        );

    dispatch({ type: "SELECT", id: selectedId, additive: false });
  }, [dispatch, snapshot.scene, snapshot.source, source]);

  useEffect(() => {
    if (!fitToContentModeActive) {
      return;
    }
    if (!svgResult) {
      return;
    }
    if (activeCanvasDragKind || activeSourceScrubSourceId) {
      return;
    }
    if (snapshot.source !== source) {
      return;
    }
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }
    fitToContent();
  }, [
    activeCanvasDragKind,
    activeSourceScrubSourceId,
    fitToContent,
    fitToContentModeActive,
    lastEditChangeToken,
    snapshot.source,
    source,
    svgResult,
    viewportSize.height,
    viewportSize.width
  ]);

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

  useEffect(() => () => setActiveCanvasDragKind(null), [setActiveCanvasDragKind]);

  useEffect(() => {
    if (activeCanvasDragKind == null) {
      setPathAttachedNodePreview(null);
    }
  }, [activeCanvasDragKind]);

  const svgDiffHints = useMemo<SvgDiffHints | undefined>(() => {
    if (!activeCanvasDragKind || dragPatchMode !== "partial") {
      return undefined;
    }
    if (!dragAffectedSourceIds || dragAffectedSourceIds.length === 0) {
      return undefined;
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
  const guideStrokeWidth = 1 / Math.max(canvasTransform.scale, 1e-3);
  const guideHitStrokeWidth = 12 / Math.max(canvasTransform.scale, 1e-3);
  const snapStrokeWidth = 1 / Math.max(canvasTransform.scale, 1e-3);
  const snapCrossSize = 3 / Math.max(canvasTransform.scale, 1e-3);
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
    const anchorLeft = popupAnchorBox?.x ?? sourceBounds?.minX ?? contentBox.x;
    const anchorRight = popupAnchorBox ? popupAnchorBox.x + popupAnchorBox.width : (sourceBounds?.maxX ?? (contentBox.x + contentBox.width));
    const anchorTop = popupAnchorBox?.y ?? sourceBounds?.minY ?? contentBox.y;
    const anchorBottom = popupAnchorBox ? popupAnchorBox.y + popupAnchorBox.height : (sourceBounds?.maxY ?? (contentBox.y + contentBox.height));
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
    canUseCustomTextEditCaret &&
    textEditingSession != null &&
    textEditingSession.selectionStart === textEditingSession.selectionEnd;

  const contextMenuDefinition = useMemo(
    () =>
      buildCanvasContextMenuDefinition({
        includeEditEquationForSingleNode: contextMenuState?.includeEditEquationForSingleNode ?? false,
        includeMatrixMultiInsertRowAbove: contextMenuState?.includeMatrixMultiInsertRowAbove ?? false,
        includeMatrixMultiInsertRowBelow: contextMenuState?.includeMatrixMultiInsertRowBelow ?? false,
        includeMatrixMultiRemoveRow: contextMenuState?.includeMatrixMultiRemoveRow ?? false,
        includeMatrixMultiInsertColumnLeft: contextMenuState?.includeMatrixMultiInsertColumnLeft ?? false,
        includeMatrixMultiInsertColumnRight: contextMenuState?.includeMatrixMultiInsertColumnRight ?? false,
        includeMatrixMultiRemoveColumn: contextMenuState?.includeMatrixMultiRemoveColumn ?? false
      }),
    [
      contextMenuState?.includeEditEquationForSingleNode,
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
        onBackgroundClick={onBackgroundClick}
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
        visibleRanges={visibleRanges}
        showGuides={showGuides}
        renderedGuides={renderedGuides}
        guideStrokeWidth={guideStrokeWidth}
        guideHitStrokeWidth={guideHitStrokeWidth}
        onGuidePointerDown={onGuidePointerDown}
        snapLines={snapLines}
        snapStrokeWidth={snapStrokeWidth}
        snapCrossSize={snapCrossSize}
        toolPreview={toolPreview}
        handleStrokeWidth={handleStrokeWidth}
        previewArrowPoints={previewArrowPoints}
        hitRegions={hitRegions}
        hoveredElementId={hoveredElementId}
        editableTextRegionKeys={editableTextRegionKeys}
        draggableSourceIds={draggableSourceIds}
        onElementPointerDown={onElementPointerDown}
        onElementContextMenu={onElementContextMenu}
        onElementDoubleClick={onElementDoubleClick}
        onHoverChange={(id: string | null) => dispatch({ type: "SET_HOVERED_ELEMENT", id })}
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
        nodeAnchorOverlay={nodeAnchorOverlay}
        handleHalfSize={handleHalfSize}
        handleDisplays={handleDisplays}
        onHandlePointerDown={onHandlePointerDown}
        onResizeHandlePointerDown={onResizeHandlePointerDown}
        onRotateHandlePointerDown={onRotateHandlePointerDown}
        platform={platform}
        contextMenuState={contextMenuState}
        commandRuntimeBindings={commandRuntime.bindings}
        contextMenuDefinition={contextMenuDefinition}
        onContextMenuClose={() => setContextMenuState(null)}
        onContextMenuCommandRun={(commandId: AppMenuCommandId, origin: any) => {
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
        onTextEditTextareaChange={handleTextEditTextareaChange}
        onTextEditTextareaSelect={handleTextEditTextareaSelect}
        onTextEditTextareaCopy={stopTextEditTextareaClipboardPropagation}
        onTextEditTextareaCut={stopTextEditTextareaClipboardPropagation}
        onTextEditTextareaPaste={stopTextEditTextareaClipboardPropagation}
        onTextEditTextareaKeyDown={handleTextEditTextareaKeyDown}
        selectionHint={pathSelectionHint}
        showDevPanel={showDevPanel}
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
            onClose={() => setEquationModalTarget(null)}
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

function collectMatrixDescendantSourceIdsForChangedSources(
  elements: readonly SceneElement[],
  changedSourceIds: readonly string[]
): string[] {
  if (elements.length === 0 || changedSourceIds.length === 0) {
    return [];
  }
  const changed = new Set(changedSourceIds);
  const descendantSourceIds = new Set<string>();
  for (const element of elements) {
    const matrixSourceId = element.matrixCell?.matrixSourceId?.trim();
    if (!matrixSourceId || !changed.has(matrixSourceId)) {
      continue;
    }
    descendantSourceIds.add(element.sourceRef.sourceId);
    const cellSourceId = element.matrixCell?.cellSourceId?.trim();
    if (cellSourceId) {
      descendantSourceIds.add(cellSourceId);
    }
  }
  return [...descendantSourceIds];
}

function mergeSourceIdLists(left: readonly string[], right: readonly string[]): string[] {
  if (left.length === 0) {
    return [...right];
  }
  if (right.length === 0) {
    return [...left];
  }
  return [...new Set([...left, ...right])];
}
