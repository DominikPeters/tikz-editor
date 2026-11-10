import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveGraphicsName, texGraphicsPathPrefixes, type DocumentGraphicsResolver } from "@tikz-editor/core/graphics/index.js";
import type { TexFuzzNode } from "./model.js";
import type { TexFuzzRandom } from "./random.js";

/** Ordered key programs: repeated sizing/crop keys and rotation order are intentional. */
export const TEX_FUZZ_GRAPHICS_KEYS = ["width", "height", "totalheight", "scale", "angle", "origin", "keepaspectratio", "trim", "viewport", "bb", "clip", "draft", "page"] as const;
export const TEX_FUZZ_GRAPHICS_PROGRAMS: readonly (readonly string[])[] = [
  [], ["width=18pt"], ["height=10pt"], ["totalheight=12pt"], ["scale=.5"],
  ["width=18pt", "height=10pt", "keepaspectratio"],
  ["width=18pt", "angle=90"], ["angle=90", "width=18pt"],
  ["origin=c", "angle=-30", "totalheight=12pt"], ["angle=-90", "totalheight=12pt"],
  ["width=18pt", "width=!"], ["scale=.5", "width=18pt"], ["angle=30", "scale=.75"],
  ["trim=2 1 3 2", "clip", "width=18pt"], ["viewport=2 1 20 14", "clip"],
  ["bb=2 1 20 14", "clip", "height=10pt"],
  ["trim=2 1 3 2", "viewport=1 1 20 14", "clip=false"],
  ["viewport=1 1 20 14", "trim=2 1 3 2", "clip"], ["draft", "width=18pt"],
];

export function generateTexFuzzGraphicsNode(random: TexFuzzRandom, path: string): Extract<TexFuzzNode, { kind: "includegraphics" }> {
  const filename = random.pick(`${path}/image-file`, ["fuzz-images/pattern.png", "fuzz-images/photo.jpg", "fuzz-images/pages.pdf", "fuzz-images/pattern.v2"] as const);
  const options = [...random.pick(`${path}/image-program`, TEX_FUZZ_GRAPHICS_PROGRAMS)];
  if (filename.endsWith(".pdf")) options.unshift(`page=${random.pick(`${path}/image-page`, [1, 2] as const)}`);
  const corners = random.int(`${path}/image-corners`, 12) === 0;
  return { kind: "includegraphics", filename, options: corners ? [] : options,
    starred: random.boolean(`${path}/image-star`),
    gap: random.boolean(`${path}/image-trivia`) ? " " : " % image argument\n",
    ...(corners ? { corners: ["1,1", "20,14"] as const } : {}) };
}

interface ImagePage { readonly dataPath: string; readonly widthBp: number; readonly heightBp: number }
interface Image { readonly path: string; readonly mimeType: "image/png" | "image/jpeg"; readonly pages: readonly ImagePage[] }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
const fixtureRoot = new URL("../../../test/fixtures/graphics-fuzz/", import.meta.url);
let loaded: { images: readonly Image[]; bytes: ReadonlyMap<string, Buffer>; revision: string } | undefined;

/** Load the same image fixtures used by the TeX comparisons. */
function assets() {
  if (loaded) return loaded;
  const manifest: unknown = JSON.parse(readFileSync(new URL("assets.json", fixtureRoot), "utf8"));
  if (!record(manifest) || !Array.isArray(manifest.files) || !Array.isArray(manifest.images)) throw new Error("Invalid image fuzz fixture manifest.");
  const bytes = new Map<string, Buffer>();
  const revision = createHash("sha256").update(JSON.stringify(manifest));
  for (const path of manifest.files as unknown[]) {
    if (typeof path !== "string" || path.includes("..") || !path.startsWith("fuzz-images/")) throw new Error("Invalid image fuzz fixture path.");
    const data = readFileSync(new URL(path, fixtureRoot));
    revision.update(data);
    bytes.set(path, data);
  }
  const entries: readonly unknown[] = manifest.images;
  const images = entries.map((entry): Image => {
    if (!record(entry) || typeof entry.path !== "string" || (entry.mimeType !== "image/png" && entry.mimeType !== "image/jpeg")) throw new Error("Invalid image fuzz fixture image.");
    const pages: readonly unknown[] = Array.isArray(entry.pages) ? entry.pages : [{ ...entry, dataPath: entry.path }];
    return { path: entry.path, mimeType: entry.mimeType, pages: pages.map((page) => {
      if (!record(page) || typeof page.dataPath !== "string" || !bytes.has(page.dataPath) ||
        typeof page.widthBp !== "number" || !(page.widthBp > 0) || typeof page.heightBp !== "number" || !(page.heightBp > 0)) throw new Error("Invalid image fuzz fixture page.");
      return { dataPath: page.dataPath, widthBp: page.widthBp, heightBp: page.heightBp };
    }) };
  });
  loaded = { images, bytes, revision: revision.digest("hex") };
  return loaded;
}

export function createTexFuzzGraphicsResolver(source = ""): DocumentGraphicsResolver {
  const catalog = assets();
  const prefixes = texGraphicsPathPrefixes(source);
  const files = new Set(catalog.images.map((image) => image.path));
  return { cacheKey: `fuzz-images:${catalog.revision}:${prefixes.join(";")}`, resolve(request) {
    const path = resolveGraphicsName(request.filename, prefixes, files);
    const image = catalog.images.find((entry) => entry.path === path);
    if (!image) return { status: "missing" };
    if (request.options.page?.status === "invalid") return { status: "unsupported", reason: "Invalid PDF page" };
    const page = image.pages[image.path.endsWith(".pdf") ? (request.options.page?.pageNumber ?? 1) - 1 : 0];
    const data = page && catalog.bytes.get(page.dataPath);
    if (!page || !data) return { status: "unsupported", reason: "Image page is outside the controlled fixture" };
    return { status: "resolved", mimeType: image.mimeType, dataBase64: data.toString("base64"),
      naturalWidthPt: page.widthBp * 72.27 / 72, naturalHeightPt: page.heightBp * 72.27 / 72, revision: catalog.revision };
  } };
}
