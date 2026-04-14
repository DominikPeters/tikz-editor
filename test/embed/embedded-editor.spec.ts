/** @vitest-environment jsdom */

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorStoreApi } from "../../packages/app/src/store/store";

vi.mock("../../packages/app/src/ui/CanvasPanel", () => ({
  CanvasPanel: () => React.createElement("div", { "data-testid": "mock-canvas" })
}));

vi.mock("../../packages/app/src/embed/useEmbedComputeDriver", () => ({
  useEmbedComputeDriver: () => undefined
}));

import { EmbeddedEditor } from "../../packages/app/src/embed/EmbeddedEditor";

describe("EmbeddedEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

  it("snapshots initial props once and ignores subsequent initial* prop updates", async () => {
    let latestStore: EditorStoreApi | null = null;
    const handleStoreRef = (store: EditorStoreApi | null) => {
      latestStore = store;
    };

    await act(async () => {
      root.render(
        React.createElement(EmbeddedEditor, {
          initialSource: "\\draw (0,0) -- (1,0);",
          documentTitle: "First title",
          activeFigureId: "figure:0",
          storeRef: handleStoreRef
        })
      );
    });

    expect(latestStore).not.toBeNull();
    if (!latestStore) {
      throw new Error("Expected EmbeddedEditor to expose a store via storeRef");
    }
    const initialStore: EditorStoreApi = latestStore;
    expect(initialStore.getState().source).toContain("(1,0)");
    expect(initialStore.getState().activeFigureId).toBe("figure:0");
    expect(initialStore.getState().documents[initialStore.getState().activeDocumentId]?.title).toBe("First title");

    await act(async () => {
      root.render(
        React.createElement(EmbeddedEditor, {
          initialSource: "\\draw (0,0) -- (9,0);",
          documentTitle: "Second title",
          activeFigureId: "figure:9",
          storeRef: handleStoreRef
        })
      );
    });

    expect(latestStore).toBe(initialStore);
    expect(initialStore.getState().source).toContain("(1,0)");
    expect(initialStore.getState().activeFigureId).toBe("figure:0");
    expect(initialStore.getState().documents[initialStore.getState().activeDocumentId]?.title).toBe("First title");
  });
});
