import {
  defaultTexTextFontProfile,
  type TexTextFontProfile,
} from "./fonts/text-profile.js";
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
  type SimpleTexInlineNode,
  type SimpleTexParagraphSegment,
  type SimpleTexTextBoxAlignment,
  type SimpleTexTextBoxCommandName,
  type TexSpaceGlueProfile,
} from "./ir.js";
import { roundTexPt } from "./fonts/units.js";
import { texInterwordGlueForSpaceFactor } from "./space-glue.js";

const TEX_LATEX_FBOX_RULE_PT = 0.4;
const TEX_LATEX_FBOX_SEP_PT = 3;

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
  readonly sourceKind?: "text" | "math";
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly stretch?: number;
  readonly shrink?: number;
  readonly caretMap?: TexMathCaretMap;
  readonly caretStops?: readonly number[];
  readonly constructRanges?: readonly TexMathConstructRange[];
  readonly breakpoints?: readonly TexMathBreakpoint[];
  readonly svgBody?: string;
  readonly hlist?: TexMathHList;
  readonly fontProfile?: TexMathFontProfile;
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
  readonly xStart: number;
  readonly xEnd: number;
  readonly yStart: number;
  readonly yEnd: number;
}

export interface TexMathCaretEntry {
  readonly sourceOffset: number;
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly depth: number;
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
  readonly xStart: number;
  readonly xEnd: number;
}

export interface TexMathBreakpoint {
  readonly kind: "binary" | "relation" | "penalty";
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
  readonly width: number;
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

export type TexLayoutTextBoxCommandName =
  | SimpleTexTextBoxCommandName
  | SimpleTexDimensionBoxCommandName
  | "rule"
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
  readonly width: number;
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
        atPt,
        metricProvider,
        spaceGlueProfile,
        mathBoxProvider,
        textFontProfile,
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
        raise: token.ruleRaise ?? 0,
        width: token.ruleWidth ?? 0,
        height: token.ruleHeight ?? 0,
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

    if (token.kind === "raisebox") {
      const box = texRaiseBoxFromInlineNodes({
        source: token.text,
        content: token.content ?? "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.contentStart ?? token.sourceStart,
        contentEnd: token.contentEnd ?? token.sourceEnd,
        children: token.children ?? [],
        lift: token.lift ?? 0,
        boxHeight: token.boxHeight,
        boxDepth: token.boxDepth,
        fontState: token.fontState,
        atPt,
        metricProvider,
        spaceGlueProfile,
        mathBoxProvider,
        textFontProfile,
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
  readonly boxWidth?: number;
  readonly boxAlign?: SimpleTexTextBoxAlignment;
  readonly fontState: SimpleTexFontState;
  readonly atPt: number;
  readonly metricProvider: TexMetricProvider;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly textFontProfile: TexTextFontProfile;
}): TexMathBox | null {
  const innerItems = simpleTexInlineTokensToLayoutItems({
    tokens: simpleTexInlineNodesToTokens(params.children, params.fontState),
    atPt: params.atPt,
    metricProvider: params.metricProvider,
    spaceGlueProfile: params.spaceGlueProfile,
    mathBoxProvider: params.mathBoxProvider,
    textFontProfile: params.textFontProfile,
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
  const boxedHList = params.command === "fbox" || params.command === "framebox"
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
      xStart: 0,
      xEnd: boxedHList.width,
    }],
    hlist: boxedHList,
    fontProfile: texMBoxFontProfile(params.metricProvider, params.textFontProfile),
  };
}

export function texFrameMBoxHList(
  body: TexMathHList,
  params: {
    readonly sourceSpan: { readonly start: number; readonly end: number };
    readonly contentSourceSpan: { readonly start: number; readonly end: number };
    readonly boxWidth?: number;
    readonly boxAlign?: SimpleTexTextBoxAlignment;
  }
): TexMathHList {
  const rule = TEX_LATEX_FBOX_RULE_PT;
  const sep = TEX_LATEX_FBOX_SEP_PT;
  const hasExplicitWidth = params.boxWidth !== undefined && Number.isFinite(params.boxWidth);
  const framedBody = hasExplicitWidth
    ? texReboxMBoxHList(body, {
        boxWidth: roundTexPt((params.boxWidth ?? 0) - 2 * sep),
        boxAlign: params.boxAlign ?? "center",
      })
    : body;
  const width = hasExplicitWidth
    ? roundTexPt(params.boxWidth ?? 0)
    : roundTexPt(framedBody.width + 2 * (rule + sep));
  const bodyX = hasExplicitWidth ? sep : roundTexPt(rule + sep);
  const height = roundTexPt(framedBody.height + sep + rule);
  const depth = roundTexPt(framedBody.depth + sep + rule);
  const sideHeight = roundTexPt(height + depth);
  const kernItem = (x: number, width: number): TexMathKernLayoutItem => ({
    kind: "kern",
    x: roundTexPt(x),
    width: roundTexPt(width),
    reason: "text-kern",
    sourceSpan: params.sourceSpan,
  });
  const liftedKernItem = (x: number, y: number, width: number): TexMathChildHListLayoutItem => ({
    kind: "hlist",
    role: "boxed-kern",
    x: roundTexPt(x),
    y: roundTexPt(y),
    width: roundTexPt(width),
    height: 0,
    depth: 0,
    sourceSpan: params.sourceSpan,
    items: [kernItem(0, width)],
  });
  const rules: TexMathRuleLayoutItem[] = [
    {
      kind: "rule",
      role: "boxed-rule",
      x: 0,
      y: -height,
      width,
      height: rule,
      sourceSpan: params.sourceSpan,
    },
    {
      kind: "rule",
      role: "boxed-rule",
      x: 0,
      y: -height,
      width: rule,
      height: sideHeight,
      sourceSpan: params.sourceSpan,
    },
    {
      kind: "rule",
      role: "boxed-rule",
      x: roundTexPt(width - rule),
      y: -height,
      width: rule,
      height: sideHeight,
      sourceSpan: params.sourceSpan,
    },
    {
      kind: "rule",
      role: "boxed-rule",
      x: 0,
      y: roundTexPt(framedBody.depth + sep),
      width,
      height: rule,
      sourceSpan: params.sourceSpan,
    },
  ];
  const bodyChild: TexMathChildHListLayoutItem = {
    kind: "hlist",
    role: "boxed-body",
    x: bodyX,
    y: 0,
    width: framedBody.width,
    height: framedBody.height,
    depth: framedBody.depth,
    sourceSpan: params.contentSourceSpan,
    items: framedBody.items,
  };
  const contentItems: TexMathHListItem[] = hasExplicitWidth
    ? [
        liftedKernItem(rule, sep, -rule),
        kernItem(0, sep),
        bodyChild,
        kernItem(roundTexPt(sep + framedBody.width), sep),
        liftedKernItem(width, sep, -rule),
      ]
    : [
        kernItem(rule, sep),
        bodyChild,
        kernItem(roundTexPt(rule + sep + framedBody.width), sep),
      ];
  return {
    kind: "math-hlist",
    style: "text",
    width,
    height,
    depth,
    sourceSpan: params.sourceSpan,
    items: [rules[0], rules[1], ...contentItems, rules[2], rules[3]],
  };
}

function texRuleBox(params: {
  readonly source: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly raise: number;
  readonly width: number;
  readonly height: number;
  readonly metricProvider: TexMetricProvider;
  readonly textFontProfile: TexTextFontProfile;
}): TexMathBox {
  const sourceSpan = { start: params.sourceStart, end: params.sourceEnd };
  const width = roundTexPt(params.width);
  const ruleHeight = roundTexPt(params.height);
  const raisedHeight = params.height + params.raise;
  const height = roundTexPt(Math.max(0, raisedHeight));
  const depth = roundTexPt(Math.max(0, -params.raise));
  const rule = {
    kind: "rule",
    role: "literal-rule",
    x: 0,
    y: roundTexPt(-raisedHeight),
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
      xStart: 0,
      xEnd: width,
    }],
    hlist,
    fontProfile: texMBoxFontProfile(params.metricProvider, params.textFontProfile),
  };
}

function texRaiseBoxFromInlineNodes(params: {
  readonly source: string;
  readonly content: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly children: readonly SimpleTexInlineNode[];
  readonly lift: number;
  readonly boxHeight?: number;
  readonly boxDepth?: number;
  readonly fontState: SimpleTexFontState;
  readonly atPt: number;
  readonly metricProvider: TexMetricProvider;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly textFontProfile: TexTextFontProfile;
}): TexMathBox | null {
  const innerItems = simpleTexInlineTokensToLayoutItems({
    tokens: simpleTexInlineNodesToTokens(params.children, params.fontState),
    atPt: params.atPt,
    metricProvider: params.metricProvider,
    spaceGlueProfile: params.spaceGlueProfile,
    mathBoxProvider: params.mathBoxProvider,
    textFontProfile: params.textFontProfile,
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
  const naturalHeight = roundTexPt(Math.max(0, body.height + lift));
  const naturalDepth = roundTexPt(Math.max(0, body.depth - lift));
  const height = roundTexPt(params.boxHeight ?? naturalHeight);
  const depth = roundTexPt(params.boxDepth ?? naturalDepth);
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
      x: 0,
      y: roundTexPt(-lift),
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
      xStart: 0,
      xEnd: body.width,
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
  readonly atPt: number;
  readonly metricProvider: TexMetricProvider;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly textFontProfile: TexTextFontProfile;
}): TexMathBox | null {
  const innerItems = simpleTexInlineTokensToLayoutItems({
    tokens: simpleTexInlineNodesToTokens(params.children, params.fontState),
    atPt: params.atPt,
    metricProvider: params.metricProvider,
    spaceGlueProfile: params.spaceGlueProfile,
    mathBoxProvider: params.mathBoxProvider,
    textFontProfile: params.textFontProfile,
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
  const width = preserveWidth ? body.width : 0;
  const height = preserveVertical ? body.height : 0;
  const depth = preserveVertical ? body.depth : 0;
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
      xStart: 0,
      xEnd: width,
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
    resolveMathFont: ({ family, style, baseAtPt = 10 }) => {
      const fontId = defaultTexMathFontProfile.resolveMathFontId(family, style);
      return metricProvider.resolveFont({
        fontId,
        atPt: texMBoxMathFontAtPt(family, fontId, style, baseAtPt),
      });
    },
  };
}

function texMBoxMathFontAtPt(
  family: TexMathFontFamily,
  fontId: string,
  style: TexMathStyle,
  baseAtPt: number
): number {
  if (family === "extension" && fontId === "cmex10") {
    return baseAtPt;
  }
  if (style === "script") {
    return baseAtPt * 0.7;
  }
  if (style === "scriptscript") {
    return baseAtPt * 0.5;
  }
  return baseAtPt;
}

function texMBoxCaretStops(
  sourceStart: number,
  sourceEnd: number,
  contentStart: number,
  contentEnd: number,
  width: number
): readonly number[] {
  const length = Math.max(0, sourceEnd - sourceStart);
  const contentLength = Math.max(1, contentEnd - contentStart);
  return Array.from({ length: length + 1 }, (_, index) => {
    const sourceOffset = sourceStart + index;
    if (sourceOffset <= contentStart) {
      return 0;
    }
    if (sourceOffset >= contentEnd) {
      return roundTexPt(width);
    }
    return roundTexPt(((sourceOffset - contentStart) / contentLength) * width);
  });
}

export function simpleTexInlineTokensToLayoutItems(params: {
  readonly tokens: ReturnType<typeof simpleTexInlineNodesToTokens>;
  readonly atPt: number;
  readonly metricProvider: TexMetricProvider;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly textFontProfile: TexTextFontProfile;
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
        raise: token.ruleRaise ?? 0,
        width: token.ruleWidth ?? 0,
        height: token.ruleHeight ?? 0,
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

    if (token.kind === "raisebox") {
      const box = texRaiseBoxFromInlineNodes({
        source: token.text,
        content: token.content ?? "",
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        contentStart: token.contentStart ?? token.sourceStart,
        contentEnd: token.contentEnd ?? token.sourceEnd,
        children: token.children ?? [],
        lift: token.lift ?? 0,
        boxHeight: token.boxHeight,
        boxDepth: token.boxDepth,
        fontState: token.fontState,
        atPt: params.atPt,
        metricProvider: params.metricProvider,
        spaceGlueProfile: params.spaceGlueProfile,
        mathBoxProvider: params.mathBoxProvider,
        textFontProfile: params.textFontProfile,
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
): number {
  if (left.font.id !== right.font.id || left.text.length === 0 || right.text.length === 0) {
    return 0;
  }
  const leftChar = left.text.at(-1) ?? "";
  const rightChar = right.text[0] ?? "";
  if (!leftChar || !rightChar) {
    return 0;
  }
  const shapedPair = metricProvider.shapeText(`${leftChar}${rightChar}`, left.font);
  if (!shapedPair.items.some((item) => item.kind === "kern")) {
    return 0;
  }
  const separateWidth =
    metricProvider.shapeText(leftChar, left.font).width +
    metricProvider.shapeText(rightChar, right.font).width;
  return roundTexPt(shapedPair.width - separateWidth);
}

export function texMBoxHListFromLayoutItems(params: {
  readonly items: readonly TexLayoutInlineItem[];
  readonly sourceSpan: { readonly start: number; readonly end: number };
  readonly metricProvider: TexMetricProvider;
}): TexMathHList | null {
  const items: TexMathHListItem[] = [];
  let cursor = 0;
  let height = 0;
  let depth = 0;

  for (const item of params.items) {
    if (item.kind === "text") {
      const shaped = params.metricProvider.shapeText(item.text, item.font, {
        sourceStart: item.sourceStart,
      });
      for (const shapedItem of shaped.items) {
        const layoutItem = texTextShapedItemToMBoxItem(shapedItem, item.font, cursor);
        items.push(layoutItem);
        cursor = roundTexPt(cursor + layoutItem.width);
        if (layoutItem.kind === "glyph") {
          height = Math.max(height, layoutItem.height);
          depth = Math.max(depth, layoutItem.depth);
        }
      }
      const correction = item.italicCorrectionAfter
        ? texMBoxTrailingItalicCorrectionWidth(shaped.items)
        : 0;
      if (item.italicCorrectionAfter) {
        const kern = texMBoxKernItem(cursor, correction, item.sourceEnd, item.sourceEnd);
        items.push(kern);
        cursor = roundTexPt(cursor + kern.width);
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
      cursor = roundTexPt(cursor + layoutGlue.width);
      continue;
    }

    if (item.kind === "kern") {
      const kern = texMBoxKernItem(cursor, item.width, item.sourceStart, item.sourceEnd);
      items.push(kern);
      cursor = roundTexPt(cursor + kern.width);
      continue;
    }

    if (item.kind === "math" || item.kind === "text-box") {
      const child = texMBoxChildHListItem(item.box, cursor, item.sourceStart, item.sourceEnd);
      if (!child) {
        return null;
      }
      items.push(child);
      cursor = roundTexPt(cursor + child.width);
      height = Math.max(height, child.height);
      depth = Math.max(depth, child.depth);
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
    width: roundTexPt(cursor),
    height: roundTexPt(height),
    depth: roundTexPt(depth),
    sourceSpan: params.sourceSpan,
    items,
  };
}

export function texReboxMBoxHList(
  hlist: TexMathHList,
  params: {
    readonly boxWidth?: number;
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
      x: roundTexPt(item.x + offset),
    })),
  };
}

function texMBoxAlignmentOffset(
  naturalWidth: number,
  targetWidth: number,
  alignment: SimpleTexTextBoxAlignment
): number {
  switch (alignment) {
    case "left":
    case "natural":
    case "stretch":
      return 0;
    case "right":
      return roundTexPt(targetWidth - naturalWidth);
    case "center":
      return roundTexPt((targetWidth - naturalWidth) / 2);
  }
}

function texSetMBoxHListWidth(
  hlist: TexMathHList,
  targetWidth: number
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
  let offset = 0;
  const items = hlist.items.map((item): TexMathHListItem => {
    const shiftedX = roundTexPt(item.x + offset);
    if (item.kind !== "glue") {
      return {
        ...item,
        x: shiftedX,
      };
    }
    const adjustment = (sign === "stretch" ? item.stretch : -item.shrink) * ratio;
    const adjustedWidth = roundTexPt(item.width + adjustment);
    offset = roundTexPt(offset + adjustedWidth - item.width);
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
  x: number
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
    y: 0,
    width: item.width,
    height: item.height,
    depth: item.depth,
    italicCorrection: item.italicCorrection,
    sourceSpan: {
      start: item.sourceStart,
      end: item.sourceEnd,
    },
  };
}

function texMBoxKernItem(
  x: number,
  width: number,
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
  x: number,
  glue: { readonly width: number; readonly stretch: number; readonly shrink: number },
  sourceStart: number,
  sourceEnd: number
): TexMathGlueLayoutItem {
  return {
    kind: "glue",
    x,
    width: roundTexPt(glue.width),
    mu: 0,
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
): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "glyph") {
      return item.italicCorrection;
    }
  }
  return 0;
}

function texMBoxChildHListItem(
  box: TexMathBox,
  x: number,
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
    y: 0,
    width: roundTexPt(box.width),
    height: roundTexPt(box.height),
    depth: roundTexPt(box.depth),
    sourceSpan: {
      start: sourceStart,
      end: sourceEnd,
    },
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
