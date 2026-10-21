import { requireArrayValue } from "../utils/collections.js";
import type { Statement } from "../ast/types.js";
import type { OptionEntry, OptionListAst } from "../options/types.js";
import type { WorldTransform } from "../coords/transforms.js";
import type { AxisBasis } from "../semantic/coords/axis-basis.js";
import type { StyleSourceRef } from "../semantic/style-chain.js";
import { frameTransform, type FrameTransform } from "../coords/transforms.js";
import {
  currentFrame,
  restoreSemanticContext,
  resolveContextColorAliasValue,
  snapshotSemanticContext,
  type SemanticContext
} from "../semantic/context.js";
import { createSemanticEvaluationRun, evaluateSemanticStatementByIndex, resolvePathBoundary } from "../semantic/evaluate.js";
import { evaluateTransformCoordinate } from "../semantic/coords/evaluate.js";
import { extractOnBackgroundLayerOptionLayers, makeEveryOnBackgroundLayerOptionLayer } from "../semantic/backgrounds.js";
import { cloneCustomStyleRegistry } from "../semantic/style/custom-styles.js";
import { expandOptionListMacros } from "../semantic/style/macro-options.js";
import { resolveContextDelta } from "../semantic/style/resolve.js";
import type { EvaluateOptions } from "../semantic/types.js";
import type { EditGeometrySession } from "./geometry-session.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";

export type StatementFrameResolver = {
  parent: FrameTransform;
  options: (entries?: readonly OptionEntry[], includeScopeFinalOptions?: boolean) => FrameTransform | undefined;
};

/** Capture the actual entry frame, including ordered picture/scopes/styles. */
export function createStatementFrameResolver(context: SemanticContext, statement: Statement): StatementFrameResolver {
  const checkpoint = snapshotSemanticContext(context, { editHandlesMode: "length" });
  const handles = context.editHandles.slice();
  const transform = currentFrame(context).transform;
  const parent = asFrame(transform);
  return {
    parent,
    options(entries, includeScopeFinalOptions = entries == null) {
      if (statement.kind !== "Path" && statement.kind !== "Scope") return;
      restoreSemanticContext(context, checkpoint, { editHandleSource: handles });
      const original = statement.options;
      const options = entries
        ? [{ span: original?.span ?? statement.span, raw: "", entries: [...entries] }]
        : original ? [original] : [];
      const sourceRef = { sourceId: statement.id, sourceSpan: statement.span,
        sourceKind: statement.kind === "Path" ? "path-statement" : "scope-statement" } as const;
      const resolved = resolveStatementOptionState(context, statement.kind === "Path"
        ? { kind: "path", command: statement.command, options, sourceRef }
        : { kind: "scope", options, sourceRef }, includeScopeFinalOptions);
      return asFrame(resolved.transform);
    }
  };
}

/** A statement's options, as the evaluator resolves them against the current context. */
export type StatementOptionDescription =
  | { kind: "path"; command: Extract<Statement, { kind: "Path" }>["command"]; options: readonly OptionListAst[]; sourceRef: StyleSourceRef }
  | { kind: "scope"; options: readonly OptionListAst[]; sourceRef: StyleSourceRef };

/**
 * The transform and axes a statement's options produce in the current
 * context, including ordered styles and macros. Background layer styles run
 * after the entire scope option list when `includeScopeFinalOptions` is set.
 */
export function resolveStatementOptionState(
  context: SemanticContext,
  description: StatementOptionDescription,
  includeScopeFinalOptions = true
): { transform: WorldTransform; axisBasis: AxisBasis } {
  const frame = currentFrame(context);
  const expanded = expandOptionListMacros([...description.options], frame.macroBindings, context.macroTraceCollector ?? undefined);
  if (description.kind === "path") {
    // As the evaluator reads a path: `every path` styles, then the command's options.
    const { resolved } = resolvePathBoundary(frame, context, description.command, description.sourceRef,
      [{ kind: "command", sourceRef: description.sourceRef, rawOptions: expanded }]);
    return { transform: resolved.transform, axisBasis: resolved.axisBasis };
  }
  const customStyles = cloneCustomStyleRegistry(frame.customStyles);
  let resolved = resolveContextDelta(frame.style, frame.transform, [{
    kind: "scope",
    sourceRef: description.sourceRef,
    rawOptions: expanded
  }], customStyles, (raw, basis) => evaluateTransformCoordinate(raw, context, basis), frame.styleChain,
  (raw) => resolveContextColorAliasValue(context, raw), frame.axisBasis);
  if (includeScopeFinalOptions) {
    const backgroundLayers = extractOnBackgroundLayerOptionLayers(resolved.expandedOptionLists, description.sourceRef);
    if (backgroundLayers.length > 0) {
      const everyLayer = makeEveryOnBackgroundLayerOptionLayer(description.sourceRef);
      resolved = resolveContextDelta(resolved.style, resolved.transform,
        [everyLayer, ...backgroundLayers].map(layer => ({ kind: "scope", sourceRef: layer.sourceRef, rawOptions: layer.rawOptions })),
        customStyles, (raw, basis) => evaluateTransformCoordinate(raw, context, basis), resolved.chain,
        (raw) => resolveContextColorAliasValue(context, raw), resolved.axisBasis);
    }
  }
  return { transform: resolved.transform, axisBasis: resolved.axisBasis };
}

function asFrame(transform: { a: number; b: number; c: number; d: number; e: number; f: number }): FrameTransform {
  return frameTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
}

function resolveStatementFrameResolver(
  source: string,
  sourceId: string,
  parseOptions: EditParseOptions,
  evaluateOptions: EvaluateOptions
): StatementFrameResolver | undefined {
  const parsed = parseTikzForEdit(source, parseOptions);
  const run = createSemanticEvaluationRun(parsed.figure, source, evaluateOptions);
  run.captureGeometryCheckpoints = false;
  const index = run.expandedFigureBody.findIndex(statement => statement.id === sourceId);
  if (index < 0) return;
  for (let i = 0; i < index; i++) evaluateSemanticStatementByIndex(run, i);
  return createStatementFrameResolver(run.context, requireArrayValue(run.expandedFigureBody, index));
}

export function resolveStatementParentFrame(
  source: string,
  sourceId: string,
  parseOptions: EditParseOptions = {},
  geometry?: EditGeometrySession,
  evaluateOptions: EvaluateOptions = {}
): FrameTransform | undefined {
  if (geometry?.source === source) return geometry.parentFrame(sourceId);
  return resolveStatementFrameResolver(source, sourceId, parseOptions, evaluateOptions)?.parent;
}

/** Resolve an authored option prefix in its entry context, without rendering the statement. */
export function resolveStatementOptionFrame(
  source: string,
  sourceId: string,
  entries?: readonly OptionEntry[],
  parseOptions: EditParseOptions = {},
  geometry?: EditGeometrySession,
  evaluateOptions: EvaluateOptions = {},
  includeScopeFinalOptions = entries == null
): FrameTransform | undefined {
  if (geometry?.source === source) return geometry.optionFrame(sourceId, entries, includeScopeFinalOptions);
  return resolveStatementFrameResolver(source, sourceId, parseOptions, evaluateOptions)?.options(entries, includeScopeFinalOptions);
}
