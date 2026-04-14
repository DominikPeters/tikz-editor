/** @vitest-environment jsdom */

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { makeEmptySnapshot } from "../../packages/app/src/compute";
import { EditorStoreProvider, defaultEditorStore } from "../../packages/app/src/store/store";
import { makeInitialState } from "../../packages/app/src/store/reducer";
import { StylesPanel } from "../../packages/app/src/ui/StylesPanel";
import { renderTikzToSvg } from "../../packages/core/src/render";

export function seedStylesPanelState(source: string, selectedSourceIds: string[]): void {
  const rendered = renderTikzToSvg(source, { parse: { recover: true } });
  const activeFigureId = rendered.parse.activeFigureId;
  const snapshot = {
    ...makeEmptySnapshot(source),
    source,
    activeFigureId,
    figures: rendered.parse.figures,
    editHandles: rendered.semantic.editHandles,
    scene: rendered.semantic.scene,
    parseResult: rendered.parse,
    semanticResult: rendered.semantic,
    svg: rendered.svg,
    svgModel: rendered.svg.model
  };

  const base = makeInitialState();
  const dispatch = defaultEditorStore.getState().dispatch;
  const activeDocumentId = base.activeDocumentId;
  const doc = base.documents[activeDocumentId]!;
  const selected = new Set(selectedSourceIds);

  defaultEditorStore.setState({
    ...base,
    source,
    sourceRevision: 1,
    activeFigureId,
    snapshot,
    selectedElementIds: selected,
    documents: {
      ...base.documents,
      [activeDocumentId]: {
        ...doc,
        source,
        sourceRevision: 1,
        activeFigureId,
        snapshot,
        selectedElementIds: selected,
        history: [],
        historyIndex: -1,
        lastEditPatches: null,
        lastEditChangedSourceIds: null,
        lastEditWarningMessage: null,
        dirty: true
      }
    },
    dispatch
  }, true);
}

export async function mountStylesPanel(): Promise<{ container: HTMLDivElement; root: Root }> {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(
        EditorStoreProvider,
        { store: defaultEditorStore },
        React.createElement(StylesPanel)
      )
    );
  });
  return { container, root };
}

export async function unmountStylesPanel(root: Root, container: HTMLDivElement): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  document.querySelectorAll(".menuFixed").forEach((entry) => entry.remove());
}

export async function commitEditableInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.focus();
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.blur();
  });
}

export async function clickButton(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
  });
}

export async function clickAndTypeRawValue(
  button: HTMLButtonElement,
  previousValue: string,
  value: string
): Promise<void> {
  await act(async () => {
    button.click();
  });
  const input = Array.from(document.querySelectorAll('input[type="text"]'))
    .find((entry) => (entry as HTMLInputElement).value === previousValue) as HTMLInputElement | undefined;
  if (!input) {
    throw new Error("Expected raw value input");
  }
  await commitEditableInput(input, value);
}
