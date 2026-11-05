import { useEffect, type RefObject } from "react";

// As in Keynote for iPad: a tap or a swipe to the left advances, a swipe to
// the right goes back, and pinching ends the presentation. Holding a finger
// still shows the controls. As in a book reader, a tap on the left quarter of
// the slide goes back; a tap on the black around the slide shows the controls.
const TAP_SLOP_PX = 10;
const SWIPE_PX = 40;
const HOLD_MS = 500;
const PINCH_END_RATIO = 0.6;
const CLICK_SUPPRESS_MS = 600;
const BACK_ZONE = 0.25;

export type AudienceTouchHandlers = {
  next(): void; previous(): void; end(): void; showControls(): void;
  /** Where the slide is drawn, in client coordinates; null for the whole surface. */
  slideRect?(): DOMRect | null;
};

type Touch = { startX: number; startY: number; x: number; y: number };

export function useAudienceTouchGestures(target: RefObject<HTMLElement | null>, handlers: RefObject<AudienceTouchHandlers | null>): void {
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const touches = new Map<number, Touch>();
    // A hold, a second finger or a pinch uses up the gesture: lifting the
    // fingers afterwards neither advances nor goes back.
    let consumed = false;
    let pinchFrom = 0;
    // A pinch ends the presentation once the fingers lift, so the rest of the
    // pinch does not land on the editor underneath.
    let endOnLift = false;
    const finish = () => {
      consumed = false; pinchFrom = 0;
      if (endOnLift) { endOnLift = false; handlers.current?.end(); }
    };
    let holdTimer = 0;
    let suppressClickUntil = 0;
    const spread = () => {
      const [a, b] = [...touches.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const onControl = (event: Event) => (event.target instanceof Element ? event.target : null)?.closest("button, a, select") != null;

    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || onControl(event)) return;
      touches.set(event.pointerId, { startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY });
      window.clearTimeout(holdTimer);
      if (touches.size === 1) {
        consumed = false;
        holdTimer = window.setTimeout(() => { consumed = true; handlers.current?.showControls(); }, HOLD_MS);
      } else {
        consumed = true;
        pinchFrom = touches.size === 2 ? spread() : 0;
      }
    };
    const move = (event: PointerEvent) => {
      const touch = touches.get(event.pointerId);
      if (!touch) return;
      touch.x = event.clientX; touch.y = event.clientY;
      if (Math.hypot(touch.x - touch.startX, touch.y - touch.startY) > TAP_SLOP_PX) window.clearTimeout(holdTimer);
      if (pinchFrom && touches.size === 2 && spread() < pinchFrom * PINCH_END_RATIO) endOnLift = true;
    };
    const up = (event: PointerEvent) => {
      const touch = touches.get(event.pointerId);
      if (!touch) return;
      touches.delete(event.pointerId);
      window.clearTimeout(holdTimer);
      suppressClickUntil = performance.now() + CLICK_SUPPRESS_MS;
      if (consumed) {
        if (!touches.size) finish();
        return;
      }
      const dx = touch.x - touch.startX, dy = touch.y - touch.startY;
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) handlers.current?.next(); else handlers.current?.previous();
      } else if (Math.hypot(dx, dy) <= TAP_SLOP_PX) {
        const current = handlers.current;
        const slide = current?.slideRect?.() ?? element.getBoundingClientRect();
        const { x, y } = touch;
        if (x < slide.left || x > slide.right || y < slide.top || y > slide.bottom) current?.showControls();
        else if (x < slide.left + slide.width * BACK_ZONE) current?.previous();
        else current?.next();
      }
    };
    const cancel = (event: PointerEvent) => {
      if (!touches.delete(event.pointerId)) return;
      window.clearTimeout(holdTimer);
      if (!touches.size) finish();
    };
    // The tap was handled above; the click WebKit sends after it must not
    // advance a second time.
    const click = (event: MouseEvent) => {
      if (performance.now() < suppressClickUntil && !onControl(event)) { event.preventDefault(); event.stopPropagation(); }
    };

    // WebKit on iOS reports a pinch through its gesture events, with the
    // scale; following both fingers' pointers alone did not catch it.
    const gestureScale = (event: Event) => "scale" in event && typeof event.scale === "number" ? event.scale : 1;
    const gestureStart = (event: Event) => {
      event.preventDefault();
      consumed = true;
      window.clearTimeout(holdTimer);
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      if (gestureScale(event) < PINCH_END_RATIO) endOnLift = true;
    };
    // Once WebKit has taken a pinch, the fingers' pointerup or pointercancel
    // may never arrive: the gesture's end is the fingers lifting.
    const gestureEnd = (event: Event) => {
      event.preventDefault();
      touches.clear();
      window.clearTimeout(holdTimer);
      suppressClickUntil = performance.now() + CLICK_SUPPRESS_MS;
      finish();
    };

    element.addEventListener("gesturestart", gestureStart);
    element.addEventListener("gesturechange", gestureChange);
    element.addEventListener("gestureend", gestureEnd);
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", cancel);
    element.addEventListener("click", click, true);
    return () => {
      window.clearTimeout(holdTimer);
      element.removeEventListener("gesturestart", gestureStart);
      element.removeEventListener("gesturechange", gestureChange);
      element.removeEventListener("gestureend", gestureEnd);
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("click", click, true);
    };
  }, [target, handlers]);
}
