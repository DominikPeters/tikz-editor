import type { AppMenuCommandId } from "@tikz-editor/app/app-menu";
import type {
  ArxivSourcePayload,
  AssistantAccountSnapshot,
  AssistantDynamicToolResult,
  AssistantEvent,
  AssistantModelOption,
  AssistantThreadState,
  AssistantThreadSummary,
  DesktopContextMenuPayload,
  UpdateInfo,
  UpdateInstallProgress
} from "@tikz-editor/app/platform/types";
import type { FileRevision } from "@tikz-editor/app/store/types";
import type { Update } from "@tauri-apps/plugin-updater";

export type DesktopOpenTextResult = {
  source: string;
  path: string;
  name: string;
};

export type DesktopOpenBinaryResult = {
  bytesBase64: string;
  path: string;
  name: string;
};

export type DesktopOpenTextFailureResult = {
  path: string;
  message: string;
};

export type DesktopSaveTextResult = {
  ok: boolean;
  path: string | null;
  name: string | null;
};

export type DesktopLinkedFileRef = {
  kind: "file";
  name: string;
  path: string;
  provider: "desktop-fs";
};

export type DesktopLinkedTextReadResult =
  | { status: "ok"; source: string; revision: FileRevision; fileRef: DesktopLinkedFileRef }
  | { status: "missing" }
  | { status: "failed"; reason?: string };

export type DesktopLinkedTextWriteResult =
  | { status: "saved"; revision: FileRevision; fileRef: DesktopLinkedFileRef }
  | { status: "changed-on-disk"; source: string; revision: FileRevision; fileRef: DesktopLinkedFileRef }
  | { status: "missing" }
  | { status: "failed"; reason?: string };

export type DesktopBridge = {
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
  exportFile: (params: { fileName: string; mimeType: string; bytesBase64: string }) => Promise<boolean>;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  readCustomClipboardText: (formats: readonly string[]) => Promise<{ format: string; text: string } | null>;
  readCustomClipboardBytes: (formats: readonly string[]) => Promise<{ format: string; bytesBase64: string } | null>;
  writeClipboardBundle: (payload: {
    plainText: string;
    tikzJson?: string | null;
    svgText?: string | null;
    pngBase64?: string | null;
  }) => Promise<void>;
  setWindowTitle: (title: string) => Promise<void>;
  setTheme: (theme: "light" | "dark" | null) => Promise<void>;
  closeWindow: () => Promise<void>;
  confirmUnsavedChanges: (message: string) => Promise<"save" | "discard" | "cancel">;
  showMessage?: (options: { title: string; message: string; kind?: "info" | "warning" | "error" }) => Promise<void>;
  showAboutPanel: () => Promise<void>;
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
  onContextMenuCommand: (
    handler: (payload: { requestId: string; commandId: AppMenuCommandId }) => void
  ) => Promise<() => void>;
  checkLatexAvailable: () => Promise<{ available: boolean; details: string }>;
  compileTikz: (latexDocument: string) => Promise<string>;
  readLastCompileLog: () => Promise<string>;
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

const DESKTOP_OPEN_REQUESTS_CHANGED_EVENT = "desktop-open-requests-changed";

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return await tauriInvoke<T>(command, args);
}

export function createDefaultBridge(): DesktopBridge {
  let pendingUpdate: Update | null = null;

  return {
    openText: async (path, options) => await invoke<DesktopOpenTextResult | null>("desktop_open_text", {
      path,
      addToRecent: options?.addToRecent
    }),
    openBinary: async (path, options) => await invoke<DesktopOpenBinaryResult | null>("desktop_open_binary", {
      path,
      addToRecent: options?.addToRecent
    }),
    fetchArxivSource: async (idOrUrl) => await invoke<ArxivSourcePayload>("desktop_fetch_arxiv_source", { idOrUrl }),
    saveText: async ({ text, suggestedName, path, forceSaveAs }) => await invoke<DesktopSaveTextResult>(
      "desktop_save_text",
      { text, suggestedName, path, forceSaveAs }
    ),
    readLinkedText: async (path) => await invoke<DesktopLinkedTextReadResult>("desktop_read_linked_text", { path }),
    writeLinkedText: async ({ path, text, expectedRevision }) => await invoke<DesktopLinkedTextWriteResult>(
      "desktop_write_linked_text",
      { path, text, expectedRevision: expectedRevision ?? null }
    ),
    syncLinkedFileWatches: async (paths) => {
      await invoke("desktop_sync_linked_file_watches", { paths });
    },
    onLinkedFileChanged: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<{ path: string }>("desktop-linked-file-changed", (event) => {
        handler(event.payload);
      });
    },
    exportFile: async ({ fileName, mimeType, bytesBase64 }) => await invoke<boolean>("desktop_export_file", {
      fileName,
      mimeType,
      bytesBase64
    }),
    readClipboard: async () => {
      const { readText } = await import("tauri-plugin-clipboard-x-api");
      return await readText();
    },
    writeClipboard: async (text) => {
      const { writeText } = await import("tauri-plugin-clipboard-x-api");
      await writeText(text);
    },
    readCustomClipboardText: async (formats) => await invoke<{ format: string; text: string } | null>(
      "desktop_read_custom_clipboard_text",
      { formats }
    ),
    readCustomClipboardBytes: async (formats) => await invoke<{ format: string; bytesBase64: string } | null>(
      "desktop_read_custom_clipboard_bytes",
      { formats }
    ),
    writeClipboardBundle: async (payload) => {
      await invoke("desktop_write_clipboard_bundle", { payload });
    },
    setWindowTitle: async (title) => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setTitle(title);
    },
    setTheme: async (theme) => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setTheme(theme);
    },
    closeWindow: async () => {
      await invoke("desktop_confirm_window_close");
    },
    confirmUnsavedChanges: async (message) => await invoke<"save" | "discard" | "cancel">(
      "desktop_confirm_unsaved_changes",
      { message }
    ),
    showMessage: async ({ title, message, kind }) => {
      await invoke("desktop_show_message_dialog", { title, message, kind: kind ?? "info" });
    },
    showAboutPanel: async () => {
      await invoke("desktop_show_about_panel");
    },
    openExternalUrl: async (url) => await invoke<boolean>("desktop_open_external", { url }),
    performSnapHaptic: async () => {
      await invoke("desktop_perform_snap_haptic");
    },
    prefersNonBlinkingTextInsertionIndicator: async () => await invoke<boolean>(
      "desktop_prefers_non_blinking_text_insertion_indicator"
    ),
    bindPrefersNonBlinkingTextInsertionIndicatorChange: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<boolean>("desktop-prefers-non-blinking-text-insertion-indicator-changed", (event) => {
        handler(event.payload);
      });
    },
    listRecentFiles: async () => await invoke<string[]>("desktop_list_recent_files"),
    clearRecentFiles: async () => {
      await invoke("desktop_clear_recent_files");
    },
    takePendingOpenRequests: async () => await invoke<DesktopOpenTextResult[]>("desktop_take_pending_open_requests"),
    takePendingOpenFailures: async () => await invoke<DesktopOpenTextFailureResult[]>("desktop_take_pending_open_failures"),
    onPendingOpenRequestsChanged: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen(DESKTOP_OPEN_REQUESTS_CHANGED_EVENT, handler);
    },
    onWindowCloseRequest: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen("desktop-window-close-request", handler);
    },
    showContextMenu: async (payload) => {
      await invoke("desktop_show_context_menu", { payload });
    },
    onContextMenuCommand: async (handler) => {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen<{ requestId: string; commandId: AppMenuCommandId }>("desktop-context-menu-command", (event) => {
        handler(event.payload);
      });
    },
    checkLatexAvailable: async () => await invoke<{ available: boolean; details: string }>(
      "desktop_check_latex_available"
    ),
    compileTikz: async (latexDocument) => await invoke<string>("desktop_compile_tikz", { latexDocument }),
    readLastCompileLog: async () => await invoke<string>("desktop_read_last_compile_log"),
    checkCodexStatus: async () => await invoke<{
      installed: boolean;
      has_npm: boolean;
      has_brew: boolean;
      has_wsl: boolean;
    }>("desktop_check_codex_status"),
    installCodex: async (method) => await invoke<string>("desktop_install_codex", { method }),
    checkForUpdate: async () => {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      pendingUpdate = update;
      return update
        ? { version: update.version, currentVersion: update.currentVersion, date: update.date, body: update.body }
        : null;
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
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await invoke("desktop_prepare_update_relaunch");
      await relaunch();
    },
    assistantEnsureDocumentThread: async (params) => await invoke<AssistantThreadSummary>(
      "desktop_assistant_ensure_document_thread",
      params
    ),
    assistantStartTurn: async (params) => await invoke<{ turnId: string | null }>(
      "desktop_assistant_start_turn",
      params
    ),
    assistantSteerTurn: async (params) => await invoke<{ turnId: string | null }>(
      "desktop_assistant_steer_turn",
      params
    ),
    assistantInterruptTurn: async ({ documentId }) => {
      await invoke("desktop_assistant_interrupt_turn", { documentId });
    },
    assistantSyncSource: async ({ documentId, source }) => {
      await invoke("desktop_assistant_sync_source", { documentId, source });
    },
    assistantRespondToApproval: async ({ documentId, requestId, decision }) => {
      await invoke("desktop_assistant_respond_to_approval", { documentId, requestId, decision });
    },
    assistantRespondToDynamicToolCall: async ({ documentId, requestId, result }) => {
      await invoke("desktop_assistant_respond_to_dynamic_tool_call", { documentId, requestId, result });
    },
    assistantLoadThreadState: async ({ documentId }) => await invoke<AssistantThreadState | null>(
      "desktop_assistant_load_thread_state",
      { documentId }
    ),
    assistantWarmUp: async () => {
      await invoke("desktop_assistant_warm_up");
    },
    assistantListModels: async () => await invoke<AssistantModelOption[]>("desktop_assistant_list_models"),
    assistantReadAccountSnapshot: async () => await invoke<AssistantAccountSnapshot | null>(
      "desktop_assistant_read_account_snapshot"
    ),
    assistantReadAccount: async () => await invoke<unknown>("desktop_assistant_read_account"),
    assistantReadRateLimits: async () => await invoke<unknown>("desktop_assistant_read_rate_limits"),
    assistantLoginStart: async ({ loginType, apiKey }) => await invoke<unknown>(
      "desktop_assistant_login_start",
      { loginType, apiKey }
    ),
    assistantLoginCancel: async ({ loginId }) => {
      await invoke("desktop_assistant_login_cancel", { loginId });
    },
    assistantLogout: async () => {
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
