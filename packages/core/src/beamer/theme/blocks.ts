import type {
  BeamerBlockTemplateContext,
  BeamerBlockTemplatePlan,
} from "./types.js";

const TEX_POINTS_PER_BP = 72.27 / 72;

function bp(value: number): number {
  return value * TEX_POINTS_PER_BP;
}

/**
 * Resolve the structural block template before frame composition.
 *
 * The rounded constants follow beamerbaseauxtemplates.sty and
 * beamerbaseboxes.sty: the template contributes medskip, the box starts with
 * 4bp, paints 4bp outside its text width, floors the title depth at 1.5pt,
 * uses the 2pt body lead, and reserves the Madrid shadow.
 */
export function planBeamerBlockTemplate(
  context: BeamerBlockTemplateContext
): BeamerBlockTemplatePlan {
  const templateId = context.theme.templates.block.id;
  const style = templateId.includes("/rounded")
    ? "rounded"
    : templateId.includes("/metropolis") || templateId.includes("/moloch")
      ? "modern"
      : "default";
  const suffix =
    context.environment === "alertblock"
      ? " alerted"
      : context.environment === "exampleblock"
        ? " example"
        : "";

  return {
    templateId,
    style,
    shadow: templateId === "beamer/block/rounded-shadow",
    titleColorRole: `block title${suffix}`,
    bodyColorRole: `block body${suffix}`,
    titleFontRole: "block-title",
    bodyFontRole: "block-body",
    geometry: style === "rounded"
      ? {
          beforeSkipPt: 6,
          afterSkipPt: 3,
          outerBleedPt: bp(4),
          roundedTopInsetPt: bp(3),
          titleDepthFloorPt: 1.5,
          titleExtraHeightPt: bp(5),
          transitionHeightPt: bp(2.5),
          bodyTopPaddingPt: 2,
          // The lower PGF path protrudes below the natural vbox. The colored
          // body ends 3.5pt below the final paragraph box, while the vbox
          // reference advances only another 1bp.
          bodyExtraHeightPt: 3.5,
          boxBottomAdvancePt: bp(1),
          cornerRadiusPt: bp(4),
          shadowExtentPt: context.theme.templates.block.id.endsWith(
              "rounded-shadow"
            )
            ? bp(4)
            : bp(2),
        }
      : {
          beforeSkipPt: 6,
          afterSkipPt: 3,
          outerBleedPt: 0,
          roundedTopInsetPt: 0,
          titleDepthFloorPt: 0,
          titleExtraHeightPt: 0,
          transitionHeightPt: 0,
          bodyTopPaddingPt: 0,
          bodyExtraHeightPt: 0,
          boxBottomAdvancePt: 0,
          cornerRadiusPt: 0,
          shadowExtentPt: 0,
        },
  };
}
