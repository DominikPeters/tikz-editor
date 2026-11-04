import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openPdfDocument, rasterizePdfAsset } from "../packages/app/src/pdf-asset-rasterizer";

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument, GlobalWorkerOptions: {} }));

beforeEach(() => {
  getDocument.mockReset();
  vi.stubGlobal("Worker", class {});
});
afterEach(() => vi.unstubAllGlobals());

describe("PDF resource ownership", () => {
  it.each(["open", "rasterize"])("destroys a failed loading task in %s", async (operation) => {
    vi.stubGlobal("document", {});
    const error = new Error("Invalid PDF document");
    const destroy = vi.fn(async () => {});
    getDocument.mockImplementation(() => ({ promise: Promise.reject(error), destroy }));
    const result = operation === "open" ? openPdfDocument(new Uint8Array())
      : rasterizePdfAsset({ bytes: new Uint8Array(), pageNumber: 1 });
    await expect(result).rejects.toBe(error);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("leaves a successfully opened viewer document owned by its caller", async () => {
    vi.stubGlobal("document", {});
    const pdf = { numPages: 2 };
    const destroy = vi.fn(async () => {});
    getDocument.mockReturnValue({ promise: Promise.resolve(pdf), destroy });
    expect(await openPdfDocument(new Uint8Array())).toBe(pdf);
    expect(destroy).not.toHaveBeenCalled();
  });

  it.each(["render", "serialize", "context", "success"])("releases raster surfaces and document resources after %s", async (failure) => {
    const error = new Error("Raster failed");
    const canvas = { width: 0, height: 0, getContext: () => failure === "context" ? null : {},
      toDataURL: () => { if (failure === "serialize") throw error; return "data:image/png;base64,AAAA"; } };
    vi.stubGlobal("document", { createElement: () => canvas });
    const cleanup = vi.fn();
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: scale * 100, height: scale * 50 }), cleanup,
      render: () => ({ promise: failure === "render" ? Promise.reject(error) : Promise.resolve() }) };
    const destroy = vi.fn(async () => {});
    getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: async () => page }), destroy });
    const result = rasterizePdfAsset({ bytes: new Uint8Array(), pageNumber: 1 });
    if (failure === "success") await expect(result).resolves.toMatchObject({ dataBase64: "AAAA", pixelWidth: 200 });
    else await expect(result).rejects.toThrow();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
