import type { EditHandle } from "../semantic/types.js";
import type { WorldPoint } from "../coords/points.js";
import { worldPoint } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import { createSemanticEvaluationRun, evaluateSemanticStatementByIndex } from "../semantic/evaluate.js";
import { restoreSemanticContext, snapshotSemanticContext } from "../semantic/context.js";
import type { EditGeometrySession } from "./geometry-session.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { replaceSpan } from "./patch.js";
import { rewriteCoordinate } from "./rewrite.js";

/** Keep dependent calc points at their requested positions when their bases move too. */
export function correctMovedCalcDependencies(
  source: string,
  updatedSource: string,
  handles: readonly EditHandle[],
  deltas: ReadonlyMap<string, WorldPoint>,
  parseOptions: EditParseOptions,
  geometry?: EditGeometrySession
): string | null {
  const selectedHandles = handles.filter(handle => deltas.has(handle.sourceRef.sourceId));
  const calcHandles = selectedHandles.filter(handle => handle.rewriteMode === "calc")
    .sort((left, right) => left.sourceRef.sourceSpan.from - right.sourceRef.sourceSpan.from);
  if (calcHandles.some(handle => handles.some(other => other.id !== handle.id &&
    other.sourceRef.sourceSpan.from === handle.sourceRef.sourceSpan.from &&
    other.sourceRef.sourceSpan.to === handle.sourceRef.sourceSpan.to))) return null;
  if (calcHandles.length === 0 || (deltas.size === 1 && selectedHandles.length === 1)) return updatedSource;
  const key = JSON.stringify([[...deltas.keys()].sort(), selectedHandles.map(handle => handle.id)]);
  let cache = geometry ? replayBaselines.get(geometry) : undefined;
  if (geometry && !cache) {
    cache = new Map();
    replayBaselines.set(geometry, cache);
  }
  let baseline = cache?.get(key);
  if (!baseline) {
    baseline = prepareBaseline(source, selectedHandles, calcHandles, deltas, parseOptions);
    if (!baseline) return null;
    cache?.set(key, baseline);
  }
  const newRun = (text: string) => createSemanticEvaluationRun(parseTikzForEdit(text, parseOptions).figure, text);
  let currentSource = updatedSource;
  let run = newRun(currentSource);
  if (run.expandedFigureBody.map(statement => statement.id).join("\n") !== baseline.statementIds) return null;
  restoreSemanticContext(run.context, baseline.checkpoint, { editHandleSource: baseline.prefixHandles });
  let index = baseline.firstIndex;
  let beforeStatement = baseline.checkpoint;
  let beforeHandles = baseline.prefixHandles;
  for (const original of calcHandles) {
    const targetIndex = baseline.indices.get(original.id)!;
    for (; index <= targetIndex; index++) {
      beforeStatement = snapshotSemanticContext(run.context, { editHandlesMode: "length" });
      beforeHandles = run.context.editHandles.slice();
      evaluateSemanticStatementByIndex(run, index);
    }
    const delta = deltas.get(original.sourceRef.sourceId)!;
    const originalGeometry = baseline.handles.find(handle => handle.id === original.id);
    const currentGeometry = run.context.editHandles.find(handle => handle.id === original.id);
    if (!originalGeometry || currentGeometry?.rewriteMode !== "calc") return null;
    // Both measurements use the same evaluator, so native text metrics do not
    // introduce offsets when a calc expression refers to a named node anchor.
    const target = worldPoint(pt(originalGeometry.world.x + delta.x), pt(originalGeometry.world.y + delta.y));
    const replacement = rewriteCoordinate(target, currentGeometry, currentSource);
    if (replacement == null) return null;
    const next = replaceSpan(currentSource, currentGeometry.sourceRef.sourceSpan, replacement).source;
    if (next === currentSource) continue;
    currentSource = next;
    run = newRun(currentSource);
    restoreSemanticContext(run.context, beforeStatement, { editHandleSource: beforeHandles });
    index = targetIndex;
  }
  return currentSource;
}

/** Preserve the unchanged prefix once per gesture; never evaluate the unrelated suffix. */
function prepareBaseline(source: string, selected: readonly EditHandle[], calc: readonly EditHandle[], deltas: ReadonlyMap<string, WorldPoint>, parseOptions: EditParseOptions) {
  const run = createSemanticEvaluationRun(parseTikzForEdit(source, parseOptions).figure, source);
  const indices = new Map(selected.map(handle => [handle.id, run.expandedFigureBody.findIndex(statement => {
    if (run.scopeSteps.has(statement)) return false;
    const span = run.sourceStatementSpanById.get(statement.id) ?? statement.span;
    return span.from <= handle.sourceRef.sourceSpan.from && span.to >= handle.sourceRef.sourceSpan.to;
  })]));
  if ([...indices.values()].some(index => index < 0)) return;
  // A moved ancestor changes the frame in which its children are evaluated.
  // Restore before that scope's entry, not inside its old transform.
  const movedScopes = run.expandedFigureBody.flatMap((statement, index) =>
    run.scopeSteps.get(statement) === "enter" && deltas.has(statement.id) ? [index] : []);
  const firstIndex = Math.min(...indices.values(), ...movedScopes);
  const lastIndex = Math.max(...calc.map(handle => indices.get(handle.id)!));
  for (let i = 0; i < firstIndex; i++) evaluateSemanticStatementByIndex(run, i);
  const checkpoint = snapshotSemanticContext(run.context, { editHandlesMode: "length" });
  const prefixHandles = run.context.editHandles.slice();
  for (let i = firstIndex; i <= lastIndex; i++) evaluateSemanticStatementByIndex(run, i);
  return { indices, firstIndex, checkpoint, prefixHandles, handles: run.context.editHandles.slice(),
    statementIds: run.expandedFigureBody.map(statement => statement.id).join("\n") };
}
const replayBaselines = new WeakMap<EditGeometrySession, Map<string, NonNullable<ReturnType<typeof prepareBaseline>>>>();
