import type { BeamerDelimitedSourceValue } from "../types.js";
import { texLength } from "../../text/tex/coordinates.js";
import { texScannedDimensionPt } from "../../text/tex/dimensions.js";
import { createBeamerTexTextFontProfile } from "./font.js";
import { beamerExMultiple, beamerFontExPt } from "./font-metrics.js";
import type {
  BeamerChromeTemplatePlan,
  BeamerFrameTemplateContext,
  BeamerNavigationSectionEntry,
  BeamerTemplatePrimitive,
  BeamerThemeFontRole,
  BeamerThemeTemplateRef,
} from "./types.js";
import { resolveBeamerThemeColor } from "./resolve.js";

// TeX Live 2026 source contracts:
// - beamerouterthemetree.sty: three ht=2.5ex,dp=1.125ex navigation rows.
// - beamerouterthemesplit.sty: half-page section/subsection boxes and the
//   matching author/title footline.
// - beamerouterthememiniframes.sty: the section-navigation strip, optional
//   subsection row, separation lines, and four footline variants.
// Every height here is a multiple of `ex` in the head/foot font the box is
// typeset in (stock Beamer: `tiny structure`, which beamerposter scales), so
// the dimensions are computed from that font's x-height like TeX does and
// follow poster font sizes. At the 11pt-class deck size they reproduce the
// LuaLaTeX/Latin Modern measurements to the scaled point.
const SEPARATION_LINE_HEIGHT_PT = 3;
const FOOTLINE_RESERVE_PT = 4;
// \.3cm leftskip/rightskip and text margins as TeX scans the length.
const HORIZONTAL_MARGIN_PT = texScannedDimensionPt(".3", "cm") ?? 8.5359039306640625;
const MINI_FRAME_DIAMETER_PT = 72.27 / 2.54 * 0.1;
const MINI_FRAME_STEP_PT = 72.27 / 2.54 * 0.14;
const MINI_FRAME_STROKE_PT = 0.4;
const SINGAPORE_HEAD_FADE_HEIGHT_PT = 1.25 * 72.27 / 2.54;
const SP = 1 / 65_536;

/**
 * The ht=2.5ex,dp=1.125ex color box Beamer's outer themes stack for their
 * head and foot rows, in the ex of the font it is typeset in.
 */
type HeadFootBar = {
  ex: number;
  /** `ht=2.5ex`: also where the text baseline sits. */
  baselinePt: number;
  /** `ht` plus `dp=1.125ex`. */
  heightPt: number;
};

function headFootBar(
  context: BeamerFrameTemplateContext,
  role: BeamerThemeFontRole
): HeadFootBar {
  const ex = beamerFontExPt(context.theme.fonts[role]);
  const baselinePt = beamerExMultiple(2.5, ex);
  return { ex, baselinePt, heightPt: baselinePt + beamerExMultiple(1.125, ex) };
}

/** A raised or lowered length such as `1.9pt`, kept in scaled points. */
function spPt(pt: number): number {
  return Math.round(pt * 65_536) * SP;
}

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
    // `title in head/foot` sets no size of its own: the headline font.
    bar: headFootBar(context, "headline"),
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
    bar: headFootBar(context, "section-in-head-foot"),
    text: section,
    colorRole: "section in head/foot",
    x: HORIZONTAL_MARGIN_PT + (hooks ? 8.4 : 6),
    ...(hooks && section ? { hook: { x: HORIZONTAL_MARGIN_PT + 2 } } : {}),
  });
  const subsection = context.navigation.currentSubsection?.title;
  y = appendTreeRow({
    context,
    primitives,
    y,
    id: "subsection",
    bar: headFootBar(context, "subsection-in-head-foot"),
    text: subsection,
    colorRole: "subsection in head/foot",
    x: HORIZONTAL_MARGIN_PT + (hooks ? 15.8 : 12),
    ...(hooks && subsection ? { hook: { x: HORIZONTAL_MARGIN_PT + 9.4 } } : {}),
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
  // Both half-page boxes sit inside `\usebeamerfont{section in head/foot}`.
  const bar = headFootBar(context, "section-in-head-foot");
  const height = compressed ? bar.heightPt : splitHeadlineHeight(bar, context);
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
    appendHorizontalSectionTitles(context, primitives, 0, half, height, bar.baselinePt);
    appendHorizontalSubsectionTitles(context, primitives, half, half, height, bar.baselinePt);
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
      centerBaseline: splitCenterBaseline(bar, height),
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
      centerBaseline: splitCenterBaseline(bar, height),
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
  const bar = headFootBar(context, "footline");
  const height = bar.heightPt;
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
    baselineY: y + bar.baselinePt,
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
    baselineY: y + bar.baselinePt,
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
  // The section box has no ht/dp of its own: \vskip2.5ex, the navigation row
  // (its mini-frame rows hang below the baseline), \vskip1.125ex. The
  // navigation vbox is `\vskip-\baselineskip` plus the interline glue that
  // restores it, so the text baseline sits 2.5ex below the box top and the
  // depth below it is the deeper of the section boxes' 0.75ex and the lowest
  // mini-frame row.
  const headBar = headFootBar(context, "headline");
  const navigationDepth = Math.max(
    beamerExMultiple(0.75, beamerFontExPt(context.theme.fonts["section-in-head-foot"])),
    miniFrameLowering(miniFrameRowCount(sections))
  );
  const sectionHeight = headBar.heightPt + navigationDepth;
  appendBackground(
    primitives,
    context,
    "headline:section:background",
    { x: 0, y, width: context.page.page.width, height: sectionHeight },
    "section in head/foot"
  );
  appendMiniFrameSections(context, primitives, y, sectionHeight, sections, {
    titleBaselineY: y + headBar.baselinePt,
  });
  y += sectionHeight;

  if (ref.options.subsection !== false) {
    y += appendSeparationLine(
      primitives,
      context,
      y,
      "middle separation line head",
      "headline:middle-separation"
    );
    // The subsection box starts before \usebeamerfont{subsection in head/foot},
    // so its ex belongs to the headline font.
    appendBackground(
      primitives,
      context,
      "headline:subsection:background",
      {
        x: 0,
        y,
        width: context.page.page.width,
        height: headBar.heightPt,
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
          height: headBar.heightPt,
        },
        source: { kind: "mapped", value: subsection },
        fontRole: "subsection-in-head-foot",
        colorRole: "subsection in head/foot",
        alignment: "left",
        verticalAlignment: "top",
        baselineY: y + headBar.baselinePt,
      });
    }
    y += headBar.heightPt;
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
  const bar = headFootBar(context, "footline");
  const primitives: BeamerTemplatePrimitive[] = [];
  const topSeparation = hasBackground(context, "upper separation line foot")
    ? SEPARATION_LINE_HEIGHT_PT
    : 0;
  const bottomSeparation = hasBackground(context, "lower separation line foot")
    ? SEPARATION_LINE_HEIGHT_PT
    : 0;
  const paintHeight =
    topSeparation + rows * bar.heightPt + bottomSeparation;
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
      "institute",
      bar
    );
    y += bar.heightPt;
    appendMiniMetadataRow(
      context,
      primitives,
      y,
      "title in head/foot",
      "title",
      null,
      bar
    );
    y += bar.heightPt;
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
      right,
      bar
    );
    y += bar.heightPt;
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
  bar: HeadFootBar;
  text: BeamerDelimitedSourceValue | undefined;
  colorRole: string;
  x: number;
  hook?: { x: number };
}): number {
  const { context, primitives, y, bar } = params;
  appendBackground(
    primitives,
    context,
    `headline:${params.id}:background`,
    {
      x: 0,
      y,
      width: context.page.page.width,
      height: bar.heightPt,
    },
    params.colorRole
  );
  if (params.hook) {
    // \raise1.9pt\hbox{\vrule height1.875ex\vrule width5pt height0.4pt} on
    // the row's 2.5ex baseline.
    const raise = spPt(1.9);
    const hookHeight = beamerExMultiple(1.875, bar.ex);
    primitives.push(
      {
        kind: "fill",
        id: `${context.frame.id}:headline:${params.id}:hook-vertical`,
        sourceSpan: params.text?.span ?? context.frame.span,
        bounds: {
          x: params.hook.x,
          y: y + bar.baselinePt - raise - hookHeight,
          width: 0.4,
          height: hookHeight,
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
          y: y + bar.baselinePt - raise - spPt(0.4),
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
        height: bar.heightPt,
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
      baselineY: y + bar.baselinePt,
    });
  }
  return y + bar.heightPt;
}

export function appendMiniFrameSections(
  context: BeamerFrameTemplateContext,
  primitives: BeamerTemplatePrimitive[],
  y: number,
  height: number,
  sections: readonly BeamerNavigationSectionEntry[],
  options: {
    /** Absolute baseline of the navigation row; its section titles and mini frames hang from it. */
    titleBaselineY: number;
    miniFrameIndexing?: "subsection" | "global";
  }
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
      baselineY: options.titleBaselineY,
    });
  }
  appendMiniFrameShapes(
    context,
    primitives,
    sections,
    options.titleBaselineY,
    options.miniFrameIndexing ?? "subsection"
  );
}

// beamerouterthemedefault.sty: `mini frame size=.14cm,mini frame offset=-0.01cm`;
// beamerbasenavigation.sty \slideentry raises each frame box by
// -(offset+size)*ypos-.05cm. Lengths are scanned like TeX does.
const MINI_FRAME_BOX_SIZE_SP = Math.round((texScannedDimensionPt(".14", "cm") ?? 0) * 65_536);
const MINI_FRAME_OFFSET_SP = Math.round((texScannedDimensionPt("-.01", "cm") ?? 0) * 65_536);
const MINI_FRAME_BASE_DROP_SP = Math.round((texScannedDimensionPt(".05", "cm") ?? 0) * 65_536);

/** `\beamer@ypos` of every frame of a section: its subsection number, plus one once a frame precedes the first subsection. */
function miniFrameRowOf(
  section: BeamerNavigationSectionEntry,
  indexing: "subsection" | "global"
): Map<number, number> {
  const rows = new Map<number, number>();
  if (indexing === "global") {
    for (const { frameIndex } of section.frames) rows.set(frameIndex, 1);
    return rows;
  }
  const offset = section.directFrames.length > 0 ? 1 : 0;
  for (const { frameIndex } of section.directFrames) rows.set(frameIndex, 1);
  for (const [position, subsection] of section.subsections.entries()) {
    for (const { frameIndex } of subsection.frames) rows.set(frameIndex, position + 1 + offset);
  }
  return rows;
}

/** The deepest `\beamer@ypos` over the navigation, which sets how far the mini-frame rows hang. */
function miniFrameRowCount(sections: readonly BeamerNavigationSectionEntry[]): number {
  let rows = 0;
  for (const section of sections) {
    for (const row of miniFrameRowOf(section, "subsection").values()) rows = Math.max(rows, row);
  }
  return rows;
}

/** How far the row `ypos` hangs below the navigation baseline, in points. */
function miniFrameLowering(ypos: number): number {
  if (ypos <= 0) return 0;
  return ((MINI_FRAME_OFFSET_SP + MINI_FRAME_BOX_SIZE_SP) * ypos + MINI_FRAME_BASE_DROP_SP) / 65_536;
}

function appendMiniFrameShapes(
  context: BeamerFrameTemplateContext,
  primitives: BeamerTemplatePrimitive[],
  sections: readonly BeamerNavigationSectionEntry[],
  baselineY: number,
  indexing: "subsection" | "global"
): void {
  const frames = sections.flatMap((section) => {
    const rows = miniFrameRowOf(section, indexing);
    return section.frames.map((frame) => ({ section, frame, row: rows.get(frame.frameIndex) ?? 1 }));
  });
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
  const slideIndices = new Map<string, number>();
  const positioned = frames.map(({ section, frame, row }, frameIndex) => {
    if (indexing === "global") {
      return { section, frame, row, slideIndex: frameIndex };
    }
    const subsectionKey = frame.frame.subsectionId ??
      `${section.section.id}:direct`;
    const slideIndex = slideIndices.get(subsectionKey) ?? 0;
    slideIndices.set(subsectionKey, slideIndex + 1);
    return { section, frame, row, slideIndex };
  });
  const maxSlideIndex = Math.max(
    ...positioned.map(({ slideIndex }) => slideIndex)
  );
  // The picture's lower-left corner is lowered by (size+offset)*ypos+.05cm
  // below the baseline and the circle's center is half a diameter above it,
  // so the center is (size+offset)*ypos below the baseline.
  const centerOf = (row: number) => baselineY + (miniFrameLowering(row) - MINI_FRAME_DIAMETER_PT / 2);
  const centers = positioned.map(({ row }) => centerOf(row));
  const top = Math.min(...centers) - MINI_FRAME_DIAMETER_PT / 2;
  const bottom = Math.max(...centers) + MINI_FRAME_DIAMETER_PT / 2;
  const totalWidth = MINI_FRAME_DIAMETER_PT +
    maxSlideIndex * MINI_FRAME_STEP_PT;
  primitives.push({
    kind: "vector",
    id: `${context.frame.id}:headline:mini-frames`,
    sourceSpan: lastSection.section.span,
    bounds: {
      x: startX,
      y: top,
      width: totalWidth,
      height: bottom - top,
    },
    templateId: "beamer/mini-frames/default",
    layoutKind: "mini-frame-navigation",
    shapes: positioned.flatMap(({ section, frame, row, slideIndex }) => {
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
        cy: centerOf(row),
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
  height: number,
  baselinePt: number
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
    "section-in-head-foot",
    baselinePt
  );
}

function appendHorizontalSubsectionTitles(
  context: BeamerFrameTemplateContext,
  primitives: BeamerTemplatePrimitive[],
  x: number,
  width: number,
  height: number,
  baselinePt: number
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
    "subsection-in-head-foot",
    baselinePt
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
  fontRole: "section-in-head-foot" | "subsection-in-head-foot",
  baselinePt: number
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
      baselineY: baselinePt,
    });
  }
}

function appendMiniMetadataRow(
  context: BeamerFrameTemplateContext,
  primitives: BeamerTemplatePrimitive[],
  y: number,
  colorRole: string,
  left: "title" | "author",
  right: "author" | "institute" | null,
  bar: HeadFootBar
): void {
  appendBackground(
    primitives,
    context,
    `footline:${left}:background`,
    {
      x: 0,
      y,
      width: context.page.page.width,
      height: bar.heightPt,
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
      height: bar.heightPt,
    },
    colorRole,
    alignment: "left",
    baselineY: y + bar.baselinePt,
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
        height: bar.heightPt,
      },
      colorRole: right === "institute"
        ? "institute in head/foot"
        : "author in head/foot",
      alignment: "right",
      baselineY: y + bar.baselinePt,
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

function splitHeadlineHeight(
  bar: HeadFootBar,
  context: BeamerFrameTemplateContext
): number {
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
  // beamerouterthemesplit.sty: \@tempdimb=2.4375ex, \multiply by the row
  // count, \advance by 1.825ex.
  return rows * beamerExMultiple(2.4375, bar.ex) + beamerExMultiple(1.825, bar.ex);
}

function splitCenterBaseline(bar: HeadFootBar, height: number): number {
  // The navigation vbox is centered between two \vfil in the \vbox to height;
  // its first baseline lies `(15/32)ex` below the center of that box.
  return height / 2 + 0.46875 * bar.ex;
}
