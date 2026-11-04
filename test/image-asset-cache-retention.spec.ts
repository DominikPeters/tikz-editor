import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDocumentGraphicsPreviewBundle, invalidateImageAssetPath, prepareDocumentGraphicsContext } from "../packages/app/src/image-asset-cache";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../packages/app/src/platform/current";

// Exercise real eviction with a small budget instead of allocating large images
// just to cross the production limits.
vi.mock("../packages/app/src/bounded-lru", async (importOriginal) => {
  const original = await importOriginal<typeof import("../packages/app/src/bounded-lru")>();
  return { BoundedLru: class<K, V> extends original.BoundedLru<K, V> {
    constructor(entries: number, bytes: number, retainOversize = false) {
      super(Math.min(entries, 4), Math.min(bytes, 8192), retainOversize);
    }
  } };
});

const previous = getActiveEditorPlatform();
afterEach(() => setActiveEditorPlatform(previous));
let sequence = 0;
function install() {
  const prefix = `/cache-retention-${++sequence}`;
  const read = vi.fn(async (path: string) => ({ status: "ok" as const, path, revision: "1", size: 100,
    bytesBase64: Buffer.from(`<svg width="10pt" height="5pt">${" ".repeat(path.includes("large") ? 3200 : path.includes("medium") ? 1000 : 100)}</svg>`).toString("base64") }));
  setActiveEditorPlatform({ id: "cache-retention", persistence: { load: () => null, save() {} }, files: { readLocalAsset: read } });
  const prepare = (name: string) => prepareDocumentGraphicsContext({ source: `\\includegraphics{${prefix}/${name}.svg}` });
  return { read, prepare, prefix };
}

describe("image cache retention", () => {
  it("reuses hot assets while evicting old files after enough documents are opened", async () => {
    const { read, prepare } = install();
    const first = await prepare("a");
    await prepare("b"); await prepare("c"); await prepare("d");
    await prepare("a"); // Refresh both the file and its preview bundle.
    await prepare("e");
    expect(getDocumentGraphicsPreviewBundle(first.previewBundle.cacheKey)).toEqual(first.previewBundle);
    expect(read).toHaveBeenCalledTimes(5);
    await prepare("b");
    expect(read).toHaveBeenCalledTimes(6);
  });

  it("bounds image payloads before reaching the entry limit", async () => {
    const { read, prepare } = install();
    const first = await prepare("medium-a");
    await prepare("medium-b"); await prepare("medium-c");
    expect(getDocumentGraphicsPreviewBundle(first.previewBundle.cacheKey)).toBeNull();
    await prepare("medium-a");
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("retains one oversized current asset/bundle for repeated edits, then releases it", async () => {
    const { read, prepare } = install();
    const large = await prepare("large");
    expect(getDocumentGraphicsPreviewBundle(large.previewBundle.cacheKey)).toBe(large.previewBundle);
    await prepare("large");
    expect(read).toHaveBeenCalledOnce();
    await prepare("small");
    expect(getDocumentGraphicsPreviewBundle(large.previewBundle.cacheKey)).toBeNull();
    await prepare("large");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("invalidates entries without disturbing unrelated cached files or byte accounting", async () => {
    const { read, prepare, prefix } = install();
    await prepare("a"); await prepare("b");
    invalidateImageAssetPath(`${prefix}/a.svg`);
    await prepare("b");
    expect(read).toHaveBeenCalledTimes(2);
    await prepare("a");
    expect(read).toHaveBeenCalledTimes(3);
    await prepare("c"); await prepare("d"); await prepare("a");
    expect(read).toHaveBeenCalledTimes(5);
  });
});
