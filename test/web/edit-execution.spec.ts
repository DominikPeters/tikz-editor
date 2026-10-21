import { afterEach, expect, it, vi } from "vitest";
import { computeSnapshot } from "../../packages/app/src/compute.js";
import { editorReducer, makeInitialState } from "../../packages/app/src/store/reducer.js";
import { executeDocumentEdit } from "../../packages/app/src/edit-execution.js";
import { type EditAction } from "../../packages/core/src/edit/actions.js";
import * as evaluator from "../../packages/core/src/semantic/evaluate.js";
import { applySourcePatches } from "../../packages/core/src/edit/source-patches.js";

const source = String.raw`\begin{tikzpicture}
  \draw (0,3) rectangle (2,1);
  \draw (3,2) rectangle (5,1);
\end{tikzpicture}`;
// Statements that already carry an option list: a property edit then changes
// the list in place, where adding the list would renumber the path's items.
const optionedSource = String.raw`\begin{tikzpicture}
  \draw[thin] (0,3) rectangle (2,1);
  \draw[thin] (3,2) rectangle (5,1);
\end{tikzpicture}`;
let nextId = 0;
async function setup(input = source, activeRootId = "figure:0") {
  let state = editorReducer(makeInitialState(), { type: "CODE_EDITED", source: input });
  const documentId = state.activeDocumentId;
  const { snapshot } = await computeSnapshot({ id: `setup-${++nextId}`, documentId, kind: "render", source: input, sourceRevision: state.sourceRevision, activeRootId });
  state = editorReducer(state, { type: "SET_ACTIVE_ROOT", rootId: activeRootId });
  state = editorReducer(state, { type: "COMPUTE_REQUESTED", requestId: "ready" });
  state = editorReducer(state, { type: "SNAPSHOT_READY", requestId: "ready", snapshot });
  return { state, documentId, snapshot };
}
afterEach(() => vi.restoreAllMocks());

it("batches property edits into one revision and undo step, with cleanup in the same edit", async () => {
  const { state } = await setup();
  const action: EditAction = { kind: "setProperties", actions: [
    { kind: "setProperty", elementId: "path:0", level: "command", key: "draw", value: "none" },
    { kind: "setProperty", elementId: "path:1", level: "command", key: "draw", value: "none" }
  ] };
  const edited = editorReducer(state, { type: "APPLY_EDIT_ACTION", action });
  expect(edited.sourceRevision).toBe(state.sourceRevision + 1);
  expect(edited.history).toHaveLength(1);
  expect(edited.source).not.toContain("draw=none");
  expect(edited.source).toContain(String.raw`\path (0,3) rectangle (2,1);`);
  expect(edited.source).toContain(String.raw`\path (3,2) rectangle (5,1);`);
  expect(editorReducer(edited, { type: "UNDO" }).source).toBe(source);
  expect(editorReducer(editorReducer(edited, { type: "UNDO" }), { type: "REDO" }).source).toBe(edited.source);
});

it("does not partially apply a batch with an invalid target", async () => {
  const { state } = await setup();
  const edited = editorReducer(state, { type: "APPLY_EDIT_ACTION", action: { kind: "setProperties", actions: [
    { kind: "setProperty", elementId: "path:0", level: "command", key: "draw", value: "red" },
    { kind: "setProperty", elementId: "absent", level: "command", key: "draw", value: "blue" }
  ] } });
  expect(edited.source).toBe(source);
  expect(edited.history).toHaveLength(0);
});

it("shares snapshot geometry with grouping commands", async () => {
  const { state, documentId } = await setup();
  const evaluate = vi.spyOn(evaluator, "evaluateTikzFigure");
  const result = executeDocumentEdit({ ...state, documentId }, { kind: "groupElements", elementIds: ["path:0", "path:1"] });
  expect(result.kind).toBe("success");
  expect(evaluate).not.toHaveBeenCalled();
});

it("uses incremental parsing and evaluation for ordinary property commands", async () => {
  const { state, documentId } = await setup(optionedSource);
  const result = executeDocumentEdit({ ...state, documentId }, { kind: "setProperty", elementId: "path:1", level: "command", key: "draw", value: "red" });
  if (result.kind !== "success") throw new Error("Expected property edit");
  const { snapshot } = await computeSnapshot({ id: "property-next", documentId, kind: "render", source: result.newSource,
    sourceRevision: state.sourceRevision + 1, activeRootId: state.activeRootId, patches: result.patches,
    patchBaseRevision: state.sourceRevision, changedSourceIds: result.changedSourceIds, trigger: "other" });
  expect(snapshot.incremental).toMatchObject({ parseStrategy: "incremental", strategy: "incremental" });
  const full = await computeSnapshot({ id: "property-full", documentId: `full-${++nextId}`, kind: "render", source: result.newSource, activeRootId: state.activeRootId });
  expect(snapshot.svg?.svg).toBe(full.snapshot.svg?.svg);
  expect(snapshot.scene?.elements.map((element) => element.id)).toEqual(full.snapshot.scene?.elements.map((element) => element.id));
});

it("parses in full when a property edit adds an option list, which renumbers the path's items", async () => {
  const { state, documentId } = await setup();
  const result = executeDocumentEdit({ ...state, documentId }, { kind: "setProperty", elementId: "path:1", level: "command", key: "line width", value: "2pt" });
  if (result.kind !== "success") throw new Error("Expected property edit");
  const { snapshot } = await computeSnapshot({ id: "property-list", documentId, kind: "render", source: result.newSource,
    sourceRevision: state.sourceRevision + 1, activeRootId: state.activeRootId, patches: result.patches,
    patchBaseRevision: state.sourceRevision, changedSourceIds: result.changedSourceIds, trigger: "other" });
  const full = await computeSnapshot({ id: "property-list-full", documentId: `full-${++nextId}`, kind: "render", source: result.newSource, activeRootId: state.activeRootId });
  expect(snapshot.parseResult?.figure.body[1]).toEqual(full.snapshot.parseResult?.figure.body[1]);
  expect(snapshot.scene?.elements.map((element) => element.id)).toEqual(full.snapshot.scene?.elements.map((element) => element.id));
});

it("rejects misleading patch ownership before semantic or SVG reuse", async () => {
  const { state, documentId } = await setup();
  const result = executeDocumentEdit({ ...state, documentId }, { kind: "setProperty", elementId: "path:1", level: "command", key: "draw", value: "red" });
  if (result.kind !== "success") throw new Error("Expected property edit");
  const { snapshot } = await computeSnapshot({ id: "unsafe-next", documentId, kind: "render", source: result.newSource,
    sourceRevision: state.sourceRevision + 1, activeRootId: state.activeRootId, patches: result.patches,
    patchBaseRevision: state.sourceRevision, changedSourceIds: ["path:0"], trigger: "other" });
  expect(snapshot.incremental).toMatchObject({ parseStrategy: "full", strategy: "full" });
  const full = await computeSnapshot({ id: "unsafe-full", documentId: `full-${++nextId}`, kind: "render", source: result.newSource, activeRootId: state.activeRootId });
  expect(snapshot.svg?.svg).toBe(full.snapshot.svg?.svg);
});

it("keeps surrounding Beamer source intact during nested property cleanup", async () => {
  const nestedSource = String.raw`\documentclass{beamer}
\begin{document}\begin{frame}{Example}
Before
\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}
After
\end{frame}\end{document}`;
  const { state } = await setup(nestedSource, "frame:0:tikzpicture:0");
  const edited = editorReducer(state, { type: "APPLY_EDIT_ACTION", action: { kind: "setProperty", elementId: "path:0", level: "command", key: "draw", value: "none" } });
  expect(edited.source).toContain("Before"); expect(edited.source).toContain("After");
  expect(edited.source).toContain(String.raw`\path (0,0)--(1,1);`);
  expect(applySourcePatches(state.source, edited.lastEditPatches ?? [])).toMatchObject({ kind: "success", source: edited.source });
});

it("keeps attached-node drags incremental beyond both path endpoints", async () => {
  const { state: initial, documentId } = await setup(String.raw`\begin{tikzpicture}
\draw (0,0)--(2,0) node[pos=.4] {Label};
\draw (0,3)--(2,3);
\end{tikzpicture}`);
  let state = initial;
  for (const [index, pos] of [1.2, -.5, .8].entries()) {
    const handle = state.snapshot.editHandles.find(handle => handle.pathAttachmentContext)!;
    const context = handle.pathAttachmentContext!;
    const prior = state;
    state = editorReducer(state, { type: "APPLY_EDIT_ACTION", action: { kind: "movePathAttachedNode",
      nodeId: handle.sourceRef.sourceId, hostPathSourceId: context.hostPathSourceId, pos, preserveRegime: true } });
    const { snapshot } = await computeSnapshot({ id: `attached-${index}`, documentId, kind: "render", source: state.source,
      sourceRevision: state.sourceRevision, activeRootId: state.activeRootId, patches: state.lastEditPatches ? [...state.lastEditPatches] : null,
      patchBaseRevision: prior.sourceRevision, changedSourceIds: state.lastEditChangedSourceIds, trigger: "drag-element" });
    expect(snapshot.incremental).toMatchObject({ parseStrategy: "incremental", strategy: "incremental" });
    expect(snapshot.editHandles.find(handle => handle.pathAttachmentContext)?.pathAttachmentContext?.pos).toBe(pos);
    // Full comparison uses another document, so seed the incremental session again for the next step.
    const full = await computeSnapshot({ id: `attached-full-${index}`, documentId: `full-attached-${index}`, kind: "render", source: state.source, activeRootId: state.activeRootId });
    expect(snapshot.svg?.svg).toBe(full.snapshot.svg?.svg);
    await computeSnapshot({ id: `attached-reseed-${index}`, documentId, kind: "render", source: state.source, sourceRevision: state.sourceRevision, activeRootId: state.activeRootId });
    state = editorReducer(state, { type: "COMPUTE_REQUESTED", requestId: `attached-${index}` });
    state = editorReducer(state, { type: "SNAPSHOT_READY", requestId: `attached-${index}`, snapshot });
  }
});


it("commits nested property previews when rendering has not caught up", async () => {
  const nested = String.raw`\documentclass{beamer}\begin{document}\begin{frame}
Before\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}After
\end{frame}\end{document}`;
  const { state } = await setup(nested, "frame:0:tikzpicture:0");
  let current = state;
  for (const value of ["verylongcolorname", "red"]) {
    current = editorReducer(current, { type: "APPLY_EDIT_ACTION", recordInHistory: false,
      action: { kind: "setProperty", elementId: "path:0", level: "command", key: "draw", value } });
    expect(current.source).toContain(value === "red" ? "[red]" : `[draw=${value}]`);
    expect(current.source).toContain("After");
  }
  expect(current.history).toHaveLength(0);
});

it("does not apply ids from one figure's snapshot to another active figure", async () => {
  // path:0 names the first figure's statement; in the second figure it is a different one.
  const figures = source + String.raw`\begin{tikzpicture}\draw (0,0)--(9,9);\end{tikzpicture}`;
  const { state, documentId } = await setup(figures);
  const result = executeDocumentEdit({ ...state, documentId, activeRootId: "figure:1" },
    { kind: "setProperty", elementId: "path:0", level: "command", key: "draw", value: "red" });
  expect(result.kind).toBe("unsupported");
});

it("preserves separate patch ranges so multi-selection properties stay incremental", async () => {
  const { state, documentId } = await setup(optionedSource);
  const result = executeDocumentEdit({ ...state, documentId }, { kind: "setProperties", actions: [
    { kind: "setProperty", elementId: "path:0", level: "command", key: "draw", value: "red" },
    { kind: "setProperty", elementId: "path:1", level: "command", key: "draw", value: "blue" },
    { kind: "setProperty", elementId: "path:0", level: "command", key: "line width", value: "2pt" }
  ] });
  if (result.kind !== "success") throw new Error(JSON.stringify(result));
  expect(result.patches).toHaveLength(2);
  const { snapshot } = await computeSnapshot({ id: "batch-incremental", documentId, kind: "render", source: result.newSource,
    sourceRevision: state.sourceRevision + 1, activeRootId: state.activeRootId, patches: result.patches,
    patchBaseRevision: state.sourceRevision, changedSourceIds: result.changedSourceIds, trigger: "other" });
  expect(snapshot.incremental, JSON.stringify({ patches: result.patches, incremental: snapshot.incremental })).toMatchObject({ parseStrategy: "incremental", strategy: "incremental" });
  const full = await computeSnapshot({ id: "batch-full", documentId: "batch-full", source: result.newSource, activeRootId: state.activeRootId });
  expect(snapshot.svg?.svg).toBe(full.snapshot.svg?.svg);
});

it("refuses element edits from a snapshot of another picture, right after switching pictures", async () => {
  const twoPictures = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (5,5) -- (6,6);
\end{tikzpicture}`;
  const { state: shown } = await setup(twoPictures, "figure:0");
  // The second picture is chosen; its render has not arrived yet.
  const switched = editorReducer(shown, { type: "SET_ACTIVE_ROOT", rootId: "figure:1" });
  const edited = editorReducer(switched, { type: "APPLY_EDIT_ACTION", action: { kind: "deleteElement", elementId: "path:0" } });
  expect(edited.source).toBe(twoPictures);
});
