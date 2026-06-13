import type { ResolvedTexFont } from "../fonts/types.js";
import { roundTexPt } from "../fonts/units.js";
import type { SimpleTexListContext } from "../ir.js";
import type { TexVListItem } from "./types.js";
import type { SimpleTexParagraphVerticalSkip } from "./lower-simple.js";

const articleQuoteSpacingEm = {
  topsep: 1,
  partopsep: 0.3,
  parsep: 0.4,
  compactExitTopsep: 0.8,
} as const;

const articleListSpacingEm = {
  topsep: 1,
  partopsep: 0.3,
  nestedTopsepByDepth: [0.8, 0.8, 0.4, 0.2],
  itemsepByDepth: [0.8, 0.4, 0.2],
  parsepByDepth: [0.4, 0.2, 0],
} as const;

export function planSimpleTexParagraphVerticalSkips(
  items: readonly TexVListItem[],
  font: ResolvedTexFont
): readonly SimpleTexParagraphVerticalSkip[] {
  const skips: SimpleTexParagraphVerticalSkip[] = [];
  let previousEmittedQuoteDepth = 0;
  let previousEmittedListContext: SimpleTexListContext | undefined;
  const quoteEntryHadPreviousParagraphByDepth = new Map<number, boolean>();
  let emittedParagraphCount = 0;

  for (const item of items) {
    if (item.kind !== "paragraph") {
      continue;
    }

    const paragraph = item.paragraph;
    const hasPreviousEmittedParagraph = emittedParagraphCount > 0;
    const listVerticalSkipBefore = texArticleListVerticalSkipBefore(
      previousEmittedListContext,
      paragraph.listContext,
      hasPreviousEmittedParagraph,
      font
    );
    const quoteVerticalSkipBefore = texArticleQuoteVerticalSkipBefore(
      previousEmittedQuoteDepth,
      paragraph.quoteDepth,
      previousEmittedListContext !== undefined || paragraph.listContext !== undefined,
      quoteEntryHadPreviousParagraphByDepth.get(previousEmittedQuoteDepth) ?? true,
      hasPreviousEmittedParagraph,
      font
    );

    skips.push({
      blockIndex: paragraph.blockIndex,
      segmentIndex: 0,
      quoteSize: quoteVerticalSkipBefore,
      listSize: listVerticalSkipBefore,
      size: quoteVerticalSkipBefore + listVerticalSkipBefore,
    });

    if (paragraph.quoteDepth > previousEmittedQuoteDepth) {
      for (
        let depth = previousEmittedQuoteDepth + 1;
        depth <= paragraph.quoteDepth;
        depth += 1
      ) {
        quoteEntryHadPreviousParagraphByDepth.set(depth, hasPreviousEmittedParagraph);
      }
    } else if (paragraph.quoteDepth < previousEmittedQuoteDepth) {
      for (
        let depth = previousEmittedQuoteDepth;
        depth > paragraph.quoteDepth;
        depth -= 1
      ) {
        quoteEntryHadPreviousParagraphByDepth.delete(depth);
      }
    }
    previousEmittedQuoteDepth = paragraph.quoteDepth;
    previousEmittedListContext = paragraph.listContext;
    emittedParagraphCount += 1;
  }

  return skips;
}

function texArticleQuoteVerticalSkipBefore(
  previousQuoteDepth: number,
  quoteDepth: number,
  listTransitionActive = false,
  exitingQuoteHadPreviousParagraph = true,
  hasPreviousEmittedParagraph = true,
  font: ResolvedTexFont
): number {
  if (listTransitionActive) {
    return 0;
  }
  if (previousQuoteDepth === quoteDepth) {
    return quoteDepth > 0 ? texEmSkip(articleQuoteSpacingEm.parsep, font) : 0;
  }
  if (quoteDepth > previousQuoteDepth) {
    return texEmSkip(
      articleQuoteSpacingEm.topsep +
        (hasPreviousEmittedParagraph ? 0 : articleQuoteSpacingEm.partopsep),
      font
    );
  }
  if (previousQuoteDepth > quoteDepth) {
    return texEmSkip(
      exitingQuoteHadPreviousParagraph
        ? articleQuoteSpacingEm.topsep
        : articleQuoteSpacingEm.compactExitTopsep,
      font
    );
  }
  return 0;
}

function texArticleListVerticalSkipBefore(
  previous: SimpleTexListContext | undefined,
  current: SimpleTexListContext | undefined,
  hasPreviousEmittedParagraph: boolean,
  font: ResolvedTexFont
): number {
  if (!previous && !current) {
    return 0;
  }
  if (!hasPreviousEmittedParagraph && current) {
    return texArticleInitialListSkip(font);
  }
  if (!previous && current) {
    return texArticleOutsideListBoundarySkip(font);
  }
  if (previous && !current) {
    return texArticleOutsideListBoundarySkip(font);
  }
  if (!previous || !current) {
    return 0;
  }
  if (current.depth > previous.depth) {
    return texArticleNestedListBoundarySkip(current.depth, font);
  }
  if (current.depth < previous.depth) {
    return texArticleNestedListBoundarySkip(previous.depth, font);
  }
  if (
    current.kind === previous.kind &&
    current.labelDepth === previous.labelDepth &&
    current.itemIndex === previous.itemIndex
  ) {
    return current.showLabel ? 0 : texArticleListParagraphSkip(current.depth, font);
  }
  return texArticleListItemBoundarySkip(current.depth, font);
}

function texArticleInitialListSkip(font: ResolvedTexFont): number {
  return texEmSkip(articleListSpacingEm.topsep + articleListSpacingEm.partopsep, font);
}

function texArticleOutsideListBoundarySkip(font: ResolvedTexFont): number {
  return texEmSkip(articleListSpacingEm.topsep, font);
}

function texArticleNestedListBoundarySkip(depth: number, font: ResolvedTexFont): number {
  return texEmSkip(
    texDepthIndexedEm(articleListSpacingEm.nestedTopsepByDepth, depth),
    font
  );
}

function texArticleListItemBoundarySkip(depth: number, font: ResolvedTexFont): number {
  return texEmSkip(texDepthIndexedEm(articleListSpacingEm.itemsepByDepth, depth), font);
}

function texArticleListParagraphSkip(depth: number, font: ResolvedTexFont): number {
  return texEmSkip(texDepthIndexedEm(articleListSpacingEm.parsepByDepth, depth), font);
}

function texDepthIndexedEm(values: readonly number[], depth: number): number {
  return values[Math.max(0, Math.min(depth - 1, values.length - 1))] ?? 0;
}

function texEmSkip(value: number, font: ResolvedTexFont): number {
  return roundTexPt(value * font.atPt);
}
