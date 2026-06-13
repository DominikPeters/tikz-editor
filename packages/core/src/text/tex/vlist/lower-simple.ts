import type {
  SimpleTexBlockItem,
  SimpleTexParagraphBlock,
  SimpleTexPlaceholderBlockItem,
  SimpleTexVerticalGlueBlockItem,
  SimpleTexVerticalRuleBlockItem,
} from "../ir.js";
import type {
  TexGlueItem,
  TexPlaceholderItem,
  TexRuleItem,
  TexSourceSpan,
  TexVBoxRole,
  TexVListDocument,
  TexVListItem,
} from "./types.js";

export interface SimpleTexParagraphVerticalSkip {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly size: number;
}

export function lowerSimpleTexBlocksToVList(
  blocks: readonly SimpleTexParagraphBlock[]
): TexVListDocument {
  return lowerSimpleTexBlockItemsToVList(blocks.map((block, blockIndex) => ({
    kind: "paragraph",
    blockIndex,
    block,
  })));
}

export function lowerSimpleTexBlockItemsToVList(
  blockItems: readonly SimpleTexBlockItem[]
): TexVListDocument {
  const items: TexVListItem[] = blockItems.map((item) => {
    if (item.kind === "vertical-glue") {
      return glueItemFromSimpleTexVerticalGlue(item);
    }
    if (item.kind === "vertical-rule") {
      return ruleItemFromSimpleTexVerticalRule(item);
    }
    if (item.kind === "placeholder") {
      return placeholderItemFromSimpleTexPlaceholder(item);
    }
    return {
      kind: "paragraph",
      sourceSpan: sourceSpanFromBlock(item.block),
      blockIndex: item.blockIndex,
      block: item.block,
    };
  });
  return {
    kind: "vlist",
    sourceSpan: sourceSpanForVListItems(items),
    items,
  };
}

export function addParagraphVerticalGlueToVList(
  vlist: TexVListDocument,
  skips: readonly SimpleTexParagraphVerticalSkip[]
): TexVListDocument {
  const verticalSkipByBlock = new Map<number, number>();
  for (const skip of skips) {
    if (skip.segmentIndex === 0 && skip.size > 0) {
      verticalSkipByBlock.set(skip.blockIndex, skip.size);
    }
  }

  const items: TexVListItem[] = [];
  for (const item of vlist.items) {
    if (item.kind === "paragraph") {
      const size = verticalSkipByBlock.get(item.blockIndex) ?? 0;
      if (size > 0) {
        items.push({
          kind: "glue",
          sourceSpan: item.sourceSpan,
          size,
          stretchOrder: "normal",
          shrinkOrder: "normal",
        });
      }
    }
    items.push(item);
  }

  return {
    ...vlist,
    items,
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

function scopePathForVerticalBlockItem(
  item: SimpleTexVerticalGlueBlockItem | SimpleTexVerticalRuleBlockItem | SimpleTexPlaceholderBlockItem
): readonly TexVBoxRole[] | undefined {
  const path: TexVBoxRole[] = [];
  for (let depth = 1; depth <= item.quoteDepth; depth += 1) {
    path.push({ kind: "quote", depth });
  }
  if (item.listScope) {
    path.push({
      kind: "list",
      listKind: item.listScope.kind,
      depth: item.listScope.depth,
      labelDepth: item.listScope.labelDepth,
      totalLeftMarginEm: item.listScope.totalLeftMarginEm,
    });
  }
  return path.length > 0 ? path : undefined;
}

function sourceSpanFromBlock(block: SimpleTexParagraphBlock): TexSourceSpan {
  return {
    start: block.sourceStart,
    end: block.sourceEnd,
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
