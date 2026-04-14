/** @vitest-environment jsdom */

import React, { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorStoreApi } from "../../packages/app/src/store/store";
import { useDemoPlayer } from "../../packages/app/src/embed/useDemoPlayer";
import type { CursorFrameState, DemoScript } from "../../packages/app/src/embed/demo-script";

type HarnessProps = {
  store: EditorStoreApi | null;
  script: DemoScript;
  viewportEl?: Element | null;
  onCursor?: (state: CursorFrameState) => void;
};

function Harness({ store, script, viewportEl, onCursor }: HarnessProps) {
  useDemoPlayer({
    store,
    script,
    onCursor: onCursor ?? (() => undefined),
    viewportEl
  });
  return null;
}

type MockObserverEntry = {
  ratio: number;
  target: Element;
};

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  private callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe = vi.fn((_target: Element) => undefined);
  unobserve = vi.fn((_target: Element) => undefined);
  disconnect = vi.fn(() => undefined);

  trigger({ ratio, target }: MockObserverEntry): void {
    const entry = {
      time: 0,
      target,
      rootBounds: null,
      boundingClientRect: DOMRectReadOnly.fromRect(),
      intersectionRect: DOMRectReadOnly.fromRect(),
      isIntersecting: ratio > 0,
      intersectionRatio: ratio
    } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

function createStoreStub() {
  const dispatch = vi.fn<(action: unknown) => void>();
  const store = {
    getState: () => ({ dispatch })
  } as unknown as EditorStoreApi;
  return { store, dispatch };
}

function collectEditedSources(dispatch: ReturnType<typeof vi.fn>): string[] {
  return dispatch.mock.calls
    .map(([action]) => action as { type?: string; source?: string })
    .filter((action) => action.type === "CODE_EDITED")
    .map((action) => action.source ?? "");
}

describe("useDemoPlayer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let viewport: HTMLDivElement;
  let now = 0;
  let rafId = 1;
  let rafCallbacks = new Map<number, FrameRequestCallback>();
  let hidden = false;

  const performanceNowSpy = vi.spyOn(performance, "now");

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    viewport = document.createElement("div");
    document.body.appendChild(container);
    document.body.appendChild(viewport);
    root = createRoot(container);

    now = 0;
    rafId = 1;
    rafCallbacks = new Map<number, FrameRequestCallback>();
    performanceNowSpy.mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = rafId;
      rafId += 1;
      rafCallbacks.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafCallbacks.delete(id);
    });
    MockIntersectionObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver as unknown as typeof IntersectionObserver);
    hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    viewport.remove();
    vi.unstubAllGlobals();
    performanceNowSpy.mockReset();
  });

  async function advanceFrame(ms: number): Promise<void> {
    await act(async () => {
      now += ms;
      const callbacks = [...rafCallbacks.values()];
      rafCallbacks.clear();
      for (const callback of callbacks) {
        callback(now);
      }
      await Promise.resolve();
    });
  }

  it("replays from start after duration rollover and re-applies events in the next cycle", async () => {
    const { store, dispatch } = createStoreStub();
    const script: DemoScript = {
      id: "loop",
      duration: 100,
      initialSource: "init",
      cursor: [],
      events: [{ t: 20, kind: "loadSource", source: "event" }]
    };

    await act(async () => {
      root.render(createElement(Harness, { store, script }));
    });

    expect(collectEditedSources(dispatch)).toEqual(["init"]);

    await advanceFrame(10);
    expect(collectEditedSources(dispatch)).toEqual(["init"]);

    await advanceFrame(15);
    expect(collectEditedSources(dispatch)).toEqual(["init", "event"]);

    await advanceFrame(80);
    expect(collectEditedSources(dispatch)).toEqual(["init", "event", "init"]);

    await advanceFrame(25);
    expect(collectEditedSources(dispatch)).toEqual(["init", "event", "init", "event"]);
  });

  it("pauses and resumes playback across visibility and viewport gating without time skew", async () => {
    const { store, dispatch } = createStoreStub();
    const script: DemoScript = {
      id: "gates",
      duration: 500,
      initialSource: "init",
      cursor: [],
      events: [
        { t: 100, kind: "loadSource", source: "event-1" },
        { t: 180, kind: "loadSource", source: "event-2" }
      ]
    };

    await act(async () => {
      root.render(createElement(Harness, { store, script, viewportEl: viewport }));
    });

    expect(collectEditedSources(dispatch)).toEqual([]);
    const observer = MockIntersectionObserver.instances[0];
    expect(observer).toBeDefined();
    observer!.trigger({ ratio: 1, target: viewport });
    expect(collectEditedSources(dispatch)).toEqual(["init"]);

    await advanceFrame(90);
    expect(collectEditedSources(dispatch)).toEqual(["init"]);

    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await advanceFrame(100);
    expect(collectEditedSources(dispatch)).toEqual(["init"]);

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await advanceFrame(5);
    expect(collectEditedSources(dispatch)).toEqual(["init"]);
    await advanceFrame(10);
    expect(collectEditedSources(dispatch)).toEqual(["init", "event-1"]);

    observer!.trigger({ ratio: 0, target: viewport });
    await advanceFrame(100);
    expect(collectEditedSources(dispatch)).toEqual(["init", "event-1"]);

    observer!.trigger({ ratio: 1, target: viewport });
    await advanceFrame(70);
    expect(collectEditedSources(dispatch)).toEqual(["init", "event-1"]);
    await advanceFrame(10);
    expect(collectEditedSources(dispatch)).toEqual(["init", "event-1", "event-2"]);
  });

  it("restarts playback from the new script when script prop changes", async () => {
    const { store, dispatch } = createStoreStub();
    const scriptA: DemoScript = {
      id: "A",
      duration: 1000,
      initialSource: "A-init",
      cursor: [],
      events: [{ t: 50, kind: "loadSource", source: "A-event" }]
    };
    const scriptB: DemoScript = {
      id: "B",
      duration: 1000,
      initialSource: "B-init",
      cursor: [],
      events: [{ t: 20, kind: "loadSource", source: "B-event" }]
    };

    await act(async () => {
      root.render(createElement(Harness, { store, script: scriptA }));
    });
    expect(collectEditedSources(dispatch)).toEqual(["A-init"]);

    await advanceFrame(30);
    expect(collectEditedSources(dispatch)).toEqual(["A-init"]);

    await act(async () => {
      root.render(createElement(Harness, { store, script: scriptB }));
    });
    expect(collectEditedSources(dispatch)).toEqual(["A-init", "B-init"]);

    await advanceFrame(25);
    expect(collectEditedSources(dispatch)).toEqual(["A-init", "B-init", "B-event"]);
    expect(collectEditedSources(dispatch)).not.toContain("A-event");
  });
});
