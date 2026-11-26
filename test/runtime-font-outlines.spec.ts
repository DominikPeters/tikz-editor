import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { texGlyphOutline, texGlyphOutlineGeneration, withTexGlyphOutlines } from "../packages/core/src/text/tex/fonts/glyph-outlines.js";
import { buildRuntimeTexFont, loadRuntimeHarfBuzz } from "../packages/core/src/text/tex/fonts/runtime-opentype.js";
import { registerRuntimeTexFont, registerRuntimeTexFontTransfer, runtimeTexFont } from "../packages/core/src/text/tex/fonts/runtime-registry.js";

function texLiveFont(file: string): Uint8Array | null {
  try {
    const path = execFileSync("kpsewhich", [file], { encoding: "utf8" }).trim();
    return path ? readFileSync(path) : null;
  } catch {
    return null;
  }
}

const bytes = texLiveFont("Lato-Light.ttf");

describe("runtime font outlines", () => {
  it.skipIf(!bytes)("a transferred font has metrics at once and outlines once harfbuzz has drawn them", async () => {
    const hb = await loadRuntimeHarfBuzz();
    const built = buildRuntimeTexFont(hb, bytes!, "Lato-Light.ttf");
    // What a worker receives: structured-cloneable metrics and the file, no outlines.
    const received = structuredClone({ font: built.font, bytes: built.bytes });
    expect(Object.keys(received).sort()).toEqual(["bytes", "font"]);
    registerRuntimeTexFontTransfer("otf:Transferred.ttf", received);
    expect(runtimeTexFont("otf:Transferred.ttf")?.chars["120"]?.width).toBe(built.font.chars["120"]?.width);

    const generation = texGlyphOutlineGeneration();
    const rendered: string[] = [];
    const outline = await withTexGlyphOutlines(() => {
      const current = texGlyphOutline("otf:Transferred.ttf", 120);
      rendered.push(current);
      return current;
    });
    // The first render finds the outline missing (and starts drawing); the second has it.
    expect(rendered[0]).toBe("");
    expect(outline).toBe(built.outline(120));
    expect(outline).toMatch(/^M/u);
    expect(texGlyphOutlineGeneration()).toBeGreaterThan(generation);
  });

  it.skipIf(!bytes)("registering the same file again keeps the font and its outlines", async () => {
    const hb = await loadRuntimeHarfBuzz();
    const built = buildRuntimeTexFont(hb, bytes!, "Lato-Light.ttf");
    registerRuntimeTexFontTransfer("otf:Again.ttf", structuredClone({ font: built.font, bytes: built.bytes }));
    await withTexGlyphOutlines(() => texGlyphOutline("otf:Again.ttf", 120));
    const first = runtimeTexFont("otf:Again.ttf");
    const generation = texGlyphOutlineGeneration();
    registerRuntimeTexFontTransfer("otf:Again.ttf", structuredClone({ font: built.font, bytes: built.bytes }));
    expect(runtimeTexFont("otf:Again.ttf")).toBe(first);
    expect(texGlyphOutlineGeneration()).toBe(generation);
    expect(texGlyphOutline("otf:Again.ttf", 120)).toMatch(/^M/u);
  });

  it.skipIf(!bytes)("a font built here draws outlines synchronously", async () => {
    const hb = await loadRuntimeHarfBuzz();
    const built = buildRuntimeTexFont(hb, bytes!, "Lato-Light.ttf");
    registerRuntimeTexFont("otf:Local.ttf", built);
    expect(texGlyphOutline("otf:Local.ttf", 120)).toBe(built.outline(120));
    expect(texGlyphOutline("otf:Local.ttf", 120)).toMatch(/^M/u);
  });
});
