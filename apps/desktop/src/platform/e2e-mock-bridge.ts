import type { FileRevision } from "@tikz-editor/app/store/types";
import type { DesktopBridge } from "./bridge";

type E2eWrite = {
  text: string;
  path: string;
  forceSaveAs: boolean;
};

type E2eExportPayload = {
  fileName: string;
  mimeType: string;
  bytesBase64: string;
};

type E2eUnsavedDecision = "save" | "discard" | "cancel";

type DesktopE2eWindow = Window & {
  __DESKTOP_E2E_CONSOLE_CAPTURE_INSTALLED__?: boolean;
  __DESKTOP_E2E_WRITES__: E2eWrite[];
  __DESKTOP_E2E_EXPORTS__: string[];
  __DESKTOP_E2E_EXPORT_PAYLOADS__: E2eExportPayload[];
  __DESKTOP_E2E_CLEAR_RECENT_CALLS__: number[];
  __DESKTOP_E2E_WINDOW_TITLES__: string[];
  __DESKTOP_E2E_UNSAVED_DECISIONS__: E2eUnsavedDecision[];
  __DESKTOP_E2E_UNSAVED_PROMPTS__: string[];
  __DESKTOP_E2E_WARNINGS__: string[];
  __DESKTOP_E2E_ERRORS__: string[];
  __DESKTOP_E2E_TITLE__?: string;
  __DESKTOP_E2E_CLOSED__: boolean;
  __TIKZ_EDITOR_DESKTOP_TEST_API__: {
    setBridgeOverride: (bridge: DesktopBridge | null) => void;
  };
};

/** Runs inside the WebView through WebDriver's `execute` serialization. */
export function installDeterministicBridgeInPage(): void {
  const e2eWindow = window as unknown as DesktopE2eWindow;
  const writes: E2eWrite[] = [];
  const exports: string[] = [];
  const exportPayloads: E2eExportPayload[] = [];
  const clearRecentCalls: number[] = [];
  const windowTitles: string[] = [];
  const unsavedDecisions: E2eUnsavedDecision[] = [];
  const unsavedPrompts: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const linkedFiles = new Map<string, { source: string; revision: FileRevision }>();

  const linkedRevisionForText = (text: string): FileRevision => ({
    hash: `e2e-${text.length}-${Array.from(text)
      .reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 0)
      .toString(16)}`,
    size: text.length
  });
  const linkedFileRefForPath = (filePath: string) => ({
    kind: "file" as const,
    provider: "desktop-fs" as const,
    path: filePath,
    name: filePath.split("/").pop() ?? "tikz-document.tex"
  });

  e2eWindow.__DESKTOP_E2E_WARNINGS__ = warnings;
  e2eWindow.__DESKTOP_E2E_ERRORS__ = errors;
  if (!e2eWindow.__DESKTOP_E2E_CONSOLE_CAPTURE_INSTALLED__) {
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);
    console.warn = (...args: unknown[]) => {
      e2eWindow.__DESKTOP_E2E_WARNINGS__.push(args.map(String).join(" "));
      originalWarn(...args);
    };
    console.error = (...args: unknown[]) => {
      e2eWindow.__DESKTOP_E2E_ERRORS__.push(args.map(String).join(" "));
      originalError(...args);
    };
    e2eWindow.__DESKTOP_E2E_CONSOLE_CAPTURE_INSTALLED__ = true;
  }

  const noOp = (): void => {
    // The deterministic bridge has no native listener resources to release.
  };

  const bridge = {
    openText: (path) => {
      const resolvedPath = path ?? "/tmp/opened-from-e2e.tex";
      const source = "\\\\draw (9,9)--(10,10); % desktop-opened";
      linkedFiles.set(resolvedPath, { source, revision: linkedRevisionForText(source) });
      return Promise.resolve({
        source,
        path: resolvedPath,
        name: resolvedPath.split("/").pop() ?? "opened-from-e2e.tex"
      });
    },
    saveText: ({ text, suggestedName, path, forceSaveAs }) => {
      const computedPath = forceSaveAs || !path
        ? `/tmp/${(suggestedName ?? "tikz-document").replace(/[^A-Za-z0-9_.-]/g, "_")}`
        : path;
      writes.push({ text, path: computedPath, forceSaveAs });
      return Promise.resolve({
        ok: true,
        path: computedPath,
        name: computedPath.split("/").pop() ?? "tikz-document.tex"
      });
    },
    readLinkedText: (filePath) => {
      const entry = linkedFiles.get(filePath);
      if (!entry) return Promise.resolve({ status: "missing" as const });
      return Promise.resolve({
        status: "ok" as const,
        source: entry.source,
        revision: entry.revision,
        fileRef: linkedFileRefForPath(filePath)
      });
    },
    writeLinkedText: ({ path: filePath, text }) => {
      const revision = linkedRevisionForText(text);
      linkedFiles.set(filePath, { source: text, revision });
      writes.push({ text, path: filePath, forceSaveAs: false });
      return Promise.resolve({
        status: "saved" as const,
        revision,
        fileRef: linkedFileRefForPath(filePath)
      });
    },
    exportFile: ({ fileName, mimeType, bytesBase64 }) => {
      exports.push(fileName);
      exportPayloads.push({ fileName, mimeType, bytesBase64 });
      return Promise.resolve(true);
    },
    readClipboard: () => Promise.resolve(""),
    writeClipboard: () => Promise.resolve(),
    readCustomClipboardText: () => Promise.resolve(null),
    readCustomClipboardBytes: () => Promise.resolve(null),
    writeClipboardBundle: () => Promise.resolve(),
    setWindowTitle: (title) => {
      e2eWindow.__DESKTOP_E2E_TITLE__ = title;
      windowTitles.push(title);
      return Promise.resolve();
    },
    setTheme: () => Promise.resolve(),
    closeWindow: () => {
      e2eWindow.__DESKTOP_E2E_CLOSED__ = true;
      return Promise.resolve();
    },
    confirmUnsavedChanges: (message) => {
      unsavedPrompts.push(message);
      return Promise.resolve(unsavedDecisions.shift() ?? "cancel");
    },
    showAboutPanel: () => Promise.resolve(),
    openExternalUrl: () => Promise.resolve(true),
    listRecentFiles: () => Promise.resolve([]),
    clearRecentFiles: () => {
      clearRecentCalls.push(Date.now());
      return Promise.resolve();
    },
    takePendingOpenRequests: () => Promise.resolve([]),
    takePendingOpenFailures: () => Promise.resolve([]),
    onPendingOpenRequestsChanged: () => Promise.resolve(noOp),
    onWindowCloseRequest: () => Promise.resolve(noOp),
    showContextMenu: () => Promise.resolve(),
    onContextMenuCommand: () => Promise.resolve(noOp),
    checkLatexAvailable: () => Promise.resolve({ available: true, details: "desktop e2e mock" }),
    compileTikz: () => Promise.resolve("<svg />"),
    readLastCompileLog: () => Promise.resolve("")
  } satisfies DesktopBridge;

  e2eWindow.__DESKTOP_E2E_WRITES__ = writes;
  e2eWindow.__DESKTOP_E2E_EXPORTS__ = exports;
  e2eWindow.__DESKTOP_E2E_EXPORT_PAYLOADS__ = exportPayloads;
  e2eWindow.__DESKTOP_E2E_CLEAR_RECENT_CALLS__ = clearRecentCalls;
  e2eWindow.__DESKTOP_E2E_WINDOW_TITLES__ = windowTitles;
  e2eWindow.__DESKTOP_E2E_UNSAVED_DECISIONS__ = unsavedDecisions;
  e2eWindow.__DESKTOP_E2E_UNSAVED_PROMPTS__ = unsavedPrompts;
  e2eWindow.__DESKTOP_E2E_CLOSED__ = false;
  e2eWindow.__TIKZ_EDITOR_DESKTOP_TEST_API__.setBridgeOverride(bridge);
}
