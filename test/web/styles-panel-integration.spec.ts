/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../../packages/app/src/settings/useSettingsStore";
import { useEditorStore } from "../../packages/app/src/store/store";
import { renderTikzToSvg } from "../../packages/core/src/render";
import {
  clickAndTypeRawValue,
  clickButton,
  commitEditableInput,
  mountStylesPanel,
  seedStylesPanelState,
  unmountStylesPanel
} from "./styles-panel-test-helpers";

vi.mock("../../packages/app/src/edit-analysis-manager", () => ({
  getSharedEditAnalysisView: () => ({ kind: "test-analysis" }),
  getSharedEditAnalysisSession: () => null
}));

vi.mock("../../packages/app/src/colors/project-named-colors", () => ({
  useProjectNamedColorSwatches: () => []
}));

function firstElementIds(source: string, kind: "Path" | "Text", count: number): string[] {
  const rendered = renderTikzToSvg(source, { parse: { recover: true } });
  const ids = rendered.semantic.scene.elements
    .filter((entry) => entry.kind === kind)
    .slice(0, count)
    .map((entry) => entry.sourceRef.sourceId);
  if (ids.length !== count) {
    throw new Error(`Expected ${count} ${kind} ids, got ${ids.length}`);
  }
  return ids;
}

function firstPathIds(source: string, count: number): string[] {
  return firstElementIds(source, "Path", count);
}

function firstTextIds(source: string, count: number): string[] {
  return firstElementIds(source, "Text", count);
}

function getToggleOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('input[type="checkbox"][aria-label^="Toggle "]'))
    .map((input) => (input as HTMLInputElement).getAttribute("aria-label") ?? "")
    .map((label) => label.replace(/^Toggle\s+/u, "").trim());
}

describe("StylesPanel integration", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        editor: {
          ...state.settings.editor,
          indentSize: 2
        }
      }
    }));
  });

  afterEach(() => {
    document.querySelectorAll(".menuFixed").forEach((entry) => entry.remove());
  });

  it("updates source when renaming a flag key", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fooflag,draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

      const { container, root } = await mountStylesPanel();
    try {
      const keyInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[aria-label="Property name"]'));
      const flagInput = keyInputs.find((entry) => entry.value === "fooflag");
      expect(flagInput).toBeDefined();

      await commitEditableInput(flagInput!, "barflag");

      const updatedSource = useEditorStore.getState().source;
      expect(updatedSource).toContain("barflag");
      expect(updatedSource).not.toContain("fooflag");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("updates source when deleting an option", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const deleteButton = container.querySelector<HTMLButtonElement>('button[aria-label="Delete draw"]');
      expect(deleteButton).not.toBeNull();

      await clickButton(deleteButton!);

      const updatedSource = useEditorStore.getState().source;
      expect(updatedSource).not.toContain("draw=red");
      expect(updatedSource).toContain("line width=1pt");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("toggles a declaration off by commenting it out", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const toggle = container.querySelector<HTMLInputElement>('input[aria-label="Toggle draw"]');
      expect(toggle).not.toBeNull();
      expect(toggle?.checked).toBe(true);

      await act(async () => {
        toggle!.click();
      });

      const updatedSource = useEditorStore.getState().source;
      expect(updatedSource).toContain("% draw=red,");
      expect(updatedSource).toContain("line width=1pt");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("toggles a disabled declaration back on", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[
    % draw=red,
    line width=1pt
  ] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const toggle = container.querySelector<HTMLInputElement>('input[aria-label="Toggle draw"]');
      expect(toggle).not.toBeNull();
      expect(toggle?.checked).toBe(false);

      await act(async () => {
        toggle!.click();
      });

      const updatedSource = useEditorStore.getState().source;
      expect(updatedSource).toContain("draw=red");
      expect(updatedSource).not.toContain("% draw=red,");
      expect(updatedSource).toContain("line width=1pt");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("toggles declarations in named-style layers (non-bracketed option sites)", async () => {
    const source = String.raw`\begin{tikzpicture}[accent/.style={draw=red,fill=blue}]
  \draw[accent] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const toggle = container.querySelector<HTMLInputElement>('input[aria-label="Toggle draw"]');
      expect(toggle).not.toBeNull();

      await act(async () => {
        toggle!.click();
      });

      const updatedSource = useEditorStore.getState().source;
      expect(updatedSource).toContain("% draw=red,");
      expect(updatedSource).toContain("fill=blue");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("toggles fill in every-node style layers", async () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \node (A) at (-1, -1) {A};
\end{tikzpicture}`;
    const [textId] = firstTextIds(source, 1);
    seedStylesPanelState(source, [textId]);

    const { container, root } = await mountStylesPanel();
    try {
      const fillToggles = Array.from(container.querySelectorAll<HTMLInputElement>('input[aria-label="Toggle fill"]'));
      expect(fillToggles.length).toBeGreaterThan(0);
      const activeFillToggle = fillToggles.find((entry) => entry.checked) ?? null;
      expect(activeFillToggle).not.toBeNull();

      await act(async () => {
        activeFillToggle!.click();
      });

      const updatedSource = useEditorStore.getState().source;
      expect(updatedSource).toContain("every node/.style={");
      expect(updatedSource).toContain("% fill=blue!10,");
      expect(updatedSource).toContain("every node/.style={\n  % fill=blue!10,\n}");
      expect(updatedSource).toContain("% fill=blue!10,\n}");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("re-enables fill in every-node style layers after disabling", async () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \node[draw] (A) at (-1, -1) {A};
\end{tikzpicture}`;
    const [textId] = firstTextIds(source, 1);
    seedStylesPanelState(source, [textId]);

    const { container, root } = await mountStylesPanel();
    try {
      const fillTogglesBefore = Array.from(container.querySelectorAll<HTMLInputElement>('input[aria-label="Toggle fill"]'));
      const activeFillToggle = fillTogglesBefore.find((entry) => entry.checked) ?? null;
      expect(activeFillToggle).not.toBeNull();

      await act(async () => {
        activeFillToggle!.click();
      });

      const toggledOffSource = useEditorStore.getState().source;
      expect(toggledOffSource).toContain("every node/.style={");
      expect(toggledOffSource).toContain("% fill=blue!10,");
      await act(async () => {
        seedStylesPanelState(toggledOffSource, [textId]);
      });

      const fillTogglesAfter = Array.from(container.querySelectorAll<HTMLInputElement>('input[aria-label="Toggle fill"]'));
      const disabledFillToggle = fillTogglesAfter.find((entry) => !entry.checked) ?? null;
      expect(disabledFillToggle).not.toBeNull();

      await act(async () => {
        disabledFillToggle!.click();
      });

      const reenabledSource = useEditorStore.getState().source;
      expect(reenabledSource).toContain("every node/.style={");
      expect(reenabledSource).toContain("fill=blue!10");
      expect(reenabledSource).not.toContain("% fill=blue!10,");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("uses editor indent setting when reflowing toggled options", async () => {
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        editor: {
          ...state.settings.editor,
          indentSize: 4
        }
      }
    }));

    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \node[draw] (A) at (-1, -1) {A};
\end{tikzpicture}`;
    const [textId] = firstTextIds(source, 1);
    seedStylesPanelState(source, [textId]);

    const { container, root } = await mountStylesPanel();
    try {
      const fillToggles = Array.from(container.querySelectorAll<HTMLInputElement>('input[aria-label="Toggle fill"]'));
      const activeFillToggle = fillToggles.find((entry) => entry.checked) ?? null;
      expect(activeFillToggle).not.toBeNull();

      await act(async () => {
        activeFillToggle!.click();
      });

      const updatedSource = useEditorStore.getState().source;
      expect(updatedSource).toContain("every node/.style={\n    % fill=blue!10,\n}");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("keeps declaration order stable after toggling a middle property", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red,rounded corners,line width=1pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const orderBefore = getToggleOrder(container);
      const drawIndex = orderBefore.indexOf("draw");
      const roundedIndex = orderBefore.indexOf("rounded corners");
      const lineWidthIndex = orderBefore.indexOf("line width");
      expect(drawIndex).toBeGreaterThanOrEqual(0);
      expect(roundedIndex).toBeGreaterThan(drawIndex);
      expect(lineWidthIndex).toBeGreaterThan(roundedIndex);

      const toggle = container.querySelector<HTMLInputElement>('input[aria-label="Toggle rounded corners"]');
      expect(toggle).not.toBeNull();
      await act(async () => {
        toggle!.click();
      });

      const orderAfterDisable = getToggleOrder(container);
      expect(orderAfterDisable).toEqual(orderBefore);

      const updatedSource = useEditorStore.getState().source;
      expect(updatedSource).toContain("% rounded corners,");
      expect(updatedSource).toContain("draw=red");
      expect(updatedSource).toContain("line width=1pt");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("toggles a flag declaration for rectangle paths", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw,rounded corners,line width=1pt] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const toggle = container.querySelector<HTMLInputElement>('input[aria-label="Toggle draw"]');
      expect(toggle).not.toBeNull();
      await act(async () => {
        toggle!.click();
      });

      const updatedSource = useEditorStore.getState().source;
      expect(updatedSource).toContain("% draw,");
      expect(updatedSource).toContain("rounded corners");
      expect(updatedSource).toContain("line width=1pt");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("toggles node declarations when a text element is selected", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,rounded corners,font=\small] at (0,0) {A};
\end{tikzpicture}`;
    const [textId] = firstTextIds(source, 1);
    seedStylesPanelState(source, [textId]);

    const { container, root } = await mountStylesPanel();
    try {
      const toggle = container.querySelector<HTMLInputElement>('input[aria-label="Toggle rounded corners"]');
      expect(toggle).not.toBeNull();
      await act(async () => {
        toggle!.click();
      });

      const updatedSource = useEditorStore.getState().source;
      expect(updatedSource).toContain("% rounded corners,");
      expect(updatedSource).toContain("draw,");
      expect(updatedSource).toContain("font=\\small");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("keeps a commented-only node property visible so it can be re-enabled", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw=red] at (-0.2,3) {node};
\end{tikzpicture}`;
    const [textId] = firstTextIds(source, 1);
    seedStylesPanelState(source, [textId]);

    const { container, root } = await mountStylesPanel();
    try {
      const toggleBefore = container.querySelector<HTMLInputElement>('input[aria-label="Toggle draw"]');
      expect(toggleBefore).not.toBeNull();
      expect(toggleBefore?.checked).toBe(true);

      await act(async () => {
        toggleBefore!.click();
      });

      const toggledOffSource = useEditorStore.getState().source;
      expect(toggledOffSource).toContain("% draw=red,");
      await act(async () => {
        seedStylesPanelState(toggledOffSource, [textId]);
      });

      const drawTogglesAfter = Array.from(container.querySelectorAll<HTMLInputElement>('input[aria-label="Toggle draw"]'));
      expect(drawTogglesAfter.length).toBeGreaterThan(0);
      const disabledToggle = drawTogglesAfter.find((entry) => !entry.checked) ?? null;
      expect(disabledToggle).not.toBeNull();

      await act(async () => {
        disabledToggle!.click();
      });

      const reenabledSource = useEditorStore.getState().source;
      expect(reenabledSource).toContain("draw=red");
      expect(reenabledSource).not.toContain("% draw=red,");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("updates raw unsupported option values", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[foo=bar,draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const valueButton = Array.from(container.querySelectorAll("button"))
        .find((entry) => entry.textContent?.trim() === "bar");
      expect(valueButton).toBeDefined();

      await clickAndTypeRawValue(valueButton!, "bar", "baz");
      const updated = useEditorStore.getState().source;
      expect(updated).toContain("foo=baz");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("adds known template properties with default values", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const addButton = Array.from(container.querySelectorAll("button"))
        .find((entry) => entry.textContent?.trim() === "+");
      expect(addButton).toBeDefined();
      await clickButton(addButton!);

      const newPropInput = container.querySelector<HTMLInputElement>('input[aria-label="New property name"]');
      expect(newPropInput).not.toBeNull();
      await commitEditableInput(newPropInput!, "line width");

      const updated = useEditorStore.getState().source;
      expect(updated).toContain("line width=");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("adds unknown properties as flags", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=red] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const addButton = Array.from(container.querySelectorAll("button"))
        .find((entry) => entry.textContent?.trim() === "+");
      expect(addButton).toBeDefined();
      await clickButton(addButton!);

      const newPropInput = container.querySelector<HTMLInputElement>('input[aria-label="New property name"]');
      expect(newPropInput).not.toBeNull();
      await commitEditableInput(newPropInput!, "foobarflag");

      const updated = useEditorStore.getState().source;
      expect(updated).toContain("foobarflag");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("updates displayed raw values on external source refresh", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[foo=bar,help lines] (0,0) -- (1,0);
\end{tikzpicture}`;
    const [pathId] = firstPathIds(source, 1);
    seedStylesPanelState(source, [pathId]);

    const { container, root } = await mountStylesPanel();
    try {
      const barBefore = Array.from(container.querySelectorAll("button"))
        .find((entry) => entry.textContent?.trim() === "bar");
      expect(barBefore).toBeDefined();

      const refreshedSource = String.raw`\begin{tikzpicture}
  \draw[foo=baz,help lines] (0,0) -- (1,0);
\end{tikzpicture}`;
      await act(async () => {
        seedStylesPanelState(refreshedSource, [pathId]);
      });

      const barAfter = Array.from(container.querySelectorAll("button"))
        .find((entry) => entry.textContent?.trim() === "baz");
      expect(barAfter).toBeDefined();
      expect(useEditorStore.getState().source).toContain("foo=baz");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });

  it("applies shared-cascade edits across multi-selection", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fooflag,draw=red] (0,0) -- (1,0);
  \draw[fooflag,draw=red] (0,1) -- (1,1);
\end{tikzpicture}`;
    const pathIds = firstPathIds(source, 2);
    seedStylesPanelState(source, pathIds);

    const { container, root } = await mountStylesPanel();
    try {
      const keyInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[aria-label="Property name"]'));
      const flagInput = keyInputs.find((entry) => entry.value === "fooflag");
      expect(flagInput).toBeDefined();

      await commitEditableInput(flagInput!, "barflag");

      const updatedSource = useEditorStore.getState().source;
      expect((updatedSource.match(/barflag/g) ?? []).length).toBe(2);
      expect(updatedSource).not.toContain("fooflag");
    } finally {
      await unmountStylesPanel(root, container);
    }
  });
});
