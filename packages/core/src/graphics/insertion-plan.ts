import { analyzeSimpleTexResources } from "../text/tex/ir.js";
import { texGraphicsPathPrefixes } from "./graphics-path.js";

/**
 * Where a new image goes, and how its `\includegraphics` names it, following
 * the conventions the document already has. Paths are POSIX and relative to
 * the directory TeX runs in (the main file's); `""` is that directory itself.
 */

/** Image files around the document, as a bounded scan of the folder found them. */
export interface GraphicsFolderListing {
  readonly files: readonly { readonly path: string; readonly size?: number }[];
  /** Folders that exist, including empty ones. */
  readonly directories?: readonly string[];
}

export type GraphicsFolderReason = "graphicspath" | "nearest" | "existing" | "loose" | "default";

export interface GraphicsFolderChoice {
  readonly folder: string;
  readonly reason: GraphicsFolderReason;
}

export interface GraphicsInsertionPlan {
  readonly folder: string;
  readonly reason: GraphicsFolderReason;
  /** The file to write (or reuse), relative to the TeX directory. */
  readonly path: string;
  /** The `\includegraphics` argument. */
  readonly texPath: string;
  /** An identical file is already there; nothing needs writing. */
  readonly reuse: boolean;
}

export const DEFAULT_GRAPHICS_FOLDER = "figures";

// pdftex.def's \Gin@extensions, in order.
const TEX_GRAPHICS_EXTENSIONS = [".pdf", ".png", ".jpg", ".mps", ".jpeg", ".jbig2", ".jb2", ".PDF", ".PNG", ".JPG", ".JPEG", ".JBIG2", ".JB2", ".eps"];
const KNOWN_EXTENSIONS = new Set([...TEX_GRAPHICS_EXTENSIONS, ".svg", ".gif", ".tif", ".tiff", ".bmp", ".webp", ".heic", ".ps"].map((extension) => extension.toLowerCase()));
const IMPORTED_PREFIX = "__tikz_assets__/";

interface Reference {
  readonly offset: number;
  readonly written: string;
  /** Folder of the file it names, when it can be told. */
  readonly folder: string | null;
  /** The graphicspath prefix it was found through. */
  readonly prefix: string | null;
}

/** The folder a new image inserted at `offset` belongs in. */
export function planGraphicsFolder(source: string, offset: number, listing: GraphicsFolderListing | null): GraphicsFolderChoice {
  const prefixes = texGraphicsPathPrefixes(source).map(normalizePrefix).filter((prefix): prefix is string => prefix !== null);
  const references = graphicsReferences(source, prefixes, listing);
  if (prefixes.length > 0) {
    // The author declared where images live: stay among those folders.
    const declared = nearest(references.filter((reference) => reference.prefix !== null), offset);
    const first = prefixes.find((prefix) => prefix === "" || prefix.endsWith("/"));
    if (declared?.folder != null || first !== undefined) return { folder: declared?.folder ?? stripSlash(first ?? ""), reason: "graphicspath" };
  }
  const located = references.filter((reference) => reference.folder !== null);
  // A shared folder outside the project (a logo, say) is a convention only
  // when the document keeps nothing of its own.
  const own = located.filter((reference) => !isOutside(reference.folder ?? ""));
  const near = nearest(own.length > 0 ? own : located, offset);
  if (near?.folder != null) return { folder: near.folder, reason: "nearest" };

  const counts = new Map<string, number>();
  for (const file of listing?.files ?? []) {
    const path = normalizePath(file.path);
    if (path === null || path.startsWith(IMPORTED_PREFIX) || !KNOWN_EXTENSIONS.has(extensionOf(path).toLowerCase())) continue;
    const folder = dirname(path);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  const best = [...counts].sort(([a, countA], [b, countB]) => countB - countA || depth(a) - depth(b) || a.localeCompare(b))[0];
  if (best) return { folder: best[0], reason: best[0] === "" ? "loose" : "existing" };
  return { folder: DEFAULT_GRAPHICS_FOLDER, reason: "default" };
}

/**
 * The file name and `\includegraphics` argument for `name` in `folder`.
 * `extension` is the file's actual extension (with its dot), after any
 * conversion. `identical` holds listed paths whose bytes equal the new file's.
 */
export function planGraphicsFileName(
  source: string,
  choice: GraphicsFolderChoice,
  name: string,
  extension: string,
  listing: GraphicsFolderListing | null,
  identical: ReadonlySet<string> = new Set(),
): GraphicsInsertionPlan {
  const folder = choice.folder;
  const prefixes = texGraphicsPathPrefixes(source).map(normalizePrefix).filter((prefix): prefix is string => prefix !== null);
  const references = graphicsReferences(source, prefixes, listing);
  const files = (listing?.files ?? []).map((file) => normalizePath(file.path)).filter((path): path is string => path !== null);
  const ext = extension.toLowerCase();

  const reused = files.find((path) => dirname(path) === folder && identical.has(path) && extensionOf(path).toLowerCase() === ext);
  const siblings = files.filter((path) => dirname(path) === folder);
  const base = reused ? stemOf(basename(reused)) : uniqueStem(styledStem(name, [...siblings, ...references.filter((reference) => reference.folder === folder).map((reference) => reference.written)].map((path) => stemOf(basename(path)))), siblings);
  const path = join(folder, `${base}${reused ? extensionOf(reused) : ext}`);

  const existing = new Set(files);
  existing.add(path);
  const omitExtension = references.length > 0 && references.every((reference) => !hasKnownExtension(reference.written));
  const dotSlash = references.filter((reference) => reference.written.includes("/"));
  const useDotSlash = dotSlash.length > 0 && dotSlash.filter((reference) => reference.written.startsWith("./")).length * 2 > dotSlash.length;

  const withinPrefix = [...prefixes].sort((a, b) => b.length - a.length).find((prefix) => (folder === "" ? "" : `${folder}/`).startsWith(prefix));
  const candidates: string[] = [];
  const forms = (relative: string) => {
    const full = omitExtension ? relative.slice(0, relative.length - extensionOf(relative).length) : relative;
    if (omitExtension) candidates.push(full);
    candidates.push(relative);
  };
  if (withinPrefix !== undefined) forms(path.slice(withinPrefix.length));
  forms(useDotSlash && folder !== "" && !isOutside(folder) ? `./${path}` : path);
  const texPath = candidates.find((candidate) => resolveGraphicsName(candidate, prefixes, existing) === path) ?? path;
  return { folder, reason: choice.reason, path, texPath, reuse: reused !== undefined };
}

/** graphics.sty's lookup of `\includegraphics{name}` among `files`. */
export function resolveGraphicsName(name: string, prefixes: readonly string[], files: ReadonlySet<string>): string | null {
  return lookupGraphicsName(name, prefixes, files)?.path ?? null;
}

function lookupGraphicsName(name: string, prefixes: readonly string[], files: ReadonlySet<string>): { path: string; prefix: string | null } | null {
  const bases = [{ base: normalizePath(name), prefix: null as string | null }, ...prefixes.map((prefix) => ({ base: normalizePath(`${prefix}${name}`), prefix }))]
    .filter((entry): entry is { base: string; prefix: string | null } => entry.base !== null);
  // A recognised extension names the file; anything else (`plot.v2`) gets
  // each of \Gin@extensions in turn, across every prefix.
  if (hasKnownExtension(name)) {
    const found = bases.find((entry) => files.has(entry.base));
    return found ? { path: found.base, prefix: found.prefix } : null;
  }
  for (const extension of [...TEX_GRAPHICS_EXTENSIONS, ".svg"]) {
    for (const entry of bases) if (files.has(entry.base + extension)) return { path: entry.base + extension, prefix: entry.prefix };
  }
  return null;
}

function graphicsReferences(source: string, prefixes: readonly string[], listing: GraphicsFolderListing | null): Reference[] {
  const files = new Set((listing?.files ?? []).map((file) => normalizePath(file.path)).filter((path): path is string => path !== null));
  const references: Reference[] = [];
  for (const graphic of analyzeSimpleTexResources(source).graphics) {
    const written = graphic.filename.trim();
    if (!written || written.startsWith(IMPORTED_PREFIX) || isAbsolute(written)) continue;
    const found = lookupGraphicsName(written, prefixes, files);
    // An unlisted file still shows its folder when the name spells one out.
    const folder = found ? dirname(found.path) : prefixes.length === 0 && written.includes("/") ? normalizePath(dirname(written)) : null;
    references.push({ offset: graphic.sourceStart, written, folder, prefix: found?.prefix ?? null });
  }
  return references;
}

function nearest(references: readonly Reference[], offset: number): Reference | null {
  let before: Reference | null = null;
  let after: Reference | null = null;
  for (const reference of references) {
    if (reference.offset < offset) { if (!before || reference.offset > before.offset) before = reference; }
    else if (!after || reference.offset < after.offset) after = reference;
  }
  return before ?? after;
}

type NameStyle = { readonly separator: "-" | "_"; readonly lowercase: boolean } | null;

/** `name`'s words, written the way the neighbouring files are named. */
export function styledStem(name: string, neighbours: readonly string[]): string {
  const stem = stemOf(basename(name.replaceAll("\\", "/")));
  const style = nameStyle(neighbours);
  const words = stem.split(/[^A-Za-z0-9]+/u).filter(Boolean);
  if (words.length === 0) return "image";
  if (!style) {
    // No convention to follow: keep the name, minus what TeX trips on.
    return stem.replace(/[^A-Za-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "") || "image";
  }
  const joined = words.join(style.separator);
  return style.lowercase ? joined.toLowerCase() : joined;
}

function nameStyle(stems: readonly string[]): NameStyle {
  const named = stems.filter((stem) => /[A-Za-z]/u.test(stem));
  if (named.length < 2) return null;
  const hyphen = named.filter((stem) => stem.includes("-")).length;
  const underscore = named.filter((stem) => stem.includes("_")).length;
  return { separator: underscore > hyphen ? "_" : "-", lowercase: named.every((stem) => stem === stem.toLowerCase()) };
}

function uniqueStem(stem: string, siblings: readonly string[]): string {
  // Any extension counts: an extensionless reference would find the other file.
  const taken = new Set(siblings.map((path) => stemOf(basename(path)).toLowerCase()));
  if (!taken.has(stem.toLowerCase())) return stem;
  const separator = stem.includes("_") && !stem.includes("-") ? "_" : "-";
  for (let index = 2; ; index++) {
    const candidate = `${stem}${separator}${index}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function hasKnownExtension(path: string): boolean {
  return KNOWN_EXTENSIONS.has(extensionOf(path).toLowerCase());
}

function extensionOf(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

function stemOf(name: string): string {
  return hasKnownExtension(name) ? name.slice(0, name.length - extensionOf(name).length) : name;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function join(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

function depth(folder: string): number {
  return folder === "" ? 0 : folder.split("/").length;
}

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || path.startsWith("~") || /^[A-Za-z]:/u.test(path);
}

function isOutside(folder: string): boolean {
  return folder === ".." || folder.startsWith("../");
}

function stripSlash(prefix: string): string {
  return prefix.replace(/\/+$/u, "");
}

function normalizePrefix(prefix: string): string | null {
  if (isAbsolute(prefix)) return null;
  const path = normalizePath(prefix);
  // A prefix is prepended verbatim; without its slash it names files, not a folder.
  return path === null ? null : path === "" ? "" : prefix.endsWith("/") ? `${path}/` : path;
}

/** Collapse `.` and `..` segments; null for absolute paths. */
function normalizePath(path: string): string | null {
  if (isAbsolute(path)) return null;
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
