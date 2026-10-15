import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTexFontData, writeTexFontData } from "../scripts/lib/tex-font-data.mjs";
import { describe, expect, it } from "vitest";
import { COMPUTER_MODERN_OT1_FONTS } from "../packages/core/src/text/tex/fonts/data/computer-modern-ot1.generated.js";
import { parseGeneratedTexFontTable, parseGeneratedTexGlyphOutlines } from "../packages/core/src/text/tex/fonts/generated-data.js";

describe("generated TeX font data", () => {
  it("provides all common TFM parameters required by the font model", () => {
    const parameters = ["slant", "space", "stretch", "shrink", "xheight", "quad"] as const;
    for (const [fontId, font] of Object.entries(COMPUTER_MODERN_OT1_FONTS)) {
      for (const parameter of parameters) {
        expect(Number.isFinite(font.fontdimen[parameter]), `${fontId}.${parameter}`).toBe(true);
      }
    }
  });

  it("validates metric fields and nested generated structures before exposing a font table", () => {
    const font = Object.values(COMPUTER_MODERN_OT1_FONTS)[0];
    if (!font) throw new Error("Expected generated fonts");
    expect(parseGeneratedTexFontTable(JSON.stringify({ sample: font }))).toEqual({ sample: font });
    const invalidFonts = [
      { ...font, source: { kind: "unknown", name: "sample" } },
      { ...font, fontdimen: { ...font.fontdimen, space: "0.3" } },
      { ...font, fontdimen: { space: 0.3 } },
      { ...font, chars: { 65: { code: 65, width: "0.5" } } },
      { ...font, chars: { 65: { code: 65, varchar: { rep: "x" } } } },
      { ...font, ligKerns: [["lig", 65, 66]] },
      { ...font, ligKerns: [["unknown", 65, 66, 67]] },
      { ...font, ligKerns: [["kern", 65, 66, "0.1"]] },
    ];
    for (const invalid of invalidFonts) {
      expect(() => parseGeneratedTexFontTable(JSON.stringify({ sample: invalid }))).toThrow("Invalid generated TeX font metrics");
    }
  });

  it("round-trips generated metric and lazy outline modules through the generator reader", () => {
    const directory = mkdtempSync(join(tmpdir(), "tex-font-data-"));
    try {
      const metricsPath = join(directory, "metrics.generated.ts");
      const outlinesPath = join(directory, "outlines");
      const font = Object.values(COMPUTER_MODERN_OT1_FONTS)[0];
      if (!font) throw new Error("Expected generated fonts");
      const glyphs = { 65: "M0 0L1 1", 66: "path with 'quotes' and \\slashes" };
      const fonts = { sample: { ...font, glyphs } };
      writeTexFontData(fonts, metricsPath, outlinesPath);
      expect(readTexFontData(metricsPath, outlinesPath)).toEqual(fonts);
      expect(readFileSync(metricsPath, "utf8")).toContain("parseGeneratedTexFontTable(");
      expect(readFileSync(join(outlinesPath, "sample.generated.ts"), "utf8")).toContain("parseGeneratedTexGlyphOutlines(");
      expect(readFileSync(join(outlinesPath, "index.generated.ts"), "utf8")).toContain('import("./sample.generated.js")');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects non-record tables and non-string glyph outlines", () => {
    expect(parseGeneratedTexGlyphOutlines('{"65":"M0 0L1 1"}')).toEqual({ 65: "M0 0L1 1" });
    for (const value of [null, [], "font", 12]) {
      expect(() => parseGeneratedTexFontTable(JSON.stringify(value))).toThrow();
      expect(() => parseGeneratedTexGlyphOutlines(JSON.stringify(value))).toThrow();
    }
    expect(() => parseGeneratedTexGlyphOutlines('{"65":12}')).toThrow("Invalid generated TeX glyph outlines");
  });
});
