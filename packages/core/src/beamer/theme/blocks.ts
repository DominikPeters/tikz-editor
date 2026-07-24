import type {
  BeamerBlockTemplateContext,
  BeamerBlockTemplatePlan,
  BeamerThemeFontRole,
} from "./types.js";
import { texLength } from "../../text/tex/coordinates.js";
import { createBeamerTexTextFontProfile } from "./font.js";
import { resolveBeamerThemeColor } from "./resolve.js";

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
  const style = templateId.includes("/inmargin")
    ? "inmargin"
    : templateId.includes("/rounded")
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
  const titleColorRole = `block title${suffix}`;
  const bodyColorRole = `block body${suffix}`;
  const hasTitleBackground =
    resolveBeamerThemeColor(context.theme, titleColorRole).bg != null;
  const hasBodyBackground =
    resolveBeamerThemeColor(context.theme, bodyColorRole).bg != null;
  const defaultColored =
    style === "default" && hasTitleBackground && hasBodyBackground;
  const titleColorSepPt = defaultColored
    ? 0.75 * fontXHeightPt(context, "block-title")
    : 0;
  const bodyColorSepPt = defaultColored
    ? 0.75 * fontXHeightPt(context, "block-body")
    : 0;

  return {
    templateId,
    style,
    shadow: templateId === "beamer/block/rounded-shadow",
    titleColorRole,
    bodyColorRole,
    titleFontRole: "block-title",
    bodyFontRole: "block-body",
    geometry: style === "inmargin"
      ? {
          beforeSkipPt: 6,
          // The template's sole \smallskip belongs to the packaged block
          // extent below; unlike the default template there is no second
          // inter-block skip.
          afterSkipPt: 0,
          outerBleedPt: 0,
          roundedTopInsetPt: 0,
          titleDepthFloorPt: 0,
          titleExtraHeightPt: 0,
          transitionHeightPt: 0,
          bodyTopPaddingPt: 0,
          bodyExtraHeightPt: 0,
          boxTopSkipPt: 0,
          titleBodyGapPt: 0,
          bodyFirstBaselineSkipPt: null,
          bodyInitialVSkipEx: 0,
          flowBoxHeight: "natural",
          flowEndingDepth: "zero",
          bodyBottomRaisePt: 0,
          boxBottomSkipPt: 3,
          cornerRadiusPt: 0,
          shadowExtentPt: 0,
        }
      : style === "rounded"
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
          // body ends 3.5pt below the final paragraph box; the independent
          // TeX flow advance is described by the fields below.
          bodyExtraHeightPt: 3.5,
          // beamerbaseboxes.sty: \vskip4bp, then after the title hbox
          // \vskip-1pt + a 6pt transition hbox + \vskip-.5pt. The body hbox
          // is raised by its depth plus .5pt and shadowed boxes finish with
          // natural 4bp glue (with 2bp shrink).
          boxTopSkipPt: bp(4),
          titleBodyGapPt: 4.5,
          bodyFirstBaselineSkipPt: null,
          bodyInitialVSkipEx: 0,
          flowBoxHeight: "natural",
          flowEndingDepth: "zero",
          bodyBottomRaisePt: 0.5,
          boxBottomSkipPt: context.theme.templates.block.id.endsWith(
              "rounded-shadow"
            )
            ? bp(4)
            : bp(2),
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
          // A non-empty default colorbox paints `colsep*=.75ex` outside the
          // text width as well as above and below its contents.
          outerBleedPt: titleColorSepPt,
          roundedTopInsetPt: titleColorSepPt,
          titleDepthFloorPt: 0,
          titleExtraHeightPt: 2 * titleColorSepPt,
          // When both boxes have backgrounds, the source joins them using
          // `\nointerlineskip\vskip-.5pt`.
          transitionHeightPt: defaultColored ? -0.5 : 0,
          bodyTopPaddingPt: 0,
          bodyExtraHeightPt: bodyColorSepPt,
          boxTopSkipPt: 0,
          // beamerinnerthemedefault.sty leaves normal inter-line handling
          // between empty-background title and body colorboxes. Their box
          // dimensions force TeX's 1pt \lineskip. Inside the vmode body,
          // an empty vbox establishes a fresh 13.6pt baseline after
          // \vskip-.25ex.
          titleBodyGapPt: defaultColored
            ? 2 * titleColorSepPt - 0.5
            : 1,
          bodyFirstBaselineSkipPt:
            context.theme.fonts["block-body"].lineHeightPt,
          // For a colored body the `.75ex` opening color separation and
          // template's `\vskip-.75ex` cancel before the empty vbox.
          bodyInitialVSkipEx: defaultColored ? 0 : -0.25,
          flowBoxHeight: defaultColored ? "natural" : "title-ascent",
          flowEndingDepth: defaultColored ? "zero" : "body-last-line",
          bodyBottomRaisePt: 0,
          boxBottomSkipPt: bodyColorSepPt,
          cornerRadiusPt: 0,
          shadowExtentPt: 0,
        },
  };
}

function fontXHeightPt(
  context: BeamerBlockTemplateContext,
  role: BeamerThemeFontRole
): number {
  const font = context.theme.fonts[role];
  const profile = createBeamerTexTextFontProfile(font);
  const resolved = profile.resolveTextFont(
    profile.defaultFontState,
    texLength(font.sizePt),
    profile.metricProvider
  );
  return resolved.data.fontdimen.xheight * Number(resolved.atPt);
}
