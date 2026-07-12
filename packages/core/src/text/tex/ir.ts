import type { ParagraphAlignment } from "../knuth-plass/alignment.js";
import { parseLength } from "../../semantic/coords/parse-length.js";
import { parseTexDimensionText } from "./dimensions.js";
import { normalizeColor, resolveDefineColorModel, type ColorAliasResolver } from "../../semantic/style/colors.js";
import { DEFAULT_TEXT_FONT_SIZE, FONT_SIZE_COMMAND_FACTORS } from "../../semantic/style/constants.js";

export type TexParagraphAlignment = ParagraphAlignment;
export type TexAlignmentProfile = "latex-declaration" | "latex-quote";
export type TexSpaceGlueProfile = "font" | "tikz-fixed";
export type TexFontFamily = "roman" | "sans" | "typewriter" | "normal";
export type TexFontSeries = "medium" | "bold";
export type TexFontShape = "upright" | "italic" | "slanted" | "small-caps";
export const SIMPLE_TEX_TEXT_BOX_COMMAND_NAMES = [
  "framebox",
  "fcolorbox",
  "colorbox",
  "makebox",
  "underline",
  "mbox",
  "fbox",
  "llap",
  "rlap",
] as const;
export type SimpleTexTextBoxCommandName = (typeof SIMPLE_TEX_TEXT_BOX_COMMAND_NAMES)[number];
export type SimpleTexTextBoxAlignment = "natural" | "left" | "center" | "right" | "stretch";
export const SIMPLE_TEX_DIMENSION_BOX_COMMAND_NAMES = [
  "hphantom",
  "vphantom",
  "phantom",
  "smash",
] as const;
export type SimpleTexDimensionBoxCommandName = (typeof SIMPLE_TEX_DIMENSION_BOX_COMMAND_NAMES)[number];
const TEX_GRAPHICS_BARE_NUMBER_UNIT_PT = 72.27 / 72;
export const SIMPLE_TEX_FONT_COMMAND_NAMES = [
  "textnormal",
  "textit",
  "textbf",
  "textmd",
  "textsl",
  "texttt",
  "textup",
  "textrm",
  "textsf",
  "textsc",
  "emph",
] as const;
export type SimpleTexFontCommandName = (typeof SIMPLE_TEX_FONT_COMMAND_NAMES)[number];
export const SIMPLE_TEX_FONT_DECLARATION_NAMES = [
  "normalfont",
  "bfseries",
  "mdseries",
  "rmfamily",
  "sffamily",
  "ttfamily",
  "itshape",
  "slshape",
  "upshape",
  "scshape",
  "it",
  "bf",
  "rm",
  "sf",
  "sl",
  "sc",
  "tt",
  "em",
] as const;
export type SimpleTexFontDeclarationName = (typeof SIMPLE_TEX_FONT_DECLARATION_NAMES)[number];
export type SimpleTexQuoteEnvironmentName = "quote" | "quotation";
export type SimpleTexTrivlistEnvironmentName = "center" | "flushleft" | "flushright";
export type SimpleTexEnvironmentName =
  | SimpleTexQuoteEnvironmentName
  | SimpleTexTrivlistEnvironmentName
  | "itemize"
  | "enumerate"
  | "description";
export type SimpleTexListKind = "itemize" | "enumerate" | "description";
export type SimpleTexVerticalGlueCommandName =
  | "vspace"
  | "vskip"
  | "smallskip"
  | "medskip"
  | "bigskip"
  | "vfill";
export type SimpleTexBoxCommandName = "parbox" | "minipage";
export type SimpleTexBoxAlignment = "top" | "center" | "bottom";

export type SimpleTexScopePathRole =
  | { readonly kind: "quote"; readonly depth: number }
  | {
      readonly kind: "trivlist";
      readonly envName: SimpleTexTrivlistEnvironmentName;
      readonly depth: number;
      readonly alignment: TexParagraphAlignment;
    }
  | {
      readonly kind: "list";
      readonly listKind: SimpleTexListKind;
      readonly depth: number;
      readonly labelDepth: number;
      readonly ownLeftMarginEm: number;
      readonly totalLeftMarginEm: number;
    }
  | {
      readonly kind: "list-item";
      readonly listKind: SimpleTexListKind;
      readonly depth: number;
      readonly labelDepth: number;
      readonly itemIndex: number;
    };

export interface SimpleTexFontState {
  readonly family: TexFontFamily;
  readonly series: TexFontSeries;
  readonly shape: TexFontShape;
  /** Absolute TeX point size selected by an inline declaration. */
  readonly sizePt?: number;
  /** CSS color normalized from the xcolor spelling in the source. */
  readonly color?: string;
}

interface SimpleTexSourceRange {
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

export interface SimpleTexTextNode extends SimpleTexSourceRange {
  readonly kind: "text";
  readonly text: string;
}

export interface SimpleTexSpaceNode extends SimpleTexSourceRange {
  readonly kind: "space";
  readonly text: string;
  /** TeX's active `~` space: visible glue without a line-break opportunity. */
  readonly nonBreaking?: boolean;
}

export interface SimpleTexLineBreakNode extends SimpleTexSourceRange {
  readonly kind: "line-break";
  readonly text: string;
  readonly lineLeading?: string;
  /** LaTeX `\linebreak[n]`; omitted for forced `\\` and `\newline`. */
  readonly priority?: 0 | 1 | 2 | 3 | 4;
}

export interface SimpleTexMathNode extends SimpleTexSourceRange {
  readonly kind: "math";
  readonly text: string;
  readonly delimiter: "dollar" | "paren";
  readonly content: string;
  readonly contentStart: number;
  readonly contentEnd: number;
}

export const SIMPLE_TEX_DISPLAY_MATH_DELIMITERS = [
  "bracket",
  "double-dollar",
  "equation",
  "equation-star",
  "align",
  "align-star",
  "flalign",
  "flalign-star",
  "gather",
  "gather-star",
  "multline",
  "multline-star",
] as const;
export type SimpleTexDisplayMathDelimiter = (typeof SIMPLE_TEX_DISPLAY_MATH_DELIMITERS)[number];

export interface SimpleTexDisplayMathNode extends SimpleTexSourceRange {
  readonly kind: "display-math";
  readonly text: string;
  readonly delimiter: SimpleTexDisplayMathDelimiter;
  readonly content: string;
  readonly contentStart: number;
  readonly contentEnd: number;
}

export interface SimpleTexFontCommandNode extends SimpleTexSourceRange {
  readonly kind: "font-command";
  readonly text: string;
  readonly command: SimpleTexFontCommandName;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly children: readonly SimpleTexInlineNode[];
}

export interface SimpleTexFontDeclarationNode extends SimpleTexSourceRange {
  readonly kind: "font-declaration";
  readonly text: string;
  readonly command: SimpleTexFontDeclarationName;
}

export interface SimpleTexStyleDeclarationNode extends SimpleTexSourceRange {
  readonly kind: "style-declaration";
  readonly text: string;
  readonly sizePt?: number;
  readonly color?: string;
}

export interface SimpleTexColorCommandNode extends SimpleTexSourceRange {
  readonly kind: "color-command";
  readonly text: string;
  readonly color: string;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly children: readonly SimpleTexInlineNode[];
}

export interface SimpleTexGroupNode extends SimpleTexSourceRange {
  readonly kind: "group";
  readonly text: string;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly children: readonly SimpleTexInlineNode[];
}

export interface SimpleTexMBoxNode extends SimpleTexSourceRange {
  readonly kind: "mbox";
  readonly command: SimpleTexTextBoxCommandName;
  readonly text: string;
  readonly content: string;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly children: readonly SimpleTexInlineNode[];
  readonly boxWidth?: number;
  readonly boxAlign?: SimpleTexTextBoxAlignment;
  /** Background and frame colors normalized from xcolor syntax. */
  readonly backgroundColor?: string;
  readonly frameColor?: string;
}

export interface SimpleTexRuleNode extends SimpleTexSourceRange {
  readonly kind: "rule";
  readonly text: string;
  readonly raise: number;
  readonly width: number;
  readonly height: number;
}

export interface SimpleTexIncludeGraphicsNode extends SimpleTexSourceRange {
  readonly kind: "includegraphics";
  readonly text: string;
  readonly filename: string;
  readonly filenameStart: number;
  readonly filenameEnd: number;
  readonly options: SimpleTexGraphicsOptions;
}

export interface SimpleTexGraphicsOptions {
  readonly width?: number;
  readonly height?: number;
  readonly scale?: number;
  readonly keepAspectRatio?: boolean;
  readonly trim?: SimpleTexGraphicsTrim;
  readonly viewport?: SimpleTexGraphicsViewport;
  readonly clip?: boolean;
  readonly raw: string;
}

export interface SimpleTexGraphicsTrim {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
}

export interface SimpleTexGraphicsViewport {
  readonly llx: number;
  readonly lly: number;
  readonly urx: number;
  readonly ury: number;
}

export interface SimpleTexRaiseBoxNode extends SimpleTexSourceRange {
  readonly kind: "raisebox";
  readonly text: string;
  readonly lift: number;
  /** Lift relative to the surrounding text size, used by text super/subscripts. */
  readonly relativeLiftEm?: number;
  /** Child font scale relative to the surrounding text size. */
  readonly childFontScale?: number;
  readonly boxHeight?: number;
  readonly boxDepth?: number;
  readonly content: string;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly children: readonly SimpleTexInlineNode[];
}

export interface SimpleTexDimensionBoxNode extends SimpleTexSourceRange {
  readonly kind: "dimension-box";
  readonly command: SimpleTexDimensionBoxCommandName;
  readonly text: string;
  readonly content: string;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly children: readonly SimpleTexInlineNode[];
}

export interface SimpleTexParagraphBreakNode extends SimpleTexSourceRange {
  readonly kind: "paragraph-break";
  readonly text: string;
  readonly breakKind: "control" | "blank-line";
}

export interface SimpleTexNoIndentNode extends SimpleTexSourceRange {
  readonly kind: "noindent";
  readonly text: string;
}

export interface SimpleTexAlignmentNode extends SimpleTexSourceRange {
  readonly kind: "alignment";
  readonly text: string;
  readonly alignment: TexParagraphAlignment;
  readonly alignmentProfile: TexAlignmentProfile;
}

export interface SimpleTexUnsupportedCommandNode extends SimpleTexSourceRange {
  readonly kind: "unsupported-command";
  readonly text: string;
}

export type SimpleTexLiteralReason =
  | "unsupported-command"
  | "unsupported-character"
  | "malformed-input"
  | "math-error";

export interface SimpleTexLiteralNode extends SimpleTexSourceRange {
  readonly kind: "literal";
  readonly text: string;
  readonly reason: SimpleTexLiteralReason;
  readonly detail?: string;
}

export interface SimpleTexEnvironmentBoundaryNode extends SimpleTexSourceRange {
  readonly kind: "environment-boundary";
  readonly text: string;
  readonly boundary: "begin" | "end";
  readonly name: SimpleTexEnvironmentName;
}

export interface SimpleTexItemNode extends SimpleTexSourceRange {
  readonly kind: "item";
  readonly text: string;
  readonly labelNodes?: readonly SimpleTexInlineNode[];
  readonly labelSourceStart?: number;
  readonly labelSourceEnd?: number;
}

export interface SimpleTexVerticalGlueNode extends SimpleTexSourceRange {
  readonly kind: "vertical-glue";
  readonly text: string;
  readonly command: SimpleTexVerticalGlueCommandName;
  readonly size: number;
  readonly stretch?: number;
  readonly shrink?: number;
  readonly stretchOrder?: "normal" | "fil" | "fill" | "filll";
  readonly shrinkOrder?: "normal" | "fil" | "fill" | "filll";
}

export interface SimpleTexVerticalRuleNode extends SimpleTexSourceRange {
  readonly kind: "vertical-rule";
  readonly text: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface SimpleTexPenaltyNode extends SimpleTexSourceRange {
  readonly kind: "penalty";
  readonly text: string;
  readonly penalty: number;
}

export interface SimpleTexBoxNode extends SimpleTexSourceRange {
  readonly kind: "box";
  readonly text: string;
  readonly command: SimpleTexBoxCommandName;
  readonly width: number;
  readonly height?: number;
  readonly alignment: SimpleTexBoxAlignment;
  readonly content: string;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly body: SimpleTexParagraphIr;
}

export type SimpleTexInlineNode =
  | SimpleTexTextNode
  | SimpleTexSpaceNode
  | SimpleTexLineBreakNode
  | SimpleTexMathNode
  | SimpleTexFontCommandNode
  | SimpleTexFontDeclarationNode
  | SimpleTexStyleDeclarationNode
  | SimpleTexColorCommandNode
  | SimpleTexGroupNode
  | SimpleTexMBoxNode
  | SimpleTexRuleNode
  | SimpleTexIncludeGraphicsNode
  | SimpleTexRaiseBoxNode
  | SimpleTexDimensionBoxNode
  | SimpleTexLiteralNode;

export type SimpleTexControlNode =
  | SimpleTexParagraphBreakNode
  | SimpleTexDisplayMathNode
  | SimpleTexNoIndentNode
  | SimpleTexAlignmentNode
  | SimpleTexEnvironmentBoundaryNode
  | SimpleTexItemNode
  | SimpleTexVerticalGlueNode
  | SimpleTexVerticalRuleNode
  | SimpleTexPenaltyNode
  | SimpleTexBoxNode
  | SimpleTexUnsupportedCommandNode;

export type SimpleTexNode = SimpleTexInlineNode | SimpleTexControlNode;

export const SIMPLE_TEX_INLINE_NODE_KINDS = [
  "text",
  "space",
  "line-break",
  "math",
  "font-command",
  "font-declaration",
  "style-declaration",
  "color-command",
  "group",
  "mbox",
  "rule",
  "includegraphics",
  "raisebox",
  "dimension-box",
  "literal",
] as const satisfies readonly SimpleTexInlineNode["kind"][];

export const SIMPLE_TEX_CONTROL_NODE_KINDS = [
  "paragraph-break",
  "display-math",
  "noindent",
  "alignment",
  "environment-boundary",
  "item",
  "vertical-glue",
  "vertical-rule",
  "penalty",
  "box",
  "unsupported-command",
] as const satisfies readonly SimpleTexControlNode["kind"][];

type MissingSimpleTexInlineNodeKind = Exclude<
  SimpleTexInlineNode["kind"],
  (typeof SIMPLE_TEX_INLINE_NODE_KINDS)[number]
>;
type MissingSimpleTexControlNodeKind = Exclude<
  SimpleTexControlNode["kind"],
  (typeof SIMPLE_TEX_CONTROL_NODE_KINDS)[number]
>;
const SIMPLE_TEX_NODE_KIND_REGISTRY_IS_COMPLETE: [
  MissingSimpleTexInlineNodeKind,
  MissingSimpleTexControlNodeKind,
] extends [never, never] ? true : never = true;
void SIMPLE_TEX_NODE_KIND_REGISTRY_IS_COMPLETE;

export interface SimpleTexToken {
  readonly kind: "text" | "space" | "forced-break" | "penalty" | "math" | "mbox" | "rule" | "includegraphics" | "raisebox" | "dimension-box";
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly delimiter?: "dollar" | "paren";
  readonly content?: string;
  readonly contentStart?: number;
  readonly contentEnd?: number;
  readonly children?: readonly SimpleTexInlineNode[];
  readonly command?: SimpleTexTextBoxCommandName;
  readonly dimensionCommand?: SimpleTexDimensionBoxCommandName;
  readonly boxWidth?: number;
  readonly boxAlign?: SimpleTexTextBoxAlignment;
  readonly backgroundColor?: string;
  readonly frameColor?: string;
  readonly ruleRaise?: number;
  readonly ruleWidth?: number;
  readonly ruleHeight?: number;
  readonly graphicsFilename?: string;
  readonly graphicsFilenameStart?: number;
  readonly graphicsFilenameEnd?: number;
  readonly graphicsOptions?: SimpleTexGraphicsOptions;
  readonly lift?: number;
  readonly relativeLiftEm?: number;
  readonly childFontScale?: number;
  readonly boxHeight?: number;
  readonly boxDepth?: number;
  readonly lineLeading?: string;
  readonly penalty?: number;
  readonly fontState: SimpleTexFontState;
  readonly nonBreaking?: boolean;
  readonly italicCorrectionAfter?: boolean;
  readonly literal?: SimpleTexTokenLiteralInfo;
}

export interface SimpleTexTokenLiteralInfo {
  readonly reason: SimpleTexLiteralReason;
  readonly detail?: string;
}

export interface SimpleTexParagraphBlock {
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly nodes: readonly SimpleTexInlineNode[];
  readonly noIndent: boolean;
  readonly startsAfterExplicitPar?: boolean;
  readonly firstLineIndentEm?: number;
  readonly quotationItemFirstParagraph?: boolean;
  readonly alignment?: TexParagraphAlignment;
  readonly alignmentProfile?: TexAlignmentProfile;
  readonly quoteDepth: number;
  readonly quotationDepth: number;
  readonly listContext?: SimpleTexListContext;
  readonly scopePath?: readonly SimpleTexScopePathRole[];
}

export interface SimpleTexParagraphBlockItem {
  readonly kind: "paragraph";
  readonly blockIndex: number;
  readonly block: SimpleTexParagraphBlock;
}

export interface SimpleTexVerticalGlueBlockItem extends SimpleTexSourceRange {
  readonly kind: "vertical-glue";
  readonly text: string;
  readonly command: SimpleTexVerticalGlueCommandName;
  readonly size: number;
  readonly stretch?: number;
  readonly shrink?: number;
  readonly stretchOrder?: "normal" | "fil" | "fill" | "filll";
  readonly shrinkOrder?: "normal" | "fil" | "fill" | "filll";
  readonly quoteDepth: number;
  readonly listScope?: SimpleTexListScope;
  readonly scopePath?: readonly SimpleTexScopePathRole[];
}

export interface SimpleTexVerticalRuleBlockItem extends SimpleTexSourceRange {
  readonly kind: "vertical-rule";
  readonly text: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly quoteDepth: number;
  readonly listScope?: SimpleTexListScope;
  readonly scopePath?: readonly SimpleTexScopePathRole[];
}

export interface SimpleTexPenaltyBlockItem extends SimpleTexSourceRange {
  readonly kind: "penalty";
  readonly text: string;
  readonly penalty: number;
  readonly quoteDepth: number;
  readonly listScope?: SimpleTexListScope;
  readonly scopePath?: readonly SimpleTexScopePathRole[];
}

export interface SimpleTexPlaceholderBlockItem extends SimpleTexSourceRange {
  readonly kind: "placeholder";
  readonly text: string;
  readonly reason: string;
  readonly quoteDepth: number;
  readonly listScope?: SimpleTexListScope;
  readonly scopePath?: readonly SimpleTexScopePathRole[];
}

export interface SimpleTexDisplayMathBlockItem extends SimpleTexSourceRange {
  readonly kind: "display-math";
  readonly text: string;
  readonly delimiter: SimpleTexDisplayMathDelimiter;
  readonly content: string;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly quoteDepth: number;
  readonly listScope?: SimpleTexListScope;
  readonly scopePath?: readonly SimpleTexScopePathRole[];
}

export interface SimpleTexBoxBlockItem extends SimpleTexSourceRange {
  readonly kind: "box";
  readonly text: string;
  readonly command: SimpleTexBoxCommandName;
  readonly width: number;
  readonly height?: number;
  readonly alignment: SimpleTexBoxAlignment;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly quoteDepth: number;
  readonly listScope?: SimpleTexListScope;
  readonly scopePath?: readonly SimpleTexScopePathRole[];
  readonly items: readonly SimpleTexBlockItem[];
}

export interface SimpleTexListScope {
  readonly kind: SimpleTexListKind;
  readonly depth: number;
  readonly labelDepth: number;
  readonly itemIndex: number;
  readonly ownLeftMarginEm: number;
  readonly totalLeftMarginEm: number;
}

export type SimpleTexBlockItem =
  | SimpleTexParagraphBlockItem
  | SimpleTexVerticalGlueBlockItem
  | SimpleTexVerticalRuleBlockItem
  | SimpleTexPenaltyBlockItem
  | SimpleTexDisplayMathBlockItem
  | SimpleTexBoxBlockItem
  | SimpleTexPlaceholderBlockItem;

export interface SimpleTexListContext {
  readonly kind: SimpleTexListKind;
  readonly depth: number;
  readonly labelDepth: number;
  readonly itemIndex: number;
  readonly ownLeftMarginEm: number;
  readonly totalLeftMarginEm: number;
  readonly showLabel: boolean;
  readonly label?: SimpleTexListLabel;
}

export interface SimpleTexListLabel {
  readonly nodes: readonly SimpleTexInlineNode[];
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

export interface SimpleTexParagraphSegment {
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly nodes: readonly SimpleTexInlineNode[];
  readonly noIndent: boolean;
  readonly firstLineIndentEm?: number;
  readonly quotationItemFirstParagraph?: boolean;
  readonly forcedBreakAfter?: {
    readonly sourceOffset: number;
    readonly lineLeading?: string;
  };
}

export interface SimpleTexSegmentInput {
  readonly text: string;
  readonly sourceSpan: {
    readonly start: number;
    readonly end: number;
  };
  readonly nodes: readonly SimpleTexInlineNode[];
  readonly noIndent: boolean;
  readonly startsAfterExplicitPar?: boolean;
  readonly firstLineIndentEm?: number;
  readonly quotationItemFirstParagraph?: boolean;
  readonly quoteDepth: number;
  readonly quotationDepth?: number;
  readonly scopePath?: readonly SimpleTexScopePathRole[];
}

export interface SimpleTexParagraphBlockScanResult {
  readonly blocks: readonly SimpleTexParagraphBlock[];
  readonly items: readonly SimpleTexBlockItem[];
  readonly partialFallbackSupported: boolean;
  readonly unsupportedCommand: boolean;
}

export interface SimpleTexParagraphIr {
  readonly kind: "simple-tex-paragraph";
  readonly nodes: readonly SimpleTexNode[];
  readonly blocks: readonly SimpleTexParagraphBlock[];
  readonly items: readonly SimpleTexBlockItem[];
  readonly partialFallbackSupported: boolean;
  readonly unsupportedCommand: boolean;
}

export interface SimpleTexParagraphAnalysis {
  readonly ir: SimpleTexParagraphIr | null;
  readonly fallbackReason: string | null;
}

interface SimpleTexIrOptions {
  readonly parindent?: number;
  readonly tikzTextWidthNode?: boolean;
}

const unsupportedDirectTextCharPattern = /[&_^~#%]/;
const whitespacePattern = /[ \n]+/;
const paragraphBreakPattern = /^\n(?: *\n)+/;
const lineLeadingOptionPattern =
  /^\[\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu)\s*\]/i;
const texLengthPattern =
  String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu)`;
const vskipGluePattern = new RegExp(
  String.raw`^\\vskip\s*(${texLengthPattern})(?:\s+plus\s+(${texLengthPattern}))?(?:\s+minus\s+(${texLengthPattern}))?`,
  "i"
);
export const latexArticleQuotationFirstLineIndentEm = 1.5;
const defaultSimpleTexFontState: SimpleTexFontState = {
  family: "roman",
  series: "medium",
  shape: "upright",
};

const luaLatexNormalFontState: SimpleTexFontState = {
  family: "normal",
  series: "medium",
  shape: "upright",
};
export const articleListLeftMarginEmByDepth = [2.5, 2.2, 1.87, 1.7, 1, 1] as const;

export function getSimpleTexFallbackReason(text: string, width: number): string | null {
  return analyzeSimpleTexParagraph(text, width).fallbackReason;
}

export function analyzeSimpleTexParagraph(
  text: string,
  width: number,
  resolveColorAlias?: ColorAliasResolver
): SimpleTexParagraphAnalysis {
  if (!Number.isFinite(width) || width <= 0) {
    return {
      ir: null,
      fallbackReason: "Paragraph width must be positive.",
    };
  }
  const ir = buildSimpleTexParagraphIr(text, resolveColorAlias);
  if (ir.unsupportedCommand) {
    return {
      ir,
      fallbackReason: "Paragraph contains TeX syntax that is not supported by the simple text path.",
    };
  }
  for (let index = 0; index < text.length; index++) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint < 0x20 && codePoint !== 0x0a) {
      return {
        ir,
        fallbackReason: `Paragraph contains unsupported OT1 character U+${codePoint.toString(16).toUpperCase()}.`,
      };
    }
  }
  return { ir, fallbackReason: null };
}

export function parseSimpleTexParagraphIr(
  text: string,
  resolveColorAlias?: ColorAliasResolver
): SimpleTexParagraphIr {
  return buildSimpleTexParagraphIr(text, resolveColorAlias);
}

export function parseSimpleTexInlineNodes(
  text: string,
  sourceOffset = 0
): { readonly nodes: readonly SimpleTexInlineNode[]; readonly unsupportedCommand: boolean } {
  const scan = scanSimpleTexIrNodes(text, sourceOffset);
  return {
    nodes: scan.nodes.filter(isSimpleTexInlineNode),
    unsupportedCommand: scan.unsupportedCommand || !scan.nodes.every(isSimpleTexInlineNode),
  };
}

function buildSimpleTexParagraphIr(
  text: string,
  resolveColorAlias?: ColorAliasResolver
): SimpleTexParagraphIr {
  return buildSimpleTexParagraphIrForRange(text, 0, text.length, 0, resolveColorAlias);
}

function buildSimpleTexParagraphIrForRange(
  text: string,
  start: number,
  end: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): SimpleTexParagraphIr {
  const nodeScan = scanSimpleTexIrNodes(
    text.slice(start, end),
    sourceOffset + start,
    resolveColorAlias
  );
  const blockScan = buildSimpleTexParagraphBlocksFromNodes(
    text,
    nodeScan.nodes,
    sourceOffset,
    sourceOffset + end
  );
  return {
    kind: "simple-tex-paragraph",
    nodes: nodeScan.nodes,
    blocks: blockScan.blocks,
    items: blockScan.items,
    partialFallbackSupported:
      blockScan.partialFallbackSupported &&
      simpleTexBlockItemsContainPlaceholder(blockScan.items),
    unsupportedCommand: nodeScan.unsupportedCommand || blockScan.unsupportedCommand,
  };
}

function scanSimpleTexIrNodes(
  text: string,
  sourceOffset = 0,
  resolveColorAlias?: ColorAliasResolver
): { nodes: readonly SimpleTexNode[]; unsupportedCommand: boolean } {
  const nodes: SimpleTexNode[] = [];
  let unsupportedCommand = false;
  let index = 0;

  while (index < text.length) {
    const sourceStart = sourceOffset + index;
    const char = text[index];

    const displayMath = scanSimpleTexDisplayMath(text, index);
    if (displayMath) {
      nodes.push({
        kind: "display-math",
        text: text.slice(index, displayMath.end),
        delimiter: displayMath.delimiter,
        content: text.slice(displayMath.contentStart, displayMath.contentEnd),
        contentStart: sourceOffset + displayMath.contentStart,
        contentEnd: sourceOffset + displayMath.contentEnd,
        sourceStart,
        sourceEnd: sourceOffset + displayMath.end,
      });
      index = displayMath.end;
      continue;
    }

    const math = scanSimpleTexMath(text, index);
    if (math) {
      nodes.push({
        kind: "math",
        text: text.slice(index, math.end),
        delimiter: math.delimiter,
        content: text.slice(math.contentStart, math.contentEnd),
        contentStart: sourceOffset + math.contentStart,
        contentEnd: sourceOffset + math.contentEnd,
        sourceStart,
        sourceEnd: sourceOffset + math.end,
      });
      index = math.end;
      continue;
    }

    if (char === "\\") {
      const lineBreak = scanSimpleTexLineBreak(text, index);
      if (lineBreak) {
        nodes.push({
          kind: "line-break",
          text: text.slice(index, lineBreak.end),
          sourceStart,
          sourceEnd: sourceOffset + lineBreak.end,
          lineLeading: lineBreak.lineLeading,
          priority: lineBreak.priority,
        });
        index = lineBreak.end;
        continue;
      }

      const proseControl = scanSimpleTexProseControl(text, index, sourceOffset, resolveColorAlias);
      if (proseControl) {
        nodes.push(proseControl.node);
        unsupportedCommand ||= proseControl.unsupportedCommand;
        index = proseControl.end;
        continue;
      }

      const paragraphCommand = scanSimpleTexParagraphCommand(text, index);
      const environmentBoundary = scanSimpleTexEnvironmentBoundary(text, index);
      const itemCommand = scanSimpleTexItemCommand(text, index, sourceOffset, resolveColorAlias);
      const verticalGlue = scanSimpleTexVerticalGlueCommand(text, index, sourceOffset);
      const verticalRule = scanSimpleTexVerticalRuleCommand(text, index, sourceOffset);
      const penalty = scanSimpleTexPenaltyCommand(text, index, sourceOffset);
      const boxCommand = scanSimpleTexBoxCommand(text, index, sourceOffset, resolveColorAlias);
      const boxEnvironment = scanSimpleTexBoxEnvironment(text, index, sourceOffset, resolveColorAlias);
      const colorBoxCommand = scanSimpleTexColorBoxCommand(text, index, sourceOffset, resolveColorAlias);
      const mboxCommand = scanSimpleTexMBoxCommand(text, index, sourceOffset, resolveColorAlias);
      const ruleCommand = scanSimpleTexRuleCommand(text, index, sourceOffset);
      const includeGraphicsCommand = scanSimpleTexIncludeGraphicsCommand(text, index, sourceOffset);
      const raiseBoxCommand = scanSimpleTexRaiseBoxCommand(text, index, sourceOffset, resolveColorAlias);
      const dimensionBoxCommand = scanSimpleTexDimensionBoxCommand(text, index, sourceOffset, resolveColorAlias);
      const fontCommand = scanSimpleTexFontCommand(text, index, sourceOffset, resolveColorAlias);
      const fontDeclaration = scanSimpleTexFontDeclaration(text, index, sourceOffset);
      const styleDeclaration = scanSimpleTexStyleDeclaration(text, index, sourceOffset, resolveColorAlias);
      const colorCommand = scanSimpleTexColorCommand(text, index, sourceOffset, resolveColorAlias);
      const accentCommand = scanSimpleTexAccentCommand(text, index, sourceOffset);
      if (boxEnvironment) {
        nodes.push(boxEnvironment.node);
        unsupportedCommand ||= boxEnvironment.unsupportedCommand;
        index = boxEnvironment.end;
        continue;
      }
      if (environmentBoundary) {
        nodes.push({
          kind: "environment-boundary",
          text: text.slice(index, environmentBoundary.end),
          boundary: environmentBoundary.boundary,
          name: environmentBoundary.name,
          sourceStart,
          sourceEnd: sourceOffset + environmentBoundary.end,
        });
        index = environmentBoundary.end;
        continue;
      }
      if (itemCommand) {
        nodes.push(itemCommand.node);
        unsupportedCommand ||= itemCommand.unsupportedCommand;
        index = itemCommand.end;
        continue;
      }
      if (verticalGlue) {
        nodes.push(verticalGlue.node);
        unsupportedCommand ||= verticalGlue.unsupportedCommand;
        index = verticalGlue.end;
        continue;
      }
      if (verticalRule) {
        nodes.push(verticalRule.node);
        unsupportedCommand ||= verticalRule.unsupportedCommand;
        index = verticalRule.end;
        continue;
      }
      if (penalty) {
        nodes.push(penalty.node);
        unsupportedCommand ||= penalty.unsupportedCommand;
        index = penalty.end;
        continue;
      }
      if (boxCommand) {
        nodes.push(boxCommand.node);
        unsupportedCommand ||= boxCommand.unsupportedCommand;
        index = boxCommand.end;
        continue;
      }
      if (colorBoxCommand) {
        nodes.push(colorBoxCommand.node);
        unsupportedCommand ||= colorBoxCommand.unsupportedCommand;
        index = colorBoxCommand.end;
        continue;
      }
      if (mboxCommand) {
        nodes.push(mboxCommand.node);
        unsupportedCommand ||= mboxCommand.unsupportedCommand;
        index = mboxCommand.end;
        continue;
      }
      if (ruleCommand) {
        nodes.push(ruleCommand.node);
        unsupportedCommand ||= ruleCommand.unsupportedCommand;
        index = ruleCommand.end;
        continue;
      }
      if (includeGraphicsCommand) {
        nodes.push(includeGraphicsCommand.node);
        index = includeGraphicsCommand.end;
        continue;
      }
      if (raiseBoxCommand) {
        nodes.push(raiseBoxCommand.node);
        unsupportedCommand ||= raiseBoxCommand.unsupportedCommand;
        index = raiseBoxCommand.end;
        continue;
      }
      if (dimensionBoxCommand) {
        nodes.push(dimensionBoxCommand.node);
        unsupportedCommand ||= dimensionBoxCommand.unsupportedCommand;
        index = dimensionBoxCommand.end;
        continue;
      }

      if (paragraphCommand?.kind === "par") {
        nodes.push({
          kind: "paragraph-break",
          text: text.slice(index, paragraphCommand.end),
          breakKind: "control",
          sourceStart,
          sourceEnd: sourceOffset + paragraphCommand.end,
        });
        index = paragraphCommand.end;
        continue;
      }
      if (paragraphCommand?.kind === "noindent") {
        nodes.push({
          kind: "noindent",
          text: text.slice(index, paragraphCommand.end),
          sourceStart,
          sourceEnd: sourceOffset + paragraphCommand.end,
        });
        index = paragraphCommand.end;
        continue;
      }
      if (paragraphCommand?.kind === "alignment") {
        nodes.push({
          kind: "alignment",
          text: text.slice(index, paragraphCommand.end),
          alignment: paragraphCommand.alignment,
          alignmentProfile: "latex-declaration",
          sourceStart,
          sourceEnd: sourceOffset + paragraphCommand.end,
        });
        index = paragraphCommand.end;
        continue;
      }
      if (fontCommand) {
        nodes.push(fontCommand.node);
        unsupportedCommand ||= fontCommand.unsupportedCommand;
        index = fontCommand.end;
        continue;
      }
      if (fontDeclaration) {
        nodes.push(fontDeclaration.node);
        index = skipSimpleTexControlWordSpaces(text, fontDeclaration.end);
        continue;
      }
      if (styleDeclaration) {
        nodes.push(styleDeclaration.node);
        index = skipSimpleTexControlWordSpaces(text, styleDeclaration.end);
        continue;
      }
      if (colorCommand) {
        nodes.push(colorCommand.node);
        unsupportedCommand ||= colorCommand.unsupportedCommand;
        index = colorCommand.end;
        continue;
      }
      if (accentCommand) {
        nodes.push(accentCommand.node);
        index = accentCommand.end;
        continue;
      }

      const end = scanUnsupportedControlSequenceEnd(text, index);
      const commandNameMatch = /^\\[A-Za-z]+/.exec(text.slice(index));
      nodes.push({
        kind: "literal",
        text: text.slice(index, end),
        reason: "unsupported-command",
        detail: commandNameMatch?.[0] ?? text.slice(index, Math.min(end, index + 2)),
        sourceStart,
        sourceEnd: sourceOffset + end,
      });
      index = end;
      continue;
    }

    if (char === "{") {
      const group = scanSimpleTexGroup(text, index, sourceOffset, resolveColorAlias);
      if (group) {
        nodes.push(group.node);
        unsupportedCommand ||= group.unsupportedCommand;
        index = group.end;
        continue;
      }
      nodes.push({
        kind: "literal",
        text: char,
        reason: "malformed-input",
        sourceStart,
        sourceEnd: sourceStart + 1,
      });
      index += 1;
      continue;
    }

    if (char === "}") {
      nodes.push({
        kind: "literal",
        text: char,
        reason: "malformed-input",
        sourceStart,
        sourceEnd: sourceStart + 1,
      });
      index += 1;
      continue;
    }

    if (char === "$") {
      nodes.push({
        kind: "literal",
        text: char,
        reason: "malformed-input",
        sourceStart,
        sourceEnd: sourceStart + 1,
      });
      index += 1;
      continue;
    }

    const proseConvention = scanSimpleTexProseConvention(text, index, sourceOffset);
    if (proseConvention) {
      nodes.push(proseConvention.node);
      index = proseConvention.end;
      continue;
    }

    if (char === "\n") {
      const match = paragraphBreakPattern.exec(text.slice(index));
      if (match) {
        const full = match[0] ?? "";
        nodes.push({
          kind: "paragraph-break",
          text: full,
          breakKind: "blank-line",
          sourceStart,
          sourceEnd: sourceOffset + index + full.length,
        });
        index += full.length;
        continue;
      }
    }

    if (char === " " || char === "\n") {
      const start = index;
      while (index < text.length && (text[index] === " " || text[index] === "\n")) {
        index += 1;
      }
      nodes.push({
        kind: "space",
        text: text.slice(start, index),
        sourceStart: sourceOffset + start,
        sourceEnd: sourceOffset + index,
      });
      continue;
    }

    if (unsupportedDirectTextCharPattern.test(char ?? "")) {
      nodes.push({
        kind: "literal",
        text: char ?? "",
        reason: "unsupported-character",
        sourceStart,
        sourceEnd: sourceStart + 1,
      });
      index += 1;
      continue;
    }

    const start = index;
    while (
      index < text.length &&
      text[index] !== "\\" &&
      text[index] !== "{" &&
      text[index] !== "}" &&
      text[index] !== "$" &&
      scanSimpleTexProseConvention(text, index, sourceOffset) === null &&
      !unsupportedDirectTextCharPattern.test(text[index] ?? "") &&
      !whitespacePattern.test(text[index] ?? "")
    ) {
      index += 1;
    }
    nodes.push({
      kind: "text",
      text: text.slice(start, index),
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + index,
    });
  }

  return { nodes, unsupportedCommand };
}

function scanSimpleTexColorBoxCommand(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): {
  readonly node: SimpleTexMBoxNode;
  readonly end: number;
  readonly unsupportedCommand: boolean;
} | null {
  const colorboxEnd = scanSimpleTexControlWord(text, start, "colorbox");
  const fcolorboxEnd = scanSimpleTexControlWord(text, start, "fcolorbox");
  const command = colorboxEnd !== null
    ? { name: "colorbox" as const, end: colorboxEnd }
    : fcolorboxEnd !== null
      ? { name: "fcolorbox" as const, end: fcolorboxEnd }
      : null;
  if (!command) return null;

  let cursor = skipSimpleTexControlWordSpaces(text, command.end);
  const scanColorArgument = (): { readonly color: string } | null => {
    let model: string | undefined;
    if (text[cursor] === "[") {
      const modelArgument = scanSimpleTexOptionalBracketArgument(text, cursor);
      if (!modelArgument) return null;
      model = modelArgument.content.trim();
      cursor = skipSimpleTexControlWordSpaces(text, modelArgument.end);
    }
    const colorArgument = scanSimpleTexRequiredGroupArgument(text, cursor);
    if (!colorArgument) return null;
    const color = normalizeSimpleTexColor(colorArgument.content, model, resolveColorAlias);
    if (!color) return null;
    cursor = skipSimpleTexControlWordSpaces(text, colorArgument.end);
    return { color };
  };

  const firstColor = scanColorArgument();
  if (!firstColor) return null;
  const secondColor = command.name === "fcolorbox" ? scanColorArgument() : null;
  if (command.name === "fcolorbox" && !secondColor) return null;
  const contentArgument = scanSimpleTexRequiredGroupArgument(text, cursor);
  if (!contentArgument) return null;
  const childScan = scanSimpleTexIrNodes(
    contentArgument.content,
    sourceOffset + contentArgument.contentStart,
    resolveColorAlias
  );
  const childrenAreInline = childScan.nodes.every(isSimpleTexInlineNode);
  const hasForcedBreak = childScan.nodes.some((node) => node.kind === "line-break");
  return {
    node: {
      kind: "mbox",
      command: command.name,
      text: text.slice(start, contentArgument.end),
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + contentArgument.end,
      content: contentArgument.content,
      contentStart: sourceOffset + contentArgument.contentStart,
      contentEnd: sourceOffset + contentArgument.contentEnd,
      children: childrenAreInline ? childScan.nodes.filter(isSimpleTexInlineNode) : [],
      backgroundColor: command.name === "colorbox" ? firstColor.color : secondColor?.color,
      frameColor: command.name === "fcolorbox" ? firstColor.color : undefined,
    },
    end: contentArgument.end,
    unsupportedCommand: childScan.unsupportedCommand || !childrenAreInline || hasForcedBreak,
  };
}

function scanSimpleTexProseConvention(
  text: string,
  start: number,
  sourceOffset: number
): { readonly node: SimpleTexTextNode | SimpleTexSpaceNode; readonly end: number } | null {
  const sourceStart = sourceOffset + start;
  if (text[start] === "~") {
    return {
      node: {
        kind: "space",
        text: "~",
        nonBreaking: true,
        sourceStart,
        sourceEnd: sourceStart + 1,
      },
      end: start + 1,
    };
  }
  const replacements: readonly [string, string][] = [
    ["---", "\u2014"],
    ["--", "\u2013"],
    ["``", "\u201c"],
    ["''", "\u201d"],
    ["`", "\u2018"],
    ["'", "\u2019"],
  ];
  for (const [source, replacement] of replacements) {
    if (text.startsWith(source, start)) {
      return {
        node: {
          kind: "text",
          text: replacement,
          sourceStart,
          sourceEnd: sourceStart + source.length,
        },
        end: start + source.length,
      };
    }
  }
  return null;
}

function scanSimpleTexProseControl(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): {
  readonly node: SimpleTexInlineNode;
  readonly end: number;
  readonly unsupportedCommand: boolean;
} | null {
  const sourceStart = sourceOffset + start;
  const escaped = text[start + 1];
  const escapedReplacements: Readonly<Record<string, string>> = {
    "%": "%",
    "&": "&",
    "_": "_",
    "#": "#",
    "$": "$",
    "{": "{",
    "}": "}",
  };
  const escapedReplacement = escaped === undefined ? undefined : escapedReplacements[escaped];
  if (escapedReplacement !== undefined) {
    return {
      node: {
        kind: "text",
        text: escapedReplacement,
        sourceStart,
        sourceEnd: sourceStart + 2,
      },
      end: start + 2,
      unsupportedCommand: false,
    };
  }
  if (escaped === " ") {
    return {
      node: {
        kind: "space",
        text: text.slice(start, start + 2),
        sourceStart,
        sourceEnd: sourceStart + 2,
      },
      end: start + 2,
      unsupportedCommand: false,
    };
  }

  for (const [name, replacement] of [
    ["textbackslash", "\\"],
    ["textellipsis", "\u2026"],
    ["ldots", "\u2026"],
  ] as const) {
    const commandEnd = scanSimpleTexControlWord(text, start, name);
    if (commandEnd !== null) {
      const end = skipSimpleTexControlWordSpaces(text, commandEnd);
      return {
        node: {
          kind: "text",
          text: replacement,
          sourceStart,
          // TeX consumes one delimiter space after a control word. Attach
          // that invisible source to the replacement glyph for caret coverage.
          sourceEnd: sourceOffset + end,
        },
        end,
        unsupportedCommand: false,
      };
    }
  }

  const ensureMathEnd = scanSimpleTexControlWord(text, start, "ensuremath");
  if (ensureMathEnd !== null) {
    const groupStart = skipSimpleTexControlWordSpaces(text, ensureMathEnd);
    const groupEnd = text[groupStart] === "{" ? findBalancedSimpleTexGroupEnd(text, groupStart) : null;
    if (groupEnd === null) {
      return null;
    }
    return {
      node: {
        kind: "math",
        text: text.slice(start, groupEnd),
        delimiter: "paren",
        content: text.slice(groupStart + 1, groupEnd - 1),
        sourceStart,
        sourceEnd: sourceOffset + groupEnd,
        contentStart: sourceOffset + groupStart + 1,
        contentEnd: sourceOffset + groupEnd - 1,
      },
      end: groupEnd,
      unsupportedCommand: false,
    };
  }

  for (const [name, relativeLiftEm] of [
    ["textsuperscript", 0.45],
    ["textsubscript", -0.2],
  ] as const) {
    const commandEnd = scanSimpleTexControlWord(text, start, name);
    if (commandEnd === null) {
      continue;
    }
    const groupStart = skipSimpleTexControlWordSpaces(text, commandEnd);
    const groupEnd = text[groupStart] === "{" ? findBalancedSimpleTexGroupEnd(text, groupStart) : null;
    if (groupEnd === null) {
      return null;
    }
    const contentStart = groupStart + 1;
    const contentEnd = groupEnd - 1;
    const childScan = scanSimpleTexIrNodes(
      text.slice(contentStart, contentEnd),
      sourceOffset + contentStart,
      resolveColorAlias
    );
    const childrenAreInline = childScan.nodes.every(isSimpleTexInlineNode);
    const hasForcedBreak = childScan.nodes.some((node) => node.kind === "line-break");
    return {
      node: {
        kind: "raisebox",
        text: text.slice(start, groupEnd),
        lift: 0,
        relativeLiftEm,
        childFontScale: 0.7,
        sourceStart,
        sourceEnd: sourceOffset + groupEnd,
        content: text.slice(contentStart, contentEnd),
        contentStart: sourceOffset + contentStart,
        contentEnd: sourceOffset + contentEnd,
        children: childrenAreInline ? childScan.nodes.filter(isSimpleTexInlineNode) : [],
      },
      end: groupEnd,
      unsupportedCommand: childScan.unsupportedCommand || !childrenAreInline || hasForcedBreak,
    };
  }
  return null;
}

function scanSimpleTexDisplayMath(
  text: string,
  start: number
): {
  readonly delimiter: SimpleTexDisplayMathDelimiter;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly end: number;
} | null {
  if (
    text[start] === "\\" &&
    text[start + 1] === "[" &&
    !isEscapedSimpleTexChar(text, start)
  ) {
    let index = start + 2;
    while (index < text.length) {
      if (
        text[index] === "\\" &&
        text[index + 1] === "]" &&
        !isEscapedSimpleTexChar(text, index)
      ) {
        return {
          delimiter: "bracket",
          contentStart: start + 2,
          contentEnd: index,
          end: index + 2,
        };
      }
      index += 1;
    }
    return null;
  }

  if (
    text[start] === "$" &&
    text[start + 1] === "$" &&
    !isEscapedSimpleTexChar(text, start)
  ) {
    let index = start + 2;
    while (index < text.length - 1) {
      if (
        text[index] === "$" &&
        text[index + 1] === "$" &&
        !isEscapedSimpleTexChar(text, index)
      ) {
        return {
          delimiter: "double-dollar",
          contentStart: start + 2,
          contentEnd: index,
          end: index + 2,
        };
      }
      index += 1;
    }
  }

  const equationStarBegin = String.raw`\begin{equation*}`;
  if (text.startsWith(equationStarBegin, start) && !isEscapedSimpleTexChar(text, start)) {
    const equationStarEnd = String.raw`\end{equation*}`;
    const contentStart = start + equationStarBegin.length;
    const contentEnd = text.indexOf(equationStarEnd, contentStart);
    if (contentEnd >= 0) {
      return {
        delimiter: "equation-star",
        contentStart,
        contentEnd,
        end: contentEnd + equationStarEnd.length,
      };
    }
  }

  const equationBegin = String.raw`\begin{equation}`;
  if (text.startsWith(equationBegin, start) && !isEscapedSimpleTexChar(text, start)) {
    const equationEnd = String.raw`\end{equation}`;
    const contentStart = start + equationBegin.length;
    const contentEnd = text.indexOf(equationEnd, contentStart);
    if (contentEnd >= 0) {
      return {
        delimiter: "equation",
        contentStart,
        contentEnd,
        end: contentEnd + equationEnd.length,
      };
    }
  }

  const alignStarBegin = String.raw`\begin{align*}`;
  if (text.startsWith(alignStarBegin, start) && !isEscapedSimpleTexChar(text, start)) {
    const alignStarEnd = String.raw`\end{align*}`;
    const contentStart = start + alignStarBegin.length;
    const contentEnd = text.indexOf(alignStarEnd, contentStart);
    if (contentEnd >= 0) {
      return {
        delimiter: "align-star",
        contentStart,
        contentEnd,
        end: contentEnd + alignStarEnd.length,
      };
    }
  }

  const alignBegin = String.raw`\begin{align}`;
  if (text.startsWith(alignBegin, start) && !isEscapedSimpleTexChar(text, start)) {
    const alignEnd = String.raw`\end{align}`;
    const contentStart = start + alignBegin.length;
    const contentEnd = text.indexOf(alignEnd, contentStart);
    if (contentEnd >= 0) {
      return {
        delimiter: "align",
        contentStart,
        contentEnd,
        end: contentEnd + alignEnd.length,
      };
    }
  }

  const flalignStarBegin = String.raw`\begin{flalign*}`;
  if (text.startsWith(flalignStarBegin, start) && !isEscapedSimpleTexChar(text, start)) {
    const flalignStarEnd = String.raw`\end{flalign*}`;
    const contentStart = start + flalignStarBegin.length;
    const contentEnd = text.indexOf(flalignStarEnd, contentStart);
    if (contentEnd >= 0) {
      return {
        delimiter: "flalign-star",
        contentStart,
        contentEnd,
        end: contentEnd + flalignStarEnd.length,
      };
    }
  }

  const flalignBegin = String.raw`\begin{flalign}`;
  if (text.startsWith(flalignBegin, start) && !isEscapedSimpleTexChar(text, start)) {
    const flalignEnd = String.raw`\end{flalign}`;
    const contentStart = start + flalignBegin.length;
    const contentEnd = text.indexOf(flalignEnd, contentStart);
    if (contentEnd >= 0) {
      return {
        delimiter: "flalign",
        contentStart,
        contentEnd,
        end: contentEnd + flalignEnd.length,
      };
    }
  }

  const gatherStarBegin = String.raw`\begin{gather*}`;
  if (text.startsWith(gatherStarBegin, start) && !isEscapedSimpleTexChar(text, start)) {
    const gatherStarEnd = String.raw`\end{gather*}`;
    const contentStart = start + gatherStarBegin.length;
    const contentEnd = text.indexOf(gatherStarEnd, contentStart);
    if (contentEnd >= 0) {
      return {
        delimiter: "gather-star",
        contentStart,
        contentEnd,
        end: contentEnd + gatherStarEnd.length,
      };
    }
  }

  const gatherBegin = String.raw`\begin{gather}`;
  if (text.startsWith(gatherBegin, start) && !isEscapedSimpleTexChar(text, start)) {
    const gatherEnd = String.raw`\end{gather}`;
    const contentStart = start + gatherBegin.length;
    const contentEnd = text.indexOf(gatherEnd, contentStart);
    if (contentEnd >= 0) {
      return {
        delimiter: "gather",
        contentStart,
        contentEnd,
        end: contentEnd + gatherEnd.length,
      };
    }
  }

  const multlineStarBegin = String.raw`\begin{multline*}`;
  if (text.startsWith(multlineStarBegin, start) && !isEscapedSimpleTexChar(text, start)) {
    const multlineStarEnd = String.raw`\end{multline*}`;
    const contentStart = start + multlineStarBegin.length;
    const contentEnd = text.indexOf(multlineStarEnd, contentStart);
    if (contentEnd >= 0) {
      return {
        delimiter: "multline-star",
        contentStart,
        contentEnd,
        end: contentEnd + multlineStarEnd.length,
      };
    }
  }

  const multlineBegin = String.raw`\begin{multline}`;
  if (text.startsWith(multlineBegin, start) && !isEscapedSimpleTexChar(text, start)) {
    const multlineEnd = String.raw`\end{multline}`;
    const contentStart = start + multlineBegin.length;
    const contentEnd = text.indexOf(multlineEnd, contentStart);
    if (contentEnd >= 0) {
      return {
        delimiter: "multline",
        contentStart,
        contentEnd,
        end: contentEnd + multlineEnd.length,
      };
    }
  }

  return null;
}

function scanSimpleTexMath(
  text: string,
  start: number
): {
  readonly delimiter: "dollar" | "paren";
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly end: number;
} | null {
  if (text[start] === "$" && text[start + 1] !== "$" && !isEscapedSimpleTexChar(text, start)) {
    let index = start + 1;
    while (index < text.length) {
      if (
        text[index] === "$" &&
        text[index + 1] !== "$" &&
        !isEscapedSimpleTexChar(text, index)
      ) {
        return {
          delimiter: "dollar",
          contentStart: start + 1,
          contentEnd: index,
          end: index + 1,
        };
      }
      index += 1;
    }
    return null;
  }

  if (
    text[start] === "\\" &&
    text[start + 1] === "(" &&
    !isEscapedSimpleTexChar(text, start)
  ) {
    let index = start + 2;
    while (index < text.length) {
      if (
        text[index] === "\\" &&
        text[index + 1] === ")" &&
        !isEscapedSimpleTexChar(text, index)
      ) {
        return {
          delimiter: "paren",
          contentStart: start + 2,
          contentEnd: index,
          end: index + 2,
        };
      }
      index += 1;
    }
  }

  return null;
}

function isEscapedSimpleTexChar(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function scanSimpleTexVerticalGlueCommand(
  text: string,
  start: number,
  sourceOffset: number
): {
  node: SimpleTexVerticalGlueNode;
  end: number;
  unsupportedCommand: boolean;
} | null {
  for (const preset of [
    { command: "smallskip", size: 3, stretch: 1, shrink: 1 },
    { command: "medskip", size: 6, stretch: 2, shrink: 2 },
    { command: "bigskip", size: 12, stretch: 4, shrink: 4 },
  ] as const) {
    const end = scanSimpleTexControlWord(text, start, preset.command);
    if (end === null) {
      continue;
    }
    return {
      node: {
        kind: "vertical-glue",
        text: text.slice(start, end),
        command: preset.command,
        sourceStart: sourceOffset + start,
        sourceEnd: sourceOffset + end,
        size: preset.size,
        stretch: preset.stretch,
        shrink: preset.shrink,
        stretchOrder: "normal",
        shrinkOrder: "normal",
      },
      end,
      unsupportedCommand: false,
    };
  }

  const vfillEnd = scanSimpleTexControlWord(text, start, "vfill");
  if (vfillEnd !== null) {
    return {
      node: {
        kind: "vertical-glue",
        text: text.slice(start, vfillEnd),
        command: "vfill",
        sourceStart: sourceOffset + start,
        sourceEnd: sourceOffset + vfillEnd,
        size: 0,
        stretch: 1,
        stretchOrder: "fill",
      },
      end: vfillEnd,
      unsupportedCommand: false,
    };
  }

  const vspaceEnd = scanSimpleTexControlWord(text, start, "vspace");
  if (vspaceEnd !== null) {
    let argumentStart = vspaceEnd;
    if (text[argumentStart] === "*") {
      argumentStart += 1;
    }
    while (text[argumentStart] === " " || text[argumentStart] === "\n") {
      argumentStart += 1;
    }
    if (text[argumentStart] !== "{") {
      return null;
    }
    const argumentEnd = findBalancedSimpleTexGroupEnd(text, argumentStart);
    if (argumentEnd === null) {
      return null;
    }
    const rawLength = text.slice(argumentStart + 1, argumentEnd - 1);
    const parsed = parseLength(rawLength, "pt");
    return {
      node: {
        kind: "vertical-glue",
        text: text.slice(start, argumentEnd),
        command: "vspace",
        sourceStart: sourceOffset + start,
        sourceEnd: sourceOffset + argumentEnd,
        size: parsed ?? 0,
        stretchOrder: "normal",
        shrinkOrder: "normal",
      },
      end: argumentEnd,
      unsupportedCommand: parsed === null,
    };
  }

  const vskipMatch = vskipGluePattern.exec(text.slice(start));
  if (vskipMatch) {
    const full = vskipMatch[0] ?? "";
    const size = parseLength(vskipMatch[1] ?? "", "pt");
    const stretch = vskipMatch[2] ? parseLength(vskipMatch[2], "pt") : undefined;
    const shrink = vskipMatch[3] ? parseLength(vskipMatch[3], "pt") : undefined;
    return {
      node: {
        kind: "vertical-glue",
        text: text.slice(start, start + full.length),
        command: "vskip",
        sourceStart: sourceOffset + start,
        sourceEnd: sourceOffset + start + full.length,
        size: size ?? 0,
        stretch: stretch ?? undefined,
        shrink: shrink ?? undefined,
        stretchOrder: stretch !== undefined ? "normal" : undefined,
        shrinkOrder: shrink !== undefined ? "normal" : undefined,
      },
      end: start + full.length,
      unsupportedCommand:
        size === null ||
        (vskipMatch[2] !== undefined && stretch === null) ||
        (vskipMatch[3] !== undefined && shrink === null),
    };
  }

  return null;
}

function scanSimpleTexVerticalRuleCommand(
  text: string,
  start: number,
  sourceOffset: number
): {
  node: SimpleTexVerticalRuleNode;
  end: number;
  unsupportedCommand: boolean;
} | null {
  const hruleEnd = scanSimpleTexControlWord(text, start, "hrule");
  if (hruleEnd === null) {
    return null;
  }

  let cursor = skipSimpleTexControlWordSpaces(text, hruleEnd);
  const dimensions: {
    width?: number | null;
    height?: number | null;
    depth?: number | null;
  } = {};
  let parsedAnyDimension = false;
  while (cursor < text.length) {
    const keywordMatch = /^(width|height|depth)(?=[^A-Za-z]|$)/i.exec(text.slice(cursor));
    if (!keywordMatch) {
      break;
    }
    const keyword = keywordMatch[1]?.toLowerCase() as "width" | "height" | "depth";
    cursor += keyword.length;
    cursor = skipSimpleTexControlWordSpaces(text, cursor);
    const lengthMatch = new RegExp(`^(${texLengthPattern})`, "i").exec(text.slice(cursor));
    if (!lengthMatch) {
      return {
        node: {
          kind: "vertical-rule",
          text: text.slice(start, cursor),
          sourceStart: sourceOffset + start,
          sourceEnd: sourceOffset + cursor,
          width: 0,
          height: 0,
          depth: 0,
        },
        end: cursor,
        unsupportedCommand: true,
      };
    }
    const rawLength = lengthMatch[1] ?? "";
    dimensions[keyword] = parseLength(rawLength, "pt");
    cursor += rawLength.length;
    cursor = skipSimpleTexControlWordSpaces(text, cursor);
    parsedAnyDimension = true;
  }

  const supported =
    parsedAnyDimension &&
    typeof dimensions.width === "number" &&
    typeof dimensions.height === "number" &&
    dimensions.width !== null &&
    dimensions.height !== null &&
    dimensions.depth !== null;
  return {
    node: {
      kind: "vertical-rule",
      text: text.slice(start, cursor),
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + cursor,
      width: dimensions.width ?? 0,
      height: dimensions.height ?? 0,
      depth: dimensions.depth ?? 0,
    },
    end: cursor,
    unsupportedCommand: !supported,
  };
}

function scanSimpleTexPenaltyCommand(
  text: string,
  start: number,
  sourceOffset: number
): {
  node: SimpleTexPenaltyNode;
  end: number;
  unsupportedCommand: boolean;
} | null {
  const commandEnd = scanSimpleTexControlWord(text, start, "penalty");
  if (commandEnd === null) {
    return null;
  }

  const valueStart = skipSimpleTexControlWordSpaces(text, commandEnd);
  const valueMatch = /^[+-]?\d+/.exec(text.slice(valueStart));
  if (!valueMatch) {
    return {
      node: {
        kind: "penalty",
        text: text.slice(start, valueStart),
        sourceStart: sourceOffset + start,
        sourceEnd: sourceOffset + valueStart,
        penalty: 0,
      },
      end: valueStart,
      unsupportedCommand: true,
    };
  }

  const rawValue = valueMatch[0] ?? "";
  const end = valueStart + rawValue.length;
  return {
    node: {
      kind: "penalty",
      text: text.slice(start, end),
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + end,
      penalty: Number.parseInt(rawValue, 10),
    },
    end,
    unsupportedCommand: false,
  };
}

function scanSimpleTexBoxCommand(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): {
  node: SimpleTexBoxNode;
  end: number;
  unsupportedCommand: boolean;
} | null {
  const commandEnd = scanSimpleTexControlWord(text, start, "parbox");
  if (commandEnd === null) {
    return null;
  }

  let cursor = skipSimpleTexControlWordSpaces(text, commandEnd);
  let alignment: SimpleTexBoxAlignment = "center";
  if (text[cursor] === "[") {
    const optionEnd = findBalancedSimpleTexOptionalArgumentEnd(text, cursor);
    if (optionEnd === null) {
      return null;
    }
    alignment = parseSimpleTexBoxAlignment(text.slice(cursor + 1, optionEnd - 1));
    cursor = skipSimpleTexControlWordSpaces(text, optionEnd);
  }

  let height: number | undefined;
  let unsupportedCommand = false;
  if (text[cursor] === "[") {
    const heightEnd = findBalancedSimpleTexOptionalArgumentEnd(text, cursor);
    if (heightEnd === null) {
      return null;
    }
    const parsedHeight = parseLength(text.slice(cursor + 1, heightEnd - 1), "pt");
    height = parsedHeight ?? undefined;
    unsupportedCommand ||= parsedHeight === null;
    cursor = skipSimpleTexControlWordSpaces(text, heightEnd);

    if (text[cursor] === "[") {
      const innerPositionEnd = findBalancedSimpleTexOptionalArgumentEnd(text, cursor);
      if (innerPositionEnd === null) {
        return null;
      }
      alignment = parseSimpleTexBoxAlignment(text.slice(cursor + 1, innerPositionEnd - 1));
      cursor = skipSimpleTexControlWordSpaces(text, innerPositionEnd);
    }
  }

  if (text[cursor] !== "{") {
    return null;
  }
  const widthGroupEnd = findBalancedSimpleTexGroupEnd(text, cursor);
  if (widthGroupEnd === null) {
    return null;
  }
  const parsedWidth = parseLength(text.slice(cursor + 1, widthGroupEnd - 1), "pt");
  unsupportedCommand ||= parsedWidth === null;
  cursor = skipSimpleTexControlWordSpaces(text, widthGroupEnd);

  if (text[cursor] !== "{") {
    return null;
  }
  const contentGroupEnd = findBalancedSimpleTexGroupEnd(text, cursor);
  if (contentGroupEnd === null) {
    return null;
  }
  const contentStart = cursor + 1;
  const contentEnd = contentGroupEnd - 1;
  const body = buildSimpleTexParagraphIrForRange(
    text,
    contentStart,
    contentEnd,
    sourceOffset,
    resolveColorAlias
  );
  unsupportedCommand ||= body.unsupportedCommand;

  return {
    node: {
      kind: "box",
      text: text.slice(start, contentGroupEnd),
      command: "parbox",
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + contentGroupEnd,
      width: parsedWidth ?? 0,
      ...(height !== undefined ? { height } : {}),
      alignment,
      content: text.slice(contentStart, contentEnd),
      contentStart: sourceOffset + contentStart,
      contentEnd: sourceOffset + contentEnd,
      body,
    },
    end: contentGroupEnd,
    unsupportedCommand,
  };
}

function scanSimpleTexBoxEnvironment(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): {
  node: SimpleTexBoxNode;
  end: number;
  unsupportedCommand: boolean;
} | null {
  const beginPrefix = String.raw`\begin{minipage}`;
  if (!text.startsWith(beginPrefix, start)) {
    return null;
  }

  let cursor = skipSimpleTexControlWordSpaces(text, start + beginPrefix.length);
  let alignment: SimpleTexBoxAlignment = "center";
  if (text[cursor] === "[") {
    const optionEnd = findBalancedSimpleTexOptionalArgumentEnd(text, cursor);
    if (optionEnd === null) {
      return null;
    }
    alignment = parseSimpleTexBoxAlignment(text.slice(cursor + 1, optionEnd - 1));
    cursor = skipSimpleTexControlWordSpaces(text, optionEnd);
  }

  let height: number | undefined;
  let unsupportedCommand = false;
  if (text[cursor] === "[") {
    const heightEnd = findBalancedSimpleTexOptionalArgumentEnd(text, cursor);
    if (heightEnd === null) {
      return null;
    }
    const parsedHeight = parseLength(text.slice(cursor + 1, heightEnd - 1), "pt");
    height = parsedHeight ?? undefined;
    unsupportedCommand ||= parsedHeight === null;
    cursor = skipSimpleTexControlWordSpaces(text, heightEnd);

    if (text[cursor] === "[") {
      const innerPositionEnd = findBalancedSimpleTexOptionalArgumentEnd(text, cursor);
      if (innerPositionEnd === null) {
        return null;
      }
      alignment = parseSimpleTexBoxAlignment(text.slice(cursor + 1, innerPositionEnd - 1));
      cursor = skipSimpleTexControlWordSpaces(text, innerPositionEnd);
    }
  }

  if (text[cursor] !== "{") {
    return null;
  }
  const widthGroupEnd = findBalancedSimpleTexGroupEnd(text, cursor);
  if (widthGroupEnd === null) {
    return null;
  }
  const parsedWidth = parseLength(text.slice(cursor + 1, widthGroupEnd - 1), "pt");
  unsupportedCommand ||= parsedWidth === null;

  const contentStart = widthGroupEnd;
  const environmentEnd = findMatchingSimpleTexEnvironmentEnd(
    text,
    contentStart,
    "minipage"
  );
  if (!environmentEnd) {
    return null;
  }
  const body = buildSimpleTexParagraphIrForRange(
    text,
    contentStart,
    environmentEnd.contentEnd,
    sourceOffset,
    resolveColorAlias
  );
  unsupportedCommand ||= body.unsupportedCommand;

  return {
    node: {
      kind: "box",
      text: text.slice(start, environmentEnd.end),
      command: "minipage",
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + environmentEnd.end,
      width: parsedWidth ?? 0,
      ...(height !== undefined ? { height } : {}),
      alignment,
      content: text.slice(contentStart, environmentEnd.contentEnd),
      contentStart: sourceOffset + contentStart,
      contentEnd: sourceOffset + environmentEnd.contentEnd,
      body,
    },
    end: environmentEnd.end,
    unsupportedCommand,
  };
}

function findMatchingSimpleTexEnvironmentEnd(
  text: string,
  start: number,
  name: string
): { readonly contentEnd: number; readonly end: number } | null {
  const beginPrefix = `\\begin{${name}}`;
  const endPrefix = `\\end{${name}}`;
  let depth = 1;
  let index = start;
  while (index < text.length) {
    const nextBegin = text.indexOf(beginPrefix, index);
    const nextEnd = text.indexOf(endPrefix, index);
    if (nextEnd < 0) {
      return null;
    }
    if (nextBegin >= 0 && nextBegin < nextEnd) {
      depth += 1;
      index = nextBegin + beginPrefix.length;
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return {
        contentEnd: nextEnd,
        end: nextEnd + endPrefix.length,
      };
    }
    index = nextEnd + endPrefix.length;
  }
  return null;
}

function parseSimpleTexBoxAlignment(raw: string): SimpleTexBoxAlignment {
  const value = raw.trim().toLowerCase();
  if (value === "t") {
    return "top";
  }
  if (value === "b") {
    return "bottom";
  }
  return "center";
}

function scanSimpleTexEnvironmentBoundary(
  text: string,
  start: number
): { boundary: "begin" | "end"; name: SimpleTexEnvironmentName; end: number } | null {
  for (const boundary of ["begin", "end"] as const) {
    const prefix = `\\${boundary}{`;
    if (!text.startsWith(prefix, start)) {
      continue;
    }
    const nameStart = start + prefix.length;
    const nameEnd = text.indexOf("}", nameStart);
    if (nameEnd < 0) {
      return null;
    }
    const name = text.slice(nameStart, nameEnd);
    if (
      isSimpleTexQuoteEnvironmentName(name) ||
      isSimpleTexTrivlistEnvironmentName(name) ||
      name === "itemize" ||
      name === "enumerate" ||
      name === "description"
    ) {
      return {
        boundary,
        name,
        end: nameEnd + 1,
      };
    }
  }
  return null;
}

function isSimpleTexQuoteEnvironmentName(name: string): name is SimpleTexQuoteEnvironmentName {
  return name === "quote" || name === "quotation";
}

function isSimpleTexTrivlistEnvironmentName(
  name: string
): name is SimpleTexTrivlistEnvironmentName {
  return name === "center" || name === "flushleft" || name === "flushright";
}

function isSimpleTexListEnvironmentName(name: string): name is SimpleTexListKind {
  return name === "itemize" || name === "enumerate" || name === "description";
}

function simpleTexTrivlistAlignment(
  name: SimpleTexTrivlistEnvironmentName
): TexParagraphAlignment {
  if (name === "flushright") {
    return "ragged-left";
  }
  if (name === "flushleft") {
    return "ragged-right";
  }
  return "center";
}

function scanSimpleTexItemCommand(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): {
  node: SimpleTexItemNode;
  end: number;
  unsupportedCommand: boolean;
} | null {
  const commandEnd = scanSimpleTexControlWord(text, start, "item");
  if (commandEnd === null) {
    return null;
  }

  let end = skipSimpleTexControlWordSpaces(text, commandEnd);
  let labelNodes: readonly SimpleTexInlineNode[] | undefined;
  let labelSourceStart: number | undefined;
  let labelSourceEnd: number | undefined;
  let unsupportedCommand = false;
  if (text[end] === "[") {
    const labelEnd = findBalancedSimpleTexOptionalArgumentEnd(text, end);
    if (labelEnd === null) {
      return null;
    }
    const contentStart = end + 1;
    const contentEnd = labelEnd - 1;
    const labelScan = scanSimpleTexIrNodes(
      text.slice(contentStart, contentEnd),
      sourceOffset + contentStart,
      resolveColorAlias
    );
    const labelIsInline = labelScan.nodes.every(isSimpleTexInlineNode);
    labelNodes = labelIsInline
      ? labelScan.nodes.filter(isSimpleTexInlineNode)
      : [];
    labelSourceStart = sourceOffset + contentStart;
    labelSourceEnd = sourceOffset + contentEnd;
    unsupportedCommand = labelScan.unsupportedCommand || !labelIsInline;
    end = skipSimpleTexControlWordSpaces(text, labelEnd);
  }

  return {
    node: {
      kind: "item",
      text: text.slice(start, end),
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + end,
      labelNodes,
      labelSourceStart,
      labelSourceEnd,
    },
    end,
    unsupportedCommand,
  };
}

function scanSimpleTexFontCommand(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): {
  node: SimpleTexFontCommandNode;
  end: number;
  unsupportedCommand: boolean;
} | null {
  const command = scanSimpleTexFontCommandName(text, start);
  if (!command) {
    return null;
  }

  let groupStart = command.end;
  while (text[groupStart] === " " || text[groupStart] === "\n") {
    groupStart += 1;
  }
  if (text[groupStart] !== "{") {
    return null;
  }
  const groupEnd = findBalancedSimpleTexGroupEnd(text, groupStart);
  if (groupEnd === null) {
    return null;
  }

  const contentStart = groupStart + 1;
  const contentEnd = groupEnd - 1;
  const childScan = scanSimpleTexIrNodes(
    text.slice(contentStart, contentEnd),
    sourceOffset + contentStart,
    resolveColorAlias
  );
  const childrenAreInline = childScan.nodes.every(isSimpleTexInlineNode);
  return {
    node: {
      kind: "font-command",
      text: text.slice(start, groupEnd),
      command: command.name,
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + groupEnd,
      contentStart: sourceOffset + contentStart,
      contentEnd: sourceOffset + contentEnd,
      children: childrenAreInline
        ? childScan.nodes.filter(isSimpleTexInlineNode)
        : [],
    },
    end: groupEnd,
    unsupportedCommand: childScan.unsupportedCommand || !childrenAreInline,
  };
}

function scanSimpleTexMBoxCommand(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): {
  node: SimpleTexMBoxNode;
  end: number;
  unsupportedCommand: boolean;
} | null {
  const command = scanSimpleTexTextBoxCommandName(text, start);
  if (!command) {
    return null;
  }

  let cursor = skipSimpleTexControlWordSpaces(text, command.end);
  let boxWidth: number | undefined;
  let boxAlign: SimpleTexTextBoxAlignment | undefined;
  let unsupportedDimension = false;
  if ((command.name === "makebox" || command.name === "framebox") && text[cursor] === "[") {
    const widthArgument = scanSimpleTexOptionalBracketArgument(text, cursor);
    if (!widthArgument) {
      return null;
    }
    const parsedWidth = parseTexDimensionText(widthArgument.content.trim());
    if (parsedWidth === null) {
      unsupportedDimension = true;
      boxWidth = 0;
    } else {
      boxWidth = parsedWidth;
    }
    boxAlign = "center";
    cursor = skipSimpleTexControlWordSpaces(text, widthArgument.end);
    if (text[cursor] === "[") {
      const alignArgument = scanSimpleTexOptionalBracketArgument(text, cursor);
      if (!alignArgument) {
        return null;
      }
      boxAlign = simpleTexTextBoxAlignment(alignArgument.content.trim());
      cursor = skipSimpleTexControlWordSpaces(text, alignArgument.end);
    }
  } else if (command.name === "llap") {
    boxWidth = 0;
    boxAlign = "right";
  } else if (command.name === "rlap") {
    boxWidth = 0;
    boxAlign = "left";
  }

  const groupStart = cursor;
  if (text[groupStart] !== "{") {
    return null;
  }
  const groupEnd = findBalancedSimpleTexGroupEnd(text, groupStart);
  if (groupEnd === null) {
    return null;
  }

  const contentStart = groupStart + 1;
  const contentEnd = groupEnd - 1;
  const childScan = scanSimpleTexIrNodes(
    text.slice(contentStart, contentEnd),
    sourceOffset + contentStart,
    resolveColorAlias
  );
  const childrenAreInline = childScan.nodes.every(isSimpleTexInlineNode);
  const hasForcedBreak = childScan.nodes.some((node) => node.kind === "line-break");
  return {
    node: {
      kind: "mbox",
      command: command.name,
      text: text.slice(start, groupEnd),
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + groupEnd,
      content: text.slice(contentStart, contentEnd),
      contentStart: sourceOffset + contentStart,
      contentEnd: sourceOffset + contentEnd,
      children: childrenAreInline
        ? childScan.nodes.filter(isSimpleTexInlineNode)
        : [],
      boxWidth,
      boxAlign,
    },
    end: groupEnd,
    unsupportedCommand: unsupportedDimension || childScan.unsupportedCommand || !childrenAreInline || hasForcedBreak,
  };
}

function scanSimpleTexRuleCommand(
  text: string,
  start: number,
  sourceOffset: number
): {
  node: SimpleTexRuleNode;
  end: number;
  unsupportedCommand: boolean;
} | null {
  const commandEnd = scanSimpleTexControlWord(text, start, "rule");
  if (commandEnd === null) {
    return null;
  }

  let cursor = skipSimpleTexControlWordSpaces(text, commandEnd);
  let raise = 0;
  let unsupportedDimension = false;
  if (text[cursor] === "[") {
    const raiseArgument = scanSimpleTexOptionalBracketArgument(text, cursor);
    if (!raiseArgument) {
      return null;
    }
    const parsedRaise = parseTexDimensionText(raiseArgument.content.trim());
    if (parsedRaise === null) {
      unsupportedDimension = true;
    } else {
      raise = parsedRaise;
    }
    cursor = skipSimpleTexControlWordSpaces(text, raiseArgument.end);
  }

  const widthArgument = scanSimpleTexRequiredDimensionGroupArgument(text, cursor);
  if (!widthArgument) {
    return null;
  }
  const width = widthArgument.value ?? 0;
  unsupportedDimension ||= widthArgument.value === null;
  cursor = skipSimpleTexControlWordSpaces(text, widthArgument.end);

  const heightArgument = scanSimpleTexRequiredDimensionGroupArgument(text, cursor);
  if (!heightArgument) {
    return null;
  }
  const height = heightArgument.value ?? 0;
  unsupportedDimension ||= heightArgument.value === null;

  const end = heightArgument.end;
  return {
    node: {
      kind: "rule",
      text: text.slice(start, end),
      raise,
      width,
      height,
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + end,
    },
    end,
    unsupportedCommand: unsupportedDimension,
  };
}

function scanSimpleTexIncludeGraphicsCommand(
  text: string,
  start: number,
  sourceOffset: number
): {
  node: SimpleTexIncludeGraphicsNode;
  end: number;
} | null {
  const commandEnd = scanSimpleTexControlWord(text, start, "includegraphics");
  if (commandEnd === null) {
    return null;
  }

  let cursor = skipSimpleTexControlWordSpaces(text, commandEnd);
  let rawOptions = "";
  if (text[cursor] === "[") {
    const optionsArgument = scanSimpleTexOptionalBracketArgument(text, cursor);
    if (!optionsArgument) {
      return null;
    }
    rawOptions = optionsArgument.content;
    cursor = skipSimpleTexControlWordSpaces(text, optionsArgument.end);
  }

  const groupStart = cursor;
  if (text[groupStart] !== "{") {
    return null;
  }
  const groupEnd = findBalancedSimpleTexGroupEnd(text, groupStart);
  if (groupEnd === null) {
    return null;
  }

  const filenameStart = groupStart + 1;
  const filenameEnd = groupEnd - 1;
  return {
    node: {
      kind: "includegraphics",
      text: text.slice(start, groupEnd),
      filename: text.slice(filenameStart, filenameEnd).trim(),
      filenameStart: sourceOffset + filenameStart,
      filenameEnd: sourceOffset + filenameEnd,
      options: parseSimpleTexGraphicsOptions(rawOptions),
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + groupEnd,
    },
    end: groupEnd,
  };
}

function parseSimpleTexGraphicsOptions(raw: string): SimpleTexGraphicsOptions {
  let width: number | undefined;
  let height: number | undefined;
  let scale: number | undefined;
  let keepAspectRatio = false;
  let trim: SimpleTexGraphicsTrim | undefined;
  let viewport: SimpleTexGraphicsViewport | undefined;
  let clip: boolean | undefined;
  for (const part of splitSimpleTexGraphicsOptions(raw)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const equals = trimmed.indexOf("=");
    const key = (equals >= 0 ? trimmed.slice(0, equals) : trimmed).trim().toLowerCase();
    const value = equals >= 0 ? trimmed.slice(equals + 1).trim() : "";
    if (key === "width") {
      const parsed = parseTexDimensionText(value);
      if (parsed !== null) {
        width = parsed;
      }
      continue;
    }
    if (key === "height") {
      const parsed = parseTexDimensionText(value);
      if (parsed !== null) {
        height = parsed;
      }
      continue;
    }
    if (key === "scale") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        scale = parsed;
      }
      continue;
    }
    if (key === "keepaspectratio") {
      keepAspectRatio = equals < 0 || simpleTexBooleanOptionValue(value);
      continue;
    }
    if (key === "trim") {
      const parsed = parseSimpleTexGraphicsQuad(value);
      if (parsed) {
        trim = {
          left: parsed[0],
          bottom: parsed[1],
          right: parsed[2],
          top: parsed[3],
        };
      }
      continue;
    }
    if (key === "viewport") {
      const parsed = parseSimpleTexGraphicsQuad(value);
      if (parsed) {
        viewport = {
          llx: parsed[0],
          lly: parsed[1],
          urx: parsed[2],
          ury: parsed[3],
        };
      }
      continue;
    }
    if (key === "clip") {
      clip = equals < 0 || simpleTexBooleanOptionValue(value);
    }
  }
  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(keepAspectRatio ? { keepAspectRatio } : {}),
    ...(trim ? { trim } : {}),
    ...(viewport ? { viewport } : {}),
    ...(clip !== undefined ? { clip } : {}),
    raw,
  };
}

function splitSimpleTexGraphicsOptions(raw: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let braceDepth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
      continue;
    }
    if (char === "," && braceDepth === 0) {
      parts.push(raw.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts;
}

function simpleTexBooleanOptionValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "no";
}

function parseSimpleTexGraphicsQuad(raw: string): [number, number, number, number] | null {
  const parts = splitSimpleTexGraphicsDimensionList(stripSingleSimpleTexBraceLayer(raw));
  if (parts.length !== 4) {
    return null;
  }
  const parsed = parts.map((part) =>
    parseSimpleTexGraphicsDimension(stripSingleSimpleTexBraceLayer(part))
  );
  if (parsed.includes(null)) {
    return null;
  }
  return parsed as [number, number, number, number];
}

function parseSimpleTexGraphicsDimension(raw: string): number | null {
  const trimmed = raw.trim();
  const explicit = parseTexDimensionText(trimmed);
  if (explicit !== null) {
    return explicit;
  }
  const bare = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/.exec(trimmed);
  if (!bare) {
    return null;
  }
  const value = Number(bare[1]);
  return Number.isFinite(value) ? value * TEX_GRAPHICS_BARE_NUMBER_UNIT_PT : null;
}

function splitSimpleTexGraphicsDimensionList(raw: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let braceDepth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
      continue;
    }
    if (/\s/.test(char) && braceDepth === 0) {
      if (index > start) {
        parts.push(raw.slice(start, index));
      }
      start = index + 1;
    }
  }
  if (raw.length > start) {
    parts.push(raw.slice(start));
  }
  return parts.map((part) => part.trim()).filter(Boolean);
}

function stripSingleSimpleTexBraceLayer(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return trimmed;
  }
  const end = findBalancedSimpleTexGroupEnd(trimmed, 0);
  return end === trimmed.length ? trimmed.slice(1, -1).trim() : trimmed;
}

function scanSimpleTexRaiseBoxCommand(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): {
  node: SimpleTexRaiseBoxNode;
  end: number;
  unsupportedCommand: boolean;
} | null {
  const commandEnd = scanSimpleTexControlWord(text, start, "raisebox");
  if (commandEnd === null) {
    return null;
  }

  let cursor = skipSimpleTexControlWordSpaces(text, commandEnd);
  const liftArgument = scanSimpleTexRequiredDimensionGroupArgument(text, cursor);
  if (!liftArgument) {
    return null;
  }
  const lift = liftArgument.value ?? 0;
  let unsupportedDimension = liftArgument.value === null;
  cursor = skipSimpleTexControlWordSpaces(text, liftArgument.end);

  let boxHeight: number | undefined;
  let boxDepth: number | undefined;
  let hasHeightArgument = false;
  let heightArgumentIsEmpty = false;
  if (text[cursor] === "[") {
    const heightArgument = scanSimpleTexOptionalBracketArgument(text, cursor);
    if (!heightArgument) {
      return null;
    }
    hasHeightArgument = true;
    const trimmedHeight = heightArgument.content.trim();
    if (trimmedHeight !== "") {
      const parsedHeight = parseTexDimensionText(trimmedHeight);
      if (parsedHeight === null) {
        unsupportedDimension = true;
      } else {
        boxHeight = parsedHeight;
      }
    } else {
      heightArgumentIsEmpty = true;
    }
    cursor = skipSimpleTexControlWordSpaces(text, heightArgument.end);
  }

  if (hasHeightArgument && text[cursor] === "[") {
    const depthArgument = scanSimpleTexOptionalBracketArgument(text, cursor);
    if (!depthArgument) {
      return null;
    }
    if (heightArgumentIsEmpty) {
      unsupportedDimension = true;
    }
    const parsedDepth = parseTexDimensionText(depthArgument.content.trim());
    if (parsedDepth === null) {
      unsupportedDimension = true;
    } else {
      boxDepth = parsedDepth;
    }
    cursor = skipSimpleTexControlWordSpaces(text, depthArgument.end);
  }

  const groupStart = cursor;
  if (text[groupStart] !== "{") {
    return null;
  }
  const groupEnd = findBalancedSimpleTexGroupEnd(text, groupStart);
  if (groupEnd === null) {
    return null;
  }

  const contentStart = groupStart + 1;
  const contentEnd = groupEnd - 1;
  const childScan = scanSimpleTexIrNodes(
    text.slice(contentStart, contentEnd),
    sourceOffset + contentStart,
    resolveColorAlias
  );
  const childrenAreInline = childScan.nodes.every(isSimpleTexInlineNode);
  const hasForcedBreak = childScan.nodes.some((node) => node.kind === "line-break");
  return {
    node: {
      kind: "raisebox",
      text: text.slice(start, groupEnd),
      lift,
      boxHeight,
      boxDepth,
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + groupEnd,
      content: text.slice(contentStart, contentEnd),
      contentStart: sourceOffset + contentStart,
      contentEnd: sourceOffset + contentEnd,
      children: childrenAreInline
        ? childScan.nodes.filter(isSimpleTexInlineNode)
        : [],
    },
    end: groupEnd,
    unsupportedCommand: unsupportedDimension || childScan.unsupportedCommand || !childrenAreInline || hasForcedBreak,
  };
}

function scanSimpleTexDimensionBoxCommand(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): {
  node: SimpleTexDimensionBoxNode;
  end: number;
  unsupportedCommand: boolean;
} | null {
  const command = scanSimpleTexDimensionBoxCommandName(text, start);
  if (!command) {
    return null;
  }

  const groupStart = skipSimpleTexControlWordSpaces(text, command.end);
  if (text[groupStart] !== "{") {
    return null;
  }
  const groupEnd = findBalancedSimpleTexGroupEnd(text, groupStart);
  if (groupEnd === null) {
    return null;
  }

  const contentStart = groupStart + 1;
  const contentEnd = groupEnd - 1;
  const childScan = scanSimpleTexIrNodes(
    text.slice(contentStart, contentEnd),
    sourceOffset + contentStart,
    resolveColorAlias
  );
  const childrenAreInline = childScan.nodes.every(isSimpleTexInlineNode);
  const hasForcedBreak = childScan.nodes.some((node) => node.kind === "line-break");
  return {
    node: {
      kind: "dimension-box",
      command: command.name,
      text: text.slice(start, groupEnd),
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + groupEnd,
      content: text.slice(contentStart, contentEnd),
      contentStart: sourceOffset + contentStart,
      contentEnd: sourceOffset + contentEnd,
      children: childrenAreInline
        ? childScan.nodes.filter(isSimpleTexInlineNode)
        : [],
    },
    end: groupEnd,
    unsupportedCommand: childScan.unsupportedCommand || !childrenAreInline || hasForcedBreak,
  };
}

function scanSimpleTexDimensionBoxCommandName(
  text: string,
  start: number
): { readonly name: SimpleTexDimensionBoxCommandName; readonly end: number } | null {
  for (const name of SIMPLE_TEX_DIMENSION_BOX_COMMAND_NAMES) {
    const end = scanSimpleTexControlWord(text, start, name);
    if (end !== null) {
      return { name, end };
    }
  }
  return null;
}

function scanSimpleTexTextBoxCommandName(
  text: string,
  start: number
): { readonly name: SimpleTexTextBoxCommandName; readonly end: number } | null {
  for (const name of SIMPLE_TEX_TEXT_BOX_COMMAND_NAMES) {
    const end = scanSimpleTexControlWord(text, start, name);
    if (end !== null) {
      return { name, end };
    }
  }
  return null;
}

function scanSimpleTexOptionalBracketArgument(
  text: string,
  start: number
): { readonly content: string; readonly end: number } | null {
  const end = findBalancedSimpleTexOptionalArgumentEnd(text, start);
  if (end === null) {
    return null;
  }
  return {
    content: text.slice(start + 1, end - 1),
    end,
  };
}

function scanSimpleTexRequiredGroupArgument(
  text: string,
  start: number
): {
  readonly content: string;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly end: number;
} | null {
  if (text[start] !== "{") return null;
  const end = findBalancedSimpleTexGroupEnd(text, start);
  if (end === null) return null;
  return {
    content: text.slice(start + 1, end - 1),
    contentStart: start + 1,
    contentEnd: end - 1,
    end,
  };
}

function scanSimpleTexRequiredDimensionGroupArgument(
  text: string,
  start: number
): { readonly value: number | null; readonly end: number } | null {
  if (text[start] !== "{") {
    return null;
  }
  const groupEnd = findBalancedSimpleTexGroupEnd(text, start);
  if (groupEnd === null) {
    return null;
  }
  return {
    value: parseTexDimensionText(text.slice(start + 1, groupEnd - 1).trim()),
    end: groupEnd,
  };
}

export function simpleTexTextBoxAlignment(value: string): SimpleTexTextBoxAlignment {
  switch (value) {
    case "l":
    case "t":
      return "left";
    case "r":
    case "b":
      return "right";
    case "s":
      return "stretch";
    case "c":
    default:
      return "center";
  }
}

function scanSimpleTexFontCommandName(
  text: string,
  start: number
): { name: SimpleTexFontCommandName; end: number } | null {
  for (const name of SIMPLE_TEX_FONT_COMMAND_NAMES) {
    const end = scanSimpleTexControlWord(text, start, name);
    if (end !== null) {
      return { name, end };
    }
  }
  return null;
}

function scanSimpleTexFontDeclaration(
  text: string,
  start: number,
  sourceOffset: number
): {
  node: SimpleTexFontDeclarationNode;
  end: number;
} | null {
  const command = scanSimpleTexFontDeclarationName(text, start);
  if (!command) {
    return null;
  }
  return {
    node: {
      kind: "font-declaration",
      text: text.slice(start, command.end),
      command: command.name,
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + command.end,
    },
    end: command.end,
  };
}

function scanSimpleTexFontDeclarationName(
  text: string,
  start: number
): { name: SimpleTexFontDeclarationName; end: number } | null {
  for (const name of SIMPLE_TEX_FONT_DECLARATION_NAMES) {
    const end = scanSimpleTexControlWord(text, start, name);
    if (end !== null) {
      return { name, end };
    }
  }
  return null;
}

function scanSimpleTexStyleDeclaration(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): { node: SimpleTexStyleDeclarationNode; end: number } | null {
  for (const name of [
    "tiny", "scriptsize", "footnotesize", "small", "normalsize",
    "large", "Large", "LARGE", "huge", "Huge",
  ] as const) {
    const end = scanSimpleTexControlWord(text, start, name);
    if (end !== null) {
      return {
        node: {
          kind: "style-declaration",
          text: text.slice(start, end),
          sizePt: DEFAULT_TEXT_FONT_SIZE * (FONT_SIZE_COMMAND_FACTORS[`\\${name}`] ?? 1),
          sourceStart: sourceOffset + start,
          sourceEnd: sourceOffset + end,
        },
        end,
      };
    }
  }

  const fontsizeEnd = scanSimpleTexControlWord(text, start, "fontsize");
  if (fontsizeEnd === null) {
    return scanSimpleTexColorDeclaration(text, start, sourceOffset, resolveColorAlias);
  }
  let cursor = skipSimpleTexControlWordSpaces(text, fontsizeEnd);
  const size = scanSimpleTexRequiredGroupArgument(text, cursor);
  if (!size) return null;
  cursor = skipSimpleTexControlWordSpaces(text, size.end);
  const baselineSkip = scanSimpleTexRequiredGroupArgument(text, cursor);
  if (!baselineSkip) return null;
  cursor = skipSimpleTexControlWordSpaces(text, baselineSkip.end);
  const selectfontEnd = scanSimpleTexControlWord(text, cursor, "selectfont");
  if (selectfontEnd === null) return null;
  const sizePt = parseTexDimensionText(size.content.trim());
  if (sizePt === null || sizePt <= 0) return null;
  return {
    node: {
      kind: "style-declaration",
      text: text.slice(start, selectfontEnd),
      sizePt,
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + selectfontEnd,
    },
    end: selectfontEnd,
  };
}

function scanSimpleTexColorDeclaration(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): { node: SimpleTexStyleDeclarationNode; end: number } | null {
  const commandEnd = scanSimpleTexControlWord(text, start, "color");
  if (commandEnd === null) return null;
  let cursor = skipSimpleTexControlWordSpaces(text, commandEnd);
  let model: string | undefined;
  if (text[cursor] === "[") {
    const argument = scanSimpleTexOptionalBracketArgument(text, cursor);
    if (!argument) return null;
    model = argument.content.trim();
    cursor = skipSimpleTexControlWordSpaces(text, argument.end);
  }
  const argument = scanSimpleTexRequiredGroupArgument(text, cursor);
  if (!argument) return null;
  const color = normalizeSimpleTexColor(argument.content, model, resolveColorAlias);
  if (!color) return null;
  return {
    node: {
      kind: "style-declaration",
      text: text.slice(start, argument.end),
      color,
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + argument.end,
    },
    end: argument.end,
  };
}

function scanSimpleTexColorCommand(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): { node: SimpleTexColorCommandNode; end: number; unsupportedCommand: boolean } | null {
  const commandEnd = scanSimpleTexControlWord(text, start, "textcolor");
  if (commandEnd === null) return null;
  let cursor = skipSimpleTexControlWordSpaces(text, commandEnd);
  let model: string | undefined;
  if (text[cursor] === "[") {
    const argument = scanSimpleTexOptionalBracketArgument(text, cursor);
    if (!argument) return null;
    model = argument.content.trim();
    cursor = skipSimpleTexControlWordSpaces(text, argument.end);
  }
  const colorArgument = scanSimpleTexRequiredGroupArgument(text, cursor);
  if (!colorArgument) return null;
  cursor = skipSimpleTexControlWordSpaces(text, colorArgument.end);
  const contentArgument = scanSimpleTexRequiredGroupArgument(text, cursor);
  if (!contentArgument) return null;
  const color = normalizeSimpleTexColor(colorArgument.content, model, resolveColorAlias);
  if (!color) return null;
  const childScan = scanSimpleTexIrNodes(
    contentArgument.content,
    sourceOffset + contentArgument.contentStart,
    resolveColorAlias
  );
  const childrenAreInline = childScan.nodes.every(isSimpleTexInlineNode);
  return {
    node: {
      kind: "color-command",
      text: text.slice(start, contentArgument.end),
      color,
      contentStart: sourceOffset + contentArgument.contentStart,
      contentEnd: sourceOffset + contentArgument.contentEnd,
      children: childrenAreInline ? childScan.nodes.filter(isSimpleTexInlineNode) : [],
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + contentArgument.end,
    },
    end: contentArgument.end,
    unsupportedCommand: childScan.unsupportedCommand || !childrenAreInline,
  };
}

function normalizeSimpleTexColor(
  specification: string,
  model?: string,
  resolveColorAlias?: ColorAliasResolver
): string | null {
  if (model) {
    return resolveDefineColorModel(model, specification);
  }
  const normalized = normalizeColor(specification, { resolveAlias: resolveColorAlias });
  return normalized.length > 0 && normalized !== "none" ? normalized : null;
}

const SIMPLE_TEX_ACCENT_MARKS: Readonly<Record<string, string>> = {
  "'": "\u0301",
  "`": "\u0300",
  "^": "\u0302",
  '"': "\u0308",
  "~": "\u0303",
  "=": "\u0304",
  ".": "\u0307",
  u: "\u0306",
  v: "\u030c",
  H: "\u030b",
  c: "\u0327",
  k: "\u0328",
  b: "\u0331",
  d: "\u0323",
  r: "\u030a",
  t: "\u0361",
};

const SIMPLE_TEX_LETTER_COMMANDS: Readonly<Record<string, string>> = {
  aa: "å", AA: "Å", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ",
  o: "ø", O: "Ø", l: "ł", L: "Ł", ss: "ß",
};

function scanSimpleTexAccentCommand(
  text: string,
  start: number,
  sourceOffset: number
): { readonly node: SimpleTexTextNode; readonly end: number } | null {
  if (text[start] !== "\\") {
    return null;
  }
  const letterMatch = /^\\([A-Za-z]+)/.exec(text.slice(start));
  if (letterMatch) {
    const replacement = SIMPLE_TEX_LETTER_COMMANDS[letterMatch[1] ?? ""];
    if (replacement) {
      const end = start + (letterMatch[0]?.length ?? 0);
      return {
        node: {
          kind: "text",
          text: replacement,
          sourceStart: sourceOffset + start,
          sourceEnd: sourceOffset + end,
        },
        end,
      };
    }
  }

  const command = text[start + 1] ?? "";
  const mark = SIMPLE_TEX_ACCENT_MARKS[command];
  if (!mark || (/[A-Za-z]/.test(command) && /[A-Za-z]/.test(text[start + 2] ?? ""))) {
    return null;
  }
  let cursor = start + 2;
  while (text[cursor] === " " || text[cursor] === "\n") cursor += 1;
  let base: string;
  if (text[cursor] === "{") {
    const groupEnd = findBalancedSimpleTexGroupEnd(text, cursor);
    if (groupEnd === null) return null;
    base = text.slice(cursor + 1, groupEnd - 1);
    cursor = groupEnd;
  } else {
    const codePoint = text.codePointAt(cursor);
    if (codePoint === undefined) return null;
    const length = codePoint > 0xffff ? 2 : 1;
    base = text.slice(cursor, cursor + length);
    cursor += length;
  }
  // Accent primitives take one character. Avoid silently swallowing nested
  // syntax or a multi-character group that needs fuller TeX expansion.
  if ([...base].length !== 1 || base === "\\") {
    return null;
  }
  return {
    node: {
      kind: "text",
      text: `${base}${mark}`.normalize("NFC"),
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + cursor,
    },
    end: cursor,
  };
}

function scanSimpleTexGroup(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): {
  node: SimpleTexGroupNode;
  end: number;
  unsupportedCommand: boolean;
} | null {
  const groupEnd = findBalancedSimpleTexGroupEnd(text, start);
  if (groupEnd === null) {
    return null;
  }

  const contentStart = start + 1;
  const contentEnd = groupEnd - 1;
  const childScan = scanSimpleTexIrNodes(
    text.slice(contentStart, contentEnd),
    sourceOffset + contentStart,
    resolveColorAlias
  );
  const childrenAreInline = childScan.nodes.every(isSimpleTexInlineNode);
  return {
    node: {
      kind: "group",
      text: text.slice(start, groupEnd),
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + groupEnd,
      contentStart: sourceOffset + contentStart,
      contentEnd: sourceOffset + contentEnd,
      children: childrenAreInline
        ? childScan.nodes.filter(isSimpleTexInlineNode)
        : [],
    },
    end: groupEnd,
    unsupportedCommand: childScan.unsupportedCommand || !childrenAreInline,
  };
}

function findBalancedSimpleTexGroupEnd(text: string, start: number): number | null {
  if (text[start] !== "{") {
    return null;
  }
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return null;
}

function findBalancedSimpleTexOptionalArgumentEnd(
  text: string,
  start: number
): number | null {
  if (text[start] !== "[") {
    return null;
  }
  let bracketDepth = 0;
  let groupDepth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") {
      groupDepth += 1;
      continue;
    }
    if (char === "}" && groupDepth > 0) {
      groupDepth -= 1;
      continue;
    }
    if (groupDepth > 0) {
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth -= 1;
      if (bracketDepth === 0) {
        return index + 1;
      }
    }
  }
  return null;
}

function skipSimpleTexControlWordSpaces(text: string, start: number): number {
  let index = start;
  while (text[index] === " " || text[index] === "\n") {
    index += 1;
  }
  return index;
}

export function scanSimpleTexLineBreak(
  text: string,
  start: number
): { end: number; lineLeading?: string; priority?: 0 | 1 | 2 | 3 | 4 } | null {
  if (text[start] !== "\\") {
    return null;
  }

  const newlineEnd = scanSimpleTexControlWord(text, start, "newline");
  if (newlineEnd !== null) {
    return { end: newlineEnd };
  }
  const linebreakEnd = scanSimpleTexControlWord(text, start, "linebreak");
  if (linebreakEnd !== null) {
    const option = /^\[\s*([0-4])\s*\]/.exec(text.slice(linebreakEnd));
    return {
      end: linebreakEnd + (option?.[0].length ?? 0),
      priority: Number.parseInt(option?.[1] ?? "4", 10) as 0 | 1 | 2 | 3 | 4,
    };
  }
  if (text[start + 1] !== "\\") {
    return null;
  }

  let end = start + 2;
  // LaTeX's starred form suppresses a page break after this forced line. The
  // distinction is irrelevant inside a single node paragraph, but the star
  // is still command syntax and must not leak into painted prose.
  if (text[end] === "*") {
    end += 1;
  }
  const rest = text.slice(end);
  if (rest.startsWith("[")) {
    const match = rest.match(lineLeadingOptionPattern);
    if (!match) {
      return null;
    }
    const full = match[0] ?? "";
    end += full.length;
    return {
      end,
      lineLeading: full.slice(1, -1).trim(),
    };
  }
  return { end };
}

function scanSimpleTexParagraphCommand(
  text: string,
  start: number
): { kind: "par" | "noindent"; end: number } | { kind: "alignment"; alignment: TexParagraphAlignment; end: number } | null {
  const parEnd = scanSimpleTexControlWord(text, start, "par");
  if (parEnd !== null) {
    return { kind: "par", end: parEnd };
  }
  const noIndentEnd = scanSimpleTexControlWord(text, start, "noindent");
  if (noIndentEnd !== null) {
    return { kind: "noindent", end: noIndentEnd };
  }
  return scanSimpleTexAlignmentCommand(text, start);
}

function scanSimpleTexAlignmentCommand(
  text: string,
  start: number
): { kind: "alignment"; alignment: TexParagraphAlignment; end: number } | null {
  const raggedRightEnd = scanSimpleTexControlWord(text, start, "raggedright");
  if (raggedRightEnd !== null) {
    return { kind: "alignment", alignment: "ragged-right", end: raggedRightEnd };
  }
  const raggedLeftEnd = scanSimpleTexControlWord(text, start, "raggedleft");
  if (raggedLeftEnd !== null) {
    return { kind: "alignment", alignment: "ragged-left", end: raggedLeftEnd };
  }
  const centeringEnd = scanSimpleTexControlWord(text, start, "centering");
  if (centeringEnd !== null) {
    return { kind: "alignment", alignment: "center", end: centeringEnd };
  }
  return null;
}

function scanSimpleTexControlWord(text: string, start: number, word: string): number | null {
  if (text[start] !== "\\") {
    return null;
  }
  const end = start + 1 + word.length;
  if (text.slice(start + 1, end) !== word) {
    return null;
  }
  const next = text[end] ?? "";
  return next && /[A-Za-z]/.test(next) ? null : end;
}

function scanUnsupportedControlSequenceEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && /[A-Za-z]/.test(text[index] ?? "")) {
    index += 1;
  }
  if (index === start + 1) {
    return Math.min(text.length, start + 2);
  }
  return scanUnsupportedControlSequenceArgumentsEnd(text, index);
}

function scanUnsupportedControlSequenceArgumentsEnd(text: string, start: number): number {
  let end = start;
  let index = start;
  while (index < text.length) {
    while (text[index] === " " || text[index] === "\n") {
      index += 1;
    }
    if (text[index] === "{") {
      const groupEnd = findBalancedSimpleTexGroupEnd(text, index);
      if (groupEnd === null) {
        break;
      }
      end = groupEnd;
      index = groupEnd;
      continue;
    }
    if (text[index] === "[") {
      const optionEnd = findBalancedSimpleTexOptionalArgumentEnd(text, index);
      if (optionEnd === null) {
        break;
      }
      end = optionEnd;
      index = optionEnd;
      continue;
    }
    break;
  }
  return end;
}

function isSimpleTexInlineNode(node: SimpleTexNode): node is SimpleTexInlineNode {
  return (
    node.kind === "text" ||
    node.kind === "space" ||
    node.kind === "line-break" ||
    node.kind === "math" ||
    node.kind === "font-command" ||
    node.kind === "font-declaration" ||
    node.kind === "style-declaration" ||
    node.kind === "color-command" ||
    node.kind === "group" ||
    node.kind === "mbox" ||
    node.kind === "rule" ||
    node.kind === "includegraphics" ||
    node.kind === "raisebox" ||
    node.kind === "dimension-box" ||
    node.kind === "literal"
  );
}

function simpleTexInlineNodesForRange(
  nodes: readonly SimpleTexNode[],
  sourceStart: number,
  sourceEnd: number
): SimpleTexInlineNode[] {
  return nodes.filter((node): node is SimpleTexInlineNode =>
    isSimpleTexInlineNode(node) &&
    node.sourceStart >= sourceStart &&
    node.sourceEnd <= sourceEnd
  );
}

function buildSimpleTexParagraphBlocksFromNodes(
  text: string,
  sourceNodes: readonly SimpleTexNode[],
  sourceOffset = 0,
  sourceEnd = sourceOffset + text.length
): SimpleTexParagraphBlockScanResult {
  const blocks: SimpleTexParagraphBlock[] = [];
  const items: SimpleTexBlockItem[] = [];
  let unsupportedCommand = false;
  let abortScan = false;
  interface ActiveSimpleTexList {
    readonly kind: SimpleTexListKind;
    readonly depth: number;
    readonly labelDepth: number;
    itemIndex: number;
    readonly ownLeftMarginEm: number;
    readonly totalLeftMarginEm: number;
    readonly scopeRole: Extract<SimpleTexScopePathRole, { readonly kind: "list" }>;
  }
  interface ActiveSimpleTexEnvironment {
    readonly name: SimpleTexEnvironmentName;
    readonly scopeRole: Exclude<SimpleTexScopePathRole, { readonly kind: "list-item" }>;
  }
  const listStack: ActiveSimpleTexList[] = [];
  const environmentStack: ActiveSimpleTexEnvironment[] = [];
  const scopeStack: Exclude<SimpleTexScopePathRole, { readonly kind: "list-item" }>[] = [];
  let pendingListLabel: SimpleTexListLabel | undefined;
  let pendingListShowLabel = false;

  const skipSpaceNodes = (start: number): number => {
    let index = start;
    while (sourceNodes[index]?.kind === "space") {
      index += 1;
    }
    return index;
  };

  const consumeParagraphPrefix = (
    start: number
  ): {
    start: number;
    noIndent: boolean;
    alignment?: TexParagraphAlignment;
    alignmentProfile?: TexAlignmentProfile;
  } => {
    let index = skipSpaceNodes(start);
    let noIndent = false;
    let alignment: TexParagraphAlignment | undefined;
    let alignmentProfile: TexAlignmentProfile | undefined;
    while (index < sourceNodes.length) {
      const node = sourceNodes[index];
      if (node?.kind === "noindent") {
        noIndent = true;
        index = skipSpaceNodes(index + 1);
        continue;
      }
      if (node?.kind === "alignment") {
        noIndent = true;
        alignment = node.alignment;
        alignmentProfile = node.alignmentProfile;
        index = skipSpaceNodes(index + 1);
        continue;
      }
      break;
    }
    return {
      start: index,
      noIndent,
      alignment,
      alignmentProfile,
    };
  };

  const textCharAtSourceOffset = (offset: number): string =>
    text[offset - sourceOffset] ?? "";

  const textSliceAtSourceOffsets = (start: number, end: number): string =>
    text.slice(start - sourceOffset, end - sourceOffset);

  const hasExplicitParagraphBoundaryBetween = (start: number, end: number): boolean => {
    const gap = textSliceAtSourceOffsets(start, end);
    return /\\par\b|\n\s*\n/u.test(gap);
  };

  const sourceStartForNodeIndex = (index: number): number =>
    sourceNodes[index]?.sourceStart ?? sourceEnd;

  const currentSimpleTexListScope = (): SimpleTexListScope | undefined => {
    const activeList = listStack.at(-1);
    if (!activeList) {
      return undefined;
    }
    return {
      kind: activeList.kind,
      depth: activeList.depth,
      labelDepth: activeList.labelDepth,
      itemIndex: activeList.itemIndex,
      ownLeftMarginEm: activeList.ownLeftMarginEm,
      totalLeftMarginEm: activeList.totalLeftMarginEm,
    };
  };

  const currentSimpleTexScopePath = (): readonly SimpleTexScopePathRole[] | undefined => {
    if (scopeStack.length === 0) {
      return undefined;
    }
    const activeList = listStack.at(-1);
    const path: SimpleTexScopePathRole[] = [];
    for (const role of scopeStack) {
      if (role.kind !== "list") {
        path.push(role);
        continue;
      }
      if (activeList?.scopeRole !== role) {
        continue;
      }
      path.push(role);
      if (activeList.itemIndex <= 0) {
        continue;
      }
      path.push({
        kind: "list-item",
        listKind: activeList.kind,
        depth: activeList.depth,
        labelDepth: activeList.labelDepth,
        itemIndex: activeList.itemIndex,
      });
    }
    return path.length > 0 ? path : undefined;
  };

  const pushBlock = (
    rawStart: number,
    rawEnd: number,
    noIndent: boolean,
    firstLineIndentEm: number | undefined,
    quoteDepth: number,
    quotationDepth: number,
    alignment?: TexParagraphAlignment,
    alignmentProfile?: TexAlignmentProfile
  ) => {
    let start = rawStart;
    let end = rawEnd;
    while (
      start < end &&
      (textCharAtSourceOffset(start) === " " || textCharAtSourceOffset(start) === "\n")
    ) {
      start += 1;
    }
    while (
      end > start &&
      (textCharAtSourceOffset(end - 1) === " " || textCharAtSourceOffset(end - 1) === "\n")
    ) {
      end -= 1;
    }
    if (start < end) {
      const listContext = currentSimpleTexListContext();
      if (listStack.length > 0 && !listContext) {
        unsupportedCommand = true;
        abortScan = true;
        return;
      }
      const startsAfterExplicitPar = previousParagraphBlockEnd !== undefined &&
        hasExplicitParagraphBoundaryBetween(previousParagraphBlockEnd, rawStart);
      const scopePath = currentSimpleTexScopePath();
      const nodes = simpleTexInlineNodesForRange(sourceNodes, start, end);
      unsupportedCommand ||= simpleTexBlockStartsWithVerticalModeLapBox(nodes);
      const block: SimpleTexParagraphBlock = {
        text: textSliceAtSourceOffsets(start, end),
        sourceStart: start,
        sourceEnd: end,
        nodes,
        noIndent,
        ...(startsAfterExplicitPar ? { startsAfterExplicitPar: true } : {}),
        ...(firstLineIndentEm !== undefined ? { firstLineIndentEm } : {}),
        ...(quotationItemLabelPendingStack.at(-1) === true
          ? { quotationItemFirstParagraph: true }
          : {}),
        alignment,
        alignmentProfile,
        quoteDepth,
        quotationDepth,
        listContext,
        ...(scopePath ? { scopePath } : {}),
      };
      blocks.push(block);
      items.push({
        kind: "paragraph",
        blockIndex: blocks.length - 1,
        block,
      });
      if (quotationItemLabelPendingStack.at(-1) === true) {
        quotationItemLabelPendingStack[quotationItemLabelPendingStack.length - 1] = false;
      }
      previousParagraphBlockEnd = end;
      pendingListLabel = undefined;
      pendingListShowLabel = false;
    }
  };

  const simpleTexBlockStartsWithVerticalModeLapBox = (
    nodes: readonly SimpleTexInlineNode[]
  ): boolean => {
    const first = nodes.find((node) => node.kind !== "space");
    return first?.kind === "mbox" && (first.command === "llap" || first.command === "rlap");
  };

  const currentSimpleTexListContext = (): SimpleTexListContext | undefined => {
    const activeList = listStack.at(-1);
    if (!activeList || activeList.itemIndex <= 0) {
      return undefined;
    }
    return {
      kind: activeList.kind,
      depth: activeList.depth,
      labelDepth: activeList.labelDepth,
      itemIndex: activeList.itemIndex,
      ownLeftMarginEm: activeList.ownLeftMarginEm,
      totalLeftMarginEm: activeList.totalLeftMarginEm,
      showLabel: pendingListShowLabel,
      label: pendingListLabel,
    };
  };

  const beginList = (kind: SimpleTexListKind) => {
    const depth = currentQuoteDepth + listStack.length + 1;
    const labelDepth = listStack.filter((entry) => entry.kind === kind).length + 1;
    const ownMargin = articleListLeftMarginEmByDepth[
      Math.min(depth - 1, articleListLeftMarginEmByDepth.length - 1)
    ] ?? 1;
    const scopeRole = {
      kind: "list",
      listKind: kind,
      depth,
      labelDepth,
      ownLeftMarginEm: ownMargin,
      totalLeftMarginEm: (listStack.at(-1)?.totalLeftMarginEm ?? 0) + ownMargin,
    } as const;
    listStack.push({
      kind,
      depth,
      labelDepth,
      itemIndex: 0,
      ownLeftMarginEm: ownMargin,
      totalLeftMarginEm: scopeRole.totalLeftMarginEm,
      scopeRole,
    });
    return scopeRole;
  };

  const beginQuote = (
    name: SimpleTexQuoteEnvironmentName
  ): Extract<SimpleTexScopePathRole, { readonly kind: "quote" }> => {
    currentQuoteDepth += 1;
    if (name === "quotation") {
      currentQuotationDepth += 1;
      quotationItemLabelPendingStack.push(true);
    } else {
      currentNonQuotationQuoteDepth += 1;
    }
    return {
      kind: "quote",
      depth: currentQuoteDepth,
    };
  };

  const endQuote = (name: SimpleTexQuoteEnvironmentName) => {
    currentQuoteDepth -= 1;
    if (name === "quotation") {
      currentQuotationDepth -= 1;
      quotationItemLabelPendingStack.pop();
    } else {
      currentNonQuotationQuoteDepth -= 1;
    }
  };

  const beginTrivlist = (
    name: SimpleTexTrivlistEnvironmentName
  ): Extract<SimpleTexScopePathRole, { readonly kind: "trivlist" }> => {
    const depth = scopeStack.filter((role) => role.kind === "trivlist").length + 1;
    return {
      kind: "trivlist",
      envName: name,
      depth,
      alignment: simpleTexTrivlistAlignment(name),
    };
  };

  let prefix = consumeParagraphPrefix(0);
  let blockStart = sourceStartForNodeIndex(prefix.start);
  let currentNoIndent = prefix.noIndent;
  let currentQuoteDepth = 0;
  let currentNonQuotationQuoteDepth = 0;
  let currentQuotationDepth = 0;
  const quotationItemLabelPendingStack: boolean[] = [];
  let previousParagraphBlockEnd: number | undefined;
  let index = prefix.start;

  const environmentSuppressesParagraphIndent = (): boolean =>
    currentNonQuotationQuoteDepth > 0 ||
    listStack.length > 0 ||
    scopeStack.some((role) => role.kind === "trivlist");

  const quotationFirstLineIndentEm = (): number | undefined =>
    currentQuotationDepth > 0 && listStack.length === 0
      ? latexArticleQuotationFirstLineIndentEm
      : undefined;

  const noIndentForCurrentScope = (
    prefixNoIndent: boolean
  ): boolean => prefixNoIndent || environmentSuppressesParagraphIndent();

  const currentSimpleTexBlockItemScope = (): {
    readonly quoteDepth: number;
    readonly listScope?: SimpleTexListScope;
    readonly scopePath?: readonly SimpleTexScopePathRole[];
  } => {
    const listScope = currentSimpleTexListScope();
    const scopePath = currentSimpleTexScopePath();
    return {
      quoteDepth: currentQuoteDepth,
      ...(listScope ? { listScope } : {}),
      ...(scopePath ? { scopePath } : {}),
    };
  };

  while (index < sourceNodes.length) {
    const node = sourceNodes[index];
    if (!node) {
      unsupportedCommand = true;
      abortScan = true;
      break;
    }

    if (node.kind === "unsupported-command") {
      if (hasNonSpaceSourceText(text, blockStart, node.sourceStart, sourceOffset)) {
        unsupportedCommand = true;
        abortScan = true;
        break;
      }
      items.push({
        kind: "placeholder",
        text: node.text,
        reason: "Unsupported TeX command in vertical mode.",
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        ...currentSimpleTexBlockItemScope(),
      });
      unsupportedCommand = true;
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = noIndentForCurrentScope(prefix.noIndent);
      index = prefix.start;
      continue;
    }

    if (node.kind === "display-math") {
      pushBlock(
        blockStart,
        node.sourceStart,
        currentNoIndent,
        quotationFirstLineIndentEm(),
        currentQuoteDepth,
        currentQuotationDepth,
        prefix.alignment,
        prefix.alignmentProfile
      );
      if (abortScan) {
        break;
      }
      items.push({
        kind: "display-math",
        text: node.text,
        delimiter: node.delimiter,
        content: node.content,
        contentStart: node.contentStart,
        contentEnd: node.contentEnd,
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        ...currentSimpleTexBlockItemScope(),
      });
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = true;
      index = prefix.start;
      continue;
    }

    if (node.kind === "paragraph-break") {
      pushBlock(
        blockStart,
        node.sourceStart,
        currentNoIndent,
        quotationFirstLineIndentEm(),
        currentQuoteDepth,
        currentQuotationDepth,
        prefix.alignment,
        prefix.alignmentProfile
      );
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = noIndentForCurrentScope(prefix.noIndent);
      index = prefix.start;
      continue;
    }

    if (node.kind === "environment-boundary") {
      pushBlock(
        blockStart,
        node.sourceStart,
        currentNoIndent || environmentSuppressesParagraphIndent(),
        quotationFirstLineIndentEm(),
        currentQuoteDepth,
        currentQuotationDepth,
        prefix.alignment,
        prefix.alignmentProfile
      );
      if (abortScan) {
        break;
      }
      if (node.boundary === "begin") {
        let scopeRole: ActiveSimpleTexEnvironment["scopeRole"];
        if (isSimpleTexQuoteEnvironmentName(node.name)) {
          scopeRole = beginQuote(node.name);
        } else if (isSimpleTexTrivlistEnvironmentName(node.name)) {
          scopeRole = beginTrivlist(node.name);
        } else if (isSimpleTexListEnvironmentName(node.name)) {
          scopeRole = beginList(node.name);
        } else {
          unsupportedCommand = true;
          abortScan = true;
          break;
        }
        environmentStack.push({ name: node.name, scopeRole });
        scopeStack.push(scopeRole);
      } else {
        const openEnvironment = environmentStack.pop();
        if (openEnvironment?.name !== node.name) {
          unsupportedCommand = true;
          abortScan = true;
          break;
        }
        const openScope = scopeStack.pop();
        if (openScope !== openEnvironment.scopeRole) {
          unsupportedCommand = true;
          abortScan = true;
          break;
        }
        if (isSimpleTexQuoteEnvironmentName(node.name)) {
          endQuote(node.name);
          if (currentQuoteDepth < 0) {
            unsupportedCommand = true;
            abortScan = true;
            break;
          }
        } else if (isSimpleTexListEnvironmentName(node.name)) {
          listStack.pop();
          pendingListLabel = undefined;
          pendingListShowLabel = false;
        } else if (!isSimpleTexTrivlistEnvironmentName(node.name)) {
          unsupportedCommand = true;
          abortScan = true;
          break;
        }
      }
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = noIndentForCurrentScope(prefix.noIndent);
      index = prefix.start;
      continue;
    }

    if (node.kind === "item") {
      pushBlock(
        blockStart,
        node.sourceStart,
        currentNoIndent || environmentSuppressesParagraphIndent(),
        quotationFirstLineIndentEm(),
        currentQuoteDepth,
        currentQuotationDepth,
        prefix.alignment,
        prefix.alignmentProfile
      );
      if (abortScan) {
        break;
      }
      const activeList = listStack.at(-1);
      if (!activeList) {
        unsupportedCommand = true;
        abortScan = true;
        break;
      }
      activeList.itemIndex += 1;
      pendingListShowLabel = true;
      pendingListLabel = node.labelNodes && node.labelSourceStart !== undefined && node.labelSourceEnd !== undefined
        ? {
            nodes: node.labelNodes,
            sourceStart: node.labelSourceStart,
            sourceEnd: node.labelSourceEnd,
          }
        : undefined;
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = true;
      index = prefix.start;
      continue;
    }

    if (node.kind === "vertical-glue") {
      if (hasNonSpaceSourceText(text, blockStart, node.sourceStart, sourceOffset)) {
        unsupportedCommand = true;
        abortScan = true;
        break;
      }
      items.push({
        kind: "vertical-glue",
        text: node.text,
        command: node.command,
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        size: node.size,
        stretch: node.stretch,
        shrink: node.shrink,
        stretchOrder: node.stretchOrder,
        shrinkOrder: node.shrinkOrder,
        ...currentSimpleTexBlockItemScope(),
      });
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = noIndentForCurrentScope(prefix.noIndent);
      index = prefix.start;
      continue;
    }

    if (node.kind === "vertical-rule") {
      if (hasNonSpaceSourceText(text, blockStart, node.sourceStart, sourceOffset)) {
        unsupportedCommand = true;
        abortScan = true;
        break;
      }
      items.push({
        kind: "vertical-rule",
        text: node.text,
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        width: node.width,
        height: node.height,
        depth: node.depth,
        ...currentSimpleTexBlockItemScope(),
      });
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = noIndentForCurrentScope(prefix.noIndent);
      index = prefix.start;
      continue;
    }

    if (node.kind === "penalty") {
      if (hasNonSpaceSourceText(text, blockStart, node.sourceStart, sourceOffset)) {
        unsupportedCommand = true;
        abortScan = true;
        break;
      }
      items.push({
        kind: "penalty",
        text: node.text,
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        penalty: node.penalty,
        ...currentSimpleTexBlockItemScope(),
      });
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = noIndentForCurrentScope(prefix.noIndent);
      index = prefix.start;
      continue;
    }

    if (node.kind === "box") {
      if (hasNonSpaceSourceText(text, blockStart, node.sourceStart, sourceOffset)) {
        unsupportedCommand = true;
        abortScan = true;
        break;
      }
      const body = rebaseSimpleTexBoxBody(node.body, blocks.length);
      blocks.push(...body.blocks);
      items.push({
        kind: "box",
        text: node.text,
        command: node.command,
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        width: node.width,
        ...(node.height !== undefined ? { height: node.height } : {}),
        alignment: node.alignment,
        contentStart: node.contentStart,
        contentEnd: node.contentEnd,
        ...currentSimpleTexBlockItemScope(),
        items: body.items,
      });
      unsupportedCommand ||= node.body.unsupportedCommand;
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = noIndentForCurrentScope(prefix.noIndent);
      index = prefix.start;
      continue;
    }

    if (node.kind === "noindent" || node.kind === "alignment") {
      unsupportedCommand = true;
      abortScan = true;
      break;
    }

    index += 1;
  }
  if (!abortScan) {
    if (
      currentQuoteDepth !== 0 ||
      listStack.length !== 0 ||
      environmentStack.length !== 0 ||
      scopeStack.length !== 0
    ) {
      unsupportedCommand = true;
      abortScan = true;
    }
  }
  if (!abortScan) {
    pushBlock(
      blockStart,
      sourceEnd,
      currentNoIndent || environmentSuppressesParagraphIndent(),
      quotationFirstLineIndentEm(),
      currentQuoteDepth,
      currentQuotationDepth,
      prefix.alignment,
      prefix.alignmentProfile
    );
  }
  return {
    blocks,
    items,
    partialFallbackSupported: unsupportedCommand && !abortScan,
    unsupportedCommand,
  };
}

function hasNonSpaceSourceText(
  text: string,
  start: number,
  end: number,
  sourceOffset = 0
): boolean {
  for (let index = start; index < end; index += 1) {
    const char = text[index - sourceOffset];
    if (char !== " " && char !== "\n") {
      return true;
    }
  }
  return false;
}

function rebaseSimpleTexBoxBody(
  body: SimpleTexParagraphIr,
  blockIndexOffset: number
): {
  readonly blocks: readonly SimpleTexParagraphBlock[];
  readonly items: readonly SimpleTexBlockItem[];
} {
  return {
    blocks: body.blocks,
    items: rebaseSimpleTexBlockItems(body.items, blockIndexOffset),
  };
}

function rebaseSimpleTexBlockItems(
  items: readonly SimpleTexBlockItem[],
  blockIndexOffset: number
): readonly SimpleTexBlockItem[] {
  return items.map((item) => {
    if (item.kind === "paragraph") {
      return {
        ...item,
        blockIndex: item.blockIndex + blockIndexOffset,
      };
    }
    if (item.kind === "box") {
      return {
        ...item,
        items: rebaseSimpleTexBlockItems(item.items, blockIndexOffset),
      };
    }
    return item;
  });
}

function simpleTexBlockItemsContainPlaceholder(
  items: readonly SimpleTexBlockItem[]
): boolean {
  return items.some((item) =>
    item.kind === "placeholder" ||
    (item.kind === "box" && simpleTexBlockItemsContainPlaceholder(item.items))
  );
}

export function splitSimpleTexParagraphSegments(
  block: SimpleTexSegmentInput,
  options: SimpleTexIrOptions,
  alignment: TexParagraphAlignment,
  blockIndex: number
): SimpleTexParagraphSegment[] {
  const initialNoIndent =
    block.noIndent ||
    block.quotationItemFirstParagraph === true ||
    (options.tikzTextWidthNode === true && blockIndex === 0);
  if (alignment === "justified") {
    return [{
      text: block.text,
      sourceStart: block.sourceSpan.start,
      sourceEnd: block.sourceSpan.end,
      nodes: block.nodes,
      noIndent: initialNoIndent,
      ...(block.firstLineIndentEm !== undefined
        ? { firstLineIndentEm: block.firstLineIndentEm }
        : {}),
      ...(block.quotationItemFirstParagraph === true
        ? { quotationItemFirstParagraph: true }
        : {}),
    }];
  }

  const segments: SimpleTexParagraphSegment[] = [];
  let segmentStart = block.sourceSpan.start;
  let nodeStart = 0;
  let noIndent = initialNoIndent;

  const pushSegment = (
    rawStart: number,
    rawEnd: number,
    rawNodes: readonly SimpleTexInlineNode[],
    segmentNoIndent: boolean,
    firstLineIndentEm: number | undefined,
    forcedBreakAfter?: SimpleTexParagraphSegment["forcedBreakAfter"]
  ) => {
    let start = rawStart;
    let end = rawEnd;
    while (start < end && (textCharAtSource(block, start) === " " || textCharAtSource(block, start) === "\n")) {
      start += 1;
    }
    while (end > start && (textCharAtSource(block, end - 1) === " " || textCharAtSource(block, end - 1) === "\n")) {
      end -= 1;
    }
    if (start < end) {
      segments.push({
        text: block.text.slice(start - block.sourceSpan.start, end - block.sourceSpan.start),
        sourceStart: start,
        sourceEnd: end,
        nodes: rawNodes.filter((node) =>
          node.sourceStart >= start &&
          node.sourceEnd <= end
        ),
        noIndent: segmentNoIndent,
        ...(firstLineIndentEm !== undefined ? { firstLineIndentEm } : {}),
        ...(block.quotationItemFirstParagraph === true && segments.length === 0
          ? { quotationItemFirstParagraph: true }
          : {}),
        forcedBreakAfter,
      });
    }
  };

  for (let index = 0; index < block.nodes.length; index += 1) {
    const node = block.nodes[index];
    if (node.kind !== "line-break" || (node.priority !== undefined && node.priority < 4)) {
      continue;
    }

    pushSegment(
      segmentStart,
      node.sourceStart,
      block.nodes.slice(nodeStart, index),
      noIndent,
      block.firstLineIndentEm,
      {
        sourceOffset: node.sourceStart,
        lineLeading: node.lineLeading,
      }
    );
    index += 1;
    while (block.nodes[index]?.kind === "space") {
      index += 1;
    }
    segmentStart = block.nodes[index]?.sourceStart ?? block.sourceSpan.end;
    nodeStart = index;
    noIndent = block.quoteDepth > 0 || noIndentAfterForcedBreak(options, alignment);
    index -= 1;
  }

  pushSegment(
    segmentStart,
    block.sourceSpan.end,
    block.nodes.slice(nodeStart),
    noIndent,
    block.firstLineIndentEm
  );
  return segments;
}

function textCharAtSource(block: SimpleTexSegmentInput, sourceOffset: number): string {
  return block.text[sourceOffset - block.sourceSpan.start] ?? "";
}

function noIndentAfterForcedBreak(
  options: SimpleTexIrOptions,
  alignment: TexParagraphAlignment
): boolean {
  return !(
    options.tikzTextWidthNode === true &&
    alignment !== "justified" &&
    Number.isFinite(options.parindent) &&
    options.parindent !== undefined &&
    options.parindent > 0
  );
}

export function simpleTexInlineNodesToTokens(
  nodes: readonly SimpleTexInlineNode[],
  fontState: SimpleTexFontState = defaultSimpleTexFontState
): SimpleTexToken[] {
  const tokens: SimpleTexToken[] = [];
  let skipPostLineBreakSpace = false;
  let activeFontState = fontState;

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    if (node.kind === "line-break") {
      while (tokens.at(-1)?.kind === "space") {
        tokens.pop();
      }
      if (node.priority !== undefined && node.priority < 4) {
        const penalties = [0, -51, -151, -301] as const;
        tokens.push({
          kind: "penalty",
          text: node.text,
          sourceStart: node.sourceStart,
          sourceEnd: node.sourceEnd,
          penalty: penalties[node.priority as 0 | 1 | 2 | 3],
          fontState: activeFontState,
        });
      } else {
        tokens.push({
          kind: "forced-break",
          text: node.text,
          sourceStart: node.sourceStart,
          sourceEnd: node.sourceEnd,
          lineLeading: node.lineLeading,
          fontState: activeFontState,
        });
        skipPostLineBreakSpace = true;
      }
      continue;
    }

    if (node.kind === "font-command") {
      const childFontState = simpleTexFontStateForCommand(activeFontState, node.command);
      if (
        simpleTexFontStateHasItalicCorrection(activeFontState) &&
        !simpleTexFontStateHasItalicCorrection(childFontState)
      ) {
        markLastTextTokenItalicCorrection(tokens);
      }
      const childTokens = simpleTexInlineNodesToTokens(
        node.children,
        childFontState
      );
      markLastTextTokenItalicCorrection(childTokens);
      if (skipPostLineBreakSpace && childTokens[0]?.kind === "space") {
        tokens.push(...childTokens.slice(1));
      } else {
        tokens.push(...childTokens);
      }
      skipPostLineBreakSpace = childTokens.at(-1)?.kind === "forced-break";
      continue;
    }

    if (node.kind === "color-command") {
      const childTokens = simpleTexInlineNodesToTokens(node.children, {
        ...activeFontState,
        color: node.color,
      });
      if (skipPostLineBreakSpace && childTokens[0]?.kind === "space") {
        tokens.push(...childTokens.slice(1));
      } else {
        tokens.push(...childTokens);
      }
      skipPostLineBreakSpace = childTokens.at(-1)?.kind === "forced-break";
      continue;
    }

    if (node.kind === "math") {
      tokens.push({
        kind: "math",
        text: node.text,
        delimiter: node.delimiter,
        content: node.content,
        contentStart: node.contentStart,
        contentEnd: node.contentEnd,
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        fontState: activeFontState,
      });
      skipPostLineBreakSpace = false;
      continue;
    }

    if (node.kind === "mbox") {
      tokens.push({
        kind: "mbox",
        text: node.text,
        content: node.content,
        contentStart: node.contentStart,
        contentEnd: node.contentEnd,
        children: node.children,
        command: node.command,
        boxWidth: node.boxWidth,
        boxAlign: node.boxAlign,
        backgroundColor: node.backgroundColor,
        frameColor: node.frameColor,
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        fontState: activeFontState,
      });
      skipPostLineBreakSpace = false;
      continue;
    }

    if (node.kind === "rule") {
      tokens.push({
        kind: "rule",
        text: node.text,
        ruleRaise: node.raise,
        ruleWidth: node.width,
        ruleHeight: node.height,
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        fontState: activeFontState,
      });
      skipPostLineBreakSpace = false;
      continue;
    }

    if (node.kind === "includegraphics") {
      tokens.push({
        kind: "includegraphics",
        text: node.text,
        graphicsFilename: node.filename,
        graphicsFilenameStart: node.filenameStart,
        graphicsFilenameEnd: node.filenameEnd,
        graphicsOptions: node.options,
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        fontState: activeFontState,
      });
      skipPostLineBreakSpace = false;
      continue;
    }

    if (node.kind === "raisebox") {
      tokens.push({
        kind: "raisebox",
        text: node.text,
        content: node.content,
        contentStart: node.contentStart,
        contentEnd: node.contentEnd,
        children: node.children,
        lift: node.lift,
        relativeLiftEm: node.relativeLiftEm,
        childFontScale: node.childFontScale,
        boxHeight: node.boxHeight,
        boxDepth: node.boxDepth,
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        fontState: activeFontState,
      });
      skipPostLineBreakSpace = false;
      continue;
    }

    if (node.kind === "dimension-box") {
      tokens.push({
        kind: "dimension-box",
        text: node.text,
        content: node.content,
        contentStart: node.contentStart,
        contentEnd: node.contentEnd,
        children: node.children,
        dimensionCommand: node.command,
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        fontState: activeFontState,
      });
      skipPostLineBreakSpace = false;
      continue;
    }

    if (node.kind === "font-declaration") {
      activeFontState = simpleTexFontStateForDeclaration(
        activeFontState,
        node.command
      );
      continue;
    }


    if (node.kind === "style-declaration") {
      activeFontState = {
        ...activeFontState,
        ...(node.sizePt !== undefined ? { sizePt: node.sizePt } : {}),
        ...(node.color !== undefined ? { color: node.color } : {}),
      };
      continue;
    }

    if (node.kind === "group") {
      const childTokens = simpleTexInlineNodesToTokens(
        node.children,
        activeFontState
      );
      if (skipPostLineBreakSpace && childTokens[0]?.kind === "space") {
        tokens.push(...childTokens.slice(1));
      } else {
        tokens.push(...childTokens);
      }
      skipPostLineBreakSpace = childTokens.at(-1)?.kind === "forced-break";
      continue;
    }

    if (node.kind === "space") {
      if (skipPostLineBreakSpace) {
        continue;
      }
      tokens.push({
        kind: "space",
        text: " ",
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        fontState: activeFontState,
        nonBreaking: node.nonBreaking,
      });
      continue;
    }

    if (node.kind === "literal") {
      // Literal source is displayed in the typewriter face; OT1 typewriter
      // keeps \ { } _ # % ^ ~ & at their ASCII positions, unlike roman.
      const literalFontState: SimpleTexFontState = {
        ...activeFontState,
        family: "typewriter",
        series: "medium",
        shape: "upright",
      };
      const literalInfo: SimpleTexTokenLiteralInfo = node.detail
        ? { reason: node.reason, detail: node.detail }
        : { reason: node.reason };
      // Split on whitespace: text tokens must not contain spaces (TFM fonts
      // have no glyph at 0x20), and spaces are the only break opportunities
      // inside a literal run.
      const pattern = /([ \n]+)|([^ \n]+)/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(node.text)) !== null) {
        const segmentStart = node.sourceStart + match.index;
        const segmentEnd = segmentStart + match[0].length;
        if (match[1] !== undefined) {
          tokens.push({
            kind: "space",
            text: " ",
            sourceStart: segmentStart,
            sourceEnd: segmentEnd,
            fontState: literalFontState,
            literal: literalInfo,
          });
        } else {
          tokens.push({
            kind: "text",
            text: match[0],
            sourceStart: segmentStart,
            sourceEnd: segmentEnd,
            fontState: literalFontState,
            literal: literalInfo,
          });
        }
      }
      skipPostLineBreakSpace = false;
      continue;
    }

    skipPostLineBreakSpace = false;
    tokens.push({
      kind: "text",
      text: node.text,
      sourceStart: node.sourceStart,
      sourceEnd: node.sourceEnd,
      fontState: activeFontState,
    });
  }
  return tokens;
}

function simpleTexFontStateHasItalicCorrection(
  state: SimpleTexFontState | undefined
): boolean {
  return state?.shape === "italic" || state?.shape === "slanted";
}

function markLastTextTokenItalicCorrection(tokens: SimpleTexToken[]): void {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token?.kind !== "text") {
      continue;
    }
    tokens[index] = {
      ...token,
      italicCorrectionAfter: true,
    };
    break;
  }
}

export function simpleTexFontStateForCommand(
  current: SimpleTexFontState,
  command: SimpleTexFontCommandName
): SimpleTexFontState {
  if (command === "textit") {
    return { ...current, shape: "italic" };
  }
  if (command === "textsl") {
    return { ...current, shape: "slanted" };
  }
  if (command === "textup") {
    return { ...current, shape: "upright" };
  }
  if (command === "textbf") {
    return { ...current, series: "bold" };
  }
  if (command === "textmd") {
    return { ...current, series: "medium" };
  }
  if (command === "texttt") {
    return { ...current, family: "typewriter" };
  }
  if (command === "emph") {
    return {
      ...current,
      shape: current.shape === "italic" ? "upright" : "italic",
    };
  }
  if (command === "textnormal") {
    return { ...luaLatexNormalFontState, sizePt: current.sizePt, color: current.color };
  }
  if (command === "textsf") {
    return { ...current, family: "sans" };
  }
  if (command === "textsc") {
    return { ...current, shape: "small-caps" };
  }
  return { ...current, family: "roman" };
}

function simpleTexFontStateForDeclaration(
  current: SimpleTexFontState,
  command: SimpleTexFontDeclarationName
): SimpleTexFontState {
  if (command === "it") {
    return { ...defaultSimpleTexFontState, shape: "italic" };
  }
  if (command === "bf") {
    return { ...defaultSimpleTexFontState, series: "bold" };
  }
  if (command === "rm") {
    return defaultSimpleTexFontState;
  }
  if (command === "sf") {
    return { ...defaultSimpleTexFontState, family: "sans" };
  }
  if (command === "sl") {
    return { ...defaultSimpleTexFontState, shape: "slanted" };
  }
  if (command === "sc") {
    return { ...defaultSimpleTexFontState, shape: "small-caps" };
  }
  if (command === "tt") {
    return { ...defaultSimpleTexFontState, family: "typewriter" };
  }
  if (command === "em") {
    return {
      ...current,
      shape: current.shape === "italic" ? "upright" : "italic",
    };
  }
  if (command === "normalfont") {
    return { ...luaLatexNormalFontState, sizePt: current.sizePt, color: current.color };
  }
  if (command === "itshape") {
    return { ...current, shape: "italic" };
  }
  if (command === "slshape") {
    return { ...current, shape: "slanted" };
  }
  if (command === "upshape") {
    return { ...current, shape: "upright" };
  }
  if (command === "scshape") {
    return { ...current, shape: "small-caps" };
  }
  if (command === "bfseries") {
    return { ...current, series: "bold" };
  }
  if (command === "mdseries") {
    return { ...current, series: "medium" };
  }
  if (command === "sffamily") {
    return { ...current, family: "sans" };
  }
  if (command === "ttfamily") {
    return { ...current, family: "typewriter" };
  }
  return { ...current, family: "roman" };
}
