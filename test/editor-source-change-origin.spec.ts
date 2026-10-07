import { describe, expect, it } from "vitest";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer";
import type { EditorState } from "../packages/app/src/store/types";

const origin = (state: EditorState) => state.documents[state.activeDocumentId].lastSourceChangeOrigin;

describe("source revision provenance", () => {
  it("records source typing even after a targeted command left object IDs behind", () => {
    let state = makeInitialState();
    state = editorReducer(state, { type: "SET_SOURCE_TRANSIENT", source: "command", changedSourceIds: ["path:0"] });
    expect(origin(state)).toBe("edit-command");
    state = editorReducer(state, { type: "CODE_EDITED", source: "typing" });
    expect(origin(state)).toBe("source-editor");
    expect(state.lastEditChangedSourceIds).toBeNull();
    state = editorReducer(state, { type: "SET_ACTIVE_ROOT", rootId: "frame:1" });
    expect(origin(state)).toBe("source-editor"); // Navigation is classified from the transition, not this retained value.
  });
  it("distinguishes assistant streaming from undo/redo of its source", () => {
    let state = makeInitialState();
    state = editorReducer(state, { type: "ASSISTANT_SOURCE_UPDATED", source: "generated", revisionToken: "chunk-1" });
    expect(origin(state)).toBe("assistant");
    state = editorReducer(state, { type: "UNDO" });
    expect(origin(state)).toBe("history");
    state = editorReducer(state, { type: "REDO" });
    expect(origin(state)).toBe("history");
    expect(state.source).toBe("generated");
  });
  it("distinguishes a disk reload from typing", () => {
    let state = editorReducer(makeInitialState(), { type: "CODE_EDITED", source: "typing" });
    state = editorReducer(state, { type: "REPLACE_DOCUMENT_SOURCE_FROM_DISK", source: "disk", diskRevision: { hash: "disk-1" } });
    expect(origin(state)).toBe("disk");
    expect(state.lastEditChangedSourceIds).toBeNull();
  });
  it("keeps canvas source patches as commands even when they have no affected IDs", () => {
    let state = editorReducer(makeInitialState(), { type: "CODE_EDITED", source: "text" });
    state = editorReducer(state, { type: "APPLY_SOURCE_PATCHES", baseRevision: state.sourceRevision, changedSourceIds: [],
      patches: [{ oldSpan: { from: 0, to: 4 }, newSpan: { from: 0, to: 5 }, replacement: "text!" }] });
    expect(state.source).toBe("text!");
    expect(origin(state)).toBe("edit-command");
  });
});
