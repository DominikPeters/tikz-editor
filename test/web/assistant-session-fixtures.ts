import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import type { EditorPlatform } from "../../packages/app/src/platform/types";

const appCallbacks = vi.hoisted(() => ({ current: {} as {
  onNewChat: () => void;
  onSubmitPrompt: (prompt: string, model: string | null, attachments: []) => Promise<void>;
} }));
export { appCallbacks };

// Keep App orchestration, store, reducer, and desktop adapter. Capture assistant
// callbacks while excluding unrelated UI and rendering work.
vi.mock("../../packages/app/src/ui/editor-command-runtime", () => ({ useEditorCommandRuntime: () => ({ bindings: {}, runCommand: vi.fn() }) }));
vi.mock("../../packages/app/src/ui/compute-scheduler", () => ({
  createSingleFlightScheduler: () => ({ schedule: vi.fn(), invalidate: vi.fn(), dispose: vi.fn() })
}));
vi.mock("../../packages/app/src/ui/useDeferredPropertyCleanup", () => ({ useDeferredPropertyCleanup: () => {} }));
vi.mock("../../packages/app/src/ui/AppMenuBar", () => ({ AppMenuBar: () => null }));
vi.mock("../../packages/app/src/ui/Toolbar", () => ({ Toolbar: () => null }));
vi.mock("../../packages/app/src/ui/TabStrip", () => ({ TabStrip: () => null }));
vi.mock("../../packages/app/src/ui/DockLayout", () => ({ DockLayout: (callbacks: typeof appCallbacks.current) => { appCallbacks.current = callbacks; return null; } }));
vi.mock("../../packages/app/src/ui/StatusBar", () => ({ StatusBar: () => null }));
vi.mock("../../packages/app/src/ui/DevPanel", () => ({ DevPanel: () => null }));

import { App } from "../../packages/app/src/ui/App";
import { useEditorStore } from "../../packages/app/src/store/store";
import { makeInitialState } from "../../packages/app/src/store/reducer";
import { setActiveEditorPlatform } from "../../packages/app/src/platform/current";

let root: Root | null = null;

export async function mountAssistantApp(platform: EditorPlatform, source: string): Promise<string> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.matchMedia = globalThis.matchMedia;
  setActiveEditorPlatform(platform);
  useEditorStore.setState(makeInitialState());
  useEditorStore.getState().dispatch({ type: "CODE_EDITED", source });
  const container = document.createElement("div");
  container.dataset.testAssistantApp = "true";
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(React.createElement(App)); });
  return useEditorStore.getState().activeDocumentId;
}

export async function unmountAssistantApp(): Promise<void> {
  await act(async () => { root?.unmount(); });
  root = null;
  document.querySelector("[data-test-assistant-app]")?.remove();
  window.dispatchEvent(new Event("pagehide"));
  vi.unstubAllGlobals();
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail; });
  return { promise, resolve, reject };
}
