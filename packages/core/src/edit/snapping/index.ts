import { retainSnapTargets, SNAP_RELEASE_RATIO } from "./retention.js";
import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint, WorldVector } from "../../coords/points.js";
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
  SelectionSnapPoint,
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
    previousTargets: input.previousTargets,
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
      : referencesExcluding(input.context, input.sourceId);

  return snapPointerWithPointsAndGrid({
    context: input.context,
    settings,
    previousTargets: input.previousTargets,
    pointer: input.point,
    direction: input.direction,
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
      previousTargets: input.previousTargets,
      pointer: input.pointer,
      referencePoints: input.context.referencePoints
    });
  }

  return snapPointerWithPointsAndGrid({
    context: input.context,
    settings,
    previousTargets: input.previousTargets,
    pointer: input.pointer,
    referencePoints: input.context.referencePoints
  });
}

function snapPointerWithPointsAndGrid({
  context,
  settings,
  pointer,
  direction,
  referencePoints,
  previousTargets
}: {
  previousTargets?: AxisSnapBuckets;
  context: SnapContext;
  settings: SnapSettings;
  pointer: SelectionSnapPoint;
  direction?: WorldVector | null;
  referencePoints: readonly WorldPoint[];
}): SnapResult {
  const thresholdWorld = settings.thresholdPx / context.zoom;
  const firstPass = collectPointAndGridSnaps({
    context,
    settings,
    selectionPoints: [pointer],
    referencePoints,
    thresholdWorld,
    clusterBreakWorld: SNAP_CLUSTER_BREAK_PX / context.zoom
  });

  retainSnapTargets(firstPass.nearest, previousTargets, context, settings, [pointer]);
  let offset = pointSnapOffset(firstPass.nearest);
  if (direction) {
    // Independent x/y offsets would leave the permitted resize line. Choose
    // the nearest reachable target and solve the other coordinate along it.
    offset = worldPoint(pt(0), pt(0));
    let nearestDistance = Number.POSITIVE_INFINITY;
    const length = Math.hypot(direction.x, direction.y);
    for (const axis of ["x", "y"] as const) {
      if (Math.abs(direction[axis]) <= SNAP_EPSILON * length) continue;
      for (const candidate of firstPass.nearest[axis]) {
        const step = candidate.offset / direction[axis];
        const distance = Math.abs(step) * length;
        const retained = previousTargets?.[axis].some(target => sameSnapTarget(candidate, target));
        if (distance <= thresholdWorld * (retained ? SNAP_RELEASE_RATIO : 1) + SNAP_EPSILON && distance < nearestDistance) {
          nearestDistance = distance;
          offset = worldPoint(pt(step * direction.x), pt(step * direction.y));
        }
      }
    }
  }
  const snappedPoint = worldPoint(pt(pointer.x + offset.x), pt(pointer.y + offset.y));
  const targets = createEmptySnapBuckets();
  for (const axis of ["x", "y"] as const) {
    // A stationary edge coordinate must not pin or advertise a resize snap.
    if (direction && Math.abs(direction[axis]) <= SNAP_EPSILON * Math.hypot(direction.x, direction.y)) continue;
    targets[axis] = firstPass.nearest[axis].filter(target => Math.abs(target.offset - offset[axis]) <= SNAP_EPSILON);
  }

  return {
    offset,
    snappedPoint,
    targets,
    lines: pointerSnapLines(context, { ...snappedPoint, role: pointer.role }, targets, settings, referencePoints)
  };
}

/** Validate pointer targets against the point actually produced by an edit. */
export function pointerSnapLines(
  context: SnapContext,
  point: SelectionSnapPoint,
  targets: AxisSnapBuckets,
  settings: SnapSettings = context.settings,
  referencePoints: readonly WorldPoint[] = context.referencePoints
): SnapLine[] {
  const secondPass = collectPointAndGridSnaps({
    context,
    settings,
    selectionPoints: [point],
    referencePoints,
    thresholdWorld: 0,
    clusterBreakWorld: SNAP_CLUSTER_BREAK_PX / context.zoom
  });
  for (const axis of ["x", "y"] as const) {
    secondPass.nearest[axis] = secondPass.nearest[axis].filter(candidate =>
      targets[axis].some(target => sameSnapTarget(candidate, target))
    );
  }
  return withReferenceBounds([
    ...createPointSnapLines(secondPass.nearest),
    ...createPointerLinesForPointSnap(secondPass.nearest, point)
  ], context);
}

function runSelectionSnapPasses({
  context,
  settings,
  selection,
  includeGaps,
  enabledAxis,
  previousTargets
}: {
  previousTargets?: AxisSnapBuckets;
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

  retainSnapTargets(firstPass.nearest, previousTargets, context, settings, selection.snapPoints, selection, enabledAxis);
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

  return withReferenceBounds([...pointLines, ...gapLines], context);
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
  selectionPoints: SelectionSnapPoint[];
  referencePoints: readonly WorldPoint[];
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

function withReferenceBounds(lines: SnapLine[], context: SnapContext): SnapLine[] {
  let byId = referenceBoundsIndexes.get(context.referenceBounds);
  if (!byId) { byId = new Map(context.referenceBounds.map(bounds => [bounds.sourceId, bounds])); referenceBoundsIndexes.set(context.referenceBounds, byId); }
  return lines.map(line => ({ ...line, referenceBounds: line.referenceBounds ?? line.sourceIds?.flatMap(id => byId.get(id) ?? []) }));
}

const referenceBoundsIndexes = new WeakMap<SnapContext["referenceBounds"], Map<string, SnapContext["referenceBounds"][number]>>();
const excludedReferences = new WeakMap<SnapContext["referencePoints"], Map<string, SnapContext["referencePoints"]>>();
function referencesExcluding(context: SnapContext, sourceId: string): SnapContext["referencePoints"] {
  let exclusions = excludedReferences.get(context.referencePoints);
  if (!exclusions) { exclusions = new Map(); excludedReferences.set(context.referencePoints, exclusions); }
  let points = exclusions.get(sourceId);
  if (!points) { points = context.referencePoints.filter(point => point.sourceId !== sourceId); exclusions.set(sourceId, points); }
  return points;
}
