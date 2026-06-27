import type {
  NodeTextGraphicsResolution,
  NodeTextGraphicsResolveRequest,
  NodeTextGraphicsResolver,
} from "tikz-editor/text/types";
import { rasterizePdfAsset } from "./pdf-asset-rasterizer";
import { getActiveEditorPlatform } from "./platform/current";
import type { LocalAssetReadResult } from "./platform/types";
import type { DocumentFileRef } from "./store/types";

type ResolvedImageMimeType = "image/png" | "image/jpeg" | "image/svg+xml";
type RawAssetMimeType = ResolvedImageMimeType | "application/pdf";

type ImageIncludeCandidate = {
  readonly filename: string;
  readonly rawOptions: string;
};

type PreparedAssetEntry = {
  readonly filename: string;
  readonly rawOptions: string;
  readonly resolution: NodeTextGraphicsResolution;
};

type PathCacheEntry = {
  readonly path: string;
  readonly resolution: NodeTextGraphicsResolution;
  readonly signature: string;
  readonly watchedPaths: readonly string[];
};

const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg", ".pdf"] as const;
const TEX_PT_PER_BP = 72.27 / 72;
const pathCache = new Map<string, PathCacheEntry>();
let cacheGeneration = 0;

export async function prepareImageAssetResolver(params: {
  readonly source: string;
  readonly documentFileRef?: DocumentFileRef | null;
}): Promise<NodeTextGraphicsResolver> {
  const platform = getActiveEditorPlatform();
  const readLocalAsset = platform.files?.readLocalAsset;
  const baseDirectory = documentDirectory(params.documentFileRef);
  const includeCandidates = collectIncludeGraphicsCandidates(params.source);
  const entries = new Map<string, PreparedAssetEntry>();
  const watchedPaths = new Set<string>();

  for (const include of includeCandidates) {
    const requestKey = includeGraphicsRequestKey({
      filename: include.filename,
      rawOptions: include.rawOptions,
      baseDirectory,
    });
    if (entries.has(requestKey)) {
      continue;
    }
    const resolution = await resolveIncludeGraphicsAsset({
      filename: include.filename,
      rawOptions: include.rawOptions,
      baseDirectory,
      readLocalAsset,
    });
    for (const watchedPath of resolution.watchedPaths ?? []) {
      watchedPaths.add(watchedPath);
    }
    entries.set(requestKey, {
      filename: include.filename,
      rawOptions: include.rawOptions,
      resolution,
    });
  }

  const cacheKey = imageAssetResolverCacheKey({
    baseDirectory,
    entries: [...entries.values()],
  });
  const resolver: NodeTextGraphicsResolver = {
    cacheKey,
    resolve(request: NodeTextGraphicsResolveRequest): NodeTextGraphicsResolution {
      const requestKey = includeGraphicsRequestKey({
        filename: request.filename,
        rawOptions: rawGraphicsOptions(request.options.raw),
        baseDirectory,
      });
      const prepared = entries.get(requestKey);
      if (prepared) {
        return prepared.resolution;
      }
      return placeholderResolutionForUnpreparedRequest(
        request.filename,
        baseDirectory
      );
    },
  };

  await syncLocalAssetWatches([...watchedPaths].sort());
  return resolver;
}

export function invalidateImageAssetPath(path: string): void {
  const comparablePath = comparableLocalPath(path);
  let changed = false;
  for (const [key, entry] of pathCache) {
    if (comparableLocalPath(entry.path) === comparablePath) {
      pathCache.delete(key);
      changed = true;
      continue;
    }
    if (entry.watchedPaths.some((watchedPath) => comparableLocalPath(watchedPath) === comparablePath)) {
      pathCache.delete(key);
      changed = true;
    }
  }
  if (changed) {
    cacheGeneration += 1;
  }
}

async function syncLocalAssetWatches(paths: readonly string[]): Promise<void> {
  const sync = getActiveEditorPlatform().files?.syncLocalAssetWatches;
  if (typeof sync !== "function") {
    return;
  }
  await sync(paths);
}

async function resolveIncludeGraphicsAsset(params: {
  readonly filename: string;
  readonly rawOptions: string;
  readonly baseDirectory: string | null;
  readonly readLocalAsset: ((path: string) => Promise<LocalAssetReadResult>) | undefined;
}): Promise<NodeTextGraphicsResolution> {
  const descriptor = includeGraphicsPathDescriptor(params.filename, params.baseDirectory);
  if (!descriptor) {
    return {
      status: "missing",
      revision: "unresolved-base",
      watchedPaths: [],
    };
  }

  if (descriptor.kind === "unsupported") {
    return {
      status: "unsupported",
      reason: `Unsupported image extension '${descriptor.extension}'.`,
      resolvedPath: descriptor.path,
      revision: `unsupported:${descriptor.path}`,
      watchedPaths: [descriptor.path],
    };
  }

  if (!params.readLocalAsset) {
    return {
      status: "missing",
      revision: "local-assets-unavailable",
      watchedPaths: descriptor.candidates,
    };
  }

  for (const candidate of descriptor.candidates) {
    const cacheKey = assetCacheKeyForCandidate(candidate, params.rawOptions);
    const cached = pathCache.get(cacheKey);
    if (cached) {
      if (cached.resolution.status === "resolved") {
        return cached.resolution;
      }
      if (descriptor.kind === "explicit") {
        return cached.resolution;
      }
      continue;
    }

    const read = await params.readLocalAsset(candidate);
    const entry = await pathCacheEntryFromRead(candidate, descriptor.candidates, read, params.rawOptions);
    pathCache.set(cacheKey, entry);
    if (entry.resolution.status === "resolved") {
      return entry.resolution;
    }
    if (descriptor.kind === "explicit") {
      return entry.resolution;
    }
  }

  return {
    status: "missing",
    revision: `missing:${descriptor.candidates.join("|")}`,
    watchedPaths: descriptor.candidates,
  };
}

function pathCacheEntryFromRead(
  candidate: string,
  watchedPaths: readonly string[],
  read: LocalAssetReadResult,
  rawOptions: string
): Promise<PathCacheEntry> {
  if (read.status !== "ok") {
    const missingPath = read.path ?? candidate;
    const revision = read.status === "missing"
      ? `missing:${missingPath}`
      : `failed:${missingPath}:${read.reason ?? ""}`;
    return Promise.resolve({
      path: missingPath,
      watchedPaths,
      signature: revision,
      resolution: {
        status: "missing",
        resolvedPath: missingPath,
        revision,
        watchedPaths,
      },
    });
  }

  const rawMimeType = rawAssetMimeTypeForPath(read.path);
  if (!rawMimeType) {
    return Promise.resolve({
      path: read.path,
      watchedPaths,
      signature: `unsupported:${read.path}:${read.revision}`,
      resolution: {
        status: "unsupported",
        resolvedPath: read.path,
        revision: read.revision,
        watchedPaths,
        reason: "Unsupported image extension.",
      },
    });
  }

  if (rawMimeType === "application/pdf") {
    return pdfPathCacheEntryFromRead(read, watchedPaths, rawOptions);
  }

  const bytes = bytesFromBase64(read.bytesBase64);
  const naturalSize = naturalSizeForImage(bytes, rawMimeType);
  if (!naturalSize) {
    return Promise.resolve({
      path: read.path,
      watchedPaths,
      signature: `unsupported:${read.path}:${read.revision}:unreadable-size`,
      resolution: {
        status: "unsupported",
        resolvedPath: read.path,
        revision: read.revision,
        watchedPaths,
        reason: "Could not determine image dimensions.",
      },
    });
  }

  const signature = `${read.path}:${read.revision}:${naturalSize.widthPt}x${naturalSize.heightPt}`;
  return Promise.resolve({
    path: read.path,
    watchedPaths,
    signature,
    resolution: {
      status: "resolved",
      resolvedPath: read.path,
      revision: read.revision,
      watchedPaths,
      mimeType: rawMimeType,
      dataBase64: read.bytesBase64,
      naturalWidthPt: naturalSize.widthPt,
      naturalHeightPt: naturalSize.heightPt,
    },
  });
}

async function pdfPathCacheEntryFromRead(
  read: Extract<LocalAssetReadResult, { status: "ok" }>,
  watchedPaths: readonly string[],
  rawOptions: string
): Promise<PathCacheEntry> {
  const page = parsePdfPageOption(rawOptions);
  if (page.status === "invalid") {
    const signature = `unsupported:${read.path}:${read.revision}:pdf:${page.reason}`;
    return {
      path: read.path,
      watchedPaths,
      signature,
      resolution: {
        status: "unsupported",
        resolvedPath: read.path,
        revision: signature,
        watchedPaths,
        reason: page.reason,
      },
    };
  }

  try {
    const rendered = await rasterizePdfAsset({
      bytes: bytesFromBase64(read.bytesBase64),
      pageNumber: page.pageNumber,
    });
    const signature = `${read.path}:${read.revision}:pdf:${rendered.signature}`;
    return {
      path: read.path,
      watchedPaths,
      signature,
      resolution: {
        status: "resolved",
        resolvedPath: read.path,
        revision: signature,
        watchedPaths,
        mimeType: rendered.mimeType,
        dataBase64: rendered.dataBase64,
        naturalWidthPt: rendered.naturalWidthPt,
        naturalHeightPt: rendered.naturalHeightPt,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const signature = `${read.path}:${read.revision}:pdf:render-failed:${page.pageNumber}:${reason}`;
    return {
      path: read.path,
      watchedPaths,
      signature,
      resolution: {
        status: "unsupported",
        resolvedPath: read.path,
        revision: signature,
        watchedPaths,
        reason,
      },
    };
  }
}

function placeholderResolutionForUnpreparedRequest(
  filename: string,
  baseDirectory: string | null
): NodeTextGraphicsResolution {
  const descriptor = includeGraphicsPathDescriptor(filename, baseDirectory);
  if (descriptor?.kind === "unsupported") {
    return {
      status: "unsupported",
      reason: `Unsupported image extension '${descriptor.extension}'.`,
      resolvedPath: descriptor.path,
      revision: `unsupported:${descriptor.path}`,
      watchedPaths: [descriptor.path],
    };
  }
  return {
    status: "missing",
    revision: "unprepared",
    watchedPaths: descriptor?.candidates ?? [],
  };
}

function imageAssetResolverCacheKey(params: {
  readonly baseDirectory: string | null;
  readonly entries: readonly PreparedAssetEntry[];
}): string {
  const signatures = params.entries
    .map((entry) => {
      const resolution = entry.resolution;
      return {
        filename: entry.filename,
        rawOptions: entry.rawOptions,
        status: resolution.status,
        revision: resolution.revision ?? null,
        path: resolution.resolvedPath ?? null,
        size: resolution.status === "resolved"
          ? `${formatDimension(resolution.naturalWidthPt)}x${formatDimension(resolution.naturalHeightPt)}`
          : null,
      };
    })
    .sort((left, right) =>
      left.filename.localeCompare(right.filename) || left.rawOptions.localeCompare(right.rawOptions)
    );
  return JSON.stringify({
    kind: "image-assets",
    generation: cacheGeneration,
    baseDirectory: params.baseDirectory,
    signatures,
  });
}

function collectIncludeGraphicsCandidates(source: string): ImageIncludeCandidate[] {
  const candidates: ImageIncludeCandidate[] = [];
  const pattern = /\\includegraphics\b\s*(?:\[([^\]]*)\]\s*)?\{([^{}]+)\}/g;
  for (const match of source.matchAll(pattern)) {
    const rawOptions = match[1] ?? "";
    const filename = match[2]?.trim();
    if (filename) {
      candidates.push({ filename, rawOptions });
    }
  }
  return candidates;
}

function includeGraphicsRequestKey(params: {
  readonly filename: string;
  readonly rawOptions: string;
  readonly baseDirectory: string | null;
}): string {
  const normalizedFilename = params.filename.trim();
  const descriptor = includeGraphicsPathDescriptor(normalizedFilename, params.baseDirectory);
  const needsOptions = descriptor?.kind === "extensionless" ||
    (descriptor?.kind === "explicit" && extensionForPath(descriptor.candidates[0] ?? "") === ".pdf");
  return [
    params.baseDirectory ?? "",
    normalizedFilename,
    needsOptions ? pdfPageCacheDiscriminator(params.rawOptions) : "",
  ].join("\n");
}

function rawGraphicsOptions(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pdfPageCacheDiscriminator(rawOptions: string): string {
  const page = parsePdfPageOption(rawOptions);
  return page.status === "ok"
    ? `page=${page.pageNumber}`
    : `invalid-page=${rawOptions.trim()}`;
}

function parsePdfPageOption(rawOptions: string):
  | { readonly status: "ok"; readonly pageNumber: number }
  | { readonly status: "invalid"; readonly reason: string } {
  for (const part of splitGraphicsOptions(rawOptions)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const equals = trimmed.indexOf("=");
    const key = (equals >= 0 ? trimmed.slice(0, equals) : trimmed).trim().toLowerCase();
    if (key !== "page") {
      continue;
    }
    if (equals < 0) {
      return {
        status: "invalid",
        reason: "PDF page option must be a positive integer.",
      };
    }
    const value = trimmed.slice(equals + 1).trim();
    if (!/^\d+$/.test(value)) {
      return {
        status: "invalid",
        reason: "PDF page option must be a positive integer.",
      };
    }
    const pageNumber = Number(value);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
      return {
        status: "invalid",
        reason: "PDF page option must be a positive integer.",
      };
    }
    return { status: "ok", pageNumber };
  }
  return { status: "ok", pageNumber: 1 };
}

function splitGraphicsOptions(raw: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let braceDepth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
      continue;
    }
    if (char === "," && braceDepth === 0) {
      parts.push(raw.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts;
}

function includeGraphicsPathDescriptor(
  filename: string,
  baseDirectory: string | null
):
  | { readonly kind: "explicit"; readonly candidates: readonly string[] }
  | { readonly kind: "extensionless"; readonly candidates: readonly string[] }
  | { readonly kind: "unsupported"; readonly path: string; readonly extension: string }
  | null {
  const trimmed = filename.trim();
  if (!trimmed || isRemoteUrl(trimmed)) {
    return null;
  }
  const path = resolveLocalImagePath(trimmed, baseDirectory);
  if (!path) {
    return null;
  }
  const extension = extensionForPath(path);
  if (extension) {
    if (!SUPPORTED_EXTENSIONS.includes(extension as (typeof SUPPORTED_EXTENSIONS)[number])) {
      return {
        kind: "unsupported",
        path,
        extension,
      };
    }
    return {
      kind: "explicit",
      candidates: [path],
    };
  }
  return {
    kind: "extensionless",
    candidates: SUPPORTED_EXTENSIONS.map((supportedExtension) => `${path}${supportedExtension}`),
  };
}

function documentDirectory(fileRef: DocumentFileRef | null | undefined): string | null {
  if (fileRef?.provider !== "desktop-fs" || typeof fileRef.path !== "string") {
    return null;
  }
  const normalized = fileRef.path.trim();
  if (!normalized) {
    return null;
  }
  const slashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : null;
}

function resolveLocalImagePath(filename: string, baseDirectory: string | null): string | null {
  if (isAbsoluteLocalPath(filename)) {
    return normalizeLocalPath(filename);
  }
  if (!baseDirectory) {
    return null;
  }
  const separator = baseDirectory.includes("\\") && !baseDirectory.includes("/") ? "\\" : "/";
  return normalizeLocalPath(`${baseDirectory}${baseDirectory.endsWith("/") || baseDirectory.endsWith("\\") ? "" : separator}${filename}`);
}

function normalizeLocalPath(path: string): string {
  const usesBackslash = path.includes("\\") && !path.includes("/");
  const separator = usesBackslash ? "\\" : "/";
  const root = localPathRoot(path, separator);
  const rest = root ? path.slice(root.length) : path;
  const parts: string[] = [];
  for (const part of rest.split(/[\\/]+/)) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!root) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }
  return `${root}${parts.join(separator)}`;
}

function localPathRoot(path: string, separator: string): string {
  if (path.startsWith("\\\\")) {
    return "\\\\";
  }
  if (path.startsWith("/")) {
    return "/";
  }
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return `${path.slice(0, 2)}${separator}`;
  }
  return "";
}

function comparableLocalPath(path: string): string {
  return normalizeLocalPath(path).replaceAll("\\", "/");
}

function assetCacheKeyForCandidate(path: string, rawOptions: string): string {
  const comparablePath = comparableLocalPath(path);
  return extensionForPath(path) === ".pdf"
    ? `${comparablePath}\npdf:${pdfPageCacheDiscriminator(rawOptions)}`
    : comparablePath;
}

function isAbsoluteLocalPath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
}

function isRemoteUrl(path: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) && !/^[A-Za-z]:[\\/]/.test(path);
}

function extensionForPath(path: string): string | null {
  const basename = path.split(/[\\/]/).pop() ?? path;
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === basename.length - 1) {
    return null;
  }
  return basename.slice(dotIndex).toLowerCase();
}

function rawAssetMimeTypeForPath(path: string): RawAssetMimeType | null {
  const extension = extensionForPath(path);
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  if (extension === ".pdf") {
    return "application/pdf";
  }
  return null;
}

function naturalSizeForImage(
  bytes: Uint8Array,
  mimeType: ResolvedImageMimeType
): { readonly widthPt: number; readonly heightPt: number } | null {
  if (mimeType === "image/png") {
    return naturalPngSize(bytes);
  }
  if (mimeType === "image/jpeg") {
    return naturalJpegSize(bytes);
  }
  return naturalSvgSize(bytes);
}

function naturalPngSize(bytes: Uint8Array): { readonly widthPt: number; readonly heightPt: number } | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return null;
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return positivePixelSizeToPt(width, height);
}

function naturalJpegSize(bytes: Uint8Array): { readonly widthPt: number; readonly heightPt: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let index = 2;
  while (index + 9 < bytes.length) {
    if (bytes[index] !== 0xff) {
      index += 1;
      continue;
    }
    while (bytes[index] === 0xff) {
      index += 1;
    }
    const marker = bytes[index];
    index += 1;
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (index + 2 > bytes.length) {
      break;
    }
    const length = readUint16BE(bytes, index);
    if (length < 2 || index + length > bytes.length) {
      break;
    }
    if (isJpegStartOfFrameMarker(marker) && length >= 7) {
      const height = readUint16BE(bytes, index + 3);
      const width = readUint16BE(bytes, index + 5);
      return positivePixelSizeToPt(width, height);
    }
    index += length;
  }
  return null;
}

function naturalSvgSize(bytes: Uint8Array): { readonly widthPt: number; readonly heightPt: number } | null {
  const text = decodeUtf8(bytes);
  const svgTag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgTag) {
    return null;
  }
  const width = parseSvgLength(attributeValue(svgTag, "width"));
  const height = parseSvgLength(attributeValue(svgTag, "height"));
  if (width !== null && height !== null && width > 0 && height > 0) {
    return { widthPt: width, heightPt: height };
  }
  const viewBox = attributeValue(svgTag, "viewBox");
  if (!viewBox) {
    return null;
  }
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
  if (parts.length !== 4 || parts[2] <= 0 || parts[3] <= 0) {
    return null;
  }
  return positivePixelSizeToPt(parts[2], parts[3]);
}

function parseSvgLength(raw: string | null): number | null {
  if (!raw) {
    return null;
  }
  const match = raw.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))(pt|bp|px|in|cm|mm|pc)?$/i);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  const unit = (match[2] ?? "px").toLowerCase();
  switch (unit) {
    case "pt":
      return value;
    case "bp":
    case "px":
      return value * TEX_PT_PER_BP;
    case "in":
      return value * 72.27;
    case "cm":
      return (value * 72.27) / 2.54;
    case "mm":
      return (value * 72.27) / 25.4;
    case "pc":
      return value * 12;
    default:
      return null;
  }
}

function attributeValue(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = tag.match(pattern);
  return match?.[1] ?? match?.[2] ?? null;
}

function positivePixelSizeToPt(
  width: number,
  height: number
): { readonly widthPt: number; readonly heightPt: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    widthPt: width * TEX_PT_PER_BP,
    heightPt: height * TEX_PT_PER_BP,
  };
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function isJpegStartOfFrameMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function bytesFromBase64(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8").decode(bytes);
  }
  let text = "";
  for (let i = 0; i < bytes.length; i += 1) {
    text += String.fromCharCode(bytes[i]);
  }
  return decodeURIComponent(escape(text));
}

function formatDimension(value: number): string {
  return Number(value.toFixed(6)).toString();
}
