import { texLength } from "../../text/tex/coordinates.js";
import { createBeamerTexTextFontProfile } from "./font.js";
import { requireDefined } from "../../utils/invariants.js";
import type {
  BeamerChromeTemplatePlan,
  BeamerFrameChromePlan,
  BeamerFrameTemplateContext,
  BeamerTemplatePrimitive,
  BeamerThemeTemplateRef,
} from "./types.js";
import { planBeamerNavigationSymbols } from "./navigation-symbols.js";
import { isBlankBeamerFrameHeading } from "../frame-headings.js";
import { resolveBeamerThemeColor } from "./resolve.js";
import {
  planMiniFramesFootline,
  planMiniFramesHeadline,
  planSplitFootline,
  planSplitHeadline,
  planTreeHeadline,
} from "./navigation-templates.js";
import {
  planShadowFrameTitle,
  planShadowHeadline,
  planSmoothBarsFrameTitle,
  planSmoothBarsHeadline,
  planSmoothTreeFrameTitle,
  planSmoothTreeHeadline,
} from "./smooth-navigation-templates.js";
import {
  planSidebarCanvas,
  planSidebarFrameTitle,
  planSidebarHeadline,
  planSidebarPageDecoration,
} from "./sidebar-templates.js";

// Stock sep=0.3cm after TeX dimension scanning (559409sp).
const DEFAULT_FRAME_TITLE_SEP_PT = 559409 / 65_536;
// beamerouterthemedefault.sty paints the frametitle color box, while
// beamerbaseframe.sty adds a separate 0.25em skip to the frame-title box.
// Keep those dimensions separate: only the former is colored.
const DEFAULT_FRAME_TITLE_PAINT_HEIGHT_PT = 27.684661865234375;
// With an empty frame-title background, beamercolorbox retains only its
// natural strut/text box instead of the full colored box extent.
const EMPTY_BACKGROUND_FRAME_TITLE_HEIGHT_PT = 1_254_933 / 65_536;
const DEFAULT_FRAME_TITLE_TRAILING_SKIP_EM = 0.25;
const DEFAULT_FRAME_TITLE_TEXT_TOP_PT = 10.148712158203125;
const DEFAULT_FRAME_TITLE_BASELINE_PT = 20.142303466796875;
// When the frame-title color has no background, the default template omits
// `\nointerlineskip`; TeX therefore inserts its 1pt `\lineskip` before the
// color box.
const EMPTY_BACKGROUND_FRAME_TITLE_LINE_SKIP_PT = 1;
// beamerouterthemeinfolines.sty: ht=2.25ex,dp=1ex. The 4pt reserve added by
// beamerbaseframecomponents.sty belongs to \footheight, not the painted boxes.
// beamerouterthemeinfolines.sty: ht=2.65ex,dp=1.5ex at the 6pt
// `tiny structure` headline font.
const INFOLINES_HEADLINE_PAINT_HEIGHT_PT = 11.055587768554688;
const INFOLINES_HEADLINE_BASELINE_PT = 7.0595855712890625;
const BEAMER_FOOTLINE_RESERVE_PT = 4;
// The Infolines template uses leftskip=2ex,rightskip=2ex at its 6pt footline
// font. This is the LuaLaTeX/Latin Modern Sans 8 ex measured in TeX points.
const INFOLINES_FOOTLINE_EX_PT = 2.6674957275390625;

type FrameTitlePlanner = (
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
) => BeamerChromeTemplatePlan;

type EdgePlanner = (
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
) => BeamerChromeTemplatePlan;

const frameTitlePlanners = new Map<string, FrameTitlePlanner>([
  ["beamer/frame-title/default", planDefaultFrameTitle],
  ["beamer/frame-title/sidebar", planSidebarFrameTitle],
  ["beamer/frame-title/smoothbars", planSmoothBarsFrameTitle],
  ["beamer/frame-title/smoothtree", planSmoothTreeFrameTitle],
  ["beamer/frame-title/shadow", planShadowFrameTitle],
  ["beamer/frame-title/metropolis", planModernFrameTitle],
  ["beamer/frame-title/moloch", planModernFrameTitle],
]);

const sidebarPlanners = new Map<string, EdgePlanner>([
  ["beamer/sidebar/none", emptyEdge],
  ["beamer/sidebar/canvas", planSidebarCanvas],
  ["beamer/sidebar/navigation", planSidebarPageDecoration],
]);

const headlinePlanners = new Map<string, EdgePlanner>([
  ["beamer/headline/none", emptyEdge],
  ["beamer/headline/sidebar", planSidebarHeadline],
  ["beamer/headline/infolines", planInfolinesHeadline],
  ["beamer/headline/tree", planTreeHeadline],
  ["beamer/headline/split", planSplitHeadline],
  ["beamer/headline/miniframes", planMiniFramesHeadline],
  ["beamer/headline/smoothbars", planSmoothBarsHeadline],
  ["beamer/headline/smoothtree", planSmoothTreeHeadline],
  ["beamer/headline/shadow", planShadowHeadline],
  ["beamer/headline/metropolis-progress", planModernHeadline],
  ["beamer/headline/moloch-progress", planModernHeadline],
]);

const footlinePlanners = new Map<string, EdgePlanner>([
  ["beamer/footline/none", emptyFootline],
  ["beamer/footline/infolines", planInfolinesFootline],
  ["beamer/footline/split", planSplitFootline],
  ["beamer/footline/miniframes", planMiniFramesFootline],
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
  // \frametitle ignores blank arguments instead of constructing an empty
  // strut/colorbox. Keep the authored value in the document/edit model.
  if (context.frame.title && isBlankBeamerFrameHeading(context.document.source, context.frame.title)) {
    const frame = { ...context.frame };
    delete frame.title;
    context = { ...context, frame };
  }
  const sidebar = getPlanner(
    sidebarPlanners,
    context.theme.templates.sidebar
  )(context, context.theme.templates.sidebar);
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
  const footlinePaintTopY = footline.primitives.length > 0
    ? Math.min(...footline.primitives.map((primitive) => primitive.bounds.y))
    : context.page.page.height;
  const navigationSymbols = planBeamerNavigationSymbols(
    context,
    footlinePaintTopY
  );

  return {
    topInset: headline.inset + frameTitle.inset,
    headlineInset: headline.inset,
    frameTitleInset: frameTitle.inset,
    bottomInset: footline.inset,
    // Plain frames use the empty page style. Keep the document's measured
    // chrome insets available to continuation splitting, but suppress its
    // headline, footline, sidebar and navigation paint.
    primitives: context.frame.options?.plain ? frameTitle.primitives : [
      ...sidebar.primitives,
      ...navigationSymbols,
      ...headline.primitives,
      ...offsetPrimitives(frameTitle.primitives, 0, headline.inset),
      ...footline.primitives,
    ],
  };
}

function planDefaultFrameTitle(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  if (!context.frame.title) {
    return { inset: 0, primitives: [] };
  }
  // beamerouterthemedefault.sty: beamercolorbox sep=0.3cm and width
  // textwidth + both Beamer margins. The painted vertical extent is locked to
  // the LuaLaTeX oracle until TeX strut/glue execution is shared here.
  const background = resolveBeamerThemeColor(
    context.theme,
    "frametitle"
  ).bg;
  const titleFont = context.theme.fonts["frame-title"];
  const subtitleFont = context.theme.fonts["frame-subtitle"];
  const hasSubtitle = context.frame.subtitle != null &&
    !isBlankBeamerFrameHeading(context.document.source, context.frame.subtitle);
  // The default template emits two paragraphs with their font-specific
  // struts. TeX inserts \lineskip when the subtitle's baseline glue would
  // be negative (18pt title strut, 11pt subtitle strut at stock 11pt size).
  let subtitleBaselineAdvance = 0.3 * titleFont.lineHeightPt +
    Math.max(1, subtitleFont.lineHeightPt - 0.3 * titleFont.lineHeightPt - 0.7 * subtitleFont.lineHeightPt) +
    0.7 * subtitleFont.lineHeightPt;
  let subtitleExtent = hasSubtitle
    ? subtitleBaselineAdvance + 0.3 * subtitleFont.lineHeightPt - 0.3 * titleFont.lineHeightPt
    : 0;
  let paintHeight = (background
    ? DEFAULT_FRAME_TITLE_PAINT_HEIGHT_PT
    : EMPTY_BACKGROUND_FRAME_TITLE_HEIGHT_PT) + subtitleExtent;
  let leadingLineSkip = background
    ? 0
    : EMPTY_BACKGROUND_FRAME_TITLE_LINE_SKIP_PT;
  let titleBaseline = DEFAULT_FRAME_TITLE_BASELINE_PT;
  const width = context.page.frameArea.width - 2 * DEFAULT_FRAME_TITLE_SEP_PT;
  const measured = context.measureFrameHeading?.(context.frame.title, "frame-title", width);
  if (measured) {
    const firstAdvance = measured.baselineSkip - measured.firstHeight >= 0
      ? measured.baselineSkip : measured.firstHeight + 1;
    titleBaseline = DEFAULT_FRAME_TITLE_SEP_PT - measured.xHeight + firstAdvance;
    let materialExtent = firstAdvance + measured.extent - measured.firstHeight;
    if (hasSubtitle) {
      const subtitle = context.measureFrameHeading?.(requireDefined(context.frame.subtitle, "Expected an internal templates value"), "frame-subtitle", width);
      if (subtitle) {
        const skip = subtitle.baselineSkip - measured.endingDepth - subtitle.firstHeight;
        const glue = skip >= 0 ? skip : 1;
        subtitleBaselineAdvance = materialExtent + glue + subtitle.firstHeight - firstAdvance;
        subtitleExtent = glue + subtitle.extent;
        materialExtent += subtitleExtent;
      }
    }
    // colorbox's two -1ex skips and sep, plus an extra bottom sep when
    // painted. The outer empty vbox inserts ordinary interline glue unless
    // the template's background activates \nointerlineskip.
    paintHeight = materialExtent - 2 * measured.xHeight + DEFAULT_FRAME_TITLE_SEP_PT * (background ? 2 : 1);
    const outerSkip = titleFont.lineHeightPt - paintHeight;
    leadingLineSkip = background ? 0 : outerSkip >= 0 ? outerSkip : 1;
  }
  const inset = leadingLineSkip + paintHeight +
    DEFAULT_FRAME_TITLE_TRAILING_SKIP_EM *
      // `\beamer@frametitlebox` has ended when beamerbaseframe.sty emits
      // `\vskip0.25em`, so TeX evaluates this em in the restored body font.
      context.theme.fonts["normal-text"].sizePt;
  return {
    inset,
    primitives: [
      ...(background
        ? [{
            kind: "fill" as const,
            id: `${context.frame.id}:frame-title:background`,
            sourceSpan: context.frame.title.span,
            bounds: {
              x: context.page.frameArea.x,
              y: 0,
              width: context.page.frameArea.width,
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
          x: context.page.frameArea.x + DEFAULT_FRAME_TITLE_SEP_PT,
          y: DEFAULT_FRAME_TITLE_TEXT_TOP_PT,
          width:
            context.page.frameArea.width -
            2 * DEFAULT_FRAME_TITLE_SEP_PT,
          height: context.theme.fonts["frame-title"].lineHeightPt,
        },
        source: {
          kind: "mapped",
          value: context.frame.title,
        },
        fontRole: "frame-title",
        colorRole: "frametitle",
        alignment:
          ref.options.alignment === "center"
            ? "center"
            : ref.options.alignment === "right"
              ? "right"
              : "left",
        verticalAlignment: "top",
        // The template inserts a strut, so the baseline is independent of
        // whether this particular title contains a tall or deep glyph.
        baselineY: titleBaseline + leadingLineSkip,
      },
      ...(hasSubtitle ? [{
        kind: "text" as const,
        id: `${context.frame.id}:frame-subtitle:text`,
        sourceSpan: requireDefined(context.frame.subtitle, "Expected an internal templates value").contentSpan,
        bounds: {
          x: context.page.frameArea.x + DEFAULT_FRAME_TITLE_SEP_PT,
          y: DEFAULT_FRAME_TITLE_TEXT_TOP_PT + subtitleBaselineAdvance,
          width: context.page.frameArea.width - 2 * DEFAULT_FRAME_TITLE_SEP_PT,
          height: subtitleFont.lineHeightPt,
        },
        source: { kind: "mapped" as const, value: requireDefined(context.frame.subtitle, "Expected an internal templates value") },
        fontRole: "frame-subtitle" as const,
        colorRole: "framesubtitle",
        alignment: ref.options.alignment === "center" ? "center" as const
          : ref.options.alignment === "right" ? "right" as const : "left" as const,
        verticalAlignment: "top" as const,
        baselineY: titleBaseline + leadingLineSkip + subtitleBaselineAdvance,
      }] : []),
    ],
  };
}

function planModernFrameTitle(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  if (!context.frame.title) {
    return { inset: 0, primitives: [] };
  }
  // Padding is assigned while the body font is active at theme load;
  // Moloch's horizontal skips are evaluated later in the title font.
  const font = context.theme.fonts["frame-title"];
  const profile = createBeamerTexTextFontProfile(font);
  const resolved = profile.resolveTextFont(profile.defaultFontState, texLength(font.sizePt), profile.metricProvider);
  const xHeight = Math.round(resolved.data.fontdimen.xheight * font.sizePt * 65536) / 65536;
  const body = context.theme.fonts["normal-text"];
  const bodyProfile = createBeamerTexTextFontProfile(body);
  const bodyResolved = bodyProfile.resolveTextFont(bodyProfile.defaultFontState, texLength(body.sizePt), bodyProfile.metricProvider);
  const padding = typeof ref.options.paddingPt === "number" ? ref.options.paddingPt : Math.round(2.2 * bodyResolved.data.fontdimen.xheight * body.sizePt * 65536) / 65536;
  const horizontalPadding = ref.id.endsWith("/moloch") ? Math.round(1.6 * xHeight * 65536) / 65536 : padding;
  const capHeight = Math.max(0, ...profile.metricProvider.shapeText("X", resolved).items.map(item => item.kind === "glyph" ? Number(item.height) + Number(item.depth) : 0));
  const measured = context.measureFrameHeading?.(context.frame.title, "frame-title", context.page.page.width - 2 * horizontalPadding,
    { start: `\\rule{0pt}{${padding + capHeight}pt}`, end: `\\rule[-${padding}pt]{0pt}{${padding}pt}` });
  const progressHeight = ref.options.progressbar === true ? 0.4 : 0;
  const height = (measured?.extent ?? font.lineHeightPt + 2 * padding) + progressHeight;
  const baselineY = measured?.firstHeight ?? padding + capHeight;
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
        x: horizontalPadding,
        y: padding,
        width: context.page.page.width - 2 * horizontalPadding,
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
      baselineY,
      justify: ref.id.endsWith("/metropolis"),
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
  return { inset: height + .25 * body.sizePt, primitives };
}

function planInfolinesFootline(
  context: BeamerFrameTemplateContext
): BeamerChromeTemplatePlan {
  // beamerouterthemeinfolines.sty: three .333333 paperwidth color boxes,
  // ht=2.25ex, dp=1ex.
  const font = context.theme.fonts.footline;
  const profile = createBeamerTexTextFontProfile(font);
  const resolved = profile.resolveTextFont(profile.defaultFontState, texLength(font.sizePt), profile.metricProvider);
  const ex = Math.round(resolved.data.fontdimen.xheight * font.sizePt * 65536) / 65536;
  const paintHeight = Math.round(2.25 * ex * 65536) / 65536 + ex;
  const inset = paintHeight + BEAMER_FOOTLINE_RESERVE_PT;
  const y = context.page.page.height - paintHeight;
  const baselineY = y +
    Math.round(2.25 * ex * 65536) / 65536;
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
      x: 2 * third + 2 * ex,
      y,
      width: third - 4 * ex,
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

function planInfolinesHeadline(
  context: BeamerFrameTemplateContext
): BeamerChromeTemplatePlan {
  const height = INFOLINES_HEADLINE_PAINT_HEIGHT_PT;
  const half = context.page.page.width / 2;
  const horizontalPadding = 2 * INFOLINES_FOOTLINE_EX_PT;
  const section = context.navigation.currentSection;
  const subsection = context.navigation.currentSubsection;
  const primitives: BeamerTemplatePrimitive[] = [
    {
      kind: "fill",
      id: `${context.frame.id}:headline:section:background`,
      sourceSpan: section?.title.span ?? context.frame.span,
      bounds: { x: 0, y: 0, width: half, height },
      colorRole: "section in head/foot",
    },
    {
      kind: "fill",
      id: `${context.frame.id}:headline:subsection:background`,
      sourceSpan: subsection?.title.span ?? context.frame.span,
      bounds: { x: half, y: 0, width: half, height },
      colorRole: "subsection in head/foot",
    },
  ];
  if (section) {
    primitives.push({
      kind: "text",
      id: `${context.frame.id}:headline:section`,
      sourceSpan: section.title.contentSpan,
      bounds: {
        x: 0,
        y: 0,
        width: half - horizontalPadding,
        height,
      },
      source: { kind: "mapped", value: section.title },
      fontRole: "section-in-head-foot",
      colorRole: "section in head/foot",
      alignment: "right",
      verticalAlignment: "center",
      baselineY: INFOLINES_HEADLINE_BASELINE_PT,
    });
  }
  if (subsection) {
    primitives.push({
      kind: "text",
      id: `${context.frame.id}:headline:subsection`,
      sourceSpan: subsection.title.contentSpan,
      bounds: {
        x: half + horizontalPadding,
        y: 0,
        width: half - horizontalPadding,
        height,
      },
      source: { kind: "mapped", value: subsection.title },
      fontRole: "subsection-in-head-foot",
      colorRole: "subsection in head/foot",
      alignment: "left",
      verticalAlignment: "center",
      baselineY: INFOLINES_HEADLINE_BASELINE_PT,
    });
  }
  return { inset: height, primitives };
}

function planModernHeadline(
  context: BeamerFrameTemplateContext
): BeamerChromeTemplatePlan {
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
): BeamerChromeTemplatePlan {
  if (ref.options.numbering === "none") {
    return { inset: 0, primitives: [] };
  }
  const moloch = ref.id === "beamer/footline/moloch";
  const footFont = context.theme.fonts.footline;
  const numberFont = context.theme.fonts["page-number"];
  const metrics = (font: typeof footFont) => {
    const profile = createBeamerTexTextFontProfile(font);
    return profile.resolveTextFont(profile.defaultFontState, texLength(font.sizePt), profile.metricProvider);
  };
  const foot = metrics(footFont), number = metrics(numberFont);
  const text = ref.options.numbering === "fraction"
    ? `${context.frameIndex + 1}/${context.totalFrames}` : String(context.frameIndex + 1);
  const numberHeight = Math.max(0, ...[...text].map(character =>
    (number.data.chars[String(character.codePointAt(0))]?.height ?? 0) * numberFont.sizePt));
  const numberDepth = Math.max(0, ...[...text].map(character =>
    (number.data.chars[String(character.codePointAt(0))]?.depth ?? 0) * numberFont.sizePt));
  // sep=3ex is evaluated before and after selecting the page-number font.
  const before = moloch ? 0 : 3 * foot.data.fontdimen.xheight * footFont.sizePt;
  const after = moloch ? 4 : 3 * number.data.fontdimen.xheight * numberFont.sizePt;
  const height = before + numberHeight + numberDepth + after + BEAMER_FOOTLINE_RESERVE_PT;
  const rightSkip = moloch ? 5 : before;
  return {
    inset: height,
    primitives: [{
      kind: "text", id: `${context.frame.id}:footline:number`, sourceSpan: context.frame.span,
      bounds: { x: 0, y: context.page.page.height - height, width: context.page.page.width - rightSkip, height },
      source: { kind: "derived", text, sourceSpan: context.frame.span },
      fontRole: "page-number", colorRole: "normal text", alignment: "right", verticalAlignment: "top",
      baselineY: context.page.page.height - after - numberDepth,
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

function emptyEdge(): BeamerChromeTemplatePlan {
  return { inset: 0, primitives: [] };
}

function emptyFootline(): BeamerChromeTemplatePlan {
  // beamerbaseframecomponents.sty reserves 4pt even when the footline
  // template's measured box is empty.
  return { inset: BEAMER_FOOTLINE_RESERVE_PT, primitives: [] };
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
    ...(primitive.kind === "vector"
      ? {
          shapes: primitive.shapes.map((shape) => {
            if (shape.kind === "rect") {
              return { ...shape, x: shape.x + dx, y: shape.y + dy };
            }
            if (shape.kind === "circle") {
              return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
            }
            return {
              ...shape,
              commands: shape.commands.map((command) => {
                if (command.kind === "close") {
                  return command;
                }
                if (command.kind === "cubic") {
                  return {
                    ...command,
                    control1X: command.control1X + dx,
                    control1Y: command.control1Y + dy,
                    control2X: command.control2X + dx,
                    control2Y: command.control2Y + dy,
                    x: command.x + dx,
                    y: command.y + dy,
                  };
                }
                return {
                  ...command,
                  x: command.x + dx,
                  y: command.y + dy,
                };
              }),
            };
          }),
        }
      : {}),
    ...(primitive.kind === "text" && primitive.baselineY != null
      ? { baselineY: primitive.baselineY + dy }
      : {}),
  }));
}
