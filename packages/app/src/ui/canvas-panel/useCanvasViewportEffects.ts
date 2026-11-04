import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { viewportPoint as makeViewportPoint, clientPoint, px } from "@tikz-editor/core/coords/index";
import { clamp, distanceSquared, viewportToSvgPoint } from "./geometry";
import { resolveToolCreateCurrentWorld } from "./interaction-helpers";
import type { ClientPoint, SvgPoint, ViewportPoint, WorldPoint } from "../coords/types";
import type { CanvasTransform } from "../../store/types";
import type { CanvasSnapshot, DragState, PendingTouchViewport, StateSetter, ValueSetter } from "./types";
import type { SvgViewBox } from "@tikz-editor/core/svg/types";

export type UseCanvasViewportEffectsArgs = {
  canvasContextKey?: string;
  viewportStateReadyRef?: MutableRefObject<boolean>;
  dragRef: MutableRefObject<DragState | null>;
  pendingTouchViewportRef: MutableRefObject<PendingTouchViewport | null>;
  suppressNextBackgroundClickRef: MutableRefObject<boolean>;
  setDragState: ValueSetter<DragState | null>;
  setToolDraft: StateSetter<Extract<DragState, { kind: "tool-create" }> | null>;
  setToolCursorWorld: StateSetter<WorldPoint | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
  setViewportSize: StateSetter<{ width: number; height: number }>;
  canvasTransformRef: MutableRefObject<CanvasTransform>;
  svgResult: CanvasSnapshot["svg"];
  svgResultRef: MutableRefObject<CanvasSnapshot["svg"]>;
  fitToContentModeActiveRef: MutableRefObject<boolean>;
  previousViewBoxRef: MutableRefObject<SvgViewBox | null>;
  dispatchCanvasTransform: (transform: CanvasTransform) => void;
  zoomSpeed: number;
  MIN_SCALE: number;
  MAX_SCALE: number;
  setFitToContentModeActive: ValueSetter<boolean>;
  requestFitToContent: () => void;
};

export function useCanvasViewportEffects(args: UseCanvasViewportEffectsArgs) {
  const {
    dragRef,
    pendingTouchViewportRef,
    suppressNextBackgroundClickRef,
    setDragState,
    setToolDraft,
    setToolCursorWorld,
    viewportRef,
    setViewportSize,
    canvasTransformRef,
    svgResult,
    svgResultRef,
    fitToContentModeActiveRef,
    previousViewBoxRef,
    dispatchCanvasTransform,
    zoomSpeed,
    MIN_SCALE,
    MAX_SCALE,
    setFitToContentModeActive,
    requestFitToContent
  } = args;
  const dispatchTransformRef = useRef(dispatchCanvasTransform);
  const previousViewBoxContextRef = useRef(args.canvasContextKey);
  useLayoutEffect(() => { dispatchTransformRef.current = dispatchCanvasTransform; });
  const [interactionViewport, setInteractionViewport] = useState<HTMLDivElement | null>(null);
  // A stable ref can point at a replaced DOM node; inspect it after every commit.
  // The identity comparison makes the setter a no-op while the surface is unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    setInteractionViewport(current => current === viewportRef.current ? current : viewportRef.current);
  });

  useEffect(() => {
    const onModifierKeyChange = (event: KeyboardEvent) => {
      if (event.key !== "Shift") {
        return;
      }

      const drag = dragRef.current;
      if (drag?.kind !== "tool-create") {
        return;
      }

      const nextWorld = resolveToolCreateCurrentWorld(
        drag.startWorld,
        drag.rawCurrentWorld,
        drag.toolMode,
        event.type === "keydown"
      );
      if (distanceSquared(nextWorld, drag.currentWorld) <= 1e-12) {
        return;
      }

      drag.currentWorld = nextWorld;
      setToolDraft({ ...drag });
      setToolCursorWorld(nextWorld);
    };

    window.addEventListener("keydown", onModifierKeyChange);
    window.addEventListener("keyup", onModifierKeyChange);
    return () => {
      window.removeEventListener("keydown", onModifierKeyChange);
      window.removeEventListener("keyup", onModifierKeyChange);
    };
  }, [dragRef, setToolCursorWorld, setToolDraft]);

  useEffect(() => {
    const viewport = interactionViewport;
    if (!viewport) return;

    const updateSize = () => {
      const rect = viewport.getBoundingClientRect();
      setViewportSize({
        width: rect.width,
        height: rect.height
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => { updateSize(); });
    observer.observe(viewport);

    return () => { observer.disconnect(); };
  }, [setViewportSize, interactionViewport]);

  useLayoutEffect(() => {
    if (previousViewBoxContextRef.current !== args.canvasContextKey || args.viewportStateReadyRef?.current === false) {
      previousViewBoxContextRef.current = args.canvasContextKey;
      previousViewBoxRef.current = null;
    }
    if (args.viewportStateReadyRef?.current === false) return;
    if (!svgResult) {
      previousViewBoxRef.current = null;
      return;
    }

    const previous = previousViewBoxRef.current;
    previousViewBoxRef.current = svgResult.viewBox;
    if (!previous) return;

    const sameX = Math.abs(previous.x - svgResult.viewBox.x) < 1e-6;
    const sameY = Math.abs(previous.y - svgResult.viewBox.y) < 1e-6;
    const sameW = Math.abs(previous.width - svgResult.viewBox.width) < 1e-6;
    const sameH = Math.abs(previous.height - svgResult.viewBox.height) < 1e-6;
    if (sameX && sameY && sameW && sameH) return;

    const currentTransform = canvasTransformRef.current;
    const scale = currentTransform.scale;

    const translateX = currentTransform.translateX + (svgResult.viewBox.x - previous.x) * scale;
    const translateY =
      currentTransform.translateY +
      ((previous.y + previous.height) - (svgResult.viewBox.y + svgResult.viewBox.height)) * scale;

    dispatchCanvasTransform({ translateX, translateY, scale });
  }, [args.canvasContextKey, args.viewportStateReadyRef, canvasTransformRef, dispatchCanvasTransform, previousViewBoxRef, svgResult]);

  useEffect(() => {
    const viewport = interactionViewport;
    if (!viewport) return;

    const activeTouchPointers = new Map<number, ClientPoint>();
    const touchStartPointers = new Map<number, { point: ClientPoint; time: number }>();
    let lastTouchTap: { point: ClientPoint; time: number } | null = null;
    let suppressTapUntilTouchesEnd = false;
    let touchEventPinchActive = false;
    let touchEventPinchIds: [number, number] | null = null;
    let pinchGesture:
      | {
          baseScale: number;
          baseSvgPoint: SvgPoint;
          baseDistance: number;
        }
      | null = null;

    const clearPendingTouchViewport = () => {
      const pending = pendingTouchViewportRef.current;
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      pendingTouchViewportRef.current = null;
    };

    const pointerTouchPair = () => {
      const [first, second] = [...activeTouchPointers.values()];
      if (!first || !second) {
        return null;
      }
      return { first, second };
    };

    const stopPinchEvent = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const claimViewportPinch = (event: Event) => {
      suppressTapUntilTouchesEnd = true;
      suppressNextBackgroundClickRef.current = true;
      clearPendingTouchViewport();
      if (dragRef.current) {
        setDragState(null);
      }
      stopPinchEvent(event);
    };

    const beginPinchGestureFromPoints = (first: ClientPoint, second: ClientPoint) => {
      const currentSvg = svgResultRef.current;
      if (!currentSvg) {
        pinchGesture = null;
        return;
      }
      const center = midpointLocal(first, second, viewport);
      const distance = touchDistance(first, second);
      if (!Number.isFinite(distance) || distance <= 0) {
        pinchGesture = null;
        return;
      }
      const currentTransform = canvasTransformRef.current;
      pinchGesture = {
        baseScale: currentTransform.scale,
        baseSvgPoint: viewportToSvgPoint(center, currentTransform, currentSvg.viewBox),
        baseDistance: distance
      };
    };

    const beginPointerPinchGesture = () => {
      const pair = pointerTouchPair();
      if (!pair) {
        pinchGesture = null;
        return;
      }
      beginPinchGestureFromPoints(pair.first, pair.second);
    };

    const updatePinchGestureFromPoints = (first: ClientPoint, second: ClientPoint) => {
      const currentSvg = svgResultRef.current;
      if (!currentSvg || !pinchGesture) {
        return;
      }
      const distance = touchDistance(first, second);
      if (!Number.isFinite(distance) || distance <= 0) {
        return;
      }
      const center = midpointLocal(first, second, viewport);
      const nextScale = clamp(
        pinchGesture.baseScale * (distance / pinchGesture.baseDistance),
        MIN_SCALE,
        MAX_SCALE
      );
      const translateX = center.x - (pinchGesture.baseSvgPoint.x - currentSvg.viewBox.x) * nextScale;
      const translateY = center.y - (pinchGesture.baseSvgPoint.y - currentSvg.viewBox.y) * nextScale;

      if (fitToContentModeActiveRef.current) {
        setFitToContentModeActive(false);
      }

      dispatchTransformRef.current({ translateX, translateY, scale: nextScale });
    };

    const updatePointerPinchGesture = () => {
      const pair = pointerTouchPair();
      if (!pair) {
        return;
      }
      updatePinchGestureFromPoints(pair.first, pair.second);
    };

    const onWheel = (event: WheelEvent) => {
      const currentSvg = svgResultRef.current;
      if (!currentSvg) return;
      // Plain wheel gestures over the text edit surface scroll its textarea,
      // not the canvas. Zoom chords keep zooming the canvas (and must not
      // fall through to browser page zoom).
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        event.target instanceof Element &&
        event.target.closest('[data-testid="canvas-text-edit-popup"]')
      ) {
        return;
      }
      const currentTransform = canvasTransformRef.current;

      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        event.stopPropagation();
      }

      const rect = viewport.getBoundingClientRect();
      const viewportPoint = makeViewportPoint(px(event.clientX - rect.left), px(event.clientY - rect.top));

      if (event.ctrlKey || event.metaKey) {
        if (fitToContentModeActiveRef.current) {
          setFitToContentModeActive(false);
        }
        const deltaModeFactor =
          event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? Math.max(1, viewport.clientHeight)
              : 1;
        const zoomFactor = Math.exp(-event.deltaY * deltaModeFactor * zoomSpeed);
        const nextScale = clamp(currentTransform.scale * zoomFactor, MIN_SCALE, MAX_SCALE);
        const svgPoint = viewportToSvgPoint(viewportPoint, currentTransform, currentSvg.viewBox);
        const translateX = viewportPoint.x - (svgPoint.x - currentSvg.viewBox.x) * nextScale;
        const translateY = viewportPoint.y - (svgPoint.y - currentSvg.viewBox.y) * nextScale;

        dispatchTransformRef.current({ translateX, translateY, scale: nextScale });
        return;
      }

      dispatchTransformRef.current({
        translateX: currentTransform.translateX - event.deltaX,
        translateY: currentTransform.translateY - event.deltaY,
        scale: currentTransform.scale
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (touchEventPinchActive) {
        stopPinchEvent(event);
        return;
      }
      if (event.pointerType !== "touch") {
        return;
      }
      const point = clientPoint(px(event.clientX), px(event.clientY));
      activeTouchPointers.set(event.pointerId, point);
      touchStartPointers.set(event.pointerId, { point, time: event.timeStamp });
      if (activeTouchPointers.size < 2) {
        return;
      }
      claimViewportPinch(event);
      beginPointerPinchGesture();
      updatePointerPinchGesture();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (touchEventPinchActive) {
        stopPinchEvent(event);
        return;
      }
      if (event.pointerType !== "touch" || !activeTouchPointers.has(event.pointerId)) {
        return;
      }
      activeTouchPointers.set(event.pointerId, clientPoint(px(event.clientX), px(event.clientY)));
      if (!pinchGesture) {
        if (suppressTapUntilTouchesEnd) {
          stopPinchEvent(event);
        }
        return;
      }
      updatePointerPinchGesture();
      stopPinchEvent(event);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (touchEventPinchActive) {
        stopPinchEvent(event);
        return;
      }
      if (event.pointerType !== "touch" || !activeTouchPointers.has(event.pointerId)) {
        return;
      }
      const start = touchStartPointers.get(event.pointerId) ?? null;
      const current = activeTouchPointers.get(event.pointerId) ?? null;
      const isTap =
        !suppressTapUntilTouchesEnd &&
        activeTouchPointers.size === 1 &&
        start != null &&
        current != null &&
        Math.hypot(current.x - start.point.x, current.y - start.point.y) <= 12 &&
        event.timeStamp - start.time <= 320;
      if (isTap) {
        if (
          lastTouchTap &&
          event.timeStamp - lastTouchTap.time <= 360 &&
          Math.hypot(current.x - lastTouchTap.point.x, current.y - lastTouchTap.point.y) <= 48
        ) {
          requestFitToContent();
          lastTouchTap = null;
          stopPinchEvent(event);
        } else {
          lastTouchTap = { point: current, time: event.timeStamp };
        }
      }

      const wasPinching = pinchGesture != null || suppressTapUntilTouchesEnd;
      activeTouchPointers.delete(event.pointerId);
      touchStartPointers.delete(event.pointerId);
      if (activeTouchPointers.size >= 2) {
        beginPointerPinchGesture();
        if (wasPinching) {
          stopPinchEvent(event);
        }
        return;
      }
      if (activeTouchPointers.size === 0) {
        suppressTapUntilTouchesEnd = false;
      }
      pinchGesture = null;
      if (wasPinching) {
        stopPinchEvent(event);
      }
    };

    const touchPointById = (touches: TouchList, id: number): ClientPoint | null => {
      for (let index = 0; index < touches.length; index += 1) {
        const touch = touches.item(index);
        if (touch?.identifier === id) {
          return clientPoint(px(touch.clientX), px(touch.clientY));
        }
      }
      return null;
    };

    const viewportTouchPair = (touches: TouchList): [number, number] | null => {
      const rect = viewport.getBoundingClientRect();
      const ids: number[] = [];
      for (let index = 0; index < touches.length; index += 1) {
        const touch = touches.item(index);
        if (
          touch &&
          touch.clientX >= rect.left &&
          touch.clientX <= rect.right &&
          touch.clientY >= rect.top &&
          touch.clientY <= rect.bottom
        ) {
          ids.push(touch.identifier);
        }
      }
      const [first, second] = ids;
      return first === undefined || second === undefined ? null : [first, second];
    };

    const beginTouchEventPinch = (event: TouchEvent): boolean => {
      // Fingers on a layer over the whole editor (the in-app presentation)
      // are that layer's, even where they are over the canvas.
      if ((event.target instanceof Element ? event.target : null)?.closest("[data-owns-touches]")) {
        return false;
      }
      const ids = viewportTouchPair(event.touches);
      if (!ids) {
        return false;
      }
      const first = touchPointById(event.touches, ids[0]);
      const second = touchPointById(event.touches, ids[1]);
      if (!first || !second) {
        return false;
      }
      touchEventPinchActive = true;
      touchEventPinchIds = ids;
      activeTouchPointers.clear();
      touchStartPointers.clear();
      claimViewportPinch(event);
      beginPinchGestureFromPoints(first, second);
      updatePinchGestureFromPoints(first, second);
      return true;
    };

    const updateTouchEventPinch = (event: TouchEvent): boolean => {
      if (!touchEventPinchActive || !touchEventPinchIds) {
        return beginTouchEventPinch(event);
      }
      const first = touchPointById(event.touches, touchEventPinchIds[0]);
      const second = touchPointById(event.touches, touchEventPinchIds[1]);
      if (!first || !second) {
        pinchGesture = null;
        const ids = viewportTouchPair(event.touches);
        if (ids) {
          touchEventPinchIds = ids;
          return updateTouchEventPinch(event);
        }
        if (event.touches.length === 0) {
          touchEventPinchActive = false;
          touchEventPinchIds = null;
          suppressTapUntilTouchesEnd = false;
        }
        stopPinchEvent(event);
        return true;
      }
      updatePinchGestureFromPoints(first, second);
      stopPinchEvent(event);
      return true;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (touchEventPinchActive || event.touches.length >= 2) {
        updateTouchEventPinch(event);
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (touchEventPinchActive || event.touches.length >= 2) {
        updateTouchEventPinch(event);
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!touchEventPinchActive) {
        return;
      }
      updateTouchEventPinch(event);
    };
    const clearTouchGesture = () => {
      activeTouchPointers.clear();
      touchStartPointers.clear();
      touchEventPinchActive = false;
      touchEventPinchIds = null;
      suppressTapUntilTouchesEnd = false;
      lastTouchTap = null;
      pinchGesture = null;
      clearPendingTouchViewport();
    };
    const onPointerCancel = (event: PointerEvent) => {
      // WebKit cancels the pointers once a touch-event pinch claims them;
      // that pinch ends through touchend/touchcancel instead.
      if (touchEventPinchActive) {
        stopPinchEvent(event);
        return;
      }
      if (activeTouchPointers.has(event.pointerId)) clearTouchGesture();
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("pointerdown", onPointerDown, { capture: true, passive: false });
    window.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onPointerUp, { capture: true, passive: false });
    window.addEventListener("pointercancel", onPointerCancel, { capture: true, passive: false });
    window.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
    window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    window.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    window.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: false });
    window.addEventListener("blur", clearTouchGesture);

    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerup", onPointerUp, { capture: true });
      window.removeEventListener("pointercancel", onPointerCancel, { capture: true });
      window.removeEventListener("touchstart", onTouchStart, { capture: true });
      window.removeEventListener("touchmove", onTouchMove, { capture: true });
      window.removeEventListener("touchend", onTouchEnd, { capture: true });
      window.removeEventListener("touchcancel", onTouchEnd, { capture: true });
      window.removeEventListener("blur", clearTouchGesture);
      clearTouchGesture();
    };
  }, [
    MAX_SCALE,
    MIN_SCALE,
    canvasTransformRef,
    args.canvasContextKey,
    dragRef,
    fitToContentModeActiveRef,
    pendingTouchViewportRef,
    requestFitToContent,
    setDragState,
    setFitToContentModeActive,
    svgResultRef,
    suppressNextBackgroundClickRef,
    interactionViewport,
    zoomSpeed
  ]);
}

function midpointLocal(
  first: ClientPoint,
  second: ClientPoint,
  viewport: HTMLDivElement
): ViewportPoint {
  const rect = viewport.getBoundingClientRect();
  return makeViewportPoint(
    px((first.x + second.x) / 2 - rect.left),
    px((first.y + second.y) / 2 - rect.top)
  );
}

function touchDistance(
  first: ClientPoint,
  second: ClientPoint
): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
