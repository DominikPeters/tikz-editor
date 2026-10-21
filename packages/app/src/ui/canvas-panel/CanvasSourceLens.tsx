import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { scanTexRecovery } from "@tikz-editor/core/text/tex/recovery";
import css from "./CanvasPanel.module.css";
import { useClearOfBand, type ClearBand } from "./useClearOfBand";

/**
 * The source lens (R13): the raw source of a construct, edited in place
 * while the slide re-renders it. ⌘E opens it; Esc closes it, keeping what
 * it wrote; ⏎ closes it too once the source is balanced (⇧⏎ always
 * breaks the line).
 */
export type CanvasSourceLensModel = {
  /** Identity: a new key starts the lens over. */
  readonly key: string;
  /** The span's source when the lens opened; the lens holds it from then on. */
  readonly initial: string;
  /** The caret's place in it then. */
  readonly caret: number;
  /** Viewport px: the lens's left edge. */
  readonly left: number;
  /** Viewport px: the lines the lens leaves visible (the construct it edits). */
  readonly band: ClearBand;
  readonly onChange: (text: string, caret: number) => void;
  readonly onClose: () => void;
  readonly onHistory: (direction: "undo" | "redo") => void;
};

/** The field grows with its text, wrapped lines included, up to this many lines (18px each). */
const MAX_HEIGHT_PX = 8 * 18 + 6;

/** What keeps ⏎ from closing: an opener with no closer, or a closer with no opener. */
function imbalance(text: string): string | null {
  const recovery = scanTexRecovery(text);
  const missing = recovery.closers.map((closer) => closer.closer);
  if (missing.length > 0) {
    return `Missing ${[...missing].reverse().join(" ")}`;
  }
  const stray = recovery.strays[0];
  return stray ? `Unmatched ${text.slice(stray.from, stray.to)}` : null;
}

export function CanvasSourceLens({ model }: { model: CanvasSourceLensModel }) {
  const [text, setText] = useState(model.initial);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const placement = useClearOfBand(root, model.band, "below", model.left, height);
  const problem = imbalance(text);

  useLayoutEffect(() => {
    const input = field.current;
    if (!input) {
      return;
    }
    input.style.height = "auto";
    const next = Math.min(MAX_HEIGHT_PX, input.scrollHeight);
    input.style.height = `${next}px`;
    setHeight(next);
  }, [text]);

  useEffect(() => {
    const input = field.current;
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(model.caret, model.caret);
    // (Mounted per key: the caret is where the canvas had it when the lens opened.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) {
      return;
    }
    const primary = event.metaKey || event.ctrlKey;
    if (event.key === "Escape" || (primary && !event.shiftKey && event.key.toLowerCase() === "e")) {
      event.preventDefault();
      model.onClose();
    } else if (event.key === "Enter" && !event.shiftKey && !primary && !event.altKey && problem == null) {
      event.preventDefault();
      model.onClose();
    } else if (primary && event.key.toLowerCase() === "z") {
      // The session's history, not the field's: an undo also closes the lens.
      event.preventDefault();
      model.onHistory(event.shiftKey ? "redo" : "undo");
    }
  };

  return (
    <div
      ref={root}
      className={css.sourceLens}
      style={placement.style}
      data-side={placement.side}
      data-canvas-source-lens=""
      data-testid="canvas-source-lens"
      onPointerDown={(event) => { event.stopPropagation(); }}
    >
      <textarea
        ref={field}
        className={css.sourceLensField}
        value={text}
        rows={1}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        aria-label="Source"
        data-testid="canvas-source-lens-field"
        onChange={(event) => {
          setText(event.target.value);
          model.onChange(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={handleKeyDown}
      />
      <div className={problem ? css.sourceLensProblem : css.sourceLensHint}>
        {problem ? `${problem} · Esc closes` : "⏎ done · ⇧⏎ new line"}
      </div>
    </div>
  );
}
