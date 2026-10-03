import type { ResolvedTexFont, TexMetricProvider } from "../fonts/types.js";
import type { TexTextFontProfile } from "../fonts/text-profile.js";
import type { DocumentGraphicsResolver } from "../../../graphics/types.js";
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
  graphicsResolver?: DocumentGraphicsResolver
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
  readonly graphicsResolver?: DocumentGraphicsResolver;
  readonly mathBoxProvider?: TexMathBoxProvider;
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
        params.graphicsResolver,
        params.mathBoxProvider
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
  if (listContext?.kind !== "description" && listContext?.kind !== "bibliography") {
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
  graphicsResolver?: DocumentGraphicsResolver,
  mathBoxProvider?: TexMathBoxProvider
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
    mathBoxProvider,
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
  graphicsResolver?: DocumentGraphicsResolver
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

  if (labelContent.kind === "marker") {
    const marker = labelContent.marker;
    return {
      items: [],
      sourceStart: 0,
      sourceEnd: 0,
      rightEdge: texVListX(
        roundTexPt(
          rightEdge +
          (marker.rightEdgeOffsetEm ?? 0) * Number(font.atPt)
        )
      ),
      marker: {
        profile: marker,
        atPt: font.atPt,
      },
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
      ...(listContext.itemCommandSpan ? { itemCommandSpan: listContext.itemCommandSpan } : {}),
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
  if (label.marker) {
    const { profile, atPt } = label.marker;
    const width = texLength(roundTexPt(profile.widthEm * atPt));
    const height = texLength(roundTexPt(profile.heightEm * atPt));
    const depth = texLength(roundTexPt(profile.depthEm * atPt));
    const renderItems: TexRenderItem[] = profile.glyph
      ? [{
          kind: "tex-glyph",
          text: profile.glyph.text,
          code: profile.glyph.code,
          fontId: profile.glyph.fontId,
          atPt: texLength(profile.glyph.fontSizePt),
          color: profile.glyph.color,
          x: texHBoxX(0),
          baseline: texHBoxY(roundTexPt(
            height + profile.glyph.baselineOffsetEm * atPt
          )),
        }]
      : [{
          kind: "tex-math-svg",
          svgBody: profile.svgBody,
          x: texHBoxX(0),
          baseline: texHBoxY(height),
        }];
    if (profile.projectedText) {
      renderItems.push({
        kind: "tex-glyph-run",
        text: profile.projectedText.text,
        fontId: profile.projectedText.fontId,
        atPt: texLength(profile.projectedText.fontSizePt),
        color: profile.projectedText.color,
        x: texHBoxX(roundTexPt(profile.projectedText.xEm * atPt)),
        baseline: texHBoxY(roundTexPt(
          height + profile.projectedText.baselineOffsetEm * atPt
        )),
      });
    }
    return {
      metrics: { width, height, depth },
      renderItems,
    };
  }
  let width = texLength(0);
  let height = texLength(0);
  let depth = Number.NEGATIVE_INFINITY;
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
      const shaped = metricProvider.shapeText(item.text, item.font, {
        sourceStart: item.sourceStart,
        includeCaretStops: false,
      });
      let cursor = Number(width);
      for (const shapedItem of shaped.items) {
        if (shapedItem.kind === "kern") {
          cursor += shapedItem.width;
          continue;
        }
        if (shapedItem.kind !== "glyph") {
          continue;
        }
        pendingItems.push({
          kind: "tex-glyph",
          text: item.text.slice(shapedItem.sourceStart - item.sourceStart, shapedItem.sourceEnd - item.sourceStart),
          code: shapedItem.code,
          fontId: item.font.id,
          atPt: item.font.atPt,
          ...(item.sourceEnd > item.sourceStart
            ? { sourceSpan: { start: shapedItem.sourceStart, end: shapedItem.sourceEnd } }
            : {}),
          ...(item.font.color ? { color: item.font.color } : {}),
          x: texHBoxX(roundTexPt(cursor)),
        });
        cursor += shapedItem.width;
        height = texLength(Math.max(height, shapedItem.height));
        depth = texLength(Math.max(depth, shapedItem.depth));
      }
      width = texLength(width + shaped.width);
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
  const resolvedDepth = Number.isFinite(depth) ? depth : texLength(0);
  return {
    metrics: {
      width: texLength(roundTexPt(width)),
      height: texLength(baseline),
      depth: texLength(roundTexPt(resolvedDepth)),
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
  return `<g fill="${escaped}" stroke="none">${body}</g>`;
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
