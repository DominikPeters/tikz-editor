import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { collectGeometryInvalidation } from "tikz-editor/semantic/index";
import type { SceneElement } from "tikz-editor/semantic/types";

import type { CanvasDragKind } from "../../store/types";
import { recordDragPatchModeFullReason } from "./drag-patch-mode-debug";
import type { CanvasSnapshot } from "./types";

export type UseCanvasSvgPatchInvalidationArgs = {
  activeCanvasDragKind: CanvasDragKind | null;
  dragPatchMode: "partial" | "full";
  setDragPatchMode: Dispatch<SetStateAction<"partial" | "full">>;
  lastEditChangeToken: number;
  lastEditChangedSourceIds: readonly string[] | null;
  selectedElementIds: ReadonlySet<string>;
  snapshot: CanvasSnapshot;
};

export function useCanvasSvgPatchInvalidation({
  activeCanvasDragKind,
  dragPatchMode,
  setDragPatchMode,
  lastEditChangeToken,
  lastEditChangedSourceIds,
  selectedElementIds,
  snapshot
}: UseCanvasSvgPatchInvalidationArgs): string[] | null {
  const [dragAffectedSourceIds, setDragAffectedSourceIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (activeCanvasDragKind) {
      return;
    }
    setDragPatchMode("partial");
    setDragAffectedSourceIds(null);
  }, [activeCanvasDragKind, setDragPatchMode]);

  useEffect(() => {
    if (!activeCanvasDragKind || dragPatchMode === "full") {
      return;
    }
    if (
      activeCanvasDragKind === "element" &&
      [...selectedElementIds].some((sourceId) =>
        snapshot.editHandles.some(
          (handle) =>
            handle.sourceRef.sourceId === sourceId &&
            handle.kind === "node-position" &&
            handle.pathAttachmentContext != null
        )
      )
    ) {
      recordDragPatchModeFullReason("path-attached-node", {
        activeCanvasDragKind,
        selectedSourceIds: [...selectedElementIds]
      });
      setDragPatchMode("full");
      setDragAffectedSourceIds(null);
      return;
    }
    const dependencies = snapshot.semanticResult?.dependencies;
    if (!dependencies) {
      return;
    }
    const changedSourceIds = lastEditChangedSourceIds;
    if (!changedSourceIds || changedSourceIds.length === 0) {
      setDragAffectedSourceIds(null);
      return;
    }

    const matrixDescendantSourceIds = collectMatrixDescendantSourceIdsForChangedSources(
      snapshot.scene?.elements ?? [],
      changedSourceIds
    );
    const changedSourceIdsForInvalidation =
      matrixDescendantSourceIds.length > 0
        ? [...new Set([...changedSourceIds, ...matrixDescendantSourceIds])]
        : changedSourceIds;
    const invalidation = collectGeometryInvalidation(dependencies, {
      changedSourceIds: changedSourceIdsForInvalidation
    });
    if (invalidation.reachedOpaque) {
      recordDragPatchModeFullReason("opaque-invalidation", {
        activeCanvasDragKind,
        changedSourceIds,
        changedSourceIdsForInvalidation
      });
      setDragPatchMode("full");
      setDragAffectedSourceIds(null);
      return;
    }
    const affectedSourceIds = mergeSourceIdLists(
      mergeSourceIdLists(
        invalidation.affectedSourceIds,
        matrixDescendantSourceIds
      ),
      [...selectedElementIds]
    );
    setDragAffectedSourceIds(affectedSourceIds.length > 0 ? affectedSourceIds : null);
  }, [
    activeCanvasDragKind,
    dragPatchMode,
    lastEditChangeToken,
    lastEditChangedSourceIds,
    selectedElementIds,
    setDragPatchMode,
    snapshot.editHandles,
    snapshot.scene,
    snapshot.semanticResult
  ]);

  return dragAffectedSourceIds;
}

function collectMatrixDescendantSourceIdsForChangedSources(
  elements: readonly SceneElement[],
  changedSourceIds: readonly string[]
): string[] {
  if (elements.length === 0 || changedSourceIds.length === 0) {
    return [];
  }
  const changed = new Set(changedSourceIds);
  const descendantSourceIds = new Set<string>();
  for (const element of elements) {
    const matrixSourceId = element.matrixCell?.matrixSourceId?.trim();
    if (!matrixSourceId || !changed.has(matrixSourceId)) {
      continue;
    }
    descendantSourceIds.add(element.sourceRef.sourceId);
    const cellSourceId = element.matrixCell?.cellSourceId?.trim();
    if (cellSourceId) {
      descendantSourceIds.add(cellSourceId);
    }
  }
  return [...descendantSourceIds];
}

function mergeSourceIdLists(left: readonly string[], right: readonly string[]): string[] {
  if (left.length === 0) {
    return [...right];
  }
  if (right.length === 0) {
    return [...left];
  }
  return [...new Set([...left, ...right])];
}
