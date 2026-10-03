/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { appCallbacks, deferred, memoryPersistence, mountFileApp, unmountFileApp } from "./app-file-operations-fixtures";
import { useEditorStore } from "../../packages/app/src/store/store";
import { revisionForText, type LinkedTextReadResult } from "../../packages/app/src/linked-file-sync";
import type { DocumentFileRef } from "../../packages/app/src/store/types";

const OLD = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`;
const REMOTE_1 = String.raw`\begin{tikzpicture}\draw (0,0) -- (2,2);\end{tikzpicture}`;
const REMOTE_2 = String.raw`\begin{tikzpicture}\draw (0,0) -- (3,3);\end{tikzpicture}`;
const FILE_A: DocumentFileRef = { kind: "file", provider: "desktop-fs", name: "a.tex", path: "/tmp/a.tex" };
const FILE_B: DocumentFileRef = { ...FILE_A, name: "b.tex", path: "/tmp/b.tex" };
const ok = (source: string, fileRef = FILE_A): LinkedTextReadResult => ({ status: "ok", source, fileRef, revision: revisionForText(source) });
afterEach(unmountFileApp);

async function attachFile(id: string) {
  await act(async () => { useEditorStore.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", documentId: id,
    fileRef: FILE_A, diskRevision: revisionForText(OLD), lastKnownDiskSource: OLD }); });
}
async function focus() { await act(async () => { window.dispatchEvent(new Event("focus")); }); }

it("ignores a read of the old linked file which finishes after Save As", async () => {
  const oldRead = deferred<LinkedTextReadResult>();
  const read = vi.fn((fileRef: DocumentFileRef) => fileRef.path === FILE_A.path ? oldRead.promise : Promise.resolve(ok(OLD, FILE_B)));
  const id = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence, files: {
    readLinkedText: read, saveText: async () => ({ status: "saved", fileRef: FILE_B })
  } }, OLD);
  await attachFile(id);
  await focus();
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => { appCallbacks.current.onRequestSaveDocument(id, "save-as"); });
  expect(useEditorStore.getState().documents[id].fileRef?.path).toBe(FILE_B.path);
  await act(async () => { oldRead.resolve(ok(REMOTE_1)); });
  const doc = useEditorStore.getState().documents[id];
  expect(doc.fileRef?.path).toBe(FILE_B.path);
  expect(doc.source).toBe(OLD);
});

it("does not revert a newer linked refresh when an older read finishes later", async () => {
  const first = deferred<LinkedTextReadResult>();
  const second = deferred<LinkedTextReadResult>();
  const read = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  const id = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence,
    files: { readLinkedText: read } }, OLD);
  await attachFile(id);
  await focus();
  await focus();
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => { second.resolve(ok(REMOTE_2)); });
  expect(useEditorStore.getState().documents[id].source).toBe(REMOTE_2);
  await act(async () => { first.resolve(ok(REMOTE_1)); });
  expect(useEditorStore.getState().documents[id].source).toBe(REMOTE_2);
});

it("preserves an unsaved local edit made while a linked read is pending", async () => {
  const pendingRead = deferred<LinkedTextReadResult>();
  const id = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence,
    files: { readLinkedText: () => pendingRead.promise } }, OLD);
  await attachFile(id);
  await focus();
  await act(async () => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: REMOTE_2 }); });
  await act(async () => { pendingRead.resolve(ok(REMOTE_1)); });
  const doc = useEditorStore.getState().documents[id];
  expect(doc.source).toBe(REMOTE_2);
  expect(doc.dirty).toBe(true);
  expect(doc.externalChangeStatus).toBe("changed");
});
