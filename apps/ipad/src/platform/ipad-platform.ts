import type {
  DocumentFileRef,
  EditorPlatform,
  FileRevision,
  LinkedTextReadResult,
  LinkedTextWriteResult,
  MenuCommandHandler
} from "@tikz-editor/app";
// Deep import on purpose: pulling revisionForText from the package index would
// evaluate the editor store (and seed the workspace from the in-memory fallback
// platform) before bootstrap() registers the iPad platform adapter — silently
// discarding the persisted workspace on every launch.
import { revisionForText } from "@tikz-editor/app/linked-file-sync";
import { createInAppPresentationApi } from "@tikz-editor/app/presentation";
import { createIpadExternalDisplay } from "./external-display";
import { nativeAlert } from "./native-alert";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { documentDir, join } from "@tauri-apps/api/path";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { BaseDirectory, readFile, readTextFile, remove, stat, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type IpadPlatformEnvironment = {
  storage?: StorageLike;
};

const TEXT_FILTERS = [
  {
    name: "TikZ, TeX, SVG, and Ipe",
    extensions: ["tex", "tikz", "txt", "svg", "ipe"]
  }
];

const PPTX_FILTERS = [
  {
    name: "PowerPoint",
    extensions: ["pptx"]
  }
];

function resolveStorage(env: IpadPlatformEnvironment): StorageLike | null {
  if (env.storage) {
    return env.storage;
  }
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  return null;
}

function firstSelectedPath(value: string | string[] | null): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value;
}

function fileNameFromPath(path: string, fallback: string): string {
  try {
    const normalized = path.startsWith("file://") ? new URL(path).pathname : path;
    const decoded = decodeURIComponent(normalized);
    const parts = decoded.split(/[\\/]/);
    return parts.at(-1) ?? fallback;
  } catch {
    const parts = path.split(/[\\/]/);
    return parts.at(-1) ?? fallback;
  }
}

// Tauri commands reject with plain strings, not Error objects.
function errorReason(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return fallback;
}

function fileRefFromPath(path: string, fallbackName: string): DocumentFileRef {
  return {
    kind: "file",
    name: fileNameFromPath(path, fallbackName),
    path,
    provider: "ios-files"
  };
}

const BOOKMARK_STORAGE_KEY = "tikz-editor-ipad-file-bookmarks";
const MAX_BOOKMARKS = 64;

type FileAccess = {
  /** Records a persistent grant for a file the user just picked. */
  remember: (location: string) => Promise<void>;
  /** The location to read or write; re-grants access after a relaunch. */
  locate: (location: string) => Promise<string>;
};

// Files picked in the Files app stay reachable only for the current process;
// a bookmark keeps the grant across launches and follows renames and moves.
function createFileAccess(storage: StorageLike | null): FileAccess {
  const granted = new Map<string, string>();

  const load = (): Record<string, string> => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(BOOKMARK_STORAGE_KEY) ?? "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      );
    } catch {
      return {};
    }
  };
  const store = (location: string, bookmark: string) => {
    const bookmarks = load();
    delete bookmarks[location];
    bookmarks[location] = bookmark;
    const entries = Object.entries(bookmarks);
    try {
      storage?.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries.slice(-MAX_BOOKMARKS))));
    } catch {
      // Storage full or unavailable: the grant still lasts for this session.
    }
  };

  return {
    remember: async (location) => {
      granted.set(location, location);
      try {
        store(location, await invoke<string>("ipad_create_bookmark", { location }));
      } catch {
        // Outside the native shell (browser dev loop) there is nothing to keep.
      }
    },
    locate: async (location) => {
      const known = granted.get(location);
      if (known) return known;
      const bookmark = load()[location];
      if (!bookmark) return location;
      try {
        const resolved = await invoke<{ url: string; bookmark: string }>("ipad_resolve_bookmark", { bookmark });
        store(resolved.url, resolved.bookmark);
        granted.set(location, resolved.url);
        granted.set(resolved.url, resolved.url);
        return resolved.url;
      } catch {
        return location;
      }
    }
  };
}

function filePathFromLocation(location: string): string {
  return location.startsWith("file://") ? decodeURIComponent(new URL(location).pathname) : location;
}

// On iOS the save dialog first writes an empty file named after the suggestion
// into the app's Documents folder and exports that; it never removes it.
async function removeSavePlaceholder(fileName: string, chosen: string | null): Promise<void> {
  try {
    const placeholder = await join(await documentDir(), fileName);
    if (chosen && filePathFromLocation(chosen) === placeholder) return;
    const info = await stat(fileName, { baseDir: BaseDirectory.Document });
    if (info.isFile && info.size === 0) await remove(fileName, { baseDir: BaseDirectory.Document });
  } catch {
    // Nothing there (or not on iOS): nothing to clean up.
  }
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function blobPartsToBytes(content: BlobPart[], mimeType: string): Promise<Uint8Array> {
  const blob = new Blob(content, { type: mimeType });
  return new Uint8Array(await blob.arrayBuffer());
}

async function readLinkedTextFile(access: FileAccess, fileRef: DocumentFileRef): Promise<LinkedTextReadResult> {
  if (fileRef.provider !== "ios-files" || !fileRef.path) {
    return { status: "permission-needed" };
  }
  try {
    const location = await access.locate(fileRef.path);
    const source = await readTextFile(location);
    return {
      status: "ok",
      source,
      revision: revisionForText(source),
      fileRef: fileRefFromPath(location, fileRef.name)
    };
  } catch (error) {
    return {
      status: "failed",
      reason: errorReason(error, "Unable to read linked file.")
    };
  }
}

async function writeLinkedTextFile(
  access: FileAccess,
  fileRef: DocumentFileRef,
  text: string,
  expectedRevision: FileRevision | null
): Promise<LinkedTextWriteResult> {
  if (fileRef.provider !== "ios-files" || !fileRef.path) {
    return { status: "permission-needed" };
  }
  try {
    const location = await access.locate(fileRef.path);
    const currentSource = await readTextFile(location);
    const currentRevision = revisionForText(currentSource);
    if (expectedRevision && currentRevision.hash !== expectedRevision.hash) {
      return {
        status: "changed-on-disk",
        source: currentSource,
        revision: currentRevision,
        fileRef: fileRefFromPath(location, fileRef.name)
      };
    }
    await writeTextFile(location, text);
    return {
      status: "saved",
      revision: revisionForText(text),
      fileRef: fileRefFromPath(location, fileRef.name)
    };
  } catch (error) {
    return {
      status: "failed",
      reason: errorReason(error, "Unable to write linked file.")
    };
  }
}

async function tryShareExport(content: BlobPart[], options: { fileName: string; mimeType: string }): Promise<boolean> {
  if (typeof navigator.share !== "function" || typeof File === "undefined") {
    return false;
  }
  const bytes = await blobPartsToBytes(content, options.mimeType);
  const file = new File([arrayBufferFromBytes(bytes)], options.fileName, { type: options.mimeType });
  const sharePayload = { files: [file], title: options.fileName };
  if (typeof navigator.canShare === "function" && !navigator.canShare(sharePayload)) {
    return false;
  }
  try {
    await navigator.share(sharePayload);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }
    return false;
  }
}

type OpenRequestHandler = (opened: { source: string; fileRef: DocumentFileRef | null }) => void;

/**
 * Documents opened from Files (src-tauri/src/lib.rs, `opened_files`). The
 * native side keeps them until asked; here they wait for the editor's
 * handler, which may not be bound yet at launch or between remounts.
 */
function createOpenedFiles(access: FileAccess) {
  let handler: OpenRequestHandler | null = null;
  const waiting: string[] = [];
  let listening = false;
  const deliver = async () => {
    while (handler && waiting.length) {
      const location = waiting.shift();
      if (!location) break;
      const current = handler;
      try {
        const source = await readTextFile(location);
        await access.remember(location);
        current({ source, fileRef: fileRefFromPath(location, "document.tex") });
      } catch (error) {
        await message(errorReason(error, "The file could not be read."), { title: "Couldn’t Open the File", kind: "error" }).catch(() => {});
      }
    }
  };
  const take = async () => {
    try {
      waiting.push(...await invoke<string[]>("ipad_take_opened_files"));
    } catch {
      // Outside the native shell nothing is ever opened this way.
    }
    await deliver();
  };
  return {
    bind(next: OpenRequestHandler) {
      handler = next;
      if (!listening) {
        listening = true;
        void listen("ipad-open-files", () => { void take(); }).catch(() => {});
      }
      void take();
      return () => {
        if (handler === next) handler = null;
      };
    }
  };
}

export function createIpadPlatformAdapter(env: IpadPlatformEnvironment = {}): EditorPlatform {
  const storage = resolveStorage(env);
  const access = createFileAccess(storage);
  const openedFiles = createOpenedFiles(access);
  let menuHandler: MenuCommandHandler | null = null;

  return {
    id: "ipad-ios-tauri",
    tikzJax: false,
    // One screen: the slides or the presenter view show over the editor.
    presentation: createInAppPresentationApi({
      keepAwake: async (active) => { await invoke("ipad_keep_awake", { active }); },
      fullScreen: async (active) => { await invoke("ipad_full_screen", { active }); },
      externalDisplay: createIpadExternalDisplay()
    }),
    persistence: {
      load: (key) => storage?.getItem(key) ?? null,
      save: (key, value) => {
        storage?.setItem(key, value);
      }
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
    clipboard: {
      readText: async () => navigator.clipboard.readText(),
      writeText: async (text) => navigator.clipboard.writeText(text)
    },
    window: {
      setDocumentState: ({ title, dirty }) => {
        const baseTitle = title ?? "TikZ Editor";
        document.title = dirty ? `• ${baseTitle}` : baseTitle;
      },
      confirmUnsavedChanges: async (_message, titles) => {
        const question = titles.length === 1
          ? `Do you want to save the changes made to “${titles[0]}”?`
          : `Do you want to save the changes to ${titles.length} documents?`;
        const choice = await nativeAlert(question, "Your changes will be lost if you don’t save them.", [
          { title: "Save", preferred: true },
          { title: "Don’t Save", style: "destructive" },
          { title: "Cancel", style: "cancel" }
        ]).catch(() => 2);
        return (["save", "discard", "cancel"] as const)[choice] ?? "cancel";
      },
      showMessage: async ({ title, message: body, kind }) => {
        await message(body, { title, ...(kind === undefined ? {} : { kind }) });
      },
      openExternalUrl: async (url) => {
        try {
          await openUrl(url);
          return true;
        } catch {
          return false;
        }
      }
    },
    files: {
      bindOpenRequest: (handler) => openedFiles.bind(handler),
      openText: async () => {
        // "scoped" opens the file in place; the default copies it into the
        // sandbox, so saves would land in the copy and never reach Files.
        const selected = await open({
          multiple: false,
          directory: false,
          filters: TEXT_FILTERS,
          fileAccessMode: "scoped"
        });
        const path = firstSelectedPath(selected);
        if (!path) {
          return null;
        }
        const source = await readTextFile(path);
        await access.remember(path);
        return {
          source,
          fileRef: fileRefFromPath(path, "document.tex")
        };
      },
      openBinary: async () => {
        const selected = await open({
          multiple: false,
          directory: false,
          filters: PPTX_FILTERS
        });
        const path = firstSelectedPath(selected);
        if (!path) {
          return null;
        }
        const bytes = await readFile(path);
        return {
          bytes: arrayBufferFromBytes(bytes),
          fileRef: fileRefFromPath(path, "imported.pptx")
        };
      },
      saveText: async (text, options) => {
        const suggestedName = options?.suggestedName ?? options?.fileRef?.name ?? "tikz-document.tex";
        const currentPath = options?.mode !== "save-as" ? options?.fileRef?.path : null;
        if (currentPath) {
          try {
            const location = await access.locate(currentPath);
            await writeTextFile(location, text);
            return {
              status: "saved",
              fileRef: fileRefFromPath(location, suggestedName)
            };
          } catch {
            // Fall through to Save As when the file can no longer be reached.
          }
        }

        const path = await save({
          defaultPath: suggestedName,
          filters: TEXT_FILTERS
        });
        await removeSavePlaceholder(suggestedName, path);
        if (!path) {
          return { status: "cancelled", fileRef: options?.fileRef ?? null };
        }
        try {
          await writeTextFile(path, text);
          await access.remember(path);
          return {
            status: "saved",
            fileRef: fileRefFromPath(path, suggestedName)
          };
        } catch (error) {
          return {
            status: "failed",
            fileRef: options?.fileRef ?? null,
            reason: errorReason(error, "Unable to save file.")
          };
        }
      },
      readLinkedText: (fileRef) => readLinkedTextFile(access, fileRef),
      writeLinkedText: (fileRef, text, expectedRevision) => writeLinkedTextFile(access, fileRef, text, expectedRevision),
      syncLinkedFileWatches: () => {},
      exportFile: async (content, options) => {
        if (await tryShareExport(content, options)) {
          return true;
        }
        const path = await save({
          defaultPath: options.fileName
        });
        await removeSavePlaceholder(options.fileName, path);
        if (!path) {
          return false;
        }
        const bytes = await blobPartsToBytes(content, options.mimeType);
        await writeFile(path, bytes);
        return true;
      }
    }
  };
}
