import { applyEditAction, type EditActionResult } from "@tikz-editor/core/edit/actions";
import { cleanupIdiomaticPropertyWrites } from "@tikz-editor/core/edit/property-write-planner";
import { maskSourceOutsideSpan } from "@tikz-editor/core/document/masking";
import { applySourcePatches } from "@tikz-editor/core/edit/source-patches";
import { computeMinimalReplacementPatch } from "@tikz-editor/core/edit/patch";
import type { PropertyCleanupTask } from "./property-cleanup-request";

/** Runs in the cleanup worker. Keep the conservative edit if certification fails. */
export function certifyPropertyCleanup(task: PropertyCleanupTask): EditActionResult | null {
  const original = task.originalSource ?? task.source;
  const editSource = task.nestedFigureSpan ? maskSourceOutsideSpan(original, task.nestedFigureSpan) : original;
  const parseOptions = { activeFigureId: task.activeFigureId };
  const result = task.properties
    ? applyEditAction(editSource, [], { kind: "setProperties", actions: task.properties }, { parseOptions })
    : cleanupIdiomaticPropertyWrites(editSource, { ...parseOptions, propertyWriteMode: "drag-end" }, task.elementIds);
  if (result.kind !== "success" && result.kind !== "partial") return null;
  const replay = applySourcePatches(original, result.patches);
  if (replay.kind !== "success" || replay.source === task.source) return null;
  return { ...result, newSource: replay.source,
    patches: [computeMinimalReplacementPatch(task.source, replay.source)], changedSourceIds: task.elementIds };
}
