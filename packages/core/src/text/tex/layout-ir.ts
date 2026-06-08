import type { KnuthPlassLayoutMode } from "../knuth-plass/index.js";
import type { ResolvedTexFont } from "./fonts/types.js";
import {
  simpleTexInlineNodesToTokens,
  splitSimpleTexParagraphSegments,
  type SimpleTexParagraphBlock,
  type SimpleTexParagraphSegment,
  type TexAlignmentProfile,
  type TexParagraphAlignment,
  type TexSpaceGlueProfile,
} from "./ir.js";

export interface TexLayoutIrOptions {
  readonly parindent?: number;
  readonly tikzTextWidthNode?: boolean;
}

export interface TexLayoutTextItem {
  readonly kind: "text";
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly font: ResolvedTexFont;
  readonly spaceFactorBefore: number;
  readonly spaceFactorAfter: number;
}

export interface TexLayoutSpaceItem {
  readonly kind: "space";
  readonly text: " ";
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly font: ResolvedTexFont;
  readonly spaceFactor: number;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
}

export interface TexLayoutForcedBreakItem {
  readonly kind: "forced-break";
  readonly text: " ";
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly font: ResolvedTexFont;
  readonly lineLeading?: string;
  readonly spaceFactor: number;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
}

export type TexLayoutInlineItem =
  | TexLayoutTextItem
  | TexLayoutSpaceItem
  | TexLayoutForcedBreakItem;

export interface TexLayoutParagraphIr {
  readonly kind: "tex-layout-paragraph";
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly font: ResolvedTexFont;
  readonly alignment: TexParagraphAlignment;
  readonly alignmentProfile?: TexAlignmentProfile;
  readonly inheritedAlignment: TexParagraphAlignment;
  readonly inheritedAlignmentProfile?: TexAlignmentProfile;
  readonly noIndent: boolean;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly leftMarginWidth: number;
  readonly rightMarginWidth: number;
  readonly verticalSkipBefore: number;
  readonly quoteDepth: number;
  readonly forcedBreakAfter?: SimpleTexParagraphSegment["forcedBreakAfter"];
  readonly items: readonly TexLayoutInlineItem[];
}

export interface SimpleTexLayoutDocumentIr {
  readonly kind: "simple-tex-layout-document";
  readonly reportAlignment: TexParagraphAlignment;
  readonly layoutMode: KnuthPlassLayoutMode;
  readonly paragraphs: readonly TexLayoutParagraphIr[];
}

export function createSimpleTexLayoutDocumentIr(params: {
  readonly blocks: readonly SimpleTexParagraphBlock[];
  readonly defaultAlignment: TexParagraphAlignment;
  readonly font: ResolvedTexFont;
  readonly options: TexLayoutIrOptions;
}): SimpleTexLayoutDocumentIr {
  const paragraphs: TexLayoutParagraphIr[] = [];
  const reportAlignment = params.blocks[0]?.alignment ?? params.defaultAlignment;
  let layoutMode: KnuthPlassLayoutMode = "wrap";
  let activeAlignment = params.defaultAlignment;
  let activeAlignmentProfile: TexAlignmentProfile | undefined;
  let activeSpaceGlueProfile = texInitialSpaceGlueProfile(params.defaultAlignment);
  let previousEmittedQuoteDepth = 0;

  for (let blockIndex = 0; blockIndex < params.blocks.length; blockIndex += 1) {
    const block = params.blocks[blockIndex];
    const inheritedAlignment = activeAlignment;
    const inheritedAlignmentProfile = activeAlignmentProfile;
    const alignment = block.alignment ?? activeAlignment;
    const alignmentProfile = block.alignment
      ? block.alignmentProfile
      : activeAlignmentProfile;

    if (block.alignment) {
      activeAlignment = block.alignment;
      activeAlignmentProfile = block.alignmentProfile;
      if (
        block.alignmentProfile === "latex-declaration" &&
        params.options.tikzTextWidthNode === true
      ) {
        activeSpaceGlueProfile = "tikz-fixed";
      }
    }

    const effectiveAlignment = texQuoteParagraphAlignment(block.quoteDepth, alignment);
    const effectiveAlignmentProfile = texQuoteParagraphAlignmentProfile(
      block.quoteDepth,
      alignment,
      alignmentProfile
    );
    const segments = splitSimpleTexParagraphSegments(
      block,
      params.options,
      effectiveAlignment,
      blockIndex
    );
    if (segments.some((segment) => segment.forcedBreakAfter)) {
      layoutMode = "wrapped-explicit";
    }

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex];
      const quoteMarginWidth = texArticleQuoteMarginWidth(block.quoteDepth, params.font);
      const verticalSkipBefore = segmentIndex === 0
        ? texArticleQuoteVerticalSkipBefore(previousEmittedQuoteDepth, block.quoteDepth)
        : 0;
      paragraphs.push({
        kind: "tex-layout-paragraph",
        blockIndex,
        segmentIndex,
        text: segment.text,
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceEnd,
        font: params.font,
        alignment: effectiveAlignment,
        alignmentProfile: effectiveAlignmentProfile,
        inheritedAlignment,
        inheritedAlignmentProfile,
        noIndent: segment.noIndent,
        spaceGlueProfile: activeSpaceGlueProfile,
        leftMarginWidth: quoteMarginWidth,
        rightMarginWidth: quoteMarginWidth,
        verticalSkipBefore,
        quoteDepth: block.quoteDepth,
        forcedBreakAfter: segment.forcedBreakAfter,
        items: simpleTexSegmentToLayoutItems(
          segment,
          params.font,
          activeSpaceGlueProfile
        ),
      });
      previousEmittedQuoteDepth = block.quoteDepth;
    }
  }

  return {
    kind: "simple-tex-layout-document",
    reportAlignment,
    layoutMode,
    paragraphs,
  };
}

function texArticleQuoteVerticalSkipBefore(
  previousQuoteDepth: number,
  quoteDepth: number
): number {
  if (previousQuoteDepth === quoteDepth) {
    return quoteDepth > 0 ? 4 : 0;
  }
  if (previousQuoteDepth > 0 || quoteDepth > 0) {
    return 10;
  }
  return 0;
}

function texQuoteParagraphAlignment(
  quoteDepth: number,
  alignment: TexParagraphAlignment
): TexParagraphAlignment {
  if (quoteDepth === 0) {
    return alignment;
  }
  return alignment === "ragged-right" ? "ragged-right" : "justified";
}

function texQuoteParagraphAlignmentProfile(
  quoteDepth: number,
  alignment: TexParagraphAlignment,
  alignmentProfile: TexAlignmentProfile | undefined
): TexAlignmentProfile | undefined {
  if (quoteDepth === 0) {
    return alignmentProfile;
  }
  return alignment === "ragged-right" ? "latex-quote" : undefined;
}

function texArticleQuoteMarginWidth(quoteDepth: number, font: ResolvedTexFont): number {
  if (!(quoteDepth > 0)) {
    return 0;
  }
  const articleLeftMarginEmByDepth = [2.5, 2.2, 1.87, 1.7, 1, 1];
  let margin = 0;
  for (let index = 0; index < quoteDepth; index += 1) {
    margin += articleLeftMarginEmByDepth[Math.min(index, articleLeftMarginEmByDepth.length - 1)] ?? 1;
  }
  return margin * font.atPt;
}

function simpleTexSegmentToLayoutItems(
  segment: SimpleTexParagraphSegment,
  font: ResolvedTexFont,
  spaceGlueProfile: TexSpaceGlueProfile
): TexLayoutInlineItem[] {
  const tokens = simpleTexInlineNodesToTokens(segment.nodes);
  const items: TexLayoutInlineItem[] = [];
  let spaceFactor = 1000;
  let hasSeenText = false;

  for (const token of tokens) {
    if (token.kind === "space" && !hasSeenText) {
      continue;
    }

    if (token.kind === "text") {
      const spaceFactorBefore = spaceFactor;
      spaceFactor = updateSpaceFactorForText(spaceFactor, token.text);
      items.push({
        kind: "text",
        text: token.text,
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        font,
        spaceFactorBefore,
        spaceFactorAfter: spaceFactor,
      });
      hasSeenText = true;
      continue;
    }

    if (token.kind === "forced-break") {
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

function texInitialSpaceGlueProfile(
  alignment: TexParagraphAlignment
): TexSpaceGlueProfile {
  return alignment === "justified" ? "font" : "tikz-fixed";
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
