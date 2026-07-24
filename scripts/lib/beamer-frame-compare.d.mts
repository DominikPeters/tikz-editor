export interface BeamerTraceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BeamerTraceGlyph {
  readonly code: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly fontName: string;
  readonly fontSize: number;
}

export interface NativeBeamerTraceLine {
  readonly id: string;
  readonly paragraphId: string;
  readonly role:
    | "frame-title"
    | "frame-subtitle"
    | "body"
    | "block-title"
    | "block-body"
    | "footline"
    | "embedded-tikz";
  readonly lineIndex: number;
  readonly sourceSpan: { readonly from: number; readonly to: number };
  readonly text: string;
  readonly x: number;
  readonly baselineY: number;
  readonly glyphs: readonly BeamerTraceGlyph[];
}

export interface OracleBeamerTraceLine {
  readonly text: string;
  readonly x: number;
  readonly baselineY: number;
  readonly glyphs: readonly BeamerTraceGlyph[];
}

export interface NativeBeamerPageTrace {
  readonly coordinateSystem: {
    readonly unit: "tex-pt";
    readonly origin: "top-left";
    readonly yAxis: "down";
  };
  readonly page: BeamerTraceRect;
  readonly untracedRegions: readonly {
    readonly kind: "embedded-tikz";
    readonly itemId: string;
    readonly bounds: BeamerTraceRect;
  }[];
  readonly rectangles: readonly (BeamerTraceRect & {
    readonly id: string;
    readonly role: string;
  })[];
  readonly coveredRectangles?: readonly (BeamerTraceRect & {
    readonly id: string;
    readonly role: string;
  })[];
  readonly lines: readonly NativeBeamerTraceLine[];
  readonly coveredLines?: readonly OracleBeamerTraceLine[];
  readonly glyphs: readonly (BeamerTraceGlyph & {
    readonly paragraphId: string;
    readonly role: string;
    readonly lineIndex: number;
  })[];
}

export interface OracleBeamerPageTrace {
  readonly coordinateSystem: NativeBeamerPageTrace["coordinateSystem"];
  readonly page: BeamerTraceRect;
  readonly shipoutOrigin: { readonly x: number; readonly y: number };
  readonly boxes: readonly unknown[];
  readonly rules: readonly (BeamerTraceRect & {
    readonly path: string;
    readonly depth: number;
    readonly totalHeight: number;
  })[];
  readonly glyphs: readonly BeamerTraceGlyph[];
  readonly lines: readonly OracleBeamerTraceLine[];
}

export interface BeamerStructuralComparison {
  readonly coordinateSystem: NativeBeamerPageTrace["coordinateSystem"];
  readonly summary: {
    readonly matchedRectangles: number;
    readonly unmatchedNativeRectangles: number;
    readonly unmatchedOracleRules: number;
    readonly coveredOverlayRules: number;
    readonly maxRectangleEdgeDeltaPt: number;
    readonly matchedTextLines: number;
    readonly unmatchedNativeTextLines: number;
    readonly unmatchedOracleTextLines: number;
    readonly excludedOracleTextLines: number;
    readonly coveredOverlayTextLines: number;
    readonly comparedGlyphs: number;
    readonly maxAbsoluteGlyphDxPt: number;
    readonly maxAbsoluteGlyphDyPt: number;
    readonly glyphCodeMatch: boolean;
    readonly fontMatch: boolean;
  };
  readonly geometry: unknown;
  readonly text: unknown;
}

export function normalizeOracleBeamerPageTrace(
  pageTrace: unknown,
  pageGeometry: unknown
): OracleBeamerPageTrace;
export function buildNativeBeamerPageTrace(
  render: unknown,
  metricProvider: unknown
): NativeBeamerPageTrace;
export function compareBeamerPageTraces(
  nativeTrace: NativeBeamerPageTrace,
  oracleTrace: OracleBeamerPageTrace
): BeamerStructuralComparison;
