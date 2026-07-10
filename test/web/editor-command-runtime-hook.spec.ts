/** @vitest-environment jsdom */

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_MENU_COMMAND_IDS } from "../../packages/app/src/app-menu/index.js";
import type { SessionSnapshot } from "../../packages/app/src/compute.js";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";
import type { CanvasDragKind, EditorAction } from "../../packages/app/src/store/types.js";

type MockEditorStoreState = {
  source: string;
  activeFigureId: string | null;
  sourceRevision: number;
  snapshot: SessionSnapshot;
  toolMode: "select";
  selectedElementIds: ReadonlySet<string>;
  activeHandleId: string | null;
  activeCanvasDragKind: CanvasDragKind | null;
  historyIndex: number;
  history: unknown[];
  activeDocumentId: string;
  tabOrder: string[];
  documents: Record<string, { dirty: boolean; fileRef: null }>;
  fitToContentModeActive: boolean;
  showGrid: boolean;
  showTransparencyGrid: boolean;
  snapModes: { grid: boolean; guides: boolean; points: boolean; gaps: boolean };
  showRulers: boolean;
  showGuides: boolean;
  showDocumentBounds: boolean;
  showSourcePanel: boolean;
  showInspectorPanel: boolean;
  showObjectsPanel: boolean;
  showStylesPanel: boolean;
  showFiguresPanel: boolean;
  showAssistantPanel: boolean;
  rightSidebarTab: "inspector";
  showDevPanel: boolean;
  dispatch: (action: EditorAction) => void;
};

const mocks = vi.hoisted(() => ({
  editorState: {} as MockEditorStoreState,
  dispatch: vi.fn<(action: EditorAction) => void>(),
  updateCanvasSettings: vi.fn()
}));

vi.mock("../../packages/app/src/store/store", () => ({
  useEditorStore: (selector: (state: MockEditorStoreState) => unknown) => selector(mocks.editorState)
}));

vi.mock("../../packages/app/src/settings/useSettingsStore", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({
    settings: {
      canvas: { snapHapticsEnabled: true },
      editor: { indentSize: 2 }
    },
    updateCanvasSettings: mocks.updateCanvasSettings
  })
}));

vi.mock("../../packages/app/src/platform/current", () => ({
  getActiveEditorPlatform: () => ({
    id: "test-platform",
    persistence: {
      load: () => null,
      save: () => undefined
    }
  })
}));

vi.mock("svg2tikz", () => ({
  svgToTikz: vi.fn()
}));

vi.mock("ipe2tikz", () => ({
  convertIpeToTikz: vi.fn()
}));

import { useEditorCommandRuntime } from "../../packages/app/src/ui/editor-command-runtime.js";

const SOURCE = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

function makeSnapshot(source: string): SessionSnapshot {
  const rendered = renderTikzToSvg(source);
  return {
    source,
    revision: 1,
    figures: rendered.parse.figures,
    activeFigureId: rendered.parse.activeFigureId,
    editHandles: rendered.semantic.editHandles,
    scene: rendered.semantic.scene,
    svg: rendered.svg,
    svgModel: rendered.svg.model,
    parseResult: rendered.parse,
    semanticResult: rendered.semantic,
    incremental: null
  };
}

function RuntimeHarness({ renderToken }: { renderToken: number }) {
  const runtime = useEditorCommandRuntime();
  return React.createElement("output", {
    "data-render-token": renderToken,
    "data-delete-enabled": String(runtime.bindings[APP_MENU_COMMAND_IDS.DELETE].enabled)
  });
}

describe("useEditorCommandRuntime", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const snapshot = makeSnapshot(SOURCE);
    Object.assign(mocks.editorState, {
      source: SOURCE,
      activeFigureId: snapshot.activeFigureId,
      sourceRevision: 1,
      snapshot,
      toolMode: "select",
      selectedElementIds: new Set(["path:0"]),
      activeHandleId: null,
      activeCanvasDragKind: null,
      historyIndex: -1,
      history: [],
      activeDocumentId: "doc-1",
      tabOrder: ["doc-1"],
      documents: { "doc-1": { dirty: false, fileRef: null } },
      fitToContentModeActive: false,
      showGrid: false,
      showTransparencyGrid: false,
      snapModes: { grid: true, guides: true, points: true, gaps: true },
      showRulers: true,
      showGuides: true,
      showDocumentBounds: true,
      showSourcePanel: true,
      showInspectorPanel: true,
      showObjectsPanel: true,
      showStylesPanel: true,
      showFiguresPanel: true,
      showAssistantPanel: false,
      rightSidebarTab: "inspector",
      showDevPanel: false,
      dispatch: mocks.dispatch
    } satisfies MockEditorStoreState);
    mocks.dispatch.mockReset();
    mocks.updateCanvasSettings.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("freezes command inputs during a drag and refreshes them after the drag commits", async () => {
    await render(0);
    expect(deleteEnabled()).toBe(true);

    mocks.editorState.selectedElementIds = new Set();
    mocks.editorState.activeCanvasDragKind = "element";
    await render(1);
    expect(deleteEnabled()).toBe(true);

    mocks.editorState.activeCanvasDragKind = null;
    await render(2);
    expect(deleteEnabled()).toBe(false);

    mocks.editorState.selectedElementIds = new Set(["path:0"]);
    mocks.editorState.activeCanvasDragKind = "element";
    await render(3);
    expect(deleteEnabled()).toBe(false);
  });

  async function render(renderToken: number): Promise<void> {
    await act(async () => {
      root.render(React.createElement(RuntimeHarness, { renderToken }));
    });
  }

  function deleteEnabled(): boolean {
    return container.querySelector("output")?.getAttribute("data-delete-enabled") === "true";
  }
});
