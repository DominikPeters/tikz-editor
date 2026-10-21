import { buildBeamerCaretStopDomain, type BeamerFrameLayout, type BeamerRect } from "@tikz-editor/core/beamer/index";
import type { Span } from "@tikz-editor/core/ast/types";

/** Highlight only source-backed geometry painted on the active step. */
export function buildSelectionRects(layout: BeamerFrameLayout, source: string, spans: readonly Span[]): BeamerRect[] {
  if (spans.length === 0) return [];
  const shapes = layout.items.filter((item) => item.visibility !== "hidden" &&
    ["block", "graphics", "tikzpicture"].includes(item.kind) &&
    spans.some((span) => span.from <= item.sourceSpan.from && span.to >= item.sourceSpan.to));
  const rects: BeamerRect[] = shapes.map((item) => item.bounds);
  const paragraphs = layout.paragraphs.filter((paragraph) =>
    !["headline", "footline"].includes(paragraph.role) &&
    spans.some((span) => span.from < paragraph.sourceSpan.to && span.to > paragraph.sourceSpan.from) &&
    !shapes.some((item) => item.sourceSpan.from <= paragraph.sourceSpan.from && item.sourceSpan.to >= paragraph.sourceSpan.to));
  const domain = buildBeamerCaretStopDomain({ paragraphs, source });
  for (const line of domain.rows) {
    for (const span of spans) {
      const stops = line.stops.filter((stop) => span.from <= stop.offset && stop.offset <= span.to);
      if (stops.length < 2) continue;
      const x = Math.min(...stops.map((stop) => stop.x));
      const right = Math.max(...stops.map((stop) => stop.x));
      if (right > x) rects.push({ x, y: line.y, width: right - x, height: line.height });
    }
  }
  return rects;
}
