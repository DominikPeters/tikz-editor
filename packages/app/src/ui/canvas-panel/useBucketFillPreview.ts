import { useEffect, type MutableRefObject } from "react";

import type { ToolMode } from "../../store/types";
import { resolveBucketFillEdit } from "./bucket-fill";
import type { CanvasDispatch, CanvasSnapshot } from "./types";

export type BucketPreviewSession = {
  documentId: string;
  figureId: string | null;
  sourceId: string;
  colorToken: string;
  baseSource: string;
  previewSource: string;
};

export type UseBucketFillPreviewArgs = {
  toolMode: ToolMode;
  hoveredElementId: string | null;
  bucketFillColor: string;
  source: string;
  snapshot: CanvasSnapshot;
  activeDocumentId: string;
  activeFigureId: string | null;
  dispatch: CanvasDispatch;
  bucketPreviewSessionRef: MutableRefObject<BucketPreviewSession | null>;
};

export function useBucketFillPreview({
  toolMode,
  hoveredElementId,
  bucketFillColor,
  source,
  snapshot,
  activeDocumentId,
  activeFigureId,
  dispatch,
  bucketPreviewSessionRef
}: UseBucketFillPreviewArgs): void {
  useEffect(() => {
    const current = bucketPreviewSessionRef.current;
    if (
      current &&
      (current.documentId !== activeDocumentId || current.figureId !== activeFigureId)
    ) {
      dispatch({
        type: "SET_SOURCE_TRANSIENT",
        documentId: current.documentId,
        source: current.baseSource,
        changedSourceIds: [current.sourceId]
      });
      bucketPreviewSessionRef.current = null;
      return;
    }
    if (toolMode !== "addBucket" || !hoveredElementId) {
      if (current && source !== current.baseSource) {
        dispatch({
          type: "SET_SOURCE_TRANSIENT",
          documentId: current.documentId,
          source: current.baseSource,
          changedSourceIds: [current.sourceId]
        });
      }
      bucketPreviewSessionRef.current = null;
      return;
    }

    const baseSource = current?.baseSource ?? source;
    const resolution = resolveBucketFillEdit({
      sourceId: hoveredElementId,
      colorToken: bucketFillColor,
      source: baseSource,
      elements: snapshot.scene?.elements ?? [],
      editHandles: snapshot.editHandles,
      activeFigureId,
      figureCount: snapshot.figures.length,
      propertyWriteMode: "preview"
    });

    if (resolution.kind !== "ready") {
      if (current && source !== current.baseSource) {
        dispatch({
          type: "SET_SOURCE_TRANSIENT",
          documentId: current.documentId,
          source: current.baseSource,
          changedSourceIds: [current.sourceId]
        });
      }
      bucketPreviewSessionRef.current = null;
      return;
    }

    const nextPreviewSource = resolution.result.newSource;
    if (
      current?.sourceId === hoveredElementId &&
      current.colorToken === bucketFillColor &&
      current.previewSource === nextPreviewSource &&
      source === nextPreviewSource
    ) {
      return;
    }

    dispatch({
      type: "SET_SOURCE_TRANSIENT",
      source: nextPreviewSource,
      changedSourceIds: [hoveredElementId]
    });
    bucketPreviewSessionRef.current = {
      documentId: activeDocumentId,
      figureId: activeFigureId,
      sourceId: hoveredElementId,
      colorToken: bucketFillColor,
      baseSource,
      previewSource: nextPreviewSource
    };
  }, [
    activeDocumentId,
    activeFigureId,
    bucketFillColor,
    bucketPreviewSessionRef,
    dispatch,
    hoveredElementId,
    snapshot.editHandles,
    snapshot.figures.length,
    snapshot.scene,
    source,
    toolMode
  ]);
}
