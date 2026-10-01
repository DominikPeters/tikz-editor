import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint } from "../../coords/points.js";
import { buildSnapContext, resolveSnapSettings } from "./context.js";
import { createGapSnapLines, collectGapSnaps } from "./gap-snaps.js";
import {
  SNAP_EPSILON,
  translateBounds,
  translatePoints
} from "./geometry.js";
import { collectGridSnaps, pickGridStepPt, snapToNextMultiple } from "./grid-snaps.js";
import {
  SNAP_CLUSTER_BREAK_PX,
  collectGuideSnaps,
  collectPointSnaps,
  createEmptySnapBuckets,
  createMinOffset,
  createPointSnapLines,
  createPointerLinesForPointSnap,
  pointSnapOffset
} from "./point-snaps.js";
import type {
  Axis,
  AxisSnapCandidate,
  AxisSnapBuckets,
  GapSnapCandidate,
  SelectionGeometry,
  SnapContext,
  SnapHandlePositionInput,
  SnapKeyboardNudgeInput,
  SnapLine,
  SnapResult,
  SnapSelectionTranslationInput,
  SnapSettings,
  SnapSettingsPatch,
  SnapToolPointerInput
} from "./types.js";

export {
  buildSnapContext,
  pickGridStepPt,
  resolveSnapSettings,
  snapToNextMultiple
};

export {
  boundsFromPoints,
  collectSelectionGeometry,
  collectSelectionGeometryFromBounds,
  collectSourceWorldBounds,
  selectionSnapPointsFromBounds
} from "./geometry.js";

export type * from "./types.js";

export function snapSelectionTranslation(input: SnapSelectionTranslationInput): SnapResult {
  const settings = effectiveSettings(input.context, input.settings);

  if (shouldBypassSnapping(settings, input.modifiers)) {
    return {
      offset: worldPoint(pt(0), pt(0)),
      snappedDelta: input.rawDelta,
      lines: []
    };
  }

  const movedSelection = {
    bounds: translateBounds(input.selection.bounds, input.rawDelta),
    snapPoints: translatePoints(input.selection.snapPoints, input.rawDelta)
  };

  const snap = runSelectionSnapPasses({
    context: input.context,
    settings,
    selection: movedSelection,
    includeGaps: true,
    enabledAxis: input.enabledAxis
  });

  return {
    offset: snap.offset,
    snappedDelta: worldPoint(pt(input.rawDelta.x + snap.offset.x), pt(input.rawDelta.y + snap.offset.y)),
    lines: snap.lines,
    targets: snap.targets
  };
}

export function snapHandlePosition(input: SnapHandlePositionInput): SnapResult {
  const settings = effectiveSettings(input.context, input.settings);

  if (shouldBypassSnapping(settings, input.modifiers)) {
    return {
      offset: worldPoint(pt(0), pt(0)),
      snappedPoint: input.point,
      lines: []
    };
  }

  const referencePoints =
    input.allowSelfSnap || !input.sourceId
      ? input.context.referencePoints
      : input.context.referencePoints.filter((point) => point.sourceId !== input.sourceId);

  return snapPointerWithPointsAndGrid({
    context: input.context,
    settings,
    pointer: input.point,
    referencePoints,
  });
}

export function snapKeyboardNudge(input: SnapKeyboardNudgeInput): SnapResult {
  const fallback = input.direction * input.step;

  let axisDelta = fallback;
  if (input.anchor) {
    const current = input.axis === "x" ? input.anchor.x : input.anchor.y;
    const next = snapToNextMultiple(current, input.step, input.direction);
    axisDelta = next - current;
    if (Math.abs(axisDelta) < input.step * 1e-6) {
      axisDelta = fallback;
    }
  }

  const rawDelta = input.axis === "x"
    ? worldPoint(pt(axisDelta), pt(0))
    : worldPoint(pt(0), pt(axisDelta));

  return {
    offset: worldPoint(pt(0), pt(0)),
    snappedDelta: rawDelta,
    lines: []
  };
}

export function snapToolPointer(input: SnapToolPointerInput): SnapResult {
  const settings = effectiveSettings(input.context, input.settings);

  if (shouldBypassSnapping(settings, input.modifiers)) {
    return {
      offset: worldPoint(pt(0), pt(0)),
      snappedPoint: input.pointer,
      lines: []
    };
  }

  if ((input.kind === "rect-corner" || input.kind === "circle-edge") && input.anchor) {
    // During anchored shape creation the start point is fixed.
    // Snapping against full draft bounds can pin offset to zero when the anchor
    // already matches a target, so only the movable pointer should drive snaps.
    return snapPointerWithPointsAndGrid({
      context: input.context,
      settings,
      pointer: input.pointer,
      referencePoints: input.context.referencePoints
    });
  }

  return snapPointerWithPointsAndGrid({
    context: input.context,
    settings,
    pointer: input.pointer,
    referencePoints: input.context.referencePoints
  });
}

function snapPointerWithPointsAndGrid({
  context,
  settings,
  pointer,
  referencePoints
}: {
  context: SnapContext;
  settings: SnapSettings;
  pointer: WorldPoint;
  referencePoints: WorldPoint[];
}): SnapResult {
  const firstPass = collectPointAndGridSnaps({
    context,
    settings,
    selectionPoints: [pointer],
    referencePoints,
    enabledAxis: null,
    thresholdWorld: settings.thresholdPx / context.zoom,
    clusterBreakWorld: SNAP_CLUSTER_BREAK_PX / context.zoom
  });

  const offset = pointSnapOffset(firstPass.nearest);
  const snappedPoint = worldPoint(pt(pointer.x + offset.x), pt(pointer.y + offset.y));

  const secondPass = collectPointAndGridSnaps({
    context,
    settings,
    selectionPoints: [snappedPoint],
    referencePoints,
    enabledAxis: null,
    thresholdWorld: 0,
    clusterBreakWorld: SNAP_CLUSTER_BREAK_PX / context.zoom
  });

  const lines = [
    ...createPointSnapLines(secondPass.nearest),
    ...createPointerLinesForPointSnap(secondPass.nearest, snappedPoint)
  ];

  return {
    offset,
    snappedPoint,
    lines
  };
}

function runSelectionSnapPasses({
  context,
  settings,
  selection,
  includeGaps,
  enabledAxis
}: {
  context: SnapContext;
  settings: SnapSettings;
  selection: SelectionGeometry;
  includeGaps: boolean;
  enabledAxis: Axis | null | undefined;
}): { offset: WorldPoint; lines: SnapLine[]; targets: AxisSnapBuckets } {
  const thresholdWorld = settings.thresholdPx / context.zoom;

  const firstPass = collectPointGridAndGapSnaps({
    context,
    settings,
    selection,
    includeGaps,
    enabledAxis,
    thresholdWorld,
    clusterBreakWorld: SNAP_CLUSTER_BREAK_PX / context.zoom
  });

  const offset = worldPoint(pt(firstPass.nearest.x[0]?.offset ?? 0), pt(firstPass.nearest.y[0]?.offset ?? 0));
  const targets = {
    x: firstPass.nearest.x.filter((target) => Math.abs(target.offset - offset.x) <= SNAP_EPSILON),
    y: firstPass.nearest.y.filter((target) => Math.abs(target.offset - offset.y) <= SNAP_EPSILON)
  };

  const snappedSelection: SelectionGeometry = {
    bounds: translateBounds(selection.bounds, offset),
    snapPoints: translatePoints(selection.snapPoints, offset)
  };

  return {
    offset,
    targets,
    lines: selectionSnapLines(context, snappedSelection, targets, settings)
  };
}

/** Validate retained targets against the geometry actually produced by an edit. */
export function selectionSnapLines(
  context: SnapContext,
  selection: SelectionGeometry,
  targets: AxisSnapBuckets,
  settings: SnapSettings = context.settings
): SnapLine[] {
  const secondPass = collectPointGridAndGapSnaps({
    context,
    settings,
    selection,
    includeGaps: true,
    thresholdWorld: 0,
    clusterBreakWorld: SNAP_CLUSTER_BREAK_PX / context.zoom
  });
  for (const axis of ["x", "y"] as const) {
    secondPass.nearest[axis] = secondPass.nearest[axis].filter((candidate) =>
      targets[axis].some((target) => sameSnapTarget(candidate, target))
    );
  }

  const pointLines = createPointSnapLines(secondPass.nearest);
  const gapLines = createGapSnapLines(
    selection.bounds,
    collectGapCandidates(secondPass.nearest)
  );

  return [...pointLines, ...gapLines];
}

function sameSnapTarget(candidate: AxisSnapCandidate, target: AxisSnapCandidate): boolean {
  if (candidate.kind === "gap" || target.kind === "gap") {
    return candidate.kind === "gap" && target.kind === "gap" &&
      candidate.direction === target.direction && candidate.gap === target.gap;
  }
  return candidate.kind === target.kind && candidate.sourceId === target.sourceId &&
    candidate.role === target.role && Math.abs(candidate.key - target.key) <= SNAP_EPSILON;
}

function collectPointGridAndGapSnaps({
  context,
  settings,
  selection,
  includeGaps,
  enabledAxis,
  thresholdWorld,
  clusterBreakWorld
}: {
  context: SnapContext;
  settings: SnapSettings;
  selection: SelectionGeometry;
  includeGaps: boolean;
  enabledAxis?: Axis | null;
  thresholdWorld: number;
  clusterBreakWorld?: number;
}): {
  nearest: AxisSnapBuckets;
} {
  const nearest = createEmptySnapBuckets();
  const minOffset = createMinOffset(thresholdWorld, enabledAxis);

  if (settings.points.enabled) {
    collectPointSnaps({
      selectionPoints: selection.snapPoints,
      referencePoints: context.referencePoints,
      minOffset,
      nearest,
      kind: "point",
      enabledAxis,
      clusterBreakWorld
    });
  }

  collectGuideSnaps({
    selectionPoints: selection.snapPoints,
    guides: context.guides,
    minOffset,
    nearest,
    enabledAxis
  });

  if (settings.grid.enabled) {
    collectGridSnaps({
      selectionPoints: selection.snapPoints,
      minOffset,
      nearest,
      gridStep: pickGridStepPt(context.zoom, settings.grid.minorTargetPx),
      enabledAxis
    });
  }

  if (includeGaps && settings.gaps.enabled) {
    collectGapSnaps({
      selectionBounds: selection.bounds,
      visibleGaps: context.visibleGaps,
      minOffset,
      nearest,
      enabledAxis
    });
  }

  return { nearest };
}

function collectPointAndGridSnaps({
  context,
  settings,
  selectionPoints,
  referencePoints,
  enabledAxis,
  thresholdWorld,
  clusterBreakWorld
}: {
  context: SnapContext;
  settings: SnapSettings;
  selectionPoints: WorldPoint[];
  referencePoints: WorldPoint[];
  enabledAxis?: Axis | null;
  thresholdWorld: number;
  clusterBreakWorld?: number;
}): {
  nearest: AxisSnapBuckets;
} {
  const nearest = createEmptySnapBuckets();
  const minOffset = createMinOffset(thresholdWorld, enabledAxis);

  if (settings.points.enabled) {
    collectPointSnaps({
      selectionPoints,
      referencePoints,
      minOffset,
      nearest,
      kind: "point",
      enabledAxis,
      clusterBreakWorld
    });
  }

  collectGuideSnaps({
    selectionPoints,
    guides: context.guides,
    minOffset,
    nearest,
    enabledAxis
  });

  if (settings.grid.enabled) {
    collectGridSnaps({
      selectionPoints,
      minOffset,
      nearest,
      gridStep: pickGridStepPt(context.zoom, settings.grid.minorTargetPx),
      enabledAxis
    });
  }

  return {
    nearest
  };
}

function collectGapCandidates(nearest: AxisSnapBuckets): GapSnapCandidate[] {
  return [...nearest.x, ...nearest.y].filter((snap): snap is GapSnapCandidate => snap.kind === "gap");
}

function shouldBypassSnapping(settings: SnapSettings, modifiers?: { ctrlOrMeta: boolean }): boolean {
  return settings.bypassWithCtrlOrMeta && Boolean(modifiers?.ctrlOrMeta);
}

function effectiveSettings(context: SnapContext, patch?: SnapSettingsPatch): SnapSettings {
  return resolveSnapSettings(patch, context.settings);
}
