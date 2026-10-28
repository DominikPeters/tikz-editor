/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Orientation, type IJsonModel, type TabNode, type TabSetNode } from "flexlayout-react";
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
import { applyWorkspace, listAllWorkspaces } from "../../packages/app/src/ui/workspace-apply";
import { dockSideOf } from "../../packages/app/src/ui/dock-panel-menus";

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

  it("remembers separate document-kind layouts and keeps a deck layout for nested drawings", async () => {
    await mount();
    const dispatch = useEditorStore.getState().dispatch;
    const tikzId = useEditorStore.getState().activeDocumentId;
    await act(async () => { getDockLayoutHandle()!.togglePanel("source"); });
    expect(useEditorStore.getState().showSourcePanel).toBe(false);
    await act(async () => { dispatch({ type: "NEW_DOCUMENT", source: String.raw`\documentclass{beamer}\begin{document}\begin{frame}Hello\begin{tikzpicture}\end{tikzpicture}\end{frame}\end{document}` }); });
    const beamerId = useEditorStore.getState().activeDocumentId;
    expect(useEditorStore.getState().showSourcePanel).toBe(true);
    expect(getDockLayoutHandle()!.getModel().getNodeById("builds")).toBeTruthy();
    expect(getDockLayoutHandle()!.getModel().getNodeById("figure-navigator")).toBeTruthy();
    await act(async () => { getDockLayoutHandle()!.togglePanel("builds"); });
    const deckModel = getDockLayoutHandle()!.getModel();
    await act(async () => { dispatch({ type: "SET_ACTIVE_ROOT", rootId: "frame:0:tikzpicture:0" }); });
    expect(getDockLayoutHandle()!.getModel()).toBe(deckModel);
    await act(async () => { dispatch({ type: "SWITCH_DOCUMENT", documentId: tikzId }); });
    expect(useEditorStore.getState().showSourcePanel).toBe(false);
    expect(getDockLayoutHandle()!.getModel().getNodeById("builds")).toBeUndefined();
    await act(async () => { dispatch({ type: "SWITCH_DOCUMENT", documentId: beamerId }); });
    expect(useEditorStore.getState().showSourcePanel).toBe(true);
    expect(getDockLayoutHandle()!.getModel().getNodeById("builds")).toBeUndefined();
    expect(storage.has("tikz-editor:dock-layout:beamer")).toBe(true);
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

  it("uses the Beamer default for reset and workspace selection, and reopens panels in their homes", async () => {
    useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source: String.raw`\documentclass{beamer}\begin{document}\begin{frame}Hello\end{frame}\end{document}` });
    await mount();
    function expectDeckLayout() {
      const model = getDockLayoutHandle()!.getModel();
      const slides = model.getNodeById("figure-navigator")!.getParent() as TabSetNode;
      const source = model.getNodeById("source")!.getParent() as TabSetNode;
      const canvas = model.getNodeById("canvas")!.getParent()!;
      expect(dockSideOf(model, slides)).toBe("left");
      expect(dockSideOf(model, source)).toBe("below-canvas");
      expect(source.getParent()).toBe(canvas.getParent());
      expect(source.getParent()!.getOrientation()).toBe(Orientation.VERT);
      expect(source.getParent()!.getChildren()).toEqual([canvas, source]);
      expect(model.getNodeById("builds")).toBeTruthy();
    }
    expectDeckLayout();
    expect(listAllWorkspaces().find(entry => entry.id === "default")!.json).toEqual(LAYOUT_PRESETS.default("beamer"));
    await act(async () => { applyWorkspace("canvasOnly"); applyWorkspace("default"); });
    expectDeckLayout();
    await act(async () => { getDockLayoutHandle()!.applyPreset("canvasOnly"); getDockLayoutHandle()!.resetLayout(); });
    expectDeckLayout();
    for (const panel of ["source", "figure-navigator"]) {
      await act(async () => { getDockLayoutHandle()!.togglePanel(panel); getDockLayoutHandle()!.togglePanel(panel); });
      expectDeckLayout();
    }
    await act(async () => { getDockLayoutHandle()!.togglePanel("notes"); });
    expect((getDockLayoutHandle()!.getModel().getNodeById("source")!.getParent() as TabSetNode).getWeight()).toBe(35);
    expect(useEditorStore.getState()).toMatchObject({ showGrid: false, showRulers: false });
  });

  it("preserves an existing Beamer layout until reset", async () => {
    const raw = JSON.stringify(LAYOUT_PRESETS.default());
    storage.set("tikz-editor:dock-layout:beamer", raw);
    useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source: String.raw`\documentclass{beamer}` });
    await mount();
    const model = getDockLayoutHandle()!.getModel();
    expect(dockSideOf(model, model.getNodeById("source")!.getParent() as TabSetNode)).toBe("left");
    expect(storage.get("tikz-editor:dock-layout:beamer")).toBe(raw);
    await act(async () => { getDockLayoutHandle()!.resetLayout(); });
    expect(getDockLayoutHandle()!.getModel().getNodeById("left-tabset")).toBeTruthy();
  });

  it("reopens source below a canvas with a generated tabset id in a saved Beamer layout", async () => {
    storage.set("tikz-editor:dock-layout:beamer", JSON.stringify({ layout: { type: "row", children: [
      { type: "tabset", children: [{ type: "tab", id: "figure-navigator", component: "figure-navigator", name: "Slides" }] },
      { type: "tabset", children: [{ type: "tab", id: "canvas", component: "canvas", name: "Canvas" }] },
    ] } }));
    useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source: String.raw`\documentclass{beamer}` });
    await mount();
    await act(async () => { getDockLayoutHandle()!.togglePanel("source"); });
    const model = getDockLayoutHandle()!.getModel();
    expect(dockSideOf(model, model.getNodeById("source")!.getParent() as TabSetNode)).toBe("below-canvas");
    expect(model.getNodeById("figure-navigator")).toBeTruthy();
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
