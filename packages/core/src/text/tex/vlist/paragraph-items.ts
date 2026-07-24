import type { ResolvedTexFont, TexMetricProvider } from "../fonts/types.js";
import type { TexTextFontProfile } from "../fonts/text-profile.js";
import type { DocumentGraphicsResolver } from "../../../graphics/types.js";
import {
  simpleTexSegmentToLayoutItems,
  type TexMathBoxProvider,
  type TexLayoutInlineItem,
} from "../layout-inline-items.js";
import type { TexLayoutParagraphPlan } from "./paragraph-plans.js";
import type { TexLength } from "../coordinates.js";

export function texLayoutItemsForParagraphPlan(
  plan: TexLayoutParagraphPlan,
  params: {
    readonly atPt: TexLength;
    readonly metricProvider: TexMetricProvider;
    readonly mathBoxProvider?: TexMathBoxProvider;
    readonly graphicsResolver?: DocumentGraphicsResolver;
    readonly textFontProfile?: TexTextFontProfile;
  }
): readonly TexLayoutInlineItem[] {
  const contentItems = simpleTexSegmentToLayoutItems(
    plan.segment,
    params.atPt,
    params.metricProvider,
    plan.spaceGlueProfile,
    params.mathBoxProvider,
    params.textFontProfile?.defaultFontState,
    params.textFontProfile,
    params.graphicsResolver
  );
  if (plan.preserveTrailingInterwordSpace) {
    const trailingSourceSpace = plan.segment.nodes.at(-1);
    let trailingFont: ResolvedTexFont | undefined;
    const trailingContentItem = contentItems.at(-1);
    const trailingSpaceFactor =
      trailingContentItem?.kind === "text"
        ? trailingContentItem.spaceFactorAfter
        : 1000;
    for (let index = contentItems.length - 1; index >= 0; index -= 1) {
      const item = contentItems[index];
      if (!item) {
        continue;
      }
      if (trailingFont === undefined && "font" in item) {
        trailingFont = item.font;
      }
      if (trailingFont !== undefined) {
        break;
      }
    }
    if (trailingSourceSpace?.kind === "space") {
      contentItems.push({
        kind: "space",
        text: " ",
        sourceStart: trailingSourceSpace.sourceStart,
        sourceEnd: trailingSourceSpace.sourceEnd,
        font: trailingFont ??
          params.textFontProfile?.resolveTextFont(
            params.textFontProfile.defaultFontState,
            params.atPt,
            params.metricProvider
          ) ??
          params.metricProvider.resolveFont({ atPt: params.atPt }),
        spaceFactor: trailingSpaceFactor,
        spaceGlueProfile: plan.spaceGlueProfile,
        preserveAtLineEnd: true,
      });
    }
  }
  return [...plan.inlinePrefixItems, ...contentItems];
}
