import { create } from "zustand";
import type { BeamerFrameLayout } from "@tikz-editor/core/beamer/index";
import { useEditorStore } from "../../store/store";

/**
 * The image in crop mode, by where its command starts: crop edits change only
 * its options, while the rendered item id follows reflow. Ephemeral; it holds
 * only while that image stays selected on that frame.
 */
export type DeckCropTarget = { readonly documentId: string; readonly frameId: string; readonly sourceStart: number };

type DeckCropStore = {
  readonly crop: DeckCropTarget | null;
  readonly setCrop: (crop: DeckCropTarget | null) => void;
};

export const useDeckCropStore = create<DeckCropStore>((set) => ({
  crop: null,
  setCrop: (crop) => { set({ crop }); },
}));

/** Enter crop mode for the selected image of the active frame. */
export function startDeckCrop(layout: BeamerFrameLayout, objectId: string): boolean {
  const state = useEditorStore.getState();
  const graphic = layout.graphics.find((item) => item.itemId === objectId && item.visibility === "visible");
  if (!graphic) return false;
  useDeckCropStore.getState().setCrop({ documentId: state.activeDocumentId, frameId: layout.frameId, sourceStart: graphic.sourceSpan.from });
  return true;
}

export function stopDeckCrop(): void {
  if (useDeckCropStore.getState().crop) useDeckCropStore.getState().setCrop(null);
}

/** Whether `crop` names the image currently selected on `layout`. */
export function deckCropMatches(crop: DeckCropTarget | null, layout: BeamerFrameLayout | null): boolean {
  if (!crop || !layout) return false;
  const state = useEditorStore.getState();
  const selection = state.deckObjectSelection;
  if (crop.documentId !== state.activeDocumentId || crop.frameId !== layout.frameId || selection?.frameId !== layout.frameId) return false;
  const graphic = layout.graphics.find((item) => item.itemId === selection.objectId && item.visibility === "visible");
  return graphic?.sourceSpan.from === crop.sourceStart;
}
