import type { AnchorReference, ComplexPathSegment } from "@tikz-editor/core/edit/element-templates";
import type { EditAction } from "@tikz-editor/core/edit/actions";
import type { WorldPoint } from "../coords/types";

import { distanceSquared } from "./geometry";
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
    ...(startAnchor !== undefined ? { startAnchor: startAnchor } : {}),
    segments: [],
    ...(appendTarget !== undefined ? { appendTarget: appendTarget } : {})
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

export function undoLastPathToolSegment(draft: PathToolDraft): PathToolDraft {
  if (draft.segments.length === 0) {
    return draft;
  }

  return {
    ...draft,
    segments: draft.segments.slice(0, -1)
  };
}

/** The finished draft as a new path, in world points. */
export function pathToolAddPathAction(draft: PathToolDraft, options: { closed: boolean; strokeColor?: string }): Extract<EditAction, { kind: "addPath" }> | null {
  if (draft.segments.length === 0) return null;
  return {
    kind: "addPath",
    start: draft.startWorld,
    segments: draft.segments,
    closed: options.closed,
    ...(draft.startAnchor !== undefined ? { startAnchor: draft.startAnchor } : {}),
    ...(options.strokeColor !== undefined ? { strokeColor: options.strokeColor } : {})
  };
}

/** The draft as segments drawn on from the end of an existing path. */
export function pathToolAppendAction(draft: PathToolDraft): Extract<EditAction, { kind: "appendToPath" }> | null {
  if (draft.segments.length === 0 || !draft.appendTarget) return null;
  return {
    kind: "appendToPath",
    elementId: draft.appendTarget.elementId,
    end: draft.appendTarget.end,
    start: draft.startWorld,
    segments: draft.segments,
    ...(draft.startAnchor !== undefined ? { startAnchor: draft.startAnchor } : {})
  };
}
