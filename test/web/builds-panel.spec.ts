/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeInitialState } from "../../packages/app/src/store/reducer";
import { useEditorStore } from "../../packages/app/src/store/store";
import { BuildsPanel } from "../../packages/app/src/ui/builds-panel/BuildsPanel";

vi.mock("../../packages/app/src/ui/DockLayout", () => ({ getDockLayoutHandle: () => null }));

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Test}
\only<2->{Target}
\begin{itemize}[<+->]
\item Alpha
\item Beta
\end{itemize}
\end{frame}
\begin{frame}{Other}Unchanged.\end{frame}
\end{document}`;

let host: HTMLDivElement;
let root: Root;
function button(text: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find((element) => element.textContent?.trim() === text);
  expect(found, text).toBeDefined();
  return found!;
}
function selectTarget(): void {
  const target = Array.from(host.querySelectorAll("button")).find((element) => element.textContent?.startsWith("Text · Target"));
  act(() => { target!.click(); });
}
function inputValue(value: string): void {
  const input = host.querySelector<HTMLInputElement>('[aria-label="Build steps"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useEditorStore.setState(makeInitialState());
  useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: SOURCE });
  useEditorStore.getState().dispatch({ type: "SET_ACTIVE_ROOT", rootId: "frame:0" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => { root.render(React.createElement(BuildsPanel)); });
});
afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});

describe("Builds panel", () => {
  it("lists invisible content, selects its source, and previews without source changes", () => {
    expect(host.querySelectorAll('[data-testid="build-row"]')).toHaveLength(4);
    selectTarget();
    const selected = useEditorStore.getState().deckBuildSelection!;
    expect(SOURCE.slice(selected.sourceSpan.from, selected.sourceSpan.to)).toBe(String.raw`\only<2->{Target}`);
    expect(selected.contentSpans).toEqual([]);
    act(() => { button("Preview on step 2").click(); });
    expect(useEditorStore.getState().deckBuildSelection?.step).toBe(2);
    expect(useEditorStore.getState().deckBuildSelection?.contentSpans).toHaveLength(1);
    expect(useEditorStore.getState().source).toBe(SOURCE);
  });

  it("commits a minimal spec edit, with undo and redo", () => {
    selectTarget();
    inputValue("3-5");
    act(() => { button("Apply").click(); });
    expect(useEditorStore.getState().source).toBe(SOURCE.replace("<2->", "<3-5>"));
    act(() => { useEditorStore.getState().dispatch({ type: "UNDO" }); });
    expect(useEditorStore.getState().source).toBe(SOURCE);
    act(() => { useEditorStore.getState().dispatch({ type: "REDO" }); });
    expect(useEditorStore.getState().source).toBe(SOURCE.replace("<2->", "<3-5>"));
  });

  it("rejects invalid edits and keeps relative defaults in source", () => {
    selectTarget();
    inputValue("4-2");
    expect(button("Apply").disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("positive steps");
    const inherited = Array.from(host.querySelectorAll("button")).find((element) => element.textContent?.startsWith("Bullet · Beta"))!;
    act(() => { inherited.click(); });
    expect(host.querySelector('[aria-label="Build steps"]')).toBeNull();
    expect(host.textContent).toContain("Inherited from the list default");
    expect(host.textContent).toContain("Resolved");
    act(() => { button("Edit rule in source").click(); });
    const selected = useEditorStore.getState().deckBuildSelection!;
    expect(SOURCE.slice(selected.sourceSpan.from, selected.sourceSpan.to)).toBe("<+->");
    expect(selected.revealSource).toBe(true);
    expect(useEditorStore.getState().source).toBe(SOURCE);
  });

  it("reconciles source edits and cancels stale drafts", () => {
    selectTarget();
    inputValue("9-");
    act(() => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: SOURCE.replace("{Target}", "{Renamed}") }); });
    expect(host.querySelector<HTMLInputElement>('[aria-label="Build steps"]')?.value).toBe("2-");
    expect(host.querySelector('[data-selected="true"]')?.textContent).toContain("Renamed");
    expect(useEditorStore.getState().deckBuildSelection?.sourceRevision).toBe(useEditorStore.getState().sourceRevision);
  });

  it("does not retain a build selection on another frame or document", () => {
    selectTarget();
    act(() => { useEditorStore.getState().dispatch({ type: "SET_ACTIVE_ROOT", rootId: "frame:1" }); });
    expect(host.textContent).toContain("no overlay rules");
    expect(useEditorStore.getState().deckBuildSelection).toBeNull();
    act(() => { useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT" }); });
    expect(host.textContent).toContain("Open a Beamer slide");
    expect(useEditorStore.getState().deckBuildSelection).toBeNull();
  });

  it("bounds the timeline for large step numbers", () => {
    act(() => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: SOURCE.replace("<2->", "<1000000->") }); });
    expect(host.querySelectorAll("thead button")).toHaveLength(4);
    selectTarget();
    act(() => { button("Preview on step 1000000").click(); });
    expect(host.querySelectorAll("thead button")).toHaveLength(4);
    expect(useEditorStore.getState().source).toContain("<1000000->");
  });

  it("yields selection to canvas editing and does not reclaim it on source changes", () => {
    selectTarget();
    act(() => { useEditorStore.getState().dispatch({ type: "SET_DECK_OBJECT_SELECTION", frameId: "frame:0", objectId: "block:1" }); });
    expect(host.querySelector('[data-selected="true"]')).toBeNull();
    act(() => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: SOURCE.replace("Target", "Renamed") }); });
    expect(useEditorStore.getState().deckBuildSelection).toBeNull();
    expect(useEditorStore.getState().deckObjectSelection?.objectId).toBe("block:1");
  });

  it("clears a build selection when the canvas background is selected", () => {
    selectTarget();
    act(() => { useEditorStore.getState().dispatch({ type: "SET_DECK_OBJECT_SELECTION", frameId: "frame:0", objectId: null }); });
    expect(host.querySelector('[data-selected="true"]')).toBeNull();
    expect(useEditorStore.getState().deckBuildSelection).toBeNull();
  });
});
