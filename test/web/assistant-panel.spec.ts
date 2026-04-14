/** @vitest-environment jsdom */

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveEditorPlatform, getActiveEditorPlatform } from "../../packages/app/src/platform/current";
import { EditorStoreProvider, defaultEditorStore } from "../../packages/app/src/store/store";

vi.mock("../../packages/app/src/ui/assistant-image-attachments", () => ({
  normalizePastedImageForAssistant: vi.fn(async (file: File, index: number) => ({
    blob: file,
    mimeType: "image/png",
    fileName: `pasted-${index + 1}.png`
  }))
}));

import { AssistantPanel } from "../../packages/app/src/ui/AssistantPanel";
import { normalizePastedImageForAssistant } from "../../packages/app/src/ui/assistant-image-attachments";

function dispatchPaste(target: HTMLElement, items: Array<{ kind: string; type: string; getAsFile?: () => File | null }>): void {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData?: DataTransfer };
  Object.defineProperty(event, "clipboardData", {
    value: { items },
    configurable: true
  });
  target.dispatchEvent(event);
}

describe("AssistantPanel image paste", () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousPlatform: ReturnType<typeof getActiveEditorPlatform>;

  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const urlApi = URL as typeof URL & {
      createObjectURL?: (obj: Blob | MediaSource) => string;
      revokeObjectURL?: (url: string) => void;
    };
    urlApi.createObjectURL = () => "blob:mock";
    urlApi.revokeObjectURL = () => undefined;
    previousPlatform = getActiveEditorPlatform();
    setActiveEditorPlatform({
      id: "test-platform",
      persistence: {
        load: () => null,
        save: () => undefined
      },
      assistant: {
        startTurn: async () => ({ turnId: "turn-1" }),
        listModels: async () => [],
        readAccount: async () => null,
        readRateLimits: async () => null,
        checkCodexStatus: async () => ({
          installed: true,
          hasNpm: true,
          hasBrew: false,
          hasWsl: false
        }),
        warmUp: async () => undefined
      }
    });

    const state = defaultEditorStore.getState();
    const docId = state.activeDocumentId;
    const doc = state.documents[docId]!;
    defaultEditorStore.setState({
      ...state,
      documents: {
        ...state.documents,
        [docId]: {
          ...doc,
          assistantTurnStatus: "idle",
          assistantItems: [],
          assistantPendingApprovals: [],
          assistantError: null
        }
      }
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(EditorStoreProvider, { store: defaultEditorStore }, React.createElement(AssistantPanel, { onSubmitPrompt: async () => undefined, onInterruptTurn: async () => undefined }))
      );
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    setActiveEditorPlatform(previousPlatform);
    vi.clearAllMocks();
  });

  it("adds a pending attachment when an image is pasted", async () => {
    const textarea = container.querySelector('[data-testid="assistant-prompt"]') as HTMLTextAreaElement;
    const file = new File([new Blob(["image"])], "clip.png", { type: "image/png" });

    dispatchPaste(textarea, [{ kind: "file", type: "image/png", getAsFile: () => file }]);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(normalizePastedImageForAssistant).toHaveBeenCalled();
    const attachments = container.querySelector('[data-testid="assistant-attachments"]');
    expect(attachments).not.toBeNull();
    const thumb = attachments?.querySelector("img");
    expect(thumb).not.toBeNull();
    const previewButton = attachments?.querySelector('button[aria-label="Preview pasted-1.png"]') as HTMLButtonElement;
    await act(async () => {
      previewButton.click();
      await Promise.resolve();
    });
    expect(thumb?.className).toContain("attachmentThumbExpanded");

    const form = container.querySelector("form");
    const firstChild = form?.firstElementChild as HTMLElement | null;
    expect(firstChild?.dataset.testid).toBe("assistant-attachments");
  });

  it("shows attached image thumbnails in user message history", async () => {
    const state = defaultEditorStore.getState();
    const docId = state.activeDocumentId;
    const doc = state.documents[docId]!;
    await act(async () => {
      defaultEditorStore.setState({
        ...state,
        documents: {
          ...state.documents,
          [docId]: {
            ...doc,
            assistantItems: [{
              type: "userMessage",
              id: "u-1",
              content: [
                { type: "text", text: "Please apply this style" },
                { type: "image", url: "data:image/png;base64,Zm9v" }
              ]
            }]
          }
        }
      });
      root.render(
        React.createElement(EditorStoreProvider, { store: defaultEditorStore }, React.createElement(AssistantPanel, { onSubmitPrompt: async () => undefined, onInterruptTurn: async () => undefined }))
      );
    });

    const thumb = container.querySelector('img[alt="Attachment 1"]') as HTMLImageElement | null;
    expect(thumb).not.toBeNull();
    expect(thumb?.src).toContain("data:image/png;base64,Zm9v");
  });

  it("keeps non-image paste as a no-op for attachments", async () => {
    const textarea = container.querySelector('[data-testid="assistant-prompt"]') as HTMLTextAreaElement;

    dispatchPaste(textarea, [{ kind: "string", type: "text/plain" }]);

    await act(async () => {
      await Promise.resolve();
    });

    expect(normalizePastedImageForAssistant).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="assistant-attachments"]')).toBeNull();
  });

  it("removes an attachment chip when clicking remove", async () => {
    const textarea = container.querySelector('[data-testid="assistant-prompt"]') as HTMLTextAreaElement;
    const file = new File([new Blob(["image"])], "clip.png", { type: "image/png" });

    dispatchPaste(textarea, [{ kind: "file", type: "image/png", getAsFile: () => file }]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const removeButton = container.querySelector('button[aria-label="Remove pasted-1.png"]') as HTMLButtonElement;
    await act(async () => {
      removeButton.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="assistant-attachments"]')).toBeNull();
  });

  it("renders fileChange items as edited code with diff stats and diff text", async () => {
    const state = defaultEditorStore.getState();
    const docId = state.activeDocumentId;
    const doc = state.documents[docId]!;
    await act(async () => {
      defaultEditorStore.setState({
        ...state,
        documents: {
          ...state.documents,
          [docId]: {
            ...doc,
            assistantItems: [{
              type: "fileChange",
              id: "fc-1",
              status: "completed",
              changes: [{
                path: "/tmp/figure.tex",
                diff: "@@ -1,1 +1,1 @@\n-\\\\draw (0,0)--(1,1);\n+\\\\draw (0,0)--(2,2);\n"
              }]
            }]
          }
        }
      });
      root.render(
        React.createElement(EditorStoreProvider, { store: defaultEditorStore }, React.createElement(AssistantPanel, { onSubmitPrompt: async () => undefined, onInterruptTurn: async () => undefined }))
      );
    });

    const summary = Array.from(container.querySelectorAll("summary"))
      .find((node) => (node.textContent ?? "").includes("Edited code"));
    expect(summary?.textContent).toContain("Edited code +1 -1");
    expect(container.textContent).toContain("\\draw (0,0)--(2,2);");
  });

  it("renames figure.tex read command execution to 'Read the code'", async () => {
    const state = defaultEditorStore.getState();
    const docId = state.activeDocumentId;
    const doc = state.documents[docId]!;
    await act(async () => {
      defaultEditorStore.setState({
        ...state,
        documents: {
          ...state.documents,
          [docId]: {
            ...doc,
            assistantItems: [{
              type: "commandExecution",
              id: "cmd-1",
              command: ["cat", "figure.tex"],
              status: "completed"
            }]
          }
        }
      });
      root.render(
        React.createElement(EditorStoreProvider, { store: defaultEditorStore }, React.createElement(AssistantPanel, { onSubmitPrompt: async () => undefined, onInterruptTurn: async () => undefined }))
      );
    });

    const summary = Array.from(container.querySelectorAll("summary"))
      .find((node) => (node.textContent ?? "").includes("Read the code"));
    expect(summary).toBeDefined();
  });
});
