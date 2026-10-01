import type { GeneratedTexFont, ResolvedTexFont } from "./types.js";

type EscapedGlyphPath = { readonly source: string; readonly escaped: string };
const escapedPaths = new WeakMap<GeneratedTexFont, Map<number, EscapedGlyphPath>>();

/** Glyph outlines are shared across font sizes and source positions. */
export function texGlyphSvgPath(font: ResolvedTexFont, code: number): string {
  const source = font.data.glyphs?.[String(code)] ?? "";
  if (!source) return "";
  let paths = escapedPaths.get(font.data);
  const cached = paths?.get(code);
  if (cached?.source === source) return cached.escaped;
  const escaped = source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  if (!paths) {
    paths = new Map();
    escapedPaths.set(font.data, paths);
  }
  paths.set(code, { source, escaped });
  return escaped;
}
