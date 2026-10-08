import { useEffect, useState, type RefObject } from "react";
import type { Span } from "@tikz-editor/core/ast/types";
import { getKnuthPlassPointFromOffset, getKnuthPlassSelectionRects } from "@tikz-editor/core/text/knuth-plass";
import { documentSourceOffset } from "@tikz-editor/core/text/source-coordinates";
import type { CanvasTransform } from "../../store/types";
import { clientBoundsToViewport } from "../coords/text";
import type { EditableTextTarget, TextEditingSession } from "./types";

/** An outline the caret's context asks for (R8): the focus construct, or its parent. */
export type CanvasContextOutlineRequest = {
  readonly role: "focus" | "parent";
  /** The small tag on the focus outline (`textbf`, `sub`). */
  readonly tag: string | null;
  /** Buffer-local span of the construct. */
  readonly span: Span;
};

export type CanvasContextOutline = {
  readonly role: "focus" | "parent";
  readonly tag: string | null;
  /** Viewport px. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

const OUTLINE_PADDING_PX = 2;

/**
 * Viewport boxes for the context outlines: the union of the selection
 * rects the paragraph hit maps give for each construct's source span.
 * Inside math those rects cover whole rows, so a construct on one line is
 * narrowed to the carets at its two ends: horizontally to their positions
 * (hugging the construct's first and last items), and vertically to their
 * extent when both are math carets, which are sized to their level.
 * Recomputed when the outlined spans, the rendered source or the view
 * transform change.
 */
export function useCanvasContextOutlines(args: {
  session: TextEditingSession | null;
  requests: readonly CanvasContextOutlineRequest[];
  /** The rendered source; outlines wait until it matches the edited source. */
  renderedSource: string;
  source: string;
  textLayoutContext: unknown;
  canvasTransform: CanvasTransform;
  viewportRef: RefObject<HTMLDivElement | null>;
  resolveTarget: (session: TextEditingSession) => EditableTextTarget | null;
  resolveContainer: (target: EditableTextTarget, paragraphId: string) => SVGGraphicsElement | null;
}): readonly CanvasContextOutline[] {
  const { session, requests, renderedSource, source, textLayoutContext, canvasTransform, viewportRef, resolveTarget, resolveContainer } = args;
  const [outlines, setOutlines] = useState<readonly CanvasContextOutline[]>([]);
  const requestKey = requests.map((request) => `${request.role}:${request.tag}:${request.span.from}-${request.span.to}`).join("|");

  useEffect(() => {
    const target = session?.isScopeSession ? resolveTarget(session) : null;
    const paragraphs = target?.scopeParagraphs ?? [];
    const viewport = viewportRef.current;
    if (!session || !target || paragraphs.length === 0 || !viewport || requests.length === 0 || renderedSource !== source) {
      setOutlines([]);
      return;
    }
    const cancelled = { value: false };
    const viewportRect = viewport.getBoundingClientRect();
    void (async () => {
      const result: CanvasContextOutline[] = [];
      for (const request of requests) {
        const from = session.sourceSpan.from + request.span.from;
        const to = session.sourceSpan.from + request.span.to;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const paragraph of paragraphs) {
          const start = Math.max(from, paragraph.sourceSpan.from);
          const end = Math.min(to, paragraph.sourceSpan.to);
          const container = end > start ? resolveContainer(target, paragraph.paragraphId) : null;
          if (!container) {
            continue;
          }
          const rects = await getKnuthPlassSelectionRects(textLayoutContext, {
            paragraphId: paragraph.paragraphId,
            sourceText: source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to),
            sourceTextStartOffset: documentSourceOffset(paragraph.sourceSpan.from),
            sourceCoordinateSpace: "document",
            containerElement: container,
            startOffset: documentSourceOffset(start),
            endOffset: documentSourceOffset(end)
          });
          if (cancelled.value) {
            return;
          }
          for (const rect of rects.ok ? rects.rects : []) {
            const bounds = clientBoundsToViewport(rect.bounds, viewportRect);
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
          }
        }
        const ends = await caretEnds(textLayoutContext, target, paragraphs, source, from, to, resolveContainer);
        if (cancelled.value) {
          return;
        }
        if (ends && onOneLine(ends.start, ends.end) && Number.isFinite(minX)) {
          minX = Math.min(ends.start.x, ends.end.x) - viewportRect.left;
          maxX = Math.max(ends.start.x, ends.end.x) - viewportRect.left;
          if (ends.start.extent && ends.end.extent) {
            minY = Math.min(ends.start.extent.top, ends.end.extent.top) - viewportRect.top;
            maxY = Math.max(ends.start.extent.bottom, ends.end.extent.bottom) - viewportRect.top;
          }
        }
        if (Number.isFinite(minX) && maxX > minX) {
          result.push({
            role: request.role,
            tag: request.tag,
            left: minX - OUTLINE_PADDING_PX,
            top: minY - OUTLINE_PADDING_PX,
            width: maxX - minX + 2 * OUTLINE_PADDING_PX,
            height: maxY - minY + 2 * OUTLINE_PADDING_PX
          });
        }
      }
      if (!cancelled.value) {
        setOutlines(result);
      }
    })();
    return () => {
      cancelled.value = true;
    };
    // requestKey stands for requests; the resolvers are stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, session?.sourceId, session?.sourceSpan.from, renderedSource, source, textLayoutContext, canvasTransform]);

  return outlines;
}

type ClientXY = { readonly x: number; readonly y: number; readonly extent?: { top: number; bottom: number } };

/** Client points of the caret at a span's two ends, when one paragraph renders both. */
async function caretEnds(
  layoutContext: unknown,
  target: EditableTextTarget,
  paragraphs: NonNullable<EditableTextTarget["scopeParagraphs"]>,
  source: string,
  from: number,
  to: number,
  resolveContainer: (target: EditableTextTarget, paragraphId: string) => SVGGraphicsElement | null
): Promise<{ start: ClientXY; end: ClientXY } | null> {
  const paragraph = paragraphs.find((candidate) => candidate.sourceSpan.from <= from && to <= candidate.sourceSpan.to);
  const container = paragraph ? resolveContainer(target, paragraph.paragraphId) : null;
  if (!paragraph || !container) {
    return null;
  }
  const point = async (offset: number, side: "before" | "after"): Promise<ClientXY | null> => {
    const result = await getKnuthPlassPointFromOffset(layoutContext, {
      paragraphId: paragraph.paragraphId,
      sourceText: source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to),
      sourceTextStartOffset: documentSourceOffset(paragraph.sourceSpan.from),
      sourceCoordinateSpace: "document",
      containerElement: container,
      offset: documentSourceOffset(offset),
      edge: { side, within: { from, to } }
    });
    if (!result.ok || !result.clientPoint) {
      return null;
    }
    const extent = result.caretTop && result.caretBottom
      ? { top: Math.min(result.caretTop.y, result.caretBottom.y), bottom: Math.max(result.caretTop.y, result.caretBottom.y) }
      : undefined;
    return { x: result.clientPoint.x, y: result.clientPoint.y, extent };
  };
  const start = await point(from, "before");
  const end = await point(to, "after");
  return start && end ? { start, end } : null;
}

/** Whether two caret points are on one rendered line: their extents overlap (math), or their centres agree. */
function onOneLine(start: ClientXY, end: ClientXY): boolean {
  if (start.extent && end.extent) {
    return start.extent.top < end.extent.bottom && end.extent.top < start.extent.bottom;
  }
  return Math.abs(start.y - end.y) < 2;
}
