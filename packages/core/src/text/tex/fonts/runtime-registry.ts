import { installTexGlyphOutlines } from "./glyph-outlines.js";
import type { RuntimeTexFontData } from "./runtime-opentype.js";
import type { GeneratedTexFont } from "./types.js";

/**
 * Fonts built at runtime from OpenType files (runtime-opentype.ts), next to
 * the generated table. Their ids start with `otf:` and name the font file,
 * so a document's fonts resolve the same way in every worker that registers
 * them.
 */
const fonts = new Map<string, GeneratedTexFont>();

export function runtimeTexFontId(fileName: string): `otf:${string}` {
  return `otf:${fileName}`;
}

export function registerRuntimeTexFont(id: string, data: RuntimeTexFontData): void {
  if (fonts.get(id) === data.font) return;
  fonts.set(id, data.font);
  installTexGlyphOutlines(id, data.outlines);
}

export function runtimeTexFont(id: string): GeneratedTexFont | undefined {
  return fonts.get(id);
}

export function hasRuntimeTexFont(id: string): boolean {
  return fonts.has(id);
}
