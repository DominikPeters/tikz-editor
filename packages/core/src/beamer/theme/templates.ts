import type {
  BeamerFrameChromePlan,
  BeamerFrameTemplateContext,
  BeamerTemplatePrimitive,
  BeamerThemeTemplateRef,
} from "./types.js";

const TEX_POINTS_PER_CM = 72.27 / 2.54;
const DEFAULT_FRAME_TITLE_SEP_PT = 0.3 * TEX_POINTS_PER_CM;
// beamerouterthemedefault.sty paints the frametitle color box, while
// beamerbaseframe.sty adds a separate 0.25em skip to the frame-title box.
// Keep those dimensions separate: only the former is colored.
const DEFAULT_FRAME_TITLE_PAINT_HEIGHT_PT = 27.684661865234375;
const DEFAULT_FRAME_TITLE_TRAILING_SKIP_EM = 0.25;
const DEFAULT_FRAME_TITLE_TEXT_TOP_PT = 10.148712158203125;
// beamerouterthemeinfolines.sty: ht=2.25ex,dp=1ex. The 4pt reserve added by
// beamerbaseframecomponents.sty belongs to \footheight, not the painted boxes.
const INFOLINES_FOOTLINE_PAINT_HEIGHT_PT = 8.658004760742188;
const BEAMER_FOOTLINE_RESERVE_PT = 4;
const LATIN_MODERN_SANS_X_HEIGHT_EM = 0.444;
// The Infolines template uses leftskip=2ex,rightskip=2ex at its 6pt footline
// font. This is the LuaLaTeX/Latin Modern Sans 8 ex measured in TeX points.
const INFOLINES_FOOTLINE_EX_PT = 2.6674957275390625;

type ChromeTemplatePlan = {
  inset: number;
  primitives: BeamerTemplatePrimitive[];
};

type FrameTitlePlanner = (
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
) => ChromeTemplatePlan;

type EdgePlanner = (
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
) => ChromeTemplatePlan;

const frameTitlePlanners = new Map<string, FrameTitlePlanner>([
  ["beamer/frame-title/default", planDefaultFrameTitle],
  ["beamer/frame-title/metropolis", planModernFrameTitle],
  ["beamer/frame-title/moloch", planModernFrameTitle],
]);

const headlinePlanners = new Map<string, EdgePlanner>([
  ["beamer/headline/none", emptyEdge],
  ["beamer/headline/infolines", planInfolinesHeadline],
  ["beamer/headline/metropolis-progress", planModernHeadline],
  ["beamer/headline/moloch-progress", planModernHeadline],
]);

const footlinePlanners = new Map<string, EdgePlanner>([
  ["beamer/footline/none", emptyEdge],
  ["beamer/footline/infolines", planInfolinesFootline],
  ["beamer/footline/metropolis", planModernFootline],
  ["beamer/footline/moloch", planModernFootline],
]);

/**
 * Plan theme chrome as generic composition primitives.
 *
 * Theme-specific planners resolve structural template behavior into fills and
 * text requests. They do not measure glyphs or emit SVG.
 */
export function planBeamerFrameChrome(
  context: BeamerFrameTemplateContext
): BeamerFrameChromePlan {
  const headline = getPlanner(
    headlinePlanners,
    context.theme.templates.headline
  )(context, context.theme.templates.headline);
  const frameTitle = getPlanner(
    frameTitlePlanners,
    context.theme.templates.frameTitle
  )(context, context.theme.templates.frameTitle);
  const footline = getPlanner(
    footlinePlanners,
    context.theme.templates.footline
  )(context, context.theme.templates.footline);

  return {
    topInset: headline.inset + frameTitle.inset,
    bottomInset: footline.inset,
    primitives: [
      ...headline.primitives,
      ...offsetPrimitives(frameTitle.primitives, 0, headline.inset),
      ...footline.primitives,
    ],
  };
}

function planDefaultFrameTitle(
  context: BeamerFrameTemplateContext
): ChromeTemplatePlan {
  if (!context.frame.title) {
    return { inset: 0, primitives: [] };
  }
  // beamerouterthemedefault.sty: beamercolorbox sep=0.3cm and width
  // textwidth + both Beamer margins. The painted vertical extent is locked to
  // the LuaLaTeX oracle until TeX strut/glue execution is shared here.
  const paintHeight = DEFAULT_FRAME_TITLE_PAINT_HEIGHT_PT;
  const inset = paintHeight +
    DEFAULT_FRAME_TITLE_TRAILING_SKIP_EM *
      // `\beamer@frametitlebox` has ended when beamerbaseframe.sty emits
      // `\vskip0.25em`, so TeX evaluates this em in the restored body font.
      context.theme.fonts["normal-text"].sizePt;
  const background = context.theme.colors.frametitle?.bg;
  return {
    inset,
    primitives: [
      ...(background
        ? [{
            kind: "fill" as const,
            id: `${context.frame.id}:frame-title:background`,
            sourceSpan: context.frame.title.span,
            bounds: {
              x: 0,
              y: 0,
              width: context.page.page.width,
              height: paintHeight,
            },
            colorRole: "frametitle",
          }]
        : []),
      {
        kind: "text",
        id: `${context.frame.id}:frame-title:text`,
        sourceSpan: context.frame.title.contentSpan,
        bounds: {
          x: DEFAULT_FRAME_TITLE_SEP_PT,
          y: DEFAULT_FRAME_TITLE_TEXT_TOP_PT,
          width: context.page.page.width - 2 * DEFAULT_FRAME_TITLE_SEP_PT,
          height: context.theme.fonts["frame-title"].lineHeightPt,
        },
        source: {
          kind: "mapped",
          value: context.frame.title,
        },
        fontRole: "frame-title",
        colorRole: "frametitle",
        alignment: "left",
        verticalAlignment: "top",
      },
    ],
  };
}

function planModernFrameTitle(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): ChromeTemplatePlan {
  if (!context.frame.title) {
    return { inset: 0, primitives: [] };
  }
  // metropolis/moloch outer themes: left/right padding 2.2ex around the
  // frametitle struts; the optional progress rule is 0.4pt.
  const font = context.theme.fonts["frame-title"];
  const padding = 2.2 * font.sizePt * 0.431;
  const progressHeight = ref.options.progressbar === true ? 0.4 : 0;
  const height = font.lineHeightPt + 2 * padding + progressHeight;
  const primitives: BeamerTemplatePrimitive[] = [
    {
      kind: "fill",
      id: `${context.frame.id}:frame-title:background`,
      sourceSpan: context.frame.title.span,
      bounds: {
        x: 0,
        y: 0,
        width: context.page.page.width,
        height: height - progressHeight,
      },
      colorRole: "frametitle",
    },
    {
      kind: "text",
      id: `${context.frame.id}:frame-title:text`,
      sourceSpan: context.frame.title.contentSpan,
      bounds: {
        x: padding,
        y: padding,
        width: context.page.page.width - 2 * padding,
        height: font.lineHeightPt,
      },
      source: {
        kind: "mapped",
        value: context.frame.title,
      },
      fontRole: "frame-title",
      colorRole: "frametitle",
      alignment: "left",
      verticalAlignment: "top",
    },
  ];
  if (progressHeight > 0) {
    const progress = (context.frameIndex + 1) / Math.max(context.totalFrames, 1);
    primitives.push(
      {
        kind: "fill",
        id: `${context.frame.id}:frame-title:progress-background`,
        sourceSpan: context.frame.span,
        bounds: {
          x: 0,
          y: height - progressHeight,
          width: context.page.page.width,
          height: progressHeight,
        },
        colorRole: "progress bar background",
      },
      {
        kind: "fill",
        id: `${context.frame.id}:frame-title:progress`,
        sourceSpan: context.frame.span,
        bounds: {
          x: 0,
          y: height - progressHeight,
          width: context.page.page.width * progress,
          height: progressHeight,
        },
        colorRole: "progress bar",
      }
    );
  }
  return { inset: height, primitives };
}

function planInfolinesFootline(
  context: BeamerFrameTemplateContext
): ChromeTemplatePlan {
  // beamerouterthemeinfolines.sty: three .333333 paperwidth color boxes,
  // ht=2.25ex, dp=1ex.
  const paintHeight = INFOLINES_FOOTLINE_PAINT_HEIGHT_PT;
  const inset = paintHeight + BEAMER_FOOTLINE_RESERVE_PT;
  const y = context.page.page.height - paintHeight;
  const baselineY = y +
    2.25 *
      LATIN_MODERN_SANS_X_HEIGHT_EM *
      context.theme.fonts.footline.sizePt;
  const third = context.page.page.width / 3;
  const primitives: BeamerTemplatePrimitive[] = [
    infolinesFill(context, 0, y, third, paintHeight, "palette tertiary", "author"),
    infolinesFill(context, third, y, third, paintHeight, "palette secondary", "title"),
    infolinesFill(context, 2 * third, y, third, paintHeight, "palette primary", "date"),
  ];
  const title = context.document.preamble.metadata.title;
  if (title) {
    primitives.push({
      kind: "text",
      id: `${context.frame.id}:footline:title`,
      sourceSpan: (title.shortValue ?? title.value).contentSpan,
      bounds: {
        x: third,
        y,
        width: third,
        height: paintHeight,
      },
      source: {
        kind: "mapped",
        value: title.shortValue ?? title.value,
      },
      fontRole: "footline",
      colorRole: "title in head/foot",
      alignment: "center",
      verticalAlignment: "center",
      baselineY,
    });
  }
  primitives.push({
    kind: "text",
    id: `${context.frame.id}:footline:number`,
    sourceSpan: context.frame.span,
    bounds: {
      x: 2 * third + 2 * INFOLINES_FOOTLINE_EX_PT,
      y,
      width: third - 4 * INFOLINES_FOOTLINE_EX_PT,
      height: paintHeight,
    },
    source: {
      kind: "derived",
      text: `${context.frameIndex + 1} / ${context.totalFrames}`,
      sourceSpan: context.frame.span,
    },
    fontRole: "footline",
    colorRole: "date in head/foot",
    alignment: "right",
    verticalAlignment: "center",
    baselineY,
    interwordSpacePt: context.theme.fonts.footline.sizePt / 6,
  });
  return { inset, primitives };
}

function planInfolinesHeadline(): ChromeTemplatePlan {
  // Kept registered because infolines itself selects this template. Aggregate
  // Madrid immediately resets headline to Beamer's default (empty) template.
  return { inset: 0, primitives: [] };
}

function planModernHeadline(
  context: BeamerFrameTemplateContext
): ChromeTemplatePlan {
  const height = 0.4;
  const progress = (context.frameIndex + 1) / Math.max(context.totalFrames, 1);
  return {
    inset: height,
    primitives: [
      {
        kind: "fill",
        id: `${context.frame.id}:headline:progress-background`,
        sourceSpan: context.frame.span,
        bounds: { x: 0, y: 0, width: context.page.page.width, height },
        colorRole: "progress bar background",
      },
      {
        kind: "fill",
        id: `${context.frame.id}:headline:progress`,
        sourceSpan: context.frame.span,
        bounds: {
          x: 0,
          y: 0,
          width: context.page.page.width * progress,
          height,
        },
        colorRole: "progress bar",
      },
    ],
  };
}

function planModernFootline(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): ChromeTemplatePlan {
  if (ref.options.numbering === "none") {
    return { inset: 0, primitives: [] };
  }
  const height = context.theme.fonts.footline.lineHeightPt * 2;
  return {
    inset: height,
    primitives: [{
      kind: "text",
      id: `${context.frame.id}:footline:number`,
      sourceSpan: context.frame.span,
      bounds: {
        x: context.page.textArea.x,
        y: context.page.page.height - height,
        width: context.page.textArea.width,
        height,
      },
      source: {
        kind: "derived",
        text: String(context.frameIndex + 1),
        sourceSpan: context.frame.span,
      },
      fontRole: "footline",
      colorRole: "normal text",
      alignment: "right",
      verticalAlignment: "center",
    }],
  };
}

function infolinesFill(
  context: BeamerFrameTemplateContext,
  x: number,
  y: number,
  width: number,
  height: number,
  colorRole: string,
  suffix: string
): BeamerTemplatePrimitive {
  return {
    kind: "fill",
    id: `${context.frame.id}:footline:${suffix}:background`,
    sourceSpan: context.frame.span,
    bounds: { x, y, width, height },
    colorRole,
  };
}

function emptyEdge(): ChromeTemplatePlan {
  return { inset: 0, primitives: [] };
}

function getPlanner<T>(
  registry: ReadonlyMap<string, T>,
  ref: BeamerThemeTemplateRef
): T {
  const planner = registry.get(ref.id);
  if (!planner) {
    throw new Error(`No Beamer structural template is registered for '${ref.id}'.`);
  }
  return planner;
}

function offsetPrimitives(
  primitives: readonly BeamerTemplatePrimitive[],
  dx: number,
  dy: number
): BeamerTemplatePrimitive[] {
  if (dx === 0 && dy === 0) {
    return [...primitives];
  }
  return primitives.map((primitive) => ({
    ...primitive,
    bounds: {
      ...primitive.bounds,
      x: primitive.bounds.x + dx,
      y: primitive.bounds.y + dy,
    },
  }));
}
