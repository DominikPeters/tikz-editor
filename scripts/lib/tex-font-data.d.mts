import type { GeneratedTexFont, TexGlyphOutlines } from "../../packages/core/src/text/tex/fonts/types.js";

export const TEX_FONT_DATA_PATH: string;
export const TEX_FONT_OUTLINES_DIR: string;

/** Reads serialized generator data; callers must validate it before using domain types. */
export function readTexFontData(path?: string, outlinesDir?: string): unknown;
export function writeTexFontData(
  fonts: Readonly<Record<string, GeneratedTexFont & { readonly glyphs?: TexGlyphOutlines }>>,
  path?: string,
  outlinesDir?: string
): void;
