/** @vitest-environment jsdom */
import React, { act, useMemo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBeamerObjectIndex, prepareBeamerDocument, type BeamerFrameLayout } from "../../packages/core/src/beamer/index.js";
import { DeckResizeOverlay } from "../../packages/app/src/ui/canvas-panel/DeckResizeOverlay.js";
import { useEditorStore } from "../../packages/app/src/store/store.js";
import { makeInitialState } from "../../packages/app/src/store/reducer.js";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}\begin{frame}[t]
\begin{columns}[T]
\begin{column}{.55\textwidth}\includegraphics[width=.5\linewidth]{demo.png}\end{column}
\begin{column}{.42\textwidth}Right\end{column}
\end{columns}
\only<2>{Later}
\end{frame}\end{document}`;
let host: HTMLDivElement;
let root: Root;
let layout: BeamerFrameLayout;
let renderedSource: string;
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const dispatch = useEditorStore.getState().dispatch;
const closeText = () => {};
function Harness() {
  const ref = useRef<SVGSVGElement>(null);
  const selection = useEditorStore(s => s.deckObjectSelection);
  const index = useMemo(() => buildBeamerObjectIndex({ ...layout, source: renderedSource }), [layout, renderedSource]);
  return React.createElement("svg", { ref }, React.createElement(DeckResizeOverlay, { source: renderedSource, layout, index,
    selected: index.byId.get(selection?.objectId ?? "") ?? null, svgRef: ref, scale: 2, closeText }));
}
async function renderSnapshot() {
  renderedSource = useEditorStore.getState().source;
  layout = (await prepareBeamerDocument(renderedSource).renderFrame({ frameIndex: 0, graphicsResolver: {
    cacheKey: "resize-hook", resolve: () => ({ status: "resolved", mimeType: "image/png", dataBase64: "", naturalWidthPt: 120, naturalHeightPt: 60, revision: "1" })
  } })).layout;
  const current = useEditorStore.getState();
  useEditorStore.setState({ snapshot: { ...current.snapshot, source: renderedSource } });
  act(() => { root.render(React.createElement(Harness)); });
}
function event(type: string, x: number, y = 0, id = 1) {
  const event = new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, "pointerId", { value: id }); return event;
}
function begin(testId = "deck-column-divider") {
  act(() => { host.querySelector(`[data-testid="${testId}"]`)!.dispatchEvent(event("pointerdown", 0)); });
}
function pointer(type: string, x: number, y = 0, id = 1) {
  act(() => { window.dispatchEvent(event(type, x, y, id)); });
}
function flush() {
  act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(0)); });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++frameId, cb); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  Object.defineProperty(SVGSVGElement.prototype, "getScreenCTM", { configurable: true, value: () => ({ inverse: () => ({ a: .5 }) }) });
  Object.defineProperty(SVGSVGElement.prototype, "createSVGPoint", { configurable: true, value: () => ({ x: 0, y: 0, matrixTransform(this: { x: number; y: number }) { return { x: this.x / 2, y: this.y / 2 }; } }) });
  useEditorStore.setState(makeInitialState());
  dispatch({ type: "CODE_EDITED", source: SOURCE });
  dispatch({ type: "SET_ACTIVE_ROOT", rootId: "frame:0" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await renderSnapshot();
});
afterEach(() => { act(() => { root.unmount(); }); host.remove(); frames.clear(); vi.unstubAllGlobals(); });

describe("canvas resize gestures", () => {
  it("previews at zoom, commits the release sample once, and supports undo/redo", () => {
    const history = useEditorStore.getState().history.length;
    begin(); pointer("pointermove", 20); pointer("pointermove", 40); flush();
    expect(useEditorStore.getState().source).not.toBe(SOURCE);
    expect(useEditorStore.getState().history.length).toBe(history);
    const preview = useEditorStore.getState().source;
    pointer("pointerup", 60);
    const final = useEditorStore.getState().source;
    expect(final).not.toBe(preview);
    expect(useEditorStore.getState().history.length).toBe(history + 1);
    flush(); expect(useEditorStore.getState().source).toBe(final);
    act(() => { dispatch({ type: "UNDO" }); }); expect(useEditorStore.getState().source).toBe(SOURCE);
    act(() => { dispatch({ type: "REDO" }); }); expect(useEditorStore.getState().source).toBe(final);
  });
  it.each(["Escape", "pointercancel", "blur", "step", "slide"])("restores the original source on %s", (reason) => {
    const history = useEditorStore.getState().history.length;
    begin(); pointer("pointermove", 40); flush();
    act(() => {
      if (reason === "step") dispatch({ type: "SET_DECK_STEP", rootId: "frame:0", step: 2 });
      else if (reason === "slide") dispatch({ type: "SET_ACTIVE_ROOT", rootId: "frame:1" });
      else window.dispatchEvent(reason === "Escape" ? new KeyboardEvent("keydown", { key: "Escape", bubbles: true }) : reason === "blur" ? new Event("blur") : event("pointercancel", 40));
    });
    pointer("pointerup", 60); flush();
    expect(useEditorStore.getState().source).toBe(SOURCE);
    expect(useEditorStore.getState().history.length).toBe(history);
    expect(useEditorStore.getState().activeInspectorEditDocumentId).toBeNull();
  });
  it("restores a preview in its original tab when switching documents", () => {
    const id = useEditorStore.getState().activeDocumentId;
    begin(); pointer("pointermove", 40); flush();
    act(() => { dispatch({ type: "NEW_DOCUMENT", source: "other document" }); });
    pointer("pointerup", 60);
    expect(useEditorStore.getState().source).toBe("other document");
    expect(useEditorStore.getState().documents[id].source).toBe(SOURCE);
  });
  it("never overwrites an intervening source edit", () => {
    begin(); pointer("pointermove", 40); flush();
    act(() => { dispatch({ type: "CODE_EDITED", source: SOURCE + "\n% External edit" }); });
    pointer("pointerup", 60); flush();
    expect(useEditorStore.getState().source).toBe(SOURCE + "\n% External edit");
  });
  it("ignores other pointers and does not record a click or a return to the origin", () => {
    const history = useEditorStore.getState().history.length;
    begin(); pointer("pointermove", 40, 0, 2); flush();
    expect(useEditorStore.getState().source).toBe(SOURCE);
    pointer("pointermove", 40); flush(); pointer("pointerup", 0);
    expect(useEditorStore.getState().source).toBe(SOURCE);
    expect(useEditorStore.getState().history.length).toBe(history);
  });
  it("supports keyboard column nudges with one history entry", () => {
    const history = useEditorStore.getState().history.length;
    act(() => { host.querySelector('[role="separator"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })); });
    expect(useEditorStore.getState().source).not.toBe(SOURCE);
    expect(useEditorStore.getState().history.length).toBe(history + 1);
  });
  it.each(["nw", "ne", "sw", "se"])("resizes from the %s image corner and retains selection after reflow", async corner => {
    act(() => { dispatch({ type: "SET_DECK_OBJECT_SELECTION", frameId: layout.frameId, objectId: layout.graphics[0].itemId }); });
    const bounds = layout.graphics[0].bounds;
    begin(`deck-image-resize-${corner}`);
    const dx = (corner.endsWith("e") ? 1 : -1) * bounds.width;
    const dy = (corner.startsWith("s") ? 1 : -1) * bounds.height;
    pointer("pointermove", dx, dy); flush();
    expect(useEditorStore.getState().source).toContain("width=.75\\linewidth");
    await renderSnapshot();
    expect(host.querySelectorAll('[data-testid^="deck-image-resize-"]')).toHaveLength(4);
    pointer("pointerup", dx, dy); await renderSnapshot();
    expect(useEditorStore.getState().deckObjectSelection?.objectId).toBe(layout.graphics[0].itemId);
    expect(layout.graphics[0].bounds.width).toBeCloseTo(bounds.width * 1.5, 3);
    expect(layout.graphics[0].bounds.height).toBeCloseTo(bounds.height * 1.5, 3);
  });
  it("does not start a gesture while a new overlay step is pending", () => {
    act(() => { dispatch({ type: "SET_DECK_STEP", rootId: "frame:0", step: 2 }); });
    begin(); pointer("pointerup", 40);
    expect(useEditorStore.getState().source).toBe(SOURCE);
  });
  it("rejects gestures against a stale rendered source or step", () => {
    act(() => { dispatch({ type: "CODE_EDITED", source: SOURCE + "\n% typing" }); });
    begin(); pointer("pointerup", 40);
    expect(useEditorStore.getState().source).toBe(SOURCE + "\n% typing");
  });
});
