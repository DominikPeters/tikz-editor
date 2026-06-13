import type { KnuthPlassLayoutMode } from "../knuth-plass/index.js";
import type { ResolvedTexFont, TexMetricProvider } from "./fonts/types.js";
import { roundTexPt, tfmToPt } from "./fonts/units.js";
import {
  computerModernTexMetricProvider,
  type DefaultComputerModernTextFont,
} from "./fonts/computer-modern.js";
import {
  simpleTexInlineNodesToTokens,
  splitSimpleTexParagraphSegments,
  type SimpleTexBlockItem,
  type SimpleTexParagraphBlock,
  type SimpleTexParagraphSegment,
  type SimpleTexFontState,
  type SimpleTexListContext,
  type TexAlignmentProfile,
  type TexParagraphAlignment,
  type TexSpaceGlueProfile,
} from "./ir.js";
import {
  lowerSimpleTexBlockItemsToVList,
  lowerSimpleTexBlocksToVList,
  prepareSimpleTexVList,
  texVListParagraphEntries,
  type TexParagraphItem,
  type TexVBoxItem,
  type TexVListDocument,
} from "./vlist/index.js";

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
  readonly italicCorrectionAfter: boolean;
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
  readonly firstLineIndentWidth?: number;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly leftMarginWidth: number;
  readonly rightMarginWidth: number;
  readonly quoteDepth: number;
  readonly listContext?: SimpleTexListContext;
  readonly label?: TexLayoutLabel;
  readonly forcedBreakAfter?: SimpleTexParagraphSegment["forcedBreakAfter"];
  readonly items: readonly TexLayoutInlineItem[];
}

export interface SimpleTexLayoutDocumentIr {
  readonly kind: "simple-tex-layout-document";
  readonly vlist: TexVListDocument;
  readonly reportAlignment: TexParagraphAlignment;
  readonly layoutMode: KnuthPlassLayoutMode;
  readonly paragraphs: readonly TexLayoutParagraphIr[];
}

export function createSimpleTexLayoutDocumentIr(params: {
  readonly blocks: readonly SimpleTexParagraphBlock[];
  readonly items?: readonly SimpleTexBlockItem[];
  readonly defaultAlignment: TexParagraphAlignment;
  readonly font: ResolvedTexFont;
  readonly metricProvider?: TexMetricProvider;
  readonly options: TexLayoutIrOptions;
}): SimpleTexLayoutDocumentIr {
  const metricProvider = params.metricProvider ?? computerModernTexMetricProvider;
  const paragraphs: TexLayoutParagraphIr[] = [];
  const baseVList = params.items
    ? lowerSimpleTexBlockItemsToVList(params.items)
    : lowerSimpleTexBlocksToVList(params.blocks);
  const preparedVList = prepareSimpleTexVList(baseVList, params.font);
  const normalizedVList = preparedVList.normalized;
  const paragraphEntries = texVListParagraphEntries(normalizedVList.items);
  const paragraphItems = paragraphEntries.map((entry) => entry.item);
  const reportAlignment = texHonoredBlockAlignment(
    params.blocks[0],
    params.options
  ) ?? params.defaultAlignment;
  let layoutMode: KnuthPlassLayoutMode = "wrap";
  let activeAlignment = params.defaultAlignment;
  let activeAlignmentProfile: TexAlignmentProfile | undefined;
  let activeSpaceGlueProfile = texInitialSpaceGlueProfile(params.defaultAlignment);
  const finalParagraphBlockIndex = finalVListParagraphBlockIndex(paragraphItems);

  for (const entry of paragraphEntries) {
    const item = entry.item;
    const paragraph = item.paragraph;
    const scopePolicy = texParagraphScopePolicy(entry.ancestors);
    const blockIndex = paragraph.blockIndex;
    const inheritedAlignment = scopePolicy.resetInheritedAlignment ? params.defaultAlignment : activeAlignment;
    const inheritedAlignmentProfile = scopePolicy.resetInheritedAlignment ? undefined : activeAlignmentProfile;
    const blockAlignment = texHonoredBlockAlignment(
      paragraph,
      params.options,
      blockIndex === finalParagraphBlockIndex
    );
    const blockAlignmentProfile = blockAlignment ? paragraph.alignmentProfile : undefined;
    const alignment = blockAlignment ?? activeAlignment;
    const alignmentProfile = blockAlignment ? blockAlignmentProfile : activeAlignmentProfile;

    if (blockAlignment) {
      activeAlignment = blockAlignment;
      activeAlignmentProfile = blockAlignmentProfile;
      if (
        blockAlignmentProfile === "latex-declaration" &&
        params.options.tikzTextWidthNode === true
      ) {
        activeSpaceGlueProfile = "tikz-fixed";
      }
    }

    const effectiveAlignment = texScopeParagraphAlignment(scopePolicy, alignment);
    const effectiveAlignmentProfile = texScopeParagraphAlignmentProfile(
      scopePolicy,
      alignment,
      alignmentProfile
    );
    const paragraphSpaceGlueProfile = scopePolicy.resetSpaceGlueProfile
      ? texInitialSpaceGlueProfile(params.defaultAlignment)
      : activeSpaceGlueProfile;
    const segments = splitSimpleTexParagraphSegments(
      paragraph,
      params.options,
      effectiveAlignment,
      blockIndex
    );
    if (segments.some((segment) => segment.forcedBreakAfter)) {
      layoutMode = "wrapped-explicit";
    }

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex];
      const scopeLayout = texParagraphScopeLayout(entry.ancestors);
      const listLabelRightEdge = scopeLayout.listLabelRightEdge;
      const descriptionLabelItems =
        segmentIndex === 0 && paragraph.listContext?.showLabel === true
          ? texDescriptionLabelItemsForListContext(
              paragraph.listContext,
              params.font,
              metricProvider,
              paragraphSpaceGlueProfile
          )
          : [];
      const firstLineIndentWidth = texArticleDescriptionFirstLineIndentWidth(
        paragraph.listContext,
        scopeLayout,
        descriptionLabelItems.length > 0
      );
      const label = segmentIndex === 0 &&
        paragraph.listContext?.showLabel === true &&
        paragraph.listContext.kind !== "description"
        ? texLayoutLabelForListContext(
            paragraph.listContext,
            params.font,
            metricProvider,
            paragraphSpaceGlueProfile,
            listLabelRightEdge
          )
        : undefined;
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
        firstLineIndentWidth,
        spaceGlueProfile: paragraphSpaceGlueProfile,
        leftMarginWidth: scopeLayout.leftMarginWidth,
        rightMarginWidth: scopeLayout.rightMarginWidth,
        quoteDepth: paragraph.quoteDepth,
        listContext: paragraph.listContext,
        label,
        forcedBreakAfter: segment.forcedBreakAfter,
        items: [
          ...descriptionLabelItems,
          ...simpleTexSegmentToLayoutItems(
            segment,
            params.font.atPt,
            metricProvider,
            paragraphSpaceGlueProfile
          ),
        ],
      });
    }
  }

  return {
    kind: "simple-tex-layout-document",
    vlist: normalizedVList,
    reportAlignment,
    layoutMode,
    paragraphs,
  };
}

function texHonoredBlockAlignment(
  block: Pick<SimpleTexParagraphBlock, "alignment" | "alignmentProfile"> | undefined,
  options: TexLayoutIrOptions,
  finalParagraphInNode = false
): TexParagraphAlignment | undefined {
  if (!block?.alignment) {
    return undefined;
  }
  if (
    options.tikzTextWidthNode === true &&
    block.alignmentProfile === "latex-declaration" &&
    finalParagraphInNode
  ) {
    return undefined;
  }
  return block.alignment;
}

function finalVListParagraphBlockIndex(
  items: readonly TexParagraphItem[]
): number | undefined {
  return items.at(-1)?.paragraph.blockIndex;
}

function texScopeParagraphAlignment(
  policy: TexParagraphScopePolicy,
  alignment: TexParagraphAlignment
): TexParagraphAlignment {
  if (!policy.fallbackAlignment) {
    return alignment;
  }
  if (policy.preserveRaggedRight && alignment === "ragged-right") {
    return "ragged-right";
  }
  return policy.fallbackAlignment;
}

function texScopeParagraphAlignmentProfile(
  policy: TexParagraphScopePolicy,
  alignment: TexParagraphAlignment,
  alignmentProfile: TexAlignmentProfile | undefined
): TexAlignmentProfile | undefined {
  if (!policy.fallbackAlignment) {
    return alignmentProfile;
  }
  if (policy.preserveRaggedRight && alignment === "ragged-right") {
    return policy.raggedRightProfile;
  }
  return undefined;
}

interface TexParagraphScopePolicy {
  readonly fallbackAlignment?: TexParagraphAlignment;
  readonly preserveRaggedRight?: boolean;
  readonly raggedRightProfile?: TexAlignmentProfile;
  readonly resetInheritedAlignment: boolean;
  readonly resetSpaceGlueProfile: boolean;
}

function texParagraphScopePolicy(ancestors: readonly TexVBoxItem[]): TexParagraphScopePolicy {
  const policy: {
    fallbackAlignment?: TexParagraphAlignment;
    preserveRaggedRight?: boolean;
    raggedRightProfile?: TexAlignmentProfile;
    resetInheritedAlignment: boolean;
    resetSpaceGlueProfile: boolean;
  } = {
    resetInheritedAlignment: false,
    resetSpaceGlueProfile: false,
  };
  for (const ancestor of ancestors) {
    const paragraphPolicy = ancestor.layout?.paragraphPolicy;
    if (!paragraphPolicy) {
      continue;
    }
    if (paragraphPolicy.fallbackAlignment) {
      policy.fallbackAlignment = paragraphPolicy.fallbackAlignment;
    }
    if (paragraphPolicy.preserveRaggedRight !== undefined) {
      policy.preserveRaggedRight = paragraphPolicy.preserveRaggedRight;
    }
    if (paragraphPolicy.raggedRightProfile !== undefined) {
      policy.raggedRightProfile = paragraphPolicy.raggedRightProfile;
    }
    policy.resetInheritedAlignment ||= paragraphPolicy.resetInheritedAlignment === true;
    policy.resetSpaceGlueProfile ||= paragraphPolicy.resetSpaceGlueProfile === true;
  }
  return policy;
}

function texParagraphScopeLayout(ancestors: readonly TexVBoxItem[]): {
  readonly leftMarginWidth: number;
  readonly rightMarginWidth: number;
  readonly listLabelRightEdge: number;
  readonly listOwnLeftMarginWidth: number;
  readonly descriptionLabelSepWidth: number;
} {
  let leftMarginWidth = 0;
  let rightMarginWidth = 0;
  let listLabelRightEdge = 0;
  let listOwnLeftMarginWidth = 0;
  let descriptionLabelSepWidth = 0;
  for (const ancestor of ancestors) {
    if (!ancestor.layout) {
      continue;
    }
    const leftBefore = leftMarginWidth;
    leftMarginWidth += ancestor.layout.leftMarginWidth;
    rightMarginWidth += ancestor.layout.rightMarginWidth;
    if (ancestor.layout.list) {
      listLabelRightEdge = leftBefore + ancestor.layout.list.labelRightEdge;
      listOwnLeftMarginWidth = ancestor.layout.list.ownLeftMarginWidth;
      descriptionLabelSepWidth = ancestor.layout.list.descriptionLabelSepWidth;
    }
  }
  return {
    leftMarginWidth,
    rightMarginWidth,
    listLabelRightEdge,
    listOwnLeftMarginWidth,
    descriptionLabelSepWidth,
  };
}

function texArticleDescriptionFirstLineIndentWidth(
  listContext: SimpleTexListContext | undefined,
  scopeLayout: ReturnType<typeof texParagraphScopeLayout>,
  hasDescriptionLabel: boolean
): number | undefined {
  return listContext?.kind === "description"
    ? roundTexPt(
        -scopeLayout.listOwnLeftMarginWidth +
        (hasDescriptionLabel ? scopeLayout.descriptionLabelSepWidth : 0)
      )
    : undefined;
}

function texDescriptionLabelItemsForListContext(
  listContext: SimpleTexListContext,
  font: ResolvedTexFont,
  metricProvider: TexMetricProvider,
  spaceGlueProfile: TexSpaceGlueProfile
): TexLayoutInlineItem[] {
  if (listContext.kind !== "description" || !listContext.label) {
    return [];
  }
  return simpleTexInlineNodesToLayoutItems(
    listContext.label.nodes,
    listContext.label.sourceStart,
    listContext.label.sourceEnd,
    font.atPt,
    metricProvider,
    spaceGlueProfile,
    {
      family: "roman",
      series: "bold",
      shape: "upright",
    }
  );
}

function texLayoutLabelForListContext(
  listContext: SimpleTexListContext,
  font: ResolvedTexFont,
  metricProvider: TexMetricProvider,
  spaceGlueProfile: TexSpaceGlueProfile,
  rightEdge: number
): TexLayoutLabel {
  if (listContext.label) {
    return {
      items: simpleTexInlineNodesToLayoutItems(
        listContext.label.nodes,
        listContext.label.sourceStart,
        listContext.label.sourceEnd,
        font.atPt,
        metricProvider,
        spaceGlueProfile
      ),
      sourceStart: listContext.label.sourceStart,
      sourceEnd: listContext.label.sourceEnd,
      rightEdge,
    };
  }

  const glyphLabel = texDefaultItemizeGlyphLabel(listContext, font.atPt, metricProvider);
  if (glyphLabel) {
    return {
      items: [glyphLabel],
      sourceStart: 0,
      sourceEnd: 0,
      rightEdge,
    };
  }

  const text = texDefaultEnumerateLabelText(listContext);
  return {
    items: [{
      kind: "text",
      text,
      sourceStart: 0,
      sourceEnd: 0,
      font,
      italicCorrectionAfter: false,
      spaceFactorBefore: 1000,
      spaceFactorAfter: 1000,
    }],
    sourceStart: 0,
    sourceEnd: 0,
    rightEdge,
  };
}

function texDefaultItemizeGlyphLabel(
  listContext: SimpleTexListContext,
  atPt: number,
  metricProvider: TexMetricProvider
): TexLayoutGlyphItem | null {
  if (listContext.kind !== "itemize") {
    return null;
  }
  if (listContext.labelDepth === 2) {
    return {
      kind: "glyph",
      text: "–",
      code: 0x2013,
      font: metricProvider.resolveFont({ fontId: "lmroman10-regular", atPt }),
    };
  }
  if (listContext.labelDepth === 3) {
    return {
      kind: "glyph",
      text: "*",
      code: 42,
      font: metricProvider.resolveFont({ fontId: "tcrm1000", atPt }),
    };
  }
  if (listContext.labelDepth === 4) {
    return {
      kind: "glyph",
      text: ".",
      code: 183,
      font: metricProvider.resolveFont({ fontId: "tcrm1000", atPt }),
    };
  }
  return {
    kind: "glyph",
    text: "•",
    code: 0x2022,
    font: metricProvider.resolveFont({ fontId: "lmroman10-regular", atPt }),
  };
}

function texDefaultEnumerateLabelText(listContext: SimpleTexListContext): string {
  if (listContext.kind === "description") {
    return "";
  }
  switch (listContext.labelDepth) {
    case 2:
      return `(${texLowerAlphaCounter(listContext.itemIndex)})`;
    case 3:
      return `${texLowerRomanCounter(listContext.itemIndex)}.`;
    case 4:
      return `${texUpperAlphaCounter(listContext.itemIndex)}.`;
    default:
      return `${listContext.itemIndex}.`;
  }
}

function texLowerAlphaCounter(value: number): string {
  const normalized = Math.max(1, Math.floor(value));
  let remaining = normalized;
  let result = "";
  while (remaining > 0) {
    remaining -= 1;
    result = String.fromCharCode(97 + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26);
  }
  return result;
}

function texUpperAlphaCounter(value: number): string {
  return texLowerAlphaCounter(value).toUpperCase();
}

function texLowerRomanCounter(value: number): string {
  const normalized = Math.max(1, Math.floor(value));
  const entries: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let remaining = normalized;
  let result = "";
  for (const [amount, symbol] of entries) {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  }
  return result;
}

function simpleTexInlineNodesToLayoutItems(
  nodes: readonly SimpleTexParagraphSegment["nodes"][number][],
  sourceStart: number,
  sourceEnd: number,
  atPt: number,
  metricProvider: TexMetricProvider,
  spaceGlueProfile: TexSpaceGlueProfile,
  initialFontState?: SimpleTexFontState
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
    initialFontState
  );
}

export function texLayoutGlyphItemWidth(item: TexLayoutGlyphItem): number {
  return roundTexPt(tfmToPt(
    item.font,
    item.font.data.chars[String(item.code)]?.width
  ));
}

export function texLayoutGlyphItemHeight(item: TexLayoutGlyphItem): number {
  return roundTexPt(tfmToPt(
    item.font,
    item.font.data.chars[String(item.code)]?.height
  ));
}

export function texLayoutGlyphItemDepth(item: TexLayoutGlyphItem): number {
  return roundTexPt(tfmToPt(
    item.font,
    item.font.data.chars[String(item.code)]?.depth
  ));
}

function simpleTexSegmentToLayoutItems(
  segment: SimpleTexParagraphSegment,
  atPt: number,
  metricProvider: TexMetricProvider,
  spaceGlueProfile: TexSpaceGlueProfile,
  initialFontState?: SimpleTexFontState
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
      const font = resolveComputerModernFontForState(token.fontState, atPt, metricProvider);
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

    if (token.kind === "forced-break") {
      const font = resolveComputerModernFontForState(token.fontState, atPt, metricProvider);
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

    const font = resolveComputerModernFontForState(token.fontState, atPt, metricProvider);
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

function resolveComputerModernFontForState(
  state: SimpleTexFontState,
  atPt: number,
  metricProvider: TexMetricProvider
): ResolvedTexFont {
  return metricProvider.resolveFont({
    fontId: computerModernFontIdForState(state),
    atPt,
  });
}

function computerModernFontIdForState(
  state: SimpleTexFontState
): DefaultComputerModernTextFont {
  if (
    state.family === "normal" &&
    state.series === "medium" &&
    state.shape === "upright"
  ) {
    return "lmroman10-regular";
  }
  if (state.family === "sans") {
    if (state.series === "bold") {
      return "cmssbx10";
    }
    if (state.shape === "small-caps") {
      return "cmcsc10";
    }
    if (state.shape === "italic") {
      return "cmssi10";
    }
    return "cmss10";
  }
  if (state.series === "bold" && state.shape === "small-caps") {
    return "cmbx10";
  }
  if (state.series === "bold" && state.shape === "italic") {
    return "cmbxti10";
  }
  if (state.series === "bold") {
    return "cmbx10";
  }
  if (state.shape === "small-caps") {
    return "cmcsc10";
  }
  if (state.shape === "italic") {
    return "cmti10";
  }
  return "cmr10";
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
