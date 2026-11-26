import { installTexGlyphOutlines, registerTexGlyphOutlineLoader } from "./glyph-outlines.js";
import { createRuntimeOutlines, loadRuntimeHarfBuzz, type RuntimeTexFontData, type RuntimeTexFontTransfer } from "./runtime-opentype.js";
import type { GeneratedTexFont } from "./types.js";

/**
 * Fonts built at runtime from OpenType files (runtime-opentype.ts), next to
 * the generated table. Their ids start with `otf:` and name the font file,
 * so a document's fonts resolve the same way in every worker that registers
 * them.
 */
const fonts = new Map<string, GeneratedTexFont>();
const fontBytes = new Map<string, Uint8Array>();

export function runtimeTexFontId(fileName: string): `otf:${string}` {
  return `otf:${fileName}`;
}

/** Registers a font built in this thread, whose outlines it draws itself. */
export function registerRuntimeTexFont(id: string, data: RuntimeTexFontData): void {
  if (fonts.get(id) === data.font) return;
  fonts.set(id, data.font);
  fontBytes.set(id, data.bytes);
  installTexGlyphOutlines(id, data.outline);
}

/**
 * Registers a font from its metrics and file, as a worker receives it: the
 * metrics are usable at once, and outlines are drawn from the file (with
 * harfbuzz, loaded on the first paint) when glyphs are first rendered. The
 * font stays as it is when the same file is registered again.
 */
export function registerRuntimeTexFontTransfer(id: string, transfer: RuntimeTexFontTransfer): void {
  if (fonts.get(id) === transfer.font) return;
  const known = fontBytes.get(id);
  if (known && sameBytes(known, transfer.bytes) && fonts.has(id)) return;
  fonts.set(id, transfer.font);
  fontBytes.set(id, transfer.bytes);
  registerTexGlyphOutlineLoader(id, async () => createRuntimeOutlines(await loadRuntimeHarfBuzz(), transfer.bytes));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

export function runtimeTexFont(id: string): GeneratedTexFont | undefined {
  return fonts.get(id);
}

export function hasRuntimeTexFont(id: string): boolean {
  return fonts.has(id);
}
