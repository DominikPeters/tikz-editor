import type {
  BeamerTitlePageTemplatePlan,
  ResolvedBeamerTheme,
} from "./types.js";

const TEX_POINTS_PER_BP = 72.27 / 72;
const TITLE_PAGE_LEADING_MATERIAL_PT = 14.6;

/**
 * Resolve the active inner theme's title template into TeX box geometry.
 *
 * The default values follow beamerinnerthemedefault.sty's 8pt colorbox
 * separation. The rounded inner theme wraps the same content in
 * beamerboxesrounded, adding its PGF box material around that colorbox.
 */
export function planBeamerTitlePageTemplate(
  theme: ResolvedBeamerTheme,
  hasSubtitle: boolean
): BeamerTitlePageTemplatePlan {
  const templateId = theme.templates.titlePage.id;
  if (templateId === "beamer/title-page/rounded-shadow") {
    return {
      templateId,
      style: "rounded",
      shadow: true,
      outerBleedPt: 4 * TEX_POINTS_PER_BP,
      titleBoxTopPt: TITLE_PAGE_LEADING_MATERIAL_PT,
      titleBoxHeightPt: hasSubtitle ? 56.468338 : 37.1676,
      titleBaselineFromBoxTopPt: 24.508591,
      subtitleBaselineFromBoxTopPt: 41.708588,
    };
  }
  return {
    templateId,
    style: "colorbox",
    shadow: false,
    outerBleedPt: 0,
    titleBoxTopPt: TITLE_PAGE_LEADING_MATERIAL_PT,
    titleBoxHeightPt: hasSubtitle ? 45.438339 : 26.137601,
    titleBaselineFromBoxTopPt: 17.993591,
    subtitleBaselineFromBoxTopPt: 35.193588,
  };
}
