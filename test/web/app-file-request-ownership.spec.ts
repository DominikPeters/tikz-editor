/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { appCallbacks, deferred, memoryPersistence, mountFileApp, unmountFileApp } from "./app-file-operations-fixtures";
import { useEditorStore } from "../../packages/app/src/store/store";
import { revisionForText, type LinkedTextReadResult, type LinkedTextWriteResult } from "../../packages/app/src/linked-file-sync";
import type { DocumentFileRef } from "../../packages/app/src/store/types";

const A: DocumentFileRef = { kind: "file", provider: "desktop-fs", name: "a.tex", path: "/tmp/a.tex" };
const B: DocumentFileRef = { ...A, name: "b.tex", path: "/tmp/b.tex" };
const saved = (source: string, fileRef = A): LinkedTextWriteResult => ({ status: "saved", fileRef, revision: revisionForText(source) });
const readResult = (source: string, fileRef = A): LinkedTextReadResult => ({ status: "ok", source, fileRef, revision: revisionForText(source) });
const saveText = async () => ({ status: "cancelled" as const, fileRef: null });
afterEach(unmountFileApp);

async function bind(id: string, source: string, fileRef = A) {
  await act(async () => {
    useEditorStore.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", documentId: id,
      fileRef, savedSource: source, diskRevision: revisionForText(source), lastKnownDiskSource: source });
  });
}

async function choose(decision: "cancel" | "reload" | "save-anyway") {
  const button = document.querySelector<HTMLButtonElement>(`[data-testid="test-conflict-${decision}"]`);
  expect(button).not.toBeNull();
  await act(async () => { button!.click(); });
}

it("serializes changed-source saves and writes the queued source against the completed baseline", async () => {
  const first = deferred<LinkedTextWriteResult>();
  const second = deferred<LinkedTextWriteResult>();
  const write = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  const id = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence, files: { saveText, writeLinkedText: write } }, "old");
  await bind(id, "old");
  await act(async () => {
    appCallbacks.current.onRequestSaveDocument(id, "save");
    useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: "new" });
    appCallbacks.current.onRequestSaveDocument(id, "save");
  });
  expect(write).toHaveBeenCalledTimes(1);
  await act(async () => { first.resolve(saved("old")); });
  expect(write.mock.calls[1]?.slice(1)).toEqual(["new", revisionForText("old")]);
  expect(useEditorStore.getState().documents[id].dirty).toBe(true);
  await act(async () => { second.resolve(saved("new")); });
  expect(useEditorStore.getState().documents[id].savedSource).toBe("new");
  expect(useEditorStore.getState().documents[id].dirty).toBe(false);
});

it("coalesces duplicate pending saves without opening a second conflict dialog", async () => {
  const pending = deferred<LinkedTextWriteResult>();
  const write = vi.fn(() => pending.promise);
  const id = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence, files: { saveText, writeLinkedText: write } }, "local");
  await bind(id, "local");
  await act(async () => {
    appCallbacks.current.onRequestSaveDocument(id, "save");
    appCallbacks.current.onRequestSaveDocument(id, "save");
  });
  expect(write).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ status: "changed-on-disk", fileRef: A, source: "remote", revision: revisionForText("remote") }); });
  expect(document.querySelectorAll("[data-testid=test-file-conflict]")).toHaveLength(1);
  await choose("cancel");
  expect(document.querySelector("[data-testid=test-file-conflict]")).toBeNull();
  expect(write).toHaveBeenCalledTimes(1);
});

it("queues conflict choices belonging to different documents", async () => {
  const write = vi.fn(async (fileRef: DocumentFileRef): Promise<LinkedTextWriteResult> => ({
    status: "changed-on-disk", fileRef, source: "remote", revision: revisionForText("remote")
  }));
  const idA = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence, files: { saveText, writeLinkedText: write } }, "local a");
  await bind(idA, "local a");
  await act(async () => { useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source: "local b" }); });
  const idB = useEditorStore.getState().activeDocumentId;
  await bind(idB, "local b", B);
  await act(async () => {
    appCallbacks.current.onRequestSaveDocument(idA, "save");
    appCallbacks.current.onRequestSaveDocument(idB, "save");
  });
  expect(document.querySelector("[data-testid=test-file-conflict]")?.textContent).toContain("a.tex");
  await choose("cancel");
  expect(document.querySelector("[data-testid=test-file-conflict]")?.textContent).toContain("b.tex");
  await choose("cancel");
  expect(document.querySelector("[data-testid=test-file-conflict]")).toBeNull();
});

it("retires a closed document's conflict and exposes the next document's choice", async () => {
  const write = async (fileRef: DocumentFileRef): Promise<LinkedTextWriteResult> => ({
    status: "changed-on-disk", fileRef, source: "remote", revision: revisionForText("remote")
  });
  const idA = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence, files: { saveText, writeLinkedText: write } }, "local a");
  await bind(idA, "local a");
  await act(async () => { useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source: "local b" }); });
  const idB = useEditorStore.getState().activeDocumentId;
  await bind(idB, "local b", B);
  await act(async () => {
    appCallbacks.current.onRequestSaveDocument(idA, "save");
    appCallbacks.current.onRequestSaveDocument(idB, "save");
  });
  await act(async () => { useEditorStore.getState().dispatch({ type: "CLOSE_DOCUMENT", documentId: idA }); });
  expect(document.querySelector("[data-testid=test-file-conflict]")?.textContent).toContain("b.tex");
  await choose("cancel");
});

it("does not reload over an edit made while a conflict choice was open", async () => {
  const showMessage = vi.fn(async () => {});
  const id = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence, window: { showMessage },
    files: { saveText, writeLinkedText: async () => ({ status: "changed-on-disk", fileRef: A, source: "remote", revision: revisionForText("remote") }) } }, "local");
  await bind(id, "local");
  await act(async () => { appCallbacks.current.onRequestSaveDocument(id, "save"); });
  await act(async () => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: "new local" }); });
  await choose("reload");
  expect(useEditorStore.getState().documents[id].source).toBe("new local");
  expect(showMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "warning" }));
});

it("uses an explicit overwrite choice to save the current source without queue deadlock", async () => {
  const write = vi.fn().mockResolvedValueOnce({ status: "changed-on-disk", fileRef: A, source: "remote", revision: revisionForText("remote") })
    .mockImplementationOnce(async (_file: DocumentFileRef, source: string) => saved(source));
  const id = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence, files: { saveText, writeLinkedText: write } }, "local");
  await bind(id, "local");
  await act(async () => { appCallbacks.current.onRequestSaveDocument(id, "save"); });
  await act(async () => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: "new local" }); });
  await choose("save-anyway");
  expect(write.mock.calls[1]?.slice(1)).toEqual(["new local", null]);
  expect(useEditorStore.getState().documents[id].dirty).toBe(false);
});

it("initializes only disk metadata when Save As baseline lookup overlaps an edit", async () => {
  const pending = deferred<LinkedTextReadResult>();
  const id = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence, files: {
    saveText: async () => ({ status: "saved", fileRef: A }), readLinkedText: () => pending.promise
  } }, "written");
  await act(async () => { appCallbacks.current.onRequestSaveDocument(id, "save-as"); });
  await act(async () => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: "new local" }); });
  await act(async () => { pending.resolve(readResult("written")); });
  const doc = useEditorStore.getState().documents[id];
  expect(doc.savedSource).toBe("written");
  expect(doc.dirty).toBe(true);
  expect(doc.diskRevision).toEqual(revisionForText("written"));
});

it("ignores a late old-file read failure after Save As", async () => {
  const pending = deferred<LinkedTextReadResult>();
  const id = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence, files: {
    saveText: async () => ({ status: "saved", fileRef: B }),
    readLinkedText: (fileRef) => fileRef.path === A.path ? pending.promise : Promise.resolve(readResult("local", B))
  } }, "local");
  await bind(id, "local");
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await act(async () => { appCallbacks.current.onRequestSaveDocument(id, "save-as"); });
  await act(async () => { pending.reject(new Error("Old file is gone")); });
  expect(useEditorStore.getState().documents[id].fileRef?.path).toBe(B.path);
  expect(useEditorStore.getState().documents[id].externalChangeStatus).toBe("none");
});

it("invalidates a pending refresh when saving and suppresses refreshes during the write", async () => {
  const pendingRead = deferred<LinkedTextReadResult>();
  const pendingWrite = deferred<LinkedTextWriteResult>();
  const read = vi.fn(() => pendingRead.promise);
  const id = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence, files: {
    saveText, readLinkedText: read, writeLinkedText: () => pendingWrite.promise
  } }, "local");
  await bind(id, "local");
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await act(async () => { appCallbacks.current.onRequestSaveDocument(id, "save"); });
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => { pendingWrite.resolve(saved("local")); });
  await act(async () => { pendingRead.resolve(readResult("old remote")); });
  expect(useEditorStore.getState().documents[id].source).toBe("local");
});

it("rechecks all documents before close-all, including an initially clean tab", async () => {
  const pending = deferred<{ status: "saved"; fileRef: DocumentFileRef }>();
  const idA = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence,
    files: { saveText: () => pending.promise }, window: { confirmUnsavedChanges: async () => "save" } }, "dirty a");
  await act(async () => { useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source: "clean b" }); });
  const idB = useEditorStore.getState().activeDocumentId;
  await bind(idB, "clean b", B);
  await act(async () => { appCallbacks.current.onRequestCloseAllDocuments(); });
  await act(async () => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: "new b" }); });
  await act(async () => { pending.resolve({ status: "saved", fileRef: A }); });
  expect(useEditorStore.getState().documents[idA]).toBeDefined();
  expect(useEditorStore.getState().documents[idB].source).toBe("new b");
  expect(useEditorStore.getState().documents[idB].dirty).toBe(true);
});

it("does not publish an in-flight save completion after the App is unmounted", async () => {
  const pending = deferred<LinkedTextWriteResult>();
  const id = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence,
    files: { saveText, writeLinkedText: () => pending.promise } }, "written baseline");
  await bind(id, "written baseline");
  await act(async () => {
    useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: "local change" });
    appCallbacks.current.onRequestSaveDocument(id, "save");
  });
  await unmountFileApp();
  await act(async () => { pending.resolve(saved("local change")); });
  expect(useEditorStore.getState().documents[id].savedSource).toBe("written baseline");
  expect(useEditorStore.getState().documents[id].dirty).toBe(true);
});
