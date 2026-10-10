import { useEffect, useState, type RefObject } from "react";
import { getKnuthPlassPointFromOffset } from "@tikz-editor/core/text/knuth-plass";
import { documentSourceOffset } from "@tikz-editor/core/text/source-coordinates";
import type { CanvasTransform } from "../../store/types";
import type { EditableTextTarget, TextEditingSession } from "./types";

/**
 * A `\right` written with its `\left` and not yet accepted (M14): its
 * glyph is drawn faint, and a hint below it says how to accept it.
 */
export type CanvasPendingCloser = {
  /** The `\right` as written: `\right)`. */
  readonly closer: string;
  /** Viewport px: where the hint goes, below the delimiter. */
  readonly left: number;
  readonly top: number;
};

/** Glyphs drawn faint while their `\right` is pending. */
const FAINT_OPACITY = "0.35";

/**
 * Finds the pending `\right`'s glyphs (those between the caret places just
 * before and just after it), draws them faint while it is pending, and
 * places the hint. `closer`: its span in the session buffer, or null.
 */
export function useCanvasPendingCloser(args: {
  session: TextEditingSession | null;
  closer: { readonly from: number; readonly to: number } | null;
  renderedSource: string;
  source: string;
  textLayoutContext: unknown;
  canvasTransform: CanvasTransform;
  viewportRef: RefObject<HTMLDivElement | null>;
  resolveTarget: (session: TextEditingSession) => EditableTextTarget | null;
  resolveContainer: (target: EditableTextTarget, paragraphId: string) => SVGGraphicsElement | null;
}): CanvasPendingCloser | null {
  const { session, closer, renderedSource, source, textLayoutContext, canvasTransform, viewportRef, resolveTarget, resolveContainer } = args;
  const [pending, setPending] = useState<CanvasPendingCloser | null>(null);
  const from = closer?.from ?? null;
  const to = closer?.to ?? null;

  useEffect(() => {
    const target = session && from != null && to != null ? resolveTarget(session) : null;
    const viewport = viewportRef.current;
    if (!session || from == null || to == null || !target || !viewport || renderedSource !== source) {
      setPending(null);
      return;
    }
    const start = session.sourceSpan.from + from;
    const end = session.sourceSpan.from + to;
    const paragraph = target.scopeParagraphs?.find((candidate) => candidate.sourceSpan.from <= start && end <= candidate.sourceSpan.to);
    const container = paragraph ? resolveContainer(target, paragraph.paragraphId) : null;
    if (!paragraph || !container) {
      setPending(null);
      return;
    }
    const cancelled = { value: false };
    const faded: SVGElement[] = [];
    const pointAt = (offset: number) => getKnuthPlassPointFromOffset(textLayoutContext, {
      paragraphId: paragraph.paragraphId,
      sourceText: source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to),
      sourceTextStartOffset: documentSourceOffset(paragraph.sourceSpan.from),
      sourceCoordinateSpace: "document",
      containerElement: container,
      offset: documentSourceOffset(offset)
    });
    void (async () => {
      const [before, after] = await Promise.all([pointAt(start), pointAt(end)]);
      if (cancelled.value) {
        return;
      }
      if (!before.ok || !after.ok || !before.clientPoint || !after.clientPoint) {
        setPending(null);
        return;
      }
      const leftX = before.clientPoint.x;
      const rightX = after.clientPoint.x;
      let bottom = Math.max(before.caretBottom?.y ?? before.clientPoint.y, after.caretBottom?.y ?? after.clientPoint.y);
      for (const glyph of Array.from(container.querySelectorAll<SVGElement>("[data-tex-glyph]"))) {
        const box = glyph.getBoundingClientRect();
        const center = box.left + box.width / 2;
        if (center > leftX && center < rightX) {
          glyph.style.opacity = FAINT_OPACITY;
          faded.push(glyph);
          bottom = Math.max(bottom, box.bottom);
        }
      }
      const viewportRect = viewport.getBoundingClientRect();
      setPending({
        closer: session.text.slice(from, to),
        left: leftX - viewportRect.left,
        top: bottom - viewportRect.top + 3
      });
    })();
    return () => {
      cancelled.value = true;
      for (const glyph of faded) {
        glyph.style.opacity = "";
      }
    };
    // The resolvers are stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, session?.sourceId, session?.sourceSpan.from, session?.text, renderedSource, source, textLayoutContext, canvasTransform]);

  return closer ? pending : null;
}
