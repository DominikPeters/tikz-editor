import type { ResolvedTexFont } from "../fonts/types.js";
import { roundTexPt } from "../fonts/units.js";
import type { SimpleTexListContext } from "../ir.js";
import { texVListPathKey } from "./paths.js";
import { texVBoxRolePathForParagraph } from "./scope-roles.js";
import type {
  TexDisplayMathItem,
  TexGlueItem,
  TexParagraphItem,
  TexVBoxRole,
  TexVListDocument,
  TexVListItem,
} from "./types.js";

const articleQuoteSpacingEm = {
  topsep: 1,
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

const latexArticleDisplaySkipsPt = {
  above: {
    size: 10,
    stretch: 2,
    shrink: 5,
  },
  below: {
    size: 10,
    stretch: 2,
    shrink: 5,
  },
} as const;

export interface SimpleTexParagraphVerticalSkip {
  readonly blockIndex: number;
  readonly vlistPath: readonly number[];
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
      emittedListItemKeys: new Set(),
      emittedParagraphCount: 0,
    },
    skips,
    [],
    []
  );

  return skips;
}

interface SimpleTexParagraphVerticalSkipState {
  previousEmittedQuoteDepth: number;
  previousEmittedListContext: SimpleTexListContext | undefined;
  readonly quoteEntryHadPreviousParagraphByDepth: Map<number, boolean>;
  readonly emittedListItemKeys: Set<string>;
  emittedParagraphCount: number;
}

function planSimpleTexParagraphVerticalSkipsInto(
  items: readonly TexVListItem[],
  font: ResolvedTexFont,
  state: SimpleTexParagraphVerticalSkipState,
  skips: SimpleTexParagraphVerticalSkip[],
  ancestors: readonly TexVBoxRole[],
  pathPrefix: readonly number[]
): void {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    const path = [...pathPrefix, index];
    if (item.kind === "vbox") {
      planSimpleTexParagraphVerticalSkipsInto(
        item.items,
        font,
        state,
        skips,
        item.role ? [...ancestors, item.role] : ancestors,
        path
      );
      continue;
    }
    if (item.kind !== "paragraph") {
      continue;
    }

    const paragraph = item.paragraph;
    const scope = paragraphScopeFromVListAncestors(item, ancestors, state);
    const hasPreviousEmittedParagraph = state.emittedParagraphCount > 0;
    const listVerticalSkipBefore = texArticleListVerticalSkipBefore(
      state.previousEmittedListContext,
      scope.listContext,
      hasPreviousEmittedParagraph,
      font
    );
    const quoteVerticalSkipBefore = texArticleQuoteVerticalSkipBefore(
      state.previousEmittedQuoteDepth,
      scope.quoteDepth,
      state.previousEmittedListContext !== undefined || scope.listContext !== undefined,
      state.quoteEntryHadPreviousParagraphByDepth.get(state.previousEmittedQuoteDepth) ?? true,
      font
    );

    skips.push({
      blockIndex: paragraph.blockIndex,
      vlistPath: path,
      segmentIndex: 0,
      quoteSize: quoteVerticalSkipBefore,
      listSize: listVerticalSkipBefore,
      size: quoteVerticalSkipBefore + listVerticalSkipBefore,
    });

    if (scope.quoteDepth > state.previousEmittedQuoteDepth) {
      for (
        let depth = state.previousEmittedQuoteDepth + 1;
        depth <= scope.quoteDepth;
        depth += 1
      ) {
        state.quoteEntryHadPreviousParagraphByDepth.set(depth, hasPreviousEmittedParagraph);
      }
    } else if (scope.quoteDepth < state.previousEmittedQuoteDepth) {
      for (
        let depth = state.previousEmittedQuoteDepth;
        depth > scope.quoteDepth;
        depth -= 1
      ) {
        state.quoteEntryHadPreviousParagraphByDepth.delete(depth);
      }
    }
    state.previousEmittedQuoteDepth = scope.quoteDepth;
    state.previousEmittedListContext = scope.listContext;
    if (scope.listItemKey) {
      state.emittedListItemKeys.add(scope.listItemKey);
    }
    state.emittedParagraphCount += 1;
  }
}

function paragraphScopeFromVListAncestors(
  item: TexParagraphItem,
  ancestors: readonly TexVBoxRole[],
  state: SimpleTexParagraphVerticalSkipState
): {
  readonly quoteDepth: number;
  readonly listContext: SimpleTexListContext | undefined;
  readonly listItemKey?: string;
} {
  const quoteDepthFromAncestors = ancestors.filter((role) => role.kind === "quote").length;
  const listRole = lastVListAncestorRole(ancestors, "list");
  const listItemRole = lastVListAncestorRole(ancestors, "list-item");
  if (listRole && listItemRole) {
    const listItemKey = texListItemScopeKey(listItemRole);
    return {
      quoteDepth: quoteDepthFromAncestors,
      listItemKey,
      listContext: {
        kind: listRole.listKind,
        depth: listRole.depth,
        labelDepth: listRole.labelDepth,
        itemIndex: listItemRole.itemIndex,
        ownLeftMarginEm: listRole.ownLeftMarginEm,
        totalLeftMarginEm: listRole.totalLeftMarginEm,
        showLabel: item.paragraph.listContext?.showLabel ??
          !state.emittedListItemKeys.has(listItemKey),
        label: item.paragraph.listContext?.label,
      },
    };
  }
  return {
    quoteDepth: quoteDepthFromAncestors > 0 ? quoteDepthFromAncestors : item.paragraph.quoteDepth,
    listContext: item.paragraph.listContext,
  };
}

function texListItemScopeKey(role: Extract<TexVBoxRole, { kind: "list-item" }>): string {
  return [
    role.listKind,
    role.depth,
    role.labelDepth,
    role.itemIndex,
  ].join(":");
}

function lastVListAncestorRole<K extends TexVBoxRole["kind"]>(
  ancestors: readonly TexVBoxRole[],
  kind: K
): Extract<TexVBoxRole, { kind: K }> | undefined {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const role = ancestors[index];
    if (role?.kind === kind) {
      return role as Extract<TexVBoxRole, { kind: K }>;
    }
  }
  return undefined;
}

export function addParagraphVerticalGlueToVList(
  vlist: TexVListDocument,
  skips: readonly SimpleTexParagraphVerticalSkip[]
): TexVListDocument {
  const verticalSkipByPath = new Map<string, SimpleTexParagraphVerticalSkip>();
  for (const skip of skips) {
    if (skip.segmentIndex === 0 && skip.size > 0) {
      verticalSkipByPath.set(texVListPathKey(skip.vlistPath), skip);
    }
  }

  const items = addParagraphVerticalGlueToItems(vlist.items, verticalSkipByPath, []);

  return {
    ...vlist,
    items,
  };
}

function addParagraphVerticalGlueToItems(
  sourceItems: readonly TexVListItem[],
  verticalSkipByPath: ReadonlyMap<string, SimpleTexParagraphVerticalSkip>,
  pathPrefix: readonly number[]
): readonly TexVListItem[] {
  const items: TexVListItem[] = [];
  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = sourceItems[index];
    if (!item) {
      continue;
    }
    const path = [...pathPrefix, index];
    if (item.kind === "vbox") {
      items.push({
        ...item,
        items: addParagraphVerticalGlueToItems(item.items, verticalSkipByPath, path),
      });
      continue;
    }
    if (item.kind === "paragraph") {
      const skip = verticalSkipByPath.get(texVListPathKey(path));
      if (skip) {
        items.push(...paragraphBoundaryGlueItems(item, skip));
      }
    }
    items.push(item);
  }
  return items;
}

function paragraphBoundaryGlueItems(
  item: TexParagraphItem,
  skip: SimpleTexParagraphVerticalSkip
): TexGlueItem[] {
  const scopePath = texVBoxRolePathForParagraph(item.paragraph);
  const shared = {
    sourceSpan: item.sourceSpan,
    ...(scopePath.length > 0 ? { scopePath } : {}),
    stretchOrder: "normal" as const,
    shrinkOrder: "normal" as const,
  };
  const glues: TexGlueItem[] = [];
  if (skip.quoteSize > 0) {
    glues.push({
      kind: "glue",
      ...shared,
      origin: {
        kind: "quote-boundary",
        beforeBlockIndex: item.paragraph.blockIndex,
      },
      size: skip.quoteSize,
    });
  }
  if (skip.listSize > 0) {
    glues.push({
      kind: "glue",
      ...shared,
      origin: {
        kind: "list-boundary",
        beforeBlockIndex: item.paragraph.blockIndex,
      },
      size: skip.listSize,
    });
  }
  return glues;
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

export function materializeDisplayMathVerticalGlueInVList(
  vlist: TexVListDocument
): TexVListDocument {
  return {
    ...vlist,
    items: materializeDisplayMathVerticalGlueInItems(vlist.items),
  };
}

function materializeDisplayMathVerticalGlueInItems(
  sourceItems: readonly TexVListItem[]
): readonly TexVListItem[] {
  const items: TexVListItem[] = [];
  for (const item of sourceItems) {
    if (item.kind === "vbox") {
      items.push({
        ...item,
        items: materializeDisplayMathVerticalGlueInItems(item.items),
      });
      continue;
    }
    if (item.kind === "display-math") {
      items.push(displayMathBoundaryGlueItem(item, "above"));
      items.push(item);
      items.push(displayMathBoundaryGlueItem(item, "below"));
      continue;
    }
    items.push(item);
  }
  return items;
}

function displayMathBoundaryGlueItem(
  item: TexDisplayMathItem,
  side: "above" | "below"
): TexGlueItem {
  const skip = latexArticleDisplaySkipsPt[side];
  return {
    kind: "glue",
    sourceSpan: item.sourceSpan,
    ...(item.scopePath ? { scopePath: item.scopePath } : {}),
    origin: {
      kind: "display-math-boundary",
      side,
    },
    size: skip.size,
    stretch: skip.stretch,
    shrink: skip.shrink,
    stretchOrder: "normal",
    shrinkOrder: "normal",
  };
}

function texArticleQuoteVerticalSkipBefore(
  previousQuoteDepth: number,
  quoteDepth: number,
  listTransitionActive = false,
  exitingQuoteHadPreviousParagraph = true,
  font: ResolvedTexFont
): number {
  if (listTransitionActive) {
    return 0;
  }
  if (previousQuoteDepth === quoteDepth) {
    return quoteDepth > 0 ? texEmSkip(articleQuoteSpacingEm.parsep, font) : 0;
  }
  if (quoteDepth > previousQuoteDepth) {
    return texEmSkip(articleQuoteSpacingEm.topsep, font);
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
