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

describe("slide move review transactions", () => {
  const warned = String.raw`\documentclass{beamer}\begin{document}
\def\unit{ms}
\begin{frame}{A}\unit\end{frame}
\def\unit{s}
\begin{frame}{B}B\end{frame}
\end{document}`;
  const edit = { kind: "move", frameIds: ["frame:0"], destination: { kind: "end" } } as const;
  it("requires confirmation and rejects a confirmation from an earlier source revision", () => {
    const state = editorReducer(makeInitialState(), { type: "CODE_EDITED", source: warned });
    const action = { type: "EDIT_DECK_SLIDES", documentId: state.activeDocumentId, baseRevision: state.sourceRevision, edit } as const;
    expect(editorReducer(state, action)).toBe(state);
    expect(editorReducer(state, { ...action, allowWarnings: true }).source).not.toBe(warned);
    let changed = editorReducer(state, { type: "CODE_EDITED", source: warned + "\n" });
    changed = editorReducer(changed, { type: "CODE_EDITED", source: warned });
    expect(editorReducer(changed, { ...action, allowWarnings: true })).toBe(changed);
  });
  it("cannot override structural failures", () => {
    const conditional = warned.replace("\\def\\unit{ms}", "\\iffalse").replace("\\def\\unit{s}", "\\fi");
    const state = editorReducer(makeInitialState(), { type: "CODE_EDITED", source: conditional });
    expect(editorReducer(state, { type: "EDIT_DECK_SLIDES", documentId: state.activeDocumentId, baseRevision: state.sourceRevision, edit, allowWarnings: true })).toBe(state);
  });
  it("moves definitions and frames in one undo event", () => {
    const original = warned.replace("\\def\\unit{ms}\n", "").replace("\\unit\\end", "A\\end").replace("{B}B", "{B}\\unit");
    let state = editorReducer(makeInitialState(), { type: "CODE_EDITED", source: original });
    state = editorReducer(state, { type: "EDIT_DECK_SLIDES", documentId: state.activeDocumentId, baseRevision: state.sourceRevision,
      edit: { kind: "move", frameIds: ["frame:1"], destination: { kind: "before", frameId: "frame:0" } } });
    expect(state.source).not.toBe(original);
    expect(state.history).toHaveLength(1);
    state = editorReducer(state, { type: "UNDO" });
    expect(state.source).toBe(original);
  });
  it("scopes source reveals to the current document and source revision", () => {
    const state = setup();
    const action = { type: "REVEAL_SOURCE", documentId: state.activeDocumentId, sourceRevision: state.sourceRevision, span: { from: 0, to: 20 } } as const;
    expect(editorReducer(state, action).sourceReveal).toMatchObject({ span: action.span });
    expect(editorReducer(state, { ...action, sourceRevision: state.sourceRevision - 1 })).toBe(state);
    expect(editorReducer(state, { ...action, documentId: "other" })).toBe(state);
    expect(editorReducer(state, { ...action, span: { from: 10, to: 100000 } })).toBe(state);
  });
});


it("pastes multiple slides as one undo transaction with restored selection", () => {
  let state = setup();
  const before = state;
  state = editorReducer(state, { type: "EDIT_DECK_SLIDES", documentId: state.activeDocumentId, baseRevision: state.sourceRevision,
    edit: { kind: "paste", source: "\\begin{frame}{D}D\\end{frame}\n\\begin{frame}{E}E\\end{frame}", destination: { kind: "after", frameId: "frame:0" } } });
  expect(state.history).toHaveLength(1);
  expect(state.history[0].label).toBe("Paste slides");
  expect(state.documents[state.activeDocumentId].deckSlideSelection?.frameIds).toEqual(["frame:1", "frame:2"]);
  const pasted = state.source;
  state = editorReducer(state, { type: "UNDO" });
  expect(state.source).toBe(before.source);
  expect(state.activeRootId).toBe(before.activeRootId);
  state = editorReducer(state, { type: "REDO" });
  expect(state.source).toBe(pasted);
});
