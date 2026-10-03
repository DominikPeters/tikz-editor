/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { appCallbacks, deferred, memoryPersistence, mountFileApp, unmountFileApp } from "./app-file-operations-fixtures";
import { useEditorStore } from "../../packages/app/src/store/store";
import { revisionForText } from "../../packages/app/src/linked-file-sync";
import type { DocumentFileRef } from "../../packages/app/src/store/types";
import type { PlatformFileApi } from "../../packages/app/src/platform/types";

const OLD = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`;
const NEW = String.raw`\begin{tikzpicture}\draw (0,0) -- (5,5);\end{tikzpicture}`;
const FILE: DocumentFileRef = { kind: "file", provider: "download", name: "figure.tex" };
afterEach(unmountFileApp);

it("keeps an edit made during Save As dirty and records the bytes actually saved", async () => {
  const result = deferred<{ status: "saved"; fileRef: DocumentFileRef }>();
  const save = vi.fn<NonNullable<PlatformFileApi["saveText"]>>(() => result.promise);
  const id = await mountFileApp({ id: "web", persistence: memoryPersistence, files: { saveText: save } }, OLD);
  await act(async () => { appCallbacks.current.onRequestSaveDocument(id, "save-as"); });
  expect(save.mock.calls[0]?.[0]).toBe(OLD);
  await act(async () => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: NEW }); });
  await act(async () => { result.resolve({ status: "saved", fileRef: FILE }); });
  const doc = useEditorStore.getState().documents[id];
  expect(doc.savedSource).toBe(OLD);
  expect(doc.source).toBe(NEW);
  expect(doc.dirty).toBe(true);
});

it("keeps an edit made during linked Save dirty", async () => {
  const linked: DocumentFileRef = { kind: "file", provider: "desktop-fs", name: "figure.tex", path: "/tmp/figure.tex" };
  const result = deferred<{ status: "saved"; fileRef: DocumentFileRef; revision: ReturnType<typeof revisionForText> }>();
  const save = vi.fn<NonNullable<PlatformFileApi["writeLinkedText"]>>(() => result.promise);
  const id = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence,
    files: { saveText: async () => ({ status: "saved", fileRef: linked }), writeLinkedText: save } }, OLD);
  await act(async () => {
    useEditorStore.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", documentId: id, fileRef: linked });
    useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: OLD + "\n% initial edit" });
  });
  const savedSource = useEditorStore.getState().source;
  await act(async () => { appCallbacks.current.onRequestSaveDocument(id, "save"); });
  expect(save.mock.calls[0]?.[1]).toBe(savedSource);
  await act(async () => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: NEW }); });
  await act(async () => { result.resolve({ status: "saved", fileRef: linked, revision: revisionForText(savedSource) }); });
  const doc = useEditorStore.getState().documents[id];
  expect(doc.savedSource).toBe(savedSource);
  expect(doc.dirty).toBe(true);
});

it("does not close a document with edits made during the close dialog's Save", async () => {
  const result = deferred<{ status: "saved"; fileRef: DocumentFileRef }>();
  const save = vi.fn<NonNullable<PlatformFileApi["saveText"]>>(() => result.promise);
  const id = await mountFileApp({ id: "desktop-mac", persistence: memoryPersistence,
    files: { saveText: save }, window: { confirmUnsavedChanges: async () => "save" } }, OLD);
  await act(async () => { appCallbacks.current.onRequestCloseDocument(id); });
  expect(save.mock.calls[0]?.[0]).toBe(OLD);
  await act(async () => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: NEW }); });
  await act(async () => { result.resolve({ status: "saved", fileRef: FILE }); });
  expect(useEditorStore.getState().documents[id]?.source).toBe(NEW);
});

it("marks the unchanged document clean on a successful save", async () => {
  const result = deferred<{ status: "saved"; fileRef: DocumentFileRef }>();
  const id = await mountFileApp({ id: "web", persistence: memoryPersistence, files: { saveText: () => result.promise } }, OLD);
  await act(async () => { appCallbacks.current.onRequestSaveDocument(id, "save-as"); });
  await act(async () => { result.resolve({ status: "saved", fileRef: FILE }); });
  expect(useEditorStore.getState().documents[id].savedSource).toBe(OLD);
  expect(useEditorStore.getState().documents[id].dirty).toBe(false);
});
