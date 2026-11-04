import { describe, expect, it } from "vitest";
import { createInAppPresentationApi, inAppPresentationView, type InAppExternalDisplay } from "../packages/app/src/presentation/in-app-platform.js";
import type { PresentationMessage, PresentationOptions, PresentationSnapshot } from "../packages/app/src/presentation/types.js";

const OPTIONS: PresentationOptions = { mode: "display", audienceDisplay: null, presenterDisplay: null, showPresenter: null, countdownMinutes: null };
const flush = () => new Promise<void>(resolve => { queueMicrotask(resolve); });

describe("in-app presentation platform", () => {
  it("delivers each message to the other members only, after the send", async () => {
    const api = createInAppPresentationApi();
    const service: PresentationMessage[] = [], view: PresentationMessage[] = [], other: PresentationMessage[] = [];
    const serviceSide = await api.connect("s", message => { service.push(message); });
    const viewSide = await api.connect("s", message => { view.push(message); });
    await api.connect("other", message => { other.push(message); });
    const hello: PresentationMessage = { type: "hello", sessionId: "s", role: "audience" };
    void viewSide.send(hello);
    expect(service).toEqual([]);
    await flush();
    expect(service).toEqual([hello]);
    expect(view).toEqual([]);
    expect(other).toEqual([]);
    viewSide.close();
    void serviceSide.send({ type: "alive", sessionId: "s", sequence: 1 });
    await flush();
    expect(view).toEqual([]);
  });

  it("shows the slides, switches to the presenter view and back, and closes", async () => {
    const api = createInAppPresentationApi();
    let lost = 0;
    const windows = await api.open("s", OPTIONS, () => { lost++; });
    expect(inAppPresentationView.get()).toEqual({ sessionId: "s", role: "audience" });
    await windows.showPresenter();
    expect(inAppPresentationView.get()).toEqual({ sessionId: "s", role: "presenter" });
    expect(lost).toBe(1);
    await windows.recoverOutput(null);
    expect(inAppPresentationView.get()).toEqual({ sessionId: "s", role: "audience" });
    await windows.close();
    expect(inAppPresentationView.get()).toBeNull();
  });

  it("rehearses in the presenter view without reporting the slides lost", async () => {
    const api = createInAppPresentationApi();
    let lost = 0;
    const windows = await api.open("r", { ...OPTIONS, mode: "rehearse" }, () => { lost++; });
    expect(inAppPresentationView.get()).toEqual({ sessionId: "r", role: "presenter" });
    await windows.showPresenter();
    expect(lost).toBe(0);
    await windows.close();
  });

  it("keeps the display awake while anyone asks", async () => {
    const calls: boolean[] = [];
    const api = createInAppPresentationApi({ keepAwake: active => { calls.push(active); return Promise.resolve(); } });
    await api.keepAwake?.(true);
    await api.keepAwake?.(true);
    await api.keepAwake?.(false);
    expect(calls).toEqual([true]);
    await api.keepAwake?.(false);
    await api.keepAwake?.(false);
    expect(calls).toEqual([true, false]);
  });
});

function fakeDisplay(initiallyConnected: boolean) {
  let connected = initiallyConnected;
  const listeners = new Set<(connected: boolean) => void>();
  const shown: (string | null)[] = [];
  let hidden = 0;
  const display: InAppExternalDisplay = {
    connected: () => connected,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    show(src) { shown.push(src); return Promise.resolve(); },
    hide() { hidden++; return Promise.resolve(); },
  };
  return {
    display, shown, hidden: () => hidden,
    set(next: boolean) { connected = next; for (const listener of listeners) listener(next); },
  };
}

function snapshot(sessionId: string, svg: string, blank: PresentationSnapshot["blank"] = "none"): PresentationSnapshot {
  return { sessionId, documentId: "d", title: "t", revision: 1, sequence: 1, ended: false, frames: [],
    current: { cursor: { frame: 0, step: 1, continuation: 1 }, svg, notesSvg: null }, next: null, thumbnails: {}, blank,
    timer: { elapsedMs: 0, runningSince: null, started: false, budgetMs: null }, outputAvailable: true, presenterVisible: false, error: null };
}

describe("in-app presentation with an external display", () => {
  it("puts the slides on the display and the presenter view on the screen", async () => {
    const fake = fakeDisplay(true);
    const api = createInAppPresentationApi({ externalDisplay: fake.display });
    const heard: PresentationMessage[] = [];
    const service = await api.connect("x", message => { heard.push(message); });
    const windows = await api.open("x", OPTIONS, () => {});
    expect(inAppPresentationView.get()).toEqual({ sessionId: "x", role: "presenter" });
    await flush();
    expect(heard).toContainEqual({ type: "hello", sessionId: "x", role: "audience" });
    void service.send({ type: "snapshot", sessionId: "x", snapshot: snapshot("x", "<svg/>") });
    void service.send({ type: "snapshot", sessionId: "x", snapshot: snapshot("x", "<svg/>") });
    void service.send({ type: "snapshot", sessionId: "x", snapshot: snapshot("x", "<svg/>", "black") });
    await flush();
    expect(fake.shown).toEqual([`data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg/>")}`, null]);
    await windows.close();
    expect(fake.hidden()).toBe(1);
    expect(inAppPresentationView.get()).toBeNull();
  });

  it("follows the display being unplugged and plugged in during the talk", async () => {
    const fake = fakeDisplay(false);
    const api = createInAppPresentationApi({ externalDisplay: fake.display });
    let lost = 0, restored = 0;
    const windows = await api.open("y", OPTIONS, () => { lost++; }, () => { restored++; });
    expect(inAppPresentationView.get()?.role).toBe("audience");
    fake.set(true);
    expect(inAppPresentationView.get()?.role).toBe("presenter");
    fake.set(false);
    expect(lost).toBe(1);
    expect(fake.hidden()).toBe(1);
    expect(inAppPresentationView.get()?.role).toBe("presenter");
    fake.set(true);
    expect(restored).toBe(2);
    fake.set(false);
    await windows.recoverOutput(null);
    expect(inAppPresentationView.get()?.role).toBe("audience");
    await windows.close();
  });

  it("keeps a rehearsal off the display", async () => {
    const fake = fakeDisplay(true);
    const api = createInAppPresentationApi({ externalDisplay: fake.display });
    const windows = await api.open("z", { ...OPTIONS, mode: "rehearse" }, () => {});
    await flush();
    expect(fake.shown).toEqual([]);
    await windows.close();
    expect(fake.hidden()).toBe(0);
  });
});
