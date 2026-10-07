/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBucketFillPreview, type BucketPreviewSession } from "../../packages/app/src/ui/canvas-panel/useBucketFillPreview.js";
import { useEditorStore } from "../../packages/app/src/store/store.js";
import { makeInitialState } from "../../packages/app/src/store/reducer.js";
import { makeEmptySnapshot } from "../../packages/app/src/compute.js";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";

const SOURCE = String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (2,2);
\filldraw[fill=green!20] (3,0) rectangle (5,2);
\end{tikzpicture}`;
let root: Root;
let hoveredElementId: string | null;
let color: string;
let api: ReturnType<typeof useBucketFillPreview>;
let session: { current: BucketPreviewSession | null };
const dispatch = useEditorStore.getState().dispatch;

function ready() {
  const state = useEditorStore.getState();
  const rendered = renderTikzToSvg(state.source, { parse: { activeFigureId: state.activeRootId ?? undefined } });
  dispatch({ type: "COMPUTE_REQUESTED", requestId: "ready" });
  dispatch({ type: "SNAPSHOT_READY", requestId: "ready", snapshot: {
    ...makeEmptySnapshot(state.source), parseResult: rendered.parse, semanticResult: rendered.semantic,
    scene: rendered.semantic.scene, editHandles: rendered.semantic.editHandles,
    figures: rendered.parse.figures, activeRootId: rendered.parse.activeFigureId
  } });
}
function Harness() {
  const state = useEditorStore(s => s);
  api = useBucketFillPreview({ toolMode: state.toolMode, hoveredElementId, bucketFillColor: color,
    source: state.source, snapshot: state.snapshot, activeDocumentId: state.activeDocumentId,
    activeRootId: state.activeRootId, dispatch, bucketPreviewSessionRef: session });
  return null;
}
async function hover(id: string | null) {
  hoveredElementId = id;
  await act(async () => { root.render(React.createElement(Harness)); });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hoveredElementId = null; color = "red!60"; session = { current: null };
  useEditorStore.setState(makeInitialState());
  dispatch({ type: "CODE_EDITED", source: SOURCE });
  ready();
  dispatch({ type: "SET_TOOL_MODE", mode: "addBucket" });
  root = createRoot(document.createElement("div"));
  await act(async () => { root.render(React.createElement(Harness)); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  vi.unstubAllGlobals();
});

it("retains selection and identity when canceling a color preview", async () => {
  await act(async () => { dispatch({ type: "SELECT", id: "path:0", additive: false }); });
  const identities = useEditorStore.getState().documents[useEditorStore.getState().activeDocumentId].editingIdentities?.entries.map(entry => entry.id);
  const history = useEditorStore.getState().history.length;
  await hover("path:0");
  expect(useEditorStore.getState().source).toContain("fill=red!60");
  await act(async () => { ready(); });
  await hover(null);
  await act(async () => { ready(); });
  expect(useEditorStore.getState().source).toBe(SOURCE);
  expect(useEditorStore.getState().history).toHaveLength(history);
  expect([...useEditorStore.getState().selectedElementIds]).toEqual(["path:0"]);
  expect(useEditorStore.getState().documents[useEditorStore.getState().activeDocumentId].editingIdentities?.entries.map(entry => entry.id)).toEqual(identities);
});

it("switches preview targets and colors without carrying the old fill forward", async () => {
  await hover("path:0");
  await act(async () => { ready(); });
  await hover("path:1");
  expect(new Set(useEditorStore.getState().lastEditChangedSourceIds)).toEqual(new Set(["path:0", "path:1"]));
  expect(useEditorStore.getState().source).toContain("fill=blue!20");
  expect(useEditorStore.getState().source).not.toContain("fill=green!20");
  color = "yellow";
  await hover("path:1");
  expect(useEditorStore.getState().source).toContain("fill=yellow");
  expect(useEditorStore.getState().source).not.toContain("red!60");
  await hover(null);
  expect(useEditorStore.getState().source).toBe(SOURCE);
});

it("commits a hover preview as one undoable edit", async () => {
  const history = useEditorStore.getState().history.length;
  await hover("path:0");
  await act(async () => { ready(); });
  await act(async () => { expect(api.commitFill("path:0").kind).toBe("ready"); });
  const committed = useEditorStore.getState().source;
  expect(committed).toContain("fill=red!60");
  expect(useEditorStore.getState().history).toHaveLength(history + 1);
  await hover(null);
  expect(useEditorStore.getState().source).toBe(committed);
  await act(async () => { dispatch({ type: "UNDO" }); });
  expect(useEditorStore.getState().source).toBe(SOURCE);
  await act(async () => { dispatch({ type: "REDO" }); });
  expect(useEditorStore.getState().source).toBe(committed);
});

it.each(["typing", "same text after an intervening edit", "undo"])("does not overwrite or commit over %s", async reason => {
  if (reason === "undo") await act(async () => {
    dispatch({ type: "APPLY_EDIT_ACTION", action: { kind: "setProperty", elementId: "path:1", level: "command", key: "line width", value: "1pt" } });
    ready();
  });
  await hover("path:0");
  const preview = useEditorStore.getState().source;
  expect(preview).toContain("fill=red!60");
  await act(async () => {
    if (reason === "undo") dispatch({ type: "UNDO" });
    else {
      dispatch({ type: "CODE_EDITED", source: preview + "\n% independent edit" });
      if (reason === "same text after an intervening edit") dispatch({ type: "CODE_EDITED", source: preview });
    }
  });
  const edited = useEditorStore.getState().source;
  await act(async () => { ready(); });
  await act(async () => { expect(api.commitFill("path:0").kind).toBe("noop"); });
  expect(useEditorStore.getState().source).toBe(edited);
  await hover(null);
  expect(useEditorStore.getState().source).toBe(edited);
});

it("allows a new hover after canceling for an intervening edit", async () => {
  await hover("path:0");
  await act(async () => { dispatch({ type: "CODE_EDITED", source: SOURCE + "\n% independent edit" }); ready(); });
  expect(useEditorStore.getState().source).toBe(SOURCE + "\n% independent edit");
  await hover(null);
  await hover("path:0");
  expect(useEditorStore.getState().source).toContain("fill=red!60");
  expect(useEditorStore.getState().source).toContain("independent edit");
  await hover(null);
  expect(useEditorStore.getState().source).toBe(SOURCE + "\n% independent edit");
});

it("restores only the original document on tab switch", async () => {
  const originalId = useEditorStore.getState().activeDocumentId;
  await hover("path:0");
  await act(async () => { dispatch({ type: "NEW_DOCUMENT", source: SOURCE + "\n% other document" }); ready(); });
  expect(useEditorStore.getState().documents[originalId].source).toBe(SOURCE);
  expect(useEditorStore.getState().source).toBe(SOURCE + "\n% other document");
});

it("does not fill another picture using the previous picture's snapshot", async () => {
  const source = SOURCE + "\n" + SOURCE;
  await act(async () => { dispatch({ type: "CODE_EDITED", source }); ready(); });
  await hover("path:0");
  await act(async () => { dispatch({ type: "SET_ACTIVE_ROOT", rootId: "figure:1" }); });
  await act(async () => { ready(); });
  expect(useEditorStore.getState().source).toBe(source);
});

it("skips initial previews while the rendered source is stale", async () => {
  const edited = SOURCE + "\n% edit before hover";
  await act(async () => { dispatch({ type: "CODE_EDITED", source: edited }); });
  await hover("path:0");
  expect(useEditorStore.getState().source).toBe(edited);
  expect(api.commitFill("path:0").kind).toBe("noop");
});

it.each([false, true])("unmount restores only an owned preview (intervening edit: %s)", async edited => {
  await hover("path:0");
  const expected = edited ? SOURCE + "\n% independently edited" : SOURCE;
  if (edited) await act(async () => { dispatch({ type: "CODE_EDITED", source: expected }); });
  await act(async () => { root.render(null); });
  expect(useEditorStore.getState().source).toBe(expected);
});
