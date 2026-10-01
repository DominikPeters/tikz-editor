/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useDeferredPropertyCleanup, type SchedulePropertyCleanup } from "../../packages/app/src/ui/canvas-panel/useDeferredPropertyCleanup.js";
import type { DragState } from "../../packages/app/src/ui/canvas-panel/types.js";

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
  const dispatch = vi.fn();
  const dragRef = { current: null as DragState | null };
  let schedule: SchedulePropertyCleanup;
  function Harness({ source, revision }: { source: string; revision: number }) {
    schedule = useDeferredPropertyCleanup({ documentId: "doc", source, sourceRevision: revision, dragRef, dispatch });
    return null;
  }
  const reply = (requestId: number, source: string) => ({ data: { requestId, result: {
    kind: "success", newSource: `${source}!`, patches: [{ oldSpan: {from: source.length,to: source.length}, newSpan: {from: source.length,to:source.length+1},replacement:"!" }]
  } } });
  try {
    await act(async () => { root.render(React.createElement(Harness, { source: "first", revision: 1 })); });
    await act(async () => { schedule!("first", ["path:0"], "gesture-1"); });
    const firstId = workers[0].postMessage.mock.calls[0][0].requestId as number;
    await act(async () => { root.render(React.createElement(Harness, { source: "second", revision: 2 })); });
    workers[0].onmessage!(reply(firstId, "first"));
    expect(dispatch).not.toHaveBeenCalled();
    await act(async () => { schedule!("second", ["path:0"], "gesture-2"); });
    expect(workers).toHaveLength(1);
    const secondId = workers[0].postMessage.mock.calls[1][0].requestId as number;
    workers[0].onmessage!(reply(firstId, "first"));
    expect(dispatch).not.toHaveBeenCalled();
    workers[0].onmessage!(reply(secondId, "second"));
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][0]).toMatchObject({ expectedDocumentRevision: { documentId: "doc", sourceRevision: 2 }, precomputedSource: "second", historyMergeKey: "gesture-2" });
    // Returning to old text must not resubmit a consumed cleanup request.
    await act(async () => { root.render(React.createElement(Harness, { source: "third", revision: 3 })); });
    await act(async () => { root.render(React.createElement(Harness, { source: "second", revision: 4 })); });
    expect(workers[0].postMessage).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => { root.unmount(); });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  }
});
