import type { BeamerTitlePageTemplatePlan, ResolvedBeamerTheme } from "./types.js";
import { resolveBeamerThemeColor } from "./resolve.js";

/** Select template structure; content dimensions are measured by the renderer. */
export function planBeamerTitlePageTemplate(
  theme: ResolvedBeamerTheme
): BeamerTitlePageTemplatePlan {
  const templateId = theme.templates.titlePage.id;
  for (const style of ["inmargin", "metropolis", "moloch"] as const) {
    if (templateId === `beamer/title-page/${style}`) {
      return { templateId, style, shadow: false, outerBleedPt: 0, paddingPt: 0 };
    }
  }
  const titleBackground = resolveBeamerThemeColor(theme, "title").bg ??
    resolveBeamerThemeColor(theme, "titlelike").bg;
  const rounded = titleBackground && (templateId === "beamer/title-page/rounded-shadow" || templateId === "beamer/title-page/rounded");
  return {
    templateId,
    style: rounded ? "rounded" : "colorbox",
    shadow: Boolean(rounded && templateId.endsWith("-shadow")),
    outerBleedPt: rounded ? 4 * 72.27 / 72 : 0,
    paddingPt: 8,
  };
}
