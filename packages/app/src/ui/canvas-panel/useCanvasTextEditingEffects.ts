import { useEffect, type RefObject } from "react";
import { svgPoint, svgBounds, viewportBounds, pt, px } from "@tikz-editor/core/coords/index";
import { getActiveMathJaxOutputJax } from "@tikz-editor/core/text/mathjax-engine";
import { getKnuthPlassPointFromOffset, getKnuthPlassSelectionRects } from "@tikz-editor/core/text/knuth-plass";
import type { SvgBounds, SvgPoint, ViewportPoint } from "../coords/types";
import type { CanvasTransform, ToolMode } from "../../store/types";
import { clientToViewport, svgToViewport } from "../coords/convert";
import { clientBoundsToViewport, svgBoundsToViewportBounds } from "../coords/text";
import { resolveRectHitRegionContentBox } from "../coords/regions";
import { clamp } from "./geometry";
import { createSourceRenderOffsetMap } from "./text-offset-map";
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
  resolveRenderedMathTextElement: (target: EditableTextTarget) => SVGSVGElement | null;
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
    { syntax: target.usesMathJax ? "mathjax" : "plain" }
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
  outputJax: unknown,
  paragraphId: string,
  sourceText: string,
  containerElement: SVGSVGElement,
  offset: number
): Promise<number | null> {
  const nextOffset = Math.min(sourceText.length, offset + 1);
  const prevOffset = Math.max(0, offset - 1);
  const probes: Array<[number, number]> = [];
  if (nextOffset > offset) {
    probes.push([offset, nextOffset]);
  }
  if (prevOffset < offset) {
    probes.push([prevOffset, offset]);
  }
  for (const [startOffset, endOffset] of probes) {
    const rects = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId,
      sourceText,
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
    svgResult
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
    if (selectedElementIds.size > 0 && !selectedElementIds.has(textEditingSession.sourceId)) {
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

    const boundedStart = clamp(textEditingSession.selectionStart, 0, textEditingSession.text.length);
    const boundedEnd = clamp(textEditingSession.selectionEnd, 0, textEditingSession.text.length);
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

    const outputJax = getActiveMathJaxOutputJax();
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
    const offsetMap = createSourceRenderOffsetMap(target.text, target.renderSourceText);
    const renderAnchor = clamp(offsetMap.sourceToRender(boundedStart), 0, target.renderSourceText.length);
    const renderFocus = clamp(offsetMap.sourceToRender(boundedEnd), 0, target.renderSourceText.length);
    const renderStart = Math.min(renderAnchor, renderFocus);
    const renderEnd = Math.max(renderAnchor, renderFocus);

    void (async () => {
      const requiresParagraphGeometry =
        target.usesMathJax && target.layoutKind !== "single-line";
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
          console.error("[canvas-text-edit] Missing paragraph geometry for multiline MathJax overlay.", {
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
        if (!target.paragraphId || !outputJax || !containerElement) {
          setRegionFallbackOverlay();
          return;
        }

        if (renderStart === renderEnd) {
          const point = await getKnuthPlassPointFromOffset(outputJax, {
            paragraphId: target.paragraphId,
            sourceText: target.renderSourceText,
            containerElement,
            offset: renderStart
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
              outputJax,
              target.paragraphId,
              target.renderSourceText,
              containerElement,
              point.offset ?? renderStart
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

        const rects = await getKnuthPlassSelectionRects(outputJax, {
          paragraphId: target.paragraphId,
          sourceText: target.renderSourceText,
          containerElement,
          startOffset: renderStart,
          endOffset: renderEnd
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
    svgResult
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
