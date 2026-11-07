import { beamerImageCropPatches, beamerImageCropTarget } from "@tikz-editor/core/beamer/index";
import { beginDocumentEdit } from "../edit-session.js";
import type { EditorAction, EditorState } from "../store/types.js";

/** Remove the selected image's crop, keeping its drawn scale. */
export function resetSelectedDeckGraphicsCrop(params: {
  getState: () => EditorState;
  dispatch: (action: EditorAction) => void;
}): boolean {
  const state = params.getState();
  const frame = state.snapshot.deck?.activeFrame;
  const selected = state.deckObjectSelection;
  if (!frame || selected?.frameId !== frame.frameId || selected.documentId !== state.activeDocumentId ||
    state.snapshot.source !== state.source || state.documents[state.activeDocumentId]?.assistantLockReason) return false;
  const target = beamerImageCropTarget(state.source, frame.layout, selected.objectId);
  if (!target) return false;
  const patches = beamerImageCropPatches(state.source, target, { left: 0, bottom: 0, right: 0, top: 0 });
  if (!patches.length) return false;
  const edit = beginDocumentEdit(state, []);
  params.dispatch({ type: "APPLY_SOURCE_PATCHES", documentId: edit.documentId, baseRevision: edit.latestRevision, patches, changedSourceIds: [] });
  return true;
}
