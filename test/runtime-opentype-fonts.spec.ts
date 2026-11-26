import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildRuntimeTexFont, type RuntimeHarfBuzz } from "../packages/core/src/text/tex/fonts/runtime-opentype.js";

type OracleFont = {
  file: string;
  params: Record<string, number>;
  chars: Record<string, { width: number; height: number; depth: number }>;
  kerns: [number, number, number][];
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
    const measured = (pair: string) => pair.split(",").every(code => !substituted.has(Number(code)));
    const expectedKerns = new Map(expected.kerns.filter(([left, right]) => !substituted.has(left) && !substituted.has(right))
      .map(([left, right, kern]) => [`${left},${right}`, kern]));
    // The oracle's kerns are rounded to scaled points at 10pt; luaotfload
    // rounds at each font size, so the builder keeps exact font units.
    for (const [pair, kern] of expectedKerns) expect(kerns.get(pair), `kern ${pair}`).toBeCloseTo(kern, 5);
    const asciiPairs = [...kerns.keys()].filter(pair => measured(pair) && pair.split(",").every(code => Number(code) < 0xfb00));
    expect(asciiPairs.filter(pair => !expectedKerns.has(pair))).toEqual([]);
  });

  it.skipIf(!bytes)("draws outlines in 10pt units with y up negative", () => {
    const x = built!.outlines[String(0x78)];
    expect(x).toMatch(/^M/u);
    const ys = [...(x ?? "").matchAll(/-?\d+(?:\.\d+)?/gu)].map(match => Number(match[0])).filter((_, index) => index % 2 === 1);
    expect(Math.min(...ys)).toBeCloseTo(-(expected.params.xheight ?? 0) * 10, 2);
  });
});
