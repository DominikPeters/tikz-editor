import type { BeamerDelimitedSourceValue } from "../types.js";
import { texLength } from "../../text/tex/coordinates.js";
import { createBeamerTexTextFontProfile } from "./font.js";
import type {
  BeamerChromeTemplatePlan,
  BeamerFrameTemplateContext,
  BeamerNavigationSectionEntry,
  BeamerTemplatePrimitive,
  BeamerThemeTemplateRef,
} from "./types.js";
import { resolveBeamerThemeColor } from "./resolve.js";

// TeX Live 2025 source contracts:
// - beamerouterthemetree.sty: three ht=2.5ex,dp=1.125ex navigation rows.
// - beamerouterthemesplit.sty: half-page section/subsection boxes and the
//   matching author/title footline.
// - beamerouterthememiniframes.sty: the section-navigation strip, optional
//   subsection row, separation lines, and four footline variants.
// All three execute inside Beamer's 6pt `headline`/`footline` font. These
// constants are the resulting 11pt-class LuaLaTeX/Latin Modern boxes from
// those ex-based templates.
const NAVIGATION_ROW_HEIGHT_PT = 9.656997680664;
const NAVIGATION_BASELINE_PT = 6.660003662109375;
const MINI_FRAMES_SECTION_HEIGHT_PT = 14.778717041015625;
const MINI_FRAMES_EMPTY_SECTION_HEIGHT_PT = 11.654998779296875;
const SPLIT_HEADLINE_HEIGHT_PT = 17.848785400390625;
const SPLIT_CENTER_BASELINE_PT = 10.173141479492188;
const SEPARATION_LINE_HEIGHT_PT = 3;
const FOOTLINE_RESERVE_PT = 4;
const HORIZONTAL_MARGIN_PT = 8.5359039306640625;
const MINI_FRAME_DIAMETER_PT = 72.27 / 2.54 * 0.1;
const MINI_FRAME_STEP_PT = 72.27 / 2.54 * 0.14;
const MINI_FRAME_STROKE_PT = 0.4;
const SINGAPORE_HEAD_FADE_HEIGHT_PT = 1.25 * 72.27 / 2.54;

export function planTreeHeadline(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  const primitives: BeamerTemplatePrimitive[] = [];
  let y = appendSeparationLine(
    primitives,
    context,
    0,
    "upper separation line head",
    "headline:upper-separation"
  );
  const title = metadataValue(context, "title");
  y = appendTreeRow({
    context,
    primitives,
    y,
    id: "title",
    text: title,
    colorRole: "title in head/foot",
    x: HORIZONTAL_MARGIN_PT,
  });
  const section = context.navigation.currentSection?.title;
  const hooks = ref.options.hooks !== false;
  y = appendTreeRow({
    context,
    primitives,
    y,
    id: "section",
    text: section,
    colorRole: "section in head/foot",
    x: HORIZONTAL_MARGIN_PT + (hooks ? 8.4 : 6),
    hook: hooks && section
      ? {
          x: HORIZONTAL_MARGIN_PT + 2,
          verticalTopOffset: -0.2349853515625,
        }
      : undefined,
  });
  const subsection = context.navigation.currentSubsection?.title;
  y = appendTreeRow({
    context,
    primitives,
    y,
    id: "subsection",
    text: subsection,
    colorRole: "subsection in head/foot",
    x: HORIZONTAL_MARGIN_PT + (hooks ? 15.8 : 12),
    hook: hooks && subsection
      ? {
          x: HORIZONTAL_MARGIN_PT + 9.4,
          verticalTopOffset: -0.2349853515625,
        }
      : undefined,
  });
  y += appendSeparationLine(
    primitives,
    context,
    y,
    "lower separation line head",
    "headline:lower-separation"
  );
  return { inset: y, primitives };
}

export function planSplitHeadline(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  const compressed = ref.options.compress === true;
  const sections = context.navigation.model.sections;
  if (!compressed && sections.length === 0) {
    return { inset: 0, primitives: [] };
  }
  const height = compressed
    ? NAVIGATION_ROW_HEIGHT_PT
    : splitHeadlineHeight(context);
  const half = context.page.page.width / 2;
  const primitives: BeamerTemplatePrimitive[] = [];
  appendBackground(
    primitives,
    context,
    "headline:section:background",
    { x: 0, y: 0, width: half, height },
    "section in head/foot"
  );
  appendBackground(
    primitives,
    context,
    "headline:subsection:background",
    { x: half, y: 0, width: half, height },
    "subsection in head/foot"
  );

  if (compressed) {
    appendHorizontalSectionTitles(context, primitives, 0, half, height);
    appendHorizontalSubsectionTitles(context, primitives, half, half, height);
  } else {
    appendVerticalNavigationTitles({
      context,
      primitives,
      entries: sections.map((entry) => ({
        id: `section-${entry.sectionIndex}`,
        title: entry.title,
        active: entry === context.navigation.currentSection,
      })),
      x: HORIZONTAL_MARGIN_PT,
      width: half - 2 * HORIZONTAL_MARGIN_PT,
      height,
      centerBaseline: splitCenterBaseline(height),
      alignment: "right",
      colorRole: "section in head/foot",
      shadedColorRole: "section in head/foot shaded",
      fontRole: "section-in-head-foot",
    });
    const subsections = context.navigation.currentSection?.subsections ?? [];
    appendVerticalNavigationTitles({
      context,
      primitives,
      entries: subsections.map((entry) => ({
        id: `subsection-${entry.subsectionIndex}`,
        title: entry.title,
        active: entry === context.navigation.currentSubsection,
      })),
      x: half + HORIZONTAL_MARGIN_PT,
      width: half - 2 * HORIZONTAL_MARGIN_PT,
      height,
      centerBaseline: splitCenterBaseline(height),
      alignment: "left",
      colorRole: "subsection in head/foot",
      shadedColorRole: "subsection in head/foot shaded",
      fontRole: "subsection-in-head-foot",
    });
  }
  return { inset: height, primitives };
}

export function planSplitFootline(
  context: BeamerFrameTemplateContext
): BeamerChromeTemplatePlan {
  const height = NAVIGATION_ROW_HEIGHT_PT;
  const y = context.page.page.height - height;
  const half = context.page.page.width / 2;
  const primitives: BeamerTemplatePrimitive[] = [];
  appendBackground(
    primitives,
    context,
    "footline:author:background",
    { x: 0, y, width: half, height },
    "author in head/foot"
  );
  appendBackground(
    primitives,
    context,
    "footline:title:background",
    { x: half, y, width: half, height },
    "title in head/foot"
  );
  appendMetadataText({
    context,
    primitives,
    field: "author",
    id: "footline:author",
    bounds: {
      x: HORIZONTAL_MARGIN_PT,
      y,
      width: half - 2 * HORIZONTAL_MARGIN_PT,
      height,
    },
    colorRole: "author in head/foot",
    alignment: "right",
    baselineY: y + NAVIGATION_BASELINE_PT,
  });
  appendMetadataText({
    context,
    primitives,
    field: "title",
    id: "footline:title",
    bounds: {
      x: half + HORIZONTAL_MARGIN_PT,
      y,
      width: half - 2 * HORIZONTAL_MARGIN_PT,
      height,
    },
    colorRole: "title in head/foot",
    alignment: "left",
    baselineY: y + NAVIGATION_BASELINE_PT,
  });
  return { inset: height + FOOTLINE_RESERVE_PT, primitives };
}

export function planMiniFramesHeadline(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  const primitives: BeamerTemplatePrimitive[] = [];
  if (ref.options.fade === true) {
    appendHeadFade(context, primitives);
  }
  let y = appendSeparationLine(
    primitives,
    context,
    0,
    "upper separation line head",
    "headline:upper-separation"
  );
  const sections = context.navigation.model.sections;
  const sectionHeight = sections.length > 0
    ? MINI_FRAMES_SECTION_HEIGHT_PT
    : MINI_FRAMES_EMPTY_SECTION_HEIGHT_PT;
  appendBackground(
    primitives,
    context,
    "headline:section:background",
    { x: 0, y, width: context.page.page.width, height: sectionHeight },
    "section in head/foot"
  );
  appendMiniFrameSections(context, primitives, y, sectionHeight, sections);
  y += sectionHeight;

  if (ref.options.subsection !== false) {
    y += appendSeparationLine(
      primitives,
      context,
      y,
      "middle separation line head",
      "headline:middle-separation"
    );
    appendBackground(
      primitives,
      context,
      "headline:subsection:background",
      {
        x: 0,
        y,
        width: context.page.page.width,
        height: NAVIGATION_ROW_HEIGHT_PT,
      },
      "subsection in head/foot"
    );
    const subsection = context.navigation.currentSubsection?.title;
    if (subsection) {
      primitives.push({
        kind: "text",
        id: `${context.frame.id}:headline:subsection`,
        sourceSpan: subsection.contentSpan,
        bounds: {
          x: HORIZONTAL_MARGIN_PT,
          y,
          width: context.page.page.width - 2 * HORIZONTAL_MARGIN_PT,
          height: NAVIGATION_ROW_HEIGHT_PT,
        },
        source: { kind: "mapped", value: subsection },
        fontRole: "subsection-in-head-foot",
        colorRole: "subsection in head/foot",
        alignment: "left",
        verticalAlignment: "top",
        baselineY: y + NAVIGATION_BASELINE_PT,
      });
    }
    y += NAVIGATION_ROW_HEIGHT_PT;
  }
  y += appendSeparationLine(
    primitives,
    context,
    y,
    "lower separation line head",
    "headline:lower-separation"
  );
  return { inset: y, primitives };
}

function appendHeadFade(
  context: BeamerFrameTemplateContext,
  primitives: BeamerTemplatePrimitive[]
): void {
  const bands = 96;
  const bandHeight = SINGAPORE_HEAD_FADE_HEIGHT_PT / bands;
  primitives.push({
    kind: "vector",
    id: `${context.frame.id}:headline:fade`,
    sourceSpan: context.frame.span,
    bounds: {
      x: 0,
      y: 0,
      width: context.page.page.width,
      height: SINGAPORE_HEAD_FADE_HEIGHT_PT,
    },
    templateId: "beamer/headline/singapore-fade",
    layoutKind: "headline-decoration",
    shapes: Array.from({ length: bands }, (_, index) => ({
      kind: "rect" as const,
      x: 0,
      y: index * bandHeight,
      width: context.page.page.width,
      height: bandHeight + 0.01,
      fillColorRole: "section in head/foot fade",
      fillOpacity: 1 - (index + 0.5) / bands,
    })),
  });
}

export function planMiniFramesFootline(
  context: BeamerFrameTemplateContext,
  ref: BeamerThemeTemplateRef
): BeamerChromeTemplatePlan {
  const style = typeof ref.options.style === "string"
    ? ref.options.style
    : "empty";
  if (style === "empty") {
    return { inset: FOOTLINE_RESERVE_PT, primitives: [] };
  }
  const rows = style === "authorinstitutetitle" ? 2 : 1;
  const primitives: BeamerTemplatePrimitive[] = [];
  const topSeparation = hasBackground(context, "upper separation line foot")
    ? SEPARATION_LINE_HEIGHT_PT
    : 0;
  const bottomSeparation = hasBackground(context, "lower separation line foot")
    ? SEPARATION_LINE_HEIGHT_PT
    : 0;
  const paintHeight =
    topSeparation + rows * NAVIGATION_ROW_HEIGHT_PT + bottomSeparation;
  let y = context.page.page.height - paintHeight;
  y += appendSeparationLine(
    primitives,
    context,
    y,
    "upper separation line foot",
    "footline:upper-separation"
  );
  if (style === "authorinstitutetitle") {
    appendMiniMetadataRow(
      context,
      primitives,
      y,
      "author in head/foot",
      "author",
      "institute"
    );
    y += NAVIGATION_ROW_HEIGHT_PT;
    appendMiniMetadataRow(
      context,
      primitives,
      y,
      "title in head/foot",
      "title",
      null
    );
    y += NAVIGATION_ROW_HEIGHT_PT;
  } else {
    const [left, right, colorRole] =
      style === "authorinstitute"
        ? ["author", "institute", "author in head/foot"] as const
        : style === "authortitle"
          ? ["title", "author", "title in head/foot"] as const
          : ["title", "institute", "title in head/foot"] as const;
    appendMiniMetadataRow(
      context,
      primitives,
      y,
      colorRole,
      left,
      right
    );
    y += NAVIGATION_ROW_HEIGHT_PT;
  }
  appendSeparationLine(
    primitives,
    context,
    y,
    "lower separation line foot",
    "footline:lower-separation"
  );
  return {
    inset: paintHeight + FOOTLINE_RESERVE_PT,
    primitives,
  };
}

function appendTreeRow(params: {
  context: BeamerFrameTemplateContext;
  primitives: BeamerTemplatePrimitive[];
  y: number;
  id: string;
  text: BeamerDelimitedSourceValue | undefined;
  colorRole: string;
  x: number;
  hook?: {
    x: number;
    verticalTopOffset: number;
  };
}): number {
  const { context, primitives, y } = params;
  appendBackground(
    primitives,
    context,
    `headline:${params.id}:background`,
    {
      x: 0,
      y,
      width: context.page.page.width,
      height: NAVIGATION_ROW_HEIGHT_PT,
    },
    params.colorRole
  );
  if (params.hook) {
    primitives.push(
      {
        kind: "fill",
        id: `${context.frame.id}:headline:${params.id}:hook-vertical`,
        sourceSpan: params.text?.span ?? context.frame.span,
        bounds: {
          x: params.hook.x,
          y: y + params.hook.verticalTopOffset,
          width: 0.4,
          height: 4.995,
        },
        colorRole: params.colorRole,
        paint: "foreground",
      },
      {
        kind: "fill",
        id: `${context.frame.id}:headline:${params.id}:hook-horizontal`,
        sourceSpan: params.text?.span ?? context.frame.span,
        bounds: {
          x: params.hook.x + 0.4,
          y: y + 4.360015869140625,
          width: 5,
          height: 0.4,
        },
        colorRole: params.colorRole,
        paint: "foreground",
      }
    );
  }
  if (params.text) {
    primitives.push({
      kind: "text",
      id: `${context.frame.id}:headline:${params.id}`,
      sourceSpan: params.text.contentSpan,
      bounds: {
        x: params.x,
        y,
        width: context.page.page.width - params.x - HORIZONTAL_MARGIN_PT,
        height: NAVIGATION_ROW_HEIGHT_PT,
      },
      source: { kind: "mapped", value: params.text },
      fontRole: params.id === "subsection"
        ? "subsection-in-head-foot"
        : params.id === "section"
          ? "section-in-head-foot"
          : "headline",
      colorRole: params.colorRole,
      alignment: "left",
      verticalAlignment: "top",
      baselineY: y + NAVIGATION_BASELINE_PT,
    });
  }
  return y + NAVIGATION_ROW_HEIGHT_PT;
}

function appendMiniFrameSections(
  context: BeamerFrameTemplateContext,
  primitives: BeamerTemplatePrimitive[],
  y: number,
  height: number,
  sections: readonly BeamerNavigationSectionEntry[]
): void {
  if (sections.length === 0) {
    return;
  }
  const usableWidth = context.page.page.width - 2 * HORIZONTAL_MARGIN_PT;
  const cellWidth = usableWidth / sections.length;
  for (const [index, section] of sections.entries()) {
    const cellX = HORIZONTAL_MARGIN_PT + index * cellWidth;
    const alignment = sections.length === 1
      ? "left"
      : index === 0
        ? "left"
        : index === sections.length - 1
          ? "right"
          : "center";
    primitives.push({
      kind: "text",
      id: `${context.frame.id}:headline:section-${section.sectionIndex}`,
      sourceSpan: section.title.contentSpan,
      bounds: { x: cellX, y, width: cellWidth, height },
      source: { kind: "mapped", value: section.title },
      fontRole: "section-in-head-foot",
      colorRole: section === context.navigation.currentSection
        ? "section in head/foot"
        : "section in head/foot shaded",
      alignment,
      verticalAlignment: "top",
      baselineY: y + NAVIGATION_BASELINE_PT,
    });
  }
  appendMiniFrameShapes(context, primitives, sections, y);
}

function appendMiniFrameShapes(
  context: BeamerFrameTemplateContext,
  primitives: BeamerTemplatePrimitive[],
  sections: readonly BeamerNavigationSectionEntry[],
  y: number
): void {
  const frames = sections.flatMap((section) =>
    section.frames.map((frame) => ({ section, frame }))
  );
  if (frames.length === 0) {
    return;
  }
  const lastSection = sections.at(-1);
  if (!lastSection) {
    return;
  }
  const startX =
    context.page.page.width -
    HORIZONTAL_MARGIN_PT -
    measureNavigationTitleWidth(context, lastSection.title) +
    1;
  const centerY = y + 10.320587158203125;
  const slideIndices = new Map<string, number>();
  const positioned = frames.map(({ section, frame }) => {
    const subsectionKey = frame.frame.subsectionId ??
      `${section.section.id}:direct`;
    const slideIndex = slideIndices.get(subsectionKey) ?? 0;
    slideIndices.set(subsectionKey, slideIndex + 1);
    return { section, frame, slideIndex };
  });
  const maxSlideIndex = Math.max(
    ...positioned.map(({ slideIndex }) => slideIndex)
  );
  const totalWidth = MINI_FRAME_DIAMETER_PT +
    maxSlideIndex * MINI_FRAME_STEP_PT;
  primitives.push({
    kind: "vector",
    id: `${context.frame.id}:headline:mini-frames`,
    sourceSpan: lastSection.section.span,
    bounds: {
      x: startX,
      y: centerY - MINI_FRAME_DIAMETER_PT / 2,
      width: totalWidth,
      height: MINI_FRAME_DIAMETER_PT,
    },
    templateId: "beamer/mini-frames/default",
    layoutKind: "mini-frame-navigation",
    shapes: positioned.flatMap(({ section, frame, slideIndex }) => {
      const currentSection = section === context.navigation.currentSection;
      const currentSubsection =
        frame.frame.subsectionId === context.navigation.currentSubsection?.subsection.id;
      const currentFrame = frame === context.navigation.currentFrame;
      const role = currentSection
        ? "mini frame"
        : "mini frame shaded";
      return [{
        kind: "circle" as const,
        cx: startX + slideIndex * MINI_FRAME_STEP_PT +
          MINI_FRAME_DIAMETER_PT / 2,
        cy: centerY,
        radius: MINI_FRAME_DIAMETER_PT / 2,
        ...(currentFrame
          ? { fillColorRole: role, strokeColorRole: role }
          : {
              strokeColorRole: currentSubsection
                ? role
                : "mini frame shaded",
            }),
        strokeWidthPt: MINI_FRAME_STROKE_PT,
      }];
    }),
  });
}

function measureNavigationTitleWidth(
  context: BeamerFrameTemplateContext,
  title: BeamerDelimitedSourceValue
): number {
  const font = context.theme.fonts["section-in-head-foot"];
  const profile = createBeamerTexTextFontProfile(font);
  const resolved = profile.resolveTextFont(
    profile.defaultFontState,
    texLength(font.sizePt),
    profile.metricProvider
  );
  return Number(profile.metricProvider.shapeText(title.value, resolved).width);
}

function appendVerticalNavigationTitles(params: {
  context: BeamerFrameTemplateContext;
  primitives: BeamerTemplatePrimitive[];
  entries: readonly {
    id: string;
    title: BeamerDelimitedSourceValue;
    active: boolean;
  }[];
  x: number;
  width: number;
  height: number;
  centerBaseline: number;
  alignment: "left" | "right";
  colorRole: string;
  shadedColorRole: string;
  fontRole: "section-in-head-foot" | "subsection-in-head-foot";
}): void {
  const lineHeight = params.context.theme.fonts[params.fontRole].lineHeightPt;
  const firstBaseline = params.centerBaseline -
    (params.entries.length - 1) * lineHeight / 2;
  for (const [index, entry] of params.entries.entries()) {
    params.primitives.push({
      kind: "text",
      id: `${params.context.frame.id}:headline:${entry.id}`,
      sourceSpan: entry.title.contentSpan,
      bounds: {
        x: params.x,
        y: 0,
        width: params.width,
        height: params.height,
      },
      source: { kind: "mapped", value: entry.title },
      fontRole: params.fontRole,
      colorRole: entry.active
        ? params.colorRole
        : params.shadedColorRole,
      alignment: params.alignment,
      verticalAlignment: "top",
      baselineY: firstBaseline + index * lineHeight,
    });
  }
}

function appendHorizontalSectionTitles(
  context: BeamerFrameTemplateContext,
  primitives: BeamerTemplatePrimitive[],
  x: number,
  width: number,
  height: number
): void {
  const sections = context.navigation.model.sections;
  appendHorizontalTitles(
    context,
    primitives,
    sections.map((entry) => ({
      id: `section-${entry.sectionIndex}`,
      title: entry.title,
      active: entry === context.navigation.currentSection,
    })),
    x,
    width,
    height,
    "section in head/foot",
    "section in head/foot shaded",
    "section-in-head-foot"
  );
}

function appendHorizontalSubsectionTitles(
  context: BeamerFrameTemplateContext,
  primitives: BeamerTemplatePrimitive[],
  x: number,
  width: number,
  height: number
): void {
  const subsections = context.navigation.currentSection?.subsections ?? [];
  appendHorizontalTitles(
    context,
    primitives,
    subsections.map((entry) => ({
      id: `subsection-${entry.subsectionIndex}`,
      title: entry.title,
      active: entry === context.navigation.currentSubsection,
    })),
    x,
    width,
    height,
    "subsection in head/foot",
    "subsection in head/foot shaded",
    "subsection-in-head-foot"
  );
}

function appendHorizontalTitles(
  context: BeamerFrameTemplateContext,
  primitives: BeamerTemplatePrimitive[],
  entries: readonly {
    id: string;
    title: BeamerDelimitedSourceValue;
    active: boolean;
  }[],
  x: number,
  width: number,
  height: number,
  colorRole: string,
  shadedColorRole: string,
  fontRole: "section-in-head-foot" | "subsection-in-head-foot"
): void {
  if (entries.length === 0) {
    return;
  }
  const cellWidth = (width - 2 * HORIZONTAL_MARGIN_PT) / entries.length;
  for (const [index, entry] of entries.entries()) {
    primitives.push({
      kind: "text",
      id: `${context.frame.id}:headline:${entry.id}`,
      sourceSpan: entry.title.contentSpan,
      bounds: {
        x: x + HORIZONTAL_MARGIN_PT + index * cellWidth,
        y: 0,
        width: cellWidth,
        height,
      },
      source: { kind: "mapped", value: entry.title },
      fontRole,
      colorRole: entry.active ? colorRole : shadedColorRole,
      alignment: "center",
      verticalAlignment: "top",
      baselineY: NAVIGATION_BASELINE_PT,
    });
  }
}

function appendMiniMetadataRow(
  context: BeamerFrameTemplateContext,
  primitives: BeamerTemplatePrimitive[],
  y: number,
  colorRole: string,
  left: "title" | "author",
  right: "author" | "institute" | null
): void {
  appendBackground(
    primitives,
    context,
    `footline:${left}:background`,
    {
      x: 0,
      y,
      width: context.page.page.width,
      height: NAVIGATION_ROW_HEIGHT_PT,
    },
    colorRole
  );
  appendMetadataText({
    context,
    primitives,
    field: left,
    id: `footline:${left}`,
    bounds: {
      x: HORIZONTAL_MARGIN_PT,
      y,
      width: context.page.page.width - 2 * HORIZONTAL_MARGIN_PT,
      height: NAVIGATION_ROW_HEIGHT_PT,
    },
    colorRole,
    alignment: "left",
    baselineY: y + NAVIGATION_BASELINE_PT,
  });
  if (right) {
    appendMetadataText({
      context,
      primitives,
      field: right,
      id: `footline:${right}`,
      bounds: {
        x: HORIZONTAL_MARGIN_PT,
        y,
        width: context.page.page.width - 2 * HORIZONTAL_MARGIN_PT,
        height: NAVIGATION_ROW_HEIGHT_PT,
      },
      colorRole: right === "institute"
        ? "institute in head/foot"
        : "author in head/foot",
      alignment: "right",
      baselineY: y + NAVIGATION_BASELINE_PT,
    });
  }
}

function appendMetadataText(params: {
  context: BeamerFrameTemplateContext;
  primitives: BeamerTemplatePrimitive[];
  field: "title" | "author" | "institute";
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  colorRole: string;
  alignment: "left" | "right";
  baselineY: number;
}): void {
  const value = metadataValue(params.context, params.field);
  if (!value || value.value.length === 0) {
    return;
  }
  params.primitives.push({
    kind: "text",
    id: `${params.context.frame.id}:${params.id}`,
    sourceSpan: value.contentSpan,
    bounds: params.bounds,
    source: { kind: "mapped", value },
    fontRole: "footline",
    colorRole: params.colorRole,
    alignment: params.alignment,
    verticalAlignment: "top",
    baselineY: params.baselineY,
  });
}

function appendBackground(
  primitives: BeamerTemplatePrimitive[],
  context: BeamerFrameTemplateContext,
  id: string,
  bounds: { x: number; y: number; width: number; height: number },
  colorRole: string
): void {
  if (!hasBackground(context, colorRole)) {
    return;
  }
  primitives.push({
    kind: "fill",
    id: `${context.frame.id}:${id}`,
    sourceSpan: context.frame.span,
    bounds,
    colorRole,
  });
}

function appendSeparationLine(
  primitives: BeamerTemplatePrimitive[],
  context: BeamerFrameTemplateContext,
  y: number,
  colorRole: string,
  id: string
): number {
  if (!hasBackground(context, colorRole)) {
    return 0;
  }
  primitives.push({
    kind: "fill",
    id: `${context.frame.id}:${id}`,
    sourceSpan: context.frame.span,
    bounds: {
      x: 0,
      y,
      width: context.page.page.width,
      height: SEPARATION_LINE_HEIGHT_PT,
    },
    colorRole,
  });
  return SEPARATION_LINE_HEIGHT_PT;
}

function hasBackground(
  context: BeamerFrameTemplateContext,
  colorRole: string
): boolean {
  return resolveBeamerThemeColor(context.theme, colorRole).bg != null;
}

function metadataValue(
  context: BeamerFrameTemplateContext,
  field: "title" | "author" | "institute"
): BeamerDelimitedSourceValue | undefined {
  const metadata = context.document.preamble.metadata[field];
  return metadata?.shortValue ?? metadata?.value;
}

function splitHeadlineHeight(context: BeamerFrameTemplateContext): number {
  const sectionRows = context.navigation.model.sections.length;
  const subsectionRows = Math.max(
    0,
    ...context.navigation.model.sections.map(
      (section) => section.subsections.length
    )
  );
  const rows = Math.max(sectionRows, subsectionRows);
  if (rows === 0) {
    return 0;
  }
  // The source uses 2.4375ex per row plus 1.825ex. Lock the 2-row profile to
  // the oracle and scale the row contribution for larger navigation models.
  return SPLIT_HEADLINE_HEIGHT_PT +
    (rows - 2) * context.theme.fonts.headline.lineHeightPt;
}

function splitCenterBaseline(height: number): number {
  return SPLIT_CENTER_BASELINE_PT +
    (height - SPLIT_HEADLINE_HEIGHT_PT) / 2;
}
