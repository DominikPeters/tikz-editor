import { describe, expect, it } from "vitest";
import { editorReducer, makeInitialState, DEFAULT_SOURCE } from "../packages/app/src/store/reducer.js";
import type { EditorAction, EditorState, HistoryEntry } from "../packages/app/src/store/types.js";
import type { TikzFigureInventoryItem } from "../packages/core/src/ast/types.js";
import { makeEmptySnapshot } from "../packages/app/src/compute.js";
import { PROPERTY_WRITE_CLEANUP_NOOP_REASON } from "../packages/core/src/edit/actions.js";
import type { WorldPoint } from "../packages/core/src/coords/points.js";
import type { EditHandle } from "../packages/core/src/semantic/types.js";
import { identityMatrix } from "../packages/core/src/semantic/transform.js";
import { computeSourceFingerprint } from "../packages/core/src/utils/source-fingerprint.js";
import { PT_PER_CM } from "../packages/core/src/edit/format.js";
import { wp } from "./coords-helpers.js";

// Helper to dispatch a sequence of actions
function applyActions(actions: EditorAction[], initial?: EditorState): EditorState {
  let state = initial ?? makeInitialState();
  for (const action of actions) {
    state = editorReducer(state, action);
  }
  return state;
}

const cm = (v: number) => v * PT_PER_CM;
const figureInventoryItem = (id: string): TikzFigureInventoryItem => ({
  id,
  span: { from: 0, to: 0 },
  beginSpan: { from: 0, to: 0 },
  endSpan: { from: 0, to: 0 },
  startLine: 1,
  endLine: 1
});

function makeHandle(
  source: string,
  overrides: Partial<EditHandle> & {
    world: WorldPoint;
    sourceSpan: { from: number; to: number };
    sourceId?: string;
  }
): EditHandle {
  const { world, sourceSpan, sourceId, ...rest } = overrides;
  const span = sourceSpan;
  const transform = rest.transform ?? identityMatrix();
  const kind = rest.kind ?? "path-point";
  const rewriteMode = rest.rewriteMode ?? "direct";
  return {
    id: `handle-${span.from}-${span.to}`,
    runtimeId: `runtime:handle-${span.from}-${span.to}`,
    sourceRef: {
      sourceId: sourceId ?? "elem-1",
      sourceSpan: span,
      sourceFingerprint: computeSourceFingerprint(source)
    },
    handleType: "coordinate",
    coordinateSpace: "frame-local",
    kind,
    world: world,
    local: rest.local ?? world,
    frame: rest.frame ?? transform,
    transform,
    sourceText: source.slice(span.from, span.to),
    coordinateForm: overrides.coordinateForm ?? "cartesian",
    rewriteMode,
    ...rest
  } as EditHandle;
}

function makeStateWithHandle(source: string = "\\draw (1,2) -- (3,4);"): { state: EditorState; handle: EditHandle } {
  const handle = makeHandle(source, {
    world: wp(cm(1), cm(2)),
    sourceSpan: { from: 6, to: 11 },
    sourceId: "elem-1"
  });

  const initial = makeInitialState();
  return {
    handle,
    state: {
      ...initial,
      source,
      snapshot: { ...makeEmptySnapshot(source), source, editHandles: [handle] }
    }
  };
}

function applySourcePatches(
  source: string,
  patches: ReadonlyArray<{ oldSpan: { from: number; to: number }; replacement: string }>
): string {
  let cursor = 0;
  let output = "";
  for (const patch of patches) {
    output += source.slice(cursor, patch.oldSpan.from);
    output += patch.replacement;
    cursor = patch.oldSpan.to;
  }
  output += source.slice(cursor);
  return output;
}

// ── CODE_EDITED ────────────────────────────────────────────────────────────────

describe("editorReducer – CODE_EDITED", () => {
  it("updates source when it changes", () => {
    const state = applyActions([{ type: "CODE_EDITED", source: "new source" }]);
    expect(state.source).toBe("new source");
  });

  it("clears WYSIWYG history on direct code edits", () => {
    const initial = makeInitialState();
    const withHistory: EditorState = {
      ...initial,
      history: [
        {
          kind: "move",
          label: "Moved element",
          forward: [],
          sourceBefore: "before",
          sourceAfter: "after"
        }
      ],
      historyIndex: 0
    };

    const next = editorReducer(withHistory, { type: "CODE_EDITED", source: "typed source" });
    expect(next.history).toEqual([]);
    expect(next.historyIndex).toBe(-1);
  });

  it("is a no-op when source is unchanged", () => {
    const initial = makeInitialState();
    const next = editorReducer(initial, { type: "CODE_EDITED", source: DEFAULT_SOURCE });
    expect(next).toBe(initial); // same reference = no change
  });

  it("records changed source ids and patches while source scrubbing is active", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1.5, -0.5);
\end{tikzpicture}`;
    const initial = applyActions([
      { type: "CODE_EDITED", source },
      { type: "SET_ACTIVE_SOURCE_SCRUB", sourceId: "path:0" }
    ]);
    const nextSource = source.replace("(1.5, -0.5)", "(1.75, -0.5)");
    const next = editorReducer(initial, {
      type: "CODE_EDITED",
      source: nextSource
    });

    expect(next.lastEditChangedSourceIds).toEqual(["path:0"]);
    expect(next.lastEditPatches).not.toBeNull();
    expect(next.lastEditPatches).toHaveLength(1);
    expect(next.lastEditPatchBaseRevision).toBe(initial.sourceRevision);
    const patch = next.lastEditPatches?.[0];
    expect(patch?.replacement.length).toBeGreaterThan(0);
    expect(applySourcePatches(source, next.lastEditPatches ?? [])).toBe(nextSource);
  });

  it("increments sourceRevision only when the source text changes", () => {
    const initial = makeInitialState();
    const edited = editorReducer(initial, {
      type: "CODE_EDITED",
      source: `${initial.source}\n% changed`
    });
    const selected = editorReducer(edited, { type: "SELECT", id: "path:0", additive: false });

    expect(initial.sourceRevision).toBe(0);
    expect(edited.sourceRevision).toBe(1);
    expect(selected.sourceRevision).toBe(1);
  });
});

// ── COMPUTE_REQUESTED / SNAPSHOT_READY ────────────────────────────────────────

describe("editorReducer – compute lifecycle", () => {
  it("COMPUTE_REQUESTED stores the pending request id", () => {
    const state = applyActions([{ type: "COMPUTE_REQUESTED", requestId: "req-1" }]);
    expect(state.pendingRequestId).toBe("req-1");
  });

  it("SNAPSHOT_READY updates snapshot when id matches", () => {
    const snap = { ...makeEmptySnapshot("hello"), revision: 5 };
    const state = applyActions([
      { type: "COMPUTE_REQUESTED", requestId: "req-1" },
      { type: "SNAPSHOT_READY", requestId: "req-1", snapshot: snap }
    ]);
    expect(state.snapshot.revision).toBe(5);
    expect(state.pendingRequestId).toBeNull();
  });

  it("SNAPSHOT_READY is ignored when id does not match (stale response)", () => {
    const initial = makeInitialState();
    const stale = applyActions([
      { type: "COMPUTE_REQUESTED", requestId: "req-2" }
    ], initial);

    const snap = makeEmptySnapshot("stale");
    const after = editorReducer(stale, {
      type: "SNAPSHOT_READY",
      requestId: "req-1",  // wrong id
      snapshot: snap
    });
    expect(after.pendingRequestId).toBe("req-2"); // unchanged
    expect(after.snapshot.source).toBe(DEFAULT_SOURCE); // unchanged
  });

  it("auto-selects the first figure on first compute and clears active figure if it disappears", () => {
    const figureA = {
      id: "figure:a",
      span: { from: 0, to: 10 },
      beginSpan: { from: 0, to: 5 },
      endSpan: { from: 5, to: 10 },
      startLine: 1,
      endLine: 2
    };
    const figureB = {
      id: "figure:b",
      span: { from: 10, to: 20 },
      beginSpan: { from: 10, to: 15 },
      endSpan: { from: 15, to: 20 },
      startLine: 3,
      endLine: 4
    };
    const firstSnapshot = {
      ...makeEmptySnapshot("source"),
      source: "source",
      figures: [figureA, figureB],
      activeFigureId: null
    };
    const afterFirst = applyActions([
      { type: "COMPUTE_REQUESTED", requestId: "req-1" },
      { type: "SNAPSHOT_READY", requestId: "req-1", snapshot: firstSnapshot }
    ]);
    expect(afterFirst.activeFigureId).toBe("figure:a");

    const switched = editorReducer(afterFirst, { type: "SET_ACTIVE_FIGURE", figureId: "figure:b" });
    expect(switched.activeFigureId).toBe("figure:b");

    const secondSnapshot = {
      ...firstSnapshot,
      figures: [figureA],
      activeFigureId: null
    };
    const afterRemoval = applyActions([
      { type: "COMPUTE_REQUESTED", requestId: "req-2" },
      { type: "SNAPSHOT_READY", requestId: "req-2", snapshot: secondSnapshot }
    ], switched);
    expect(afterRemoval.activeFigureId).toBeNull();
  });

  it("auto-selects the first figure when source changes from no figures to one figure", () => {
    const figure = {
      id: "figure:0",
      span: { from: 0, to: 10 },
      beginSpan: { from: 0, to: 5 },
      endSpan: { from: 5, to: 10 },
      startLine: 1,
      endLine: 2
    };
    const emptySnapshot = {
      ...makeEmptySnapshot(""),
      source: "",
      figures: [],
      activeFigureId: null
    };
    const emptyState = applyActions([
      { type: "CODE_EDITED", source: "" },
      { type: "COMPUTE_REQUESTED", requestId: "req-empty" },
      { type: "SNAPSHOT_READY", requestId: "req-empty", snapshot: emptySnapshot }
    ]);
    expect(emptyState.activeFigureId).toBeNull();

    const lineSnapshot = {
      ...makeEmptySnapshot("source"),
      source: "source",
      figures: [figure],
      activeFigureId: null
    };
    const afterLine = applyActions([
      { type: "CODE_EDITED", source: "source" },
      { type: "COMPUTE_REQUESTED", requestId: "req-line" },
      { type: "SNAPSHOT_READY", requestId: "req-line", snapshot: lineSnapshot }
    ], emptyState);

    expect(afterLine.activeFigureId).toBe("figure:0");
  });

  it("auto-selects first figure when figure count grows and the previous active figure became invalid", () => {
    const figure0 = {
      id: "figure:0",
      span: { from: 0, to: 10 },
      beginSpan: { from: 0, to: 5 },
      endSpan: { from: 5, to: 10 },
      startLine: 1,
      endLine: 2
    };
    const figureA = {
      id: "figure:a",
      span: { from: 20, to: 30 },
      beginSpan: { from: 20, to: 25 },
      endSpan: { from: 25, to: 30 },
      startLine: 3,
      endLine: 4
    };
    const figureB = {
      id: "figure:b",
      span: { from: 40, to: 50 },
      beginSpan: { from: 40, to: 45 },
      endSpan: { from: 45, to: 50 },
      startLine: 5,
      endLine: 6
    };

    const firstSnapshot = {
      ...makeEmptySnapshot("source-1"),
      source: "source-1",
      figures: [figure0],
      activeFigureId: null
    };
    const afterFirst = applyActions([
      { type: "COMPUTE_REQUESTED", requestId: "req-1" },
      { type: "SNAPSHOT_READY", requestId: "req-1", snapshot: firstSnapshot }
    ]);
    expect(afterFirst.activeFigureId).toBe("figure:0");

    const secondSnapshot = {
      ...makeEmptySnapshot("source-2"),
      source: "source-2",
      figures: [figureA, figureB],
      activeFigureId: null
    };
    const afterSecond = applyActions([
      { type: "CODE_EDITED", source: "source-2" },
      { type: "COMPUTE_REQUESTED", requestId: "req-2" },
      { type: "SNAPSHOT_READY", requestId: "req-2", snapshot: secondSnapshot }
    ], afterFirst);

    expect(afterSecond.activeFigureId).toBe("figure:a");
  });
});

// ── UNDO / REDO ────────────────────────────────────────────────────────────────

describe("editorReducer – UNDO / REDO", () => {
  it("UNDO is a no-op when history is empty", () => {
    const initial = makeInitialState();
    const after = editorReducer(initial, { type: "UNDO" });
    expect(after).toBe(initial);
  });

  it("REDO is a no-op when at the end of history", () => {
    const initial = makeInitialState();
    const after = editorReducer(initial, { type: "REDO" });
    expect(after).toBe(initial);
  });

  it("increments sourceRevision for undo and redo source changes", () => {
    const { state: initial, handle } = makeStateWithHandle();
    const edited = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: handle.id,
        newWorld: wp(cm(5), cm(6))
      }
    });

    expect(edited.sourceRevision).toBe(1);

    const undone = editorReducer(edited, { type: "UNDO" });
    expect(undone.sourceRevision).toBe(2);

    const redone = editorReducer(undone, { type: "REDO" });
    expect(redone.sourceRevision).toBe(3);
  });

  it("restores WYSIWYG selections across undo and redo", () => {
    const initial: EditorState = {
      ...makeInitialState(),
      source: "before",
      selectedElementIds: new Set(["path:0"]),
      snapshot: { ...makeEmptySnapshot("before"), source: "before" }
    };

    const edited = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "duplicateElements",
        elementIds: ["path:0"]
      },
      precomputedResult: {
        kind: "success",
        newSource: "after",
        patches: [],
        selectedSourceIds: ["path:2"]
      }
    });
    expect(edited.selectedElementIds).toEqual(new Set(["path:2"]));

    const undone = editorReducer(edited, { type: "UNDO" });
    expect(undone.source).toBe("before");
    expect(undone.selectedElementIds).toEqual(new Set(["path:0"]));

    const redone = editorReducer(undone, { type: "REDO" });
    expect(redone.source).toBe("after");
    expect(redone.selectedElementIds).toEqual(new Set(["path:2"]));
  });
});

// ── APPLY_EDIT_ACTION ──────────────────────────────────────────────────────────

describe("editorReducer – APPLY_EDIT_ACTION", () => {
  it("applies a successful edit action and pushes history", () => {
    const { state: initial, handle } = makeStateWithHandle();

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: handle.id,
        newWorld: wp(cm(5), cm(6))
      }
    });

    expect(next.source).toBe("\\draw (5,6) -- (3,4);");
    expect(next.history).toHaveLength(1);
    expect(next.historyIndex).toBe(0);
    expect(next.history[0]?.kind).toBe("move-handle");
    expect(next.history[0]?.sourceBefore).toBe("\\draw (1,2) -- (3,4);");
    expect(next.history[0]?.sourceAfter).toBe("\\draw (5,6) -- (3,4);");
  });

  it("coalesces drag updates that share the same history merge key", () => {
    const { state: initial, handle } = makeStateWithHandle();
    const mergeKey = "drag-elem-1";

    const first = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: handle.id,
        newWorld: wp(cm(5), cm(6))
      },
      historyMergeKey: mergeKey
    });

    const refreshedHandle = makeHandle(first.source, {
      world: wp(cm(5), cm(6)),
      sourceSpan: { from: 6, to: 11 },
      sourceId: "elem-1"
    });

    const withFreshSnapshot: EditorState = {
      ...first,
      snapshot: {
        ...first.snapshot,
        source: first.source,
        editHandles: [refreshedHandle]
      }
    };

    const second = editorReducer(withFreshSnapshot, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: refreshedHandle.id,
        newWorld: wp(cm(7), cm(8))
      },
      historyMergeKey: mergeKey
    });

    expect(second.history).toHaveLength(1);
    expect(second.historyIndex).toBe(0);
    expect(second.history[0]?.sourceBefore).toBe("\\draw (1,2) -- (3,4);");
    expect(second.history[0]?.sourceAfter).toBe("\\draw (7,8) -- (3,4);");
  });

  it("surfaces a warning for unsupported edit actions", () => {
    const initial = makeInitialState();
    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveElement",
        elementId: "missing",
        delta: wp(cm(1), cm(1))
      }
    });
    expect(next).not.toBe(initial);
    expect(next.source).toBe(initial.source);
    expect(next.lastEditWarningMessage).toContain("Edit action skipped");
    expect(next.lastEditWarningToken).toBe(initial.lastEditWarningToken + 1);
  });

  it("applies precomputed edit results without recomputing the action", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      snapshot: { ...makeEmptySnapshot(source), source, editHandles: [] }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: "missing-handle-id",
        newWorld: wp(cm(5), cm(6))
      },
      precomputedResult: {
        kind: "success",
        newSource: "\\draw (5,6) -- (3,4);",
        patches: [
          {
            oldSpan: { from: 6, to: 11 },
            newSpan: { from: 6, to: 11 },
            replacement: "(5,6)"
          }
        ],
        changedSourceIds: ["elem-1"]
      }
    });

    expect(next.source).toBe("\\draw (5,6) -- (3,4);");
    expect(next.history).toHaveLength(1);
    expect(next.history[0]?.kind).toBe("move-handle");
    expect(next.lastEditChangedSourceIds).toEqual(["elem-1"]);
  });

  it("keeps source patches for path-attached node moves while disabling changed-id incremental render", () => {
    const source = "\\draw (0,0) -- node[above] {r} (1,0);";
    const oldNodeSyntax = "node[above]";
    const oldNodeFrom = source.indexOf(oldNodeSyntax);
    const oldNodeTo = oldNodeFrom + oldNodeSyntax.length;
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      snapshot: { ...makeEmptySnapshot(source), source, editHandles: [] }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "movePathAttachedNode",
        nodeId: "node:0:2",
        hostPathSourceId: "path:0",
        pos: 0.6,
        preserveRegime: true
      },
      precomputedResult: {
        kind: "success",
        newSource: "\\draw (0,0) -- node[pos=0.6,above] {r} (1,0);",
        patches: [
          {
            oldSpan: { from: oldNodeFrom, to: oldNodeTo },
            newSpan: { from: oldNodeFrom, to: oldNodeFrom + "node[pos=0.6,above]".length },
            replacement: "node[pos=0.6,above]"
          }
        ],
        changedSourceIds: ["node:0:2"]
      }
    });

    expect(next.lastEditChangedSourceIds).toBeNull();
    expect(next.lastEditPatches).toHaveLength(1);
    expect(applySourcePatches(source, next.lastEditPatches ?? [])).toBe(next.source);
  });

  it("is a no-op when an edit action rewrites to the same source text", () => {
    const { state: initial } = makeStateWithHandle();

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveElement",
        elementId: "elem-1",
        delta: wp(0.01, 0)
      }
    });

    expect(next).toBe(initial);
  });

  it("replaces selected ids when the edit result provides selectedSourceIds", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      selectedElementIds: new Set(["path:0"]),
      snapshot: { ...makeEmptySnapshot(source), source }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "pasteStatements",
        snippets: ["\\draw (2,2) -- (3,2);"],
        anchorElementId: "path:0"
      }
    });

    expect(next).not.toBe(initial);
    expect(next.selectedElementIds).not.toEqual(new Set(["path:0"]));
    expect(next.selectedElementIds.size).toBe(1);
  });

  it("records reorder actions with reorder history kind and label", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      snapshot: { ...makeEmptySnapshot(source), source }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "reorderElements",
        elementIds: ["path:0"],
        direction: "bringForward"
      }
    });

    expect(next.history).toHaveLength(1);
    expect(next.history[0]?.kind).toBe("reorder");
    expect(next.history[0]?.label).toBe("Reordered elements");
  });

  it("records align actions with align history kind and label", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,1) -- (3,1);
\end{tikzpicture}`;
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      snapshot: { ...makeEmptySnapshot(source), source }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "alignElements",
        elementIds: ["path:0", "path:1"],
        mode: "left"
      }
    });

    expect(next.history).toHaveLength(1);
    expect(next.history[0]?.kind).toBe("align");
    expect(next.history[0]?.label).toBe("Aligned elements");
  });

  it("records distribute actions with distribute history kind and label", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,0) -- (3,0);
  \draw (10,0) -- (11,0);
\end{tikzpicture}`;
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      snapshot: { ...makeEmptySnapshot(source), source }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "distributeElements",
        elementIds: ["path:0", "path:1", "path:2"],
        axis: "horizontal"
      }
    });

    expect(next.history).toHaveLength(1);
    expect(next.history[0]?.kind).toBe("distribute");
    expect(next.history[0]?.label).toBe("Distributed elements");
  });

  it("records resize actions with resize history kind and updates source", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      snapshot: { ...makeEmptySnapshot(source), source }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "resizeElement",
        elementId: "path:0",
        role: "bottom-right",
        newWorld: wp(100, 100)
      }
    });

    expect(next.source).not.toBe(source);
    expect(next.source).toContain("minimum width=");
    expect(next.source).toContain("minimum height=");
    expect(next.history).toHaveLength(1);
    expect(next.history[0]?.kind).toBe("resize");
    expect(next.history[0]?.label).toBe("Resized element");
  });

  it("increments sourceRevision for successful edit actions, including transient previews", () => {
    const { state: initial, handle } = makeStateWithHandle();
    const preview = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: handle.id,
        newWorld: wp(cm(5), cm(6))
      },
      recordInHistory: false
    });

    expect(preview.sourceRevision).toBe(1);

    const committed = editorReducer(preview, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: makeHandle(preview.source, {
          world: wp(cm(5), cm(6)),
          sourceSpan: { from: 6, to: 11 },
          sourceId: "elem-1"
        }).id,
        newWorld: wp(cm(7), cm(8))
      },
      precomputedResult: {
        kind: "success",
        newSource: "\\draw (7,8) -- (3,4);",
        patches: [
          {
            oldSpan: { from: 6, to: 11 },
            newSpan: { from: 6, to: 11 },
            replacement: "(7,8)"
          }
        ],
        changedSourceIds: ["elem-1"]
      }
    });

    expect(committed.sourceRevision).toBe(2);
  });

  it("surfaces partial edit reasons as warnings while applying the source change", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const initial: EditorState = {
      ...makeInitialState(),
      source,
      snapshot: { ...makeEmptySnapshot(source), source, editHandles: [] }
    };

    const next = editorReducer(initial, {
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "moveHandle",
        handleId: "unused",
        newWorld: wp(cm(5), cm(6))
      },
      precomputedResult: {
        kind: "partial",
        newSource: "\\draw (5,6) -- (3,4);",
        patches: [
          {
            oldSpan: { from: 6, to: 11 },
            newSpan: { from: 6, to: 11 },
            replacement: "(5,6)"
          }
        ],
        skippedHandles: [],
        reason: "fallback path used"
      }
    });

    expect(next.source).toBe("\\draw (5,6) -- (3,4);");
    expect(next.lastEditWarningMessage).toBe("fallback path used");
    expect(next.lastEditWarningToken).toBe(initial.lastEditWarningToken + 1);
  });
});

// ── SELECT / CLEAR_SELECTION ───────────────────────────────────────────────────

describe("editorReducer – selection", () => {
  it("SELECT sets the selected id (non-additive)", () => {
    const state = applyActions([{ type: "SELECT", id: "elem-1", additive: false }]);
    expect(state.selectedElementIds).toEqual(new Set(["elem-1"]));
  });

  it("SELECT with additive adds to selection", () => {
    const state = applyActions([
      { type: "SELECT", id: "elem-1", additive: false },
      { type: "SELECT", id: "elem-2", additive: true }
    ]);
    expect(state.selectedElementIds).toEqual(new Set(["elem-1", "elem-2"]));
  });

  it("SELECT with additive on existing id removes it", () => {
    const state = applyActions([
      { type: "SELECT", id: "elem-1", additive: false },
      { type: "SELECT", id: "elem-1", additive: true }
    ]);
    expect(state.selectedElementIds.size).toBe(0);
  });

  it("CLEAR_SELECTION empties the selection", () => {
    const state = applyActions([
      { type: "SELECT", id: "elem-1", additive: false },
      { type: "CLEAR_SELECTION" }
    ]);
    expect(state.selectedElementIds.size).toBe(0);
    expect(state.focusedScopeId).toBeNull();
  });

  it("CLEAR_SELECTION is a no-op when already empty", () => {
    const initial = makeInitialState();
    const after = editorReducer(initial, { type: "CLEAR_SELECTION" });
    expect(after).toBe(initial);
  });

  it("CLEAR_SELECTION can preserve focused scope", () => {
    const state = applyActions([
      { type: "SET_FOCUSED_SCOPE", scopeId: "scope:0" },
      { type: "SELECT", id: "scope:0", additive: false },
      { type: "CLEAR_SELECTION", preserveFocusedScope: true }
    ]);
    expect(state.selectedElementIds.size).toBe(0);
    expect(state.focusedScopeId).toBe("scope:0");
  });

  it("SET_FOCUSED_SCOPE updates focus id", () => {
    const state = applyActions([{ type: "SET_FOCUSED_SCOPE", scopeId: "scope:1" }]);
    expect(state.focusedScopeId).toBe("scope:1");
  });

  it("SELECT_RANGE sets multiple ids", () => {
    const state = applyActions([
      { type: "SELECT_RANGE", ids: ["elem-1", "elem-2", "elem-3"] }
    ]);
    expect(state.selectedElementIds).toEqual(new Set(["elem-1", "elem-2", "elem-3"]));
  });

});

// ── SET_TOOL_MODE ──────────────────────────────────────────────────────────────

describe("editorReducer – SET_TOOL_MODE", () => {
  it("updates tool mode", () => {
    const state = applyActions([{ type: "SET_TOOL_MODE", mode: "addNode" }]);
    expect(state.toolMode).toBe("addNode");
  });

  it("is a no-op when mode is unchanged", () => {
    const initial = makeInitialState();
    expect(initial.toolMode).toBe("select");
    const after = editorReducer(initial, { type: "SET_TOOL_MODE", mode: "select" });
    expect(after).toBe(initial);
  });
});

describe("editorReducer – SET_FREEHAND_SMOOTHING", () => {
  it("updates freehand smoothing value", () => {
    const state = applyActions([{ type: "SET_FREEHAND_SMOOTHING", value: 20 }]);
    expect(state.freehandSmoothingPx).toBe(20);
  });

  it("clamps smoothing value to supported bounds", () => {
    const low = applyActions([{ type: "SET_FREEHAND_SMOOTHING", value: -5 }]);
    expect(low.freehandSmoothingPx).toBe(4);

    const high = applyActions([{ type: "SET_FREEHAND_SMOOTHING", value: 999 }], low);
    expect(high.freehandSmoothingPx).toBe(32);
  });

  it("is a no-op when smoothing value is unchanged", () => {
    const initial = makeInitialState();
    expect(initial.freehandSmoothingPx).toBe(16);
    const after = editorReducer(initial, { type: "SET_FREEHAND_SMOOTHING", value: 16 });
    expect(after).toBe(initial);
  });
});

describe("editorReducer – SET_ADD_SHAPE_PRESET", () => {
  it("updates the selected add-shape preset", () => {
    const state = applyActions([{ type: "SET_ADD_SHAPE_PRESET", value: "diamond" }]);
    expect(state.selectedAddShape).toBe("diamond");
  });

  it("is a no-op when the preset is unchanged", () => {
    const initial = makeInitialState();
    expect(initial.selectedAddShape).toBe("rectangle");
    const after = editorReducer(initial, { type: "SET_ADD_SHAPE_PRESET", value: "rectangle" });
    expect(after).toBe(initial);
  });
});

describe("editorReducer – SET_ADD_MATRIX_PRESET", () => {
  it("updates selected matrix rows/columns", () => {
    const state = applyActions([{ type: "SET_ADD_MATRIX_PRESET", rows: 3, columns: 4 }]);
    expect(state.selectedAddMatrixRows).toBe(3);
    expect(state.selectedAddMatrixColumns).toBe(4);
  });

  it("clamps rows/columns to minimum 1", () => {
    const state = applyActions([{ type: "SET_ADD_MATRIX_PRESET", rows: 0, columns: -1 }]);
    expect(state.selectedAddMatrixRows).toBe(1);
    expect(state.selectedAddMatrixColumns).toBe(1);
  });

  it("is a no-op when preset is unchanged", () => {
    const initial = makeInitialState();
    expect(initial.selectedAddMatrixRows).toBe(2);
    expect(initial.selectedAddMatrixColumns).toBe(2);
    const after = editorReducer(initial, { type: "SET_ADD_MATRIX_PRESET", rows: 2, columns: 2 });
    expect(after).toBe(initial);
  });
});

// ── SET_CANVAS_TRANSFORM ───────────────────────────────────────────────────────

describe("editorReducer – SET_CANVAS_TRANSFORM", () => {
  it("updates canvas transform", () => {
    const transform = { translateX: 100, translateY: 50, scale: 2 };
    const state = applyActions([{ type: "SET_CANVAS_TRANSFORM", transform }]);
    expect(state.canvasTransform).toEqual(transform);
  });
});

describe("editorReducer – SET_HOVERED_ELEMENT", () => {
  it("updates hovered element id", () => {
    const state = applyActions([{ type: "SET_HOVERED_ELEMENT", id: "elem-1" }]);
    expect(state.hoveredElementId).toBe("elem-1");
  });

  it("is a no-op when hovered id is unchanged", () => {
    const initial = makeInitialState();
    const hovered = editorReducer(initial, { type: "SET_HOVERED_ELEMENT", id: "elem-1" });
    const unchanged = editorReducer(hovered, { type: "SET_HOVERED_ELEMENT", id: "elem-1" });
    expect(unchanged).toBe(hovered);
  });

  it("clears hovered element id", () => {
    const initial = makeInitialState();
    const hovered = editorReducer(initial, { type: "SET_HOVERED_ELEMENT", id: "elem-1" });
    const cleared = editorReducer(hovered, { type: "SET_HOVERED_ELEMENT", id: null });
    expect(cleared.hoveredElementId).toBeNull();
  });
});

// ── Layout ────────────────────────────────────────────────────────────────────

describe("editorReducer – layout", () => {
  it("initial layout flags match dock defaults", () => {
    const initial = makeInitialState();
    expect(initial.showSourcePanel).toBe(true);
    expect(initial.showInspectorPanel).toBe(true);
    expect(initial.showObjectsPanel).toBe(true);
    expect(initial.showStylesPanel).toBe(true);
    expect(initial.showFiguresPanel).toBe(false);
    expect(initial.showAssistantPanel).toBe(false);
  });

  it("SYNC_LAYOUT_STATE updates layout flags", () => {
    const state = applyActions([{
      type: "SYNC_LAYOUT_STATE",
      sourceVisible: false,
      inspectorVisible: false,
      objectsVisible: true,
      stylesVisible: true,
      figuresVisible: false,
      assistantVisible: false,
      activeRightTab: "objects" as const
    }]);
    expect(state.showSourcePanel).toBe(false);
    expect(state.showInspectorPanel).toBe(false);
    expect(state.showObjectsPanel).toBe(true);
    expect(state.rightSidebarTab).toBe("objects");
  });

  it("TOGGLE_PANEL toggles source panel", () => {
    const initial = makeInitialState();
    expect(initial.showSourcePanel).toBe(true);
    const after = editorReducer(initial, { type: "TOGGLE_PANEL", panel: "source" });
    expect(after.showSourcePanel).toBe(false);
    const restored = editorReducer(after, { type: "TOGGLE_PANEL", panel: "source" });
    expect(restored.showSourcePanel).toBe(true);
  });

  it("TOGGLE_PANEL toggles inspector panel", () => {
    const initial = makeInitialState();
    expect(initial.showInspectorPanel).toBe(true);
    const after = editorReducer(initial, { type: "TOGGLE_PANEL", panel: "inspector" });
    expect(after.showInspectorPanel).toBe(false);
  });

  it("SET_RIGHT_SIDEBAR_TAB switches to objects and keeps the sidebar visible", () => {
    const initial = makeInitialState();
    const after = editorReducer(initial, { type: "SET_RIGHT_SIDEBAR_TAB", tab: "objects" });
    expect(after.rightSidebarTab).toBe("objects");
    expect(after.showInspectorPanel).toBe(true);
  });

  it("TOGGLE_CANVAS_AID toggles canvas aid visibility", () => {
    const initial = makeInitialState();
    expect(initial.showGrid).toBe(true);
    expect(initial.showTransparencyGrid).toBe(false);
    expect(initial.snapModes).toEqual({ grid: true, guides: true, points: true, gaps: true });
    expect(initial.showRulers).toBe(true);
    expect(initial.showGuides).toBe(true);
    expect(initial.showDocumentBounds).toBe(true);

    const afterGrid = editorReducer(initial, { type: "TOGGLE_CANVAS_AID", aid: "grid" });
    expect(afterGrid.showGrid).toBe(false);
    expect(afterGrid.showTransparencyGrid).toBe(false);
    expect(afterGrid.showRulers).toBe(true);
    expect(afterGrid.showGuides).toBe(true);
    expect(afterGrid.showDocumentBounds).toBe(true);

    const afterRulers = editorReducer(afterGrid, { type: "TOGGLE_CANVAS_AID", aid: "rulers" });
    expect(afterRulers.showGrid).toBe(false);
    expect(afterRulers.showTransparencyGrid).toBe(false);
    expect(afterRulers.showRulers).toBe(false);
    expect(afterRulers.showGuides).toBe(true);
    expect(afterRulers.showDocumentBounds).toBe(true);

    const afterGuides = editorReducer(afterRulers, { type: "TOGGLE_CANVAS_AID", aid: "guides" });
    expect(afterGuides.showGrid).toBe(false);
    expect(afterGuides.showTransparencyGrid).toBe(false);
    expect(afterGuides.showRulers).toBe(false);
    expect(afterGuides.showGuides).toBe(false);
    expect(afterGuides.showDocumentBounds).toBe(true);
    expect(afterGuides.snapModes).toEqual({ grid: true, guides: true, points: true, gaps: true });

    const afterTransparencyGrid = editorReducer(afterGuides, { type: "TOGGLE_CANVAS_AID", aid: "transparencyGrid" });
    expect(afterTransparencyGrid.showTransparencyGrid).toBe(true);
    expect(afterTransparencyGrid.showDocumentBounds).toBe(true);

    const afterDocumentBounds = editorReducer(afterTransparencyGrid, { type: "TOGGLE_CANVAS_AID", aid: "documentBounds" });
    expect(afterDocumentBounds.showTransparencyGrid).toBe(true);
    expect(afterDocumentBounds.showDocumentBounds).toBe(false);
  });

  it("TOGGLE_SNAP_MODE toggles each snapping mode independently", () => {
    const initial = makeInitialState();
    expect(initial.showGrid).toBe(true);
    expect(initial.snapModes).toEqual({ grid: true, guides: true, points: true, gaps: true });

    const hiddenGrid = editorReducer(initial, { type: "TOGGLE_CANVAS_AID", aid: "grid" });
    expect(hiddenGrid.showGrid).toBe(false);
    expect(hiddenGrid.snapModes).toEqual({ grid: true, guides: true, points: true, gaps: true });

    const snapOff = editorReducer(hiddenGrid, { type: "TOGGLE_SNAP_MODE", mode: "grid" });
    expect(snapOff.showGrid).toBe(false);
    expect(snapOff.snapModes).toEqual({ grid: false, guides: true, points: true, gaps: true });

    const guidesOff = editorReducer(snapOff, { type: "TOGGLE_SNAP_MODE", mode: "guides" });
    expect(guidesOff.snapModes).toEqual({ grid: false, guides: false, points: true, gaps: true });

    const pointsOff = editorReducer(guidesOff, { type: "TOGGLE_SNAP_MODE", mode: "points" });
    expect(pointsOff.snapModes).toEqual({ grid: false, guides: false, points: false, gaps: true });

    const gapsOff = editorReducer(pointsOff, { type: "TOGGLE_SNAP_MODE", mode: "gaps" });
    expect(gapsOff.snapModes).toEqual({ grid: false, guides: false, points: false, gaps: false });
  });

  it("REQUEST_FIT_TO_CONTENT increments request token", () => {
    const initial = makeInitialState();
    expect(initial.fitToContentRequestToken).toBe(0);
    expect(initial.fitToContentModeActive).toBe(true);

    const next = editorReducer(initial, { type: "REQUEST_FIT_TO_CONTENT" });
    expect(next.fitToContentRequestToken).toBe(1);
    expect(next.fitToContentModeActive).toBe(true);

    const next2 = editorReducer(next, { type: "REQUEST_FIT_TO_CONTENT" });
    expect(next2.fitToContentRequestToken).toBe(2);
  });

  it("SET_FIT_TO_CONTENT_MODE updates fit tracking without issuing a fit request", () => {
    const initial = makeInitialState();
    const disabled = editorReducer(initial, { type: "SET_FIT_TO_CONTENT_MODE", active: false });

    expect(disabled.fitToContentModeActive).toBe(false);
    expect(disabled.fitToContentRequestToken).toBe(initial.fitToContentRequestToken);

    const disabledAgain = editorReducer(disabled, { type: "SET_FIT_TO_CONTENT_MODE", active: false });
    expect(disabledAgain).toBe(disabled);

    const enabled = editorReducer(disabled, { type: "SET_FIT_TO_CONTENT_MODE", active: true });
    expect(enabled.fitToContentModeActive).toBe(true);
    expect(enabled.fitToContentRequestToken).toBe(initial.fitToContentRequestToken);
  });

  it("SET_CANVAS_STATUS_HINT updates transient canvas guidance", () => {
    const initial = makeInitialState();
    expect(initial.canvasStatusHint).toBeNull();

    const hinted = editorReducer(initial, {
      type: "SET_CANVAS_STATUS_HINT",
      hint: "Double-click path to add a point."
    });
    expect(hinted.canvasStatusHint).toBe("Double-click path to add a point.");

    const hintedAgain = editorReducer(hinted, {
      type: "SET_CANVAS_STATUS_HINT",
      hint: "Double-click path to add a point."
    });
    expect(hintedAgain).toBe(hinted);

    const cleared = editorReducer(hinted, { type: "SET_CANVAS_STATUS_HINT", hint: null });
    expect(cleared.canvasStatusHint).toBeNull();
  });
});

// ── TOGGLE_DEV_PANEL ──────────────────────────────────────────────────────────

describe("editorReducer – TOGGLE_DEV_PANEL", () => {
  it("toggles dev panel visibility", () => {
    const initial = makeInitialState();
    expect(initial.showDevPanel).toBe(false);
    const after = editorReducer(initial, { type: "TOGGLE_DEV_PANEL" });
    expect(after.showDevPanel).toBe(true);
    const restored = editorReducer(after, { type: "TOGGLE_DEV_PANEL" });
    expect(restored.showDevPanel).toBe(false);
  });
});

describe("editorReducer – branch edge cases", () => {
  it("keeps document actions no-op for missing or unchanged targets", () => {
    const initial = makeInitialState();
    expect(editorReducer(initial, { type: "SWITCH_DOCUMENT", documentId: "missing" })).toBe(initial);
    expect(editorReducer(initial, { type: "CLOSE_DOCUMENT", documentId: "missing" })).toBe(initial);
    expect(editorReducer(initial, { type: "REORDER_TABS", fromId: initial.activeDocumentId, toId: initial.activeDocumentId })).toBe(initial);
    expect(editorReducer(initial, { type: "SET_ACTIVE_FIGURE", figureId: null })).toBe(initial);
    expect(editorReducer(initial, { type: "COMPUTE_REQUESTED", requestId: "req-missing", documentId: "missing" })).toBe(initial);
  });

  it("handles close, reorder, active figure, and disk replacement fallbacks", () => {
    const initial = makeInitialState();
    const withSecond = editorReducer(initial, { type: "NEW_DOCUMENT", source: "second", title: "Second" });
    const firstId = initial.activeDocumentId;
    const secondId = withSecond.activeDocumentId;

    const figureChanged = editorReducer(withSecond, { type: "SET_ACTIVE_FIGURE", figureId: "figure:1", documentId: secondId });
    expect(figureChanged.activeFigureId).toBe("figure:1");

    const reordered = editorReducer(figureChanged, { type: "REORDER_TABS", fromId: secondId, toId: firstId });
    expect(reordered.tabOrder[0]).toBe(secondId);

    const replacedSameSource = editorReducer(reordered, {
      type: "REPLACE_DOCUMENT_SOURCE_FROM_DISK",
      documentId: secondId,
      source: "second",
      diskRevision: { hash: "disk" }
    });
    expect(replacedSameSource.sourceRevision).toBe(reordered.sourceRevision);
    expect(replacedSameSource.documents[secondId]?.title).toBe("Second");

    const closedInactive = editorReducer(replacedSameSource, { type: "CLOSE_DOCUMENT", documentId: firstId });
    expect(closedInactive.activeDocumentId).toBe(secondId);
    expect(closedInactive.recentDocumentIds).not.toContain(firstId);
  });

  it("applies current, stale, and rejected compute snapshots correctly", () => {
    const source = "\\draw (0,0)--(1,1);";
    const initial = editorReducer(makeInitialState(), { type: "CODE_EDITED", source });
    const requested = editorReducer(initial, { type: "COMPUTE_REQUESTED", requestId: "req-1" });
    const activeHandleId = "handle-1";
    const withHandle = {
      ...requested,
      activeHandleId,
      documents: {
        ...requested.documents,
        [requested.activeDocumentId]: {
          ...requested.documents[requested.activeDocumentId],
          activeHandleId
        }
      }
    };
    const currentSnapshot = {
      ...makeEmptySnapshot(source),
      source,
      figures: [figureInventoryItem("figure:0"), figureInventoryItem("figure:1")],
      editHandles: [makeHandle(source, {
        id: activeHandleId,
        world: wp(0, 0),
        sourceSpan: { from: 0, to: 0 }
      })]
    };

    const ready = editorReducer(withHandle, {
      type: "SNAPSHOT_READY",
      requestId: "req-1",
      snapshot: currentSnapshot
    });
    expect(ready.pendingRequestId).toBeNull();
    expect(ready.activeFigureId).toBe("figure:0");
    expect(ready.activeHandleId).toBe(activeHandleId);

    const staleIgnored = editorReducer(ready, {
      type: "SNAPSHOT_READY",
      requestId: "stale",
      snapshot: { ...makeEmptySnapshot("ignored"), source: "ignored" }
    });
    expect(staleIgnored).toBe(ready);

    const dragging = editorReducer(ready, { type: "SET_ACTIVE_CANVAS_DRAG", kind: "element" });
    const staleDrag = editorReducer(dragging, {
      type: "SNAPSHOT_READY",
      requestId: "stale",
      snapshot: { ...makeEmptySnapshot("drag-source"), source: "drag-source", figures: [figureInventoryItem("figure:9")] }
    });
    expect(staleDrag.snapshot.source).toBe("drag-source");
    expect(staleDrag.pendingRequestId).toBeNull();
    expect(staleDrag.activeHandleId).toBeNull();
  });

  it("records history labels for precomputed edit-action families and no-ops cleanup warnings", () => {
    let state = makeInitialState();
    const cases: Array<[string, HistoryEntry["kind"]]> = [
      ["splitPath", "path-edit"],
      ["groupElements", "add-element"],
      ["ungroupElements", "delete"],
      ["reorderElements", "reorder"],
      ["alignElements", "align"],
      ["distributeElements", "distribute"],
      ["flattenForeach", "flatten-foreach"],
      ["resizeElement", "resize"]
    ];

    for (const [kind, expectedHistoryKind] of cases) {
      const previousSource = state.source;
      const nextSource = `${previousSource}\n% ${kind}`;
      state = editorReducer(state, {
        type: "APPLY_EDIT_ACTION",
        action: { kind } as never,
        precomputedSource: previousSource,
        precomputedResult: {
          kind: "success",
          newSource: nextSource,
          patches: [{
            oldSpan: { from: previousSource.length, to: previousSource.length },
            newSpan: { from: nextSource.length, to: nextSource.length },
            replacement: `\n% ${kind}`
          }]
        }
      });
      expect(state.history[state.historyIndex]?.kind).toBe(expectedHistoryKind);
    }

    const cleanupNoop = editorReducer(state, {
      type: "APPLY_EDIT_ACTION",
      action: { kind: "cleanupPropertyWrites" },
      precomputedResult: {
        kind: "unsupported",
        reason: PROPERTY_WRITE_CLEANUP_NOOP_REASON
      }
    } as unknown as EditorAction);
    expect(cleanupNoop).toBe(state);
  });

  it("covers selection and UI no-op branches", () => {
    const initial = makeInitialState();
    const selected = editorReducer(initial, { type: "SELECT", id: "path:0", additive: false });
    expect(editorReducer(selected, { type: "SELECT", id: "path:0", additive: false })).toBe(selected);
    const focused = editorReducer(selected, { type: "SET_FOCUSED_SCOPE", scopeId: "scope:0" });
    expect(editorReducer(focused, { type: "SET_FOCUSED_SCOPE", scopeId: "scope:0" })).toBe(focused);
    const handle = editorReducer(focused, { type: "SET_ACTIVE_HANDLE", handleId: "handle:0" });
    expect(editorReducer(handle, { type: "SET_ACTIVE_HANDLE", handleId: "handle:0" })).toBe(handle);

    const drag = editorReducer(handle, { type: "SET_ACTIVE_CANVAS_DRAG", kind: "element" });
    expect(editorReducer(drag, { type: "SET_ACTIVE_CANVAS_DRAG", kind: "element" })).toBe(drag);
    const scrub = editorReducer(drag, { type: "SET_ACTIVE_SOURCE_SCRUB", sourceId: "path:0" });
    expect(editorReducer(scrub, { type: "SET_ACTIVE_SOURCE_SCRUB", sourceId: "path:0" })).toBe(scrub);
    const textEdit = editorReducer(scrub, { type: "SET_ACTIVE_CANVAS_TEXT_EDIT", sourceId: "node:0" });
    expect(editorReducer(textEdit, { type: "SET_ACTIVE_CANVAS_TEXT_EDIT", sourceId: "node:0" })).toBe(textEdit);
  });

  it("normalizes scalar UI settings and rejects invalid values", () => {
    let state = makeInitialState();
    expect(editorReducer(state, { type: "SET_BUCKET_FILL_COLOR", value: "   " })).toBe(state);
    state = editorReducer(state, { type: "SET_BUCKET_FILL_COLOR", value: " Red!50 " });
    expect(state.bucketFillColor).toBe("red!50");
    expect(editorReducer(state, { type: "SET_BUCKET_FILL_COLOR", value: "red!50" })).toBe(state);

    expect(editorReducer(state, { type: "SET_CREATION_STROKE_COLOR", value: "" })).toBe(state);
    state = editorReducer(state, { type: "SET_CREATION_STROKE_COLOR", value: " Blue " });
    expect(state.creationStrokeColor).toBe("blue");
    expect(editorReducer(state, { type: "SET_CREATION_STROKE_COLOR", value: "blue" })).toBe(state);

    state = editorReducer(state, { type: "SET_CREATION_FILL_COLOR", value: " Green " });
    expect(state.creationFillColor).toBe("green");
    expect(editorReducer(state, { type: "SET_CREATION_FILL_COLOR", value: "green" })).toBe(state);

    expect(editorReducer(state, { type: "REQUEST_ZOOM_SCALE", scale: 0 })).toBe(state);
    const zoomed = editorReducer(state, { type: "REQUEST_ZOOM_SCALE", scale: 1.5 });
    expect(zoomed.zoomScaleRequestValue).toBe(1.5);
    const fitScale = editorReducer(zoomed, { type: "SET_CANVAS_FIT_TO_CONTENT_SCALE", scale: 2 });
    expect(fitScale.canvasFitToContentScale).toBe(2);
    expect(editorReducer(fitScale, { type: "SET_CANVAS_FIT_TO_CONTENT_SCALE", scale: 2 })).toBe(fitScale);
    const invalidFitScale = editorReducer(fitScale, { type: "SET_CANVAS_FIT_TO_CONTENT_SCALE", scale: Number.NaN });
    expect(invalidFitScale.canvasFitToContentScale).toBeNull();
  });

  it("handles sidebar, zoom, and assistant-locked tool-mode edge branches", () => {
    const initial = makeInitialState();
    expect(editorReducer(initial, { type: "SET_RIGHT_SIDEBAR_TAB", tab: "inspector" })).toBe(initial);

    const zoomed = editorReducer(initial, { type: "REQUEST_ZOOM", direction: "in" });
    expect(zoomed.zoomRequestToken).toBe(initial.zoomRequestToken + 1);
    expect(zoomed.zoomRequestDirection).toBe("in");

    const locked = editorReducer(initial, {
      type: "ASSISTANT_TURN_STATUS",
      status: "starting",
      turnId: "turn-locked"
    });
    expect(editorReducer(locked, { type: "SET_TOOL_MODE", mode: "addNode" })).toBe(locked);
  });
});

describe("editorReducer – assistant integration", () => {
  it("applies assistant source updates to the active document", () => {
    const initial = makeInitialState();
    const next = editorReducer(initial, {
      type: "ASSISTANT_SOURCE_UPDATED",
      source: "\\draw (5,5)--(6,6);",
      revisionToken: "rev-1"
    });
    expect(next.source).toBe("\\draw (5,5)--(6,6);");
    expect(next.documents[next.activeDocumentId]?.assistantLastSourceRevision).toBe("rev-1");
  });

  it("coalesces assistant source updates into one undo entry per turn", () => {
    const initial = makeInitialState();
    const first = editorReducer(initial, {
      type: "ASSISTANT_SOURCE_UPDATED",
      source: "\\draw (1,1)--(2,2);",
      revisionToken: "rev-1",
      historyMergeKey: "assistant-turn:doc"
    });
    const second = editorReducer(first, {
      type: "ASSISTANT_SOURCE_UPDATED",
      source: "\\draw (3,3)--(4,4);",
      revisionToken: "rev-2",
      historyMergeKey: "assistant-turn:doc"
    });

    expect(second.history).toHaveLength(1);
    expect(second.history[0]?.label).toBe("AI assistant edit");
    expect(second.history[0]?.sourceBefore).toBe(DEFAULT_SOURCE);
    expect(second.history[0]?.sourceAfter).toBe("\\draw (3,3)--(4,4);");
  });

  it("blocks direct user edits while the assistant lock is active", () => {
    const initial = makeInitialState();
    const locked = editorReducer(initial, {
      type: "ASSISTANT_TURN_STATUS",
      status: "inProgress",
      turnId: "turn-1"
    });
    const afterEdit = editorReducer(locked, {
      type: "CODE_EDITED",
      source: "\\draw (9,9)--(10,10);"
    });
    expect(afterEdit.source).toBe(initial.source);
    expect(afterEdit.documents[afterEdit.activeDocumentId]?.assistantLockReason).toBeTruthy();
  });

  it("updates assistant thread metadata, items, deltas, approvals, and error state", () => {
    let state = makeInitialState();
    const activeDoc = () => state.documents[state.activeDocumentId];
    state = editorReducer(state, {
      type: "ASSISTANT_THREAD_READY",
      threadId: "thread-1",
      workspacePath: "/tmp/ws",
      figurePath: "/tmp/ws/figure.tex",
      previewPath: "/tmp/ws/current.png"
    });
    expect(activeDoc().assistantThreadId).toBe("thread-1");

    state = editorReducer(state, {
      type: "ASSISTANT_THREAD_LOADED",
      state: {
        threadId: "thread-2",
        workspacePath: "/tmp/ws2",
        figurePath: "/tmp/ws2/figure.tex",
        previewPath: "/tmp/ws2/current.png",
        items: [{ type: "agentMessage", id: "agent-1", text: "hello" }]
      }
    });
    expect(activeDoc().assistantThreadId).toBe("thread-2");
    expect(activeDoc().assistantItems).toHaveLength(1);

    state = {
      ...state,
      documents: {
        ...state.documents,
        [state.activeDocumentId]: {
          ...state.documents[state.activeDocumentId],
          assistantItems: [
            { type: "userMessage", id: "optimistic-user-message:1", content: [] },
            ...activeDoc().assistantItems
          ]
        }
      }
    };
    state = editorReducer(state, {
      type: "ASSISTANT_ITEM_STARTED",
      item: { type: "userMessage", id: "user-1", content: [{ type: "text", text: "actual" }] }
    });
    expect(activeDoc().assistantItems.map((item) => item.id)).toEqual(["agent-1", "user-1"]);

    state = editorReducer(state, {
      type: "ASSISTANT_ITEM_UPDATED",
      item: { type: "agentMessage", id: "agent-1", text: "hello world" }
    });
    expect(activeDoc().assistantItems.find((item) => item.id === "agent-1")).toMatchObject({ text: "hello world" });

    for (const [item, deltaType, expected] of [
      [{ type: "plan", id: "plan-1", text: "" }, "item/plan/delta", { text: " plan" }],
      [{ type: "reasoning", id: "reason-1" }, "item/reasoning/summaryTextDelta", { summary: " plan" }],
      [{ type: "reasoning", id: "reason-2" }, "item/reasoning/textDelta", { content: " plan" }],
      [{ type: "commandExecution", id: "cmd-1" }, "item/commandExecution/outputDelta", { aggregatedOutput: " plan" }]
    ] as const) {
      state = editorReducer(state, { type: "ASSISTANT_ITEM_COMPLETED", item });
      state = editorReducer(state, {
        type: "ASSISTANT_ITEM_DELTA",
        itemId: item.id,
        deltaType,
        delta: " plan"
      });
      expect(activeDoc().assistantItems.find((entry) => entry.id === item.id)).toMatchObject(expected);
    }

    const missingDelta = editorReducer(state, {
      type: "ASSISTANT_ITEM_DELTA",
      itemId: "missing",
      deltaType: "item/agentMessage/delta",
      delta: "ignored"
    });
    expect(missingDelta).toBe(state);

    state = editorReducer(state, {
      type: "ASSISTANT_APPROVAL_REQUESTED",
      approval: { kind: "command", requestId: "approval-1", itemId: "cmd-1", threadId: "thread-2", turnId: "turn-1" }
    });
    state = editorReducer(state, {
      type: "ASSISTANT_APPROVAL_REQUESTED",
      approval: { kind: "command", requestId: "approval-1", itemId: "cmd-1", threadId: "thread-2", turnId: "turn-2" }
    });
    expect(activeDoc().assistantPendingApprovals).toHaveLength(1);
    expect(activeDoc().assistantPendingApprovals[0]?.turnId).toBe("turn-2");

    state = editorReducer(state, { type: "ASSISTANT_APPROVAL_CLEARED", requestId: "approval-1" });
    expect(activeDoc().assistantPendingApprovals).toEqual([]);

    state = editorReducer(state, { type: "ASSISTANT_SET_ERROR", message: "failed" });
    expect(activeDoc().assistantError).toBe("failed");
    state = editorReducer(state, { type: "ASSISTANT_NEW_CHAT" });
    expect(activeDoc().assistantThreadId).toBeNull();
    expect(activeDoc().assistantError).toBeNull();
  });

  it("handles assistant status and repeated source update edge cases", () => {
    const initial = makeInitialState();
    const failed = editorReducer(initial, {
      type: "ASSISTANT_TURN_STATUS",
      status: "failed",
      error: "bad turn"
    });
    expect(failed.documents[failed.activeDocumentId]?.assistantTurnStatus).toBe("failed");
    expect(failed.documents[failed.activeDocumentId]?.assistantCurrentTurnId).toBeNull();
    expect(failed.documents[failed.activeDocumentId]?.assistantError).toBe("bad turn");

    const idle = editorReducer(failed, {
      type: "ASSISTANT_TURN_STATUS",
      status: "idle"
    });
    expect(idle.documents[idle.activeDocumentId]?.assistantCurrentTurnId).toBeNull();
    expect(idle.documents[idle.activeDocumentId]?.assistantLockReason).toBeNull();

    const unchangedSource = editorReducer(idle, {
      type: "ASSISTANT_SOURCE_UPDATED",
      source: idle.source,
      revisionToken: "same-source"
    });
    expect(unchangedSource.source).toBe(idle.source);
    expect(unchangedSource.documents[unchangedSource.activeDocumentId]?.assistantLastSourceRevision).toBe("same-source");

    const warned = {
      ...unchangedSource,
      lastEditWarningMessage: "old warning",
      lastEditWarningToken: 3,
      documents: {
        ...unchangedSource.documents,
        [unchangedSource.activeDocumentId]: {
          ...unchangedSource.documents[unchangedSource.activeDocumentId],
          lastEditWarningMessage: "old warning",
          lastEditWarningToken: 3
        }
      }
    };
    const updated = editorReducer(warned, {
      type: "ASSISTANT_SOURCE_UPDATED",
      source: "assistant edit",
      revisionToken: "new-source"
    });
    expect(updated.lastEditWarningMessage).toBeNull();
    expect(updated.lastEditWarningToken).toBe(4);
  });
});
