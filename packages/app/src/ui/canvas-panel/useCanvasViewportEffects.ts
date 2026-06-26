import { useEffect, useLayoutEffect, type MutableRefObject, type RefObject } from "react";
import { viewportPoint as makeViewportPoint, clientPoint, px } from "tikz-editor/coords/index";
import { clamp, distanceSquared, viewportToSvgPoint } from "./geometry";
import { resolveToolCreateCurrentWorld } from "./interaction-helpers";
import type { ClientPoint, SvgPoint, ViewportPoint, WorldPoint } from "../coords/types";
import type { CanvasTransform } from "../../store/types";
import type { CanvasSnapshot, DragState, PendingTouchViewport, SourceBoundsMap, StateSetter, ValueSetter } from "./types";
import type { ResizeFrame } from "./resize-frames";
import type { SvgViewBox } from "tikz-editor/svg/types";

export type UseCanvasViewportEffectsArgs = {
  dragRef: MutableRefObject<DragState | null>;
  pendingTouchViewportRef: MutableRefObject<PendingTouchViewport | null>;
  setDragState: ValueSetter<DragState | null>;
  setToolDraft: StateSetter<Extract<DragState, { kind: "tool-create" }> | null>;
  setToolCursorWorld: StateSetter<WorldPoint | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
  setViewportSize: StateSetter<{ width: number; height: number }>;
  canvasTransform: CanvasTransform;
  canvasTransformRef: MutableRefObject<CanvasTransform>;
  selectedElementIds: ReadonlySet<string>;
  selectedElementIdsRef: MutableRefObject<ReadonlySet<string>>;
  svgResult: CanvasSnapshot["svg"];
  svgResultRef: MutableRefObject<CanvasSnapshot["svg"]>;
  fitToContentModeActive: boolean;
  fitToContentModeActiveRef: MutableRefObject<boolean>;
  sourceBoundsSvg: SourceBoundsMap;
  sourceBoundsSvgRef: MutableRefObject<SourceBoundsMap>;
  resizeFramesBySource: ReadonlyMap<string, ResizeFrame | null>;
  liveResizeFramesRef: MutableRefObject<ReadonlyMap<string, ResizeFrame | null>>;
  previousViewBoxRef: MutableRefObject<SvgViewBox | null>;
  dispatchCanvasTransform: (transform: CanvasTransform) => void;
  zoomSpeed: number;
  MIN_SCALE: number;
  MAX_SCALE: number;
  setFitToContentModeActive: ValueSetter<boolean>;
};

export function useCanvasViewportEffects(args: UseCanvasViewportEffectsArgs) {
  const {
    dragRef,
    pendingTouchViewportRef,
    setDragState,
    setToolDraft,
    setToolCursorWorld,
    viewportRef,
    setViewportSize,
    canvasTransform,
    canvasTransformRef,
    selectedElementIds,
    selectedElementIdsRef,
    svgResult,
    svgResultRef,
    fitToContentModeActive,
    fitToContentModeActiveRef,
    sourceBoundsSvg,
    sourceBoundsSvgRef,
    resizeFramesBySource,
    liveResizeFramesRef,
    previousViewBoxRef,
    dispatchCanvasTransform,
    zoomSpeed,
    MIN_SCALE,
    MAX_SCALE,
    setFitToContentModeActive
  } = args;

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
    const viewport = viewportRef.current;
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
  }, [setViewportSize, viewportRef]);

  useLayoutEffect(() => {
    canvasTransformRef.current = canvasTransform;
  }, [canvasTransform, canvasTransformRef]);

  useEffect(() => {
    selectedElementIdsRef.current = selectedElementIds;
  }, [selectedElementIds, selectedElementIdsRef]);

  useEffect(() => {
    svgResultRef.current = svgResult;
  }, [svgResult, svgResultRef]);

  useLayoutEffect(() => {
    fitToContentModeActiveRef.current = fitToContentModeActive;
  }, [fitToContentModeActive, fitToContentModeActiveRef]);

  useEffect(() => {
    sourceBoundsSvgRef.current = sourceBoundsSvg;
  }, [sourceBoundsSvg, sourceBoundsSvgRef]);

  useEffect(() => {
    liveResizeFramesRef.current = resizeFramesBySource;
  }, [liveResizeFramesRef, resizeFramesBySource]);

  useLayoutEffect(() => {
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
  }, [canvasTransformRef, dispatchCanvasTransform, previousViewBoxRef, svgResult]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const activeTouchPointers = new Map<number, ClientPoint>();
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

    const touchPair = () => {
      const [first, second] = [...activeTouchPointers.values()];
      if (!first || !second) {
        return null;
      }
      return { first, second };
    };

    const beginPinchGesture = () => {
      const currentSvg = svgResultRef.current;
      const pair = touchPair();
      if (!currentSvg || !pair) {
        pinchGesture = null;
        return;
      }
      const center = midpointLocal(pair.first, pair.second, viewport);
      const distance = touchDistance(pair.first, pair.second);
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

    const updatePinchGesture = () => {
      const currentSvg = svgResultRef.current;
      const pair = touchPair();
      if (!currentSvg || !pair || !pinchGesture) {
        return;
      }
      const distance = touchDistance(pair.first, pair.second);
      if (!Number.isFinite(distance) || distance <= 0) {
        return;
      }
      const center = midpointLocal(pair.first, pair.second, viewport);
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

      dispatchCanvasTransform({ translateX, translateY, scale: nextScale });
    };

    const onWheel = (event: WheelEvent) => {
      const currentSvg = svgResultRef.current;
      if (!currentSvg) return;
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

        dispatchCanvasTransform({ translateX, translateY, scale: nextScale });
        return;
      }

      dispatchCanvasTransform({
        translateX: currentTransform.translateX - event.deltaX,
        translateY: currentTransform.translateY - event.deltaY,
        scale: currentTransform.scale
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") {
        return;
      }
      activeTouchPointers.set(event.pointerId, clientPoint(px(event.clientX), px(event.clientY)));
      if (activeTouchPointers.size < 2) {
        return;
      }
      clearPendingTouchViewport();
      if (dragRef.current?.kind === "pan" || dragRef.current?.kind === "marquee") {
        setDragState(null);
      }
      beginPinchGesture();
      updatePinchGesture();
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !activeTouchPointers.has(event.pointerId)) {
        return;
      }
      activeTouchPointers.set(event.pointerId, clientPoint(px(event.clientX), px(event.clientY)));
      if (!pinchGesture) {
        return;
      }
      updatePinchGesture();
      event.preventDefault();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !activeTouchPointers.has(event.pointerId)) {
        return;
      }
      activeTouchPointers.delete(event.pointerId);
      if (activeTouchPointers.size >= 2) {
        beginPinchGesture();
        return;
      }
      pinchGesture = null;
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("pointerdown", onPointerDown, { passive: false });
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerUp, { passive: false });

    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      activeTouchPointers.clear();
      pinchGesture = null;
    };
  }, [
    MAX_SCALE,
    MIN_SCALE,
    canvasTransformRef,
    dispatchCanvasTransform,
    dragRef,
    fitToContentModeActiveRef,
    pendingTouchViewportRef,
    setDragState,
    setFitToContentModeActive,
    svgResultRef,
    viewportRef,
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
