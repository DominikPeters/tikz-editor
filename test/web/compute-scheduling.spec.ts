/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeSchedulingPolicy, type ComputeSchedulingInput } from "../../packages/app/src/ui/compute-scheduling";
import { useScheduledCompute } from "../../packages/app/src/ui/hooks/useScheduledCompute";
import type { ComputeRequest } from "../../packages/app/src/compute";

function input(overrides: Partial<ComputeSchedulingInput> = {}, request: Partial<ComputeSchedulingInput["request"]> = {}): ComputeSchedulingInput {
  return {
    request: { documentId: "doc-1", activeRootId: "frame:0", deckStep: 1, source: "before", sourceRevision: 1,
      documentFileRef: null, textEditMaskSpan: null, trigger: "other", ...request },
    sourceChangeOrigin: "source-editor", dragKind: null, sourceScrubActive: false,
    inspectorEditActive: false, canvasTextEditActive: false, assetRefreshToken: 0, ...overrides
  };
}

describe("render scheduling policy", () => {
  const before = input();
  it("renders initial state immediately, including restored typing provenance", () => {
    expect(computeSchedulingPolicy(null, before)).toEqual({ cause: "initial", delayMs: null });
  });
  it("debounces actual source typing independently of stale changed-object IDs", () => {
    expect(computeSchedulingPolicy(before, input({}, { source: "after", changedSourceIds: ["old-target"] })))
      .toEqual({ cause: "source-typing", delayMs: 120 });
    expect(computeSchedulingPolicy(before, input({}, { source: "x".repeat(80_001) })).delayMs).toBe(220);
  });
  it.each([
    [{}, { activeRootId: "frame:1" }, "root-switch"],
    [{}, { documentId: "doc-2", source: "new document" }, "document-switch"],
    [{}, { deckStep: 2 }, "overlay-step"],
    [{}, { documentFileRef: { kind: "file", name: "saved.tex" } }, "file-context"],
    [{ assetRefreshToken: 1 }, {}, "asset-refresh"],
    [{}, { textEditMaskSpan: { from: 0, to: 4 } }, "text-edit-state"],
  ] as const)("flushes discrete context changes without inheriting typing delay", (state, request, cause) => {
    expect(computeSchedulingPolicy(before, input(state, request))).toEqual({ cause, delayMs: null });
  });
  it("lets navigation win when pending source and root both change", () => {
    expect(computeSchedulingPolicy(before, input({}, { activeRootId: "frame:1", source: "pending edit" })))
      .toEqual({ cause: "root-switch", delayMs: null });
  });
  it.each([
    [{ dragKind: "handle" }, "drag-handle"], [{ dragKind: "resize" }, "drag-element"],
    [{ dragKind: "rotate" }, "drag-element"], [{ dragKind: "element" }, "drag-element"],
    [{ sourceScrubActive: true }, "source-scrub"], [{ inspectorEditActive: true }, "inspector-edit"],
    [{ canvasTextEditActive: true }, "canvas-text-edit"],
  ] as const)("keeps rapid direct editing responsive", (state, cause) => {
    expect(computeSchedulingPolicy(before, input(state, { source: "after" }))).toEqual({ cause, delayMs: null });
  });
  it.each([
    ["history", "history", null], ["disk", "disk-update", null],
    ["edit-command", "edit-command", null], ["assistant", "assistant-update", 60],
  ] as const)("uses explicit provenance for %s source changes", (sourceChangeOrigin, cause, delayMs) => {
    expect(computeSchedulingPolicy(before, input({ sourceChangeOrigin }, { source: "after" }))).toEqual({ cause, delayMs });
  });
});

describe("scheduled render transitions", () => {
  let root: Root;
  const scheduler = { schedule: vi.fn<(request: ComputeRequest) => void>(), invalidate: vi.fn(), dispose: vi.fn() };
  const schedulerRef = { current: scheduler };
  function Harness({ value }: { value: ComputeSchedulingInput }) {
    useScheduledCompute(schedulerRef, value);
    return null;
  }
  function update(value: ComputeSchedulingInput) {
    act(() => { root.render(React.createElement(Harness, { value })); });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(document.createElement("div"));
    scheduler.schedule.mockClear(); scheduler.invalidate.mockClear();
    update(input());
    scheduler.schedule.mockClear(); scheduler.invalidate.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers(); vi.unstubAllGlobals();
  });
  it("coalesces source typing and cancels obsolete computation as soon as source changes", () => {
    update(input({}, { source: "first", sourceRevision: 2 }));
    expect(scheduler.invalidate).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(100); });
    update(input({}, { source: "second", sourceRevision: 3 }));
    act(() => { vi.advanceTimersByTime(119); });
    expect(scheduler.schedule).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(scheduler.schedule).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      source: "second", schedulingTrigger: "source-typing", inferSourceChanges: true
    }));
  });
  it.each(["root", "step", "document"] as const)("flushes pending typing on %s navigation and retires its timer", kind => {
    const typed = input({}, { source: "latest typing", sourceRevision: 2 });
    update(typed);
    act(() => { vi.advanceTimersByTime(50); });
    const navigated = { ...typed, request: { ...typed.request,
      ...(kind === "root" ? { activeRootId: "frame:1" } : kind === "step" ? { deckStep: 2 } : { documentId: "doc-2" }) } };
    update(navigated);
    expect(scheduler.schedule).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      source: "latest typing", activeRootId: navigated.request.activeRootId,
      deckStep: navigated.request.deckStep, documentId: navigated.request.documentId, inferSourceChanges: true
    }));
    act(() => { vi.advanceTimersByTime(500); });
    expect(scheduler.schedule).toHaveBeenCalledTimes(1);
  });
  it("does not restart the debounce for unrelated rerenders", () => {
    const typed = input({}, { source: "typed", sourceRevision: 2 });
    update(typed);
    act(() => { vi.advanceTimersByTime(100); });
    update(typed);
    act(() => { vi.advanceTimersByTime(20); });
    expect(scheduler.schedule).toHaveBeenCalledTimes(1);
  });
  it("flushes undo while retiring a pending assistant stream update", () => {
    update(input({ sourceChangeOrigin: "assistant" }, { source: "stream chunk", sourceRevision: 2 }));
    act(() => { vi.advanceTimersByTime(30); });
    update(input({ sourceChangeOrigin: "history" }, { source: "undone", sourceRevision: 3 }));
    expect(scheduler.schedule).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      source: "undone", schedulingTrigger: "history", inferSourceChanges: false
    }));
    act(() => { vi.advanceTimersByTime(100); });
    expect(scheduler.schedule).toHaveBeenCalledTimes(1);
  });
  it("keeps successive source scrub values immediate", () => {
    for (const source of ["1", "2", "3"]) update(input({ sourceScrubActive: true }, { source }));
    expect(scheduler.schedule.mock.calls.map(([request]) => [request.source, request.schedulingTrigger]))
      .toEqual([["1", "source-scrub"], ["2", "source-scrub"], ["3", "source-scrub"]]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
