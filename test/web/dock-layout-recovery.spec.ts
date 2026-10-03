/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { IJsonModel, TabNode } from "flexlayout-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveEditorPlatform } from "../../packages/app/src/platform/current";
import { useEditorStore } from "../../packages/app/src/store/store";
import { makeInitialState } from "../../packages/app/src/store/reducer";
import { loadUserWorkspaces } from "../../packages/app/src/store/workspace-storage";

const visual = vi.hoisted(() => ({ factory: null as null | ((node: TabNode) => React.ReactNode) }));
// Exercise the real dock model, persistence, and store while omitting unrelated panel UI.
vi.mock("../../packages/app/src/ui/source-panel/SourcePanel", () => ({ SourcePanel: () => null }));
vi.mock("../../packages/app/src/ui/canvas-panel/CanvasPanel", () => ({ CanvasPanel: () => null }));
vi.mock("../../packages/app/src/ui/FigureNavigator", () => ({ FigureNavigator: () => null }));
vi.mock("../../packages/app/src/ui/inspector-panel/InspectorPanel", () => ({ InspectorPanel: () => null }));
vi.mock("../../packages/app/src/ui/inspector-panel/DeckInspectorPanel", () => ({ DeckInspectorPanel: () => null }));
vi.mock("../../packages/app/src/ui/builds-panel/BuildsPanel", () => ({ BuildsPanel: () => null }));
vi.mock("../../packages/app/src/ui/objects-panel/ObjectsPanel", () => ({ ObjectsPanel: () => null }));
vi.mock("../../packages/app/src/ui/StylesPanel", () => ({ StylesPanel: () => null }));
vi.mock("../../packages/app/src/ui/AssistantPanel", () => ({ AssistantPanel: () => null }));
vi.mock("flexlayout-react", async importOriginal => ({
  ...await importOriginal<typeof import("flexlayout-react")>(),
  Layout: ({ factory }: { factory: (node: TabNode) => React.ReactNode }) => { visual.factory = factory; return null; }
}));
import { DockLayout, getDockLayoutHandle, LAYOUT_PRESETS } from "../../packages/app/src/ui/DockLayout";

const DOCK_KEY = "tikz-editor:dock-layout";
const USER_WORKSPACES_KEY = "tikz-editor:user-workspaces";
const malformedLayouts = [
  ["string root children", { layout: { type: "row", children: "invalid" } }],
  ["nested object children", { layout: { type: "row", children: [{ type: "row", children: {} }] } }],
  ["null nested node", { layout: { type: "row", children: [null] } }],
  ["non-array tabset children", { layout: { type: "row", children: [{ type: "tabset", children: true }] } }],
  ["null root", { layout: null }],
  ["malformed border children", { layout: { type: "row", children: [] }, borders: [{ location: "left", children: "invalid" }] }],
  ["malformed popout children", { layout: { type: "row", children: [] }, popouts: { popout: { layout: { type: "row", children: false }, rect: { x: 0, y: 0, width: 400, height: 300 } } } }]
] as const;

describe("dock layout recovery", () => {
  let root: Root | null;
  let storage: Map<string, string>;
  let originalStore: ReturnType<typeof useEditorStore.getState>;

  async function mount() {
    root = createRoot(document.createElement("div"));
    await act(async () => { root!.render(React.createElement(DockLayout, {
      repeatPreviewModel: null, onSubmitPrompt: async () => {}, onInterruptTurn: async () => {}, onNewChat() {}
    })); });
  }

  beforeEach(() => {
    root = null;
    originalStore = useEditorStore.getState();
    useEditorStore.setState(makeInitialState());
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(console, "info").mockImplementation(() => {});
    storage = new Map();
    setActiveEditorPlatform({ id: "dock-recovery-test", persistence: {
      load: key => storage.get(key) ?? null,
      save: (key, value) => { storage.set(key, value); }
    } });
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    useEditorStore.setState(originalStore);
    visual.factory = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(malformedLayouts)("mounts and replaces persisted %s with the default layout", async (_name, json) => {
    storage.set(DOCK_KEY, JSON.stringify(json));
    await mount();
    expect(getDockLayoutHandle()!.getModel().getNodeById("canvas")).toBeTruthy();
    expect(useEditorStore.getState().showSourcePanel).toBe(true);
    const recovered = storage.get(DOCK_KEY);
    expect(recovered).not.toBe(JSON.stringify(json));
    await act(async () => { root!.unmount(); });
    root = null;
    await mount();
    expect(getDockLayoutHandle()!.getModel().getNodeById("source")).toBeTruthy();
    expect(storage.get(DOCK_KEY)).toBe(recovered);
  });

  it("guards model parser failures after recursive validation", async () => {
    const duplicate = LAYOUT_PRESETS.default();
    duplicate.layout.children[1].id = duplicate.layout.children[0].id;
    storage.set(DOCK_KEY, JSON.stringify(duplicate));
    await mount();
    expect(getDockLayoutHandle()!.getModel().getNodeById("canvas")).toBeTruthy();
    expect(getDockLayoutHandle()!.getModel().getNodeById("canvas-tabset")).toBeTruthy();
    expect(JSON.parse(storage.get(DOCK_KEY)!).layout.children[1].id).toBe("canvas-tabset");
  });

  it("keeps valid persisted layout bytes while mounting the selected layout", async () => {
    const json = LAYOUT_PRESETS.canvasOnly();
    const raw = JSON.stringify({ ...json, futureMetadata: { enabled: true } });
    storage.set(DOCK_KEY, raw);
    await mount();
    expect(useEditorStore.getState().showSourcePanel).toBe(false);
    expect(getDockLayoutHandle()!.getModel().getNodeById("canvas")).toBeTruthy();
    expect(storage.get(DOCK_KEY)).toBe(raw);
  });

  it("recovers malformed user-workspace apply and persists the recovered model", async () => {
    storage.set(DOCK_KEY, JSON.stringify(LAYOUT_PRESETS.canvasOnly()));
    await mount();
    expect(useEditorStore.getState().showSourcePanel).toBe(false);
    await act(async () => { getDockLayoutHandle()!.applyLayoutJson({
      layout: { type: "row", children: [{ type: "tabset", children: "invalid" }] }
    } as unknown as IJsonModel); });
    expect(useEditorStore.getState().showSourcePanel).toBe(true);
    expect(getDockLayoutHandle()!.getModel().getNodeById("canvas")).toBeTruthy();
    expect(storage.get(DOCK_KEY)).toBe(JSON.stringify(getDockLayoutHandle()!.getCurrentJson()));
  });

  it("preserves valid layouts and their unknown panel fallback when applying a saved workspace", async () => {
    const json = LAYOUT_PRESETS.canvasOnly();
    json.layout.children.push({ type: "tabset", id: "future-tabset", weight: 35,
      children: [{ type: "tab", id: "future-panel", name: "Future", component: "future-component" }] });
    storage.set(USER_WORKSPACES_KEY, JSON.stringify({ version: 1, items: [
      { id: "bad", name: "Bad", json: malformedLayouts[0][1], createdAt: 1 },
      { id: "good", name: "Good", json, createdAt: 2 }
    ] }));
    await mount();
    const workspaces = loadUserWorkspaces();
    expect(workspaces.map(item => item.id)).toEqual(["good"]);
    await act(async () => { getDockLayoutHandle()!.applyLayoutJson(workspaces[0].json); });
    const handle = getDockLayoutHandle()!;
    expect(handle.getModel().getNodeById("future-tabset")!.getId()).toBe("future-tabset");
    expect(useEditorStore.getState().showSourcePanel).toBe(false);
    const panel = handle.getModel().getNodeById("future-panel") as TabNode;
    const host = document.createElement("div"), panelRoot = createRoot(host);
    try {
      await act(async () => { panelRoot.render(visual.factory!(panel)); });
      expect(host.textContent).toBe("Unknown panel: future-component");
    } finally { await act(async () => { panelRoot.unmount(); }); }
  });

  it("still mounts a default layout when persistence reads and recovery writes are denied", async () => {
    const save = vi.fn(() => { throw new DOMException("Denied", "SecurityError"); });
    setActiveEditorPlatform({ id: "denied-storage", persistence: {
      load() { throw new DOMException("Denied", "SecurityError"); }, save
    } });
    await mount();
    expect(getDockLayoutHandle()!.getModel().getNodeById("canvas")).toBeTruthy();
    expect(save).toHaveBeenCalledWith(DOCK_KEY, expect.any(String));
    expect(storage.size).toBe(0);
  });
});
