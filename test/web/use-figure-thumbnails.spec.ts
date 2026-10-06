/** @vitest-environment jsdom */

import { createElement, useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFigureThumbnailStateForTests, useFigureThumbnails } from "../../packages/app/src/ui/useFigureThumbnails";

vi.mock("../../packages/app/src/ui/workers/thumbnail-worker-client", () => ({
  requestThumbnail: vi.fn(),
  cancelGroup: vi.fn()
}));

import { cancelGroup, requestThumbnail } from "../../packages/app/src/ui/workers/thumbnail-worker-client";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type FigureEntry = {
  id: string;
  span: { from: number; to: number };
  deckFrameIndex?: number;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function Harness(props: {
  source: string;
  figures: readonly FigureEntry[];
  documentKey?: string;
  graphicsPreviewBundleKey?: string | null;
  priorityFigureIds?: readonly string[];
  maxToRender?: number;
  externalThumbnail?: { figureId: string; deckFrameIndex?: number; url: string | null };
  onUpdate: (value: ReadonlyMap<string, string>) => void;
}) {
  const thumbnails = useFigureThumbnails(props.source, props.figures, {
    documentKey: props.documentKey,
    graphicsPreviewBundleKey: props.graphicsPreviewBundleKey,
    priorityFigureIds: props.priorityFigureIds,
    maxToRender: props.maxToRender ?? 4,
    refreshDelayMs: 0,
    externalThumbnail: props.externalThumbnail
  });

  useEffect(() => {
    props.onUpdate(new Map(thumbnails));
  }, [thumbnails, props]);

  return null;
}

describe("useFigureThumbnails", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetFigureThumbnailStateForTests();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("mirrors an existing render without requesting the active frame or restarting other work", async () => {
    const pending = createDeferred<any>();
    vi.mocked(requestThumbnail).mockReturnValue(pending.promise);
    const figures = [
      { id: "active", span: { from: 0, to: 1 }, deckFrameIndex: 0 },
      { id: "other", span: { from: 1, to: 2 }, deckFrameIndex: 1 }
    ];
    let latest: ReadonlyMap<string, string> = new Map();
    const props = { source: "ab", figures, onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; } };
    await act(async () => {
      root.render(createElement(Harness, { ...props,
        externalThumbnail: { figureId: "active", deckFrameIndex: 0, url: null } }));
    });
    expect(requestThumbnail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestThumbnail).mock.calls[0]?.[0].deckFrameIndex).toBe(1);
    const cancellations = vi.mocked(cancelGroup).mock.calls.length;
    for (const url of ["data:main-step-1", "data:main-step-2", "data:main-edited"]) {
      await act(async () => {
        root.render(createElement(Harness, { ...props,
          externalThumbnail: { figureId: "active", deckFrameIndex: 0, url } }));
      });
      expect(latest.get("active")).toBe(url);
    }
    expect(requestThumbnail).toHaveBeenCalledTimes(1);
    expect(cancelGroup).toHaveBeenCalledTimes(cancellations);
  });

  it("keeps mirroring the main render across edited frame thumbnail IDs", async () => {
    vi.mocked(requestThumbnail).mockReturnValue(new Promise(() => {}));
    let latest: ReadonlyMap<string, string> = new Map();
    const onUpdate = (value: ReadonlyMap<string, string>) => { latest = value; };
    for (const [id, source, url] of [["old", "a", "data:main-old"], ["new", "b", "data:main-old"], ["new", "b", "data:main-new"]]) {
      await act(async () => {
        root.render(createElement(Harness, { source,
          figures: [{ id, span: { from: 0, to: 1 }, deckFrameIndex: 0 }],
          externalThumbnail: { figureId: id, deckFrameIndex: 0, url }, onUpdate }));
        vi.runOnlyPendingTimers(); await flushMicrotasks();
      });
      expect(latest.get(id)).toBe(url);
    }
    expect(requestThumbnail).not.toHaveBeenCalled();
  });

  it("retains a mirrored image until the inactive frame's final-overlay thumbnail arrives", async () => {
    const pending = createDeferred<any>();
    vi.mocked(requestThumbnail).mockReturnValue(pending.promise);
    const figures = [{ id: "frame", span: { from: 0, to: 1 }, deckFrameIndex: 0 }];
    let latest: ReadonlyMap<string, string> = new Map();
    const props = { source: "a", figures, onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; } };
    await act(async () => {
      root.render(createElement(Harness, { ...props,
        externalThumbnail: { figureId: "frame", deckFrameIndex: 0, url: "data:main-step-1" } }));
    });
    expect(requestThumbnail).not.toHaveBeenCalled();
    await act(async () => { root.render(createElement(Harness, props)); });
    expect(requestThumbnail).toHaveBeenCalledTimes(1);
    expect(latest.get("frame")).toBe("data:main-step-1");
    await act(async () => { pending.resolve({ ok: true, svg: "<svg>final-overlay</svg>" }); await flushMicrotasks(); });
    await waitForCondition(() => latest.get("frame")?.includes("final-overlay") === true);
  });

  it("ignores an in-flight thumbnail after its frame starts mirroring the main render", async () => {
    const stale = createDeferred<any>();
    const final = createDeferred<any>();
    vi.mocked(requestThumbnail).mockReturnValueOnce(stale.promise).mockReturnValueOnce(final.promise);
    const figures = [{ id: "frame", span: { from: 0, to: 1 }, deckFrameIndex: 0 }];
    let latest: ReadonlyMap<string, string> = new Map();
    const props = { source: "a", figures, onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; } };
    await act(async () => { root.render(createElement(Harness, props)); });
    await act(async () => {
      root.render(createElement(Harness, { ...props,
        externalThumbnail: { figureId: "frame", deckFrameIndex: 0, url: "data:main" } }));
    });
    await act(async () => { stale.resolve({ ok: true, svg: "<svg>stale</svg>" }); await flushMicrotasks(); });
    expect(latest.get("frame")).toBe("data:main");
    await act(async () => { root.render(createElement(Harness, props)); });
    expect(requestThumbnail).toHaveBeenCalledTimes(2);
    expect(latest.get("frame")).toBe("data:main");
  });

  it("does not mirror the previous document while another document's main render is pending", async () => {
    const figures = [{ id: "frame", span: { from: 0, to: 1 }, deckFrameIndex: 0 }];
    let latest: ReadonlyMap<string, string> = new Map();
    const props = { source: "a", figures, onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; } };
    await act(async () => {
      root.render(createElement(Harness, { ...props, documentKey: "first",
        externalThumbnail: { figureId: "frame", deckFrameIndex: 0, url: "data:first-document" } }));
    });
    await act(async () => {
      root.render(createElement(Harness, { ...props, documentKey: "second",
        externalThumbnail: { figureId: "frame", deckFrameIndex: 0, url: null } }));
    });
    expect(latest.has("frame")).toBe(false);
    expect(requestThumbnail).not.toHaveBeenCalled();
  });

  it("cancels stale groups and ignores stale results after source changes", async () => {
    const pendingOld = createDeferred<any>();
    const pendingNew = createDeferred<any>();
    vi.mocked(requestThumbnail)
      .mockReturnValueOnce(pendingOld.promise)
      .mockReturnValueOnce(pendingNew.promise);

    let latest: ReadonlyMap<string, string> = new Map<string, string>();
    const figure = { id: "figure:0", span: { from: 0, to: 1000 } };
    const figures = [figure] as const;
    const sourceA = "\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}";
    const sourceB = "\\begin{tikzpicture}\\draw (0,0)--(2,2);\\end{tikzpicture}\n%changed";

    await act(async () => {
      root.render(createElement(Harness, {
        source: sourceA,
        figures,
        onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; }
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
    expect(requestThumbnail).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(createElement(Harness, {
        source: sourceB,
        figures,
        onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; }
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });

    await waitForCondition(() => vi.mocked(requestThumbnail).mock.calls.length >= 2);
    expect(requestThumbnail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(cancelGroup).mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(latest.get("figure:0")).toBeUndefined();

    pendingOld.resolve({
      type: "result",
      ok: true,
      requestId: "old",
      groupId: "old-group",
      figureId: "figure:0",
      figureSignature: "old-sig",
      svg: "<svg>old</svg>"
    });
    await act(async () => {
      await flushMicrotasks();
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
    expect(latest.get("figure:0")).toBeUndefined();

    pendingNew.resolve({
      type: "result",
      ok: true,
      requestId: "new",
      groupId: "new-group",
      figureId: "figure:0",
      figureSignature: "new-sig",
      svg: "<svg>new</svg>"
    });
    await act(async () => {
      await flushMicrotasks();
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });

    expect(latest.get("figure:0")).toContain("%3Csvg%3Enew%3C%2Fsvg%3E");
  });

  it("restarts a canceled thumbnail when visibility changes without a source edit", async () => {
    const pending = createDeferred<any>();
    vi.mocked(requestThumbnail).mockReturnValueOnce(pending.promise).mockImplementation(async request => ({
      type: "result", ok: true, requestId: request.requestId, groupId: request.groupId,
      figureId: request.figureId, figureSignature: request.figureSignature, svg: "<svg>fresh</svg>"
    }));
    const figures = [{ id: "figure:0", span: { from: 0, to: 1 } }];
    let latest: ReadonlyMap<string, string> = new Map();
    const props = { source: "x", figures, onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; } };
    await act(async () => { root.render(createElement(Harness, { ...props, priorityFigureIds: [] })); });
    expect(requestThumbnail).toHaveBeenCalledTimes(1);
    await act(async () => { root.render(createElement(Harness, { ...props, priorityFigureIds: ["figure:0"] })); });
    await waitForCondition(() => latest.has("figure:0"));
    expect(latest.get("figure:0")).toContain("fresh");
    pending.resolve({ ok: true, svg: "<svg>stale</svg>" });
    await act(flushMicrotasks);
    expect(latest.get("figure:0")).toContain("fresh");
  });

  it("keeps last thumbnail visible while next render is pending", async () => {
    const pendingFirst = createDeferred<any>();
    const pendingSecond = createDeferred<any>();
    vi.mocked(requestThumbnail)
      .mockReturnValueOnce(pendingFirst.promise)
      .mockReturnValueOnce(pendingSecond.promise);

    let latest: ReadonlyMap<string, string> = new Map<string, string>();
    const figure = { id: "figure:0", span: { from: 0, to: 1000 } };
    const figures = [figure] as const;
    const sourceA = "\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}";
    const sourceB = "\\begin{tikzpicture}\\draw (0,0)--(3,3);\\end{tikzpicture}\n%changed";

    await act(async () => {
      root.render(createElement(Harness, {
        source: sourceA,
        figures,
        onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; }
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });

    await waitForCondition(() => vi.mocked(requestThumbnail).mock.calls.length >= 1);

    await act(async () => {
      pendingFirst.resolve({
        type: "result",
        ok: true,
        requestId: "first",
        groupId: "grp-1",
        figureId: "figure:0",
        figureSignature: "sig-1",
        svg: "<svg>first</svg>"
      });
      await flushMicrotasks();
      await flushMicrotasks();
      vi.runOnlyPendingTimers();
    });
    await waitForCondition(() => latest.get("figure:0") != null);
    const firstUrl = latest.get("figure:0");
    expect(firstUrl).toContain("%3Csvg%3Efirst%3C%2Fsvg%3E");

    await act(async () => {
      root.render(createElement(Harness, {
        source: sourceB,
        figures,
        onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; }
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });

    await waitForCondition(() => vi.mocked(requestThumbnail).mock.calls.length >= 2);
    expect(requestThumbnail).toHaveBeenCalledTimes(2);
    expect(latest.get("figure:0")).toBe(firstUrl);

    await act(async () => {
      pendingSecond.resolve({
        type: "result",
        ok: true,
        requestId: "second",
        groupId: "grp-2",
        figureId: "figure:0",
        figureSignature: "sig-2",
        svg: "<svg>second</svg>"
      });
      await flushMicrotasks();
      await flushMicrotasks();
      vi.runOnlyPendingTimers();
    });

    expect(latest.get("figure:0")).toContain("%3Csvg%3Esecond%3C%2Fsvg%3E");
  });

  it("defers off-screen thumbnails until priority changes", async () => {
    const pendingFigure1 = createDeferred<any>();
    const pendingFigure3 = createDeferred<any>();
    vi.mocked(requestThumbnail)
      .mockReturnValueOnce(pendingFigure1.promise)
      .mockReturnValueOnce(pendingFigure3.promise);

    let latest: ReadonlyMap<string, string> = new Map<string, string>();
    const figures = [
      { id: "figure:1", span: { from: 0, to: 1000 } },
      { id: "figure:2", span: { from: 0, to: 1000 } },
      { id: "figure:3", span: { from: 0, to: 1000 } }
    ] as const;
    const source = "\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}";

    await act(async () => {
      root.render(createElement(Harness, {
        source,
        figures,
        priorityFigureIds: ["figure:1"],
        maxToRender: 1,
        onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; }
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });

    expect(requestThumbnail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestThumbnail).mock.calls[0]?.[0].figureId).toBe("figure:1");

    pendingFigure1.resolve({
      type: "result",
      ok: true,
      requestId: "first",
      groupId: "grp-1",
      figureId: "figure:1",
      figureSignature: "sig-1",
      svg: "<svg>one</svg>"
    });
    await act(async () => {
      await flushMicrotasks();
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
    expect(latest.get("figure:1")).toContain("%3Csvg%3Eone%3C%2Fsvg%3E");
    expect(latest.get("figure:3")).toBeUndefined();

    await act(async () => {
      root.render(createElement(Harness, {
        source,
        figures,
        priorityFigureIds: ["figure:3"],
        maxToRender: 1,
        onUpdate: (value: ReadonlyMap<string, string>) => { latest = value; }
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });

    expect(requestThumbnail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(requestThumbnail).mock.calls[1]?.[0].figureId).toBe("figure:3");

    pendingFigure3.resolve({
      type: "result",
      ok: true,
      requestId: "second",
      groupId: "grp-2",
      figureId: "figure:3",
      figureSignature: "sig-3",
      svg: "<svg>three</svg>"
    });
    await act(async () => {
      await flushMicrotasks();
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });

    expect(latest.get("figure:3")).toContain("%3Csvg%3Ethree%3C%2Fsvg%3E");
  });

  it("invalidates deck thumbnails when document-level source changes", async () => {
    vi.mocked(requestThumbnail).mockImplementation(async (request) => ({
      type: "result",
      ok: true,
      requestId: request.requestId,
      groupId: request.groupId,
      figureId: request.figureId,
      figureSignature: request.figureSignature,
      svg: `<svg>${request.figureSignature}</svg>`
    }));

    const frame = "\\begin{frame}Hello\\end{frame}";
    const sourceA = `\\documentclass{beamer}\\usetheme{Madrid}${frame}`;
    const sourceB = `\\documentclass{beamer}\\usetheme{Bergen}${frame}`;
    const spanFrom = sourceA.indexOf(frame);
    const figures = [
      {
        id: "frame:0",
        span: { from: spanFrom, to: spanFrom + frame.length },
        deckFrameIndex: 0
      }
    ] as const;

    await act(async () => {
      root.render(createElement(Harness, {
        source: sourceA,
        figures,
        documentKey: "deck-document",
        onUpdate: () => undefined
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
    await waitForCondition(() => vi.mocked(requestThumbnail).mock.calls.length >= 1);
    const firstSignature =
      vi.mocked(requestThumbnail).mock.calls[0]?.[0].figureSignature;

    await act(async () => {
      root.render(createElement(Harness, {
        source: sourceB,
        figures,
        documentKey: "deck-document",
        onUpdate: () => undefined
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
    await waitForCondition(() => vi.mocked(requestThumbnail).mock.calls.length >= 2);

    expect(vi.mocked(requestThumbnail)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(requestThumbnail).mock.calls[1]?.[0].figureSignature)
      .not.toBe(firstSignature);
  });

  it("isolates thumbnail cache entries by document", async () => {
    vi.mocked(requestThumbnail).mockImplementation(async (request) => ({
      type: "result",
      ok: true,
      requestId: request.requestId,
      groupId: request.groupId,
      figureId: request.figureId,
      figureSignature: request.figureSignature,
      svg: "<svg />"
    }));
    const source = "\\begin{tikzpicture}\\end{tikzpicture}";
    const figures = [
      { id: "figure:0", span: { from: 0, to: source.length } }
    ] as const;

    await act(async () => {
      root.render(createElement(Harness, {
        source,
        figures,
        documentKey: "document-a",
        onUpdate: () => undefined
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
    await waitForCondition(() => vi.mocked(requestThumbnail).mock.calls.length >= 1);

    await act(async () => {
      root.render(createElement(Harness, {
        source,
        figures,
        documentKey: "document-b",
        onUpdate: () => undefined
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
    await waitForCondition(() => vi.mocked(requestThumbnail).mock.calls.length >= 2);

    expect(vi.mocked(requestThumbnail)).toHaveBeenCalledTimes(2);
  });

  it("invalidates thumbnails and forwards the graphics preview bundle key", async () => {
    vi.mocked(requestThumbnail).mockImplementation(async (request) => ({
      type: "result",
      ok: true,
      requestId: request.requestId,
      groupId: request.groupId,
      figureId: request.figureId,
      figureSignature: request.figureSignature,
      svg: "<svg />"
    }));
    const source = String.raw`\begin{tikzpicture}\node {\includegraphics{fig.png}};\end{tikzpicture}`;
    const figures = [
      { id: "figure:0", span: { from: 0, to: source.length } }
    ] as const;

    await act(async () => {
      root.render(createElement(Harness, {
        source,
        figures,
        documentKey: "document-images",
        graphicsPreviewBundleKey: "graphics:r1",
        onUpdate: () => undefined
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
    await waitForCondition(() => vi.mocked(requestThumbnail).mock.calls.length >= 1);
    expect(vi.mocked(requestThumbnail).mock.calls[0]?.[0])
      .toMatchObject({ graphicsPreviewBundleKey: "graphics:r1" });

    await act(async () => {
      root.render(createElement(Harness, {
        source,
        figures,
        documentKey: "document-images",
        graphicsPreviewBundleKey: "graphics:r2",
        onUpdate: () => undefined
      }));
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
    await waitForCondition(() => vi.mocked(requestThumbnail).mock.calls.length >= 2);
    expect(vi.mocked(requestThumbnail).mock.calls[1]?.[0])
      .toMatchObject({ graphicsPreviewBundleKey: "graphics:r2" });
  });
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForCondition(predicate: () => boolean, maxAttempts = 30): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await act(async () => {
      vi.runOnlyPendingTimers();
      await flushMicrotasks();
    });
  }
  throw new Error("Timed out waiting for condition");
}
