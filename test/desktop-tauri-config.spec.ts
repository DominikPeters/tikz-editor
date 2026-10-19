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
    expect(window.backgroundThrottling).toBe("disabled");
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

  it("limits Windows default associations to TikZ while retaining shared TeX support", () => {
    const sharedBundle = readConfig("tauri.conf.json").bundle as Record<string, unknown>;
    const windowsBundle = readConfig("tauri.windows.conf.json").bundle as Record<string, unknown>;
    const associations = (bundle: Record<string, unknown>) =>
      bundle.fileAssociations as Array<{ ext: string[]; rank?: string }>;

    expect(associations(sharedBundle).flatMap(({ ext }) => ext)).toEqual(["tikz", "tex"]);
    expect(associations(sharedBundle).find(({ ext }) => ext.includes("tex"))?.rank).toBe("Alternate");
    // Tauri's platform merge replaces arrays; both Windows bundlers consume this list.
    expect(associations(windowsBundle).flatMap(({ ext }) => ext)).toEqual(["tikz"]);
  });

  it("registers TeX as Open with only in both Windows installers", () => {
    const windowsBundle = readConfig("tauri.windows.conf.json").bundle as Record<string, unknown>;
    const windows = windowsBundle.windows as {
      nsis: { template: string };
      wix: { fragmentPaths: string[]; componentRefs: string[] };
    };
    const nsis = fs.readFileSync(path.join(TAURI_DIR, windows.nsis.template), "utf8");
    const writes = nsis.split("\n").filter((line) => /WriteReg\w+.*\\\.tex(?:\\|")/.test(line));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('"Software\\Classes\\.tex\\OpenWithProgids" "TikZEditor.TeX" ""');
    const deletes = nsis.split("\n").filter((line) => /DeleteReg\w+.*\\\.tex(?:\\|")/.test(line));
    expect(deletes).toHaveLength(2);
    expect(deletes.every((line) => line.includes('"TikZEditor.TeX"') || line.includes("/ifempty"))).toBe(true);

    const fragment = windows.wix.fragmentPaths
      .map((file) => fs.readFileSync(path.join(TAURI_DIR, file), "utf8"))
      .find((xml) => xml.includes('Id="TeXOpenWith"'));
    expect(fragment).toBeDefined();
    expect(windows.wix.componentRefs).toContain("TeXOpenWith");
    const texValues = [...(fragment ?? "").matchAll(/<RegistryValue\b[^>]*Key="Software\\Classes\\\.tex(?:\\[^"]*)?"[^>]*\/>/g)];
    expect(texValues).toHaveLength(1);
    expect(texValues[0][0]).toContain('Key="Software\\Classes\\.tex\\OpenWithProgids"');
    expect(texValues[0][0]).toContain('Name="TikZEditor.TeX"');
    expect(nsis).not.toContain("UserChoice");
    expect(fragment).not.toContain("UserChoice");
  });
});
