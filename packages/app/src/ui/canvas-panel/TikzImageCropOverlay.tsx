import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { beamerImageCropDrag, beamerImageCropPatches } from "@tikz-editor/core/beamer/index";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import { beginDocumentEdit, canContinueDocumentEdit } from "../../edit-session";
import { useEditorStore } from "../../store/store";
import { pointerTolerancePtForScale } from "../canvas-zoom";
import { DeckCropOverlay, type CropHandleTarget } from "./DeckCropOverlay";
import { stopTikzCrop, tikzCropMatches, tikzImageCropTarget, useTikzCropStore } from "./tikz-image-crop";
import { usePatchDrag, type PatchDragSession } from "./usePatchDrag";

function cropPatches(base: string, target: CropHandleTarget, dx: number, dy: number): SourcePatch[] {
  const tolerance = pointerTolerancePtForScale(useEditorStore.getState().canvasTransform.scale);
  return beamerImageCropPatches(base, target.crop, beamerImageCropDrag(target.crop, target.handle, dx, dy), tolerance);
}

/**
 * Crop handles on an image node of a TikZ figure, in crop mode: the slide
 * crop overlay, over the node's picture in canvas SVG coordinates.
 */
export function TikzImageCropOverlay({ svgRef, scale, viewBox }: {
  svgRef: RefObject<SVGSVGElement | null>;
  scale: number;
  viewBox: { readonly y: number; readonly height: number } | null;
}) {
  const crop = useTikzCropStore((s) => s.crop);
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const selected = useEditorStore((s) => s.selectedElementIds);
  const locked = useEditorStore((s) => s.documents[s.activeDocumentId]?.assistantLockReason != null);
  const valid = useCallback((session: PatchDragSession<CropHandleTarget>) => {
    const state = useEditorStore.getState();
    return canContinueDocumentEdit(session.edit, state) && !state.documents[session.edit.documentId]?.assistantLockReason;
  }, []);
  // The release lands on the capturing canvas, whose click reads as a click on
  // the background and clears the selection; the node is reselected after it.
  const reselecting = useRef<string | null>(null);
  const afterStop = useCallback(() => {
    const crop = useTikzCropStore.getState().crop;
    if (!crop) return;
    reselecting.current = crop.elementId;
    setTimeout(() => {
      const state = useEditorStore.getState();
      if (useTikzCropStore.getState().crop === crop && state.activeDocumentId === crop.documentId && !state.selectedElementIds.has(crop.elementId)) {
        state.dispatch({ type: "SELECT_RANGE", ids: [crop.elementId] });
      }
      reselecting.current = null;
    }, 0);
  }, []);
  const drag = usePatchDrag<CropHandleTarget>({ svgRef, valid, patchesFor: cropPatches, afterStop });
  const active = tikzCropMatches(crop) ? crop : null;
  // `active` is re-derived each render, so a selection change (which re-renders) re-checks the match.
  const target = useMemo(() => active && viewBox ? tikzImageCropTarget(source, snapshot, active.elementId, viewBox) : null,
    [active, source, snapshot, viewBox]);

  // Crop mode ends with its node's selection, or when the node can no longer be cropped.
  useEffect(() => {
    if (!crop || drag.dragging || reselecting.current || snapshot.source !== source) return;
    if (!tikzCropMatches(crop) || (viewBox && !tikzImageCropTarget(source, snapshot, crop.elementId, viewBox))) stopTikzCrop();
  }, [crop, drag.dragging, selected, snapshot, source, viewBox]);
  // Return or Escape leaves crop mode, unless focus is in a text field.
  useEffect(() => {
    if (!target || drag.dragging) return;
    const key = (event: globalThis.KeyboardEvent) => {
      const element = event.target instanceof HTMLElement ? event.target : null;
      if ((event.key !== "Escape" && event.key !== "Enter") || event.defaultPrevented || element?.isContentEditable ||
        element?.tagName === "INPUT" || element?.tagName === "TEXTAREA" || element?.tagName === "BUTTON" || element?.closest(".cm-editor")) return;
      event.preventDefault(); event.stopPropagation();
      stopTikzCrop();
    };
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("keydown", key, true); };
  }, [target, drag.dragging]);

  const prepare = (): PatchDragSession<CropHandleTarget>["edit"] | null => {
    const state = useEditorStore.getState();
    if (drag.active() || state.source !== source || state.snapshot.source !== source || state.activeInspectorEditDocumentId ||
      state.documents[state.activeDocumentId]?.assistantLockReason) return null;
    return beginDocumentEdit(state, []);
  };
  const begin = (event: ReactPointerEvent<SVGElement>, handle: CropHandleTarget) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus();
    const edit = prepare();
    if (edit) drag.begin(event, { edit, target: handle, patches: [], cleanup: () => {} });
  };
  const onKeyDown = (event: KeyboardEvent<SVGElement>, handle: CropHandleTarget) => {
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    event.preventDefault(); event.stopPropagation();
    const edit = prepare();
    if (!edit) return;
    useEditorStore.getState().dispatch({ type: "APPLY_SOURCE_PATCHES", documentId: edit.documentId, baseRevision: edit.latestRevision,
      patches: cropPatches(source, handle, dx, dy), changedSourceIds: [] });
  };

  if (!target || locked) return null;
  return <g data-testid="tikz-crop-overlay" onClick={(event) => { event.stopPropagation(); }}>
    <DeckCropOverlay target={target} scale={scale} begin={begin} onKeyDown={onKeyDown} />
  </g>;
}
