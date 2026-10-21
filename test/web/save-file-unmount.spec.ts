/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DocumentFileRef } from "../../packages/app/src/store/types";
import type { LinkedTextReadResult } from "../../packages/app/src/linked-file-sync";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../../packages/app/src/platform/current";
import { makeInitialState } from "../../packages/app/src/store/reducer";
import { useEditorStore } from "../../packages/app/src/store/store";
import { useDocumentFileOperations } from "../../packages/app/src/ui/useDocumentFileOperations";

it("does not report save completion after unmount during the linked-file baseline read", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const originalPlatform = getActiveEditorPlatform();
  const originalState = useEditorStore.getState();
  const state = makeInitialState();
  useEditorStore.setState(state);
  let finishRead: (result: LinkedTextReadResult) => void = () => { throw new Error("Read not initialized"); };
  const read = new Promise<LinkedTextReadResult>(resolve => { finishRead = resolve; });
  const fileRef = { kind: "file" as const, name: "saved.tex", path: "/saved.tex", provider: "desktop-fs" } satisfies DocumentFileRef;
  const readLinkedText = vi.fn(() => read);
  setActiveEditorPlatform({ ...originalPlatform, files: {
    ...originalPlatform.files,
    saveText: async () => ({ status: "saved", fileRef }), readLinkedText
  } });
  const operations: { current: ReturnType<typeof useDocumentFileOperations> | null } = { current: null };
  function Harness() {
    operations.current = useDocumentFileOperations({ dispatch: originalState.dispatch, showMessage: async () => {} });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() => { root.render(React.createElement(Harness)); });
    const current = operations.current;
    if (!current) throw new Error("File operations did not mount");
    const pending = current.saveDocument(state.activeDocumentId, "save-as");
    await vi.waitFor(() => { expect(readLinkedText).toHaveBeenCalledTimes(1); });
    act(() => { root.unmount(); });
    finishRead({ status: "missing" });
    await expect(pending).resolves.toBe(false);
  } finally {
    act(() => { root.unmount(); });
    setActiveEditorPlatform(originalPlatform);
    useEditorStore.setState(originalState, true);
    vi.unstubAllGlobals();
  }
});
