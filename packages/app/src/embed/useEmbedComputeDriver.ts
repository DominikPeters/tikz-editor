import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { computeSnapshot, makeEmptySnapshot, type ComputeRequest, type ComputeResponse } from "../compute";
import { createSingleFlightScheduler, type SingleFlightScheduler } from "../ui/compute-scheduler";
import { useEditorStore } from "../store/store";

// Minimal compute driver for embedded editors. Single-flights renders so that
// rapid-fire demo edits don't race. No typing debounce or prewarm — demos
// dispatch EditActions in bursts, not through a code editor.
export function useEmbedComputeDriver(): void {
  const { source, activeFigureId, activeDocumentId, snapshotSource, dispatch } = useEditorStore(
    useShallow((s) => ({
      source: s.source,
      activeFigureId: s.activeFigureId,
      activeDocumentId: s.activeDocumentId,
      snapshotSource: s.snapshot.source,
      dispatch: s.dispatch
    }))
  );

  const schedulerRef = useRef<SingleFlightScheduler<ComputeRequest, ComputeResponse> | null>(null);

  useEffect(() => {
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
      onError: (request) => {
        dispatch({
          type: "SNAPSHOT_READY",
          requestId: request.id,
          snapshot: makeEmptySnapshot(request.source),
          documentId: request.documentId
        });
      }
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, [dispatch]);

  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!scheduler || snapshotSource === source) {
      return;
    }
    scheduler.schedule({
      id: crypto.randomUUID(),
      documentId: activeDocumentId,
      kind: "render",
      source,
      activeFigureId,
      changedSourceIds: null,
      patches: null,
      trigger: "other"
    });
  }, [activeDocumentId, activeFigureId, snapshotSource, source]);
}
