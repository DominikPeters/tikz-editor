import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { computeSnapshot, makeEmptySnapshot, type ComputeRequest, type ComputeResponse } from "../compute";
import { createSingleFlightScheduler } from "../ui/compute-scheduler";
import { computeTrigger } from "../ui/compute-trigger";
import { useEditorStore } from "../store/store";

// Minimal compute driver for embedded editors. Single-flights renders so that
// rapid-fire demo edits don't race. No typing debounce or prewarm — demos
// dispatch EditActions in bursts, not through a code editor.
//
// Kept in one effect so the scheduler and the initial schedule land together;
// under StrictMode a split-effect version would dispose the scheduler that
// received the first-render request.
export function useEmbedComputeDriver(): void {
  const {
    source,
    activeFigureId,
    activeDocumentId,
    snapshotSource,
    hasSvg,
    snapshotActiveFigureId,
    activeCanvasDragKind,
    lastEditChangedSourceIds,
    lastEditPatches,
    dispatch
  } = useEditorStore(
    useShallow((s) => ({
      source: s.source,
      activeFigureId: s.activeFigureId,
      activeDocumentId: s.activeDocumentId,
      snapshotSource: s.snapshot.source,
      hasSvg: Boolean(s.snapshot.svg),
      snapshotActiveFigureId: s.snapshot.activeFigureId,
      activeCanvasDragKind: s.activeCanvasDragKind,
      lastEditChangedSourceIds: s.lastEditChangedSourceIds,
      lastEditPatches: s.lastEditPatches,
      dispatch: s.dispatch
    }))
  );

  useEffect(() => {
    const trigger = computeTrigger(activeCanvasDragKind, null);
    const changedSourceIds = lastEditChangedSourceIds;
    const scheduler = createSingleFlightScheduler<ComputeRequest, ComputeResponse>({
      run: (request) => computeSnapshot(request),
      onStart: (request) => {
        dispatch({ type: "COMPUTE_REQUESTED", requestId: request.id, documentId: request.documentId });
      },
      onSuccess: (_request, response) => {
        dispatch({
          type: "SNAPSHOT_READY",
          requestId: response.id,
          snapshot: response.snapshot,
          documentId: response.documentId
        });
      },
      onError: (request, error) => {
        console.error("[embed compute] error:", error);
        dispatch({
          type: "SNAPSHOT_READY",
          requestId: request.id,
          snapshot: makeEmptySnapshot(request.source),
          documentId: request.documentId
        });
      }
    });

    // Schedule when source changed, when we've never produced any SVG, or
    // when figure selection changed after a parse-only snapshot. That final
    // case happens on first load: compute returns figure ids with no active
    // scene, reducer auto-selects the first figure, then we need one more
    // compute to materialize scene/svg for that active figure.
    if (snapshotSource !== source || !hasSvg || snapshotActiveFigureId !== activeFigureId) {
      scheduler.schedule({
        id: crypto.randomUUID(),
        documentId: activeDocumentId,
        kind: "render",
        source,
        activeFigureId,
        changedSourceIds,
        patches: lastEditPatches ? [...lastEditPatches] : null,
        trigger
      });
    }

    return () => {
      scheduler.dispose();
    };
  }, [
    dispatch,
    source,
    snapshotSource,
    hasSvg,
    snapshotActiveFigureId,
    activeDocumentId,
    activeFigureId,
    activeCanvasDragKind,
    lastEditChangedSourceIds,
    lastEditPatches
  ]);
}
