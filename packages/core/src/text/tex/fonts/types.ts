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
  readonly fontdimen: Readonly<Record<string, number>>;
  readonly chars: Readonly<Record<string, GeneratedTexCharMetric>>;
  readonly ligKerns: readonly GeneratedTexLigKern[];
  readonly glyphs?: Readonly<Record<string, string>>;
}

export type GeneratedTexFontTable = Readonly<Record<string, GeneratedTexFont>>;

export interface ResolvedTexFont {
  readonly id: string;
  readonly atPt: number;
  readonly data: GeneratedTexFont;
  readonly color?: string;
}

export interface TexGlyphBox {
  readonly kind: "glyph";
  readonly fontId: string;
  readonly code: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly italicCorrection: number;
  readonly components: readonly number[];
}

export interface TexKern {
  readonly kind: "kern";
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly width: number;
}

export type TexShapedItem = TexGlyphBox | TexKern;

export interface TexCaretStop {
  readonly sourceOffset: number;
  readonly x: number;
}

export interface ShapedTexTextRun {
  readonly text: string;
  readonly font: ResolvedTexFont;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly width: number;
  readonly items: readonly TexShapedItem[];
  readonly caretStops: readonly number[];
  readonly sourceCaretStops: readonly TexCaretStop[];
}

export interface ShapeTexTextOptions {
  readonly sourceStart?: number;
  /** Source end for a synthesized single-character run (for example \\'{e}). */
  readonly sourceEnd?: number;
}

export interface ResolveTexFontOptions {
  readonly fontId?: string;
  readonly atPt?: number;
}

export interface TexMetricProvider {
  resolveFont(options?: ResolveTexFontOptions): ResolvedTexFont;
  shapeText(
    text: string,
    font?: ResolvedTexFont,
    options?: ShapeTexTextOptions
  ): ShapedTexTextRun;
}
