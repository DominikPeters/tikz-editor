import { useEffect, useRef } from "react";
import { worldToClientPoint } from "../ui/canvas-panel/geometry";
import type { EditorStoreApi } from "../store/store";
import {
  resolveCursorAt,
  validateDemoScript,
  type CursorFrameState,
  type DemoEvent,
  type DemoScript,
  type PointerModifiers
} from "./demo-script";

const HIDDEN_CURSOR: CursorFrameState = { x: 0, y: 0, visible: false, pressed: false, cursor: "pointer" };
const INTERACTION_SELECTOR = '[data-testid="canvas-interaction-layer"]';

// Each demo instance gets a unique pointer ID to prevent interference when
// multiple demos run simultaneously (e.g., in a gallery view).
let nextSyntheticPointerId = 424242;
function allocateSyntheticPointerId(): number {
  return nextSyntheticPointerId++;
}

export type UseDemoPlayerOptions = {
  store: EditorStoreApi | null;
  script: DemoScript;
  onCursor: (state: CursorFrameState) => void;
  // When provided, playback pauses whenever the element's visibility ratio
  // falls below 0.1. The same element is queried for the canvas interaction
  // layer used to dispatch synthetic pointer events.
  viewportEl?: Element | null;
};

type PointerRuntime = {
  down: boolean;
  lastX: number;
  lastY: number;
};

function findInteractionSvg(container: Element | null | undefined): SVGSVGElement | null {
  const root = container ?? document;
  return root.querySelector(INTERACTION_SELECTOR) as SVGSVGElement | null;
}

function readViewBox(svg: SVGSVGElement): { x: number; y: number; width: number; height: number } {
  const vb = svg.viewBox.baseVal;
  return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
}

function pointerEventInit(
  clientX: number,
  clientY: number,
  pointerId: number,
  modifiers?: PointerModifiers
): PointerEventInit {
  return {
    clientX,
    clientY,
    pointerId,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 1,
    bubbles: true,
    cancelable: true,
    composed: true,
    ctrlKey: modifiers?.ctrl ?? false,
    shiftKey: modifiers?.shift ?? false,
    altKey: modifiers?.alt ?? false,
    metaKey: modifiers?.meta ?? false
  };
}

function dispatchSyntheticPointer(
  kind: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  worldX: number,
  worldY: number,
  container: Element | null | undefined,
  pointerId: number,
  modifiers?: PointerModifiers
): boolean {
  const svg = findInteractionSvg(container);
  if (!svg) return false;
  const client = worldToClientPoint(worldX, worldY, svg, readViewBox(svg));
  if (!client) return false;
  const init = pointerEventInit(client.clientX, client.clientY, pointerId, modifiers);
  // pointerdown should hit the real element under the cursor so select-mode
  // gestures can target scene elements (instead of always hitting background).
  // move/up go through the window because drag listeners are attached there.
  if (kind === "pointerdown") {
    const target = document.elementFromPoint(client.clientX, client.clientY) ?? svg;
    target.dispatchEvent(new PointerEvent("pointerdown", init));
  } else {
    window.dispatchEvent(new PointerEvent(kind, { ...init, buttons: kind === "pointermove" ? 1 : 0 }));
  }
  return true;
}

// rAF-driven demo runner. Single source of truth: `performance.now()` - startTime.
// Pause on tab-hidden and off-screen; resume without time skew.
export function useDemoPlayer({ store, script, onCursor, viewportEl }: UseDemoPlayerOptions): void {
  const stateRef = useRef({
    running: false,
    startTime: 0,
    pausedElapsed: 0,
    nextEventIndex: 0,
    raf: 0 as number,
    onCursor,
    script,
    store,
    viewportEl: viewportEl ?? null,
    pointer: { down: false, lastX: 0, lastY: 0 } as PointerRuntime,
    pointerId: allocateSyntheticPointerId()
  });
  stateRef.current.onCursor = onCursor;
  stateRef.current.script = script;
  stateRef.current.store = store;
  stateRef.current.viewportEl = viewportEl ?? null;

  useEffect(() => {
    if (!store) {
      return;
    }
    validateDemoScript(script);
    const local = stateRef.current;

    const cancelActivePointer = (): void => {
      if (!local.pointer.down) return;
      dispatchSyntheticPointer("pointercancel", local.pointer.lastX, local.pointer.lastY, local.viewportEl, local.pointerId);
      local.pointer.down = false;
    };

    const applyEvent = (event: DemoEvent): void => {
      const api = local.store;
      if (!api) return;
      switch (event.kind) {
        case "dispatch":
          api.getState().dispatch({ type: "APPLY_EDIT_ACTION", action: event.action });
          return;
        case "storeAction":
          api.getState().dispatch(event.action);
          return;
        case "loadSource":
          api.getState().dispatch({ type: "CODE_EDITED", source: event.source });
          return;
        case "pointerDown":
          local.pointer.down = true;
          local.pointer.lastX = event.x;
          local.pointer.lastY = event.y;
          dispatchSyntheticPointer("pointerdown", event.x, event.y, local.viewportEl, local.pointerId, event.modifiers);
          return;
        case "pointerMove":
          local.pointer.lastX = event.x;
          local.pointer.lastY = event.y;
          dispatchSyntheticPointer("pointermove", event.x, event.y, local.viewportEl, local.pointerId);
          return;
        case "pointerUp":
          if (local.pointer.down) {
            dispatchSyntheticPointer("pointerup", local.pointer.lastX, local.pointer.lastY, local.viewportEl, local.pointerId);
            local.pointer.down = false;
          }
          return;
        case "pointerCancel":
          cancelActivePointer();
          return;
      }
    };

    const reset = (nowPerf: number): void => {
      cancelActivePointer();
      local.startTime = nowPerf;
      local.nextEventIndex = 0;
      applyEvent({ t: 0, kind: "loadSource", source: local.script.initialSource });
    };

    const tick = (): void => {
      if (!local.running) return;
      const nowPerf = performance.now();
      const elapsed = nowPerf - local.startTime;
      const { script: s } = local;

      if (elapsed >= s.duration) {
        reset(nowPerf);
      } else {
        while (
          local.nextEventIndex < s.events.length &&
          s.events[local.nextEventIndex]!.t <= elapsed
        ) {
          applyEvent(s.events[local.nextEventIndex]!);
          local.nextEventIndex += 1;
        }
      }

      const cursor = resolveCursorAt(s.cursor, Math.min(elapsed, s.duration));
      local.onCursor(cursor ?? HIDDEN_CURSOR);

      // Auto-emit pointermove while a synthetic drag is active, using the
      // interpolated cursor position. Keeps drag scripts terse: authors list
      // pointerDown + pointerUp and the cursor keyframes do the rest.
      if (local.pointer.down && cursor && cursor.visible) {
        if (cursor.x !== local.pointer.lastX || cursor.y !== local.pointer.lastY) {
          local.pointer.lastX = cursor.x;
          local.pointer.lastY = cursor.y;
          dispatchSyntheticPointer("pointermove", cursor.x, cursor.y, local.viewportEl, local.pointerId);
        }
      }

      local.raf = requestAnimationFrame(tick);
    };

    const start = (): void => {
      if (local.running) return;
      local.running = true;
      local.startTime = performance.now() - local.pausedElapsed;
      if (local.pausedElapsed === 0) {
        applyEvent({ t: 0, kind: "loadSource", source: local.script.initialSource });
      }
      local.raf = requestAnimationFrame(tick);
    };

    const pause = (): void => {
      if (!local.running) return;
      local.running = false;
      local.pausedElapsed = performance.now() - local.startTime;
      cancelAnimationFrame(local.raf);
      cancelActivePointer();
    };

    const onVisibility = (): void => {
      if (document.hidden) pause();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    let observer: IntersectionObserver | null = null;
    if (viewportEl) {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) return;
          if (entry.intersectionRatio >= 0.1) start();
          else pause();
        },
        { threshold: [0, 0.1, 0.5, 1] }
      );
      observer.observe(viewportEl);
    } else {
      start();
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
      cancelAnimationFrame(local.raf);
      cancelActivePointer();
      local.running = false;
      local.pausedElapsed = 0;
      local.nextEventIndex = 0;
    };
  }, [store, script, viewportEl]);
}
