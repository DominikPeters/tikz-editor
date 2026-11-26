import type { GeneratedTexCharMetric, GeneratedTexFont, GeneratedTexLigKern, TexGlyphOutlines } from "./types.js";

/**
 * The part of harfbuzzjs this module uses. The host loads harfbuzzjs (and
 * its WebAssembly) and passes the module in, so core stays free of a bundler-
 * specific asset import.
 */
export type RuntimeHarfBuzz = {
  readonly Blob: new (data: Uint8Array) => RuntimeHarfBuzzBlob;
  readonly Face: new (blob: RuntimeHarfBuzzBlob, index?: number) => RuntimeHarfBuzzFace;
  readonly Font: new (face: RuntimeHarfBuzzFace) => RuntimeHarfBuzzFont;
  readonly Buffer: new () => RuntimeHarfBuzzBuffer;
  readonly Feature: new (tag: string, value?: number) => RuntimeHarfBuzzFeature;
  shape(font: RuntimeHarfBuzzFont, buffer: RuntimeHarfBuzzBuffer, features?: RuntimeHarfBuzzFeature[]): void;
};

type RuntimeHarfBuzzBlob = object;
type RuntimeHarfBuzzFeature = object;

type RuntimeHarfBuzzFace = {
  readonly upem: number;
  collectUnicodes(): Uint32Array;
  referenceTable(table: string): Uint8Array | undefined;
};

type RuntimeHarfBuzzFont = {
  nominalGlyph(unicode: number): number | undefined;
  glyphHAdvance(glyph: number): number;
  glyphExtents(glyph: number): { xBearing: number; yBearing: number; width: number; height: number } | undefined;
  glyphToJson(glyph: number): readonly { type: string; values: readonly number[] }[];
};

type RuntimeHarfBuzzBuffer = {
  addCodePoints(codePoints: number[]): void;
  guessSegmentProperties(): void;
  getGlyphInfosAndPositions(): readonly { codepoint: number; xAdvance?: number }[];
};

export type RuntimeTexFontData = {
  readonly font: GeneratedTexFont;
  readonly outlines: TexGlyphOutlines;
};

// luaotfload numbers glyphs without a Unicode mapping from here, in glyph order.
const PRIVATE_BASE = 0xf0000;
// Pairs are measured for printable ASCII, curly quotes and dashes, and the
// ligatures, as the build-time generator does for Fira.
const PAIR_CODES = [
  ...Array.from({ length: 0x7e - 0x21 + 1 }, (_, index) => 0x21 + index),
  0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014,
];
// Common ligatures luaotfload applies with fontspec's default Ligatures=Common.
const LIGATURE_INPUTS = ["ff", "fi", "fl", "ffi", "ffl", "fj", "ffj", "ft", "fft", "fb", "fh", "fk", "ffb", "ffh", "ffk"];

const round = (value: number) => Number(value.toFixed(6));

/**
 * Metrics, ligature/kern program and outlines of an OpenType font, as
 * LuaLaTeX with fontspec (luaotfload node mode) sets it: widths are
 * advances, heights and depths the glyph's bounding box, the space and its
 * stretch (1/2) and shrink (1/3) luaotfload's defaults, the x-height that of
 * `x`. Ligatures resolve to the font's Unicode presentation forms where its
 * cmap has them and to luaotfload's private codes otherwise. Kerns are those
 * HarfBuzz applies with `kern` on and contextual alternates off.
 */
export function buildRuntimeTexFont(hb: RuntimeHarfBuzz, bytes: Uint8Array, name: string): RuntimeTexFontData {
  const face = new hb.Face(new hb.Blob(bytes), 0);
  const font = new hb.Font(face);
  const upem = face.upem;
  const glyphToCode = new Map<number, number>();
  for (const unicode of face.collectUnicodes()) {
    const glyph = font.nominalGlyph(unicode);
    if (glyph === undefined) continue;
    // The lowest code point wins for a glyph mapped from several.
    if (!glyphToCode.has(glyph) || (glyphToCode.get(glyph) ?? Infinity) > unicode) glyphToCode.set(glyph, unicode);
  }
  const numGlyphs = readUint16(face.referenceTable("maxp"), 4);
  let privateIndex = 0;
  for (let glyph = 0; glyph < numGlyphs; glyph += 1) {
    if (!glyphToCode.has(glyph)) glyphToCode.set(glyph, PRIVATE_BASE + privateIndex++);
  }
  const codeOf = (glyph: number) => glyphToCode.get(glyph) ?? PRIVATE_BASE;

  const chars: Record<string, GeneratedTexCharMetric> = {};
  const outlines: Record<string, string> = {};
  const addGlyph = (glyph: number) => {
    const code = codeOf(glyph);
    if (chars[code]) return code;
    const extents = font.glyphExtents(glyph);
    const top = extents ? extents.yBearing : 0;
    const bottom = extents ? extents.yBearing + extents.height : 0;
    chars[code] = {
      code,
      width: round(font.glyphHAdvance(glyph) / upem),
      height: round(Math.max(0, top) / upem),
      depth: round(Math.max(0, -bottom) / upem),
      italicCorrection: 0,
    };
    if (code !== 0x20) {
      const path = svgPathAt10pt(font.glyphToJson(glyph), upem);
      if (path) outlines[code] = path;
    }
    return code;
  };
  for (const [glyph, code] of glyphToCode) if (code < PRIVATE_BASE && code <= 0xffff) addGlyph(glyph);

  const features = [new hb.Feature("kern", 1), new hb.Feature("liga", 1), new hb.Feature("calt", 0), new hb.Feature("clig", 0)];
  const shape = (codes: number[]) => {
    const buffer = new hb.Buffer();
    buffer.addCodePoints(codes);
    buffer.guessSegmentProperties();
    hb.shape(font, buffer, features);
    return buffer.getGlyphInfosAndPositions();
  };

  const ligKerns: GeneratedTexLigKern[] = [];
  // Ligatures, longest components resolved through shorter ones (ff then ffi).
  const ligatureOf = new Map<string, number>();
  for (const input of LIGATURE_INPUTS) {
    const codes = [...input].map(char => char.codePointAt(0) ?? 0);
    if (codes.some(code => font.nominalGlyph(code) === undefined)) continue;
    const shaped = shape(codes);
    if (shaped.length !== 1) continue;
    const ligature = shaped[0];
    if (!ligature) continue;
    const code = addGlyph(ligature.codepoint);
    const prefix = input.slice(0, -1);
    const left = prefix.length === 1 ? prefix.codePointAt(0) : ligatureOf.get(prefix);
    if (left === undefined) continue;
    ligKerns.push(["lig", left, codes.at(-1) ?? 0, code]);
    ligatureOf.set(input, code);
  }

  // Pair kerns among the measured codes, and between them and ligatures.
  const present = PAIR_CODES.filter(code => font.nominalGlyph(code) !== undefined);
  const advance = (code: number) => font.glyphHAdvance(font.nominalGlyph(code) ?? 0);
  for (const left of present) {
    // TeX puts a discretionary after the hyphen character, so it never kerns
    // with what follows it.
    if (left === 0x2d) continue;
    for (const right of present) {
      const shaped = shape([left, right]);
      if (shaped.length !== 2) continue;
      const kern = (shaped[0]?.xAdvance ?? 0) - advance(left);
      if (kern !== 0) ligKerns.push(["kern", left, right, round(kern / upem)]);
    }
  }
  for (const [input, ligature] of ligatureOf) {
    const components = [...input].map(char => char.codePointAt(0) ?? 0);
    const ligatureAdvance = chars[ligature]?.width ?? 0;
    for (const right of present) {
      const shaped = shape([...components, right]);
      if (shaped.length !== 2 || codeOf(shaped[0]?.codepoint ?? -1) !== ligature) continue;
      const kern = (shaped[0]?.xAdvance ?? 0) / upem - ligatureAdvance;
      if (Math.abs(kern) > 1e-9) ligKerns.push(["kern", ligature, right, round(kern)]);
    }
    for (const left of present) {
      if (left === 0x2d) continue;
      const shaped = shape([left, ...components]);
      if (shaped.length !== 2 || codeOf(shaped[1]?.codepoint ?? -1) !== ligature) continue;
      const kern = (shaped[0]?.xAdvance ?? 0) - advance(left);
      if (kern !== 0) ligKerns.push(["kern", left, ligature, round(kern / upem)]);
    }
  }

  const space = (font.nominalGlyph(0x20) === undefined ? upem / 4 : advance(0x20)) / upem;
  const xGlyph = font.nominalGlyph(0x78);
  const xExtents = xGlyph === undefined ? undefined : font.glyphExtents(xGlyph);
  const italicAngle = readFixed(face.referenceTable("post"), 4);
  return {
    font: {
      family: name,
      codingScheme: "Unicode OpenType",
      ligKernEncoding: "unicode",
      checksum: "",
      designSize: 10,
      source: { kind: "opentype", name },
      fontdimen: {
        // The generated table stores slant divided by the 10pt design size.
        slant: round(Math.tan((-italicAngle * Math.PI) / 180) / 10),
        space: round(space),
        stretch: round(space / 2),
        shrink: round(space / 3),
        xheight: round((xExtents ? xExtents.yBearing : upem / 2) / upem),
        quad: 1,
        extraspace: round(space / 3),
      },
      chars,
      ligKerns,
    },
    outlines,
  };
}

function svgPathAt10pt(commands: readonly { type: string; values: readonly number[] }[], upem: number): string {
  const scale = 10 / upem;
  const number = (value: number) => {
    const text = value.toFixed(6).replace(/\.?0+$/u, "");
    return text === "-0" || text === "" ? "0" : text;
  };
  return commands.map(command => {
    const values = command.values.map((value, index) => number(index % 2 === 0 ? value * scale : -value * scale));
    return `${command.type}${values.join(" ")}`;
  }).join("");
}

function readUint16(table: Uint8Array | undefined, offset: number): number {
  if (!table || table.length < offset + 2) return 0;
  return ((table[offset] ?? 0) << 8) | (table[offset + 1] ?? 0);
}

function readFixed(table: Uint8Array | undefined, offset: number): number {
  if (!table || table.length < offset + 4) return 0;
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  return view.getInt32(offset) / 65536;
}
