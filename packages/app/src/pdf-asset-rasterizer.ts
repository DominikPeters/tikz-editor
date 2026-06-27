import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import type * as PdfJs from "pdfjs-dist/legacy/build/pdf.mjs";

const TEX_PT_PER_BP = 72.27 / 72;
const DEFAULT_PDF_RENDER_SCALE = 2;
const DEFAULT_PDF_MAX_DIMENSION_PX = 4096;
const DEFAULT_PDF_MAX_AREA_PX = 16_000_000;

type PdfJsModule = typeof PdfJs;
type PdfWorkerMode = "real-worker-preferred" | "fake-worker";

export type PdfAssetRasterizeRequest = {
  readonly bytes: Uint8Array;
  readonly pageNumber: number;
  readonly renderScale?: number;
  readonly maxDimensionPx?: number;
  readonly maxAreaPx?: number;
};

export type PdfAssetRasterizeResult = {
  readonly mimeType: "image/png";
  readonly dataBase64: string;
  readonly naturalWidthPt: number;
  readonly naturalHeightPt: number;
  readonly renderScale: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly signature: string;
};

export type PdfAssetRasterizer = (request: PdfAssetRasterizeRequest) => Promise<PdfAssetRasterizeResult>;

let pdfAssetRasterizer: PdfAssetRasterizer = rasterizePdfWithPdfJs;
let pdfWorkerMode: PdfWorkerMode = "real-worker-preferred";

export function setPdfAssetRasterizerForTests(rasterizer: PdfAssetRasterizer | null): () => void {
  const previous = pdfAssetRasterizer;
  pdfAssetRasterizer = rasterizer ?? rasterizePdfWithPdfJs;
  return () => {
    pdfAssetRasterizer = previous;
  };
}

export async function rasterizePdfAsset(request: PdfAssetRasterizeRequest): Promise<PdfAssetRasterizeResult> {
  return await pdfAssetRasterizer(request);
}

async function rasterizePdfWithPdfJs(request: PdfAssetRasterizeRequest): Promise<PdfAssetRasterizeResult> {
  if (request.pageNumber < 1 || !Number.isInteger(request.pageNumber)) {
    throw new Error("PDF page must be a positive integer.");
  }
  const ownerDocument = typeof document !== "undefined" ? document : null;
  if (!ownerDocument) {
    throw new Error("PDF rendering requires a DOM document.");
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    return await rasterizePdfWithWorkerMode(pdfjs, request, ownerDocument);
  } catch (error) {
    if (pdfWorkerMode !== "fake-worker" && isPdfWorkerSetupError(error)) {
      pdfWorkerMode = "fake-worker";
      return await rasterizePdfWithWorkerMode(pdfjs, request, ownerDocument);
    }
    throw error;
  }
}

async function rasterizePdfWithWorkerMode(
  pdfjs: PdfJsModule,
  request: PdfAssetRasterizeRequest,
  ownerDocument: Document
): Promise<PdfAssetRasterizeResult> {
  await configurePdfJsWorker(pdfjs);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(request.bytes),
    isOffscreenCanvasSupported: false,
    useWorkerFetch: false,
    stopAtErrors: true,
    ownerDocument,
  });

  const pdf = await loadingTask.promise;
  try {
    if (request.pageNumber > pdf.numPages) {
      throw new Error(`PDF page ${request.pageNumber} is out of range; document has ${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"}.`);
    }

    const page = await pdf.getPage(request.pageNumber);
    try {
      const naturalViewport = page.getViewport({ scale: 1 });
      const naturalWidthPt = naturalViewport.width * TEX_PT_PER_BP;
      const naturalHeightPt = naturalViewport.height * TEX_PT_PER_BP;
      if (
        !Number.isFinite(naturalWidthPt) ||
        !Number.isFinite(naturalHeightPt) ||
        naturalWidthPt <= 0 ||
        naturalHeightPt <= 0
      ) {
        throw new Error("PDF page has invalid dimensions.");
      }

      const renderScale = cappedRenderScale({
        width: naturalViewport.width,
        height: naturalViewport.height,
        desiredScale: request.renderScale ?? DEFAULT_PDF_RENDER_SCALE,
        maxDimensionPx: request.maxDimensionPx ?? DEFAULT_PDF_MAX_DIMENSION_PX,
        maxAreaPx: request.maxAreaPx ?? DEFAULT_PDF_MAX_AREA_PX,
      });
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = ownerDocument.createElement("canvas");
      const pixelWidth = Math.max(1, Math.ceil(viewport.width));
      const pixelHeight = Math.max(1, Math.ceil(viewport.height));
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) {
        throw new Error("PDF rendering requires a 2D canvas context.");
      }

      await page.render({
        canvas,
        canvasContext,
        viewport,
      }).promise;

      const dataUrl = canvas.toDataURL("image/png");
      canvas.width = 0;
      canvas.height = 0;
      const dataBase64 = dataUrl.match(/^data:image\/png;base64,(.+)$/)?.[1];
      if (!dataBase64) {
        throw new Error("PDF rendering did not produce a PNG data URL.");
      }

      return {
        mimeType: "image/png",
        dataBase64,
        naturalWidthPt,
        naturalHeightPt,
        renderScale,
        pixelWidth,
        pixelHeight,
        signature: [
          `page=${request.pageNumber}`,
          `scale=${formatPdfNumber(renderScale)}`,
          `pixels=${pixelWidth}x${pixelHeight}`,
          `natural=${formatPdfNumber(naturalWidthPt)}x${formatPdfNumber(naturalHeightPt)}`,
        ].join(";"),
      };
    } finally {
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
}

async function configurePdfJsWorker(pdfjs: PdfJsModule): Promise<void> {
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  if (pdfWorkerMode === "fake-worker" || typeof Worker === "undefined") {
    pdfWorkerMode = "fake-worker";
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  }
}

function isPdfWorkerSetupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bworker\b/i.test(message) || message.includes("GlobalWorkerOptions.workerSrc");
}

function cappedRenderScale(params: {
  readonly width: number;
  readonly height: number;
  readonly desiredScale: number;
  readonly maxDimensionPx: number;
  readonly maxAreaPx: number;
}): number {
  if (
    !Number.isFinite(params.width) ||
    !Number.isFinite(params.height) ||
    params.width <= 0 ||
    params.height <= 0
  ) {
    return 1;
  }
  const maxDimensionScale = Math.min(
    params.maxDimensionPx / params.width,
    params.maxDimensionPx / params.height
  );
  const maxAreaScale = Math.sqrt(params.maxAreaPx / (params.width * params.height));
  const scale = Math.min(params.desiredScale, maxDimensionScale, maxAreaScale);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function formatPdfNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}
