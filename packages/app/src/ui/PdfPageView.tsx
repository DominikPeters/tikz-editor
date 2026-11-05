import { useEffect, useRef, useState } from "react";
import type { PdfDocument } from "../pdf-asset-rasterizer";

/** Pages kept rendered either side of the shown one, so that a step shows its page at once. */
const NEIGHBOURS = 2;

type Box = { width: number; height: number; pixelRatio: number };
type RenderedPage = { done: Promise<HTMLCanvasElement>; cancel: () => void };


/**
 * A page of an open PDF, drawn to fit the view at the display's pixel
 * density and redrawn when the view resizes. The page shown stays until
 * the next one is drawn; its neighbours render after it, ready for a step.
 */
export function PdfPageView({ pdf, page, label, className, pageClassName, onError }: {
  pdf: PdfDocument;
  page: number;
  label: string;
  className?: string;
  pageClassName?: string;
  onError: (message: string) => void;
}) {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const rendered = useRef(new Map<number, RenderedPage>());

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.floor(entry.contentRect.width), height = Math.floor(entry.contentRect.height);
      const pixelRatio = window.devicePixelRatio || 1;
      setBox((current) => current?.width === width && current.height === height && current.pixelRatio === pixelRatio
        ? current : { width, height, pixelRatio });
    });
    observer.observe(view);
    return () => { observer.disconnect(); };
  }, []);

  // Pages drawn for another document or size are of no use.
  useEffect(() => {
    const pages = rendered.current;
    return () => {
      for (const entry of pages.values()) entry.cancel();
      pages.clear();
    };
  }, [box, pdf]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !box || box.width <= 0 || box.height <= 0) return;
    const pages = rendered.current;
    const render = (number: number): RenderedPage => {
      const cached = pages.get(number);
      if (cached) return cached;
      const entry = renderPage(pdf, number, box, pageClassName);
      pages.set(number, entry);
      return entry;
    };
    let current = true;
    render(page).done.then((canvas) => {
      if (!current) return;
      view.replaceChildren(canvas);
      for (const [number, entry] of pages) {
        if (Math.abs(number - page) > NEIGHBOURS) {
          entry.cancel();
          pages.delete(number);
        }
      }
      for (let distance = 1; distance <= NEIGHBOURS; distance++) {
        if (page + distance <= pdf.numPages) render(page + distance);
        if (page - distance >= 1) render(page - distance);
      }
    }, (error: unknown) => {
      if (current && !isCancellation(error)) onError(error instanceof Error ? error.message : String(error));
    });
    return () => { current = false; };
  }, [box, onError, page, pageClassName, pdf]);

  return <div ref={viewRef} className={className} role="img" aria-label={label} />;
}

function renderPage(pdf: PdfDocument, number: number, box: Box, className: string | undefined): RenderedPage {
  let cancelled = false;
  const isCancelled = () => cancelled;
  let cancelTask: (() => void) | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let cleanupPage: (() => void) | null = null;
  const release = () => {
    // The old visible page stays painted until its replacement is ready.
    if (canvas && !canvas.isConnected) { canvas.width = 0; canvas.height = 0; }
    cleanupPage?.();
    cleanupPage = null;
  };
  const done = pdf.getPage(number).then(async (pdfPage) => {
    cleanupPage = () => { pdfPage.cleanup(); };
    if (cancelled) { release(); throw new PageRenderCancelled(); }
    try {
      const natural = pdfPage.getViewport({ scale: 1 });
      const fit = Math.min(box.width / natural.width, box.height / natural.height);
      const viewport = pdfPage.getViewport({ scale: fit * box.pixelRatio });
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = `${canvas.width / box.pixelRatio}px`;
      canvas.style.height = `${canvas.height / box.pixelRatio}px`;
      if (className) canvas.className = className;
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) throw new Error("PDF rendering requires a 2D canvas context.");
      const task = pdfPage.render({ canvas, canvasContext, viewport });
      cancelTask = () => { task.cancel(); };
      await task.promise;
      if (isCancelled()) throw new PageRenderCancelled();
      return canvas;
    } catch (error) {
      release();
      throw error;
    } finally {
      cancelTask = null;
    }
  });
  // A neighbour may be cancelled before anyone waits on it.
  done.catch(() => null);
  return { done, cancel: () => {
    cancelled = true;
    if (cancelTask) cancelTask();
    else release();
  } };
}

/** A page dropped before pdf.js began drawing it; pdf.js names its own cancellations alike. */
class PageRenderCancelled extends Error {
  override name = "RenderingCancelledException";
}

function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "RenderingCancelledException";
}
