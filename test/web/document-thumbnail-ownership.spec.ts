/** @vitest-environment jsdom */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentThumbnails, type DocumentThumbnail, type DocumentThumbnailSource } from "../../packages/app/src/ui/ipad/useDocumentThumbnails";
import { requestThumbnail } from "../../packages/app/src/ui/workers/thumbnail-worker-client";

vi.mock("../../packages/app/src/ui/workers/thumbnail-worker-client", () => ({ requestThumbnail: vi.fn(), cancelGroup: vi.fn() }));

function Harness({ document, onUpdate }: { document: DocumentThumbnailSource; onUpdate: (value: ReadonlyMap<string, DocumentThumbnail>) => void }) {
  const thumbnails = useDocumentThumbnails([document], true);
  useEffect(() => { onUpdate(thumbnails); }, [onUpdate, thumbnails]);
  return null;
}

describe("document thumbnail ownership", () => {
  let root: Root;
  let host: HTMLDivElement;
  let latest: ReadonlyMap<string, DocumentThumbnail>;
  const onUpdate = (value: ReadonlyMap<string, DocumentThumbnail>) => { latest = value; };
  const source = "%".repeat(64) + "old" + "%".repeat(64);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    latest = new Map();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const render = async (document: DocumentThumbnailSource) => {
    await act(async () => { root.render(createElement(Harness, { document, onUpdate })); });
  };

  it("refreshes after equal-length edits in the middle of a document", async () => {
    const doc = { id: "interior-edit", source, activeRootId: "figure:0", deck: false, snapshotSvg: "<svg>old</svg>", snapshotSource: source, snapshotActiveRootId: "figure:0" };
    await render(doc);
    const next = source.replace("old", "new");
    await render({ ...doc, source: next, snapshotSource: next, snapshotSvg: "<svg>new</svg>" });
    expect(decodeURIComponent(latest.get(doc.id)!.url)).toContain("<svg>new</svg>");
  });

  it("refreshes when the active picture changes without a source edit", async () => {
    vi.mocked(requestThumbnail).mockImplementation(async request => ({ ...request, type: "result", ok: true, svg: `<svg>${request.parseOptions.activeRootId}</svg>` }));
    const doc = { id: "root-switch", source, activeRootId: "figure:0", deck: false, snapshotSvg: null, snapshotSource: null, snapshotActiveRootId: null };
    await render(doc);
    expect(decodeURIComponent(latest.get(doc.id)!.url)).toContain("figure:0");
    await render({ ...doc, activeRootId: "figure:1" });
    expect(requestThumbnail).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(latest.get(doc.id)!.url)).toContain("figure:1");
  });

  it("does not cache a previous root's current-source snapshot after navigation", async () => {
    vi.mocked(requestThumbnail).mockImplementation(async request => ({ ...request, type: "result", ok: true, svg: "<svg>new root</svg>" }));
    const doc = { id: "stale-root-snapshot", source, activeRootId: "figure:0", deck: false,
      snapshotSvg: "<svg>old root</svg>", snapshotSource: source, snapshotActiveRootId: "figure:0" };
    await render(doc);
    await render({ ...doc, activeRootId: "figure:1" });
    expect(requestThumbnail).toHaveBeenCalledOnce();
    expect(decodeURIComponent(latest.get(doc.id)!.url)).toContain("<svg>new root</svg>");
  });

  it("discards an old result after an equal-length edit supersedes it", async () => {
    let finishOld!: (svg: string) => void;
    vi.mocked(requestThumbnail).mockImplementationOnce(request => new Promise(resolve => {
      finishOld = svg => resolve({ ...request, type: "result", ok: true, svg });
    })).mockImplementation(async request => ({ ...request, type: "result", ok: true, svg: "<svg>new</svg>" }));
    const doc = { id: "late-interior-edit", source, activeRootId: "figure:0", deck: false, snapshotSvg: null, snapshotSource: null, snapshotActiveRootId: null };
    await render(doc);
    await render({ ...doc, source: source.replace("old", "new") });
    await act(async () => { finishOld("<svg>old</svg>"); });
    expect(decodeURIComponent(latest.get(doc.id)!.url)).toContain("<svg>new</svg>");
  });

  it.each([false, true])("refreshes and owns graphics after an asset revision changes (deck: %s)", async deck => {
    vi.mocked(requestThumbnail).mockImplementation(async request => ({ ...request, type: "result", ok: true, svg: `<svg>${request.graphicsPreviewBundleKey}</svg>` }));
    const bundle = { version: 1 as const, cacheKey: "old-assets", entries: [] };
    const doc = { id: `graphics-revision-${deck}`, source, activeRootId: "figure:0", deck, snapshotSvg: null,
      snapshotSource: null, snapshotActiveRootId: null, graphicsPreviewBundle: bundle };
    await render(doc);
    const nextBundle = { ...bundle, cacheKey: "new-assets" };
    await render({ ...doc, graphicsPreviewBundle: nextBundle });
    expect(requestThumbnail).toHaveBeenLastCalledWith(expect.objectContaining({ graphicsPreviewBundleKey: "new-assets" }), nextBundle);
    expect(decodeURIComponent(latest.get(doc.id)!.url)).toContain("new-assets");
  });
});
