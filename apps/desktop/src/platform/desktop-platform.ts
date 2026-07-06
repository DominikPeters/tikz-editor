import { APP_MENU_COMMAND_IDS, type AppMenuCommandId, type AppMenuDefinition, type AppMenuItem } from "@tikz-editor/app/app-menu";
import type { LinkedTextReadResult, LinkedTextWriteResult } from "@tikz-editor/app/linked-file-sync";
import type {
  AssistantAccountSnapshot,
  DesktopContextMenuItem,
  DesktopContextMenuPayload,
  AssistantDynamicToolResult,
  AssistantEvent,
  AssistantModelOption,
  AssistantThreadState,
  AssistantThreadSummary,
  ArxivSourcePayload,
  EditorPlatform,
  UpdateInfo,
  UpdateInstallProgress,
  MenuCommandHandler
} from "@tikz-editor/app/platform/types";
import type { DocumentFileRef, FileRevision } from "@tikz-editor/app/store/types";
import type { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import type { Update } from "@tauri-apps/plugin-updater";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

type DesktopOpenTextResult = {
  source: string;
  path: string;
  name: string;
};

type DesktopOpenBinaryResult = {
  bytesBase64: string;
  path: string;
  name: string;
};

type DesktopOpenTextFailureResult = {
  path: string;
  message: string;
};

type DesktopSaveTextResult = {
  ok: boolean;
  path: string | null;
  name: string | null;
};

type DesktopLinkedFileRef = {
  kind: "file";
  name: string;
  path: string;
  provider: "desktop-fs";
};

type DesktopLinkedTextReadResult =
  | { status: "ok"; source: string; revision: FileRevision; fileRef: DesktopLinkedFileRef }
  | { status: "missing" }
  | { status: "failed"; reason?: string };

type DesktopLinkedTextWriteResult =
  | { status: "saved"; revision: FileRevision; fileRef: DesktopLinkedFileRef }
  | { status: "changed-on-disk"; source: string; revision: FileRevision; fileRef: DesktopLinkedFileRef }
  | { status: "missing" }
  | { status: "failed"; reason?: string };

type DesktopBridge = {
  openText: (path?: string | null, options?: { addToRecent?: boolean }) => Promise<DesktopOpenTextResult | null>;
  openBinary?: (path?: string | null, options?: { addToRecent?: boolean }) => Promise<DesktopOpenBinaryResult | null>;
  fetchArxivSource?: (idOrUrl: string) => Promise<ArxivSourcePayload>;
  saveText: (params: {
    text: string;
    suggestedName?: string;
    path?: string | null;
    forceSaveAs: boolean;
  }) => Promise<DesktopSaveTextResult>;
  readLinkedText?: (path: string) => Promise<DesktopLinkedTextReadResult>;
  writeLinkedText?: (params: {
    path: string;
    text: string;
    expectedRevision?: FileRevision | null;
  }) => Promise<DesktopLinkedTextWriteResult>;
  syncLinkedFileWatches?: (paths: string[]) => Promise<void>;
  onLinkedFileChanged?: (handler: (payload: { path: string }) => void) => Promise<() => void>;
  exportFile: (params: {
    fileName: string;
    mimeType: string;
    bytesBase64: string;
  }) => Promise<boolean>;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  readCustomClipboardText: (
    formats: readonly string[]
  ) => Promise<{ format: string; text: string } | null>;
  readCustomClipboardBytes: (
    formats: readonly string[]
  ) => Promise<{ format: string; bytesBase64: string } | null>;
  writeClipboardBundle: (payload: {
    plainText: string;
    tikzJson?: string | null;
    svgText?: string | null;
    pngBase64?: string | null;
  }) => Promise<void>;
  setWindowTitle: (title: string) => Promise<void>;
  closeWindow: () => Promise<void>;
  confirmUnsavedChanges: (message: string) => Promise<"save" | "discard" | "cancel">;
  showMessage?: (options: { title: string; message: string; kind?: "info" | "warning" | "error" }) => Promise<void>;
  openExternalUrl: (url: string) => Promise<boolean>;
  performSnapHaptic?: () => Promise<void>;
  prefersNonBlinkingTextInsertionIndicator?: () => Promise<boolean>;
  bindPrefersNonBlinkingTextInsertionIndicatorChange?: (
    handler: (prefersNonBlinkingTextInsertionIndicator: boolean) => void
  ) => Promise<() => void>;
  listRecentFiles: () => Promise<string[]>;
  clearRecentFiles: () => Promise<void>;
  takePendingOpenRequests: () => Promise<DesktopOpenTextResult[]>;
  takePendingOpenFailures: () => Promise<DesktopOpenTextFailureResult[]>;
  onPendingOpenRequestsChanged: (handler: () => void) => Promise<() => void>;
  onWindowCloseRequest: (handler: () => void) => Promise<() => void>;
  showContextMenu: (payload: DesktopContextMenuPayload) => Promise<void>;
  onContextMenuCommand: (handler: (payload: { requestId: string; commandId: AppMenuCommandId }) => void) => Promise<() => void>;
  checkCodexStatus?: () => Promise<{ installed: boolean; has_npm: boolean; has_brew: boolean; has_wsl: boolean }>;
  installCodex?: (method: "npm" | "brew" | "wsl") => Promise<string>;
  checkForUpdate?: () => Promise<UpdateInfo | null>;
  installUpdate?: (onProgress: (progress: UpdateInstallProgress) => void) => Promise<void>;
  relaunch?: () => Promise<void>;
  assistantEnsureDocumentThread?: (params: {
    documentId: string;
    source: string;
    threadId?: string | null;
    workspacePath?: string | null;
    figurePath?: string | null;
    previewPath?: string | null;
  }) => Promise<AssistantThreadSummary>;
  assistantStartTurn?: (params: {
    documentId: string;
    prompt: string;
    source: string;
    pngBase64?: string | null;
    pastedImages?: Array<{ base64: string; mimeType: string; fileName: string }>;
    threadId?: string | null;
    workspacePath?: string | null;
    figurePath?: string | null;
    previewPath?: string | null;
    model?: string | null;
    figureContext?: string | null;
    diagnosticsText?: string | null;
  }) => Promise<{ turnId: string | null }>;
  assistantSteerTurn?: (params: {
    documentId: string;
    prompt: string;
    pastedImages?: Array<{ base64: string; mimeType: string; fileName: string }>;
  }) => Promise<{ turnId: string | null }>;
  assistantInterruptTurn?: (params: { documentId: string }) => Promise<void>;
  assistantSyncSource?: (params: { documentId: string; source: string }) => Promise<void>;
  assistantRespondToApproval?: (params: {
    documentId: string;
    requestId: string;
    decision: "accept" | "acceptForSession" | "decline" | "cancel";
  }) => Promise<void>;
  assistantRespondToDynamicToolCall?: (params: {
    documentId: string;
    requestId: string;
    result: AssistantDynamicToolResult;
  }) => Promise<void>;
  assistantLoadThreadState?: (params: { documentId: string }) => Promise<AssistantThreadState | null>;
  assistantWarmUp?: () => Promise<void>;
  assistantListModels?: () => Promise<AssistantModelOption[]>;
  assistantReadAccountSnapshot?: () => Promise<AssistantAccountSnapshot | null>;
  assistantReadAccount?: () => Promise<unknown>;
  assistantReadRateLimits?: () => Promise<unknown>;
  assistantLoginStart?: (params: { loginType: string; apiKey?: string }) => Promise<unknown>;
  assistantLoginCancel?: (params: { loginId: string }) => Promise<void>;
  assistantLogout?: () => Promise<void>;
  onAssistantEvent?: (handler: (event: AssistantEvent) => void) => Promise<() => void>;
};

export type DesktopPlatformEnvironment = {
  storage?: StorageLike;
  bridge?: DesktopBridge;
};

type BrowserLikeGlobal = typeof globalThis & {
  __TIKZ_EDITOR_DESKTOP_PLATFORM_ENV__?: DesktopPlatformEnvironment;
  __TIKZ_EDITOR_DESKTOP_TEST_API__?: {
    setBridgeOverride: (bridge: DesktopBridge | null) => void;
    dispatchCommand: (commandId: AppMenuCommandId) => boolean;
    triggerOpenRequest: (opened: { source: string; path: string; name: string }) => void;
    triggerWindowCloseRequest: () => void;
  };
};

type NativeCommandState = {
  enabled: boolean;
  checked?: boolean;
};

type NativeMenuSyncPayload = {
  definition: AppMenuDefinition;
  commandStates: Record<AppMenuCommandId, NativeCommandState>;
  workspaceSignature?: string;
};

type NativeCommandRef = {
  kind: "command" | "check";
  item: {
    setEnabled: (enabled: boolean) => Promise<void>;
    setChecked?: (checked: boolean) => Promise<void>;
  };
};

function shouldHideDisabledContextMenuCommand(commandId: AppMenuCommandId, state: NativeCommandState): boolean {
  return commandId === APP_MENU_COMMAND_IDS.FLATTEN_FOREACH && !state.enabled;
}

type NativeMenuNode = CheckMenuItem | MenuItem | PredefinedMenuItem | Submenu;

function readInjectedTestEnvironment(): DesktopPlatformEnvironment {
  return ((globalThis as BrowserLikeGlobal).__TIKZ_EDITOR_DESKTOP_PLATFORM_ENV__) ?? {};
}

function logDesktopPlatformDebug(message: string, error?: unknown): void {
  if (typeof console === "undefined" || typeof console.info !== "function") {
    return;
  }
  if (error != null) {
    console.info(`[tikz-editor] ${message}`, error);
    return;
  }
  console.info(`[tikz-editor] ${message}`);
}

function resolveStorage(env: DesktopPlatformEnvironment): StorageLike {
  if (env.storage) {
    return env.storage;
  }
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    }
  };
}

function toDesktopFileRef(path: string, name: string): DocumentFileRef {
  return {
    kind: "file",
    name,
    path,
    provider: "desktop-fs"
  };
}

function base64FromBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function bytesFromBase64(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /(mac|iphone|ipad)/i.test(navigator.platform);
}

function hasModifierAccelerator(accelerator: string | undefined): accelerator is string {
  if (!accelerator) {
    return false;
  }
  return /cmd|ctrl|alt|shift|meta|option|super/i.test(accelerator);
}

const DESKTOP_OPEN_REQUESTS_CHANGED_EVENT = "desktop-open-requests-changed";

function basename(path: string): string {
  const segments = path.split(/[\\/]/g);
  const last = segments[segments.length - 1];
  return last.trim() ? last : path;
}

function serializeDesktopContextMenuItems(
  items: readonly AppMenuItem[],
  commandStates: Record<AppMenuCommandId, NativeCommandState>
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
      if (children.length === 0) {
        continue;
      }
      serialized.push({
        kind: "submenu",
        label: item.label,
        items: children
      });
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

function createNativeDesktopMenuManager(options: {
  getBridge: () => DesktopBridge;
  dispatchCommand: (commandId: AppMenuCommandId, origin: "platform" | "context-menu") => void;
  dispatchOpenRecent: (path: string) => void;
}) {
  const APP_DISPLAY_NAME = "TikZ Editor";
  const { getBridge, dispatchCommand, dispatchOpenRecent } = options;
  const commandRefs = new Map<AppMenuCommandId, NativeCommandRef[]>();
  let currentMenu: Menu | null = null;
  let latestPayload: NativeMenuSyncPayload | null = null;
  let definitionKey: string | null = null;
  let workspaceKey: string | null = null;
  let recentsDirty = true;
  let syncQueue = Promise.resolve();

  function addCommandRef(commandId: AppMenuCommandId, ref: NativeCommandRef): void {
    const known = commandRefs.get(commandId) ?? [];
    known.push(ref);
    commandRefs.set(commandId, known);
  }

  function nativeClipboardPredefinedItemFor(commandId: AppMenuCommandId): "Cut" | "Copy" | "Paste" | null {
    if (commandId === APP_MENU_COMMAND_IDS.CUT) {
      return "Cut";
    }
    if (commandId === APP_MENU_COMMAND_IDS.COPY) {
      return "Copy";
    }
    if (commandId === APP_MENU_COMMAND_IDS.PASTE) {
      return "Paste";
    }
    return null;
  }

  async function applyCommandStates(commandStates: Record<AppMenuCommandId, NativeCommandState>): Promise<void> {
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
    commandStates: Record<AppMenuCommandId, NativeCommandState>,
    recentFiles: readonly string[],
    origin: "platform" | "context-menu"
  ): Promise<NativeMenuNode[]> {
    const built: NativeMenuNode[] = [];
    for (const item of items) {
      if (item.kind === "workspace-list") {
        const expanded = await buildWorkspaceMenuItems();
        built.push(...expanded);
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

    // Built-ins come first; user workspaces follow after a separator.
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
    commandStates: Record<AppMenuCommandId, NativeCommandState>,
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
          recentItems.push(
            await menuApi.MenuItem.new({
              id: `file.open-recent.${i}`,
              text: basename(path),
              action: () => {
                dispatchOpenRecent(path);
              }
            })
          );
        }
        recentItems.push(await menuApi.PredefinedMenuItem.new({ item: "Separator" }));
        recentItems.push(
          await menuApi.MenuItem.new({
            id: APP_MENU_COMMAND_IDS.CLEAR_RECENT_FILES,
            text: "Clear Open Recent",
            action: () => {
              void getBridge()
                .clearRecentFiles()
                .then(() => {
                  refreshRecents();
                });
            }
          })
        );
      } else {
        recentItems.push(
          await menuApi.MenuItem.new({
            id: "file.open-recent.empty",
            text: "No Recent Files",
            enabled: false
          })
        );
      }

      return await menuApi.Submenu.new({
        id: "file.open-recent",
        text: item.label,
        items: recentItems
      });
    }

    if (item.kind === "submenu") {
      const builtItems = await buildMenuItems(item.items, commandStates, recentFiles, origin);

      if (builtItems.length === 0) {
        return null;
      }

      return await menuApi.Submenu.new({
        text: item.label,
        items: builtItems
      });
    }

    if (item.kind === "workspace-list") {
      // Expansion is handled inline by the caller via expandWorkspaceList.
      // If we reach here, return null so it's filtered out.
      return null;
    }

    const state = commandStates[item.commandId] ?? { enabled: false };
    if (origin === "context-menu" && shouldHideDisabledContextMenuCommand(item.commandId, state)) {
      return null;
    }
    const accelerator = hasModifierAccelerator(item.accelerator) ? item.accelerator : undefined;
    const predefinedClipboardItem = nativeClipboardPredefinedItemFor(item.commandId);

    // Use native clipboard menu roles so Tauri/WebView performs standard copy/cut/paste
    // for focused text controls and emits DOM clipboard events for the focused canvas.
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
          dispatchCommand(id as AppMenuCommandId, origin);
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
        dispatchCommand(id as AppMenuCommandId, origin);
      }
    });
    addCommandRef(item.commandId, { kind: "command", item: commandItem });
    return commandItem;
  }

  async function buildMacApplicationSubmenu(
    commandStates: Record<AppMenuCommandId, NativeCommandState>
  ): Promise<Submenu> {
    const menuApi = await import("@tauri-apps/api/menu");
    const aboutItem = await menuApi.MenuItem.new({
      id: "app.about",
      text: `About ${APP_DISPLAY_NAME}`,
      action: () => {
        void import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("desktop_show_about_panel"))
          .catch((error: unknown) => {
            logDesktopPlatformDebug("Failed to show native About dialog.", error);
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
      logDesktopPlatformDebug("Failed to read recent files for native menu rebuild.", error);
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

      if (sectionItems.length === 0) {
        continue;
      }

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
    if (windowSubmenu) {
      topLevelItems.push(windowSubmenu);
    }

    const menu = await menuApi.Menu.new({ items: topLevelItems });
    await menu.setAsAppMenu();
    await nativeWindowSubmenu?.setAsWindowsMenuForNSApp();
    await helpSubmenu?.setAsHelpMenuForNSApp();
    currentMenu = menu;
    await applyCommandStates(payload.commandStates);
  }

  async function performSync(): Promise<void> {
    if (!latestPayload) {
      return;
    }
    const nextDefinitionKey = JSON.stringify(latestPayload.definition);
    const nextWorkspaceKey = latestPayload.workspaceSignature ?? "";
    if (
      !currentMenu ||
      recentsDirty ||
      definitionKey !== nextDefinitionKey ||
      workspaceKey !== nextWorkspaceKey
    ) {
      await rebuildMenu(latestPayload);
      definitionKey = nextDefinitionKey;
      workspaceKey = nextWorkspaceKey;
      recentsDirty = false;
      return;
    }

    await applyCommandStates(latestPayload.commandStates);
  }

  function enqueueSync(): void {
    syncQueue = syncQueue.then(async () => {
      await performSync();
    }).catch((error: unknown) => {
      logDesktopPlatformDebug("Native menu sync failed.", error);
    });
  }

  function refreshRecents(): void {
    recentsDirty = true;
    if (!latestPayload) {
      return;
    }
    enqueueSync();
  }

  return {
    sync(payload: NativeMenuSyncPayload): Promise<void> {
      latestPayload = payload;
      enqueueSync();
      return syncQueue;
    },
    refreshRecents(): void {
      refreshRecents();
    }
  };
}

function createDefaultBridge(): DesktopBridge {
  let pendingUpdate: Update | null = null;

  return {
    openText: async (path, options) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DesktopOpenTextResult | null>("desktop_open_text", {
        path,
        addToRecent: options?.addToRecent
      });
    },
    openBinary: async (path, options) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DesktopOpenBinaryResult | null>("desktop_open_binary", {
        path,
        addToRecent: options?.addToRecent
      });
    },
    fetchArxivSource: async (idOrUrl) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<ArxivSourcePayload>("desktop_fetch_arxiv_source", { idOrUrl });
    },
    saveText: async ({ text, suggestedName, path, forceSaveAs }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DesktopSaveTextResult>("desktop_save_text", {
        text,
        suggestedName,
        path,
        forceSaveAs
      });
    },
    readLinkedText: async (path) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DesktopLinkedTextReadResult>("desktop_read_linked_text", { path });
    },
    writeLinkedText: async ({ path, text, expectedRevision }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DesktopLinkedTextWriteResult>("desktop_write_linked_text", {
        path,
        text,
        expectedRevision: expectedRevision ?? null
      });
    },
    syncLinkedFileWatches: async (paths) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_sync_linked_file_watches", { paths });
    },
    onLinkedFileChanged: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<{ path: string }>("desktop-linked-file-changed", (event) => {
        handler(event.payload);
      });
    },
    exportFile: async ({ fileName, mimeType, bytesBase64 }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("desktop_export_file", { fileName, mimeType, bytesBase64 });
    },
    readClipboard: async () => {
      const { readText } = await import("tauri-plugin-clipboard-x-api");
      return await readText();
    },
    writeClipboard: async (text) => {
      const { writeText } = await import("tauri-plugin-clipboard-x-api");
      await writeText(text);
    },
    readCustomClipboardText: async (formats) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<{ format: string; text: string } | null>("desktop_read_custom_clipboard_text", {
        formats
      });
    },
    readCustomClipboardBytes: async (formats) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<{ format: string; bytesBase64: string } | null>("desktop_read_custom_clipboard_bytes", {
        formats
      });
    },
    writeClipboardBundle: async (payload) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_write_clipboard_bundle", {
        payload
      });
    },
    setWindowTitle: async (title) => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setTitle(title);
    },
    closeWindow: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_confirm_window_close");
    },
    confirmUnsavedChanges: async (message) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<"save" | "discard" | "cancel">("desktop_confirm_unsaved_changes", { message });
    },
    showMessage: async ({ title, message, kind }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_show_message_dialog", { title, message, kind: kind ?? "info" });
    },
    openExternalUrl: async (url) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("desktop_open_external", { url });
    },
    performSnapHaptic: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_perform_snap_haptic");
    },
    prefersNonBlinkingTextInsertionIndicator: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("desktop_prefers_non_blinking_text_insertion_indicator");
    },
    bindPrefersNonBlinkingTextInsertionIndicatorChange: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<boolean>(
        "desktop-prefers-non-blinking-text-insertion-indicator-changed",
        (event) => {
          handler(event.payload);
        }
      );
    },
    listRecentFiles: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string[]>("desktop_list_recent_files");
    },
    clearRecentFiles: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_clear_recent_files");
    },
    takePendingOpenRequests: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DesktopOpenTextResult[]>("desktop_take_pending_open_requests");
    },
    takePendingOpenFailures: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<DesktopOpenTextFailureResult[]>("desktop_take_pending_open_failures");
    },
    onPendingOpenRequestsChanged: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen(DESKTOP_OPEN_REQUESTS_CHANGED_EVENT, () => {
        handler();
      });
    },
    onWindowCloseRequest: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen("desktop-window-close-request", () => {
        handler();
      });
    },
    showContextMenu: async (payload) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_show_context_menu", { payload });
    },
    onContextMenuCommand: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<{ requestId: string; commandId: AppMenuCommandId }>("desktop-context-menu-command", (event) => {
        handler(event.payload);
      });
    },
    checkCodexStatus: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<{ installed: boolean; has_npm: boolean; has_brew: boolean; has_wsl: boolean }>("desktop_check_codex_status");
    },
    installCodex: async (method: "npm" | "brew" | "wsl") => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string>("desktop_install_codex", { method });
    },
    checkForUpdate: async () => {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      pendingUpdate = update;
      if (!update) {
        return null;
      }
      return {
        version: update.version,
        currentVersion: update.currentVersion,
        date: update.date,
        body: update.body
      };
    },
    installUpdate: async (onProgress) => {
      if (!pendingUpdate) {
        throw new Error("No pending update is available.");
      }
      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            onProgress({ type: "started", contentLength: event.data.contentLength });
            break;
          case "Progress":
            onProgress({ type: "progress", chunkLength: event.data.chunkLength });
            break;
          case "Finished":
            onProgress({ type: "finished" });
            break;
        }
      });
      pendingUpdate = null;
    },
    relaunch: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await invoke("desktop_prepare_update_relaunch");
      await relaunch();
    },
    assistantEnsureDocumentThread: async ({ documentId, source, threadId, workspacePath, figurePath, previewPath }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AssistantThreadSummary>("desktop_assistant_ensure_document_thread", {
        documentId,
        source,
        threadId,
        workspacePath,
        figurePath,
        previewPath
      });
    },
    assistantStartTurn: async ({ documentId, prompt, source, pngBase64, pastedImages, threadId, workspacePath, figurePath, previewPath, model, figureContext, diagnosticsText }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<{ turnId: string | null }>("desktop_assistant_start_turn", {
        documentId,
        prompt,
        source,
        pngBase64,
        pastedImages,
        threadId,
        workspacePath,
        figurePath,
        previewPath,
        model,
        figureContext,
        diagnosticsText
      });
    },
    assistantInterruptTurn: async ({ documentId }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_assistant_interrupt_turn", { documentId });
    },
    assistantSteerTurn: async ({ documentId, prompt, pastedImages }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<{ turnId: string | null }>("desktop_assistant_steer_turn", {
        documentId,
        prompt,
        pastedImages
      });
    },
    assistantSyncSource: async ({ documentId, source }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_assistant_sync_source", { documentId, source });
    },
    assistantRespondToApproval: async ({ documentId, requestId, decision }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_assistant_respond_to_approval", { documentId, requestId, decision });
    },
    assistantRespondToDynamicToolCall: async ({ documentId, requestId, result }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_assistant_respond_to_dynamic_tool_call", { documentId, requestId, result });
    },
    assistantLoadThreadState: async ({ documentId }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AssistantThreadState | null>("desktop_assistant_load_thread_state", { documentId });
    },
    assistantWarmUp: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_assistant_warm_up");
    },
    assistantListModels: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AssistantModelOption[]>("desktop_assistant_list_models");
    },
    assistantReadAccountSnapshot: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<AssistantAccountSnapshot | null>("desktop_assistant_read_account_snapshot");
    },
    assistantReadAccount: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<unknown>("desktop_assistant_read_account");
    },
    assistantReadRateLimits: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<unknown>("desktop_assistant_read_rate_limits");
    },
    assistantLoginStart: async ({ loginType, apiKey }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<unknown>("desktop_assistant_login_start", { loginType, apiKey });
    },
    assistantLoginCancel: async ({ loginId }) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_assistant_login_cancel", { loginId });
    },
    assistantLogout: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("desktop_assistant_logout");
    },
    onAssistantEvent: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<AssistantEvent>("desktop-assistant-event", (event) => {
        handler(event.payload);
      });
    }
  };
}

export function createDesktopPlatformAdapter(env: DesktopPlatformEnvironment = {}): EditorPlatform {
  const mergedEnv = { ...readInjectedTestEnvironment(), ...env };
  const storage = resolveStorage(mergedEnv);
  const defaultBridge = mergedEnv.bridge ?? createDefaultBridge();
  let bridgeOverride: DesktopBridge | null = null;
  const getBridge = () => bridgeOverride ?? readInjectedTestEnvironment().bridge ?? mergedEnv.bridge ?? defaultBridge;
  let menuHandler: MenuCommandHandler | null = null;
  const contextMenuHandlersByRequestId = new Map<string, MenuCommandHandler>();
  let openRequestHandler: ((opened: { source: string; fileRef: DocumentFileRef | null }) => void) | null = null;
  let closeRequestHandler: (() => void) | null = null;
  const pendingOpenedBuffer: Array<{ source: string; fileRef: DocumentFileRef | null }> = [];
  const pendingOpenFailureBuffer: DesktopOpenTextFailureResult[] = [];
  let windowCloseUnlistenPromise: Promise<(() => void) | null> | null = null;
  let contextMenuCommandUnlistenPromise: Promise<(() => void) | null> | null = null;
  let openRequestsChangedUnlistenPromise: Promise<(() => void) | null> | null = null;
  let pendingOpenSyncQueue = Promise.resolve();
  let nextContextMenuRequestId = 0;

  const nativeMenuManager = createNativeDesktopMenuManager({
    getBridge,
    dispatchCommand: (commandId, origin) => {
      menuHandler?.(commandId, origin);
    },
    dispatchOpenRecent: (path) => {
      if (!openRequestHandler) {
        return;
      }
      void getBridge().openText(path).then((opened) => {
        if (!opened) {
          return;
        }
        openRequestHandler?.({
          source: opened.source,
          fileRef: toDesktopFileRef(opened.path, opened.name)
        });
        nativeMenuManager.refreshRecents();
      });
    }
  });

  function showPendingOpenFailuresAlert(failures: readonly DesktopOpenTextFailureResult[]): void {
    if (failures.length === 0) {
      return;
    }
    const alertFn = (globalThis as { alert?: (message?: string) => void }).alert;
    if (typeof alertFn !== "function") {
      return;
    }
    const detailLines = failures.map((failure) => {
      const pathLabel = failure.path?.trim() ? failure.path : "(unknown path)";
      const message = failure.message?.trim() ? failure.message : "unknown error";
      return `• ${pathLabel}: ${message}`;
    });
    const summary = failures.length === 1
      ? "Could not open file:"
      : "Some files could not be opened:";
    alertFn(`${summary}\n${detailLines.join("\n")}`);
  }

  function flushPendingOpenBuffers(): void {
    if (!openRequestHandler) {
      return;
    }
    while (pendingOpenedBuffer.length > 0) {
      const opened = pendingOpenedBuffer.shift()!;
      openRequestHandler(opened);
    }
    if (pendingOpenFailureBuffer.length > 0) {
      const failures = pendingOpenFailureBuffer.splice(0, pendingOpenFailureBuffer.length);
      showPendingOpenFailuresAlert(failures);
    }
  }

  function syncPendingOpenQueues(): void {
    pendingOpenSyncQueue = pendingOpenSyncQueue.then(async () => {
      const [pendingOpens, pendingFailures] = await Promise.all([
        getBridge().takePendingOpenRequests().catch((error: unknown) => {
          logDesktopPlatformDebug("Failed to read pending desktop open requests.", error);
          return [] as DesktopOpenTextResult[];
        }),
        getBridge().takePendingOpenFailures().catch((error: unknown) => {
          logDesktopPlatformDebug("Failed to read pending desktop open failures.", error);
          return [] as DesktopOpenTextFailureResult[];
        })
      ]);

      if (pendingOpens.length === 0 && pendingFailures.length === 0) {
        return;
      }

      for (const opened of pendingOpens) {
        pendingOpenedBuffer.push({
          source: opened.source,
          fileRef: toDesktopFileRef(opened.path, opened.name)
        });
      }
      if (pendingFailures.length > 0) {
        pendingOpenFailureBuffer.push(...pendingFailures);
      }
      flushPendingOpenBuffers();
    }).catch((error: unknown) => {
      logDesktopPlatformDebug("Pending desktop open queue sync failed.", error);
    });
  }

  function ensureNativeEventHooks(): void {
    windowCloseUnlistenPromise ??= getBridge().onWindowCloseRequest(() => {
        closeRequestHandler?.();
      }).catch((error: unknown) => {
        logDesktopPlatformDebug("Failed to register native window close hook.", error);
        return null;
      });
    contextMenuCommandUnlistenPromise ??= getBridge().onContextMenuCommand((payload) => {
        const contextMenuHandler = contextMenuHandlersByRequestId.get(payload.requestId);
        if (contextMenuHandler) {
          contextMenuHandlersByRequestId.delete(payload.requestId);
          contextMenuHandler(payload.commandId, "context-menu");
          return;
        }
        menuHandler?.(payload.commandId, "context-menu");
      }).catch((error: unknown) => {
        logDesktopPlatformDebug("Failed to register native context menu hook.", error);
        return null;
      });
    if (!openRequestsChangedUnlistenPromise) {
      openRequestsChangedUnlistenPromise = getBridge().onPendingOpenRequestsChanged(() => {
        syncPendingOpenQueues();
      }).catch((error: unknown) => {
        logDesktopPlatformDebug("Failed to register native pending-open hook.", error);
        return null;
      });
      syncPendingOpenQueues();
    }
  }

  ensureNativeEventHooks();

  (globalThis as BrowserLikeGlobal).__TIKZ_EDITOR_DESKTOP_TEST_API__ = {
    setBridgeOverride: (bridge) => {
      bridgeOverride = bridge;
    },
    dispatchCommand: (commandId) => {
      if (!menuHandler) {
        return false;
      }
      menuHandler(commandId, "platform");
      return true;
    },
    triggerOpenRequest: (opened) => {
      openRequestHandler?.({
        source: opened.source,
        fileRef: toDesktopFileRef(opened.path, opened.name)
      });
    },
    triggerWindowCloseRequest: () => {
      closeRequestHandler?.();
    }
  };

  return {
    id: "desktop-tauri",
    persistence: {
      load: (key) => storage.getItem(key),
      save: (key, value) => {
        storage.setItem(key, value);
      }
    },
    clipboard: {
      readText: async () => await getBridge().readClipboard(),
      writeText: async (text) => {
        await getBridge().writeClipboard(text);
      },
      readCustomText: async (formats) => {
        return await getBridge().readCustomClipboardText(formats);
      },
      readCustomBytes: async (formats) => {
        return await getBridge().readCustomClipboardBytes(formats);
      },
      writeBundle: async (payload) => {
        await getBridge().writeClipboardBundle(payload);
      }
    },
    menu: {
      usesNativeMenuBar: true,
      usesNativeContextMenus: true,
      bindCommandHandler: (handler) => {
        menuHandler = handler;
        return () => {
          if (menuHandler === handler) {
            menuHandler = null;
          }
        };
      },
      dispatchCommand: (commandId, origin = "platform") => {
        menuHandler?.(commandId, origin);
      },
      syncNativeMenu: async (payload) => {
        await nativeMenuManager.sync(payload);
      },
      showNativeContextMenu: async (payload) => {
        nextContextMenuRequestId += 1;
        const requestId = `ctx-${Date.now()}-${nextContextMenuRequestId}`;
        let cleanupTimeout: ReturnType<typeof setTimeout> | null = null;
        if (payload.onCommandRun) {
          contextMenuHandlersByRequestId.set(requestId, payload.onCommandRun);
          cleanupTimeout = setTimeout(() => {
            contextMenuHandlersByRequestId.delete(requestId);
          }, 30_000);
        }
        try {
          await getBridge().showContextMenu({
            requestId,
            items: serializeDesktopContextMenuItems(payload.items, payload.commandStates)
          });
        } catch (error) {
          contextMenuHandlersByRequestId.delete(requestId);
          if (cleanupTimeout != null) {
            clearTimeout(cleanupTimeout);
          }
          throw error;
        }
      }
    },
    window: {
      setDocumentState: ({ title, dirty }) => {
        const baseTitle = title ?? "TikZ Editor";
        const fullTitle = dirty ? `• ${baseTitle}` : baseTitle;
        void getBridge().setWindowTitle(fullTitle);
      },
      bindCloseRequest: (handler) => {
        closeRequestHandler = handler;
        ensureNativeEventHooks();
        return () => {
          if (closeRequestHandler === handler) {
            closeRequestHandler = null;
          }
        };
      },
      close: async () => {
        await getBridge().closeWindow();
      },
      confirmUnsavedChanges: async (message) => {
        return await getBridge().confirmUnsavedChanges(message);
      },
      showMessage: async (options) => {
        const showMessage = getBridge().showMessage;
        if (showMessage) {
          await showMessage(options);
          return;
        }
        const alertFn = (globalThis as { alert?: (message?: string) => void }).alert;
        if (typeof alertFn === "function") {
          alertFn(options.message);
        }
      },
      openExternalUrl: async (url) => {
        return await getBridge().openExternalUrl(url);
      },
      setTheme: async (theme) => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setTheme(theme);
      }
    },
    haptics: {
      performSnapFeedback: async () => {
        await getBridge().performSnapHaptic?.();
      }
    },
    accessibility: {
      prefersNonBlinkingTextInsertionIndicator: async () => {
        return await getBridge().prefersNonBlinkingTextInsertionIndicator?.() ?? false;
      },
      bindPrefersNonBlinkingTextInsertionIndicatorChange: async (handler) => {
        const bridge = getBridge();
        if (!bridge.bindPrefersNonBlinkingTextInsertionIndicatorChange) {
          return () => {};
        }
        return await bridge.bindPrefersNonBlinkingTextInsertionIndicatorChange(handler);
      }
    },
    files: {
      bindOpenRequest: (handler) => {
        openRequestHandler = handler;
        flushPendingOpenBuffers();
        return () => {
          if (openRequestHandler === handler) {
            openRequestHandler = null;
          }
        };
      },
      openText: async (options) => {
        const opened = await getBridge().openText(null, { addToRecent: options?.addToRecent ?? true });
        if (!opened) {
          return null;
        }
        nativeMenuManager.refreshRecents();
        return {
          source: opened.source,
          fileRef: toDesktopFileRef(opened.path, opened.name)
        };
      },
      openBinary: async (options) => {
        const opened = await getBridge().openBinary?.(null, { addToRecent: options?.addToRecent ?? true });
        if (!opened) {
          return null;
        }
        nativeMenuManager.refreshRecents();
        const decoded = bytesFromBase64(opened.bytesBase64);
        const bytes = new ArrayBuffer(decoded.byteLength);
        new Uint8Array(bytes).set(decoded);
        return {
          bytes,
          fileRef: toDesktopFileRef(opened.path, opened.name)
        };
      },
      fetchArxivSource: async (idOrUrl) => {
        const fetchArxivSource = getBridge().fetchArxivSource;
        if (!fetchArxivSource) {
          throw new Error("Opening from arXiv is unavailable in this desktop build.");
        }
        return await fetchArxivSource(idOrUrl);
      },
      saveText: async (text, options) => {
        const mode = options?.mode ?? "save";
        const currentRef = options?.fileRef ?? null;
        let result: DesktopSaveTextResult;
        try {
          result = await getBridge().saveText({
            text,
            suggestedName: options?.suggestedName ?? currentRef?.name ?? "tikz-document.tex",
            path: currentRef?.provider === "desktop-fs" ? (currentRef.path ?? null) : null,
            forceSaveAs: mode === "save-as"
          });
        } catch (error) {
          logDesktopPlatformDebug("Desktop save failed.", error);
          return { status: "failed", fileRef: currentRef };
        }
        if (!result.ok || !result.path || !result.name) {
          return { status: "cancelled", fileRef: currentRef };
        }
        nativeMenuManager.refreshRecents();
        return {
          status: "saved",
          fileRef: toDesktopFileRef(result.path, result.name)
        };
      },
      readLinkedText: async (fileRef): Promise<LinkedTextReadResult> => {
        if (fileRef.provider !== "desktop-fs" || !fileRef.path || !getBridge().readLinkedText) {
          return { status: "failed", reason: "File is not linked to a desktop path." };
        }
        const result = await getBridge().readLinkedText!(fileRef.path);
        if (result.status === "ok") {
          return {
            status: "ok",
            source: result.source,
            revision: result.revision,
            fileRef: toDesktopFileRef(result.fileRef.path, result.fileRef.name)
          };
        }
        return result;
      },
      writeLinkedText: async (fileRef, text, expectedRevision): Promise<LinkedTextWriteResult> => {
        if (fileRef.provider !== "desktop-fs" || !fileRef.path || !getBridge().writeLinkedText) {
          return { status: "failed", reason: "File is not linked to a desktop path." };
        }
        const result = await getBridge().writeLinkedText!({
          path: fileRef.path,
          text,
          expectedRevision
        });
        if (result.status === "saved") {
          nativeMenuManager.refreshRecents();
          return {
            status: "saved",
            revision: result.revision,
            fileRef: toDesktopFileRef(result.fileRef.path, result.fileRef.name)
          };
        }
        if (result.status === "changed-on-disk") {
          return {
            status: "changed-on-disk",
            source: result.source,
            revision: result.revision,
            fileRef: toDesktopFileRef(result.fileRef.path, result.fileRef.name)
          };
        }
        return result;
      },
      syncLinkedFileWatches: async (fileRefs) => {
        const sync = getBridge().syncLinkedFileWatches;
        if (!sync) {
          return;
        }
        const paths = fileRefs
          .filter((fileRef) => fileRef.provider === "desktop-fs" && typeof fileRef.path === "string")
          .map((fileRef) => fileRef.path!)
          .filter((path, index, all) => path.trim().length > 0 && all.indexOf(path) === index);
        await sync(paths);
      },
      bindLinkedFileChange: (handler) => {
        const bridge = getBridge();
        if (!bridge.onLinkedFileChanged) {
          return;
        }
        let active = true;
        let unlisten: (() => void) | null = null;
        void bridge.onLinkedFileChanged((payload) => {
          if (!active) {
            return;
          }
          const name = payload.path.split(/[\\/]/).pop() ?? "document.tex";
          handler(toDesktopFileRef(payload.path, name));
        }).then((fn) => {
          if (!active) {
            fn();
            return;
          }
          unlisten = fn;
        }).catch((error: unknown) => {
          logDesktopPlatformDebug("Failed to bind linked file watcher events.", error);
        });
        return () => {
          active = false;
          unlisten?.();
        };
      },
      exportFile: async (content, options) => {
        const blob = new Blob(content, { type: options.mimeType });
        const arrayBuffer = await blob.arrayBuffer();
        return await getBridge().exportFile({
          fileName: options.fileName,
          mimeType: options.mimeType,
          bytesBase64: base64FromBytes(new Uint8Array(arrayBuffer))
        });
      },
      clearRecentFiles: async () => {
        await getBridge().clearRecentFiles();
        nativeMenuManager.refreshRecents();
      }
    },
    latex: {
      checkAvailable: async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<{ available: boolean; details: string }>("desktop_check_latex_available");
      },
      compileTikzToSvg: async (latexDocument: string) => {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<string>("desktop_compile_tikz", { latexDocument });
      },
      readLastCompileLog: async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<string>("desktop_read_last_compile_log");
      }
    },
    assistant: {
      checkCodexStatus: async () => {
        const result = await getBridge().checkCodexStatus?.();
        if (!result) return { installed: false, hasNpm: false, hasBrew: false, hasWsl: false };
        return { installed: result.installed, hasNpm: result.has_npm, hasBrew: result.has_brew, hasWsl: result.has_wsl };
      },
      installCodex: async (method) => {
        return await getBridge().installCodex?.(method) ?? "";
      },
      ensureDocumentThread: async (params) => await getBridge().assistantEnsureDocumentThread?.(params)
        ?? Promise.reject(new Error("Assistant bridge unavailable.")),
      startTurn: async (params) => await getBridge().assistantStartTurn?.(params)
        ?? Promise.reject(new Error("Assistant bridge unavailable.")),
      steerTurn: async (params) => await getBridge().assistantSteerTurn?.(params)
        ?? Promise.reject(new Error("Assistant bridge unavailable.")),
      interruptTurn: async (params) => {
        await getBridge().assistantInterruptTurn?.(params);
      },
      syncSource: async (params) => {
        await getBridge().assistantSyncSource?.(params);
      },
      respondToApproval: async (params) => {
        await getBridge().assistantRespondToApproval?.(params as {
          documentId: string;
          requestId: string;
          decision: "accept" | "acceptForSession" | "decline" | "cancel";
        });
      },
      respondToDynamicToolCall: async (params) => {
        await getBridge().assistantRespondToDynamicToolCall?.(params);
      },
      loadThreadState: async (params) => await getBridge().assistantLoadThreadState?.(params) ?? null,
      warmUp: async () => { await getBridge().assistantWarmUp?.(); },
      listModels: async () => await getBridge().assistantListModels?.() ?? [],
      readAccountSnapshot: async () => await getBridge().assistantReadAccountSnapshot?.() ?? null,
      readAccount: async () => await getBridge().assistantReadAccount?.() ?? null,
      readRateLimits: async () => await getBridge().assistantReadRateLimits?.() ?? null,
      loginStart: async (params) => await getBridge().assistantLoginStart?.(params) ?? null,
      loginCancel: async (params) => { await getBridge().assistantLoginCancel?.(params); },
      logout: async () => { await getBridge().assistantLogout?.(); },
      bindEvents: (handler) => {
        let disposed = false;
        let unlisten: (() => void) | null = null;
        void getBridge().onAssistantEvent?.(handler).then((fn) => {
          if (disposed) {
            fn();
            return;
          }
          unlisten = fn;
        });
        return () => {
          disposed = true;
          unlisten?.();
        };
      }
    },
    updates: {
      checkForUpdate: async () => {
        const checkForUpdate = getBridge().checkForUpdate;
        if (!checkForUpdate) {
          return null;
        }
        return await checkForUpdate();
      },
      installUpdate: async (onProgress) => {
        const installUpdate = getBridge().installUpdate;
        if (!installUpdate) {
          throw new Error("Desktop updater is unavailable.");
        }
        await installUpdate(onProgress);
      },
      relaunch: async () => {
        const relaunch = getBridge().relaunch;
        if (!relaunch) {
          throw new Error("Desktop relaunch is unavailable.");
        }
        await relaunch();
      }
    }
  };
}
