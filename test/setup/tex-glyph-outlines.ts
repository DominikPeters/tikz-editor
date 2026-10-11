import { loadAllTexGlyphOutlines } from "../../packages/core/src/text/tex/fonts/glyph-outlines.js";

// Renders without a text engine still paint glyphs, as in the app once fonts load.
await loadAllTexGlyphOutlines();
