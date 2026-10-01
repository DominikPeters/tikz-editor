import { pt, worldPoint, worldVector } from "@tikz-editor/core/coords/index";
import { pointerSnapLines, snapHandlePosition, type SnapContext, type SnapResult } from "@tikz-editor/core/edit/snapping";
import type { WorldPoint } from "../coords/types";
import { shouldConstrainToolCreateToSquare, type ToolCreateMode } from "../tool-config";
import { DEFAULT_GRID_TOOL_STEP_PT, resolveToolCreateCurrentWorld, snapPointDeltaToAxisStepMultiples } from "./interaction-helpers";

/** Creation constraints are applied before snapping, and validated afterwards. */
export function snapToolCreatePointer(input: {
  context: SnapContext | null;
  start: WorldPoint;
  pointer: WorldPoint;
  mode: ToolCreateMode;
  shiftKey: boolean;
  bypass: boolean;
}): SnapResult & { snappedPoint: WorldPoint } {
  const { context, start, mode, shiftKey, bypass } = input;
  const pointer = resolveToolCreateCurrentWorld(start, input.pointer, mode, shiftKey);
  const direction = shiftKey && shouldConstrainToolCreateToSquare(mode)
    ? worldVector(pt(Math.sign(pointer.x - start.x) || 1), pt(Math.sign(pointer.y - start.y) || 1)) : null;
  const snap = context ? snapHandlePosition({ context, point: pointer, direction, modifiers: { ctrlOrMeta: bypass } }) : null;
  let snappedPoint = snap?.snappedPoint ?? pointer;
  if (mode === "addGrid" && !bypass) {
    snappedPoint = snapPointDeltaToAxisStepMultiples(start, snappedPoint, DEFAULT_GRID_TOOL_STEP_PT, DEFAULT_GRID_TOOL_STEP_PT);
  }
  return {
    ...snap,
    offset: snap?.offset ?? worldPoint(pt(0), pt(0)),
    snappedPoint,
    lines: context && snap?.targets ? pointerSnapLines(context, snappedPoint, snap.targets) : []
  };
}
