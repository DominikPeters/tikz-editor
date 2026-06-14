import type { KnuthPlassLayoutMode } from "../knuth-plass/index.js";
import type { ResolvedTexFont, TexMetricProvider } from "./fonts/types.js";
import { simpleTexInlineNodesToLayoutItems } from "./layout-inline-items.js";
import {
  texListItemParagraphAttachments,
  type TexListItemParagraphAttachments,
} from "./layout-list-attachments.js";
import type { TexLayoutIrOptions } from "./layout-options.js";
import {
  texParagraphScopeContext,
  type TexParagraphScopeContext,
} from "./layout-scope.js";
import {
  TexParagraphLayoutState,
  type TexParagraphLayoutStateResult,
} from "./layout-state.js";
import {
  splitSimpleTexParagraphSegments,
  type SimpleTexParagraphSegment,
  type TexParagraphAlignment,
} from "./ir.js";
import {
  attachTexHBoxesBeforeVListParagraphs,
  texVListParagraphEntries,
  type TexHBoxItem,
  type TexParagraphItem,
  type TexVListDocument,
} from "./vlist/index.js";

export interface TexLayoutParagraphPreparation {
  readonly vlist: TexVListDocument;
  readonly layoutMode: KnuthPlassLayoutMode;
  readonly segmentPlans: readonly TexLayoutParagraphSegmentPlan[];
}

export interface TexLayoutParagraphSegmentPlan {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly paragraph: TexParagraphItem["paragraph"];
  readonly segment: SimpleTexParagraphSegment;
  readonly paragraphState: TexParagraphLayoutStateResult;
  readonly scopeContext: TexParagraphScopeContext;
  readonly listAttachments: TexListItemParagraphAttachments;
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
  const segmentPlans: TexLayoutParagraphSegmentPlan[] = [];
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
      segmentPlans.push({
        blockIndex,
        segmentIndex,
        paragraph,
        segment,
        paragraphState: paragraphStateResult,
        scopeContext,
        listAttachments,
      });
    }
  }

  return {
    vlist: attachTexHBoxesBeforeVListParagraphs(
      params.vlist,
      marginLabelHBoxesByBlockIndex
    ),
    layoutMode,
    segmentPlans,
  };
}

function finalVListParagraphBlockIndex(
  items: readonly TexParagraphItem[]
): number | undefined {
  return items.at(-1)?.paragraph.blockIndex;
}
