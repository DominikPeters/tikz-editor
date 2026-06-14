import type {
  SimpleTexBlockItem,
  SimpleTexParagraphBlock,
  SimpleTexPenaltyBlockItem,
  SimpleTexPlaceholderBlockItem,
  SimpleTexVerticalGlueBlockItem,
  SimpleTexVerticalRuleBlockItem,
} from "../ir.js";
import { texVBoxRolePathForScope } from "./scope-roles.js";
import type {
  TexGlueItem,
  TexParagraphInput,
  TexPenaltyItem,
  TexPlaceholderItem,
  TexRuleItem,
  TexSourceSpan,
  TexVBoxRole,
  TexVListDocument,
  TexVListItem,
} from "./types.js";

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
    if (item.kind === "penalty") {
      return penaltyItemFromSimpleTexPenalty(item);
    }
    if (item.kind === "placeholder") {
      return placeholderItemFromSimpleTexPlaceholder(item);
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
