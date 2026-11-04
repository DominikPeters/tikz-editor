import { useEffect, type RefObject } from "react";

// A hold lifts a card, as in Keynote: lifting the finger then opens the
// slide's menu, moving it drags the slide to a new place.
const HOLD_MS = 450;
const SLOP_PX = 10;
const CLICK_SUPPRESS_MS = 700;
const EDGE_PX = 44;
const EDGE_SPEED_PX = 12;

export type NavigatorTouchHandlers = {
  /** Whether a held card may lift at all. */
  canLift: (id: string) => boolean;
  /** The finger came up without moving after the hold. */
  openMenu: (id: string, card: HTMLElement, x: number, y: number) => void;
  /** The lifted card started to move; false refuses the drag. */
  beginDrag: (id: string) => boolean;
  /** The dragged card is over this point (updates the insertion mark). */
  dragOver: (x: number, y: number, target: Element | null) => void;
  /** Dropped where the insertion mark is. */
  drop: () => void;
  cancelDrag: () => void;
  /** The direction the cards run in, for scrolling at the edges. */
  axis: () => "x" | "y";
};

type Gesture = {
  pointerId: number;
  id: string;
  card: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  timer: number;
  state: "pending" | "lifted" | "dragging";
  ghost: HTMLElement | null;
  offsetX: number;
  offsetY: number;
  frame: number;
};

/**
 * Touch gestures on the slide navigator's cards. iOS WebKit fires neither
 * `contextmenu` nor HTML drag events for a finger, so a hold lifts the card
 * here and the rest of the gesture is followed by pointer events. Before the
 * hold completes, moving the finger scrolls the navigator as usual.
 */
export function useNavigatorTouchGestures(
  viewportRef: RefObject<HTMLElement | null>,
  handlers: RefObject<NavigatorTouchHandlers | null>,
  ghostClassName: string
): void {
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let gesture: Gesture | null = null;
    let suppressClickUntil = 0;

    const end = (commit: boolean) => {
      const current = gesture;
      gesture = null;
      if (!current) return;
      window.clearTimeout(current.timer);
      cancelAnimationFrame(current.frame);
      current.ghost?.remove();
      delete current.card.dataset.lifted;
      if (current.state === "dragging") {
        if (commit) handlers.current?.drop(); else handlers.current?.cancelDrag();
      }
      if (current.state !== "pending") suppressClickUntil = performance.now() + CLICK_SUPPRESS_MS;
    };

    const lift = () => {
      if (gesture?.state !== "pending") return;
      gesture.state = "lifted";
      gesture.card.dataset.lifted = "hold";
    };

    const startDrag = (current: Gesture) => {
      if (!handlers.current?.beginDrag(current.id)) { end(false); return; }
      current.state = "dragging";
      current.card.dataset.lifted = "drag";
      const rect = current.card.getBoundingClientRect();
      const ghost = current.card.cloneNode(true);
      if (!(ghost instanceof HTMLElement)) { end(false); return; }
      delete ghost.dataset.lifted;
      ghost.removeAttribute("data-slide-id");
      ghost.removeAttribute("role");
      ghost.setAttribute("aria-hidden", "true");
      ghost.className = ghostClassName;
      // The card's look depends on the navigator's layout (strip, column).
      const layout = current.card.closest<HTMLElement>("[data-layout]")?.dataset.layout;
      if (layout) ghost.dataset.layout = layout;
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      current.offsetX = current.startX - rect.left;
      current.offsetY = current.startY - rect.top;
      document.body.appendChild(ghost);
      current.ghost = ghost;
      follow(current);
      const scrollAtEdges = () => {
        if (gesture !== current) return;
        const box = viewport.getBoundingClientRect();
        const axis = handlers.current?.axis() ?? "x";
        const position = axis === "x" ? current.x : current.y;
        const start = axis === "x" ? box.left : box.top;
        const finish = axis === "x" ? box.right : box.bottom;
        const step = position < start + EDGE_PX ? -EDGE_SPEED_PX : position > finish - EDGE_PX ? EDGE_SPEED_PX : 0;
        if (step) {
          if (axis === "x") viewport.scrollLeft += step; else viewport.scrollTop += step;
          handlers.current?.dragOver(current.x, current.y, document.elementFromPoint(current.x, current.y));
        }
        current.frame = requestAnimationFrame(scrollAtEdges);
      };
      current.frame = requestAnimationFrame(scrollAtEdges);
    };

    const follow = (current: Gesture) => {
      if (current.ghost) current.ghost.style.transform = `translate(${current.x - current.offsetX}px, ${current.y - current.offsetY}px) scale(1.05)`;
      handlers.current?.dragOver(current.x, current.y, document.elementFromPoint(current.x, current.y));
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      if (gesture) { end(false); return; } // a second finger
      if (!event.isPrimary) return;
      const card = (event.target instanceof Element ? event.target : null)?.closest<HTMLElement>("[data-slide-id]");
      const id = card?.dataset.slideId;
      if (!card || !id || !handlers.current?.canLift(id)) return;
      gesture = { pointerId: event.pointerId, id, card, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
        timer: window.setTimeout(lift, HOLD_MS), state: "pending", ghost: null, offsetX: 0, offsetY: 0, frame: 0 };
    };

    const onPointerMove = (event: PointerEvent) => {
      const current = gesture;
      if (current?.pointerId !== event.pointerId) return;
      current.x = event.clientX; current.y = event.clientY;
      const moved = Math.hypot(current.x - current.startX, current.y - current.startY) > SLOP_PX;
      if (current.state === "pending") { if (moved) end(false); return; }
      event.preventDefault();
      if (current.state === "lifted" && moved) startDrag(current);
      else if (current.state === "dragging") follow(current);
    };

    const onPointerUp = (event: PointerEvent) => {
      const current = gesture;
      if (current?.pointerId !== event.pointerId) return;
      if (current.state === "lifted") {
        end(false);
        handlers.current?.openMenu(current.id, current.card, current.startX, current.startY);
        return;
      }
      end(current.state === "dragging");
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (gesture?.pointerId === event.pointerId) end(false);
    };

    // Once a card is lifted the finger no longer scrolls the navigator.
    const onTouchMove = (event: TouchEvent) => {
      if (gesture && gesture.state !== "pending") event.preventDefault();
    };

    const onClick = (event: MouseEvent) => {
      if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); }
    };

    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("pointercancel", onPointerCancel);
    viewport.addEventListener("touchmove", onTouchMove, { passive: false });
    viewport.addEventListener("click", onClick, true);
    return () => {
      end(false);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerUp);
      viewport.removeEventListener("pointercancel", onPointerCancel);
      viewport.removeEventListener("touchmove", onTouchMove);
      viewport.removeEventListener("click", onClick, true);
    };
  }, [viewportRef, handlers, ghostClassName]);
}
