/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { history, undo, undoDepth } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { parkSourceState, restoreParkedSourceState } from "../../packages/app/src/ui/source-panel/SourcePanel";

const SOURCE = "\\begin{itemize}\n\\item A\n\\end{itemize}";

function typed(): EditorState {
  const state = EditorState.create({ doc: SOURCE, extensions: [history()] });
  const at = SOURCE.indexOf("}") + 1;
  return state.update({ changes: { from: at, insert: "[<+->]" }, annotations: [Transaction.userEvent.of("input.type")] }).state;
}

describe("source editor history across closing the panel", () => {
  it("can still undo the typing after the panel reopens", () => {
    const before = typed();
    parkSourceState("doc", before);
    const restored = restoreParkedSourceState("doc", before.doc.toString(), [history()]);
    expect(restored?.doc.toString()).toBe(before.doc.toString());
    expect(undoDepth(restored!)).toBe(1);
    const view = new EditorView({ state: restored! });
    undo(view);
    expect(view.state.doc.toString()).toBe(SOURCE);
    view.destroy();
  });

  it("takes in edits made while it was closed without making them undoable", () => {
    const before = typed();
    parkSourceState("doc", before);
    const elsewhere = before.doc.toString().replace("\\item A", "\\item B");
    const restored = restoreParkedSourceState("doc", elsewhere, [history()]);
    expect(restored?.doc.toString()).toBe(elsewhere);
    expect(undoDepth(restored!)).toBe(1);
    const view = new EditorView({ state: restored! });
    undo(view);
    expect(view.state.doc.toString()).toBe(SOURCE.replace("\\item A", "\\item B"));
    view.destroy();
  });

  it("starts afresh for another document, and only once", () => {
    parkSourceState("doc", typed());
    expect(restoreParkedSourceState("other", SOURCE, [history()])).toBeNull();
    parkSourceState("doc", typed());
    expect(restoreParkedSourceState("doc", SOURCE, [history()])).not.toBeNull();
    expect(restoreParkedSourceState("doc", SOURCE, [history()])).toBeNull();
  });
});
