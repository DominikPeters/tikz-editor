/** @vitest-environment jsdom */
import React, { act, type PointerEvent as ReactPointerEvent } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useInspectorPreviewScrub } from "../../packages/app/src/ui/inspector-panel/useInspectorPreviewScrub.js";
import { useEditorStore } from "../../packages/app/src/store/store.js";
import { makeInitialState } from "../../packages/app/src/store/reducer.js";

let api: ReturnType<typeof useInspectorPreviewScrub>;
const selection = ["path:0"];
const emptyProvenance = {};
const freeze = vi.fn();
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const root = createRoot(document.createElement("div"));
const dispatch = useEditorStore.getState().dispatch;
function Harness() {
  api = useInspectorPreviewScrub({ dispatch, selectedSourceIds: selection, descriptor: null, multiModel: null,
    singlePropertyProvenance: emptyProvenance, multiPropertyProvenance: emptyProvenance, setFrozenInspectorView: freeze });
  return null;
}
function pointer(type: string, x: number) {
  const event = new Event(type);
  Object.assign(event, { pointerId: 1, clientX: x, shiftKey: false, altKey: false });
  window.dispatchEvent(event);
}
async function flushFrame() {
  await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(0)); });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++frameId, cb); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  useEditorStore.setState(makeInitialState());
  dispatch({ type: "CODE_EDITED", source: "base" });
  await act(async () => { root.render(React.createElement(Harness)); });
});
afterEach(async () => {
  await act(async () => { root.render(null); });
  frames.clear(); vi.unstubAllGlobals();
});

it("coalesces scrub samples and commits the release position once", async () => {
  const preview = vi.fn((value: number) => dispatch({ type: "SET_SOURCE_TRANSIENT", source: String(value) }));
  const commit = vi.fn((value: number) => {
    expect(useEditorStore.getState().source).toBe("base");
    dispatch({ type: "SET_SOURCE_TRANSIENT", source: String(value) });
  });
  await act(async () => { api.beginNumberLabelScrub({ button: 0, pointerId: 1, clientX: 0, preventDefault() {} } as ReactPointerEvent<HTMLElement>,
    { writable: true, value: 1, step: .1, onPreview: preview, onCommit: commit });
    pointer("pointermove", 12); pointer("pointermove", 24); });
  expect(preview).not.toHaveBeenCalled();
  await flushFrame();
  expect(preview).toHaveBeenCalledOnce();
  await act(async () => { pointer("pointermove", 32); pointer("pointerup", 48); });
  expect(commit).toHaveBeenCalledExactlyOnceWith(1.6);
  expect(useEditorStore.getState().source).toBe("1.6");
  await flushFrame();
  expect(preview).toHaveBeenCalledTimes(2);
});

it("restores hover previews in their original tab when switching documents", async () => {
  const originalId = useEditorStore.getState().activeDocumentId;
  await act(async () => { api.applyHoverPreview("color", () => dispatch({ type: "SET_SOURCE_TRANSIENT", source: "preview" })); });
  await act(async () => { dispatch({ type: "NEW_DOCUMENT", source: "other tab" }); });
  expect(useEditorStore.getState().source).toBe("other tab");
  expect(useEditorStore.getState().documents[originalId].source).toBe("base");
});

it("does not restore or commit over an intervening source edit, even when the text returns", async () => {
  await act(async () => { api.applyHoverPreview("color", () => dispatch({ type: "SET_SOURCE_TRANSIENT", source: "preview" })); });
  await act(async () => { dispatch({ type: "CODE_EDITED", source: "external" }); dispatch({ type: "CODE_EDITED", source: "preview" }); });
  const commit = vi.fn();
  await act(async () => { api.commitAfterHoverPreview("color", commit); });
  expect(commit).not.toHaveBeenCalled();
  expect(useEditorStore.getState().source).toBe("preview");
});

it("cancels queued scrub work on blur without committing", async () => {
  const preview = vi.fn((value: number) => dispatch({ type: "SET_SOURCE_TRANSIENT", source: String(value) }));
  const commit = vi.fn();
  await act(async () => { api.beginNumberLabelScrub({ button: 0, pointerId: 1, clientX: 0, preventDefault() {} } as ReactPointerEvent<HTMLElement>,
    { writable: true, value: 1, step: .1, onPreview: preview, onCommit: commit }); pointer("pointermove", 24); });
  await flushFrame();
  await act(async () => { pointer("pointermove", 48); window.dispatchEvent(new Event("blur")); });
  await flushFrame();
  expect(useEditorStore.getState().source).toBe("base");
  expect(preview).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled();
});
