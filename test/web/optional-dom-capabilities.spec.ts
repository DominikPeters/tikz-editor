/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { parseTikz } from "../../packages/core/src/parser/index";
import { Modal } from "../../packages/app/src/ui/Modal";
import { RootNavigator } from "../../packages/app/src/ui/RootNavigator";
import { makeInitialState } from "../../packages/app/src/store/reducer";
import { useEditorStore } from "../../packages/app/src/store/store";

vi.mock("../../packages/app/src/ui/useFigureThumbnails", () => ({ useFigureThumbnails: () => new Map<string, string>() }));
afterEach(() => { vi.unstubAllGlobals(); });

it.each(["header", "svg"])("drags a modal from %s when the DOM provider omits pointer capture", (targetTag) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    const modalProps = { variant: "panel" as const, draggable: true, onClose() {},
      children: React.createElement("header", { "data-modal-drag-handle": "true" }, React.createElement("svg")) };
    act(() => { root.render(React.createElement(Modal, modalProps)); });
    const handle = host.querySelector(targetTag);
    const panel = host.querySelector<HTMLDivElement>('[role="dialog"]');
    if (!handle || !panel) throw new Error("Missing modal drag surface");
    Object.defineProperty(panel, "setPointerCapture", { configurable: true, value: undefined });
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    act(() => { handle.dispatchEvent(pointer("pointerdown", 5, 10)); });
    act(() => { window.dispatchEvent(pointer("pointermove", 25, 40)); });
    expect(panel.style.transform).toBe("translate(20px, 30px)");
  } finally { act(() => { root.unmount(); }); }
});

it("renders the active figure when the DOM provider omits scrolling", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const originalState = useEditorStore.getState();
  const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: undefined });
  const state = makeInitialState();
  const source = String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}`;
  const parsed = parseTikz(source);
  const figure = parsed.figures[0];
  if (!figure) throw new Error("Missing parsed figure fixture");
  useEditorStore.setState({ ...state, source, activeRootId: figure.id,
    snapshot: { ...state.snapshot, source, activeRootId: figure.id, figures: parsed.figures } });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => { root.render(React.createElement(RootNavigator)); });
    expect(host.querySelector(`[data-slide-id="${figure.id}"]`)).not.toBeNull();
  } finally {
    act(() => { root.unmount(); });
    useEditorStore.setState(originalState, true);
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});
