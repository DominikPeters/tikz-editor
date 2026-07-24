import type { BeamerDelimitedSourceValue } from "../types.js";
import {
  appendMiniFrameSections,
  planSplitHeadline,
} from "./navigation-templates.js";
import type {
  BeamerChromeTemplatePlan,
  BeamerFrameTemplateContext,
  BeamerTemplatePrimitive,
  BeamerThemeTemplateRef,
} from "./types.js";

// TeX Live 2025 source contracts:
// - beamerouterthemesmoothbars.sty declares the compressed section strip,
//   optional subsection row, and its paired shaded frame-title template.
// - beamerouterthemesmoothtree.sty uses the same fade construction around a
//   title/section/subsection tree.
// - beamerouterthemeshadow.sty loads `split`, appends a 2pt-deep headline
//   shadow, and replaces only the frame-title template.
//
// The exact boxes below are the resulting 11pt-class LuaLaTeX/Latin Modern
// page coordinates. Keeping them in the template module preserves the
// source-owned overlap/protrusion behavior without teaching frame composition
// about aggregate theme names.
const SMOOTH_BARS_WITH_SUBSECTION = {
  headlineInsetPt: 24.242401,
  headlinePaintHeightPt: 23.310013,
  sectionBaselinePt: 5.860809,
  subsectionBaselinePt: 21.51181,
  headlineFadeY: 23.176819,
  frameTransitionY: 23.603012,
  frameTransitionHeightPt: 2.664001,
  frameBackgroundY: 26.027267,
  frameBackgroundHeightPt: 19.465195,
  frameTitleBaselinePt: 39.959213,
  frameBottomFadeY: 45.359268,
  topInsetPt: 50.760454,
} as const;

const SMOOTH_BARS_WITHOUT_SUBSECTION = {
  // With no subsection row the headline is an overfull box: \headheight is
  // 6.260406pt and \headdp is 9.990005pt. A frame title overlaps that depth,
  // while a title-page frame must reserve the full box.
  headlineInsetPt: 16.250412,
  headlinePaintHeightPt: 15.984009,
  sectionBaselinePt: 6.260406,
  headlineFadeY: 15.850815,
  frameTransitionY: 12.947021,
  frameTransitionHeightPt: 5.328003,
  frameBackgroundY: 18.035278,
  frameBackgroundHeightPt: 19.465195,
  frameTitleBaselinePt: 31.967224,
  frameBottomFadeY: 37.367279,
  topInsetPt: 42.76846,
} as const;

const SMOOTH_TREE = {
  headlineInsetPt: 25.041611,
  headlinePaintHeightPt: 24.642014,
  titleBaselinePt: 5.79422,
  sectionBaselinePt: 14.452209,
  subsectionBaselinePt: 23.110199,
  headlineFadeY: 24.50882,
  frameTransitionY: 24.322327,
  frameTransitionHeightPt: 2.664001,
  frameBackgroundY: 26.986328,
  frameBackgroundHeightPt: 20.203262,
  frameTitleBaselinePt: 41.789536,
  frameBottomFadeY: 46.656799,
  topInsetPt: 52.057985,
} as const;

const SHADOW_HEADLINE_EXTRA_INSET_PT = 2;
const SHADOW_FADE_HEIGHT_PT = 8;
const SHADOW_FRAME_TITLE_HEIGHT_PT = 18.604858;
const SHADOW_FRAME_TITLE_BASELINE_PT = 13.204804;
const SHADOW_FRAME_TITLE_INSET_PT = 19.342059;
const HORIZONTAL_MARGIN_PT = 8.5359039306640625;
const SMOOTH_TREE_SECTION_INDENT_PT = 6;
const SMOOTH_TREE_SUBSECTION_INDENT_PT = 12;
const SMOOTH_TREE_FRAME_TITLE_X_PT = 26.603256;
const SHADOW_FRAME_TITLE_X_PT = 13.230301;
const FADE_HEIGHT_PT = 2.664001;

export function planSmoothBarsHeadline(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  const subsection = ref.options.subsection !== false;
  const geometry = subsection
    ? SMOOTH_BARS_WITH_SUBSECTION
    : SMOOTH_BARS_WITHOUT_SUBSECTION;
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
        height: FADE_HEIGHT_PT,
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
      miniFrameCenterY: geometry.sectionBaselinePt + 3.8,
      miniFrameIndexing: "global",
    }
  );
  if (subsection && context.navigation.currentSubsection) {
    const title = context.navigation.currentSubsection.title;
    primitives.push(textPrimitive({
      context,
      id: "headline:subsection",
      text: title,
      x: HORIZONTAL_MARGIN_PT,
      baselineY: SMOOTH_BARS_WITH_SUBSECTION.subsectionBaselinePt,
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
  const geometry = subsection
    ? SMOOTH_BARS_WITH_SUBSECTION
    : SMOOTH_BARS_WITHOUT_SUBSECTION;
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
  return {
    inset: geometry.topInsetPt - geometry.headlineInsetPt,
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
      {
        kind: "fill",
        id: `${context.frame.id}:frame-title:background`,
        sourceSpan: context.frame.title.span,
        bounds: {
          x: 0,
          y: geometry.frameBackgroundY - geometry.headlineInsetPt,
          width: context.page.page.width,
          height: geometry.frameBackgroundHeightPt,
        },
        colorRole: "frametitle",
      },
      frameTitleText(
        context,
        HORIZONTAL_MARGIN_PT,
        geometry.frameTitleBaselinePt - geometry.headlineInsetPt
      ),
      frameBottomFade(
        context,
        geometry.frameBottomFadeY - geometry.headlineInsetPt
      ),
    ],
  };
}

export function planSmoothTreeHeadline(
  context: BeamerFrameTemplateContext
): BeamerChromeTemplatePlan {
  const primitives: BeamerTemplatePrimitive[] = [
    gradientPrimitive({
      context,
      id: "headline:smoothtree:shade",
      bounds: {
        x: 0,
        y: 0,
        width: context.page.page.width,
        height: SMOOTH_TREE.headlinePaintHeightPt,
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
        y: SMOOTH_TREE.headlineFadeY,
        width: context.page.page.width,
        height: FADE_HEIGHT_PT,
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
      baselineY: SMOOTH_TREE.titleBaselinePt,
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
      baselineY: SMOOTH_TREE.sectionBaselinePt,
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
      baselineY: SMOOTH_TREE.subsectionBaselinePt,
      colorRole: "subsection in head/foot",
      fontRole: "subsection-in-head-foot",
    }));
  }
  return {
    inset: SMOOTH_TREE.headlineInsetPt,
    primitives,
  };
}

export function planSmoothTreeFrameTitle(
  context: BeamerFrameTemplateContext
): BeamerChromeTemplatePlan {
  if (!context.frame.title) {
    return { inset: 0, primitives: [] };
  }
  return {
    inset: SMOOTH_TREE.topInsetPt - SMOOTH_TREE.headlineInsetPt,
    primitives: [
      gradientPrimitive({
        context,
        id: "frame-title:transition",
        bounds: {
          x: 0,
          y: SMOOTH_TREE.frameTransitionY - SMOOTH_TREE.headlineInsetPt,
          width: context.page.page.width,
          height: SMOOTH_TREE.frameTransitionHeightPt,
        },
        templateId: "beamer/frame-title/smooth-transition",
        layoutKind: "background",
        direction: "vertical",
        stops: [
          backgroundStop(0, "subsection in head/foot"),
          backgroundStop(1, "frametitle"),
        ],
      }),
      {
        kind: "fill",
        id: `${context.frame.id}:frame-title:background`,
        sourceSpan: context.frame.title.span,
        bounds: {
          x: 0,
          y: SMOOTH_TREE.frameBackgroundY - SMOOTH_TREE.headlineInsetPt,
          width: context.page.page.width,
          height: SMOOTH_TREE.frameBackgroundHeightPt,
        },
        colorRole: "frametitle",
      },
      frameTitleText(
        context,
        SMOOTH_TREE_FRAME_TITLE_X_PT,
        SMOOTH_TREE.frameTitleBaselinePt - SMOOTH_TREE.headlineInsetPt
      ),
      frameBottomFade(
        context,
        SMOOTH_TREE.frameBottomFadeY - SMOOTH_TREE.headlineInsetPt
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
  return {
    inset: SHADOW_FRAME_TITLE_INSET_PT,
    primitives: [
      gradientPrimitive({
        context,
        // The PGF horizontal shading is clipped to the title box but its
        // shipped rule spans `\paperheight`; it is visual chrome rather than
        // a structurally comparable colorbox rectangle.
        id: "frame-title:shade",
        bounds: {
          x: 0,
          y: 0,
          width: context.page.page.width,
          height: SHADOW_FRAME_TITLE_HEIGHT_PT,
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
        SHADOW_FRAME_TITLE_BASELINE_PT
      ),
      gradientPrimitive({
        context,
        id: "frame-title:shadow",
        bounds: {
          x: 0,
          y: SHADOW_FRAME_TITLE_HEIGHT_PT - 4,
          width: context.page.page.width,
          height: SHADOW_FADE_HEIGHT_PT,
        },
        templateId: "beamer/frame-title/shadow-fade",
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
  y: number
): BeamerTemplatePrimitive {
  return gradientPrimitive({
    context,
    id: "frame-title:fade",
    bounds: {
      x: 0,
      y,
      width: context.page.page.width,
      height: FADE_HEIGHT_PT,
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

function gradientPrimitive(params: {
  context: BeamerFrameTemplateContext;
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  templateId: string;
  layoutKind: Extract<
    BeamerTemplatePrimitive,
    { kind: "vector" }
  >["layoutKind"];
  direction: "horizontal" | "vertical";
  stops: readonly {
    offset: number;
    colorRole: string;
    paint: "foreground" | "background";
    opacity?: number;
  }[];
}): BeamerTemplatePrimitive {
  return {
    kind: "vector",
    id: `${params.context.frame.id}:${params.id}`,
    sourceSpan: params.context.frame.span,
    bounds: params.bounds,
    templateId: params.templateId,
    layoutKind: params.layoutKind,
    shapes: [{
      kind: "rect",
      ...params.bounds,
      fillGradient: {
        direction: params.direction,
        stops: params.stops,
      },
    }],
  };
}

function backgroundStop(
  offset: number,
  colorRole: string,
  opacity?: number
) {
  return {
    offset,
    colorRole,
    paint: "background" as const,
    ...(opacity == null ? {} : { opacity }),
  };
}

function foregroundStop(
  offset: number,
  colorRole: string,
  opacity?: number
) {
  return {
    offset,
    colorRole,
    paint: "foreground" as const,
    ...(opacity == null ? {} : { opacity }),
  };
}

function metadataValue(
  context: BeamerFrameTemplateContext,
  field: "title"
): BeamerDelimitedSourceValue | undefined {
  const metadata = context.document.preamble.metadata[field];
  return metadata?.shortValue ?? metadata?.value;
}
