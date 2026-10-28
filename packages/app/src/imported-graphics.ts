import type { LocalAssetReadResult, PlatformPersistence } from "./platform/types.js";
import type { DocumentFileRef } from "./store/types.js";

const PREFIX = "__tikz_assets__/";
const KEY = "tikz-editor:imported-graphic:";
export function isImportedGraphicPath(path: string): boolean { return path.startsWith(PREFIX); }

export function importedGraphicPath(name: string): string {
  const filename = name.replace(/[^a-zA-Z0-9._-]/gu, "-");
  return `${PREFIX}${crypto.randomUUID()}/${filename}`;
}

export function graphicBytesBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const chunks: string[] = [];
  // Bound argument count and avoid one intermediate string node per byte when
  // importing multi-megabyte images/PDFs.
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...view.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}

export function storeImportedGraphic(storage: PlatformPersistence, graphic: { path: string; payload: string }): void {
  storage.save(KEY + graphic.path, graphic.payload);
  if (storage.load(KEY + graphic.path) !== graphic.payload) throw new Error("The selected image could not be saved in browser storage.");
}

export function readImportedGraphic(storage: PlatformPersistence, path: string): LocalAssetReadResult | null {
  if (!isImportedGraphicPath(path)) return null;
  const payload = storage.load(KEY + path);
  return payload === null ? null : { status: "ok", path, bytesBase64: payload, size: Math.floor(payload.length * 3 / 4), revision: path };
}

/** Native references stay portable within the source's directory tree. */
export function replacementGraphicPath(file: DocumentFileRef, document: DocumentFileRef | null): string | null {
  if (file.provider !== "desktop-fs" || !file.path) return null;
  const path = file.path.replaceAll("\\", "/");
  const directory = document?.provider === "desktop-fs" && document.path ? document.path.replaceAll("\\", "/").replace(/\/[^/]*$/u, "") : null;
  if (!directory || /^[a-z]:/iu.exec(path)?.[0].toLowerCase() !== /^[a-z]:/iu.exec(directory)?.[0].toLowerCase()) return path;
  const source = directory.split("/");
  const target = path.split("/");
  const windows = /^[a-z]:/iu.test(path) || path.startsWith("//");
  if (path.startsWith("//") && source.slice(0, 4).join("/").toLowerCase() !== target.slice(0, 4).join("/").toLowerCase()) return path;
  let common = 0;
  while (common < Math.min(source.length, target.length) && (windows ? source[common]?.toLowerCase() === target[common]?.toLowerCase() : source[common] === target[common])) common++;
  return [...source.slice(common).map(() => ".."), ...target.slice(common)].join("/");
}
