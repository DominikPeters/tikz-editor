import { svgPoint, viewportBounds, px } from "@tikz-editor/core/coords/index";
import type { ClientBounds, SvgBounds, SvgPoint, ViewportBounds, ViewportPoint } from "./types";

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
