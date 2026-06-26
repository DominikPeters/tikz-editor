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

export type ParseTikzOptions = {
  recover?: boolean;
  activeFigureId?: string | null;
  includeContextDefinitions?: boolean;
  nodeTextValidator?: (context: NodeTextValidationContext) => NodeTextValidationIssue | null;
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
  const scannedFigures = scanTikzFigures(input);
  const figureSpans = scannedFigures
    .filter((figure) => !figure.isTemplate)
    .map((figure) => ({ from: figure.span.from, to: figure.span.to }));
  const activeFigureSpan = resolveActiveFigureSpan(figureSpans, opts.activeFigureId);
  const parseSource = resolveParseWindowSource(input, activeFigureSpan);
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
