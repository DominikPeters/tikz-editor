/**
 * Runs `callback` in a task after the next frame is painted. Returns a cancel
 * function. A hidden document paints no frames, so there it just runs next.
 */
export function afterNextPaint(callback: () => void): () => void {
  if (typeof requestAnimationFrame !== "function" ||
    (typeof document !== "undefined" && document.visibilityState === "hidden")) {
    const timer = setTimeout(callback, 0);
    return () => { clearTimeout(timer); };
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(callback, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    if (timer != null) clearTimeout(timer);
  };
}

/**
 * Runs `callback` in the slack after a frame, so it never delays one. WebKit
 * (the desktop app) has no idle callbacks: there it runs after the next paint.
 */
export function whenIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(callback);
    return () => { cancelIdleCallback(handle); };
  }
  return afterNextPaint(callback);
}
