import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTexFuzzGraphicsResolver } from "../../packages/tex-fuzz/src/graphics.js";
import type { DocumentFileRef } from "../../packages/app/src/store/types.js";
import type { EditorPlatform } from "../../packages/app/src/platform/types.js";
import type { PdfAssetRasterizer } from "../../packages/app/src/pdf-asset-rasterizer.js";

const directory = fileURLToPath(new URL("../fixtures/graphics-fuzz/", import.meta.url));
const pdf = readFileSync(resolve(directory, "fuzz-images/pages.pdf"));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const pdfHash = hash(pdf);

export function fuzzGraphicsDocumentFileRef(source: string): DocumentFileRef | null {
  return source.includes("fuzz-images/") ? { kind: "file", name: "main.tex", provider: "desktop-fs", path: resolve(directory, "main.tex") } : null;
}

/** Exercise the app's real path lookup, byte decoding and resource caches. */
export function graphicsFuzzPlatform(previous: EditorPlatform): EditorPlatform {
  return { ...previous, id: `${previous.id}:controlled-graphics`, files: { ...previous.files, readLocalAsset: async path => {
    if (!resolve(path).startsWith(directory.replace(/[\\/]+$/u, "") + sep)) return await previous.files?.readLocalAsset?.(path) ?? { status: "missing", path };
    if (!existsSync(path)) return { status: "missing", path };
    const bytes = readFileSync(path);
    return { status: "ok", path, bytesBase64: bytes.toString("base64"), size: bytes.length, revision: hash(bytes) };
  } } };
}

/** Node has no PDF canvas: use pinned Poppler pages, not missing-image fallbacks. */
export const graphicsFuzzPdfRasterizer: PdfAssetRasterizer = async request => {
  if (hash(request.bytes) !== pdfHash) throw new Error("PDF is outside the controlled graphics corpus.");
  const result = createTexFuzzGraphicsResolver().resolve({ filename: "fuzz-images/pages.pdf", options: { raw: "", page: { status: "valid", pageNumber: request.pageNumber } }, source: "", sourceStart: 0, sourceEnd: 0 });
  if (result.status !== "resolved") throw new Error("Controlled PDF page is missing.");
  // Match pdf-asset-rasterizer.ts's default scale 2 (144 dpi).
  return { ...result, mimeType: "image/png", renderScale: 2, pixelWidth: Math.round(result.naturalWidthPt * 144 / 72.27),
    pixelHeight: Math.round(result.naturalHeightPt * 144 / 72.27), signature: `${pdfHash}:page=${request.pageNumber}:scale=2` };
};
