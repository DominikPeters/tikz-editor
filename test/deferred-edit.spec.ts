import { describe, expect, it } from "vitest";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer.js";
import type { EditorAction } from "../packages/app/src/store/types.js";
import { editedSource, fragment } from "./fragment-helpers.js";

function precomputed(state: ReturnType<typeof makeInitialState>): EditorAction {
  return {
    type: "APPLY_EDIT_ACTION",
    action: { kind: "setProperty", elementId: "path:0", level: "command", key: "draw", value: "red" },
    historyMergeKey: "drag:test",
    expectedDocumentRevision: { documentId: state.activeDocumentId, sourceRevision: state.sourceRevision },
    precomputedSource: state.source,
    precomputedResult: {
      kind: "success", newSource: editedSource(`${state.source}\n% edited`),
      patches: [{ oldSpan: { from: state.source.length, to: state.source.length },
        newSpan: { from: state.source.length, to: state.source.length + 10 }, replacement: fragment("\n% edited") }]
    }
  };
}

describe("deferred edit revision guards", () => {
  it("applies a result to its exact document revision", () => {
    const initial = makeInitialState();
    const result = editorReducer(initial, precomputed(initial));
    expect(result.source).toBe(`${initial.source}\n% edited`);
  });

  it("discards a late result instead of reevaluating it against newer edits", () => {
    const initial = makeInitialState();
    const late = precomputed(initial);
    const edited = editorReducer(initial, { type: "CODE_EDITED", source: "new source" });
    expect(editorReducer(edited, late)).toBe(edited);
  });

  it("rejects a stale revision even when the source returns to the same text", () => {
    const initial = makeInitialState();
    const late = precomputed(initial);
    const edited = editorReducer(initial, { type: "CODE_EDITED", source: "new source" });
    const restored = editorReducer(edited, { type: "CODE_EDITED", source: initial.source });
    expect(editorReducer(restored, late)).toBe(restored);
  });

  it("rejects a result prepared for another document", () => {
    const initial = makeInitialState();
    const late = precomputed(initial);
    if (late.type !== "APPLY_EDIT_ACTION") throw new Error("action");
    late.expectedDocumentRevision!.documentId = "other-document";
    expect(editorReducer(initial, late)).toBe(initial);
  });
});
