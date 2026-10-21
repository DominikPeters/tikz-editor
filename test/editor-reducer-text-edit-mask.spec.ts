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
  it("applies revision-checked source patches in deck mode with merged history", () => {
    const deckSource = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Title}
Hello
\end{frame}
\end{document}`;
    const base = editorReducer(makeInitialState(), {
      type: "CODE_EDITED",
      source: deckSource
    });
    const from = base.source.indexOf("Hello");
    const first = editorReducer(base, {
      type: "APPLY_SOURCE_PATCHES",
      baseRevision: base.sourceRevision,
      patches: [{
        oldSpan: { from, to: from + 5 },
        newSpan: { from, to: from + 6 },
        replacement: "Hello!"
      }],
      changedSourceIds: ["frame:0:paragraph:0:editable:0"],
      historyMergeKey: "text-edit:frame:0:paragraph:0:editable:0",
      canvasTextEditMask: {
        elementId: "frame:0:paragraph:0:editable:0",
        span: { from, to: from + 6 }
      }
    });
    expect(first.source).toContain("Hello!");
    expect(first.history.at(-1)?.kind).toBe("text-edit");
    expect(maskIsValid(first)).toBe(true);

    const second = editorReducer(first, {
      type: "APPLY_SOURCE_PATCHES",
      baseRevision: first.sourceRevision,
      patches: [{
        oldSpan: { from, to: from + 6 },
        newSpan: { from, to: from + 7 },
        replacement: "Hello!!"
      }],
      changedSourceIds: ["frame:0:paragraph:0:editable:0"],
      historyMergeKey: "text-edit:frame:0:paragraph:0:editable:0",
      canvasTextEditMask: {
        elementId: "frame:0:paragraph:0:editable:0",
        span: { from, to: from + 7 }
      }
    });
    expect(second.history).toHaveLength(first.history.length);

    const undone = editorReducer(second, { type: "UNDO" });
    expect(undone.source).toBe(deckSource);
    const redone = editorReducer(undone, { type: "REDO" });
    expect(redone.source).toContain("Hello!!");
  });

  it("rejects a source patch based on a stale revision", () => {
    const base = initialStateWithSource();
    const from = base.source.indexOf("hello");
    const next = editorReducer(base, {
      type: "APPLY_SOURCE_PATCHES",
      baseRevision: base.sourceRevision - 1,
      patches: [{
        oldSpan: { from, to: from + 5 },
        newSpan: { from, to: from + 4 },
        replacement: "nope"
      }],
      changedSourceIds: ["elem-1"]
    });
    expect(next.source).toBe(base.source);
    expect(next.lastEditWarningMessage).toMatch(/source changed/u);
  });

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
