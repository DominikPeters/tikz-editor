import {
  createStandaloneLatexExportArtifact,
  createPdfExportArtifact,
  createPngExportArtifact,
  createSvgExportArtifact
} from "@tikz-editor/core/export/index";
import { serializeSvgModelAsync, type EmitSvgResult } from "@tikz-editor/core/svg/index";
import { getActiveEditorPlatform } from "../platform/current";
import { publishUiError } from "./ui-notifications";

const DEFAULT_PNG_EXPORT_DPI = 144;
const MIN_PNG_EXPORT_DPI = 36;
const MAX_PNG_EXPORT_DPI = 1200;

export function canExportSvg(svgResult: EmitSvgResult | null): svgResult is EmitSvgResult {
  return svgResult != null;
}

export type SvgTransformPreset = "beautify" | "compress";

type SvgOptimizer = (svgMarkup: string, preset: SvgTransformPreset) => string;

export type RenderPngExportOptions = {
  fileName?: string;
  dpi?: number;
  transparentBackground?: boolean;
};

export type RenderPngExportResult = {
  artifact: ReturnType<typeof createPngExportArtifact>;
  blob: Blob;
  dpi: number;
  pixelWidth: number;
  pixelHeight: number;
};

let svgOptimizerPromise: Promise<SvgOptimizer> | null = null;

function reportExportFailure(message: string, error?: unknown): false {
  console.warn(`[tikz-editor] ${message}`, error);
  publishUiError(message);
  return false;
}

export async function exportStandaloneLatexDownload(
  source: string,
  activeFigureId: string | null,
  options: { fileName?: string } = {}
): Promise<boolean> {
  const artifact = createStandaloneLatexExportArtifact({
    source,
    activeFigureId,
    fileName: options.fileName
  });
  if (!artifact.complete) {
    console.warn("[tikz-editor] Standalone LaTeX export emitted with unresolved diagnostics.", artifact.diagnostics);
  }
  const platformExportResult = await getActiveEditorPlatform().files?.exportFile?.(
    [artifact.text],
    { fileName: artifact.fileName, mimeType: artifact.mimeType }
  );
  if (platformExportResult) {
    return true;
  }

  if (typeof document === "undefined" || typeof Blob === "undefined") {
    return reportExportFailure("Standalone LaTeX export is unavailable in this runtime.");
  }
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
    return reportExportFailure("Standalone LaTeX export requires object URL support.");
  }
  if (!document.body) {
    return reportExportFailure("Standalone LaTeX export requires an active document.");
  }

  const blob = new Blob([artifact.text], { type: artifact.mimeType });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = artifact.fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function exportSvgDownload(
  svgResult: EmitSvgResult,
  options: { fileName?: string } = {}
): Promise<boolean> {
  if (typeof document === "undefined" || typeof Blob === "undefined") {
    return reportExportFailure("SVG export is unavailable in this runtime.");
  }
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
    return reportExportFailure("SVG export requires object URL support.");
  }
  if (!document.body) {
    return reportExportFailure("SVG export requires an active document.");
  }

  const text = await serializeSvgForExport(svgResult);
  return downloadSvgMarkup(text, options);
}

export async function renderPngExport(
  svgResult: EmitSvgResult,
  options: RenderPngExportOptions = {}
): Promise<RenderPngExportResult> {
  if (typeof document === "undefined" || typeof Blob === "undefined" || typeof Image === "undefined") {
    throw new Error("PNG export is unavailable in this runtime.");
  }

  const text = await serializeSvgForExport(svgResult);
  const artifact = createPngExportArtifact({ fileName: options.fileName });
  const dpi = normalizePngExportDpi(options.dpi);
  const scale = dpi / 72;
  const pixelWidth = Math.max(1, Math.ceil(svgResult.viewBox.width * scale));
  const pixelHeight = Math.max(1, Math.ceil(svgResult.viewBox.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("PNG export requires a 2D canvas context.");
  }

  if (options.transparentBackground === false) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pixelWidth, pixelHeight);
  } else {
    context.clearRect(0, 0, pixelWidth, pixelHeight);
  }

  const svgBlob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadSvgImage(svgUrl);
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }

  const blob = await canvasToBlob(canvas, artifact.mimeType);
  return {
    artifact,
    blob,
    dpi,
    pixelWidth,
    pixelHeight
  };
}

export async function exportPngDownload(
  svgResult: EmitSvgResult,
  options: RenderPngExportOptions = {}
): Promise<boolean> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return reportExportFailure("PNG export is unavailable in this runtime.");
  }
  if (typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
    return reportExportFailure("PNG export requires object URL support.");
  }
  if (!document.body) {
    return reportExportFailure("PNG export requires an active document.");
  }

  try {
    const result = await renderPngExport(svgResult, options);
    const platformExportResult = await getActiveEditorPlatform().files?.exportFile?.(
      [result.blob],
      { fileName: result.artifact.fileName, mimeType: result.artifact.mimeType }
    );
    if (platformExportResult) {
      return true;
    }
    const objectUrl = URL.createObjectURL(result.blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = result.artifact.fileName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    return reportExportFailure("Failed to export PNG.", error);
  }
}

let pdfExporterPromise: Promise<PdfExporter> | null = null;

export async function exportPdfDownload(
  svgResult: EmitSvgResult,
  options: { fileName?: string } = {}
): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return reportExportFailure("PDF export is unavailable in this runtime.");
  }

  try {
    const text = await serializeSvgForExport(svgResult);
    const svgElement = parseSvgDocument(text);
    if (!svgElement) {
      throw new Error("Failed to parse SVG document for PDF export.");
    }

    svgElement.setAttribute("width", `${svgResult.viewBox.width}`);
    svgElement.setAttribute("height", `${svgResult.viewBox.height}`);

    const artifact = createPdfExportArtifact({ fileName: options.fileName });
    const exportPdf = await loadPdfExporter();
    const blob = await exportPdf(svgElement, svgResult.viewBox.width, svgResult.viewBox.height);
    const platformExportResult = await getActiveEditorPlatform().files?.exportFile?.(
      [blob],
      { fileName: artifact.fileName, mimeType: artifact.mimeType }
    );
    if (platformExportResult) {
      return true;
    }
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
      return reportExportFailure("PDF export requires object URL support.");
    }
    if (!document.body) {
      return reportExportFailure("PDF export requires an active document.");
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = artifact.fileName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    return reportExportFailure("Failed to export PDF.", error);
  }
}

export async function copySvgMarkup(svgResult: EmitSvgResult): Promise<boolean> {
  const text = await serializeSvgForExport(svgResult);
  return copySvgText(text);
}

export function normalizePngExportDpi(dpi?: number): number {
  if (typeof dpi !== "number" || !Number.isFinite(dpi)) {
    return DEFAULT_PNG_EXPORT_DPI;
  }
  return Math.min(MAX_PNG_EXPORT_DPI, Math.max(MIN_PNG_EXPORT_DPI, Math.round(dpi)));
}

export async function serializeSvgForExport(svgResult: EmitSvgResult): Promise<string> {
  try {
    return await serializeSvgModelAsync(svgResult.model, {
      includeXmlns: true,
      pretty: true
    });
  } catch (error) {
    console.warn("[tikz-editor] Failed to pretty-format SVG; using compact SVG output.", error);
    return svgResult.svg;
  }
}

export function preloadSvgOptimizer(): Promise<void> {
  return loadSvgOptimizer().then(() => {});
}

export async function transformSvgMarkup(
  svgMarkup: string,
  preset: SvgTransformPreset
): Promise<string> {
  const optimize = await loadSvgOptimizer();
  return optimize(svgMarkup, preset);
}

export async function downloadSvgMarkup(
  svgMarkup: string,
  options: { fileName?: string } = {}
): Promise<boolean> {
  const artifact = createSvgExportArtifact({
    svg: svgMarkup,
    fileName: options.fileName
  });
  const platformExportResult = await getActiveEditorPlatform().files?.exportFile?.(
    [artifact.text],
    { fileName: artifact.fileName, mimeType: artifact.mimeType }
  );
  if (platformExportResult) {
    return true;
  }

  if (typeof document === "undefined" || typeof Blob === "undefined") {
    return reportExportFailure("SVG export is unavailable in this runtime.");
  }
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof URL.revokeObjectURL !== "function") {
    return reportExportFailure("SVG export requires object URL support.");
  }
  if (!document.body) {
    return reportExportFailure("SVG export requires an active document.");
  }

  const blob = new Blob([artifact.text], { type: artifact.mimeType });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = artifact.fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function copySvgText(svgMarkup: string): Promise<boolean> {
  const artifact = createSvgExportArtifact({ svg: svgMarkup });
  const platformClipboard = getActiveEditorPlatform().clipboard?.writeText;
  if (typeof platformClipboard === "function") {
    try {
      await platformClipboard(artifact.text);
      return true;
    } catch (error) {
      console.warn("[tikz-editor] Platform clipboard write failed; falling back to browser clipboard.", error);
    }
  }

  if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
    return reportExportFailure("Clipboard access is unavailable; SVG was not copied.");
  }

  try {
    await navigator.clipboard.writeText(artifact.text);
    return true;
  } catch (error) {
    return reportExportFailure("Failed to copy SVG to the clipboard.", error);
  }
}

export function validateSvgMarkup(svgMarkup: string): { valid: true } | { valid: false; message: string } {
  if (typeof DOMParser === "undefined") {
    return { valid: true };
  }
  const parsed = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
  if (parsed.getElementsByTagName("parsererror").length > 0) {
    const parserError = parsed.getElementsByTagName("parsererror")[0];
    const message = parserError?.textContent?.trim() || "The SVG markup could not be parsed.";
    return { valid: false, message };
  }
  const root = parsed.documentElement;
  if (root?.nodeName.toLowerCase() !== "svg") {
    return { valid: false, message: "The document must contain a single <svg> root element." };
  }
  return { valid: true };
}

function loadSvgImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => { resolve(image); };
    image.onerror = () => { reject(new Error("Failed to decode SVG for PNG export.")); };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas export returned no blob."));
        return;
      }
      resolve(blob);
    }, mimeType);
  });
}

type PdfExporter = (
  svgElement: SVGSVGElement,
  width: number,
  height: number
) => Promise<Blob>;

function loadPdfExporter(): Promise<PdfExporter> {
  pdfExporterPromise ??= import("jspdf").then(async ({ jsPDF }) => {
      await import("svg2pdf.js");
      return async (svgElement: SVGSVGElement, width: number, height: number) => {
        const orientation = width > height ? "landscape" : "portrait";
        const pdfDocument = new jsPDF({
          orientation,
          unit: "pt",
          format: [width, height]
        });
        await pdfDocument.svg(svgElement, {
          x: 0,
          y: 0,
          width,
          height
        });
        return pdfDocument.output("blob");
      };
    });
  return pdfExporterPromise;
}

function loadSvgOptimizer(): Promise<SvgOptimizer> {
  svgOptimizerPromise ??= import("svgo/browser").then(
      ({ optimize }) => (svgMarkup: string, preset: SvgTransformPreset) =>
        optimize(svgMarkup, {
          multipass: preset === "compress",
          js2svg: preset === "beautify" ? { pretty: true, indent: 2 } : undefined,
          plugins: [
            {
              name: "preset-default",
              params: {
                overrides: {
                  cleanupIds: false,
                  removeViewBox: false
                }
              }
            }
          ]
        }).data
    );
  return svgOptimizerPromise;
}

function parseSvgDocument(text: string): SVGSVGElement | null {
  if (typeof DOMParser === "undefined") {
    return null;
  }
  const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
  const svgElement = parsed.documentElement;
  if (svgElement?.nodeName.toLowerCase() !== "svg") {
    return null;
  }
  return svgElement as unknown as SVGSVGElement;
}
