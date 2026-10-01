/** @vitest-environment jsdom */
import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { buildBeamerObjectIndex, prepareBeamerDocument, type BeamerObjectIndex, type BeamerObjectNode } from "../../packages/core/src/beamer/index";
import { APP_MENU_COMMAND_IDS as IDS } from "../../packages/app/src/app-menu";
import { makeInitialState } from "../../packages/app/src/store/reducer";
import { useEditorStore } from "../../packages/app/src/store/store";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../../packages/app/src/platform/current";
import type { EditorPlatform } from "../../packages/app/src/platform/types";
import { useDeckOverlayContextMenu } from "../../packages/app/src/ui/canvas-panel/useDeckOverlayContextMenu";
import { BuildsPanel } from "../../packages/app/src/ui/builds-panel/BuildsPanel";
import type { CommandBindings } from "../../packages/app/src/ui/editor-command-runtime";

vi.mock("../../packages/app/src/ui/DockLayout", () => ({ getDockLayoutHandle: () => null }));
const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Test}
\begin{block}{Facts}Content\end{block}
\begin{itemize}\item Alpha\item Beta\end{itemize}
\end{frame}
\end{document}`;
let host: HTMLDivElement;
let root: Root;
let index: BeamerObjectIndex;
let node: BeamerObjectNode;
let originalPlatform: EditorPlatform;
let showNative: ReturnType<typeof vi.fn>;
const bindings = Object.fromEntries(Object.values(IDS).map((id) => [id, { enabled: true, run: () => {} }])) as unknown as CommandBindings;

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useEditorStore((s) => s.deckStepByRootKey[`${s.activeDocumentId}::frame:0`] ?? 1);
  const menu = useDeckOverlayContextMenu({ index, selected: node,
    frame: { frameId: "frame:0", step, viewBox: { x: 0, y: 0, width: 300, height: 200 } },
    viewportRef: ref, svgRef: { current: null }, bindings, closeText: () => {}, editObject: () => {} });
  return React.createElement("div", { ref, tabIndex: 0 },
    React.createElement("button", { onClick: () => { menu.openForObject(node, 20, 20); } }, "Open"),
    menu.menu, React.createElement(BuildsPanel));
}
function click(id: string) {
  const button = document.querySelector<HTMLButtonElement>(`[data-testid="canvas-context-cmd-${id}"]`)!;
  expect(button).not.toBeNull();
  act(() => { button.click(); });
}
function open() { act(() => { host.querySelector<HTMLButtonElement>("button")!.click(); }); }
async function setup(source = SOURCE, native = false) {
  const state = useEditorStore.getState();
  state.dispatch({ type: "CODE_EDITED", source });
  state.dispatch({ type: "SET_ACTIVE_ROOT", rootId: "frame:0" });
  const page = await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: 1 });
  index = buildBeamerObjectIndex({ ...page.layout, source });
  node = index.nodes.find((candidate) => candidate.kind === "block")!;
  const current = useEditorStore.getState();
  const snapshot = { ...current.snapshot, source };
  useEditorStore.setState({ snapshot, documents: { ...current.documents, [current.activeDocumentId]: { ...current.documents[current.activeDocumentId], snapshot } } });
  if (native) setActiveEditorPlatform({ ...originalPlatform, menu: { usesNativeContextMenus: true, showNativeContextMenu: showNative } });
  act(() => { root.render(React.createElement(Harness)); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  originalPlatform = getActiveEditorPlatform();
  showNative = vi.fn(async () => {});
  useEditorStore.setState(makeInitialState());
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => { root.unmount(); }); host.remove();
  setActiveEditorPlatform(originalPlatform); vi.unstubAllGlobals();
});

describe("canvas Overlays menu", () => {
  it("adds a next-step reveal, selects its panel row, and records one undo entry", async () => {
    await setup(); open();
    expect(document.body.textContent).toContain("Appear on next step (2)");
    const length = useEditorStore.getState().history.length;
    click(IDS.OVERLAY_NEXT);
    const state = useEditorStore.getState();
    expect(state.source).toBe(SOURCE.replace("\\begin{block}", "\\begin{block}<2->"));
    expect(state.history.length).toBe(length + 1);
    expect(state.deckBuildSelection?.step).toBe(2);
    expect(host.querySelector('[data-selected="true"]')?.textContent).toContain("Facts");
    act(() => { state.dispatch({ type: "UNDO" }); });
    expect(useEditorStore.getState().source).toBe(SOURCE);
  });
  it("selects an existing rule in the panel", async () => {
    await setup(SOURCE.replace("\\begin{block}", "\\begin{block}<1->")); open();
    click(IDS.OVERLAY_EDIT);
    expect(host.querySelector<HTMLInputElement>('[aria-label="Overlay steps"]')?.value).toBe("1-");
  });
  it("removes only the object's rule", async () => {
    await setup(SOURCE.replace("\\begin{block}", "\\begin{block}<1->")); open(); click(IDS.OVERLAY_REMOVE);
    expect(useEditorStore.getState().source).toBe(SOURCE);
  });
  it("invalidates the menu after source edits", async () => {
    await setup(); open();
    act(() => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: SOURCE + "\n% newer" }); });
    expect(document.querySelector('[data-testid="canvas-context-menu"]')).toBeNull();
  });
  it("supports opening and navigating the submenu with the keyboard", async () => {
    await setup(); open();
    const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-haspopup="menu"]')).find((entry) => entry.textContent?.includes("Overlays"))!;
    act(() => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(document.activeElement?.textContent).toContain("Appear on next step");
    act(() => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(document.activeElement?.textContent).toBe("Show from step 1");
    act(() => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector('[data-testid="canvas-context-menu"]')).toBeNull();
  });
  it("uses the same commands for native context menus", async () => {
    await setup(SOURCE, true); open();
    const payload = showNative.mock.calls[0][0];
    expect(payload.items.at(-1).label).toBe("Overlays");
    act(() => { payload.onCommandRun(IDS.OVERLAY_ONLY, "context-menu"); });
    expect(useEditorStore.getState().source).toContain("\\begin{block}<1>");
  });
  it("rejects stale native menu callbacks", async () => {
    await setup(SOURCE, true); open();
    const payload = showNative.mock.calls[0][0];
    const updated = SOURCE + "\n% newer";
    act(() => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: updated }); payload.onCommandRun(IDS.OVERLAY_NEXT, "context-menu"); });
    expect(useEditorStore.getState().source).toBe(updated);
  });
});
