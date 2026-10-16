import { isBlankBeamerFrameHeading } from "../frame-headings.js";
import type { BeamerFrameTemplateContext, BeamerTemplatePrimitive } from "./types.js";

/** Measure the actual paragraphs and TeX interline glue, independently of template paint. */
export function measureBeamerHeadingStack(context: BeamerFrameTemplateContext, width: number, options: {
  titleStart?: string;
  titleEnd?: string;
  subtitleStart?: string;
  subtitleEnd?: string;
  subtitleBaselineSkipPt?: number;
} = {}) {
  const hasSubtitle = context.frame.subtitle != null && !isBlankBeamerFrameHeading(context.document.source, context.frame.subtitle);
  const title = context.frame.title && context.measureFrameHeading?.(context.frame.title, "frame-title", width,
    { start: options.titleStart ?? "\\strut", end: options.titleEnd ?? "\\strut" });
  const subtitle = hasSubtitle && context.frame.subtitle
    ? context.measureFrameHeading?.(context.frame.subtitle, "frame-subtitle", width, {
      start: options.subtitleStart ?? "\\strut", end: options.subtitleEnd ?? "\\strut",
      ...(options.subtitleBaselineSkipPt === undefined ? {} : { baselineSkipPt: options.subtitleBaselineSkipPt }),
    }) ?? null : null;
  if (!title) return null;
  const interlineSkip = subtitle ? subtitle.baselineSkip - title.endingDepth - subtitle.firstHeight : 0;
  const subtitleBaseline = subtitle ? title.extent - title.firstHeight +
    (interlineSkip >= 0 ? interlineSkip : 1) + subtitle.firstHeight : 0;
  return {
    title, subtitle, subtitleBaseline,
    extent: subtitle ? title.firstHeight + subtitleBaseline + subtitle.extent - subtitle.firstHeight : title.extent,
    lastBaseline: subtitle ? subtitleBaseline + subtitle.extent - subtitle.firstHeight - subtitle.endingDepth
      : title.extent - title.firstHeight - title.endingDepth,
  };
}

export function beamerSubtitlePrimitive(context: BeamerFrameTemplateContext, x: number, width: number, baselineY: number, baselineSkipPt?: number): BeamerTemplatePrimitive[] {
  if (!context.frame.subtitle) return [];
  return [{
    kind: "text", id: `${context.frame.id}:frame-subtitle:text`, sourceSpan: context.frame.subtitle.contentSpan,
    bounds: { x, y: 0, width, height: context.theme.fonts["frame-subtitle"].lineHeightPt },
    source: { kind: "mapped", value: context.frame.subtitle }, fontRole: "frame-subtitle", colorRole: "framesubtitle",
    alignment: "left", verticalAlignment: "top", baselineY,
    ...(baselineSkipPt === undefined ? {} : { baselineSkipPt }),
  }];
}
