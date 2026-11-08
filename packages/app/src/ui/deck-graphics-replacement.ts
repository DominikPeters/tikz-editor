import { applyDeckEditAction, buildBeamerObjectIndex } from "@tikz-editor/core/beamer/index";
import { beginDocumentEdit, canContinueDocumentEdit } from "../edit-session.js";
import { prepareGraphics } from "../graphics-bytes.js";
import { discardPlacedGraphics, graphicsFileName, graphicsMimeType, placeGraphicsFile, showGraphicsNotice } from "./deck-graphics-insertion.js";
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
    const opened = await picker({ addToRecent: false, kind: "graphics-import" });
    if (!opened) return { status: "cancelled" };
    const stale = (latest: EditorState) => !canContinueDocumentEdit(session, latest) || latest.documents[session.documentId]?.assistantLockReason != null ||
      latest.deckObjectSelection?.objectId !== selected.objectId || latest.deckObjectSelection.frameId !== selected.frameId ||
      latest.snapshot.deck?.activeFrame?.step !== frame.step || latest.deckStepByRootKey[stepKey] !== state.deckStepByRootKey[stepKey] ||
      latest.snapshot.source !== latest.source || getActiveEditorPlatform() !== platform;
    if (stale(params.getState())) return { status: "stale" };
    const name = opened.fileRef?.name ?? null;
    const input = { bytes: opened.bytes, name, mimeType: name ? graphicsMimeType(name) : "",
      path: opened.fileRef?.provider === "desktop-fs" ? opened.fileRef.path ?? null : null };
    const prepared = await prepareGraphics(input.bytes, input.mimeType);
    // The image goes where the document keeps images, as an insertion would.
    const placed = await placeGraphicsFile({ source: session.latestSource, offset: node.sourceSpan.from, documentId: session.documentId,
      documentRef: params.getState().documents[session.documentId]?.fileRef ?? null, input, prepared, name: graphicsFileName(input, session.latestSource, frame.frameId) });
    if ("error" in placed) return { status: "failed", reason: placed.error };
    const action = { kind: "deckReplaceGraphics", frameId: frame.frameId, objectId: selected.objectId, path: placed.texPath } as const;
    const result = applyDeckEditAction(session.latestSource, frame.layout, action);
    if (result.kind !== "success" || stale(params.getState())) {
      await discardPlacedGraphics(placed.notice);
      return result.kind !== "success" ? { status: "failed", reason: result.kind === "unsupported" ? result.reason : "The image could not be replaced." } : { status: "stale" };
    }
    params.rememberSelection();
    params.dispatch({ type: "APPLY_EDIT_ACTION", documentId: session.documentId, action, precomputedSource: session.latestSource,
      precomputedResult: result, expectedDocumentRevision: { documentId: session.documentId, sourceRevision: session.latestRevision } });
    showGraphicsNotice(placed, result.newSource);
    return { status: "applied" };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "The selected image could not be loaded or stored." };
  }
}
