import type { Statement } from "../ast/types.js";
import type { OptionEntry } from "../options/types.js";
import { frameTransform, type FrameTransform } from "../coords/transforms.js";
import {
  currentFrame,
  restoreSemanticContext,
  resolveContextColorAliasValue,
  snapshotSemanticContext,
  type SemanticContext
} from "../semantic/context.js";
import { createSemanticEvaluationRun, evaluateSemanticStatementByIndex } from "../semantic/evaluate.js";
import { evaluateRawCoordinate } from "../semantic/coords/evaluate.js";
import { extractOnBackgroundLayerOptionLayers, makeEveryOnBackgroundLayerOptionLayer } from "../semantic/backgrounds.js";
import { cloneCustomStyleRegistry } from "../semantic/style/custom-styles.js";
import { expandOptionListMacros } from "../semantic/style/macro-options.js";
import { commandDefaultStyle, resolveContextDelta } from "../semantic/style/resolve.js";
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
      const frame = currentFrame(context);
      const original = statement.options;
      const options = entries
        ? [{ span: original?.span ?? statement.span, raw: "", entries: [...entries] }]
        : original ? [original] : [];
      const expanded = expandOptionListMacros(options, frame.macroBindings, context.macroTraceCollector ?? undefined);
      const sourceRef = { sourceId: statement.id, sourceSpan: statement.span,
        sourceKind: statement.kind === "Path" ? "path-statement" : "scope-statement" };
      const customStyles = cloneCustomStyleRegistry(frame.customStyles);
      const baseStyle = statement.kind === "Path"
        ? { ...frame.style, ...commandDefaultStyle(statement.command, frame.style) }
        : frame.style;
      let resolved = resolveContextDelta(baseStyle, frame.transform, [{
        kind: statement.kind === "Path" ? "command" : "scope",
        sourceRef,
        rawOptions: expanded
      }], customStyles, (raw) => evaluateRawCoordinate(raw, context).world, frame.styleChain,
      (raw) => resolveContextColorAliasValue(context, raw));
      // Background layer styles run after the entire scope option list. An
      // authored prefix excludes this final stage; a full candidate includes it.
      if (statement.kind === "Scope" && includeScopeFinalOptions) {
        const backgroundLayers = extractOnBackgroundLayerOptionLayers(resolved.expandedOptionLists, sourceRef);
        if (backgroundLayers.length > 0) {
          const everyLayer = makeEveryOnBackgroundLayerOptionLayer(sourceRef);
          resolved = resolveContextDelta(resolved.style, resolved.transform,
            [everyLayer, ...backgroundLayers].map(layer => ({ kind: "scope", sourceRef: layer.sourceRef, rawOptions: layer.rawOptions })),
            customStyles, (raw) => evaluateRawCoordinate(raw, context).world, resolved.chain,
            (raw) => resolveContextColorAliasValue(context, raw));
        }
      }
      return asFrame(resolved.transform);
    }
  };
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
  return createStatementFrameResolver(run.context, run.expandedFigureBody[index]);
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
