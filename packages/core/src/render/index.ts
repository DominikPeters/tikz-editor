import { parseTikz } from "../parser/index.js";
import type { ParseTikzOptions, ParseTikzResult } from "../parser/index.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import type { EvaluateOptions, EvaluateTikzResult } from "../semantic/index.js";
import { emitSvg } from "../svg/emit.js";
import type { EmitSvgOptions, EmitSvgResult } from "../svg/index.js";
import { createMathJaxNodeTextEngine } from "../text/mathjax-engine.js";
import type { NodeTextEngine } from "../text/types.js";
import type { NodeItem, TikzFigure } from "../ast/types.js";
import type { AddonRuntime } from "../addons/runtime.js";
import { parseNodeParts } from "../semantic/nodes/multipart.js";

let mathJaxEngineUnavailable = false;
let mathJaxEngineUnavailableReason: string | null = null;
let lastMathJaxWarning: string | null = null;

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
  validateNodeText?: boolean;
  /** Active add-on runtime, threaded into both parse and evaluate. */
  addons?: AddonRuntime | null;
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
};

export function renderTikzToSvg(source: string, opts: RenderTikzOptions = {}): RenderTikzToSvgResult {
  const parseResult = parseTikz(source, { addons: opts.addons, ...opts.parse });
  const semanticResult = (opts.semanticEvaluator ?? evaluateTikzFigure)(
    parseResult.figure,
    parseResult.source,
    { addons: opts.addons, ...opts.evaluate }
  );
  const svgResult = emitSvg(semanticResult.scene, opts.svg);

  return {
    parse: parseResult,
    semantic: semanticResult,
    svg: svgResult,
    renderDiagnostics: []
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
  const browserRuntime = hasBrowserDomGlobals();
  const useDefaultNodeTextValidator = opts.validateNodeText ?? true;
  const hasUserMacros = containsUserMacroDefinitions(source);
  if (shouldCreateDefaultTextEngine && !browserRuntime && mathJaxEngineUnavailable) {
    renderDiagnostics.push({
      code: "mathjax-engine-unavailable",
      message:
        mathJaxEngineUnavailableReason ??
        "MathJax text engine is unavailable in this runtime; using plain SVG text fallback.",
      severity: "warning"
    });
    textEngine = null;
  } else if (shouldCreateDefaultTextEngine && (!mathJaxEngineUnavailable || browserRuntime)) {
    try {
      textEngine = await createMathJaxNodeTextEngine();
      if (!browserRuntime) {
        mathJaxEngineUnavailableReason = null;
      }
    } catch (error) {
      const message = describeMathJaxFailure(error);
      textEngine = null;
      renderDiagnostics.push({
        code: "mathjax-engine-unavailable",
        message,
        severity: "warning"
      });
      logMathJaxWarning(message);
      if (!browserRuntime) {
        mathJaxEngineUnavailable = true;
        mathJaxEngineUnavailableReason = message;
      }
    }
  }

  const parseOpts: ParseTikzOptions = {
    addons: opts.addons,
    ...opts.parse,
    includeContextDefinitions: opts.parse?.includeContextDefinitions ?? true,
    nodeTextValidator:
      opts.parse?.nodeTextValidator ??
      (useDefaultNodeTextValidator && textEngine && !hasUserMacros
        ? ({ node }) => {
            if (isMatrixNode(node)) {
              return null;
            }
            return textEngine?.validate(normalizeNodeTextForValidation(node.text)) ?? null;
          }
        : undefined)
  };

  const evaluateOpts: EvaluateOptions = {
    addons: opts.addons,
    ...opts.evaluate,
    textEngine: opts.evaluate?.textEngine ?? textEngine
  };

  const svgOpts: EmitSvgOptions = {
    ...opts.svg,
    textEngine: opts.svg?.textEngine ?? textEngine
  };

  const parseResult = parseTikz(source, parseOpts);
  const semanticEvaluator = opts.semanticEvaluator ?? evaluateTikzFigure;
  let semanticResult = semanticEvaluator(parseResult.figure, parseResult.source, evaluateOpts);
  let svgResult = emitSvg(semanticResult.scene, svgOpts);

  const flushedPendingTextKeys = await textEngine?.flushPending?.();
  if (flushedPendingTextKeys && flushedPendingTextKeys.length > 0) {
    semanticResult = semanticEvaluator(parseResult.figure, parseResult.source, evaluateOpts);
    svgResult = emitSvg(semanticResult.scene, svgOpts);
  }

  return {
    parse: parseResult,
    semantic: semanticResult,
    svg: svgResult,
    renderDiagnostics
  };
}

function hasBrowserDomGlobals(): boolean {
  const candidate = globalThis as { window?: unknown; document?: unknown };
  return candidate.window != null && candidate.document != null;
}

function describeMathJaxFailure(error: unknown): string {
  const details = error instanceof Error ? error.message : String(error);
  const normalizedDetails = details.trim();
  if (!normalizedDetails) {
    return "MathJax text engine initialization failed; falling back to plain SVG text rendering.";
  }
  return `MathJax text engine initialization failed; falling back to plain SVG text rendering. (${normalizedDetails})`;
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

function logMathJaxWarning(message: string): void {
  if (lastMathJaxWarning === message) {
    return;
  }
  lastMathJaxWarning = message;
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(`[tikz-editor] ${message}`);
  }
}
