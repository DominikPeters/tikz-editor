import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

import type { ToolMode } from "../../store/types";
import { beginDocumentEdit, canContinueDocumentEdit, restoreDocumentEdit, trackDocumentEdit, type DocumentEditSession } from "../../edit-session";
import { useEditorStore } from "../../store/store";
import { composeSourcePatches } from "@tikz-editor/core/edit/source-patches";
import { resolveBucketFillEdit, type BucketFillEditResolution } from "./bucket-fill";
import type { CanvasDispatch, CanvasSnapshot } from "./types";

export type BucketPreviewSession = {
  edit: DocumentEditSession;
  sourceId: string;
  colorToken: string;
  snapshot: CanvasSnapshot;
  result: Extract<BucketFillEditResolution, { kind: "ready" }>["result"];
};

export type UseBucketFillPreviewArgs = {
  toolMode: ToolMode;
  hoveredElementId: string | null;
  bucketFillColor: string;
  source: string;
  snapshot: CanvasSnapshot;
  activeDocumentId: string;
  activeRootId: string | null;
  dispatch: CanvasDispatch;
  bucketPreviewSessionRef: MutableRefObject<BucketPreviewSession | null>;
};

export function useBucketFillPreview({
  toolMode, hoveredElementId, bucketFillColor, source, snapshot,
  activeDocumentId, activeRootId, dispatch, bucketPreviewSessionRef
}: UseBucketFillPreviewArgs): { commitFill: (sourceId: string) => BucketFillEditResolution } {
  // An intervening edit cancels this hover. Require a new hover before starting
  // another preview, even if rendering catches up or the source text returns.
  const cancelledHoverRef = useRef<string | null>(null);
  const hoverKey = JSON.stringify([activeDocumentId, activeRootId, hoveredElementId]);
  const restore = useCallback((current: BucketPreviewSession) =>
    restoreDocumentEdit(current.edit, useEditorStore.getState, dispatch, current.result), [dispatch]);

  useEffect(() => {
    let current = bucketPreviewSessionRef.current;
    if (current && (current.edit.documentId !== activeDocumentId || current.edit.activeRootId !== activeRootId)) {
      bucketPreviewSessionRef.current = null;
      restore(current);
      cancelledHoverRef.current = hoveredElementId ? hoverKey : null;
      return;
    }
    if (current && !canContinueDocumentEdit(current.edit, useEditorStore.getState())) {
      bucketPreviewSessionRef.current = null;
      cancelledHoverRef.current = hoverKey;
      return;
    }
    if (toolMode !== "addBucket" || !hoveredElementId) {
      bucketPreviewSessionRef.current = null;
      if (current) restore(current);
      cancelledHoverRef.current = null;
      return;
    }
    if (cancelledHoverRef.current === hoverKey) return;
    cancelledHoverRef.current = null;
    if (current?.sourceId === hoveredElementId && current.colorToken === bucketFillColor) return;

    const state = useEditorStore.getState();
    if (!current && (state.activeDocumentId !== activeDocumentId || state.activeRootId !== activeRootId ||
      state.source !== source || snapshot.source !== source)) return;
    const baseSource = current?.edit.baseSource ?? source;
    const baseSnapshot = current?.snapshot ?? snapshot;
    const resolution = resolveBucketFillEdit({
      sourceId: hoveredElementId, colorToken: bucketFillColor, source: baseSource,
      elements: baseSnapshot.scene?.elements ?? [], editHandles: baseSnapshot.editHandles,
      activeRootId, figureCount: baseSnapshot.figures.length, propertyWriteMode: "preview"
    });
    if (resolution.kind !== "ready") {
      bucketPreviewSessionRef.current = null;
      if (current) restore(current);
      return;
    }

    const patches = current ? composeSourcePatches(current.edit.latestSource, [
      current.result.patches.map(patch => ({ oldSpan: patch.newSpan, newSpan: patch.oldSpan,
        replacement: baseSource.slice(patch.oldSpan.from, patch.oldSpan.to) })),
      resolution.result.patches
    ]) : resolution.result.patches;
    const edit = current?.edit ?? beginDocumentEdit(useEditorStore.getState());
    edit.changedSourceIds = [...new Set([...(edit.changedSourceIds ?? []), ...(resolution.result.changedSourceIds ?? [hoveredElementId])])];
    current = { edit, sourceId: hoveredElementId, colorToken: bucketFillColor, snapshot: baseSnapshot, result: resolution.result };
    bucketPreviewSessionRef.current = current;
    dispatch({
      type: "SET_SOURCE_TRANSIENT", documentId: edit.documentId,
      source: resolution.result.newSource, expectedSource: edit.latestSource, expectedSourceRevision: edit.latestRevision,
      changedSourceIds: edit.changedSourceIds, patches
    });
    trackDocumentEdit(edit, useEditorStore.getState());
  }, [activeDocumentId, activeRootId, bucketFillColor, bucketPreviewSessionRef, dispatch,
    hoverKey, hoveredElementId, restore, snapshot, source, toolMode]);

  useEffect(() => () => {
    const current = bucketPreviewSessionRef.current;
    bucketPreviewSessionRef.current = null;
    if (current) restore(current);
  }, [bucketPreviewSessionRef, restore]);

  const commitFill = useCallback((sourceId: string): BucketFillEditResolution => {
    const current = bucketPreviewSessionRef.current;
    const state = useEditorStore.getState();
    if (cancelledHoverRef.current === JSON.stringify([activeDocumentId, activeRootId, sourceId]) ||
      state.activeDocumentId !== activeDocumentId || state.activeRootId !== activeRootId ||
      (current && !canContinueDocumentEdit(current.edit, state))) {
      bucketPreviewSessionRef.current = null;
      if (current) restore(current);
      return { kind: "noop", reason: "The figure changed during the preview. Move the pointer away and try again." };
    }
    if (!current && (state.source !== source || snapshot.source !== source)) {
      return { kind: "noop", reason: "The figure is still catching up with the source edit." };
    }
    const baseSource = current?.edit.baseSource ?? source;
    const baseSnapshot = current?.snapshot ?? snapshot;
    const resolution = resolveBucketFillEdit({
      sourceId, colorToken: bucketFillColor, source: baseSource,
      elements: baseSnapshot.scene?.elements ?? [], editHandles: baseSnapshot.editHandles,
      activeRootId, figureCount: baseSnapshot.figures.length, propertyWriteMode: "commit"
    });
    bucketPreviewSessionRef.current = null;
    if (current && !restore(current)) return { kind: "noop", reason: "The figure changed during the preview." };
    if (resolution.kind !== "ready") return resolution;
    const latest = useEditorStore.getState();
    dispatch({
      type: "APPLY_EDIT_ACTION", documentId: activeDocumentId,
      expectedDocumentRevision: { documentId: activeDocumentId, sourceRevision: latest.sourceRevision },
      precomputedSource: baseSource, precomputedResult: resolution.result, action: resolution.action
    });
    return resolution;
  }, [activeDocumentId, activeRootId, bucketFillColor, bucketPreviewSessionRef, dispatch, restore, snapshot, source]);

  return { commitFill };
}
