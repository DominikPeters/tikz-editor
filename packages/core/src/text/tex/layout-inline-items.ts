import {
  defaultTexTextFontProfile,
  type TexTextFontProfile,
} from "./fonts/text-profile.js";
import type {
  NodeTextGraphicsOptions,
  NodeTextGraphicsResolver,
} from "../types.js";
import type { ResolvedTexFont, TexMetricProvider } from "./fonts/types.js";
import {
  defaultTexMathFontProfile,
  type TexMathFontFamily,
  type TexMathFontProfile,
} from "./math/font-profile.js";
import type {
  TexMathStyle,
  TexMathTextPart,
} from "./math/ir.js";
import type {
  TexMathChildHListLayoutItem,
  TexMathGlueLayoutItem,
  TexMathGlyphLayoutItem,
  TexMathHList,
  TexMathHListItem,
  TexMathKernLayoutItem,
  TexMathRuleLayoutItem,
} from "./math/layout.js";
import {
  simpleTexInlineNodesToTokens,
  type SimpleTexDimensionBoxCommandName,
  type SimpleTexDisplayMathDelimiter,
  type SimpleTexFontState,
  type SimpleTexGraphicsOptions,
  type SimpleTexGraphicsTrim,
  type SimpleTexGraphicsViewport,
  type SimpleTexInlineNode,
  type SimpleTexParagraphSegment,
  type SimpleTexTextBoxAlignment,
  type SimpleTexTextBoxCommandName,
  type SimpleTexTokenLiteralInfo,
  type TexSpaceGlueProfile,
} from "./ir.js";
import { roundTexPt } from "./fonts/units.js";
import {
  offsetTexHBoxLocalX,
  texHBoxLocalX,
  texHBoxLocalY,
  texHBoxOffsetX,
  texHBoxOffsetY,
  texHBoxX,
  texHBoxY,
  texLength,
  texMuLength,
  type TexHBoxLocalX,
  type TexHBoxLocalY,
  type TexHBoxOffsetX,
  type TexHBoxOffsetY,
  type TexHBoxX,
  type TexHBoxY,
  type TexLength,
  type TexVListLocalX,
  type TexVListX,
} from "./coordinates.js";
import { texInterwordGlueForSpaceFactor } from "./space-glue.js";

const TEX_LATEX_FBOX_RULE_PT = texLength(0.4);
const TEX_LATEX_FBOX_SEP_PT = texLength(3);
const TEX_INCLUDEGRAPHICS_PLACEHOLDER_SIZE_PT = texLength(28.4527559055);
const TEX_SVG_UNIT_SCALE = 100;

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
  readonly literal?: SimpleTexTokenLiteralInfo;
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
  /** Preserve interword stretch/shrink while prohibiting a break at TeX `~`. */
  readonly nonBreaking?: boolean;
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
  readonly sourceKind?: "text" | "math";
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly width: TexLength;
  readonly height: TexLength;
  readonly depth: TexLength;
  readonly stretch?: TexLength;
  readonly shrink?: TexLength;
  readonly caretMap?: TexMathCaretMap;
  readonly caretStops?: readonly TexHBoxX[];
  readonly constructRanges?: readonly TexMathConstructRange[];
  readonly breakpoints?: readonly TexMathBreakpoint[];
  readonly svgBody?: string;
  readonly hlist?: TexMathHList;
  readonly fontProfile?: TexMathFontProfile;
  readonly color?: string;
  readonly rootBox?: TexMathBox;
}

export type TexMathCaretEntryKind =
  | "math-boundary"
  | "construct-boundary"
  | "command"
  | "group-boundary"
  | "glyph-boundary"
  | "synthetic-boundary";

export interface TexMathCaretBounds {
  readonly xStart: TexHBoxX;
  readonly xEnd: TexHBoxX;
  readonly yStart: TexHBoxY;
  readonly yEnd: TexHBoxY;
}

export interface TexMathCaretEntry {
  readonly sourceOffset: number;
  readonly x: TexHBoxX;
  readonly y: TexHBoxY;
  readonly height: TexLength;
  readonly depth: TexLength;
  readonly hitBounds: TexMathCaretBounds;
  readonly kind: TexMathCaretEntryKind;
  readonly sourceSpan?: {
    readonly start: number;
    readonly end: number;
  };
  readonly priority?: number;
}

export type TexMathCaretDiagnosticCode =
  | "unsupported-math-caret-geometry"
  | "incomplete-math-caret-geometry";

export interface TexMathCaretDiagnostic {
  readonly code: TexMathCaretDiagnosticCode;
  readonly message: string;
  readonly sourceSpan: {
    readonly start: number;
    readonly end: number;
  };
}

export interface TexMathCaretMap {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly entries: readonly TexMathCaretEntry[];
  readonly diagnostics?: readonly TexMathCaretDiagnostic[];
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
  readonly explicit?: boolean;
}

export interface TexMathConstructRange {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly xStart: TexHBoxX;
  readonly xEnd: TexHBoxX;
}

export interface TexMathBreakpoint {
  readonly kind: "binary" | "relation" | "penalty";
  readonly sourceOffset: number;
  readonly x: TexHBoxX;
  readonly penalty: number;
  readonly stretchBefore?: TexLength;
  readonly shrinkBefore?: TexLength;
  readonly postBreakGlue?: {
    readonly width: TexLength;
    readonly stretch: TexLength;
    readonly shrink: TexLength;
  };
}

export interface TexMathDisplayAlignmentRowBox extends TexMathBox {
  readonly rowIndex: number;
  readonly x: TexVListLocalX;
}

export interface TexMathDisplayAlignmentIntertext {
  readonly beforeRowIndex: number;
  readonly text: string;
  readonly parts: readonly TexMathTextPart[];
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
}

export interface TexMathDisplayAlignment {
  readonly source: string;
  readonly content: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly delimiter: SimpleTexDisplayMathDelimiter;
  readonly width: TexLength;
  readonly rows: readonly TexMathDisplayAlignmentRowBox[];
  readonly intertexts?: readonly TexMathDisplayAlignmentIntertext[];
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
    readonly targetWidth?: TexLength;
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
    readonly targetWidth: TexLength;
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

export type TexLayoutTextBoxCommandName =
  | SimpleTexTextBoxCommandName
  | SimpleTexDimensionBoxCommandName
  | "rule"
  | "includegraphics"
  | "raisebox";

export interface TexLayoutTextBoxItem {
  readonly kind: "text-box";
  readonly role?: "list-label";
  readonly command: TexLayoutTextBoxCommandName;
  readonly text: string;
  readonly content: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly box: TexMathBox;
}

export interface TexLayoutPenaltyItem {
  readonly kind: "penalty";
  readonly role?: "list-label";
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly penalty: number;
}

export interface TexLayoutKernItem {
  readonly kind: "kern";
  readonly role?: "list-label";
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly font: ResolvedTexFont;
  readonly width: TexLength;
}

export type TexLayoutInlineItem =
  | TexLayoutTextItem
  | TexLayoutSpaceItem
  | TexLayoutForcedBreakItem
  | TexLayoutMathItem
  | TexLayoutTextBoxItem
  | TexLayoutPenaltyItem
  | TexLayoutKernItem;

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
  readonly rightEdge: TexVListX;
}

const TEX_LITERAL_FONT_STATE: SimpleTexFontState = {
  family: "typewriter",
  series: "medium",
  shape: "upright",
};

// Lowers raw source text to literal typewriter items: the total-rendering
// degradation for spans the engine cannot interpret (see
// design/tex-total-rendering.md). Breaks are allowed only at spaces.
function texLiteralItemsForSource(params: {
  readonly source: string;
  readonly sourceStart: number;
  readonly literal: SimpleTexTokenLiteralInfo;
  readonly atPt: TexLength;
  readonly metricProvider: TexMetricProvider;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly textFontProfile: TexTextFontProfile;
}): TexLayoutInlineItem[] {
  const font = params.textFontProfile.resolveTextFont(
    TEX_LITERAL_FONT_STATE,
    params.atPt,
    params.metricProvider
  );
  const items: TexLayoutInlineItem[] = [];
  const pattern = /([ \n]+)|([^ \n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(params.source)) !== null) {
    const segmentStart = params.sourceStart + match.index;
    const segmentEnd = segmentStart + match[0].length;
    if (match[1] !== undefined) {
      items.push({
        kind: "space",
        text: " ",
        sourceStart: segmentStart,
        sourceEnd: segmentEnd,
        font,
        spaceFactor: 1000,
        spaceGlueProfile: params.spaceGlueProfile,
      });
    } else {
      items.push({
        kind: "text",
        text: match[0],
        sourceStart: segmentStart,
        sourceEnd: segmentEnd,
        font,
        italicCorrectionAfter: false,
        spaceFactorBefore: 1000,
        spaceFactorAfter: 1000,
        literal: params.literal,
      });
    }
  }
  return items;
}

export function simpleTexInlineNodesToLayoutItems(
  nodes: readonly SimpleTexInlineNode[],
  sourceStart: number,
  sourceEnd: number,
  atPt: TexLength,
  metricProvider: TexMetricProvider,
  spaceGlueProfile: TexSpaceGlueProfile,
  mathBoxProvider?: TexMathBoxProvider,
  initialFontState?: SimpleTexFontState,
  textFontProfile: TexTextFontProfile = defaultTexTextFontProfile,
  graphicsResolver?: NodeTextGraphicsResolver
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
    textFontProfile,
    graphicsResolver
  );
}

export function simpleTexSegmentToLayoutItems(
  segment: SimpleTexParagraphSegment,
  atPt: TexLength,
  metricProvider: TexMetricProvider,
  spaceGlueProfile: TexSpaceGlueProfile,
  mathBoxProvider?: TexMathBoxProvider,
  initialFontState?: SimpleTexFontState,
  textFontProfile: TexTextFontProfile = defaultTexTextFontProfile,
  graphicsResolver?: NodeTextGraphicsResolver
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
        ...(token.literal ? { literal: token.literal } : {}),
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
        // Total rendering: a math span the math subsystem cannot handle is
        // contained as a literal run instead of escalating to node fallback.
        items.push(...texLiteralItemsForSource({
          source: token.text,
          sourceStart: token.sourceStart,
          literal: { reason: "math-error" },
          atPt,
          metricProvider,
          spaceGlueProfile,
          textFontProfile,
        }));
        hasSeenText = true;
        spaceFactor = 1000;
        continue;
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
        box: token.fontState.color
          ? {
              ...box,
              color: token.fontState.color,
              ...(box.rootBox ? { rootBox: { ...box.rootBox, color: token.fontState.color } } : {}),
            }
          : box,
      });
      hasSeenText = true;
      spaceFactor = 1000;
      continue;
    }

    if (token.kind === "mbox") {
      const box = texMBoxFromInlineNodes({
        command: token.command ?? "mbox",
        source: token.text,
        content: token.content ?? "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.contentStart ?? token.sourceStart,
        contentEnd: token.contentEnd ?? token.sourceEnd,
        children: token.children ?? [],
        boxWidth: token.boxWidth,
        boxAlign: token.boxAlign,
        backgroundColor: token.backgroundColor,
        frameColor: token.frameColor,
        fontState: token.fontState,
        atPt,
        metricProvider,
        spaceGlueProfile,
        mathBoxProvider,
        textFontProfile,
        graphicsResolver,
      });
      if (!box) {
        throw new Error(`Failed to lay out TeX \\${token.command ?? "mbox"} for source range ${token.sourceStart}:${token.sourceEnd}.`);
      }
      items.push({
        kind: "text-box",
        command: token.command ?? "mbox",
        text: token.text,
        content: token.content ?? "",
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

    if (token.kind === "rule") {
      const box = texRuleBox({
        source: token.text,
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        raise: token.ruleRaise ?? texHBoxOffsetY(0),
        width: token.ruleWidth ?? texLength(0),
        height: token.ruleHeight ?? texLength(0),
        metricProvider,
        textFontProfile,
      });
      items.push({
        kind: "text-box",
        command: "rule",
        text: token.text,
        content: "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.sourceStart,
        contentEnd: token.sourceEnd,
        box,
      });
      hasSeenText = true;
      spaceFactor = 1000;
      continue;
    }

    if (token.kind === "includegraphics") {
      const box = texIncludeGraphicsBox({
        source: token.text,
        filename: token.graphicsFilename ?? "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        filenameStart: token.graphicsFilenameStart ?? token.sourceStart,
        filenameEnd: token.graphicsFilenameEnd ?? token.sourceEnd,
        options: token.graphicsOptions ?? { raw: "" },
        graphicsResolver,
      });
      items.push({
        kind: "text-box",
        command: "includegraphics",
        text: token.text,
        content: token.graphicsFilename ?? "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.graphicsFilenameStart ?? token.sourceStart,
        contentEnd: token.graphicsFilenameEnd ?? token.sourceEnd,
        box,
      });
      hasSeenText = true;
      spaceFactor = 1000;
      continue;
    }

    if (token.kind === "raisebox") {
      const surroundingSizePt = token.fontState.sizePt ?? atPt;
      const box = texRaiseBoxFromInlineNodes({
        source: token.text,
        content: token.content ?? "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.contentStart ?? token.sourceStart,
        contentEnd: token.contentEnd ?? token.sourceEnd,
        children: token.children ?? [],
        lift: texHBoxOffsetY(roundTexPt(
          (token.lift ?? texHBoxOffsetY(0)) +
          (token.relativeLiftEm ?? 0) * surroundingSizePt
        )),
        boxHeight: token.boxHeight,
        boxDepth: token.boxDepth,
        fontState: token.fontState,
        childFontScale: token.childFontScale,
        atPt,
        metricProvider,
        spaceGlueProfile,
        mathBoxProvider,
        textFontProfile,
        graphicsResolver,
      });
      if (!box) {
        throw new Error(`Failed to lay out TeX \\raisebox for source range ${token.sourceStart}:${token.sourceEnd}.`);
      }
      items.push({
        kind: "text-box",
        command: "raisebox",
        text: token.text,
        content: token.content ?? "",
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

    if (token.kind === "dimension-box") {
      const command = token.dimensionCommand ?? "phantom";
      const box = texDimensionBoxFromInlineNodes({
        command,
        source: token.text,
        content: token.content ?? "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.contentStart ?? token.sourceStart,
        contentEnd: token.contentEnd ?? token.sourceEnd,
        children: token.children ?? [],
        fontState: token.fontState,
        atPt,
        metricProvider,
        spaceGlueProfile,
        mathBoxProvider,
        textFontProfile,
        graphicsResolver,
      });
      if (!box) {
        throw new Error(`Failed to lay out TeX \\${command} for source range ${token.sourceStart}:${token.sourceEnd}.`);
      }
      items.push({
        kind: "text-box",
        command,
        text: token.text,
        content: token.content ?? "",
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

    if (token.kind === "penalty") {
      items.push({
        kind: "penalty",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        penalty: token.penalty ?? 0,
      });
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
    if (token.nonBreaking) {
      items.push({
        kind: "space",
        text: " ",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        font,
        spaceFactor,
        spaceGlueProfile,
        nonBreaking: true,
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

  while (
    items.at(-1)?.kind === "space" ||
    (items.at(-1)?.kind === "forced-break" && segment.forcedBreakAfter === undefined)
  ) {
    items.pop();
  }
  return insertTextBoundaryKerns(items, metricProvider);
}

function texMBoxFromInlineNodes(params: {
  readonly command: SimpleTexTextBoxCommandName;
  readonly source: string;
  readonly content: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly children: readonly SimpleTexInlineNode[];
  readonly boxWidth?: TexLength;
  readonly boxAlign?: SimpleTexTextBoxAlignment;
  readonly backgroundColor?: string;
  readonly frameColor?: string;
  readonly fontState: SimpleTexFontState;
  readonly atPt: TexLength;
  readonly metricProvider: TexMetricProvider;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly textFontProfile: TexTextFontProfile;
  readonly graphicsResolver?: NodeTextGraphicsResolver;
}): TexMathBox | null {
  const innerItems = simpleTexInlineTokensToLayoutItems({
    tokens: simpleTexInlineNodesToTokens(params.children, params.fontState),
    atPt: params.atPt,
    metricProvider: params.metricProvider,
    spaceGlueProfile: params.spaceGlueProfile,
    mathBoxProvider: params.mathBoxProvider,
    textFontProfile: params.textFontProfile,
    graphicsResolver: params.graphicsResolver,
    trimEdges: false,
  });
  const hlist = texMBoxHListFromLayoutItems({
    items: innerItems,
    sourceSpan: {
      start: params.sourceStart,
      end: params.sourceEnd,
    },
    metricProvider: params.metricProvider,
  });
  if (!hlist) {
    return null;
  }
  const boxedHList = params.command === "fbox" || params.command === "framebox" ||
      params.command === "colorbox" || params.command === "fcolorbox"
    ? texFrameMBoxHList(hlist, {
        sourceSpan: {
          start: params.sourceStart,
          end: params.sourceEnd,
        },
        contentSourceSpan: {
          start: params.contentStart,
          end: params.contentEnd,
        },
        boxWidth: params.command === "framebox" ? params.boxWidth : undefined,
        boxAlign: params.boxAlign,
        frame: params.command !== "colorbox",
        backgroundColor: params.backgroundColor,
        frameColor: params.frameColor,
      })
    : params.command === "underline"
      ? texUnderlineMBoxHList(hlist, {
          start: params.sourceStart,
          end: params.sourceEnd,
        })
      : texReboxMBoxHList(hlist, {
        boxWidth: params.boxWidth,
        boxAlign: params.boxAlign,
      });
  return {
    source: params.source,
    content: params.content,
    sourceKind: "text",
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    contentStart: params.contentStart,
    contentEnd: params.contentEnd,
    width: boxedHList.width,
    height: boxedHList.height,
    depth: boxedHList.depth,
    caretStops: texMBoxCaretStops(
      params.sourceStart,
      params.sourceEnd,
      params.contentStart,
      params.contentEnd,
      boxedHList.width
    ),
    constructRanges: [{
      sourceStart: params.sourceStart,
      sourceEnd: params.sourceEnd,
      xStart: texHBoxX(0),
      xEnd: texHBoxX(boxedHList.width),
    }],
    hlist: boxedHList,
    fontProfile: texMBoxFontProfile(params.metricProvider, params.textFontProfile),
  };
}

function texUnderlineMBoxHList(
  body: TexMathHList,
  sourceSpan: { readonly start: number; readonly end: number }
): TexMathHList {
  const thickness = TEX_LATEX_FBOX_RULE_PT;
  const gap = texLength(roundTexPt(thickness * 1.5));
  const depth = texLength(roundTexPt(body.depth + gap + thickness));
  return {
    ...body,
    depth,
    sourceSpan,
    items: [
      ...body.items,
      {
        kind: "rule",
        role: "underline-rule",
        x: texHBoxLocalX(0),
        y: texHBoxLocalY(roundTexPt(body.depth + gap)),
        width: body.width,
        height: thickness,
        sourceSpan,
      },
    ],
  };
}

export function texFrameMBoxHList(
  body: TexMathHList,
  params: {
    readonly sourceSpan: { readonly start: number; readonly end: number };
    readonly contentSourceSpan: { readonly start: number; readonly end: number };
    readonly boxWidth?: TexLength;
    readonly boxAlign?: SimpleTexTextBoxAlignment;
    readonly frame?: boolean;
    readonly backgroundColor?: string;
    readonly frameColor?: string;
  }
): TexMathHList {
  const rule = params.frame === false ? texLength(0) : TEX_LATEX_FBOX_RULE_PT;
  const sep = TEX_LATEX_FBOX_SEP_PT;
  const hasExplicitWidth = params.boxWidth !== undefined && Number.isFinite(params.boxWidth);
  const framedBody = hasExplicitWidth
    ? texReboxMBoxHList(body, {
        boxWidth: texLength(roundTexPt((params.boxWidth ?? texLength(0)) - 2 * sep)),
        boxAlign: params.boxAlign ?? "center",
      })
    : body;
  const width = hasExplicitWidth
    ? texLength(roundTexPt(params.boxWidth ?? texLength(0)))
    : texLength(roundTexPt(framedBody.width + 2 * (rule + sep)));
  const bodyX = texHBoxLocalX(hasExplicitWidth ? sep : roundTexPt(rule + sep));
  const height = texLength(roundTexPt(framedBody.height + sep + rule));
  const depth = texLength(roundTexPt(framedBody.depth + sep + rule));
  const sideHeight = texLength(roundTexPt(height + depth));
  const kernItem = (x: TexHBoxLocalX, width: TexLength): TexMathKernLayoutItem => ({
    kind: "kern",
    x: roundTexPt(x),
    width: roundTexPt(width),
    reason: "text-kern",
    sourceSpan: params.sourceSpan,
  });
  const liftedKernItem = (
    x: TexHBoxLocalX,
    y: TexHBoxLocalY,
    width: TexLength
  ): TexMathChildHListLayoutItem => ({
    kind: "hlist",
    role: "boxed-kern",
    x: roundTexPt(x),
    y: roundTexPt(y),
    width: roundTexPt(width),
    height: texLength(0),
    depth: texLength(0),
    sourceSpan: params.sourceSpan,
    items: [kernItem(texHBoxLocalX(0), width)],
  });
  const frameRules: TexMathRuleLayoutItem[] = rule > 0 ? [
    {
      kind: "rule",
      role: "boxed-rule",
      x: texHBoxLocalX(0),
      y: texHBoxLocalY(0 - height),
      width,
      height: rule,
      color: params.frameColor,
      sourceSpan: params.sourceSpan,
    },
    {
      kind: "rule",
      role: "boxed-rule",
      x: texHBoxLocalX(0),
      y: texHBoxLocalY(0 - height),
      width: rule,
      height: sideHeight,
      color: params.frameColor,
      sourceSpan: params.sourceSpan,
    },
    {
      kind: "rule",
      role: "boxed-rule",
      x: texHBoxLocalX(roundTexPt(width - rule)),
      y: texHBoxLocalY(0 - height),
      width: rule,
      height: sideHeight,
      color: params.frameColor,
      sourceSpan: params.sourceSpan,
    },
    {
      kind: "rule",
      role: "boxed-rule",
      x: texHBoxLocalX(0),
      y: texHBoxLocalY(roundTexPt(framedBody.depth + sep)),
      width,
      height: rule,
      color: params.frameColor,
      sourceSpan: params.sourceSpan,
    },
  ] : [];
  const backgroundRule: TexMathRuleLayoutItem | null = params.backgroundColor
    ? {
        kind: "rule",
        role: "colorbox-background",
        x: texHBoxLocalX(0),
        y: texHBoxLocalY(0 - height),
        width,
        height: sideHeight,
        color: params.backgroundColor,
        sourceSpan: params.sourceSpan,
      }
    : null;
  const bodyChild: TexMathChildHListLayoutItem = {
    kind: "hlist",
    role: "boxed-body",
    x: bodyX,
    y: texHBoxLocalY(0),
    width: framedBody.width,
    height: framedBody.height,
    depth: framedBody.depth,
    sourceSpan: params.contentSourceSpan,
    items: framedBody.items,
  };
  const contentItems: TexMathHListItem[] = hasExplicitWidth
    ? [
        liftedKernItem(texHBoxLocalX(rule), texHBoxLocalY(sep), texLength(0 - rule)),
        kernItem(texHBoxLocalX(0), sep),
        bodyChild,
        kernItem(texHBoxLocalX(roundTexPt(sep + framedBody.width)), sep),
        liftedKernItem(texHBoxLocalX(width), texHBoxLocalY(sep), texLength(0 - rule)),
      ]
    : [
        kernItem(texHBoxLocalX(rule), sep),
        bodyChild,
        kernItem(texHBoxLocalX(roundTexPt(rule + sep + framedBody.width)), sep),
      ];
  return {
    kind: "math-hlist",
    style: "text",
    width,
    height,
    depth,
    sourceSpan: params.sourceSpan,
    items: [
      ...(backgroundRule ? [backgroundRule] : []),
      ...frameRules.slice(0, 2),
      ...contentItems,
      ...frameRules.slice(2),
    ],
  };
}

function texRuleBox(params: {
  readonly source: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly raise: TexHBoxOffsetY;
  readonly width: TexLength;
  readonly height: TexLength;
  readonly metricProvider: TexMetricProvider;
  readonly textFontProfile: TexTextFontProfile;
}): TexMathBox {
  const sourceSpan = { start: params.sourceStart, end: params.sourceEnd };
  const width = roundTexPt(params.width);
  const ruleHeight = roundTexPt(params.height);
  const raisedHeight = params.height + params.raise;
  const height = texLength(roundTexPt(Math.max(0, raisedHeight)));
  const depth = texLength(roundTexPt(Math.max(0, 0 - params.raise)));
  const rule = {
    kind: "rule",
    role: "literal-rule",
    x: texHBoxLocalX(0),
    y: texHBoxLocalY(roundTexPt(0 - raisedHeight)),
    width,
    height: ruleHeight,
    sourceSpan,
  } satisfies TexMathRuleLayoutItem;
  const hlist: TexMathHList = {
    kind: "math-hlist",
    style: "text",
    width,
    height,
    depth,
    sourceSpan,
    items: [rule],
  };
  return {
    source: params.source,
    content: "",
    sourceKind: "text",
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    contentStart: params.sourceStart,
    contentEnd: params.sourceEnd,
    width,
    height,
    depth,
    caretStops: texMBoxCaretStops(
      params.sourceStart,
      params.sourceEnd,
      params.sourceStart,
      params.sourceEnd,
      width
    ),
    constructRanges: [{
      sourceStart: params.sourceStart,
      sourceEnd: params.sourceEnd,
      xStart: texHBoxX(0),
      xEnd: texHBoxX(width),
    }],
    hlist,
    fontProfile: texMBoxFontProfile(params.metricProvider, params.textFontProfile),
  };
}

function texIncludeGraphicsBox(params: {
  readonly source: string;
  readonly filename: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly filenameStart: number;
  readonly filenameEnd: number;
  readonly options: SimpleTexGraphicsOptions;
  readonly graphicsResolver?: NodeTextGraphicsResolver;
}): TexMathBox {
  const graphicsOptions = nodeTextGraphicsOptions(params.options);
  const resolution = params.graphicsResolver?.resolve({
    filename: params.filename,
    options: graphicsOptions,
    source: params.source,
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
  }) ?? { status: "missing" as const };
  const assetNatural = resolution.status === "resolved" &&
    Number.isFinite(resolution.naturalWidthPt) &&
    Number.isFinite(resolution.naturalHeightPt) &&
    resolution.naturalWidthPt > 0 &&
    resolution.naturalHeightPt > 0
      ? {
          width: texLength(resolution.naturalWidthPt),
          height: texLength(resolution.naturalHeightPt),
        }
      : null;
  const cropRect = assetNatural
    ? texIncludeGraphicsCropRect(params.options, assetNatural)
    : null;
  const displayNatural = assetNatural
    ? {
        width: texLength((cropRect?.width ?? assetNatural.width) * (params.options.scale ?? 1)),
        height: texLength((cropRect?.height ?? assetNatural.height) * (params.options.scale ?? 1)),
      }
    : null;
  const size = texIncludeGraphicsTargetSize(params.options, displayNatural);
  const sourceSpan = { start: params.sourceStart, end: params.sourceEnd };
  const svgBody = resolution.status === "resolved" && assetNatural
    ? renderTexIncludeGraphicsImageSvgBody({
        sourceSpan,
        filename: params.filename,
        width: size.width,
        height: size.height,
        naturalWidth: assetNatural.width,
        naturalHeight: assetNatural.height,
        cropRect,
        clip: params.options.clip === true,
        mimeType: resolution.mimeType,
        dataBase64: resolution.dataBase64,
      })
    : renderTexIncludeGraphicsPlaceholderSvgBody({
        sourceSpan,
        filename: params.filename,
        width: size.width,
        height: size.height,
        status: resolution.status === "resolved" ? "unsupported" : resolution.status,
        reason: resolution.status === "resolved"
          ? "Could not determine image dimensions."
          : resolution.status === "unsupported"
            ? resolution.reason
            : undefined,
      });
  const width = roundTexPt(size.width);
  const height = roundTexPt(size.height);
  return {
    source: params.source,
    content: params.filename,
    sourceKind: "text",
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    contentStart: params.filenameStart,
    contentEnd: params.filenameEnd,
    width,
    height,
    depth: texLength(0),
    caretStops: texMBoxCaretStops(
      params.sourceStart,
      params.sourceEnd,
      params.filenameStart,
      params.filenameEnd,
      width
    ),
    constructRanges: [{
      sourceStart: params.sourceStart,
      sourceEnd: params.sourceEnd,
      xStart: texHBoxX(0),
      xEnd: texHBoxX(width),
    }],
    svgBody,
  };
}

function nodeTextGraphicsOptions(options: SimpleTexGraphicsOptions): NodeTextGraphicsOptions {
  return {
    raw: options.raw,
    ...(options.width !== undefined ? { width: `${formatTexSvgNumber(options.width)}pt` } : {}),
    ...(options.height !== undefined ? { height: `${formatTexSvgNumber(options.height)}pt` } : {}),
    ...(options.scale !== undefined ? { scale: formatTexSvgNumber(options.scale) } : {}),
    ...(options.keepAspectRatio ? { keepaspectratio: true } : {}),
    ...(options.trim ? { trim: formatTexGraphicsTrim(options.trim) } : {}),
    ...(options.viewport ? { viewport: formatTexGraphicsViewport(options.viewport) } : {}),
    ...(options.clip !== undefined ? { clip: options.clip } : {}),
  };
}

function texIncludeGraphicsTargetSize(
  options: {
    readonly width?: TexLength;
    readonly height?: TexLength;
    readonly scale?: number;
    readonly keepAspectRatio?: boolean;
  },
  natural: { readonly width: TexLength; readonly height: TexLength } | null
): { readonly width: TexLength; readonly height: TexLength } {
  const requestedWidth = finitePositive(options.width);
  const requestedHeight = finitePositive(options.height);
  const base = natural ?? {
    width: texLength(TEX_INCLUDEGRAPHICS_PLACEHOLDER_SIZE_PT * (options.scale ?? 1)),
    height: texLength(TEX_INCLUDEGRAPHICS_PLACEHOLDER_SIZE_PT * (options.scale ?? 1)),
  };
  if (requestedWidth !== null && requestedHeight !== null) {
    if (options.keepAspectRatio && base.width > 0 && base.height > 0) {
      const scale = Math.min(requestedWidth / base.width, requestedHeight / base.height);
      return {
        width: texLength(roundTexPt(base.width * scale)),
        height: texLength(roundTexPt(base.height * scale)),
      };
    }
    return {
      width: texLength(roundTexPt(requestedWidth)),
      height: texLength(roundTexPt(requestedHeight)),
    };
  }
  if (requestedWidth !== null) {
    return {
      width: texLength(roundTexPt(requestedWidth)),
      height: texLength(roundTexPt(natural ? requestedWidth * (base.height / base.width) : TEX_INCLUDEGRAPHICS_PLACEHOLDER_SIZE_PT)),
    };
  }
  if (requestedHeight !== null) {
    return {
      width: texLength(roundTexPt(natural ? requestedHeight * (base.width / base.height) : TEX_INCLUDEGRAPHICS_PLACEHOLDER_SIZE_PT)),
      height: texLength(roundTexPt(requestedHeight)),
    };
  }
  return {
    width: texLength(roundTexPt(base.width)),
    height: texLength(roundTexPt(base.height)),
  };
}

function finitePositive<T extends number>(value: T | undefined): T | null {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

type TexIncludeGraphicsCropRect = {
  readonly x: TexHBoxX;
  readonly y: TexHBoxY;
  readonly width: TexLength;
  readonly height: TexLength;
};

function texIncludeGraphicsCropRect(
  options: SimpleTexGraphicsOptions,
  natural: { readonly width: TexLength; readonly height: TexLength }
): TexIncludeGraphicsCropRect | null {
  if (options.viewport) {
    const crop = texIncludeGraphicsViewportCropRect(options.viewport, natural);
    if (validTexIncludeGraphicsCropRect(crop)) {
      return crop;
    }
    return null;
  }
  if (options.trim) {
    const crop = {
      x: texHBoxX(options.trim.left),
      y: texHBoxY(options.trim.top),
      width: texLength(natural.width - options.trim.left - options.trim.right),
      height: texLength(natural.height - options.trim.bottom - options.trim.top),
    };
    if (validTexIncludeGraphicsCropRect(crop)) {
      return crop;
    }
  }
  return null;
}

function texIncludeGraphicsViewportCropRect(
  viewport: SimpleTexGraphicsViewport,
  natural: { readonly width: TexLength; readonly height: TexLength }
): TexIncludeGraphicsCropRect {
  return {
    x: texHBoxX(viewport.llx),
    y: texHBoxY(natural.height - viewport.ury),
    width: texLength(viewport.urx - viewport.llx),
    height: texLength(viewport.ury - viewport.lly),
  };
}

function validTexIncludeGraphicsCropRect(crop: TexIncludeGraphicsCropRect): boolean {
  return (
    Number.isFinite(crop.x) &&
    Number.isFinite(crop.y) &&
    Number.isFinite(crop.width) &&
    Number.isFinite(crop.height) &&
    crop.width > 0 &&
    crop.height > 0
  );
}

function renderTexIncludeGraphicsImageSvgBody(params: {
  readonly sourceSpan: { readonly start: number; readonly end: number };
  readonly filename: string;
  readonly width: TexLength;
  readonly height: TexLength;
  readonly naturalWidth: TexLength;
  readonly naturalHeight: TexLength;
  readonly cropRect: TexIncludeGraphicsCropRect | null;
  readonly clip: boolean;
  readonly mimeType: string;
  readonly dataBase64: string;
}): string {
  const width = params.width * TEX_SVG_UNIT_SCALE;
  const height = params.height * TEX_SVG_UNIT_SCALE;
  const href = `data:${escapeTexSvgAttribute(params.mimeType)};base64,${escapeTexSvgAttribute(params.dataBase64)}`;
  if (params.cropRect) {
    const naturalWidth = params.naturalWidth * TEX_SVG_UNIT_SCALE;
    const naturalHeight = params.naturalHeight * TEX_SVG_UNIT_SCALE;
    const cropX = params.cropRect.x * TEX_SVG_UNIT_SCALE;
    const cropY = params.cropRect.y * TEX_SVG_UNIT_SCALE;
    const cropWidth = params.cropRect.width * TEX_SVG_UNIT_SCALE;
    const cropHeight = params.cropRect.height * TEX_SVG_UNIT_SCALE;
    return [
      `<g data-tex-includegraphics="true" data-source-start="${params.sourceSpan.start}" data-source-end="${params.sourceSpan.end}" data-tex-includegraphics-filename="${escapeTexSvgAttribute(params.filename)}">`,
      `<svg x="0" y="${formatTexSvgNumber(-height)}" width="${formatTexSvgNumber(width)}" height="${formatTexSvgNumber(height)}" overflow="${params.clip ? "hidden" : "visible"}" viewBox="${formatTexSvgNumber(cropX)} ${formatTexSvgNumber(cropY)} ${formatTexSvgNumber(cropWidth)} ${formatTexSvgNumber(cropHeight)}" preserveAspectRatio="none">`,
      `<image x="0" y="0" width="${formatTexSvgNumber(naturalWidth)}" height="${formatTexSvgNumber(naturalHeight)}" preserveAspectRatio="none" href="${href}" />`,
      `</svg>`,
      `</g>`,
    ].join("");
  }
  return [
    `<g data-tex-includegraphics="true" data-source-start="${params.sourceSpan.start}" data-source-end="${params.sourceSpan.end}" data-tex-includegraphics-filename="${escapeTexSvgAttribute(params.filename)}">`,
    `<image x="0" y="${formatTexSvgNumber(-height)}" width="${formatTexSvgNumber(width)}" height="${formatTexSvgNumber(height)}" preserveAspectRatio="none" href="${href}" />`,
    `</g>`,
  ].join("");
}

function renderTexIncludeGraphicsPlaceholderSvgBody(params: {
  readonly sourceSpan: { readonly start: number; readonly end: number };
  readonly filename: string;
  readonly width: TexLength;
  readonly height: TexLength;
  readonly status: "missing" | "unsupported";
  readonly reason?: string;
}): string {
  const width = params.width * TEX_SVG_UNIT_SCALE;
  const height = params.height * TEX_SVG_UNIT_SCALE;
  const y = -height;
  const reasonAttr = params.reason
    ? ` data-tex-includegraphics-reason="${escapeTexSvgAttribute(params.reason)}"`
    : "";
  return [
    `<g data-tex-includegraphics="placeholder" data-tex-includegraphics-status="${params.status}" data-source-start="${params.sourceSpan.start}" data-source-end="${params.sourceSpan.end}" data-tex-includegraphics-filename="${escapeTexSvgAttribute(params.filename)}"${reasonAttr}>`,
    `<rect x="0" y="${formatTexSvgNumber(y)}" width="${formatTexSvgNumber(width)}" height="${formatTexSvgNumber(height)}" fill="none" stroke="currentColor" stroke-width="40" />`,
    `<path d="M0 ${formatTexSvgNumber(y)} L${formatTexSvgNumber(width)} 0 M${formatTexSvgNumber(width)} ${formatTexSvgNumber(y)} L0 0" fill="none" stroke="currentColor" stroke-width="40" />`,
    `</g>`,
  ].join("");
}

function escapeTexSvgAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatTexSvgNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Number(value.toFixed(6)).toString();
}

function formatTexGraphicsTrim(trim: SimpleTexGraphicsTrim): string {
  return [
    `${formatTexSvgNumber(trim.left)}pt`,
    `${formatTexSvgNumber(trim.bottom)}pt`,
    `${formatTexSvgNumber(trim.right)}pt`,
    `${formatTexSvgNumber(trim.top)}pt`,
  ].join(" ");
}

function formatTexGraphicsViewport(viewport: SimpleTexGraphicsViewport): string {
  return [
    `${formatTexSvgNumber(viewport.llx)}pt`,
    `${formatTexSvgNumber(viewport.lly)}pt`,
    `${formatTexSvgNumber(viewport.urx)}pt`,
    `${formatTexSvgNumber(viewport.ury)}pt`,
  ].join(" ");
}

function texRaiseBoxFromInlineNodes(params: {
  readonly source: string;
  readonly content: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly children: readonly SimpleTexInlineNode[];
  readonly lift: TexHBoxOffsetY;
  readonly boxHeight?: TexLength;
  readonly boxDepth?: TexLength;
  readonly fontState: SimpleTexFontState;
  readonly childFontScale?: number;
  readonly atPt: TexLength;
  readonly metricProvider: TexMetricProvider;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly textFontProfile: TexTextFontProfile;
  readonly graphicsResolver?: NodeTextGraphicsResolver;
}): TexMathBox | null {
  const childFontState = params.childFontScale === undefined
    ? params.fontState
    : {
        ...params.fontState,
        sizePt: texLength(roundTexPt(
          (params.fontState.sizePt ?? params.atPt) * params.childFontScale
        )),
      };
  const innerItems = simpleTexInlineTokensToLayoutItems({
    tokens: simpleTexInlineNodesToTokens(params.children, childFontState),
    atPt: params.atPt,
    metricProvider: params.metricProvider,
    spaceGlueProfile: params.spaceGlueProfile,
    mathBoxProvider: params.mathBoxProvider,
    textFontProfile: params.textFontProfile,
    graphicsResolver: params.graphicsResolver,
    trimEdges: false,
  });
  const body = texMBoxHListFromLayoutItems({
    items: innerItems,
    sourceSpan: {
      start: params.contentStart,
      end: params.contentEnd,
    },
    metricProvider: params.metricProvider,
  });
  if (!body) {
    return null;
  }
  const lift = roundTexPt(params.lift);
  const naturalHeight = texLength(roundTexPt(Math.max(0, body.height + lift)));
  const naturalDepth = texLength(roundTexPt(Math.max(0, body.depth - lift)));
  const height = texLength(roundTexPt(params.boxHeight ?? naturalHeight));
  const depth = texLength(roundTexPt(params.boxDepth ?? naturalDepth));
  const sourceSpan = { start: params.sourceStart, end: params.sourceEnd };
  const hlist: TexMathHList = {
    kind: "math-hlist",
    style: "text",
    width: body.width,
    height,
    depth,
    sourceSpan,
    items: [{
      kind: "hlist",
      role: "nucleus",
      x: texHBoxLocalX(0),
      y: texHBoxLocalY(roundTexPt(0 - lift)),
      width: body.width,
      height: body.height,
      depth: body.depth,
      sourceSpan: {
        start: params.contentStart,
        end: params.contentEnd,
      },
      items: body.items,
    }],
  };
  return {
    source: params.source,
    content: params.content,
    sourceKind: "text",
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    contentStart: params.contentStart,
    contentEnd: params.contentEnd,
    width: body.width,
    height,
    depth,
    caretStops: texMBoxCaretStops(
      params.sourceStart,
      params.sourceEnd,
      params.contentStart,
      params.contentEnd,
      body.width
    ),
    constructRanges: [{
      sourceStart: params.sourceStart,
      sourceEnd: params.sourceEnd,
      xStart: texHBoxX(0),
      xEnd: texHBoxX(body.width),
    }],
    hlist,
    fontProfile: texMBoxFontProfile(params.metricProvider, params.textFontProfile),
  };
}

function texDimensionBoxFromInlineNodes(params: {
  readonly command: SimpleTexDimensionBoxCommandName;
  readonly source: string;
  readonly content: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly children: readonly SimpleTexInlineNode[];
  readonly fontState: SimpleTexFontState;
  readonly atPt: TexLength;
  readonly metricProvider: TexMetricProvider;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly textFontProfile: TexTextFontProfile;
  readonly graphicsResolver?: NodeTextGraphicsResolver;
}): TexMathBox | null {
  const innerItems = simpleTexInlineTokensToLayoutItems({
    tokens: simpleTexInlineNodesToTokens(params.children, params.fontState),
    atPt: params.atPt,
    metricProvider: params.metricProvider,
    spaceGlueProfile: params.spaceGlueProfile,
    mathBoxProvider: params.mathBoxProvider,
    textFontProfile: params.textFontProfile,
    graphicsResolver: params.graphicsResolver,
    trimEdges: false,
  });
  const body = texMBoxHListFromLayoutItems({
    items: innerItems,
    sourceSpan: {
      start: params.contentStart,
      end: params.contentEnd,
    },
    metricProvider: params.metricProvider,
  });
  if (!body) {
    return null;
  }
  const preserveWidth = params.command === "phantom" ||
    params.command === "hphantom" ||
    params.command === "smash";
  const preserveVertical = params.command === "phantom" || params.command === "vphantom";
  const renderBody = params.command === "smash";
  const width = preserveWidth ? body.width : texLength(0);
  const height = preserveVertical ? body.height : texLength(0);
  const depth = preserveVertical ? body.depth : texLength(0);
  const sourceSpan = { start: params.sourceStart, end: params.sourceEnd };
  const hlist: TexMathHList = {
    kind: "math-hlist",
    style: "text",
    width,
    height,
    depth,
    sourceSpan,
    items: renderBody ? body.items : [],
  };
  return {
    source: params.source,
    content: params.content,
    sourceKind: "text",
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    contentStart: params.contentStart,
    contentEnd: params.contentEnd,
    width,
    height,
    depth,
    caretStops: texMBoxCaretStops(
      params.sourceStart,
      params.sourceEnd,
      params.contentStart,
      params.contentEnd,
      width
    ),
    constructRanges: [{
      sourceStart: params.sourceStart,
      sourceEnd: params.sourceEnd,
      xStart: texHBoxX(0),
      xEnd: texHBoxX(width),
    }],
    hlist,
    fontProfile: texMBoxFontProfile(params.metricProvider, params.textFontProfile),
  };
}

function texMBoxFontProfile(
  metricProvider: TexMetricProvider,
  textFontProfile: TexTextFontProfile
): TexMathFontProfile {
  return {
    ...defaultTexMathFontProfile,
    textFontProfile,
    metricProvider,
    resolveMathFont: ({ family, style, baseAtPt = texLength(10) }) => {
      const fontId = defaultTexMathFontProfile.resolveMathFontId(family, style);
      return metricProvider.resolveFont({
        fontId,
        atPt: texMBoxMathFontAtPt(family, fontId, style, texLength(baseAtPt)),
      });
    },
  };
}

function texMBoxMathFontAtPt(
  family: TexMathFontFamily,
  fontId: string,
  style: TexMathStyle,
  baseAtPt: TexLength
): TexLength {
  if (family === "extension" && fontId === "cmex10") {
    return baseAtPt;
  }
  if (style === "script") {
    return texLength(baseAtPt * 0.7);
  }
  if (style === "scriptscript") {
    return texLength(baseAtPt * 0.5);
  }
  return baseAtPt;
}

function texMBoxCaretStops(
  sourceStart: number,
  sourceEnd: number,
  contentStart: number,
  contentEnd: number,
  width: TexLength
): readonly TexHBoxX[] {
  const length = Math.max(0, sourceEnd - sourceStart);
  const contentLength = Math.max(1, contentEnd - contentStart);
  return Array.from({ length: length + 1 }, (_, index) => {
    const sourceOffset = sourceStart + index;
    if (sourceOffset <= contentStart) {
      return texHBoxX(0);
    }
    if (sourceOffset >= contentEnd) {
      return texHBoxX(roundTexPt(width));
    }
    return texHBoxX(roundTexPt(((sourceOffset - contentStart) / contentLength) * width));
  });
}

export function simpleTexInlineTokensToLayoutItems(params: {
  readonly tokens: ReturnType<typeof simpleTexInlineNodesToTokens>;
  readonly atPt: TexLength;
  readonly metricProvider: TexMetricProvider;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly textFontProfile: TexTextFontProfile;
  readonly graphicsResolver?: NodeTextGraphicsResolver;
  readonly trimEdges: boolean;
}): TexLayoutInlineItem[] {
  const items: TexLayoutInlineItem[] = [];
  let spaceFactor = 1000;
  let hasSeenText = false;

  for (let tokenIndex = 0; tokenIndex < params.tokens.length; tokenIndex += 1) {
    const token = params.tokens[tokenIndex];
    if (params.trimEdges && token.kind === "space" && !hasSeenText) {
      continue;
    }

    if (token.kind === "text") {
      const font = params.textFontProfile.resolveTextFont(token.fontState, params.atPt, params.metricProvider);
      const italicCorrectionAfter =
        token.italicCorrectionAfter === true &&
        !texItalicCorrectionSuppressedByNextToken(params.tokens[tokenIndex + 1]);
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
        ...(token.literal ? { literal: token.literal } : {}),
      });
      hasSeenText = true;
      continue;
    }

    if (token.kind === "math") {
      const box = params.mathBoxProvider?.getInlineMathBox({
        source: token.text,
        content: token.content ?? "",
        delimiter: token.delimiter ?? "dollar",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.contentStart ?? token.sourceStart,
        contentEnd: token.contentEnd ?? token.sourceEnd,
      }) ?? null;
      if (!box) {
        items.push(...texLiteralItemsForSource({
          source: token.text,
          sourceStart: token.sourceStart,
          literal: { reason: "math-error" },
          atPt: params.atPt,
          metricProvider: params.metricProvider,
          spaceGlueProfile: params.spaceGlueProfile,
          textFontProfile: params.textFontProfile,
        }));
        hasSeenText = true;
        spaceFactor = 1000;
        continue;
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

    if (token.kind === "mbox") {
      const box = texMBoxFromInlineNodes({
        command: token.command ?? "mbox",
        source: token.text,
        content: token.content ?? "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.contentStart ?? token.sourceStart,
        contentEnd: token.contentEnd ?? token.sourceEnd,
        children: token.children ?? [],
        boxWidth: token.boxWidth,
        boxAlign: token.boxAlign,
        fontState: token.fontState,
        atPt: params.atPt,
        metricProvider: params.metricProvider,
        spaceGlueProfile: params.spaceGlueProfile,
        mathBoxProvider: params.mathBoxProvider,
        textFontProfile: params.textFontProfile,
        graphicsResolver: params.graphicsResolver,
      });
      if (!box) {
        throw new Error(`Failed to lay out TeX \\${token.command ?? "mbox"} for source range ${token.sourceStart}:${token.sourceEnd}.`);
      }
      items.push({
        kind: "text-box",
        command: token.command ?? "mbox",
        text: token.text,
        content: token.content ?? "",
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

    if (token.kind === "rule") {
      const box = texRuleBox({
        source: token.text,
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        raise: token.ruleRaise ?? texHBoxOffsetY(0),
        width: token.ruleWidth ?? texLength(0),
        height: token.ruleHeight ?? texLength(0),
        metricProvider: params.metricProvider,
        textFontProfile: params.textFontProfile,
      });
      items.push({
        kind: "text-box",
        command: "rule",
        text: token.text,
        content: "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.sourceStart,
        contentEnd: token.sourceEnd,
        box,
      });
      hasSeenText = true;
      spaceFactor = 1000;
      continue;
    }

    if (token.kind === "includegraphics") {
      const box = texIncludeGraphicsBox({
        source: token.text,
        filename: token.graphicsFilename ?? "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        filenameStart: token.graphicsFilenameStart ?? token.sourceStart,
        filenameEnd: token.graphicsFilenameEnd ?? token.sourceEnd,
        options: token.graphicsOptions ?? { raw: "" },
        graphicsResolver: params.graphicsResolver,
      });
      items.push({
        kind: "text-box",
        command: "includegraphics",
        text: token.text,
        content: token.graphicsFilename ?? "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.graphicsFilenameStart ?? token.sourceStart,
        contentEnd: token.graphicsFilenameEnd ?? token.sourceEnd,
        box,
      });
      hasSeenText = true;
      spaceFactor = 1000;
      continue;
    }

    if (token.kind === "raisebox") {
      const surroundingSizePt = token.fontState.sizePt ?? params.atPt;
      const box = texRaiseBoxFromInlineNodes({
        source: token.text,
        content: token.content ?? "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.contentStart ?? token.sourceStart,
        contentEnd: token.contentEnd ?? token.sourceEnd,
        children: token.children ?? [],
        lift: texHBoxOffsetY(roundTexPt(
          (token.lift ?? texHBoxOffsetY(0)) +
          (token.relativeLiftEm ?? 0) * surroundingSizePt
        )),
        boxHeight: token.boxHeight,
        boxDepth: token.boxDepth,
        fontState: token.fontState,
        childFontScale: token.childFontScale,
        atPt: params.atPt,
        metricProvider: params.metricProvider,
        spaceGlueProfile: params.spaceGlueProfile,
        mathBoxProvider: params.mathBoxProvider,
        textFontProfile: params.textFontProfile,
        graphicsResolver: params.graphicsResolver,
      });
      if (!box) {
        throw new Error(`Failed to lay out TeX \\raisebox for source range ${token.sourceStart}:${token.sourceEnd}.`);
      }
      items.push({
        kind: "text-box",
        command: "raisebox",
        text: token.text,
        content: token.content ?? "",
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

    if (token.kind === "dimension-box") {
      const command = token.dimensionCommand ?? "phantom";
      const box = texDimensionBoxFromInlineNodes({
        command,
        source: token.text,
        content: token.content ?? "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.contentStart ?? token.sourceStart,
        contentEnd: token.contentEnd ?? token.sourceEnd,
        children: token.children ?? [],
        fontState: token.fontState,
        atPt: params.atPt,
        metricProvider: params.metricProvider,
        spaceGlueProfile: params.spaceGlueProfile,
        mathBoxProvider: params.mathBoxProvider,
        textFontProfile: params.textFontProfile,
        graphicsResolver: params.graphicsResolver,
      });
      if (!box) {
        throw new Error(`Failed to lay out TeX \\${command} for source range ${token.sourceStart}:${token.sourceEnd}.`);
      }
      items.push({
        kind: "text-box",
        command,
        text: token.text,
        content: token.content ?? "",
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

    if (token.kind === "penalty") {
      items.push({
        kind: "penalty",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        penalty: token.penalty ?? 0,
      });
      continue;
    }

    if (token.kind === "forced-break") {
      const font = params.textFontProfile.resolveTextFont(token.fontState, params.atPt, params.metricProvider);
      items.push({
        kind: "forced-break",
        text: " ",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        font,
        lineLeading: token.lineLeading,
        spaceFactor,
        spaceGlueProfile: params.spaceGlueProfile,
      });
      continue;
    }

    const font = params.textFontProfile.resolveTextFont(token.fontState, params.atPt, params.metricProvider);
    if (token.nonBreaking) {
      items.push({
        kind: "space",
        text: " ",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        font,
        spaceFactor,
        spaceGlueProfile: params.spaceGlueProfile,
        nonBreaking: true,
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
      spaceGlueProfile: params.spaceGlueProfile,
    });
  }

  if (params.trimEdges) {
    while (items.at(-1)?.kind === "space" || items.at(-1)?.kind === "forced-break") {
      items.pop();
    }
  }
  return insertTextBoundaryKerns(items, params.metricProvider);
}

function insertTextBoundaryKerns(
  items: readonly TexLayoutInlineItem[],
  metricProvider: TexMetricProvider
): TexLayoutInlineItem[] {
  const result: TexLayoutInlineItem[] = [];
  for (const item of items) {
    const previous = result.at(-1);
    if (previous?.kind === "text" && item.kind === "text") {
      const width = textBoundaryKernWidth(previous, item, metricProvider);
      if (Math.abs(width) > 0.00001) {
        result.push({
          kind: "kern",
          sourceStart: previous.sourceEnd,
          sourceEnd: item.sourceStart,
          font: item.font,
          width,
        });
      }
    }
    result.push(item);
  }
  return result;
}

function textBoundaryKernWidth(
  left: TexLayoutTextItem,
  right: TexLayoutTextItem,
  metricProvider: TexMetricProvider
): TexLength {
  if (left.font.id !== right.font.id || left.text.length === 0 || right.text.length === 0) {
    return texLength(0);
  }
  const leftChar = left.text.at(-1) ?? "";
  const rightChar = right.text[0] ?? "";
  if (!leftChar || !rightChar) {
    return texLength(0);
  }
  const shapedPair = metricProvider.shapeText(`${leftChar}${rightChar}`, left.font);
  if (!shapedPair.items.some((item) => item.kind === "kern")) {
    return texLength(0);
  }
  const separateWidth =
    metricProvider.shapeText(leftChar, left.font).width +
    metricProvider.shapeText(rightChar, right.font).width;
  return texLength(roundTexPt(shapedPair.width - separateWidth));
}

export function texMBoxHListFromLayoutItems(params: {
  readonly items: readonly TexLayoutInlineItem[];
  readonly sourceSpan: { readonly start: number; readonly end: number };
  readonly metricProvider: TexMetricProvider;
}): TexMathHList | null {
  const items: TexMathHListItem[] = [];
  let cursor = texHBoxLocalX(0);
  let height = texLength(0);
  let depth = texLength(0);

  for (const item of params.items) {
    if (item.kind === "text") {
      const shaped = params.metricProvider.shapeText(item.text, item.font, {
        sourceStart: item.sourceStart,
        sourceEnd: item.sourceEnd,
      });
      for (const shapedItem of shaped.items) {
        const layoutItem = texTextShapedItemToMBoxItem(shapedItem, item.font, cursor);
        items.push(layoutItem);
        cursor = texHBoxLocalX(roundTexPt(cursor + layoutItem.width));
        if (layoutItem.kind === "glyph") {
          height = texLength(Math.max(height, layoutItem.height));
          depth = texLength(Math.max(depth, layoutItem.depth));
        }
      }
      const correction = item.italicCorrectionAfter
        ? texMBoxTrailingItalicCorrectionWidth(shaped.items)
        : texLength(0);
      if (item.italicCorrectionAfter) {
        const kern = texMBoxKernItem(cursor, correction, item.sourceEnd, item.sourceEnd);
        items.push(kern);
        cursor = texHBoxLocalX(roundTexPt(cursor + kern.width));
      }
      continue;
    }

    if (item.kind === "space") {
      const glue = texInterwordGlueForSpaceFactor(
        item.font,
        item.spaceFactor,
        item.spaceGlueProfile
      );
      const layoutGlue = texMBoxGlueItem(cursor, glue, item.sourceStart, item.sourceEnd);
      items.push(layoutGlue);
      cursor = texHBoxLocalX(roundTexPt(cursor + layoutGlue.width));
      continue;
    }

    if (item.kind === "kern") {
      const kern = texMBoxKernItem(cursor, item.width, item.sourceStart, item.sourceEnd);
      items.push(kern);
      cursor = texHBoxLocalX(roundTexPt(cursor + kern.width));
      continue;
    }

    if (item.kind === "math" || item.kind === "text-box") {
      const child = texMBoxChildHListItem(item.box, cursor, item.sourceStart, item.sourceEnd);
      if (!child) {
        return null;
      }
      items.push(child);
      cursor = texHBoxLocalX(roundTexPt(cursor + child.width));
      height = texLength(Math.max(height, child.height));
      depth = texLength(Math.max(depth, child.depth));
      continue;
    }

    if (item.kind === "penalty") {
      continue;
    }

    return null;
  }

  return {
    kind: "math-hlist",
    style: "text",
    width: texLength(roundTexPt(cursor)),
    height: texLength(roundTexPt(height)),
    depth: texLength(roundTexPt(depth)),
    sourceSpan: params.sourceSpan,
    items,
  };
}

export function texReboxMBoxHList(
  hlist: TexMathHList,
  params: {
    readonly boxWidth?: TexLength;
    readonly boxAlign?: SimpleTexTextBoxAlignment;
  }
): TexMathHList {
  if (params.boxWidth === undefined || !Number.isFinite(params.boxWidth)) {
    return hlist;
  }
  const targetWidth = roundTexPt(params.boxWidth);
  const alignment = params.boxAlign ?? "center";
  if (alignment === "stretch") {
    return texSetMBoxHListWidth(hlist, targetWidth);
  }
  const offset = texMBoxAlignmentOffset(hlist.width, targetWidth, alignment);
  if (offset === 0) {
    return hlist.width === targetWidth
      ? hlist
      : { ...hlist, width: targetWidth };
  }
  return {
    ...hlist,
    width: targetWidth,
    items: hlist.items.map((item): TexMathHListItem => ({
      ...item,
      x: texHBoxLocalX(roundTexPt(offsetTexHBoxLocalX(item.x, offset))),
    })),
  };
}

function texMBoxAlignmentOffset(
  naturalWidth: TexLength,
  targetWidth: TexLength,
  alignment: SimpleTexTextBoxAlignment
): TexHBoxOffsetX {
  switch (alignment) {
    case "left":
    case "natural":
    case "stretch":
      return texHBoxOffsetX(0);
    case "right":
      return texHBoxOffsetX(roundTexPt(targetWidth - naturalWidth));
    case "center":
      return texHBoxOffsetX(roundTexPt((targetWidth - naturalWidth) / 2));
  }
}

function texSetMBoxHListWidth(
  hlist: TexMathHList,
  targetWidth: TexLength
): TexMathHList {
  const roundedTargetWidth = roundTexPt(targetWidth);
  const delta = roundTexPt(roundedTargetWidth - hlist.width);
  if (delta === 0) {
    return hlist.width === roundedTargetWidth
      ? hlist
      : { ...hlist, width: roundedTargetWidth };
  }
  const sign = delta > 0 ? "stretch" : "shrink";
  const total = hlist.items.reduce((sum, item) => {
    if (item.kind !== "glue") {
      return sum;
    }
    return sum + Math.max(0, sign === "stretch" ? item.stretch : item.shrink);
  }, 0);
  if (total <= 0) {
    return { ...hlist, width: roundedTargetWidth };
  }
  const ratio = sign === "stretch"
    ? delta / total
    : Math.min(-delta / total, 1);
  let offset = texHBoxOffsetX(0);
  const items = hlist.items.map((item): TexMathHListItem => {
    const shiftedX = texHBoxLocalX(roundTexPt(offsetTexHBoxLocalX(item.x, offset)));
    if (item.kind !== "glue") {
      return {
        ...item,
        x: shiftedX,
      };
    }
    const adjustment = (sign === "stretch" ? item.stretch : 0 - item.shrink) * ratio;
    const adjustedWidth = texLength(roundTexPt(item.width + adjustment));
    offset = texHBoxOffsetX(roundTexPt(offset + adjustedWidth - item.width));
    return {
      ...item,
      x: shiftedX,
      width: adjustedWidth,
    };
  });
  return {
    ...hlist,
    width: roundedTargetWidth,
    items,
  };
}

function texTextShapedItemToMBoxItem(
  item: ReturnType<TexMetricProvider["shapeText"]>["items"][number],
  font: ResolvedTexFont,
  x: TexHBoxLocalX
): TexMathGlyphLayoutItem | TexMathKernLayoutItem {
  if (item.kind === "kern") {
    return texMBoxKernItem(x, item.width, item.sourceStart, item.sourceEnd);
  }
  return {
    kind: "glyph",
    fontId: font.id,
    atPt: font.atPt,
    family: "text",
    code: item.code,
    text: String.fromCharCode(item.code),
    x,
    y: texHBoxLocalY(0),
    width: item.width,
    height: item.height,
    depth: item.depth,
    italicCorrection: item.italicCorrection,
    ...(font.color ? { color: font.color } : {}),
    sourceSpan: {
      start: item.sourceStart,
      end: item.sourceEnd,
    },
  };
}

function texMBoxKernItem(
  x: TexHBoxLocalX,
  width: TexLength,
  sourceStart: number,
  sourceEnd: number
): TexMathKernLayoutItem {
  return {
    kind: "kern",
    x,
    width: roundTexPt(width),
    reason: "text-kern",
    sourceSpan: {
      start: sourceStart,
      end: sourceEnd,
    },
  };
}

function texMBoxGlueItem(
  x: TexHBoxLocalX,
  glue: {
    readonly width: TexLength;
    readonly stretch: TexLength;
    readonly shrink: TexLength;
  },
  sourceStart: number,
  sourceEnd: number
): TexMathGlueLayoutItem {
  return {
    kind: "glue",
    x,
    width: roundTexPt(glue.width),
    mu: texMuLength(0),
    stretch: roundTexPt(glue.stretch),
    shrink: roundTexPt(glue.shrink),
    source: "explicit",
    sourceSpan: {
      start: sourceStart,
      end: sourceEnd,
    },
  };
}

function texMBoxTrailingItalicCorrectionWidth(
  items: ReturnType<TexMetricProvider["shapeText"]>["items"]
): TexLength {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "glyph") {
      return item.italicCorrection;
    }
  }
  return texLength(0);
}

function texMBoxChildHListItem(
  box: TexMathBox,
  x: TexHBoxLocalX,
  sourceStart: number,
  sourceEnd: number
): TexMathChildHListLayoutItem | null {
  if (!box.hlist) {
    return null;
  }
  return {
    kind: "hlist",
    role: "nucleus",
    x,
    y: texHBoxLocalY(0),
    width: roundTexPt(box.width),
    height: roundTexPt(box.height),
    depth: roundTexPt(box.depth),
    sourceSpan: {
      start: sourceStart,
      end: sourceEnd,
    },
    ...(box.color ? { color: box.color } : {}),
    items: box.hlist.items,
  };
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
