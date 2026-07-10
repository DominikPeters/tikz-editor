import { describe, expect, it } from "vitest";
import { APP_MENU_COMMAND_IDS, type EditorPlatform } from "../packages/app/src/index.js";
import { createBrowserPlatformAdapter } from "../apps/web/src/platform/browser-platform.js";
import { createDesktopPlatformAdapter } from "../apps/desktop/src/platform/desktop-platform.js";

type DesktopPlatformEnv = NonNullable<Parameters<typeof createDesktopPlatformAdapter>[0]>;
type DesktopBridge = NonNullable<DesktopPlatformEnv["bridge"]>;

function makeDesktopBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    openText: async () => null,
    saveText: async () => ({ ok: false, path: null, name: null }),
    exportFile: async () => false,
    readClipboard: async () => "",
    writeClipboard: async () => undefined,
    readCustomClipboardText: async () => null,
    readCustomClipboardBytes: async () => null,
    writeClipboardBundle: async () => undefined,
    setWindowTitle: async () => undefined,
    setTheme: async () => undefined,
    closeWindow: async () => undefined,
    confirmUnsavedChanges: async () => "cancel",
    showAboutPanel: async () => undefined,
    openExternalUrl: async () => true,
    listRecentFiles: async () => [],
    clearRecentFiles: async () => undefined,
    takePendingOpenRequests: async () => [],
    takePendingOpenFailures: async () => [],
    onPendingOpenRequestsChanged: async () => () => undefined,
    onWindowCloseRequest: async () => () => undefined,
    showContextMenu: async () => undefined,
    onContextMenuCommand: async () => () => undefined,
    checkLatexAvailable: async () => ({ available: false, details: "test bridge" }),
    compileTikz: async () => "<svg />",
    readLastCompileLog: async () => "",
    ...overrides
  };
}

function runPlatformContract(name: string, create: () => EditorPlatform) {
  describe(name, () => {
    it("round-trips persistence values", () => {
      const platform = create();
      platform.persistence.save("contract:key", "value-1");
      expect(platform.persistence.load("contract:key")).toBe("value-1");
      expect(platform.persistence.load("contract:missing")).toBeNull();
    });

    it("supports menu command hookup", () => {
      const platform = create();
      let seen: string | null = null;
      const dispose = platform.menu?.bindCommandHandler?.((commandId) => {
        seen = commandId;
      });
      platform.menu?.dispatchCommand?.(APP_MENU_COMMAND_IDS.UNDO, "platform");
      expect(seen).toBe(APP_MENU_COMMAND_IDS.UNDO);
      if (typeof dispose === "function") {
        dispose();
      }
    });
  });
}

describe("platform adapter contracts", () => {
  runPlatformContract("web adapter", () => {
    const storageMap = new Map<string, string>();
    let clipboardText = "";
    return createBrowserPlatformAdapter({
      storage: {
        getItem: (key) => storageMap.get(key) ?? null,
        setItem: (key, value) => {
          storageMap.set(key, value);
        }
      },
      clipboard: {
        readText: async () => clipboardText,
        writeText: async (text) => {
          clipboardText = text;
        }
      }
    });
  });

  runPlatformContract("desktop adapter", () =>
    (() => {
      const storageMap = new Map<string, string>();
      return createDesktopPlatformAdapter({
      storage: {
        getItem: (key) => storageMap.get(key) ?? null,
        setItem: (key, value) => {
          storageMap.set(key, value);
        }
      },
      bridge: makeDesktopBridge()
      });
    })()
  );

  it("web adapter clipboard read/write uses provided environment", async () => {
    const storageMap = new Map<string, string>();
    let clipboardText = "";
    const platform = createBrowserPlatformAdapter({
      storage: {
        getItem: (key) => storageMap.get(key) ?? null,
        setItem: (key, value) => {
          storageMap.set(key, value);
        }
      },
      clipboard: {
        readText: async () => clipboardText,
        writeText: async (text) => {
          clipboardText = text;
        }
      }
    });

    await platform.clipboard?.writeText?.("hello");
    const read = await platform.clipboard?.readText?.();
    expect(read).toBe("hello");
  });

  it("desktop adapter clipboard round-trips text", async () => {
    let clipboardText = "";
    let customReadFormats: readonly string[] | null = null;
    let customReadByteFormats: readonly string[] | null = null;
    let bundleWrite: { plainText: string; tikzJson?: string | null; svgText?: string | null } | null = null;
    const platform = createDesktopPlatformAdapter({
      storage: {
        getItem: () => null,
        setItem: () => undefined
      },
      bridge: makeDesktopBridge({
        readClipboard: async () => clipboardText,
        writeClipboard: async (text: string) => {
          clipboardText = text;
        },
        readCustomClipboardText: async (formats: readonly string[]) => {
          customReadFormats = formats;
          return { format: "com.microsoft.image-svg-xml", text: "<svg></svg>" };
        },
        readCustomClipboardBytes: async (formats: readonly string[]) => {
          customReadByteFormats = formats;
          return { format: "com.microsoft.Art--GVML-ClipFormat", bytesBase64: "AAECAw==" };
        },
        writeClipboardBundle: async (payload: { plainText: string; tikzJson?: string | null; svgText?: string | null }) => {
          bundleWrite = payload;
        }
      })
    });
    await platform.clipboard?.writeText?.("desktop-hello");
    const read = await platform.clipboard?.readText?.();
    const custom = await platform.clipboard?.readCustomText?.(["com.microsoft.image-svg-xml"]);
    const customBytes = await platform.clipboard?.readCustomBytes?.(["com.microsoft.Art--GVML-ClipFormat"]);
    await platform.clipboard?.writeBundle?.({
      plainText: "hello",
      tikzJson: "{\"ok\":true}",
      svgText: "<svg />"
    });
    expect(read).toBe("desktop-hello");
    expect(custom).toEqual({ format: "com.microsoft.image-svg-xml", text: "<svg></svg>" });
    expect(customBytes).toEqual({ format: "com.microsoft.Art--GVML-ClipFormat", bytesBase64: "AAECAw==" });
    expect(customReadFormats).toEqual(["com.microsoft.image-svg-xml"]);
    expect(customReadByteFormats).toEqual(["com.microsoft.Art--GVML-ClipFormat"]);
    expect(bundleWrite).toEqual({
      plainText: "hello",
      tikzJson: "{\"ok\":true}",
      svgText: "<svg />"
    });
  });

  it("desktop adapter exposes haptic feedback bridge", async () => {
    let hapticCalls = 0;
    const platform = createDesktopPlatformAdapter({
      storage: {
        getItem: () => null,
        setItem: () => undefined
      },
      bridge: makeDesktopBridge({
        performSnapHaptic: async () => {
          hapticCalls += 1;
        }
      })
    });

    await platform.haptics?.performSnapFeedback?.();
    expect(hapticCalls).toBe(1);
  });

  it("desktop saveText returns desktop fileRef when save succeeds", async () => {
    const platform = createDesktopPlatformAdapter({
      storage: {
        getItem: () => null,
        setItem: () => undefined
      },
      bridge: makeDesktopBridge({
        saveText: async () => ({ ok: true, path: "/tmp/a.tex", name: "a.tex" })
      })
    });
    const result = await platform.files?.saveText?.("abc", {
      suggestedName: "a.tex",
      fileRef: { kind: "file", name: "a.tex" },
      mode: "save"
    });
    expect(result).toEqual({
      status: "saved",
      fileRef: {
        kind: "file",
        name: "a.tex",
        path: "/tmp/a.tex",
        provider: "desktop-fs"
      }
    });
  });

  it("desktop adapter bindOpenRequest receives test open requests", async () => {
    const platform = createDesktopPlatformAdapter({
      storage: {
        getItem: () => null,
        setItem: () => undefined
      },
      bridge: makeDesktopBridge({
        openText: async (path?: string | null) =>
          path
            ? { source: "\\draw (0,0)--(1,1);", path, name: "recent.tex" }
            : null,
        listRecentFiles: async () => ["/tmp/recent.tex"]
      })
    });
    let seenSource = "";
    const unbind = platform.files?.bindOpenRequest?.((opened) => {
      seenSource = opened.source;
    });
    (
      globalThis as typeof globalThis & {
        __TIKZ_EDITOR_DESKTOP_TEST_API__?: {
          triggerOpenRequest: (opened: { source: string; path: string; name: string }) => void;
        };
      }
    ).__TIKZ_EDITOR_DESKTOP_TEST_API__?.triggerOpenRequest({
      source: "\\draw (0,0)--(1,1);",
      path: "/tmp/recent.tex",
      name: "recent.tex"
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(seenSource).toContain("\\draw");
    if (typeof unbind === "function") {
      unbind();
    }
  });

  it("desktop adapter bindCloseRequest and close bridge window lifecycle", async () => {
    let closeRequestHandler: (() => void) | null = null;
    let closeCalled = false;
    const platform = createDesktopPlatformAdapter({
      storage: {
        getItem: () => null,
        setItem: () => undefined
      },
      bridge: makeDesktopBridge({
        closeWindow: async () => {
          closeCalled = true;
        },
        onWindowCloseRequest: async (handler: () => void) => {
          closeRequestHandler = handler;
          return () => {
            if (closeRequestHandler === handler) {
              closeRequestHandler = null;
            }
          };
        }
      })
    });

    let seenCloseRequest = 0;
    const unbind = platform.window?.bindCloseRequest?.(() => {
      seenCloseRequest += 1;
    });
    (closeRequestHandler as (() => void) | null)?.();
    await Promise.resolve();
    expect(seenCloseRequest).toBe(1);

    await platform.window?.close?.();
    expect(closeCalled).toBe(true);

    if (typeof unbind === "function") {
      unbind();
    }
  });

  it("web adapter openText returns source and fileRef via fallback input", async () => {
    const platform = createBrowserPlatformAdapter({
      fsApi: {},
      storage: {
        getItem: () => null,
        setItem: () => undefined
      }
    });
    expect(typeof platform.files?.openText).toBe("function");
  });

  it("web adapter saveText supports fs-handle rebinding flow", async () => {
    const handleStore = new Map<string, unknown>();
    const writes: string[] = [];
    const fakeFsHandle = {
      name: "bound.tex",
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      createWritable: async () => ({
        write: async (value: string) => {
          writes.push(value);
        },
        close: async () => undefined
      })
    };
    const platform = createBrowserPlatformAdapter({
      storage: {
        getItem: () => null,
        setItem: () => undefined
      },
      fsApi: {
        showSaveFilePicker: async () => fakeFsHandle
      },
      fsHandleStore: {
        load: async (handleId) => handleStore.get(handleId) ?? null,
        save: async (handleId, handle) => {
          handleStore.set(handleId, handle);
        }
      }
    });

    const firstSave = await platform.files?.saveText?.("v1", { mode: "save-as", suggestedName: "first.tex" });
    expect(firstSave?.status).toBe("saved");
    expect(firstSave?.fileRef?.kind).toBe("browser-file");
    const secondSave = await platform.files?.saveText?.("v2", {
      mode: "save",
      fileRef: firstSave?.fileRef ?? null,
      suggestedName: "first.tex"
    });
    expect(secondSave?.status).toBe("saved");
    expect(writes).toEqual(["v1", "v2"]);
  });
});
