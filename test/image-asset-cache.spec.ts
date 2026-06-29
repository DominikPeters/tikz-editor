import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { invalidateImageAssetPath, prepareImageAssetResolver } from "../packages/app/src/image-asset-cache.js";
import { setPdfAssetRasterizerForTests, type PdfAssetRasterizer } from "../packages/app/src/pdf-asset-rasterizer.js";
import { setActiveEditorPlatform } from "../packages/app/src/platform/current.js";
import type { EditorPlatform } from "../packages/app/src/platform/types.js";
import type { DocumentFileRef } from "../packages/app/src/store/types.js";

function setTestPlatform(platform: Partial<EditorPlatform>): void {
  setActiveEditorPlatform({
    id: "test-platform",
    persistence: {
      load: () => null,
      save: () => {},
    },
    ...platform,
  });
}

describe("image asset cache", () => {
  let restorePdfRasterizer: (() => void) | null = null;

  beforeEach(() => {
    restorePdfRasterizer?.();
    restorePdfRasterizer = null;
  });

  afterEach(() => {
    restorePdfRasterizer?.();
    restorePdfRasterizer = null;
  });

  it("returns placeholders when the active platform has no local asset reader", async () => {
    setTestPlatform({});

    const resolver = await prepareImageAssetResolver({
      source: String.raw`\node {\includegraphics{fig}};`,
      documentFileRef: null,
    });
    const resolution = resolver.resolve({
      filename: "fig",
      options: {},
      source: String.raw`\includegraphics{fig}`,
      sourceStart: 0,
      sourceEnd: 21,
    });

    expect(resolution.status).toBe("missing");
  });

  it("resolves extensionless desktop assets by the first supported existing candidate", async () => {
    const documentFileRef: DocumentFileRef = {
      kind: "file",
      name: "main.tex",
      path: "/tmp/tikz/main.tex",
      provider: "desktop-fs",
    };
    const svgBase64 = Buffer.from('<svg width="10pt" height="5pt" viewBox="0 0 10 5"></svg>').toString("base64");
    const reads: string[] = [];
    let watched: readonly string[] = [];
    setTestPlatform({
      files: {
        readLocalAsset: async (path) => {
          reads.push(path);
          if (path.endsWith(".svg")) {
            return {
              status: "ok",
              path,
              bytesBase64: svgBase64,
              size: svgBase64.length,
              revision: "svg-r1",
            };
          }
          return { status: "missing", path };
        },
        syncLocalAssetWatches: (paths) => {
          watched = [...paths];
        },
      },
    });
    invalidateImageAssetPath("/tmp/tikz/fig.svg");

    const resolver = await prepareImageAssetResolver({
      source: String.raw`\node {\includegraphics{fig}};`,
      documentFileRef,
    });
    const resolution = resolver.resolve({
      filename: "fig",
      options: {},
      source: String.raw`\includegraphics{fig}`,
      sourceStart: 0,
      sourceEnd: 21,
    });

    expect(reads).toEqual([
      "/tmp/tikz/fig.png",
      "/tmp/tikz/fig.jpg",
      "/tmp/tikz/fig.jpeg",
      "/tmp/tikz/fig.svg",
    ]);
    expect(watched).toEqual([
      "/tmp/tikz/fig.jpeg",
      "/tmp/tikz/fig.jpg",
      "/tmp/tikz/fig.pdf",
      "/tmp/tikz/fig.png",
      "/tmp/tikz/fig.svg",
    ]);
    expect(resolution).toMatchObject({
      status: "resolved",
      mimeType: "image/svg+xml",
      naturalWidthPt: 10,
      naturalHeightPt: 5,
      dataBase64: svgBase64,
    });
  });

  it("reuses native image assets across trim and clip variants", async () => {
    const documentFileRef = desktopFileRef();
    const svgBase64 = Buffer.from('<svg width="120pt" height="80pt" viewBox="0 0 120 80"></svg>').toString("base64");
    const reads: string[] = [];
    setTestPlatform({
      files: {
        readLocalAsset: async (path) => {
          reads.push(path);
          return {
            status: "ok",
            path,
            bytesBase64: svgBase64,
            size: svgBase64.length,
            revision: "svg-r2",
          };
        },
      },
    });
    invalidateImageAssetPath("/tmp/tikz/fig.svg");

    const resolver = await prepareImageAssetResolver({
      source: String.raw`\node {\includegraphics[trim=10 5 20 15]{fig.svg}\includegraphics[trim=10 5 20 15,clip]{fig.svg}};`,
      documentFileRef,
    });
    const visible = resolver.resolve({
      filename: "fig.svg",
      options: { raw: "trim=10 5 20 15" },
      source: String.raw`\includegraphics[trim=10 5 20 15]{fig.svg}`,
      sourceStart: 0,
      sourceEnd: 45,
    });
    const clipped = resolver.resolve({
      filename: "fig.svg",
      options: { raw: "trim=10 5 20 15,clip" },
      source: String.raw`\includegraphics[trim=10 5 20 15,clip]{fig.svg}`,
      sourceStart: 0,
      sourceEnd: 50,
    });

    expect(reads).toEqual(["/tmp/tikz/fig.svg"]);
    expect(visible.status).toBe("resolved");
    expect(clipped.status).toBe("resolved");
  });

  it("resolves explicit PDF assets as rasterized PNG images", async () => {
    const documentFileRef = desktopFileRef();
    const pdfBytes = Buffer.from("%PDF-1.7\npage 1");
    const pdfBase64 = pdfBytes.toString("base64");
    const rasterRequests: number[] = [];
    restorePdfRasterizer = setPdfAssetRasterizerForTests(async (request) => {
      rasterRequests.push(request.pageNumber);
      expect(Buffer.from(request.bytes).toString()).toBe(pdfBytes.toString());
      return {
        mimeType: "image/png",
        dataBase64: "png-page-1",
        naturalWidthPt: 200,
        naturalHeightPt: 100,
        renderScale: 2,
        pixelWidth: 400,
        pixelHeight: 200,
        signature: "page=1;scale=2;pixels=400x200;natural=200x100",
      };
    });
    setTestPlatform({
      files: {
        readLocalAsset: async (path) => ({
          status: "ok",
          path,
          bytesBase64: pdfBase64,
          size: pdfBytes.length,
          revision: "pdf-r1",
        }),
      },
    });
    invalidateImageAssetPath("/tmp/tikz/fig.pdf");

    const resolver = await prepareImageAssetResolver({
      source: String.raw`\node {\includegraphics{fig.pdf}};`,
      documentFileRef,
    });
    const resolution = resolver.resolve({
      filename: "fig.pdf",
      options: { raw: "" },
      source: String.raw`\includegraphics{fig.pdf}`,
      sourceStart: 0,
      sourceEnd: 25,
    });

    expect(rasterRequests).toEqual([1]);
    expect(resolution).toMatchObject({
      status: "resolved",
      mimeType: "image/png",
      dataBase64: "png-page-1",
      naturalWidthPt: 200,
      naturalHeightPt: 100,
      resolvedPath: "/tmp/tikz/fig.pdf",
    });
    expect(resolution.revision).toContain("pdf-r1");
    expect(resolution.revision).toContain("page=1");
  });

  it("uses page options for PDF cache variants", async () => {
    const documentFileRef = desktopFileRef();
    const pdfBase64 = Buffer.from("%PDF-1.7\npages").toString("base64");
    const rasterizedPages: number[] = [];
    restorePdfRasterizer = setPdfAssetRasterizerForTests(async (request) => {
      rasterizedPages.push(request.pageNumber);
      return rasterizedPdfPage(request.pageNumber);
    });
    setTestPlatform({
      files: {
        readLocalAsset: async (path) => ({
          status: "ok",
          path,
          bytesBase64: pdfBase64,
          size: pdfBase64.length,
          revision: "pdf-r2",
        }),
      },
    });
    invalidateImageAssetPath("/tmp/tikz/fig.pdf");

    const resolver = await prepareImageAssetResolver({
      source: String.raw`\node {\includegraphics[page=1]{fig.pdf}\includegraphics[page=2]{fig.pdf}};`,
      documentFileRef,
    });
    const page1 = resolver.resolve({
      filename: "fig.pdf",
      options: { raw: "page=1" },
      source: String.raw`\includegraphics[page=1]{fig.pdf}`,
      sourceStart: 0,
      sourceEnd: 34,
    });
    const page2 = resolver.resolve({
      filename: "fig.pdf",
      options: { raw: "page=2" },
      source: String.raw`\includegraphics[page=2]{fig.pdf}`,
      sourceStart: 0,
      sourceEnd: 34,
    });

    expect(rasterizedPages).toEqual([1, 2]);
    expect(page1.status).toBe("resolved");
    expect(page2.status).toBe("resolved");
    if (page1.status === "resolved" && page2.status === "resolved") {
      expect(page1.dataBase64).toBe("png-page-1");
      expect(page2.dataBase64).toBe("png-page-2");
      expect(page1.revision).not.toBe(page2.revision);
    }
  });

  it("reuses a PDF page asset across trim and clip variants", async () => {
    const documentFileRef = desktopFileRef();
    const pdfBase64 = Buffer.from("%PDF-1.7\npages").toString("base64");
    const reads: string[] = [];
    const rasterizedPages: number[] = [];
    restorePdfRasterizer = setPdfAssetRasterizerForTests(async (request) => {
      rasterizedPages.push(request.pageNumber);
      return rasterizedPdfPage(request.pageNumber);
    });
    setTestPlatform({
      files: {
        readLocalAsset: async (path) => {
          reads.push(path);
          return {
            status: "ok",
            path,
            bytesBase64: pdfBase64,
            size: pdfBase64.length,
            revision: "pdf-r2-trim",
          };
        },
      },
    });
    invalidateImageAssetPath("/tmp/tikz/fig.pdf");

    const resolver = await prepareImageAssetResolver({
      source: String.raw`\node {\includegraphics[page=2,trim=10 5 20 15]{fig.pdf}\includegraphics[page=2,trim=10 5 20 15,clip]{fig.pdf}};`,
      documentFileRef,
    });
    const visible = resolver.resolve(pdfResolveRequest("page=2,trim=10 5 20 15"));
    const clipped = resolver.resolve(pdfResolveRequest("page=2,trim=10 5 20 15,clip"));

    expect(reads).toEqual(["/tmp/tikz/fig.pdf"]);
    expect(rasterizedPages).toEqual([2]);
    expect(visible.status).toBe("resolved");
    expect(clipped.status).toBe("resolved");
  });

  it("returns unsupported placeholders for invalid or failed PDF pages", async () => {
    const documentFileRef = desktopFileRef();
    const pdfBase64 = Buffer.from("%PDF-1.7\npages").toString("base64");
    restorePdfRasterizer = setPdfAssetRasterizerForTests(async (request) => {
      if (request.pageNumber === 9) {
        throw new Error("PDF page 9 is out of range; document has 2 pages.");
      }
      return rasterizedPdfPage(request.pageNumber);
    });
    setTestPlatform({
      files: {
        readLocalAsset: async (path) => ({
          status: "ok",
          path,
          bytesBase64: pdfBase64,
          size: pdfBase64.length,
          revision: "pdf-r3",
        }),
      },
    });
    invalidateImageAssetPath("/tmp/tikz/fig.pdf");

    const resolver = await prepareImageAssetResolver({
      source: String.raw`\node {\includegraphics[page=0]{fig.pdf}\includegraphics[page=9]{fig.pdf}};`,
      documentFileRef,
    });
    const invalid = resolver.resolve({
      filename: "fig.pdf",
      options: { raw: "page=0" },
      source: String.raw`\includegraphics[page=0]{fig.pdf}`,
      sourceStart: 0,
      sourceEnd: 34,
    });
    const outOfRange = resolver.resolve({
      filename: "fig.pdf",
      options: { raw: "page=9" },
      source: String.raw`\includegraphics[page=9]{fig.pdf}`,
      sourceStart: 0,
      sourceEnd: 34,
    });

    expect(invalid).toMatchObject({
      status: "unsupported",
      reason: "PDF page option must be a positive integer.",
    });
    expect(outOfRange).toMatchObject({
      status: "unsupported",
      reason: "PDF page 9 is out of range; document has 2 pages.",
    });
  });

  it("invalidates all cached PDF page variants when the file changes", async () => {
    const documentFileRef = desktopFileRef();
    let revision = "pdf-r1";
    let renderVersion = 1;
    const rasterizedPages: string[] = [];
    restorePdfRasterizer = setPdfAssetRasterizerForTests(async (request) => {
      rasterizedPages.push(`${renderVersion}:${request.pageNumber}`);
      return {
        ...rasterizedPdfPage(request.pageNumber),
        dataBase64: `png-v${renderVersion}-page-${request.pageNumber}`,
        signature: `version=${renderVersion};page=${request.pageNumber}`,
      };
    });
    setTestPlatform({
      files: {
        readLocalAsset: async (path) => ({
          status: "ok",
          path,
          bytesBase64: Buffer.from(`%PDF ${revision}`).toString("base64"),
          size: revision.length,
          revision,
        }),
      },
    });
    invalidateImageAssetPath("/tmp/tikz/fig.pdf");

    const first = await prepareImageAssetResolver({
      source: String.raw`\node {\includegraphics[page=1]{fig.pdf}\includegraphics[page=2]{fig.pdf}};`,
      documentFileRef,
    });
    expect(first.resolve(pdfResolveRequest("page=1")).status).toBe("resolved");
    expect(first.resolve(pdfResolveRequest("page=2")).status).toBe("resolved");

    revision = "pdf-r2";
    renderVersion = 2;
    invalidateImageAssetPath("/tmp/tikz/fig.pdf");

    const second = await prepareImageAssetResolver({
      source: String.raw`\node {\includegraphics[page=1]{fig.pdf}};`,
      documentFileRef,
    });
    const resolved = second.resolve(pdfResolveRequest("page=1"));

    expect(rasterizedPages).toEqual(["1:1", "1:2", "2:1"]);
    expect(resolved.status).toBe("resolved");
    if (resolved.status === "resolved") {
      expect(resolved.dataBase64).toBe("png-v2-page-1");
      expect(resolved.revision).toContain("pdf-r2");
    }
  });
});

function desktopFileRef(): DocumentFileRef {
  return {
    kind: "file",
    name: "main.tex",
    path: "/tmp/tikz/main.tex",
    provider: "desktop-fs",
  };
}

function rasterizedPdfPage(pageNumber: number): Awaited<ReturnType<PdfAssetRasterizer>> {
  return {
    mimeType: "image/png",
    dataBase64: `png-page-${pageNumber}`,
    naturalWidthPt: pageNumber * 100,
    naturalHeightPt: pageNumber * 50,
    renderScale: 2,
    pixelWidth: pageNumber * 200,
    pixelHeight: pageNumber * 100,
    signature: `page=${pageNumber};scale=2`,
  };
}

function pdfResolveRequest(raw: string) {
  return {
    filename: "fig.pdf",
    options: { raw },
    source: String.raw`\includegraphics{fig.pdf}`,
    sourceStart: 0,
    sourceEnd: 25,
  };
}
