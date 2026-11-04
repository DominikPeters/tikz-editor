import { useEffect, type RefObject } from "react";

const LONG_PRESS_MS = 500;
// Empty canvas arms the marquee first (TOUCH_MARQUEE_HOLD_MS); its menu waits
// long enough that a hold-then-drag reliably becomes a selection box.
const EMPTY_CANVAS_LONG_PRESS_MS = 1000;
const MOVE_TOLERANCE_PX = 10;
const CLICK_SUPPRESS_WINDOW_MS = 900;

type PendingLongPress = {
  pointerId: number;
  target: EventTarget;
  startX: number;
  startY: number;
  timer: number;
};

/**
 * Opens the canvas context menu on touch long-press.
 *
 * iOS WebKit never fires `contextmenu` for touch input, so this synthesizes
 * one on the touched element after a hold — reusing the exact right-click
 * plumbing (element/selection resolution, native-menu platforms, submenu
 * definitions). Before opening the menu it dispatches a synthetic
 * `pointercancel` so any drag/selection state machine tracking that pointer
 * aborts cleanly, and it swallows the remaining events of that pointer so
 * lifting the finger does not register as a tap.
 */
export function useCanvasTouchLongPress(
  viewportRef: RefObject<HTMLDivElement | null>,
  enabled: boolean
): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    let pending: PendingLongPress | null = null;
    let suppressedPointerId: number | null = null;
    let suppressClickUntil = 0;
    let dispatchingSynthetic = false;

    const clearPending = (): void => {
      if (pending) {
        window.clearTimeout(pending.timer);
        pending = null;
      }
    };

    const fireLongPress = (): void => {
      const current = pending;
      pending = null;
      if (!current) {
        return;
      }
      suppressedPointerId = current.pointerId;
      suppressClickUntil = performance.now() + CLICK_SUPPRESS_WINDOW_MS;
      dispatchingSynthetic = true;
      try {
        current.target.dispatchEvent(new PointerEvent("pointercancel", {
          bubbles: true,
          cancelable: false,
          pointerId: current.pointerId,
          pointerType: "touch",
          clientX: current.startX,
          clientY: current.startY,
          isPrimary: true
        }));
        current.target.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: current.startX,
          clientY: current.startY,
          button: 2
        }));
      } finally {
        dispatchingSynthetic = false;
      }
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (dispatchingSynthetic) {
        return;
      }
      if (event.pointerType !== "touch" || !event.target) {
        clearPending();
        return;
      }
      if (pending || !event.isPrimary) {
        // A second finger means pinch/pan, not a long-press.
        clearPending();
        return;
      }
      pending = {
        pointerId: event.pointerId,
        target: event.target,
        startX: event.clientX,
        startY: event.clientY,
        timer: window.setTimeout(fireLongPress, isEmptyCanvas(event.target, viewport) ? EMPTY_CANVAS_LONG_PRESS_MS : LONG_PRESS_MS)
      };
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (dispatchingSynthetic) {
        return;
      }
      if (suppressedPointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.pointerId !== pending?.pointerId) {
        return;
      }
      if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) > MOVE_TOLERANCE_PX) {
        clearPending();
      }
    };

    const onPointerEnd = (event: PointerEvent): void => {
      if (dispatchingSynthetic) {
        return;
      }
      if (suppressedPointerId === event.pointerId) {
        suppressedPointerId = null;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.pointerId === pending?.pointerId) {
        clearPending();
      }
    };

    const onClick = (event: MouseEvent): void => {
      if (dispatchingSynthetic || performance.now() > suppressClickUntil) {
        return;
      }
      suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    };

    viewport.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onPointerEnd, { capture: true, passive: false });
    window.addEventListener("pointercancel", onPointerEnd, { capture: true, passive: false });
    window.addEventListener("click", onClick, { capture: true });
    return () => {
      viewport.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerup", onPointerEnd, { capture: true });
      window.removeEventListener("pointercancel", onPointerEnd, { capture: true });
      window.removeEventListener("click", onClick, { capture: true });
      clearPending();
    };
  }, [enabled, viewportRef]);
}

function isEmptyCanvas(target: EventTarget, viewport: HTMLElement): boolean {
  return target === viewport ||
    (target instanceof Element && target.getAttribute("data-testid") === "canvas-interaction-layer");
}
