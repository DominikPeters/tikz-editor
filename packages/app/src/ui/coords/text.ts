import { svgPoint, textareaLocalPoint, viewportBounds, px } from "@tikz-editor/core/coords/index";
import type { ClientBounds, ClientPoint, SvgBounds, SvgPoint, TextareaLocalPoint, ViewportBounds, ViewportPoint } from "./types";

export function clientPointToTextareaLocal(point: ClientPoint, textareaRect: DOMRect): TextareaLocalPoint {
  return textareaLocalPoint(px(point.x - textareaRect.left), px(point.y - textareaRect.top));
}

export function clientBoundsToViewport(bounds: ClientBounds, viewportRect: DOMRect | null): ViewportBounds {
  const left = viewportRect?.left ?? 0;
  const top = viewportRect?.top ?? 0;
  return viewportBounds(
    px(bounds.minX - left),
    px(bounds.minY - top),
    px(bounds.maxX - left),
    px(bounds.maxY - top)
  );
}

export function svgBoundsToViewportBounds(
  bounds: SvgBounds,
  project: (point: SvgPoint) => ViewportPoint
): ViewportBounds {
  const topLeft = project(svgPoint(bounds.minX, bounds.minY));
  const bottomRight = project(svgPoint(bounds.maxX, bounds.maxY));
  return viewportBounds(px(topLeft.x), px(topLeft.y), px(bottomRight.x), px(bottomRight.y));
}
