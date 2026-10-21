import type { WorldPoint } from "@tikz-editor/core/coords/index";
import type { ComplexPathSegment, ElementTemplate } from "@tikz-editor/core/edit/element-templates";
import type { SceneFigure } from "@tikz-editor/core/semantic/types";
import { applyMatrix, inverseMatrix } from "@tikz-editor/core/semantic/transform";
import type { FreehandToolDraft } from "./freehand-tool";
import type { PathToolDraft } from "./path-tool";

/**
 * Where a point the canvas shows is in the picture's own coordinates: what a
 * new statement writes. They differ when the picture's options transform it,
 * as a drawing layer's `shift={(current page.south west)}` does.
 */
export function worldToPictureCoordinates(scene: SceneFigure | null): (point: WorldPoint) => WorldPoint {
  const inverse = scene?.rootTransform ? inverseMatrix(scene.rootTransform) : null;
  return inverse ? (point) => applyMatrix(inverse, point) : (point) => point;
}

export function templateInPictureCoordinates(template: ElementTemplate, map: (point: WorldPoint) => WorldPoint): ElementTemplate {
  switch (template.kind) {
    case "line":
      return template.to ? { ...template, to: map(template.to) } : template;
    case "bezier":
      return {
        ...template,
        ...(template.to ? { to: map(template.to) } : {}),
        ...(template.control1 ? { control1: map(template.control1) } : {}),
        ...(template.control2 ? { control2: map(template.control2) } : {})
      };
    case "grid":
    case "rectangle":
    case "ellipse":
      return template.corner ? { ...template, corner: map(template.corner) } : template;
    case "circle":
    case "filledCircle":
      return template.edge ? { ...template, edge: map(template.edge) } : template;
    case "node":
    case "matrix":
      return template;
  }
}

export function pathDraftInPictureCoordinates(draft: PathToolDraft, map: (point: WorldPoint) => WorldPoint): PathToolDraft {
  return {
    ...draft,
    startWorld: map(draft.startWorld),
    segments: draft.segments.map((segment): ComplexPathSegment => segment.kind === "line"
      ? { ...segment, to: map(segment.to) }
      : { ...segment, to: map(segment.to), control1: map(segment.control1), control2: map(segment.control2) })
  };
}

export function freehandDraftInPictureCoordinates(draft: FreehandToolDraft, map: (point: WorldPoint) => WorldPoint): FreehandToolDraft {
  return { ...draft, points: draft.points.map(map) };
}
