import type { DocumentFileRef } from "../store/types.js";
import { parseSvgForImport } from "./svg-path-validation.js";
import { convertSvgWithClipping } from "./svg-import-clipping.js";

type OpenedTextFile = {
  source: string;
  fileRef: DocumentFileRef | null;
};

type OpenedBinaryFile = {
  bytes: ArrayBuffer | Uint8Array;
  fileRef: DocumentFileRef | null;
};

type ResolveOpenedFileOptions = {
  requireSvg?: boolean;
  requireIpe?: boolean;
};

export type ResolveOpenedFileResult =
  | { kind: "success"; source: string; title: string; fileRef: DocumentFileRef | null; importedFromSvg: boolean }
  | { kind: "failure"; message: string };

export type SvgScopeSnippetResult =
  | { kind: "success"; snippet: string; body: string; tikzSource: string }
  | { kind: "failure"; message: string };

export type KeynoteScopeSnippetResult = SvgScopeSnippetResult;
export type PowerPointScopeSnippetResult = SvgScopeSnippetResult;

const SVG_XML_RE = /<svg[\s>]/i;
const IPE_XML_RE = /<ipe[\s>]/i;

function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/u, "");
}

function suggestedTexNameFromName(name: string, fallbackBaseName = "imported-svg"): string {
  const base = stripExtension(name).trim();
  return `${base.length > 0 ? base : fallbackBaseName}.tex`;
}

function titleFromRef(fileRef: DocumentFileRef | null): string {
  return fileRef?.name ?? "Opened document";
}

export function detectSvgText(source: string, name?: string | null): boolean {
  const trimmedName = name?.trim().toLowerCase() ?? "";
  if (trimmedName.endsWith(".svg")) {
    return true;
  }
  const head = source.slice(0, 2048);
  return SVG_XML_RE.test(head);
}

export function detectIpeText(source: string, name?: string | null): boolean {
  const trimmedName = name?.trim().toLowerCase() ?? "";
  if (trimmedName.endsWith(".ipe")) {
    return true;
  }
  const head = source.slice(0, 2048);
  return IPE_XML_RE.test(head);
}

export function extractTikzPictureBody(tikzSource: string): string {
  const beginToken = "\\begin{tikzpicture}";
  const endToken = "\\end{tikzpicture}";
  const beginIndex = tikzSource.indexOf(beginToken);
  const endIndex = tikzSource.lastIndexOf(endToken);
  if (beginIndex < 0 || endIndex < 0 || endIndex <= beginIndex) {
    return tikzSource.trim();
  }
  const beginLineEnd = tikzSource.indexOf("\n", beginIndex);
  if (beginLineEnd < 0 || beginLineEnd >= endIndex) {
    return "";
  }
  const rawBody = tikzSource.slice(beginLineEnd + 1, endIndex);
  return rawBody
    .replace(/^\n+/u, "")
    .replace(/\s+$/u, "");
}

async function convertSvgToTikzSource(svgSource: string): Promise<string> {
  const svgElement = parseSvgForImport(svgSource);
  const { svgToTikz } = await import("svg2tikz");
  return convertSvgWithClipping(svgElement, svgToTikz);
}

async function convertIpeToTikzSource(ipeSource: string): Promise<string> {
  const { convertIpeToTikz } = await import("ipe2tikz");
  const converted = convertIpeToTikz(ipeSource);
  const errorDiagnostics = converted.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errorDiagnostics.length > 0 && converted.tikz.trim().length === 0) {
    throw new Error(errorDiagnostics.map((diagnostic) => diagnostic.message).join("; "));
  }
  return converted.tikz;
}

function toImportedFileRef(name: string, fallbackBaseName = "imported-svg"): DocumentFileRef {
  return {
    kind: "virtual",
    name: suggestedTexNameFromName(name, fallbackBaseName)
  };
}

async function resolveOpenedSvgAsDocument(opened: OpenedTextFile): Promise<ResolveOpenedFileResult> {
  const originalName = opened.fileRef?.name ?? "imported.svg";
  try {
    const converted = await convertSvgToTikzSource(opened.source);
    const suggestedFileRef = toImportedFileRef(originalName);
    return {
      kind: "success",
      source: converted,
      title: suggestedFileRef.name,
      fileRef: suggestedFileRef,
      importedFromSvg: true
    };
  } catch (error) {
    return {
      kind: "failure",
      message: `SVG import failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function resolveOpenedIpeAsDocument(opened: OpenedTextFile): Promise<ResolveOpenedFileResult> {
  const originalName = opened.fileRef?.name ?? "imported.ipe";
  try {
    const converted = await convertIpeToTikzSource(opened.source);
    const suggestedFileRef = toImportedFileRef(originalName, "imported-ipe");
    return {
      kind: "success",
      source: converted,
      title: suggestedFileRef.name,
      fileRef: suggestedFileRef,
      importedFromSvg: false
    };
  } catch (error) {
    return {
      kind: "failure",
      message: `Ipe import failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function resolveOpenedFileForDocument(
  opened: OpenedTextFile,
  options: ResolveOpenedFileOptions = {}
): Promise<ResolveOpenedFileResult> {
  const isSvg = detectSvgText(opened.source, opened.fileRef?.name);
  const isIpe = detectIpeText(opened.source, opened.fileRef?.name);
  if (options.requireSvg && !isSvg) {
    return { kind: "failure", message: "Selected file is not an SVG document." };
  }
  if (options.requireIpe && !isIpe) {
    return { kind: "failure", message: "Selected file is not an Ipe document." };
  }
  if (isSvg) {
    return resolveOpenedSvgAsDocument(opened);
  }
  if (isIpe) {
    return resolveOpenedIpeAsDocument(opened);
  }
  return {
    kind: "success",
    source: opened.source,
    title: titleFromRef(opened.fileRef),
    fileRef: opened.fileRef,
    importedFromSvg: false
  };
}

export async function resolveOpenedPowerPointForDocument(opened: OpenedBinaryFile): Promise<ResolveOpenedFileResult> {
  const originalName = opened.fileRef?.name ?? "imported.pptx";
  try {
    const { parse, convertSlidesToTikZ } = await import("pptx2tikz");
    const inputBytes = opened.bytes instanceof Uint8Array ? opened.bytes : new Uint8Array(opened.bytes);
    const parsed = await parse(normalizeBytesToArrayBuffer(inputBytes));
    const converted = convertSlidesToTikZ(parsed.slides, parsed.size, {
      noImages: true,
      xcolorRgbConvert: true
    });
    const suggestedFileRef = toImportedFileRef(originalName, "imported-powerpoint");
    return {
      kind: "success",
      source: converted.tex,
      title: suggestedFileRef.name,
      fileRef: suggestedFileRef,
      importedFromSvg: false
    };
  } catch (error) {
    return {
      kind: "failure",
      message: `PowerPoint import failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export function buildScopeWrappedSnippet(body: string, options: { scale?: number } = {}): string {
  const normalizedBody = body
    .replace(/\r\n?/g, "\n")
    .replace(/^\n+/u, "")
    .replace(/\s+$/u, "");
  const scale = options.scale;
  const scaleOption = typeof scale === "number" && Number.isFinite(scale) ? `[scale=${scale}]` : "";
  return normalizedBody.length > 0
    ? `\\begin{scope}${scaleOption}\n${normalizedBody}\n\\end{scope}`
    : `\\begin{scope}${scaleOption}\n\\end{scope}`;
}

function toScopeSnippetResult(tikzSource: string): { kind: "success"; snippet: string; body: string; tikzSource: string } {
  const body = extractTikzPictureBody(tikzSource);
  return {
    kind: "success",
    snippet: buildScopeWrappedSnippet(body),
    body,
    tikzSource
  };
}

export async function convertSvgToScopeSnippet(svgSource: string): Promise<SvgScopeSnippetResult> {
  try {
    const converted = await convertSvgToTikzSource(svgSource);
    return toScopeSnippetResult(converted);
  } catch (error) {
    return {
      kind: "failure",
      message: `SVG import failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function convertKeynoteClipboardToScopeSnippet(rawClipboardText: string): Promise<KeynoteScopeSnippetResult> {
  try {
    const { toTikzFromClipboard } = await import("keynote-clipboard");
    const converted = await Promise.resolve(toTikzFromClipboard(rawClipboardText));
    return toScopeSnippetResult(converted.tikz);
  } catch (error) {
    return {
      kind: "failure",
      message: `Keynote import failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function normalizeBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

export async function convertPowerPointClipboardToScopeSnippet(
  rawClipboardBytes: ArrayBuffer | Uint8Array
): Promise<PowerPointScopeSnippetResult> {
  try {
    const { parseClipboardGVML, convertSlideToTikZ } = await import("pptx2tikz");
    const inputBytes = rawClipboardBytes instanceof Uint8Array ? rawClipboardBytes : new Uint8Array(rawClipboardBytes);
    const parsed = await parseClipboardGVML(normalizeBytesToArrayBuffer(inputBytes));
    const slide = parsed.slides?.[0];
    if (!slide) {
      throw new Error("GVML clipboard payload did not contain a slide.");
    }
    const converted = convertSlideToTikZ(slide, parsed.size, { xcolorRgbConvert: true });
    const tikzSource = typeof converted.body === "string"
      ? converted.body
      : typeof converted.tex === "string"
      ? converted.tex
      : "";
    if (tikzSource.length === 0) {
      throw new Error("PowerPoint converter did not return TikZ source.");
    }
    return toScopeSnippetResult(tikzSource);
  } catch (error) {
    return {
      kind: "failure",
      message: `PowerPoint import failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export function findSvgFileInDataTransfer(dataTransfer: DataTransfer | null): File | null {
  if (!dataTransfer) {
    return null;
  }

  for (const file of Array.from(dataTransfer.files ?? [])) {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    if (type === "image/svg+xml" || name.endsWith(".svg")) {
      return file;
    }
  }

  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== "file") {
      continue;
    }
    const type = item.type.toLowerCase();
    if (type !== "image/svg+xml" && type !== "text/xml" && type !== "application/xml") {
      continue;
    }
    const file = item.getAsFile();
    if (!file) {
      continue;
    }
    const name = file.name.toLowerCase();
    if (type === "image/svg+xml" || name.endsWith(".svg")) {
      return file;
    }
  }

  return null;
}

export function dataTransferHasFilePayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }
  if ((dataTransfer.files?.length ?? 0) > 0) {
    return true;
  }
  if ((dataTransfer.items?.length ?? 0) > 0) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === "file") {
        return true;
      }
    }
  }
  return Array.from(dataTransfer.types ?? []).includes("Files");
}
