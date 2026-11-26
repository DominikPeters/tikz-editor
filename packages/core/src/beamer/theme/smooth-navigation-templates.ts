import { resolveBeamerThemeColor } from "./resolve.js";
import { beamerExMultiple, beamerFontExPt } from "./font-metrics.js";
import { measureBeamerHeadingStack, beamerSubtitlePrimitive } from "./heading-layout.js";
import type { BeamerDelimitedSourceValue } from "../types.js";
import {
  appendMiniFrameSections,
  planSplitHeadline,
} from "./navigation-templates.js";
import {
  backgroundGradientStop as backgroundStop,
  foregroundGradientStop as foregroundStop,
  gradientRectPrimitive as gradientPrimitive,
} from "./template-primitives.js";
import type {
  BeamerChromeTemplatePlan,
  BeamerFrameTemplateContext,
  BeamerTemplatePrimitive,
  BeamerThemeTemplateRef,
} from "./types.js";

// TeX Live 2026 source contracts:
// - beamerouterthemesmoothbars.sty declares the compressed section strip,
//   optional subsection row, and its paired shaded frame-title template.
// - beamerouterthemesmoothtree.sty uses the same fade construction around a
//   title/section/subsection tree.
// - beamerouterthemeshadow.sty loads `split`, appends a 2pt-deep headline
//   shadow, and replaces only the frame-title template.
//
// The boxes are stacked exactly as those templates do: skips and box heights
// in ex of the headline font (shadings are declared under
// `\usebeamerfont*{headline}`), frame-title lines in the frame-title font's
// baselineskip. Each product is scanned like TeX scans `<decimal>ex`. At the
// 11pt-class deck size this reproduces the LuaLaTeX/Latin Modern page
// coordinates the earlier hard-coded values were measured from, and under
// beamerposter the bars grow with the head/foot font.
type SmoothGeometry = {
  headlineInsetPt: number;
  headlinePaintHeightPt: number;
  sectionBaselinePt: number;
  subsectionBaselinePt?: number;
  titleBaselinePt?: number;
  headlineFadeY: number;
  /** The 1ex fade strips. */
  fadeHeightPt: number;
  frameTransitionY: number;
  frameTransitionHeightPt: number;
  frameBackgroundY: number;
  frameBackgroundHeightPt: number;
  frameTitleBaselinePt: number;
  frameBottomFadeY: number;
  topInsetPt: number;
};

// Where the frame title's first skip starts relative to the end of the
// headline box (measured against LuaLaTeX: smoothbars -0.14ex, smoothtree
// -0.07ex; both are ex multiples at 11pt, the poster check keeps them in ex).
const SMOOTH_BARS_FRAME_TITLE_START_EX = -0.14;
const SMOOTH_TREE_FRAME_TITLE_START_EX = -0.07;
// Smoothbars' LuaLaTeX positions need two more scaled points than the
// truncated product (0.14ex = 24442sp, measured 24444sp at 11pt).
const SMOOTH_BARS_FRAME_TITLE_START_EXTRA_SP = -2 / 65_536;

function smoothBarsGeometry(context: BeamerFrameTemplateContext, subsection: boolean): SmoothGeometry {
  const ex = beamerFontExPt(context.theme.fonts.headline);
  const m = (decimal: number) => beamerExMultiple(decimal, ex);
  const lineHeight = context.theme.fonts["frame-title"].lineHeightPt;
  // Headline: the barshade, then `\vskip-0.05ex` and the 1ex fade strip, then
  // a negative skip back up over both for the section (and subsection) boxes.
  const shade = m(subsection ? 8.75 : 6);
  const fadeY = shade - m(0.05);
  const sectionTop = fadeY + m(1) - m(subsection ? 9.75 : 6.85);
  const sectionBottom = sectionTop + m(2.25) + m(3.75);
  const subsectionBaseline = sectionBottom + m(2.125);
  const headlineInset = subsection
    ? subsectionBaseline + m(1.125) - m(0.1)
    : sectionBottom;
  // Frame title: `\vskip-0.1ex`, a ht=1ex,dp=1ex box carrying the
  // above-title shading (1ex tall with a subsection, 2ex without), `\vskip-1.09ex`,
  // the title box (`\vskip0.5ex`, strut line, `\vskip0.05ex`), `\vskip-0.05ex`
  // and the 1ex fade strip.
  const start = headlineInset + m(SMOOTH_BARS_FRAME_TITLE_START_EX) + SMOOTH_BARS_FRAME_TITLE_START_EXTRA_SP;
  const transitionBoxTop = start - m(0.1);
  const transitionHeight = m(subsection ? 1 : 2);
  const backgroundY = transitionBoxTop + m(1) + m(1) - m(1.09);
  const backgroundHeight = m(0.5) + lineHeight + m(0.05);
  const fadeBottomY = backgroundY + backgroundHeight - m(0.05);
  return {
    headlineInsetPt: headlineInset,
    headlinePaintHeightPt: shade,
    sectionBaselinePt: sectionTop + m(2.25),
    ...(subsection ? { subsectionBaselinePt: subsectionBaseline } : {}),
    headlineFadeY: fadeY,
    fadeHeightPt: m(1),
    frameTransitionY: transitionBoxTop + m(1) - transitionHeight,
    frameTransitionHeightPt: transitionHeight,
    frameBackgroundY: backgroundY,
    frameBackgroundHeightPt: backgroundHeight,
    frameTitleBaselinePt: backgroundY + m(0.5) + beamerExMultiple(0.7, lineHeight),
    frameBottomFadeY: fadeBottomY,
    topInsetPt: fadeBottomY + m(1) + frameTitleTrailingSkip(context),
  };
}

function smoothTreeGeometry(
  context: BeamerFrameTemplateContext
): SmoothGeometry & { titleBaselinePt: number; subsectionBaselinePt: number } {
  const ex = beamerFontExPt(context.theme.fonts.headline);
  const m = (decimal: number) => beamerExMultiple(decimal, ex);
  const lineHeight = context.theme.fonts["frame-title"].lineHeightPt;
  // Headline: the 9.25ex treeshade, a 1ex fade strip after `\vskip-0.05ex`,
  // `\vskip-9.15ex`, then the 2.25ex title box and two 3.25ex rows.
  const shade = m(9.25);
  const fadeY = shade - m(0.05);
  const titleTop = fadeY + m(1) - m(9.15);
  const titleBottom = titleTop + m(1.125) + m(1.125);
  const sectionBottom = titleBottom + m(2.125) + m(1.125);
  const subsectionBottom = sectionBottom + m(2.125) + m(1.125);
  const headlineInset = subsectionBottom - m(0.4);
  // Frame title: `\vskip-0.05ex`, a ht=0.85ex box whose 1ex shading hangs
  // above its baseline, the title box (`\vskip-1.2ex`, then a line whose
  // baseline is one baselineskip below that, strut depth .3), `\vskip-0.2ex`
  // and the 1ex fade strip.
  const start = headlineInset + m(SMOOTH_TREE_FRAME_TITLE_START_EX);
  const transitionBoxTop = start - m(0.05);
  const backgroundY = transitionBoxTop + m(0.85);
  const titleBaseline = backgroundY - m(1.2) + lineHeight;
  const backgroundHeight = titleBaseline - backgroundY + beamerExMultiple(0.3, lineHeight);
  const fadeBottomY = backgroundY + backgroundHeight - m(0.2);
  return {
    headlineInsetPt: headlineInset,
    headlinePaintHeightPt: shade,
    titleBaselinePt: titleTop + m(1.125),
    sectionBaselinePt: titleBottom + m(2.125),
    subsectionBaselinePt: sectionBottom + m(2.125),
    headlineFadeY: fadeY,
    fadeHeightPt: m(1),
    frameTransitionY: transitionBoxTop + m(0.85) - m(1),
    frameTransitionHeightPt: m(1),
    frameBackgroundY: backgroundY,
    frameBackgroundHeightPt: backgroundHeight,
    frameTitleBaselinePt: titleBaseline,
    frameBottomFadeY: fadeBottomY,
    topInsetPt: fadeBottomY + m(1) + frameTitleTrailingSkip(context),
  };
}

/**
 * beamerbaseframe.sty's `\vskip0.25em` after the frame-title box, in the
 * restored body font.
 */
function frameTitleTrailingSkip(context: BeamerFrameTemplateContext): number {
  return beamerExMultiple(0.25, context.theme.fonts["normal-text"].sizePt);
}

const SHADOW_HEADLINE_EXTRA_INSET_PT = 2;
const SHADOW_FADE_HEIGHT_PT = 8;
const HORIZONTAL_MARGIN_PT = 8.5359039306640625;
const SMOOTH_TREE_SECTION_INDENT_PT = 6;
const SMOOTH_TREE_SUBSECTION_INDENT_PT = 12;
const SMOOTH_TREE_FRAME_TITLE_X_PT = 26.603256;
const SHADOW_FRAME_TITLE_X_PT = 13.230301;

/**
 * The shadow theme's frame-title minipage: `\vbox{}\vskip-.75ex` (ex of the
 * frame-title font it is typeset in) above a strut line one baselineskip
 * down, with the strut's .3 depth below it; the template nets `\vskip-2pt`
 * and the box's own +2pt out of the inset before beamerbaseframe's 0.25em.
 */
function shadowFrameTitleGeometry(context: BeamerFrameTemplateContext) {
  const font = context.theme.fonts["frame-title"];
  const baselinePt = font.lineHeightPt - beamerExMultiple(0.75, beamerFontExPt(font));
  const heightPt = baselinePt + beamerExMultiple(0.3, font.lineHeightPt);
  return {
    baselinePt,
    heightPt,
    insetPt: heightPt + frameTitleTrailingSkip(context) - 2,
  };
}

export function planSmoothBarsHeadline(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  const subsection = ref.options.subsection !== false;
  const geometry = smoothBarsGeometry(context, subsection);
  const primitives: BeamerTemplatePrimitive[] = [
    gradientPrimitive({
      context,
      id: "headline:smoothbars:shade",
      bounds: {
        x: 0,
        y: 0,
        width: context.page.page.width,
        height: geometry.headlinePaintHeightPt,
      },
      templateId: "beamer/headline/smoothbars-shade",
      layoutKind: "background",
      direction: "vertical",
      stops: subsection
        ? [
            backgroundStop(0, "section in head/foot"),
            backgroundStop(5.5 / 8.75, "section in head/foot"),
            backgroundStop(6.5 / 8.75, "subsection in head/foot"),
            backgroundStop(1, "subsection in head/foot"),
          ]
        : [
            backgroundStop(0, "section in head/foot"),
            backgroundStop(1, "section in head/foot"),
          ],
    }),
    gradientPrimitive({
      context,
      id: "headline:smoothbars:fade",
      bounds: {
        x: 0,
        y: geometry.headlineFadeY,
        width: context.page.page.width,
        height: geometry.fadeHeightPt,
      },
      templateId: "beamer/headline/smoothbars-fade",
      layoutKind: "headline-decoration",
      direction: "vertical",
      stops: [
        backgroundStop(
          0,
          subsection ? "subsection in head/foot" : "section in head/foot",
          0.35
        ),
        backgroundStop(
          1,
          subsection ? "subsection in head/foot" : "section in head/foot",
          0
        ),
      ],
    }),
  ];
  appendMiniFrameSections(
    context,
    primitives,
    0,
    geometry.headlinePaintHeightPt,
    context.navigation.model.sections,
    {
      titleBaselineY: geometry.sectionBaselinePt,
      miniFrameIndexing: "global",
    }
  );
  if (subsection && geometry.subsectionBaselinePt !== undefined && context.navigation.currentSubsection) {
    const title = context.navigation.currentSubsection.title;
    primitives.push(textPrimitive({
      context,
      id: "headline:subsection",
      text: title,
      x: HORIZONTAL_MARGIN_PT,
      baselineY: geometry.subsectionBaselinePt,
      colorRole: "subsection in head/foot",
      fontRole: "subsection-in-head-foot",
    }));
  }
  return {
    inset: geometry.headlineInsetPt,
    primitives,
  };
}

export function planSmoothBarsFrameTitle(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  if (!context.frame.title) {
    return { inset: 0, primitives: [] };
  }
  const subsection = ref.options.subsection !== false;
  const geometry = smoothBarsGeometry(context, subsection);
  const transitionStops = subsection
    ? [
        backgroundStop(0, "subsection in head/foot"),
        backgroundStop(1, "frametitle"),
      ]
    : [
        backgroundStop(0, "section in head/foot"),
        backgroundStop(0.5, "frametitle"),
        backgroundStop(1, "frametitle"),
      ];
  const width = context.page.page.width - HORIZONTAL_MARGIN_PT - HORIZONTAL_MARGIN_PT;
  const measured = measureBeamerHeadingStack(context, width, { titleEnd: context.frame.subtitle ? "" : "\\strut" });
  const extra = measured ? measured.extent - context.theme.fonts["frame-title"].lineHeightPt : 0;
  return {
    inset: geometry.topInsetPt - geometry.headlineInsetPt + extra,
    primitives: [
      gradientPrimitive({
        context,
        id: "frame-title:transition",
        bounds: {
          x: 0,
          y: geometry.frameTransitionY - geometry.headlineInsetPt,
          width: context.page.page.width,
          height: geometry.frameTransitionHeightPt,
        },
        templateId: "beamer/frame-title/smooth-transition",
        layoutKind: "background",
        direction: "vertical",
        stops: transitionStops,
      }),
      ...(resolveBeamerThemeColor(context.theme, "frametitle").bg ? [{
        kind: "fill" as const,
        id: `${context.frame.id}:frame-title:background`,
        sourceSpan: context.frame.title.span,
        bounds: {
          x: 0,
          y: geometry.frameBackgroundY - geometry.headlineInsetPt,
          width: context.page.page.width,
          height: geometry.frameBackgroundHeightPt + extra,
        },
        colorRole: "frametitle",
      }] : []),
      frameTitleText(
        context,
        HORIZONTAL_MARGIN_PT,
        geometry.frameTitleBaselinePt - geometry.headlineInsetPt
      ),
      ...(measured?.subtitle ? beamerSubtitlePrimitive(context, HORIZONTAL_MARGIN_PT, width,
        geometry.frameTitleBaselinePt - geometry.headlineInsetPt + measured.subtitleBaseline) : []),
      frameBottomFade(
        context,
        geometry.frameBottomFadeY - geometry.headlineInsetPt + extra,
        geometry.fadeHeightPt
      ),
    ],
  };
}

export function planSmoothTreeHeadline(
  context: BeamerFrameTemplateContext
): BeamerChromeTemplatePlan {
  const geometry = smoothTreeGeometry(context);
  const primitives: BeamerTemplatePrimitive[] = [
    gradientPrimitive({
      context,
      id: "headline:smoothtree:shade",
      bounds: {
        x: 0,
        y: 0,
        width: context.page.page.width,
        height: geometry.headlinePaintHeightPt,
      },
      templateId: "beamer/headline/smoothtree-shade",
      layoutKind: "background",
      direction: "vertical",
      stops: [
        backgroundStop(0, "title in head/foot"),
        backgroundStop(2.75 / 9.25, "title in head/foot"),
        backgroundStop(3.75 / 9.25, "section in head/foot"),
        backgroundStop(6 / 9.25, "section in head/foot"),
        backgroundStop(7 / 9.25, "subsection in head/foot"),
        backgroundStop(1, "subsection in head/foot"),
      ],
    }),
    gradientPrimitive({
      context,
      id: "headline:smoothtree:fade",
      bounds: {
        x: 0,
        y: geometry.headlineFadeY,
        width: context.page.page.width,
        height: geometry.fadeHeightPt,
      },
      templateId: "beamer/headline/smoothtree-fade",
      layoutKind: "headline-decoration",
      direction: "vertical",
      stops: [
        backgroundStop(0, "subsection in head/foot", 0.35),
        backgroundStop(1, "subsection in head/foot", 0),
      ],
    }),
  ];
  const title = metadataValue(context, "title");
  if (title) {
    primitives.push(textPrimitive({
      context,
      id: "headline:title",
      text: title,
      x: HORIZONTAL_MARGIN_PT,
      baselineY: geometry.titleBaselinePt,
      colorRole: "title in head/foot",
      fontRole: "headline",
    }));
  }
  if (context.navigation.currentSection) {
    primitives.push(textPrimitive({
      context,
      id: "headline:section",
      text: context.navigation.currentSection.title,
      x: HORIZONTAL_MARGIN_PT + SMOOTH_TREE_SECTION_INDENT_PT,
      baselineY: geometry.sectionBaselinePt,
      colorRole: "section in head/foot",
      fontRole: "section-in-head-foot",
    }));
  }
  if (context.navigation.currentSubsection) {
    primitives.push(textPrimitive({
      context,
      id: "headline:subsection",
      text: context.navigation.currentSubsection.title,
      x: HORIZONTAL_MARGIN_PT + SMOOTH_TREE_SUBSECTION_INDENT_PT,
      baselineY: geometry.subsectionBaselinePt,
      colorRole: "subsection in head/foot",
      fontRole: "subsection-in-head-foot",
    }));
  }
  return {
    inset: geometry.headlineInsetPt,
    primitives,
  };
}

export function planSmoothTreeFrameTitle(
  context: BeamerFrameTemplateContext
): BeamerChromeTemplatePlan {
  if (!context.frame.title) {
    return { inset: 0, primitives: [] };
  }
  const geometry = smoothTreeGeometry(context);
  const width = context.page.page.width - SMOOTH_TREE_FRAME_TITLE_X_PT - HORIZONTAL_MARGIN_PT;
  const measured = measureBeamerHeadingStack(context, width, { titleEnd: context.frame.subtitle ? "" : "\\strut" });
  const extra = measured ? measured.extent - context.theme.fonts["frame-title"].lineHeightPt : 0;
  return {
    inset: geometry.topInsetPt - geometry.headlineInsetPt + extra,
    primitives: [
      gradientPrimitive({
        context,
        id: "frame-title:transition",
        bounds: {
          x: 0,
          y: geometry.frameTransitionY - geometry.headlineInsetPt,
          width: context.page.page.width,
          height: geometry.frameTransitionHeightPt,
        },
        templateId: "beamer/frame-title/smooth-transition",
        layoutKind: "background",
        direction: "vertical",
        stops: [
          backgroundStop(0, "subsection in head/foot"),
          backgroundStop(1, "frametitle"),
        ],
      }),
      ...(resolveBeamerThemeColor(context.theme, "frametitle").bg ? [{
        kind: "fill" as const,
        id: `${context.frame.id}:frame-title:background`,
        sourceSpan: context.frame.title.span,
        bounds: {
          x: 0,
          y: geometry.frameBackgroundY - geometry.headlineInsetPt,
          width: context.page.page.width,
          height: geometry.frameBackgroundHeightPt + extra,
        },
        colorRole: "frametitle",
      }] : []),
      frameTitleText(
        context,
        SMOOTH_TREE_FRAME_TITLE_X_PT,
        geometry.frameTitleBaselinePt - geometry.headlineInsetPt
      ),
      ...(measured?.subtitle ? beamerSubtitlePrimitive(context, SMOOTH_TREE_FRAME_TITLE_X_PT, width,
        geometry.frameTitleBaselinePt - geometry.headlineInsetPt + measured.subtitleBaseline) : []),
      frameBottomFade(
        context,
        geometry.frameBottomFadeY - geometry.headlineInsetPt + extra,
        geometry.fadeHeightPt
      ),
    ],
  };
}

export function planShadowHeadline(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  const split = planSplitHeadline(context, ref);
  const shadowTop = split.inset;
  return {
    inset: split.inset + SHADOW_HEADLINE_EXTRA_INSET_PT,
    primitives: [
      ...split.primitives,
      gradientPrimitive({
        context,
        id: "headline:shadow",
        bounds: {
          x: 0,
          y: shadowTop,
          width: context.page.page.width,
          height: SHADOW_FADE_HEIGHT_PT,
        },
        templateId: "beamer/headline/shadow-fade",
        layoutKind: "headline-decoration",
        direction: "vertical",
        stops: [
          foregroundStop(0, "normal text", 0.3),
          foregroundStop(1, "normal text", 0),
        ],
      }),
    ],
  };
}

export function planShadowFrameTitle(
  context: BeamerFrameTemplateContext
): BeamerChromeTemplatePlan {
  if (!context.frame.title) {
    return { inset: 0, primitives: [] };
  }
  const shadow = shadowFrameTitleGeometry(context);
  const width = context.page.page.width - SHADOW_FRAME_TITLE_X_PT - HORIZONTAL_MARGIN_PT;
  const measured = measureBeamerHeadingStack(context, width, { subtitleStart: "" });
  const extra = measured ? measured.extent - context.theme.fonts["frame-title"].lineHeightPt : 0;
  return {
    inset: shadow.insetPt + extra,
    primitives: [
      gradientPrimitive({
        context,
        id: "frame-title:shadow",
        bounds: {
          x: 0,
          y: shadow.heightPt + extra - 4,
          width: context.page.page.width,
          height: SHADOW_FADE_HEIGHT_PT,
        },
        templateId: "beamer/frame-title/shadow-fade",
        layoutKind: "headline-decoration",
        direction: "vertical",
        stops: [
          foregroundStop(0, "normal text", 1),
          foregroundStop(1, "normal text", 0),
        ],
      }),
      gradientPrimitive({
        context,
        // The PGF horizontal shading is clipped to the title box but its
        // shipped rule spans `\paperheight`; it is visual chrome rather than
        // a structurally comparable colorbox rectangle.
        id: "frame-title:shade",
        bounds: {
          x: 0,
          y: -2,
          width: context.page.page.width,
          height: shadow.heightPt + extra + 2,
        },
        templateId: "beamer/frame-title/shadow-shade",
        layoutKind: "frame-title",
        direction: "horizontal",
        stops: [
          backgroundStop(0, "frametitle"),
          backgroundStop(1, "frametitle right"),
        ],
      }),
      frameTitleText(
        context,
        SHADOW_FRAME_TITLE_X_PT,
        shadow.baselinePt
      ),
      ...(measured?.subtitle ? beamerSubtitlePrimitive(context, SHADOW_FRAME_TITLE_X_PT, width,
        shadow.baselinePt + measured.subtitleBaseline) : []),

    ],
  };
}

function frameTitleText(
  context: BeamerFrameTemplateContext,
  x: number,
  baselineY: number
): BeamerTemplatePrimitive {
  if (!context.frame.title) {
    throw new Error("A frame-title primitive requires source title text.");
  }
  return {
    kind: "text",
    id: `${context.frame.id}:frame-title:text`,
    sourceSpan: context.frame.title.contentSpan,
    bounds: {
      x,
      y: 0,
      width: context.page.page.width - x - HORIZONTAL_MARGIN_PT,
      height: context.theme.fonts["frame-title"].lineHeightPt,
    },
    source: { kind: "mapped", value: context.frame.title },
    fontRole: "frame-title",
    colorRole: "frametitle",
    alignment: "left",
    verticalAlignment: "top",
    baselineY,
  };
}

function frameBottomFade(
  context: BeamerFrameTemplateContext,
  y: number,
  heightPt: number
): BeamerTemplatePrimitive {
  return gradientPrimitive({
    context,
    id: "frame-title:fade",
    bounds: {
      x: 0,
      y,
      width: context.page.page.width,
      height: heightPt,
    },
    templateId: "beamer/frame-title/smooth-fade",
    layoutKind: "headline-decoration",
    direction: "vertical",
    stops: [
      backgroundStop(0, "frametitle", 0.35),
      backgroundStop(1, "frametitle", 0),
    ],
  });
}

function textPrimitive(params: {
  context: BeamerFrameTemplateContext;
  id: string;
  text: BeamerDelimitedSourceValue;
  x: number;
  baselineY: number;
  colorRole: string;
  fontRole:
    | "headline"
    | "section-in-head-foot"
    | "subsection-in-head-foot";
}): BeamerTemplatePrimitive {
  return {
    kind: "text",
    id: `${params.context.frame.id}:${params.id}`,
    sourceSpan: params.text.contentSpan,
    bounds: {
      x: params.x,
      y: 0,
      width:
        params.context.page.page.width -
        params.x -
        HORIZONTAL_MARGIN_PT,
      height: params.context.theme.fonts[params.fontRole].lineHeightPt,
    },
    source: { kind: "mapped", value: params.text },
    fontRole: params.fontRole,
    colorRole: params.colorRole,
    alignment: "left",
    verticalAlignment: "top",
    baselineY: params.baselineY,
  };
}

function metadataValue(
  context: BeamerFrameTemplateContext,
  field: "title"
): BeamerDelimitedSourceValue | undefined {
  const metadata = context.document.preamble.metadata[field];
  return metadata?.shortValue ?? metadata?.value;
}
