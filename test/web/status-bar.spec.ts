/** @vitest-environment jsdom */

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasDragKind, EditorAction, ToolMode } from "../../packages/app/src/store/types.js";
import { getModifierKeyLabels } from "../../packages/app/src/ui/key-labels.js";

type MockStatusBarState = {
  snapshot: {
    parseResult: { diagnostics: unknown[] };
    semanticResult: { diagnostics: unknown[] };
    incremental: null;
    scene: { elements: unknown[] };
    figures: unknown[];
  };
  activeFigureId: string | null;
  activeDocumentId: string;
  documents: Record<string, { dirty: boolean }>;
  canvasTransform: { translateX: number; translateY: number; scale: number };
  fitToContentModeActive: boolean;
  showGrid: boolean;
  selectedElementIds: Set<string>;
  pendingRequestId: string | null;
  toolMode: ToolMode;
  activeCanvasDragKind: CanvasDragKind | null;
  activeSourceScrubSourceId: string | null;
  canvasStatusHint: string | null;
  dispatch: (action: EditorAction) => void;
};

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn<(action: EditorAction) => void>();
  const storeState: MockStatusBarState = {
    snapshot: {
      parseResult: { diagnostics: [] },
      semanticResult: { diagnostics: [] },
      incremental: null,
      scene: { elements: [{}, {}] },
      figures: []
    },
    activeFigureId: null,
    activeDocumentId: "doc-1",
    documents: { "doc-1": { dirty: false } },
    canvasTransform: { translateX: 0, translateY: 0, scale: 1 },
    fitToContentModeActive: false,
    showGrid: true,
    selectedElementIds: new Set(),
    pendingRequestId: null,
    toolMode: "select",
    activeCanvasDragKind: null,
    activeSourceScrubSourceId: null,
    canvasStatusHint: null,
    dispatch
  };
  return { dispatch, storeState };
});

vi.mock("../../packages/app/src/store/store", () => ({
  useEditorStore: (selector: (state: MockStatusBarState) => unknown) => selector(mocks.storeState)
}));

vi.mock("../../packages/app/src/ui/useFrameTimingStats", () => ({
  useFrameTimingStats: () => ({
    fps: null,
    p95FrameMs: null,
    maxFrameMs: null,
    frameCount: 0,
    dragFps: null,
    dragP95FrameMs: null,
    dragMaxFrameMs: null,
    dragFrameCount: 0
  })
}));

import { StatusBar } from "../../packages/app/src/ui/StatusBar";

describe("StatusBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.dispatch.mockReset();
    mocks.storeState.fitToContentModeActive = false;
    mocks.storeState.showGrid = true;
    mocks.storeState.canvasTransform = { translateX: 0, translateY: 0, scale: 1 };
    mocks.storeState.toolMode = "select";
    mocks.storeState.activeCanvasDragKind = null;
    mocks.storeState.activeSourceScrubSourceId = null;
    mocks.storeState.canvasStatusHint = null;

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

  it("requests fit to content when the fit toggle is off", async () => {
    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    const fitButton = container.querySelector<HTMLButtonElement>('button[aria-label="Fit to content"]');
    expect(fitButton).not.toBeNull();
    expect(fitButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      fitButton?.click();
    });

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "REQUEST_FIT_TO_CONTENT" });
  });

  it("turns fit tracking off without requesting a fit when the fit toggle is on", async () => {
    mocks.storeState.fitToContentModeActive = true;

    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    const fitButton = container.querySelector<HTMLButtonElement>('button[aria-label="Fit to content"]');
    expect(fitButton).not.toBeNull();
    expect(fitButton?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      fitButton?.click();
    });

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "SET_FIT_TO_CONTENT_MODE", active: false });
  });

  it("dispatches the existing grid toggle from the grid button", async () => {
    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    const gridButton = container.querySelector<HTMLButtonElement>('button[aria-label="Hide grid"]');
    expect(gridButton).not.toBeNull();
    expect(gridButton?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      gridButton?.click();
    });

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "TOGGLE_CANVAS_AID", aid: "grid" });
  });

  it("shows canvas guidance from shared UI state", async () => {
    mocks.storeState.canvasStatusHint = "Double-click path to add a point.";

    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    expect(container.textContent).toContain("Double-click path to add a point.");
  });

  it("shows modifier hints for active rotate drags", async () => {
    mocks.storeState.activeCanvasDragKind = "rotate";
    const keys = getModifierKeyLabels();

    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    expect(container.textContent).toContain("Modifiers:");
    expect(container.textContent).toContain(`${keys.alt} rotate around center`);
    expect(container.textContent).toContain(`${keys.shift} snap to 15° increments`);
    expect(container.textContent).toContain(`${keys.primary} ignore snapping`);
    expect(container.textContent).not.toContain("Cmd/Ctrl");
    expect(container.textContent).not.toContain("Alt/Option");
    expect(container.textContent).not.toContain("center pivot");
    expect(container.textContent).not.toContain("15° snap");
  });

  it("shows modifier hints for source number scrubbing", async () => {
    mocks.storeState.activeSourceScrubSourceId = "path:0";
    const keys = getModifierKeyLabels();

    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    expect(container.textContent).toContain("Modifiers:");
    expect(container.textContent).toContain(`${keys.shift} adjust numbers more slowly`);
    expect(container.textContent).toContain(`${keys.alt} adjust numbers faster`);
    expect(container.textContent).not.toContain("Alt/Option");
    expect(container.textContent).not.toContain("fine");
    expect(container.textContent).not.toContain("coarse");
  });

  it("shows plain-language resize modifier hints", async () => {
    mocks.storeState.activeCanvasDragKind = "resize";
    const keys = getModifierKeyLabels();

    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    expect(container.textContent).toContain(`${keys.shift} keep proportions`);
    expect(container.textContent).not.toContain(`${keys.alt} fine adjustments`);
    expect(container.textContent).not.toContain(`${keys.alt} fine positioning`);
    expect(container.textContent).not.toContain("preserve aspect");
    expect(container.textContent).not.toContain("write more decimal places");
  });

  it("does not advertise hidden precision formatting for element drags", async () => {
    mocks.storeState.activeCanvasDragKind = "element";
    const keys = getModifierKeyLabels();

    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    expect(container.textContent).toContain(`${keys.primary} ignore snapping`);
    expect(container.textContent).not.toContain(`${keys.alt} fine positioning`);
    expect(container.textContent).not.toContain(`${keys.alt} fine adjustments`);
    expect(container.textContent).not.toContain("write more decimal places");
  });

  it("shows shape-specific tool creation hints", async () => {
    mocks.storeState.activeCanvasDragKind = "tool-create";
    mocks.storeState.toolMode = "addRect";
    const keys = getModifierKeyLabels();

    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    expect(container.textContent).toContain(`${keys.shift} draw a square`);
    expect(container.textContent).toContain(`${keys.primary} ignore snapping`);
    expect(container.textContent).not.toContain("constrain");
  });

  it("omits Shift from tool creation hints when the active tool does not use it", async () => {
    mocks.storeState.activeCanvasDragKind = "tool-create";
    mocks.storeState.toolMode = "addLine";
    const keys = getModifierKeyLabels();

    await act(async () => {
      root.render(React.createElement(StatusBar));
    });

    expect(container.textContent).toContain(`${keys.primary} ignore snapping`);
    expect(container.textContent).not.toContain(`${keys.shift} draw`);
    expect(container.textContent).not.toContain("constrain");
  });

  it("uses mac modifier symbols when formatting hint keys", () => {
    expect(getModifierKeyLabels("MacIntel")).toEqual({
      shift: "⇧",
      alt: "⌥",
      primary: "⌘"
    });
  });

  it("uses non-mac control and alt labels when formatting hint keys", () => {
    expect(getModifierKeyLabels("Win32")).toEqual({
      shift: "⇧",
      alt: "Alt",
      primary: "Ctrl"
    });
  });
});
