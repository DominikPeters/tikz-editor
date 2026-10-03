/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index";
import { getInspectorDescriptor } from "../../packages/core/src/edit/inspector";
import { pt, worldPoint } from "../../packages/core/src/coords/index";
import { makeEmptySnapshot } from "../../packages/app/src/compute";
import { makeInitialState } from "../../packages/app/src/store/reducer";
import { useEditorStore } from "../../packages/app/src/store/store";
import { useInspectorModel } from "../../packages/app/src/ui/inspector-panel/useInspectorModel";

const BASE = String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (1,1);
\end{tikzpicture}`;
let root: Root;
let model: ReturnType<typeof useInspectorModel>;
const dispatch = useEditorStore.getState().dispatch;
function ready() {
  const source = useEditorStore.getState().source;
  const rendered = renderTikzToSvg(source);
  dispatch({ type: "COMPUTE_REQUESTED", requestId: "ready" });
  dispatch({ type: "SNAPSHOT_READY", requestId: "ready", snapshot: {
    ...makeEmptySnapshot(source), parseResult: rendered.parse, semanticResult: rendered.semantic,
    activeRootId: rendered.parse.activeFigureId, figures: rendered.parse.figures, scene: rendered.semantic.scene,
    editHandles: rendered.semantic.editHandles, svg: rendered.svg
  } });
  expect(useEditorStore.getState().documents[useEditorStore.getState().activeDocumentId].editingIdentities).toBeDefined();
}
function Harness() {
  const selectedIds = useEditorStore(s => s.selectedElementIds);
  model = useInspectorModel({ selectedIds, dispatch, getInspectorDescriptor });
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useEditorStore.setState(makeInitialState());
  dispatch({ type: "CODE_EDITED", source: BASE });
  ready();
  dispatch({ type: "SELECT", id: "path:0", additive: false });
  root = createRoot(document.createElement("div"));
  await act(async () => { root.render(React.createElement(Harness)); });
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

function move() {
  dispatch({ type: "APPLY_EDIT_ACTION", action: { kind: "moveElements", elementIds: ["path:0"], delta: worldPoint(pt(10), pt(0)) } });
  expect(useEditorStore.getState().source).not.toBe(BASE);
}

it.each(["element", "resize", "rotate", "handle"] as const)("thaws %s after its final snapshot arrived before release", async kind => {
  await act(async () => dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind }));
  await act(async () => { move(); ready(); });
  expect(model.source).toBe(BASE);
  await act(async () => dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind: null }));
  const state = useEditorStore.getState();
  expect(state.snapshot.source).toBe(state.source);
  expect(model.source).toBe(state.source);
  expect(model.selectedElements[0]).toEqual(state.snapshot.scene!.elements.find(e => e.sourceRef.sourceId === "path:0"));
});

it.each(["element", "resize", "rotate", "handle"] as const)("waits for synchronized source/snapshot after %s release", async kind => {
  const originalElement = model.selectedElements[0];
  await act(async () => dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind }));
  await act(async () => move());
  await act(async () => dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind: null }));
  expect(model.source).toBe(BASE);
  expect(model.selectedElements[0]).toBe(originalElement);
  await act(async () => ready());
  expect(model.source).toBe(useEditorStore.getState().source);
  expect(model.selectedElements[0]).not.toBe(originalElement);
});

it("does not thaw on unrelated notifications while the drag remains active", async () => {
  await act(async () => dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind: "element" }));
  await act(async () => { move(); ready(); });
  await act(async () => dispatch({ type: "SET_HOVERED_ELEMENT", id: "path:0" }));
  expect(model.source).toBe(BASE);
  await act(async () => dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind: null }));
  expect(model.source).toBe(useEditorStore.getState().source);
});
