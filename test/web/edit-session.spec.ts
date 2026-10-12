import { describe, expect, it } from "vitest";
import { beginDocumentEdit, canContinueDocumentEdit } from "../../packages/app/src/edit-session";

type SessionState = Parameters<typeof beginDocumentEdit>[0];

function state(activeRootId: string | null, hasInitializedRootSelection: boolean, source = "\\begin{tikzpicture}\\end{tikzpicture}"): SessionState {
  return {
    activeDocumentId: "doc",
    documents: { doc: { id: "doc", activeRootId, hasInitializedRootSelection, source, sourceRevision: 1 } }
  } as unknown as SessionState;
}

describe("document edit sessions", () => {
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
