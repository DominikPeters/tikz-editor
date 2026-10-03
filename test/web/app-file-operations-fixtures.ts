import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import type { EditorPlatform } from "../../packages/app/src/platform/types";

const appCallbacks = vi.hoisted(() => ({ current: {} as {
  onRequestSaveDocument: (documentId: string, mode: "save" | "save-as") => void;
  onRequestCloseDocument: (documentId: string) => void;
  onRequestCloseAllDocuments: () => void;
} }));
export { appCallbacks };

// Keep the real App file orchestration, store, and reducer. Child UI and the
// unrelated render scheduler are removed to isolate asynchronous file I/O.
vi.mock("../../packages/app/src/ui/editor-command-runtime", () => ({
  useEditorCommandRuntime: (callbacks: typeof appCallbacks.current) => {
    appCallbacks.current = callbacks;
    return { bindings: {}, runCommand: vi.fn() };
  }
}));
vi.mock("../../packages/app/src/ui/compute-scheduler", () => ({
  createSingleFlightScheduler: () => ({ schedule: vi.fn(), invalidate: vi.fn(), dispose: vi.fn() })
}));
vi.mock("../../packages/app/src/ui/useDeferredPropertyCleanup", () => ({ useDeferredPropertyCleanup: () => {} }));
vi.mock("../../packages/app/src/ui/AppMenuBar", () => ({ AppMenuBar: () => null }));
vi.mock("../../packages/app/src/ui/Toolbar", () => ({ Toolbar: () => null }));
vi.mock("../../packages/app/src/ui/TabStrip", () => ({ TabStrip: () => null }));
vi.mock("../../packages/app/src/ui/DockLayout", () => ({ DockLayout: () => null }));
vi.mock("../../packages/app/src/ui/StatusBar", () => ({ StatusBar: () => null }));
vi.mock("../../packages/app/src/ui/DevPanel", () => ({ DevPanel: () => null }));

vi.mock("../../packages/app/src/ui/FileConflictModal", () => ({
  FileConflictModal: ({ documentTitle, onChoose }: {
    documentTitle: string; onChoose: (decision: "cancel" | "reload" | "save-anyway" | "save-as") => void
  }) => React.createElement("div", { "data-testid": "test-file-conflict" }, documentTitle,
    ...(["cancel", "reload", "save-anyway", "save-as"] as const).map((decision) =>
      React.createElement("button", { key: decision, "data-testid": `test-conflict-${decision}`,
        onClick: () => { onChoose(decision); } }, decision)))
}));

import { App } from "../../packages/app/src/ui/App";
import { useEditorStore } from "../../packages/app/src/store/store";
import { makeInitialState } from "../../packages/app/src/store/reducer";
import { setActiveEditorPlatform } from "../../packages/app/src/platform/current";

let root: Root | null = null;

export async function mountFileApp(platform: EditorPlatform, source: string): Promise<string> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.matchMedia = globalThis.matchMedia;
  setActiveEditorPlatform(platform);
  useEditorStore.setState(makeInitialState());
  useEditorStore.getState().dispatch({ type: "CODE_EDITED", source });
  const container = document.createElement("div");
  container.dataset.testFileApp = "true";
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(React.createElement(App)); });
  return useEditorStore.getState().activeDocumentId;
}

export async function unmountFileApp(): Promise<void> {
  await act(async () => { root?.unmount(); });
  root = null;
  document.querySelector("[data-test-file-app]")?.remove();
  window.dispatchEvent(new Event("pagehide"));
  vi.unstubAllGlobals();
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail; });
  return { promise, resolve, reject };
}

export const memoryPersistence = { load: () => null, save: () => {} };
