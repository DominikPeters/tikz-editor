import { afterEach, describe, expect, it, vi } from "vitest";
import { pt, worldPoint } from "@tikz-editor/core/coords/index";
import { computeSnapshot } from "../../packages/app/src/compute.js";
import { editorReducer, makeInitialState } from "../../packages/app/src/store/reducer.js";
import type { EditorAction } from "../../packages/app/src/store/types.js";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../../packages/app/src/platform/current.js";
import type { EditorPlatform, PlatformFileApi } from "../../packages/app/src/platform/types.js";
import {
  graphicsInsertionTarget, insertTikzGraphics, tikzInsertionWidthCm, undoGraphicsInsertion, useGraphicsNoticeStore
} from "../../packages/app/src/ui/deck-graphics-insertion.js";
import { graphicBytesBase64 } from "../../packages/app/src/imported-graphics.js";
import { prepareDocumentGraphicsContext } from "../../packages/app/src/image-asset-cache.js";

const SOURCE = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1);
\end{tikzpicture}`;
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
  };
  const platform: EditorPlatform = { id: `tikz-graphics-${++nextId}`, persistence: { load: () => null, save: () => {} }, files };
  setActiveEditorPlatform(platform);
  let state = editorReducer(makeInitialState(), { type: "CODE_EDITED", source: SOURCE });
  state = editorReducer(state, { type: "MARK_DOCUMENT_SAVED", fileRef: { kind: "file", provider: "desktop-fs", name: "figure.tex", path: "/project/figure.tex" } });
  const { snapshot } = await computeSnapshot({ id: `tikz-graphics-${nextId}`, documentId: state.activeDocumentId, kind: "render", source: SOURCE,
    activeRootId: null, sourceRevision: state.sourceRevision });
  state = editorReducer(state, { type: "COMPUTE_REQUESTED", requestId: "ready" });
  state = editorReducer(state, { type: "SNAPSHOT_READY", requestId: "ready", snapshot });
  const dispatch = (action: EditorAction) => { state = editorReducer(state, action); };
  const getState = () => state;
  const load = async () => ({ bytes: SVG, name: "photo.svg", mimeType: "image/svg+xml" });
  return { disk, files, getState, dispatch, load };
}

describe("image insertion in a TikZ figure", () => {
  it("targets the figure, not a slide", async () => {
    const fx = await fixture();
    const state = fx.getState();
    expect(graphicsInsertionTarget({ snapshot: state.snapshot, activeRootId: state.activeRootId, drawingLayerRootId: null })).toBe("figure");
  });

  it("adds a node holding the image, saved beside the document", async () => {
    const fx = await fixture();
    const at = worldPoint(pt(2 * 28.452756), pt(28.452756));
    const outcome = await insertTikzGraphics({ getState: fx.getState, dispatch: fx.dispatch, at, load: fx.load });
    expect(outcome).toBe("applied");
    const source = fx.getState().source;
    expect(source).toContain(String.raw`\node[inner sep=0pt] at (2,1) {\includegraphics[width=5cm]{figures/photo.svg}};`);
    expect([...fx.disk.keys()]).toEqual(["/project/figures/photo.svg"]);
    const graphics = await prepareDocumentGraphicsContext({ source, documentFileRef: fx.getState().documents[fx.getState().activeDocumentId]?.fileRef });
    expect(graphics.previewBundle.entries).toHaveLength(1);
    expect(graphics.previewBundle.entries[0].resolution.status).toBe("resolved");

    const notice = useGraphicsNoticeStore.getState().notice!;
    if (notice.kind === "error") throw new Error(notice.message);
    expect(notice.sourceAfter).toBe(source);
    undoGraphicsInsertion(notice, fx.getState, fx.dispatch);
    expect(fx.getState().source).toBe(SOURCE);
  });

  it("removes the written file when the document changed meanwhile", async () => {
    const fx = await fixture();
    const loading = deferred<void>();
    const inserting = insertTikzGraphics({ getState: fx.getState, dispatch: fx.dispatch, at: null, load: async () => { await loading.promise; return fx.load(); } });
    fx.dispatch({ type: "CODE_EDITED", source: `${SOURCE}% newer` });
    loading.resolve();
    expect(await inserting).toBe("stale");
    expect(fx.getState().source).toBe(`${SOURCE}% newer`);
    expect(fx.disk.size).toBe(0);
  });
});

describe("tikzInsertionWidthCm", () => {
  it("keeps a small image's natural size", () => {
    expect(tikzInsertionWidthCm({ pixelSize: { width: 100, height: 80 } })).toBeUndefined();
  });

  it("fits a photo into 6cm by 5cm", () => {
    expect(tikzInsertionWidthCm({ pixelSize: { width: 4000, height: 3000 } })).toBe(6);
    expect(tikzInsertionWidthCm({ pixelSize: { width: 1000, height: 2000 } })).toBe(2.5);
  });

  it("gives unknown sizes a moderate width", () => {
    expect(tikzInsertionWidthCm({ pixelSize: null })).toBe(5);
  });
});
