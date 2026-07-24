import { texLength } from "../../text/tex/coordinates.js";
import type { BeamerDelimitedSourceValue } from "../types.js";
import { createBeamerTexTextFontProfile } from "./font.js";
import {
  backgroundGradientStop,
  gradientRectPrimitive,
} from "./template-primitives.js";
import type {
  BeamerChromeTemplatePlan,
  BeamerFrameTemplateContext,
  BeamerTemplatePrimitive,
  BeamerThemeFontRole,
  BeamerThemeTemplateRef,
} from "./types.js";

const TEX_POINTS_PER_CM = 72.27 / 2.54;
const FRAME_TITLE_HORIZONTAL_PADDING_PT = 0.3 * TEX_POINTS_PER_CM;
const SIDEBAR_TITLE_FIRST_BASELINE_PT = 13.164001;
const SIDEBAR_TITLE_LINE_HEIGHT_PT = 7;
const SIDEBAR_FIRST_SECTION_BASELINE_PT = 44.888;
const SIDEBAR_SUBSECTION_BASELINE_STEP_PT = 8.004;
const SIDEBAR_NEXT_SECTION_BASELINE_STEP_PT = 12;
const SIDEBAR_FRAME_TITLE_ABSOLUTE_BASELINE_PT = 26.999969;
const SIDEBAR_FRAME_TITLE_INSET_PT = -0.1426;

export function planSidebarPageDecoration(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  const width = numberOption(ref, "widthPt");
  if (!(width > 0)) {
    return { inset: 0, primitives: [] };
  }
  const side = ref.options.side === "right" ? "right" : "left";
  const headHeight = numberOption(ref, "headHeightPt");
  const x = side === "right"
    ? context.page.page.width - width
    : 0;
  const canvasBounds = {
    x,
    y: headHeight,
    width,
    height: Math.max(0, context.page.page.height - headHeight),
  };
  const primitives: BeamerTemplatePrimitive[] = [
    ref.options.canvas === "vertical-gradient"
      ? gradientRectPrimitive({
          context,
          id: `sidebar:${side}:canvas`,
          bounds: canvasBounds,
          templateId: `beamer/sidebar-canvas/${side}/vertical-gradient`,
          layoutKind: "background",
          direction: "vertical",
          stops: [
            backgroundGradientStop(
              0,
              stringOption(ref, "topRole", `sidebar ${side}`)
            ),
            backgroundGradientStop(
              1,
              stringOption(ref, "bottomRole", `sidebar ${side}`)
            ),
          ],
        })
      : {
          kind: "fill",
          id: `${context.frame.id}:sidebar:${side}:background`,
          sourceSpan: context.frame.span,
          bounds: canvasBounds,
          colorRole: `sidebar ${side}`,
        },
  ];

  const title = metadataValue(context, "title");
  const titleLineCount = title
    ? wrappedLineCount(
        context,
        title,
        "title-in-sidebar",
        Math.max(0, width - 6)
      )
    : 0;
  if (title) {
    primitives.push(sidebarText({
      context,
      id: "sidebar:title",
      text: title,
      x: x + 3,
      width: Math.max(0, width - 6),
      baselineY: headHeight + SIDEBAR_TITLE_FIRST_BASELINE_PT,
      colorRole: "title in sidebar",
      fontRole: "title-in-sidebar",
      alignment: "center",
    }));
  }

  const hideAllSubsections = ref.options.hideAllSubsections === true;
  const hideOtherSubsections = ref.options.hideOtherSubsections === true;
  let baselineY =
    headHeight +
    SIDEBAR_FIRST_SECTION_BASELINE_PT +
    Math.max(0, titleLineCount - 2) * SIDEBAR_TITLE_LINE_HEIGHT_PT;
  for (const section of context.navigation.model.sections) {
    const sectionActive = section === context.navigation.currentSection;
    primitives.push(sidebarText({
      context,
      id: `sidebar:section-${section.sectionIndex}`,
      text: section.title,
      x: x + 3,
      width: Math.max(0, width - 4),
      baselineY,
      colorRole: sectionActive
        ? "section in sidebar"
        : "section in sidebar shaded",
      fontRole: "section-in-sidebar",
      alignment: "left",
    }));
    const subsections = hideAllSubsections ||
        (hideOtherSubsections && !sectionActive)
      ? []
      : section.subsections;
    for (const subsection of subsections) {
      baselineY += SIDEBAR_SUBSECTION_BASELINE_STEP_PT;
      primitives.push(sidebarText({
        context,
        id:
          `sidebar:section-${section.sectionIndex}:subsection-${subsection.subsectionIndex}`,
        text: subsection.title,
        x: x + 5,
        width: Math.max(0, width - 6),
        baselineY,
        colorRole: subsection === context.navigation.currentSubsection
          ? "subsection in sidebar"
          : "subsection in sidebar shaded",
        fontRole: "subsection-in-sidebar",
        alignment: "left",
      }));
    }
    baselineY += SIDEBAR_NEXT_SECTION_BASELINE_STEP_PT;
  }
  return { inset: 0, primitives };
}

/**
 * Paint a responsive sidebar canvas without installing navigation material.
 *
 * The in-margin inner theme uses Beamer's left sidebar register as a page
 * margin, but deliberately does not select the sidebar outer theme.
 */
export function planSidebarCanvas(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  const side = ref.options.side === "right" ? "right" : "left";
  const width = side === "right"
    ? context.page.page.width -
      (context.page.frameArea.x + context.page.frameArea.width)
    : context.page.frameArea.x;
  if (!(width > 0)) {
    return { inset: 0, primitives: [] };
  }
  return {
    inset: 0,
    primitives: [{
      kind: "fill",
      id: `${context.frame.id}:sidebar:${side}:background`,
      sourceSpan: context.frame.span,
      bounds: {
        x: side === "right" ? context.page.page.width - width : 0,
        y: 0,
        width,
        height: context.page.page.height,
      },
      colorRole: `sidebar ${side}`,
    }],
  };
}

export function planSidebarHeadline(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  const height = numberOption(ref, "headHeightPt");
  if (!(height > 0)) {
    return { inset: 0, primitives: [] };
  }
  const side = ref.options.side === "right" ? "right" : "left";
  const width = numberOption(ref, "widthPt");
  const logoX = side === "right"
    ? context.page.page.width - width
    : 0;
  return {
    inset: height,
    primitives: [
      {
        kind: "fill",
        id: `${context.frame.id}:headline:sidebar:background`,
        sourceSpan: context.frame.span,
        bounds: {
          x: 0,
          y: 0,
          width: context.page.page.width,
          height,
        },
        colorRole: "frametitle",
      },
      ...(width > 0
        ? [{
            kind: "fill" as const,
            id: `${context.frame.id}:headline:sidebar:logo-background`,
            sourceSpan: context.frame.span,
            bounds: { x: logoX, y: 0, width, height },
            colorRole: "logo",
          }]
        : []),
    ],
  };
}

export function planSidebarFrameTitle(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  if (!context.frame.title) {
    return { inset: 0, primitives: [] };
  }
  const headHeight = numberOption(ref, "headHeightPt");
  return {
    // The fixed-height title vbox cancels the separately reserved headline
    // with `\vskip-\beamer@headheight`. Its remaining strut/depth and
    // trailing `\vskip-.2em` form this slightly negative box extent.
    inset: SIDEBAR_FRAME_TITLE_INSET_PT,
    primitives: [{
      kind: "text",
      id: `${context.frame.id}:frame-title:text`,
      sourceSpan: context.frame.title.contentSpan,
      bounds: {
        x: context.page.frameArea.x + FRAME_TITLE_HORIZONTAL_PADDING_PT,
        y: -headHeight,
        width:
          context.page.frameArea.width -
          2 * FRAME_TITLE_HORIZONTAL_PADDING_PT,
        height: headHeight,
      },
      source: { kind: "mapped", value: context.frame.title },
      fontRole: "frame-title",
      colorRole: "frametitle",
      alignment: "left",
      verticalAlignment: "top",
      baselineY: SIDEBAR_FRAME_TITLE_ABSOLUTE_BASELINE_PT - headHeight,
    }],
  };
}

function sidebarText(params: {
  context: BeamerFrameTemplateContext;
  id: string;
  text: BeamerDelimitedSourceValue;
  x: number;
  width: number;
  baselineY: number;
  colorRole: string;
  fontRole: BeamerThemeFontRole;
  alignment: "left" | "center";
}): BeamerTemplatePrimitive {
  return {
    kind: "text",
    id: `${params.context.frame.id}:${params.id}`,
    sourceSpan: params.text.contentSpan,
    bounds: {
      x: params.x,
      y: 0,
      width: params.width,
      height: params.context.page.page.height,
    },
    source: { kind: "mapped", value: params.text },
    fontRole: params.fontRole,
    colorRole: params.colorRole,
    alignment: params.alignment,
    verticalAlignment: "top",
    baselineY: params.baselineY,
    disableAutomaticHyphenation: true,
  };
}

function wrappedLineCount(
  context: BeamerFrameTemplateContext,
  text: BeamerDelimitedSourceValue,
  fontRole: BeamerThemeFontRole,
  width: number
): number {
  if (!(width > 0)) {
    return 1;
  }
  const font = context.theme.fonts[fontRole];
  const profile = createBeamerTexTextFontProfile(font);
  const resolved = profile.resolveTextFont(
    profile.defaultFontState,
    texLength(font.sizePt),
    profile.metricProvider
  );
  const space = resolved.data.fontdimen.space * Number(resolved.atPt);
  let lines = 1;
  let lineWidth = 0;
  for (const word of text.value.trim().split(/\s+/u)) {
    const wordWidth = Number(
      profile.metricProvider.shapeText(word, resolved).width
    );
    const candidate = lineWidth === 0 ? wordWidth : lineWidth + space + wordWidth;
    if (lineWidth > 0 && candidate > width) {
      lines += 1;
      lineWidth = wordWidth;
    } else {
      lineWidth = candidate;
    }
  }
  return lines;
}

function metadataValue(
  context: BeamerFrameTemplateContext,
  field: "title"
): BeamerDelimitedSourceValue | undefined {
  const metadata = context.document.preamble.metadata[field];
  return metadata?.shortValue ?? metadata?.value;
}

function numberOption(
  ref: BeamerThemeTemplateRef,
  name: string
): number {
  const value = ref.options[name];
  return typeof value === "number" ? value : 0;
}

function stringOption(
  ref: BeamerThemeTemplateRef,
  name: string,
  fallback: string
): string {
  const value = ref.options[name];
  return typeof value === "string" ? value : fallback;
}
