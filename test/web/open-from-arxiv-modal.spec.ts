/** @vitest-environment jsdom */

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setActiveEditorPlatform } from "../../packages/app/src/platform/current.js";
import { OpenFromArxivModal } from "../../packages/app/src/ui/OpenFromArxivModal.js";

const renderTikzToSvgAsync = vi.fn(async () => ({
  parse: { diagnostics: [] },
  semantic: { diagnostics: [], scene: { elements: [{ kind: "Path" }] } },
  renderDiagnostics: [],
  svg: {
    svg: '<svg viewBox="0 0 10 10"><path d="M 0 0 L 10 10" stroke="black" /></svg>',
    viewBox: { x: 0, y: 0, width: 10, height: 10 },
    model: { defs: [], diagnostics: [], parts: [], viewBox: { x: 0, y: 0, width: 10, height: 10 } },
    diagnostics: []
  }
}));

vi.mock("tikz-editor/render/index", () => ({ renderTikzToSvgAsync }));

describe("OpenFromArxivModal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
    renderTikzToSvgAsync.mockClear();
    setActiveEditorPlatform({
      id: "test",
      persistence: { load: () => null, save: () => {} },
      files: {
        fetchArxivSource: async () => ({ id: "2605.06194", files: [] })
      }
    });

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

  it("embeds rendered previews as SVG images", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1);
\end{tikzpicture}`;

    await act(async () => {
      root.render(
        React.createElement(OpenFromArxivModal, {
          session: {
            input: "https://arxiv.org/abs/2605.06194",
            paper: {
              id: "2605.06194",
              files: [{ path: "paper.tex", source, size: source.length }]
            },
            selectedCandidateId: null
          },
          onSessionChange: () => {},
          onClose: () => {},
          onOpenCandidate: () => {}
        })
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const previewImage = container.querySelector<HTMLImageElement>("img");

    expect(previewImage).not.toBeNull();
    expect(previewImage?.src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/u);
    expect(decodeURIComponent(previewImage?.src.split(",")[1] ?? "")).toContain("<path");
    expect(container.querySelector(".previewFrame svg")).toBeNull();
  });
});
