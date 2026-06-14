import type { TexMetricProvider } from "../fonts/types.js";
import {
  simpleTexSegmentToLayoutItems,
  type TexLayoutInlineItem,
} from "../layout-inline-items.js";
import type { TexLayoutParagraphPlan } from "./paragraph-plans.js";

export function texLayoutItemsForParagraphPlan(
  plan: TexLayoutParagraphPlan,
  params: {
    readonly atPt: number;
    readonly metricProvider: TexMetricProvider;
  }
): readonly TexLayoutInlineItem[] {
  return [
    ...plan.inlinePrefixItems,
    ...simpleTexSegmentToLayoutItems(
      plan.segment,
      params.atPt,
      params.metricProvider,
      plan.spaceGlueProfile
    ),
  ];
}
