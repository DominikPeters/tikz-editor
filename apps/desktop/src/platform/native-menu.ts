import {
  APP_MENU_COMMAND_IDS,
  type AnyMenuCommandId,
  type AppMenuDefinition,
  type AppMenuItem
} from "@tikz-editor/app/app-menu";
import type { DesktopContextMenuItem } from "@tikz-editor/app/platform/types";
import type { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import type { DesktopBridge } from "./bridge";

export type NativeCommandState = {
  enabled: boolean;
  checked?: boolean;
};

export type NativeCommandStates = Partial<Record<AnyMenuCommandId, NativeCommandState>>;

export type NativeMenuSyncPayload = {
  definition: AppMenuDefinition;
  commandStates: NativeCommandStates;
  workspaceSignature?: string;
};

type NativeCommandRef = {
  kind: "command" | "check";
  item: {
    setEnabled: (enabled: boolean) => Promise<void>;
    setChecked?: (checked: boolean) => Promise<void>;
  };
};

type NativeMenuNode = CheckMenuItem | MenuItem | PredefinedMenuItem | Submenu;

function shouldHideDisabledContextMenuCommand(commandId: AnyMenuCommandId, state: NativeCommandState): boolean {
  return commandId === APP_MENU_COMMAND_IDS.FLATTEN_FOREACH && !state.enabled;
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /(mac|iphone|ipad)/i.test(navigator.platform);
}

function hasModifierAccelerator(accelerator: string | undefined): accelerator is string {
  return Boolean(accelerator && /cmd|ctrl|alt|shift|meta|option|super/i.test(accelerator));
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/g);
  const last = segments[segments.length - 1];
  return last.trim() ? last : path;
}

export function serializeDesktopContextMenuItems(
  items: readonly AppMenuItem[],
  commandStates: NativeCommandStates
): DesktopContextMenuItem[] {
  const serialized: DesktopContextMenuItem[] = [];

  for (const item of items) {
    if (item.kind === "separator") {
      serialized.push({ kind: "separator" });
      continue;
    }
    if (item.kind === "recent-files" || item.kind === "workspace-list") {
      continue;
    }
    if (item.kind === "submenu") {
      const children = serializeDesktopContextMenuItems(item.items, commandStates);
      if (children.length > 0) {
        serialized.push({ kind: "submenu", label: item.label, items: children });
      }
      continue;
    }

    const state = commandStates[item.commandId] ?? { enabled: false };
    if (shouldHideDisabledContextMenuCommand(item.commandId, state)) {
      continue;
    }
    serialized.push({
      kind: "command",
      commandId: item.commandId,
      label: item.label,
      enabled: state.enabled,
      checked: state.checked,
      accelerator: hasModifierAccelerator(item.accelerator) ? item.accelerator : undefined
    });
  }

  return serialized;
}

export function createNativeDesktopMenuManager(options: {
  getBridge: () => DesktopBridge;
  dispatchCommand: (commandId: AnyMenuCommandId, origin: "platform" | "context-menu") => void;
  dispatchOpenRecent: (path: string) => void;
  reportError: (message: string, error?: unknown) => void;
}) {
  const APP_DISPLAY_NAME = "TikZ Editor";
  const { getBridge, dispatchCommand, dispatchOpenRecent, reportError } = options;
  const commandRefs = new Map<AnyMenuCommandId, NativeCommandRef[]>();
  let currentMenu: Menu | null = null;
  let latestPayload: NativeMenuSyncPayload | null = null;
  let definitionKey: string | null = null;
  let workspaceKey: string | null = null;
  let recentsDirty = true;
  let syncQueue = Promise.resolve();

  function addCommandRef(commandId: AnyMenuCommandId, ref: NativeCommandRef): void {
    const known = commandRefs.get(commandId) ?? [];
    known.push(ref);
    commandRefs.set(commandId, known);
  }

  function nativeClipboardPredefinedItemFor(commandId: AnyMenuCommandId): "Cut" | "Copy" | "Paste" | null {
    if (commandId === APP_MENU_COMMAND_IDS.CUT) return "Cut";
    if (commandId === APP_MENU_COMMAND_IDS.COPY) return "Copy";
    if (commandId === APP_MENU_COMMAND_IDS.PASTE) return "Paste";
    return null;
  }

  async function applyCommandStates(commandStates: NativeCommandStates): Promise<void> {
    for (const [commandId, refs] of commandRefs.entries()) {
      const state = commandStates[commandId] ?? { enabled: false };
      for (const ref of refs) {
        await ref.item.setEnabled(state.enabled);
        if (ref.kind === "check") {
          await ref.item.setChecked?.(Boolean(state.checked));
        }
      }
    }
  }

  async function buildMenuItems(
    items: readonly AppMenuItem[],
    commandStates: NativeCommandStates,
    recentFiles: readonly string[],
    origin: "platform" | "context-menu"
  ): Promise<NativeMenuNode[]> {
    const built: NativeMenuNode[] = [];
    for (const item of items) {
      if (item.kind === "workspace-list") {
        built.push(...await buildWorkspaceMenuItems());
        continue;
      }
      const node = await buildMenuItem(item, commandStates, recentFiles, origin);
      if (node != null) built.push(node);
    }
    return built;
  }

  async function buildWorkspaceMenuItems(): Promise<NativeMenuNode[]> {
    const menuApi = await import("@tauri-apps/api/menu");
    const { applyWorkspace, findActiveWorkspaceId, listAllWorkspaces } = await import("@tikz-editor/app/workspace");
    const entries = listAllWorkspaces();
    const activeId = findActiveWorkspaceId();
    const items: NativeMenuNode[] = [];
    const workspaceMenuItems: Array<{
      id: string;
      item: { setChecked?: (checked: boolean) => Promise<void> };
    }> = [];

    async function syncWorkspaceChecks(checkedId: string | null): Promise<void> {
      for (const ref of workspaceMenuItems) {
        await ref.item.setChecked?.(ref.id === checkedId);
      }
    }

    let sawBuiltIn = false;
    let separatorInserted = false;
    for (const entry of entries) {
      if (entry.kind === "user" && sawBuiltIn && !separatorInserted) {
        items.push(await menuApi.PredefinedMenuItem.new({ item: "Separator" }));
        separatorInserted = true;
      }
      if (entry.kind === "built-in") sawBuiltIn = true;

      const item = await menuApi.CheckMenuItem.new({
        id: `view.workspace.apply.${entry.id}`,
        text: entry.name,
        checked: entry.id === activeId,
        enabled: true,
        action: () => {
          applyWorkspace(entry.id);
          void syncWorkspaceChecks(entry.id);
        }
      });
      workspaceMenuItems.push({ id: entry.id, item });
      items.push(item);
    }
    return items;
  }

  async function buildMenuItem(
    item: AppMenuItem,
    commandStates: NativeCommandStates,
    recentFiles: readonly string[],
    origin: "platform" | "context-menu"
  ): Promise<NativeMenuNode | null> {
    const menuApi = await import("@tauri-apps/api/menu");

    if (item.kind === "separator") {
      return await menuApi.PredefinedMenuItem.new({ item: "Separator" });
    }

    if (item.kind === "recent-files") {
      const recentItems: NativeMenuNode[] = [];
      if (recentFiles.length > 0) {
        for (let i = 0; i < recentFiles.length; i += 1) {
          const path = recentFiles[i];
          recentItems.push(await menuApi.MenuItem.new({
            id: `file.open-recent.${i}`,
            text: basename(path),
            action: () => {
              dispatchOpenRecent(path);
            }
          }));
        }
        recentItems.push(await menuApi.PredefinedMenuItem.new({ item: "Separator" }));
        recentItems.push(await menuApi.MenuItem.new({
          id: APP_MENU_COMMAND_IDS.CLEAR_RECENT_FILES,
          text: "Clear Open Recent",
          action: () => {
            void getBridge().clearRecentFiles().then(refreshRecents);
          }
        }));
      } else {
        recentItems.push(await menuApi.MenuItem.new({
          id: "file.open-recent.empty",
          text: "No Recent Files",
          enabled: false
        }));
      }

      return await menuApi.Submenu.new({
        id: "file.open-recent",
        text: item.label,
        items: recentItems
      });
    }

    if (item.kind === "submenu") {
      const builtItems = await buildMenuItems(item.items, commandStates, recentFiles, origin);
      return builtItems.length > 0 ? await menuApi.Submenu.new({ text: item.label, items: builtItems }) : null;
    }

    if (item.kind === "workspace-list") {
      return null;
    }

    const state = commandStates[item.commandId] ?? { enabled: false };
    if (origin === "context-menu" && shouldHideDisabledContextMenuCommand(item.commandId, state)) {
      return null;
    }
    const accelerator = hasModifierAccelerator(item.accelerator) ? item.accelerator : undefined;
    const predefinedClipboardItem = nativeClipboardPredefinedItemFor(item.commandId);
    if (predefinedClipboardItem) {
      return await menuApi.PredefinedMenuItem.new({ item: predefinedClipboardItem });
    }

    if (state.checked != null) {
      const checkItem = await menuApi.CheckMenuItem.new({
        id: item.commandId,
        text: item.label,
        checked: state.checked,
        enabled: state.enabled,
        accelerator,
        action: (id) => {
          dispatchCommand(id as AnyMenuCommandId, origin);
        }
      });
      addCommandRef(item.commandId, { kind: "check", item: checkItem });
      return checkItem;
    }

    const commandItem = await menuApi.MenuItem.new({
      id: item.commandId,
      text: item.label,
      enabled: state.enabled,
      accelerator,
      action: (id) => {
        dispatchCommand(id as AnyMenuCommandId, origin);
      }
    });
    addCommandRef(item.commandId, { kind: "command", item: commandItem });
    return commandItem;
  }

  async function buildMacApplicationSubmenu(
    commandStates: NativeCommandStates
  ): Promise<Submenu> {
    const menuApi = await import("@tauri-apps/api/menu");
    const aboutItem = await menuApi.MenuItem.new({
      id: "app.about",
      text: `About ${APP_DISPLAY_NAME}`,
      action: () => {
        void getBridge().showAboutPanel().catch((error: unknown) => {
          reportError("Failed to show native About dialog.", error);
        });
      }
    });
    const separator1 = await menuApi.PredefinedMenuItem.new({ item: "Separator" });
    const separator2 = await menuApi.PredefinedMenuItem.new({ item: "Separator" });
    const quitItem = await menuApi.PredefinedMenuItem.new({
      text: `Quit ${APP_DISPLAY_NAME}`,
      item: "Quit"
    });

    const settingsState = commandStates[APP_MENU_COMMAND_IDS.OPEN_SETTINGS] ?? { enabled: false };
    const settingsItem = await menuApi.MenuItem.new({
      id: "app.open-settings",
      text: "Settings...",
      enabled: settingsState.enabled,
      accelerator: "CmdOrCtrl+,",
      action: () => {
        dispatchCommand(APP_MENU_COMMAND_IDS.OPEN_SETTINGS, "platform");
      }
    });
    addCommandRef(APP_MENU_COMMAND_IDS.OPEN_SETTINGS, { kind: "command", item: settingsItem });

    const updateState = commandStates[APP_MENU_COMMAND_IDS.CHECK_FOR_UPDATES] ?? { enabled: false };
    const updateItem = await menuApi.MenuItem.new({
      id: "app.check-for-updates",
      text: "Check for Updates...",
      enabled: updateState.enabled,
      action: () => {
        dispatchCommand(APP_MENU_COMMAND_IDS.CHECK_FOR_UPDATES, "platform");
      }
    });
    addCommandRef(APP_MENU_COMMAND_IDS.CHECK_FOR_UPDATES, { kind: "command", item: updateItem });

    return await menuApi.Submenu.new({
      id: "app",
      text: APP_DISPLAY_NAME,
      items: [aboutItem, separator1, updateItem, settingsItem, separator2, quitItem]
    });
  }

  async function buildMacWindowSubmenu(): Promise<Submenu> {
    const menuApi = await import("@tauri-apps/api/menu");
    const minimizeItem = await menuApi.PredefinedMenuItem.new({ item: "Minimize" });
    const zoomItem = await menuApi.PredefinedMenuItem.new({ item: "Maximize", text: "Zoom" });
    const separator = await menuApi.PredefinedMenuItem.new({ item: "Separator" });
    const bringAllToFrontItem = await menuApi.PredefinedMenuItem.new({ item: "BringAllToFront" });
    return await menuApi.Submenu.new({
      id: "window",
      text: "Window",
      items: [minimizeItem, zoomItem, separator, bringAllToFrontItem]
    });
  }

  async function rebuildMenu(payload: NativeMenuSyncPayload): Promise<void> {
    const menuApi = await import("@tauri-apps/api/menu");
    const recentFiles = await getBridge().listRecentFiles().catch((error: unknown) => {
      reportError("Failed to read recent files for native menu rebuild.", error);
      return [] as string[];
    });

    commandRefs.clear();
    const topLevelItems: Submenu[] = [];
    let windowSubmenu: Submenu | null = null;
    let nativeWindowSubmenu: Submenu | null = null;
    let helpSubmenu: Submenu | null = null;

    if (isMacPlatform()) {
      topLevelItems.push(await buildMacApplicationSubmenu(payload.commandStates));
      windowSubmenu = await buildMacWindowSubmenu();
      nativeWindowSubmenu = windowSubmenu;
    }

    for (const section of payload.definition) {
      if (isMacPlatform() && section.id === "help" && windowSubmenu) {
        topLevelItems.push(windowSubmenu);
        windowSubmenu = null;
      }

      const sectionItems = await buildMenuItems(section.items, payload.commandStates, recentFiles, "platform");
      if (sectionItems.length === 0) continue;

      const submenu = await menuApi.Submenu.new({
        id: `section.${section.id}`,
        text: section.label,
        items: sectionItems
      });
      if (isMacPlatform() && section.id === "help") {
        helpSubmenu = submenu;
      }
      topLevelItems.push(submenu);
    }
    if (windowSubmenu) topLevelItems.push(windowSubmenu);

    const menu = await menuApi.Menu.new({ items: topLevelItems });
    await menu.setAsAppMenu();
    await nativeWindowSubmenu?.setAsWindowsMenuForNSApp();
    await helpSubmenu?.setAsHelpMenuForNSApp();
    currentMenu = menu;
    await applyCommandStates(payload.commandStates);
  }

  async function performSync(): Promise<void> {
    if (!latestPayload) return;
    const nextDefinitionKey = JSON.stringify(latestPayload.definition);
    const nextWorkspaceKey = latestPayload.workspaceSignature ?? "";
    if (!currentMenu || recentsDirty || definitionKey !== nextDefinitionKey || workspaceKey !== nextWorkspaceKey) {
      await rebuildMenu(latestPayload);
      definitionKey = nextDefinitionKey;
      workspaceKey = nextWorkspaceKey;
      recentsDirty = false;
      return;
    }
    await applyCommandStates(latestPayload.commandStates);
  }

  function enqueueSync(): void {
    syncQueue = syncQueue.then(performSync).catch((error: unknown) => {
      reportError("Native menu sync failed.", error);
    });
  }

  function refreshRecents(): void {
    recentsDirty = true;
    if (latestPayload) enqueueSync();
  }

  return {
    sync(payload: NativeMenuSyncPayload): Promise<void> {
      latestPayload = payload;
      enqueueSync();
      return syncQueue;
    },
    refreshRecents
  };
}
