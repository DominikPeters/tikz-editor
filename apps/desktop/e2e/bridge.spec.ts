import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultBridge } from "../src/platform/bridge";
import { createNativeDesktopMenuManager } from "../src/platform/native-menu";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  menuItemNew: vi.fn(),
  setTheme: vi.fn(),
  updaterCheck: vi.fn(),
  downloadAndInstall: vi.fn()
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.updaterCheck }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTheme: mocks.setTheme
  })
}));

vi.mock("@tauri-apps/api/menu", () => ({
  CheckMenuItem: { new: vi.fn() },
  MenuItem: { new: mocks.menuItemNew },
  PredefinedMenuItem: {
    new: (options: unknown) => Promise.resolve({ options })
  },
  Submenu: {
    new: (options: unknown) => Promise.resolve({
      options,
      setAsHelpMenuForNSApp: () => Promise.resolve(),
      setAsWindowsMenuForNSApp: () => Promise.resolve()
    })
  },
  Menu: {
    new: (options: unknown) => Promise.resolve({
      options,
      setAsAppMenu: () => Promise.resolve()
    })
  }
}));

describe("default desktop bridge", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.menuItemNew.mockReset();
    mocks.menuItemNew.mockImplementation((options: unknown) => Promise.resolve({
      options,
      setEnabled: () => Promise.resolve()
    }));
    mocks.setTheme.mockReset();
    mocks.updaterCheck.mockReset();
    mocks.downloadAndInstall.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("owns About, theme, and LaTeX native operations", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "desktop_check_latex_available") {
        return { available: true, details: "latex + dvisvgm" };
      }
      if (command === "desktop_compile_tikz") {
        return "<svg />";
      }
      if (command === "desktop_read_last_compile_log") {
        return "compile log";
      }
      return undefined;
    });
    const bridge = createDefaultBridge();

    await bridge.showAboutPanel();
    await bridge.setTheme("dark");
    await expect(bridge.checkLatexAvailable()).resolves.toEqual({
      available: true,
      details: "latex + dvisvgm"
    });
    await expect(bridge.compileTikz("\\documentclass{standalone}")).resolves.toBe("<svg />");
    await expect(bridge.readLastCompileLog()).resolves.toBe("compile log");

    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    expect(mocks.invoke.mock.calls).toEqual([
      ["desktop_show_about_panel", undefined],
      ["desktop_check_latex_available", undefined],
      ["desktop_compile_tikz", { latexDocument: "\\documentclass{standalone}", sourceDirectory: null }],
      ["desktop_read_last_compile_log", undefined]
    ]);
  });

  it("offers portable ZIP updates and refuses installer-based updates", async () => {
    mocks.invoke.mockResolvedValue(true);
    mocks.updaterCheck.mockResolvedValue({
      version: "0.7.0", currentVersion: "0.6.0", downloadAndInstall: mocks.downloadAndInstall
    });
    const bridge = createDefaultBridge();
    await expect(bridge.checkForUpdate?.()).resolves.toEqual({
      version: "0.7.0", currentVersion: "0.6.0",
      downloadUrl: "https://github.com/DominikPeters/tikz-editor/releases/download/app-v0.7.0/TikZ.Editor_0.7.0_x64-portable.zip"
    });
    await expect(bridge.installUpdate?.(() => {})).rejects.toThrow("Portable updates must be downloaded");
    expect(mocks.downloadAndInstall).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("desktop_is_portable", undefined);
  });

  it("keeps installer updates for the installed edition", async () => {
    mocks.invoke.mockResolvedValue(false);
    mocks.updaterCheck.mockResolvedValue({
      version: "0.7.0", currentVersion: "0.6.0", downloadAndInstall: mocks.downloadAndInstall
    });
    const bridge = createDefaultBridge();
    await expect(bridge.checkForUpdate?.()).resolves.toEqual({ version: "0.7.0", currentVersion: "0.6.0" });
    await bridge.installUpdate?.(() => {});
    expect(mocks.downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("routes the macOS About menu action through the injected bridge", async () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    const showAboutPanel = vi.fn(() => Promise.resolve());
    const bridge = {
      ...createDefaultBridge(),
      listRecentFiles: () => Promise.resolve([]),
      showAboutPanel
    };
    const manager = createNativeDesktopMenuManager({
      getBridge: () => bridge,
      dispatchCommand: () => undefined,
      dispatchOpenRecent: () => undefined,
      reportError: () => undefined
    });

    await manager.sync({
      definition: [],
      commandStates: {}
    });
    const aboutOptions = mocks.menuItemNew.mock.calls
      .map(([options]) => options as { id?: string; action?: () => void })
      .find((options) => options.id === "app.about");
    expect(aboutOptions?.action).toBeTypeOf("function");
    aboutOptions?.action?.();
    await vi.waitFor(() => {
      expect(showAboutPanel).toHaveBeenCalledOnce();
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
