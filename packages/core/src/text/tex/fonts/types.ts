import type { TexHBoxX, TexLength } from "../coordinates.js";

export type GeneratedTexLigKern =
  | readonly ["lig", number, number, number]
  | readonly ["kern", number, number, number];

export interface GeneratedTexCharMetric {
  readonly code: number;
  readonly width?: number;
  readonly height?: number;
  readonly depth?: number;
  readonly italicCorrection?: number;
  readonly nextLarger?: number;
  readonly varchar?: GeneratedTexExtensibleRecipe;
}

export interface GeneratedTexExtensibleRecipe {
  readonly top?: number;
  readonly mid?: number;
  readonly bot?: number;
  readonly rep?: number;
}

export interface GeneratedTexFontSourceMetadata {
  readonly kind: "tfm" | "opentype";
  readonly name: string;
}

export interface GeneratedTexFont {
  readonly family: string;
  readonly codingScheme: string;
  readonly checksum: string;
  readonly designSize: number;
  readonly source: GeneratedTexFontSourceMetadata;
  readonly fontdimen: GeneratedTexFontDimensions;
  readonly chars: Readonly<Record<string, GeneratedTexCharMetric>>;
  readonly ligKerns: readonly GeneratedTexLigKern[];
  /** Legacy tables use OT1 quote aliases; Unicode pair programs address cmap codes directly. */
  readonly ligKernEncoding?: "unicode";
}

/** The six common TFM parameters are present in every generated font. */
export interface GeneratedTexFontDimensions {
  readonly slant: number;
  readonly space: number;
  readonly stretch: number;
  readonly shrink: number;
  readonly xheight: number;
  readonly quad: number;
  readonly [parameter: string]: number;
}

export type GeneratedTexFontTable = Readonly<Record<string, GeneratedTexFont>>;

/** One font's SVG glyph paths by character code, at 10pt. */
export type TexGlyphOutlines = Readonly<Record<string, string>>;

export interface ResolvedTexFont {
  readonly id: string;
  readonly atPt: TexLength;
  readonly data: GeneratedTexFont;
  readonly color?: string;
}

export interface TexGlyphBox {
  readonly kind: "glyph";
  readonly fontId: string;
  readonly code: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly width: TexLength;
  readonly height: TexLength;
  readonly depth: TexLength;
  readonly italicCorrection: TexLength;
  readonly components: readonly number[];
}

export interface TexKern {
  readonly kind: "kern";
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly width: TexLength;
}

export type TexShapedItem = TexGlyphBox | TexKern;

export interface TexCaretStop {
  readonly sourceOffset: number;
  readonly x: TexHBoxX;
}

export interface ShapedTexTextRun {
  readonly text: string;
  readonly font: ResolvedTexFont;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly width: TexLength;
  readonly items: readonly TexShapedItem[];
  readonly caretStops: readonly TexHBoxX[];
  readonly sourceCaretStops: readonly TexCaretStop[];
}

export interface ShapeTexTextOptions {
  readonly sourceStart?: number;
  /** Source end for a synthesized single-character run (for example \\'{e}). */
  readonly sourceEnd?: number;
  /** Allow providers to omit caret arrays for glyph-only rendering. */
  readonly includeCaretStops?: boolean;
}

export interface ResolveTexFontOptions {
  readonly fontId?: string;
  readonly atPt?: TexLength;
}

export interface TexMetricProvider {
  resolveFont(options?: ResolveTexFontOptions): ResolvedTexFont;
  shapeText(
    text: string,
    font?: ResolvedTexFont,
    options?: ShapeTexTextOptions
  ): ShapedTexTextRun;
}
