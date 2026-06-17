import type {
  SimpleTexBlockItem,
  SimpleTexDisplayMathBlockItem,
  SimpleTexParagraphBlock,
  SimpleTexPenaltyBlockItem,
  SimpleTexPlaceholderBlockItem,
  SimpleTexVerticalGlueBlockItem,
  SimpleTexVerticalRuleBlockItem,
} from "../ir.js";
import type { ResolvedTexFont } from "../fonts/types.js";
import {
  texVBoxLayoutForScopeRole,
  texVBoxRolePathForScope,
} from "./scope-roles.js";
import type {
  TexGlueItem,
  TexDisplayAlignmentItem,
  TexDisplayMathItem,
  TexParagraphInput,
  TexPenaltyItem,
  TexPlaceholderItem,
  TexRuleItem,
  TexSourceSpan,
  TexVBoxRole,
  TexVListDocument,
  TexVListItem,
} from "./types.js";
import type { TexMathBoxProvider } from "../layout-inline-items.js";

export interface LowerSimpleTexBlockItemsToVListOptions {
  readonly font?: ResolvedTexFont;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly width?: number;
}

export function lowerSimpleTexBlocksToVList(
  blocks: readonly SimpleTexParagraphBlock[],
  options: LowerSimpleTexBlockItemsToVListOptions = {}
): TexVListDocument {
  return lowerSimpleTexBlockItemsToVList(blocks.map((block, blockIndex) => ({
    kind: "paragraph",
    blockIndex,
    block,
  })), options);
}

export function lowerSimpleTexBlockItemsToVList(
  blockItems: readonly SimpleTexBlockItem[],
  options: LowerSimpleTexBlockItemsToVListOptions = {}
): TexVListDocument {
  const items: TexVListItem[] = blockItems.map((item) => {
    if (item.kind === "vertical-glue") {
      return glueItemFromSimpleTexVerticalGlue(item);
    }
    if (item.kind === "vertical-rule") {
      return ruleItemFromSimpleTexVerticalRule(item);
    }
    if (item.kind === "penalty") {
      return penaltyItemFromSimpleTexPenalty(item);
    }
    if (item.kind === "placeholder") {
      return placeholderItemFromSimpleTexPlaceholder(item);
    }
    if (item.kind === "display-math") {
      return displayMathItemFromSimpleTexDisplayMath(item, options);
    }
    return {
      kind: "paragraph",
      sourceSpan: sourceSpanFromBlock(item.block),
      blockIndex: item.blockIndex,
      paragraph: paragraphInputFromSimpleTexBlock(item.block, item.blockIndex),
    };
  });
  return {
    kind: "vlist",
    sourceSpan: sourceSpanForVListItems(items),
    items,
  };
}

function displayMathItemFromSimpleTexDisplayMath(
  item: SimpleTexDisplayMathBlockItem,
  options: LowerSimpleTexBlockItemsToVListOptions
): TexDisplayMathItem | TexDisplayAlignmentItem | TexPlaceholderItem {
  const sourceSpan = {
    start: item.sourceStart,
    end: item.sourceEnd,
  };
  const scopePath = scopePathForVerticalBlockItem(item);
  const targetWidth = scopedDisplayMathTargetWidth(scopePath, options);
  if (item.delimiter === "equation" || item.delimiter === "align") {
    return unsupportedDisplayMathPlaceholder(item, sourceSpan);
  }
  if (item.delimiter === "align-star" || item.delimiter === "gather-star") {
    const alignment = options.mathBoxProvider?.getDisplayMathAlignment?.({
      source: item.text,
      content: item.content,
      delimiter: item.delimiter,
      sourceStart: item.sourceStart,
      sourceEnd: item.sourceEnd,
      contentStart: item.contentStart,
      contentEnd: item.contentEnd,
      targetWidth: targetWidth ?? 0,
    }) ?? null;
    if (!alignment) {
      return unsupportedDisplayMathPlaceholder(item, sourceSpan);
    }
    return {
      kind: "display-alignment",
      sourceSpan,
      scopePath,
      text: item.text,
      content: item.content,
      delimiter: item.delimiter,
      contentStart: item.contentStart,
      contentEnd: item.contentEnd,
      targetWidth: targetWidth ?? alignment.width,
      alignment,
    };
  }
  const box = options.mathBoxProvider?.getDisplayMathBox?.({
    source: item.text,
    content: item.content,
    delimiter: item.delimiter,
    sourceStart: item.sourceStart,
    sourceEnd: item.sourceEnd,
    contentStart: item.contentStart,
    contentEnd: item.contentEnd,
    targetWidth,
  }) ?? null;
  if (!box) {
    return unsupportedDisplayMathPlaceholder(item, sourceSpan);
  }
  return {
    kind: "display-math",
    sourceSpan,
    scopePath,
    text: item.text,
    content: item.content,
    delimiter: item.delimiter,
    contentStart: item.contentStart,
    contentEnd: item.contentEnd,
    targetWidth: targetWidth ?? box.width,
    box,
  };
}

function scopedDisplayMathTargetWidth(
  scopePath: readonly TexVBoxRole[] | undefined,
  options: LowerSimpleTexBlockItemsToVListOptions
): number | undefined {
  const width = options.width;
  if (width === undefined) {
    return undefined;
  }
  const font = options.font;
  if (!font || !scopePath?.length) {
    return width;
  }
  const marginWidth = scopePath.reduce((sum, role) => {
    const layout = texVBoxLayoutForScopeRole(role, font);
    return sum + layout.leftMarginWidth + layout.rightMarginWidth;
  }, 0);
  return Math.max(0, width - marginWidth);
}

function unsupportedDisplayMathPlaceholder(
  item: SimpleTexDisplayMathBlockItem,
  sourceSpan: TexSourceSpan
): TexPlaceholderItem {
  const reason = item.delimiter === "equation" || item.delimiter === "align"
    ? "Numbered TeX display math is not implemented yet."
    : "TeX display math rendering is not implemented for this formula.";
  return {
    kind: "placeholder",
    sourceSpan,
    reason,
    scopePath: scopePathForVerticalBlockItem(item),
    estimated: {
      width: 0,
      height: 10,
      depth: 4,
    },
  };
}

function placeholderItemFromSimpleTexPlaceholder(
  item: SimpleTexPlaceholderBlockItem
): TexPlaceholderItem {
  return {
    kind: "placeholder",
    sourceSpan: {
      start: item.sourceStart,
      end: item.sourceEnd,
    },
    reason: item.reason,
    scopePath: scopePathForVerticalBlockItem(item),
    estimated: {
      width: 0,
      height: 8.5,
      depth: 3.5,
    },
  };
}

function glueItemFromSimpleTexVerticalGlue(item: SimpleTexVerticalGlueBlockItem): TexGlueItem {
  return {
    kind: "glue",
    sourceSpan: {
      start: item.sourceStart,
      end: item.sourceEnd,
    },
    origin: {
      kind: "explicit-command",
      command: item.command,
    },
    scopePath: scopePathForVerticalBlockItem(item),
    size: item.size,
    stretch: item.stretch,
    shrink: item.shrink,
    stretchOrder: item.stretchOrder,
    shrinkOrder: item.shrinkOrder,
  };
}

function ruleItemFromSimpleTexVerticalRule(item: SimpleTexVerticalRuleBlockItem): TexRuleItem {
  return {
    kind: "rule",
    sourceSpan: {
      start: item.sourceStart,
      end: item.sourceEnd,
    },
    scopePath: scopePathForVerticalBlockItem(item),
    width: item.width,
    height: item.height,
    depth: item.depth,
  };
}

function penaltyItemFromSimpleTexPenalty(item: SimpleTexPenaltyBlockItem): TexPenaltyItem {
  return {
    kind: "penalty",
    sourceSpan: {
      start: item.sourceStart,
      end: item.sourceEnd,
    },
    scopePath: scopePathForVerticalBlockItem(item),
    penalty: item.penalty,
  };
}

function scopePathForVerticalBlockItem(
  item:
    | SimpleTexVerticalGlueBlockItem
    | SimpleTexVerticalRuleBlockItem
    | SimpleTexPenaltyBlockItem
    | SimpleTexDisplayMathBlockItem
    | SimpleTexPlaceholderBlockItem
): readonly TexVBoxRole[] | undefined {
  const path = texVBoxRolePathForScope(item);
  return path.length > 0 ? path : undefined;
}

function sourceSpanFromBlock(block: SimpleTexParagraphBlock): TexSourceSpan {
  return {
    start: block.sourceStart,
    end: block.sourceEnd,
  };
}

function paragraphInputFromSimpleTexBlock(
  block: SimpleTexParagraphBlock,
  blockIndex: number
): TexParagraphInput {
  return {
    blockIndex,
    text: block.text,
    sourceSpan: sourceSpanFromBlock(block),
    nodes: block.nodes,
    noIndent: block.noIndent,
    alignment: block.alignment,
    alignmentProfile: block.alignmentProfile,
    quoteDepth: block.quoteDepth,
    listContext: block.listContext,
  };
}

function sourceSpanForVListItems(
  items: readonly TexVListItem[]
): TexSourceSpan | undefined {
  let span: TexSourceSpan | undefined;
  for (const item of items) {
    if (!item.sourceSpan) {
      continue;
    }
    if (!span) {
      span = item.sourceSpan;
      continue;
    }
    span = {
      start: Math.min(span.start, item.sourceSpan.start),
      end: Math.max(span.end, item.sourceSpan.end),
    };
  }
  return span;
}
