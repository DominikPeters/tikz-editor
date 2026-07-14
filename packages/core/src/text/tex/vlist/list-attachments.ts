import type { ResolvedTexFont, TexMetricProvider } from "../fonts/types.js";
import type { TexTextFontProfile } from "../fonts/text-profile.js";
import type { NodeTextGraphicsResolver } from "../../types.js";
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
  TexLayoutTextBoxItem,
  TexMathBox,
  TexMathBoxProvider,
} from "../layout-inline-items.js";
import { renderTexMathHListSvgBody } from "../math/render-svg.js";
import {
  texHBoxX,
  texHBoxY,
  texLength,
  texVListLocalXFromOrigin,
  texVListX,
  type TexLength,
  type TexVListX,
} from "../coordinates.js";
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
  atPt: TexLength,
  metricProvider: TexMetricProvider,
  spaceGlueProfile: TexSpaceGlueProfile,
  mathBoxProvider?: TexMathBoxProvider,
  initialFontState?: SimpleTexFontState,
  textFontProfile?: TexTextFontProfile,
  graphicsResolver?: NodeTextGraphicsResolver
) => TexLayoutInlineItem[];

export interface TexListItemParagraphAttachments {
  readonly inlineLabelItems: readonly TexLayoutInlineItem[];
  readonly firstLineIndentWidth?: TexLength;
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
  readonly graphicsResolver?: NodeTextGraphicsResolver;
  readonly textFontProfile?: TexTextFontProfile;
  /** Absolute origin of the paragraph's containing VList. */
  readonly paragraphOriginX: TexVListX;
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
        params.textFontProfile,
        params.graphicsResolver
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
        params.textFontProfile,
        params.graphicsResolver
      )
    : undefined;
  const marginLabelHBox = marginLabel && listItemLabel && params.listContext
    ? texMarginListLabelHBoxFromLayoutLabel(
        marginLabel,
        params.listContext,
        params.blockIndex,
        listItemLabel,
        params.metricProvider,
        params.paragraphOriginX
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
): TexVListX {
  if (labelBox.rightEdge === undefined) {
    throw new Error("TeX list-item vbox label attachment is missing rightEdge.");
  }
  return labelBox.rightEdge;
}

function texArticleDescriptionFirstLineIndentWidth(
  listContext: SimpleTexListContext | undefined,
  listItemLayout: TexVBoxListItemLayout | undefined,
  hasDescriptionLabel: boolean
): TexLength | undefined {
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
  textFontProfile?: TexTextFontProfile,
  graphicsResolver?: NodeTextGraphicsResolver
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
    textFontProfile,
    graphicsResolver
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
  textFontProfile?: TexTextFontProfile,
  graphicsResolver?: NodeTextGraphicsResolver
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
        textFontProfile,
        graphicsResolver
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
  metricProvider: TexMetricProvider,
  paragraphOriginX: TexVListX
): TexHBoxItem {
  const box = texLayoutLabelHBoxContent(label, metricProvider);
  const labelLeft = texVListX(
    roundTexPt(label.rightEdge - box.metrics.width)
  );
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
    x: texVListLocalXFromOrigin(labelLeft, paragraphOriginX),
    advance: texLength(0),
    affectsVBoxBaseline: false,
    verticalPlacement: {
      kind: "paragraph-first-line-baseline",
      blockIndex,
    },
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
  let width = texLength(0);
  let height = texLength(0);
  let depth = texLength(0);
  const pendingItems: Array<
    | Omit<Extract<TexRenderItem, { kind: "tex-glyph-run" }>, "baseline">
    | Omit<Extract<TexRenderItem, { kind: "tex-glyph" }>, "baseline">
    | Omit<Extract<TexRenderItem, { kind: "tex-math-svg" }>, "baseline">
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
        ...(item.font.color ? { color: item.font.color } : {}),
        x: texHBoxX(roundTexPt(width)),
      });
      width = texLength(width + glyphWidth);
      height = texLength(Math.max(height, texLayoutGlyphItemHeight(item)));
      depth = texLength(Math.max(depth, texLayoutGlyphItemDepth(item)));
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
        ...(item.font.color ? { color: item.font.color } : {}),
        x: texHBoxX(roundTexPt(width)),
      });
      width = texLength(width + shaped.width);
      for (const shapedItem of shaped.items) {
        if (shapedItem.kind !== "glyph") {
          continue;
        }
        height = texLength(Math.max(height, shapedItem.height));
        depth = texLength(Math.max(depth, shapedItem.depth));
      }
      continue;
    }
    if (item.kind === "kern") {
      width = texLength(width + item.width);
      continue;
    }
    if (item.kind === "math") {
      const mathWidth = texLayoutMathItemWidth(item);
      const svgBody = texLayoutBoxSvgBody(item.box);
      if (svgBody) {
        pendingItems.push({
          kind: "tex-math-svg",
          svgBody,
          x: texHBoxX(roundTexPt(width)),
        });
      }
      width = texLength(width + mathWidth);
      height = texLength(Math.max(height, item.box.height));
      depth = texLength(Math.max(depth, item.box.depth));
      continue;
    }
    if (item.kind === "text-box") {
      const boxWidth = texLayoutTextBoxItemWidth(item);
      const svgBody = texLayoutBoxSvgBody(item.box);
      if (svgBody) {
        pendingItems.push({
          kind: "tex-math-svg",
          svgBody,
          x: texHBoxX(roundTexPt(width)),
        });
      }
      width = texLength(width + boxWidth);
      height = texLength(Math.max(height, item.box.height));
      depth = texLength(Math.max(depth, item.box.depth));
      continue;
    }
    if (item.kind === "penalty") {
      continue;
    }
    width = texLength(width + texLayoutSpaceItemWidth(item));
  }
  const baseline = texHBoxY(roundTexPt(height));
  return {
    metrics: {
      width: texLength(roundTexPt(width)),
      height: texLength(baseline),
      depth: texLength(roundTexPt(depth)),
    },
    renderItems: pendingItems.map((item) => ({
      ...item,
      baseline,
    })),
  };
}

function texLayoutSpaceItemWidth(item: TexLayoutSpaceItem): TexLength {
  const normalized = Number.isFinite(item.spaceFactor) && item.spaceFactor > 0
    ? item.spaceFactor
    : 1000;
  if (item.spaceGlueProfile === "tikz-fixed") {
    return texLength(roundTexPt((normalized >= 2000 ? 0.5 : 0.3333) * item.font.atPt));
  }
  const baseSpace = tfmToPt(item.font, item.font.data.fontdimen.space);
  const extraSpace = tfmToPt(item.font, item.font.data.fontdimen.extraspace ?? 0);
  return texLength(roundTexPt(baseSpace + (normalized >= 2000 ? extraSpace : 0)));
}

export function texLayoutMathItemWidth(item: TexLayoutMathItem): TexLength {
  return texLength(roundTexPt(item.box.width));
}

export function texLayoutTextBoxItemWidth(item: TexLayoutTextBoxItem): TexLength {
  return texLength(roundTexPt(item.box.width));
}

function texLayoutBoxSvgBody(box: TexMathBox): string | undefined {
  if (box.hlist && box.fontProfile) {
    const body = renderTexMathHListSvgBody(box.hlist, {
      fontProfile: box.fontProfile,
    });
    return box.color ? wrapTexBoxColor(body, box.color) : body;
  }
  return box.svgBody && box.color ? wrapTexBoxColor(box.svgBody, box.color) : box.svgBody;
}

function wrapTexBoxColor(body: string, color: string): string {
  const escaped = color.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return `<g fill="${escaped}" stroke="${escaped}">${body}</g>`;
}

export function texLayoutGlyphItemWidth(item: TexLayoutGlyphItem): TexLength {
  return texLength(roundTexPt(tfmToPt(
    item.font,
    item.font.data.chars[String(item.code)]?.width
  )));
}

export function texLayoutGlyphItemHeight(item: TexLayoutGlyphItem): TexLength {
  return texLength(roundTexPt(tfmToPt(
    item.font,
    item.font.data.chars[String(item.code)]?.height
  )));
}

export function texLayoutGlyphItemDepth(item: TexLayoutGlyphItem): TexLength {
  return texLength(roundTexPt(tfmToPt(
    item.font,
    item.font.data.chars[String(item.code)]?.depth
  )));
}
