import { useEffect, useMemo, useState, type RefObject } from "react";
import { ghostSlots, type EditView, type GhostSlot, type Position } from "@tikz-editor/core/editing/position/index";
import type { CanvasTransform } from "../../store/types";
import { scopeCaretPoint, type ScopeCaretPoint } from "./scope-caret-point";
import type { EditableTextTarget, TextEditingSession } from "./types";

/**
 * A ghost slot (V3): an optional slot the focus construct lacks (a root's
 * index, a missing script, a description label), drawn faintly where it
 * would go; clicking it creates the slot. Viewport px.
 */
export type CanvasGhostSlot = {
  readonly key: string;
  readonly kind: GhostSlot["kind"];
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly onCreate: () => void;
};

/**
 * The focus construct's ghost slots, placed by the caret's geometry at the
 * construct and at the script a missing one pairs with. Empty while the
 * layout lags the source.
 */
export function useCanvasGhostSlots(args: {
  session: TextEditingSession | null;
  caret: { view: EditView; position: Position } | null;
  renderedSource: string;
  source: string;
  textLayoutContext: unknown;
  canvasTransform: CanvasTransform;
  viewportRef: RefObject<HTMLDivElement | null>;
  resolveTarget: (session: TextEditingSession) => EditableTextTarget | null;
  resolveContainer: (target: EditableTextTarget, paragraphId: string) => SVGGraphicsElement | null;
  onCreate: (ghost: GhostSlot) => void;
}): readonly CanvasGhostSlot[] {
  const { session, caret, renderedSource, source, textLayoutContext, canvasTransform, viewportRef, resolveTarget, resolveContainer, onCreate } = args;
  const ghosts = useMemo(
    () => (session?.isScopeSession && caret && session.selectionStart === session.selectionEnd ? ghostSlots(caret.view, caret.position) : []),
    [caret, session?.isScopeSession, session?.selectionEnd, session?.selectionStart]
  );
  const ghostKey = ghosts.map((ghost) => `${ghost.kind}@${ghost.at}`).join("|");
  const [boxes, setBoxes] = useState<readonly CanvasGhostSlot[]>([]);

  useEffect(() => {
    const target = session && ghosts.length > 0 ? resolveTarget(session) : null;
    const paragraphs = target?.scopeParagraphs ?? [];
    const viewport = viewportRef.current;
    if (!session || !target || paragraphs.length === 0 || !viewport || renderedSource !== source) {
      setBoxes([]);
      return;
    }
    const cancelled = { value: false };
    const viewportRect = viewport.getBoundingClientRect();
    const pointAt = (local: number) =>
      scopeCaretPoint({ session, target, source, textLayoutContext, viewportRect, resolveContainer, local });
    void (async () => {
      const result: CanvasGhostSlot[] = [];
      for (const ghost of ghosts) {
        const anchor = await pointAt(ghost.anchor);
        const pair = ghost.pair == null ? null : await pointAt(ghost.pair);
        if (cancelled.value) {
          return;
        }
        const box = anchor ? ghostBox(ghost, anchor, pair) : null;
        if (box) {
          result.push({ key: `${ghost.kind}@${ghost.at}`, kind: ghost.kind, ...box, onCreate: () => { onCreate(ghost); } });
        }
      }
      if (!cancelled.value) {
        setBoxes(result);
      }
    })();
    return () => {
      cancelled.value = true;
    };
    // ghostKey stands for the ghosts; the resolvers and onCreate are stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghostKey, session?.sourceId, session?.sourceSpan.from, renderedSource, source, textLayoutContext, canvasTransform]);

  return boxes;
}

/**
 * Where a ghost goes, from the caret at the construct's start (`anchor`,
 * a full-size caret) and at the script it pairs with: an index over the
 * root's hook, a missing superscript over the subscript and level with
 * the base's top, a missing subscript under the superscript, a label to
 * the left of the item's text.
 */
function ghostBox(ghost: GhostSlot, anchor: ScopeCaretPoint, pair: ScopeCaretPoint | null): { left: number; top: number; width: number; height: number } | null {
  const size = anchor.bottom - anchor.top;
  switch (ghost.kind) {
    case "index": {
      const height = size * 0.34;
      return { left: anchor.x, top: anchor.top + size * 0.08, width: height * 0.8, height };
    }
    case "sup":
    case "sub": {
      if (!pair) {
        return null;
      }
      const height = (pair.bottom - pair.top) * 0.72;
      const top = ghost.kind === "sup" ? anchor.top + size * 0.02 : anchor.bottom - height * 0.75;
      return { left: pair.x + 1, top, width: height * 0.62, height };
    }
    case "label": {
      const height = size * 0.72;
      const width = height * 2.2;
      return { left: anchor.x - width - size * 0.3, top: anchor.bottom - height - size * 0.12, width, height };
    }
  }
}
