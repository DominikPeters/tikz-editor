import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invalidateImageAssetPath, prepareDocumentGraphicsContext } from "../packages/app/src/image-asset-cache";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../packages/app/src/platform/current";
import type { LocalAssetReadResult } from "../packages/app/src/platform/types";
import { setPdfAssetRasterizerForTests, type PdfAssetRasterizer } from "../packages/app/src/pdf-asset-rasterizer";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}
const previous = getActiveEditorPlatform();
let restoreRasterizer: (() => void) | undefined;
afterEach(() => { restoreRasterizer?.(); restoreRasterizer = undefined; setActiveEditorPlatform(previous); });
const source = String.raw`\begin{tikzpicture}\node {\includegraphics{fig.svg}};\end{tikzpicture}`;
const fileRef = (directory: string) => ({ kind: "file" as const, name: "main.tex", provider: "desktop-fs" as const, path: `${directory}/main.tex` });
function svgRead(path: string, revision: string): LocalAssetReadResult {
  return { status: "ok", path, revision, size: 100,
    bytesBase64: Buffer.from(`<svg width="10pt" height="5pt"><rect width="10" height="5" fill="${revision}"/></svg>`).toString("base64") };
}
function installReader(readLocalAsset: (path: string) => Promise<LocalAssetReadResult>) {
  setActiveEditorPlatform({ id: "asset-race", persistence: { load: () => null, save() {} }, files: { readLocalAsset } });
}

describe("image asset read ownership", () => {
  for (const variant of ["resolved", "old-missing", "new-missing"] as const) {
    it(`retires an older ${variant} read even before a cache entry exists`, async () => {
      const directory = `/tmp/asset-race-${variant}`;
      const requestedPath = `${directory}/fig.svg`;
      const path = requestedPath;
      const old = deferred<LocalAssetReadResult>();
      const began = deferred<void>();
      const latest = variant === "new-missing" ? { status: "missing" as const, path } : svgRead(path, "blue");
      const read = vi.fn(async () => {
        if (read.mock.calls.length === 1) { began.resolve(); return await old.promise; }
        return latest;
      });
      installReader(read);
      const params = { source, documentFileRef: fileRef(directory) };
      const older = prepareDocumentGraphicsContext(params);
      await began.promise;
      invalidateImageAssetPath(path);
      const newer = await prepareDocumentGraphicsContext(params);
      old.resolve(variant === "old-missing" ? { status: "missing", path } : svgRead(path, "red"));
      await older;
      const reused = await prepareDocumentGraphicsContext(params);
      expect(read).toHaveBeenCalledTimes(2);
      expect(reused.previewBundle.entries).toEqual(newer.previewBundle.entries);
      expect(reused.previewBundle.cacheKey).toBe(newer.previewBundle.cacheKey);
    });
  }

  it("coalesces concurrent same-generation reads and retains the completed cache", async () => {
    const path = "/tmp/asset-race-coalesce/fig.svg";
    const pending = deferred<LocalAssetReadResult>();
    const read = vi.fn(async () => pending.promise);
    installReader(read);
    const params = { source, documentFileRef: fileRef("/tmp/asset-race-coalesce") };
    const first = prepareDocumentGraphicsContext(params);
    const second = prepareDocumentGraphicsContext(params);
    expect(read).toHaveBeenCalledOnce();
    pending.resolve(svgRead(path, "blue"));
    const [a, b] = await Promise.all([first, second]);
    const c = await prepareDocumentGraphicsContext(params);
    expect(read).toHaveBeenCalledOnce();
    expect(b.previewBundle).toEqual(a.previewBundle);
    expect(c.previewBundle).toEqual(a.previewBundle);
  });

  it("invalidates extensionless candidates together without restoring old missing entries", async () => {
    const directory = "/tmp/asset-race-extensionless";
    const pending = deferred<LocalAssetReadResult>();
    let first = true;
    const read = vi.fn(async (path: string): Promise<LocalAssetReadResult> => {
      if (first) { first = false; return await pending.promise; }
      return path.endsWith(".svg") ? svgRead(path, "blue") : { status: "missing", path };
    });
    installReader(read);
    const params = { source: source.replace("fig.svg", "fig"), documentFileRef: fileRef(directory) };
    const older = prepareDocumentGraphicsContext(params);
    invalidateImageAssetPath(`${directory}/fig.svg`);
    const newer = await prepareDocumentGraphicsContext(params);
    pending.resolve({ status: "missing", path: `${directory}/fig.png` });
    await older;
    const cached = await prepareDocumentGraphicsContext(params);
    expect(read).toHaveBeenCalledTimes(5);
    expect(cached.previewBundle.entries).toEqual(newer.previewBundle.entries);
    expect(cached.previewBundle.entries[0].resolution.status).toBe("resolved");
  });

  for (const variant of ["read", "rasterization", "failed-rasterization"] as const) {
    it(`retires obsolete PDF ${variant} results for every page variant`, async () => {
      const directory = `/tmp/pdf-asset-race-${variant}`;
      const path = `${directory}/fig.pdf`;
      const oldRead = deferred<LocalAssetReadResult>();
      const oldRaster = deferred<Awaited<ReturnType<PdfAssetRasterizer>>>();
      const began = deferred<void>();
      const raster = (label: string, page: number): Awaited<ReturnType<PdfAssetRasterizer>> => ({
        mimeType: "image/png", dataBase64: `${label}-page-${page}`, naturalWidthPt: 10 * page,
        naturalHeightPt: 5, renderScale: 2, pixelWidth: 20 * page, pixelHeight: 10, signature: `${label}:${page}`
      });
      restoreRasterizer = setPdfAssetRasterizerForTests(async ({ bytes, pageNumber }) => {
        const label = Buffer.from(bytes).toString();
        if (label === "red" && variant !== "read") {
          began.resolve();
          await oldRaster.promise;
          if (variant === "failed-rasterization") throw new Error("Obsolete PDF failed");
        }
        return raster(label, pageNumber);
      });
      const result = (label: string): LocalAssetReadResult => ({ status: "ok", path, revision: label, size: 3, bytesBase64: Buffer.from(label).toString("base64") });
      const read = vi.fn(async () => {
        if (read.mock.calls.length === 1) {
          if (variant === "read") { began.resolve(); return await oldRead.promise; }
          return result("red");
        }
        return result("blue");
      });
      installReader(read);
      const params = { source: source.replace("fig.svg", "fig.pdf"), documentFileRef: fileRef(directory) };
      const older = prepareDocumentGraphicsContext(params);
      await began.promise;
      invalidateImageAssetPath(path);
      const newer = await prepareDocumentGraphicsContext(params);
      oldRead.resolve(result("red"));
      oldRaster.resolve(raster("red", 1));
      await older;
      const cached = await prepareDocumentGraphicsContext(params);
      expect(read).toHaveBeenCalledTimes(2);
      expect(cached.previewBundle.entries).toEqual(newer.previewBundle.entries);
      const pageTwo = await prepareDocumentGraphicsContext({ ...params, source: params.source.replace("\\includegraphics", "\\includegraphics[page=2]") });
      expect(pageTwo.previewBundle.entries[0].resolution).toMatchObject({ status: "resolved", dataBase64: "blue-page-2" });
    });
  }

  it("does not retain a rejected read as an in-flight cache entry", async () => {
    const path = "/tmp/asset-race-rejected/fig.svg";
    const read = vi.fn().mockRejectedValueOnce(new Error("Read failed")).mockResolvedValue(svgRead(path, "blue"));
    installReader(read);
    const params = { source, documentFileRef: fileRef("/tmp/asset-race-rejected") };
    await expect(prepareDocumentGraphicsContext(params)).rejects.toThrow("Read failed");
    expect((await prepareDocumentGraphicsContext(params)).previewBundle.entries[0].resolution.status).toBe("resolved");
    expect(read).toHaveBeenCalledTimes(2);
  });
});
