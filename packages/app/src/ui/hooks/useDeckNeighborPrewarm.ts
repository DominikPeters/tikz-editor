import { useEffect } from "react";
import { useEditorStore } from "../../store/store";
import { cancelDeckPrewarm, isDeckSnapshotCurrent, prewarmDeckNeighbors, type ComputeRequest } from "../../compute";
import { rootKey } from "../../root-key";
import { yieldToBrowser } from "../../yield-to-browser";

export function useDeckNeighborPrewarm(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let idle: number | null = null;
    let running: AbortController | null = null;
    let wanted: string | null = null;
    let completed: string | null = null;
    let quietUntil = 0;
    let pointerHeld = false;
    const keysHeld = new Set<string>();
    const cancel = () => {
      if (timer != null) clearTimeout(timer);
      if (idle != null) window.cancelIdleCallback(idle);
      timer = null; idle = null; wanted = null;
      running?.abort(); running = null; cancelDeckPrewarm();
    };
    const schedule = () => {
      const state = useEditorStore.getState(), doc = state.documents[state.activeDocumentId];
      if (pointerHeld || keysHeld.size || document.visibilityState !== "visible" ||
        state.documentKind !== "beamer" || state.pendingRequestId != null || state.activeCanvasDragKind != null ||
        state.activeSourceScrubSourceId != null || state.activeCanvasTextEditSourceId != null ||
        state.activeInspectorEditDocumentId != null || doc.assistantLockReason) { cancel(); return; }
      const request: ComputeRequest = { id: "idle-neighbors", documentId: doc.id, source: doc.source,
        sourceRevision: doc.sourceRevision, documentFileRef: doc.fileRef, activeRootId: doc.activeRootId,
        deckStep: state.deckStepByRootKey[rootKey(doc.id, doc.activeRootId)] ?? 1 };
      if (!isDeckSnapshotCurrent(state.snapshot, request)) { cancel(); return; }
      const quietWait = quietUntil - performance.now();
      if (quietWait > 0) { cancel(); timer = setTimeout(schedule, quietWait); return; }
      const key = JSON.stringify([doc.id, doc.sourceRevision, doc.activeRootId, request.deckStep, state.snapshot.deck?.cacheEpoch]);
      if (key === wanted || key === completed) return;
      cancel(); wanted = key;
      const run = () => {
        timer = null; idle = null;
        if (wanted !== key) return;
        const controller = new AbortController(); running = controller;
        void prewarmDeckNeighbors(request, { budgetMs: 4, signal: controller.signal, yieldControl: yieldToBrowser })
          .then(() => { if (!controller.signal.aborted && wanted === key) completed = key; })
          .catch(() => { /* Best effort: foreground rendering owns errors and UI. */ })
          .finally(() => { if (running === controller) running = null; });
      };
      // No timeout on idle callbacks: busy foreground work always wins. WebKit
      // fallback waits for quiet before beginning its cooperative batches.
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(run);
      else timer = setTimeout(run, 250);
    };
    const input = (event: Event) => {
      if (event.type === "pointerdown") pointerHeld = true;
      if (event instanceof KeyboardEvent) keysHeld.add(event.code);
      quietUntil = performance.now() + 250; cancel();
    };
    const release = (event: Event) => {
      if (event.type === "pointerup" || event.type === "pointercancel") pointerHeld = false;
      if (event instanceof KeyboardEvent) keysHeld.delete(event.code);
      quietUntil = performance.now() + 250; schedule();
    };
    const blur = () => { pointerHeld = false; keysHeld.clear(); cancel(); };
    for (const event of ["pointerdown", "keydown", "wheel"] as const) window.addEventListener(event, input, { capture: true, passive: true });
    for (const event of ["pointerup", "pointercancel", "keyup"] as const) window.addEventListener(event, release, { capture: false, passive: true });
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", schedule);
    const unsubscribe = useEditorStore.subscribe(schedule);
    schedule();
    return () => {
      unsubscribe(); cancel();
      for (const event of ["pointerdown", "keydown", "wheel"] as const) window.removeEventListener(event, input, true);
      for (const event of ["pointerup", "pointercancel", "keyup"] as const) window.removeEventListener(event, release, false);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, []);
}
