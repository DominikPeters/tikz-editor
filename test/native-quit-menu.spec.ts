/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_MENU_COMMAND_IDS, APP_MENU_DEFINITION, filterAppMenuDefinitionForTarget } from "../packages/app/src/app-menu/index.js";
import type { DesktopBridge } from "../apps/desktop/src/platform/bridge.js";
import { createNativeDesktopMenuManager } from "../apps/desktop/src/platform/native-menu.js";

const capture = vi.hoisted(() => ({ predefined: [] as Array<Record<string, unknown>>, commands: [] as Array<Record<string, unknown>>, enabled: [] as Array<[unknown, boolean]> }));
vi.mock("@tikz-editor/app/workspace", () => ({ listAllWorkspaces: () => [], findActiveWorkspaceId: () => null, applyWorkspace: () => {} }));
vi.mock("@tauri-apps/api/menu", () => {
  const instance = (id?: unknown) => ({ setEnabled: async (enabled: boolean) => { capture.enabled.push([id, enabled]); }, setChecked: async () => {},
    setAsAppMenu: async () => {}, setAsWindowsMenuForNSApp: async () => {}, setAsHelpMenuForNSApp: async () => {} });
  return { Menu: { new: async () => instance() }, Submenu: { new: async () => instance() },
    MenuItem: { new: async (params: Record<string, unknown>) => { capture.commands.push(params); return instance(params.id); } },
    CheckMenuItem: { new: async (params: Record<string, unknown>) => { capture.commands.push(params); return instance(params.id); } },
    PredefinedMenuItem: { new: async (params: Record<string, unknown>) => { capture.predefined.push(params); return instance(); } } };
});
afterEach(() => { capture.predefined.length = capture.commands.length = capture.enabled.length = 0; vi.unstubAllGlobals(); });

describe("guarded native Quit", () => {
  it.each(["MacIntel", "Win32", "Linux x86_64"])("dispatches one guarded Quit on %s with its accelerator", async platform => {
    vi.stubGlobal("navigator", { platform, userAgent: navigator.userAgent });
    const dispatch = vi.fn();
    const manager = createNativeDesktopMenuManager({ getBridge: () => ({ listRecentFiles: async () => [] }) as unknown as DesktopBridge,
      dispatchCommand: dispatch, dispatchOpenRecent: () => {}, reportError: (_message, error) => { throw error; } });
    const target = platform === "MacIntel" ? "desktop-macos" : platform === "Win32" ? "desktop-windows" : "desktop-linux";
    const definition = filterAppMenuDefinitionForTarget(APP_MENU_DEFINITION, target);
    const commandStates = { [APP_MENU_COMMAND_IDS.QUIT_APP]: { enabled: true } } as never;
    await manager.sync({ definition, commandStates });
    expect(capture.predefined.filter(item => item.item === "Quit")).toEqual([]);
    const quits = capture.commands.filter(item => item.id === APP_MENU_COMMAND_IDS.QUIT_APP);
    expect(quits).toHaveLength(1);
    expect(quits[0]).toMatchObject({ enabled: true, accelerator: "CmdOrCtrl+Q" });
    (quits[0].action as (id: string) => void)(APP_MENU_COMMAND_IDS.QUIT_APP);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(APP_MENU_COMMAND_IDS.QUIT_APP, "platform");
    await manager.sync({ definition, commandStates: { [APP_MENU_COMMAND_IDS.QUIT_APP]: { enabled: false } } as never });
    expect(capture.enabled.filter(([id]) => id === APP_MENU_COMMAND_IDS.QUIT_APP).at(-1)).toEqual([APP_MENU_COMMAND_IDS.QUIT_APP, false]);
  });
});
