import { describe, expect, it } from "vitest";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { editorReducer, makeInitialState } from "../../packages/app/src/store/reducer.js";
import { makeEmptySnapshot, type SessionSnapshot } from "../../packages/app/src/compute.js";
import { reconcileEditingIdentities } from "../../packages/app/src/editing-identities.js";
import { resolveHandleIdForDrag } from "../../packages/app/src/ui/canvas-panel/interaction-helpers.js";
import { wp } from "../coords-helpers.js";
import { createEditGeometrySession } from "../../packages/core/src/edit/geometry-session.js";
import { executeDocumentEdit } from "../../packages/app/src/edit-execution.js";
import type { EditorState } from "../../packages/app/src/store/types.js";

const wrap = (body: string) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;
const a = String.raw`\draw (0,0) rectangle (1,1);`, b = String.raw`\draw (3,0) rectangle (4,1);`;
function snapshot(source: string, activeFigureId?: string | null): SessionSnapshot {
  const parseResult = parseTikz(source, { activeFigureId });
  const semanticResult = evaluateTikzFigure(parseResult.figure, source);
  return { ...makeEmptySnapshot(source), parseResult, semanticResult, activeRootId: parseResult.activeFigureId,
    figures: parseResult.figures, scene: semanticResult.scene, editHandles: semanticResult.editHandles };
}
function ready(state: EditorState) {
  state = editorReducer(state, { type: "COMPUTE_REQUESTED", requestId: "ready" });
  return editorReducer(state, { type: "SNAPSHOT_READY", requestId: "ready", snapshot: snapshot(state.source, state.activeRootId ?? undefined) });
}
function setup(source = wrap(`${a}\n${b}`)) { return ready(editorReducer(makeInitialState(), { type: "CODE_EDITED", source })); }
function entries(state: EditorState) { return state.documents[state.activeDocumentId].editingIdentities!.entries.filter(entry => entry.kind === "Path"); }

describe("document editing identities", () => {
  it("preserves identity through commands, reordering, undo, and redo", () => {
    let state = setup(); const original = entries(state).map(entry => entry.id);
    state = editorReducer(state, { type: "SELECT", id: "path:0", additive: false });
    const selection = state.selectedElementIds;
    state = ready(editorReducer(state, { type: "APPLY_EDIT_ACTION", action: { kind: "moveElements", elementIds: ["path:0"], delta: wp(5, 2) } }));
    expect(entries(state).map(entry => entry.id)).toEqual(original);
    expect(state.selectedElementIds).toBe(selection);
    state = ready(editorReducer(state, { type: "APPLY_EDIT_ACTION", action: { kind: "reorderElements", elementIds: ["path:0"], direction: "bringToFront" } }));
    expect(entries(state).map(entry => entry.id)).toEqual([...original].reverse());
    expect([...state.selectedElementIds]).toEqual(["path:1"]);
    state = ready(editorReducer(state, { type: "UNDO" }));
    expect(entries(state).map(entry => entry.id)).toEqual(original);
    state = ready(editorReducer(state, { type: "REDO" }));
    expect(entries(state).map(entry => entry.id)).toEqual([...original].reverse());
  });

  it("uses explicit reorder provenance for identical anonymous objects", () => {
    let state = setup(wrap(`${a}\n${a}\n${b}`)); const original = entries(state).map(entry => entry.id);
    state = ready(editorReducer(state, { type: "APPLY_EDIT_ACTION", action: { kind: "reorderElements", elementIds: ["path:0"], direction: "bringToFront" } }));
    expect(entries(state).map(entry => entry.id)).toEqual([original[1], original[2], original[0]]);
  });

  it("gives duplicated objects new identities and restores them through undo/redo", () => {
    let state = setup(); const original = entries(state).map(entry => entry.id);
    state = ready(editorReducer(state, { type: "APPLY_EDIT_ACTION", action: { kind: "duplicateElements", elementIds: ["path:0"], delta: wp(0, 0) } }));
    const duplicated = entries(state).map(entry => entry.id);
    expect(duplicated).toHaveLength(3); expect(new Set(duplicated).size).toBe(3);
    expect(duplicated).toEqual(expect.arrayContaining(original));
    state = ready(editorReducer(ready(editorReducer(state, { type: "UNDO" })), { type: "REDO" }));
    expect(entries(state).map(entry => entry.id)).toEqual(duplicated);
  });

  it("keeps selection on a uniquely matched object after manual reordering", () => {
    let state = setup(); const original = entries(state).map(entry => entry.id);
    state = editorReducer(state, { type: "SELECT", id: "path:0", additive: false });
    state = ready(editorReducer(state, { type: "CODE_EDITED", source: wrap(`${b}\n${a}`) }));
    expect(entries(state).map(entry => entry.id)).toEqual([...original].reverse());
    expect([...state.selectedElementIds]).toEqual(["path:1"]);
  });

  it("preserves objects and the dragged handle through automatic naming, reordering, and returning to baseline", () => {
    let state = setup(wrap(String.raw`\draw (-1,1)--(1,1);\node[draw] at (0,0) {C};`));
    const originalIds = entries(state).map(entry => entry.id);
    const initialHandle = state.snapshot.editHandles[0];
    const geometry = createEditGeometrySession({ source: state.source, parsed: state.snapshot.parseResult!, semantic: state.snapshot.semanticResult! });
    state = editorReducer(state, { type: "SET_ACTIVE_CANVAS_DRAG", kind: "handle" });
    const connect = { kind: "connectHandle", handleId: initialHandle.id, nodeName: "", nodeSourceId: "path:1", anchor: "center" } as const;
    for (let i = 0; i < 2; i++) {
      const result = executeDocumentEdit({ ...state, documentId: state.activeDocumentId }, connect, { geometry });
      if (result.kind !== "success") throw new Error(JSON.stringify(result));
      state = ready(editorReducer(state, { type: "APPLY_EDIT_ACTION", action: connect, precomputedSource: state.source, precomputedResult: result, historyMergeKey: "connect" }));
      expect(entries(state).map(entry => entry.id)).toEqual([...originalIds].reverse());
      expect(state.snapshot.editHandles.find(handle => handle.editingId === initialHandle.editingId)?.sourceRef.sourceId).toBe("path:1");
    }
    const move = { kind: "moveHandle", handleId: initialHandle.id, newWorld: initialHandle.world } as const;
    const result = executeDocumentEdit({ ...state, documentId: state.activeDocumentId }, move, { geometry });
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    state = ready(editorReducer(state, { type: "APPLY_EDIT_ACTION", action: move, precomputedSource: state.source, precomputedResult: result, historyMergeKey: "connect" }));
    expect(state.source).toBe(geometry.source);
    expect(entries(state).map(entry => entry.id)).toEqual(originalIds);
    expect(state.snapshot.editHandles[0].editingId).toBe(initialHandle.editingId);
  });

  it("never recycles an identity from a discarded undo branch", () => {
    let state = setup();
    state = ready(editorReducer(state, { type: "APPLY_EDIT_ACTION", action: { kind: "duplicateElements", elementIds: ["path:0"], delta: wp(0, 0) } }));
    const discarded = entries(state).map(entry => entry.id);
    state = ready(editorReducer(state, { type: "UNDO" }));
    const original = new Set(entries(state).map(entry => entry.id));
    state = ready(editorReducer(state, { type: "APPLY_EDIT_ACTION", action: { kind: "duplicateElements", elementIds: ["path:1"], delta: wp(0, 0) } }));
    expect(entries(state).filter(entry => !original.has(entry.id)).every(entry => !discarded.includes(entry.id))).toBe(true);
  });

  it("does not identify ambiguous replaced objects by their parser slot or proximity", () => {
    let state = setup(wrap(`${a}\n${a}`)); const old = entries(state).map(entry => entry.id);
    state = editorReducer(state, { type: "SELECT", id: "path:0", additive: false });
    state = ready(editorReducer(state, { type: "CODE_EDITED", source: wrap(`${b}\n${b}`) }));
    expect(entries(state).every(entry => !old.includes(entry.id))).toBe(true);
    expect([...state.selectedElementIds]).toEqual([]);
  });

  it("keeps identities separate between documents and runtime loop instances", () => {
    const source = wrap(String.raw`\foreach \x in {1,2,3} {\draw (\x,0)--(\x,1);}`);
    const s = snapshot(source);
    const first = reconcileEditingIdentities(undefined, s, "a"), second = reconcileEditingIdentities(undefined, s, "b");
    expect(first.entries.every(entry => !second.entries.some(other => other.id === entry.id))).toBe(true);
    const state = setup(source); const handles = state.snapshot.editHandles;
    expect(new Set(handles.map(handle => handle.id)).size).toBe(handles.length);
    expect(new Set(handles.map(handle => handle.editingId)).size).toBe(handles.length);
  });

  it("recovers handles only through an unambiguous editing identity", () => {
    let state = setup(); const original = state.snapshot.editHandles[0];
    state = ready(editorReducer(state, { type: "CODE_EDITED", source: wrap(`${b}\n${a}`) }));
    const drag = { kind: "handle", handleId: original.id, handleEditingId: original.editingId, sourceId: original.sourceRef.sourceId, handleKind: original.kind, lastKnownWorld: original.world } as any;
    const recovered = resolveHandleIdForDrag(drag, state.snapshot.editHandles);
    expect(state.snapshot.editHandles.find(handle => handle.id === recovered)?.editingId).toBe(original.editingId);
    expect(drag.sourceId).toBe("path:1");
    expect(resolveHandleIdForDrag(drag, [state.snapshot.editHandles[2], state.snapshot.editHandles[2]])).toBeNull();
  });

  it("adding handles to an earlier path cannot renumber a later object's handles", () => {
    const before = snapshot(wrap(`${a}\n${b}`)).editHandles.filter(handle => handle.sourceRef.sourceId === "path:1");
    const after = snapshot(wrap(`${a.replace(';', ' -- (9,9);')}\n${b}`)).editHandles.filter(handle => handle.sourceRef.sourceId === "path:1");
    expect(after.map(handle => handle.id)).toEqual(before.map(handle => handle.id));
  });
});

it("keeps identities across figure switches", () => {
  let state = setup(`${wrap(a)}\n${wrap(b)}`);
  const first = entries(state).map(entry => entry.id);
  state = ready(editorReducer(state, { type: "SET_ACTIVE_ROOT", rootId: "figure:1" }));
  expect(entries(state).every(entry => !first.includes(entry.id))).toBe(true);
  state = ready(editorReducer(state, { type: "SET_ACTIVE_ROOT", rootId: "figure:0" }));
  expect(entries(state).map(entry => entry.id)).toEqual(first);
});
it("does not apply an old selection to another object while source reconciliation is pending", () => {
  let state = setup();
  state = editorReducer(state, { type: "CODE_EDITED", source: wrap(`${b}\n${a}`) });
  const attempted = editorReducer(state, { type: "APPLY_EDIT_ACTION", action: { kind: "setProperty", elementId: "path:0", level: "command", key: "draw", value: "red" } });
  expect(attempted.source).toBe(state.source);
});

it("retains an explicit selection made while a source edit is still rendering", () => {
  let state = setup();
  state = editorReducer(state, { type: "SELECT", id: "path:0", additive: false });
  state = editorReducer(state, { type: "CODE_EDITED", source: wrap(`\\draw (8,0)--(9,0);\n${a}\n${b}`) });
  state = editorReducer(state, { type: "SELECT", id: "path:1", additive: false });
  state = ready(state);
  expect([...state.selectedElementIds]).toEqual(["path:2"]);
});
