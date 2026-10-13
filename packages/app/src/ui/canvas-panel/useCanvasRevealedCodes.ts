import { useEffect, useMemo, useState, type RefObject } from "react";
import type { CommandTable } from "@tikz-editor/core/editing/commands/index";
import { revealedCodes } from "@tikz-editor/core/editing/position/index";
import type { CanvasTransform } from "../../store/types";
import { canvasEditView } from "./edit-tree-shadow";
import { scopeCaretPoint } from "./scope-caret-point";
import type { EditableTextTarget, TextEditingSession } from "./types";

/**
 * A chip for a piece of invisible syntax while reveal codes is on (R14):
 * small and gray above its place, without moving the text. Viewport px.
 */
export type CanvasRevealedCode = {
  readonly key: string;
  readonly label: string;
  readonly left: number;
  readonly top: number;
  readonly height: number;
  /** The selection covers it. */
  readonly selected: boolean;
  /** Selects it (B4): ⌫ then deletes it, ⌘E edits its source. */
  readonly onSelect: () => void;
};

export function useCanvasRevealedCodes(args: {
  session: TextEditingSession | null;
  enabled: boolean;
  commands: CommandTable;
  renderedSource: string;
  source: string;
  textLayoutContext: unknown;
  canvasTransform: CanvasTransform;
  viewportRef: RefObject<HTMLDivElement | null>;
  resolveTarget: (session: TextEditingSession) => EditableTextTarget | null;
  resolveContainer: (target: EditableTextTarget, paragraphId: string) => SVGGraphicsElement | null;
  onSelect: (span: { from: number; to: number }) => void;
}): readonly CanvasRevealedCode[] {
  const { session, enabled, commands, renderedSource, source, textLayoutContext, canvasTransform, viewportRef, resolveTarget, resolveContainer, onSelect } = args;
  const codes = useMemo(
    () => (enabled && session?.isScopeSession ? revealedCodes(canvasEditView(session.text, commands)) : []),
    [commands, enabled, session?.isScopeSession, session?.text]
  );
  const codeKey = codes.map((code) => `${code.span.from}-${code.span.to}:${code.label}`).join("|");
  const [placed, setPlaced] = useState<readonly Omit<CanvasRevealedCode, "selected" | "onSelect">[]>([]);

  useEffect(() => {
    const target = session && codes.length > 0 ? resolveTarget(session) : null;
    const viewport = viewportRef.current;
    if (!session || !target || !viewport || renderedSource !== source) {
      setPlaced([]);
      return;
    }
    const cancelled = { value: false };
    const viewportRect = viewport.getBoundingClientRect();
    void (async () => {
      const result: Omit<CanvasRevealedCode, "selected" | "onSelect">[] = [];
      for (const code of codes) {
        // A code past the rendered text (a comment ending a paragraph) goes where the text ends.
        let point = null;
        for (let local = code.span.from; local >= Math.max(0, code.span.from - 3) && !point; local -= 1) {
          point = await scopeCaretPoint({ session, target, source, textLayoutContext, viewportRect, resolveContainer, local });
        }
        if (cancelled.value) {
          return;
        }
        if (point) {
          const height = Math.max(10, (point.bottom - point.top) * 0.55);
          result.push({ key: `${code.span.from}-${code.span.to}`, label: code.label, left: point.x - 1, top: point.top - height - 1, height });
        }
      }
      if (!cancelled.value) {
        setPlaced(result);
      }
    })();
    return () => {
      cancelled.value = true;
    };
    // codeKey stands for the codes; the resolvers are stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeKey, session?.sourceId, session?.sourceSpan.from, renderedSource, source, textLayoutContext, canvasTransform]);

  return useMemo(() => {
    const from = session ? Math.min(session.selectionStart, session.selectionEnd) : -1;
    const to = session ? Math.max(session.selectionStart, session.selectionEnd) : -1;
    return placed.map((chip) => {
      const code = codes.find((candidate) => `${candidate.span.from}-${candidate.span.to}` === chip.key);
      const span = code?.span ?? { from: -1, to: -1 };
      return { ...chip, selected: from <= span.from && span.to <= to && from < to, onSelect: () => { onSelect(span); } };
    });
  }, [codes, onSelect, placed, session]);
}
