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
function inputKey(key: string): void {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Build steps"]')!;
  act(() => {
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}
function pointer(type: string, x: number, pointerId = 1): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}
function beginDrag(): void {
  selectTarget();
  act(() => { host.querySelector<HTMLButtonElement>('[data-boundary="start"]')!.dispatchEvent(pointer("pointerdown", 100)); });
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
  it("sets timing from a cell's context menu and undoes one source patch", () => {
    const cell = host.querySelector<HTMLButtonElement>('[aria-label="Text · Target, step 1: Absent"]')!;
    act(() => { cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 })); });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Show from step 1");
    const only = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((entry) => entry.textContent === "Only on step 1")!;
    act(() => { only.click(); });
    expect(useEditorStore.getState().source).toBe(SOURCE.replace("<2->", "<1>"));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    act(() => { useEditorStore.getState().dispatch({ type: "UNDO" }); });
    expect(useEditorStore.getState().source).toBe(SOURCE);
  });

  it("dismisses stale timing menus after source changes", () => {
    selectTarget();
    act(() => { host.querySelector<HTMLButtonElement>('[aria-label="Timing actions"]')!.click(); });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    act(() => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: SOURCE.replace("Target", "Renamed") }); });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(useEditorStore.getState().source).toContain("Renamed");
  });

  it("previews boundary drags in source, commits once, and uses the release position", () => {
    const historyLength = useEditorStore.getState().history.length;
    beginDrag();
    act(() => { window.dispatchEvent(pointer("pointermove", 124)); });
    expect(useEditorStore.getState().source).toBe(SOURCE.replace("<2->", "<3->"));
    expect(useEditorStore.getState().history.length).toBe(historyLength);
    act(() => { window.dispatchEvent(pointer("pointerup", 148)); });
    expect(useEditorStore.getState().source).toBe(SOURCE.replace("<2->", "<4->"));
    expect(useEditorStore.getState().history.length).toBe(historyLength + 1);
    act(() => { useEditorStore.getState().dispatch({ type: "UNDO" }); });
    expect(useEditorStore.getState().source).toBe(SOURCE);
    act(() => { useEditorStore.getState().dispatch({ type: "REDO" }); });
    expect(useEditorStore.getState().source).toBe(SOURCE.replace("<2->", "<4->"));
  });

  it.each(["Escape", "pointercancel", "blur"])("cancels boundary drags on %s without creating history", (reason) => {
    const historyLength = useEditorStore.getState().history.length;
    beginDrag();
    act(() => { window.dispatchEvent(pointer("pointermove", 148)); });
    act(() => {
      window.dispatchEvent(reason === "Escape" ? new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        : reason === "pointercancel" ? pointer("pointercancel", 148) : new Event("blur"));
    });
    expect(useEditorStore.getState().source).toBe(SOURCE);
    expect(useEditorStore.getState().history.length).toBe(historyLength);
    expect(useEditorStore.getState().activeInspectorEditDocumentId).toBeNull();
    act(() => { window.dispatchEvent(pointer("pointerup", 172)); });
    expect(useEditorStore.getState().source).toBe(SOURCE);
  });

  it("does not overwrite an external edit during a boundary drag", () => {
    beginDrag();
    act(() => { window.dispatchEvent(pointer("pointermove", 124)); });
    const external = useEditorStore.getState().source.replace("Target", "Renamed");
    act(() => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: external }); });
    act(() => { window.dispatchEvent(pointer("pointerup", 148)); });
    expect(useEditorStore.getState().source).toBe(external);
  });

  it("restores a transient edit when switching documents", () => {
    const documentId = useEditorStore.getState().activeDocumentId;
    beginDrag();
    act(() => { window.dispatchEvent(pointer("pointermove", 124)); });
    act(() => { useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT" }); });
    expect(useEditorStore.getState().documents[documentId].source).toBe(SOURCE);
    expect(useEditorStore.getState().activeDocumentId).not.toBe(documentId);
  });

  it("supports keyboard boundary edits and preserves handle focus", () => {
    selectTarget();
    act(() => { host.querySelector<HTMLButtonElement>('[data-boundary="start"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(useEditorStore.getState().source).toBe(SOURCE.replace("<2->", "<3->"));
    expect((document.activeElement as HTMLElement).dataset.boundary).toBe("start");
  });

  it("opens, navigates, and dismisses a timing menu with the keyboard", () => {
    const cell = host.querySelector<HTMLButtonElement>('[aria-label="Text · Target, step 1: Absent"]')!;
    act(() => { cell.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true })); });
    expect(document.activeElement?.textContent).toBe("Show from step 1");
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(document.activeElement?.textContent).toBe("Only on step 1");
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(cell);
    expect(useEditorStore.getState().source).toBe(SOURCE);
  });

  it("lists invisible content, selects its source, and previews without source changes", () => {
    expect(host.querySelectorAll('[data-testid="build-row"]')).toHaveLength(4);
    selectTarget();
    const selected = useEditorStore.getState().deckBuildSelection!;
    expect(SOURCE.slice(selected.sourceSpan.from, selected.sourceSpan.to)).toBe(String.raw`\only<2->{Target}`);
    expect(selected.contentSpans).toEqual([]);
    act(() => { host.querySelector<HTMLButtonElement>('[aria-label="Preview step 2"]')!.click(); });
    expect(useEditorStore.getState().deckBuildSelection?.step).toBe(2);
    expect(useEditorStore.getState().deckBuildSelection?.contentSpans).toHaveLength(1);
    expect(useEditorStore.getState().source).toBe(SOURCE);
  });

  it("commits a minimal spec edit, with undo and redo", () => {
    selectTarget();
    inputValue("3-5");
    inputKey("Enter");
    expect(useEditorStore.getState().source).toBe(SOURCE.replace("<2->", "<3-5>"));
    act(() => { useEditorStore.getState().dispatch({ type: "UNDO" }); });
    expect(useEditorStore.getState().source).toBe(SOURCE);
    act(() => { useEditorStore.getState().dispatch({ type: "REDO" }); });
    expect(useEditorStore.getState().source).toBe(SOURCE.replace("<2->", "<3-5>"));
  });

  it("rejects invalid edits and keeps relative defaults in source", () => {
    selectTarget();
    inputValue("4-2");
    inputKey("Enter");
    expect(useEditorStore.getState().source).toBe(SOURCE);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Use steps or ranges");
    const inherited = Array.from(host.querySelectorAll("button")).find((element) => element.textContent?.startsWith("Bullet · Beta"))!;
    act(() => { inherited.click(); });
    expect(host.querySelector('input[aria-label="Build steps"]')).toBeNull();
    expect(host.querySelector('output[aria-label="Build steps"]')?.textContent).toBe("2-");
    act(() => { button("Edit in source").click(); });
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
    expect(host.textContent).toContain("No builds on this slide");
    expect(useEditorStore.getState().deckBuildSelection).toBeNull();
    act(() => { useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT" }); });
    expect(host.textContent).toContain("Select a slide");
    expect(useEditorStore.getState().deckBuildSelection).toBeNull();
  });

  it("bounds the timeline for large step numbers", () => {
    act(() => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: SOURCE.replace("<2->", "<1000000->") }); });
    expect(host.querySelectorAll("thead button")).toHaveLength(4);
    selectTarget();
    act(() => { button("Go to step 1000000").click(); });
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

  it("commits on blur and cancels with Escape, like inspector fields", () => {
    selectTarget();
    inputValue("3-");
    act(() => {
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Build steps"]')!;
      input.focus();
      input.blur();
    });
    expect(useEditorStore.getState().source).toBe(SOURCE.replace("<2->", "<3->"));
    inputValue("8-");
    inputKey("Escape");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Build steps"]')!.value).toBe("3-");
    expect(useEditorStore.getState().source).toBe(SOURCE.replace("<2->", "<3->"));
    act(() => { useEditorStore.getState().dispatch({ type: "UNDO" }); });
    expect(useEditorStore.getState().source).toBe(SOURCE);
  });

  it("navigates from an inherited item to its shared default", () => {
    act(() => { button("Bullet · Beta").click(); });
    const owner = host.querySelector<HTMLButtonElement>('section[aria-label="Build rule"] button')!;
    act(() => { owner.click(); });
    expect(host.querySelector('[data-selected="true"]')?.textContent).toContain("List ·");
    expect(host.querySelector('output[aria-label="Build steps"]')?.textContent).toBe("+-");
    expect(useEditorStore.getState().source).toBe(SOURCE);
  });

  it("opens source-only rules directly instead of offering a guessed preview", () => {
    const source = SOURCE.replace(String.raw`\only<2->{Target}`, String.raw`\alert<2>{Target}`);
    act(() => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source }); });
    const row = host.querySelector('[data-testid="build-row"]')!;
    expect(row.querySelectorAll('td[data-state]')).toHaveLength(0);
    act(() => { row.querySelector<HTMLButtonElement>("td button")!.click(); });
    const selected = useEditorStore.getState().deckBuildSelection!;
    expect(selected.revealSource).toBe(true);
    expect(source.slice(selected.sourceSpan.from, selected.sourceSpan.to)).toBe("<2>");
    expect(useEditorStore.getState().source).toBe(source);
  });
});
