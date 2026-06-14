import type { ResolvedTexFont, TexMetricProvider } from "../fonts/types.js";
import type { TexTextFontProfile } from "../fonts/text-profile.js";
import { roundTexPt, tfmToPt } from "../fonts/units.js";
import type {
  SimpleTexFontState,
  SimpleTexInlineNode,
  SimpleTexListContext,
  TexSpaceGlueProfile,
} from "../ir.js";
import type {
  TexLayoutGlyphItem,
  TexLayoutInlineItem,
  TexLayoutLabel,
  TexLayoutMathItem,
  TexLayoutSpaceItem,
  TexMathBoxProvider,
} from "../layout-inline-items.js";
import type {
  TexBoxMetrics,
  TexHBoxItem,
  TexRenderItem,
  TexVBoxListItemLabelBox,
  TexVBoxListItemLayout,
} from "./types.js";

export type TexInlineNodesToLayoutItems = (
  nodes: readonly SimpleTexInlineNode[],
  sourceStart: number,
  sourceEnd: number,
  atPt: number,
  metricProvider: TexMetricProvider,
  spaceGlueProfile: TexSpaceGlueProfile,
  mathBoxProvider?: TexMathBoxProvider,
  initialFontState?: SimpleTexFontState,
  textFontProfile?: TexTextFontProfile
) => TexLayoutInlineItem[];

export interface TexListItemParagraphAttachments {
  readonly inlineLabelItems: readonly TexLayoutInlineItem[];
  readonly firstLineIndentWidth?: number;
  readonly marginLabel?: TexLayoutLabel;
  readonly marginLabelHBox?: TexHBoxItem;
}

export function texListItemParagraphAttachments(params: {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly listContext?: SimpleTexListContext;
  readonly listItemLayout?: TexVBoxListItemLayout;
  readonly font: ResolvedTexFont;
  readonly metricProvider: TexMetricProvider;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly inlineNodesToItems: TexInlineNodesToLayoutItems;
  readonly textFontProfile?: TexTextFontProfile;
}): TexListItemParagraphAttachments {
  const listItemLabel = params.segmentIndex === 0 && params.listContext?.showLabel === true
    ? params.listItemLayout?.label
    : undefined;
  const inlineLabelItems =
    params.listContext && listItemLabel?.placement === "inline"
      ? markTexInlineLabelItems(texInlineLabelItemsForListContext(
        params.listContext,
        listItemLabel,
        params.font,
        params.metricProvider,
        params.spaceGlueProfile,
        params.inlineNodesToItems,
        params.textFontProfile
      ))
      : [];
  const firstLineIndentWidth = texArticleDescriptionFirstLineIndentWidth(
    params.listContext,
    params.listItemLayout,
    inlineLabelItems.length > 0
  );
  const marginLabel = params.listContext && listItemLabel?.placement === "margin"
    ? texLayoutLabelForListContext(
        params.listContext,
        params.font,
        params.metricProvider,
        params.spaceGlueProfile,
        listItemLabel,
        params.inlineNodesToItems,
        params.textFontProfile
      )
    : undefined;
  const marginLabelHBox = marginLabel && listItemLabel && params.listContext
    ? texMarginListLabelHBoxFromLayoutLabel(
        marginLabel,
        params.listContext,
        params.blockIndex,
        listItemLabel,
        params.metricProvider
      )
    : undefined;
  return {
    inlineLabelItems,
    firstLineIndentWidth,
    ...(marginLabel ? { marginLabel } : {}),
    ...(marginLabelHBox ? { marginLabelHBox } : {}),
  };
}

function requiredTexListItemLabelRightEdge(
  labelBox: TexVBoxListItemLabelBox
): number {
  if (labelBox.rightEdge === undefined) {
    throw new Error("TeX list-item vbox label attachment is missing rightEdge.");
  }
  return labelBox.rightEdge;
}

function texArticleDescriptionFirstLineIndentWidth(
  listContext: SimpleTexListContext | undefined,
  listItemLayout: TexVBoxListItemLayout | undefined,
  hasDescriptionLabel: boolean
): number | undefined {
  if (listContext?.kind !== "description") {
    return undefined;
  }
  const indent = hasDescriptionLabel
    ? listItemLayout?.description?.labelFirstLineIndentWidth
    : listItemLayout?.description?.bodyFirstLineIndentWidth;
  if (indent === undefined) {
    throw new Error("TeX list-item vbox description metadata is missing first-line indentation.");
  }
  return indent;
}

function texInlineLabelItemsForListContext(
  listContext: SimpleTexListContext,
  labelBox: TexVBoxListItemLabelBox,
  font: ResolvedTexFont,
  metricProvider: TexMetricProvider,
  spaceGlueProfile: TexSpaceGlueProfile,
  inlineNodesToItems: TexInlineNodesToLayoutItems,
  textFontProfile?: TexTextFontProfile
): TexLayoutInlineItem[] {
  if (labelBox.content.kind !== "source" || !listContext.label) {
    return [];
  }
  return inlineNodesToItems(
    listContext.label.nodes,
    listContext.label.sourceStart,
    listContext.label.sourceEnd,
    font.atPt,
    metricProvider,
    spaceGlueProfile,
    undefined,
    labelBox.fontState,
    textFontProfile
  );
}

function markTexInlineLabelItems(
  items: readonly TexLayoutInlineItem[]
): readonly TexLayoutInlineItem[] {
  return items.map((item) => ({
    ...item,
    role: "list-label" as const,
  }));
}

function texLayoutLabelForListContext(
  listContext: SimpleTexListContext,
  font: ResolvedTexFont,
  metricProvider: TexMetricProvider,
  spaceGlueProfile: TexSpaceGlueProfile,
  labelBox: TexVBoxListItemLabelBox,
  inlineNodesToItems: TexInlineNodesToLayoutItems,
  textFontProfile?: TexTextFontProfile
): TexLayoutLabel {
  const rightEdge = requiredTexListItemLabelRightEdge(labelBox);
  const labelContent = labelBox.content;
  if (labelContent.kind === "source") {
    if (!listContext.label) {
      throw new Error("TeX list-item vbox source label metadata is missing source label content.");
    }
    return {
      items: inlineNodesToItems(
        listContext.label.nodes,
        listContext.label.sourceStart,
        listContext.label.sourceEnd,
        font.atPt,
        metricProvider,
        spaceGlueProfile,
        undefined,
        labelBox.fontState,
        textFontProfile
      ),
      sourceStart: listContext.label.sourceStart,
      sourceEnd: listContext.label.sourceEnd,
      rightEdge,
    };
  }

  if (labelContent.kind === "glyph") {
    return {
      items: [{
        kind: "glyph",
        text: labelContent.text,
        code: labelContent.code,
        font: metricProvider.resolveFont({
          fontId: labelContent.fontId,
          atPt: font.atPt,
        }),
      }],
      sourceStart: 0,
      sourceEnd: 0,
      rightEdge,
    };
  }

  return {
    items: [{
      kind: "text",
      text: labelContent.text,
      sourceStart: 0,
      sourceEnd: 0,
      font,
      italicCorrectionAfter: false,
      spaceFactorBefore: 1000,
      spaceFactorAfter: 1000,
    }],
    sourceStart: 0,
    sourceEnd: 0,
    rightEdge,
  };
}

function texMarginListLabelHBoxFromLayoutLabel(
  label: TexLayoutLabel,
  listContext: SimpleTexListContext,
  blockIndex: number,
  labelBox: TexVBoxListItemLabelBox,
  metricProvider: TexMetricProvider
): TexHBoxItem {
  const box = texLayoutLabelHBoxContent(label, metricProvider);
  return {
    kind: "hbox",
    ...(label.sourceStart !== 0 || label.sourceEnd !== 0
      ? {
          sourceSpan: {
            start: label.sourceStart,
            end: label.sourceEnd,
          },
        }
      : {}),
    role: {
      kind: "list-label",
      labelKind: labelBox.kind,
      placement: labelBox.placement,
      listKind: listContext.kind,
      depth: listContext.depth,
      labelDepth: listContext.labelDepth,
      itemIndex: listContext.itemIndex,
      blockIndex,
    },
    x: roundTexPt(label.rightEdge - box.metrics.width),
    advance: 0,
    affectsVBoxBaseline: false,
    box: {
      metrics: box.metrics,
      renderItems: box.renderItems,
    },
  };
}

function texLayoutLabelHBoxContent(
  label: TexLayoutLabel,
  metricProvider: TexMetricProvider
): {
  readonly metrics: TexBoxMetrics;
  readonly renderItems: readonly TexRenderItem[];
} {
  let width = 0;
  let height = 0;
  let depth = 0;
  const pendingItems: Array<
    | Omit<Extract<TexRenderItem, { kind: "tex-glyph-run" }>, "baseline">
    | Omit<Extract<TexRenderItem, { kind: "tex-glyph" }>, "baseline">
  > = [];
  for (const item of label.items) {
    if (item.kind === "glyph") {
      const glyphWidth = texLayoutGlyphItemWidth(item);
      pendingItems.push({
        kind: "tex-glyph",
        text: item.text,
        code: item.code,
        fontId: item.font.id,
        atPt: item.font.atPt,
        x: roundTexPt(width),
      });
      width += glyphWidth;
      height = Math.max(height, texLayoutGlyphItemHeight(item));
      depth = Math.max(depth, texLayoutGlyphItemDepth(item));
      continue;
    }
    if (item.kind === "forced-break") {
      continue;
    }
    if (item.kind === "text") {
      const shaped = metricProvider.shapeText(item.text, item.font);
      pendingItems.push({
        kind: "tex-glyph-run",
        text: item.text,
        fontId: item.font.id,
        atPt: item.font.atPt,
        x: roundTexPt(width),
      });
      width += shaped.width;
      for (const shapedItem of shaped.items) {
        if (shapedItem.kind !== "glyph") {
          continue;
        }
        height = Math.max(height, shapedItem.height);
        depth = Math.max(depth, shapedItem.depth);
      }
      continue;
    }
    if (item.kind === "math") {
      width += item.box.width;
      height = Math.max(height, item.box.height);
      depth = Math.max(depth, item.box.depth);
      continue;
    }
    width += texLayoutSpaceItemWidth(item);
  }
  const baseline = roundTexPt(height);
  return {
    metrics: {
      width: roundTexPt(width),
      height: baseline,
      depth: roundTexPt(depth),
    },
    renderItems: pendingItems.map((item) => ({
      ...item,
      baseline,
    })),
  };
}

function texLayoutSpaceItemWidth(item: TexLayoutSpaceItem): number {
  const normalized = Number.isFinite(item.spaceFactor) && item.spaceFactor > 0
    ? item.spaceFactor
    : 1000;
  if (item.spaceGlueProfile === "tikz-fixed") {
    return roundTexPt((normalized >= 2000 ? 0.5 : 0.3333) * item.font.atPt);
  }
  const baseSpace = tfmToPt(item.font, item.font.data.fontdimen.space);
  const extraSpace = tfmToPt(item.font, item.font.data.fontdimen.extraspace ?? 0);
  return roundTexPt(baseSpace + (normalized >= 2000 ? extraSpace : 0));
}

export function texLayoutMathItemWidth(item: TexLayoutMathItem): number {
  return roundTexPt(item.box.width);
}

export function texLayoutGlyphItemWidth(item: TexLayoutGlyphItem): number {
  return roundTexPt(tfmToPt(
    item.font,
    item.font.data.chars[String(item.code)]?.width
  ));
}

export function texLayoutGlyphItemHeight(item: TexLayoutGlyphItem): number {
  return roundTexPt(tfmToPt(
    item.font,
    item.font.data.chars[String(item.code)]?.height
  ));
}

export function texLayoutGlyphItemDepth(item: TexLayoutGlyphItem): number {
  return roundTexPt(tfmToPt(
    item.font,
    item.font.data.chars[String(item.code)]?.depth
  ));
}
