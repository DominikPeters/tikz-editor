import type { Tree } from "@lezer/common";

import type { Diagnostic } from "../diagnostics/types.js";
import type { NodeItem, Statement } from "../ast/types.js";
import { FeatureFlags } from "../ast/features.js";
import { walkStatements } from "../ast/walk.js";
import { collectContextDefinitions, fromCst } from "../transform/cst-to-ast.js";
import type { TikzFigure, TikzFigureInventoryItem } from "../ast/types.js";
import { parseSyntax } from "@tikz-editor/lezer-tikz";
import {
  getCachedContextDefinitions,
  resolveActiveFigureSpan,
  resolveParseWindowSource
} from "./shared.js";
import { scanTikzFigures } from "./figure-scan.js";
import { incrementProfilingCounter } from "../profiling.js";

export type NodeTextValidationContext = {
  node: NodeItem;
  source: string;
};

export type NodeTextValidationIssue = {
  code?: string;
  message: string;
};

export type StructuralMaskSpan = { from: number; to: number };

export type ParseTikzOptions = {
  recover?: boolean;
  activeFigureId?: string | null;
  includeContextDefinitions?: boolean;
  nodeTextValidator?: (context: NodeTextValidationContext) => NodeTextValidationIssue | null;
  /**
   * Spans whose content is neutralized (non-newline characters replaced by
   * spaces) in the string handed to the syntax parser, so a
   * momentarily-unbalanced edit inside them cannot reshape document
   * structure. All downstream text extraction still slices the real input.
   * Used while a canvas text-editing session is active on the span.
   */
  structuralMasks?: readonly StructuralMaskSpan[];
};

export type ParseTikzResult = {
  source: string;
  tree: Tree;
  figure: TikzFigure;
  figures: TikzFigureInventoryItem[];
  activeFigureId: string | null;
  diagnostics: Diagnostic[];
  features: typeof FeatureFlags;
};

export function parseTikz(input: string, opts: ParseTikzOptions = {}): ParseTikzResult {
  incrementProfilingCounter("parseTikzCalls");
  const recover = opts.recover ?? true;
  const structurallyMaskedInput = applyStructuralMasks(input, opts.structuralMasks);
  const scannedFigures = scanTikzFigures(structurallyMaskedInput);
  const figureSpans = scannedFigures
    .filter((figure) => !figure.isTemplate)
    .map((figure) => ({ from: figure.span.from, to: figure.span.to }));
  const activeFigureSpan = resolveActiveFigureSpan(figureSpans, opts.activeFigureId);
  const parseSource = resolveParseWindowSource(structurallyMaskedInput, activeFigureSpan);
  const contextDefinitions =
    opts.includeContextDefinitions && activeFigureSpan
      ? getCachedContextDefinitions(input.slice(0, activeFigureSpan.from), collectContextDefinitions)
      : undefined;
  const tree = parseSyntax(parseSource);

  const mapped = fromCst(tree, input, {
    activeFigureId: opts.activeFigureId,
    includeContextDefinitions: opts.includeContextDefinitions ?? false,
    contextDefinitions,
    scannedFigures
  });
  const diagnostics = [...mapped.diagnostics];

  const nodeTextValidator = opts.nodeTextValidator;
  if (nodeTextValidator) {
    const allNodes = collectNodeItems(mapped.figure.body);
    for (const node of allNodes) {
      const issue = nodeTextValidator({ node, source: input });
      if (!issue) {
        continue;
      }
      diagnostics.push({
        severity: "error",
        code: issue.code ?? "invalid-node-tex",
        message: issue.message,
        span: node.textSpan
      });
    }
  }

  if (!recover) {
    const firstError = diagnostics.find((diagnostic) => diagnostic.severity === "error");
    if (firstError) {
      throw new Error(`TikZ parse failed at ${firstError.span.from}-${firstError.span.to}: ${firstError.message}`);
    }
  }

  return {
    source: input,
    tree,
    figure: mapped.figure,
    figures: mapped.figures,
    activeFigureId: mapped.activeFigureId,
    diagnostics,
    features: FeatureFlags
  };
}

function applyStructuralMasks(
  source: string,
  masks: readonly StructuralMaskSpan[] | undefined
): string {
  if (!masks || masks.length === 0) {
    return source;
  }
  let result = source;
  for (const mask of masks) {
    const from = Math.max(0, Math.min(result.length, mask.from));
    const to = Math.max(from, Math.min(result.length, mask.to));
    if (to === from) {
      continue;
    }
    result =
      result.slice(0, from) +
      result.slice(from, to).replace(/[^\n]/g, " ") +
      result.slice(to);
  }
  return result;
}

function collectNodeItems(statements: Statement[]): NodeItem[] {
  const nodes: NodeItem[] = [];
  walkStatements(statements, {
    onNode: (node) => {
      nodes.push(node);
    }
  });
  return nodes;
}

export type { Diagnostic } from "../diagnostics/types.js";
export type * from "../ast/types.js";
export { createIncrementalParseSession } from "./incremental.js";
export type * from "./incremental.js";
