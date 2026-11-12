import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { beamerColumnResizePatches, beamerImageCropDrag, beamerImageCropPatches, beamerImageResizePatches, beamerSpacingResizePatches, type BeamerSpacingTarget, type BeamerColumnDivider, type BeamerFrameLayout, type BeamerImageCropHandle, type BeamerImageCropTarget, type BeamerImageResizeTarget } from "@tikz-editor/core/beamer/index";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import { beginDocumentEdit, canContinueDocumentEdit } from "../../edit-session";
import { useEditorStore } from "../../store/store";
import { requestedDeckStep } from "../../root-key";
import { usePatchDrag, type PatchDragSession } from "./usePatchDrag";
import { pointerTolerancePtForScale } from "../canvas-zoom";

export type DeckResizeTarget = { kind: "columns"; divider: BeamerColumnDivider }
  | { kind: "spacing"; spacing: BeamerSpacingTarget }
  | { kind: "image"; image: BeamerImageResizeTarget; corner: "nw" | "ne" | "sw" | "se" }
  | { kind: "crop"; crop: BeamerImageCropTarget; handle: BeamerImageCropHandle };
/** A slide drag: the handle, the overlay step it began on, and the image to reselect after reflow. */
type DeckDrag = { target: DeckResizeTarget; step: number; imageFrom?: number };

function patchesFor(source: string, target: DeckResizeTarget, dx: number, dy: number): SourcePatch[] {
  // Numbers are written as precisely as the pointer is at this zoom.
  const tolerance = pointerTolerancePtForScale(useEditorStore.getState().canvasTransform.scale);
  if (target.kind === "columns") return beamerColumnResizePatches(source, target.divider, dx, tolerance);
  if (target.kind === "spacing") return beamerSpacingResizePatches(source, target.spacing, dy, tolerance);
  if (target.kind === "crop") return beamerImageCropPatches(source, target.crop, beamerImageCropDrag(target.crop, target.handle, dx, dy), tolerance);
  const { width, height } = target.image.bounds;
  const sx = target.corner.endsWith("e") ? 1 : -1;
  const sy = target.corner.startsWith("s") ? 1 : -1;
  const factor = 1 + (sx * dx * width + sy * dy * height) / (width * width + height * height);
  return beamerImageResizePatches(source, target.image, factor, tolerance);
}

export function useDeckResize({ source, layout, svgRef, closeText }: {
  source: string;
  layout: BeamerFrameLayout | null;
  svgRef: RefObject<SVGSVGElement | null>;
  closeText: () => void;
}) {
  const pendingSelection = useRef<{ documentId: string; frameId: string; source: string; from: number } | null>(null);

  const valid = useCallback((current: PatchDragSession<DeckDrag>) => {
    const state = useEditorStore.getState();
    return canContinueDocumentEdit(current.edit, state) &&
      requestedDeckStep(state.deckStepByRootKey, current.edit.documentId, current.edit.activeRootId) === current.target.step &&
      !state.activeCanvasTextEditSourceId && !state.documents[current.edit.documentId]?.assistantLockReason;
  }, []);
  const drag = usePatchDrag<DeckDrag>({
    svgRef,
    valid,
    patchesFor: (base, current, dx, dy) => patchesFor(base, current.target, dx, dy),
    afterStop: (current, restored) => {
      const document = useEditorStore.getState().documents[current.edit.documentId];
      if (restored && document && current.target.imageFrom != null && current.edit.activeRootId != null) {
        pendingSelection.current = { documentId: current.edit.documentId, frameId: current.edit.activeRootId,
          source: document.source, from: current.target.imageFrom };
      }
    }
  });

  useEffect(() => {
    const state = useEditorStore.getState();
    const current = drag.current();
    const pending = pendingSelection.current;
    // While dragging, reflow can renumber the image; afterwards, the drag's result does.
    const from = current?.target.imageFrom ?? (pending?.documentId === state.activeDocumentId && pending.frameId === layout?.frameId && pending.source === source ? pending.from : undefined);
    if (from == null || !layout || source !== state.source) return;
    const image = layout.graphics.find((item) => item.sourceSpan.from === from && item.visibility === "visible");
    if (image) state.dispatch({ type: "SET_DECK_OBJECT_SELECTION", frameId: layout.frameId, objectId: image.itemId });
    if (!current) pendingSelection.current = null;
    // `drag` changes only when a drag starts or ends.
  }, [source, layout, drag]);

  const prepare = (target: DeckResizeTarget): PatchDragSession<DeckDrag> | null => {
    if (drag.active() || !layout) return null;
    const initial = useEditorStore.getState();
    if (initial.source !== source || initial.snapshot.source !== source || initial.activeRootId !== layout.frameId ||
      Math.min(requestedDeckStep(initial.deckStepByRootKey, initial.activeDocumentId, layout.frameId), layout.stepCount) !== layout.step ||
      initial.activeInspectorEditDocumentId || initial.documents[initial.activeDocumentId]?.assistantLockReason) return null;
    closeText();
    const state = useEditorStore.getState();
    if (state.sourceRevision !== initial.sourceRevision || state.activeCanvasTextEditSourceId) return null;
    pendingSelection.current = null;
    const edit = beginDocumentEdit(state, []);
    const imageFrom = target.kind === "image" ? layout.graphics.find((item) => item.itemId === target.image.objectId)?.sourceSpan.from
      : target.kind === "crop" ? target.crop.sourceStart : undefined;
    const step = requestedDeckStep(state.deckStepByRootKey, edit.documentId, layout.frameId);
    return { edit, target: { target, step, ...(imageFrom !== undefined ? { imageFrom } : {}) }, patches: [], cleanup: () => {} };
  };

  const nudge = (target: DeckResizeTarget, dx: number, dy: number) => {
    const current = prepare(target);
    if (!current) return;
    const patches = patchesFor(source, target, dx, dy);
    const state = useEditorStore.getState();
    state.dispatch({ type: "APPLY_SOURCE_PATCHES", documentId: current.edit.documentId,
      baseRevision: current.edit.latestRevision, patches, changedSourceIds: [] });
    if (current.target.imageFrom != null && layout) pendingSelection.current = { documentId: current.edit.documentId, frameId: layout.frameId,
      source: useEditorStore.getState().source, from: current.target.imageFrom };
  };

  const begin = (event: ReactPointerEvent<SVGElement>, target: DeckResizeTarget) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus();
    const current = prepare(target);
    if (current) drag.begin(event, current);
  };
  return { dragging: drag.dragging?.target ?? null, begin, nudge };
}
