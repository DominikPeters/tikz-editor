import type { KnuthPlassLayoutMode } from "../knuth-plass/index.js";
import type { ResolvedTexFont, TexMetricProvider } from "./fonts/types.js";
import { simpleTexInlineNodesToLayoutItems } from "./layout-inline-items.js";
import type {
  TexLayoutInlineItem,
  TexLayoutLabel,
} from "./layout-inline-items.js";
import type { TexLayoutIrOptions } from "./layout-options.js";
import {
  TexParagraphLayoutState,
} from "./layout-state.js";
import {
  splitSimpleTexParagraphSegments,
  type SimpleTexParagraphSegment,
  type TexAlignmentProfile,
  type TexParagraphAlignment,
  type TexSpaceGlueProfile,
} from "./ir.js";
import {
  attachTexHBoxesBeforeVListParagraphs,
  texListItemParagraphAttachments,
  texParagraphScopeContext,
  texVListParagraphEntries,
  type TexHBoxItem,
  type TexParagraphItem,
  type TexVListDocument,
} from "./vlist/index.js";

export interface TexLayoutParagraphPreparation {
  readonly vlist: TexVListDocument;
  readonly layoutMode: KnuthPlassLayoutMode;
  readonly paragraphPlans: readonly TexLayoutParagraphPlan[];
}

export interface TexLayoutParagraphPlan {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly segment: SimpleTexParagraphSegment;
  readonly alignment: TexParagraphAlignment;
  readonly alignmentProfile?: TexAlignmentProfile;
  readonly inheritedAlignment: TexParagraphAlignment;
  readonly inheritedAlignmentProfile?: TexAlignmentProfile;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly inlinePrefixItems: readonly TexLayoutInlineItem[];
  readonly breakContext: TexLayoutParagraphBreakContext;
  readonly lineLabel?: TexLayoutParagraphLineLabel;
}

export interface TexLayoutParagraphBreakContext {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly firstLineIndentWidth?: number;
  readonly leftMarginWidth: number;
  readonly rightMarginWidth: number;
  readonly quoteContextActive: boolean;
  readonly listContextActive: boolean;
}

export interface TexLayoutParagraphLineLabel {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly label: TexLayoutLabel;
}

export interface TexLayoutParagraphPreparationParams {
  readonly vlist: TexVListDocument;
  readonly defaultAlignment: TexParagraphAlignment;
  readonly font: ResolvedTexFont;
  readonly metricProvider: TexMetricProvider;
  readonly options: TexLayoutIrOptions;
}

export function prepareTexLayoutParagraphsFromVList(
  params: TexLayoutParagraphPreparationParams
): TexLayoutParagraphPreparation {
  const paragraphPlans: TexLayoutParagraphPlan[] = [];
  const paragraphEntries = texVListParagraphEntries(params.vlist.items);
  const paragraphItems = paragraphEntries.map((entry) => entry.item);
  const marginLabelHBoxesByBlockIndex = new Map<number, TexHBoxItem>();
  const paragraphState = new TexParagraphLayoutState(
    params.defaultAlignment,
    params.options
  );
  const finalParagraphBlockIndex = finalVListParagraphBlockIndex(paragraphItems);
  let layoutMode: KnuthPlassLayoutMode = "wrap";

  for (const entry of paragraphEntries) {
    const paragraph = entry.item.paragraph;
    const scopeContext = texParagraphScopeContext(entry.ancestors);
    const blockIndex = paragraph.blockIndex;
    const paragraphStateResult = paragraphState.resolveParagraph({
      paragraph,
      scopePolicy: scopeContext.policy,
      finalParagraphInNode: blockIndex === finalParagraphBlockIndex,
    });
    const segments = splitSimpleTexParagraphSegments(
      paragraph,
      params.options,
      paragraphStateResult.alignment,
      blockIndex
    );
    if (segments.some((segment) => segment.forcedBreakAfter)) {
      layoutMode = "wrapped-explicit";
    }

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex];
      const listAttachments = texListItemParagraphAttachments({
        segmentIndex,
        listContext: paragraph.listContext,
        listItemLayout: scopeContext.listItemLayout,
        font: params.font,
        metricProvider: params.metricProvider,
        spaceGlueProfile: paragraphStateResult.spaceGlueProfile,
        inlineNodesToItems: simpleTexInlineNodesToLayoutItems,
      });
      if (listAttachments.marginLabelHBox) {
        marginLabelHBoxesByBlockIndex.set(
          blockIndex,
          listAttachments.marginLabelHBox
        );
      }
      paragraphPlans.push({
        blockIndex,
        segmentIndex,
        segment,
        alignment: paragraphStateResult.alignment,
        alignmentProfile: paragraphStateResult.alignmentProfile,
        inheritedAlignment: paragraphStateResult.inheritedAlignment,
        inheritedAlignmentProfile: paragraphStateResult.inheritedAlignmentProfile,
        spaceGlueProfile: paragraphStateResult.spaceGlueProfile,
        inlinePrefixItems: listAttachments.inlineLabelItems,
        breakContext: {
          blockIndex,
          segmentIndex,
          firstLineIndentWidth: listAttachments.firstLineIndentWidth,
          leftMarginWidth: scopeContext.layout.leftMarginWidth,
          rightMarginWidth: scopeContext.layout.rightMarginWidth,
          quoteContextActive: scopeContext.quoteContextActive,
          listContextActive: scopeContext.listContextActive,
        },
        ...(listAttachments.marginLabel
          ? {
              lineLabel: {
                blockIndex,
                segmentIndex,
                label: listAttachments.marginLabel,
              },
            }
          : {}),
      });
    }
  }

  return {
    vlist: attachTexHBoxesBeforeVListParagraphs(
      params.vlist,
      marginLabelHBoxesByBlockIndex
    ),
    layoutMode,
    paragraphPlans,
  };
}

function finalVListParagraphBlockIndex(
  items: readonly TexParagraphItem[]
): number | undefined {
  return items.at(-1)?.paragraph.blockIndex;
}
