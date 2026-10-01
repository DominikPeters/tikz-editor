import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "../store/store";
import type { PropertyCleanupRequest, PropertyCleanupResponse } from "./workers/property-cleanup.worker";

export type SchedulePropertyCleanup = (source: string, elementIds: string[], historyMergeKey: string) => void;

/** One worker for inspector and canvas edits; late replies never own the document. */
export function useDeferredPropertyCleanup(): void {
  const { documentId, source, sourceRevision, activeRootId, request, busy, dispatch } = useEditorStore(useShallow(state => ({
    documentId: state.activeDocumentId, source: state.source, sourceRevision: state.sourceRevision,
    activeRootId: state.activeRootId, request: state.documents[state.activeDocumentId]?.pendingPropertyCleanup,
    busy: state.activeCanvasDragKind != null || state.activeSourceScrubSourceId != null || state.activeInspectorEditDocumentId != null,
    dispatch: state.dispatch
  })));
  const consumedRequest = useRef<typeof request>(undefined);
  const workerRef = useRef<Worker | null>(null);
  const nextRequestId = useRef(0);
  useEffect(() => () => { workerRef.current?.terminate(); }, []);
  useEffect(() => {
    if (!request || busy || consumedRequest.current === request) return;
    consumedRequest.current = request;
    if (request.source !== source || request.sourceRevision !== sourceRevision) return;
    let worker: Worker;
    try {
      worker = workerRef.current ?? new Worker(new URL("./workers/property-cleanup.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
    } catch {
      return;
    }
    const requestId = ++nextRequestId.current;
    let active = true;
    worker.onerror = () => { worker.terminate(); workerRef.current = null; };
    worker.onmessage = ({ data: response }: MessageEvent<PropertyCleanupResponse>) => {
      if (!active || response.requestId !== requestId) return;
      const result = response.result;
      const latest = useEditorStore.getState();
      if (latest.activeDocumentId !== documentId || latest.activeRootId !== activeRootId ||
        latest.activeCanvasDragKind || latest.activeSourceScrubSourceId || latest.activeInspectorEditDocumentId ||
        !result || (result.kind !== "success" && result.kind !== "partial")) return;
      dispatch({
        type: "APPLY_EDIT_ACTION", documentId,
        action: { kind: "cleanupPropertyWrites", elementIds: request.elementIds },
        historyMergeKey: request.historyMergeKey,
        expectedDocumentRevision: { documentId, sourceRevision },
        precomputedSource: source, precomputedResult: result
      });
    };
    const message: PropertyCleanupRequest = { ...request, requestId };
    worker.postMessage(message);
    return () => { active = false; };
  }, [request, documentId, source, sourceRevision, activeRootId, busy, dispatch]);
}
