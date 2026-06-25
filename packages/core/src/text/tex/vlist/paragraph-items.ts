import type { TexMetricProvider } from "../fonts/types.js";
import type { TexTextFontProfile } from "../fonts/text-profile.js";
import {
  simpleTexSegmentToLayoutItems,
  type TexMathBoxProvider,
  type TexLayoutInlineItem,
} from "../layout-inline-items.js";
import type { TexLayoutParagraphPlan } from "./paragraph-plans.js";

export function texLayoutItemsForParagraphPlan(
  plan: TexLayoutParagraphPlan,
  params: {
    readonly atPt: number;
    readonly metricProvider: TexMetricProvider;
    readonly mathBoxProvider?: TexMathBoxProvider;
    readonly textFontProfile?: TexTextFontProfile;
  }
): readonly TexLayoutInlineItem[] {
  return [
    ...plan.inlinePrefixItems,
    ...simpleTexSegmentToLayoutItems(
      plan.segment,
      params.atPt,
      params.metricProvider,
      plan.spaceGlueProfile,
      params.mathBoxProvider,
      params.textFontProfile?.defaultFontState,
      params.textFontProfile
    ),
  ];
}
