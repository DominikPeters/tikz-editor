import type { ParagraphAlignment } from "../knuth-plass/alignment.js";
import { parseLength } from "../../semantic/coords/parse-length.js";

export type TexParagraphAlignment = ParagraphAlignment;
export type TexAlignmentProfile = "latex-declaration" | "latex-quote";
export type TexSpaceGlueProfile = "font" | "tikz-fixed";
export type TexFontFamily = "roman" | "sans" | "normal";
export type TexFontSeries = "medium" | "bold";
export type TexFontShape = "upright" | "italic" | "small-caps";
export type SimpleTexFontCommandName =
  | "textit"
  | "textbf"
  | "emph"
  | "textrm"
  | "textsf"
  | "textsc"
  | "textnormal";
export type SimpleTexFontDeclarationName =
  | "it"
  | "bf"
  | "rm"
  | "sf"
  | "sc"
  | "em"
  | "itshape"
  | "bfseries"
  | "mdseries"
  | "rmfamily"
  | "sffamily"
  | "upshape"
  | "scshape"
  | "normalfont";
export type SimpleTexEnvironmentName = "quote" | "itemize" | "enumerate" | "description";
export type SimpleTexListKind = "itemize" | "enumerate" | "description";
export type SimpleTexVerticalGlueCommandName =
  | "vspace"
  | "vskip"
  | "smallskip"
  | "medskip"
  | "bigskip"
  | "vfill";

export interface SimpleTexFontState {
  readonly family: TexFontFamily;
  readonly series: TexFontSeries;
  readonly shape: TexFontShape;
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
}

export interface SimpleTexLineBreakNode extends SimpleTexSourceRange {
  readonly kind: "line-break";
  readonly text: string;
  readonly lineLeading?: string;
}

export interface SimpleTexMathNode extends SimpleTexSourceRange {
  readonly kind: "math";
  readonly text: string;
  readonly delimiter: "dollar" | "paren";
  readonly content: string;
  readonly contentStart: number;
  readonly contentEnd: number;
}

export type SimpleTexDisplayMathDelimiter =
  | "bracket"
  | "double-dollar"
  | "equation"
  | "equation-star"
  | "align"
  | "align-star"
  | "gather-star";

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

export interface SimpleTexGroupNode extends SimpleTexSourceRange {
  readonly kind: "group";
  readonly text: string;
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

export type SimpleTexInlineNode =
  | SimpleTexTextNode
  | SimpleTexSpaceNode
  | SimpleTexLineBreakNode
  | SimpleTexMathNode
  | SimpleTexFontCommandNode
  | SimpleTexFontDeclarationNode
  | SimpleTexGroupNode;

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
  | SimpleTexUnsupportedCommandNode;

export type SimpleTexNode = SimpleTexInlineNode | SimpleTexControlNode;

export interface SimpleTexToken {
  readonly kind: "text" | "space" | "forced-break" | "math";
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly delimiter?: "dollar" | "paren";
  readonly content?: string;
  readonly contentStart?: number;
  readonly contentEnd?: number;
  readonly lineLeading?: string;
  readonly fontState: SimpleTexFontState;
  readonly italicCorrectionAfter?: boolean;
}

export interface SimpleTexParagraphBlock {
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly nodes: readonly SimpleTexInlineNode[];
  readonly noIndent: boolean;
  readonly alignment?: TexParagraphAlignment;
  readonly alignmentProfile?: TexAlignmentProfile;
  readonly quoteDepth: number;
  readonly listContext?: SimpleTexListContext;
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
}

export interface SimpleTexVerticalRuleBlockItem extends SimpleTexSourceRange {
  readonly kind: "vertical-rule";
  readonly text: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly quoteDepth: number;
  readonly listScope?: SimpleTexListScope;
}

export interface SimpleTexPenaltyBlockItem extends SimpleTexSourceRange {
  readonly kind: "penalty";
  readonly text: string;
  readonly penalty: number;
  readonly quoteDepth: number;
  readonly listScope?: SimpleTexListScope;
}

export interface SimpleTexPlaceholderBlockItem extends SimpleTexSourceRange {
  readonly kind: "placeholder";
  readonly text: string;
  readonly reason: string;
  readonly quoteDepth: number;
  readonly listScope?: SimpleTexListScope;
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
  readonly quoteDepth: number;
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
  width: number
): SimpleTexParagraphAnalysis {
  if (!Number.isFinite(width) || width <= 0) {
    return {
      ir: null,
      fallbackReason: "Paragraph width must be positive.",
    };
  }
  const ir = buildSimpleTexParagraphIr(text);
  if (ir.unsupportedCommand || simpleTexIrHasUnsupportedDirectTextChar(ir.nodes)) {
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
    if (codePoint > 0x7e || (codePoint < 0x20 && codePoint !== 0x0a)) {
      return {
        ir,
        fallbackReason: `Paragraph contains unsupported OT1 character U+${codePoint.toString(16).toUpperCase()}.`,
      };
    }
  }
  return { ir, fallbackReason: null };
}

function simpleTexIrHasUnsupportedDirectTextChar(nodes: readonly SimpleTexNode[]): boolean {
  for (const node of nodes) {
    if (node.kind === "text" && unsupportedDirectTextCharPattern.test(node.text)) {
      return true;
    }
    if (
      (node.kind === "font-command" || node.kind === "group") &&
      simpleTexIrHasUnsupportedDirectTextChar(node.children)
    ) {
      return true;
    }
    if (
      node.kind === "item" &&
      node.labelNodes &&
      simpleTexIrHasUnsupportedDirectTextChar(node.labelNodes)
    ) {
      return true;
    }
  }
  return false;
}

export function parseSimpleTexParagraphIr(text: string): SimpleTexParagraphIr {
  return buildSimpleTexParagraphIr(text);
}

function buildSimpleTexParagraphIr(text: string): SimpleTexParagraphIr {
  const nodeScan = scanSimpleTexIrNodes(text);
  const blockScan = buildSimpleTexParagraphBlocksFromNodes(text, nodeScan.nodes);
  return {
    kind: "simple-tex-paragraph",
    nodes: nodeScan.nodes,
    blocks: blockScan.blocks,
    items: blockScan.items,
    partialFallbackSupported:
      blockScan.partialFallbackSupported &&
      blockScan.items.some((item) => item.kind === "placeholder"),
    unsupportedCommand: nodeScan.unsupportedCommand || blockScan.unsupportedCommand,
  };
}

function scanSimpleTexIrNodes(
  text: string,
  sourceOffset = 0
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
        });
        index = lineBreak.end;
        continue;
      }

      const paragraphCommand = scanSimpleTexParagraphCommand(text, index);
      const environmentBoundary = scanSimpleTexEnvironmentBoundary(text, index);
      const itemCommand = scanSimpleTexItemCommand(text, index, sourceOffset);
      const verticalGlue = scanSimpleTexVerticalGlueCommand(text, index, sourceOffset);
      const verticalRule = scanSimpleTexVerticalRuleCommand(text, index, sourceOffset);
      const penalty = scanSimpleTexPenaltyCommand(text, index, sourceOffset);
      const fontCommand = scanSimpleTexFontCommand(text, index, sourceOffset);
      const fontDeclaration = scanSimpleTexFontDeclaration(text, index, sourceOffset);
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

      const end = scanUnsupportedControlSequenceEnd(text, index);
      nodes.push({
        kind: "unsupported-command",
        text: text.slice(index, end),
        sourceStart,
        sourceEnd: sourceOffset + end,
      });
      unsupportedCommand = true;
      index = end;
      continue;
    }

    if (char === "{") {
      const group = scanSimpleTexGroup(text, index, sourceOffset);
      if (group) {
        nodes.push(group.node);
        unsupportedCommand ||= group.unsupportedCommand;
        index = group.end;
        continue;
      }
      nodes.push({
        kind: "unsupported-command",
        text: char,
        sourceStart,
        sourceEnd: sourceStart + 1,
      });
      unsupportedCommand = true;
      index += 1;
      continue;
    }

    if (char === "}") {
      nodes.push({
        kind: "unsupported-command",
        text: char,
        sourceStart,
        sourceEnd: sourceStart + 1,
      });
      unsupportedCommand = true;
      index += 1;
      continue;
    }

    if (char === "$") {
      nodes.push({
        kind: "unsupported-command",
        text: char,
        sourceStart,
        sourceEnd: sourceStart + 1,
      });
      unsupportedCommand = true;
      index += 1;
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

    const start = index;
    while (
      index < text.length &&
      text[index] !== "\\" &&
      text[index] !== "{" &&
      text[index] !== "}" &&
      text[index] !== "$" &&
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
    if (name === "quote" || name === "itemize" || name === "enumerate" || name === "description") {
      return {
        boundary,
        name,
        end: nameEnd + 1,
      };
    }
  }
  return null;
}

function scanSimpleTexItemCommand(
  text: string,
  start: number,
  sourceOffset: number
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
      sourceOffset + contentStart
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
  sourceOffset: number
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
    sourceOffset + contentStart
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

function scanSimpleTexFontCommandName(
  text: string,
  start: number
): { name: SimpleTexFontCommandName; end: number } | null {
  for (const name of ["textnormal", "textit", "textbf", "textrm", "textsf", "textsc", "emph"] as const) {
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
  for (const name of [
    "normalfont",
    "bfseries",
    "mdseries",
    "rmfamily",
    "sffamily",
    "itshape",
    "upshape",
    "scshape",
    "it",
    "bf",
    "rm",
    "sf",
    "sc",
    "em",
  ] as const) {
    const end = scanSimpleTexControlWord(text, start, name);
    if (end !== null) {
      return { name, end };
    }
  }
  return null;
}

function scanSimpleTexGroup(
  text: string,
  start: number,
  sourceOffset: number
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
    sourceOffset + contentStart
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
): { end: number; lineLeading?: string } | null {
  if (text[start] !== "\\" || text[start + 1] !== "\\") {
    return null;
  }

  let end = start + 2;
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
    node.kind === "group"
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
  sourceNodes: readonly SimpleTexNode[]
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
  }
  const listStack: ActiveSimpleTexList[] = [];
  const environmentStack: SimpleTexEnvironmentName[] = [];
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

  const sourceStartForNodeIndex = (index: number): number =>
    sourceNodes[index]?.sourceStart ?? text.length;

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

  const pushBlock = (
    rawStart: number,
    rawEnd: number,
    noIndent: boolean,
    quoteDepth: number,
    alignment?: TexParagraphAlignment,
    alignmentProfile?: TexAlignmentProfile
  ) => {
    let start = rawStart;
    let end = rawEnd;
    while (start < end && (text[start] === " " || text[start] === "\n")) {
      start += 1;
    }
    while (end > start && (text[end - 1] === " " || text[end - 1] === "\n")) {
      end -= 1;
    }
    if (start < end) {
      const listContext = currentSimpleTexListContext();
      if (listStack.length > 0 && !listContext) {
        unsupportedCommand = true;
        abortScan = true;
        return;
      }
      const block: SimpleTexParagraphBlock = {
        text: text.slice(start, end),
        sourceStart: start,
        sourceEnd: end,
        nodes: simpleTexInlineNodesForRange(sourceNodes, start, end),
        noIndent,
        alignment,
        alignmentProfile,
        quoteDepth,
        listContext,
      };
      blocks.push(block);
      items.push({
        kind: "paragraph",
        blockIndex: blocks.length - 1,
        block,
      });
      pendingListLabel = undefined;
      pendingListShowLabel = false;
    }
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
    listStack.push({
      kind,
      depth,
      labelDepth,
      itemIndex: 0,
      ownLeftMarginEm: ownMargin,
      totalLeftMarginEm: (listStack.at(-1)?.totalLeftMarginEm ?? 0) + ownMargin,
    });
  };

  let prefix = consumeParagraphPrefix(0);
  let blockStart = sourceStartForNodeIndex(prefix.start);
  let currentNoIndent = prefix.noIndent;
  let currentQuoteDepth = 0;
  let index = prefix.start;
  while (index < sourceNodes.length) {
    const node = sourceNodes[index];
    if (!node) {
      unsupportedCommand = true;
      abortScan = true;
      break;
    }

    if (node.kind === "unsupported-command") {
      if (hasNonSpaceSourceText(text, blockStart, node.sourceStart)) {
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
        quoteDepth: currentQuoteDepth,
        listScope: currentSimpleTexListScope(),
      });
      unsupportedCommand = true;
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = prefix.noIndent || currentQuoteDepth > 0 || listStack.length > 0;
      index = prefix.start;
      continue;
    }

    if (node.kind === "display-math") {
      pushBlock(
        blockStart,
        node.sourceStart,
        currentNoIndent,
        currentQuoteDepth,
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
        quoteDepth: currentQuoteDepth,
        listScope: currentSimpleTexListScope(),
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
        currentQuoteDepth,
        prefix.alignment,
        prefix.alignmentProfile
      );
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = prefix.noIndent || currentQuoteDepth > 0 || listStack.length > 0;
      index = prefix.start;
      continue;
    }

    if (node.kind === "environment-boundary") {
      pushBlock(
        blockStart,
        node.sourceStart,
        currentNoIndent || currentQuoteDepth > 0 || listStack.length > 0,
        currentQuoteDepth,
        prefix.alignment,
        prefix.alignmentProfile
      );
      if (abortScan) {
        break;
      }
      if (node.boundary === "begin") {
        environmentStack.push(node.name);
        if (node.name === "quote") {
          currentQuoteDepth += 1;
        } else {
          beginList(node.name);
        }
      } else {
        const openName = environmentStack.pop();
        if (openName !== node.name) {
          unsupportedCommand = true;
          abortScan = true;
          break;
        }
        if (node.name === "quote") {
          currentQuoteDepth -= 1;
          if (currentQuoteDepth < 0) {
            unsupportedCommand = true;
            abortScan = true;
            break;
          }
        } else {
          listStack.pop();
          pendingListLabel = undefined;
          pendingListShowLabel = false;
        }
      }
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = prefix.noIndent || currentQuoteDepth > 0 || listStack.length > 0;
      index = prefix.start;
      continue;
    }

    if (node.kind === "item") {
      pushBlock(
        blockStart,
        node.sourceStart,
        currentNoIndent || currentQuoteDepth > 0 || listStack.length > 0,
        currentQuoteDepth,
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
      if (hasNonSpaceSourceText(text, blockStart, node.sourceStart)) {
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
        quoteDepth: currentQuoteDepth,
        listScope: currentSimpleTexListScope(),
      });
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = prefix.noIndent || currentQuoteDepth > 0 || listStack.length > 0;
      index = prefix.start;
      continue;
    }

    if (node.kind === "vertical-rule") {
      if (hasNonSpaceSourceText(text, blockStart, node.sourceStart)) {
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
        quoteDepth: currentQuoteDepth,
        listScope: currentSimpleTexListScope(),
      });
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = prefix.noIndent || currentQuoteDepth > 0 || listStack.length > 0;
      index = prefix.start;
      continue;
    }

    if (node.kind === "penalty") {
      if (hasNonSpaceSourceText(text, blockStart, node.sourceStart)) {
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
        quoteDepth: currentQuoteDepth,
        listScope: currentSimpleTexListScope(),
      });
      prefix = consumeParagraphPrefix(index + 1);
      blockStart = sourceStartForNodeIndex(prefix.start);
      currentNoIndent = prefix.noIndent || currentQuoteDepth > 0 || listStack.length > 0;
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
    if (currentQuoteDepth !== 0 || listStack.length !== 0 || environmentStack.length !== 0) {
      unsupportedCommand = true;
      abortScan = true;
    }
  }
  if (!abortScan) {
    pushBlock(
      blockStart,
      text.length,
      currentNoIndent || currentQuoteDepth > 0 || listStack.length > 0,
      currentQuoteDepth,
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

function hasNonSpaceSourceText(text: string, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    const char = text[index];
    if (char !== " " && char !== "\n") {
      return true;
    }
  }
  return false;
}

export function splitSimpleTexParagraphSegments(
  block: SimpleTexSegmentInput,
  options: SimpleTexIrOptions,
  alignment: TexParagraphAlignment,
  blockIndex: number
): SimpleTexParagraphSegment[] {
  const initialNoIndent = block.noIndent || (options.tikzTextWidthNode === true && blockIndex === 0);
  if (alignment === "justified") {
    return [{
      text: block.text,
      sourceStart: block.sourceSpan.start,
      sourceEnd: block.sourceSpan.end,
      nodes: block.nodes,
      noIndent: initialNoIndent,
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
        forcedBreakAfter,
      });
    }
  };

  for (let index = 0; index < block.nodes.length; index += 1) {
    const node = block.nodes[index];
    if (node.kind !== "line-break") {
      continue;
    }

    pushSegment(segmentStart, node.sourceStart, block.nodes.slice(nodeStart, index), noIndent, {
      sourceOffset: node.sourceStart,
      lineLeading: node.lineLeading,
    });
    index += 1;
    while (block.nodes[index]?.kind === "space") {
      index += 1;
    }
    segmentStart = block.nodes[index]?.sourceStart ?? block.sourceSpan.end;
    nodeStart = index;
    noIndent = block.quoteDepth > 0 || noIndentAfterForcedBreak(options, alignment);
    index -= 1;
  }

  pushSegment(segmentStart, block.sourceSpan.end, block.nodes.slice(nodeStart), noIndent);
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
      tokens.push({
        kind: "forced-break",
        text: node.text,
        sourceStart: node.sourceStart,
        sourceEnd: node.sourceEnd,
        lineLeading: node.lineLeading,
        fontState: activeFontState,
      });
      skipPostLineBreakSpace = true;
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
      if (simpleTexFontStateHasItalicCorrection(childTokens[0]?.fontState)) {
        markLastTextTokenItalicCorrection(childTokens);
      }
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

    if (node.kind === "font-declaration") {
      activeFontState = simpleTexFontStateForDeclaration(
        activeFontState,
        node.command
      );
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
      });
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
  return state?.shape === "italic";
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

function simpleTexFontStateForCommand(
  current: SimpleTexFontState,
  command: SimpleTexFontCommandName
): SimpleTexFontState {
  if (command === "textit") {
    return { ...current, shape: "italic" };
  }
  if (command === "textbf") {
    return { ...current, series: "bold" };
  }
  if (command === "emph") {
    return {
      ...current,
      shape: current.shape === "italic" ? "upright" : "italic",
    };
  }
  if (command === "textnormal") {
    return luaLatexNormalFontState;
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
  if (command === "sc") {
    return { ...defaultSimpleTexFontState, shape: "small-caps" };
  }
  if (command === "em") {
    return {
      ...current,
      shape: current.shape === "italic" ? "upright" : "italic",
    };
  }
  if (command === "normalfont") {
    return luaLatexNormalFontState;
  }
  if (command === "itshape") {
    return { ...current, shape: "italic" };
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
  return { ...current, family: "roman" };
}
