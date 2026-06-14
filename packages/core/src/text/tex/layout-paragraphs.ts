import type { KnuthPlassLayoutMode } from "../knuth-plass/index.js";
import type { ResolvedTexFont } from "./fonts/types.js";
import {
  simpleTexSegmentToLayoutItems,
  type TexLayoutInlineItem,
  type TexLayoutLabel,
} from "./layout-inline-items.js";
import {
  prepareTexLayoutParagraphsFromVList,
  type TexLayoutParagraphPreparation,
  type TexLayoutParagraphPreparationParams,
  type TexLayoutParagraphSegmentPlan,
} from "./layout-paragraph-preparation.js";
import type {
  SimpleTexParagraphSegment,
  SimpleTexListContext,
  TexAlignmentProfile,
  TexParagraphAlignment,
  TexSpaceGlueProfile,
} from "./ir.js";
import type { TexVListDocument } from "./vlist/index.js";

export {
  prepareTexLayoutParagraphsFromVList,
  type TexLayoutParagraphPreparation,
  type TexLayoutParagraphPreparationParams,
  type TexLayoutParagraphSegmentPlan,
} from "./layout-paragraph-preparation.js";

export interface TexLayoutParagraphIr {
  readonly kind: "tex-layout-paragraph";
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly font: ResolvedTexFont;
  readonly alignment: TexParagraphAlignment;
  readonly alignmentProfile?: TexAlignmentProfile;
  readonly inheritedAlignment: TexParagraphAlignment;
  readonly inheritedAlignmentProfile?: TexAlignmentProfile;
  readonly noIndent: boolean;
  readonly firstLineIndentWidth?: number;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly leftMarginWidth: number;
  readonly rightMarginWidth: number;
  readonly quoteDepth: number;
  readonly listContext?: SimpleTexListContext;
  readonly label?: TexLayoutLabel;
  readonly forcedBreakAfter?: SimpleTexParagraphSegment["forcedBreakAfter"];
  readonly items: readonly TexLayoutInlineItem[];
}

export interface TexLayoutParagraphBuildResult {
  readonly vlist: TexVListDocument;
  readonly layoutMode: KnuthPlassLayoutMode;
  readonly paragraphs: readonly TexLayoutParagraphIr[];
}

export function buildTexLayoutParagraphsFromVList(
  params: TexLayoutParagraphPreparationParams
): TexLayoutParagraphBuildResult {
  const preparation = prepareTexLayoutParagraphsFromVList(params);
  return buildTexLayoutParagraphsFromPreparation(preparation, params);
}

export function buildTexLayoutParagraphsFromPreparation(
  preparation: TexLayoutParagraphPreparation,
  params: Pick<TexLayoutParagraphPreparationParams, "font" | "metricProvider">
): TexLayoutParagraphBuildResult {
  return {
    vlist: preparation.vlist,
    layoutMode: preparation.layoutMode,
    paragraphs: preparation.segmentPlans.map((plan) =>
      texLayoutParagraphIrFromSegmentPlan(plan, params)
    ),
  };
}

function texLayoutParagraphIrFromSegmentPlan(
  plan: TexLayoutParagraphSegmentPlan,
  params: Pick<TexLayoutParagraphPreparationParams, "font" | "metricProvider">
): TexLayoutParagraphIr {
  const paragraph = plan.paragraph;
  const segment = plan.segment;
  const paragraphState = plan.paragraphState;
  return {
    kind: "tex-layout-paragraph",
    blockIndex: plan.blockIndex,
    segmentIndex: plan.segmentIndex,
    text: segment.text,
    sourceStart: segment.sourceStart,
    sourceEnd: segment.sourceEnd,
    font: params.font,
    alignment: paragraphState.alignment,
    alignmentProfile: paragraphState.alignmentProfile,
    inheritedAlignment: paragraphState.inheritedAlignment,
    inheritedAlignmentProfile: paragraphState.inheritedAlignmentProfile,
    noIndent: segment.noIndent,
    firstLineIndentWidth: plan.listAttachments.firstLineIndentWidth,
    spaceGlueProfile: paragraphState.spaceGlueProfile,
    leftMarginWidth: plan.scopeContext.layout.leftMarginWidth,
    rightMarginWidth: plan.scopeContext.layout.rightMarginWidth,
    quoteDepth: paragraph.quoteDepth,
    listContext: paragraph.listContext,
    label: plan.listAttachments.marginLabel,
    forcedBreakAfter: segment.forcedBreakAfter,
    items: [
      ...plan.listAttachments.inlineLabelItems,
      ...simpleTexSegmentToLayoutItems(
        segment,
        params.font.atPt,
        params.metricProvider,
        paragraphState.spaceGlueProfile
      ),
    ],
  };
}
