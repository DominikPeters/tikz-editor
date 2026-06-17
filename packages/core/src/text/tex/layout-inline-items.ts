import {
  defaultTexTextFontProfile,
  type TexTextFontProfile,
} from "./fonts/text-profile.js";
import type { ResolvedTexFont, TexMetricProvider } from "./fonts/types.js";
import type { TexMathFontProfile } from "./math/font-profile.js";
import type { TexMathHList } from "./math/layout.js";
import {
  simpleTexInlineNodesToTokens,
  type SimpleTexDisplayMathDelimiter,
  type SimpleTexFontState,
  type SimpleTexInlineNode,
  type SimpleTexParagraphSegment,
  type TexSpaceGlueProfile,
} from "./ir.js";

export interface TexLayoutTextItem {
  readonly kind: "text";
  readonly role?: "list-label";
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly font: ResolvedTexFont;
  readonly italicCorrectionAfter: boolean;
  readonly spaceFactorBefore: number;
  readonly spaceFactorAfter: number;
}

export interface TexLayoutSpaceItem {
  readonly kind: "space";
  readonly role?: "list-label";
  readonly text: " ";
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly font: ResolvedTexFont;
  readonly spaceFactor: number;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
}

export interface TexLayoutForcedBreakItem {
  readonly kind: "forced-break";
  readonly role?: "list-label";
  readonly text: " ";
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly font: ResolvedTexFont;
  readonly lineLeading?: string;
  readonly spaceFactor: number;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
}

export interface TexMathBox {
  readonly source: string;
  readonly content: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly stretch?: number;
  readonly shrink?: number;
  readonly caretStops?: readonly number[];
  readonly constructRanges?: readonly TexMathConstructRange[];
  readonly breakpoints?: readonly TexMathBreakpoint[];
  readonly svgBody?: string;
  readonly hlist?: TexMathHList;
  readonly fontProfile?: TexMathFontProfile;
}

export interface TexMathDisplayLabel {
  readonly text: string;
  readonly sourceSpan: {
    readonly start: number;
    readonly end: number;
  };
  readonly textSourceSpan: {
    readonly start: number;
    readonly end: number;
  };
}

export interface TexMathConstructRange {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly xStart: number;
  readonly xEnd: number;
}

export interface TexMathBreakpoint {
  readonly kind: "binary" | "relation";
  readonly sourceOffset: number;
  readonly x: number;
  readonly penalty: number;
  readonly stretchBefore?: number;
  readonly shrinkBefore?: number;
  readonly postBreakGlue?: {
    readonly width: number;
    readonly stretch: number;
    readonly shrink: number;
  };
}

export interface TexMathDisplayAlignmentRowBox extends TexMathBox {
  readonly rowIndex: number;
  readonly x: number;
}

export interface TexMathDisplayAlignment {
  readonly source: string;
  readonly content: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly delimiter: SimpleTexDisplayMathDelimiter;
  readonly width: number;
  readonly rows: readonly TexMathDisplayAlignmentRowBox[];
}

export interface TexMathBoxProvider {
  readonly getInlineMathBox: (params: {
    readonly source: string;
    readonly content: string;
    readonly delimiter: "dollar" | "paren";
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly contentStart: number;
    readonly contentEnd: number;
  }) => TexMathBox | null;
  readonly getDisplayMathBox?: (params: {
    readonly source: string;
    readonly content: string;
    readonly delimiter: SimpleTexDisplayMathDelimiter;
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly contentStart: number;
    readonly contentEnd: number;
    readonly targetWidth?: number;
    readonly displayLabel?: TexMathDisplayLabel;
  }) => TexMathBox | null;
  readonly getDisplayMathAlignment?: (params: {
    readonly source: string;
    readonly content: string;
    readonly delimiter: SimpleTexDisplayMathDelimiter;
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly contentStart: number;
    readonly contentEnd: number;
    readonly targetWidth: number;
    readonly displayLabels?: readonly (TexMathDisplayLabel | null)[];
  }) => TexMathDisplayAlignment | null;
}

export interface TexLayoutMathItem {
  readonly kind: "math";
  readonly role?: "list-label";
  readonly text: string;
  readonly content: string;
  readonly delimiter: "dollar" | "paren";
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly box: TexMathBox;
}

export type TexLayoutInlineItem =
  | TexLayoutTextItem
  | TexLayoutSpaceItem
  | TexLayoutForcedBreakItem
  | TexLayoutMathItem;

export interface TexLayoutGlyphItem {
  readonly kind: "glyph";
  readonly text: string;
  readonly code: number;
  readonly font: ResolvedTexFont;
}

export type TexLayoutLabelItem = TexLayoutInlineItem | TexLayoutGlyphItem;

export interface TexLayoutLabel {
  readonly items: readonly TexLayoutLabelItem[];
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly rightEdge: number;
}

export function simpleTexInlineNodesToLayoutItems(
  nodes: readonly SimpleTexInlineNode[],
  sourceStart: number,
  sourceEnd: number,
  atPt: number,
  metricProvider: TexMetricProvider,
  spaceGlueProfile: TexSpaceGlueProfile,
  mathBoxProvider?: TexMathBoxProvider,
  initialFontState?: SimpleTexFontState,
  textFontProfile: TexTextFontProfile = defaultTexTextFontProfile
): TexLayoutInlineItem[] {
  return simpleTexSegmentToLayoutItems(
    {
      text: "",
      sourceStart,
      sourceEnd,
      nodes,
      noIndent: true,
    },
    atPt,
    metricProvider,
    spaceGlueProfile,
    mathBoxProvider,
    initialFontState,
    textFontProfile
  );
}

export function simpleTexSegmentToLayoutItems(
  segment: SimpleTexParagraphSegment,
  atPt: number,
  metricProvider: TexMetricProvider,
  spaceGlueProfile: TexSpaceGlueProfile,
  mathBoxProvider?: TexMathBoxProvider,
  initialFontState?: SimpleTexFontState,
  textFontProfile: TexTextFontProfile = defaultTexTextFontProfile
): TexLayoutInlineItem[] {
  const tokens = simpleTexInlineNodesToTokens(segment.nodes, initialFontState);
  const items: TexLayoutInlineItem[] = [];
  let spaceFactor = 1000;
  let hasSeenText = false;

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    if (token.kind === "space" && !hasSeenText) {
      continue;
    }

    if (token.kind === "text") {
      const font = textFontProfile.resolveTextFont(token.fontState, atPt, metricProvider);
      const italicCorrectionAfter =
        token.italicCorrectionAfter === true &&
        !texItalicCorrectionSuppressedByNextToken(tokens[tokenIndex + 1]);
      const spaceFactorBefore = spaceFactor;
      spaceFactor = updateSpaceFactorForText(spaceFactor, token.text);
      items.push({
        kind: "text",
        text: token.text,
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        font,
        italicCorrectionAfter,
        spaceFactorBefore,
        spaceFactorAfter: spaceFactor,
      });
      hasSeenText = true;
      continue;
    }

    if (token.kind === "math") {
      const box = mathBoxProvider?.getInlineMathBox({
        source: token.text,
        content: token.content ?? "",
        delimiter: token.delimiter ?? "dollar",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.contentStart ?? token.sourceStart,
        contentEnd: token.contentEnd ?? token.sourceEnd,
      }) ?? null;
      if (!box) {
        throw new Error(`Missing TeX inline math box for source range ${token.sourceStart}:${token.sourceEnd}.`);
      }
      items.push({
        kind: "math",
        text: token.text,
        content: token.content ?? "",
        delimiter: token.delimiter ?? "dollar",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.contentStart ?? token.sourceStart,
        contentEnd: token.contentEnd ?? token.sourceEnd,
        box,
      });
      hasSeenText = true;
      spaceFactor = 1000;
      continue;
    }

    if (token.kind === "forced-break") {
      const font = textFontProfile.resolveTextFont(token.fontState, atPt, metricProvider);
      items.push({
        kind: "forced-break",
        text: " ",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        font,
        lineLeading: token.lineLeading,
        spaceFactor,
        spaceGlueProfile,
      });
      continue;
    }

    const font = textFontProfile.resolveTextFont(token.fontState, atPt, metricProvider);
    items.push({
      kind: "space",
      text: " ",
      sourceStart: token.sourceStart,
      sourceEnd: token.sourceEnd,
      font,
      spaceFactor,
      spaceGlueProfile,
    });
  }

  while (items.at(-1)?.kind === "space" || items.at(-1)?.kind === "forced-break") {
    items.pop();
  }
  return items;
}

function texItalicCorrectionSuppressedByNextToken(
  token: ReturnType<typeof simpleTexInlineNodesToTokens>[number] | undefined
): boolean {
  return token?.kind === "text" && (token.text.startsWith(",") || token.text.startsWith("."));
}

function updateSpaceFactorForText(current: number, text: string): number {
  let spaceFactor = current;
  for (const char of text) {
    const sfcode = defaultTexSfcode(char);
    if (sfcode === 0) {
      continue;
    }
    spaceFactor = sfcode > 1000 && spaceFactor < 1000 ? 1000 : sfcode;
  }
  return spaceFactor;
}

function defaultTexSfcode(char: string): number {
  if (char >= "A" && char <= "Z") {
    return 999;
  }
  if (char === "." || char === "?" || char === "!") {
    return 3000;
  }
  if (char === ":") {
    return 2000;
  }
  if (char === ";") {
    return 1500;
  }
  if (char === ",") {
    return 1250;
  }
  if (char === ")" || char === "]" || char === "'" || char === '"') {
    return 0;
  }
  return 1000;
}
