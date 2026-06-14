import { roundTexPt, tfmToPt } from "../fonts/units.js";
import type {
  GeneratedTexCharMetric,
  ResolvedTexFont,
} from "../fonts/types.js";
import {
  defaultTexMathFontProfile,
  type TexMathFontFamily,
  type TexMathFontProfile,
} from "./font-profile.js";
import type {
  TexMathAtom,
  TexMathGlyphNucleus,
  TexMathList,
  TexMathSourceSpan,
  TexMathStyle,
} from "./ir.js";
import {
  spaceTexMathList,
  type TexMathResolvedGlue,
} from "./spacing.js";

export type TexMathHListItem =
  | TexMathGlyphLayoutItem
  | TexMathGlueLayoutItem
  | TexMathKernLayoutItem;

export interface TexMathGlyphLayoutItem {
  readonly kind: "glyph";
  readonly fontId: string;
  readonly family: TexMathFontFamily;
  readonly code: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly italicCorrection: number;
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathGlueLayoutItem {
  readonly kind: "glue";
  readonly x: number;
  readonly width: number;
  readonly mu: number;
  readonly stretch: number;
  readonly shrink: number;
  readonly source: TexMathResolvedGlue["source"];
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathKernLayoutItem {
  readonly kind: "kern";
  readonly x: number;
  readonly width: number;
  readonly reason: "italic-correction";
  readonly sourceSpan: TexMathSourceSpan;
}

export interface TexMathHList {
  readonly kind: "math-hlist";
  readonly style: TexMathStyle;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly sourceSpan: TexMathSourceSpan;
  readonly items: readonly TexMathHListItem[];
}

export interface TexMathLayoutOptions {
  readonly style?: TexMathStyle;
  readonly fontProfile?: TexMathFontProfile;
  readonly baseAtPt?: number;
}

export interface TexMathLayoutError {
  readonly message: string;
  readonly sourceSpan: TexMathSourceSpan;
}

export type TexMathLayoutResult =
  | {
      readonly supported: true;
      readonly hlist: TexMathHList;
      readonly errors: readonly TexMathLayoutError[];
    }
  | {
      readonly supported: false;
      readonly hlist: null;
      readonly errors: readonly TexMathLayoutError[];
    };

export interface ResolvedMathGlyph {
  readonly family: TexMathFontFamily;
  readonly font: ResolvedTexFont;
  readonly code: number;
  readonly text: string;
  readonly sourceSpan: TexMathSourceSpan;
}

export function layoutTexMathList(
  list: TexMathList,
  options: TexMathLayoutOptions = {}
): TexMathLayoutResult {
  const style = options.style ?? "text";
  const fontProfile = options.fontProfile ?? defaultTexMathFontProfile;
  const baseAtPt = options.baseAtPt ?? 10;
  const spaced = spaceTexMathList(list, { style });
  const items: TexMathHListItem[] = [];
  const errors: TexMathLayoutError[] = [];
  let cursor = 0;
  let height = 0;
  let depth = 0;

  for (const item of spaced.items) {
    if (item.kind === "resolved-glue") {
      const width = muToPt(fontProfile, style, baseAtPt, item.mu);
      const stretch = muToPt(fontProfile, style, baseAtPt, item.stretchMu);
      const shrink = muToPt(fontProfile, style, baseAtPt, item.shrinkMu);
      items.push({
        kind: "glue",
        x: roundTexPt(cursor),
        width,
        mu: item.mu,
        stretch,
        shrink,
        source: item.source,
        sourceSpan: item.sourceSpan,
      });
      cursor = roundTexPt(cursor + width);
      continue;
    }
    if (item.kind === "unsupported") {
      errors.push({
        message: `Unsupported TeX math item ${item.command}.`,
        sourceSpan: item.sourceSpan,
      });
      continue;
    }

    const glyph = layoutGlyphAtom(item, fontProfile, style, baseAtPt);
    if (!glyph) {
      errors.push({
        message: "Only simple glyph math atoms are supported by the initial math hlist layout.",
        sourceSpan: item.sourceSpan,
      });
      continue;
    }
    const metric = requiredCharMetric(glyph.font, glyph.code);
    const width = roundTexPt(tfmToPt(glyph.font, metric.width));
    const glyphHeight = roundTexPt(tfmToPt(glyph.font, metric.height));
    const glyphDepth = roundTexPt(tfmToPt(glyph.font, metric.depth));
    const italicCorrection = roundTexPt(tfmToPt(glyph.font, metric.italicCorrection));
    items.push({
      kind: "glyph",
      fontId: glyph.font.id,
      family: glyph.family,
      code: glyph.code,
      text: glyph.text,
      x: roundTexPt(cursor),
      y: 0,
      width,
      height: glyphHeight,
      depth: glyphDepth,
      italicCorrection,
      sourceSpan: glyph.sourceSpan,
    });
    cursor = roundTexPt(cursor + width);
    height = Math.max(height, glyphHeight);
    depth = Math.max(depth, glyphDepth);
    if (italicCorrection !== 0) {
      items.push({
        kind: "kern",
        x: roundTexPt(cursor),
        width: italicCorrection,
        reason: "italic-correction",
        sourceSpan: item.nucleus.sourceSpan,
      });
      cursor = roundTexPt(cursor + italicCorrection);
    }
  }

  if (errors.length > 0) {
    return {
      supported: false,
      hlist: null,
      errors,
    };
  }

  return {
    supported: true,
    hlist: {
      kind: "math-hlist",
      style,
      width: roundTexPt(cursor),
      height: roundTexPt(height),
      depth: roundTexPt(depth),
      sourceSpan: list.sourceSpan,
      items,
    },
    errors: [],
  };
}

function layoutGlyphAtom(
  atom: TexMathAtom,
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number
): ResolvedMathGlyph | null {
  if (
    atom.subscript ||
    atom.superscript ||
    atom.nucleus.kind !== "glyph"
  ) {
    return null;
  }
  return resolveMathGlyph(atom.nucleus, fontProfile, style, baseAtPt);
}

export function resolveMathGlyph(
  nucleus: TexMathGlyphNucleus,
  fontProfile: TexMathFontProfile = defaultTexMathFontProfile,
  style: TexMathStyle = "text",
  baseAtPt = 10
): ResolvedMathGlyph | null {
  const resolved = defaultLuaLatexMathSymbol(nucleus.text);
  if (!resolved) {
    return null;
  }
  return {
    font: fontProfile.resolveMathFont({
      family: resolved.family,
      style,
      baseAtPt,
    }),
    family: resolved.family,
    code: resolved.code,
    text: nucleus.text,
    sourceSpan: nucleus.sourceSpan,
  };
}

function defaultLuaLatexMathSymbol(
  text: string
): Pick<ResolvedMathGlyph, "family" | "code"> | null {
  if (/^[A-Za-z]$/.test(text)) {
    return { family: "letters", code: text.charCodeAt(0) };
  }
  if (/^[0-9]$/.test(text)) {
    return { family: "operators", code: text.charCodeAt(0) };
  }
  switch (text) {
    case "+":
    case "=":
    case "(":
    case ")":
    case "[":
    case "]":
      return { family: "operators", code: text.charCodeAt(0) };
    case "-":
      return { family: "symbols", code: 0 };
    case "*":
      return { family: "symbols", code: 3 };
    case ",":
      return { family: "letters", code: 59 };
    case ".":
      return { family: "letters", code: 58 };
    case "/":
      return { family: "letters", code: 61 };
    case "<":
    case ">":
      return { family: "letters", code: text.charCodeAt(0) };
    default:
      return null;
  }
}

function muToPt(
  fontProfile: TexMathFontProfile,
  style: TexMathStyle,
  baseAtPt: number,
  mu: number
): number {
  const symbols = fontProfile.resolveMathFont({
    family: "symbols",
    style,
    baseAtPt,
  });
  return roundTexPt((tfmToPt(symbols, symbols.data.fontdimen.quad) / 18) * mu);
}

function requiredCharMetric(
  font: ResolvedTexFont,
  code: number
): GeneratedTexCharMetric {
  const metric = font.data.chars[String(code)];
  if (!metric) {
    throw new Error(`Font '${font.id}' has no TeX math metric for code ${code}.`);
  }
  return metric;
}
