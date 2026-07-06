import type {
  EditorPlatform,
  MenuCommandHandler,
  PlatformUpdateApi
} from "@tikz-editor/app/platform/types";
import type { DocumentFileRef, FileRevision } from "@tikz-editor/app/store/types";
import { revisionForText, type LinkedTextReadResult, type LinkedTextWriteResult } from "@tikz-editor/app/linked-file-sync";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

type ClipboardLike = {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
  readCustomText?: (
    formats: readonly string[]
  ) => Promise<{ format: string; text: string } | null>;
  readCustomBytes?: (
    formats: readonly string[]
  ) => Promise<{ format: string; bytesBase64: string } | null>;
  writeBundle?: (payload: {
    plainText: string;
    tikzJson?: string | null;
    svgText?: string | null;
  }) => Promise<void>;
};

type FsApiLike = {
  showOpenFilePicker?: (
    options?: unknown
  ) => Promise<Array<{ name?: string; getFile: () => Promise<{ text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer>; lastModified?: number; size?: number }> }>>;
  showSaveFilePicker?: (options?: unknown) => Promise<{ name?: string; createWritable: () => Promise<{ write: (text: string) => Promise<void>; close: () => Promise<void> }> }>;
};

type FsHandleStore = {
  load: (handleId: string) => Promise<unknown>;
  save: (handleId: string, handle: unknown) => Promise<void>;
};

function logBrowserPlatformDebug(message: string, error?: unknown): void {
  if (typeof console === "undefined" || typeof console.info !== "function") {
    return;
  }
  if (error != null) {
    console.info(`[tikz-editor] ${message}`, error);
    return;
  }
  console.info(`[tikz-editor] ${message}`);
}

export type BrowserPlatformEnvironment = {
  id?: string;
  storage?: StorageLike;
  clipboard?: ClipboardLike;
  fsApi?: FsApiLike;
  fsHandleStore?: FsHandleStore;
  updates?: PlatformUpdateApi;
};

function readInjectedTestEnvironment(): BrowserPlatformEnvironment {
  const globalLike = globalThis as unknown as { __TIKZ_EDITOR_BROWSER_PLATFORM_ENV__?: BrowserPlatformEnvironment };
  return globalLike.__TIKZ_EDITOR_BROWSER_PLATFORM_ENV__ ?? {};
}

const BROWSER_FILE_PROVIDER = "browser-fsa";
const DOWNLOAD_PROVIDER = "download";
const HANDLE_INDEX_KEY = "tikz-editor:browser-file-handles";
const ACCEPT_TYPES = [
  {
    description: "TikZ, SVG, and Ipe files",
    accept: {
      "text/plain": [".tex", ".tikz", ".txt", ".ipe"],
      "image/svg+xml": [".svg"]
    }
  }
];

const ACCEPT_PPTX_TYPES = [
  {
    description: "PowerPoint files",
    accept: {
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"]
    }
  }
];

function createHandleId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `handle-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function resolveStorage(env: BrowserPlatformEnvironment): StorageLike | null {
  if (env.storage) {
    return env.storage;
  }
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  return null;
}

function resolveClipboard(env: BrowserPlatformEnvironment): ClipboardLike | null {
  if (env.clipboard) {
    return env.clipboard;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    return navigator.clipboard;
  }
  return null;
}

function resolveFsApi(env: BrowserPlatformEnvironment): FsApiLike | null {
  if (env.fsApi) {
    return env.fsApi;
  }
  const globalLike = globalThis as unknown as FsApiLike;
  if (typeof globalLike.showOpenFilePicker === "function" && typeof globalLike.showSaveFilePicker === "function") {
    return globalLike;
  }
  return null;
}

function createIndexedDbHandleStore(): FsHandleStore {
  const dbName = "tikz-editor-file-handles";
  const storeName = "handles";

  async function openDb(): Promise<IDBDatabase> {
    return await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(storeName);
      };
      request.onerror = () => { reject(request.error ?? new Error("Failed to open IndexedDB.")); };
      request.onsuccess = () => { resolve(request.result); };
    });
  }

  async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const request = run(store);
        request.onsuccess = () => { resolve(request.result); };
        request.onerror = () => { reject(request.error ?? new Error("IndexedDB request failed.")); };
      });
    } finally {
      db.close();
    }
  }

  return {
    load: async (handleId) => {
      try {
        const result: unknown = await withStore("readonly", (store) => store.get(handleId));
        return result ?? null;
      } catch (error) {
        logBrowserPlatformDebug("IndexedDB file handle load failed; falling back to Save As.", error);
        return null;
      }
    },
    save: async (handleId, handle) => {
      await withStore("readwrite", (store) => store.put(handle, handleId));
    }
  };
}

function resolveFsHandleStore(env: BrowserPlatformEnvironment): FsHandleStore | null {
  if (env.fsHandleStore) {
    return env.fsHandleStore;
  }
  if (typeof indexedDB === "undefined") {
    return null;
  }
  return createIndexedDbHandleStore();
}

function loadKnownHandleIds(storage: StorageLike | null): string[] {
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(HANDLE_INDEX_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch (error) {
    logBrowserPlatformDebug("Failed to load browser file handle index.", error);
    return [];
  }
}

function saveKnownHandleIds(storage: StorageLike | null, ids: Set<string>): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(HANDLE_INDEX_KEY, JSON.stringify([...ids]));
  } catch (error) {
    logBrowserPlatformDebug("Failed to save browser file handle index.", error);
  }
}

function openTextFileWithInput(): Promise<{ source: string; fileRef: DocumentFileRef } | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".tex,.tikz,.txt,.svg,.ipe,text/plain,image/svg+xml";
    input.style.display = "none";
    input.addEventListener("change", () => {
      void (async () => {
        const file = input.files?.[0];
        if (!file) {
          input.remove();
          resolve(null);
          return;
        }
        const text = await file.text();
        input.remove();
        resolve({
          source: text,
          fileRef: {
            kind: "file",
            name: file.name,
            provider: DOWNLOAD_PROVIDER
          }
        });
      })();
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function openBinaryFileWithInput(): Promise<{ bytes: ArrayBuffer; fileRef: DocumentFileRef } | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation";
    input.style.display = "none";
    input.addEventListener("change", () => {
      void (async () => {
        const file = input.files?.[0];
        if (!file) {
          input.remove();
          resolve(null);
          return;
        }
        const bytes = await file.arrayBuffer();
        input.remove();
        resolve({
          bytes,
          fileRef: {
            kind: "file",
            name: file.name,
            provider: DOWNLOAD_PROVIDER
          }
        });
      })();
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function downloadTextFile(text: string, fileName: string): boolean {
  if (
    typeof document === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function" ||
    !document.body
  ) {
    return false;
  }
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function requestHandlePermission(handle: unknown, mode: "read" | "readwrite"): Promise<boolean> {
  const maybeHandle = handle as {
    queryPermission?: (options: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (options: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
  };
  if (typeof maybeHandle?.queryPermission !== "function" || typeof maybeHandle?.requestPermission !== "function") {
    return true;
  }
  try {
    const queried = await maybeHandle.queryPermission({ mode });
    if (queried === "granted") {
      return true;
    }
    const requested = await maybeHandle.requestPermission({ mode });
    return requested === "granted";
  } catch (error) {
    logBrowserPlatformDebug("Browser file handle permission request failed.", error);
    return false;
  }
}

export function createBrowserPlatformAdapter(env: BrowserPlatformEnvironment = {}): EditorPlatform {
  const mergedEnv = { ...readInjectedTestEnvironment(), ...env };
  const storage = resolveStorage(mergedEnv);
  const clipboard = resolveClipboard(mergedEnv);
  const fsApi = resolveFsApi(mergedEnv);
  const fsHandleStore = resolveFsHandleStore(mergedEnv);
  const knownHandleIds = new Set(loadKnownHandleIds(storage));
  let menuHandler: MenuCommandHandler | null = null;

  async function persistHandle(handle: unknown): Promise<{ handleId: string; handle: unknown }> {
    const handleId = createHandleId();
    if (fsHandleStore) {
      await fsHandleStore.save(handleId, handle);
    }
    knownHandleIds.add(handleId);
    saveKnownHandleIds(storage, knownHandleIds);
    return { handleId, handle };
  }

  async function resolvePersistedHandle(fileRef: DocumentFileRef | null | undefined): Promise<unknown> {
    if (fileRef?.kind !== "browser-file" || !fileRef.handleId || !fsHandleStore) {
      return null;
    }
    if (!knownHandleIds.has(fileRef.handleId)) {
      return null;
    }
    return await fsHandleStore.load(fileRef.handleId);
  }

  async function openViaFsApi(): Promise<{ source: string; fileRef: DocumentFileRef } | null> {
    if (!fsApi?.showOpenFilePicker) {
      return null;
    }
    try {
      const handles = await fsApi.showOpenFilePicker({
        multiple: false,
        types: ACCEPT_TYPES
      });
      const handle = handles?.[0];
      if (!handle) {
        return null;
      }
      const file = await handle.getFile();
      const text = await file.text();
      const { handleId } = await persistHandle(handle);
      return {
        source: text,
        fileRef: {
          kind: "browser-file",
          name: handle.name ?? "document.tex",
          handleId,
          provider: BROWSER_FILE_PROVIDER
        }
      };
    } catch (error) {
      logBrowserPlatformDebug("Browser file picker open failed or was cancelled.", error);
      return null;
    }
  }

  async function openBinaryViaFsApi(): Promise<{ bytes: ArrayBuffer; fileRef: DocumentFileRef } | null> {
    if (!fsApi?.showOpenFilePicker) {
      return null;
    }
    try {
      const handles = await fsApi.showOpenFilePicker({
        multiple: false,
        types: ACCEPT_PPTX_TYPES
      });
      const handle = handles?.[0];
      if (!handle) {
        return null;
      }
      const file = await handle.getFile();
      const bytes = await file.arrayBuffer();
      return {
        bytes,
        fileRef: {
          kind: "file",
          name: handle.name ?? "imported.pptx",
          provider: DOWNLOAD_PROVIDER
        }
      };
    } catch (error) {
      logBrowserPlatformDebug("Browser binary file picker open failed or was cancelled.", error);
      return null;
    }
  }

  async function saveWithHandle(text: string, handle: unknown): Promise<boolean> {
    const canWrite = await requestHandlePermission(handle, "readwrite");
    if (!canWrite) {
      return false;
    }
    const maybeHandle = handle as { createWritable?: () => Promise<{ write: (value: string) => Promise<void>; close: () => Promise<void> }> };
    if (typeof maybeHandle.createWritable !== "function") {
      return false;
    }
    try {
      const writable = await maybeHandle.createWritable();
      await writable.write(text);
      await writable.close();
      return true;
    } catch (error) {
      logBrowserPlatformDebug("Browser file handle save failed.", error);
      return false;
    }
  }

  async function readLinkedText(fileRef: DocumentFileRef): Promise<LinkedTextReadResult> {
    const handle = await resolvePersistedHandle(fileRef);
    if (!handle) {
      return { status: "permission-needed" };
    }
    const maybeHandle = handle as {
      name?: string;
      getFile?: () => Promise<{ text: () => Promise<string>; lastModified?: number; size?: number }>;
    };
    if (typeof maybeHandle.getFile !== "function") {
      return { status: "failed", reason: "Stored browser file handle is unavailable." };
    }
    const canRead = await requestHandlePermission(handle, "read");
    if (!canRead) {
      return { status: "permission-needed" };
    }
    try {
      const file = await maybeHandle.getFile();
      const source = await file.text();
      return {
        status: "ok",
        source,
        revision: revisionForText(source, { mtimeMs: file.lastModified, size: file.size }),
        fileRef: {
          ...fileRef,
          name: maybeHandle.name ?? fileRef.name
        }
      };
    } catch (error) {
      logBrowserPlatformDebug("Browser linked file read failed.", error);
      return { status: "failed", reason: "Could not read the linked file." };
    }
  }

  async function writeLinkedText(
    fileRef: DocumentFileRef,
    text: string,
    expectedRevision: FileRevision | null
  ): Promise<LinkedTextWriteResult> {
    const current = await readLinkedText(fileRef);
    if (current.status !== "ok") {
      return current;
    }
    if (
      expectedRevision &&
      (current.revision.hash !== expectedRevision.hash ||
        current.revision.mtimeMs !== expectedRevision.mtimeMs ||
        current.revision.size !== expectedRevision.size)
    ) {
      return {
        status: "changed-on-disk",
        source: current.source,
        revision: current.revision,
        fileRef: current.fileRef
      };
    }
    const handle = await resolvePersistedHandle(fileRef);
    if (!handle) {
      return { status: "permission-needed" };
    }
    if (!(await saveWithHandle(text, handle))) {
      return { status: "failed", reason: "Could not write the linked file." };
    }
    const saved = await readLinkedText(fileRef);
    if (saved.status === "ok") {
      return {
        status: "saved",
        revision: saved.revision,
        fileRef: saved.fileRef
      };
    }
    return {
      status: "saved",
      revision: revisionForText(text),
      fileRef
    };
  }

  async function saveAsViaFsApi(
    text: string,
    suggestedName: string
  ): Promise<
    | { status: "saved"; fileRef: DocumentFileRef | null }
    | { status: "cancelled"; fileRef: DocumentFileRef | null }
    | { status: "failed"; fileRef: DocumentFileRef | null; reason?: string }
  > {
    if (!fsApi?.showSaveFilePicker) {
      return { status: "failed", fileRef: null };
    }
    try {
      const handle = await fsApi.showSaveFilePicker({
        suggestedName,
        types: ACCEPT_TYPES
      });
      const written = await saveWithHandle(text, handle);
      if (!written) {
        return { status: "failed", fileRef: null };
      }
      const { handleId } = await persistHandle(handle);
      return {
        status: "saved",
        fileRef: {
          kind: "browser-file",
          name: handle.name ?? suggestedName,
          handleId,
          provider: BROWSER_FILE_PROVIDER
        }
      };
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "AbortError" || error.name === "NotAllowedError")
      ) {
        logBrowserPlatformDebug("Browser Save As was cancelled or denied.", error);
        return { status: "cancelled", fileRef: null };
      }
      logBrowserPlatformDebug("Browser Save As failed.", error);
      return { status: "failed", fileRef: null };
    }
  }

  return {
    id: mergedEnv.id ?? "web",
    persistence: {
      load: (key) => storage?.getItem(key) ?? null,
      save: (key, value) => {
        storage?.setItem(key, value);
      }
    },
    clipboard: {
      readText: clipboard?.readText ? async () => clipboard.readText!() : undefined,
      writeText: clipboard?.writeText ? async (text) => clipboard.writeText!(text) : undefined,
      readCustomText: clipboard?.readCustomText ? async (formats) => clipboard.readCustomText!(formats) : undefined,
      readCustomBytes: clipboard?.readCustomBytes ? async (formats) => clipboard.readCustomBytes!(formats) : undefined,
      writeBundle: clipboard?.writeBundle ? async (payload) => clipboard.writeBundle!(payload) : undefined
    },
    menu: {
      usesNativeMenuBar: false,
      usesNativeContextMenus: false,
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
      syncNativeMenu: () => {},
      showNativeContextMenu: () => {}
    },
    window: {
      setDocumentState: ({ title, dirty }) => {
        if (typeof document === "undefined") {
          return;
        }
        const baseTitle = title ?? "TikZ Editor Web";
        document.title = dirty ? `• ${baseTitle}` : baseTitle;
      },
      openExternalUrl: (url) => {
        if (typeof window === "undefined" || typeof window.open !== "function") {
          return false;
        }
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        return opened != null;
      }
    },
    files: {
      openText: async () => {
        const fsResult = await openViaFsApi();
        if (fsResult) {
          return fsResult;
        }
        return await openTextFileWithInput();
      },
      openBinary: async () => {
        const fsResult = await openBinaryViaFsApi();
        if (fsResult) {
          return fsResult;
        }
        return await openBinaryFileWithInput();
      },
      saveText: async (text, options) => {
        const mode = options?.mode ?? "save";
        const suggestedName = options?.suggestedName ?? options?.fileRef?.name ?? "tikz-document.tex";
        const currentRef = options?.fileRef ?? null;

        if (mode === "save" && currentRef?.kind === "browser-file") {
          const handle = await resolvePersistedHandle(currentRef);
          if (handle && (await saveWithHandle(text, handle))) {
            return { status: "saved", fileRef: currentRef };
          }
        }

        const fsResult = await saveAsViaFsApi(text, suggestedName);
        if (fsResult.status === "saved" || fsResult.status === "cancelled") {
          return fsResult;
        }

        const downloaded = downloadTextFile(text, suggestedName);
        return {
          status: downloaded ? "saved" : "failed",
          fileRef: downloaded
            ? {
              kind: "file",
              name: suggestedName,
              provider: DOWNLOAD_PROVIDER
            }
            : currentRef
        };
      },
      readLinkedText: async (fileRef) => {
        if (fileRef.kind !== "browser-file" || fileRef.provider !== BROWSER_FILE_PROVIDER) {
          return { status: "failed", reason: "File is not linked through the browser File System Access API." };
        }
        return await readLinkedText(fileRef);
      },
      writeLinkedText: async (fileRef, text, expectedRevision) => {
        if (fileRef.kind !== "browser-file" || fileRef.provider !== BROWSER_FILE_PROVIDER) {
          return { status: "failed", reason: "File is not linked through the browser File System Access API." };
        }
        return await writeLinkedText(fileRef, text, expectedRevision);
      },
      exportFile: (content, options) => {
        if (
          typeof document === "undefined" ||
          typeof Blob === "undefined" ||
          typeof URL === "undefined" ||
          typeof URL.createObjectURL !== "function" ||
          typeof URL.revokeObjectURL !== "function" ||
          !document.body
        ) {
          return Promise.resolve(false);
        }
        const blob = new Blob(content, { type: options.mimeType });
        const objectUrl = URL.createObjectURL(blob);
        try {
          const anchor = document.createElement("a");
          anchor.href = objectUrl;
          anchor.download = options.fileName;
          anchor.style.display = "none";
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          return Promise.resolve(true);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
    },
    updates: mergedEnv.updates
  };
}
