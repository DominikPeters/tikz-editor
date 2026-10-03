import type { EditHandle } from "../semantic/types.js";
import type { WorldPoint } from "../coords/points.js";
import { worldPoint, worldVector } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import { createSemanticEvaluationRun, evaluateSemanticStatementByIndex } from "../semantic/evaluate.js";
import { restoreSemanticContext, snapshotSemanticContext } from "../semantic/context.js";
import type { EditGeometrySession } from "./geometry-session.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { replaceSpan } from "./patch.js";
import { rewriteCoordinate } from "./rewrite.js";
import { localToSourceUnits, worldDeltaToLocalDelta } from "./coords.js";
import { PT_PER_CM } from "./format.js";

/** Resolve dependent coordinates against the already moved bases in the batch. */
export function correctMovedCoordinateDependencies(
  source: string,
  updatedSource: string,
  handles: readonly EditHandle[],
  deltas: ReadonlyMap<string, WorldPoint>,
  parseOptions: EditParseOptions,
  geometry?: EditGeometrySession,
  inheritedSourceIds: ReadonlySet<string> = new Set()
): string | null {
  const selectedHandles = handles.filter(handle => deltas.has(handle.sourceRef.sourceId));
  const dependentHandles = selectedHandles.filter(isDependentCoordinate);
  if (dependentHandles.length === 0) return updatedSource;
  const spanCounts = new Map<string, number>();
  for (const handle of handles) {
    const key = spanKey(handle);
    spanCounts.set(key, (spanCounts.get(key) ?? 0) + 1);
  }
  const key = JSON.stringify([[...deltas.keys()].sort(), selectedHandles.map(handle => handle.id)]);
  let cache = geometry ? replayBaselines.get(geometry) : undefined;
  if (geometry && !cache) {
    cache = new Map();
    replayBaselines.set(geometry, cache);
  }
  let baseline = cache?.get(key);
  if (!baseline) {
    baseline = prepareBaseline(source, selectedHandles, dependentHandles, deltas, parseOptions);
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
  let currentHandlesById = new Map<string, EditHandle>();
  // Curve controls do not advance the path's current point, and a relative
  // second control depends on its endpoint. Resolve the endpoints first in
  // each statement, then the controls, regardless of their source order.
  const orderedHandles = [...dependentHandles].sort((left, right) =>
    baseline.indices.get(left.id)! - baseline.indices.get(right.id)! ||
    Number(left.kind === "path-control") - Number(right.kind === "path-control") ||
    left.sourceRef.sourceSpan.from - right.sourceRef.sourceSpan.from);
  for (const original of orderedHandles) {
    const targetIndex = baseline.indices.get(original.id)!;
    for (; index <= targetIndex; index++) {
      beforeStatement = snapshotSemanticContext(run.context, { editHandlesMode: "length" });
      beforeHandles = run.context.editHandles.slice();
      const record = evaluateSemanticStatementByIndex(run, index);
      currentHandlesById = new Map(record.editHandles.map(handle => [handle.id, handle]));
    }
    const originalGeometry = baseline.handlesById.get(original.id);
    const currentGeometry = currentHandlesById.get(original.id);
    if (!originalGeometry || !currentGeometry || !isDependentCoordinate(currentGeometry)) return null;
    const originalFrame = originalGeometry.frame ?? originalGeometry.transform;
    const currentFrame = currentGeometry.frame ?? currentGeometry.transform;
    // A scope's option writer can round its shift in pt, including through
    // transformed prefixes. Its children share that actual frame translation;
    // chasing the unrepresentable requested delta would deform them. Named
    // references still need correction if they did not follow the frame.
    const delta = inheritedSourceIds.has(original.sourceRef.sourceId)
      ? worldPoint(pt(currentFrame.e - originalFrame.e), pt(currentFrame.f - originalFrame.f))
      : deltas.get(original.sourceRef.sourceId)!;
    // Both measurements use the same evaluator, so native text metrics do not
    // introduce offsets when a calc expression refers to a named node anchor.
    const target = worldPoint(pt(originalGeometry.world.x + delta.x), pt(originalGeometry.world.y + delta.y));
    if (Math.hypot(target.x - currentGeometry.world.x, target.y - currentGeometry.world.y) < 1e-8) continue;
    // A direct base is rounded to .01cm by the coordinate writer. Preserve
    // relative vectors when only that unrepresentable residual remains;
    // rounding each dependent vector would deform long, precise chains.
    if (currentGeometry.rewriteMode === "delta") {
      const residual = worldDeltaToLocalDelta(worldVector(
        pt(target.x - currentGeometry.world.x), pt(target.y - currentGeometry.world.y)
      ), currentGeometry.frame);
      if (residual) {
        const cm = localToSourceUnits(residual);
        if (Math.abs(cm.x) < .005 + 1e-9 && Math.abs(cm.y) < .005 + 1e-9) continue;
      }
    }
    if (currentGeometry.handleType === "node-positioning" &&
      Math.abs(target.x - currentGeometry.world.x) < .005 * PT_PER_CM + 1e-8 &&
      Math.abs(target.y - currentGeometry.world.y) < .005 * PT_PER_CM + 1e-8) continue;
    // Generated instances may share an authored span. A selected scope can
    // still carry all of them safely when their inherited movement is already
    // correct; only an actual coordinate rewrite requires unique ownership.
    if (spanCounts.get(spanKey(original))! > 1) return null;
    const replacement = rewriteCoordinate(target, currentGeometry, currentSource, parseOptions.bypassSnapping);
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

function isDependentCoordinate(handle: EditHandle): boolean {
  return handle.rewriteMode === "calc" || handle.rewriteMode === "delta" || handle.handleType === "node-positioning";
}

function spanKey(handle: EditHandle): string {
  return `${handle.sourceRef.sourceSpan.from}:${handle.sourceRef.sourceSpan.to}`;
}

/** Preserve the unchanged prefix once per gesture; never evaluate the unrelated suffix. */
function prepareBaseline(source: string, selected: readonly EditHandle[], dependent: readonly EditHandle[], deltas: ReadonlyMap<string, WorldPoint>, parseOptions: EditParseOptions) {
  const run = createSemanticEvaluationRun(parseTikzForEdit(source, parseOptions).figure, source);
  const statementIndices = new Map(run.expandedFigureBody.flatMap((statement, index) =>
    run.scopeSteps.has(statement) ? [] : [[statement.id, index] as const]));
  const indices = new Map(selected.map(handle => [handle.id,
    statementIndices.get(handle.identityRef?.sourceId ?? handle.sourceRef.sourceId) ??
    statementIndices.get(handle.sourceRef.sourceId) ?? run.expandedFigureBody.findIndex(statement => {
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
  const lastIndex = Math.max(...dependent.map(handle => indices.get(handle.id)!));
  for (let i = 0; i < firstIndex; i++) evaluateSemanticStatementByIndex(run, i);
  const checkpoint = snapshotSemanticContext(run.context, { editHandlesMode: "length" });
  const prefixHandles = run.context.editHandles.slice();
  for (let i = firstIndex; i <= lastIndex; i++) evaluateSemanticStatementByIndex(run, i);
  return { indices, firstIndex, checkpoint, prefixHandles,
    handlesById: new Map(run.context.editHandles.map(handle => [handle.id, handle])),
    statementIds: run.expandedFigureBody.map(statement => statement.id).join("\n") };
}
const replayBaselines = new WeakMap<EditGeometrySession, Map<string, NonNullable<ReturnType<typeof prepareBaseline>>>>();
