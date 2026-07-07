import type {
  SimpleTexBoxBlockItem,
  SimpleTexBlockItem,
  SimpleTexDisplayMathBlockItem,
  SimpleTexParagraphBlock,
  SimpleTexPenaltyBlockItem,
  SimpleTexPlaceholderBlockItem,
  SimpleTexScopePathRole,
  SimpleTexVerticalGlueBlockItem,
  SimpleTexVerticalRuleBlockItem,
} from "../ir.js";
import type { ResolvedTexFont } from "../fonts/types.js";
import type { NodeTextGraphicsResolver } from "../../types.js";
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
  TexVBoxItem,
  TexVBoxRole,
  TexVListDocument,
  TexVListItem,
} from "./types.js";
import type { TexMathBoxProvider, TexMathDisplayLabel } from "../layout-inline-items.js";
import { parseTexMathAlignedBody } from "../math/index.js";

export interface LowerSimpleTexBlockItemsToVListOptions {
  readonly font?: ResolvedTexFont;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly graphicsResolver?: NodeTextGraphicsResolver;
  readonly width?: number;
  readonly tikzTextWidthNode?: boolean;
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
  const items: TexVListItem[] = [];
  let equationNumber = 0;
  for (const item of blockItems) {
    if (item.kind === "vertical-glue") {
      items.push(glueItemFromSimpleTexVerticalGlue(item));
      continue;
    }
    if (item.kind === "vertical-rule") {
      items.push(ruleItemFromSimpleTexVerticalRule(item));
      continue;
    }
    if (item.kind === "penalty") {
      items.push(penaltyItemFromSimpleTexPenalty(item));
      continue;
    }
    if (item.kind === "box") {
      items.push(vboxItemFromSimpleTexBox(item, options));
      continue;
    }
    if (item.kind === "placeholder") {
      items.push(placeholderItemFromSimpleTexPlaceholder(item));
      continue;
    }
    if (item.kind === "display-math") {
      if (item.delimiter === "equation") {
        equationNumber += 1;
        items.push(displayMathItemFromSimpleTexDisplayMath(item, options, [
          displayLabelForEquationNumberAt(equationNumber, item.sourceEnd),
        ]));
        continue;
      }
      if (item.delimiter === "align" || item.delimiter === "gather") {
        const numberedRows = displayLabelsForNumberedDisplayRows(
          item,
          equationNumber,
          item.delimiter
        );
        equationNumber = numberedRows.nextEquationNumber;
        items.push(displayMathItemFromSimpleTexDisplayMath(item, options, numberedRows.displayLabels));
        continue;
      }
      if (item.delimiter === "multline") {
        const numberedMultline = displayLabelForNumberedMultline(item, equationNumber);
        equationNumber = numberedMultline.nextEquationNumber;
        items.push(displayMathItemFromSimpleTexDisplayMath(item, options, numberedMultline.displayLabels));
        continue;
      }
      items.push(displayMathItemFromSimpleTexDisplayMath(item, options));
      continue;
    }
    items.push({
      kind: "paragraph",
      sourceSpan: sourceSpanFromBlock(item.block),
      blockIndex: item.blockIndex,
      paragraph: paragraphInputFromSimpleTexBlock(item.block, item.blockIndex, options),
    });
  }
  return {
    kind: "vlist",
    sourceSpan: sourceSpanForVListItems(items),
    items,
  };
}

function vboxItemFromSimpleTexBox(
  item: SimpleTexBoxBlockItem,
  options: LowerSimpleTexBlockItemsToVListOptions
): TexVBoxItem {
  const nested = lowerSimpleTexBlockItemsToVList(item.items, {
    ...options,
    width: item.width,
    tikzTextWidthNode: false,
  });
  return {
    kind: "vbox",
    sourceSpan: {
      start: item.sourceStart,
      end: item.sourceEnd,
    },
    scopePath: scopePathForVerticalBlockItem(item),
    material: {
      command: item.command,
    },
    width: item.width,
    ...(item.height !== undefined ? { height: item.height } : {}),
    alignment: item.alignment,
    layout: {
      leftMarginWidth: 0,
      rightMarginWidth: 0,
      paragraphPolicy: {
        resetInheritedAlignment: true,
        resetAlignment: "justified",
        resetSpaceGlueProfile: true,
        preserveSpaceGlueProfile: true,
        resetFinalHyphenDemeritsFromAlignment: true,
        allowParagraphIndent: false,
        allowForcedBreakIndent: false,
      },
    },
    items: nested.items,
  };
}

function displayMathItemFromSimpleTexDisplayMath(
  item: SimpleTexDisplayMathBlockItem,
  options: LowerSimpleTexBlockItemsToVListOptions,
  displayLabels?: readonly (TexMathDisplayLabel | null)[]
): TexDisplayMathItem | TexDisplayAlignmentItem | TexPlaceholderItem {
  const sourceSpan = {
    start: item.sourceStart,
    end: item.sourceEnd,
  };
  const scopePath = scopePathForVerticalBlockItem(item);
  const targetWidth = scopedDisplayMathTargetWidth(scopePath, options);
  if (
    item.delimiter === "align" ||
    item.delimiter === "align-star" ||
    item.delimiter === "flalign" ||
    item.delimiter === "flalign-star" ||
    item.delimiter === "gather" ||
    item.delimiter === "gather-star" ||
    item.delimiter === "multline" ||
    item.delimiter === "multline-star"
  ) {
    const alignment = options.mathBoxProvider?.getDisplayMathAlignment?.({
      source: item.text,
      content: item.content,
      delimiter: item.delimiter,
      sourceStart: item.sourceStart,
      sourceEnd: item.sourceEnd,
      contentStart: item.contentStart,
      contentEnd: item.contentEnd,
      targetWidth: targetWidth ?? 0,
      ...(displayLabels ? { displayLabels } : {}),
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
    ...(displayLabels?.[0] ? { displayLabel: displayLabels[0] } : {}),
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

function displayLabelForNumberedMultline(
  item: SimpleTexDisplayMathBlockItem,
  previousEquationNumber: number
): { readonly displayLabels: readonly (TexMathDisplayLabel | null)[]; readonly nextEquationNumber: number } {
  const parsed = parseTexMathAlignedBody(item.content, {
    sourceOffset: item.contentStart,
    columnSeparation: "multline",
    suppressTerminalEllipsisGlue: true,
  });
  const aligned = parsed.list.items[0];
  if (aligned?.kind !== "atom" || aligned.nucleus.kind !== "aligned") {
    return {
      displayLabels: [],
      nextEquationNumber: previousEquationNumber,
    };
  }
  const rows = aligned.nucleus.rows;
  if (
    rows.length === 0 ||
    rows.some((row) => row.suppressTag) ||
    rows.some((row) => (row.labels?.length ?? 0) > 0)
  ) {
    return {
      displayLabels: [],
      nextEquationNumber: previousEquationNumber,
    };
  }
  const equationNumber = previousEquationNumber + 1;
  const labels = rows.map((row, rowIndex) =>
    rowIndex === rows.length - 1
      ? displayLabelForEquationNumberAt(equationNumber, row.sourceSpan.end)
      : null
  );
  return {
    displayLabels: labels,
    nextEquationNumber: equationNumber,
  };
}

function displayLabelsForNumberedDisplayRows(
  item: SimpleTexDisplayMathBlockItem,
  previousEquationNumber: number,
  columnSeparation: "align" | "gather"
): { readonly displayLabels: readonly (TexMathDisplayLabel | null)[]; readonly nextEquationNumber: number } {
  const parsed = parseTexMathAlignedBody(item.content, {
    sourceOffset: item.contentStart,
    columnSeparation,
    suppressTerminalEllipsisGlue: true,
  });
  const aligned = parsed.list.items[0];
  if (aligned?.kind !== "atom" || aligned.nucleus.kind !== "aligned") {
    return {
      displayLabels: [],
      nextEquationNumber: previousEquationNumber,
    };
  }
  let equationNumber = previousEquationNumber;
  const displayLabels = aligned.nucleus.rows.map((row) => {
    if (row.suppressTag || (row.labels?.length ?? 0) > 0) {
      return null;
    }
    equationNumber += 1;
    return displayLabelForEquationNumberAt(equationNumber, row.sourceSpan.end);
  });
  return {
    displayLabels,
    nextEquationNumber: equationNumber,
  };
}

function displayLabelForEquationNumberAt(
  number: number,
  sourceOffset: number
): TexMathDisplayLabel {
  return {
    text: String(number),
    sourceSpan: {
      start: sourceOffset,
      end: sourceOffset,
    },
    textSourceSpan: {
      start: sourceOffset,
      end: sourceOffset,
    },
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
  const reason = "TeX display math rendering is not implemented for this formula.";
  // The literal run renders one line of monospaced source at 10pt; both
  // cmtt10 and lmmono10 advance 5.25pt per character.
  return {
    kind: "placeholder",
    sourceSpan,
    reason,
    scopePath: scopePathForVerticalBlockItem(item),
    literalText: item.text,
    estimated: {
      width: 5.25 * item.text.length,
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
    | SimpleTexBoxBlockItem
    | SimpleTexPlaceholderBlockItem
): readonly TexVBoxRole[] | undefined {
  if (item.scopePath) {
    return texVBoxRolePathFromSimpleTexScopePath(item.scopePath);
  }
  const path = texVBoxRolePathForScope(item);
  return path.length > 0 ? path : undefined;
}

function texVBoxRolePathFromSimpleTexScopePath(
  scopePath: readonly SimpleTexScopePathRole[]
): readonly TexVBoxRole[] | undefined {
  return scopePath.length > 0 ? scopePath : undefined;
}

function sourceSpanFromBlock(block: SimpleTexParagraphBlock): TexSourceSpan {
  return {
    start: block.sourceStart,
    end: block.sourceEnd,
  };
}

function paragraphInputFromSimpleTexBlock(
  block: SimpleTexParagraphBlock,
  blockIndex: number,
  options: LowerSimpleTexBlockItemsToVListOptions
): TexParagraphInput {
  const scopePath = block.scopePath
    ? texVBoxRolePathFromSimpleTexScopePath(block.scopePath)
    : undefined;
  const useFontSpaceGlueProfile =
    scopePath?.at(-1)?.kind === "trivlist" &&
    (
      texVBoxRolePathContains(scopePath, "quote") ||
      texVBoxRolePathContains(scopePath, "list")
    );
  return {
    blockIndex,
    text: block.text,
    sourceSpan: sourceSpanFromBlock(block),
    nodes: block.nodes,
    noIndent: block.noIndent,
    ...(block.startsAfterExplicitPar === true
      ? { startsAfterExplicitPar: true }
      : {}),
    ...(block.firstLineIndentEm !== undefined
      ? { firstLineIndentEm: block.firstLineIndentEm }
      : {}),
    ...(block.quotationItemFirstParagraph === true
      ? { quotationItemFirstParagraph: true }
      : {}),
    ...(options.tikzTextWidthNode === true
      ? { tikzTextWidthNode: true }
      : {}),
    alignment: block.alignment,
    alignmentProfile: block.alignmentProfile,
    quoteDepth: block.quoteDepth,
    quotationDepth: block.quotationDepth,
    listContext: block.listContext,
    ...(scopePath ? { scopePath } : {}),
    ...(useFontSpaceGlueProfile ? { spaceGlueProfile: "font" as const } : {}),
  };
}

function texVBoxRolePathContains(
  scopePath: readonly TexVBoxRole[] | undefined,
  kind: TexVBoxRole["kind"]
): boolean {
  return scopePath?.some((role) => role.kind === kind) ?? false;
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
