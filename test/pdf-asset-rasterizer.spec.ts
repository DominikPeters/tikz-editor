import { afterEach, expect, it, vi } from "vitest";
import { rasterizePdfAsset } from "../packages/app/src/pdf-asset-rasterizer.js";

const pdf = vi.hoisted(() => ({
  getPage: vi.fn(), render: vi.fn(), cleanup: vi.fn(), destroy: vi.fn()
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 3, getPage: pdf.getPage }),
    destroy: pdf.destroy
  })
}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("rasterizes imported PDF pages without waiting for visible-window animation frames", async () => {
  const canvas = { width: 0, height: 0, getContext: () => ({}), toDataURL: () => "data:image/png;base64,AQID" };
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal("Worker", class {});
  // PDF.js display rendering schedules work through requestAnimationFrame;
  // print rendering uses microtasks, including in hidden WKWebViews.
  pdf.render.mockImplementation(({ intent }: { intent?: string }) => ({
    promise: intent === "print" ? Promise.resolve() : Promise.reject(new Error("Display rendering needs animation frames"))
  }));
  pdf.getPage.mockResolvedValue({
    getViewport: ({ scale }: { scale: number }) => ({ width: 90 * scale, height: 60 * scale }),
    render: pdf.render, cleanup: pdf.cleanup
  });
  expect(await rasterizePdfAsset({ bytes: new Uint8Array([1, 2, 3]), pageNumber: 3 })).toMatchObject({
    mimeType: "image/png", dataBase64: "AQID", pixelWidth: 180, pixelHeight: 120
  });
  expect(pdf.getPage).toHaveBeenCalledWith(3);
  expect(pdf.render).toHaveBeenCalledWith(expect.objectContaining({ intent: "print", canvas }));
  expect(pdf.cleanup).toHaveBeenCalledOnce();
  expect(pdf.destroy).toHaveBeenCalledOnce();
});
