/** @vitest-environment jsdom */
import React, { act, useMemo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { scanBeamerDocument } from "../../packages/core/src/beamer/index.js";
import { makeInitialState } from "../../packages/app/src/store/reducer.js";
import { useEditorStore } from "../../packages/app/src/store/store.js";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../../packages/app/src/platform/current.js";
import type { EditorPlatform } from "../../packages/app/src/platform/types.js";
import { useSlideManager } from "../../packages/app/src/ui/slide-manager/useSlideManager.js";
vi.mock("../../packages/app/src/ui/DockLayout", () => ({ getDockLayoutHandle: () => null }));
const source = String.raw`\documentclass{beamer}
\begin{document}
% A note
\begin{frame}{A}First\end{frame}
\begin{frame}{B}Second\end{frame}
\end{document}`;
let root: Root, host: HTMLDivElement, platform: EditorPlatform;
let manager: ReturnType<typeof useSlideManager>;
function Harness() {
  const source = useEditorStore(state => state.source);
  const model = useMemo(() => scanBeamerDocument(source), [source]);
  manager = useSlideManager(model, useRef<HTMLDivElement>(null));
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  platform = getActiveEditorPlatform();
  useEditorStore.setState(makeInitialState());
  useEditorStore.getState().dispatch({ type: "CODE_EDITED", source });
  useEditorStore.getState().dispatch({ type: "SET_ACTIVE_ROOT", rootId: "frame:0" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => { root.render(React.createElement(Harness)); });
});
afterEach(() => {
  act(() => { root.unmount(); }); host.remove(); setActiveEditorPlatform(platform); vi.unstubAllGlobals();
});
it("uses the native clipboard bridge for copy and paste, with one undo entry", async () => {
  let clipboard = "";
  const writeText = vi.fn(async (value: string) => { clipboard = value; });
  const readText = vi.fn(async () => clipboard);
  setActiveEditorPlatform({ ...platform, clipboard: { writeText, readText } });
  await act(async () => { await manager.copy(); });
  expect(writeText).toHaveBeenCalledWith("% A note\n\\begin{frame}{A}First\\end{frame}\n");
  await act(async () => { await manager.paste(); });
  expect(readText).toHaveBeenCalledOnce();
  expect(scanBeamerDocument(useEditorStore.getState().source).frames.map(frame => frame.title?.value)).toEqual(["A", "A", "B"]);
  expect(useEditorStore.getState().history).toHaveLength(1);
  act(() => { useEditorStore.getState().dispatch({ type: "UNDO" }); });
  expect(useEditorStore.getState().source).toBe(source);
});
it.each(["source", "selection", "document"])("discards an asynchronous paste after the %s changes", async change => {
  let resolve!: (text: string) => void;
  setActiveEditorPlatform({ ...platform, clipboard: { readText: () => new Promise<string>(done => { resolve = done; }) } });
  let pending!: Promise<void>;
  act(() => { pending = manager.paste(); });
  act(() => {
    if (change === "source") useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: source + "\n% changed" });
    else if (change === "selection") manager.select("frame:1");
    else useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source });
  });
  const before = useEditorStore.getState().source;
  await act(async () => { resolve("\\begin{frame}{Pasted}X\\end{frame}"); await pending; });
  expect(useEditorStore.getState().source).toBe(before);
});
