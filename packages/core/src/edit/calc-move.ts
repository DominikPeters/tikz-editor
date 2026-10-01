import type { EditHandle } from "../semantic/types.js";
import type { WorldPoint } from "../coords/points.js";
import { worldPoint } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { replaceSpan } from "./patch.js";
import { rewriteCoordinate } from "./rewrite.js";

/** Keep dependent calc points at their requested positions when their bases move too. */
export function correctMovedCalcDependencies(
  source: string,
  updatedSource: string,
  handles: readonly EditHandle[],
  deltas: ReadonlyMap<string, WorldPoint>,
  parseOptions: EditParseOptions
): string | null {
  const selectedHandles = handles.filter(handle => deltas.has(handle.sourceRef.sourceId));
  const calcHandles = selectedHandles.filter(handle => handle.rewriteMode === "calc")
    .sort((left, right) => left.sourceRef.sourceSpan.from - right.sourceRef.sourceSpan.from);
  if (calcHandles.some(handle => handles.some(other => other.id !== handle.id &&
    other.sourceRef.sourceSpan.from === handle.sourceRef.sourceSpan.from &&
    other.sourceRef.sourceSpan.to === handle.sourceRef.sourceSpan.to))) return null;
  if (calcHandles.length === 0 || (deltas.size === 1 && selectedHandles.length === 1)) return updatedSource;
  const before = parseTikzForEdit(source, parseOptions);
  const baseline = evaluateTikzFigure(before.figure, source);
  let currentSource = updatedSource;
  for (const original of calcHandles) {
    const delta = deltas.get(original.sourceRef.sourceId)!;
    const originalGeometry = baseline.editHandles.find(handle => handle.id === original.id);
    const parsed = parseTikzForEdit(currentSource, parseOptions);
    const currentGeometry = evaluateTikzFigure(parsed.figure, currentSource).editHandles.find(handle => handle.id === original.id);
    if (!originalGeometry || currentGeometry?.rewriteMode !== "calc") return null;
    // Compare geometry from the same evaluator on both sources. This cancels
    // differences from the caller's native text metrics for named node anchors.
    const target = worldPoint(pt(originalGeometry.world.x + delta.x), pt(originalGeometry.world.y + delta.y));
    const replacement = rewriteCoordinate(target, currentGeometry, currentSource);
    if (replacement == null) return null;
    currentSource = replaceSpan(currentSource, currentGeometry.sourceRef.sourceSpan, replacement).source;
  }
  return currentSource;
}
