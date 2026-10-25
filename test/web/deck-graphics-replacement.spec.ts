import { afterEach, describe, expect, it, vi } from "vitest";
import { computeSnapshot } from "../../packages/app/src/compute.js";
import { editorReducer, makeInitialState } from "../../packages/app/src/store/reducer.js";
import { buildBeamerObjectIndex } from "../../packages/core/src/beamer/index.js";
import { replaceSelectedDeckGraphics } from "../../packages/app/src/ui/deck-graphics-replacement.js";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../../packages/app/src/platform/current.js";
import type { EditorPlatform, PlatformFileApi } from "../../packages/app/src/platform/types.js";
import { prepareDocumentGraphicsContext, invalidateImageAssetPath } from "../../packages/app/src/image-asset-cache.js";
import { replacementGraphicPath } from "../../packages/app/src/imported-graphics.js";
import { deckStepRootKey } from "../../packages/app/src/root-key.js";

const SOURCE = String.raw`\documentclass{beamer}\begin{document}\begin{frame}\includegraphics[width=.5\textwidth,trim=1 2 3 4,clip,page=3]{old.pdf}\end{frame}\end{document}`;
type Opened = NonNullable<Awaited<ReturnType<NonNullable<PlatformFileApi["openBinary"]>>>>;
const original = getActiveEditorPlatform();
afterEach(() => { setActiveEditorPlatform(original); vi.restoreAllMocks(); });
const svg = () => ({ bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/></svg>').buffer,
  fileRef: { kind: "file" as const, provider: "download" as const, name: "Replacement.svg" } });
let nextId = 0;
async function fixture(pick: NonNullable<PlatformFileApi["openBinary"]>) {
  const saved = new Map<string, string>();
  const platform: EditorPlatform = { id: `graphic-${++nextId}`, persistence: { load: key => saved.get(key) ?? null, save: (key, value) => { saved.set(key, value); } }, files: { openBinary: pick } };
  setActiveEditorPlatform(platform);
  let state = editorReducer(makeInitialState(), { type: "CODE_EDITED", source: SOURCE });
  const { snapshot } = await computeSnapshot({ id: `graphics-${nextId}`, documentId: state.activeDocumentId, kind: "render", source: SOURCE, activeRootId: "frame:0", sourceRevision: state.sourceRevision });
  state = editorReducer(state, { type: "SET_ACTIVE_ROOT", rootId: "frame:0" });
  state = editorReducer(state, { type: "COMPUTE_REQUESTED", requestId: "ready" });
  state = editorReducer(state, { type: "SNAPSHOT_READY", requestId: "ready", snapshot });
  const frame = snapshot.deck?.activeFrame;
  if (!frame) throw new Error("Missing frame");
  const node = buildBeamerObjectIndex({ items: frame.layout.items, paragraphs: frame.layout.paragraphs, source: SOURCE }).nodes.find(node => node.kind === "graphics");
  if (!node) throw new Error("Missing image");
  state = editorReducer(state, { type: "SET_DECK_OBJECT_SELECTION", frameId: frame.frameId, objectId: node.id });
  const rememberSelection = vi.fn();
  const dispatch = vi.fn((action: Parameters<typeof editorReducer>[1]) => { state = editorReducer(state, action); });
  return { getState: () => state, dispatch, rememberSelection, platform, saved, setState: (next: typeof state) => { state = next; } };
}

describe("deferred image replacement", () => {
  it("persists a browser asset, renders it after cache invalidation and records one undo step", async () => {
    const pick = vi.fn(async () => svg());
    const fx = await fixture(pick);
    expect(await replaceSelectedDeckGraphics(fx)).toEqual({ status: "applied" });
    expect(pick).toHaveBeenCalledWith({ kind: "graphics", addToRecent: false });
    const source = fx.getState().source;
    expect(source).toContain("width=.5\\textwidth,trim=1 2 3 4,clip");
    expect(source).not.toContain("page=");
    const path = /\{(__tikz_assets__\/[^}]+)\}/u.exec(source)?.[1];
    if (!path) throw new Error("Missing imported filename");
    expect(fx.saved.size).toBe(1);
    invalidateImageAssetPath(path);
    setActiveEditorPlatform({ ...fx.platform, id: "reload" });
    const graphics = await prepareDocumentGraphicsContext({ source });
    expect(graphics.previewBundle.entries[0]?.resolution.status).toBe("resolved");
    expect(fx.rememberSelection).toHaveBeenCalledOnce();
    const undone = editorReducer(fx.getState(), { type: "UNDO" });
    expect(undone.source).toBe(SOURCE);
    expect(editorReducer(undone, { type: "REDO" }).source).toBe(source);
  });

  it("leaves source, selection, assets and history unchanged on cancellation", async () => {
    const fx = await fixture(async () => null);
    const before = fx.getState();
    expect(await replaceSelectedDeckGraphics(fx)).toEqual({ status: "cancelled" });
    expect(fx.getState()).toBe(before);
    expect(fx.dispatch).not.toHaveBeenCalled();
    expect(fx.saved.size).toBe(0);
  });

  it.each(["source", "selection", "step", "root", "platform"])("rejects a stale %s before importing or committing", async change => {
    let resolve: (opened: Opened) => void = () => {};
    const pending = new Promise<Opened>(done => { resolve = done; });
    const fx = await fixture(async () => pending);
    const operation = replaceSelectedDeckGraphics(fx);
    if (change === "source") fx.setState(editorReducer(fx.getState(), { type: "CODE_EDITED", source: SOURCE + "% newer" }));
    if (change === "selection") fx.setState(editorReducer(fx.getState(), { type: "SET_DECK_OBJECT_SELECTION", frameId: "frame:0", objectId: null }));
    if (change === "root") fx.setState(editorReducer(fx.getState(), { type: "SET_ACTIVE_ROOT", rootId: "frame:1" }));
    if (change === "platform") setActiveEditorPlatform({ ...fx.platform, id: "different-platform" });
    if (change === "step") fx.setState({ ...fx.getState(), deckStepByRootKey: { [deckStepRootKey(fx.getState().activeDocumentId, "frame:0")]: 2 } });
    resolve(svg());
    expect(await operation).toEqual({ status: "stale" });
    expect(fx.dispatch).not.toHaveBeenCalled();
    expect(fx.saved.size).toBe(0);
  });

  it.each(["picker", "storage", "format"])("leaves history unchanged after a %s failure", async failure => {
    const fx = await fixture(async () => {
      if (failure === "picker") throw new Error("Read failed");
      const file = svg();
      return failure === "format" ? { ...file, fileRef: { ...file.fileRef, name: "invalid.gif" } } : file;
    });
    if (failure === "storage") fx.platform.persistence.save = () => { throw new Error("Storage is full"); };
    const before = fx.getState();
    expect(await replaceSelectedDeckGraphics(fx)).toMatchObject({ status: "failed" });
    expect(fx.getState()).toBe(before);
    expect(fx.dispatch).not.toHaveBeenCalled();
  });

  it("uses a native file reference without storing an embedded copy", async () => {
    const fx = await fixture(async () => ({ ...svg(), fileRef: { kind: "file", provider: "desktop-fs", name: "image.png", path: "/tmp/images/image.png" } }));
    expect(await replaceSelectedDeckGraphics(fx)).toEqual({ status: "applied" });
    expect(fx.getState().source).toContain("{/tmp/images/image.png}");
    expect(fx.saved.size).toBe(0);
  });

  it("does not commit after the source changes during asynchronous asset storage", async () => {
    const fx = await fixture(async () => svg());
    let done: () => void = () => {};
    const stored = new Promise<void>(resolve => { done = resolve; });
    let began: () => void = () => {};
    const started = new Promise<void>(resolve => { began = resolve; });
    if (!fx.platform.files) throw new Error("Missing file API");
    fx.platform.files.storeGraphicAsset = async () => { began(); await stored; };
    const operation = replaceSelectedDeckGraphics(fx);
    await started;
    fx.setState(editorReducer(fx.getState(), { type: "CODE_EDITED", source: SOURCE + "% new edit" }));
    done();
    expect(await operation).toEqual({ status: "stale" });
    expect(fx.dispatch).not.toHaveBeenCalled();
  });
});

describe("native replacement paths", () => {
  it.each([
    ["/project/images/new.png", "/project/slides.tex", "images/new.png"],
    ["/images/new.png", "/project/slides.tex", "../images/new.png"],
    ["C:\\Deck\\images\\new.png", "c:\\deck\\slides.tex", "images/new.png"],
    ["D:\\new.png", "C:\\deck\\slides.tex", "D:/new.png"],
    ["\\\\server\\share\\new.png", "\\\\other\\share\\slides.tex", "//server/share/new.png"],
  ])("makes %s relative to %s when possible", (path, document, expected) => {
    expect(replacementGraphicPath({ kind: "file", provider: "desktop-fs", name: "new.png", path }, { kind: "file", provider: "desktop-fs", name: "slides.tex", path: document })).toBe(expected);
  });
});
