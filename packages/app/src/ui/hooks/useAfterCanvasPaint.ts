import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/** Cosmetic work only: cancel obsolete callbacks and let a canvas paint happen first. */
export function useAfterCanvasPaint(effect: () => void, ready: boolean): () => void {
  const raf = useRef<number | null>(null);
  const cancel = useCallback(() => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);
  const schedule = useCallback(() => {
    cancel();
    if (!ready) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = requestAnimationFrame(() => { raf.current = null; effect(); });
    });
  }, [cancel, effect, ready]);
  useLayoutEffect(() => cancel, [cancel, schedule]);
  useEffect(() => { schedule(); return cancel; }, [cancel, schedule]);
  return schedule;
}
