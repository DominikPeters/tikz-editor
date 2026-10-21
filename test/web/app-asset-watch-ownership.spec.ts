/** @vitest-environment jsdom */
import { Buffer } from "node:buffer";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred, mountFileApp, unmountFileApp } from "./app-file-operations-fixtures";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../../packages/app/src/platform/current";
import { computeSnapshot } from "../../packages/app/src/compute";
import { prepareDocumentGraphicsContext } from "../../packages/app/src/image-asset-cache";
import { createActiveDocumentAssetWatchOwner } from "../../packages/app/src/ui/useActiveDocumentAssetWatches";
import { useEditorStore } from "../../packages/app/src/store/store";
import type { LocalAssetReadResult, PlatformFileApi } from "../../packages/app/src/platform/types";
import { formatDocumentRootId } from "../../packages/core/src/document/root-id";

const previousPlatform = getActiveEditorPlatform();
const previousState = useEditorStore.getState();
afterEach(async () => {
  await unmountFileApp();
  setActiveEditorPlatform(previousPlatform);
  useEditorStore.setState(previousState, true);
  vi.restoreAllMocks();
});
const source = String.raw`\begin{tikzpicture}\node {\includegraphics{active.svg}};\end{tikzpicture}`;
const plain = String.raw`\begin{tikzpicture}\draw (0,0)--(1,0);\end{tikzpicture}`;
const file = (directory: string) => ({ kind: "file" as const, name: "main.tex", provider: "desktop-fs" as const, path: `${directory}/main.tex` });
function read(path: string, color = "blue"): LocalAssetReadResult {
  return { status: "ok", path, revision: color, size: 100,
    bytesBase64: Buffer.from(`<svg width="10pt" height="5pt"><rect width="10" height="5" fill="${color}"/></svg>`).toString("base64") };
}
async function mount(directory: string, extras: Partial<PlatformFileApi> = {}) {
  let watched: readonly string[] = [];
  let changed: ((path: string) => void) | undefined;
  const sync = vi.fn((paths: readonly string[]) => { watched = [...paths]; });
  const files = {
    readLocalAsset: async (path: string) => read(path),
    syncLocalAssetWatches: sync,
    bindLocalAssetChange: (handler: (path: string) => void) => { changed = handler; return () => { changed = undefined; }; },
    ...extras
  };
  const documentId = await mountFileApp({ id: "watch-owner", persistence: { load: () => null, save() {} }, files }, source);
  await act(async () => useEditorStore.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: file(directory) }));
  return { documentId, watched: () => watched, sync, changed: (path: string) => changed?.(path) };
}

describe("active App asset watch ownership", () => {
  for (const variant of ["plain", "prewarm", "deck", "nested", "overlay"] as const) {
    it(`retains only active watches after an auxiliary ${variant} computation`, async () => {
      const directory = `/tmp/app-watch-aux-${variant}`;
      const active = await mount(directory);
      expect(active.watched()).toEqual([`${directory}/active.svg`]);
      const deck = String.raw`\documentclass{beamer}\begin{document}\begin{frame}\begin{tikzpicture}\node {\includegraphics{auxiliary.svg}};\end{tikzpicture}\end{frame}\end{document}`;
      await computeSnapshot({ id: "auxiliary", documentId: variant === "overlay" ? active.documentId : "auxiliary",
        source: variant === "deck" || variant === "nested" ? deck : variant === "overlay" ? source.replace("active.svg", "auxiliary.svg") : plain,
        documentFileRef: file("/tmp/app-watch-auxiliary"),
        kind: variant === "prewarm" ? "prewarm" : "render",
        activeRootId: variant === "nested" ? formatDocumentRootId({ kind: "beamer-frame-tikz", frameIndex: 0, index: 0 }) : undefined });
      expect(active.watched()).toEqual([`${directory}/active.svg`]);
      await unmountFileApp();
      expect(active.watched()).toEqual([]);
    });
  }

  it("replaces subscriptions on tab switches and releases them on unmount", async () => {
    const first = await mount("/tmp/app-watch-first");
    await act(async () => {
      useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source: source.replace("active.svg", "second.svg") });
      useEditorStore.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: file("/tmp/app-watch-second") });
    });
    expect(first.watched()).toEqual(["/tmp/app-watch-second/second.svg"]);
    await act(async () => useEditorStore.getState().dispatch({ type: "SWITCH_DOCUMENT", documentId: first.documentId }));
    expect(first.watched()).toEqual(["/tmp/app-watch-first/active.svg"]);
    await unmountFileApp();
    expect(first.watched()).toEqual([]);
  });

  it("updates watch paths on source changes and Save As directory changes", async () => {
    const active = await mount("/tmp/app-watch-save-as");
    await act(async () => useEditorStore.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: file("/tmp/app-watch-save-as/new") }));
    expect(active.watched()).toEqual(["/tmp/app-watch-save-as/new/active.svg"]);
    await act(async () => useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: source.replace("active.svg", "next") }));
    expect(active.watched()).toEqual(["jpeg", "jpg", "pdf", "png", "svg"].map((extension) => `/tmp/app-watch-save-as/new/next.${extension}`));
    await act(async () => useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: plain }));
    expect(active.watched()).toEqual([]);
  });

  it("keeps native subscriptions unchanged across ordinary source edits", async () => {
    const active = await mount("/tmp/app-watch-same-path");
    const calls = active.sync.mock.calls.length;
    for (let i = 0; i < 5; i += 1) {
      await act(async () => useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: `${source}\n% edit ${i}` }));
    }
    expect(active.watched()).toEqual(["/tmp/app-watch-same-path/active.svg"]);
    expect(active.sync).toHaveBeenCalledTimes(calls);
  });

  it("an aborted old preparation cannot replace the switched document's watches", async () => {
    const pending = deferred<LocalAssetReadResult>();
    const started = deferred<void>();
    const active = await mount("/tmp/app-watch-aborted/old", {
      readLocalAsset: async (path) => {
        if (path.includes("/old/")) { started.resolve(); return await pending.promise; }
        return read(path);
      }
    });
    const controller = new AbortController();
    const older = computeSnapshot({ id: "old", documentId: active.documentId, source, documentFileRef: file("/tmp/app-watch-aborted/old") }, { signal: controller.signal, yieldControl: async () => {} });
    const settled = older.then(() => "published", () => "aborted");
    await started.promise;
    controller.abort();
    await act(async () => {
      useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source });
      useEditorStore.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: file("/tmp/app-watch-aborted/new") });
    });
    await computeSnapshot({ id: "new", documentId: useEditorStore.getState().activeDocumentId, source, documentFileRef: file("/tmp/app-watch-aborted/new") });
    expect(active.watched()).toEqual(["/tmp/app-watch-aborted/new/active.svg"]);
    pending.resolve(read("/tmp/app-watch-aborted/old/active.svg", "red"));
    expect(await settled).toBe("aborted");
    expect(active.watched()).toEqual(["/tmp/app-watch-aborted/new/active.svg"]);
  });

  it("the actual App change listener invalidates cached bytes for the next render", async () => {
    let color = "red";
    const active = await mount("/tmp/app-watch-event", { readLocalAsset: async (path) => read(path, color) });
    const params = { source, documentFileRef: file("/tmp/app-watch-event") };
    const first = await prepareDocumentGraphicsContext(params);
    color = "blue";
    await act(async () => {
      active.changed("/tmp/app-watch-event/active.svg");
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    const latest = await prepareDocumentGraphicsContext(params);
    expect(latest.previewBundle.entries).not.toEqual(first.previewBundle.entries);
    expect(latest.previewBundle.entries[0].resolution).toMatchObject({ status: "resolved", dataBase64: (read("/tmp/app-watch-event/active.svg", "blue") as Extract<LocalAssetReadResult, { status: "ok" }>).bytesBase64 });
    expect(active.watched()).toEqual(["/tmp/app-watch-event/active.svg"]);
  });
});

describe("native replacement synchronization", () => {
  it("serializes asynchronous replacement and applies the latest owner after old completion", async () => {
    const pending = deferred<void>();
    const began = deferred<void>();
    let watched: readonly string[] = [];
    const sync = vi.fn(async (paths: readonly string[]) => {
      if (sync.mock.calls.length === 1) { began.resolve(); await pending.promise; }
      watched = [...paths];
    });
    const files = { syncLocalAssetWatches: sync };
    const first = createActiveDocumentAssetWatchOwner(files);
    first.update({ source, documentFileRef: file("/tmp/owner-first") });
    await began.promise;
    // A held native call retains only the newest pending set during typing.
    for (let i = 0; i < 1000; i += 1) {
      first.update({ source, documentFileRef: file(`/tmp/owner-first-${i}`) });
    }
    first.dispose();
    const second = createActiveDocumentAssetWatchOwner(files);
    second.update({ source, documentFileRef: file("/tmp/owner-second") });
    first.dispose();
    pending.resolve();
    await vi.waitFor(() => expect(watched).toEqual(["/tmp/owner-second/active.svg"]));
    expect(sync).toHaveBeenCalledTimes(2);
    second.dispose();
    await vi.waitFor(() => expect(watched).toEqual([]));
  });

  it("retries identical paths after failure and continues with newer paths", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const sync = vi.fn().mockRejectedValueOnce(new Error("Watcher failed")).mockResolvedValue(undefined);
    const owner = createActiveDocumentAssetWatchOwner({ syncLocalAssetWatches: sync });
    owner.update({ source, documentFileRef: file("/tmp/owner-failed") });
    await vi.waitFor(() => expect(info).toHaveBeenCalledOnce());
    owner.update({ source, documentFileRef: file("/tmp/owner-failed") });
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(2));
    owner.update({ source, documentFileRef: file("/tmp/owner-retry") });
    await vi.waitFor(() => expect(sync).toHaveBeenLastCalledWith(["/tmp/owner-retry/active.svg"]));
    owner.dispose();
  });

  it("cancels a pending replacement when the desired set returns to the in-flight paths", async () => {
    const pending = deferred<void>();
    const sync = vi.fn(async () => pending.promise);
    const owner = createActiveDocumentAssetWatchOwner({ syncLocalAssetWatches: sync });
    owner.update({ source, documentFileRef: file("/tmp/owner-rollback") });
    owner.update({ source, documentFileRef: file("/tmp/owner-superseded") });
    owner.update({ source, documentFileRef: file("/tmp/owner-rollback") });
    pending.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sync).toHaveBeenCalledOnce();
    owner.dispose();
  });
});
