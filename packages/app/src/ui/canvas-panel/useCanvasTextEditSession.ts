import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SyntheticEvent as ReactSyntheticEvent
} from "react";
import {
  clientPoint as makeClientPoint,
  svgPoint as makeSvgPoint,
  pt,
  px,
  viewportPoint
} from "@tikz-editor/core/coords/index";
import {
  getKnuthPlassCaretFromPoint,
  getKnuthPlassLineRangeFromPoint,
  getKnuthPlassVListGeometrySnapshot,
  getKnuthPlassVListSourceHitFromSnapshot,
  type VListSourceHit
} from "@tikz-editor/core/text/knuth-plass";
import {
  documentOffsetToTextarea,
  documentSourceOffset
} from "@tikz-editor/core/text/source-coordinates";
import {
  beamerCaretAtomBeside,
  beamerCaretRowEdgeOffset,
  beamerStructuralBackspacePatch,
  beamerStructuralDeletePatch,
  beamerStructuralEnterPatch,
  beamerStructuralLineBreakPatch,
  beamerStructuralTabPatch,
  nearestBeamerCaretOffset,
  nextBeamerCaretOffset,
  verticalBeamerCaretOffset,
  type BeamerCaretDomain,
  type BeamerStructuralKeyResult
} from "@tikz-editor/core/beamer/index";
import type { CanvasTextEditPlacement } from "../../settings/types";
import type { CanvasTransform, EditorAction, ToolMode } from "../../store/types";
import type { ClientPoint, SvgBounds, ViewportPoint } from "../coords/types";
import { resolveRectHitRegionContentBox } from "../coords/regions";
import {
  INITIAL_CANVAS_TEXT_EDIT_STATE,
  isCanvasTextInputIntentType,
  reduceCanvasTextEdit,
  type CanvasTextEditAction
} from "./canvas-text-edit-machine";
import type {
  CanvasFocusInputModel,
  CanvasScopeEditBorder,
  CanvasTextEditPopupModel,
  CanvasTextEditViewModel
} from "./CanvasTextEditPopup";
import { clamp, clientToSvgPoint, viewportToSvgPoint } from "./geometry";
import { makeMergeKey, mapPointToRectRegionLocal } from "./panel-helpers";
import { expandSelectionToMathDelimiters } from "./text-selection-ranges";
import {
  applyTextMeasureFont,
  collectLogicalLineRanges,
  createVisualTextLayout,
  resolveVisualLineLeft
} from "./text-visual-layout";
import type {
  CanvasSnapshot,
  EditableTextTarget,
  TextEditingSession,
  TextSelectionOverlay
} from "./types";
import { useCanvasTextEditingEffects } from "./useCanvasTextEditingEffects";

type TextEditCaretOverlay = {
  left: number;
  top: number;
  height: number;
};

type TextSelectionDragMode = "char" | "word" | "line";

type TextLineRange = {
  start: number;
  end: number;
};

type ResolvedTextSourceHit = {
  offset: number;
  selectionRange: TextLineRange | null;
};

type TextSelectionDrag = {
  pointerId: number;
  sourceId: string;
  sceneTextId: string;
  anchorOffset: number;
  mode: TextSelectionDragMode;
  anchorLineRange: TextLineRange | null;
};

export type UseCanvasTextEditSessionArgs = {
  contextKey: string;
  source: string;
  sourceRevision: number;
  snapshot: CanvasSnapshot;
  toolMode: ToolMode;
  selectedElementIds: ReadonlySet<string>;
  canvasTransform: CanvasTransform;
  svgResult: CanvasSnapshot["svg"];
  viewportSize: { width: number; height: number };
  sourceBoundsSvg: ReadonlyMap<string, SvgBounds>;
  viewportRef: RefObject<HTMLDivElement | null>;
  interactionSvgRef: RefObject<SVGSVGElement | null>;
  svgLayerHostRef: RefObject<HTMLDivElement | null>;
  suppressNextBackgroundClickRef: RefObject<boolean>;
  resolveEditableTextTargetById: (
    targetId: string,
    preferredSceneTextId?: string | null
  ) => EditableTextTarget | null;
  /** Rendered caret-stop domain for a deck scope; null → source-style keys. */
  resolveDeckCaretDomain: (scopeId: string) => BeamerCaretDomain | null;
  /**
   * Esc ladder handoff (design doc "Object layer"): called before a
   * canvas-focused scope session closes on Escape, with the caret's document
   * offset. The panel selects the innermost containing object (when any) and
   * takes keyboard focus for the remaining ladder rungs.
   */
  onCanvasSessionEscape?: (session: TextEditingSession, caretDocumentOffset: number) => void;
  textLayoutContext: unknown;
  textEditPlacement: CanvasTextEditPlacement;
  dispatch: (action: EditorAction) => void;
};

export type CanvasTextEditSessionController = {
  textEditingSession: TextEditingSession | null;
  textSelectionOverlay: TextSelectionOverlay | null;
  view: CanvasTextEditViewModel;
  beginCanvasTextInteraction: (
    event: ReactPointerEvent<SVGElement>,
    target: EditableTextTarget
  ) => void;
  closeTextEditingSession: () => void;
  requestAdornmentTextEdit: (targetId: string) => void;
  /** Programmatic session entry (object-layer drill-in). */
  startTextEditingSession: (
    target: EditableTextTarget,
    selectionStart: number,
    selectionEnd: number,
    historyMergeKey?: string
  ) => void;
};

const TEXT_CARET_OVERLAY_EPSILON_PX = 0.25;
/**
 * Scope buffers larger than this always use the docked bar: a floating
 * popup carrying a whole frame body would cover the very content being
 * edited.
 */
const SCOPE_POPUP_MAX_BUFFER_CHARS = 400;
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

/**
 * Measure the client rects covering a text range inside a textarea via the
 * same mirror technique as {@link resolveTextareaCaretClientRect}: an
 * unfocused textarea hides its native selection, so the popup/bar draws
 * these itself while the canvas surface owns the keyboard. Returns one rect
 * per rendered line, in textarea-relative coordinates (scroll applied),
 * clipped to the textarea viewport.
 */
function resolveTextareaRangeClientRects(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number
): { left: number; top: number; width: number; height: number }[] | null {
  const documentRef = textarea.ownerDocument;
  const windowRef = documentRef.defaultView;
  if (!windowRef) {
    return null;
  }
  const boundedStart = clamp(Math.min(start, end), 0, textarea.value.length);
  const boundedEnd = clamp(Math.max(start, end), 0, textarea.value.length);
  if (boundedStart === boundedEnd) {
    return [];
  }
  const computed = windowRef.getComputedStyle(textarea);
  const textareaRect = textarea.getBoundingClientRect();
  const mirror = documentRef.createElement("div");
  const rangeSpan = documentRef.createElement("span");

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
  rangeSpan.textContent = textarea.value.slice(boundedStart, boundedEnd);

  try {
    mirror.append(textarea.value.slice(0, boundedStart), rangeSpan, textarea.value.slice(boundedEnd));
    documentRef.body.append(mirror);
    const viewWidth = textareaRect.width;
    const viewHeight = textarea.clientHeight > 0 ? textarea.clientHeight : textareaRect.height;
    const rects: { left: number; top: number; width: number; height: number }[] = [];
    const rangeRects = rangeSpan.getClientRects();
    for (let index = 0; index < rangeRects.length; index += 1) {
      const rect = rangeRects[index];
      if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
        continue;
      }
      const left = rect.left - textareaRect.left - textarea.scrollLeft;
      const top = rect.top - textareaRect.top - textarea.scrollTop;
      const clippedLeft = clamp(left, 0, viewWidth);
      const clippedTop = clamp(top, 0, viewHeight);
      const width = clamp(left + rect.width, 0, viewWidth) - clippedLeft;
      const height = clamp(top + rect.height, 0, viewHeight) - clippedTop;
      if (width <= 0 || height <= 0) {
        continue;
      }
      rects.push({ left: clippedLeft, top: clippedTop, width, height });
    }
    return rects;
  } finally {
    mirror.remove();
  }
}

/**
 * Keep the caret (or the selection focus end) visible inside a scrolled
 * textarea. Programmatic setSelectionRange and controlled value updates
 * never auto-scroll, so canvas clicks and typing in long scope buffers
 * would otherwise leave the caret outside the textarea viewport.
 */
function scrollTextareaCaretIntoView(textarea: HTMLTextAreaElement, offset: number): void {
  if (textarea.scrollHeight <= textarea.clientHeight) {
    return;
  }
  const caretRect = resolveTextareaCaretClientRect(textarea, offset);
  if (!caretRect) {
    return;
  }
  const textareaRect = textarea.getBoundingClientRect();
  const viewTop = textareaRect.top;
  const viewBottom = textareaRect.top + textarea.clientHeight;
  if (caretRect.top < viewTop) {
    textarea.scrollTop -= viewTop - caretRect.top;
  } else if (caretRect.bottom > viewBottom) {
    textarea.scrollTop += caretRect.bottom - viewBottom;
  }
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

function resolveWordSelectionRange(text: string, offset: number): TextLineRange {
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
    if (/\s/.test(previousChar) !== isWhitespaceRun) {
      break;
    }
    start -= 1;
  }
  while (end < text.length) {
    const nextChar = text[end] ?? "";
    if (/\s/.test(nextChar) !== isWhitespaceRun) {
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

function normalizeTextLineRange(range: TextLineRange, textLength: number): TextLineRange {
  const start = clamp(range.start, 0, textLength);
  const end = clamp(range.end, 0, textLength);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function textLineRangeFromVListSourceHit(
  hit: VListSourceHit | null,
  mapRenderOffsetToSource: (offset: number) => number,
  textLength: number
): TextLineRange | null {
  if (!hit?.selectionRange) {
    return null;
  }
  return normalizeTextLineRange({
    start: mapRenderOffsetToSource(hit.selectionRange.start),
    end: mapRenderOffsetToSource(hit.selectionRange.end)
  }, textLength);
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

function estimateTextOffsetFromClient(
  target: EditableTextTarget,
  clientPoint: ClientPoint,
  interactionSvgElement: SVGSVGElement | null,
  viewport: HTMLDivElement | null,
  svgResult: CanvasSnapshot["svg"],
  canvasTransform: CanvasTransform
): number {
  const contentBox = resolveRectHitRegionContentBox(target.region);
  const svgPoint = clientToSvgPoint(clientPoint, interactionSvgElement) ?? (() => {
    const viewportPoint = viewportPointFromClient(clientPoint, viewport);
    return svgResult
      ? viewportToSvgPoint(viewportPoint, canvasTransform, svgResult.viewBox)
      : makeSvgPoint(pt(clientPoint.x), pt(clientPoint.y));
  })();
  const localPoint = mapPointToRectRegionLocal(svgPoint, target.region);
  const ctx = getFallbackTextMeasureContext();
  applyTextMeasureFont(ctx, target.style);
  const layout = createVisualTextLayout(
    target.text,
    target.renderSourceText ?? target.text,
    (text) => ctx?.measureText(text).width ?? Number.NaN,
    { syntax: target.usesTex ? "tex" : "plain" }
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
  viewport: HTMLDivElement | null,
  svgResult: CanvasSnapshot["svg"],
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
    const viewportPoint = viewportPointFromClient(clientPoint, viewport);
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

export function useCanvasTextEditSession(
  args: UseCanvasTextEditSessionArgs
): CanvasTextEditSessionController {
  const {
    contextKey,
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
    onCanvasSessionEscape,
    textLayoutContext,
    textEditPlacement,
    dispatch
  } = args;
  const [state, setState] = useState(INITIAL_CANVAS_TEXT_EDIT_STATE);
  const stateRef = useRef(INITIAL_CANVAS_TEXT_EDIT_STATE);
  const textEditingSession = state.session;
  const textSelectionOverlay = state.selectionOverlay;
  const textEditFocusSurface = state.focusSurface;
  const canvasSurfaceFocused =
    textEditingSession?.isScopeSession === true && textEditFocusSurface === "canvas";
  const [pendingAdornmentTextEditTargetId, setPendingAdornmentTextEditTargetId] = useState<string | null>(null);
  const textSelectionDragRef = useRef<TextSelectionDrag | null>(null);
  const textEditTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canvasFocusInputRef = useRef<HTMLTextAreaElement | null>(null);
  const textEditPopupRef = useRef<HTMLDivElement | null>(null);
  const [textEditPopupHeight, setTextEditPopupHeight] = useState<number | null>(null);
  const [textEditCaretOverlay, setTextEditCaretOverlay] = useState<TextEditCaretOverlay | null>(null);
  const [textEditInactiveSelectionRects, setTextEditInactiveSelectionRects] = useState<
    { left: number; top: number; width: number; height: number }[] | null
  >(null);
  const pendingTextEditPasteRef = useRef<string | null>(null);
  const pendingTextEditInsertTextRef = useRef<string | null>(null);
  /**
   * Sticky goal column for consecutive ↑/↓ presses: survives only while the
   * caret sits where the last vertical move left it, so any other movement
   * (click, typing, horizontal keys) starts a fresh goal without needing to
   * hook every selection path.
   */
  const canvasVerticalGoalRef = useRef<{ offset: number; x: number } | null>(null);
  const previousContextKeyRef = useRef(contextKey);
  const sourceRevisionRef = useRef(sourceRevision);

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useLayoutEffect(() => {
    sourceRevisionRef.current = sourceRevision;
  }, [sourceRevision]);

  const dispatchCanvasTextEditAction = useCallback((action: CanvasTextEditAction) => {
    const reduced = reduceCanvasTextEdit(stateRef.current, action);
    stateRef.current = reduced.state;
    setState(reduced.state);
    for (const effect of reduced.effects) {
      if (effect.type !== "apply_source_patch") {
        continue;
      }
      dispatch({
        type: "APPLY_SOURCE_PATCHES",
        baseRevision: sourceRevisionRef.current,
        changedSourceIds: [effect.sourceId],
        historyMergeKey: effect.historyMergeKey,
        patches: [
          {
            oldSpan: effect.previousSpan,
            newSpan: effect.changedSpan,
            replacement: effect.replacement
          }
        ],
        canvasTextEditMask: effect.maskSpan
          ? {
              elementId: effect.sourceId,
              span: effect.maskSpan
            }
          : undefined
      });
      sourceRevisionRef.current += 1;
    }
  }, [dispatch]);

  const closeTextEditingSession = useCallback(() => {
    dispatchCanvasTextEditAction({ type: "session_close" });
  }, [dispatchCanvasTextEditAction]);

  const requestAdornmentTextEdit = useCallback((targetId: string) => {
    setPendingAdornmentTextEditTargetId(targetId);
  }, []);

  useLayoutEffect(() => {
    if (previousContextKeyRef.current === contextKey) {
      return;
    }
    previousContextKeyRef.current = contextKey;
    textSelectionDragRef.current = null;
    setPendingAdornmentTextEditTargetId(null);
    dispatchCanvasTextEditAction({ type: "session_close" });
  }, [contextKey, dispatchCanvasTextEditAction]);

  const activeCanvasTextEditSourceId = textEditingSession?.sourceId ?? null;
  useEffect(() => {
    dispatch({ type: "SET_ACTIVE_CANVAS_TEXT_EDIT", sourceId: activeCanvasTextEditSourceId });
    return () => {
      dispatch({ type: "SET_ACTIVE_CANVAS_TEXT_EDIT", sourceId: null });
    };
  }, [activeCanvasTextEditSourceId, dispatch]);

  useEffect(() => {
    if (!textEditingSession) {
      pendingTextEditPasteRef.current = null;
      pendingTextEditInsertTextRef.current = null;
    }
  }, [textEditingSession]);

  const resolveRenderedMathTextElement = useCallback((
    target: EditableTextTarget,
    paragraphIdOverride?: string
  ): SVGGraphicsElement | null => {
    const host = svgLayerHostRef.current;
    if (!host) {
      return null;
    }
    const candidates = Array.from(
      host.querySelectorAll<SVGGraphicsElement>(
        'svg[data-text-renderer="tex"], g[data-paragraph-id]'
      )
    );
    if (paragraphIdOverride) {
      for (const candidate of candidates) {
        if (candidate.getAttribute("data-paragraph-id") === paragraphIdOverride) {
          return candidate;
        }
      }
      return null;
    }
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
  }, [svgLayerHostRef]);

  const resolveScopeParagraphAtClient = useCallback(
    (target: EditableTextTarget, clientPoint: ClientPoint) => {
      const paragraphs = target.scopeParagraphs;
      if (!paragraphs || paragraphs.length === 0) {
        return null;
      }
      const svgPoint = clientToSvgPoint(clientPoint, interactionSvgRef.current) ?? (
        svgResult
          ? viewportToSvgPoint(
              viewportPointFromClient(clientPoint, viewportRef.current),
              canvasTransform,
              svgResult.viewBox
            )
          : null
      );
      if (!svgPoint) {
        return paragraphs.find((paragraph) => paragraph.paragraphId === target.paragraphId)
          ?? paragraphs[0];
      }
      const x = Number(svgPoint.x);
      const y = Number(svgPoint.y);
      let best = paragraphs[0];
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const paragraph of paragraphs) {
        const { bounds } = paragraph;
        const dx = x < bounds.x ? bounds.x - x : Math.max(0, x - (bounds.x + bounds.width));
        const dy = y < bounds.y ? bounds.y - y : Math.max(0, y - (bounds.y + bounds.height));
        if (dx === 0 && dy === 0) {
          return paragraph;
        }
        // Prefer the paragraph whose vertical band contains the pointer:
        // clicking past a line's end should target that line's paragraph.
        const distance = dy * dy * 4096 + dx * dx;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = paragraph;
        }
      }
      return best;
    },
    [canvasTransform, interactionSvgRef, svgResult, viewportRef]
  );

  const resolveParagraphHitView = useCallback(
    (target: EditableTextTarget, clientPoint: ClientPoint): {
      paragraphId: string;
      sourceText: string;
      sourceStartOffset: number;
      containerElement: SVGGraphicsElement | null;
    } | null => {
      const scopeParagraph = resolveScopeParagraphAtClient(target, clientPoint);
      if (scopeParagraph) {
        return {
          paragraphId: scopeParagraph.paragraphId,
          sourceText: source.slice(scopeParagraph.sourceSpan.from, scopeParagraph.sourceSpan.to),
          sourceStartOffset: scopeParagraph.sourceSpan.from,
          containerElement: resolveRenderedMathTextElement(target, scopeParagraph.paragraphId)
        };
      }
      if (!target.paragraphId) {
        return null;
      }
      return {
        paragraphId: target.paragraphId,
        sourceText: target.layoutSourceText ?? target.text,
        sourceStartOffset: target.layoutSourceSpan?.from ?? target.sourceSpan.from,
        containerElement: resolveRenderedMathTextElement(target)
      };
    },
    [resolveRenderedMathTextElement, resolveScopeParagraphAtClient, source]
  );

  const resolveTexVListSourceHitFromClient = useCallback(
    (
      target: EditableTextTarget,
      clientPoint: ClientPoint,
      layoutContext: unknown,
      containerElement: SVGGraphicsElement,
      paragraphId: string | null
    ): VListSourceHit | null => {
      if (!paragraphId || !(target.usesTex && target.layoutKind !== "single-line")) {
        return null;
      }
      const snapshot = getKnuthPlassVListGeometrySnapshot({
        layoutContext,
        paragraphId,
        containerElement
      });
      return getKnuthPlassVListSourceHitFromSnapshot({ snapshot, clientPoint });
    },
    []
  );

  const resolveTextSourceHitFromClient = useCallback(
    async (target: EditableTextTarget, clientPoint: ClientPoint): Promise<ResolvedTextSourceHit | null> => {
      if (target.isForeachTemplateEdit) {
        return null;
      }
      const layoutContext = textLayoutContext;
      const view = resolveParagraphHitView(target, clientPoint);
      const requiresParagraphGeometry = target.usesTex && target.layoutKind !== "single-line";
      if (!view || !layoutContext || !view.containerElement) {
        if (requiresParagraphGeometry) {
          console.error("[canvas-text-edit] Missing paragraph geometry for multiline TeX hit-testing.", {
            sourceId: target.sourceId,
            paragraphId: view?.paragraphId ?? target.paragraphId,
            layoutKind: target.layoutKind
          });
          return null;
        }
        const offset = estimateTextOffsetFromClient(
          target,
          clientPoint,
          interactionSvgRef.current,
          viewportRef.current,
          svgResult,
          canvasTransform
        );
        return { offset, selectionRange: null };
      }
      const containerElement = view.containerElement;
      const result = await getKnuthPlassCaretFromPoint(layoutContext, {
        paragraphId: view.paragraphId,
        sourceText: view.sourceText,
        sourceTextStartOffset: documentSourceOffset(view.sourceStartOffset),
        sourceCoordinateSpace: "document",
        containerElement,
        clientPoint
      });
      if (result.ok && result.offset != null) {
        return {
          offset: documentOffsetToTextarea(result.offset, target.sourceSpan),
          selectionRange: null,
        };
      }
      console.error("[canvas-text-edit] Paragraph source hit failed.", result.error);
      const vlistHit = resolveTexVListSourceHitFromClient(
        target,
        clientPoint,
        layoutContext,
        containerElement,
        view.paragraphId
      );
      if (!vlistHit) {
        return null;
      }
      return {
        offset: documentOffsetToTextarea(documentSourceOffset(vlistHit.offset), target.sourceSpan),
        selectionRange: textLineRangeFromVListSourceHit(
          vlistHit,
          (offset) => documentOffsetToTextarea(documentSourceOffset(offset), target.sourceSpan),
          target.text.length
        ),
      };
    },
    [canvasTransform, interactionSvgRef, resolveParagraphHitView, resolveTexVListSourceHitFromClient, svgResult, textLayoutContext, viewportRef]
  );

  const resolveTextLineRangeFromClient = useCallback(
    async (target: EditableTextTarget, clientPoint: ClientPoint): Promise<TextLineRange | null> => {
      if (target.isForeachTemplateEdit) {
        return null;
      }
      const layoutContext = textLayoutContext;
      const view = resolveParagraphHitView(target, clientPoint);
      const requiresParagraphGeometry = target.usesTex && target.layoutKind !== "single-line";
      if (view?.containerElement && layoutContext) {
        const containerElement = view.containerElement;
        const result = await getKnuthPlassLineRangeFromPoint(layoutContext, {
          paragraphId: view.paragraphId,
          sourceText: view.sourceText,
          sourceTextStartOffset: documentSourceOffset(view.sourceStartOffset),
          sourceCoordinateSpace: "document",
          containerElement,
          clientPoint
        });
        if (result.ok && result.lineStartOffset != null && result.lineEndOffset != null) {
          return normalizeTextLineRange({
            start: documentOffsetToTextarea(result.lineStartOffset, target.sourceSpan),
            end: documentOffsetToTextarea(result.lineEndOffset, target.sourceSpan)
          }, target.text.length);
        }
        const vlistLineRange = textLineRangeFromVListSourceHit(
          resolveTexVListSourceHitFromClient(
            target,
            clientPoint,
            layoutContext,
            containerElement,
            view.paragraphId
          ),
          (offset) => documentOffsetToTextarea(documentSourceOffset(offset), target.sourceSpan),
          target.text.length
        );
        if (vlistLineRange) {
          return vlistLineRange;
        }
      }
      if (requiresParagraphGeometry) {
        console.error("[canvas-text-edit] Missing paragraph geometry for multiline TeX line-range resolution.", {
          sourceId: target.sourceId,
          paragraphId: view?.paragraphId ?? target.paragraphId,
          layoutKind: target.layoutKind
        });
        return null;
      }
      return estimateTextLineRangeFromClient(
        target,
        clientPoint,
        interactionSvgRef.current,
        viewportRef.current,
        svgResult,
        canvasTransform
      );
    },
    [canvasTransform, interactionSvgRef, resolveParagraphHitView, resolveTexVListSourceHitFromClient, svgResult, textLayoutContext, viewportRef]
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
      if (target.atomicSelectionSpan) {
        // Atomic renders (macro output, embedded tikz, graphics) have no
        // caret geometry of their own: clicking one selects the atom's
        // full source span in the scope buffer.
        event.preventDefault();
        startTextEditingSession(
          target,
          clamp(target.atomicSelectionSpan.from - target.sourceSpan.from, 0, target.text.length),
          clamp(target.atomicSelectionSpan.to - target.sourceSpan.from, 0, target.text.length),
          textEditingSession?.sourceId === target.sourceId ? textEditingSession.historyMergeKey : undefined
        );
        return;
      }
      const requestRevision = state.asyncRequestRevision + 1;
      const baseInputRevision = state.inputRevision;
      const existingHistoryMergeKey =
        textEditingSession?.sourceId === target.sourceId ? textEditingSession.historyMergeKey : undefined;
      const clickCount = event.detail >= 2 ? event.detail : 1;
      const mode = resolveTextSelectionModeFromClickCount(clickCount);
      const clientPoint = makeClientPoint(px(event.clientX), px(event.clientY));
      const requiresParagraphGeometry = target.usesTex && target.layoutKind !== "single-line";
      const provisionalOffset = requiresParagraphGeometry
        ? 0
        : estimateTextOffsetFromClient(
            target,
            clientPoint,
            interactionSvgRef.current,
            viewportRef.current,
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
      const sourceHitPromise = resolveTextSourceHitFromClient(target, clientPoint);
      const lineRangePromise = mode === "line"
        ? resolveTextLineRangeFromClient(target, clientPoint)
        : Promise.resolve<TextLineRange | null>(null);
      void Promise.all([sourceHitPromise, lineRangePromise]).then(([sourceHit, lineRange]) => {
        const offset = sourceHit?.offset ?? null;
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
        const selection = (mode === "char" || mode === "line") && sourceHit?.selectionRange
          ? sourceHit.selectionRange
          : resolveTextSelectionRangeForMode(target.text, mode, resolvedOffset, resolvedLineRange);
        const expandedSelection = expandSelectionToMathDelimiters(target.text, selection);
        dispatchCanvasTextEditAction({
          type: "pointer_resolved",
          requestRevision,
          baseInputRevision,
          sourceId: target.sourceId,
          sceneTextId: target.sceneTextId,
          pointerId,
          selectionStart: expandedSelection.start,
          selectionEnd: expandedSelection.end,
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
          // Window listeners still complete the drag when pointer capture is unavailable.
        }
      });
    },
    [
      canvasTransform,
      dispatchCanvasTextEditAction,
      interactionSvgRef,
      resolveTextLineRangeFromClient,
      resolveTextSourceHitFromClient,
      source,
      startTextEditingSession,
      state.asyncRequestRevision,
      state.inputRevision,
      suppressNextBackgroundClickRef,
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
      if (isCanvasTextInputIntentType(inputType)) {
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

  const stopTextEditTextareaClipboardPropagation = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      event.stopPropagation();
    },
    []
  );

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

  const handleSharedTextEditModifierKeys = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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

  const isFocusSurfaceChord = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "e"
  ), []);

  const handleTextEditTextareaKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      textSelectionDragRef.current = null;
      // Esc steps out one level: bar focus hands the keyboard back to the
      // canvas surface in scope sessions; node sessions close outright.
      if (stateRef.current.session?.isScopeSession) {
        dispatchCanvasTextEditAction({ type: "focus_surface", surface: "canvas" });
      } else {
        dispatchCanvasTextEditAction({ type: "session_close" });
      }
      return;
    }

    if (isFocusSurfaceChord(event)) {
      // Cmd+E targets the bar, which is already focused; swallow it so the
      // browser's "use selection for find" cannot fire mid-session.
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    handleSharedTextEditModifierKeys(event);
  }, [dispatchCanvasTextEditAction, handleSharedTextEditModifierKeys, isFocusSurfaceChord]);

  /**
   * Canvas-focus navigation over the rendered caret-stop domain: arrows move
   * by rendered stops (atomic over macro calls and embedded objects, per-
   * offset inside math), ↑/↓ by rendered rows, Home/End to row edges, and
   * Backspace/Delete beside an atomic span select it before deleting (Word's
   * select-then-delete convention). Returns false to fall through to native
   * source-style behavior (no domain, alt-modified keys, range deletes).
   */
  const handleCanvasRenderedMotionKey = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    const session = stateRef.current.session;
    if (!session?.isScopeSession) {
      return false;
    }
    const key = event.key;
    const horizontal = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
    const vertical = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
    const isHome = key === "Home";
    const isEnd = key === "End";
    const isBackspace = key === "Backspace";
    const isDelete = key === "Delete";
    if (!horizontal && !vertical && !isHome && !isEnd && !isBackspace && !isDelete) {
      return false;
    }
    if (event.altKey) {
      return false;
    }
    const withPrimary = event.metaKey || event.ctrlKey;
    if ((isBackspace || isDelete) && (withPrimary || event.shiftKey)) {
      return false;
    }
    const domain = resolveDeckCaretDomain(session.sourceId);
    if (!domain || domain.offsets.length === 0) {
      return false;
    }
    const input = event.currentTarget;
    const bufferLength = session.text.length;
    const toDocument = (local: number) => session.sourceSpan.from + clamp(local, 0, bufferLength);
    const toLocal = (documentOffset: number) =>
      clamp(documentOffset - session.sourceSpan.from, 0, bufferLength);
    const applySelection = (start: number, end: number, direction: "forward" | "backward" | "none") => {
      event.preventDefault();
      event.stopPropagation();
      pendingTextEditInsertTextRef.current = null;
      input.setSelectionRange(start, end, direction);
      dispatchCanvasTextEditAction({
        type: "textarea_selection",
        selectionStart: start,
        selectionEnd: end
      });
    };

    if (isBackspace || isDelete) {
      if (session.selectionStart !== session.selectionEnd) {
        // Range deletes (including an atom selected by the previous press)
        // run natively through the beforeinput machine.
        return false;
      }
      const atom = beamerCaretAtomBeside(
        domain,
        toDocument(session.selectionStart),
        isBackspace ? "before" : "after"
      );
      if (!atom) {
        return false;
      }
      applySelection(toLocal(atom.from), toLocal(atom.to), isBackspace ? "backward" : "forward");
      return true;
    }

    const selectionBackward = input.selectionDirection === "backward";
    const focusLocal = selectionBackward ? session.selectionStart : session.selectionEnd;
    const anchorLocal = selectionBackward ? session.selectionEnd : session.selectionStart;
    const hasRange = session.selectionStart !== session.selectionEnd;
    const focusDoc = toDocument(focusLocal);
    const domainFocus = nearestBeamerCaretOffset(domain, focusDoc) ?? focusDoc;

    let nextDoc: number | null;
    let nextVerticalGoal: { offset: number; x: number } | null = null;
    if (isHome || isEnd || (withPrimary && horizontal !== 0)) {
      nextDoc = beamerCaretRowEdgeOffset(
        domain,
        domainFocus,
        isHome || horizontal < 0 ? "start" : "end"
      );
    } else if (withPrimary && vertical !== 0) {
      const row = vertical < 0 ? domain.rows[0] : domain.rows[domain.rows.length - 1];
      const stop = vertical < 0 ? row?.stops[0] : row?.stops[row.stops.length - 1];
      nextDoc = stop?.offset ?? null;
    } else if (horizontal !== 0) {
      if (!event.shiftKey && hasRange) {
        // Plain arrows collapse a range onto its edge without moving.
        nextDoc = horizontal < 0
          ? toDocument(session.selectionStart)
          : toDocument(session.selectionEnd);
      } else {
        nextDoc = nextBeamerCaretOffset(domain, domainFocus, horizontal) ?? domainFocus;
      }
    } else {
      const remembered = canvasVerticalGoalRef.current;
      const goalX = remembered?.offset === domainFocus ? remembered.x : null;
      const moved = verticalBeamerCaretOffset(domain, domainFocus, vertical as -1 | 1, goalX);
      if (moved) {
        nextDoc = moved.offset;
        nextVerticalGoal = { offset: moved.offset, x: moved.goalX };
      } else {
        nextDoc = domainFocus;
      }
    }
    if (nextDoc == null) {
      return false;
    }
    canvasVerticalGoalRef.current = nextVerticalGoal;

    const nextLocal = toLocal(nextDoc);
    if (event.shiftKey) {
      applySelection(
        Math.min(anchorLocal, nextLocal),
        Math.max(anchorLocal, nextLocal),
        nextLocal < anchorLocal ? "backward" : "forward"
      );
    } else {
      applySelection(nextLocal, nextLocal, "none");
    }
    return true;
  }, [dispatchCanvasTextEditAction, resolveDeckCaretDomain]);

  const handleCanvasStructuralKey = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    const currentState = stateRef.current;
    const session = currentState.session;
    if (!session?.isScopeSession || currentState.compositionRange) {
      return false;
    }
    const key = event.key;
    const isEnter = key === "Enter";
    const isTab = key === "Tab";
    const isBackspace = key === "Backspace";
    const isDelete = key === "Delete";
    if (!isEnter && !isTab && !isBackspace && !isDelete) {
      return false;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }
    if ((isBackspace || isDelete) && event.shiftKey) {
      return false;
    }
    const hasRange = session.selectionStart !== session.selectionEnd;
    if (hasRange && (isBackspace || isDelete)) {
      // Range deletes (including a selected atom) run natively through the
      // beforeinput machine.
      return false;
    }
    const swallow = (): boolean => {
      event.preventDefault();
      event.stopPropagation();
      return true;
    };
    const domain = resolveDeckCaretDomain(session.sourceId);
    if (!domain) {
      // No rendered domain: degrade to plain source keys (design safety
      // property); Tab still must not escape the session.
      return isTab ? swallow() : false;
    }
    const offset =
      session.sourceSpan.from + Math.min(session.selectionStart, session.selectionEnd);
    let result: BeamerStructuralKeyResult;
    if (isEnter) {
      if (hasRange) {
        return swallow();
      }
      result = event.shiftKey
        ? beamerStructuralLineBreakPatch(domain, offset)
        : beamerStructuralEnterPatch(domain, offset);
      if (result == null) {
        // Unknown context (fallback-rendered chunk): plain newline through
        // the beforeinput machine.
        return false;
      }
    } else if (isTab) {
      result = hasRange
        ? "swallow"
        : beamerStructuralTabPatch(domain, offset, event.shiftKey ? "unnest" : "nest") ??
          "swallow";
    } else {
      result = isBackspace
        ? beamerStructuralBackspacePatch(domain, offset)
        : beamerStructuralDeletePatch(domain, offset);
      if (result == null) {
        return false;
      }
    }
    if (result === "swallow") {
      return swallow();
    }
    // Staleness guard: the domain reflects the last reconciled render.
    // Apply only while every edited range still holds the text the patch
    // was computed against; otherwise swallow and wait for reconciliation.
    const toLocal = (documentOffset: number) => documentOffset - session.sourceSpan.from;
    for (const edit of result.edits) {
      const from = toLocal(edit.span.from);
      const to = toLocal(edit.span.to);
      if (from < 0 || to > session.text.length || from > to) {
        return swallow();
      }
      if (
        session.text.slice(from, to) !== domain.source.slice(edit.span.from, edit.span.to)
      ) {
        return swallow();
      }
    }
    let nextText = session.text;
    for (let index = result.edits.length - 1; index >= 0; index -= 1) {
      const edit = result.edits[index];
      nextText =
        nextText.slice(0, toLocal(edit.span.from)) +
        edit.insert +
        nextText.slice(toLocal(edit.span.to));
    }
    const caretLocal = clamp(toLocal(result.caretOffset), 0, nextText.length);
    event.preventDefault();
    event.stopPropagation();
    pendingTextEditInsertTextRef.current = null;
    canvasVerticalGoalRef.current = null;
    // Write the DOM inputs before dispatching (the motion handler's order):
    // a selectionchange queued against the pre-edit caret otherwise fires
    // after the machine update and echoes the stale offset back into it.
    for (const input of [canvasFocusInputRef.current, textEditTextareaRef.current]) {
      if (input) {
        input.value = nextText;
        input.setSelectionRange(caretLocal, caretLocal);
      }
    }
    dispatchCanvasTextEditAction({
      type: "structural_edit",
      nextText,
      selectionStart: caretLocal,
      selectionEnd: caretLocal
    });
    return true;
  }, [dispatchCanvasTextEditAction, resolveDeckCaretDomain]);

  const handleCanvasFocusInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      textSelectionDragRef.current = null;
      // Esc ladder rung 1: hand the caret position to the object layer
      // before closing; the panel selects the innermost containing object.
      const session = stateRef.current.session;
      if (session?.isScopeSession && onCanvasSessionEscape) {
        onCanvasSessionEscape(
          session,
          session.sourceSpan.from +
            Math.min(session.selectionStart, session.selectionEnd)
        );
      }
      dispatchCanvasTextEditAction({ type: "session_close" });
      return;
    }

    if (isFocusSurfaceChord(event)) {
      event.preventDefault();
      event.stopPropagation();
      dispatchCanvasTextEditAction({ type: "focus_surface", surface: "bar" });
      return;
    }

    if (handleCanvasStructuralKey(event)) {
      return;
    }

    if (event.key === "Tab") {
      // A modified Tab the structural handler declined: swallow so focus
      // cannot tab out of the hidden input mid-session.
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (handleCanvasRenderedMotionKey(event)) {
      return;
    }

    handleSharedTextEditModifierKeys(event);
  }, [
    dispatchCanvasTextEditAction,
    handleCanvasRenderedMotionKey,
    handleCanvasStructuralKey,
    handleSharedTextEditModifierKeys,
    isFocusSurfaceChord,
    onCanvasSessionEscape
  ]);

  const handleTextEditTextareaFocus = useCallback(() => {
    const currentState = stateRef.current;
    if (currentState.session && currentState.focusSurface !== "bar") {
      dispatchCanvasTextEditAction({ type: "focus_surface", surface: "bar" });
    }
  }, [dispatchCanvasTextEditAction]);

  const handleTextEditPopupPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  useLayoutEffect(() => {
    if (!textEditingSession) {
      return;
    }
    // Both surfaces feed the same beforeinput-intercepting machine; typing
    // is identical whichever input holds DOM focus.
    const inputs = [textEditTextareaRef.current, canvasFocusInputRef.current].filter(
      (input): input is HTMLTextAreaElement => input != null
    );
    if (inputs.length === 0) {
      return;
    }
    const cleanups = inputs.map((input) => {
      const handleBeforeInput = (event: Event) => {
        const inputEvent = event as InputEvent;
        if (typeof inputEvent.inputType === "string") {
          dispatchTextEditBeforeInputIntent(inputEvent, input);
        }
      };
      input.addEventListener("beforeinput", handleBeforeInput);
      return () => { input.removeEventListener("beforeinput", handleBeforeInput); };
    });
    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [dispatchTextEditBeforeInputIntent, textEditingSession]);

  // Layout effect so the scroll-into-view adjustment lands before the caret
  // overlay (a later layout effect) measures against the textarea viewport.
  useLayoutEffect(() => {
    const textarea = textEditTextareaRef.current;
    const canvasInput = canvasFocusInputRef.current;
    if (!textEditingSession || (!textarea && !canvasInput)) {
      return;
    }
    const activeInput = canvasSurfaceFocused ? canvasInput : textarea;
    if (activeInput && document.activeElement !== activeInput) {
      activeInput.focus({ preventScroll: true });
    }
    const start = clamp(textEditingSession.selectionStart, 0, textEditingSession.text.length);
    const end = clamp(textEditingSession.selectionEnd, 0, textEditingSession.text.length);
    // Both inputs mirror the buffer selection so native editing semantics
    // (word deletes, composition) report correct offsets from either.
    for (const input of [textarea, canvasInput]) {
      if (input && (input.selectionStart !== start || input.selectionEnd !== end)) {
        input.setSelectionRange(start, end);
      }
    }
    if (textarea) {
      scrollTextareaCaretIntoView(textarea, end);
    }
  }, [canvasSurfaceFocused, textEditingSession]);

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
    if (!textEditingSession) {
      return;
    }
    const inputs = [textEditTextareaRef.current, canvasFocusInputRef.current].filter(
      (input): input is HTMLTextAreaElement => input != null
    );
    if (inputs.length === 0) {
      return;
    }
    // With two mirroring inputs only the focused one is authoritative for
    // selection; the other's selection is programmatic echo.
    const syncSelectionFromInput = (input: HTMLTextAreaElement) => {
      if (document.activeElement !== input) {
        return;
      }
      dispatchCanvasTextEditAction({
        type: "textarea_selection",
        selectionStart: input.selectionStart ?? 0,
        selectionEnd: input.selectionEnd ?? 0
      });
    };
    const handleDocumentSelectionChange = () => {
      for (const input of inputs) {
        syncSelectionFromInput(input);
      }
    };
    const cleanups = inputs.map((input) => {
      const handleInputSelection = () => { syncSelectionFromInput(input); };
      input.addEventListener("select", handleInputSelection);
      input.addEventListener("mouseup", handleInputSelection);
      return () => {
        input.removeEventListener("select", handleInputSelection);
        input.removeEventListener("mouseup", handleInputSelection);
      };
    });
    document.addEventListener("selectionchange", handleDocumentSelectionChange);
    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
      document.removeEventListener("selectionchange", handleDocumentSelectionChange);
    };
  }, [dispatchCanvasTextEditAction, textEditingSession]);

  useLayoutEffect(() => {
    const textarea = textEditTextareaRef.current;
    if (!textEditingSession || !textarea || textEditingSession.selectionStart !== textEditingSession.selectionEnd) {
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
      const height = Math.max(1, Math.min(measuredRect.height, textareaRect.height));
      const left = measuredRect.left - textareaRect.left;
      const top = measuredRect.top - textareaRect.top;
      // A caret scrolled out of the textarea viewport is clipped like the
      // native one, not pinned to the nearest edge.
      if (
        top + height <= 0 ||
        top >= textareaRect.height ||
        left < -1 ||
        left > textareaRect.width + 1
      ) {
        setTextEditCaretOverlay(null);
        return;
      }
      const nextOverlay = {
        left: clamp(left, 0, textareaRect.width),
        top: clamp(top, 0, textareaRect.height - height),
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

  // While the canvas surface owns the keyboard the bar textarea is unfocused
  // and hides its native selection; mirror-measure the range so the bar can
  // draw it in the inactive (gray) style.
  useLayoutEffect(() => {
    const textarea = textEditTextareaRef.current;
    if (
      !textEditingSession ||
      !textarea ||
      !canvasSurfaceFocused ||
      textEditingSession.selectionStart === textEditingSession.selectionEnd
    ) {
      setTextEditInactiveSelectionRects(null);
      return;
    }
    const syncInactiveSelectionRects = () => {
      const currentTextarea = textEditTextareaRef.current;
      if (!currentTextarea) {
        setTextEditInactiveSelectionRects(null);
        return;
      }
      const rects = resolveTextareaRangeClientRects(
        currentTextarea,
        textEditingSession.selectionStart,
        textEditingSession.selectionEnd
      );
      setTextEditInactiveSelectionRects(rects && rects.length > 0 ? rects : null);
    };
    syncInactiveSelectionRects();
    textarea.addEventListener("scroll", syncInactiveSelectionRects, { passive: true });
    const windowRef = textarea.ownerDocument.defaultView;
    windowRef?.addEventListener("resize", syncInactiveSelectionRects);
    return () => {
      textarea.removeEventListener("scroll", syncInactiveSelectionRects);
      windowRef?.removeEventListener("resize", syncInactiveSelectionRects);
    };
  }, [canvasSurfaceFocused, textEditingSession, textEditPopupHeight]);

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
      const requestRevision = stateRef.current.asyncRequestRevision;
      const baseInputRevision = stateRef.current.inputRevision;
      const clientPoint = makeClientPoint(px(event.clientX), px(event.clientY));
      const offsetPromise = resolveTextSourceHitFromClient(target, clientPoint)
        .then((hit) => hit?.offset ?? null);
      const lineRangePromise = drag.mode === "line"
        ? resolveTextLineRangeFromClient(target, clientPoint)
        : Promise.resolve<TextLineRange | null>(null);
      void Promise.all([offsetPromise, lineRangePromise]).then(([offset, focusLineRange]) => {
        const resolvedOffset = offset == null ? drag.anchorOffset : clamp(offset, 0, target.text.length);
        const selection = expandSelectionToMathDelimiters(target.text, resolveTextSelectionRangeForDrag(
          target.text,
          drag.mode,
          drag.anchorOffset,
          resolvedOffset,
          drag.anchorLineRange,
          focusLineRange
        ));
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
      if (textSelectionDragRef.current?.pointerId === event.pointerId) {
        textSelectionDragRef.current = null;
      }
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
    resolveTextSourceHitFromClient,
  ]);

  useEffect(() => {
    if (!textEditingSession) {
      return;
    }
    const handleGlobalPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || viewportRef.current?.contains(target)) {
        return;
      }
      textSelectionDragRef.current = null;
      dispatchCanvasTextEditAction({ type: "session_close" });
    };
    window.addEventListener("pointerdown", handleGlobalPointerDown, true);
    return () => { window.removeEventListener("pointerdown", handleGlobalPointerDown, true); };
  }, [dispatchCanvasTextEditAction, textEditingSession, viewportRef]);

  useCanvasTextEditingEffects({
    toolMode,
    textEditingSession,
    textEditAsyncRequestRevision: state.asyncRequestRevision,
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
    svgResult,
    textLayoutContext
  });

  const supportsFieldSizing =
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("field-sizing", "content");
  const textEditTextareaSizing = useMemo(() => {
    if (!textEditingSession || supportsFieldSizing) {
      return null;
    }
    return { rows: Math.max(1, textEditingSession.text.split(/\r?\n/).length) };
  }, [supportsFieldSizing, textEditingSession]);

  const textEditPopupPlacement = useMemo(() => {
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
    const editedContentWidthSvg =
      (textEditingSession.editMode === "inline-typo" || textEditingSession.isScopeSession) &&
      popupAnchorBox
        ? popupAnchorBox.maxX - popupAnchorBox.minX
        : contentBox.width;
    const editorTextWidthPx =
      textEditingSession.editMode === "inline-typo"
        ? textEditingSession.text.length * 8 + 2
        : 0;
    const contentWidthPx = Math.max(
      editedContentWidthSvg * canvasTransform.scale,
      editorTextWidthPx,
      1
    );
    const minimumPopupWidth = textEditingSession.editMode === "inline-typo" ? 80 : 160;
    const maxWidth = clamp(
      Math.round(Math.max(nodeWidthPx, contentWidthPx) + 80),
      minimumPopupWidth,
      viewportSize.width - minPadding * 2
    );
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
    sourceBoundsSvg,
    svgResult,
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
  }, [supportsFieldSizing, textEditingSession, textEditPopupPlacement?.textareaWidth]);

  useLayoutEffect(() => {
    if (!textEditingSession || !textEditPopupPlacement) {
      setTextEditPopupHeight(null);
      return;
    }
    const popup = textEditPopupRef.current;
    if (!popup) {
      return;
    }
    const nextHeight = Math.ceil(popup.getBoundingClientRect().height);
    setTextEditPopupHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
  }, [textEditingSession, textEditPopupPlacement]);

  const textEditSurface = useMemo<"popup" | "bar" | null>(() => {
    if (!textEditingSession) {
      return null;
    }
    if (textEditPlacement === "bar") {
      return "bar";
    }
    if (
      textEditingSession.isScopeSession &&
      textEditingSession.text.length > SCOPE_POPUP_MAX_BUFFER_CHARS
    ) {
      return "bar";
    }
    return "popup";
  }, [textEditingSession, textEditPlacement]);

  const popup = useMemo<CanvasTextEditPopupModel | null>(() => {
    if (!textEditingSession || !textEditSurface) {
      return null;
    }
    if (textEditSurface === "popup" && !textEditPopupPlacement) {
      return null;
    }
    return {
      session: textEditingSession,
      surface: textEditSurface,
      focusSurface: textEditFocusSurface,
      placement: textEditPopupPlacement ?? { centerX: 0, top: 0, maxWidth: 0, textareaWidth: 0 },
      measuredHeight: textEditPopupHeight,
      popupRef: textEditPopupRef,
      textareaRef: textEditTextareaRef,
      textareaSizing: textEditTextareaSizing,
      caretOverlay: textEditCaretOverlay,
      hideNativeCaret:
        textEditingSession.selectionStart === textEditingSession.selectionEnd &&
        textEditCaretOverlay != null,
      inactiveSelectionRects: canvasSurfaceFocused ? textEditInactiveSelectionRects : null,
      onPopupPointerDown: handleTextEditPopupPointerDown,
      onTextareaFocus: handleTextEditTextareaFocus,
      onTextareaSelect: handleTextEditTextareaSelect,
      onTextareaCopy: stopTextEditTextareaClipboardPropagation,
      onTextareaCut: stopTextEditTextareaClipboardPropagation,
      onTextareaPaste: handleTextEditTextareaPaste,
      onTextareaDrop: handleTextEditTextareaDrop,
      onTextareaKeyDown: handleTextEditTextareaKeyDown
    };
  }, [
    canvasSurfaceFocused,
    handleTextEditPopupPointerDown,
    handleTextEditTextareaDrop,
    handleTextEditTextareaFocus,
    handleTextEditTextareaKeyDown,
    handleTextEditTextareaPaste,
    handleTextEditTextareaSelect,
    stopTextEditTextareaClipboardPropagation,
    textEditingSession,
    textEditCaretOverlay,
    textEditFocusSurface,
    textEditInactiveSelectionRects,
    textEditPopupHeight,
    textEditPopupPlacement,
    textEditSurface,
    textEditTextareaSizing
  ]);

  const canvasFocusInput = useMemo<CanvasFocusInputModel | null>(() => {
    if (!textEditingSession?.isScopeSession) {
      return null;
    }
    // Mounted for the whole scope session (not just while canvas-focused) so
    // focus can move between surfaces without remount races.
    const caret = textSelectionOverlay?.caret ?? null;
    return {
      inputRef: canvasFocusInputRef,
      value: textEditingSession.text,
      position: caret ? { left: caret.bounds.minX, top: caret.bounds.minY } : null,
      onKeyDown: handleCanvasFocusInputKeyDown,
      onSelect: handleTextEditTextareaSelect,
      onCopy: stopTextEditTextareaClipboardPropagation,
      onCut: stopTextEditTextareaClipboardPropagation,
      onPaste: handleTextEditTextareaPaste,
      onDrop: handleTextEditTextareaDrop
    };
  }, [
    handleCanvasFocusInputKeyDown,
    handleTextEditTextareaDrop,
    handleTextEditTextareaPaste,
    handleTextEditTextareaSelect,
    stopTextEditTextareaClipboardPropagation,
    textEditingSession,
    textSelectionOverlay
  ]);

  const scopeEditBorder = useMemo<CanvasScopeEditBorder | null>(() => {
    if (!textEditingSession?.isScopeSession || !svgResult) {
      return null;
    }
    const anchorBox = textEditingSession.popupAnchorBox;
    if (!anchorBox) {
      return null;
    }
    return {
      left: canvasTransform.translateX + (anchorBox.minX - svgResult.viewBox.x) * canvasTransform.scale,
      top: canvasTransform.translateY + (anchorBox.minY - svgResult.viewBox.y) * canvasTransform.scale,
      width: (anchorBox.maxX - anchorBox.minX) * canvasTransform.scale,
      height: (anchorBox.maxY - anchorBox.minY) * canvasTransform.scale
    };
  }, [
    canvasTransform.scale,
    canvasTransform.translateX,
    canvasTransform.translateY,
    svgResult,
    textEditingSession
  ]);

  const view = useMemo<CanvasTextEditViewModel>(
    () => ({
      session: textEditingSession,
      popup,
      focusSurface: textEditFocusSurface,
      canvasFocusInput,
      scopeEditBorder
    }),
    [canvasFocusInput, popup, scopeEditBorder, textEditFocusSurface, textEditingSession]
  );

  return {
    textEditingSession,
    textSelectionOverlay,
    view,
    beginCanvasTextInteraction,
    closeTextEditingSession,
    requestAdornmentTextEdit,
    startTextEditingSession
  };
}
