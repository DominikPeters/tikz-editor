import type { ParagraphAlignment } from "../knuth-plass/alignment.js";

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
export type SimpleTexEnvironmentName = "quote" | "itemize" | "enumerate";
export type SimpleTexListKind = "itemize" | "enumerate";

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

export type SimpleTexInlineNode =
  | SimpleTexTextNode
  | SimpleTexSpaceNode
  | SimpleTexLineBreakNode
  | SimpleTexFontCommandNode
  | SimpleTexFontDeclarationNode
  | SimpleTexGroupNode;

export type SimpleTexControlNode =
  | SimpleTexParagraphBreakNode
  | SimpleTexNoIndentNode
  | SimpleTexAlignmentNode
  | SimpleTexEnvironmentBoundaryNode
  | SimpleTexItemNode
  | SimpleTexUnsupportedCommandNode;

export type SimpleTexNode = SimpleTexInlineNode | SimpleTexControlNode;

export interface SimpleTexToken {
  readonly kind: "text" | "space" | "forced-break";
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
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

export interface SimpleTexListContext {
  readonly kind: SimpleTexListKind;
  readonly depth: number;
  readonly labelDepth: number;
  readonly itemIndex: number;
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

export interface SimpleTexParagraphBlockScanResult {
  readonly blocks: readonly SimpleTexParagraphBlock[];
  readonly unsupportedCommand: boolean;
}

export interface SimpleTexParagraphIr {
  readonly kind: "simple-tex-paragraph";
  readonly nodes: readonly SimpleTexNode[];
  readonly blocks: readonly SimpleTexParagraphBlock[];
  readonly unsupportedCommand: boolean;
}

interface SimpleTexIrOptions {
  readonly parindent?: number;
  readonly tikzTextWidthNode?: boolean;
}

const unsupportedDirectCharPattern = /[$&_^~#%]/;
const whitespacePattern = /[ \n]+/;
const paragraphBreakPattern = /^\n(?: *\n)+/;
const lineLeadingOptionPattern =
  /^\[\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu)\s*\]/i;
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
const articleListLeftMarginEmByDepth = [2.5, 2.2, 1.87, 1.7, 1, 1];

export function getSimpleTexFallbackReason(text: string, width: number): string | null {
  if (!Number.isFinite(width) || width <= 0) {
    return "Paragraph width must be positive.";
  }
  if (unsupportedDirectCharPattern.test(text)) {
    return "Paragraph contains TeX syntax that is not supported by the simple text path.";
  }
  const nodeScan = scanSimpleTexIrNodes(text);
  const blockScan = buildSimpleTexParagraphBlocksFromNodes(text, nodeScan.nodes);
  if (nodeScan.unsupportedCommand || blockScan.unsupportedCommand) {
    return "Paragraph contains TeX syntax that is not supported by the simple text path.";
  }
  for (let index = 0; index < text.length; index++) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint > 0x7e || (codePoint < 0x20 && codePoint !== 0x0a)) {
      return `Paragraph contains unsupported OT1 character U+${codePoint.toString(16).toUpperCase()}.`;
    }
  }
  return null;
}

export function parseSimpleTexParagraphIr(text: string): SimpleTexParagraphIr {
  const nodeScan = scanSimpleTexIrNodes(text);
  const blockScan = buildSimpleTexParagraphBlocksFromNodes(text, nodeScan.nodes);
  return {
    kind: "simple-tex-paragraph",
    nodes: nodeScan.nodes,
    blocks: blockScan.blocks,
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
    if (name === "quote" || name === "itemize" || name === "enumerate") {
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
  return index > start + 1 ? index : Math.min(text.length, start + 2);
}

function isSimpleTexInlineNode(node: SimpleTexNode): node is SimpleTexInlineNode {
  return (
    node.kind === "text" ||
    node.kind === "space" ||
    node.kind === "line-break" ||
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

export function splitSimpleTexParagraphBlocks(
  text: string
): SimpleTexParagraphBlockScanResult {
  return buildSimpleTexParagraphBlocksFromNodes(text, scanSimpleTexIrNodes(text).nodes);
}

function buildSimpleTexParagraphBlocksFromNodes(
  text: string,
  sourceNodes: readonly SimpleTexNode[]
): SimpleTexParagraphBlockScanResult {
  const blocks: SimpleTexParagraphBlock[] = [];
  let unsupportedCommand = false;
  interface ActiveSimpleTexList {
    readonly kind: SimpleTexListKind;
    readonly depth: number;
    readonly labelDepth: number;
    itemIndex: number;
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
        return;
      }
      blocks.push({
        text: text.slice(start, end),
        sourceStart: start,
        sourceEnd: end,
        nodes: simpleTexInlineNodesForRange(sourceNodes, start, end),
        noIndent,
        alignment,
        alignmentProfile,
        quoteDepth,
        listContext,
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
    if (!node || node.kind === "unsupported-command") {
      unsupportedCommand = true;
      break;
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
      if (unsupportedCommand) {
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
          break;
        }
        if (node.name === "quote") {
          currentQuoteDepth -= 1;
          if (currentQuoteDepth < 0) {
            unsupportedCommand = true;
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
      if (unsupportedCommand) {
        break;
      }
      const activeList = listStack.at(-1);
      if (!activeList) {
        unsupportedCommand = true;
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

    if (node.kind === "noindent" || node.kind === "alignment") {
      unsupportedCommand = true;
      break;
    }

    index += 1;
  }
  if (!unsupportedCommand) {
    if (currentQuoteDepth !== 0 || listStack.length !== 0 || environmentStack.length !== 0) {
      unsupportedCommand = true;
    }
  }
  if (!unsupportedCommand) {
    pushBlock(
      blockStart,
      text.length,
      currentNoIndent || currentQuoteDepth > 0 || listStack.length > 0,
      currentQuoteDepth,
      prefix.alignment,
      prefix.alignmentProfile
    );
  }
  return { blocks, unsupportedCommand };
}

export function splitSimpleTexParagraphSegments(
  block: SimpleTexParagraphBlock,
  options: SimpleTexIrOptions,
  alignment: TexParagraphAlignment,
  blockIndex: number
): SimpleTexParagraphSegment[] {
  const initialNoIndent = block.noIndent || (options.tikzTextWidthNode === true && blockIndex === 0);
  if (alignment === "justified") {
    return [{
      text: block.text,
      sourceStart: block.sourceStart,
      sourceEnd: block.sourceEnd,
      nodes: block.nodes,
      noIndent: initialNoIndent,
    }];
  }

  const segments: SimpleTexParagraphSegment[] = [];
  let segmentStart = block.sourceStart;
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
        text: block.text.slice(start - block.sourceStart, end - block.sourceStart),
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
    segmentStart = block.nodes[index]?.sourceStart ?? block.sourceEnd;
    nodeStart = index;
    noIndent = block.quoteDepth > 0 || noIndentAfterForcedBreak(options, alignment);
    index -= 1;
  }

  pushSegment(segmentStart, block.sourceEnd, block.nodes.slice(nodeStart), noIndent);
  return segments;
}

function textCharAtSource(block: SimpleTexParagraphBlock, sourceOffset: number): string {
  return block.text[sourceOffset - block.sourceStart] ?? "";
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

export function tokenizeSimpleTexParagraph(
  text: string,
  sourceOffset: number
): SimpleTexToken[] {
  return simpleTexInlineNodesToTokens(
    scanSimpleTexIrNodes(text, sourceOffset).nodes.filter(isSimpleTexInlineNode)
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
        markPreviousTextTokenItalicCorrection(tokens);
      }
      let childTokens = simpleTexInlineNodesToTokens(
        node.children,
        childFontState
      );
      if (simpleTexFontStateHasItalicCorrection(childTokens[0]?.fontState)) {
        childTokens = markLastTextTokenItalicCorrection(childTokens);
      }
      if (skipPostLineBreakSpace && childTokens[0]?.kind === "space") {
        tokens.push(...childTokens.slice(1));
      } else {
        tokens.push(...childTokens);
      }
      skipPostLineBreakSpace = childTokens.at(-1)?.kind === "forced-break";
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

function markLastTextTokenItalicCorrection(
  tokens: readonly SimpleTexToken[]
): SimpleTexToken[] {
  const next = [...tokens];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index]?.kind !== "text") {
      continue;
    }
    next[index] = {
      ...next[index],
      italicCorrectionAfter: true,
    };
    break;
  }
  return next;
}

function markPreviousTextTokenItalicCorrection(tokens: SimpleTexToken[]): void {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index]?.kind !== "text") {
      continue;
    }
    tokens[index] = {
      ...tokens[index],
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
