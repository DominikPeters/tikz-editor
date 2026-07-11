import type { AppMenuCommandId } from "@tikz-editor/app/app-menu";
import type { LinkedTextReadResult, LinkedTextWriteResult } from "@tikz-editor/app/linked-file-sync";
import type { EditorPlatform, MenuCommandHandler } from "@tikz-editor/app/platform/types";
import type { DocumentFileRef } from "@tikz-editor/app/store/types";
import {
  createDefaultBridge,
  type DesktopBridge,
  type DesktopOpenTextFailureResult,
  type DesktopOpenTextResult,
  type DesktopSaveTextResult
} from "./bridge";
import {
  createNativeDesktopMenuManager,
  serializeDesktopContextMenuItems
} from "./native-menu";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
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
    triggerOpenRequest: (opened: DesktopOpenTextResult) => void;
    triggerWindowCloseRequest: () => void;
  };
};

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
  return { kind: "file", name, path, provider: "desktop-fs" };
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
    },
    reportError: logDesktopPlatformDebug
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
        await getBridge().setTheme(theme);
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
      readLocalAsset: async (path) => {
        const read = getBridge().readLocalAsset;
        if (!read) {
          return { status: "failed", reason: "Desktop local asset reads are unavailable.", path };
        }
        return await read(path);
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
      syncLocalAssetWatches: async (paths) => {
        const sync = getBridge().syncLocalAssetWatches;
        if (!sync) {
          return;
        }
        const uniquePaths = paths
          .map((path) => path.trim())
          .filter((path, index, all) => path.length > 0 && all.indexOf(path) === index);
        await sync(uniquePaths);
      },
      bindLocalAssetChange: (handler) => {
        const bridge = getBridge();
        if (!bridge.onLocalAssetChanged) {
          return;
        }
        let active = true;
        let unlisten: (() => void) | null = null;
        void bridge.onLocalAssetChanged((payload) => {
          if (active) {
            handler(payload.path);
          }
        }).then((fn) => {
          if (!active) {
            fn();
            return;
          }
          unlisten = fn;
        }).catch((error: unknown) => {
          logDesktopPlatformDebug("Failed to bind local image asset watcher events.", error);
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
      checkAvailable: async () => await getBridge().checkLatexAvailable(),
      compileTikzToSvg: async (latexDocument, options) => await getBridge().compileTikz(latexDocument, options),
      readLastCompileLog: async () => await getBridge().readLastCompileLog()
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
