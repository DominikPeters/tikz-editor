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
import { getActiveMathJaxOutputJax } from "@tikz-editor/core/text/mathjax-engine";
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
};

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
    dispatch
  } = args;
  const [state, setState] = useState(INITIAL_CANVAS_TEXT_EDIT_STATE);
  const stateRef = useRef(INITIAL_CANVAS_TEXT_EDIT_STATE);
  const textEditingSession = state.session;
  const textSelectionOverlay = state.selectionOverlay;
  const [pendingAdornmentTextEditTargetId, setPendingAdornmentTextEditTargetId] = useState<string | null>(null);
  const textSelectionDragRef = useRef<TextSelectionDrag | null>(null);
  const textEditTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textEditPopupRef = useRef<HTMLDivElement | null>(null);
  const [textEditPopupHeight, setTextEditPopupHeight] = useState<number | null>(null);
  const [textEditCaretOverlay, setTextEditCaretOverlay] = useState<TextEditCaretOverlay | null>(null);
  const pendingTextEditPasteRef = useRef<string | null>(null);
  const pendingTextEditInsertTextRef = useRef<string | null>(null);
  const previousContextKeyRef = useRef(contextKey);

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatchCanvasTextEditAction = useCallback((action: CanvasTextEditAction) => {
    const reduced = reduceCanvasTextEdit(stateRef.current, action);
    stateRef.current = reduced.state;
    setState(reduced.state);
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
  }, [svgLayerHostRef]);

  const resolveTexVListSourceHitFromClient = useCallback(
    (
      target: EditableTextTarget,
      clientPoint: ClientPoint,
      outputJax: unknown,
      containerElement: SVGSVGElement
    ): VListSourceHit | null => {
      if (!target.paragraphId || !(target.usesMathJax && target.layoutKind !== "single-line")) {
        return null;
      }
      const snapshot = getKnuthPlassVListGeometrySnapshot({
        outputJax,
        paragraphId: target.paragraphId,
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
      const result = await getKnuthPlassCaretFromPoint(outputJax, {
        paragraphId: target.paragraphId,
        sourceText: target.text,
        sourceTextStartOffset: documentSourceOffset(target.sourceSpan.from),
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
      const vlistHit = resolveTexVListSourceHitFromClient(target, clientPoint, outputJax, containerElement);
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
    [canvasTransform, interactionSvgRef, resolveRenderedMathTextElement, resolveTexVListSourceHitFromClient, svgResult, viewportRef]
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
          sourceText: target.text,
          sourceTextStartOffset: documentSourceOffset(target.sourceSpan.from),
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
          resolveTexVListSourceHitFromClient(target, clientPoint, outputJax, containerElement),
          (offset) => documentOffsetToTextarea(documentSourceOffset(offset), target.sourceSpan),
          target.text.length
        );
        if (vlistLineRange) {
          return vlistLineRange;
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
        viewportRef.current,
        svgResult,
        canvasTransform
      );
    },
    [canvasTransform, interactionSvgRef, resolveRenderedMathTextElement, resolveTexVListSourceHitFromClient, svgResult, viewportRef]
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
      const requestRevision = state.asyncRequestRevision + 1;
      const baseInputRevision = state.inputRevision;
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
      if (typeof inputEvent.inputType === "string") {
        dispatchTextEditBeforeInputIntent(inputEvent, textarea);
      }
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
      const nextOverlay = {
        left: clamp(measuredRect.left - textareaRect.left, 0, textareaRect.width),
        top: clamp(measuredRect.top - textareaRect.top, 0, textareaRect.height - height),
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
    svgResult
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

  const popup = useMemo<CanvasTextEditPopupModel | null>(() => {
    if (!textEditingSession || !textEditPopupPlacement) {
      return null;
    }
    return {
      session: textEditingSession,
      placement: textEditPopupPlacement,
      measuredHeight: textEditPopupHeight,
      popupRef: textEditPopupRef,
      textareaRef: textEditTextareaRef,
      textareaSizing: textEditTextareaSizing,
      caretOverlay: textEditCaretOverlay,
      hideNativeCaret:
        textEditingSession.selectionStart === textEditingSession.selectionEnd &&
        textEditCaretOverlay != null,
      onPopupPointerDown: handleTextEditPopupPointerDown,
      onTextareaSelect: handleTextEditTextareaSelect,
      onTextareaCopy: stopTextEditTextareaClipboardPropagation,
      onTextareaCut: stopTextEditTextareaClipboardPropagation,
      onTextareaPaste: handleTextEditTextareaPaste,
      onTextareaDrop: handleTextEditTextareaDrop,
      onTextareaKeyDown: handleTextEditTextareaKeyDown
    };
  }, [
    handleTextEditPopupPointerDown,
    handleTextEditTextareaDrop,
    handleTextEditTextareaKeyDown,
    handleTextEditTextareaPaste,
    handleTextEditTextareaSelect,
    stopTextEditTextareaClipboardPropagation,
    textEditingSession,
    textEditCaretOverlay,
    textEditPopupHeight,
    textEditPopupPlacement,
    textEditTextareaSizing
  ]);

  const view = useMemo<CanvasTextEditViewModel>(
    () => ({ session: textEditingSession, popup }),
    [popup, textEditingSession]
  );

  return {
    textEditingSession,
    textSelectionOverlay,
    view,
    beginCanvasTextInteraction,
    closeTextEditingSession,
    requestAdornmentTextEdit
  };
}
