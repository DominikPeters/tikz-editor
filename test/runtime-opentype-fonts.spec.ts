import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { buildRuntimeTexFont, createRuntimeOutlines, type RuntimeHarfBuzz } from "../packages/core/src/text/tex/fonts/runtime-opentype.js";

type OracleFont = {
  file: string;
  params: Record<string, number>;
  chars: Record<string, { width: number; height: number; depth: number }>;
  kerns: [number, number, number][];
  spaceKerns: [number, number, number][];
  ligatures: Record<string, number[]>;
};

// LuaLaTeX metrics from scripts/generate-runtime-font-oracle.mjs.
const oracle = JSON.parse(readFileSync(new URL("./fixtures/fonts/runtime-opentype-oracle.json", import.meta.url), "utf8")) as { fonts: OracleFont[] };

function texLiveFont(file: string): Uint8Array | null {
  try {
    const path = execFileSync("kpsewhich", [file], { encoding: "utf8" }).trim();
    return path ? readFileSync(path) : null;
  } catch {
    return null;
  }
}

const hb = await import("harfbuzzjs") as unknown as RuntimeHarfBuzz;

describe.each(oracle.fonts)("runtime OpenType font $file against LuaLaTeX", (expected) => {
  const bytes = texLiveFont(expected.file);
  const built = bytes ? buildRuntimeTexFont(hb, bytes, expected.file) : null;

  it.skipIf(!bytes)("sets the space, its glue and the x-height as luaotfload does", () => {
    const fontdimen = built!.font.fontdimen;
    expect(fontdimen.space).toBeCloseTo(expected.params.space ?? NaN, 6);
    expect(fontdimen.stretch).toBeCloseTo(expected.params.stretch ?? NaN, 6);
    expect(fontdimen.shrink).toBeCloseTo(expected.params.shrink ?? NaN, 6);
    expect(fontdimen.xheight).toBeCloseTo(expected.params.xheight ?? NaN, 6);
    expect(fontdimen.quad).toBe(expected.params.quad);
  });

  it.skipIf(!bytes)("gives each character luaotfload's width, height and depth", () => {
    for (const [code, metric] of Object.entries(expected.chars)) {
      const actual = built!.font.chars[code];
      expect(actual, `U+${Number(code).toString(16)}`).toBeDefined();
      expect(actual?.width, `width of U+${Number(code).toString(16)}`).toBeCloseTo(metric.width, 6);
      expect(actual?.height, `height of U+${Number(code).toString(16)}`).toBeCloseTo(metric.height, 6);
      expect(actual?.depth, `depth of U+${Number(code).toString(16)}`).toBeCloseTo(metric.depth, 6);
    }
  });

  it.skipIf(!bytes)("forms the same ligatures, with the same character codes", () => {
    const ligs = built!.font.ligKerns.filter(rule => rule[0] === "lig");
    for (const [text, codes] of Object.entries(expected.ligatures)) {
      let current = text.codePointAt(0) ?? 0;
      const result: number[] = [];
      for (const char of [...text].slice(1)) {
        const right = char.codePointAt(0) ?? 0;
        const rule = ligs.find(candidate => candidate[1] === current && candidate[2] === right);
        if (rule) current = rule[3];
        else { result.push(current); current = right; }
      }
      result.push(current);
      expect(result, text).toEqual(codes);
    }
  });

  it.skipIf(!bytes)("kerns exactly the pairs luaotfload kerns", () => {
    const kerns = new Map(built!.font.ligKerns.filter(rule => rule[0] === "kern").map(rule => [`${rule[1]},${rule[2]}`, rule[3]]));
    // With fontspec's default Ligatures=TeX, luaotfload replaces " ' ` by
    // curly quotes before kerning; the editor's text layer does that itself.
    const substituted = new Set([0x22, 0x27, 0x60]);
    // Pairs with the space glyph are checked by the spacekern test below.
    const measured = (pair: string) => pair.split(",").every(code => !substituted.has(Number(code)) && Number(code) !== 0x20);
    const expectedKerns = new Map(expected.kerns.filter(([left, right]) => !substituted.has(left) && !substituted.has(right))
      .map(([left, right, kern]) => [`${left},${right}`, kern]));
    // The oracle's kerns are rounded to scaled points at 10pt; luaotfload
    // rounds at each font size, so the builder keeps exact font units.
    for (const [pair, kern] of expectedKerns) expect(kerns.get(pair), `kern ${pair}`).toBeCloseTo(kern, 5);
    const asciiPairs = [...kerns.keys()].filter(pair => measured(pair) && pair.split(",").every(code => Number(code) < 0xfb00));
    expect(asciiPairs.filter(pair => !expectedKerns.has(pair))).toEqual([]);
  });

  it.skipIf(!bytes)("kerns against the space glyph as luaotfload's spacekern does", () => {
    const kerns = new Map(built!.font.ligKerns.filter(rule => rule[0] === "kern" && (rule[1] === 0x20 || rule[2] === 0x20))
      .map(rule => [`${rule[1]},${rule[2]}`, rule[3]]));
    const substituted = new Set([0x22, 0x27, 0x60]);
    const expectedKerns = expected.spaceKerns.filter(([left, right, kern]) => Math.abs(kern) > 1e-5 && !substituted.has(left) && !substituted.has(right));
    expect(expectedKerns.length).toBeGreaterThan(0);
    for (const [left, right, kern] of expectedKerns) expect(kerns.get(`${left},${right}`), `space kern ${left},${right}`).toBeCloseTo(kern, 5);
    const expectedPairs = new Set(expectedKerns.map(([left, right]) => `${left},${right}`));
    expect([...kerns.keys()].filter(pair => !expectedPairs.has(pair) && pair.split(",").every(code => !substituted.has(Number(code))))).toEqual([]);
  });

  it.skipIf(!bytes)("draws outlines in 10pt units with y up negative", () => {
    const x = built!.outline(0x78);
    expect(x).toMatch(/^M/u);
    const ys = [...(x ?? "").matchAll(/-?\d+(?:\.\d+)?/gu)].map(match => Number(match[0])).filter((_, index) => index % 2 === 1);
    expect(Math.min(...ys)).toBeCloseTo(-(expected.params.xheight ?? 0) * 10, 2);
  });

  it.skipIf(!bytes)("draws each outline when first asked, and a worker's from the file draws the same", () => {
    const drawn = vi.spyOn(hb.Font.prototype, "glyphToJson");
    try {
      const fresh = buildRuntimeTexFont(hb, bytes!, expected.file);
      expect(drawn).not.toHaveBeenCalled();
      const x = fresh.outline(0x78);
      expect(drawn).toHaveBeenCalledTimes(1);
      expect(fresh.outline(0x78)).toBe(x);
      expect(drawn).toHaveBeenCalledTimes(1);
      expect(fresh.outline(0x20)).toBe("");
      expect(fresh.outline(0x10ffff)).toBe("");
      expect(createRuntimeOutlines(hb, bytes!)(0x78)).toBe(x);
      // Ligature glyphs are numbered privately, in both.
      const ligature = fresh.font.ligKerns.find(entry => entry[0] === "lig" && entry[3] >= 0xf0000);
      if (ligature) {
        expect(fresh.outline(ligature[3])).toMatch(/^M/u);
        expect(createRuntimeOutlines(hb, bytes!)(ligature[3])).toBe(fresh.outline(ligature[3]));
      }
    } finally {
      drawn.mockRestore();
    }
  });
});
