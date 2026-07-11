import { textRectLocalPoint, px } from "@tikz-editor/core/coords/index";
import type { HitRegion } from "../canvas-panel/hit-regions";
import { rotatePointAroundCenter } from "../canvas-panel/geometry";
import { inverseMatrix } from "@tikz-editor/core/semantic/transform";
import { worldTransform } from "@tikz-editor/core/coords/index";
import type { SvgPoint, TextRectLocalPoint } from "./types";

export function resolveRectHitRegionContentBox(region: Extract<HitRegion, { shape: "rect" }>): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const width = region.contentWidth ?? region.width;
  const height = region.contentHeight ?? region.height;
  return {
    x: region.cx - width / 2,
    y: region.cy - height / 2,
    width,
    height
  };
}

export function svgPointToTextRectLocal(point: SvgPoint, region: Extract<HitRegion, { shape: "rect" }>): TextRectLocalPoint {
  if (region.transform) {
    const inverse = inverseMatrix(
      worldTransform(
        region.transform.a,
        region.transform.b,
        region.transform.c,
        region.transform.d,
        region.transform.e,
        region.transform.f
      )
    );
    if (inverse) {
      return textRectLocalPoint(
        px(inverse.a * point.x + inverse.c * point.y + inverse.e),
        px(inverse.b * point.x + inverse.d * point.y + inverse.f)
      );
    }
  }
  const rotated = rotatePointAroundCenter(point, region.cx, region.cy, region.rotation);
  return textRectLocalPoint(px(rotated.x), px(rotated.y));
}

export function isSvgPointInsideRectHitRegionContentBox(
  point: SvgPoint,
  region: Extract<HitRegion, { shape: "rect" }>
): boolean {
  const unrotatedPoint = svgPointToTextRectLocal(point, region);
  const contentBox = resolveRectHitRegionContentBox(region);
  return (
    unrotatedPoint.x >= contentBox.x &&
    unrotatedPoint.x <= contentBox.x + contentBox.width &&
    unrotatedPoint.y >= contentBox.y &&
    unrotatedPoint.y <= contentBox.y + contentBox.height
  );
}
