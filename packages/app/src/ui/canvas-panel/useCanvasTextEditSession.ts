import { isRecord } from "../../validation";
import { requireArrayValue } from "@tikz-editor/core/utils/collections";
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
import { useStableCallback } from "../hooks/useStableCallback";
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
import type { BeamerCaretDomain } from "@tikz-editor/core/beamer/index";
import {
  CANVAS_CLIP_TYPE,
  constructMenu,
  editValues,
  fieldProblems,
  listItemOf,
  taggedValues,
  valueEditorFields,
  valueProblem,
  type CanvasClip,
  type ClipboardPayload,
  type ConstructMenuEntry
} from "@tikz-editor/core/editing/operations/index";
import type { CanvasValueEditorModel } from "./CanvasValueEditor";
import type { CanvasSourceLensModel } from "./CanvasSourceLens";
import { missingClosers, useCanvasRecoveryGhosts } from "./useCanvasRecoveryGhosts";
import { useCanvasPendingCloser } from "./useCanvasPendingCloser";
import { useCanvasSlotPlaceholders } from "./useCanvasSlotPlaceholders";
import { useCanvasGhostSlots } from "./useCanvasGhostSlots";
import { useCanvasHoverSource } from "./useCanvasHoverSource";
import { useCanvasRevealedCodes } from "./useCanvasRevealedCodes";

/** A slot's tag menu (V4): no variants of its own. */
const SLOT_MENU: readonly ConstructMenuEntry[] = [
  { id: "select", label: "Select", group: "action" },
  { id: "lens", label: "Edit source", group: "action" }
];
import {
  chipCandidates,
  copySelection,
  createIntentScheduler,
  editingHint,
  intentFromBeforeInput,
  interpretKeyDown,
  needsFreshLayout,
  NO_INTERACTION,
  pendingCloserSpan,
  resolveIntent,
  SUPPORTED_BEFORE_INPUT_TYPES,
  type ChipCandidate,
  type InputSurface,
  type Intent,
  type IntentContext,
  type InteractionState
} from "@tikz-editor/core/editing/input/index";

/** The lines the caret or selection is on, and where they start (viewport px). */
function selectionBand(overlay: TextSelectionOverlay | null): { left: number; top: number; bottom: number } | null {
  const boxes = overlay?.caret ? [overlay.caret] : overlay?.rects ?? [];
  if (boxes.length === 0) {
    return null;
  }
  return {
    left: requireArrayValue(boxes, 0).bounds.minX,
    top: Math.min(...boxes.map((box) => box.bounds.minY)),
    bottom: Math.max(...boxes.map((box) => box.bounds.maxY))
  };
}

/** Where a popup below the caret goes, or below a selection's start when there is no caret (viewport px). */
function belowSelection(overlay: TextSelectionOverlay | null): { left: number; top: number } | null {
  if (overlay?.caret) {
    return { left: overlay.caret.bounds.minX, top: overlay.caret.bounds.maxY + 4 };
  }
  const first = overlay?.rects[0];
  return first ? { left: first.bounds.minX, top: Math.max(...overlay.rects.map((rect) => rect.bounds.maxY)) + 4 } : null;
}

/**
 * A pointer selection as it is drawn and acted on: in a scope session its
 * promotion on the edit tree (N3, R9: a deletion never takes more than the
 * highlight shows), elsewhere widened to whole formulas.
 */
function promoteTextSelection(target: EditableTextTarget, range: TextSelectionRange, commands: CommandTable): TextSelectionRange {
  if (!target.scopeParagraphs || range.start === range.end) {
    return expandSelectionToMathDelimiters(target.text, range);
  }
  const promoted = promotedOffsets(canvasEditView(target.text, commands), range.start, range.end);
  return { start: promoted.anchor, end: promoted.focus };
}

/** What the chip's completion list says about each command. */
const CHIP_CATEGORY_LABELS: Record<ChipCandidate["category"], string> = {
  style: "style",
  construct: "structure",
  symbol: "symbol",
  operator: "operator",
  atom: "command",
  vertical: "spacing",
  spacing: "spacing",
  declaration: "switch",
  overlay: "overlay",
  link: "link",
  break: "break"
};
import { applyTransaction, type Transaction } from "@tikz-editor/core/editing/transaction/index";
import type { CommandTable } from "@tikz-editor/core/editing/commands/index";
import { completionPreview, useCompletionPreviewGeneration } from "./completion-previews";
import {
  caretContext,
  caretEdge,
  hoverSource,
  promotedOffsets,
  type CaretEdge,
  type ContextCrumb,
  type EditView,
  type GhostSlot,
  type HoverSource,
  type Position
} from "@tikz-editor/core/editing/position/index";
import {
  activeTextFormatWrapper,
  isTextFormatActive,
  toggleTextFormatCommand,
  type TextFormatCommandName
} from "@tikz-editor/core/text/format-commands";
import type { CanvasTextEditPlacement } from "../../settings/types";
import type { CanvasTransform, EditorAction, ToolMode } from "../../store/types";
import type { ClientPoint, SvgBounds, ViewportPoint } from "../coords/types";
import { resolveRectHitRegionContentBox } from "../coords/regions";
import {
  INITIAL_CANVAS_TEXT_EDIT_STATE,
  reduceCanvasTextEdit,
  interactionState,
  selectionPositions,
  type CanvasTextEditAction,
  type CanvasTextEditState
} from "./canvas-text-edit-machine";
import type {
  CanvasCommandChipModel,
  CanvasFocusInputModel,
  CanvasRecoveryFixModel,
  CanvasScopeEditBorder,
  CanvasTextEditPopupModel,
  CanvasTextEditViewModel,
  CanvasTextFormatCommandId,
  CanvasTextFormatColorSwatch,
  CanvasTextFormatToolbarItem,
  CanvasTextFormatToolbarModel
} from "./CanvasTextEditPopup";
import { clamp, clientToSvgPoint, viewportToSvgPoint } from "./geometry";
import { makeMergeKey, mapPointToRectRegionLocal } from "./panel-helpers";
import { expandSelectionToMathDelimiters, type TextSelectionRange } from "./text-selection-ranges";
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
import { canvasEditView, useEditCommands, useEditTree } from "./edit-tree-shadow";
import { setCanvasTextContext } from "./canvas-text-context";
import { hintAppears } from "./hint-memory";
import { useCanvasContextOutlines, type CanvasContextOutline, type CanvasContextOutlineRequest } from "./useCanvasContextOutlines";

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
  /** Changes identity exactly when the deck layout the caret domains come from changes. */
  deckCaretLayout: object;
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

/**
 * Toolbar color menu: xcolor names the engine resolves natively, with their
 * display values.
 */
const TEXT_FORMAT_COLOR_SWATCHES: readonly CanvasTextFormatColorSwatch[] = [
  { name: "red", css: "#ff0000" },
  { name: "orange", css: "#ff8000" },
  { name: "blue", css: "#0000ff" },
  { name: "teal", css: "#008080" },
  { name: "violet", css: "#800080" },
  { name: "gray", css: "#808080" }
];

/**
 * Format wraps must not swallow structure: a selection containing an
 * `\item` or environment boundary token would wrap it into the command
 * argument. Inline command syntax (an existing `\textbf{`, a color
 * argument) is fine — the wrap-safety scan in the toggle helpers already
 * guards brace balance, math parity, and paragraph breaks.
 */
function textFormatSelectionEditable(session: TextEditingSession): boolean {
  const from = Math.min(session.selectionStart, session.selectionEnd);
  const to = Math.max(session.selectionStart, session.selectionEnd);
  return !/\\(?:item|begin|end)(?![a-zA-Z])/u.test(session.text.slice(from, to));
}

/**
 * How long an intent that needs the rendered layout waits for it before
 * running against the layout as it is (a render failed or fell far behind).
 */
const LAYOUT_WAIT_TIMEOUT_MS = 200;

const IS_FAIL_FAST = import.meta.env.DEV || import.meta.env.MODE === "test";

/** The surface interpreting the keyboard: canvas only for canvas-focused scope sessions. */
/** The interaction state the next intent will see, whichever way the selection was made. */
function currentInteraction(state: CanvasTextEditState): InteractionState {
  const session = state.session;
  if (!session) {
    return NO_INTERACTION;
  }
  const forward = interactionState(state, session.selectionStart, session.selectionEnd);
  return forward !== NO_INTERACTION ? forward : interactionState(state, session.selectionEnd, session.selectionStart);
}

/** A canvas copy read back from the clipboard, if it is one (it may come from another window). */
function readCanvasClip(data: DataTransfer): CanvasClip | undefined {
  try {
    const clip: unknown = JSON.parse(data.getData(CANVAS_CLIP_TYPE));
    if (!isRecord(clip)) return undefined;
    return typeof clip.source === "string" && (clip.mode === "text" || clip.mode === "math") &&
      (clip.shape === "fragment" || clip.shape === "whole")
      ? { source: clip.source, mode: clip.mode, shape: clip.shape }
      : undefined;
  } catch {
    return undefined;
  }
}

function sessionSurface(state: CanvasTextEditState): InputSurface {
  return state.session?.isScopeSession && state.focusSurface === "canvas" ? "canvas" : "bar";
}

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
    target.renderSourceText,
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
    return requireArrayValue(ranges, 0);
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
  return ranges[index] ?? requireArrayValue(ranges, ranges.length - 1);
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
    deckCaretLayout,
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
  const editCommands = useEditCommands(snapshot.deck?.activeFrame?.editingEnvironment ?? null);
  /** Reveal codes (R14): the ¶ toggle in the format bar, kept while the panel is open. */
  const [revealCodes, setRevealCodes] = useState(false);
  const revealCodesRef = useRef(revealCodes);
  revealCodesRef.current = revealCodes;
  const editCommandsRef = useRef(editCommands);
  useLayoutEffect(() => {
    editCommandsRef.current = editCommands;
  }, [editCommands]);
  // Bound in the render path on every revision, so intents find it built.
  useEditTree(textEditingSession?.isScopeSession ? textEditingSession.text : null, editCommands);
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
  const pendingTextEditPasteRef = useRef<ClipboardPayload | null>(null);
  const pendingTextEditInsertTextRef = useRef<string | null>(null);
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
        ...(effect.maskSpan ? { canvasTextEditMask: {
              elementId: effect.sourceId,
              span: effect.maskSpan
            } } : {})
      });
      sourceRevisionRef.current += 1;
    }
  }, [dispatch]);

  /** Both DOM inputs set to a buffer state, value and selection. */
  const writeInputs = useCallback((state: { readonly text: string; readonly anchor: number; readonly focus: number }) => {
    const start = Math.min(state.anchor, state.focus);
    const end = Math.max(state.anchor, state.focus);
    const direction = state.focus < state.anchor ? "backward" : "forward";
    for (const input of [canvasFocusInputRef.current, textEditTextareaRef.current]) {
      if (input) {
        if (input.value !== state.text) {
          input.value = state.text;
        }
        input.setSelectionRange(start, end, direction);
      }
    }
  }, []);

  /**
   * Applies a transaction. Unless an IME composition owns the DOM inputs,
   * both inputs are written before dispatching so a queued selectionchange
   * cannot echo a stale offset back into the machine.
   */
  const commitTransaction = useCallback((transaction: Transaction, syncInputs: boolean) => {
    const session = stateRef.current.session;
    if (!session) {
      return;
    }
    if (syncInputs) {
      writeInputs(applyTransaction(session.text, transaction));
    }
    dispatchCanvasTextEditAction({ type: "apply_transaction", transaction, time: performance.now() });
  }, [dispatchCanvasTextEditAction, writeInputs]);

  /**
   * Undo and redo, inputs first as for a transaction: a value written
   * after the dispatch puts the inputs' caret at its end, which their
   * selection events would then report back over the restored one.
   */
  const stepHistory = useCallback((direction: "undo" | "redo") => {
    const { history } = stateRef.current;
    const steps = direction === "undo" ? history.undo : history.redo;
    const restore = steps[steps.length - 1];
    if (restore && stateRef.current.session) {
      writeInputs(restore);
    }
    dispatchCanvasTextEditAction({ type: "history", direction });
  }, [dispatchCanvasTextEditAction, writeInputs]);

  /**
   * Pointer-resolved selections arrive asynchronously (hit-testing awaits the
   * paragraph hit map). The inputs still hold the previous programmatic
   * selection, whose queued `select` event would otherwise fire before React
   * re-renders and echo the stale range back over the new one, dropping the
   * last drag step. Writing the resolved range into the inputs immediately
   * after the dispatch makes that queued event read the current value.
   */
  const syncInputSelectionFromSession = useCallback(() => {
    const session = stateRef.current.session;
    if (!session) {
      return;
    }
    const start = clamp(session.selectionStart, 0, session.text.length);
    const end = clamp(session.selectionEnd, 0, session.text.length);
    for (const input of [canvasFocusInputRef.current, textEditTextareaRef.current]) {
      if (input && (input.selectionStart !== start || input.selectionEnd !== end)) {
        input.setSelectionRange(start, end);
      }
    }
  }, []);

  const resolveDeckCaretDomainRef = useRef(resolveDeckCaretDomain);

  /** What the resolver sees of the current session state. */
  const currentIntentContext = useCallback((): IntentContext | null => {
    const state = stateRef.current;
    const session = state.session;
    if (!session) {
      return null;
    }
    const surface = sessionSurface(state);
    // The machine stores a normalized selection; its direction lives on the
    // focused DOM input.
    const input = surface === "canvas" ? canvasFocusInputRef.current : textEditTextareaRef.current;
    const backward = input?.selectionDirection === "backward";
    const anchor = backward ? session.selectionEnd : session.selectionStart;
    const focus = backward ? session.selectionStart : session.selectionEnd;
    return {
      surface,
      editMode: session.editMode,
      isScopeSession: session.isScopeSession,
      revision: state.inputRevision,
      text: session.text,
      bufferFrom: session.sourceSpan.from,
      anchor,
      focus,
      composition: state.compositionRange
        ? { from: state.compositionRange.start, to: state.compositionRange.end }
        : null,
      domain: session.isScopeSession ? resolveDeckCaretDomainRef.current(session.sourceId) : null,
      verticalGoal: state.verticalGoal,
      structure: session.isScopeSession
        ? (text, visibility) => canvasEditView(text, editCommandsRef.current, visibility)
        : null,
      positions: selectionPositions(state, anchor, focus),
      interaction: interactionState(state, anchor, focus),
      commands: session.isScopeSession ? editCommandsRef.current : null,
      title: session.sourceId.endsWith(":scope:title"),
      frameBody: session.sourceId.endsWith(":scope:body"),
      revealCodes: session.isScopeSession && revealCodesRef.current,
    };
  }, []);

  /** Resolves one intent against the current session state and applies it. */
  const runIntent = useCallback((intent: Intent) => {
    const context = currentIntentContext();
    if (!context) {
      return;
    }
    const resolution = resolveIntent(
      context,
      intent
    );
    switch (resolution.kind) {
      case "transaction":
        commitTransaction(resolution.transaction, intent.type !== "compose");
        return;
      case "history":
        stepHistory(resolution.direction);
        return;
      case "close":
        dispatchCanvasTextEditAction({ type: "session_close" });
        return;
      case "none":
        return;
    }
  }, [commitTransaction, currentIntentContext, dispatchCanvasTextEditAction, stepHistory]);

  const runIntentRef = useRef(runIntent);
  const layoutWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Revision protocol: intents that read the rendered layout wait until it
   * reflects the buffer, and later intents queue behind them, so a burst of
   * keys ahead of layout is neither dropped nor reordered.
   */
  const [intentScheduler] = useState(() => {
    const scheduler = createIntentScheduler({
      needsFreshLayout: (intent) => {
        const state = stateRef.current;
        return state.session != null &&
          needsFreshLayout(intent, sessionSurface(state), state.session.isScopeSession);
      },
      isLayoutFresh: () => {
        const session = stateRef.current.session;
        if (!session?.isScopeSession) {
          return true;
        }
        const domain = resolveDeckCaretDomainRef.current(session.sourceId);
        return domain == null || domain.source === session.workingSource;
      },
      run: (intent) => {
        runIntentRef.current(intent);
      },
      onWait: () => {
        if (layoutWaitTimerRef.current != null) {
          clearTimeout(layoutWaitTimerRef.current);
        }
        layoutWaitTimerRef.current = setTimeout(() => {
          layoutWaitTimerRef.current = null;
          scheduler.flush();
        }, LAYOUT_WAIT_TIMEOUT_MS);
      }
    });
    return scheduler;
  });

  useLayoutEffect(() => {
    runIntentRef.current = runIntent;
  }, [runIntent]);

  // A new caret domain means a new layout: run the intents waiting for it.
  useLayoutEffect(() => {
    resolveDeckCaretDomainRef.current = resolveDeckCaretDomain;
    intentScheduler.layoutChanged();
    if (intentScheduler.pending === 0 && layoutWaitTimerRef.current != null) {
      clearTimeout(layoutWaitTimerRef.current);
      layoutWaitTimerRef.current = null;
    }
  }, [deckCaretLayout, intentScheduler, resolveDeckCaretDomain]);

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
      intentScheduler.reset();
      if (layoutWaitTimerRef.current != null) {
        clearTimeout(layoutWaitTimerRef.current);
        layoutWaitTimerRef.current = null;
      }
    }
  }, [intentScheduler, textEditingSession]);

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

  const resolveScopeParagraphAtClient = useStableCallback(
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
    }
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

  const startTextEditingSession = useStableCallback(
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
    }
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
        const expandedSelection = promoteTextSelection(target, selection, editCommandsRef.current);
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
        syncInputSelectionFromSession();
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
      syncInputSelectionFromSession,
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

  /**
   * Text-carrying input from either surface (typing, IME, paste, drop,
   * modified deletes, undo from the Edit menu) enters as an intent.
   */
  const submitTextareaInput = useCallback((
    inputType: string,
    data: string | null,
    textarea: HTMLTextAreaElement,
    payload: ClipboardPayload | null = null
  ): boolean => {
    const native = intentFromBeforeInput(inputType, data);
    // A paste carries the clipboard's canvas copy, which the input event cannot.
    const intent = native?.type === "paste" && payload ? { ...native, payload } : native;
    if (!intent) {
      const message =
        `[canvas-text-edit] unsupported inputType "${inputType}". Supported: ${SUPPORTED_BEFORE_INPUT_TYPES.join(", ")}`;
      if (IS_FAIL_FAST) {
        throw new Error(message);
      }
      console.warn(message);
      return false;
    }
    // Native text input acts at the input's own selection, which a click
    // may have moved before its selectionchange arrived. With intents
    // queued, the DOM selection is the machine's (written on commit).
    if (
      !stateRef.current.compositionRange &&
      intentScheduler.pending === 0 &&
      document.activeElement === textarea
    ) {
      dispatchCanvasTextEditAction({
        type: "textarea_selection",
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd
      });
    }
    if (intent.type === "compose") {
      // The browser has already changed the input for a composition, so
      // it cannot wait behind queued intents.
      intentScheduler.flush();
    }
    intentScheduler.submit(intent);
    return true;
  }, [dispatchCanvasTextEditAction, intentScheduler]);

  const dispatchTextEditBeforeInputIntent = useCallback(
    (nativeEvent: InputEvent, textarea: HTMLTextAreaElement) => {
      if (typeof nativeEvent.inputType !== "string") {
        return;
      }
      const inputType = nativeEvent.inputType;
      nativeEvent.stopPropagation();
      let data = nativeEvent.data;
      if (inputType === "insertFromDrop" && data == null) {
        data = nativeEvent.dataTransfer?.getData("text/plain") ?? null;
      }
      if (inputType === "insertText" && data == null) {
        data = pendingTextEditInsertTextRef.current;
      }
      const pasted = inputType === "insertFromPaste" ? pendingTextEditPasteRef.current : null;
      if (inputType === "insertFromPaste" && data == null) {
        data = pasted?.plain ?? null;
      }
      if (inputType === "insertFromPaste") {
        pendingTextEditPasteRef.current = null;
      }
      pendingTextEditInsertTextRef.current = null;
      if (submitTextareaInput(inputType, data, textarea, pasted)) {
        nativeEvent.preventDefault();
      }
    },
    [submitTextareaInput]
  );

  const handleTextEditTextareaSelect = useCallback((event: ReactSyntheticEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    dispatchCanvasTextEditAction({
      type: "textarea_selection",
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd
    });
  }, [dispatchCanvasTextEditAction]);

  const handleTextEditTextareaPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    const plain = event.clipboardData.getData("text/plain");
    if (sessionSurface(stateRef.current) !== "canvas") {
      // The bar pastes source as text, through the input's own paste.
      pendingTextEditPasteRef.current = { plain };
      return;
    }
    // The canvas converts what it pastes (O6), a canvas copy first.
    const clip = readCanvasClip(event.clipboardData);
    if (submitTextareaInput("insertFromPaste", plain, event.currentTarget, { plain, ...(clip ? { clip } : {}) })) {
      event.preventDefault();
    }
  }, [submitTextareaInput]);

  /**
   * Copy and cut on the canvas (C3): `text/plain` gets the rendered text and
   * the canvas type the balanced source. The bar keeps the input's own copy.
   */
  const handleTextEditTextareaCopy = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    intentScheduler.flush();
    const context = currentIntentContext();
    const payload = context ? copySelection(context) : null;
    if (!payload) {
      return;
    }
    event.preventDefault();
    event.clipboardData.setData("text/plain", payload.plain);
    if (payload.clip) {
      event.clipboardData.setData(CANVAS_CLIP_TYPE, JSON.stringify(payload.clip));
    }
    if (event.type === "cut") {
      intentScheduler.submit({ type: "cut", origin: "menu", repeat: false });
    }
  }, [currentIntentContext, intentScheduler]);

  const handleTextEditTextareaDrop = useCallback((event: ReactDragEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    event.stopPropagation();
    submitTextareaInput("insertFromDrop", event.dataTransfer.getData("text/plain"), event.currentTarget);
  }, [submitTextareaInput]);

  const handleTextFormatCommand = useCallback((command: CanvasTextFormatCommandId) => {
    if (command === "revealCodes") {
      setRevealCodes((on) => !on);
      return;
    }
    intentScheduler.submit({ type: "format", command, origin: "menu", repeat: false });
  }, [intentScheduler]);

  const handleTextFormatColor = useCallback((color: string | null) => {
    intentScheduler.submit({ type: "color", color, origin: "menu", repeat: false });
  }, [intentScheduler]);

  /**
   * Keydown on either surface. The adapter decides what the key means;
   * keys it leaves native reach the browser (text then arrives through
   * `beforeinput`).
   */
  const handleSessionKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
    surface: InputSurface
  ) => {
    const decision = interpretKeyDown(
      {
        key: event.key,
        shift: event.shiftKey,
        primary: event.metaKey || event.ctrlKey,
        alt: event.altKey,
        repeat: event.repeat,
        composing: event.nativeEvent.isComposing
      },
      surface,
      // ⌥←/⌥→ take a pending `\right` along (M14).
      currentInteraction(stateRef.current).pendingCloser != null
    );
    if (decision.kind === "native") {
      const modified = event.ctrlKey || event.metaKey || event.altKey;
      if (intentScheduler.pending > 0 && (modified || event.key.length !== 1)) {
        // Native navigation and editing act on the DOM selection, so the
        // queued intents must land first.
        intentScheduler.flush();
      }
      if (modified) {
        // Keep app-level shortcuts from firing mid-session.
        pendingTextEditInsertTextRef.current = null;
        event.stopPropagation();
        return;
      }
      pendingTextEditInsertTextRef.current = event.key.length === 1 ? event.key : null;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    pendingTextEditInsertTextRef.current = null;
    switch (decision.kind) {
      case "block":
        return;
      case "intent":
        intentScheduler.submit(decision.intent);
        return;
      case "focusBar":
        // ⌘E: the source lens in a scope session (R13); the docked bar elsewhere.
        if (surface === "canvas" && stateRef.current.session?.isScopeSession) {
          intentScheduler.submit({ type: "openLens", origin: "keyboard", repeat: false });
          return;
        }
        intentScheduler.flush();
        dispatchCanvasTextEditAction({ type: "focus_surface", surface: "bar" });
        return;
      case "escape": {
        intentScheduler.flush();
        textSelectionDragRef.current = null;
        const session = stateRef.current.session;
        if (surface === "bar") {
          // Esc steps out one level: bar focus hands the keyboard back to
          // the canvas surface in scope sessions; node sessions close.
          dispatchCanvasTextEditAction(
            session?.isScopeSession
              ? { type: "focus_surface", surface: "canvas" }
              : { type: "session_close" }
          );
          return;
        }
        // An open command chip closes first, writing nothing (R4); a pending `\right` is accepted (M14).
        const interaction = currentInteraction(stateRef.current);
        if (interaction.chip || interaction.picker || interaction.lens || interaction.pendingCloser != null) {
          intentScheduler.submit({ type: "escape", origin: "keyboard", repeat: false });
          return;
        }
        // Esc ladder rung 1: hand the caret position to the object layer
        // before closing; the panel selects the innermost containing object.
        if (session?.isScopeSession && onCanvasSessionEscape) {
          onCanvasSessionEscape(
            session,
            session.sourceSpan.from + Math.min(session.selectionStart, session.selectionEnd)
          );
        }
        dispatchCanvasTextEditAction({ type: "session_close" });
        return;
      }
    }
  }, [dispatchCanvasTextEditAction, intentScheduler, onCanvasSessionEscape]);

  const handleTextEditTextareaKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    handleSessionKeyDown(event, "bar");
  }, [handleSessionKeyDown]);

  const handleCanvasFocusInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    handleSessionKeyDown(event, "canvas");
  }, [handleSessionKeyDown]);

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
        if (event instanceof InputEvent && typeof event.inputType === "string") {
          dispatchTextEditBeforeInputIntent(event, input);
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
    // (The value editor's fields and the source lens keep the keyboard while they are open.)
    const inOverlayInput = document.activeElement instanceof HTMLElement &&
      document.activeElement.closest("[data-canvas-value-editor], [data-canvas-source-lens]") != null;
    if (activeInput && document.activeElement !== activeInput && !inOverlayInput) {
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
        selectionStart: input.selectionStart,
        selectionEnd: input.selectionEnd
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
        const selection = promoteTextSelection(target, resolveTextSelectionRangeForDrag(
          target.text,
          drag.mode,
          drag.anchorOffset,
          resolvedOffset,
          drag.anchorLineRange,
          focusLineRange
        ), editCommandsRef.current);
        dispatchCanvasTextEditAction({
          type: "drag_resolved",
          requestRevision,
          baseInputRevision,
          sourceId: target.sourceId,
          sceneTextId: target.sceneTextId,
          selectionStart: selection.start,
          selectionEnd: selection.end
        });
        syncInputSelectionFromSession();
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
    syncInputSelectionFromSession,
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
      // Session chrome outside the canvas (the status bar breadcrumb).
      if (target instanceof Element && target.closest("[data-keeps-text-session]")) {
        return;
      }
      textSelectionDragRef.current = null;
      dispatchCanvasTextEditAction({ type: "session_close" });
    };
    window.addEventListener("pointerdown", handleGlobalPointerDown, true);
    return () => { window.removeEventListener("pointerdown", handleGlobalPointerDown, true); };
  }, [dispatchCanvasTextEditAction, textEditingSession, viewportRef]);

  /**
   * The caret's context (R8, V11): the constructs around the selection's
   * focus, from the edit tree. The raw focus position is used when the last
   * transaction recorded it (the inside and outside of `x^2‸` share an
   * offset).
   */
  const caretFocus = useMemo<{ view: EditView; position: Position } | null>(() => {
    if (!textEditingSession?.isScopeSession) {
      return null;
    }
    const view = canvasEditView(textEditingSession.text, editCommands);
    const { selectionStart: start, selectionEnd: end } = textEditingSession;
    const recorded = state.treeSelection;
    const matches = recorded?.text === textEditingSession.text && recorded.ends &&
      ((recorded.anchor === start && recorded.focus === end) || (recorded.anchor === end && recorded.focus === start));
    return { view, position: matches ? recorded.ends.focus : view.positionAt(end) };
  }, [editCommands, state.treeSelection, textEditingSession]);
  const caretCrumbs = useMemo<readonly ContextCrumb[] | null>(
    () => (caretFocus ? caretContext(caretFocus.view, caretFocus.position) : null),
    [caretFocus]
  );

  /** Which rendered item the caret hugs, in document offsets (math only; R8 caret size). */
  const caretEdgeInDocument = useMemo<CaretEdge | null>(() => {
    const edge = caretFocus && textEditingSession ? caretEdge(caretFocus.view, caretFocus.position) : null;
    if (!edge || !textEditingSession) {
      return null;
    }
    const from = textEditingSession.sourceSpan.from;
    return { ...edge, within: { from: from + edge.within.from, to: from + edge.within.to } };
  }, [caretFocus, textEditingSession]);

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
    textLayoutContext,
    caretEdge: caretEdgeInDocument
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

  const textEditToolbar = useMemo<CanvasTextFormatToolbarModel | null>(() => {
    if (!textEditingSession) {
      return null;
    }
    const session = textEditingSession;
    const editable = textFormatSelectionEditable(session);
    const wrapItem = (
      id: CanvasTextFormatCommandId,
      name: Exclude<TextFormatCommandName, "textcolor">,
      label: string,
      glyph: string,
      glyphClass?: CanvasTextFormatToolbarItem["glyphClass"]
    ): CanvasTextFormatToolbarItem => {
      const active =
        isTextFormatActive(
          session.text,
          session.selectionStart,
          session.selectionEnd,
          name
        );
      const disabled =
        (!active && !editable) ||
        toggleTextFormatCommand(
          session.text,
          session.selectionStart,
          session.selectionEnd,
          name
        ) === null;
      return { id, label, glyph, ...(glyphClass !== undefined ? { glyphClass: glyphClass } : {}), active, disabled };
    };
    const items: CanvasTextFormatToolbarItem[] = [
      wrapItem("bold", "textbf", "Bold", "B", "bold"),
      wrapItem("italic", "textit", "Italic", "I", "italic"),
      wrapItem("underline", "underline", "Underline", "U", "underline"),
      wrapItem("mono", "texttt", "Monospace", "tt", "mono"),
      wrapItem("alert", "alert", "Alert", "A!", "alert")
    ];
    if (session.isScopeSession) {
      const view = canvasEditView(session.text, editCommands);
      const caret = view.positionAt(Math.min(session.selectionStart, session.selectionEnd));
      const listContext = listItemOf(view.tree, requireArrayValue(view.tree.slots, caret.slot).node);
      items.push(
        {
          id: "bullets",
          label: "Bulleted list",
          glyph: "•—",
          active: listContext?.list.environment === "itemize",
          disabled: false
        },
        {
          id: "numbered",
          label: "Numbered list",
          glyph: "1—",
          active: listContext?.list.environment === "enumerate",
          disabled: false
        },
        {
          id: "outdent",
          label: "Decrease indent",
          glyph: "⇤",
          active: false,
          disabled: !listContext
        },
        {
          id: "indent",
          label: "Increase indent",
          glyph: "⇥",
          active: false,
          disabled: !listContext
        },
        {
          id: "revealCodes",
          label: "Reveal codes",
          glyph: "¶",
          active: revealCodes,
          disabled: false
        }
      );
    }
    const colorWrapper = activeTextFormatWrapper(
      session.text,
      session.selectionStart,
      session.selectionEnd,
      "textcolor"
    );
    return {
      items,
      colorSwatches: TEXT_FORMAT_COLOR_SWATCHES,
      activeColor: colorWrapper?.colorValue ?? null,
      colorDisabled: colorWrapper == null && !editable,
      onCommand: handleTextFormatCommand,
      onColor: handleTextFormatColor
    };
  }, [
    revealCodes,
    editCommands,
    handleTextFormatColor,
    handleTextFormatCommand,
    textEditingSession
  ]);

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
      toolbar: textEditToolbar,
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
      onTextareaCopy: handleTextEditTextareaCopy,
      onTextareaCut: handleTextEditTextareaCopy,
      onTextareaPaste: handleTextEditTextareaPaste,
      onTextareaDrop: handleTextEditTextareaDrop,
      onTextareaKeyDown: handleTextEditTextareaKeyDown
    };
  }, [
    canvasSurfaceFocused,
    handleTextEditPopupPointerDown,
    handleTextEditTextareaCopy,
    handleTextEditTextareaDrop,
    handleTextEditTextareaFocus,
    handleTextEditTextareaKeyDown,
    handleTextEditTextareaPaste,
    handleTextEditTextareaSelect,
    textEditingSession,
    textEditCaretOverlay,
    textEditFocusSurface,
    textEditInactiveSelectionRects,
    textEditPopupHeight,
    textEditPopupPlacement,
    textEditSurface,
    textEditTextareaSizing,
    textEditToolbar
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
      onCopy: handleTextEditTextareaCopy,
      onCut: handleTextEditTextareaCopy,
      onPaste: handleTextEditTextareaPaste,
      onDrop: handleTextEditTextareaDrop
    };
  }, [
    handleCanvasFocusInputKeyDown,
    handleTextEditTextareaCopy,
    handleTextEditTextareaDrop,
    handleTextEditTextareaPaste,
    handleTextEditTextareaSelect,
    textEditingSession,
    textSelectionOverlay
  ]);

  /** The hint line (V7) for the caret and what is open; a hint seen a few times stops showing. */
  const caretHint = useMemo(() => {
    if (!caretFocus || !textEditingSession) {
      return null;
    }
    const recorded = state.treeSelection?.text === textEditingSession.text ? state.treeSelection : null;
    const { view } = caretFocus;
    const from = Math.min(textEditingSession.selectionStart, textEditingSession.selectionEnd);
    const to = Math.max(textEditingSession.selectionStart, textEditingSession.selectionEnd);
    const raw = recorded?.ends ? [view.offset(recorded.ends.anchor), view.offset(recorded.ends.focus)] : null;
    const promoted = raw != null && from < to && (Math.min(...raw) !== from || Math.max(...raw) !== to);
    return editingHint(view, caretFocus.position, recorded?.interaction ?? NO_INTERACTION, promoted);
  }, [caretFocus, state.treeSelection, textEditingSession]);
  const shownHintRef = useRef<{ id: string; shows: boolean } | null>(null);
  if (caretHint?.id !== shownHintRef.current?.id) {
    shownHintRef.current = caretHint ? { id: caretHint.id, shows: hintAppears(caretHint) } : null;
  }
  const visibleHint = caretHint && shownHintRef.current?.shows ? caretHint.text : null;

  useEffect(() => {
    if (!caretCrumbs || textEditFocusSurface !== "canvas") {
      setCanvasTextContext(null);
      return;
    }
    // The path starts at the scope itself, which selects the whole buffer.
    const scopeId = textEditingSession?.sourceId ?? "";
    const root = scopeId.endsWith(":scope:title") ? "frametitle"
      : scopeId.includes(":scope:preamble:") ? scopeId.slice(scopeId.lastIndexOf(":") + 1)
        : scopeId.includes("column") ? "column" : "frame";
    setCanvasTextContext({
      crumbs: [root, ...caretCrumbs.map((crumb) => crumb.label)],
      hint: visibleHint,
      select: (index) => {
        const current = stateRef.current;
        const span = index === 0
          ? { from: 0, to: current.session?.text.length ?? 0 }
          : caretCrumbs[index - 1]?.span;
        if (!span || !current.session) {
          return;
        }
        commitTransaction({
          baseRevision: current.inputRevision,
          patches: [],
          selection: { kind: "absolute", anchor: span.from, focus: span.to },
          undo: { group: "own-step" }
        }, true);
      }
    });
    return () => { setCanvasTextContext(null); };
  }, [caretCrumbs, commitTransaction, textEditFocusSurface, textEditingSession?.sourceId, visibleHint]);

  const outlineRequests = useMemo<CanvasContextOutlineRequest[]>(() => {
    const view = caretFocus?.view;
    // A construct selected whole that has values (`\hspace{2em}`, `\url{…}`): its tag shows them.
    const selected = view && textEditingSession && textEditingSession.selectionStart !== textEditingSession.selectionEnd
      ? view.tree.nodes.find((node) => node.span.from === Math.min(textEditingSession.selectionStart, textEditingSession.selectionEnd) &&
        node.span.to === Math.max(textEditingSession.selectionStart, textEditingSession.selectionEnd) && node.values.length > 0 && node.command != null)
      : undefined;
    if (view && selected) {
      return [{ role: "focus", tag: selected.command ?? null, span: selected.span, values: taggedValues(view, selected), menu: constructMenu(view, selected.id, editCommands, textEditingSession?.sourceId.endsWith(":scope:title")) }];
    }
    const outlined = (caretCrumbs ?? []).filter((crumb) => crumb.outlined);
    const focus = outlined.at(-1);
    const parent = outlined.at(-2);
    const values = focus && view && focus.slot == null ? taggedValues(view, requireArrayValue(view.tree.nodes, focus.node)) : null;
    // A slot (`sub`) is selected or edited as source; a construct has its variants too (V4).
    const title = textEditingSession?.sourceId.endsWith(":scope:title") ?? false;
    const menu = !focus || !view ? [] : focus.slot == null ? constructMenu(view, focus.node, editCommands, title) : SLOT_MENU;
    return [
      ...(focus ? [{ role: "focus" as const, tag: focus.label, span: focus.span, values, menu }] : []),
      ...(parent ? [{ role: "parent" as const, tag: null, span: parent.span }] : [])
    ];
  }, [caretCrumbs, caretFocus, editCommands, textEditingSession]);

  const contextOutlines = useCanvasContextOutlines({
    session: textEditFocusSurface === "canvas" ? textEditingSession : null,
    requests: outlineRequests,
    renderedSource: snapshot.source,
    source,
    textLayoutContext,
    canvasTransform,
    viewportRef,
    resolveTarget: (session) => resolveEditableTextTargetById(session.sourceId, session.sceneTextId),
    resolveContainer: resolveRenderedMathTextElement
  });

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

  const previewGeneration = useCompletionPreviewGeneration();

  /** The command chip while one is open on the canvas, below the caret. */
  const commandChip = useMemo<CanvasCommandChipModel | null>(() => {
    const recorded = state.treeSelection;
    const chip = recorded?.interaction.chip;
    const caret = belowSelection(textSelectionOverlay);
    if (!chip || !caret || textEditFocusSurface !== "canvas" || !textEditingSession?.isScopeSession ||
      recorded.text !== textEditingSession.text) {
      return null;
    }
    const view = canvasEditView(textEditingSession.text, editCommands);
    const mode = requireArrayValue(view.tree.slots, view.positionAt(chip.at).slot).mode;
    // A pending `\right` (M14) is offered first.
    const pending = recorded.interaction.pendingCloser;
    const closerSpan = pending == null ? null : pendingCloserSpan(view, pending);
    const closer = closerSpan ? textEditingSession.text.slice(closerSpan.from, closerSpan.to) : null;
    const candidates = chipCandidates(editCommands, mode, chip.name, textEditingSession.text, closer);
    const selected = Math.min(chip.selected, candidates.length - 1);
    const highlighted = candidates[selected]?.name ?? "";
    return {
      name: chip.name,
      ghost: highlighted.startsWith(chip.name) ? highlighted.slice(chip.name.length) : "",
      candidates: candidates.map((candidate, index) => ({
        name: candidate.name,
        detail: candidate.user ? "document" : CHIP_CATEGORY_LABELS[candidate.category],
        selected: index === selected,
        preview: mode === "math" ? completionPreview(editCommands, candidate.name, previewGeneration) : null
      })),
      onPick: (index) => { intentScheduler.submit({ type: "pickCompletion", index, origin: "pointer", repeat: false }); },
      left: caret.left,
      top: caret.top
    };
  }, [editCommands, intentScheduler, previewGeneration, state.treeSelection, textEditFocusSurface, textEditingSession, textSelectionOverlay]);

  /** Values opened from a construct's tag, while the buffer is as it was then. */
  const [valueEditTarget, setValueEditTarget] = useState<{
    readonly text: string;
    readonly span: { readonly from: number; readonly to: number };
    readonly left: number;
    readonly top: number;
    readonly bottom: number;
  } | null>(null);

  const refocusCanvas = useCallback(() => {
    requestAnimationFrame(() => { canvasFocusInputRef.current?.focus({ preventScroll: true }); });
  }, []);

  const handleEditValues = useCallback((outline: CanvasContextOutline) => {
    const session = stateRef.current.session;
    if (!session || !outline.values) {
      return;
    }
    intentScheduler.flush();
    setValueEditTarget({ text: session.text, span: outline.span, left: outline.left, top: outline.top, bottom: outline.top + outline.height });
  }, [intentScheduler]);

  /** An entry of a focus tag's menu (V4), for the construct the outline is drawn around. */
  const handleConstructMenu = useCallback((outline: CanvasContextOutline, id: string) => {
    if (id === "values") {
      handleEditValues(outline);
      return;
    }
    intentScheduler.submit({ type: "constructMenu", span: outline.span, id, origin: "menu", repeat: false });
    if (id !== "lens") {
      refocusCanvas();
    }
  }, [handleEditValues, intentScheduler, refocusCanvas]);


  /** The value editor (O8): for the command the chip is writing, or for the values opened from a tag. */
  const valueEditor = useMemo<CanvasValueEditorModel | null>(() => {
    if (!textEditingSession?.isScopeSession || textEditFocusSurface !== "canvas") {
      return null;
    }
    const recorded = state.treeSelection;
    const picker = recorded?.text === textEditingSession.text ? recorded.interaction.picker : undefined;
    const caret = selectionBand(textSelectionOverlay);
    const view = canvasEditView(textEditingSession.text, editCommands);
    if (picker && caret) {
      const editor = valueEditorFields(editCommands, view, picker.at, picker.name, picker.key);
      if (!editor) {
        return null;
      }
      const parts: CanvasValueEditorModel["parts"][number][] = [];
      editor.schema.args.forEach((arg, argument) => {
        const field = editor.fields.findIndex((candidate) => candidate.argument === argument);
        if (field >= 0) {
          parts.push({ type: "field", field });
        } else if (arg.kind === "mandatory") {
          parts.push({ type: "text", text: "{…}" });
        }
      });
      return {
        key: `new:${picker.name}:${picker.at}:${picker.key}`,
        command: picker.name,
        parts,
        fields: editor.fields,
        initial: editor.fields.map((_, index) => (index === 0 ? picker.seed : "")),
        left: caret.left,
        band: { top: caret.top, bottom: caret.bottom },
        prefer: "below",
        problems: (values) => fieldProblems(editor.fields, values),
        onSubmit: (values, viaBrace) => {
          intentScheduler.submit({ type: "pickValues", values, viaBrace, origin: "keyboard", repeat: false });
          refocusCanvas();
        },
        onCancel: () => {
          intentScheduler.submit({ type: "escape", origin: "keyboard", repeat: false });
          refocusCanvas();
        }
      };
    }
    const target = valueEditTarget?.text === textEditingSession.text ? valueEditTarget : null;
    const node = target ? view.tree.nodes.find((each) => each.span.from === target.span.from && each.span.to === target.span.to) : undefined;
    const tagged = node ? taggedValues(view, node) : null;
    if (!target || !tagged) {
      return null;
    }
    const fields = tagged.values.map((value) => ({ kind: value.kind, open: value.open, close: value.close, optional: value.optional }));
    const edits = (values: readonly string[]) => tagged.values.map((value, index) => ({ span: value.span, text: requireArrayValue(values, index) }));
    return {
      key: `edit:${target.span.from}:${target.span.to}:${target.text.length}`,
      command: tagged.command,
      parts: fields.map((_, field) => ({ type: "field" as const, field })),
      fields,
      initial: tagged.values.map((value) => value.text),
      left: target.left,
      band: { top: target.top, bottom: target.bottom },
      prefer: "above",
      problems: (values) => {
        const each = tagged.values.map((value, index) => valueProblem(value.kind, requireArrayValue(values, index), value.optional, true));
        if (each.some((problem) => problem != null)) {
          return each;
        }
        // Each fits; together they must fit the command (a colour in its model, a table's columns).
        return editValues(view, edits(values)) ? null : each.map((_, index) => (index === 0 ? "These values do not fit the command" : null));
      },
      onSubmit: (values) => {
        const changed = edits(values).filter((edit, index) => edit.text !== requireArrayValue(tagged.values, index).text);
        if (changed.length > 0) {
          intentScheduler.submit({ type: "setValues", edits: changed, origin: "pointer", repeat: false });
        }
        setValueEditTarget(null);
        refocusCanvas();
      },
      onCancel: () => {
        setValueEditTarget(null);
        refocusCanvas();
      }
    };
  }, [editCommands, intentScheduler, refocusCanvas, state.treeSelection, textEditFocusSurface, textEditingSession, textSelectionOverlay, valueEditTarget]);

  /** Where the open lens sits: fixed when it opens, so it does not follow the caret it moves. */
  const lensPlacementRef = useRef<{ key: string; left: number; band: { top: number; bottom: number } } | null>(null);

  /** The source lens (R13), while one is open on the buffer as it now is. */
  const sourceLens = useMemo<CanvasSourceLensModel | null>(() => {
    const recorded = state.treeSelection;
    const lens = textEditingSession?.isScopeSession && recorded?.text === textEditingSession.text ? recorded.interaction.lens : undefined;
    if (!textEditingSession || !lens) {
      lensPlacementRef.current = null;
      return null;
    }
    const key = `lens:${lens.span.from}`;
    if (lensPlacementRef.current?.key !== key) {
      // Clear of the construct it opens on (its focus outline), else of the caret's lines.
      const outline = contextOutlines.find((each) => each.span.from === lens.span.from && each.span.to === lens.span.to);
      const caret = selectionBand(textSelectionOverlay);
      const place = outline
        ? { left: outline.left, band: { top: outline.top, bottom: outline.top + outline.height } }
        : caret ? { left: caret.left, band: { top: caret.top, bottom: caret.bottom } } : null;
      if (!place) {
        return null;
      }
      lensPlacementRef.current = { key, ...place };
    }
    const { left, band } = lensPlacementRef.current;
    const caret = Math.max(0, Math.min(textEditingSession.selectionEnd - lens.span.from, lens.span.to - lens.span.from));
    return {
      key,
      initial: textEditingSession.text.slice(lens.span.from, lens.span.to),
      caret,
      left,
      band,
      onChange: (text, at) => {
        intentScheduler.submit({ type: "setLensText", text, caret: at, origin: "keyboard", repeat: false });
      },
      onClose: () => {
        intentScheduler.submit({ type: "escape", origin: "keyboard", repeat: false });
        refocusCanvas();
      },
      onHistory: (direction) => {
        intentScheduler.submit({ type: direction, origin: "keyboard", repeat: false });
        refocusCanvas();
      }
    };
  }, [contextOutlines, intentScheduler, refocusCanvas, state.treeSelection, textEditingSession, textSelectionOverlay]);

  const recoveryGhosts = useCanvasRecoveryGhosts({
    session: textEditFocusSurface === "canvas" ? textEditingSession : null,
    renderedSource: snapshot.source,
    source,
    textLayoutContext,
    canvasTransform,
    viewportRef,
    resolveTarget: (session) => resolveEditableTextTargetById(session.sourceId, session.sceneTextId),
    resolveContainer: resolveRenderedMathTextElement
  });

  /** A `\right` written with its `\left` and not yet accepted (M14): its span in the buffer. */
  const pendingCloserToken = useMemo(() => {
    const recorded = state.treeSelection;
    const at = recorded?.interaction.pendingCloser;
    if (at == null || textEditFocusSurface !== "canvas" || !textEditingSession?.isScopeSession || recorded?.text !== textEditingSession.text) {
      return null;
    }
    return pendingCloserSpan(canvasEditView(textEditingSession.text, editCommands), at);
  }, [editCommands, state.treeSelection, textEditFocusSurface, textEditingSession]);

  const pendingCloser = useCanvasPendingCloser({
    session: textEditFocusSurface === "canvas" ? textEditingSession : null,
    closer: pendingCloserToken,
    renderedSource: snapshot.source,
    source,
    textLayoutContext,
    canvasTransform,
    viewportRef,
    resolveTarget: (session) => resolveEditableTextTargetById(session.sourceId, session.sceneTextId),
    resolveContainer: resolveRenderedMathTextElement
  });

  const slotPlaceholders = useCanvasSlotPlaceholders({
    session: textEditFocusSurface === "canvas" ? textEditingSession : null,
    commands: editCommands,
    renderedSource: snapshot.source,
    source,
    textLayoutContext,
    canvasTransform,
    viewportRef,
    resolveTarget: (session) => resolveEditableTextTargetById(session.sourceId, session.sceneTextId),
    resolveContainer: resolveRenderedMathTextElement
  });

  /** The source of the item under a client point (V5), or null off the session's text. */
  const hoverSourceAt = useCallback(async (point: { x: number; y: number }): Promise<HoverSource | null> => {
    const clientPoint = makeClientPoint(px(point.x), px(point.y));
    const session = stateRef.current.session;
    if (!session?.isScopeSession || !textLayoutContext) {
      return null;
    }
    const target = resolveEditableTextTargetById(session.sourceId, session.sceneTextId);
    const paragraph = target ? resolveScopeParagraphAtClient(target, clientPoint) : null;
    const container = target && paragraph ? resolveRenderedMathTextElement(target, paragraph.paragraphId) : null;
    if (!target || !paragraph || !container) {
      return null;
    }
    const result = await getKnuthPlassCaretFromPoint(textLayoutContext, {
      paragraphId: paragraph.paragraphId,
      sourceText: source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to),
      sourceTextStartOffset: documentSourceOffset(paragraph.sourceSpan.from),
      sourceCoordinateSpace: "document",
      containerElement: container,
      clientPoint
    });
    if (!result.ok || result.offset == null || stateRef.current.session?.text !== session.text) {
      return null;
    }
    return hoverSource(canvasEditView(session.text, editCommands), documentOffsetToTextarea(result.offset, target.sourceSpan));
  }, [editCommands, resolveEditableTextTargetById, resolveRenderedMathTextElement, resolveScopeParagraphAtClient, source, textLayoutContext]);

  const hoverSourceTooltip = useCanvasHoverSource({
    enabled: textEditFocusSurface === "canvas" && textEditingSession?.isScopeSession === true,
    viewportRef,
    lookup: hoverSourceAt
  });

  const handleCreateSlot = useCallback((ghost: GhostSlot) => {
    intentScheduler.submit({ type: "createSlot", kind: ghost.kind, at: ghost.at, origin: "pointer", repeat: false });
    refocusCanvas();
  }, [intentScheduler, refocusCanvas]);

  const ghostSlots = useCanvasGhostSlots({
    session: textEditFocusSurface === "canvas" && !state.treeSelection?.interaction.chip ? textEditingSession : null,
    caret: caretFocus,
    renderedSource: snapshot.source,
    source,
    textLayoutContext,
    canvasTransform,
    viewportRef,
    resolveTarget: (session) => resolveEditableTextTargetById(session.sourceId, session.sceneTextId),
    resolveContainer: resolveRenderedMathTextElement,
    onCreate: handleCreateSlot
  });

  const selectSpan = useCallback((span: { from: number; to: number }) => {
    const current = stateRef.current;
    if (!current.session) {
      return;
    }
    commitTransaction({
      baseRevision: current.inputRevision,
      patches: [],
      selection: { kind: "absolute", anchor: span.from, focus: span.to },
      undo: { group: "own-step" }
    }, true);
    refocusCanvas();
  }, [commitTransaction, refocusCanvas]);

  const revealedCodeChips = useCanvasRevealedCodes({
    session: textEditFocusSurface === "canvas" ? textEditingSession : null,
    enabled: revealCodes,
    commands: editCommands,
    renderedSource: snapshot.source,
    source,
    textLayoutContext,
    canvasTransform,
    viewportRef,
    resolveTarget: (session) => resolveEditableTextTargetById(session.sourceId, session.sceneTextId),
    resolveContainer: resolveRenderedMathTextElement,
    onSelect: selectSpan
  });

  /** The quick fix (T6): once the lens is closed, the missing closers written in with one click. */
  const recoveryFix = useMemo<CanvasRecoveryFixModel | null>(() => {
    const first = recoveryGhosts[0];
    if (!first || sourceLens || !textEditingSession) {
      return null;
    }
    const closers = missingClosers(textEditingSession);
    const label = [...new Set(closers.map((closer) => closer.text))].join(" ");
    return {
      label: `Insert missing ${label}`,
      left: first.left,
      top: first.top + first.height + 4,
      onApply: () => {
        intentScheduler.submit({ type: "insertClosers", closers, origin: "pointer", repeat: false });
        refocusCanvas();
      }
    };
  }, [intentScheduler, recoveryGhosts, refocusCanvas, sourceLens, textEditingSession]);

  const view = useMemo<CanvasTextEditViewModel>(
    () => ({
      session: textEditingSession,
      popup,
      focusSurface: textEditFocusSurface,
      canvasFocusInput,
      scopeEditBorder,
      contextOutlines,
      commandChip,
      valueEditor,
      onEditValues: handleEditValues,
      onConstructMenu: handleConstructMenu,
      sourceLens,
      recoveryGhosts,
      recoveryFix,
      pendingCloser,
      slotPlaceholders,
      ghostSlots,
      hoverSource: hoverSourceTooltip,
      revealedCodes: revealedCodeChips
    }),
    [canvasFocusInput, commandChip, contextOutlines, ghostSlots, handleConstructMenu, handleEditValues, hoverSourceTooltip, revealedCodeChips, pendingCloser, popup, recoveryFix, recoveryGhosts, scopeEditBorder, slotPlaceholders, sourceLens,
      textEditFocusSurface, textEditingSession, valueEditor]
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
