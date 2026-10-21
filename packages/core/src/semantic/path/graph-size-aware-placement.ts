import { requireArrayValue } from "../../utils/collections.js";
import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint } from "../../coords/points.js";
import type { NodeItem, PathStatement } from "../../ast/types.js";
import type { ResolvedStyle } from "../types.js";
import type { SemanticContext } from "../context.js";
import { measureNodeAnchorExtents } from "../nodes/evaluate.js";
import type { GraphPlacementHint } from "./graph.js";

type GraphVector2 = {
  x: number;
  y: number;
};

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

export type RuntimeGraphNode = {
  syntheticNode: NodeItem;
  defaultPoint: WorldPoint;
  placementHint?: GraphPlacementHint;
  nodeIndex: number;
};

type AxisSupport = {
  forward: number;
  backward: number;
};

export function resolveSizeAwareGraphNodePoints(
  runtimeNodes: RuntimeGraphNode[],
  statement: PathStatement,
  context: SemanticContext,
  style: ResolvedStyle
): Map<number, WorldPoint> {
  const resolved = new Map<number, WorldPoint>();
  if (runtimeNodes.length === 0) {
    return resolved;
  }

  const hintedNodes = runtimeNodes.filter((node): node is RuntimeGraphNode & { placementHint: GraphPlacementHint } => Boolean(node.placementHint));
  if (hintedNodes.length !== runtimeNodes.length) {
    return resolved;
  }

  const baseHint = requireArrayValue(hintedNodes, 0).placementHint;
  if (baseHint.mode !== "cartesian" && baseHint.mode !== "grid") {
    return resolved;
  }
  if (baseHint.chainSepDistance == null && baseHint.groupSepDistance == null) {
    return resolved;
  }
  if (!hintedNodes.every((node) => placementHintsCompatible(baseHint, node.placementHint))) {
    return resolved;
  }

  const chainUnit = normalizeVector(baseHint.chainShift);
  const groupUnit = normalizeVector(baseHint.groupShift);
  if (!chainUnit || !groupUnit) {
    return resolved;
  }

  const chainStep = Math.max(1e-3, Math.hypot(baseHint.chainShift.x, baseHint.chainShift.y));
  const groupStep = Math.max(1e-3, Math.hypot(baseHint.groupShift.x, baseHint.groupShift.y));
  const chainSep = baseHint.chainSepDistance;
  const groupSep = baseHint.groupSepDistance;

  const measured = hintedNodes.map((node) => ({
    node,
    extents: measureNodeAnchorExtents(node.syntheticNode, statement, context, style)
  }));

  const columnKeys = sortedUnique(measured.map((entry) => entry.node.placementHint.logicalWidth));
  const rowKeys = sortedUnique(measured.map((entry) => entry.node.placementHint.logicalDepth));

  const columnExtent = new Map<number, AxisSupport>();
  const rowExtent = new Map<number, AxisSupport>();
  for (const entry of measured) {
    const widthKey = entry.node.placementHint.logicalWidth;
    const depthKey = entry.node.placementHint.logicalDepth;
    const projectedChain = projectedAxisSupport(chainUnit, entry.extents);
    const projectedGroup = projectedAxisSupport(groupUnit, entry.extents);
    const existingColumn = columnExtent.get(widthKey);
    const existingRow = rowExtent.get(depthKey);
    columnExtent.set(widthKey, mergeAxisSupport(existingColumn, projectedChain));
    rowExtent.set(depthKey, mergeAxisSupport(existingRow, projectedGroup));
  }

  const columnOffset = buildAxisOffsets(columnKeys, columnExtent, chainSep, chainStep);
  const rowOffset = buildAxisOffsets(rowKeys, rowExtent, groupSep, groupStep);

  const anchorNode = requireArrayValue(measured, 0).node;
  const anchorColOffset = columnOffset.get(anchorNode.placementHint.logicalWidth) ?? 0;
  const anchorRowOffset = rowOffset.get(anchorNode.placementHint.logicalDepth) ?? 0;
  const anchorComputed = {
    x: chainUnit.x * anchorColOffset + groupUnit.x * anchorRowOffset,
    y: chainUnit.y * anchorColOffset + groupUnit.y * anchorRowOffset
  };
  const translation = {
    x: anchorNode.defaultPoint.x - anchorComputed.x,
    y: anchorNode.defaultPoint.y - anchorComputed.y
  };

  for (const entry of measured) {
    const col = columnOffset.get(entry.node.placementHint.logicalWidth) ?? 0;
    const row = rowOffset.get(entry.node.placementHint.logicalDepth) ?? 0;
    resolved.set(
      entry.node.nodeIndex,
      wp(
        chainUnit.x * col + groupUnit.x * row + translation.x,
        chainUnit.y * col + groupUnit.y * row + translation.y
      )
    );
  }

  return resolved;
}

function placementHintsCompatible(left: GraphPlacementHint, right: GraphPlacementHint): boolean {
  return (
    left.mode === right.mode &&
    left.chainSepDistance === right.chainSepDistance &&
    left.groupSepDistance === right.groupSepDistance &&
    Math.abs(left.chainShift.x - right.chainShift.x) <= 1e-6 &&
    Math.abs(left.chainShift.y - right.chainShift.y) <= 1e-6 &&
    Math.abs(left.groupShift.x - right.groupShift.x) <= 1e-6 &&
    Math.abs(left.groupShift.y - right.groupShift.y) <= 1e-6
  );
}

function normalizeVector(vector: GraphVector2): GraphVector2 | null {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 1e-6) {
    return null;
  }
  return {
    x: vector.x / length,
    y: vector.y / length
  };
}

function projectedAxisSupport(
  axis: GraphVector2,
  extents: { left: number; right: number; up: number; down: number }
): AxisSupport {
  const absX = Math.abs(axis.x);
  const absY = Math.abs(axis.y);

  const horizontalForward = axis.x >= 0 ? extents.right : extents.left;
  const horizontalBackward = axis.x >= 0 ? extents.left : extents.right;
  const verticalForward = axis.y >= 0 ? extents.up : extents.down;
  const verticalBackward = axis.y >= 0 ? extents.down : extents.up;

  return {
    forward: horizontalForward * absX + verticalForward * absY,
    backward: horizontalBackward * absX + verticalBackward * absY
  };
}

function mergeAxisSupport(existing: AxisSupport | undefined, next: AxisSupport): AxisSupport {
  if (!existing) {
    return { ...next };
  }
  return {
    forward: Math.max(existing.forward, next.forward),
    backward: Math.max(existing.backward, next.backward)
  };
}

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function buildAxisOffsets(
  keys: number[],
  extentByKey: Map<number, AxisSupport>,
  sepDistance: number | null,
  fallbackStep: number
): Map<number, number> {
  const offsets = new Map<number, number>();
  if (keys.length === 0) {
    return offsets;
  }

  offsets.set(requireArrayValue(keys, 0), 0);
  for (let index = 1; index < keys.length; index += 1) {
    const previousKey = requireArrayValue(keys, index - 1);
    const currentKey = requireArrayValue(keys, index);
    const previousOffset = offsets.get(previousKey) ?? 0;
    const keyGap = Math.max(1, currentKey - previousKey);

    let delta = fallbackStep * keyGap;
    if (sepDistance != null) {
      const previousExtent = extentByKey.get(previousKey);
      const currentExtent = extentByKey.get(currentKey);
      const previousForward = previousExtent?.forward ?? 0;
      const currentBackward = currentExtent?.backward ?? 0;
      delta = previousForward + currentBackward + sepDistance;
    }

    offsets.set(currentKey, previousOffset + delta);
  }

  return offsets;
}
