import { useEffect, useMemo, useState, type RefObject } from "react";
import type { CommandTable } from "@tikz-editor/core/editing/commands/index";
import { emptyMathSlots } from "@tikz-editor/core/editing/position/index";
import { getKnuthPlassPointFromOffset } from "@tikz-editor/core/text/knuth-plass";
import { documentSourceOffset } from "@tikz-editor/core/text/source-coordinates";
import type { CanvasTransform } from "../../store/types";
import { canvasEditView } from "./edit-tree-shadow";
import type { EditableTextTarget, TextEditingSession } from "./types";

/**
 * A placeholder box (V3): where an empty slot of math (`\frac{}{}`,
 * `x^{}`, `${}$`) puts its content, which TeX draws as nothing. Viewport px.
 */
export type CanvasSlotPlaceholder = {
  readonly key: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/** The box against the caret's height there: a little shorter, and narrower still. */
const HEIGHT = 0.72;
const WIDTH = 0.62;

/**
 * Placeholder boxes for the session buffer's empty math slots, at the
 * caret's place in each (so a script's box is a script's size). Empty
 * while the layout lags the source.
 */
export function useCanvasSlotPlaceholders(args: {
  session: TextEditingSession | null;
  commands: CommandTable;
  renderedSource: string;
  source: string;
  textLayoutContext: unknown;
  canvasTransform: CanvasTransform;
  viewportRef: RefObject<HTMLDivElement | null>;
  resolveTarget: (session: TextEditingSession) => EditableTextTarget | null;
  resolveContainer: (target: EditableTextTarget, paragraphId: string) => SVGGraphicsElement | null;
}): readonly CanvasSlotPlaceholder[] {
  const { session, commands, renderedSource, source, textLayoutContext, canvasTransform, viewportRef, resolveTarget, resolveContainer } = args;
  const slots = useMemo(
    () => (session?.isScopeSession ? emptyMathSlots(canvasEditView(session.text, commands)) : []),
    [commands, session?.isScopeSession, session?.text]
  );
  const slotKey = slots.map((slot) => `${slot.at}${slot.centered ? "c" : ""}`).join("|");
  const [boxes, setBoxes] = useState<readonly CanvasSlotPlaceholder[]>([]);

  useEffect(() => {
    const target = session && slots.length > 0 ? resolveTarget(session) : null;
    const paragraphs = target?.scopeParagraphs ?? [];
    const viewport = viewportRef.current;
    if (!session || !target || paragraphs.length === 0 || !viewport || renderedSource !== source) {
      setBoxes([]);
      return;
    }
    const cancelled = { value: false };
    const viewportRect = viewport.getBoundingClientRect();
    void (async () => {
      const result: CanvasSlotPlaceholder[] = [];
      for (const slot of slots) {
        const offset = session.sourceSpan.from + slot.at;
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
        if (!point.ok || !point.clientPoint || !point.caretTop || !point.caretBottom) {
          continue;
        }
        const top = Math.min(point.caretTop.y, point.caretBottom.y);
        const bottom = Math.max(point.caretTop.y, point.caretBottom.y);
        const height = (bottom - top) * HEIGHT;
        const width = height * WIDTH;
        const x = point.clientPoint.x - viewportRect.left;
        result.push({
          key: `${slot.at}`,
          left: slot.centered ? x - width / 2 : x + 1,
          top: bottom - viewportRect.top - height - (bottom - top) * 0.12,
          width,
          height
        });
      }
      if (!cancelled.value) {
        setBoxes(result);
      }
    })();
    return () => {
      cancelled.value = true;
    };
    // slotKey stands for the slots; the resolvers are stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey, session?.sourceId, session?.sourceSpan.from, renderedSource, source, textLayoutContext, canvasTransform]);

  return boxes;
}
