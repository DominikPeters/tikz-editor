/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  ExternalSourceSyncManager,
  externalSourceSyncPlugin
} from "../../packages/app/src/ui/source-panel/SourcePanel";

// The SourcePanel external-sync manager applies store-produced span patches to
// the CodeMirror buffer. Invariant under test: after every sync, the buffer
// equals the store source — patches are applied only when replaying them on
// the actual buffer content reproduces the target source; otherwise the sync
// falls back to a full-document replace.
//
// Regression context: the manager used to authorize the patch fast path from
// revision bookkeeping alone, and ASSUMED the buffer sat at the patch base
// whenever its revision was unknown (true after every user keystroke and at
// mount). A keystroke landing in the rAF/80ms-throttle coalescing window
// between a WYSIWYG edit and its flush then got span patches applied at
// shifted offsets, silently corrupting the buffer (e.g. `\draw(2,2)) --`),
// and the corruption reached the store via the next CODE_EDITED.

const S0 = [
  "\\begin{tikzpicture}",
  "  \\draw (0,0) -- (1,1);",
  "\\end{tikzpicture}"
].join("\n");

const OLD_COORD = "(0,0)";
const NEW_COORD = "(2,2)";
const COORD_FROM = S0.indexOf(OLD_COORD);

// The store-side WYSIWYG edit: a move rewrote (0,0) -> (2,2) at revision 7,
// producing source S1 at revision 8 plus the span patch below.
const S1 = S0.slice(0, COORD_FROM) + NEW_COORD + S0.slice(COORD_FROM + OLD_COORD.length);
const PATCHES = [
  {
    oldSpan: { from: COORD_FROM, to: COORD_FROM + OLD_COORD.length },
    newSpan: { from: COORD_FROM, to: COORD_FROM + NEW_COORD.length },
    replacement: NEW_COORD
  }
];

// A second store edit on top of S1: (1,1) -> (3,3) at revision 8 -> S2/9.
const S1_OLD_END = "(1,1)";
const S1_NEW_END = "(3,3)";
const S1_END_FROM = S1.indexOf(S1_OLD_END);
const S2 = S1.slice(0, S1_END_FROM) + S1_NEW_END + S1.slice(S1_END_FROM + S1_OLD_END.length);
const CHAIN = [
  { baseRevision: 7, sourceRevision: 8, patches: PATCHES },
  {
    baseRevision: 8,
    sourceRevision: 9,
    patches: [
      {
        oldSpan: { from: S1_END_FROM, to: S1_END_FROM + S1_OLD_END.length },
        newSpan: { from: S1_END_FROM, to: S1_END_FROM + S1_NEW_END.length },
        replacement: S1_NEW_END
      }
    ]
  }
];

function makeView(doc: string): { view: EditorView; sync: ExternalSourceSyncManager } {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [externalSourceSyncPlugin] })
  });
  const sync: ExternalSourceSyncManager | null = view.plugin(externalSourceSyncPlugin);
  if (!sync) {
    throw new Error("externalSourceSyncPlugin instance not found");
  }
  return { view, sync };
}

describe("SourcePanel external source sync", () => {
  it("applies verified patches when the buffer matches the patch base", () => {
    const { view, sync } = makeView(S0);
    sync.syncExternalSource(S1, 8, PATCHES, null, true);
    expect(view.state.doc.toString()).toBe(S1);
    view.destroy();
  });

  it("applies a verified patch chain accumulated across coalesced flushes", () => {
    const { view, sync } = makeView(S0);
    sync.syncExternalSource(S2, 9, CHAIN[1].patches, CHAIN, true);
    expect(view.state.doc.toString()).toBe(S2);
    view.destroy();
  });

  it("falls back to a full replace when a keystroke landed before the flush", () => {
    const { view, sync } = makeView(S0);

    // A keystroke lands in the editor during the coalescing window: the user
    // types "%" at the start of the document. The buffer no longer matches
    // the base the patches were computed against, so applying their offsets
    // would corrupt the text (this used to produce `\draw(2,2)) --`).
    view.dispatch({ changes: { from: 0, insert: "%" } });
    sync.syncExternalSource(S1, 8, PATCHES, null, true);

    // The sync must converge the buffer to the store source. Dropping the
    // unsynced keystroke via full replace is the accepted degraded mode.
    expect(view.state.doc.toString()).toBe(S1);
    view.destroy();
  });

  it("falls back to a full replace when the buffer diverged before a chain flush", () => {
    const { view, sync } = makeView(S0);
    view.dispatch({ changes: { from: 0, insert: "%" } });
    sync.syncExternalSource(S2, 9, CHAIN[1].patches, CHAIN, true);
    expect(view.state.doc.toString()).toBe(S2);
    view.destroy();
  });

  it("does not apply patches whose revisions collide across document switches", () => {
    // Revision numbers are per-document counters. Simulate a document switch
    // where the new document's pending patches carry revision numbers that
    // happen to line up with the manager's bookkeeping from the old document:
    // content verification must reject them and replace the whole buffer.
    const { view, sync } = makeView(S0);
    sync.syncExternalSource(S1, 8, PATCHES, null, true);

    const OTHER_DOC = [
      "\\begin{tikzpicture}",
      "  \\node at (0,0) {other document};",
      "\\end{tikzpicture}"
    ].join("\n");
    const otherPatches = [
      {
        oldSpan: { from: 22, to: 27 },
        newSpan: { from: 22, to: 27 },
        replacement: "(4,4)"
      }
    ];
    sync.syncExternalSource(OTHER_DOC, 9, otherPatches, null, true);
    expect(view.state.doc.toString()).toBe(OTHER_DOC);
    view.destroy();
  });
});
