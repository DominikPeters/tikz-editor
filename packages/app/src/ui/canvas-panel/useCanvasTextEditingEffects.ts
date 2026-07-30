import { useEffect, type RefObject } from "react";
import { svgPoint, svgBounds, viewportBounds, pt, px } from "@tikz-editor/core/coords/index";
import { getKnuthPlassPointFromOffset, getKnuthPlassSelectionRects } from "@tikz-editor/core/text/knuth-plass";
import {
  documentSourceOffset,
  textareaOffset,
  textareaOffsetToDocument,
  type DocumentSourceOffset
} from "@tikz-editor/core/text/source-coordinates";
import type { SvgBounds, SvgPoint, ViewportPoint } from "../coords/types";
import type { CanvasTransform, ToolMode } from "../../store/types";
import { clientToViewport, svgToViewport } from "../coords/convert";
import { clientBoundsToViewport, svgBoundsToViewportBounds } from "../coords/text";
import { resolveRectHitRegionContentBox } from "../coords/regions";
import { clamp } from "./geometry";
import { applyTextMeasureFont, createVisualTextLayout, resolveVisualLineLeft } from "./text-visual-layout";
import type { CanvasSnapshot, EditableTextTarget, StateSetter, TextEditingSession, TextSelectionOverlay, TextSelectionOverlayBox } from "./types";
import type { CanvasTextEditAction } from "./canvas-text-edit-machine";

export type UseCanvasTextEditingEffectsArgs = {
  toolMode: ToolMode;
  textEditingSession: TextEditingSession | null;
  textEditAsyncRequestRevision: number;
  dispatchCanvasTextEditAction: (action: CanvasTextEditAction) => void;
  selectedElementIds: ReadonlySet<string>;
  resolveEditableTextTargetById: (sourceId: string, sceneTextId?: string) => EditableTextTarget | null;
  resolveRenderedMathTextElement: (
    target: EditableTextTarget,
    paragraphIdOverride?: string
  ) => SVGGraphicsElement | null;
  viewportRef: RefObject<HTMLDivElement | null>;
  pendingAdornmentTextEditTargetId: string | null;
  snapshot: CanvasSnapshot;
  source: string;
  sourceRevision: number;
  startTextEditingSession: (
    target: EditableTextTarget,
    selectionStart: number,
    selectionEnd: number,
    historyMergeKey?: string
  ) => void;
  setPendingAdornmentTextEditTargetId: StateSetter<string | null>;
  canvasTransform: CanvasTransform;
  svgResult: CanvasSnapshot["svg"];
  textLayoutContext: unknown;
};

type RegionSelectionOverlayBox = {
  bounds: SvgBounds;
  center?: SvgPoint;
  rotationDeg?: number;
};

type RegionSelectionOverlay = {
  caret: RegionSelectionOverlayBox | null;
  rects: RegionSelectionOverlayBox[];
};

type PlainFallbackLineBox = {
  top: number;
  height: number;
};

let fallbackOverlayMeasureContext: CanvasRenderingContext2D | null | undefined;

function getFallbackOverlayMeasureContext(): CanvasRenderingContext2D | null {
  if (fallbackOverlayMeasureContext !== undefined) {
    return fallbackOverlayMeasureContext;
  }
  if (typeof document === "undefined") {
    fallbackOverlayMeasureContext = null;
    return fallbackOverlayMeasureContext;
  }
  const canvas = document.createElement("canvas");
  fallbackOverlayMeasureContext = canvas.getContext("2d");
  return fallbackOverlayMeasureContext;
}

function applyFallbackOverlayFont(ctx: CanvasRenderingContext2D | null, target: EditableTextTarget): void {
  applyTextMeasureFont(ctx, target?.style);
}

function resolvePlainFallbackLineBoxes(
  target: EditableTextTarget,
  lineCount: number,
  ctx: CanvasRenderingContext2D | null
): PlainFallbackLineBox[] {
  const fontSize = Math.max(1, Number(target.style.fontSize) || 12);
  let ascent = fontSize * 0.8;
  let descent = fontSize * 0.2;
  if (ctx) {
    const metrics = ctx.measureText("Mg");
    const measuredAscent = resolveTextMetric(metrics, "fontBoundingBoxAscent", "actualBoundingBoxAscent");
    const measuredDescent = resolveTextMetric(metrics, "fontBoundingBoxDescent", "actualBoundingBoxDescent");
    if (measuredAscent != null) {
      ascent = measuredAscent;
    }
    if (measuredDescent != null) {
      descent = measuredDescent;
    }
  }
  const lineGap = fontSize * 1.15;
  const firstBaselineOffset = lineCount <= 1 ? 0 : -((lineCount - 1) * lineGap) / 2;
  const height = Math.max(1, ascent + descent);
  return Array.from({ length: Math.max(1, lineCount) }, (_, index) => {
    const baseline = target.region.cy + firstBaselineOffset + index * lineGap;
    return {
      top: baseline - ascent,
      height
    };
  });
}

function resolveTextMetric(
  metrics: TextMetrics,
  preferredKey: "fontBoundingBoxAscent" | "fontBoundingBoxDescent",
  fallbackKey: "actualBoundingBoxAscent" | "actualBoundingBoxDescent"
): number | null {
  const preferred = metrics[preferredKey];
  if (Number.isFinite(preferred) && preferred > 0) {
    return preferred;
  }
  const fallback = metrics[fallbackKey];
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

function resolveRegionSelectionOverlay(
  target: EditableTextTarget,
  selectionStart: number,
  selectionEnd: number
): {
  caret: RegionSelectionOverlayBox | null;
  rects: RegionSelectionOverlayBox[];
} {
  const ctx = getFallbackOverlayMeasureContext();
  applyFallbackOverlayFont(ctx, target);
  const layout = createVisualTextLayout(
    target.text,
    target.renderSourceText ?? target.text,
    (text) => {
      if (!ctx) {
        return Number.NaN;
      }
      return ctx.measureText(text).width;
    },
    { syntax: target.usesTex ? "tex" : "plain" }
  );
  const ranges = layout.sourceLineRanges;
  const contentBox = resolveRectHitRegionContentBox(target.region);
  const fallbackLineBoxes = resolvePlainFallbackLineBoxes(target, ranges.length, ctx);
  if (selectionStart === selectionEnd) {
    const { lineIndex, x, lineWidth } = layout.getCaretPosition(selectionStart);
    const lineLeft = resolveVisualLineLeft(contentBox.width, lineWidth, target.style.textAlign);
    const left = contentBox.x + lineLeft + clamp(x, 0, Math.max(lineWidth, contentBox.width));
    const lineBox = fallbackLineBoxes[lineIndex] ?? fallbackLineBoxes[0] ?? { top: contentBox.y, height: contentBox.height };
    return {
      caret: {
        bounds: svgBounds(pt(left), pt(lineBox.top), pt(left), pt(lineBox.top + lineBox.height))
      },
      rects: []
    };
  }

  const rects: RegionSelectionOverlayBox[] = [];
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    const localStart = Math.max(start, range.start);
    const localEnd = Math.min(end, range.end);
    if (localEnd <= localStart) {
      continue;
    }
    const { leftX, rightX, lineWidth } = layout.getLineSelectionRatios(localStart, localEnd, index);
    const lineLeft = resolveVisualLineLeft(contentBox.width, lineWidth, target.style.textAlign);
    const left = contentBox.x + lineLeft + clamp(leftX, 0, Math.max(lineWidth, contentBox.width));
    const right = contentBox.x + lineLeft + clamp(rightX, 0, Math.max(lineWidth, contentBox.width));
    const lineBox = fallbackLineBoxes[index] ?? fallbackLineBoxes[0] ?? { top: contentBox.y, height: contentBox.height };
    const width = Math.max(1, right - left);
    rects.push({
      bounds: svgBounds(pt(left), pt(lineBox.top), pt(left + width), pt(lineBox.top + lineBox.height)),
      center: svgPoint(pt(left + width / 2), pt(lineBox.top + lineBox.height / 2)),
      rotationDeg: Number.isFinite(target.region.rotation) ? Number(target.region.rotation) : undefined
    });
  }
  return { caret: null, rects };
}

function projectRegionSelectionOverlayToViewport(
  overlay: RegionSelectionOverlay,
  canvasTransform: { translateX: number; translateY: number; scale: number },
  viewBox: { x: number; y: number; width: number; height: number }
): Pick<TextSelectionOverlay, "caret" | "rects"> {
  const projectPoint = (point: SvgPoint): ViewportPoint => svgToViewport(point, canvasTransform, viewBox);
  const projectBox = (box: RegionSelectionOverlayBox): TextSelectionOverlayBox => ({
    bounds: svgBoundsToViewportBounds(box.bounds, projectPoint),
    center: box.center ? projectPoint(box.center) : undefined,
    rotationDeg: box.rotationDeg
  });
  return {
    caret: overlay.caret ? projectBox(overlay.caret) : null,
    rects: overlay.rects.map(projectBox)
  };
}

async function estimateCaretHeight(
  layoutContext: unknown,
  paragraphId: string,
  sourceText: string,
  sourceTextStartOffset: DocumentSourceOffset,
  containerElement: SVGGraphicsElement,
  offset: number
): Promise<number | null> {
  const sourceEndOffset = sourceTextStartOffset + sourceText.length;
  const nextOffset = Math.min(sourceEndOffset, offset + 1);
  const prevOffset = Math.max(sourceTextStartOffset, offset - 1);
  const probes: Array<[number, number]> = [];
  if (nextOffset > offset) {
    probes.push([offset, nextOffset]);
  }
  if (prevOffset < offset) {
    probes.push([prevOffset, offset]);
  }
  for (const [startOffset, endOffset] of probes) {
    const rects = await getKnuthPlassSelectionRects(layoutContext, {
      paragraphId,
      sourceText,
      sourceTextStartOffset,
      sourceCoordinateSpace: "document",
      containerElement,
      startOffset,
      endOffset
    });
    if (rects.ok && rects.rects.length > 0) {
      const rect = rects.rects[0];
      return Math.max(1, rect.bounds.maxY - rect.bounds.minY);
    }
  }
  return null;
}

export function useCanvasTextEditingEffects(args: UseCanvasTextEditingEffectsArgs) {
  const {
    toolMode,
    textEditingSession,
    textEditAsyncRequestRevision,
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
  } = args;

  useEffect(() => {
    if (toolMode === "select" || !textEditingSession) {
      return;
    }
    dispatchCanvasTextEditAction({ type: "session_close" });
  }, [dispatchCanvasTextEditAction, textEditingSession, toolMode]);

  useEffect(() => {
    if (!textEditingSession) {
      return;
    }
    if (
      textEditingSession.editMode !== "inline-typo" &&
      selectedElementIds.size > 0 &&
      !selectedElementIds.has(textEditingSession.sourceId)
    ) {
      dispatchCanvasTextEditAction({ type: "session_close" });
    }
  }, [dispatchCanvasTextEditAction, selectedElementIds, textEditingSession]);

  useEffect(() => {
    dispatchCanvasTextEditAction({
      type: "source_reconciled",
      source,
      sourceRevision,
      target: textEditingSession
        ? resolveEditableTextTargetById(textEditingSession.sourceId, textEditingSession.sceneTextId)
        : null
    });
  }, [dispatchCanvasTextEditAction, resolveEditableTextTargetById, source, sourceRevision, textEditingSession]);

  useEffect(() => {
    if (!textEditingSession) {
      dispatchCanvasTextEditAction({
        type: "overlay_resolved",
        requestRevision: textEditAsyncRequestRevision,
        sourceId: "",
        selectionStart: 0,
        selectionEnd: 0,
        overlay: null
      });
      return;
    }

    const target = resolveEditableTextTargetById(textEditingSession.sourceId, textEditingSession.sceneTextId);
    if (!target) {
      dispatchCanvasTextEditAction({
        type: "overlay_resolved",
        requestRevision: textEditAsyncRequestRevision,
        sourceId: textEditingSession.sourceId,
        selectionStart: textEditingSession.selectionStart,
        selectionEnd: textEditingSession.selectionEnd,
        overlay: null
      });
      return;
    }
    if (snapshot.source !== source) {
      return;
    }

    // While a trailing-backslash write is deferred, the session text is
    // longer than the document span the overlay is measured against, so the
    // caret must be bounded by both lengths.
    const overlayTextLength = Math.min(
      textEditingSession.text.length,
      Math.max(0, target.sourceSpan.to - target.sourceSpan.from)
    );
    const boundedStart = clamp(textEditingSession.selectionStart, 0, overlayTextLength);
    const boundedEnd = clamp(textEditingSession.selectionEnd, 0, overlayTextLength);
    if (textEditingSession.isForeachTemplateEdit || target.isForeachTemplateEdit) {
      dispatchCanvasTextEditAction({
        type: "overlay_resolved",
        requestRevision: textEditAsyncRequestRevision,
        sourceId: target.sourceId,
        selectionStart: boundedStart,
        selectionEnd: boundedEnd,
        overlay: null
      });
      return;
    }

    const layoutContext = textLayoutContext;
    const containerElement = resolveRenderedMathTextElement(target);
    const viewport = viewportRef.current;
    if (!viewport) {
      dispatchCanvasTextEditAction({
        type: "overlay_resolved",
        requestRevision: textEditAsyncRequestRevision,
        sourceId: target.sourceId,
        selectionStart: boundedStart,
        selectionEnd: boundedEnd,
        overlay: null
      });
      return;
    }

    const requestRef = { cancelled: false };
    const viewportRect = viewport.getBoundingClientRect();
    const documentAnchor = textareaOffsetToDocument(textareaOffset(boundedStart), target.sourceSpan);
    const documentFocus = textareaOffsetToDocument(textareaOffset(boundedEnd), target.sourceSpan);
    const documentStart = documentSourceOffset(Math.min(documentAnchor, documentFocus));
    const documentEnd = documentSourceOffset(Math.max(documentAnchor, documentFocus));

    void (async () => {
      const requiresParagraphGeometry =
        target.usesTex && target.layoutKind !== "single-line";
      const pushOverlay = (overlay: TextSelectionOverlay | null) => {
        dispatchCanvasTextEditAction({
          type: "overlay_resolved",
          requestRevision: textEditAsyncRequestRevision,
          sourceId: target.sourceId,
          selectionStart: boundedStart,
          selectionEnd: boundedEnd,
          overlay
        });
      };
      const setRegionFallbackOverlay = () => {
        if (requiresParagraphGeometry) {
          console.error("[canvas-text-edit] Missing paragraph geometry for multiline TeX overlay.", {
            sourceId: target.sourceId,
            paragraphId: target.paragraphId,
            layoutKind: target.layoutKind
          });
          pushOverlay(null);
          return;
        }
        if (!svgResult) {
          pushOverlay(null);
          return;
        }
        const overlay = projectRegionSelectionOverlayToViewport(
          resolveRegionSelectionOverlay(target, boundedStart, boundedEnd),
          canvasTransform,
          svgResult.viewBox
        );
        pushOverlay({
          sourceId: target.sourceId,
          selectionStart: boundedStart,
          selectionEnd: boundedEnd,
          caret: overlay.caret,
          rects: overlay.rects
        });
      };

      try {
        // Scope sessions span many rendered paragraphs: the caret resolves
        // against the paragraph containing the offset, and a range
        // selection renders one rect set per intersected paragraph.
        const scopeParagraphs = target.scopeParagraphs;
        if (scopeParagraphs && scopeParagraphs.length > 0) {
          if (!layoutContext) {
            pushOverlay(null);
            return;
          }
          if (documentStart === documentEnd) {
            const paragraph = scopeParagraphs.find(
              (candidate) =>
                documentStart >= candidate.sourceSpan.from &&
                documentStart <= candidate.sourceSpan.to
            );
            const paragraphContainer = paragraph
              ? resolveRenderedMathTextElement(target, paragraph.paragraphId)
              : null;
            if (!paragraph || !paragraphContainer) {
              pushOverlay(null);
              return;
            }
            const sourceText = source.slice(
              paragraph.sourceSpan.from,
              paragraph.sourceSpan.to
            );
            const point = await getKnuthPlassPointFromOffset(layoutContext, {
              paragraphId: paragraph.paragraphId,
              sourceText,
              sourceTextStartOffset: documentSourceOffset(paragraph.sourceSpan.from),
              sourceCoordinateSpace: "document",
              containerElement: paragraphContainer,
              offset: documentStart
            });
            if (requestRef.cancelled) {
              return;
            }
            if (!point.ok || point.clientPoint == null) {
              pushOverlay(null);
              return;
            }
            const height =
              (await estimateCaretHeight(
                layoutContext,
                paragraph.paragraphId,
                sourceText,
                documentSourceOffset(paragraph.sourceSpan.from),
                paragraphContainer,
                point.offset ?? documentStart
              )) ?? Math.max(1, target.region.height);
            if (requestRef.cancelled) {
              return;
            }
            pushOverlay({
              sourceId: target.sourceId,
              selectionStart: boundedStart,
              selectionEnd: boundedEnd,
              caret: {
                bounds: viewportBounds(
                  px(point.clientPoint.x - viewportRect.left),
                  px(point.clientPoint.y - viewportRect.top - height / 2),
                  px(point.clientPoint.x - viewportRect.left),
                  px(point.clientPoint.y - viewportRect.top + height / 2)
                ),
                center: clientToViewport(point.clientPoint, viewportRect),
                rotationDeg:
                  typeof point.rotationDeg === "number" && Number.isFinite(point.rotationDeg)
                    ? point.rotationDeg
                    : undefined
              },
              rects: []
            });
            return;
          }

          const rects: TextSelectionOverlayBox[] = [];
          for (const paragraph of scopeParagraphs) {
            const startOffset = Math.max(documentStart, paragraph.sourceSpan.from);
            const endOffset = Math.min(documentEnd, paragraph.sourceSpan.to);
            if (endOffset <= startOffset) {
              continue;
            }
            const paragraphContainer = resolveRenderedMathTextElement(
              target,
              paragraph.paragraphId
            );
            if (!paragraphContainer) {
              continue;
            }
            const paragraphRects = await getKnuthPlassSelectionRects(layoutContext, {
              paragraphId: paragraph.paragraphId,
              sourceText: source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to),
              sourceTextStartOffset: documentSourceOffset(paragraph.sourceSpan.from),
              sourceCoordinateSpace: "document",
              containerElement: paragraphContainer,
              startOffset: documentSourceOffset(startOffset),
              endOffset: documentSourceOffset(endOffset)
            });
            if (requestRef.cancelled) {
              return;
            }
            if (paragraphRects.ok) {
              rects.push(...paragraphRects.rects.map((rect) => ({
                bounds: clientBoundsToViewport(rect.bounds, viewportRect),
                center: clientToViewport(rect.center, viewportRect),
                rotationDeg: rect.rotationDeg
              })));
            }
          }
          pushOverlay(
            rects.length > 0
              ? {
                  sourceId: target.sourceId,
                  selectionStart: boundedStart,
                  selectionEnd: boundedEnd,
                  caret: null,
                  rects
                }
              : null
          );
          return;
        }

        if (!target.paragraphId || !layoutContext || !containerElement) {
          setRegionFallbackOverlay();
          return;
        }

        if (documentStart === documentEnd) {
          const point = await getKnuthPlassPointFromOffset(layoutContext, {
            paragraphId: target.paragraphId,
            sourceText: target.layoutSourceText ?? target.text,
            sourceTextStartOffset: documentSourceOffset(
              target.layoutSourceSpan?.from ?? target.sourceSpan.from
            ),
            sourceCoordinateSpace: "document",
            containerElement,
            offset: documentStart
          });
          if (requestRef.cancelled) {
            return;
          }
          if (!point.ok || point.clientPoint == null) {
            setRegionFallbackOverlay();
            return;
          }
          const height =
            (await estimateCaretHeight(
              layoutContext,
              target.paragraphId,
              target.layoutSourceText ?? target.text,
              documentSourceOffset(
                target.layoutSourceSpan?.from ?? target.sourceSpan.from
              ),
              containerElement,
              point.offset ?? documentStart
            )) ?? Math.max(1, target.region.height);
          if (requestRef.cancelled) {
            return;
          }
          pushOverlay({
            sourceId: target.sourceId,
            selectionStart: boundedStart,
            selectionEnd: boundedEnd,
            caret: {
              bounds: viewportBounds(
                px(point.clientPoint.x - viewportRect.left),
                px(point.clientPoint.y - viewportRect.top - height / 2),
                px(point.clientPoint.x - viewportRect.left),
                px(point.clientPoint.y - viewportRect.top + height / 2)
              ),
              center: clientToViewport(point.clientPoint, viewportRect),
              rotationDeg:
                typeof point.rotationDeg === "number" && Number.isFinite(point.rotationDeg)
                  ? point.rotationDeg
                  : undefined
            },
            rects: []
          });
          return;
        }

        const rects = await getKnuthPlassSelectionRects(layoutContext, {
          paragraphId: target.paragraphId,
          sourceText: target.layoutSourceText ?? target.text,
          sourceTextStartOffset: documentSourceOffset(
            target.layoutSourceSpan?.from ?? target.sourceSpan.from
          ),
          sourceCoordinateSpace: "document",
          containerElement,
          startOffset: documentStart,
          endOffset: documentEnd
        });
        if (requestRef.cancelled) {
          return;
        }
        if (!rects.ok || rects.rects.length === 0) {
          setRegionFallbackOverlay();
          return;
        }
        pushOverlay({
          sourceId: target.sourceId,
          selectionStart: boundedStart,
          selectionEnd: boundedEnd,
          caret: null,
          rects: rects.rects.map((rect) => ({
            bounds: clientBoundsToViewport(rect.bounds, viewportRect),
            center: clientToViewport(rect.center, viewportRect),
            rotationDeg: rect.rotationDeg
          }))
        });
      } catch {
        if (requestRef.cancelled) {
          return;
        }
        setRegionFallbackOverlay();
      }
    })();

    return () => {
      requestRef.cancelled = true;
    };
  }, [
    resolveEditableTextTargetById,
    resolveRenderedMathTextElement,
    dispatchCanvasTextEditAction,
    snapshot.source,
    source,
    textEditingSession,
    textEditAsyncRequestRevision,
    viewportRef,
    canvasTransform,
    svgResult,
    textLayoutContext
  ]);

  useEffect(() => {
    if (!pendingAdornmentTextEditTargetId) {
      return;
    }
    if (snapshot.source !== source || !selectedElementIds.has(pendingAdornmentTextEditTargetId)) {
      return;
    }
    const target = resolveEditableTextTargetById(pendingAdornmentTextEditTargetId);
    if (!target) {
      return;
    }
    startTextEditingSession(target, 0, target.text.length);
    setPendingAdornmentTextEditTargetId(null);
  }, [
    pendingAdornmentTextEditTargetId,
    resolveEditableTextTargetById,
    selectedElementIds,
    setPendingAdornmentTextEditTargetId,
    snapshot.source,
    source,
    startTextEditingSession
  ]);
}
