import { getKnuthPlassPointFromOffset, getKnuthPlassSelectionRects } from "@tikz-editor/core/text/knuth-plass";
import { documentSourceOffset } from "@tikz-editor/core/text/source-coordinates";
import { clientBoundsToViewport } from "../coords/text";
import type { EditableTextTarget, TextEditingSession } from "./types";

/** A caret's place on the canvas: its x and vertical extent, viewport px. */
export type ScopeCaretPoint = { readonly x: number; readonly top: number; readonly bottom: number };

/**
 * Where the caret at a buffer offset of a scope session is drawn, in
 * viewport px, or null off the rendered paragraphs. A math caret has its
 * own extent; a caret in text takes the line's, from the character beside it.
 */
export async function scopeCaretPoint(args: {
  session: TextEditingSession;
  target: EditableTextTarget;
  source: string;
  textLayoutContext: unknown;
  viewportRect: DOMRect;
  resolveContainer: (target: EditableTextTarget, paragraphId: string) => SVGGraphicsElement | null;
  local: number;
}): Promise<ScopeCaretPoint | null> {
  const { session, target, source, textLayoutContext, viewportRect, resolveContainer, local } = args;
  const offset = session.sourceSpan.from + local;
  const paragraph = target.scopeParagraphs?.find((candidate) => candidate.sourceSpan.from <= offset && offset <= candidate.sourceSpan.to);
  const container = paragraph ? resolveContainer(target, paragraph.paragraphId) : null;
  if (!paragraph || !container) {
    return null;
  }
  const layout = {
    paragraphId: paragraph.paragraphId,
    sourceText: source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to),
    sourceTextStartOffset: documentSourceOffset(paragraph.sourceSpan.from),
    sourceCoordinateSpace: "document" as const,
    containerElement: container
  };
  const point = await getKnuthPlassPointFromOffset(textLayoutContext, { ...layout, offset: documentSourceOffset(offset) });
  if (!point.ok || !point.clientPoint) {
    return null;
  }
  const x = point.clientPoint.x - viewportRect.left;
  if (point.caretTop && point.caretBottom) {
    return {
      x,
      top: Math.min(point.caretTop.y, point.caretBottom.y) - viewportRect.top,
      bottom: Math.max(point.caretTop.y, point.caretBottom.y) - viewportRect.top
    };
  }
  // (Or the character before it, before invisible source: `\pause`, a comment.)
  let rect;
  for (const [from, to] of [[offset, offset + 1], [offset - 1, offset]]) {
    const rects = await getKnuthPlassSelectionRects(textLayoutContext, {
      ...layout,
      startOffset: documentSourceOffset(from),
      endOffset: documentSourceOffset(to)
    });
    rect = rects.ok ? rects.rects[0] : undefined;
    if (rect) {
      break;
    }
  }
  if (!rect) {
    return null;
  }
  const bounds = clientBoundsToViewport(rect.bounds, viewportRect);
  return { x, top: bounds.minY, bottom: bounds.maxY };
}
