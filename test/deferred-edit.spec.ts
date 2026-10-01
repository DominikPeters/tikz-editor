import { describe, expect, it } from "vitest";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer.js";
import type { EditorAction } from "../packages/app/src/store/types.js";
import { worldPoint, pt } from "../packages/core/src/coords/index.js";

function cleanup(state: ReturnType<typeof makeInitialState>): EditorAction {
  return {
    type: "APPLY_EDIT_ACTION",
    action: { kind: "cleanupPropertyWrites" },
    historyMergeKey: "drag:test",
    expectedDocumentRevision: { documentId: state.activeDocumentId, sourceRevision: state.sourceRevision },
    precomputedSource: state.source,
    precomputedResult: {
      kind: "success", newSource: `${state.source}\n% cleaned`,
      patches: [{ oldSpan: { from: state.source.length, to: state.source.length },
        newSpan: { from: state.source.length, to: state.source.length + 10 }, replacement: "\n% cleaned" }]
    }
  };
}

describe("deferred edit revision guards", () => {
  it("merges cleanup into the gesture even when their action kinds differ", () => {
    const initial = makeInitialState();
    const gesture = cleanup(initial);
    if (gesture.type !== "APPLY_EDIT_ACTION") throw new Error("action");
    gesture.action = { kind: "resizeElement", elementId: "path:0", role: "top-right", newWorld: worldPoint(pt(10), pt(10)) };
    const resized = editorReducer(initial, gesture);
    const cleaned = editorReducer(resized, cleanup(resized));
    expect(cleaned.history).toHaveLength(resized.history.length);
    expect(cleaned.history.at(-1)?.kind).toBe("resize");
    expect(cleaned.history.at(-1)?.sourceBefore).toBe(initial.source);
    expect(cleaned.history.at(-1)?.sourceAfter).toBe(cleaned.source);
    expect(editorReducer(cleaned, { type: "UNDO" }).source).toBe(initial.source);
  });

  it("applies a result to its exact document revision", () => {
    const initial = makeInitialState();
    const result = editorReducer(initial, cleanup(initial));
    expect(result.source).toBe(`${initial.source}\n% cleaned`);
  });

  it("discards late cleanup instead of reevaluating it against newer edits", () => {
    const initial = makeInitialState();
    const late = cleanup(initial);
    const edited = editorReducer(initial, { type: "CODE_EDITED", source: "new source" });
    expect(editorReducer(edited, late)).toBe(edited);
  });

  it("rejects a stale revision even when the source returns to the same text", () => {
    const initial = makeInitialState();
    const late = cleanup(initial);
    const edited = editorReducer(initial, { type: "CODE_EDITED", source: "new source" });
    const restored = editorReducer(edited, { type: "CODE_EDITED", source: initial.source });
    expect(editorReducer(restored, late)).toBe(restored);
  });

  it("rejects a cleanup prepared for another document", () => {
    const initial = makeInitialState();
    const late = cleanup(initial);
    if (late.type !== "APPLY_EDIT_ACTION") throw new Error("action");
    late.expectedDocumentRevision!.documentId = "other-document";
    expect(editorReducer(initial, late)).toBe(initial);
  });
});
