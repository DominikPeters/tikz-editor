import { describe, it, expect } from "vitest";
import { editorReducer, makeInitialState } from "../../packages/app/src/store/reducer.js";
import { rootKey } from "../../packages/app/src/root-key.js";
const source = String.raw`\documentclass{beamer}\begin{document}
\begin{frame}{A}A\only<3>{Late}\end{frame}
\begin{frame}{B}B\end{frame}
\begin{frame}{C}C\end{frame}
\end{document}`;
function setup() {
  let state = editorReducer(makeInitialState(), { type: "CODE_EDITED", source });
  state = editorReducer(state, { type: "SET_ACTIVE_ROOT", rootId: "frame:0" });
  state = editorReducer(state, { type: "SET_DECK_STEP", rootId: "frame:0", step: 3 });
  return state;
}
describe("slide manager store transactions", () => {
  it("moves selection, active frame and overlays together, including undo and redo", () => {
    let state = setup(); const id = state.activeDocumentId;
    state = editorReducer(state, { type: "SELECT_DECK_SLIDES", documentId: id, baseRevision: state.sourceRevision, frameIds: ["frame:0", "frame:2"], anchorId: "frame:0" });
    state = editorReducer(state, { type: "EDIT_DECK_SLIDES", documentId: id, baseRevision: state.sourceRevision,
      edit: { kind: "move", frameIds: ["frame:0", "frame:2"], destination: { kind: "end" } } });
    expect(state.activeRootId).toBe("frame:1");
    expect(state.documents[id].deckSlideSelection?.frameIds).toEqual(["frame:1", "frame:2"]);
    expect(state.deckStepByRootKey[rootKey(id, "frame:1")]).toBe(3);
    expect(state.history).toHaveLength(1);
    const after = state.source;
    state = editorReducer(state, { type: "UNDO" });
    expect(state.source).toBe(source); expect(state.activeRootId).toBe("frame:0");
    expect(state.documents[id].deckSlideSelection?.frameIds).toEqual(["frame:0", "frame:2"]);
    expect(state.deckStepByRootKey[rootKey(id, "frame:0")]).toBe(3);
    state = editorReducer(state, { type: "REDO" });
    expect(state.source).toBe(after); expect(state.activeRootId).toBe("frame:1");
  });
  it("rejects stale edits, locked documents and edits in another tab", () => {
    const state = setup(), documentId = state.activeDocumentId;
    const action = { type: "EDIT_DECK_SLIDES", documentId, baseRevision: state.sourceRevision, edit: { kind: "delete", frameIds: ["frame:0"] } } as const;
    expect(editorReducer(state, { ...action, baseRevision: state.sourceRevision - 1 })).toBe(state);
    const locked = { ...state, documents: { ...state.documents, [documentId]: { ...state.documents[documentId], assistantLockReason: "Editing" } } };
    expect(editorReducer(locked, action)).toBe(locked);
    const other = editorReducer(state, { type: "NEW_DOCUMENT", source: "Other" });
    expect(editorReducer(other, action)).toBe(other);
  });
  it("restores the owning slide selection when undoing from a nested figure", () => {
    let state = setup(); const documentId = state.activeDocumentId;
    state = editorReducer(state, { type: "SET_ACTIVE_ROOT", rootId: "frame:0:tikzpicture:0" });
    state = editorReducer(state, { type: "EDIT_DECK_SLIDES", documentId, baseRevision: state.sourceRevision, edit: { kind: "duplicate", frameIds: ["frame:0"] } });
    state = editorReducer(state, { type: "UNDO" });
    expect(state.activeRootId).toBe("frame:0:tikzpicture:0");
    expect(state.documents[documentId].deckSlideSelection?.frameIds).toEqual(["frame:0"]);
  });
  it("selects copies and restores the original selection on undo", () => {
    let state = setup(); const documentId = state.activeDocumentId;
    state = editorReducer(state, { type: "EDIT_DECK_SLIDES", documentId, baseRevision: state.sourceRevision, edit: { kind: "duplicate", frameIds: ["frame:0"] } });
    expect(state.activeRootId).toBe("frame:1");
    expect(state.documents[documentId].deckSlideSelection?.frameIds).toEqual(["frame:1"]);
    state = editorReducer(state, { type: "UNDO" });
    expect(state.activeRootId).toBe("frame:0");
  });
});
