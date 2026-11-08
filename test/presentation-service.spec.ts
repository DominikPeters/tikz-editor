import { getActiveDocument } from "../packages/app/src/store/document-sessions.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationService } from "../packages/app/src/presentation/service.js";
import type { PlatformPresentationApi, PresentationMessage, PresentationOptions } from "../packages/app/src/presentation/types.js";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../packages/app/src/platform/current.js";
import { BeamerPresentationRenderer } from "../packages/app/src/presentation/renderer.js";
import { useEditorStore } from "../packages/app/src/store/store.js";
import { makeInitialState } from "../packages/app/src/store/reducer.js";
import type { DocumentFileRef } from "../packages/app/src/store/types.js";
import * as frameScheduling from "../packages/app/src/ui/frame-scheduling.js";

const SOURCE = String.raw`\documentclass{beamer}\begin{document}\begin{frame}A\pause B\end{frame}\end{document}`;
const OPTIONS: PresentationOptions = { mode: "window", audienceDisplay: null, presenterDisplay: null, showPresenter: false, countdownMinutes: null };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

describe("presentation ownership and lifecycle", () => {
  let service: PresentationService;
  const original = useEditorStore.getState();
  let messages: PresentationMessage[], receive: (message: PresentationMessage) => void, lost: () => void, restored: (() => void) | undefined;
  let saved: string[];
  let power: boolean[], firstClose: ReturnType<typeof deferred>;
  let slowClose = false, slowOpen = false;
  let opening: ReturnType<typeof deferred>;
  const closeWindows = vi.fn();
  beforeEach(() => {
    messages = []; power = []; saved = []; firstClose = deferred(); slowClose = false;
    opening = deferred(); slowOpen = false; closeWindows.mockReset();
    let opens = 0;
    const api: PlatformPresentationApi = {
      displays: () => Promise.resolve([]),
      connect: (_id, handler) => { receive = handler; return Promise.resolve({ send: message => { messages.push(message); }, close() {} }); },
      open: (_id, _options, outputLost, outputRestored) => {
        const first = opens++ === 0; lost = outputLost; restored = outputRestored;
        const windows = { close: () => { closeWindows(); return first && slowClose ? firstClose.promise : Promise.resolve(); }, showPresenter() {}, closeView() {}, recoverOutput() {}, swapDisplays() {} };
        return slowOpen ? opening.promise.then(() => windows) : Promise.resolve(windows);
      },
      keepAwake: active => { power.push(active); return Promise.resolve(); },
    };
    setActiveEditorPlatform({ id: "presentation-owner-test", presentation: api, persistence: { load: () => null, save: key => { saved.push(key); } } });
    useEditorStore.setState(makeInitialState());
    useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source: SOURCE });
    service = new PresentationService();
  });
  afterEach(async () => { opening.resolve(); firstClose.resolve(); await service.stop(); useEditorStore.setState(original); vi.restoreAllMocks(); });

  it("refreshes a restarted session while the previous session's renderer is still pending", async () => {
    const doc = getActiveDocument(useEditorStore.getState());
    await service.start(doc, OPTIONS, 0);
    const blocked = deferred(), finished = deferred();
    const create = BeamerPresentationRenderer.create;
    const assets = vi.spyOn(BeamerPresentationRenderer, "create").mockImplementationOnce(async (...args) => {
      try { await blocked.promise; return await create(...args); }
      finally { finished.resolve(); }
    });
    try {
      useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: SOURCE + "\n% old refresh" });
      await vi.waitFor(() => expect(assets).toHaveBeenCalledTimes(1));
      await service.stop();
      await service.start(getActiveDocument(useEditorStore.getState()), OPTIONS, 0);
      useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: SOURCE + "\n% new refresh" });
      await vi.waitFor(() => expect(assets).toHaveBeenCalledTimes(3));
      await vi.waitFor(() => expect(service.getState().snapshot?.revision).toBe(2));
    } finally {
      blocked.resolve();
      await finished.promise;
    }
  });

  it("does not run an old session's queued paint against a restarted session", async () => {
    await service.start(getActiveDocument(useEditorStore.getState()), OPTIONS, 0);
    const paints: Array<() => void> = [];
    vi.spyOn(frameScheduling, "afterNextPaint").mockImplementation(callback => { paints.push(callback); return () => {}; });
    const assets = vi.spyOn(BeamerPresentationRenderer, "create");
    useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: SOURCE + "\n% before restart" });
    await service.stop();
    await service.start(getActiveDocument(useEditorStore.getState()), OPTIONS, 0);
    useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: SOURCE + "\n% after restart" });
    expect(paints).toHaveLength(2);
    paints[0]();
    await Promise.resolve(); await Promise.resolve();
    expect(assets).toHaveBeenCalledTimes(1);
    paints[1]();
    await vi.waitFor(() => expect(service.getState().snapshot?.revision).toBe(2));
    expect(assets).toHaveBeenCalledTimes(2);
  });

  it("keeps the original cleanup in the chain when an intermediate launch is stopped", async () => {
    const doc = getActiveDocument(useEditorStore.getState());
    await service.start(doc, OPTIONS, 0);
    slowClose = true;
    const stoppingFirst = service.stop();
    const startingSecond = service.start(doc, OPTIONS, 0);
    // The second launch has its windows, but is waiting for the first cleanup.
    await Promise.resolve(); await Promise.resolve();
    const stoppingSecond = service.stop();
    const startingThird = service.start(doc, OPTIONS, 0);
    try {
      await vi.waitFor(() => expect(closeWindows).toHaveBeenCalledTimes(2));
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(power).toEqual([true]);
    } finally {
      firstClose.resolve();
      await Promise.all([stoppingFirst, startingSecond, stoppingSecond, startingThird]);
    }
    expect(power).toEqual([true, false, true]);
  });

  it.each(["connect", "open"] as const)("recovers from a synchronous %s failure and permits another launch", async operation => {
    const api = getActiveEditorPlatform().presentation!;
    vi.spyOn(api, operation).mockImplementationOnce(() => { throw new Error("Platform setup failed"); });
    const doc = getActiveDocument(useEditorStore.getState());
    await expect(service.start(doc, OPTIONS, 0)).resolves.toBeUndefined();
    expect(service.getState().snapshot).toBeNull();
    expect(service.getState().error).toBe("Platform setup failed");
    await service.start(doc, OPTIONS, 0);
    expect(service.getState().snapshot?.current).not.toBeNull();
  });

  it("retires a failed launch without waiting for the other platform operation to finish", async () => {
    slowOpen = true;
    const api = getActiveEditorPlatform().presentation!;
    vi.spyOn(api, "connect").mockRejectedValueOnce(new Error("Connection failed"));
    const starting = service.start(getActiveDocument(useEditorStore.getState()), OPTIONS, 0);
    try {
      await vi.waitFor(() => expect(service.getState().snapshot).toBeNull());
      expect(service.getState().error).toBe("Connection failed");
    } finally {
      opening.resolve();
      await starting;
    }
    await vi.waitFor(() => expect(closeWindows).toHaveBeenCalledTimes(1));
  });

  it("closes adopted windows exactly once if initial asset loading fails", async () => {
    vi.spyOn(BeamerPresentationRenderer, "create").mockRejectedValueOnce(new Error("Assets failed"));
    await service.start(getActiveDocument(useEditorStore.getState()), OPTIONS, 0);
    expect(service.getState().snapshot).toBeNull();
    expect(service.getState().error).toBe("Assets failed");
    expect(closeWindows).toHaveBeenCalledTimes(1);
    expect(power).toEqual([true, false]);
  });

  it("releases power and permits a restart even if transport cleanup throws", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const api = getActiveEditorPlatform().presentation!;
    const connect = api.connect;
    vi.spyOn(api, "connect").mockImplementationOnce(async (...args) => ({
      ...await connect(...args), close() { throw new Error("Transport close failed"); }
    }));
    const doc = getActiveDocument(useEditorStore.getState());
    await service.start(doc, OPTIONS, 0);
    await expect(service.stop()).resolves.toBeUndefined();
    expect(power).toEqual([true, false]);
    await service.start(doc, OPTIONS, 0);
    expect(service.getState().snapshot?.current).not.toBeNull();
  });

  it.each(["throw", "reject"])("stops cleanly when transport publication fails by %s", async failure => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const api = getActiveEditorPlatform().presentation!;
    const connect = api.connect;
    vi.spyOn(api, "connect").mockImplementationOnce(async (...args) => ({
      ...await connect(...args), send() {
        if (failure === "throw") throw new Error("Transport disconnected");
        return Promise.reject(new Error("Transport disconnected"));
      }
    }));
    await service.start(getActiveDocument(useEditorStore.getState()), OPTIONS, 0);
    await expect(service.stop()).resolves.toBeUndefined();
    expect(service.getState().snapshot).toBeNull();
    expect(power).toEqual([true, false]);
  });

  it("waits for a pending power acquisition before releasing it", async () => {
    const api = getActiveEditorPlatform().presentation!;
    const acquiring = deferred();
    const keepAwake = api.keepAwake!;
    let first = true;
    api.keepAwake = active => {
      if (!first) return keepAwake(active);
      first = false; power.push(active); return acquiring.promise;
    };
    await service.start(getActiveDocument(useEditorStore.getState()), OPTIONS, 0);
    const stopping = service.stop();
    try {
      await Promise.resolve(); await Promise.resolve();
      expect(power).toEqual([true]);
    } finally {
      acquiring.resolve();
      await stopping;
    }
    expect(power).toEqual([true, false]);
  });

  it("reports a synchronously blocked popup without breaking command handling", async () => {
    const api = getActiveEditorPlatform().presentation!;
    const open = api.open;
    vi.spyOn(api, "open").mockImplementationOnce(async (...args) => ({
      ...await open(...args), showPresenter() { throw new Error("Popup blocked"); }
    }));
    await service.start(getActiveDocument(useEditorStore.getState()), OPTIONS, 0);
    expect(() => service.command({ type: "show-presenter" })).not.toThrow();
    await vi.waitFor(() => expect(service.getState().snapshot?.error).toBe("Popup blocked"));
  });

  it.each(["windows", "assets"])("retires a launch if its document closes while %s are loading", async stage => {
    slowOpen = stage === "windows";
    const create = BeamerPresentationRenderer.create;
    const assets = vi.spyOn(BeamerPresentationRenderer, "create").mockImplementationOnce(async (...args) => {
      if (stage === "assets") await opening.promise;
      return create(...args);
    });
    const doc = getActiveDocument(useEditorStore.getState());
    const starting = service.start(doc, OPTIONS, 0);
    if (stage === "assets") await vi.waitFor(() => expect(assets).toHaveBeenCalled());
    useEditorStore.getState().dispatch({ type: "CLOSE_DOCUMENT", documentId: doc.id });
    opening.resolve();
    await starting;
    expect(service.getState().snapshot).toBeNull();
    expect(closeWindows).toHaveBeenCalledTimes(1);
    if (stage === "windows") expect(power).not.toContain(true);
  });

  it("uses a Save As binding adopted during launch even when the source is unchanged", async () => {
    slowOpen = true;
    const create = vi.spyOn(BeamerPresentationRenderer, "create");
    const doc = getActiveDocument(useEditorStore.getState());
    const starting = service.start(doc, OPTIONS, 0);
    const fileRef: DocumentFileRef = { kind: "file", provider: "desktop-fs", path: "/new/deck.tex", name: "deck.tex" };
    useEditorStore.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", documentId: doc.id, fileRef });
    opening.resolve();
    await starting;
    await vi.waitFor(() => expect(create).toHaveBeenLastCalledWith(doc.source, fileRef));
    expect(service.getState().snapshot?.title).toBe("deck.tex");
  });

  it("adopts a binding and title changed while the initial assets are loading", async () => {
    const create = BeamerPresentationRenderer.create;
    const assets = vi.spyOn(BeamerPresentationRenderer, "create").mockImplementationOnce(async (...args) => {
      await opening.promise;
      return create(...args);
    });
    const doc = getActiveDocument(useEditorStore.getState());
    const starting = service.start(doc, OPTIONS, 0);
    await vi.waitFor(() => expect(assets).toHaveBeenCalled());
    const fileRef: DocumentFileRef = { kind: "file", provider: "desktop-fs", path: "/new/deck.tex", name: "deck.tex" };
    useEditorStore.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", documentId: doc.id, fileRef });
    opening.resolve();
    await starting;
    await vi.waitFor(() => {
      expect(assets).toHaveBeenLastCalledWith(doc.source, fileRef);
      expect(service.getState().snapshot?.title).toBe("deck.tex");
    });
  });

  it.each(["direct", "command"])("ignores an old session's %s output recovery after a restart", async kind => {
    const api = getActiveEditorPlatform().presentation!;
    const open = api.open;
    const recovery = deferred();
    api.open = async (...args) => ({ ...await open(...args), recoverOutput: () => recovery.promise });
    const doc = getActiveDocument(useEditorStore.getState());
    await service.start(doc, OPTIONS, 0);
    lost();
    const recovering = kind === "direct" ? service.recoverOutput(null) : service.command({ type: "recover-output" });
    await service.stop();
    await service.start(doc, OPTIONS, 0);
    lost();
    recovery.resolve();
    await recovering;
    await Promise.resolve();
    const snapshot = service.getState().snapshot!;
    receive({ type: "hello", sessionId: snapshot.sessionId, role: "audience", sequence: snapshot.sequence });
    expect(service.getState().snapshot?.outputAvailable).toBe(false);
  });

  it("keeps presentation attached to its original document when editor tabs change", async () => {
    const doc = getActiveDocument(useEditorStore.getState());
    await service.start(doc, OPTIONS, 0);
    const current = service.getState().snapshot!.current;
    useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT" });
    expect(service.getState().snapshot!.documentId).toBe(doc.id);
    expect(service.getState().snapshot!.current).toBe(current);
    service.command({ type: "next" });
    await vi.waitFor(() => expect(service.getState().snapshot!.current!.cursor.step).toBe(2));
  });

  it("keeps a lost-output notice until explicit recovery and uses a lightweight heartbeat for synchronized windows", async () => {
    const doc = getActiveDocument(useEditorStore.getState());
    await service.start(doc, OPTIONS, 0);
    lost();
    const snapshot = service.getState().snapshot!;
    receive({ type: "hello", sessionId: snapshot.sessionId, role: "audience", sequence: snapshot.sequence });
    expect(service.getState().snapshot!.outputAvailable).toBe(false);
    expect(messages.at(-1)?.type).toBe("alive");
    service.command({ type: "recover-output" });
    await vi.waitFor(() => expect(service.getState().snapshot!.outputAvailable).toBe(true));
  });

  it("takes the output back when the platform restores it, as when a display is plugged in again", async () => {
    const doc = getActiveDocument(useEditorStore.getState());
    await service.start(doc, OPTIONS, 0);
    lost();
    expect(service.getState().snapshot!.outputAvailable).toBe(false);
    restored?.();
    expect(service.getState().snapshot!.outputAvailable).toBe(true);
  });

  it("does not remember a one-off mode such as a rehearsal for the next presentation", async () => {
    const doc = getActiveDocument(useEditorStore.getState());
    await service.start(doc, { ...OPTIONS, mode: "rehearse" }, 0);
    expect(saved).not.toContain("tikz-editor:presentation-options");
  });

  it("waits for an older session to release its power assertion before acquiring the next one", async () => {
    const doc = getActiveDocument(useEditorStore.getState());
    await service.start(doc, OPTIONS, 0);
    slowClose = true;
    const stopping = service.stop();
    const starting = service.start(doc, OPTIONS, 0);
    await Promise.resolve();
    expect(power).toEqual([true]);
    firstClose.resolve();
    await Promise.all([stopping, starting]);
    expect(power).toEqual([true, false, true]);
  });
});
