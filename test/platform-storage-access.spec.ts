import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserPlatformAdapter } from "../apps/web/src/platform/browser-platform";
import { createDesktopPlatformAdapter } from "../apps/desktop/src/platform/adapter";
import type { DesktopBridge } from "../apps/desktop/src/platform/bridge";

const desktopBridge = {
  onWindowCloseRequest: async () => () => {},
  onContextMenuCommand: async () => () => {},
  onPendingOpenRequestsChanged: async () => () => {},
  takePendingOpenRequests: async () => [],
  takePendingOpenFailures: async () => []
} as unknown as DesktopBridge;
const createDesktop = (env: NonNullable<Parameters<typeof createDesktopPlatformAdapter>[0]> = {}) =>
  createDesktopPlatformAdapter({ ...env, bridge: desktopBridge });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

for (const [name, create] of [["browser", createBrowserPlatformAdapter], ["desktop", createDesktop]] as const) {
  describe(`${name} storage initialization`, () => {
    it("starts with isolated session memory when localStorage is missing", () => {
      vi.stubGlobal("localStorage", undefined);
      const platform = create();
      expect(platform.persistence.load("key")).toBeNull();
      platform.persistence.save("key", "session value");
      expect(platform.persistence.load("key")).toBe("session value");
      expect(create().persistence.load("key")).toBeNull();
    });

    it("starts with session memory when the localStorage getter throws", () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
      Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new DOMException("Storage denied", "SecurityError"); } });
      try {
        const platform = create();
        platform.persistence.save("key", "session value");
        expect(platform.persistence.load("key")).toBe("session value");
      } finally {
        if (original) Object.defineProperty(globalThis, "localStorage", original);
        else Reflect.deleteProperty(globalThis, "localStorage");
      }
    });

    it("uses provided storage without accessing the denied global getter", () => {
      const values = new Map<string, string>();
      const storage = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
      const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
      const get = vi.fn(() => { throw new DOMException("Storage denied", "SecurityError"); });
      Object.defineProperty(globalThis, "localStorage", { configurable: true, get });
      try {
        const platform = create({ storage });
        platform.persistence.save("key", "persistent value");
        expect(platform.persistence.load("key")).toBe("persistent value");
        expect(storage.setItem).toHaveBeenCalledWith("key", "persistent value");
        expect(get).not.toHaveBeenCalled();
      } finally {
        if (original) Object.defineProperty(globalThis, "localStorage", original);
        else Reflect.deleteProperty(globalThis, "localStorage");
      }
    });

    it("uses working global storage directly", () => {
      const values = new Map<string, string>();
      vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
      create().persistence.save("key", "persistent value");
      expect(create().persistence.load("key")).toBe("persistent value");
      expect(values.get("key")).toBe("persistent value");
    });

    it("preserves method failure reporting for provided storage", () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const denied = new DOMException("No quota", "QuotaExceededError");
      const platform = create({ storage: { getItem() { throw denied; }, setItem() { throw denied; } } });
      expect(() => platform.persistence.save("key", "value")).toThrow(denied);
      expect(() => platform.persistence.load("key")).toThrow(denied);
    });
  });
}
