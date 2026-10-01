/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useDeferredPropertyCleanup } from "../../packages/app/src/ui/useDeferredPropertyCleanup.js";
import { useEditorStore } from "../../packages/app/src/store/store.js";
import { makeInitialState } from "../../packages/app/src/store/reducer.js";

it("reuses the cleanup worker and ignores replies from obsolete revisions", async () => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() { workers.push(this); }
  }
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  useEditorStore.setState(makeInitialState());
  const dispatch = useEditorStore.getState().dispatch;
  const documentId = useEditorStore.getState().activeDocumentId;
  function Harness() { useDeferredPropertyCleanup(); return null; }
  const schedule = (source: string, historyMergeKey: string) => dispatch({ type: "QUEUE_PROPERTY_CLEANUP", documentId,
    task: { source, elementIds: ["path:0"] }, historyMergeKey });
  const reply = (requestId: number, source: string) => ({ data: { requestId, result: {
    kind: "success", newSource: `${source}!`, patches: [{ oldSpan: {from: source.length,to: source.length}, newSpan: {from: source.length,to:source.length+1},replacement:"!" }]
  } } });
  try {
    await act(async () => { root.render(React.createElement(Harness)); dispatch({ type: "CODE_EDITED", source: "first" }); schedule("first", "gesture-1"); });
    const firstId = workers[0].postMessage.mock.calls[0][0].requestId as number;
    await act(async () => { dispatch({ type: "CODE_EDITED", source: "second" }); });
    await act(async () => { workers[0].onmessage!(reply(firstId, "first")); });
    expect(useEditorStore.getState().source).toBe("second");
    await act(async () => { schedule("second", "gesture-2"); });
    expect(workers).toHaveLength(1);
    const secondId = workers[0].postMessage.mock.calls[1][0].requestId as number;
    await act(async () => { workers[0].onmessage!(reply(firstId, "first")); });
    expect(useEditorStore.getState().source).toBe("second");
    await act(async () => { workers[0].onmessage!(reply(secondId, "second")); });
    expect(useEditorStore.getState().source).toBe("second!");
    // Returning to old text must not resubmit a consumed cleanup request.
    await act(async () => { dispatch({ type: "CODE_EDITED", source: "third" }); });
    await act(async () => { dispatch({ type: "CODE_EDITED", source: "second" }); });
    expect(workers[0].postMessage).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => { root.unmount(); });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  }
});
