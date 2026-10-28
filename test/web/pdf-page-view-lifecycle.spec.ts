/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PdfDocument } from "../../packages/app/src/pdf-asset-rasterizer.js";
import { PdfPageView } from "../../packages/app/src/ui/PdfPageView.js";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: (entries: { contentRect: { width: number; height: number } }[]) => void) {}
    observe() { this.callback([{ contentRect: { width: 800, height: 600 } }]); }
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("releases evicted PDF page resources and offscreen backing surfaces during a long page sweep", async () => {
  const activePages = new Set<number>();
  const canvases: HTMLCanvasElement[] = [];
  const cleanup = vi.fn((number: number) => { activePages.delete(number); });
  const pdf = { numPages: 30, getPage: async (number: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 400 * scale, height: 300 * scale }),
    cleanup: () => { cleanup(number); },
    render: ({ canvas }: { canvas: HTMLCanvasElement }) => {
      activePages.add(number); canvases.push(canvas);
      return { promise: Promise.resolve(), cancel() {} };
    }
  }) } as unknown as PdfDocument;
  const onError = vi.fn();
  for (let page = 1; page <= 24; page++) {
    await act(async () => {
      root.render(createElement(PdfPageView, { pdf, page, label: "PDF", onError }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(activePages.size).toBeLessThanOrEqual(5);
  }
  expect(cleanup).toHaveBeenCalledWith(1);
  expect(canvases.filter(canvas => canvas.width > 0)).toHaveLength(5);
  expect(host.querySelectorAll("canvas")).toHaveLength(1);
  expect(onError).not.toHaveBeenCalled();
});

it("waits for a cancelled render to settle before releasing its page and canvas", async () => {
  let rejectRender: ((error: Error) => void) | undefined;
  let canvas: HTMLCanvasElement | undefined;
  const cleanup = vi.fn();
  const cancel = vi.fn(() => { rejectRender?.(Object.assign(new Error("cancelled"), { name: "RenderingCancelledException" })); });
  const pdf = { numPages: 1, getPage: async () => ({
    getViewport: () => ({ width: 800, height: 600 }), cleanup,
    render: (options: { canvas: HTMLCanvasElement }) => {
      canvas = options.canvas;
      return { promise: new Promise<void>((_resolve, reject) => { rejectRender = reject; }), cancel };
    }
  }) } as unknown as PdfDocument;
  const onError = vi.fn();
  await act(async () => {
    root.render(createElement(PdfPageView, { pdf, page: 1, label: "PDF", onError }));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(cleanup).not.toHaveBeenCalled();
  await act(async () => { root.render(null); });
  expect(cancel).toHaveBeenCalledOnce();
  expect(cleanup).toHaveBeenCalledOnce();
  expect([canvas?.width, canvas?.height]).toEqual([0, 0]);
  expect(onError).not.toHaveBeenCalled();
});

it("releases a page that finishes loading after the viewer has closed", async () => {
  let resolvePage: ((page: unknown) => void) | undefined;
  const cleanup = vi.fn();
  const render = vi.fn();
  const pdf = { numPages: 1, getPage: () => new Promise(resolve => { resolvePage = resolve; }) } as unknown as PdfDocument;
  const onError = vi.fn();
  await act(async () => {
    root.render(createElement(PdfPageView, { pdf, page: 1, label: "PDF", onError }));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await act(async () => { root.render(null); });
  await act(async () => { resolvePage?.({ cleanup, render }); });
  expect(cleanup).toHaveBeenCalledOnce();
  expect(render).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it("cleans page resources and scratch surfaces when rendering fails", async () => {
  const cleanup = vi.fn();
  let canvas: HTMLCanvasElement | undefined;
  const pdf = { numPages: 1, getPage: async () => ({
    getViewport: () => ({ width: 800, height: 600 }), cleanup,
    render: (options: { canvas: HTMLCanvasElement }) => {
      canvas = options.canvas;
      return { promise: Promise.reject(new Error("render failed")), cancel() {} };
    }
  }) } as unknown as PdfDocument;
  const onError = vi.fn();
  await act(async () => {
    root.render(createElement(PdfPageView, { pdf, page: 1, label: "PDF", onError }));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(cleanup).toHaveBeenCalledOnce();
  expect([canvas?.width, canvas?.height]).toEqual([0, 0]);
  expect(onError).toHaveBeenCalledWith("render failed");
});
