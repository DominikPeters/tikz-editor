import { describe, expect, it, vi } from "vitest";
import { renderTikzToSvgAsync } from "../packages/core/src/render/index.js";
import {
  installTexGlyphOutlines,
  loadTexGlyphOutlines,
  texGlyphOutline,
} from "../packages/core/src/text/tex/fonts/glyph-outlines.js";
import type { TexGlyphOutlines } from "../packages/core/src/text/tex/fonts/types.js";

const glyphPaths = (svg: string, font: string) =>
  [...svg.matchAll(new RegExp(`data-tex-font="${font}"[^>]* d="([^"]*)"`, "gu"))].map((match) => match[1]);

describe("lazily loaded glyph outlines", () => {
  it("renders blank glyphs until a font's outlines load, then renders again", async () => {
    vi.resetModules();
    const fresh = await import("../packages/core/src/text/tex/fonts/glyph-outlines.js");
    let renders = 0;
    const path = await fresh.withTexGlyphOutlines(() => {
      renders += 1;
      return fresh.texGlyphOutline("cmr10", 65);
    });
    expect(renders).toBe(2);
    expect(path).toBe(texGlyphOutline("cmr10", 65));
    expect(path).not.toBe("");
  });

  it("does not render again when every outline was already there", async () => {
    vi.resetModules();
    const fresh = await import("../packages/core/src/text/tex/fonts/glyph-outlines.js");
    await fresh.loadTexGlyphOutlines(["cmr10"]);
    let renders = 0;
    await fresh.withTexGlyphOutlines(() => {
      renders += 1;
      return fresh.texGlyphOutline("cmr10", 65);
    });
    expect(renders).toBe(1);
  });

  it("drops cached text and math rendered under older outlines", async () => {
    const source = String.raw`\begin{tikzpicture}\node {A $x$};\end{tikzpicture}`;
    await loadTexGlyphOutlines(["lmroman10-regular", "cmmi10"]);
    const text: TexGlyphOutlines = (await import("../packages/core/src/text/tex/fonts/data/outlines/lmroman10-regular.generated.js")).default;
    const math: TexGlyphOutlines = (await import("../packages/core/src/text/tex/fonts/data/outlines/cmmi10.generated.js")).default;
    const before = (await renderTikzToSvgAsync(source)).svg.svg;
    expect(glyphPaths(before, "lmroman10-regular")).toContain(text["65"]);
    expect(glyphPaths(before, "cmmi10")).toContain(math["120"]);
    try {
      installTexGlyphOutlines("lmroman10-regular", { ...text, 65: "M0 0Z" });
      installTexGlyphOutlines("cmmi10", { ...math, 120: "M1 1Z" });
      const after = (await renderTikzToSvgAsync(source)).svg.svg;
      expect(glyphPaths(after, "lmroman10-regular")).toContain("M0 0Z");
      expect(glyphPaths(after, "cmmi10")).toContain("M1 1Z");
    } finally {
      installTexGlyphOutlines("lmroman10-regular", text);
      installTexGlyphOutlines("cmmi10", math);
    }
  });
});
