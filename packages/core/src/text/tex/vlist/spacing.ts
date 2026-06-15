import type { ResolvedTexFont } from "../fonts/types.js";
import { roundTexPt } from "../fonts/units.js";
import type { SimpleTexListContext } from "../ir.js";
import { texVListPathKey } from "./paths.js";
import { texVBoxRolePathForParagraph } from "./scope-roles.js";
import type {
  TexDisplayMathSkipVariant,
  TexDisplayAlignmentItem,
  TexDisplayMathItem,
  TexGlueItem,
  TexHBoxItem,
  TexParagraphItem,
  TexBoxMetrics,
  TexVBoxRole,
  TexVListDocument,
  TexVListItem,
  TexVListParagraphBoxMeasurement,
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
    normal: {
      size: 10,
      stretch: 2,
      shrink: 5,
    },
    short: {
      size: 0,
      stretch: 3,
      shrink: 0,
    },
  },
  below: {
    normal: {
      size: 10,
      stretch: 2,
      shrink: 5,
    },
    short: {
      size: 6,
      stretch: 3,
      shrink: 3,
    },
  },
} as const;

const latexNormalLineSkipPt = 1;
const latexAmsmathAlignTopCorrectionPt = -3;
const latexAmsmathOpenBaselineSkipPt = 15;
const latexAmsmathOpenLineSkipPt = 4;
const latexAmsmathOpenLineSkipLimitPt = 3;

type DisplayAlignmentGluePurpose =
  | "align-top-correction"
  | "align-row-baseline"
  | "align-structural";

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
    if (item.kind === "display-alignment") {
      items.push(displayMathBoundaryGlueItem(item, "above"));
      items.push(...displayAlignmentMaterialItems(item));
      items.push(displayMathBoundaryGlueItem(item, "below"));
      continue;
    }
    items.push(item);
  }
  return items;
}

function displayMathBoundaryGlueItem(
  item: TexDisplayMathItem | TexDisplayAlignmentItem,
  side: "above" | "below"
): TexGlueItem {
  const skip = latexArticleDisplaySkipsPt[side].normal;
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

export function resolveDisplayMathVerticalGlueInVList(
  vlist: TexVListDocument,
  paragraphMeasurements: ReadonlyMap<string, TexVListParagraphBoxMeasurement>,
  options: {
    readonly lineHeight: number;
  }
): TexVListDocument {
  return {
    ...vlist,
    items: resolveDisplayMathVerticalGlueInItems(
      vlist.items,
      paragraphMeasurements,
      options,
      []
    ),
  };
}

function resolveDisplayMathVerticalGlueInItems(
  sourceItems: readonly TexVListItem[],
  paragraphMeasurements: ReadonlyMap<string, TexVListParagraphBoxMeasurement>,
  options: {
    readonly lineHeight: number;
  },
  pathPrefix: readonly number[]
): readonly TexVListItem[] {
  const items: TexVListItem[] = [];
  let previousParagraphMeasurement: TexVListParagraphBoxMeasurement | undefined;
  let previousDisplaySkipVariant: TexDisplayMathSkipVariant = "normal";
  let previousDisplayMaterialMetrics: TexBoxMetrics | undefined;
  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = sourceItems[index];
    if (!item) {
      continue;
    }
    const path = [...pathPrefix, index];
    if (item.kind === "vbox") {
      items.push({
        ...item,
        items: resolveDisplayMathVerticalGlueInItems(
          item.items,
          paragraphMeasurements,
          options,
          path
        ),
      });
      continue;
    }
    if (item.kind === "paragraph") {
      previousParagraphMeasurement = paragraphMeasurements.get(texVListPathKey(path));
      items.push(item);
      continue;
    }
    if (
      item.kind === "glue" &&
      item.origin?.kind === "display-math-boundary"
    ) {
      const displayItem = item.origin.side === "above"
        ? nextDisplayMathItem(sourceItems, index)
        : undefined;
      const variant: TexDisplayMathSkipVariant = displayItem
        ? displayMathSkipVariant(displayItem, previousParagraphMeasurement)
        : previousDisplaySkipVariant;
      if (item.origin.side === "above") {
        previousDisplaySkipVariant = variant;
      }
      items.push(resolveDisplayMathBoundaryGlueItem(item, variant));
      if (item.origin.side === "above" && displayItem && previousParagraphMeasurement) {
        items.push(displayMathInterlineGlueItem(
          item,
          "above",
          texInterlineGlueSize(
            previousParagraphMeasurement.ruleLeadingMetrics.depth,
            displayItem.box.height,
            options.lineHeight
          )
        ));
      } else if (item.origin.side === "below" && previousDisplayMaterialMetrics) {
        const nextParagraph = nextParagraphMeasurement(
          sourceItems,
          index,
          pathPrefix,
          paragraphMeasurements
        );
        if (nextParagraph) {
          items.push(displayMathInterlineGlueItem(
            item,
            "below",
            texInterlineGlueSize(
              previousDisplayMaterialMetrics.depth,
              nextParagraph.ruleLeadingMetrics.height,
              options.lineHeight
            )
          ));
        }
      }
      continue;
    }
    if (
      item.kind === "glue" &&
      item.origin?.kind === "display-math-interline" &&
      item.origin.purpose === "align-row-baseline"
    ) {
      const nextRow = nextDisplayAlignmentRowHBox(sourceItems, index);
      if (nextRow) {
        const previousDepth = previousParagraphMeasurement?.ruleLeadingMetrics.depth ??
          previousDisplayMaterialMetrics?.depth ??
          0;
        items.push({
          ...item,
          size: texOpenedInterlineGlueSize(previousDepth, nextRow.box.metrics.height),
        });
        continue;
      }
    }
    if (item.kind === "display-math") {
      previousParagraphMeasurement = undefined;
      previousDisplayMaterialMetrics = {
        width: item.box.width,
        height: item.box.height,
        depth: item.box.depth,
      };
    } else if (isDisplayAlignmentRowHBox(item)) {
      previousParagraphMeasurement = undefined;
      previousDisplayMaterialMetrics = item.box.metrics;
    }
    items.push(item);
  }
  return items;
}

function displayAlignmentMaterialItems(
  item: TexDisplayAlignmentItem
): readonly TexVListItem[] {
  const rows: TexVListItem[] = [];
  rows.push(displayAlignmentGlueItem(item, latexAmsmathAlignTopCorrectionPt, "align-top-correction"));
  rows.push(displayAlignmentGlueItem(item, 0, "align-structural"));
  rows.push(displayAlignmentGlueItem(item, 0, "align-row-baseline"));
  for (const row of item.alignment.rows) {
    if (row.rowIndex > 0) {
      rows.push(displayAlignmentGlueItem(item, 0, "align-structural"));
      rows.push(displayAlignmentGlueItem(item, 0, "align-row-baseline"));
    }
    rows.push(displayAlignmentRowHBox(item, row));
  }
  rows.push(displayAlignmentGlueItem(item, 0, "align-structural"));
  return rows;
}

function displayAlignmentGlueItem(
  item: TexDisplayAlignmentItem,
  size: number,
  purpose: DisplayAlignmentGluePurpose
): TexGlueItem {
  return {
    kind: "glue",
    sourceSpan: item.sourceSpan,
    ...(item.scopePath ? { scopePath: item.scopePath } : {}),
    origin: {
      kind: "display-math-interline",
      side: "above",
      purpose,
    },
    size,
    stretchOrder: "normal",
    shrinkOrder: "normal",
  };
}

function displayAlignmentRowHBox(
  item: TexDisplayAlignmentItem,
  row: TexDisplayAlignmentItem["alignment"]["rows"][number]
): TexHBoxItem {
  return {
    kind: "hbox",
    sourceSpan: {
      start: row.sourceStart,
      end: row.sourceEnd,
    },
    ...(item.scopePath ? { scopePath: item.scopePath } : {}),
    role: {
      kind: "display-align-row",
      delimiter: item.delimiter,
      rowIndex: row.rowIndex,
    },
    x: row.x,
    box: {
      metrics: {
        width: row.width,
        height: row.height,
        depth: row.depth,
      },
      renderItems: row.svgBody
        ? [{
            kind: "tex-math-svg",
            svgBody: row.svgBody,
            x: 0,
            baseline: row.height,
          }]
        : [],
    },
  };
}

function isDisplayAlignmentRowHBox(item: TexVListItem): item is TexHBoxItem {
  return item.kind === "hbox" && item.role?.kind === "display-align-row";
}

function nextDisplayAlignmentRowHBox(
  items: readonly TexVListItem[],
  index: number
): TexHBoxItem | undefined {
  for (let nextIndex = index + 1; nextIndex < items.length; nextIndex += 1) {
    const item = items[nextIndex];
    if (!item) {
      continue;
    }
    if (item.kind === "glue" || item.kind === "penalty") {
      continue;
    }
    return isDisplayAlignmentRowHBox(item) ? item : undefined;
  }
  return undefined;
}

function nextDisplayMathItem(
  items: readonly TexVListItem[],
  index: number
): TexDisplayMathItem | undefined {
  const item = items[index + 1];
  return item?.kind === "display-math" ? item : undefined;
}

function displayMathSkipVariant(
  item: TexDisplayMathItem,
  previousParagraphMeasurement: TexVListParagraphBoxMeasurement | undefined
): TexDisplayMathSkipVariant {
  const preDisplaySize = previousParagraphMeasurement?.lastLinePreDisplaySize ??
    Number.NEGATIVE_INFINITY;
  // TeX.web chooses the normal skips when the centered display overlaps the
  // preceding line's pre-display size; otherwise it uses the short skips.
  const displayLeftEdge = roundTexPt(Math.max(0, (item.targetWidth - item.box.width) / 2));
  return displayLeftEdge <= preDisplaySize ? "normal" : "short";
}

function resolveDisplayMathBoundaryGlueItem(
  item: TexGlueItem,
  variant: TexDisplayMathSkipVariant
): TexGlueItem {
  if (item.origin?.kind !== "display-math-boundary") {
    return item;
  }
  const skip = latexArticleDisplaySkipsPt[item.origin.side][variant];
  return {
    ...item,
    origin: {
      ...item.origin,
      variant,
    },
    size: skip.size,
    stretch: skip.stretch,
    shrink: skip.shrink,
  };
}

function displayMathInterlineGlueItem(
  item: TexGlueItem,
  side: "above" | "below",
  size: number
): TexGlueItem {
  return {
    kind: "glue",
    sourceSpan: item.sourceSpan,
    ...(item.scopePath ? { scopePath: item.scopePath } : {}),
    origin: {
      kind: "display-math-interline",
      side,
    },
    size,
    stretchOrder: "normal",
    shrinkOrder: "normal",
  };
}

function nextParagraphMeasurement(
  items: readonly TexVListItem[],
  index: number,
  pathPrefix: readonly number[],
  paragraphMeasurements: ReadonlyMap<string, TexVListParagraphBoxMeasurement>
): TexVListParagraphBoxMeasurement | undefined {
  for (let nextIndex = index + 1; nextIndex < items.length; nextIndex += 1) {
    const item = items[nextIndex];
    if (!item) {
      continue;
    }
    if (item.kind === "glue" || item.kind === "penalty") {
      continue;
    }
    if (item.kind === "paragraph") {
      return paragraphMeasurements.get(texVListPathKey([...pathPrefix, nextIndex]));
    }
    return undefined;
  }
  return undefined;
}

function texInterlineGlueSize(
  previousDepth: number,
  nextHeight: number,
  lineHeight: number
): number {
  const baselineGlue = roundTexPt(lineHeight - previousDepth - nextHeight);
  return baselineGlue < 0 ? latexNormalLineSkipPt : baselineGlue;
}

function texOpenedInterlineGlueSize(
  previousDepth: number,
  nextHeight: number
): number {
  const baselineGlue = roundTexPt(latexAmsmathOpenBaselineSkipPt - previousDepth - nextHeight);
  return baselineGlue < latexAmsmathOpenLineSkipLimitPt
    ? latexAmsmathOpenLineSkipPt
    : baselineGlue;
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
