import {
  generateComplexPathSource,
  generateComplexPathSegmentSource,
  generateComplexPathPrependSource,
  reverseComplexPathSegments,
  type AnchorReference,
  type ComplexPathSegment
} from "tikz-editor/edit/element-templates";
import type { WorldPoint } from "../coords/types";

import { resolveBezierControlsFromBend } from "./interaction-helpers";

const MIN_SEGMENT_LENGTH_PT = 1e-3;
export const PATH_TOOL_CLOSE_RADIUS_PX = 10;
export const PATH_TOOL_BEND_DRAG_THRESHOLD_PX = 3;

export type PathAppendTarget = {
  elementId: string;
  end: "start" | "end";
};

export type PathToolDraft = {
  startWorld: WorldPoint;
  startAnchor?: AnchorReference;
  segments: ComplexPathSegment[];
  appendTarget?: PathAppendTarget;
};

export type PathToolGestureSegment = {
  endWorld: WorldPoint;
  endAnchor?: AnchorReference;
  bendWorld: WorldPoint;
  asBezier: boolean;
};

export function createPathToolDraft(
  startWorld: WorldPoint,
  appendTarget?: PathAppendTarget,
  startAnchor?: AnchorReference
): PathToolDraft {
  return {
    startWorld: { ...startWorld },
    startAnchor,
    segments: [],
    appendTarget
  };
}

export function pathToolCurrentPoint(draft: PathToolDraft): WorldPoint {
  const lastSegment = draft.segments[draft.segments.length - 1];
  return lastSegment ? { ...lastSegment.to } : { ...draft.startWorld };
}

export function pathToolHasDrawableSegments(draft: PathToolDraft): boolean {
  return draft.segments.length > 0;
}

export function pathToolCanClose(draft: PathToolDraft): boolean {
  return !draft.appendTarget && draft.segments.length >= 2;
}

export function pathToolCloseRadiusWorld(zoom: number): number {
  return PATH_TOOL_CLOSE_RADIUS_PX / Math.max(zoom, 1e-3);
}

export function pathToolWouldCreateDegenerateSegment(draft: PathToolDraft, endWorld: WorldPoint): boolean {
  const from = pathToolCurrentPoint(draft);
  return distanceSquared(from, endWorld) <= MIN_SEGMENT_LENGTH_PT * MIN_SEGMENT_LENGTH_PT;
}

export function pathToolIsWorldPointNearStart(draft: PathToolDraft, point: WorldPoint, radiusWorld: number): boolean {
  return distanceSquared(draft.startWorld, point) <= radiusWorld * radiusWorld;
}

export function pathToolShouldClose(draft: PathToolDraft, point: WorldPoint, radiusWorld: number): boolean {
  return pathToolCanClose(draft) && pathToolIsWorldPointNearStart(draft, point, radiusWorld);
}

export function appendPathToolLineSegment(draft: PathToolDraft, endWorld: WorldPoint): PathToolDraft {
  if (pathToolWouldCreateDegenerateSegment(draft, endWorld)) {
    return draft;
  }

  return {
    ...draft,
    segments: [...draft.segments, { kind: "line", to: { ...endWorld } }]
  };
}

export function appendPathToolBezierSegment(
  draft: PathToolDraft,
  endWorld: WorldPoint,
  bendWorld: WorldPoint
): PathToolDraft {
  if (pathToolWouldCreateDegenerateSegment(draft, endWorld)) {
    return draft;
  }

  const from = pathToolCurrentPoint(draft);
  const controls = resolveBezierControlsFromBend(from, endWorld, bendWorld);

  return {
    ...draft,
    segments: [
      ...draft.segments,
      {
        kind: "bezier",
        to: { ...controls.endWorld },
        control1: { ...controls.control1 },
        control2: { ...controls.control2 }
      }
    ]
  };
}

export function appendPathToolSegmentFromGesture(
  draft: PathToolDraft,
  segment: PathToolGestureSegment
): PathToolDraft {
  const nextDraft = segment.asBezier
    ? appendPathToolBezierSegment(draft, segment.endWorld, segment.bendWorld)
    : appendPathToolLineSegment(draft, segment.endWorld);
  if (nextDraft === draft || !segment.endAnchor) {
    return nextDraft;
  }

  const nextSegments = [...nextDraft.segments];
  const lastSegment = nextSegments[nextSegments.length - 1];
  if (!lastSegment) {
    return nextDraft;
  }
  nextSegments[nextSegments.length - 1] = {
    ...lastSegment,
    toAnchor: segment.endAnchor
  };
  return {
    ...nextDraft,
    segments: nextSegments
  };
}

export function generatePathToolSource(draft: PathToolDraft, options: { closed: boolean; strokeColor?: string }): string | null {
  return generateComplexPathSource(draft.startWorld, draft.segments, {
    closed: options.closed,
    startAnchor: draft.startAnchor,
    strokeColor: options.strokeColor
  });
}

/**
 * Generate the segment source for appending/prepending to an existing path.
 * For "end": returns segment operators like `-- (x,y) -- (x2,y2)`.
 * For "start": reverses segments and returns `(newStart) -- ... --`
 * (ending with an operator, no final coordinate, since the existing body provides it).
 */
export function generateAppendSegmentSource(draft: PathToolDraft): string | null {
  if (draft.segments.length === 0) return null;
  const end = draft.appendTarget?.end ?? "end";

  if (end === "end") {
    return generateComplexPathSegmentSource(draft.segments);
  }

  // Prepend to start: reverse the drawn segments so they go from the
  // new far end back to the old start point.
  const { startWorld: newStart, startAnchor: newStartAnchor, segments: revSegs } = reverseComplexPathSegments(
    draft.startWorld,
    draft.segments,
    draft.startAnchor
  );

  return generateComplexPathPrependSource(newStart, revSegs, newStartAnchor);
}

function distanceSquared(a: WorldPoint, b: WorldPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
