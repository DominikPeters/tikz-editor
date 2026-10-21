import { buildVisibleGaps } from "./gap-snaps.js";
import { collectGeometryInvalidation } from "../../semantic/dependencies.js";
import {
  boundsIntersect,
  collectSourceReferenceBounds,
  collectSourceSnapPoints,
  expandBounds
} from "./geometry.js";
import {
  DEFAULT_SNAP_SETTINGS,
  type BuildSnapContextInput,
  type SnapBounds,
  type SnapContext,
  type SnapSettings,
  type SnapSettingsPatch
} from "./types.js";

export function resolveSnapSettings(patch?: SnapSettingsPatch, base: SnapSettings = DEFAULT_SNAP_SETTINGS): SnapSettings {
  if (!patch) {
    return {
      ...base,
      grid: { ...base.grid },
      points: { ...base.points },
      gaps: { ...base.gaps }
    };
  }

  return {
    thresholdPx: patch.thresholdPx ?? base.thresholdPx,
    grid: {
      enabled: patch.grid?.enabled ?? base.grid.enabled,
      minorTargetPx: patch.grid?.minorTargetPx ?? base.grid.minorTargetPx
    },
    points: {
      enabled: patch.points?.enabled ?? base.points.enabled
    },
    gaps: {
      enabled: patch.gaps?.enabled ?? base.gaps.enabled,
      maxPairsPerAxis: patch.gaps?.maxPairsPerAxis ?? base.gaps.maxPairsPerAxis
    },
    bypassWithCtrlOrMeta: patch.bypassWithCtrlOrMeta ?? base.bypassWithCtrlOrMeta,
    viewportPaddingPx: patch.viewportPaddingPx ?? base.viewportPaddingPx
  };
}

export function buildSnapContext(input: BuildSnapContextInput): SnapContext {
  const settings = resolveSnapSettings(input.settings);
  const zoom = Math.max(input.zoom, 1e-6);
  const selectedSet = new Set(input.selectedSourceIds);
  // Matrix cells and geometry that depends on the selection move with it.
  // They must never become stationary references at their drag-start positions.
  for (const element of input.sceneElements) {
    if (element.matrixCell && selectedSet.has(element.matrixCell.matrixSourceId)) {
      selectedSet.add(element.sourceRef.sourceId);
      selectedSet.add(element.matrixCell.cellSourceId);
    }
  }
  if (input.dependencies) {
    const affected = collectGeometryInvalidation(input.dependencies, { changedSourceIds: [...selectedSet] });
    for (const sourceId of affected.affectedSourceIds) selectedSet.add(sourceId);
  }
  const viewportWorld = input.viewportWorld ?? null;
  const viewportPaddingWorld = settings.viewportPaddingPx / zoom;
  const viewportFilter = viewportWorld ? expandBounds(viewportWorld, viewportPaddingWorld) : null;

  const sourceBounds = collectSourceReferenceBounds(input.sceneElements);
  const referenceBounds: SnapBounds[] = [];

  for (const bounds of sourceBounds.values()) {
    if (selectedSet.has(bounds.sourceId)) {
      continue;
    }

    if (viewportFilter && !boundsIntersect(bounds, viewportFilter)) {
      continue;
    }

    referenceBounds.push(bounds);
  }

  const referencePoints = collectSourceSnapPoints(referenceBounds);
  const visibleGaps = settings.gaps.enabled
    ? buildVisibleGaps(referenceBounds, settings.gaps.maxPairsPerAxis)
    : { horizontal: [], vertical: [] };
  const guides = {
    x: normalizeGuideValues(input.guides?.x),
    y: normalizeGuideValues(input.guides?.y)
  };

  return {
    zoom,
    viewportWorld,
    selectedSourceIds: [...selectedSet],
    guides,
    referencePoints,
    referenceBounds,
    visibleGaps,
    settings
  };
}

function normalizeGuideValues(values: readonly number[] | undefined): number[] {
  if (!values || values.length === 0) {
    return [];
  }

  const deduped = new Set<number>();
  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue;
    }
    deduped.add(roundGuideValue(value));
  }

  return [...deduped].sort((a, b) => a - b);
}

function roundGuideValue(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
