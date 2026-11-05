import { describe, expect, it } from "vitest";
import { beginDocumentEdit, canContinueDocumentEdit, restoreDocumentEdit } from "../../packages/app/src/edit-session";
import type { EditorAction } from "../../packages/app/src/store/types";
import { editedSource, fragment } from "../fragment-helpers";

type SessionState = Parameters<typeof beginDocumentEdit>[0];

function state(activeRootId: string | null, hasInitializedRootSelection: boolean, source = "\\begin{tikzpicture}\\end{tikzpicture}"): SessionState {
  return {
    activeDocumentId: "doc",
    documents: { doc: { id: "doc", activeRootId, hasInitializedRootSelection, source, sourceRevision: 1 } }
  } as unknown as SessionState;
}

describe("document edit sessions", () => {
  it.each([
    { explicit: null, expected: ["path:0"] },
    { explicit: [], expected: [] },
    { explicit: ["scope:0"], expected: ["scope:0"] }
  ])("preserves preview owner hints on reversal without replacing explicit session hints ($explicit)", ({ explicit, expected }) => {
    const session = beginDocumentEdit(state("figure:0", true, "before"), explicit);
    const current = state("figure:0", true, "after");
    const doc = current.documents.doc;
    if (!doc) throw new Error("Missing test document");
    session.latestSource = doc.source;
    session.latestRevision = doc.sourceRevision;
    const restored: EditorAction[] = [];
    const success = restoreDocumentEdit(session, () => current, action => {
      restored.push(action);
      if (action.type !== "SET_SOURCE_TRANSIENT") throw new Error("Expected preview reversal");
      doc.source = action.source;
      doc.sourceRevision += 1;
    }, { newSource: editedSource("after"), changedSourceIds: ["path:0"],
      patches: [{ oldSpan: { from: 0, to: 6 }, newSpan: { from: 0, to: 5 }, replacement: fragment("after") }] });
    expect(success).toBe(true);
    expect(restored).toEqual([expect.objectContaining({ type: "SET_SOURCE_TRANSIENT", source: "before", changedSourceIds: expected })]);
  });

  it("treat a document's first choice of root as the same picture, not a navigation", () => {
    const session = beginDocumentEdit(state(null, false));
    expect(canContinueDocumentEdit(session, state("figure:0", true))).toBe(true);
  });

  it("stop when the user moves to another root or the source changes", () => {
    const session = beginDocumentEdit(state("figure:0", true));
    expect(canContinueDocumentEdit(session, state("figure:0", true))).toBe(true);
    expect(canContinueDocumentEdit(session, state("figure:1", true))).toBe(false);
    expect(canContinueDocumentEdit(session, state("figure:0", true, "changed"))).toBe(false);
    expect(canContinueDocumentEdit(beginDocumentEdit(state(null, true)), state("figure:1", true))).toBe(false);
  });
});
