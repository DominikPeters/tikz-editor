import { useEffect, useRef } from "react";
import type { EditorStoreApi } from "../store/store";
import {
  resolveCursorAt,
  validateDemoScript,
  type CursorFrameState,
  type DemoEvent,
  type DemoScript
} from "./demo-script";

const HIDDEN_CURSOR: CursorFrameState = { x: 0, y: 0, visible: false, pressed: false };

export type UseDemoPlayerOptions = {
  store: EditorStoreApi | null;
  script: DemoScript;
  onCursor: (state: CursorFrameState) => void;
  // When provided, playback pauses whenever the element's visibility ratio
  // falls below 0.1. The observer is attached once per element.
  viewportEl?: Element | null;
};

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
    store
  });
  stateRef.current.onCursor = onCursor;
  stateRef.current.script = script;
  stateRef.current.store = store;

  useEffect(() => {
    if (!store) {
      return;
    }
    validateDemoScript(script);
    const local = stateRef.current;

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
      }
    };

    const reset = (nowPerf: number): void => {
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
      local.running = false;
      local.pausedElapsed = 0;
      local.nextEventIndex = 0;
    };
  }, [store, script, viewportEl]);
}
