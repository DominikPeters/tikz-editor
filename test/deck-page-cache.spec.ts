import { afterEach, describe, expect, it } from "vitest";
import { claimCachedDeckSnapshot, computeSnapshot, isDeckSnapshotCurrent, prewarmDeckNeighbors, cancelDeckPrewarm, type ComputeRequest } from "../packages/app/src/compute";
import { invalidateImageAssetPath } from "../packages/app/src/image-asset-cache";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../packages/app/src/platform/current";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer";
import { useEditorStore } from "../packages/app/src/store/store";
import { BoundedLru } from "../packages/app/src/bounded-lru";
import { deckPageDerived } from "../packages/app/src/deck-page-derived-cache";

let sequence = 0;
function request(): ComputeRequest {
  return { id: `page-cache-${++sequence}`, documentId: `cache-doc-${sequence}`, sourceRevision: 1,
    source: String.raw`\documentclass{beamer}\begin{document}
\begin{frame}{First}First.\pause Second step.\end{frame}
\begin{frame}{Second}Second.\pause Second step.\end{frame}
\begin{frame}{Third}Third.\end{frame}\end{document}` + `% ${sequence}`,
    activeRootId: "frame:0", deckStep: 1 };
}
afterEach(() => cancelDeckPrewarm());

describe("validated complete deck pages", () => {
  it("reuses SVG and layout together, and distinguishes overlay steps", async () => {
    const req = request(), result = await computeSnapshot(req);
    const hit = claimCachedDeckSnapshot(req)!;
    expect(hit.deck!.activeFrame).toBe(result.snapshot.deck!.activeFrame);
    expect(isDeckSnapshotCurrent(hit, req)).toBe(true);
    expect(claimCachedDeckSnapshot({ ...req, deckStep: 2 })).toBeNull();
    const second = await computeSnapshot({ ...req, deckStep: 2 });
    expect(claimCachedDeckSnapshot({ ...req, deckStep: 2 })!.deck!.activeFrame).toBe(second.snapshot.deck!.activeFrame);
    expect(isDeckSnapshotCurrent(hit, { ...req, deckStep: 2 })).toBe(false);
    const mixed = { ...hit, deck: { ...hit.deck!, activeFrame: { ...hit.deck!.activeFrame!, layout: second.snapshot.deck!.activeFrame!.layout } } };
    expect(isDeckSnapshotCurrent(mixed, req)).toBe(false);
  });
  it("misses for document, source, revision, file, mask, nested-root and asset changes", async () => {
    const req = request(); await computeSnapshot(req);
    for (const delta of [
      { documentId: "other" }, { source: req.source + "% edit" }, { sourceRevision: 2 },
      { documentFileRef: { kind: "file" as const, name: "new.tex", path: "/new/new.tex" } },
      { textEditMaskSpan: { from: 50, to: 55 } }, { activeRootId: "frame:0:tikzpicture:0" },
      { activeRootId: "frame:99" }
    ]) expect(claimCachedDeckSnapshot({ ...req, ...delta }), JSON.stringify(delta)).toBeNull();
    invalidateImageAssetPath("/test/cache-asset.svg");
    expect(claimCachedDeckSnapshot(req)).toBeNull();
  });
  it("misses after changing the platform's asset resolver", async () => {
    const original = getActiveEditorPlatform();
    const req = request(); await computeSnapshot(req);
    try {
      setActiveEditorPlatform({ ...original });
      expect(claimCachedDeckSnapshot(req)).toBeNull();
    } finally { setActiveEditorPlatform(original); }
  });
  it("keeps source validation separate from cache stamps", async () => {
    const req = request(), result = await computeSnapshot(req);
    expect(isDeckSnapshotCurrent({ ...result.snapshot, source: req.source + "different" }, req)).toBe(false);
  });
  it("recognizes a completed empty deck without requesting it again", async () => {
    const req = { ...request(), source: String.raw`\documentclass{beamer}\begin{document}\end{document}`, activeRootId: null };
    const result = await computeSnapshot(req);
    expect(result.snapshot.deck!.activeFrame).toBeNull();
    expect(isDeckSnapshotCurrent(result.snapshot, req)).toBe(true);
  });
});

describe("atomic cached navigation", () => {
  it("publishes one observer update containing the new root, SVG and hit geometry", async () => {
    useEditorStore.setState(makeInitialState());
    const dispatch = useEditorStore.getState().dispatch;
    const base = request(); dispatch({ type: "CODE_EDITED", source: base.source });
    const state = useEditorStore.getState();
    const req = { ...base, documentId: state.activeDocumentId, sourceRevision: state.sourceRevision };
    const first = await computeSnapshot(req);
    dispatch({ type: "COMPUTE_REQUESTED", requestId: req.id });
    dispatch({ type: "SNAPSHOT_READY", requestId: req.id, snapshot: first.snapshot });
    const second = await computeSnapshot({ ...req, activeRootId: "frame:1" });
    const seen: Array<[string | null, string | null, string | undefined]> = [];
    const unsubscribe = useEditorStore.subscribe(next => seen.push([next.activeRootId, next.snapshot.activeRootId, next.snapshot.deck?.activeFrame?.layout.frameId]));
    dispatch({ type: "SELECT_DECK_SLIDES", documentId: req.documentId, baseRevision: req.sourceRevision,
      frameIds: ["frame:1"], activeFrameId: "frame:1", anchorId: "frame:1" });
    unsubscribe();
    expect(seen).toEqual([["frame:1", "frame:1", "frame:1"]]);
    expect(useEditorStore.getState().snapshot.deck!.activeFrame).toBe(second.snapshot.deck!.activeFrame);
    expect(useEditorStore.getState().pendingRequestId).toBeNull();
    dispatch({ type: "SNAPSHOT_READY", requestId: req.id, snapshot: first.snapshot });
    expect(useEditorStore.getState().snapshot.deck!.activeFrame).toBe(second.snapshot.deck!.activeFrame);
  });
  it("rejects a current request carrying geometry from another frame", async () => {
    const req = request(), first = await computeSnapshot(req);
    const second = await computeSnapshot({ ...req, activeRootId: "frame:1" });
    let state = makeInitialState();
    state = editorReducer(state, { type: "CODE_EDITED", source: req.source });
    state = editorReducer(state, { type: "SET_ACTIVE_ROOT", rootId: "frame:1" });
    state = editorReducer(state, { type: "COMPUTE_REQUESTED", requestId: "mixed" });
    const mixed = { ...second.snapshot, deck: { ...second.snapshot.deck!, activeFrame: {
      ...second.snapshot.deck!.activeFrame!, layout: first.snapshot.deck!.activeFrame!.layout } } };
    expect(editorReducer(state, { type: "SNAPSHOT_READY", requestId: "mixed", snapshot: mixed }).snapshot).toBe(state.snapshot);
  });
});

describe("bounded retention and derived page data", () => {
  it("evicts least-recent entries, obeys byte limits, and isolates transactional forks", () => {
    const cache = new BoundedLru<string, number>(2, 10);
    cache.set("a", 1, 4); cache.set("b", 2, 4); cache.get("a"); cache.set("c", 3, 4);
    expect(cache.get("b")).toBeUndefined();
    const fork = cache.fork(); fork.set("d", 4, 7);
    expect(fork.size).toBe(1); expect(fork.retainedBytes).toBe(7);
    expect(cache.get("a")).toBe(1);
    fork.set("huge", 5, 11); expect(fork.get("huge")).toBeUndefined();
  });
  it("reuses immutable interaction data when revisiting a page, and invalidates changed source", async () => {
    const req = request(), a = (await computeSnapshot(req)).snapshot.deck!.activeFrame!;
    const b = (await computeSnapshot({ ...req, activeRootId: "frame:1" })).snapshot.deck!.activeFrame!;
    let builds = 0;
    const value = deckPageDerived(a, req.source, "test", () => ({ id: ++builds }));
    deckPageDerived(b, req.source, "test", () => ({ id: ++builds }));
    expect(deckPageDerived(a, req.source, "test", () => ({ id: ++builds }))).toBe(value);
    expect(builds).toBe(2);
    expect(deckPageDerived(a, req.source + "edited", "test", () => ({ id: ++builds }))).not.toBe(value);
  });
});

describe("neighbor warming ownership", () => {
  it("warms neighbors without publishing a different active slide", async () => {
    const req = request(), first = await computeSnapshot(req), saved = JSON.stringify(first.snapshot);
    const beforeState = useEditorStore.getState();
    await prewarmDeckNeighbors(req, { yieldControl: async () => {} });
    expect(useEditorStore.getState()).toBe(beforeState);
    expect(claimCachedDeckSnapshot({ ...req, activeRootId: "frame:1" })?.deck?.activeFrame?.layout.frameId).toBe("frame:1");
    expect(JSON.stringify(first.snapshot)).toBe(saved);
  });
  it("foreground work cancels a suspended neighbor and no incomplete page leaks", async () => {
    const req = request(); await computeSnapshot(req);
    let resume!: () => void, started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const paused = new Promise<void>(resolve => { resume = resolve; });
    const warming = prewarmDeckNeighbors(req, { budgetMs: 0, yieldControl: async () => { started(); await paused; } });
    await entered;
    expect(claimCachedDeckSnapshot({ ...req, activeRootId: "frame:1" })).toBeNull();
    await computeSnapshot({ ...req, activeRootId: "frame:2" });
    resume(); await warming;
    expect(claimCachedDeckSnapshot({ ...req, activeRootId: "frame:1" })).toBeNull();
    expect(claimCachedDeckSnapshot({ ...req, activeRootId: "frame:2" })).not.toBeNull();
  });
  it("asset invalidation during a warm render prevents cache publication", async () => {
    const req = request(); await computeSnapshot(req);
    await prewarmDeckNeighbors(req, { budgetMs: 0, yieldControl: async () => { invalidateImageAssetPath("/changed.svg"); } });
    expect(claimCachedDeckSnapshot({ ...req, activeRootId: "frame:1" })).toBeNull();
  });
});
