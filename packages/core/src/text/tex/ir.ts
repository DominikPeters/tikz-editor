import { parseTexTabular, tabularGroup } from "./tabular/parser.js";
import type { TexTabular, TexTabularAssignmentFont, TexTabularRegisters } from "./tabular/types.js";
import type { SyntaxNodeRef } from "@lezer/common";
import { freezeTexCacheValue, TexWeightedLruCache } from "./cache.js";
import {
  beamerDocumentParser,
  texFragmentParser,
} from "@tikz-editor/lezer-tex";
import type { ParagraphAlignment } from "../knuth-plass/alignment.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";
import { parseLength } from "../../semantic/coords/parse-length.js";
import {
  parseTexDimensionExpression,
  parseTexDimensionText,
  type TexDimensionExpression,
} from "./dimensions.js";
import { normalizeColor, resolveDefineColorModel, type ColorAliasResolver } from "../../semantic/style/colors.js";
import { DEFAULT_TEXT_FONT_SIZE, FONT_SIZE_COMMAND_FACTORS } from "../../semantic/style/constants.js";
import {
  texHBoxOffsetY,
  texLength,
  type TexHBoxOffsetY,
  type TexLength,
} from "./coordinates.js";
import {
  getTexSyntaxIndex,
  matchTexSyntaxEnvironments,
  type TexSyntaxIndex,
  type TexSyntaxMatchedEnvironment,
} from "./syntax-index.js";

export type TexParagraphAlignment = ParagraphAlignment;
export type TexAlignmentProfile = "latex-declaration" | "latex-quote";
export type TexSpaceGlueProfile = "font" | "font-fixed" | "tikz-fixed";
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
  | "description"
  | "bibliography";
export type SimpleTexListKind = "itemize" | "enumerate" | "description" | "bibliography";
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
  readonly sizePt?: TexLength;
  readonly baselineSkipPt?: TexLength;
  /** CSS color normalized from the xcolor spelling in the source. */
  readonly color?: string;
  readonly tabularRegisters?: TexTabularRegisters;
}

interface SimpleTexSourceRange {
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

export interface SimpleTexTextNode extends SimpleTexSourceRange {
  readonly kind: "text";
  readonly text: string;
  readonly breakAfterPenalty?: number;
}

export interface SimpleTexSpaceNode extends SimpleTexSourceRange {
  readonly kind: "space";
  readonly text: string;
  /** TeX's active `~` space: visible glue without a line-break opportunity. */
  readonly nonBreaking?: boolean;
  /** TeX's control space uses font space without punctuation's space factor. */
  readonly controlSpace?: boolean;
}

export interface SimpleTexCommentNode extends SimpleTexSourceRange {
  readonly kind: "comment";
  readonly text: string;
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

export interface SimpleTexTabularNode extends SimpleTexSourceRange {
  readonly kind: "tabular";
  readonly text: string;
  readonly table: TexTabular;
}
export type SimpleTexTransformCommandName = "rotatebox" | "scalebox" | "resizebox" | "reflectbox";
export interface SimpleTexTransformNode extends SimpleTexSourceRange {
  readonly kind: "transform-box";
  readonly command: SimpleTexTransformCommandName;
  readonly text: string;
  readonly content: string;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly children: readonly SimpleTexNode[];
  readonly parameters:
    | { readonly kind: "rotate"; readonly angle: number; readonly options?: OptionListAst }
    | { readonly kind: "scale"; readonly x: number; readonly y: number }
    | { readonly kind: "resize"; readonly width: string; readonly height: string; readonly totalHeight: boolean };
}

export interface SimpleTexStyleDeclarationNode extends SimpleTexSourceRange {
  readonly kind: "style-declaration";
  readonly text: string;
  readonly sizePt?: TexLength;
  readonly baselineSkipPt?: TexLength;
  readonly sizeScope?: { readonly boundary: "begin" | "end"; readonly name: string };
  readonly sizeCommand?: string;
  readonly listRegisters?: Partial<Record<"topsep" | "partopsep" | "itemsep" | "parsep" | "parskip", string>>;
  readonly color?: string;
  readonly tabularRegisters?: TexTabularRegisters;
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
  readonly boxWidth?: TexLength;
  readonly boxAlign?: SimpleTexTextBoxAlignment;
  /** Background and frame colors normalized from xcolor syntax. */
  readonly backgroundColor?: string;
  readonly frameColor?: string;
}

export interface SimpleTexRuleNode extends SimpleTexSourceRange {
  readonly kind: "rule";
  readonly text: string;
  readonly raise: TexHBoxOffsetY;
  readonly width: TexLength;
  readonly height: TexLength;
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
  readonly optionList?: OptionListAst;
  readonly width?: TexDimensionExpression;
  readonly height?: TexDimensionExpression;
  readonly scale?: number;
  readonly keepAspectRatio?: boolean;
  readonly page?: SimpleTexGraphicsPageOption;
  readonly trim?: SimpleTexGraphicsTrim;
  readonly viewport?: SimpleTexGraphicsViewport;
  readonly clip?: boolean;
  readonly raw: string;
}

export type SimpleTexGraphicsPageOption =
  | {
      readonly status: "valid";
      readonly pageNumber: number;
    }
  | {
      readonly status: "invalid";
      readonly raw: string;
      readonly reason: string;
    };

export interface SimpleTexGraphicsTrim {
  readonly left: TexLength;
  readonly bottom: TexLength;
  readonly right: TexLength;
  readonly top: TexLength;
}

export interface SimpleTexGraphicsViewport {
  readonly llx: TexLength;
  readonly lly: TexLength;
  readonly urx: TexLength;
  readonly ury: TexLength;
}

export interface SimpleTexRaiseBoxNode extends SimpleTexSourceRange {
  readonly kind: "raisebox";
  readonly text: string;
  readonly lift: TexHBoxOffsetY;
  /** Lift relative to the surrounding text size, used by text super/subscripts. */
  readonly relativeLiftEm?: number;
  /** Child font scale relative to the surrounding text size. */
  readonly childFontScale?: number;
  readonly boxHeight?: TexLength;
  readonly boxDepth?: TexLength;
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
  readonly size: TexLength;
  readonly relativeSize?: {
    readonly value: number;
    readonly unit: "em" | "ex";
  };
  readonly stretch?: TexLength;
  readonly shrink?: TexLength;
  readonly stretchOrder?: "normal" | "fil" | "fill" | "filll";
  readonly shrinkOrder?: "normal" | "fil" | "fill" | "filll";
}

export interface SimpleTexVerticalRuleNode extends SimpleTexSourceRange {
  readonly kind: "vertical-rule";
  readonly text: string;
  readonly width: TexLength;
  readonly height: TexLength;
  readonly depth: TexLength;
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
  readonly width: TexLength;
  readonly height?: TexLength;
  readonly alignment: SimpleTexBoxAlignment;
  readonly content: string;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly body: SimpleTexParagraphIr;
}

export type SimpleTexInlineNode =
  | SimpleTexTextNode
  | SimpleTexSpaceNode
  | SimpleTexCommentNode
  | SimpleTexLineBreakNode
  | SimpleTexMathNode
  | SimpleTexTabularNode
  | SimpleTexTransformNode
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
  "comment",
  "line-break",
  "math",
  "tabular",
  "transform-box",
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
  readonly kind: "text" | "space" | "forced-break" | "penalty" | "math" | "mbox" | "rule" | "includegraphics" | "raisebox" | "dimension-box" | "tabular" | "transform-box";
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly table?: TexTabular;
  readonly transformBox?: SimpleTexTransformNode;
  readonly delimiter?: "dollar" | "paren";
  readonly content?: string;
  readonly contentStart?: number;
  readonly contentEnd?: number;
  readonly children?: readonly SimpleTexInlineNode[];
  readonly command?: SimpleTexTextBoxCommandName;
  readonly dimensionCommand?: SimpleTexDimensionBoxCommandName;
  readonly boxWidth?: TexLength;
  readonly boxAlign?: SimpleTexTextBoxAlignment;
  readonly backgroundColor?: string;
  readonly frameColor?: string;
  readonly ruleRaise?: TexHBoxOffsetY;
  readonly ruleWidth?: TexLength;
  readonly ruleHeight?: TexLength;
  readonly graphicsFilename?: string;
  readonly graphicsFilenameStart?: number;
  readonly graphicsFilenameEnd?: number;
  readonly graphicsOptions?: SimpleTexGraphicsOptions;
  readonly lift?: TexHBoxOffsetY;
  readonly relativeLiftEm?: number;
  readonly childFontScale?: number;
  readonly boxHeight?: TexLength;
  readonly boxDepth?: TexLength;
  readonly lineLeading?: string;
  readonly penalty?: number;
  readonly fontState: SimpleTexFontState;
  readonly nonBreaking?: boolean;
  readonly controlSpace?: boolean;
  readonly italicCorrectionAfter?: boolean;
  readonly literal?: SimpleTexTokenLiteralInfo;
}

export interface SimpleTexTokenLiteralInfo {
  readonly reason: SimpleTexLiteralReason;
  readonly detail?: string;
}

export interface SimpleTexParagraphBlock {
  /** List-scoped declarations inherited before this source-owned paragraph. */
  readonly inheritedFontState?: Pick<SimpleTexFontState, "family" | "series" | "shape">;
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly nodes: readonly SimpleTexInlineNode[];
  readonly fontSizePt?: TexLength;
  readonly baselineSkip?: TexLength;
  /**
   * LaTeX lowers `\vspace` encountered in horizontal mode to `\vadjust`.
   * Keep those adjustments attached to the unbroken paragraph so line
   * breaking remains independent from vertical-list placement.
   */
  readonly verticalAdjustments?: readonly SimpleTexVerticalGlueBlockItem[];
  readonly noIndent: boolean;
  readonly startsAfterExplicitPar?: boolean;
  readonly firstLineIndentEm?: number;
  /** A source space retained when horizontal mode resumes after display math. */
  readonly leadingInterwordSpace?: boolean;
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
  readonly size: TexLength;
  readonly relativeSize?: {
    readonly value: number;
    readonly unit: "em" | "ex";
  };
  readonly stretch?: TexLength;
  readonly shrink?: TexLength;
  readonly stretchOrder?: "normal" | "fil" | "fill" | "filll";
  readonly shrinkOrder?: "normal" | "fil" | "fill" | "filll";
  readonly quoteDepth: number;
  readonly listScope?: SimpleTexListScope;
  readonly scopePath?: readonly SimpleTexScopePathRole[];
}

export interface SimpleTexVerticalRuleBlockItem extends SimpleTexSourceRange {
  readonly kind: "vertical-rule";
  readonly text: string;
  readonly width: TexLength;
  readonly height: TexLength;
  readonly depth: TexLength;
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

export interface SimpleTexDisplayMathState {
  readonly fontSizePt?: TexLength;
  readonly baselineSkip?: TexLength;
  /** Only class size commands that assign display registers replace this state. */
  readonly displaySkipCommand?: "normalsize" | "small" | "footnotesize";
  readonly normalFontSizePt?: TexLength;
}

export interface SimpleTexDisplayMathBlockItem extends SimpleTexSourceRange, SimpleTexDisplayMathState {
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
  readonly width: TexLength;
  readonly height?: TexLength;
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
  /** Distinguishes adjacent authored lists with the same kind and depth. */
  readonly listStart?: number;
  readonly kind: SimpleTexListKind;
  readonly depth: number;
  readonly labelDepth: number;
  readonly itemIndex: number;
  /** Authored item command owning both generated and custom labels. */
  readonly itemCommandSpan?: { readonly start: number; readonly end: number };
  readonly ownLeftMarginEm: number;
  readonly totalLeftMarginEm: number;
  readonly showLabel: boolean;
  readonly label?: SimpleTexListLabel;
  readonly fontSizePt?: TexLength;
  readonly spacing?: Partial<Record<"topsep" | "partopsep" | "itemsep" | "parsep" | "parskip", { readonly sizePt: number; readonly stretchPt: number; readonly shrinkPt: number }>>;
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
  readonly leadingInterwordSpace?: boolean;
  readonly quotationItemFirstParagraph?: boolean;
  readonly forcedBreakAfter?: {
    readonly sourceOffset: number;
    readonly lineLeading?: string;
  };
}

export interface SimpleTexSegmentInput {
  readonly inheritedFontState?: Pick<SimpleTexFontState, "family" | "series" | "shape">;
  readonly text: string;
  readonly sourceSpan: {
    readonly start: number;
    readonly end: number;
  };
  readonly nodes: readonly SimpleTexInlineNode[];
  readonly noIndent: boolean;
  readonly listContext?: SimpleTexListContext;
  readonly startsAfterExplicitPar?: boolean;
  readonly firstLineIndentEm?: number;
  readonly leadingInterwordSpace?: boolean;
  readonly quotationItemFirstParagraph?: boolean;
  readonly quoteDepth: number;
  readonly quotationDepth?: number;
  readonly scopePath?: readonly SimpleTexScopePathRole[];
}

export interface SimpleTexListItemTopology {
  /** The `\item` token, including an optional `[label]` and trailing spaces. */
  readonly commandSpan: SimpleTexTopologySpan;
  /** Content of the optional `[label]` argument, when present. */
  readonly labelSpan?: SimpleTexTopologySpan;
  /**
   * Item body: first content offset (after the command and any space/prefix
   * nodes) through the next structural token (`\item` or `\end`) of the
   * owning environment. Empty items have `from === to`.
   */
  readonly contentSpan: SimpleTexTopologySpan;
  /** One-based ordinal within the owning environment. */
  readonly itemIndex: number;
}

export interface SimpleTexTopologySpan {
  readonly from: number;
  readonly to: number;
}

/**
 * A list environment the block scan matched, with the source facts
 * structural editing needs. Retained at parse time so downstream editors
 * never re-interpret `\item` topology from raw source.
 */
export interface SimpleTexListTopology {
  readonly name: SimpleTexListKind;
  /** The `\begin{...}` boundary token. */
  readonly beginSpan: SimpleTexTopologySpan;
  /** The `\end{...}` boundary token. */
  readonly endSpan: SimpleTexTopologySpan;
  /** One-based nesting depth among list environments in this chunk. */
  readonly depth: number;
  readonly items: readonly SimpleTexListItemTopology[];
}

export interface SimpleTexParagraphBlockScanResult {
  readonly blocks: readonly SimpleTexParagraphBlock[];
  readonly items: readonly SimpleTexBlockItem[];
  readonly partialFallbackSupported: boolean;
  readonly unsupportedCommand: boolean;
  /** List environments the scan closed, in source order; absent when the scan aborted. */
  readonly listStructure?: readonly SimpleTexListTopology[];
}

export interface SimpleTexParagraphIr {
  readonly kind: "simple-tex-paragraph";
  readonly nodes: readonly SimpleTexNode[];
  readonly blocks: readonly SimpleTexParagraphBlock[];
  readonly items: readonly SimpleTexBlockItem[];
  readonly partialFallbackSupported: boolean;
  readonly unsupportedCommand: boolean;
  readonly listStructure?: readonly SimpleTexListTopology[];
}

export interface SimpleTexParagraphAnalysis {
  readonly ir: SimpleTexParagraphIr | null;
  readonly fallbackReason: string | null;
}

export interface SimpleTexGraphicsResource {
  readonly kind: "graphics";
  readonly filename: string;
  readonly filenameStart: number;
  readonly filenameEnd: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly options: SimpleTexGraphicsOptions;
}

export interface SimpleTexResourceManifest {
  readonly graphics: readonly SimpleTexGraphicsResource[];
}

interface SimpleTexIrOptions {
  readonly parindent?: TexLength;
  readonly tikzTextWidthNode?: boolean;
}

const unsupportedDirectTextCharPattern = /[&_^~#%]/;
const lineLeadingOptionPattern =
  /^\[\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu)\s*\]/i;
const texLengthPattern =
  String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu)`;
const vskipGluePattern = new RegExp(
  String.raw`^\\vskip\s*(${texLengthPattern})(?:\s+plus\s+(${texLengthPattern}))?(?:\s+minus\s+(${texLengthPattern}))?`,
  "i"
);

function parseTexSemanticLength(text: string): TexLength | null {
  const value = parseLength(text, "pt");
  return value === null ? null : texLength(value);
}

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
const simpleTexMathBySyntaxIndex = new WeakMap<
  TexSyntaxIndex,
  ReadonlyMap<number, SimpleTexMathNode | SimpleTexDisplayMathNode>
>();
const paragraphIrCache = new TexWeightedLruCache<string, SimpleTexParagraphIr>(512, 2 * 1024 * 1024);
const paragraphIrSeen = new TexWeightedLruCache<string, true>(1024, 512 * 1024);
const PARAGRAPH_IR_MAX_SOURCE_LENGTH = 16384;

export interface SimpleTexParagraphIrOptions {
  readonly fontSizePt?: number;
  readonly baselineSkipPt?: number;
  readonly namedFontSizes?: Readonly<Record<string, { readonly sizePt: number; readonly baselineSkipPt: number }>>;
  readonly listLeftMarginEmByDepth?: readonly number[];
  /** Margins of generated Beamer bibliography lists, keyed by layout source start. */
  readonly bibliographyMargins?: ReadonlyMap<number, number>;
  /** Identifies all color alias results; change this when any alias changes. */
  readonly colorResolverCacheKey?: string;
}

export function getSimpleTexFallbackReason(text: string, width: number): string | null {
  return analyzeSimpleTexParagraph(text, width).fallbackReason;
}

export function analyzeSimpleTexParagraph(
  text: string,
  width: number,
  resolveColorAlias?: ColorAliasResolver,
  options?: SimpleTexParagraphIrOptions
): SimpleTexParagraphAnalysis {
  if (!Number.isFinite(width) || width <= 0) {
    return {
      ir: null,
      fallbackReason: "Paragraph width must be positive.",
    };
  }
  const ir = buildSimpleTexParagraphIr(text, resolveColorAlias, options);
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
    if (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) {
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
  resolveColorAlias?: ColorAliasResolver,
  options?: SimpleTexParagraphIrOptions
): SimpleTexParagraphIr {
  return buildSimpleTexParagraphIr(text, resolveColorAlias, options);
}

export interface SimpleTexSourceProjectionPolicy {
  readonly removeLineBreaks?: boolean;
  readonly removeControlParagraphBreaks?: boolean;
}

export function simpleTexSourceHasLineBreak(text: string): boolean {
  // These are the three command spellings accepted by scanSimpleTexLineBreak.
  // A possible match still goes through the IR to exclude math and comments.
  if (
    !text.includes("\\\\") &&
    !text.includes("\\newline") &&
    !text.includes("\\linebreak")
  ) {
    return false;
  }
  return collectSimpleTexPolicyRanges(
    parseSimpleTexParagraphIr(text).nodes,
    "line-break"
  ).length > 0;
}

export function splitSimpleTexSourceAtLineBreaks(text: string): string[] {
  const ranges = collectSimpleTexPolicyRanges(
    parseSimpleTexParagraphIr(text).nodes,
    "line-break"
  );
  if (ranges.length === 0) {
    return [text];
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const range of mergeSimpleTexSourceRanges(ranges)) {
    parts.push(text.slice(cursor, range.start));
    cursor = range.end;
  }
  parts.push(text.slice(cursor));
  return parts;
}

export function projectSimpleTexSourceByPolicy(
  text: string,
  policy: SimpleTexSourceProjectionPolicy
): string {
  const ir = parseSimpleTexParagraphIr(text);
  const ranges = [
    ...(policy.removeLineBreaks
      ? collectSimpleTexPolicyRanges(ir.nodes, "line-break")
      : []),
    ...(policy.removeControlParagraphBreaks
      ? collectSimpleTexPolicyRanges(ir.nodes, "control-paragraph-break")
      : []),
  ];
  if (ranges.length === 0) {
    return text;
  }
  let result = "";
  let cursor = 0;
  for (const range of mergeSimpleTexSourceRanges(ranges)) {
    result += text.slice(cursor, range.start);
    cursor = range.end;
  }
  return result + text.slice(cursor);
}

interface SimpleTexPolicySourceRange {
  readonly start: number;
  readonly end: number;
}

type SimpleTexPolicyTarget = "line-break" | "control-paragraph-break";

function collectSimpleTexPolicyRanges(
  nodes: readonly SimpleTexNode[],
  target: SimpleTexPolicyTarget,
  ranges: SimpleTexPolicySourceRange[] = []
): SimpleTexPolicySourceRange[] {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const matches =
      (target === "line-break" && node?.kind === "line-break") ||
      (target === "control-paragraph-break" &&
        node?.kind === "paragraph-break" &&
        node.breakKind === "control");
    if (node && matches) {
      const previous = nodes[index - 1];
      const next = nodes[index + 1];
      ranges.push({
        start:
          target === "line-break" && previous?.kind === "space"
            ? previous.sourceStart
            : node.sourceStart,
        end: next?.kind === "space" ? next.sourceEnd : node.sourceEnd,
      });
    }
    if (!node) {
      continue;
    }
    if (
      node.kind === "font-command" ||
      node.kind === "color-command" ||
      node.kind === "group" ||
      node.kind === "mbox" ||
      node.kind === "transform-box" ||
      node.kind === "raisebox" ||
      node.kind === "dimension-box"
    ) {
      collectSimpleTexPolicyRanges(node.children, target, ranges);
    } else if (node.kind === "item" && node.labelNodes) {
      collectSimpleTexPolicyRanges(node.labelNodes, target, ranges);
    } else if (node.kind === "box") {
      collectSimpleTexPolicyRanges(node.body.nodes, target, ranges);
    }
  }
  return ranges;
}

function mergeSimpleTexSourceRanges(
  ranges: readonly SimpleTexPolicySourceRange[]
): readonly SimpleTexPolicySourceRange[] {
  const sorted = [...ranges].sort(
    (left, right) => left.start - right.start || left.end - right.end
  );
  const merged: SimpleTexPolicySourceRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      merged[merged.length - 1] = {
        start: previous.start,
        end: Math.max(previous.end, range.end),
      };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

/**
 * Scan arbitrary TeX/TikZ document source with the same command frontend that
 * builds paragraph IR and expose its source-backed resource references.
 * Consumers must use this manifest rather than recognizing resource commands
 * independently from raw source.
 */
export function analyzeSimpleTexResources(
  text: string
): SimpleTexResourceManifest {
  const graphics: SimpleTexGraphicsResource[] = [];
  // An absence check belongs to the resource frontend; possible occurrences
  // still go through the grammar, including comments and opaque environments.
  if (!text.includes("\\includegraphics")) return { graphics };
  // Resource discovery is a document-level superset operation: Beamer's
  // overlay-qualified \includegraphics form must remain discoverable while
  // all actual command and argument boundaries still come from the CST.
  const tree = getTexSyntaxIndex(text, beamerDocumentParser).tree;
  tree.iterate({
    enter(node) {
      if (node.name !== "IncludeGraphicsCommand") {
        return;
      }
      const graphicsNode = simpleTexGraphicsNodeFromSyntax(text, node);
      if (graphicsNode) {
        graphics.push(simpleTexGraphicsResourceFromNode(graphicsNode));
      }
      return false;
    },
  });
  return { graphics };
}

function simpleTexGraphicsNodeFromSyntax(
  text: string,
  syntax: SyntaxNodeRef
): SimpleTexIncludeGraphicsNode | null {
  const option = syntax.node.getChild("OptionalArgument");
  const filenameGroup = syntax.node.getChild("Group");
  if (
    !filenameGroup ||
    text[filenameGroup.from] !== "{" ||
    text[filenameGroup.to - 1] !== "}"
  ) {
    return null;
  }

  const filenameStart = filenameGroup.from + 1;
  const filenameEnd = filenameGroup.to - 1;
  const optionList =
    option &&
    text[option.from] === "[" &&
    text[option.to - 1] === "]"
      ? parseOptionListRaw(text.slice(option.from, option.to), option.from)
      : undefined;

  return {
    kind: "includegraphics",
    text: text.slice(syntax.from, syntax.to),
    filename: text.slice(filenameStart, filenameEnd).trim(),
    filenameStart,
    filenameEnd,
    options: parseSimpleTexGraphicsOptions(optionList),
    sourceStart: syntax.from,
    sourceEnd: syntax.to,
  };
}

export function collectSimpleTexResourceManifest(
  ir: SimpleTexParagraphIr
): SimpleTexResourceManifest {
  const graphics: SimpleTexGraphicsResource[] = [];
  collectSimpleTexGraphicsResourcesFromNodes(ir.nodes, graphics);
  return { graphics };
}

function collectSimpleTexGraphicsResourcesFromNodes(
  nodes: readonly SimpleTexNode[],
  graphics: SimpleTexGraphicsResource[]
): void {
  for (const node of nodes) {
    if (node.kind === "includegraphics") {
      graphics.push(simpleTexGraphicsResourceFromNode(node));
      continue;
    }
    if (
      node.kind === "font-command" ||
      node.kind === "color-command" ||
      node.kind === "group" ||
      node.kind === "mbox" ||
      node.kind === "transform-box" ||
      node.kind === "raisebox" ||
      node.kind === "dimension-box"
    ) {
      collectSimpleTexGraphicsResourcesFromNodes(node.children, graphics);
      continue;
    }
    if (node.kind === "item" && node.labelNodes) {
      collectSimpleTexGraphicsResourcesFromNodes(node.labelNodes, graphics);
      continue;
    }
    if (node.kind === "box") {
      collectSimpleTexGraphicsResourcesFromNodes(node.body.nodes, graphics);
    }
  }
}

function simpleTexGraphicsResourceFromNode(
  node: SimpleTexIncludeGraphicsNode
): SimpleTexGraphicsResource {
  return {
    kind: "graphics",
    filename: node.filename,
    filenameStart: node.filenameStart,
    filenameEnd: node.filenameEnd,
    sourceStart: node.sourceStart,
    sourceEnd: node.sourceEnd,
    options: node.options,
  };
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
  resolveColorAlias?: ColorAliasResolver,
  options?: SimpleTexParagraphIrOptions
): SimpleTexParagraphIr {
  // A bare resolver can change its answers without changing its identity.
  // Only versioned resolvers and finite, value-keyed list settings are shared.
  const cacheable = text.length <= PARAGRAPH_IR_MAX_SOURCE_LENGTH &&
    (!resolveColorAlias || options?.colorResolverCacheKey !== undefined) &&
    (!options?.listLeftMarginEmByDepth || options.listLeftMarginEmByDepth.every(Number.isFinite)) &&
    [...(options?.bibliographyMargins?.values() ?? [])].every(Number.isFinite);
  const key = cacheable
    ? JSON.stringify([
      text,
      resolveColorAlias ? options?.colorResolverCacheKey : null,
      options?.listLeftMarginEmByDepth ?? null,
      [...(options?.bibliographyMargins ?? [])],
      options?.fontSizePt, options?.baselineSkipPt, options?.namedFontSizes,
    ])
    : null;
  if (key !== null) {
    const cached = paragraphIrCache.get(key);
    if (cached) return cached;
  }
  const reused = key !== null && paragraphIrSeen.get(key) === true;
  if (key !== null && !reused) paragraphIrSeen.set(key, true, key.length * 2 + 64);
  const ir = buildSimpleTexParagraphIrForRange(
    text,
    0,
    text.length,
    0,
    resolveColorAlias,
    options
  );
  if (key !== null && reused) {
    paragraphIrCache.set(key, ir, freezeTexCacheValue(ir) + key.length * 2);
  }
  return ir;
}

function buildSimpleTexParagraphIrForRange(
  text: string,
  start: number,
  end: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver,
  options?: SimpleTexParagraphIrOptions
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
    sourceOffset + end,
    options
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
    ...(blockScan.listStructure ? { listStructure: blockScan.listStructure } : {}),
  };
}

function scanSimpleTexIrNodes(
  text: string,
  sourceOffset = 0,
  resolveColorAlias?: ColorAliasResolver
): { nodes: readonly SimpleTexNode[]; unsupportedCommand: boolean } {
  const nodes: SimpleTexNode[] = [];
  const syntax = getTexSyntaxIndex(text, texFragmentParser);
  const matchedEnvironments = [...matchTexSyntaxEnvironments(syntax).values()];
  const matchedEnvironmentBoundaryStarts = new Set(
    matchedEnvironments.flatMap((environment) => [
      environment.begin.span.from,
      environment.end.span.from,
    ])
  );
  const mathSyntaxByStart = simpleTexMathNodes(syntax);
  let unsupportedCommand = false;
  let index = 0;

  while (index < text.length) {
    const sourceStart = sourceOffset + index;
    const char = text[index];

    const commentEnd = syntax.commentEndByStart.get(index);
    if (commentEnd !== undefined) {
      let sourceEnd = commentEnd;
      const whitespaceEnd = syntax.whitespaceEndByStart.get(commentEnd);
      if (whitespaceEnd !== undefined) {
        if (text.startsWith("\r\n", sourceEnd)) {
          sourceEnd += 2;
        } else if (text[sourceEnd] === "\n" || text[sourceEnd] === "\r") {
          sourceEnd += 1;
        }
        while (text[sourceEnd] === " " || text[sourceEnd] === "\t") {
          sourceEnd += 1;
        }
      }
      nodes.push({
        kind: "comment",
        text: text.slice(index, sourceEnd),
        sourceStart,
        sourceEnd: sourceOffset + sourceEnd,
      });
      if (whitespaceEnd !== undefined && sourceEnd < whitespaceEnd) {
        nodes.push({
          kind: "paragraph-break",
          text: text.slice(sourceEnd, whitespaceEnd),
          breakKind: "blank-line",
          sourceStart: sourceOffset + sourceEnd,
          sourceEnd: sourceOffset + whitespaceEnd,
        });
        index = whitespaceEnd;
      } else {
        index = sourceEnd;
      }
      continue;
    }

    const whitespaceEnd = syntax.whitespaceEndByStart.get(index);
    if (whitespaceEnd !== undefined) {
      appendSimpleTexWhitespaceNode(nodes, text, index, whitespaceEnd, sourceOffset);
      index = whitespaceEnd;
      continue;
    }

    const mathSyntax = mathSyntaxByStart.get(index);
    if (mathSyntax) {
      nodes.push(offsetSimpleTexMathSyntax(mathSyntax, sourceOffset));
      index = mathSyntax.sourceEnd;
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

      const url = scanSimpleTexUrl(text, index, sourceOffset);
      if (url) { nodes.push(url.node); index = url.end; continue; }

      const transform = scanSimpleTexTransformCommand(text, index, sourceOffset, resolveColorAlias);
      if (transform) { nodes.push(transform.node); index = transform.end; continue; }
      const tabularEnvironment = matchedEnvironments.find((environment) => environment.name === "tabular" && environment.begin.span.from === index);
      if (tabularEnvironment) {
        try {
          const table = parseTexTabular(text, tabularEnvironment.contentSpan.from, tabularEnvironment.contentSpan.to, sourceOffset);
          const validateCellNodes = (nodes: readonly SimpleTexNode[], paragraph: boolean): boolean => nodes.every((node) =>
            node.kind === "group" ? validateCellNodes(node.children, paragraph) : isSimpleTexInlineNode(node) || paragraph && ["paragraph-break", "alignment", "noindent"].includes(node.kind));
          const preambles = [table.preamble, ...table.items.flatMap((item) => item.kind === "row" ? item.cells.flatMap((cell) => cell.preamble ? [cell.preamble] : []) : [])];
          for (const preamble of preambles) {
            for (const column of preamble.columns) {
              if (column.before?.trim() === "$" && column.after?.trim() === "$") continue;
              for (const part of [...column.beforeParts ?? [], ...column.afterParts ?? []]) {
                const scan = scanSimpleTexIrNodes(part.text.replace(/\\arraybackslash\b/gu, ""), part.sourceStart, resolveColorAlias);
                if (scan.unsupportedCommand || !validateCellNodes(scan.nodes, Boolean(column.width))) throw new Error("Unsupported vertical material in tabular column declaration.");
              }
            }
            for (const part of preamble.boundaries.flatMap((boundary) => [...boundary.replaceParts ?? [], ...boundary.insertParts ?? []])) {
              const scan = scanSimpleTexIrNodes(part.text, part.sourceStart, resolveColorAlias);
              if (scan.unsupportedCommand || !validateCellNodes(scan.nodes, false)) throw new Error("Unsupported vertical material in tabular boundary insert.");
            }
          }
          for (const item of table.items) {
            if (item.kind !== "row") continue;
            let columnIndex = 0;
            for (const cell of item.cells) {
              const column = cell.preamble?.columns[0] ?? table.preamble.columns[columnIndex];
              if (cell.preamble?.boundaries.some((boundary) => (boundary.replace ?? "").length || (boundary.insert ?? "").length)) throw new Error("Multicolumn boundary inserts are not yet supported.");
              if (!(column.before?.trim() === "$" && column.after?.trim() === "$")) {
                const scan = scanSimpleTexIrNodes(cell.text, cell.sourceStart, resolveColorAlias);
                if (scan.unsupportedCommand || !validateCellNodes(scan.nodes, Boolean(column.width))) throw new Error("Unsupported vertical material in tabular cell.");
              }
              columnIndex += cell.span;
            }
          }
          nodes.push({ kind: "tabular", text: text.slice(index, tabularEnvironment.span.to), table, sourceStart, sourceEnd: sourceOffset + tabularEnvironment.span.to });
        } catch (error) {
          nodes.push({ kind: "literal", text: text.slice(index, tabularEnvironment.span.to), reason: "unsupported-command", detail: error instanceof Error ? error.message : "Unsupported tabular", sourceStart, sourceEnd: sourceOffset + tabularEnvironment.span.to });
        }
        index = tabularEnvironment.span.to;
        continue;
      }
      const tableRegister = scanSimpleTexTabularRegister(text, index, sourceOffset);
      if (tableRegister) { nodes.push(tableRegister.node); index = tableRegister.end; continue; }
      const sizeBoundary = syntax.environmentBoundaryByStart.get(index);
      if (sizeBoundary && matchedEnvironmentBoundaryStarts.has(index) && Object.hasOwn(FONT_SIZE_COMMAND_FACTORS, `\\${sizeBoundary.name}`)) {
        nodes.push({ kind: "style-declaration", text: text.slice(index, sizeBoundary.span.to),
          sizeScope: { boundary: sizeBoundary.kind, name: sizeBoundary.name },
          ...(sizeBoundary.kind === "begin" ? { sizePt: texLength(DEFAULT_TEXT_FONT_SIZE * FONT_SIZE_COMMAND_FACTORS[`\\${sizeBoundary.name}`]) } : {}),
          sourceStart, sourceEnd: sourceOffset + sizeBoundary.span.to });
        index = sizeBoundary.span.to;
        continue;
      }
      const listRegister = scanSimpleTexListRegister(text, index, sourceOffset);
      if (listRegister) { nodes.push(listRegister.node); index = listRegister.end; continue; }

      const environmentBoundary = scanSimpleTexEnvironmentBoundary(
        syntax,
        matchedEnvironmentBoundaryStarts,
        index
      );
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
      const malformedEnvironmentBoundary =
        scanMalformedSimpleTexEnvironmentBoundary(
          text,
          syntax,
          matchedEnvironmentBoundaryStarts,
          index
        );
      if (malformedEnvironmentBoundary) {
        nodes.push({
          kind: "literal",
          text: text.slice(index, malformedEnvironmentBoundary.end),
          reason: "malformed-input",
          detail: malformedSimpleTexEnvironmentBoundaryDetail(
            malformedEnvironmentBoundary
          ),
          sourceStart,
          sourceEnd: sourceOffset + malformedEnvironmentBoundary.end,
        });
        index = malformedEnvironmentBoundary.end;
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
      const alertCommand = scanSimpleTexAlertCommand(text, index, sourceOffset, resolveColorAlias);
      const accentCommand = scanSimpleTexAccentCommand(text, index, sourceOffset);
      if (boxEnvironment) {
        nodes.push(boxEnvironment.node);
        unsupportedCommand ||= boxEnvironment.unsupportedCommand;
        index = boxEnvironment.end;
        continue;
      }
      if (itemCommand) {
        if (isInsideMatchedSimpleTexListEnvironment(matchedEnvironments, index)) {
          nodes.push(itemCommand.node);
          unsupportedCommand ||= itemCommand.unsupportedCommand;
        } else {
          nodes.push({
            kind: "literal",
            text: itemCommand.node.text,
            reason: "malformed-input",
            detail: "\\item outside matched list environment",
            sourceStart: itemCommand.node.sourceStart,
            sourceEnd: itemCommand.node.sourceEnd,
          });
        }
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
      if (alertCommand) {
        nodes.push(alertCommand.node);
        unsupportedCommand ||= alertCommand.unsupportedCommand;
        index = alertCommand.end;
        continue;
      }
      if (accentCommand) {
        nodes.push(accentCommand.node);
        index = accentCommand.end;
        continue;
      }

      const end = scanUnsupportedControlSequenceEnd(text, index);
      const command = syntax.controlByStart.get(index);
      nodes.push({
        kind: "literal",
        text: text.slice(index, end),
        reason: "unsupported-command",
        detail: command
          ? text.slice(index, command.span.to)
          : text.slice(index, Math.min(end, index + 2)),
        sourceStart,
        sourceEnd: sourceOffset + end,
      });
      index = end;
      continue;
    }

    if (char === "{") {
      const group = scanSimpleTexGroup(text, index, sourceOffset, resolveColorAlias);
      if (group) {
        if (group.blockChildren) {
          nodes.push({ kind: "style-declaration", text: "{", sizeScope: { boundary: "begin", name: "" }, sourceStart, sourceEnd: sourceStart + 1 },
            ...group.blockChildren,
            { kind: "style-declaration", text: "}", sizeScope: { boundary: "end", name: "" }, sourceStart: sourceOffset + group.end - 1, sourceEnd: sourceOffset + group.end });
        } else nodes.push(group.node);
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

    const textEnd = syntax.textEndByStart.get(index);
    if (textEnd !== undefined) {
      appendSimpleTexTextNodes(nodes, text, index, textEnd, sourceOffset);
      index = textEnd;
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

    nodes.push({
      kind: "text",
      text: char ?? "",
      sourceStart,
      sourceEnd: sourceStart + 1,
    });
    index += 1;
  }

  return {
    nodes: mergeAdjacentSimpleTexTextNodes(nodes),
    unsupportedCommand,
  };
}

function mergeAdjacentSimpleTexTextNodes(
  nodes: readonly SimpleTexNode[]
): readonly SimpleTexNode[] {
  const merged: SimpleTexNode[] = [];
  for (const node of nodes) {
    const previous = merged.at(-1);
    if (
      node.kind === "text" &&
      previous?.kind === "text" &&
      previous.sourceEnd === node.sourceStart &&
      previous.text.length === previous.sourceEnd - previous.sourceStart &&
      node.text.length === node.sourceEnd - node.sourceStart
    ) {
      merged[merged.length - 1] = {
        kind: "text",
        text: previous.text + node.text,
        sourceStart: previous.sourceStart,
        sourceEnd: node.sourceEnd,
      };
    } else {
      merged.push(node);
    }
  }
  return merged;
}

function appendSimpleTexWhitespaceNode(
  nodes: SimpleTexNode[],
  text: string,
  start: number,
  end: number,
  sourceOffset: number
): void {
  const raw = text.slice(start, end);
  const hasBlankLine = /(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/u.test(raw);
  if (hasBlankLine) {
    nodes.push({
      kind: "paragraph-break",
      text: raw,
      breakKind: "blank-line",
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + end,
    });
  } else {
    nodes.push({
      kind: "space",
      text: raw,
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + end,
    });
  }
}

function appendSimpleTexTextNodes(
  nodes: SimpleTexNode[],
  text: string,
  start: number,
  end: number,
  sourceOffset: number
): void {
  let index = start;
  while (index < end) {
    const convention = scanSimpleTexProseConvention(
      text,
      index,
      sourceOffset
    );
    if (convention && convention.end <= end) {
      nodes.push(convention.node);
      index = convention.end;
      continue;
    }
    if (unsupportedDirectTextCharPattern.test(text[index] ?? "")) {
      nodes.push({
        kind: "literal",
        text: text[index] ?? "",
        reason: "unsupported-character",
        sourceStart: sourceOffset + index,
        sourceEnd: sourceOffset + index + 1,
      });
      index += 1;
      continue;
    }
    const textStart = index;
    index += 1;
    while (
      index < end &&
      scanSimpleTexProseConvention(text, index, sourceOffset) === null &&
      !unsupportedDirectTextCharPattern.test(text[index] ?? "")
    ) {
      index += 1;
    }
    nodes.push({
      kind: "text",
      text: text.slice(textStart, index),
      sourceStart: sourceOffset + textStart,
      sourceEnd: sourceOffset + index,
    });
  }
}

function simpleTexMathNodes(
  syntax: TexSyntaxIndex
): ReadonlyMap<number, SimpleTexMathNode | SimpleTexDisplayMathNode> {
  const cached = simpleTexMathBySyntaxIndex.get(syntax);
  if (cached) {
    return cached;
  }

  const byStart = new Map<number, SimpleTexMathNode | SimpleTexDisplayMathNode>();
  syntax.tree.iterate({
    enter(node) {
      const math = simpleTexMathNodeFromSyntax(syntax.source, node);
      if (math) {
        byStart.set(math.sourceStart, math);
        return false;
      }
      return;
    },
  });
  simpleTexMathBySyntaxIndex.set(syntax, byStart);
  return byStart;
}

function simpleTexMathNodeFromSyntax(
  text: string,
  syntax: SyntaxNodeRef
): SimpleTexMathNode | SimpleTexDisplayMathNode | null {
  if (syntax.name === "InlineMath") {
    const delimiter = text.startsWith(String.raw`\(`, syntax.from)
      ? "paren"
      : text[syntax.from] === "$"
        ? "dollar"
        : null;
    const delimiterLength = delimiter === "paren" ? 2 : 1;
    const closingDelimiter = delimiter === "paren" ? String.raw`\)` : "$";
    if (
      !delimiter ||
      !text.startsWith(closingDelimiter, syntax.to - delimiterLength)
    ) {
      return null;
    }
    const contentStart = syntax.from + delimiterLength;
    const contentEnd = syntax.to - delimiterLength;
    if (contentEnd < contentStart) {
      return null;
    }
    return {
      kind: "math",
      text: text.slice(syntax.from, syntax.to),
      delimiter,
      content: text.slice(contentStart, contentEnd),
      contentStart,
      contentEnd,
      sourceStart: syntax.from,
      sourceEnd: syntax.to,
    };
  }

  if (syntax.name === "DisplayMath") {
    const delimiter = text.startsWith(String.raw`\[`, syntax.from)
      ? "bracket"
      : text.startsWith("$$", syntax.from)
        ? "double-dollar"
        : null;
    const delimiterLength = 2;
    const closingDelimiter = delimiter === "bracket" ? String.raw`\]` : "$$";
    if (
      !delimiter ||
      !text.startsWith(closingDelimiter, syntax.to - delimiterLength)
    ) {
      return null;
    }
    const contentStart = syntax.from + delimiterLength;
    const contentEnd = syntax.to - delimiterLength;
    if (contentEnd < contentStart) {
      return null;
    }
    return {
      kind: "display-math",
      text: text.slice(syntax.from, syntax.to),
      delimiter,
      content: text.slice(contentStart, contentEnd),
      contentStart,
      contentEnd,
      sourceStart: syntax.from,
      sourceEnd: syntax.to,
    };
  }

  if (syntax.name !== "MathEnvironment") {
    return null;
  }
  const begin = syntax.node.getChild("BeginMathEnvironment");
  const end = syntax.node.getChild("EndMathEnvironment");
  if (!begin || !end) {
    return null;
  }
  if (text.slice(syntax.from, syntax.to).includes(String.raw`\intertext`)) {
    let malformed = false;
    syntax.node.cursor().iterate(node => { if (node.type.isError) malformed = true; });
    if (malformed) return null;
  }
  const beginText = text.slice(begin.from, begin.to);
  const nameMatch = /^\\begin\{(equation|align|flalign|gather|multline)(\*)?\}$/u.exec(
    beginText
  );
  if (!nameMatch) {
    return null;
  }
  const name = nameMatch[1];
  if (!name) {
    return null;
  }
  const delimiter = `${name}${nameMatch[2] ? "-star" : ""}` as
    SimpleTexDisplayMathDelimiter;
  const expectedEnd = `\\end{${name}${nameMatch[2] ?? ""}}`;
  if (text.slice(end.from, end.to) !== expectedEnd) {
    return null;
  }
  return {
    kind: "display-math",
    text: text.slice(syntax.from, syntax.to),
    delimiter,
    content: text.slice(begin.to, end.from),
    contentStart: begin.to,
    contentEnd: end.from,
    sourceStart: syntax.from,
    sourceEnd: syntax.to,
  };
}

function offsetSimpleTexMathSyntax(
  node: SimpleTexMathNode | SimpleTexDisplayMathNode,
  sourceOffset: number
): SimpleTexMathNode | SimpleTexDisplayMathNode {
  if (sourceOffset === 0) {
    return node;
  }
  return {
    ...node,
    contentStart: node.contentStart + sourceOffset,
    contentEnd: node.contentEnd + sourceOffset,
    sourceStart: node.sourceStart + sourceOffset,
    sourceEnd: node.sourceEnd + sourceOffset,
  };
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
  const command = getTexSyntaxIndex(text, texFragmentParser).controlByStart.get(
    start
  );
  const commandEnd = command?.commandSpan.to ?? start;
  const escaped = command?.kind === "symbol" ? command.name : undefined;
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
        sourceEnd: sourceOffset + commandEnd,
      },
      end: commandEnd,
      unsupportedCommand: false,
    };
  }
  if (escaped === " ") {
    return {
      node: {
        kind: "space",
        controlSpace: true,
        text: text.slice(start, commandEnd),
        sourceStart,
        sourceEnd: sourceOffset + commandEnd,
      },
      end: commandEnd,
      unsupportedCommand: false,
    };
  }

  const explicitSpaceEnd = scanSimpleTexControlWord(text, start, "space");
  if (explicitSpaceEnd !== null) {
    const end = skipSimpleTexControlWordSpaces(text, explicitSpaceEnd);
    return {
      node: {
        kind: "space",
        text: text.slice(start, end),
        sourceStart,
        sourceEnd: sourceOffset + end,
      },
      end,
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
        lift: texHBoxOffsetY(0),
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
        size: texLength(preset.size),
        stretch: texLength(preset.stretch),
        shrink: texLength(preset.shrink),
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
        size: texLength(0),
        stretch: texLength(1),
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
    argumentStart = skipSimpleTexControlWordSpaces(text, argumentStart);
    if (text[argumentStart] !== "{") {
      return null;
    }
    const argumentEnd = findBalancedSimpleTexGroupEnd(text, argumentStart);
    if (argumentEnd === null) {
      return null;
    }
    const rawLength = text.slice(argumentStart + 1, argumentEnd - 1);
    const parsed = parseTexSemanticLength(rawLength);
    const relativeSize = parseSimpleTexRelativeLength(rawLength);
    return {
      node: {
        kind: "vertical-glue",
        text: text.slice(start, argumentEnd),
        command: "vspace",
        sourceStart: sourceOffset + start,
        sourceEnd: sourceOffset + argumentEnd,
        size: parsed ?? texLength(0),
        ...(relativeSize ? { relativeSize } : {}),
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
    const size = parseTexSemanticLength(vskipMatch[1] ?? "");
    const stretch = vskipMatch[2] ? parseTexSemanticLength(vskipMatch[2]) : undefined;
    const shrink = vskipMatch[3] ? parseTexSemanticLength(vskipMatch[3]) : undefined;
    return {
      node: {
        kind: "vertical-glue",
        text: text.slice(start, start + full.length),
        command: "vskip",
        sourceStart: sourceOffset + start,
        sourceEnd: sourceOffset + start + full.length,
        size: size ?? texLength(0),
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
    width?: TexLength | null;
    height?: TexLength | null;
    depth?: TexLength | null;
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
          width: texLength(0),
          height: texLength(0),
          depth: texLength(0),
        },
        end: cursor,
        unsupportedCommand: true,
      };
    }
    const rawLength = lengthMatch[1] ?? "";
    dimensions[keyword] = parseTexSemanticLength(rawLength);
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
      width: dimensions.width ?? texLength(0),
      height: dimensions.height ?? texLength(0),
      depth: dimensions.depth ?? texLength(0),
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

function scanSimpleTexTransformCommand(text: string, start: number, sourceOffset: number, resolveColorAlias?: ColorAliasResolver): { node: SimpleTexTransformNode | SimpleTexLiteralNode; end: number } | null {
  const command = /^\\(rotatebox|scalebox|resizebox|reflectbox)\b/u.exec(text.slice(start));
  if (!command) return null;
  const name = command[1] as SimpleTexTransformCommandName;
  let cursor = start + command[0].length; let parameters: SimpleTexTransformNode["parameters"];
  const star = name === "resizebox" && text[cursor] === "*"; if (star) cursor++;
  const optional = name === "rotatebox" ? tabularGroup(text, cursor, "[", "]") : null; if (optional) cursor = optional.end;
  const first = name !== "reflectbox" ? tabularGroup(text, cursor) : null; if (name !== "reflectbox" && !first) return null; if (first) cursor = first.end;
  if (name === "rotatebox") parameters = { kind: "rotate", angle: Number(first!.content), ...(optional ? { options: parseOptionListRaw(text.slice(optional.start - 1, optional.end), sourceOffset + optional.start - 1) } : {}) };
  else if (name === "resizebox") { const height = tabularGroup(text, cursor); if (!height) return null; cursor = height.end; parameters = { kind: "resize", width: first!.content, height: height.content, totalHeight: star }; }
  else { const vertical = name === "scalebox" ? tabularGroup(text, cursor, "[", "]") : null; if (vertical) cursor = vertical.end; parameters = { kind: "scale", x: name === "reflectbox" ? -1 : Number(first!.content), y: name === "reflectbox" ? 1 : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test((vertical?.content ?? first!.content).trim()) ? Number(vertical?.content ?? first!.content) : Number.NaN }; }
  const body = tabularGroup(text, cursor); if (!body) return null;
  const scan = scanSimpleTexIrNodes(body.content, sourceOffset + body.start, resolveColorAlias);
  const numeric = (value: string) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value.trim());
  const finite = parameters.kind === "rotate" ? numeric(first!.content) : parameters.kind === "scale" ? name === "reflectbox" || numeric(first!.content) && Number.isFinite(parameters.y) : true;
  const rotationOptions = parameters.kind !== "rotate" || (parameters.options?.entries ?? []).every((option) => {
    if (option.kind !== "kv") return false;
    const value = option.valueRaw.trim().replace(/^\{(.*)\}$/u, "$1");
    return option.key === "origin" ? /^[lrcbtB]+$/u.test(value) : option.key === "x" || option.key === "y" ? value.length > 0 : option.key === "units" && numeric(value) && Number(value) !== 0;
  });
  const supported = finite && rotationOptions && !scan.unsupportedCommand && scan.nodes.every((node) => isSimpleTexInlineNode(node) || node.kind === "box" && node.height === undefined || node.kind === "paragraph-break");
  const end = body.end;
  if (!supported) return { node: { kind: "literal", text: text.slice(start, end), sourceStart: sourceOffset + start, sourceEnd: sourceOffset + end, reason: "unsupported-command", detail: "Unsupported graphicx box content or transform." }, end };
  return { node: { kind: "transform-box", command: name, parameters, text: text.slice(start, end), content: body.content, contentStart: sourceOffset + body.start, contentEnd: sourceOffset + end - 1, sourceStart: sourceOffset + start, sourceEnd: sourceOffset + end, children: scan.nodes }, end };
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

  let height: TexLength | undefined;
  let unsupportedCommand = false;
  if (text[cursor] === "[") {
    const heightEnd = findBalancedSimpleTexOptionalArgumentEnd(text, cursor);
    if (heightEnd === null) {
      return null;
    }
    const parsedHeight = parseTexSemanticLength(text.slice(cursor + 1, heightEnd - 1));
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
  const parsedWidth = parseTexSemanticLength(text.slice(cursor + 1, widthGroupEnd - 1));
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
      width: parsedWidth ?? texLength(0),
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
  const syntax = getTexSyntaxIndex(text, texFragmentParser);
  const environment = matchTexSyntaxEnvironments(syntax).get(start);
  if (environment?.name !== "minipage") {
    return null;
  }

  let cursor = skipSimpleTexControlWordSpaces(text, environment.begin.span.to);
  let alignment: SimpleTexBoxAlignment = "center";
  if (text[cursor] === "[") {
    const optionEnd = findBalancedSimpleTexOptionalArgumentEnd(text, cursor);
    if (optionEnd === null) {
      return null;
    }
    alignment = parseSimpleTexBoxAlignment(text.slice(cursor + 1, optionEnd - 1));
    cursor = skipSimpleTexControlWordSpaces(text, optionEnd);
  }

  let height: TexLength | undefined;
  let unsupportedCommand = false;
  if (text[cursor] === "[") {
    const heightEnd = findBalancedSimpleTexOptionalArgumentEnd(text, cursor);
    if (heightEnd === null) {
      return null;
    }
    const parsedHeight = parseTexSemanticLength(text.slice(cursor + 1, heightEnd - 1));
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
  const parsedWidth = parseTexSemanticLength(text.slice(cursor + 1, widthGroupEnd - 1));
  unsupportedCommand ||= parsedWidth === null;

  const contentStart = widthGroupEnd;
  const body = buildSimpleTexParagraphIrForRange(
    text,
    contentStart,
    environment.contentSpan.to,
    sourceOffset,
    resolveColorAlias
  );
  unsupportedCommand ||= body.unsupportedCommand;

  return {
    node: {
      kind: "box",
      text: text.slice(start, environment.span.to),
      command: "minipage",
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + environment.span.to,
      width: parsedWidth ?? texLength(0),
      ...(height !== undefined ? { height } : {}),
      alignment,
      content: text.slice(contentStart, environment.contentSpan.to),
      contentStart: sourceOffset + contentStart,
      contentEnd: sourceOffset + environment.contentSpan.to,
      body,
    },
    end: environment.span.to,
    unsupportedCommand,
  };
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
  syntax: TexSyntaxIndex,
  matchedBoundaryStarts: ReadonlySet<number>,
  start: number
): { boundary: "begin" | "end"; name: SimpleTexEnvironmentName; end: number } | null {
  const boundary = syntax.environmentBoundaryByStart.get(start);
  if (
    boundary &&
    matchedBoundaryStarts.has(start) &&
    (isSimpleTexEnvironmentName(boundary.name) || boundary.name === "table")
  ) {
    return {
      boundary: boundary.kind,
      name: boundary.name === "table" ? "center" : boundary.name,
      end: boundary.span.to,
    };
  }
  return null;
}

function isSimpleTexEnvironmentName(name: string): name is SimpleTexEnvironmentName {
  return isSimpleTexQuoteEnvironmentName(name) ||
    isSimpleTexTrivlistEnvironmentName(name) ||
    isSimpleTexListEnvironmentName(name);
}

interface MalformedSimpleTexEnvironmentBoundary {
  readonly kind: "begin" | "end";
  readonly name: SimpleTexEnvironmentName | "minipage";
  readonly end: number;
  readonly recovered: boolean;
}

function scanMalformedSimpleTexEnvironmentBoundary(
  text: string,
  syntax: TexSyntaxIndex,
  matchedBoundaryStarts: ReadonlySet<number>,
  start: number
): MalformedSimpleTexEnvironmentBoundary | null {
  if (matchedBoundaryStarts.has(start)) {
    return null;
  }
  const indexed = syntax.environmentBoundaryByStart.get(start);
  if (indexed && isRecoverableSimpleTexEnvironmentName(indexed.name)) {
    return {
      kind: indexed.kind,
      name: indexed.name,
      end: indexed.span.to,
      recovered: indexed.recovered,
    };
  }

  const control = syntax.controlByStart.get(start);
  const lexicalKind =
    text.startsWith("\\begin", start) &&
      !/[A-Za-z@]/u.test(text[start + "\\begin".length] ?? "")
      ? "begin"
      : text.startsWith("\\end", start) &&
          !/[A-Za-z@]/u.test(text[start + "\\end".length] ?? "")
        ? "end"
        : null;
  const kind =
    control?.kind === "word" &&
      (control.name === "begin" || control.name === "end")
      ? control.name
      : lexicalKind;
  if (!kind) {
    return null;
  }
  const commandEnd =
    control?.kind === "word" && control.name === kind
      ? control.commandSpan.to
      : start + `\\${kind}`.length;
  const groupStart = skipSimpleTexControlWordSpaces(text, commandEnd);
  if (text[groupStart] !== "{") {
    return null;
  }
  const indexedGroupEnd = findBalancedSimpleTexGroupEnd(text, groupStart);
  const lexicalGroupClose = text.indexOf("}", groupStart + 1);
  const groupEnd = indexedGroupEnd ??
    (lexicalGroupClose >= 0 ? lexicalGroupClose + 1 : null);
  const nameEnd = groupEnd === null ? text.length : groupEnd - 1;
  const name = text.slice(groupStart + 1, nameEnd).trim();
  if (!isRecoverableSimpleTexEnvironmentName(name)) {
    return null;
  }
  return {
    kind,
    name,
    end: groupEnd ?? text.length,
    recovered: groupEnd === null,
  };
}

function isRecoverableSimpleTexEnvironmentName(
  name: string
): name is SimpleTexEnvironmentName | "minipage" {
  return name === "minipage" || isSimpleTexEnvironmentName(name);
}

function malformedSimpleTexEnvironmentBoundaryDetail(
  boundary: MalformedSimpleTexEnvironmentBoundary
): string {
  if (boundary.recovered) {
    return `incomplete \\${boundary.kind}{${boundary.name}}`;
  }
  return boundary.kind === "begin"
    ? `missing \\end{${boundary.name}}`
    : `unexpected \\end{${boundary.name}}`;
}

function isInsideMatchedSimpleTexListEnvironment(
  environments: readonly TexSyntaxMatchedEnvironment[],
  sourceOffset: number
): boolean {
  return environments.some((environment) =>
    isSimpleTexListEnvironmentName(environment.name) &&
    environment.contentSpan.from <= sourceOffset &&
    sourceOffset < environment.contentSpan.to
  );
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
  return name === "itemize" || name === "enumerate" || name === "description" || name === "bibliography";
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
  let boxWidth: TexLength | undefined;
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
      boxWidth = texLength(0);
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
    boxWidth = texLength(0);
    boxAlign = "right";
  } else if (command.name === "rlap") {
    boxWidth = texLength(0);
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
  let raise = texHBoxOffsetY(0);
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
      raise = texHBoxOffsetY(parsedRaise);
    }
    cursor = skipSimpleTexControlWordSpaces(text, raiseArgument.end);
  }

  const widthArgument = scanSimpleTexRequiredDimensionGroupArgument(text, cursor);
  if (!widthArgument) {
    return null;
  }
  const width = widthArgument.value ?? texLength(0);
  unsupportedDimension ||= widthArgument.value === null;
  cursor = skipSimpleTexControlWordSpaces(text, widthArgument.end);

  const heightArgument = scanSimpleTexRequiredDimensionGroupArgument(text, cursor);
  if (!heightArgument) {
    return null;
  }
  const height = heightArgument.value ?? texLength(0);
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
  let optionList: OptionListAst | undefined;
  if (text[cursor] === "[") {
    const optionsArgument = scanSimpleTexOptionalBracketArgument(text, cursor);
    if (!optionsArgument) {
      return null;
    }
    optionList = parseOptionListRaw(
      text.slice(cursor, optionsArgument.end),
      sourceOffset + cursor
    );
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
      options: parseSimpleTexGraphicsOptions(optionList),
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + groupEnd,
    },
    end: groupEnd,
  };
}

function parseSimpleTexGraphicsOptions(
  optionList?: OptionListAst
): SimpleTexGraphicsOptions {
  let width: TexDimensionExpression | undefined;
  let height: TexDimensionExpression | undefined;
  let scale: number | undefined;
  let keepAspectRatio = false;
  let page: SimpleTexGraphicsPageOption | undefined;
  let trim: SimpleTexGraphicsTrim | undefined;
  let viewport: SimpleTexGraphicsViewport | undefined;
  let clip: boolean | undefined;
  for (const entry of optionList?.entries ?? []) {
    const key = entry.kind === "unknown" ? "" : entry.key;
    const value = entry.kind === "kv" ? entry.valueRaw : "";
    const hasValue = entry.kind === "kv";
    if (key === "width") {
      const parsed = parseTexDimensionExpression(value);
      if (parsed !== null) {
        width = parsed;
      }
      continue;
    }
    if (key === "height") {
      const parsed = parseTexDimensionExpression(value);
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
      keepAspectRatio = !hasValue || simpleTexBooleanOptionValue(value);
      continue;
    }
    if (key === "page") {
      const normalizedPage = stripSingleSimpleTexBraceLayer(value);
      if (!hasValue || !/^\d+$/u.test(normalizedPage)) {
        page = invalidSimpleTexGraphicsPageOption(value);
        continue;
      }
      const pageNumber = Number(normalizedPage);
      page = Number.isSafeInteger(pageNumber) && pageNumber >= 1
        ? { status: "valid", pageNumber }
        : invalidSimpleTexGraphicsPageOption(value);
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
      clip = !hasValue || simpleTexBooleanOptionValue(value);
    }
  }
  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(keepAspectRatio ? { keepAspectRatio } : {}),
    ...(page ? { page } : {}),
    ...(trim ? { trim } : {}),
    ...(viewport ? { viewport } : {}),
    ...(clip !== undefined ? { clip } : {}),
    ...(optionList ? { optionList } : {}),
    raw: optionList?.raw.slice(1, -1) ?? "",
  };
}

function invalidSimpleTexGraphicsPageOption(raw: string): SimpleTexGraphicsPageOption {
  return {
    status: "invalid",
    raw,
    reason: "PDF page option must be a positive integer.",
  };
}

function simpleTexBooleanOptionValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "no";
}

function parseSimpleTexGraphicsQuad(raw: string): [TexLength, TexLength, TexLength, TexLength] | null {
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
  return parsed as [TexLength, TexLength, TexLength, TexLength];
}

function parseSimpleTexGraphicsDimension(raw: string): TexLength | null {
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
  return Number.isFinite(value)
    ? texLength(value * TEX_GRAPHICS_BARE_NUMBER_UNIT_PT)
    : null;
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
  const lift = texHBoxOffsetY(liftArgument.value ?? 0);
  let unsupportedDimension = liftArgument.value === null;
  cursor = skipSimpleTexControlWordSpaces(text, liftArgument.end);

  let boxHeight: TexLength | undefined;
  let boxDepth: TexLength | undefined;
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
): { readonly value: TexLength | null; readonly end: number } | null {
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

/** Toplevel preamble register declarations; braced local groups remain scoped. */
export function parseSimpleTexTabularRegisters(text: string): TexTabularRegisters {
  let registers: TexTabularRegisters = {};
  let font: TexTabularAssignmentFont = {};
  for (const node of scanSimpleTexIrNodes(text).nodes) {
    if (node.kind === "font-declaration") font = simpleTexFontStateForDeclaration({ family: font.family ?? defaultSimpleTexFontState.family, series: font.series ?? defaultSimpleTexFontState.series, shape: font.shape ?? defaultSimpleTexFontState.shape, sizePt: font.sizePt === undefined ? undefined : texLength(font.sizePt) }, node.command);
    if (node.kind === "style-declaration") {
      if (node.tabularRegisters) registers = { ...registers, ...snapshotTabularRegisters(node.tabularRegisters, font) };
      if (node.sizePt !== undefined) font = { ...font, sizePt: node.sizePt };
    }
  }
  return registers;
}

function snapshotTabularRegisters(registers: TexTabularRegisters, font: TexTabularAssignmentFont): TexTabularRegisters {
  return Object.fromEntries(Object.entries(registers).map(([name, value]) => [name, typeof value === "string" ? { value, font: { family: font.family, series: font.series, shape: font.shape, sizePt: font.sizePt } } : value]));
}

/** Stock url.sty: typewriter glyphs with binary/relation break penalties. */
function scanSimpleTexUrl(text: string, start: number, sourceOffset: number): { node: SimpleTexFontCommandNode; end: number } | null {
  const commandEnd = scanSimpleTexControlWord(text, start, "url");
  if (commandEnd === null) return null;
  const open = skipSimpleTexControlWordSpaces(text, commandEnd);
  if (text[open] !== "{") return null;
  let depth = 1;
  let end = open + 1;
  for (; end < text.length; end++) {
    if (text[end] === "{") depth++;
    if (text[end] === "}" && --depth === 0) break;
  }
  if (end >= text.length) return null;
  const children: SimpleTexInlineNode[] = [];
  const breaks = new Set(".@\\/!_|;>]),?&'+=#%");
  const opening = new Set("([{<");
  const atoms = Array.from({ length: end - open - 1 }, (_, index) => {
    const from = open + 1 + index;
    const char = text[from];
    return { from, char, mathClass: char === ":" ? 3 : opening.has(char) ? 4 : breaks.has(char) ? 2 : 0 };
  }).filter(atom => !/[ \t\r\n]/u.test(atom.char));
  // url.sty uses math atoms. TeX demotes binary atoms after open/bin/rel
  // atoms, before relations, and at either end of the formula.
  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index];
    const previous = atoms[index - 1];
    if (atom.mathClass === 2 && (!previous || [2, 3, 4].includes(previous.mathClass))) atom.mathClass = 0;
    if (atom.mathClass === 3 && previous?.mathClass === 2) previous.mathClass = 0;
  }
  if (atoms.at(-1)?.mathClass === 2) atoms.at(-1)!.mathClass = 0;
  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index];
    const next = atoms[index + 1];
    const penalty = next && next.mathClass !== 4 && (atom.mathClass === 2 || atom.mathClass === 3) ? atom.mathClass === 3 ? 500 : 700 : undefined;
    children.push({ kind: "text", text: atom.char, sourceStart: sourceOffset + atom.from, sourceEnd: sourceOffset + atom.from + 1, ...(penalty !== undefined ? { breakAfterPenalty: penalty } : {}) });
  }
  return { node: { kind: "font-command", command: "texttt", text: text.slice(start, end + 1), sourceStart: sourceOffset + start, sourceEnd: sourceOffset + end + 1, contentStart: sourceOffset + open + 1, contentEnd: sourceOffset + end, children }, end: end + 1 };
}

function scanSimpleTexTabularRegister(text: string, start: number, sourceOffset: number): { node: SimpleTexStyleDeclarationNode; end: number } | null {
  const command = /^\\(setlength|renewcommand|def)\b/u.exec(text.slice(start));
  if (!command) return null;
  let cursor = start + command[0].length;
  if (command[1] === "renewcommand" && text[cursor] === "*") cursor++;
  if (command[1] === "def") {
    cursor = skipSimpleTexControlWordSpaces(text, cursor);
    const registerEnd = scanSimpleTexControlWord(text, cursor, "arraystretch");
    const value = registerEnd === null ? null : tabularGroup(text, registerEnd);
    if (!value || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value.content.trim())) return null;
    return { node: { kind: "style-declaration", text: text.slice(start, value.end), sourceStart: sourceOffset + start, sourceEnd: sourceOffset + value.end, tabularRegisters: { arraystretch: Number(value.content) } }, end: value.end };
  }
  const register = tabularGroup(text, cursor);
  const value = register && tabularGroup(text, register.end);
  if (!register || !value) return null;
  const name = register.content.trim().replace(/^\\/u, "");
  const names: readonly string[] = ["tabcolsep", "arrayrulewidth", "doublerulesep", "extrarowheight", "heavyrulewidth", "lightrulewidth", "cmidrulewidth", "aboverulesep", "belowrulesep", "abovetopsep", "belowbottomsep", "cmidrulekern", "defaultaddspace"];
  if (command[1] === "setlength" && !names.includes(name)) return null;
  if (command[1] === "renewcommand" && (name !== "arraystretch" || !Number.isFinite(Number(value.content)))) return null;
  return { node: { kind: "style-declaration", text: text.slice(start, value.end), sourceStart: sourceOffset + start, sourceEnd: sourceOffset + value.end, tabularRegisters: command[1] === "renewcommand" ? { arraystretch: Number(value.content) } : { [name]: value.content } }, end: value.end };
}

function scanSimpleTexListRegister(text: string, start: number, sourceOffset: number): { node: SimpleTexStyleDeclarationNode; end: number } | null {
  const command = /^\\setlength\b/u.exec(text.slice(start));
  if (!command) return null;
  const register = tabularGroup(text, start + command[0].length);
  const value = register && tabularGroup(text, register.end);
  if (!register || !value) return null;
  const name = register.content.trim().replace(/^\\/u, "");
  if (name !== "itemsep" && name !== "parsep" && name !== "parskip") return null;
  // Keep authored glue until the active font is known at the assignment site.
  const parts = value.content.trim().split(/\s+(?:plus|minus)\s+/u);
  if (!parts.every(part => parseTexDimensionExpression(part) != null)) return null;
  return { node: { kind: "style-declaration", text: text.slice(start, value.end),
    listRegisters: { [name]: value.content }, sourceStart: sourceOffset + start, sourceEnd: sourceOffset + value.end }, end: value.end };
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
    "pgfutil@font@tiny", "pgfutil@font@scriptsize",
    "pgfutil@font@footnotesize", "pgfutil@font@small",
    "pgfutil@font@normalsize", "pgfutil@font@large",
    "pgfutil@font@Large", "pgfutil@font@LARGE",
    "pgfutil@font@huge", "pgfutil@font@Huge",
  ] as const) {
    const end = scanSimpleTexControlWord(text, start, name);
    if (end !== null) {
      return {
        node: {
          kind: "style-declaration",
          text: text.slice(start, end),
          sizeCommand: name.replace("pgfutil@font@", ""),
          sizePt: texLength(DEFAULT_TEXT_FONT_SIZE * (FONT_SIZE_COMMAND_FACTORS[`\\${name}`] ?? 1)),
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
  const fontDimension = (value: string): TexLength | null => /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value.trim())
    ? texLength(Number(value.trim())) : parseTexDimensionText(value.trim());
  const sizePt = fontDimension(size.content);
  const baselineSkipPt = fontDimension(baselineSkip.content);
  if (sizePt === null || sizePt <= 0) return null;
  return {
    node: {
      kind: "style-declaration",
      text: text.slice(start, selectfontEnd),
      sizePt,
      ...(baselineSkipPt != null ? { baselineSkipPt } : {}),
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

/**
 * Reserved alias name the `\alert` scanner resolves through the caller's
 * color resolver. It contains a space so it can never collide with an
 * xcolor name; callers that do not resolve it (TikZ node text) keep
 * `\alert` on the unsupported-command fallback path.
 */
export const TEX_ALERT_COLOR_ALIAS = "beamer alerted text";

function scanSimpleTexAlertCommand(
  text: string,
  start: number,
  sourceOffset: number,
  resolveColorAlias?: ColorAliasResolver
): { node: SimpleTexColorCommandNode; end: number; unsupportedCommand: boolean } | null {
  const commandEnd = scanSimpleTexControlWord(text, start, "alert");
  if (commandEnd === null) return null;
  const color = resolveColorAlias?.(TEX_ALERT_COLOR_ALIAS);
  if (!color) return null;
  let cursor = skipSimpleTexControlWordSpaces(text, commandEnd);
  // An overlay action spec surviving to layout colors every step (the
  // per-step projection upstream owns real `\alert<...>` semantics); it
  // is consumed as command syntax, never rendered.
  if (text[cursor] === "<") {
    const specEnd = text.indexOf(">", cursor + 1);
    const nextBrace = text.indexOf("{", cursor + 1);
    if (specEnd === -1 || (nextBrace !== -1 && nextBrace < specEnd)) return null;
    cursor = skipSimpleTexControlWordSpaces(text, specEnd + 1);
  }
  const contentArgument = scanSimpleTexRequiredGroupArgument(text, cursor);
  if (!contentArgument) return null;
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
  const command = getTexSyntaxIndex(text, texFragmentParser).controlByStart.get(
    start
  );
  if (!command) {
    return null;
  }
  const commandEnd = command.commandSpan.to;
  if (command.kind === "word") {
    const replacement = SIMPLE_TEX_LETTER_COMMANDS[command.name];
    if (replacement) {
      return {
        node: {
          kind: "text",
          text: replacement,
          sourceStart: sourceOffset + start,
          sourceEnd: sourceOffset + commandEnd,
        },
        end: commandEnd,
      };
    }
  }

  const mark = SIMPLE_TEX_ACCENT_MARKS[command.name];
  if (!mark) {
    return null;
  }
  let cursor = skipSimpleTexControlWordSpaces(text, commandEnd);
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
  readonly blockChildren?: readonly SimpleTexNode[];
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
  const blockChildren = childScan.nodes.some(node => node.kind === "display-math") &&
    childScan.nodes.every(node => isSimpleTexInlineNode(node) || node.kind === "display-math" || node.kind === "paragraph-break")
    ? childScan.nodes : undefined;
  return {
    ...(blockChildren ? { blockChildren } : {}),
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
    unsupportedCommand: childScan.unsupportedCommand || (!childrenAreInline && !blockChildren),
  };
}

function findBalancedSimpleTexGroupEnd(text: string, start: number): number | null {
  const argument = getTexSyntaxIndex(
    text,
    texFragmentParser
  ).groupByStart.get(start);
  return argument?.complete ? argument.span.to : null;
}

function findBalancedSimpleTexOptionalArgumentEnd(
  text: string,
  start: number
): number | null {
  const argument = getTexSyntaxIndex(
    text,
    texFragmentParser
  ).optionalArgumentByStart.get(start);
  return argument?.complete ? argument.span.to : null;
}

function skipSimpleTexControlWordSpaces(text: string, start: number): number {
  let index = start;
  const triviaEndByStart = getTexSyntaxIndex(
    text,
    texFragmentParser
  ).triviaEndByStart;
  for (
    let triviaEnd = triviaEndByStart.get(index);
    triviaEnd !== undefined;
    triviaEnd = triviaEndByStart.get(index)
  ) {
    index = triviaEnd;
  }
  return index;
}

export function scanSimpleTexLineBreak(
  text: string,
  start: number
): { end: number; lineLeading?: string; priority?: 0 | 1 | 2 | 3 | 4 } | null {
  const command = getTexSyntaxIndex(text, texFragmentParser).controlByStart.get(
    start
  );
  if (!command) {
    return null;
  }
  const commandEnd = command.commandSpan.to;

  if (command.kind === "word" && command.name === "newline") {
    return { end: commandEnd };
  }
  if (command.kind === "word" && command.name === "linebreak") {
    const option = scanSimpleTexOptionalBracketArgument(text, commandEnd);
    const priority = option && /^[0-4]$/u.test(option.content.trim())
      ? Number.parseInt(option.content.trim(), 10) as 0 | 1 | 2 | 3 | 4
      : 4;
    return {
      end: priority !== 4 || option?.content.trim() === "4"
        ? option?.end ?? commandEnd
        : commandEnd,
      priority,
    };
  }
  if (command.kind !== "symbol" || command.name !== "\\") {
    return null;
  }

  let end = commandEnd;
  // LaTeX's starred form suppresses a page break after this forced line. The
  // distinction is irrelevant inside a single node paragraph, but the star
  // is still command syntax and must not leak into painted prose.
  if (text[end] === "*") {
    end += 1;
  }
  if (text[end] === "[") {
    const option = scanSimpleTexOptionalBracketArgument(text, end);
    if (
      !option ||
      !lineLeadingOptionPattern.test(text.slice(end, option.end))
    ) {
      return null;
    }
    return {
      end: option.end,
      lineLeading: option.content.trim(),
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
  const command = getTexSyntaxIndex(text, texFragmentParser).controlByStart.get(
    start
  );
  return command?.kind === "word" && command.name === word
    ? command.commandSpan.to
    : null;
}

function scanUnsupportedControlSequenceEnd(text: string, start: number): number {
  const command = getTexSyntaxIndex(text, texFragmentParser).controlByStart.get(
    start
  );
  if (!command) {
    return Math.min(text.length, start + 2);
  }
  const commandEnd = command.commandSpan.to;
  return command.kind === "word"
    ? scanUnsupportedControlSequenceArgumentsEnd(text, commandEnd)
    : commandEnd;
}

function scanUnsupportedControlSequenceArgumentsEnd(text: string, start: number): number {
  let end = start;
  let index = start;
  while (index < text.length) {
    index = skipSimpleTexControlWordSpaces(text, index);
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
    node.kind === "comment" ||
    node.kind === "line-break" ||
    node.kind === "math" ||
    node.kind === "tabular" ||
    node.kind === "transform-box" ||
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
  sourceEnd = sourceOffset + text.length,
  options?: SimpleTexParagraphIrOptions
): SimpleTexParagraphBlockScanResult {
  const initialSize = texLength(options?.fontSizePt ?? 10);
  const initialBaseline = options?.baselineSkipPt === undefined ? undefined : texLength(options.baselineSkipPt);
  type SizeState = SimpleTexDisplayMathState & { sizePt: TexLength };
  const normalFontSizePt = texLength(options?.namedFontSizes?.normalsize?.sizePt ?? 10);
  const initialState: SizeState = { sizePt: initialSize, baselineSkip: initialBaseline, normalFontSizePt };
  let sizeState: SizeState = initialState;
  const sizeScopes: SizeState[] = [];
  const sizeHistory: Array<{ from: number; state: SizeState }> = [{ from: sourceOffset, state: sizeState }];
  // Class size macros also select baselines; explicit \fontsize keeps the
  // previously installed display skips. Groups restore both sets of registers.
  const defaultSizes: Readonly<Record<string, number>> = {
    tiny: 5, scriptsize: 7, footnotesize: 8, small: 9, normalsize: 10,
    large: 12, Large: 14.4, LARGE: 17.28, huge: 20.74, Huge: 24.88,
  };
  const defaultBaselines: Readonly<Record<string, number>> = {
    tiny: 6, scriptsize: 8, footnotesize: 9.5, small: 11, normalsize: 12,
    large: 14, Large: 18, LARGE: 22, huge: 25, Huge: 30,
  };
  const resolveSizeNodes = (nodes: readonly SimpleTexNode[]): SimpleTexNode[] => nodes.map(node => {
    if (node.kind === "group") {
      const outer = sizeState;
      const children = resolveSizeNodes(node.children) as SimpleTexInlineNode[];
      sizeState = outer;
      sizeHistory.push({ from: node.sourceEnd, state: outer });
      return { ...node, children };
    }
    if (node.kind !== "style-declaration") return node;
    const name = node.sizeScope?.boundary === "begin" ? node.sizeScope.name : node.sizeCommand;
    if (node.sizeScope?.boundary === "begin") sizeScopes.push(sizeState);
    if (node.sizeScope?.boundary === "end") {
      sizeState = sizeScopes.pop() ?? initialState;
    } else if (name) {
      const selected = options?.namedFontSizes?.[name];
      sizeState = { ...sizeState, sizePt: texLength(selected?.sizePt ?? defaultSizes[name] ?? node.sizePt ?? initialSize),
        baselineSkip: texLength(selected?.baselineSkipPt ?? defaultBaselines[name] ?? initialBaseline ?? 12),
        ...(["normalsize", "small", "footnotesize"].includes(name)
          ? { displaySkipCommand: name as "normalsize" | "small" | "footnotesize" } : {}) };
    } else if (node.sizePt != null) {
      sizeState = { ...sizeState, sizePt: node.sizePt, baselineSkip: node.baselineSkipPt ?? sizeState.baselineSkip };
    } else if (!node.sizeScope) return node;
    sizeHistory.push({ from: node.sourceEnd, state: sizeState });
    return { ...node, sizePt: sizeState.sizePt, baselineSkipPt: sizeState.baselineSkip };
  });
  sourceNodes = resolveSizeNodes(sourceNodes);
  const sizeAt = (offset: number): SizeState => {
    for (let i = sizeHistory.length - 1; i >= 0; i -= 1) if (sizeHistory[i].from <= offset) return sizeHistory[i].state;
    return sizeHistory[0].state;
  };
  const resolveListGlue = (raw: string, sizePt: number): { sizePt: number; stretchPt: number; shrinkPt: number } | null => {
    const parts = /^([\s\S]*?)(?:\s+plus\s+([\s\S]*?))?(?:\s+minus\s+([\s\S]*?))?$/u.exec(raw.trim());
    if (!parts) return null;
    const resolve = (part: string | undefined): number | null => {
      if (part === undefined) return 0;
      const dimension = parseTexDimensionExpression(part);
      return dimension?.kind === "absolute" ? Number(dimension.value) : dimension?.kind === "contextual" && ["em", "ex"].includes(dimension.reference)
        ? dimension.factor * sizePt * (dimension.reference === "em" ? 1 : .43) : null;
    };
    const size = resolve(parts[1]), stretch = resolve(parts[2]), shrink = resolve(parts[3]);
    return size === null || stretch === null || shrink === null ? null : { sizePt: size, stretchPt: stretch, shrinkPt: shrink };
  };
  const blocks: SimpleTexParagraphBlock[] = [];
  const items: SimpleTexBlockItem[] = [];
  let unsupportedCommand = false;
  let abortScan = false;
  interface ActiveSimpleTexList {
    readonly sourceStart: number;
    readonly kind: SimpleTexListKind;
    readonly depth: number;
    readonly labelDepth: number;
    itemIndex: number;
    itemCommandSpan?: { start: number; end: number };
    readonly ownLeftMarginEm: number;
    readonly totalLeftMarginEm: number;
    readonly scopeRole: Extract<SimpleTexScopePathRole, { readonly kind: "list" }>;
    readonly fontSizePt: TexLength;
    spacing?: SimpleTexListContext["spacing"];
    fontState?: SimpleTexFontState;
  }
  interface ActiveSimpleTexEnvironment {
    readonly name: SimpleTexEnvironmentName;
    readonly scopeRole: Exclude<SimpleTexScopePathRole, { readonly kind: "list-item" }>;
  }
  interface MutableListItemTopology {
    commandSpan: SimpleTexTopologySpan;
    labelSpan?: SimpleTexTopologySpan;
    contentFrom: number;
    contentTo: number | null;
    itemIndex: number;
  }
  interface MutableListTopology {
    name: SimpleTexListKind;
    beginSpan: SimpleTexTopologySpan;
    depth: number;
    items: MutableListItemTopology[];
  }
  const listStack: ActiveSimpleTexList[] = [];
  // Parallel to the list entries of `listStack` (only `beginList` pushes
  // there): the source topology the environment's structural edits need.
  const listTopologyStack: MutableListTopology[] = [];
  const completedListTopologies: SimpleTexListTopology[] = [];
  const closeOpenListItemTopology = (
    topology: MutableListTopology | undefined,
    boundaryStart: number
  ): void => {
    const openItem = topology?.items.at(-1);
    if (openItem?.contentTo === null) {
      openItem.contentTo = boundaryStart;
    }
  };
  const environmentStack: ActiveSimpleTexEnvironment[] = [];
  const scopeStack: Exclude<SimpleTexScopePathRole, { readonly kind: "list-item" }>[] = [];
  let pendingParagraphVerticalAdjustments: SimpleTexVerticalGlueBlockItem[] = [];
  let horizontalModeResumedAfterDisplay = false;
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
    alignmentProfile?: TexAlignmentProfile,
    allowEmptyListItem = false
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
    if (start < end || (allowEmptyListItem && pendingListShowLabel)) {
      const listContext = currentSimpleTexListContext();
      const startsAfterExplicitPar = previousParagraphBlockEnd !== undefined &&
        hasExplicitParagraphBoundaryBetween(previousParagraphBlockEnd, rawStart);
      const scopePath = currentSimpleTexScopePath();
      let nodes = simpleTexInlineNodesAfterHorizontalVSpace(
        simpleTexInlineNodesForRange(sourceNodes, start, end),
        pendingParagraphVerticalAdjustments
      );
      const activeList = listStack.at(-1);
      const inheritedFontState = activeList?.fontState;
      if (activeList) {
        for (const node of nodes) {
          if (node.kind === "font-declaration") {
            activeList.fontState = simpleTexFontStateForDeclaration(activeList.fontState ?? defaultSimpleTexFontState, node.command);
          }
        }
      }
      // Declarations in vertical mode select registers without creating an
      // empty prose paragraph (notably assignments before the first item).
      if (nodes.every(node => ["space", "comment", "style-declaration", "font-declaration"].includes(node.kind)) && !(allowEmptyListItem && pendingListShowLabel)) return;
      if (listStack.length > 0 && !listContext) {
        // Material before a list's first `\item` fails to compile in LaTeX
        // ("perhaps a missing \item"), so it is outside the supported
        // subset; render it as a literal run instead of degrading the whole
        // node, keeping a half-typed `\item` locally stable while editing.
        nodes = nodes.map((node) =>
          node.kind === "space" || node.kind === "literal"
            ? node
            : {
                kind: "literal",
                text: textSliceAtSourceOffsets(node.sourceStart, node.sourceEnd),
                reason: "malformed-input",
                detail: "missing \\item",
                sourceStart: node.sourceStart,
                sourceEnd: node.sourceEnd,
              }
        );
      }
      unsupportedCommand ||= simpleTexBlockStartsWithVerticalModeLapBox(nodes);
      const block: SimpleTexParagraphBlock = {
        text: textSliceAtSourceOffsets(start, end),
        sourceStart: start,
        sourceEnd: end,
        nodes,
        ...(listContext && inheritedFontState ? { inheritedFontState: {
          family: inheritedFontState.family, series: inheritedFontState.series, shape: inheritedFontState.shape,
        } } : {}),
        ...(options?.fontSizePt !== undefined || sizeHistory.some(entry => entry.from > sourceOffset && entry.from <= start)
          ? { fontSizePt: sizeAt(start).sizePt } : {}),
        ...(sizeAt(end).baselineSkip !== undefined ? { baselineSkip: sizeAt(end).baselineSkip } : {}),
        ...(pendingParagraphVerticalAdjustments.length > 0
          ? {
              verticalAdjustments: [
                ...pendingParagraphVerticalAdjustments,
              ],
            }
          : {}),
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
      pendingParagraphVerticalAdjustments = [];
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

  const simpleTexInlineNodesAfterHorizontalVSpace = (
    nodes: readonly SimpleTexInlineNode[],
    adjustments: readonly SimpleTexVerticalGlueBlockItem[]
  ): SimpleTexInlineNode[] => {
    const ignoredSpaceIndices = new Set<number>();
    for (const adjustment of adjustments) {
      const followingIndex = nodes.findIndex(
        (node) => node.sourceStart >= adjustment.sourceEnd
      );
      if (nodes[followingIndex]?.kind === "space") {
        // latex.ltx's `\@esphack` restores the saved space factor and, when
        // horizontal space preceded the command, issues `\ignorespaces`.
        // The pre-command interword glue remains; source whitespace after
        // `\vspace` does not create a second one.
        ignoredSpaceIndices.add(followingIndex);
      }
    }
    return nodes.filter((_, index) => !ignoredSpaceIndices.has(index));
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
      itemCommandSpan: activeList.itemCommandSpan,
      ownLeftMarginEm: activeList.ownLeftMarginEm,
      totalLeftMarginEm: activeList.totalLeftMarginEm,
      showLabel: pendingListShowLabel,
      label: pendingListLabel,
      listStart: activeList.sourceStart,
      fontSizePt: activeList.fontSizePt,
      ...(activeList.spacing ? { spacing: activeList.spacing } : {}),
    };
  };

  const beginList = (kind: SimpleTexListKind, sourceStart: number) => {
    const depth = currentQuoteDepth + listStack.length + 1;
    const labelDepth = listStack.filter((entry) => entry.kind === kind).length + 1;
    const margins =
      options?.listLeftMarginEmByDepth ?? articleListLeftMarginEmByDepth;
    const marginDepthIndex = options?.listLeftMarginEmByDepth
      ? listStack.length
      : depth - 1;
    const ownMargin = (kind === "bibliography" ? options?.bibliographyMargins?.get(sourceStart) : undefined) ?? margins[
      Math.min(marginDepthIndex, margins.length - 1)
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
      sourceStart,
      kind,
      depth,
      labelDepth,
      itemIndex: 0,
      ownLeftMarginEm: ownMargin,
      totalLeftMarginEm: scopeRole.totalLeftMarginEm,
      scopeRole,
      fontSizePt: sizeAt(sourceStart).sizePt,
      fontState: listStack.at(-1)?.fontState,
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

  const verticalGlueBlockItem = (
    node: SimpleTexVerticalGlueNode
  ): SimpleTexVerticalGlueBlockItem => ({
    kind: "vertical-glue",
    text: node.text,
    command: node.command,
    sourceStart: node.sourceStart,
    sourceEnd: node.sourceEnd,
    size: node.size,
    ...(node.relativeSize ? { relativeSize: node.relativeSize } : {}),
    stretch: node.stretch,
    shrink: node.shrink,
    stretchOrder: node.stretchOrder,
    shrinkOrder: node.shrinkOrder,
    ...currentSimpleTexBlockItemScope(),
  });

  const hasFollowingInlineMaterial = (start: number): boolean => {
    let lookahead = start;
    while (lookahead < sourceNodes.length) {
      const candidate = sourceNodes[lookahead];
      if (candidate?.kind === "space") {
        lookahead += 1;
        continue;
      }
      if (
        candidate?.kind === "vertical-glue" &&
        candidate.command === "vspace"
      ) {
        lookahead += 1;
        continue;
      }
      return candidate !== undefined && isSimpleTexInlineNode(candidate);
    }
    return false;
  };

  while (index < sourceNodes.length) {
    const node = sourceNodes[index];
    if (!node) {
      unsupportedCommand = true;
      abortScan = true;
      break;
    }
    if (node.kind === "style-declaration" && node.listRegisters && listStack.length > 0) {
      const list = listStack.at(-1)!;
      const assignments = Object.fromEntries(Object.entries(node.listRegisters).flatMap(([name, value]) => {
        const glue = resolveListGlue(value, sizeAt(node.sourceStart).sizePt);
        return glue ? [[name, glue]] : [];
      }));
      list.spacing = { ...list.spacing, ...assignments };
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
        prefix.alignmentProfile,
        true
      );
      if (abortScan) {
        break;
      }
      items.push({
        kind: "display-math",
        fontSizePt: sizeAt(node.sourceStart).sizePt,
        baselineSkip: sizeAt(node.sourceStart).baselineSkip,
        displaySkipCommand: sizeAt(node.sourceStart).displaySkipCommand,
        normalFontSizePt,
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
      horizontalModeResumedAfterDisplay = true;
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
        prefix.alignmentProfile,
        true
      );
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = noIndentForCurrentScope(prefix.noIndent);
      horizontalModeResumedAfterDisplay = false;
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
        prefix.alignmentProfile,
        node.boundary === "end" && isSimpleTexListEnvironmentName(node.name)
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
          scopeRole = beginList(node.name, node.sourceStart);
          listTopologyStack.push({
            name: node.name,
            beginSpan: { from: node.sourceStart, to: node.sourceEnd },
            depth: listTopologyStack.length + 1,
            items: [],
          });
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
          const topology = listTopologyStack.pop();
          if (topology) {
            closeOpenListItemTopology(topology, node.sourceStart);
            completedListTopologies.push({
              name: topology.name,
              beginSpan: topology.beginSpan,
              endSpan: { from: node.sourceStart, to: node.sourceEnd },
              depth: topology.depth,
              items: topology.items.map((item) => ({
                commandSpan: item.commandSpan,
                ...(item.labelSpan ? { labelSpan: item.labelSpan } : {}),
                contentSpan: {
                  from: item.contentFrom,
                  to: item.contentTo ?? node.sourceStart,
                },
                itemIndex: item.itemIndex,
              })),
            });
          }
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
      horizontalModeResumedAfterDisplay = false;
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
        prefix.alignmentProfile,
        true
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
      // Own the marker group with the command token. Covered text inside an
      // optional label must only hide its own glyphs, not the entire label.
      activeList.itemCommandSpan = { start: node.sourceStart, end: node.sourceStart + "\\item".length };
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
      const activeTopology = listTopologyStack.at(-1);
      if (activeTopology) {
        closeOpenListItemTopology(activeTopology, node.sourceStart);
        activeTopology.items.push({
          commandSpan: { from: node.sourceStart, to: node.sourceEnd },
          ...(node.labelSourceStart !== undefined && node.labelSourceEnd !== undefined
            ? { labelSpan: { from: node.labelSourceStart, to: node.labelSourceEnd } }
            : {}),
          contentFrom: Math.min(blockStart, sourceEnd),
          contentTo: null,
          itemIndex: activeList.itemIndex,
        });
      }
      currentNoIndent = true;
      horizontalModeResumedAfterDisplay = false;
      index = prefix.start;
      continue;
    }

    if (node.kind === "vertical-glue") {
      if (
        hasNonSpaceSourceText(
          text,
          blockStart,
          node.sourceStart,
          sourceOffset
        ) ||
        (
          ["vspace", "smallskip", "medskip", "bigskip"].includes(node.command) &&
          horizontalModeResumedAfterDisplay &&
          hasFollowingInlineMaterial(index + 1)
        )
      ) {
        // LaTeX defines the named skips as \vspace of their skip registers.
        if (!["vspace", "smallskip", "medskip", "bigskip"].includes(node.command)) {
          unsupportedCommand = true;
          abortScan = true;
          break;
        }
        // `\vspace` is special in LaTeX: in horizontal mode it emits a
        // `\vadjust` without ending the paragraph. Retain the command in the
        // paragraph's source range, omit it from inline shaping, and lower
        // its vertical effect only after line breaking has located the
        // containing line.
        pendingParagraphVerticalAdjustments.push(
          verticalGlueBlockItem(node)
        );
        index += 1;
        continue;
      }
      items.push(verticalGlueBlockItem(node));
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = noIndentForCurrentScope(prefix.noIndent);
      horizontalModeResumedAfterDisplay = false;
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
      prefix.alignmentProfile,
      true
    );
  }
  completedListTopologies.sort((left, right) => left.beginSpan.from - right.beginSpan.from);
  return {
    blocks,
    items,
    partialFallbackSupported: unsupportedCommand && !abortScan,
    unsupportedCommand,
    ...(abortScan || completedListTopologies.length === 0
      ? {}
      : { listStructure: completedListTopologies }),
  };
}

function parseSimpleTexRelativeLength(
  raw: string
): { readonly value: number; readonly unit: "em" | "ex" } | null {
  const match =
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(em|ex)$/iu.exec(raw.trim());
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return {
    value: Number(match[1]),
    unit: match[2].toLowerCase() as "em" | "ex",
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
      ...(block.leadingInterwordSpace === true
        ? { leadingInterwordSpace: true }
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
    if (
      start < end ||
      (segments.length === 0 && block.listContext?.showLabel === true)
    ) {
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
        ...(block.leadingInterwordSpace === true && segments.length === 0
          ? { leadingInterwordSpace: true }
          : {}),
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
    if (node.kind === "comment") {
      continue;
    }
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

    if (node.kind === "transform-box") {
      tokens.push({ kind: "transform-box", text: node.text, transformBox: node, sourceStart: node.sourceStart, sourceEnd: node.sourceEnd, fontState: activeFontState });
      skipPostLineBreakSpace = false;
      continue;
    }
    if (node.kind === "tabular") {
      tokens.push({ kind: "tabular", text: node.text, table: node.table, sourceStart: node.sourceStart, sourceEnd: node.sourceEnd, fontState: activeFontState });
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
        ...(node.baselineSkipPt !== undefined ? { baselineSkipPt: node.baselineSkipPt } : {}),
        ...(node.color !== undefined ? { color: node.color } : {}),
        ...(node.tabularRegisters ? { tabularRegisters: { ...activeFontState.tabularRegisters, ...snapshotTabularRegisters(node.tabularRegisters, activeFontState) } } : {}),
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
        controlSpace: node.controlSpace,
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
    if (node.breakAfterPenalty !== undefined) tokens.push({ kind: "penalty", text: "", sourceStart: node.sourceEnd, sourceEnd: node.sourceEnd, penalty: node.breakAfterPenalty, fontState: activeFontState });
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
    return { ...luaLatexNormalFontState, sizePt: current.sizePt, baselineSkipPt: current.baselineSkipPt, color: current.color, tabularRegisters: current.tabularRegisters };
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
    return { ...defaultSimpleTexFontState, shape: "italic", baselineSkipPt: current.baselineSkipPt, tabularRegisters: current.tabularRegisters };
  }
  if (command === "bf") {
    return { ...defaultSimpleTexFontState, series: "bold", baselineSkipPt: current.baselineSkipPt, tabularRegisters: current.tabularRegisters };
  }
  if (command === "rm") {
    return { ...defaultSimpleTexFontState, baselineSkipPt: current.baselineSkipPt, tabularRegisters: current.tabularRegisters };
  }
  if (command === "sf") {
    return { ...defaultSimpleTexFontState, family: "sans", baselineSkipPt: current.baselineSkipPt, tabularRegisters: current.tabularRegisters };
  }
  if (command === "sl") {
    return { ...defaultSimpleTexFontState, shape: "slanted", baselineSkipPt: current.baselineSkipPt, tabularRegisters: current.tabularRegisters };
  }
  if (command === "sc") {
    return { ...defaultSimpleTexFontState, shape: "small-caps", baselineSkipPt: current.baselineSkipPt, tabularRegisters: current.tabularRegisters };
  }
  if (command === "tt") {
    return { ...defaultSimpleTexFontState, family: "typewriter", baselineSkipPt: current.baselineSkipPt, tabularRegisters: current.tabularRegisters };
  }
  if (command === "em") {
    return {
      ...current,
      shape: current.shape === "italic" ? "upright" : "italic",
    };
  }
  if (command === "normalfont") {
    return { ...luaLatexNormalFontState, sizePt: current.sizePt, baselineSkipPt: current.baselineSkipPt, color: current.color, tabularRegisters: current.tabularRegisters };
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
