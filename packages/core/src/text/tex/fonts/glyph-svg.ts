import { texGlyphOutline } from "./glyph-outlines.js";
import type { GeneratedTexFont, ResolvedTexFont } from "./types.js";

type EscapedGlyphPath = { readonly source: string; readonly escaped: string; readonly id: string };
const escapedPaths = new WeakMap<GeneratedTexFont, Map<number, EscapedGlyphPath>>();

/**
 * Outlines of the glyph ids that rendered markup refers to. A glyph id is a
 * hash of its outline, so equal ids are interchangeable: fragments rendered at
 * different times, or cached, or combined into one document stay consistent.
 */
const definitions = new Map<string, string>();

const GLYPH_ID_PREFIX = "tg-";
const GLYPH_REFERENCE = /\bhref="#(tg-[0-9a-z]+)"/gu;

function escapeGlyphPath(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** 53-bit string hash (cyrb53), base 36. */
function hashOutline(source: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + source.length.toString(36);
}

function glyphEntry(font: ResolvedTexFont, code: number): EscapedGlyphPath | null {
  const source = texGlyphOutline(font.id, code);
  if (!source) return null;
  let paths = escapedPaths.get(font.data);
  const cached = paths?.get(code);
  if (cached?.source === source) return cached;
  const entry = { source, escaped: escapeGlyphPath(source), id: GLYPH_ID_PREFIX + hashOutline(source) };
  if (!paths) {
    paths = new Map();
    escapedPaths.set(font.data, paths);
  }
  paths.set(code, entry);
  return entry;
}

/** Glyph outlines are shared across font sizes and source positions. */
export function texGlyphSvgPath(font: ResolvedTexFont, code: number): string {
  return glyphEntry(font, code)?.escaped ?? "";
}

/**
 * The id of the glyph's outline, which `texGlyphSvgDefinitions` defines for any
 * markup that refers to it, or "" while the outline is not loaded.
 */
export function texGlyphSvgId(font: ResolvedTexFont, code: number): string {
  const entry = glyphEntry(font, code);
  if (!entry) return "";
  if (!definitions.has(entry.id)) definitions.set(entry.id, entry.escaped);
  return entry.id;
}

/** `<path id>` definitions, one per distinct glyph outline that `markup` refers to. */
export function texGlyphSvgDefinitions(markup: string): string[] {
  if (!markup.includes(`href="#${GLYPH_ID_PREFIX}`)) return [];
  const ids = new Set<string>();
  for (const match of markup.matchAll(GLYPH_REFERENCE)) ids.add(match[1] ?? "");
  const result: string[] = [];
  for (const id of [...ids].sort()) {
    const escaped = definitions.get(id);
    if (escaped !== undefined) result.push(`<path id="${id}" d="${escaped}"/>`);
  }
  return result;
}

/** Wraps `texGlyphSvgDefinitions` for standalone fragments: "" or one `<defs>` element. */
export function texGlyphSvgDefs(markup: string): string {
  const defs = texGlyphSvgDefinitions(markup);
  return defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "";
}
