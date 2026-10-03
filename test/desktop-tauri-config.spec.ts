import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TAURI_DIR = path.resolve(process.cwd(), "apps/desktop/src-tauri");

function readConfig(fileName: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(TAURI_DIR, fileName), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function firstWindow(config: Record<string, unknown>): Record<string, unknown> {
  const app = config.app as Record<string, unknown> | undefined;
  const windows = app?.windows as Array<Record<string, unknown>> | undefined;
  return windows?.[0] ?? {};
}

describe("desktop Tauri platform config split", () => {
  it("keeps shared config free of macOS-only titlebar settings", () => {
    const shared = readConfig("tauri.conf.json");
    const window = firstWindow(shared);
    expect(window.titleBarStyle).toBeUndefined();
    expect(window.hiddenTitle).toBeUndefined();
    expect(window.trafficLightPosition).toBeUndefined();
    expect(window.decorations).toBe(true);
  });

  it("defines macOS overlay titlebar in tauri.macos.conf.json", () => {
    const mac = readConfig("tauri.macos.conf.json");
    const window = firstWindow(mac);
    expect(window.titleBarStyle).toBe("Overlay");
    expect(window.hiddenTitle).toBe(true);
    expect(window.trafficLightPosition).toEqual({ x: 18, y: 21 });
  });

  it("defines Windows-native bundle options in tauri.windows.conf.json", () => {
    const windows = readConfig("tauri.windows.conf.json");
    const window = firstWindow(windows);
    expect(window.decorations).toBe(true);
    expect(window.titleBarStyle).toBeUndefined();
    expect(window.hiddenTitle).toBeUndefined();
    expect(window.windowClassname).toBe("TikZEditorMainWindow");

    const bundle = windows.bundle as Record<string, unknown> | undefined;
    const bundleWindows = bundle?.windows as Record<string, unknown> | undefined;
    expect(bundleWindows?.allowDowngrades).toBe(false);
    expect(bundleWindows?.webviewInstallMode).toEqual({
      type: "downloadBootstrapper",
      silent: true
    });
    expect(bundleWindows?.nsis).toEqual({
      installMode: "currentUser",
      template: "windows/installer.nsi",
      installerHooks: "windows/update-checks.nsh"
    });
  });
});
