/** @vitest-environment jsdom */

import { requireDocumentSession } from "../../packages/app/src/store/document-sessions.js";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appCallbacks, tabCallbacks, deferred, mountAssistantApp, unmountAssistantApp } from "./assistant-session-fixtures";
import { createDesktopPlatformAdapter, type DesktopBridge } from "../../apps/desktop/src/platform/desktop-platform";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../../packages/app/src/platform/current";
import { useEditorStore } from "../../packages/app/src/store/store";
import { loadWorkspaceSeed, saveWorkspace } from "../../packages/app/src/store/workspace-storage";
import { makeInitialState } from "../../packages/app/src/store/reducer";
import type { AssistantEvent, AssistantThreadSummary } from "../../packages/app/src/platform/types";

vi.mock("../../apps/desktop/src/platform/native-menu", () => ({ createNativeDesktopMenuManager: () => ({ sync: async () => {}, refreshRecents: () => {} }), serializeDesktopContextMenuItems: () => [] }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {} })
}));

const previousPlatform = getActiveEditorPlatform();
const previousState = useEditorStore.getState();
afterEach(async () => {
  await unmountAssistantApp();
  setActiveEditorPlatform(previousPlatform);
  useEditorStore.setState(previousState, true);
  vi.restoreAllMocks();
});
const source = String.raw`\begin{tikzpicture}\draw(0,0)--(1,0);\end{tikzpicture}`;
const summary = (generation: number): AssistantThreadSummary => ({ threadId: `thread-${generation}`,
  workspacePath: `/owned/${generation}`, figurePath: `/owned/${generation}/figure.tex`, previewPath: `/owned/${generation}/current.png` });

async function mount(overrides: Partial<DesktopBridge> = {}) {
  let emit: ((event: AssistantEvent) => void) | undefined;
  const reset = vi.fn(async () => {});
  const ensure = vi.fn(async (params: { sessionGeneration?: number }) => summary(params.sessionGeneration ?? 0));
  const start = vi.fn(async () => ({ turnId: "turn" }));
  const values = new Map<string, string>();
  const bridge = { onWindowCloseRequest: async () => () => {}, onContextMenuCommand: async () => () => {},
    onPendingOpenRequestsChanged: async () => () => {}, takePendingOpenRequests: async () => [], takePendingOpenFailures: async () => [],
    listRecentFiles: async () => [], setWindowTitle: async () => {}, setTheme: async () => {},
    assistantEnsureDocumentThread: ensure, assistantResetDocumentThread: reset, assistantStartTurn: start,
    onAssistantEvent: async (handler: (event: AssistantEvent) => void) => { emit = handler; return () => { emit = undefined; }; },
    ...overrides } as DesktopBridge;
  const platform = createDesktopPlatformAdapter({ bridge, storage: {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }
  } });
  const id = await mountAssistantApp(platform, source);
  return { id, reset, ensure, start, emit: (event: AssistantEvent) => emit?.(event) };
}

describe("App assistant chat lifecycle", () => {
  it("advances ownership through reducer and desktop adapter, then starts with cleared identity", async () => {
    const app = await mount();
    await act(async () => { await appCallbacks.current.onSubmitPrompt("first", null, []); });
    expect(app.ensure).toHaveBeenLastCalledWith(expect.objectContaining({ documentId: app.id, sessionGeneration: 0, threadId: null }));
    await act(async () => { appCallbacks.current.onNewChat(); });
    expect(app.reset).toHaveBeenLastCalledWith({ documentId: app.id, sessionGeneration: 1 });
    const fresh = requireDocumentSession(useEditorStore.getState().documents, app.id);
    expect([fresh.assistantThreadId, fresh.assistantWorkspacePath, fresh.assistantFigurePath, fresh.assistantPreviewPath]).toEqual([null, null, null, null]);
    expect(fresh.assistantItems).toEqual([]);
    expect(fresh.assistantPendingApprovals).toEqual([]);
    await act(async () => { await appCallbacks.current.onSubmitPrompt("new chat", null, []); });
    expect(app.ensure).toHaveBeenLastCalledWith(expect.objectContaining({ sessionGeneration: 1, threadId: null }));
    expect(app.start).toHaveBeenLastCalledWith(expect.objectContaining({ sessionGeneration: 1, threadId: "thread-1" }));
    expect(requireDocumentSession(useEditorStore.getState().documents, app.id).assistantThreadId).toBe("thread-1");
  });

  it("discards an old ensure result without starting a turn or restoring the old thread", async () => {
    const pending = deferred<AssistantThreadSummary>();
    const app = await mount({ assistantEnsureDocumentThread: async () => pending.promise });
    let submitting!: Promise<void>;
    await act(async () => { submitting = appCallbacks.current.onSubmitPrompt("old", null, []); });
    await act(async () => { appCallbacks.current.onNewChat(); });
    await act(async () => { pending.resolve(summary(0)); await submitting; });
    expect(app.start).not.toHaveBeenCalled();
    expect(requireDocumentSession(useEditorStore.getState().documents, app.id).assistantThreadId).toBeNull();
    expect(requireDocumentSession(useEditorStore.getState().documents, app.id).assistantItems).toEqual([]);
  });

  it("retires a closed document and fences off a thread ensure already in flight", async () => {
    const pending = deferred<AssistantThreadSummary>();
    const app = await mount({ assistantEnsureDocumentThread: async () => pending.promise });
    let submitting!: Promise<void>;
    await act(async () => { submitting = appCallbacks.current.onSubmitPrompt("old", null, []); });
    await act(async () => { useEditorStore.getState().dispatch({ type: "CLOSE_DOCUMENT", documentId: app.id }); });
    expect(app.reset).toHaveBeenCalledExactlyOnceWith({ documentId: app.id, sessionGeneration: 1 });
    await act(async () => { pending.resolve(summary(0)); await submitting; });
    expect(app.start).not.toHaveBeenCalled();
    expect(useEditorStore.getState().documents[app.id]).toBeUndefined();
  });

  it("retires every removed document using its current generation when closing all tabs", async () => {
    const app = await mount();
    let secondId!: string;
    await act(async () => {
      useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source });
      secondId = useEditorStore.getState().activeDocumentId;
      useEditorStore.getState().dispatch({ type: "ASSISTANT_NEW_CHAT", documentId: secondId });
      useEditorStore.getState().dispatch({ type: "ASSISTANT_NEW_CHAT", documentId: secondId });
    });
    expect(app.reset).not.toHaveBeenCalled();
    await act(async () => { useEditorStore.getState().dispatch({ type: "CLOSE_ALL_DOCUMENTS" }); });
    expect(app.reset).toHaveBeenCalledTimes(2);
    expect(app.reset).toHaveBeenCalledWith({ documentId: app.id, sessionGeneration: 1 });
    expect(app.reset).toHaveBeenCalledWith({ documentId: secondId, sessionGeneration: 3 });
    expect(useEditorStore.getState().documents[app.id]).toBeUndefined();
    expect(useEditorStore.getState().documents[secondId]).toBeUndefined();
  });

  it("keeps the session when an unsaved close is cancelled or no document was removed", async () => {
    const confirm = vi.fn(async () => "cancel" as const);
    const app = await mount({ confirmUnsavedChanges: confirm });
    await act(async () => { tabCallbacks.current!.onRequestCloseDocument(app.id); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().documents[app.id]).toBeDefined();
    await act(async () => {
      useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: `${source}\n% edited` });
      useEditorStore.getState().dispatch({ type: "CLOSE_DOCUMENT", documentId: "missing" });
    });
    expect(app.reset).not.toHaveBeenCalled();
  });

  it("contains native reset failures while closing a document", async () => {
    const failure = new Error("native reset failed");
    const reset = vi.fn(async () => { throw failure; });
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const app = await mount({ assistantResetDocumentThread: reset });
    await act(async () => { useEditorStore.getState().dispatch({ type: "CLOSE_DOCUMENT", documentId: app.id }); });
    expect(reset).toHaveBeenCalledExactlyOnceWith({ documentId: app.id, sessionGeneration: 1 });
    expect(useEditorStore.getState().documents[app.id]).toBeUndefined();
    expect(log).toHaveBeenCalledWith("[tikz-editor] Closed document assistant cleanup failed.", failure);
  });

  it("unsubscribes on app unmount without resetting restorable sessions", async () => {
    const app = await mount();
    await unmountAssistantApp();
    useEditorStore.getState().dispatch({ type: "CLOSE_DOCUMENT", documentId: app.id });
    expect(app.reset).not.toHaveBeenCalled();
  });

  it("rejects retired events and reducer actions while accepting the current generation", async () => {
    const tool = vi.fn(async () => {});
    const app = await mount({ assistantRespondToDynamicToolCall: tool });
    await act(async () => { appCallbacks.current.onNewChat(); });
    await act(async () => {
      app.emit({ type: "thread-ready", documentId: app.id, sessionGeneration: 0, thread: summary(0) });
      app.emit({ type: "source-updated", documentId: app.id, sessionGeneration: 0, source: "retired", revisionToken: "old" });
      app.emit({ type: "dynamic-tool-call", documentId: app.id, sessionGeneration: 0, requestId: "old-tool", tool: "get_diagnostics" });
      useEditorStore.getState().dispatch({ type: "ASSISTANT_ITEM_STARTED", documentId: app.id, sessionGeneration: 0, item: { id: "retired", type: "agentMessage", text: "old" } });
      useEditorStore.getState().dispatch({ type: "ASSISTANT_SOURCE_UPDATED", sessionGeneration: 0, source: "implicit retired", revisionToken: "old-implicit" });
      // Legacy events are generation zero; they cannot regain ownership after reset.
      app.emit({ type: "item-started", documentId: app.id, item: { id: "legacy", type: "agentMessage", text: "old" } });
      app.emit({ type: "item-started", documentId: app.id, sessionGeneration: 1, item: { id: "current", type: "agentMessage", text: "new" } });
    });
    const doc = requireDocumentSession(useEditorStore.getState().documents, app.id);
    expect(doc.source).toBe(source);
    expect(doc.assistantThreadId).toBeNull();
    expect(doc.assistantItems.map(item => item.id)).toEqual(["current"]);
    expect(tool).not.toHaveBeenCalled();
    await act(async () => { app.emit({ type: "error", message: "Current transport error" }); });
    expect(requireDocumentSession(useEditorStore.getState().documents, app.id).assistantError).toBe("Current transport error");
  });

  it("persists the chat generation and safely restores legacy workspaces at generation zero", async () => {
    const app = await mount();
    await act(async () => { appCallbacks.current.onNewChat(); });
    saveWorkspace(useEditorStore.getState());
    const seed = loadWorkspaceSeed();
    expect(seed?.documents.find(doc => doc.id === app.id)?.assistantSessionGeneration).toBe(1);
    expect(requireDocumentSession(makeInitialState(seed ?? undefined).documents, app.id).assistantSessionGeneration).toBe(1);
    const legacy = makeInitialState({ workspaceVersion: 1, documents: [{ id: "legacy", title: "Legacy", source }],
      tabOrder: ["legacy"], activeDocumentId: "legacy", recentDocumentIds: ["legacy"] });
    expect(requireDocumentSession(legacy.documents, "legacy").assistantSessionGeneration).toBe(0);
  });
});
