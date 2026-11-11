import { create } from "zustand";
import { imageCropTarget, type BeamerImageCropTarget } from "@tikz-editor/core/beamer/index";
import { worldPoint, pt } from "@tikz-editor/core/coords/index";
import { imageNodeCommandSpan, imageNodeCropPlacement } from "@tikz-editor/core/edit/graphics-node-size";
import type { SessionSnapshot } from "../../compute";
import { useEditorStore } from "../../store/store";
import { worldToSvgPoint } from "./geometry";

/**
 * Crop mode for an image node in a TikZ figure, by its element and document.
 * Ephemeral, like slide crop: it holds while that node stays the selection.
 */
export type TikzCropMode = { readonly documentId: string; readonly rootId: string | null; readonly elementId: string };

export const useTikzCropStore = create<{ crop: TikzCropMode | null; setCrop: (crop: TikzCropMode | null) => void }>((set) => ({
  crop: null,
  setCrop: (crop) => { set({ crop }); },
}));

export function startTikzCrop(elementId: string): void {
  const state = useEditorStore.getState();
  useTikzCropStore.getState().setCrop({ documentId: state.activeDocumentId, rootId: state.activeRootId, elementId });
}

export function stopTikzCrop(): void {
  if (useTikzCropStore.getState().crop) useTikzCropStore.getState().setCrop(null);
}

/** Whether `crop` is for the one node selected in the active document and picture. */
export function tikzCropMatches(crop: TikzCropMode | null): crop is TikzCropMode {
  if (!crop) return false;
  const state = useEditorStore.getState();
  return crop.documentId === state.activeDocumentId && crop.rootId === state.activeRootId &&
    state.selectedElementIds.size === 1 && state.selectedElementIds.has(crop.elementId);
}

/**
 * The crop target of an image node, its bounds in the canvas's SVG
 * coordinates under `viewBox`: the same target slides use, built from the
 * node's rendered image instead of a slide layout. Null for other elements,
 * unresolved images, and transformed nodes.
 */
export function tikzImageCropTarget(
  source: string,
  snapshot: Pick<SessionSnapshot, "source" | "parseResult" | "scene">,
  elementId: string,
  viewBox: { readonly y: number; readonly height: number }
): BeamerImageCropTarget | null {
  const body = snapshot.parseResult?.figure.body;
  if (!body || !snapshot.scene || snapshot.source !== source) return null;
  const span = imageNodeCommandSpan(source, body, elementId);
  if (!span) return null;
  const placement = imageNodeCropPlacement(snapshot.scene.elements, elementId, span, (x, y) => worldToSvgPoint(worldPoint(pt(x), pt(y)), viewBox));
  return placement ? imageCropTarget(source, placement) : null;
}
