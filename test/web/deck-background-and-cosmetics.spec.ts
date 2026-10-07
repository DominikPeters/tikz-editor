/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAfterCanvasPaint } from "../../packages/app/src/ui/hooks/useAfterCanvasPaint";
import { useDeckNeighborPrewarm } from "../../packages/app/src/ui/hooks/useDeckNeighborPrewarm";
import { useEditorStore } from "../../packages/app/src/store/store";
import { makeInitialState } from "../../packages/app/src/store/reducer";
import { computeSnapshot, prewarmDeckNeighbors } from "../../packages/app/src/compute";

vi.mock("../../packages/app/src/compute", async importOriginal => ({
  ...await importOriginal<typeof import("../../packages/app/src/compute")>(),
  prewarmDeckNeighbors: vi.fn(async () => {}),
}));

let root: Root;
const frames = new Map<number, FrameRequestCallback>();
const idle = new Map<number, IdleRequestCallback>();
let nextHandle = 0;
const warm = vi.mocked(prewarmDeckNeighbors);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextHandle, callback); return nextHandle; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  window.requestIdleCallback = (callback: IdleRequestCallback) => { idle.set(++nextHandle, callback); return nextHandle; };
  window.cancelIdleCallback = id => { idle.delete(id); };
  frames.clear(); idle.clear(); warm.mockClear();
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => { root.unmount(); });
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete (window as Partial<Window>).requestIdleCallback;
  delete (window as Partial<Window>).cancelIdleCallback;
});
function frame() {
  const callbacks = [...frames.values()]; frames.clear();
  act(() => { for (const callback of callbacks) callback(performance.now()); });
}
function runIdle() {
  const callbacks = [...idle.values()]; idle.clear();
  act(() => { for (const callback of callbacks) callback({ didTimeout: false, timeRemaining: () => 20 }); });
}

describe("cosmetics after canvas paint", () => {
  function Harness({ effect, ready }: { effect: () => void; ready: boolean }) {
    useAfterCanvasPaint(effect, ready); return null;
  }
  it("waits for a paint opportunity and cancels obsolete root/source callbacks", () => {
    const old = vi.fn(), latest = vi.fn();
    act(() => { root.render(React.createElement(Harness, { effect: old, ready: true })); });
    frame(); expect(old).not.toHaveBeenCalled();
    act(() => { root.render(React.createElement(Harness, { effect: latest, ready: true })); });
    frame(); expect(latest).not.toHaveBeenCalled();
    frame(); expect(latest).toHaveBeenCalledTimes(1); expect(old).not.toHaveBeenCalled();
  });
  it("does not use cosmetic source ranges until the matching canvas is ready", () => {
    const effect = vi.fn();
    act(() => { root.render(React.createElement(Harness, { effect, ready: false })); });
    frame(); frame(); expect(effect).not.toHaveBeenCalled();
    act(() => { root.render(React.createElement(Harness, { effect, ready: true })); });
    frame(); frame(); expect(effect).toHaveBeenCalledTimes(1);
  });
});

describe("neighbor prewarm input priority", () => {
  async function mount() {
    useEditorStore.setState(makeInitialState());
    const dispatch = useEditorStore.getState().dispatch;
    const source = String.raw`\documentclass{beamer}\begin{document}\begin{frame}One\end{frame}\begin{frame}Two\end{frame}\end{document}`;
    dispatch({ type: "CODE_EDITED", source });
    const state = useEditorStore.getState();
    const result = await computeSnapshot({ id: "warm-base", documentId: state.activeDocumentId, source,
      sourceRevision: state.sourceRevision, activeRootId: "frame:0" });
    dispatch({ type: "COMPUTE_REQUESTED", requestId: "warm-base" });
    dispatch({ type: "SNAPSHOT_READY", requestId: "warm-base", snapshot: result.snapshot });
    function Harness() { useDeckNeighborPrewarm(); return null; }
    act(() => { root.render(React.createElement(Harness)); });
  }
  it("uses idle priority and a small cooperative budget", async () => {
    await mount();
    expect(warm).not.toHaveBeenCalled();
    runIdle();
    expect(warm).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ activeRootId: "frame:0" }),
      expect.objectContaining({ budgetMs: 4, signal: expect.any(AbortSignal) }));
  });
  it("does not requeue while a pointer is held or immediately after release", async () => {
    await mount();
    act(() => { window.dispatchEvent(new Event("pointerdown")); });
    useEditorStore.getState().dispatch({ type: "SET_CANVAS_TRANSFORM", transform: { scale: 1, translateX: 12, translateY: 12 } });
    runIdle(); expect(warm).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new Event("pointerup")); vi.advanceTimersByTime(249); });
    runIdle(); expect(warm).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    runIdle(); expect(warm).toHaveBeenCalledTimes(1);
  });
  it("cancels active background work on input and source edits", async () => {
    let finish!: () => void;
    warm.mockImplementationOnce(async () => new Promise<void>(resolve => { finish = resolve; }));
    await mount(); runIdle();
    const signal = warm.mock.calls[0][1].signal!;
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" })); });
    expect(signal.aborted).toBe(true);
    useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: useEditorStore.getState().source + "% editing" });
    act(() => { window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA" })); vi.advanceTimersByTime(500); });
    runIdle(); expect(warm).toHaveBeenCalledTimes(1);
    finish(); await Promise.resolve();
  });
  it("does not warm hidden windows", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await mount(); runIdle(); expect(warm).not.toHaveBeenCalled();
  });
});
