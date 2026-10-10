import { useEffect, useMemo, useState, type RefObject } from "react";
import { getKnuthPlassPointFromOffset } from "@tikz-editor/core/text/knuth-plass";
import { documentSourceOffset } from "@tikz-editor/core/text/source-coordinates";
import { scanTexRecovery } from "@tikz-editor/core/text/tex/recovery";
import type { CanvasTransform } from "../../store/types";
import type { EditableTextTarget, TextEditingSession } from "./types";

/**
 * A closer that recovery put in virtually (T2), drawn faintly where TeX
 * would need it: `\textbf{bo` shows bold "bo" and a ghost `}` after it.
 */
export type CanvasRecoveryGhost = {
  /** The missing closer: `}`, `$`, `\]`, `\right)`. */
  readonly text: string;
  /** What is drawn: the closer, or for a `\right` the delimiter it draws. */
  readonly glyph: string;
  /** Buffer-local offset it belongs at. */
  readonly at: number;
  /** Viewport px: the caret's place there. */
  readonly left: number;
  readonly top: number;
  readonly height: number;
};

/** Delimiters a `\right` names by command, as the glyph they draw. */
const DELIMITER_GLYPHS: Readonly<Record<string, string>> = {
  "\\}": "}", "\\rbrace": "}", "\\rangle": "⟩", "\\rvert": "|", "\\rVert": "‖", "\\|": "‖",
  "\\rfloor": "⌋", "\\rceil": "⌉", ".": ""
};

/** How a missing closer is drawn: `\right)` as the `)` TeX would draw there. */
function closerGlyph(closer: string): string {
  if (!closer.startsWith("\\right")) {
    return closer;
  }
  const delimiter = closer.slice("\\right".length);
  return DELIMITER_GLYPHS[delimiter] ?? delimiter;
}

/** The closers the session's buffer is missing (buffer-local), innermost last as recovery lists them. */
export function missingClosers(session: TextEditingSession | null): readonly { readonly at: number; readonly text: string }[] {
  if (!session?.isScopeSession) {
    return [];
  }
  return scanTexRecovery(session.text).closers.map((closer) => ({ at: closer.at, text: closer.closer }));
}

/**
 * Viewport places for the missing closers' ghosts, at the caret's
 * position for each closer's offset. Recomputed when the closers, the
 * rendered source or the view change; empty while the layout lags.
 */
export function useCanvasRecoveryGhosts(args: {
  session: TextEditingSession | null;
  renderedSource: string;
  source: string;
  textLayoutContext: unknown;
  canvasTransform: CanvasTransform;
  viewportRef: RefObject<HTMLDivElement | null>;
  resolveTarget: (session: TextEditingSession) => EditableTextTarget | null;
  resolveContainer: (target: EditableTextTarget, paragraphId: string) => SVGGraphicsElement | null;
}): readonly CanvasRecoveryGhost[] {
  const { session, renderedSource, source, textLayoutContext, canvasTransform, viewportRef, resolveTarget, resolveContainer } = args;
  const closers = useMemo(() => missingClosers(session), [session]);
  const closerKey = closers.map((closer) => `${closer.at}${closer.text}`).join("|");
  const [ghosts, setGhosts] = useState<readonly CanvasRecoveryGhost[]>([]);

  useEffect(() => {
    const target = session && closers.length > 0 ? resolveTarget(session) : null;
    const paragraphs = target?.scopeParagraphs ?? [];
    const viewport = viewportRef.current;
    if (!session || !target || paragraphs.length === 0 || !viewport || renderedSource !== source) {
      setGhosts([]);
      return;
    }
    const cancelled = { value: false };
    const viewportRect = viewport.getBoundingClientRect();
    void (async () => {
      const result: CanvasRecoveryGhost[] = [];
      // Closers at one offset stand side by side, innermost first.
      const atOffset = new Map<number, number>();
      for (const closer of [...closers].reverse()) {
        const offset = session.sourceSpan.from + closer.at;
        const paragraph = paragraphs.find((candidate) => candidate.sourceSpan.from <= offset && offset <= candidate.sourceSpan.to);
        const container = paragraph ? resolveContainer(target, paragraph.paragraphId) : null;
        if (!paragraph || !container) {
          continue;
        }
        const point = await getKnuthPlassPointFromOffset(textLayoutContext, {
          paragraphId: paragraph.paragraphId,
          sourceText: source.slice(paragraph.sourceSpan.from, paragraph.sourceSpan.to),
          sourceTextStartOffset: documentSourceOffset(paragraph.sourceSpan.from),
          sourceCoordinateSpace: "document",
          containerElement: container,
          offset: documentSourceOffset(offset)
        });
        if (cancelled.value) {
          return;
        }
        if (!point.ok || !point.clientPoint) {
          continue;
        }
        const top = point.caretTop && point.caretBottom ? Math.min(point.caretTop.y, point.caretBottom.y) : point.clientPoint.y - 8;
        const bottom = point.caretTop && point.caretBottom ? Math.max(point.caretTop.y, point.caretBottom.y) : point.clientPoint.y + 4;
        const glyph = closerGlyph(closer.text);
        const before = atOffset.get(closer.at) ?? 0;
        atOffset.set(closer.at, before + glyph.length);
        const height = bottom - top;
        result.push({
          text: closer.text,
          glyph,
          at: closer.at,
          left: point.clientPoint.x - viewportRect.left + 1 + before * height * 0.45,
          top: top - viewportRect.top,
          height
        });
      }
      if (!cancelled.value) {
        setGhosts(result);
      }
    })();
    return () => {
      cancelled.value = true;
    };
    // closerKey stands for the closers; the resolvers are stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closerKey, session?.sourceId, session?.sourceSpan.from, renderedSource, source, textLayoutContext, canvasTransform]);

  return ghosts;
}
