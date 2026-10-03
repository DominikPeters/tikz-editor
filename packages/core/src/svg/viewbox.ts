import type { SceneFigure } from "../semantic/types.js";
import type { SvgViewBox } from "./types.js";
import { renderPathWithArrows } from "./arrows/render.js";
import { computeSvgStrokedPathBounds, transformSvgBounds } from "./geometry.js";
import { mapWorldTransformToSvgTransform } from "../coords/svg.js";

export function computeViewBox(scene: SceneFigure, padding = 12): SvgViewBox {
  let bounds: { minX: number; minY: number; maxX: number; maxY: number } | undefined = scene.bounds ? { ...scene.bounds } : undefined;
  // Semantic bounds describe authored geometry. Arrow shortening may extend
  // the shaft, and a move-only path may contain only rendered arrow tips.
  // Measure those SVG paths here, keeping the semantic layer independent.
  const originViewBox = { y: 0, height: 0 };
  for (const element of scene.elements) {
    if (element.kind !== "Path" || element.pictureSizeRelevant === false || element.style.clip || element.style.useAsBoundingBox ||
      (!element.style.markerStart && !element.style.markerEnd &&
      element.style.shortenStart === 0 && element.style.shortenEnd === 0)) continue;
    const rendered = renderPathWithArrows(element);
    const paths = [{ commands: rendered.shaftCommands,
      strokeWidth: element.style.stroke && element.style.stroke !== "none" ? element.style.lineWidth : 0,
      lineCap: element.style.lineCap, lineJoin: element.style.lineJoin }, ...rendered.tipPaths];
    for (const path of paths) {
      if (!path.commands.some(command => command.kind === "L" || command.kind === "C" || command.kind === "A")) continue;
      let pathBounds = computeSvgStrokedPathBounds(path.commands, originViewBox, path);
      if (!pathBounds) continue;
      if (element.transform) pathBounds = transformSvgBounds(pathBounds, mapWorldTransformToSvgTransform(element.transform, originViewBox));
      const minX = pathBounds.minX;
      const maxX = pathBounds.maxX;
      const minY = 0 - pathBounds.maxY;
      const maxY = 0 - pathBounds.minY;
      bounds = bounds ? {
        minX: Math.min(bounds.minX, minX), minY: Math.min(bounds.minY, minY),
        maxX: Math.max(bounds.maxX, maxX), maxY: Math.max(bounds.maxY, maxY)
      } : { minX, minY, maxX, maxY };
    }
  }
  if (!bounds) {
    return { x: -padding, y: -padding, width: 100 + padding * 2, height: 100 + padding * 2 };
  }

  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);

  return {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: width + padding * 2,
    height: height + padding * 2
  };
}
