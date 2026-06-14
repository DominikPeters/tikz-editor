import type { ResolvedTexFont } from "../fonts/types.js";
import { roundTexPt } from "../fonts/units.js";
import type { SimpleTexListContext } from "../ir.js";
import type { TexVListDocument, TexVListItem } from "./types.js";

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

export interface SimpleTexParagraphVerticalSkip {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly size: number;
  readonly quoteSize: number;
  readonly listSize: number;
}

export function planSimpleTexParagraphVerticalSkips(
  items: readonly TexVListItem[],
  font: ResolvedTexFont
): readonly SimpleTexParagraphVerticalSkip[] {
  const skips: SimpleTexParagraphVerticalSkip[] = [];
  planSimpleTexParagraphVerticalSkipsInto(
    items,
    font,
    {
      previousEmittedQuoteDepth: 0,
      previousEmittedListContext: undefined,
      quoteEntryHadPreviousParagraphByDepth: new Map(),
      emittedParagraphCount: 0,
    },
    skips
  );

  return skips;
}

interface SimpleTexParagraphVerticalSkipState {
  previousEmittedQuoteDepth: number;
  previousEmittedListContext: SimpleTexListContext | undefined;
  readonly quoteEntryHadPreviousParagraphByDepth: Map<number, boolean>;
  emittedParagraphCount: number;
}

function planSimpleTexParagraphVerticalSkipsInto(
  items: readonly TexVListItem[],
  font: ResolvedTexFont,
  state: SimpleTexParagraphVerticalSkipState,
  skips: SimpleTexParagraphVerticalSkip[]
): void {
  for (const item of items) {
    if (item.kind === "vbox") {
      planSimpleTexParagraphVerticalSkipsInto(
        item.items,
        font,
        state,
        skips
      );
      continue;
    }
    if (item.kind !== "paragraph") {
      continue;
    }

    const paragraph = item.paragraph;
    const hasPreviousEmittedParagraph = state.emittedParagraphCount > 0;
    const listVerticalSkipBefore = texArticleListVerticalSkipBefore(
      state.previousEmittedListContext,
      paragraph.listContext,
      hasPreviousEmittedParagraph,
      font
    );
    const quoteVerticalSkipBefore = texArticleQuoteVerticalSkipBefore(
      state.previousEmittedQuoteDepth,
      paragraph.quoteDepth,
      state.previousEmittedListContext !== undefined || paragraph.listContext !== undefined,
      state.quoteEntryHadPreviousParagraphByDepth.get(state.previousEmittedQuoteDepth) ?? true,
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

    if (paragraph.quoteDepth > state.previousEmittedQuoteDepth) {
      for (
        let depth = state.previousEmittedQuoteDepth + 1;
        depth <= paragraph.quoteDepth;
        depth += 1
      ) {
        state.quoteEntryHadPreviousParagraphByDepth.set(depth, hasPreviousEmittedParagraph);
      }
    } else if (paragraph.quoteDepth < state.previousEmittedQuoteDepth) {
      for (
        let depth = state.previousEmittedQuoteDepth;
        depth > paragraph.quoteDepth;
        depth -= 1
      ) {
        state.quoteEntryHadPreviousParagraphByDepth.delete(depth);
      }
    }
    state.previousEmittedQuoteDepth = paragraph.quoteDepth;
    state.previousEmittedListContext = paragraph.listContext;
    state.emittedParagraphCount += 1;
  }
}

export function addParagraphVerticalGlueToVList(
  vlist: TexVListDocument,
  skips: readonly SimpleTexParagraphVerticalSkip[]
): TexVListDocument {
  const verticalSkipByBlock = new Map<number, SimpleTexParagraphVerticalSkip>();
  for (const skip of skips) {
    if (skip.segmentIndex === 0 && skip.size > 0) {
      verticalSkipByBlock.set(skip.blockIndex, skip);
    }
  }

  const items = addParagraphVerticalGlueToItems(vlist.items, verticalSkipByBlock);

  return {
    ...vlist,
    items,
  };
}

function addParagraphVerticalGlueToItems(
  sourceItems: readonly TexVListItem[],
  verticalSkipByBlock: ReadonlyMap<number, SimpleTexParagraphVerticalSkip>
): readonly TexVListItem[] {
  const items: TexVListItem[] = [];
  for (const item of sourceItems) {
    if (item.kind === "vbox") {
      items.push({
        ...item,
        items: addParagraphVerticalGlueToItems(item.items, verticalSkipByBlock),
      });
      continue;
    }
    if (item.kind === "paragraph") {
      const skip = verticalSkipByBlock.get(item.paragraph.blockIndex);
      if (skip && skip.size > 0) {
        items.push({
          kind: "glue",
          sourceSpan: item.sourceSpan,
          origin: {
            kind: "paragraph-boundary",
            beforeBlockIndex: item.paragraph.blockIndex,
            quoteSize: skip.quoteSize,
            listSize: skip.listSize,
          },
          size: skip.size,
          stretchOrder: "normal",
          shrinkOrder: "normal",
        });
      }
    }
    items.push(item);
  }
  return items;
}

export function materializeParagraphVerticalGlueInVList(
  vlist: TexVListDocument,
  font: ResolvedTexFont
): TexVListDocument {
  return addParagraphVerticalGlueToVList(
    vlist,
    planSimpleTexParagraphVerticalSkips(vlist.items, font)
  );
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
