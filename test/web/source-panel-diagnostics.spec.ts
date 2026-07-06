/** @vitest-environment jsdom */

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";
import { makeInitialState } from "../../packages/app/src/store/reducer.js";
import { useEditorStore } from "../../packages/app/src/store/store.js";
import type { SessionSnapshot } from "../../packages/app/src/compute.js";
import {
  prioritizeDiagnosticsForDisplay,
  SourcePanel,
  type DiagnosticInput
} from "../../packages/app/src/ui/source-panel/SourcePanel.js";

describe("SourcePanel diagnostics", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    installEditorDomStubs();
    resetEditorStore(String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`);
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

  it("prioritizes primary diagnostics over parser recovery fallout", () => {
    const diagnostics: DiagnosticInput[] = [
      {
        source: "parse",
        code: "parse-error",
        severity: "error",
        message: "Syntax error in \\newcommand definition. Expected \\newcommand{\\name}[argCount]{body}.",
        from: 40,
        to: 40
      },
      {
        source: "parse",
        code: "stray-token",
        severity: "error",
        message: "Unexpected text `bad` in tikzpicture; start statements with a TikZ command such as \\draw, \\node, or \\path.",
        from: 40,
        to: 43
      },
      {
        source: "parse",
        code: "stray-token",
        severity: "error",
        message: "Unexpected text `hello` in tikzpicture; start statements with a TikZ command such as \\draw, \\node, or \\path.",
        from: 140,
        to: 145
      }
    ];

    expect(prioritizeDiagnosticsForDisplay(diagnostics).map((diagnostic) => diagnostic.message)).toEqual([
      "Syntax error in \\newcommand definition. Expected \\newcommand{\\name}[argCount]{body}.",
      "Unexpected text `hello` in tikzpicture; start statements with a TikZ command such as \\draw, \\node, or \\path."
    ]);
  });

  it("renders the prioritized diagnostic message and line number", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {Hello;
\end{tikzpicture}`;
    resetEditorStore(source);

    await act(async () => {
      root.render(React.createElement(SourcePanel));
    });

    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.textContent).toContain("Unclosed node text; add a closing `}` before the end of the node statement.");
    expect(container.textContent).toContain("Ln 2");
    expect(container.textContent).not.toContain("Statement is missing a trailing semicolon");
  });
});

function resetEditorStore(source: string): void {
  const rendered = renderTikzToSvg(source);
  const snapshot = makeSnapshot(source, rendered);
  const base = makeInitialState();
  const dispatch = useEditorStore.getState().dispatch;
  const docId = base.activeDocumentId;
  const doc = base.documents[docId];
  if (!doc) {
    throw new Error("Expected initial document");
  }

  useEditorStore.setState({
    ...base,
    source,
    sourceRevision: 1,
    activeFigureId: rendered.parse.activeFigureId,
    snapshot,
    documents: {
      ...base.documents,
      [docId]: {
        ...doc,
        source,
        sourceRevision: 1,
        activeFigureId: rendered.parse.activeFigureId,
        snapshot
      }
    },
    dispatch
  }, true);
}

function makeSnapshot(
  source: string,
  rendered: ReturnType<typeof renderTikzToSvg>
): SessionSnapshot {
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

function installEditorDomStubs(): void {
  if (typeof window.requestAnimationFrame !== "function") {
    window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => {
      callback(performance.now());
    }, 0);
  }
  if (typeof window.cancelAnimationFrame !== "function") {
    window.cancelAnimationFrame = (id: number) => {
      window.clearTimeout(id);
    };
  }
  if (typeof window.ResizeObserver !== "function") {
    window.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  document.createRange = () => ({
    setStart: () => undefined,
    setEnd: () => undefined,
    getClientRects: () => [],
    getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
    commonAncestorContainer: document.body,
    cloneContents: () => document.createDocumentFragment(),
    cloneRange: () => document.createRange(),
    collapse: () => undefined,
    compareBoundaryPoints: () => 0,
    comparePoint: () => 0,
    createContextualFragment: () => document.createDocumentFragment(),
    deleteContents: () => undefined,
    detach: () => undefined,
    extractContents: () => document.createDocumentFragment(),
    get endContainer() { return document.body; },
    get endOffset() { return 0; },
    insertNode: () => undefined,
    intersectsNode: () => false,
    isPointInRange: () => false,
    selectNode: () => undefined,
    selectNodeContents: () => undefined,
    setEndAfter: () => undefined,
    setEndBefore: () => undefined,
    setStartAfter: () => undefined,
    setStartBefore: () => undefined,
    surroundContents: () => undefined,
    get startContainer() { return document.body; },
    get startOffset() { return 0; },
    get collapsed() { return true; },
    START_TO_START: 0,
    START_TO_END: 1,
    END_TO_END: 2,
    END_TO_START: 3
  } as unknown as Range);
}
