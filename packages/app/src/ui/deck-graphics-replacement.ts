import { applyDeckEditAction, buildBeamerObjectIndex } from "@tikz-editor/core/beamer/index";
import { beginDocumentEdit, canContinueDocumentEdit } from "../edit-session.js";
import { graphicBytesBase64, importedGraphicPath, replacementGraphicPath, storeImportedGraphic } from "../imported-graphics.js";
import { getActiveEditorPlatform } from "../platform/current.js";
import type { EditorAction, EditorState } from "../store/types.js";
import { deckStepRootKey } from "../root-key.js";

export async function replaceSelectedDeckGraphics(params: {
  getState: () => EditorState;
  dispatch: (action: EditorAction) => void;
  rememberSelection: () => void;
}): Promise<{ status: "applied" | "cancelled" | "stale" } | { status: "failed"; reason: string }> {
  const state = params.getState();
  const selected = state.deckObjectSelection;
  const frame = state.snapshot.deck?.activeFrame;
  if (!frame || selected?.frameId !== frame.frameId || selected.documentId !== state.activeDocumentId || state.snapshot.source !== state.source ||
    state.documents[state.activeDocumentId]?.assistantLockReason) return { status: "stale" };
  const node = buildBeamerObjectIndex({ items: frame.layout.items, paragraphs: frame.layout.paragraphs, source: state.source }).byId.get(selected.objectId);
  if (node?.kind !== "graphics") return { status: "stale" };
  const session = beginDocumentEdit(state);
  const stepKey = deckStepRootKey(session.documentId, session.activeRootId);
  const platform = getActiveEditorPlatform();
  const picker = platform.files?.openBinary;
  if (!picker) return { status: "failed", reason: "Image selection is unavailable on this platform." };
  try {
    const opened = await picker({ addToRecent: false, kind: "graphics" });
    if (!opened) return { status: "cancelled" };
    const current = params.getState();
    if (!canContinueDocumentEdit(session, current) || current.documents[session.documentId]?.assistantLockReason || current.deckObjectSelection?.objectId !== selected.objectId ||
      current.deckObjectSelection.frameId !== selected.frameId || current.snapshot.deck?.activeFrame?.step !== frame.step ||
      current.deckStepByRootKey[stepKey] !== state.deckStepByRootKey[stepKey] ||
      current.snapshot.source !== current.source || getActiveEditorPlatform() !== platform) return { status: "stale" };
    const file = opened.fileRef;
    if (!file || !/\.(?:png|jpe?g|svg|pdf)$/iu.test(file.name)) return { status: "failed", reason: "Choose a PNG, JPEG, SVG or PDF image." };
    const nativePath = replacementGraphicPath(file, current.documents[session.documentId]?.fileRef ?? null);
    const path = nativePath ?? importedGraphicPath(file.name);
    const action = { kind: "deckReplaceGraphics", frameId: frame.frameId, objectId: selected.objectId, path } as const;
    const result = applyDeckEditAction(session.latestSource, frame.layout, action);
    if (result.kind !== "success") return { status: "failed", reason: result.kind === "unsupported" ? result.reason : "The image could not be replaced." };
    if (nativePath === null) {
      if (platform.files?.storeGraphicAsset) await platform.files.storeGraphicAsset({ path, bytes: opened.bytes });
      else storeImportedGraphic(platform.persistence, { path, payload: graphicBytesBase64(opened.bytes) });
      const latest = params.getState();
      if (!canContinueDocumentEdit(session, latest) || latest.documents[session.documentId]?.assistantLockReason || latest.deckObjectSelection?.objectId !== selected.objectId ||
        latest.deckStepByRootKey[stepKey] !== state.deckStepByRootKey[stepKey] || getActiveEditorPlatform() !== platform) return { status: "stale" };
    }
    params.rememberSelection();
    params.dispatch({ type: "APPLY_EDIT_ACTION", documentId: session.documentId, action, precomputedSource: session.latestSource,
      precomputedResult: result, expectedDocumentRevision: { documentId: session.documentId, sourceRevision: session.latestRevision } });
    return { status: "applied" };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "The selected image could not be loaded or stored." };
  }
}
