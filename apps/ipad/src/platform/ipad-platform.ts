import type {
  DocumentFileRef,
  EditorPlatform,
  MenuCommandHandler
} from "@tikz-editor/app";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
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

function fileRefFromPath(path: string, fallbackName: string): DocumentFileRef {
  return {
    kind: "file",
    name: fileNameFromPath(path, fallbackName),
    path,
    provider: "download"
  };
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

export function createIpadPlatformAdapter(env: IpadPlatformEnvironment = {}): EditorPlatform {
  const storage = resolveStorage(env);
  let menuHandler: MenuCommandHandler | null = null;

  return {
    id: "ipad-ios-tauri",
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
      showMessage: async ({ title, message: body, kind }) => {
        await message(body, { title, kind });
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
      openText: async () => {
        const selected = await open({
          multiple: false,
          directory: false,
          filters: TEXT_FILTERS
        });
        const path = firstSelectedPath(selected);
        if (!path) {
          return null;
        }
        const source = await readTextFile(path);
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
            await writeTextFile(currentPath, text);
            return {
              status: "saved",
              fileRef: fileRefFromPath(currentPath, suggestedName)
            };
          } catch {
            // Fall through to Save As if scoped access needs to be renewed.
          }
        }

        const path = await save({
          defaultPath: suggestedName,
          filters: TEXT_FILTERS
        });
        if (!path) {
          return { status: "cancelled", fileRef: options?.fileRef ?? null };
        }
        try {
          await writeTextFile(path, text);
          return {
            status: "saved",
            fileRef: fileRefFromPath(path, suggestedName)
          };
        } catch (error) {
          return {
            status: "failed",
            fileRef: options?.fileRef ?? null,
            reason: error instanceof Error ? error.message : "Unable to save file."
          };
        }
      },
      exportFile: async (content, options) => {
        const path = await save({
          defaultPath: options.fileName
        });
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
