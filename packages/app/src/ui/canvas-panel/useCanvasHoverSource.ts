import { useEffect, useRef, useState, type RefObject } from "react";
import type { HoverSource } from "@tikz-editor/core/editing/position/index";

/** The tooltip hovering shows (V5): an item's source, near the pointer. Viewport px. */
export type CanvasHoverSource = { readonly text: string; readonly left: number; readonly top: number };

const HOVER_DELAY_MS = 500;
/** Moving this far from where it opened closes it. */
const LEAVE_DISTANCE_PX = 6;

/**
 * Hovering over a symbol, atom or construct for half a second shows its
 * source (V5: `\setminus`, `\textbf{…}`), which teaches command names
 * without the bar. A key, a click, or moving away closes it.
 */
export function useCanvasHoverSource(args: {
  enabled: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  lookup: (clientPoint: { x: number; y: number }) => Promise<HoverSource | null>;
}): CanvasHoverSource | null {
  const { enabled, viewportRef, lookup } = args;
  const [shown, setShown] = useState<(CanvasHoverSource & { clientX: number; clientY: number }) | null>(null);
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!enabled || !viewport) {
      setShown(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let request = 0;
    let open: { x: number; y: number } | null = null;
    const close = () => {
      request += 1;
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      open = null;
      setShown(null);
    };
    const move = (event: PointerEvent) => {
      if (event.buttons !== 0) {
        close();
        return;
      }
      if (open && Math.hypot(event.clientX - open.x, event.clientY - open.y) < LEAVE_DISTANCE_PX) {
        return;
      }
      close();
      const point = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => {
        timer = null;
        const current = ++request;
        void lookupRef.current(point).then((source) => {
          if (current !== request || !source) {
            return;
          }
          const rect = viewport.getBoundingClientRect();
          open = point;
          setShown({ text: source.text, left: point.x - rect.left + 10, top: point.y - rect.top + 16, clientX: point.x, clientY: point.y });
        });
      }, HOVER_DELAY_MS);
    };
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerleave", close);
    viewport.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      close();
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerleave", close);
      viewport.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [enabled, viewportRef]);

  return shown ? { text: shown.text, left: shown.left, top: shown.top } : null;
}
