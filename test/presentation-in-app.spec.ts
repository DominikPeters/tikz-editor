import { describe, expect, it } from "vitest";
import { createInAppPresentationApi, inAppPresentationView } from "../packages/app/src/presentation/in-app-platform.js";
import type { PresentationMessage, PresentationOptions } from "../packages/app/src/presentation/types.js";

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
