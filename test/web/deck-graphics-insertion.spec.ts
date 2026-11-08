import { afterEach, describe, expect, it, vi } from "vitest";
import { computeSnapshot } from "../../packages/app/src/compute.js";
import { editorReducer, makeInitialState } from "../../packages/app/src/store/reducer.js";
import type { EditorAction } from "../../packages/app/src/store/types.js";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../../packages/app/src/platform/current.js";
import type { EditorPlatform, PlatformFileApi } from "../../packages/app/src/platform/types.js";
import { graphicBytesBase64 } from "../../packages/app/src/imported-graphics.js";
import { changeGraphicsLocation, insertDeckGraphics, undoGraphicsInsertion, useGraphicsNoticeStore } from "../../packages/app/src/ui/deck-graphics-insertion.js";
import { prepareDocumentGraphicsContext } from "../../packages/app/src/image-asset-cache.js";

const SOURCE = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}
Text.
\end{frame}
\end{document}`;
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>').buffer;
const original = getActiveEditorPlatform();
let nextId = 0;
afterEach(() => { setActiveEditorPlatform(original); useGraphicsNoticeStore.getState().dismiss(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const disk = new Map<string, ArrayBuffer>();
  const files = {
    listGraphicsFiles: vi.fn(async () => ({ files: [...disk].map(([path, bytes]) => ({ path: path.replace("/project/", ""), size: bytes.byteLength })), directories: [] })),
    readLocalAsset: vi.fn<NonNullable<PlatformFileApi["readLocalAsset"]>>(async path => {
      const bytes = disk.get(path);
      return bytes ? { status: "ok", path, bytesBase64: graphicBytesBase64(bytes), size: bytes.byteLength, revision: path } : { status: "missing", path };
    }),
    writeGraphicsFile: vi.fn<NonNullable<PlatformFileApi["writeGraphicsFile"]>>(async (path, bytes) => {
      if (disk.has(path)) return { status: "exists" };
      disk.set(path, bytes);
      return { status: "written", createdDirectories: [] };
    }),
    removeGraphicsFile: vi.fn(async (path: string) => { disk.delete(path); }),
    chooseGraphicsLocation: vi.fn<NonNullable<PlatformFileApi["chooseGraphicsLocation"]>>(async () => "/project/elsewhere/moved.svg"),
  };
  const platform: EditorPlatform = { id: `graphics-history-${++nextId}`, persistence: { load: () => null, save: () => {} }, files };
  setActiveEditorPlatform(platform);
  let state = editorReducer(makeInitialState(), { type: "CODE_EDITED", source: SOURCE });
  state = editorReducer(state, { type: "MARK_DOCUMENT_SAVED", fileRef: { kind: "file", provider: "desktop-fs", name: "slides.tex", path: "/project/slides.tex" } });
  const { snapshot } = await computeSnapshot({ id: `graphics-history-${nextId}`, documentId: state.activeDocumentId, kind: "render", source: SOURCE,
    activeRootId: "frame:0", sourceRevision: state.sourceRevision });
  state = editorReducer(state, { type: "SET_ACTIVE_ROOT", rootId: "frame:0" });
  state = editorReducer(state, { type: "COMPUTE_REQUESTED", requestId: "ready" });
  state = editorReducer(state, { type: "SNAPSHOT_READY", requestId: "ready", snapshot });
  const dispatch = (action: EditorAction) => { state = editorReducer(state, action); };
  const getState = () => state;
  const insert = () => insertDeckGraphics({ getState, dispatch, load: async () => ({ bytes: SVG, name: "test.svg", mimeType: "image/svg+xml" }) });
  expect(await insert()).toBe("applied");
  const notice = useGraphicsNoticeStore.getState().notice!;
  if (notice.kind === "error") throw new Error(notice.message);
  return { disk, files, getState, dispatch, notice };
}

async function expectResolved(fx: Awaited<ReturnType<typeof fixture>>) {
  const state = fx.getState();
  const graphics = await prepareDocumentGraphicsContext({ source: state.source, documentFileRef: state.documents[state.activeDocumentId]?.fileRef });
  expect(graphics.previewBundle.entries).toHaveLength(1);
  expect(graphics.previewBundle.entries[0].resolution.status).toBe("resolved");
}

describe("native image source history", () => {
  it("retains an inserted image through notice Undo and Redo", async () => {
    const fx = await fixture();
    undoGraphicsInsertion(fx.notice, fx.getState, fx.dispatch);
    expect(fx.getState().source).toBe(SOURCE);
    expect(fx.files.removeGraphicsFile).not.toHaveBeenCalled();
    fx.dispatch({ type: "REDO" });
    expect(fx.getState().source).toBe(fx.notice.sourceAfter);
    await expectResolved(fx);
  });

  it("retains both image locations through Undo and Redo of Change…", async () => {
    const fx = await fixture();
    await changeGraphicsLocation(fx.notice, fx.getState, fx.dispatch);
    expect(fx.getState().source).toContain("{elsewhere/moved.svg}");
    expect(fx.disk.has(fx.notice.absolutePath!)).toBe(true);
    await expectResolved(fx);
    const notice = useGraphicsNoticeStore.getState().notice!;
    if (notice.kind === "error") throw new Error(notice.message);
    undoGraphicsInsertion(notice, fx.getState, fx.dispatch);
    expect(fx.getState().source).toBe(fx.notice.sourceAfter);
    await expectResolved(fx);
    fx.dispatch({ type: "REDO" });
    expect(fx.getState().source).toContain("{elsewhere/moved.svg}");
    await expectResolved(fx);
  });

  it("cleans up an uncommitted new location after an intervening edit", async () => {
    const fx = await fixture();
    const started = deferred<void>();
    const finish = deferred<void>();
    fx.files.writeGraphicsFile.mockImplementationOnce(async (path, bytes) => {
      fx.disk.set(path, bytes);
      started.resolve();
      await finish.promise;
      return { status: "written", createdDirectories: [] };
    });
    const changing = changeGraphicsLocation(fx.notice, fx.getState, fx.dispatch);
    await started.promise;
    fx.dispatch({ type: "CODE_EDITED", source: fx.getState().source + "% newer" });
    const source = fx.getState().source;
    finish.resolve();
    await changing;
    expect(fx.getState().source).toBe(source);
    expect([...fx.disk.keys()]).toEqual([fx.notice.absolutePath]);
    await expectResolved(fx);
  });

  it.each(["cancel", "existing", "unreadable", "picker-error", "listing-error", "write-error"])("preserves the reference and original file after %s", async reason => {
    const fx = await fixture();
    if (reason === "cancel") fx.files.chooseGraphicsLocation.mockResolvedValueOnce(null);
    if (reason === "existing") fx.disk.set("/project/elsewhere/moved.svg", new ArrayBuffer(1));
    if (reason === "unreadable") fx.files.readLocalAsset.mockResolvedValueOnce({ status: "missing" });
    if (reason === "picker-error") fx.files.chooseGraphicsLocation.mockRejectedValueOnce(new Error("Picker failed"));
    if (reason === "listing-error") fx.files.listGraphicsFiles.mockRejectedValueOnce(new Error("Scan failed"));
    if (reason === "write-error") fx.files.writeGraphicsFile.mockRejectedValueOnce(new Error("Write failed"));
    await changeGraphicsLocation(fx.notice, fx.getState, fx.dispatch);
    expect(fx.getState().source).toBe(fx.notice.sourceAfter);
    expect(fx.disk.get(fx.notice.absolutePath!)).toBe(SVG);
    expect(fx.files.removeGraphicsFile).not.toHaveBeenCalled();
  });

  it.each(["source", "file-location", "platform"])("cancels a location picker made stale by a changed %s", async change => {
    const fx = await fixture();
    const picker = deferred<string>();
    fx.files.chooseGraphicsLocation.mockReturnValueOnce(picker.promise);
    const changing = changeGraphicsLocation(fx.notice, fx.getState, fx.dispatch);
    if (change === "source") fx.dispatch({ type: "CODE_EDITED", source: fx.getState().source + "% newer" });
    if (change === "file-location") fx.dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: { kind: "file", provider: "desktop-fs", name: "slides.tex", path: "/other/slides.tex" } });
    if (change === "platform") setActiveEditorPlatform({ ...getActiveEditorPlatform(), id: "different" });
    const source = fx.getState().source;
    picker.resolve("/project/elsewhere/moved.svg");
    await changing;
    expect(fx.getState().source).toBe(source);
    expect([...fx.disk.keys()]).toEqual([fx.notice.absolutePath]);
    expect(fx.files.writeGraphicsFile).toHaveBeenCalledTimes(1);
  });
});
