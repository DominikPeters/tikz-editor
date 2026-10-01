import type { ParseTikzResult } from "../parser/index.js";
import type { EvaluateOptions, SceneElement } from "../semantic/types.js";
import {
  createSemanticEvaluationRun,
  getGeometryCheckpoints,
  evaluateSemanticStatementByIndex,
  type EvaluateTikzResult
} from "../semantic/evaluate.js";
import { restoreSemanticContext, snapshotSemanticContext } from "../semantic/context.js";
import { collectSourceWorldBounds } from "./snapping/geometry.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";

export type EditGeometrySnapshot = {
  source: string;
  parsed: ParseTikzResult;
  semantic: EvaluateTikzResult;
};

/** Geometry owned by one interaction, never shared with a later source revision. */
export type EditGeometrySession = EditGeometrySnapshot & {
  boundsBySource: ReturnType<typeof collectSourceWorldBounds>;
  prepare: (sourceId: string) => void;
  measure: (source: string, sourceId: string) => SceneElement[];
};

/**
 * Reuse the rendered snapshot for direct edits. Layout-dependent edits replay
 * only the containing statement, with its original styles, symbols and RNG state.
 * Ordinary scopes have explicit entry/exit steps, so nested nodes replay alone.
 * Expanded templates remain atomic. Candidate sources must only change that unit.
 */
export function createEditGeometrySession(
  snapshot: EditGeometrySnapshot,
  evaluateOptions: EvaluateOptions = {},
  parseOptions: EditParseOptions = {}
): EditGeometrySession {
  let boundsBySource: EditGeometrySession["boundsBySource"] | undefined;
  const evaluators = new Map<number, (source: string) => SceneElement[]>();
  const statementIndex = (sourceId: string): number | undefined => {
    const direct = snapshot.semantic.sourceStatementFirstIndexBySourceId[sourceId];
    if (direct != null) return direct;
    const ref = snapshot.semantic.editHandles.find(handle => handle.sourceRef.sourceId === sourceId)?.sourceRef
      ?? snapshot.semantic.scene.elements.find(element => element.sourceRef.sourceId === sourceId)?.sourceRef;
    if (!ref) return;
    const owner = snapshot.parsed.figure.body.find(statement =>
      statement.span.from <= ref.sourceSpan.from && statement.span.to >= ref.sourceSpan.to);
    return owner ? snapshot.semantic.sourceStatementFirstIndexBySourceId[owner.id] : undefined;
  };
  const prepare = (sourceId: string) => {
    const index = statementIndex(sourceId);
    if (index == null) throw new Error(`No statement geometry for ${sourceId}`);
    if (evaluators.has(index)) return;
    const baseline = createSemanticEvaluationRun(snapshot.parsed.figure, snapshot.source, evaluateOptions);
    const statement = baseline.expandedFigureBody[index];
    if (!statement) throw new Error(`No statement at geometry index ${index}`);
    const checkpoints = getGeometryCheckpoints(snapshot.semantic);
    const restoreIndex = checkpoints ? Math.max(-1, ...[...checkpoints.keys()].filter(i => i <= index)) : -1;
    if (restoreIndex >= 0) restoreSemanticContext(baseline.context, checkpoints!.get(restoreIndex)!, { editHandleSource: snapshot.semantic.editHandles });
    for (let i = Math.max(0, restoreIndex); i < index; i++) evaluateSemanticStatementByIndex(baseline, i);
    const checkpoint = snapshotSemanticContext(baseline.context, { editHandlesMode: "length" });
    const prefixHandles = baseline.context.editHandles.slice();
    const sourceSpan = baseline.sourceStatementSpanById.get(statement.id) ?? statement.span;
    const prefix = snapshot.source.slice(0, sourceSpan.from);
    const suffix = snapshot.source.slice(sourceSpan.to);
    const cache = new Map<string, SceneElement[]>();
    evaluators.set(index, (source) => {
      const cached = cache.get(source);
      if (cached) return cached;
      if (!source.startsWith(prefix) || !source.endsWith(suffix) || source.length < prefix.length + suffix.length) {
        throw new Error("Prepared geometry cannot measure edits outside its statement.");
      }
      const parsed = parseTikzForEdit(source, { ...parseOptions, analysisSession: null, analysisView: null });
      const run = createSemanticEvaluationRun(parsed.figure, source, evaluateOptions);
      run.captureGeometryCheckpoints = false;
      if (run.expandedFigureBody[index]?.id !== statement.id) {
        throw new Error("Prepared geometry cannot measure a structural edit.");
      }
      restoreSemanticContext(run.context, checkpoint, { editHandleSource: prefixHandles });
      const elements = evaluateSemanticStatementByIndex(run, index).elements;
      if (run.scopeSteps.get(run.expandedFigureBody[index]) === "enter") {
        for (let i = index + 1; i < run.expandedFigureBody.length; i++) {
          elements.push(...evaluateSemanticStatementByIndex(run, i).elements);
          if (run.expandedFigureBody[i].id === `${statement.id}:leave`) break;
        }
      }
      // Node resize tries several candidates per frame. Keep recent candidates,
      // without retaining every source string for the lifetime of a long drag.
      if (cache.size >= 24) cache.delete(cache.keys().next().value!);
      cache.set(source, elements);
      return elements;
    });
  };
  return {
    ...snapshot,
    get boundsBySource() { return boundsBySource ??= collectSourceWorldBounds(snapshot.semantic.scene.elements); },
    prepare,
    measure(source, sourceId) {
      if (source === snapshot.source) return snapshot.semantic.scene.elements;
      prepare(sourceId);
      return evaluators.get(statementIndex(sourceId)!)!(source);
    }
  };
}
