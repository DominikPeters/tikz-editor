import { describe, expect, it } from "vitest";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer.js";
import type { EditorAction, EditorState } from "../packages/app/src/store/types.js";

const SOURCE = [
  "\\begin{tikzpicture}",
  "\\node at (0,0) {hello};",
  "\\node at (2,0) {world};",
  "\\end{tikzpicture}"
].join("\n");

function canvasKeystroke(nextText: string, state: EditorState): EditorAction {
  const from = state.source.indexOf("{hello") + 1;
  const currentText = "hello";
  const nextSource =
    state.source.slice(0, from) + nextText + state.source.slice(from + currentText.length);
  return {
    type: "APPLY_EDIT_ACTION",
    action: { kind: "updateNodeText", elementId: "elem-1", text: nextText },
    historyMergeKey: "text-edit:elem-1",
    precomputedResult: {
      kind: "success",
      newSource: nextSource,
      patches: [
        {
          oldSpan: { from, to: from + currentText.length },
          newSpan: { from, to: from + nextText.length },
          replacement: nextText
        }
      ],
      changedSourceIds: ["elem-1"]
    },
    canvasTextEditMask: {
      elementId: "elem-1",
      span: { from, to: from + nextText.length }
    }
  };
}

function initialStateWithSource(): EditorState {
  const initial = makeInitialState();
  return editorReducer(initial, { type: "CODE_EDITED", source: SOURCE });
}

/** Mirrors the validity check App.tsx applies before using the mask. */
function maskIsValid(state: EditorState): boolean {
  return (
    state.canvasTextEditMask != null &&
    state.canvasTextEditMask.documentId === state.activeDocumentId &&
    state.canvasTextEditMask.sourceRevision === state.sourceRevision
  );
}

describe("editorReducer – canvas text edit mask", () => {
  it("installs the mask atomically with a session source write", () => {
    const base = initialStateWithSource();
    const next = editorReducer(base, canvasKeystroke("hello {", base));

    expect(next.canvasTextEditMask).not.toBeNull();
    expect(next.canvasTextEditMask?.elementId).toBe("elem-1");
    expect(next.canvasTextEditMask?.documentId).toBe(next.activeDocumentId);
    expect(next.canvasTextEditMask?.sourceRevision).toBe(next.sourceRevision);
    expect(maskIsValid(next)).toBe(true);
    const { from, to } = next.canvasTextEditMask!.span;
    expect(next.source.slice(from, to)).toBe("hello {");
  });

  it("is invalidated by a foreign source edit", () => {
    const base = initialStateWithSource();
    const withMask = editorReducer(base, canvasKeystroke("hello {", base));
    const afterForeignEdit = editorReducer(withMask, {
      type: "CODE_EDITED",
      source: withMask.source + "\n% comment"
    });

    // The mask object survives but no longer matches the revision, so
    // consumers treat it as absent.
    expect(maskIsValid(afterForeignEdit)).toBe(false);
  });

  it("stays valid across consecutive session keystrokes", () => {
    const base = initialStateWithSource();
    const first = editorReducer(base, canvasKeystroke("hello {", base));
    const second = editorReducer(first, {
      ...canvasKeystroke("hello {x", base),
      type: "APPLY_EDIT_ACTION"
    } as EditorAction);
    expect(maskIsValid(second)).toBe(true);
  });

  it("clears the mask when the session ends", () => {
    const base = initialStateWithSource();
    const withSession = editorReducer(base, { type: "SET_ACTIVE_CANVAS_TEXT_EDIT", sourceId: "elem-1" });
    const withMask = editorReducer(withSession, canvasKeystroke("hello {", withSession));
    expect(withMask.canvasTextEditMask).not.toBeNull();

    const ended = editorReducer(withMask, { type: "SET_ACTIVE_CANVAS_TEXT_EDIT", sourceId: null });
    expect(ended.canvasTextEditMask).toBeNull();
  });

  it("leaves the mask untouched for edits that do not carry one", () => {
    const base = initialStateWithSource();
    const withMask = editorReducer(base, canvasKeystroke("hello {", base));
    const keystroke = canvasKeystroke("unrelated", withMask);
    if (keystroke.type !== "APPLY_EDIT_ACTION") {
      throw new Error("Expected an edit action.");
    }
    const { canvasTextEditMask: _mask, ...foreignAction } = keystroke;
    const foreign = editorReducer(withMask, foreignAction);
    expect(foreign.canvasTextEditMask).toBe(withMask.canvasTextEditMask);
    expect(maskIsValid(foreign)).toBe(false);
  });
});
