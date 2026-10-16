import type { GeneratedTexCharMetric, GeneratedTexFont, GeneratedTexFontTable, GeneratedTexLigKern, TexGlyphOutlines } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCharMetric(value: unknown): value is GeneratedTexCharMetric {
  if (!isRecord(value) || !isFiniteNumber(value.code)) return false;
  for (const key of ["width", "height", "depth", "italicCorrection", "nextLarger"]) {
    if (key in value && !isFiniteNumber(value[key])) return false;
  }
  if ("varchar" in value) {
    if (!isRecord(value.varchar)) return false;
    for (const key of ["top", "mid", "bot", "rep"]) {
      if (key in value.varchar && !isFiniteNumber(value.varchar[key])) return false;
    }
  }
  return true;
}

function isLigKern(value: unknown): value is GeneratedTexLigKern {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const entries: readonly unknown[] = value;
  return (entries[0] === "lig" || entries[0] === "kern") &&
    isFiniteNumber(entries[1]) && isFiniteNumber(entries[2]) && isFiniteNumber(entries[3]);
}

function isFont(value: unknown): value is GeneratedTexFont {
  if (!isRecord(value) || typeof value.family !== "string" ||
      typeof value.codingScheme !== "string" || typeof value.checksum !== "string" ||
      !isFiniteNumber(value.designSize) || !isRecord(value.source) ||
      (value.source.kind !== "tfm" && value.source.kind !== "opentype") ||
      typeof value.source.name !== "string" || !isRecord(value.fontdimen) ||
      !isRecord(value.chars) || !Array.isArray(value.ligKerns) ||
      (value.ligKernEncoding !== undefined && value.ligKernEncoding !== "unicode")) return false;
  for (const key of ["slant", "space", "stretch", "shrink", "xheight", "quad"]) {
    if (!isFiniteNumber(value.fontdimen[key])) return false;
  }
  return Object.values(value.fontdimen).every(isFiniteNumber) &&
    Object.values(value.chars).every(isCharMetric) && value.ligKerns.every(isLigKern);
}

function isFontTable(value: unknown): value is GeneratedTexFontTable {
  return isRecord(value) && Object.values(value).every(isFont);
}

function isGlyphOutlines(value: unknown): value is TexGlyphOutlines {
  return isRecord(value) && Object.values(value).every(path => typeof path === "string");
}

/** Validate compact generated data once, retaining JSON.parse's bundling cost. */
export function parseGeneratedTexFontTable(serialized: string): GeneratedTexFontTable {
  const value: unknown = JSON.parse(serialized);
  if (!isFontTable(value)) throw new Error("Invalid generated TeX font metrics.");
  return value;
}

/** Outlines are validated only when their font's lazy module is first loaded. */
export function parseGeneratedTexGlyphOutlines(serialized: string): TexGlyphOutlines {
  const value: unknown = JSON.parse(serialized);
  if (!isGlyphOutlines(value)) throw new Error("Invalid generated TeX glyph outlines.");
  return value;
}
