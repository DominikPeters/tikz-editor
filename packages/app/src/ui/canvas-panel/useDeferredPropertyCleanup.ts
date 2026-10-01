import { useCallback, useEffect, useState, useRef, type MutableRefObject } from "react";
import { maskSourceOutsideSpan } from "@tikz-editor/core/document/masking";
import { applySourcePatches } from "@tikz-editor/core/edit/source-patches";
import type { Span } from "@tikz-editor/core/ast/types";
import type { PropertyCleanupRequest, PropertyCleanupResponse } from "../workers/property-cleanup.worker";
import type { CanvasDispatch, DragState } from "./types";

export type SchedulePropertyCleanup = (source: string, elementIds: string[], historyMergeKey: string) => void;

/** Certify source simplifications off the UI thread, and discard stale results. */
export function useDeferredPropertyCleanup(input: {
  documentId: string;
  source: string;
  sourceRevision: number;
  activeFigureId?: string | null;
  nestedFigureSpan?: Span | null;
  dragRef: MutableRefObject<DragState | null>;
  dispatch: CanvasDispatch;
}): SchedulePropertyCleanup {
  const { documentId, source, sourceRevision, activeFigureId, nestedFigureSpan, dragRef, dispatch } = input;
  const [request, setRequest] = useState<{
    documentId: string; source: string; elementIds: string[]; historyMergeKey: string;
  } | null>(null);
  const schedule = useCallback<SchedulePropertyCleanup>((source, elementIds, historyMergeKey) => {
    setRequest({ documentId, source, elementIds, historyMergeKey });
  }, [documentId]);

  const consumedRequest = useRef<typeof request>(null);
  const workerRef = useRef<Worker | null>(null);
  const nextRequestId = useRef(0);
  useEffect(() => () => { workerRef.current?.terminate(); }, []);
  useEffect(() => {
    if (!request || consumedRequest.current === request) return;
    consumedRequest.current = request;
    if (request.source !== source || request.documentId !== documentId) return;
    let worker: Worker;
    try {
      worker = workerRef.current ?? new Worker(new URL("../workers/property-cleanup.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
    } catch {
      return;
    }
    const requestId = ++nextRequestId.current;
    let active = true;
    worker.onerror = () => { worker.terminate(); workerRef.current = null; };
    worker.onmessage = ({ data: response }: MessageEvent<PropertyCleanupResponse>) => {
      if (!active || response.requestId !== requestId) return;
      const data = response.result;
      if (dragRef.current || !data || (data.kind !== "success" && data.kind !== "partial")) return;
      const replay = applySourcePatches(source, data.patches);
      if (replay.kind !== "success" || replay.source === source) return;
      dispatch({
        type: "APPLY_EDIT_ACTION",
        action: { kind: "cleanupPropertyWrites", elementIds: request.elementIds },
        historyMergeKey: request.historyMergeKey,
        expectedDocumentRevision: { documentId, sourceRevision },
        precomputedSource: source,
        precomputedResult: { ...data, newSource: replay.source }
      });
    };
    const message: PropertyCleanupRequest = {
      requestId,
      source: nestedFigureSpan ? maskSourceOutsideSpan(source, nestedFigureSpan) : source,
      elementIds: request.elementIds, activeFigureId
    };
    worker.postMessage(message);
    return () => { active = false; };
  }, [request, documentId, source, sourceRevision, activeFigureId, nestedFigureSpan, dragRef, dispatch]);
  return schedule;
}
