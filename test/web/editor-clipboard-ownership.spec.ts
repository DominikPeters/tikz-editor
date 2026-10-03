/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index";
import { computeSnapshot, makeEmptySnapshot } from "../../packages/app/src/compute";
import { editorReducer, makeInitialState } from "../../packages/app/src/store/reducer";
import { useEditorStore } from "../../packages/app/src/store/store";
import type { EditorAction } from "../../packages/app/src/store/types";
import type { EditorPlatform } from "../../packages/app/src/platform/types";
import { setActiveEditorPlatform } from "../../packages/app/src/platform/current";
import { APP_MENU_COMMAND_IDS } from "../../packages/app/src/app-menu";
import { createEditorCommandRuntime } from "../../packages/app/src/ui/editor-command-runtime";
import { pasteSelectionFromSystemClipboard } from "../../packages/app/src/ui/editor-commands";
import { useCanvasKeyboardClipboard } from "../../packages/app/src/ui/canvas-panel/useCanvasKeyboardClipboard";
import * as imports from "../../packages/app/src/ui/svg-import";
import { formatDocumentRootId } from "../../packages/core/src/document/root-id";

const BASE = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0);
\end{tikzpicture}`;
const OTHER = String.raw`\begin{tikzpicture}
\draw (20,20) circle (2);
\end{tikzpicture}`;
const SNIPPET = String.raw`\draw[red] (3,3) -- (4,4);`;
const PAYLOAD = JSON.stringify({ version: 1, snippets: [SNIPPET], pasteBehavior: "preserve", pasteCount: 0 });
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M0 0 L10 10" stroke="red" fill="none"/></svg>';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("clipboard operation ownership", () => {
  let root: Root;
  let api: ReturnType<typeof useCanvasKeyboardClipboard>;
  let platform: EditorPlatform;
  let initialStore: ReturnType<typeof useEditorStore.getState>;
  const warning = vi.fn();
  const state = () => useEditorStore.getState();
  const dispatch = (action: EditorAction) => act(() => { useEditorStore.setState(editorReducer(state(), action)); });

  function ready() {
    const current = state();
    const rendered = renderTikzToSvg(current.source, { parse: { activeFigureId: current.activeRootId ?? undefined } });
    dispatch({ type: "COMPUTE_REQUESTED", requestId: "clipboard-ready" });
    dispatch({ type: "SNAPSHOT_READY", requestId: "clipboard-ready", snapshot: {
      ...makeEmptySnapshot(current.source), parseResult: rendered.parse, semanticResult: rendered.semantic,
      activeRootId: rendered.parse.activeFigureId, figures: rendered.parse.figures,
      scene: rendered.semantic.scene, editHandles: rendered.semantic.editHandles, svg: rendered.svg
    } });
    expect(state().documents[state().activeDocumentId].editingIdentities?.entries.length).toBeGreaterThan(0);
    expect(state().documents[state().activeDocumentId].editingTargetsStale).toBe(false);
  }

  function Harness() {
    const current = useEditorStore();
    api = useCanvasKeyboardClipboard({
      contextMenuState: null, toolMode: "select", textEditingSession: null,
      setContextMenuState: vi.fn(), finalizePathDraft: vi.fn(), undoTransientCanvasStep: () => false,
      setWarning: warning, setFreehandDraft: vi.fn(), dragRef: { current: null }, setDragState: vi.fn(), dispatch,
      setToolCursorWorld: vi.fn(), setSnapLines: vi.fn(), setToolDraft: vi.fn(), setBezierBendDraft: vi.fn(),
      setPendingBezier: vi.fn(), closeTextEditingSession: vi.fn(), setMarqueeDraft: vi.fn(), selectedElementIds: current.selectedElementIds,
      applyActionWithFeedback: vi.fn(), source: current.source, snapshot: current.snapshot,
      logSnapDebug: vi.fn(), NUDGE_STEP_PT: 1, NUDGE_STEP_SHIFT_PT: 10, platform,
      DESKTOP_TIKZ_CLIPBOARD_FORMATS: ["tikz"], DESKTOP_SVG_CLIPBOARD_FORMATS: ["svg"],
      DESKTOP_KEYNOTE_CLIPBOARD_FORMATS: ["keynote"], DESKTOP_POWERPOINT_GVML_CLIPBOARD_FORMATS: ["powerpoint"],
      computeAutoScaleForImportedTikz: () => null
    });
    return null;
  }

  function runtime() {
    const current = state();
    const doc = current.documents[current.activeDocumentId];
    return createEditorCommandRuntime({ ...current, historyLength: current.history.length, tabCount: current.tabOrder.length,
      fileRef: doc.fileRef, dirty: doc.dirty, snapHapticsEnabled: true, dispatch, updateCanvasSettings() {}, assistantAvailable: false });
  }

  function pasteData(files: File[] = []) {
    return { files, items: [], types: files.length ? ["Files"] : [], getData: () => "" } as unknown as DataTransfer;
  }
  function beginNativePaste(dataTransfer = pasteData()) {
    act(() => { api.onViewportPaste({ target: document.body, defaultPrevented: false, preventDefault() {}, clipboardData: dataTransfer } as never); });
  }
  function switchToOther() {
    dispatch({ type: "NEW_DOCUMENT", source: OTHER });
    ready();
  }
  async function renderHarness() {
    await act(async () => { root.render(React.createElement(Harness)); });
  }

  beforeEach(async () => {
    initialStore = state();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => {} } });
    platform = { id: "clipboard-test", persistence: { load: () => null, save() {} } };
    setActiveEditorPlatform(platform);
    useEditorStore.setState({ ...makeInitialState(), dispatch });
    dispatch({ type: "CODE_EDITED", source: BASE });
    ready();
    warning.mockClear();
    root = createRoot(document.createElement("div"));
    await renderHarness();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    useEditorStore.setState(initialStore, true);
    setActiveEditorPlatform({ id: "test-default", persistence: { load: () => null, save() {} } });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("pastes on the unchanged originating canvas and records one undoable edit", async () => {
    const read = deferred<{ format: string; text: string }>();
    platform.clipboard = { readCustomText: () => read.promise };
    await renderHarness();
    const historyIndex = state().historyIndex;
    beginNativePaste();
    await act(async () => read.resolve({ format: "tikz", text: PAYLOAD }));
    expect(state().source).toContain(SNIPPET);
    expect(state().historyIndex).toBe(historyIndex + 1);
    dispatch({ type: "UNDO" });
    expect(state().source).toBe(BASE);
    expect(warning).not.toHaveBeenCalled();
  });

  it("cancels a native paste after switching to another ready tab", async () => {
    const read = deferred<{ format: string; text: string }>();
    platform.clipboard = { readCustomText: () => read.promise };
    await renderHarness();
    const origin = state().activeDocumentId;
    beginNativePaste();
    switchToOther();
    await act(async () => read.resolve({ format: "tikz", text: PAYLOAD }));
    expect(state().documents[origin].source).toBe(BASE);
    expect(state().source).toBe(OTHER);
    expect(warning).not.toHaveBeenCalled();
  });

  it("preserves an intervening visual property edit and quietly discards the pending paste", async () => {
    const read = deferred<{ format: string; text: string }>();
    platform.clipboard = { readCustomText: () => read.promise };
    await renderHarness();
    beginNativePaste();
    dispatch({ type: "APPLY_EDIT_ACTION", action: { kind: "setProperty", elementId: "path:0", level: "command", key: "draw", value: "blue" } });
    const changed = state().source;
    expect(changed).toContain(String.raw`\draw[blue]`);
    expect(state().documents[state().activeDocumentId].editingTargetsStale).toBe(false);
    await act(async () => read.resolve({ format: "tikz", text: PAYLOAD }));
    expect(state().source).toBe(changed);
    expect(warning).not.toHaveBeenCalled();
  });

  it("quietly discards a pending paste after a direct source edit", async () => {
    const read = deferred<{ format: string; text: string }>();
    platform.clipboard = { readCustomText: () => read.promise };
    await renderHarness();
    beginNativePaste();
    dispatch({ type: "CODE_EDITED", source: OTHER });
    const warningToken = state().lastEditWarningToken;
    await act(async () => read.resolve({ format: "tikz", text: PAYLOAD }));
    expect(state().source).toBe(OTHER);
    expect(state().lastEditWarningToken).toBe(warningToken);
    expect(warning).not.toHaveBeenCalled();
  });

  it("cancels on a newer revision even if its text equals the original source", async () => {
    const read = deferred<{ format: string; text: string }>();
    platform.clipboard = { readCustomText: () => read.promise };
    await renderHarness();
    const revision = state().sourceRevision;
    beginNativePaste();
    dispatch({ type: "SET_SOURCE_TRANSIENT", source: `${BASE}\n` });
    dispatch({ type: "SET_SOURCE_TRANSIENT", source: BASE });
    ready();
    expect(state().sourceRevision).toBeGreaterThan(revision);
    await act(async () => read.resolve({ format: "tikz", text: PAYLOAD }));
    expect(state().source).toBe(BASE);
    expect(warning).not.toHaveBeenCalled();
  });

  it("cancels when the active picture changes without a source revision change", async () => {
    dispatch({ type: "CODE_EDITED", source: `${BASE}\n${OTHER}` });
    ready();
    const read = deferred<{ format: string; text: string }>();
    platform.clipboard = { readCustomText: () => read.promise };
    await renderHarness();
    const source = state().source;
    const revision = state().sourceRevision;
    beginNativePaste();
    dispatch({ type: "SET_ACTIVE_ROOT", rootId: state().snapshot.figures[1].id });
    ready();
    expect(state().sourceRevision).toBe(revision);
    await act(async () => read.resolve({ format: "tikz", text: PAYLOAD }));
    expect(state().source).toBe(source);
    expect(warning).not.toHaveBeenCalled();
  });

  it.each(["paste", "cut"] as const)("cancels delayed menu %s when its tab is closed", async operation => {
    const read = deferred<string>();
    const write = deferred<void>();
    const writeText = vi.fn(() => write.promise);
    vi.stubGlobal("navigator", { clipboard: { readText: () => read.promise, writeText } });
    if (operation === "cut") dispatch({ type: "SELECT", id: "path:0", additive: false });
    const origin = state().activeDocumentId;
    expect(runtime().runCommand(operation === "paste" ? APP_MENU_COMMAND_IDS.PASTE : APP_MENU_COMMAND_IDS.CUT, "menu")).toBe(true);
    if (operation === "cut") await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    switchToOther();
    dispatch({ type: "CLOSE_DOCUMENT", documentId: origin });
    await act(async () => { read.resolve(SNIPPET); write.resolve(); });
    expect(state().documents[origin]).toBeUndefined();
    expect(state().source).toBe(OTHER);
  });

  it("keeps ordinary menu cut undoable when ownership is unchanged", async () => {
    const write = deferred<void>();
    const writeText = vi.fn(() => write.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    dispatch({ type: "SELECT", id: "path:0", additive: false });
    expect(runtime().runCommand(APP_MENU_COMMAND_IDS.CUT, "menu")).toBe(true);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    await act(async () => write.resolve());
    expect(state().source).not.toContain(String.raw`\draw`);
    dispatch({ type: "UNDO" });
    expect(state().source).toBe(BASE);
  });

  it("returns cancelled for a delayed system read after switching documents", async () => {
    const read = deferred<string>();
    vi.stubGlobal("navigator", { clipboard: { readText: () => read.promise } });
    const current = state();
    const paste = pasteSelectionFromSystemClipboard({
      documentId: current.activeDocumentId, sourceRevision: current.sourceRevision,
      activeRootId: current.activeRootId, source: current.source, snapshotSource: current.snapshot.source,
      scene: current.snapshot.scene, editHandles: current.snapshot.editHandles, selectedElementIds: current.selectedElementIds, dispatch
    });
    switchToOther();
    read.resolve(SNIPPET);
    expect(await paste).toEqual({ kind: "cancelled" });
    expect(state().source).toBe(OTHER);
  });

  it.each([0, 1])("menu paste with empty selection targets active picture %i", async index => {
    const source = `${BASE}\n${OTHER}`;
    dispatch({ type: "CODE_EDITED", source }); ready();
    dispatch({ type: "SET_ACTIVE_ROOT", rootId: state().snapshot.figures[index].id }); ready();
    vi.stubGlobal("navigator", { clipboard: { readText: async () => SNIPPET, writeText: async () => {} } });
    expect(runtime().runCommand(APP_MENU_COMMAND_IDS.PASTE, "menu")).toBe(true);
    await vi.waitFor(() => expect(state().source).toContain(String.raw`\draw[red]`));
    const rendered = renderTikzToSvg(state().source, { parse: { activeFigureId: state().activeRootId } });
    const selected = rendered.semantic.scene.elements.filter(element => element.sourceRef.sourceId.startsWith("path:"));
    expect(selected).toHaveLength(2);
    const pictures = rendered.parse.figures;
    expect(state().source.slice(pictures[1 - index].span.from, pictures[1 - index].span.to)).toBe(index ? BASE : OTHER);
    expect(state().selectedElementIds.size).toBe(1);
  });

  it("pastes only in the selected nested Beamer picture and preserves its surrounding deck", async () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{First}
` + BASE + String.raw`
\end{frame}
\begin{frame}{Second}
` + OTHER + String.raw`
\end{frame}
\end{document}`;
    dispatch({ type: "CODE_EDITED", source });
    const nestedRoot = formatDocumentRootId({ kind: "beamer-frame-tikz", frameIndex: 1, index: 0 });
    dispatch({ type: "SET_ACTIVE_ROOT", rootId: nestedRoot });
    const response = await computeSnapshot({ id: "nested-ready", documentId: state().activeDocumentId,
      source, sourceRevision: state().sourceRevision, activeRootId: nestedRoot });
    dispatch({ type: "COMPUTE_REQUESTED", requestId: response.id });
    dispatch({ type: "SNAPSHOT_READY", requestId: response.id, snapshot: response.snapshot });
    expect(state().activeRootId).toBe(nestedRoot);
    expect(state().snapshot.parseResult).not.toBeNull();
    vi.stubGlobal("navigator", { clipboard: { readText: async () => SNIPPET, writeText: async () => {} } });
    expect(runtime().runCommand(APP_MENU_COMMAND_IDS.PASTE, "menu")).toBe(true);
    await vi.waitFor(() => expect(state().source).toContain(String.raw`\draw[red]`));
    expect(state().source.slice(0, source.indexOf(OTHER))).toBe(source.slice(0, source.indexOf(OTHER)));
    expect(state().source.endsWith(String.raw`\end{frame}
\end{document}`)).toBe(true);
    expect(state().source.indexOf(String.raw`\draw[red]`)).toBeGreaterThan(state().source.indexOf(String.raw`\begin{frame}{Second}`));
    dispatch({ type: "UNDO" }); expect(state().source).toBe(source);
  });

  it.each(["paste", "drop"] as const)("cancels SVG file %s after a tab switch", async operation => {
    const text = deferred<string>();
    const file = { type: "image/svg+xml", name: "shape.svg", text: () => text.promise } as File;
    const data = pasteData([file]);
    const origin = state().activeDocumentId;
    act(() => {
      if (operation === "paste") api.onViewportPaste({ target: document.body, defaultPrevented: false, preventDefault() {}, clipboardData: data } as never);
      else api.onViewportDrop({ preventDefault() {}, stopPropagation() {}, dataTransfer: data } as never);
    });
    switchToOther();
    await act(async () => text.resolve(SVG));
    expect(state().documents[origin].source).toBe(BASE);
    expect(state().source).toBe(OTHER);
    expect(warning).not.toHaveBeenCalled();
  });

  it("imports an SVG file normally when the owning document remains unchanged", async () => {
    beginNativePaste(pasteData([{ type: "image/svg+xml", name: "shape.svg", text: async () => SVG } as File]));
    await vi.waitFor(() => expect(state().source).toContain(String.raw`\begin{scope}`));
    expect(state().source).toContain(String.raw`\draw (0,0) -- (1,0);`);
    expect(warning).not.toHaveBeenCalled();
  });

  it.each([true, false])("handles rejected file reads (obsolete=%s) without unhandled rejections", async obsolete => {
    const text = deferred<string>();
    beginNativePaste(pasteData([{ type: "image/svg+xml", name: "shape.svg", text: () => text.promise } as File]));
    if (obsolete) switchToOther();
    await act(async () => text.reject(new Error("file unavailable")));
    expect(warning.mock.calls).toEqual(obsolete ? [] : [["SVG import failed: file unavailable"]]);
    expect(state().source).toBe(obsolete ? OTHER : BASE);
  });

  it.each(["SVG", "Keynote", "PowerPoint"] as const)("cancels after a delayed %s conversion", async format => {
    const converted = deferred<imports.SvgScopeSnippetResult>();
    const method = format === "SVG" ? "convertSvgToScopeSnippet" : format === "Keynote" ? "convertKeynoteClipboardToScopeSnippet" : "convertPowerPointClipboardToScopeSnippet";
    const convert = vi.spyOn(imports, method).mockImplementation(() => converted.promise);
    platform.clipboard = {
      readCustomText: async formats => formats[0].toLowerCase() === format.toLowerCase() ? { format: formats[0], text: SVG } : null,
      readCustomBytes: async () => format === "PowerPoint" ? { format: "powerpoint", bytesBase64: "AA==" } : null
    };
    await renderHarness();
    beginNativePaste();
    await vi.waitFor(() => expect(convert).toHaveBeenCalled());
    switchToOther();
    await act(async () => converted.resolve({ kind: "success", tikzSource: SNIPPET, body: SNIPPET, snippet: SNIPPET }));
    expect(state().source).toBe(OTHER);
    expect(warning).not.toHaveBeenCalled();
  });
});
