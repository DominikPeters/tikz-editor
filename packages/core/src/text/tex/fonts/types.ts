export type GeneratedTexLigKern =
  | readonly ["lig", number, number, number]
  | readonly ["kern", number, number, number];

export interface GeneratedTexCharMetric {
  readonly code: number;
  readonly width?: number;
  readonly height?: number;
  readonly depth?: number;
  readonly italicCorrection?: number;
}

export interface GeneratedTexFont {
  readonly family: string;
  readonly codingScheme: string;
  readonly checksum: string;
  readonly designSize: number;
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
}
