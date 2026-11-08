import { Buffer } from "node:buffer";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeSnapshot, type SessionSnapshot } from "../packages/app/src/compute";
import { getDocumentGraphicsPreviewBundle, prepareDocumentGraphicsContext } from "../packages/app/src/image-asset-cache";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../packages/app/src/platform/current";
import { requestThumbnail } from "../packages/app/src/ui/workers/thumbnail-worker-client";
import { DeckCropOverlay } from "../packages/app/src/ui/canvas-panel/DeckCropOverlay";
import { beamerImageCropTarget } from "../packages/core/src/beamer/index";

const store = vi.hoisted(() => ({ snapshot: null as SessionSnapshot | null }));
vi.mock("../packages/app/src/store/store", () => ({
  useEditorStore: (selector: (state: typeof store) => unknown) => selector(store)
}));

const previousPlatform = getActiveEditorPlatform();
afterEach(() => { setActiveEditorPlatform(previousPlatform); vi.unstubAllGlobals(); });

describe("snapshot graphics ownership", () => {
  it("keeps a live snapshot's thumbnail assets after reusable bundle eviction", async () => {
    vi.stubGlobal("Worker", undefined);
    const payload = Buffer.from('<svg width="10pt" height="5pt"><rect width="10" height="5" fill="red"/></svg>').toString("base64");
    setActiveEditorPlatform({ id: "snapshot-lifetime", persistence: { load: () => null, save() {} }, files: {
      readLocalAsset: async path => ({ status: "ok", path, revision: path, size: 100, bytesBase64: payload })
    } });
    const source = String.raw`\begin{tikzpicture}\node {\includegraphics{/snapshot-lifetime/original.svg}};\end{tikzpicture}`;
    const { snapshot } = await computeSnapshot({ id: "snapshot-lifetime", documentId: "snapshot-lifetime", source });
    for (let index = 0; index < 10; index++) {
      await prepareDocumentGraphicsContext({ source: `\\includegraphics{/snapshot-lifetime/other-${index}.svg}` });
    }
    expect(getDocumentGraphicsPreviewBundle(snapshot.graphicsPreviewBundleKey!)).toBeNull();
    expect(structuredClone(snapshot.graphicsPreviewBundle)).toEqual(snapshot.graphicsPreviewBundle);
    const result = await requestThumbnail({ type: "render", requestId: "snapshot-owned", groupId: "snapshot-owned",
      source, figureId: "figure:0", figureSignature: "snapshot-owned",
      graphicsPreviewBundleKey: snapshot.graphicsPreviewBundleKey!,
      parseOptions: { activeRootId: "figure:0", includeContextDefinitions: true } }, snapshot.graphicsPreviewBundle!);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.svg.includes(`base64,${payload}`)).toBe(true);
  });

  it("keeps the crop ghost's original image bytes after another document evicts its bundle", async () => {
    const payload = Buffer.from('<svg width="20pt" height="10pt"><rect width="20" height="10" fill="blue"/></svg>').toString("base64");
    setActiveEditorPlatform({ id: "crop-lifetime", persistence: { load: () => null, save() {} }, files: {
      readLocalAsset: async path => ({ status: "ok", path, revision: path, size: 100, bytesBase64: payload })
    } });
    const source = String.raw`\documentclass{beamer}\begin{document}\begin{frame}
\includegraphics[trim=1pt 0 0 0,clip]{/crop-lifetime/original.svg}
\end{frame}\end{document}`;
    const { snapshot } = await computeSnapshot({ id: "crop-lifetime", documentId: "crop-lifetime", source, activeRootId: "frame:0" });
    const layout = snapshot.deck!.activeFrame!.layout;
    const target = beamerImageCropTarget(source, layout, layout.graphics[0].itemId)!;
    expect(target).not.toBeNull();
    for (let index = 0; index < 10; index++) {
      await prepareDocumentGraphicsContext({ source: `\\includegraphics{/crop-lifetime/other-${index}.svg}` });
    }
    expect(getDocumentGraphicsPreviewBundle(snapshot.graphicsPreviewBundleKey!)).toBeNull();
    store.snapshot = snapshot;
    const markup = renderToStaticMarkup(createElement("svg", null, createElement(DeckCropOverlay, {
      layout, target, scale: 1, begin() {}, onKeyDown() {}
    })));
    expect(markup.includes('data-testid="deck-crop-ghost"')).toBe(true);
    expect(markup.includes(`base64,${payload}`)).toBe(true);
  });
});
