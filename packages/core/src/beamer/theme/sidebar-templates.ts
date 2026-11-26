import { measureBeamerHeadingStack, beamerSubtitlePrimitive } from "./heading-layout.js";
import { resolveBeamerThemeColor } from "./resolve.js";
import { texLength } from "../../text/tex/coordinates.js";
import type { BeamerDelimitedSourceValue } from "../types.js";
import { createBeamerTexTextFontProfile } from "./font.js";
import { beamerExMultiple, beamerFontExPt } from "./font-metrics.js";
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
  const author = metadataValue(context, "author");
  const measure = (value: BeamerDelimitedSourceValue | undefined, role: "title-in-sidebar" | "author-in-sidebar") => {
    if (!value?.value.trim()) return { firstHeight: 0, extent: 0, endingDepth: 0 };
    const font = context.theme.fonts[role];
    return context.measureSidebarMetadata?.(value, role, Math.max(0, width - 6)) ?? {
      firstHeight: .7 * font.lineHeightPt,
      extent: wrappedLineCount(context, value, role, Math.max(0, width - 6)) * font.lineHeightPt,
      endingDepth: .3 * font.lineHeightPt,
    };
  };
  const titleMetrics = measure(title, "title-in-sidebar");
  const authorMetrics = measure(author, "author-in-sidebar");
  const titleFont = context.theme.fonts["title-in-sidebar"];
  const authorFont = context.theme.fonts["author-in-sidebar"];
  const titleBaseline = headHeight + 1.5 * titleFont.sizePt + titleMetrics.firstHeight;
  const authorBaseline = headHeight + 1.5 * titleFont.sizePt + titleMetrics.extent + 1.25 * titleFont.sizePt +
    Math.max(1, authorFont.lineHeightPt - titleMetrics.endingDepth - authorMetrics.firstHeight) + authorMetrics.firstHeight;
  if (title) {
    primitives.push(sidebarText({
      context,
      id: "sidebar:title",
      text: title,
      x: x + 3,
      width: Math.max(0, width - 6),
      baselineY: titleBaseline,
      colorRole: "title in sidebar",
      fontRole: "title-in-sidebar",
      alignment: "center",
    }));
  }
  if (author?.value.trim()) primitives.push(sidebarText({ context, id: "sidebar:author", text: author,
    x: x + 3, width: Math.max(0, width - 6), baselineY: authorBaseline,
    colorRole: "author in sidebar", fontRole: "author-in-sidebar", alignment: "center" }));

  const hideAllSubsections = ref.options.hideAllSubsections === true;
  const hideOtherSubsections = ref.options.hideOtherSubsections === true;
  const sectionFont = context.theme.fonts["section-in-sidebar"];
  const subsectionFont = context.theme.fonts["subsection-in-sidebar"];
  const sectionEx = beamerFontExPt(sectionFont);
  const subsectionEx = beamerFontExPt(subsectionFont);
  // \beamer@sidebarformat: `\vbox{}`, the paragraph's first baseline one
  // baselineskip down, an empty `\vbox{}` one baselineskip below that, and
  // `\vskip-1.5ex`, so an entry reaches (baselineskip - 1.5ex) below its
  // last baseline. Sections add `\vskip1ex` above (all in the entry's own font).
  const sectionBelow = sectionFont.lineHeightPt - beamerExMultiple(1.5, sectionEx);
  const subsectionBelow = subsectionFont.lineHeightPt - beamerExMultiple(1.5, subsectionEx);
  let baselineY = authorBaseline + authorMetrics.extent - authorMetrics.firstHeight + 1.25 * authorFont.sizePt +
    beamerExMultiple(1, sectionEx) + sectionFont.lineHeightPt;
  let below = 0;
  for (const [sectionPosition, section] of context.navigation.model.sections.entries()) {
    if (sectionPosition > 0) baselineY += below + beamerExMultiple(1, sectionEx) + sectionFont.lineHeightPt;
    below = sectionBelow;
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
      baselineY += below + subsectionFont.lineHeightPt;
      below = subsectionBelow;
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
  if (!(width > 0) || !resolveBeamerThemeColor(context.theme, `sidebar ${side}`).bg) {
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
  const width = context.page.frameArea.width - 2 * FRAME_TITLE_HORIZONTAL_PADDING_PT;
  const measured = measureBeamerHeadingStack(context, width, { titleEnd: "", subtitleEnd: "" });
  // Both vfil glues share the fixed-height vbox's spare space. Wrapping
  // moves the first baseline upward by half the added paragraph extent.
  const extra = measured?.lastBaseline ?? 0;
  // The vbox to \beamer@headheight holds the strut line (ht .7, dp .3 of the
  // baselineskip), the interline glue to an empty \vbox{} (baselineskip less
  // that depth) and `\vskip-1em`, all in the frame-title font; the spare
  // height splits between the two \vfil.
  const titleFont = context.theme.fonts["frame-title"];
  const lineHeight = titleFont.lineHeightPt;
  const content = lineHeight + (lineHeight - beamerExMultiple(0.3, lineHeight)) - titleFont.sizePt;
  // \vfil has no shrink: an overfull box keeps the glue at zero.
  const absoluteBaseline = Math.max(0, headHeight - content) / 2 + beamerExMultiple(0.7, lineHeight);
  return {
    // The fixed-height title vbox cancels the separately reserved headline
    // with `\vskip-\beamer@headheight`. What is left is the trailing
    // `\vskip-.2em` of the frame-title font plus beamerbaseframe.sty's
    // `\vskip.25em` of the body font.
    inset: -beamerExMultiple(0.2, titleFont.sizePt) +
      beamerExMultiple(0.25, context.theme.fonts["normal-text"].sizePt),
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
      baselineY: absoluteBaseline - headHeight - extra / 2,
    }, ...(measured?.subtitle ? beamerSubtitlePrimitive(context,
      context.page.frameArea.x + FRAME_TITLE_HORIZONTAL_PADDING_PT, width,
      absoluteBaseline - headHeight - extra / 2 + measured.subtitleBaseline) : [])],
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
  field: "title" | "author"
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
