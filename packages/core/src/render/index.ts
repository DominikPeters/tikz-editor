import { parseTikz } from "../parser/index.js";
import type { ParseTikzOptions, ParseTikzResult } from "../parser/index.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import type { EvaluateOptions, EvaluateTikzResult } from "../semantic/index.js";
import { emitSvg } from "../svg/emit.js";
import type { EmitSvgOptions, EmitSvgResult } from "../svg/index.js";
import { createTexNodeTextEngine } from "../text/tex-node-text-engine.js";
import type { DocumentGraphicsResolver } from "../graphics/types.js";
import type { NodeTextEngine } from "../text/types.js";
import type { TextLayoutContext } from "../text/layout-context.js";
import { runTextRenderOperation, retainSceneTextLayout } from "../text/render-scope.js";
import type { NodeItem, TikzFigure } from "../ast/types.js";
import { parseNodeParts } from "../semantic/nodes/multipart.js";

export type RenderTikzOptions = {
  parse?: ParseTikzOptions;
  evaluate?: EvaluateOptions;
  semanticEvaluator?: (
    figure: TikzFigure,
    source: string,
    options: EvaluateOptions
  ) => EvaluateTikzResult;
  svg?: EmitSvgOptions;
  textEngine?: NodeTextEngine | null;
  /** Shared document-local graphics resolver for every rendering layer. */
  graphicsResolver?: DocumentGraphicsResolver;
};

export type RenderDiagnostic = {
  code: string;
  message: string;
  severity: "warning" | "error";
};

export type RenderTikzToSvgResult = {
  parse: ParseTikzResult;
  semantic: EvaluateTikzResult;
  svg: EmitSvgResult;
  renderDiagnostics: RenderDiagnostic[];
  /** Local owner of editing reports for this result's text. */
  textLayoutContext: TextLayoutContext | null;
};

export function renderTikzToSvg(source: string, opts: RenderTikzOptions = {}): RenderTikzToSvgResult {
  const parseResult = parseTikz(source, opts.parse);
  const textScope = opts.evaluate?.textEngine?.createRenderScope?.();
  const svgScope = opts.svg?.textEngine === opts.evaluate?.textEngine ? textScope : opts.svg?.textEngine?.createRenderScope?.();
  const semanticResult = runTextRenderOperation(textScope, () => (opts.semanticEvaluator ?? evaluateTikzFigure)(
    parseResult.figure,
    parseResult.source,
    {
      ...opts.evaluate,
      graphicsResolver:
        opts.graphicsResolver ?? opts.evaluate?.graphicsResolver,
    }
  ));
  const svgResult = runTextRenderOperation(svgScope, () => emitSvg(semanticResult.scene, opts.svg));
  retainSceneTextLayout(textScope, semanticResult.scene);
  if (svgScope !== textScope) retainSceneTextLayout(svgScope, semanticResult.scene);

  return {
    parse: parseResult,
    semantic: semanticResult,
    svg: svgResult,
    renderDiagnostics: [],
    textLayoutContext: textScope?.layoutContext ?? opts.evaluate?.textEngine?.layoutContext ?? svgScope?.layoutContext ?? opts.svg?.textEngine?.layoutContext ?? null,
  };
}

export async function renderTikzToSvgAsync(source: string, opts: RenderTikzOptions = {}): Promise<RenderTikzToSvgResult> {
  const renderDiagnostics: RenderDiagnostic[] = [];
  const hasExplicitTextEngine = Object.prototype.hasOwnProperty.call(opts, "textEngine");
  const providedEngine = hasExplicitTextEngine
    ? opts.textEngine
    : opts.evaluate?.textEngine ?? opts.svg?.textEngine;
  let textEngine = providedEngine;
  const shouldCreateDefaultTextEngine = textEngine === undefined;
  if (shouldCreateDefaultTextEngine) {
    textEngine = await createTexNodeTextEngine();
  }
  const hasUserMacros = containsUserMacroDefinitions(source);

  const parseOpts: ParseTikzOptions = {
    ...opts.parse,
    includeContextDefinitions: opts.parse?.includeContextDefinitions ?? true,
    nodeTextValidator:
      opts.parse?.nodeTextValidator ??
      (hasExplicitTextEngine && textEngine && !hasUserMacros
        ? ({ node }) => {
            if (isMatrixNode(node)) {
              return null;
            }
            return textEngine?.validate(normalizeNodeTextForValidation(node.text)) ?? null;
          }
        : undefined)
  };

  const evaluateOpts: EvaluateOptions = {
    ...opts.evaluate,
    textEngine: opts.evaluate?.textEngine ?? textEngine,
    graphicsResolver:
      opts.graphicsResolver ?? opts.evaluate?.graphicsResolver,
  };

  const svgOpts: EmitSvgOptions = {
    ...opts.svg,
    textEngine: opts.svg?.textEngine ?? textEngine
  };
  const textScope = evaluateOpts.textEngine?.createRenderScope?.();
  const svgScope = svgOpts.textEngine === evaluateOpts.textEngine ? textScope : svgOpts.textEngine?.createRenderScope?.();

  const parseResult = parseTikz(source, parseOpts);
  const semanticEvaluator = opts.semanticEvaluator ?? evaluateTikzFigure;
  let semanticResult = runTextRenderOperation(textScope, () => semanticEvaluator(parseResult.figure, parseResult.source, evaluateOpts));
  let svgResult = runTextRenderOperation(svgScope, () => emitSvg(semanticResult.scene, svgOpts));

  const flushedPendingTextKeys = await textEngine?.flushPending?.();
  if (flushedPendingTextKeys && flushedPendingTextKeys.length > 0) {
    semanticResult = runTextRenderOperation(textScope, () => semanticEvaluator(parseResult.figure, parseResult.source, evaluateOpts));
    svgResult = runTextRenderOperation(svgScope, () => emitSvg(semanticResult.scene, svgOpts));
  }
  retainSceneTextLayout(textScope, semanticResult.scene);
  if (svgScope !== textScope) retainSceneTextLayout(svgScope, semanticResult.scene);

  return {
    parse: parseResult,
    semantic: semanticResult,
    svg: svgResult,
    renderDiagnostics,
    textLayoutContext: textScope?.layoutContext ?? evaluateOpts.textEngine?.layoutContext ?? svgScope?.layoutContext ?? svgOpts.textEngine?.layoutContext ?? null,
  };
}

function containsUserMacroDefinitions(source: string): boolean {
  return /\\(?:def|let|newcommand|renewcommand|providecommand|DeclareRobustCommand|DeclareMathOperator|pgfmathparse|pgfmathsetmacro)\b/.test(source);
}

function isMatrixNode(node: NodeItem): boolean {
  const entries = node.options?.entries ?? [];
  return entries.some((entry) => {
    if (entry.kind !== "flag" && entry.kind !== "kv") {
      return false;
    }
    const normalized = entry.key.trim().toLowerCase().replace(/^\/tikz\//, "");
    return normalized === "matrix" || normalized === "matrix of nodes" || normalized === "matrix of math nodes";
  });
}

function normalizeNodeTextForValidation(text: string): string {
  const parts = parseNodeParts(text);
  if (parts.length <= 1 && parts[0]?.name === "text") {
    return text;
  }
  return parts.map((part) => part.text).filter((partText) => partText.length > 0).join(" ");
}
