import { requireArrayValue } from "../utils/collections.js";
import { worldBounds, worldPoint } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import type { WorldBounds, WorldPoint } from "../coords/points.js";

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

export type DistributeAxis = "horizontal" | "vertical";

export type SourceBounds = WorldBounds & {
  sourceId: string;
};

export type ArrangePlanResult =
  | { kind: "success"; deltas: Map<string, WorldPoint> }
  | { kind: "unsupported"; reason: string };

const DEFAULT_EPSILON = 1e-6;

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

function wb(minX: number, minY: number, maxX: number, maxY: number): WorldBounds {
  return worldBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

export function planAlignDeltas(
  boundsBySource: ReadonlyMap<string, WorldBounds>,
  selectedSourceIds: readonly string[],
  mode: AlignMode,
  epsilon: number = DEFAULT_EPSILON
): ArrangePlanResult {
  const normalized = normalizeSourceIds(selectedSourceIds);
  if (normalized.length < 2) {
    return { kind: "unsupported", reason: "Align requires at least 2 selected elements." };
  }

  const selectedBounds = resolveSelectedBounds(boundsBySource, normalized);
  if (selectedBounds.kind !== "success") {
    return selectedBounds;
  }

  const selectionBounds = mergeSourceBounds(selectedBounds.value);
  const deltas = new Map<string, WorldPoint>();

  for (const entry of selectedBounds.value) {
    const centerX = (entry.minX + entry.maxX) / 2;
    const centerY = (entry.minY + entry.maxY) / 2;
    const targetX =
      mode === "left"
        ? selectionBounds.minX
        : mode === "center"
          ? (selectionBounds.minX + selectionBounds.maxX) / 2
          : mode === "right"
            ? selectionBounds.maxX
            : centerX;
    const targetY =
      mode === "bottom"
        ? selectionBounds.minY
        : mode === "middle"
          ? (selectionBounds.minY + selectionBounds.maxY) / 2
          : mode === "top"
            ? selectionBounds.maxY
            : centerY;

    const dx =
      mode === "left"
        ? targetX - entry.minX
        : mode === "center"
          ? targetX - centerX
          : mode === "right"
            ? targetX - entry.maxX
            : 0;
    const dy =
      mode === "bottom"
        ? targetY - entry.minY
        : mode === "middle"
          ? targetY - centerY
          : mode === "top"
            ? targetY - entry.maxY
            : 0;

    deltas.set(entry.sourceId, wp(Math.abs(dx) <= epsilon ? 0 : dx, Math.abs(dy) <= epsilon ? 0 : dy));
  }

  if (allZeroDeltas(deltas, epsilon)) {
    return { kind: "unsupported", reason: "Selection is already aligned for this mode." };
  }

  return { kind: "success", deltas };
}

export function planDistributeDeltas(
  boundsBySource: ReadonlyMap<string, WorldBounds>,
  selectedSourceIds: readonly string[],
  axis: DistributeAxis,
  epsilon: number = DEFAULT_EPSILON
): ArrangePlanResult {
  const normalized = normalizeSourceIds(selectedSourceIds);
  if (normalized.length < 3) {
    return { kind: "unsupported", reason: "Distribute requires at least 3 selected elements." };
  }

  const selectedBounds = resolveSelectedBounds(boundsBySource, normalized);
  if (selectedBounds.kind !== "success") {
    return selectedBounds;
  }

  const order = new Map<string, number>();
  for (let index = 0; index < normalized.length; index += 1) {
    order.set(requireArrayValue(normalized, index), index);
  }

  const sorted = [...selectedBounds.value].sort((left, right) => {
    if (axis === "horizontal") {
      const primary = left.minX - right.minX;
      if (Math.abs(primary) > epsilon) {
        return primary;
      }
    } else {
      const primary = right.maxY - left.maxY;
      if (Math.abs(primary) > epsilon) {
        return primary;
      }
    }

    return order.get(left.sourceId)! - order.get(right.sourceId)!;
  });

  const deltas = new Map<string, WorldPoint>();

  if (axis === "horizontal") {
    const first = requireArrayValue(sorted, 0);
    const last = requireArrayValue(sorted, sorted.length - 1);
    const totalSpan = last.maxX - first.minX;
    const totalWidth = sorted.reduce((sum, entry) => sum + (entry.maxX - entry.minX), 0);
    const gap = (totalSpan - totalWidth) / (sorted.length - 1);

    deltas.set(first.sourceId, wp(0, 0));
    deltas.set(last.sourceId, wp(0, 0));

    let cursor = first.maxX + gap;
    for (let index = 1; index < sorted.length - 1; index += 1) {
      const entry = requireArrayValue(sorted, index);
      const targetMinX = cursor;
      const dx = targetMinX - entry.minX;
      deltas.set(entry.sourceId, wp(Math.abs(dx) <= epsilon ? 0 : dx, 0));
      cursor = targetMinX + (entry.maxX - entry.minX) + gap;
    }
  } else {
    const top = requireArrayValue(sorted, 0);
    const bottom = requireArrayValue(sorted, sorted.length - 1);
    const totalSpan = top.maxY - bottom.minY;
    const totalHeight = sorted.reduce((sum, entry) => sum + (entry.maxY - entry.minY), 0);
    const gap = (totalSpan - totalHeight) / (sorted.length - 1);

    deltas.set(top.sourceId, wp(0, 0));
    deltas.set(bottom.sourceId, wp(0, 0));

    let previousTargetMinY: number = top.minY;
    for (let index = 1; index < sorted.length - 1; index += 1) {
      const entry = requireArrayValue(sorted, index);
      const targetMaxY = previousTargetMinY - gap;
      const height = entry.maxY - entry.minY;
      const targetMinY = targetMaxY - height;
      const dy = targetMinY - entry.minY;
      deltas.set(entry.sourceId, wp(0, Math.abs(dy) <= epsilon ? 0 : dy));
      previousTargetMinY = targetMinY;
    }
  }

  if (allZeroDeltas(deltas, epsilon)) {
    return { kind: "unsupported", reason: "Selection is already evenly distributed for this axis." };
  }

  return { kind: "success", deltas };
}

function resolveSelectedBounds(
  boundsBySource: ReadonlyMap<string, WorldBounds>,
  selectedSourceIds: readonly string[]
): { kind: "success"; value: SourceBounds[] } | { kind: "unsupported"; reason: string } {
  const selected: SourceBounds[] = [];
  for (const sourceId of selectedSourceIds) {
    const bounds = boundsBySource.get(sourceId);
    if (!bounds) {
      return {
        kind: "unsupported",
        reason: `Could not resolve geometry bounds for selected element: ${sourceId}`
      };
    }
    selected.push({ ...wb(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY), sourceId });
  }
  return { kind: "success", value: selected };
}

function mergeSourceBounds(boundsList: readonly SourceBounds[]): WorldBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const bounds of boundsList) {
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }

  return wb(minX, minY, maxX, maxY);
}

function normalizeSourceIds(sourceIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of sourceIds) {
    const id = raw.trim();
    if (id.length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

function allZeroDeltas(deltas: ReadonlyMap<string, WorldPoint>, epsilon: number): boolean {
  for (const delta of deltas.values()) {
    if (Math.abs(delta.x) > epsilon || Math.abs(delta.y) > epsilon) {
      return false;
    }
  }
  return true;
}
