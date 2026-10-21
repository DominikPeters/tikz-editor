import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  displays: [
    { name: "Laptop", size: { width: 2560, height: 1600 }, position: { x: 0, y: 0 }, scaleFactor: 2 },
    { name: "Projector", size: { width: 1920, height: 1080 }, position: { x: 2560, y: 0 }, scaleFactor: 1 },
  ],
  windows: new Map<string, { position: { x: number; y: number } | null; simple: boolean; destroyed: boolean }>(),
  listeners: new Map<string, (event?: unknown) => void>(),
  focus: vi.fn(), invoke: vi.fn(), emit: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: () => Promise.resolve(native.displays), primaryMonitor: () => Promise.resolve(native.displays[0]), getCurrentWindow: () => ({ label: "main", setFocus: native.focus }) }));
vi.mock("@tauri-apps/api/dpi", () => ({ PhysicalPosition: class { constructor(public x: number, public y: number) {} }, PhysicalSize: class { constructor(public width: number, public height: number) {} } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emit: native.emit, listen: (event: string, callback: () => void) => { native.listeners.set(event, callback); return Promise.resolve(() => { native.listeners.delete(event); }); } }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow: class {
  position: { x: number; y: number } | null = null; simple = false; destroyed = false;
  constructor(readonly label: string) { native.windows.set(label, this); }
  once(event: string, callback: () => void) { if (event === "tauri://created") queueMicrotask(callback); return Promise.resolve(() => {}); }
  setSimpleFullscreen(value: boolean) { this.simple = value; return Promise.resolve(); }
  setPosition(value: { x: number; y: number }) { this.position = value; return Promise.resolve(); }
  setSize() { return Promise.resolve(); }
  show() { return Promise.resolve(); }
  setFocus() { return Promise.resolve(); }
  destroy() { this.destroyed = true; return Promise.resolve(); }
} }));
import { createDesktopPresentationApi } from "../apps/desktop/src/platform/presentation.js";

describe("desktop presentation displays", () => {
  beforeEach(() => {
    native.windows.clear(); native.listeners.clear(); native.invoke.mockResolvedValue(undefined); native.emit.mockResolvedValue(undefined);
    native.displays = [
      { name: "Laptop", size: { width: 2560, height: 1600 }, position: { x: 0, y: 0 }, scaleFactor: 2 },
      { name: "Projector", size: { width: 1920, height: 1080 }, position: { x: 2560, y: 0 }, scaleFactor: 1 },
    ];
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    vi.stubGlobal("window", { location: { href: "http://localhost:1420/" }, setInterval, clearInterval });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
  it("places output on the projector, uses simple fullscreen, and recovers without moving fullscreen onto the laptop", async () => {
    const api = createDesktopPresentationApi(), lost = vi.fn();
    const displays = await api.displays();
    const session = await api.open("test", { mode: "display", showPresenter: true, audienceDisplay: displays[1].id, presenterDisplay: displays[0].id, countdownMinutes: null }, lost);
    const audience = native.windows.get("presentation-audience-test")!, presenter = native.windows.get("presentation-presenter-test")!;
    expect(audience.simple).toBe(true);
    expect(audience.position!.x).toBeGreaterThan(2560);
    expect(presenter.position!.x).toBeLessThan(2560);
    native.displays = native.displays.slice(0, 1);
    native.listeners.get("presentation-displays-changed")!();
    await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce());
    expect(audience.simple).toBe(false);
    expect(audience.position!.x).toBeLessThan(2560);
    await session.recoverOutput(displays[0].id);
    expect(audience.simple).toBe(true);
    await session.close();
    expect(audience.destroyed && presenter.destroyed).toBe(true);
    expect(native.listeners.size).toBe(0);
  });
  it("keeps display identity across resolution and scale changes, and swaps roles", async () => {
    const api = createDesktopPresentationApi(), lost = vi.fn();
    const displays = await api.displays();
    const session = await api.open("resize", { mode: "display", showPresenter: true, audienceDisplay: displays[1].id, presenterDisplay: displays[0].id, countdownMinutes: null }, lost);
    native.displays[1].size.width = 3840; native.displays[1].scaleFactor = 2;
    expect((await api.displays())[1].id).toBe(displays[1].id);
    native.listeners.get("presentation-displays-changed")!();
    await vi.waitFor(() => expect(native.windows.get("presentation-audience-resize")!.position!.x).toBeGreaterThan(3000));
    expect(lost).not.toHaveBeenCalled();
    expect(await session.swapDisplays()).toEqual({ audienceDisplay: displays[0].id, presenterDisplay: displays[1].id });
    await session.close();
  });
  it("derives the menu context from native focused-window events and ignores another session", async () => {
    const api = createDesktopPresentationApi(), receive = vi.fn();
    const channel = await api.connect("focus", receive);
    native.listeners.get("presentation-focused-window")!({ payload: "presentation-presenter-focus" });
    expect(receive).toHaveBeenLastCalledWith({ type: "focus", sessionId: "focus", role: "presenter" });
    native.listeners.get("presentation-focused-window")!({ payload: "main" });
    expect(receive).toHaveBeenLastCalledWith({ type: "focus", sessionId: "focus", role: "editor" });
    const count = receive.mock.calls.length;
    native.listeners.get("presentation-focused-window")!({ payload: "presentation-audience-old-session" });
    expect(receive).toHaveBeenCalledTimes(count);
    channel.close();
    expect(native.listeners.size).toBe(0);
  });
});
