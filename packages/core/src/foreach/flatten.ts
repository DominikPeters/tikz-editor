import type {
  ChildForeachClause,
  ChildOperationItem,
  ForeachStatement,
  NodeForeachClause,
  NodeItem,
  PathForeachItem,
  PathItem,
  PathStatement,
  Span,
  Statement
} from "../ast/types.js";
import { parseTikz } from "../parser/index.js";
import type { SourcePatch } from "../edit/types.js";
import { isWrappedBySingleBracePair } from "../utils/braces.js";
import { buildForeachIterations } from "./options.js";
import { substituteForeachBindings } from "./substitute.js";
import type { ForeachExpansionDiagnostic, ForeachIterationBinding } from "./types.js";

export type FlattenForeachTarget =
  | { kind: "sourceId"; sourceId: string }
  | { kind: "span"; span: Span };

export type FlattenForeachOptions = {
  recursive?: boolean;
  maxExpansions?: number;
};

export type FlattenForeachPatch = SourcePatch;

export type FlattenForeachResult =
  | {
      kind: "success";
      newSource: string;
      patches: FlattenForeachPatch[];
      flattenedLoopId: string;
      flattenedSpan: Span;
      warnings: ForeachExpansionDiagnostic[];
    }
  | {
      kind: "unsupported";
      reason: string;
      diagnostics: ForeachExpansionDiagnostic[];
    }
  | { kind: "error"; message: string };

type FlattenContext = {
  recursive: boolean;
  maxExpansions: number;
  expansionCount: number;
  warnings: ForeachExpansionDiagnostic[];
};

type FlattenTargetNode =
  | { kind: "statement"; loop: ForeachStatement; span: Span; id: string }
  | { kind: "path"; loop: PathForeachItem; span: Span; id: string }
  | { kind: "node"; node: NodeItem; clause: NodeForeachClause; span: Span; id: string }
  | { kind: "child"; child: ChildOperationItem; clause: ChildForeachClause; span: Span; id: string };

const DEFAULT_MAX_EXPANSIONS = 10_000;
const STATEMENT_SNIPPET_PREFIX = "\\begin{tikzpicture}\n";
const STATEMENT_SNIPPET_SUFFIX = "\n\\end{tikzpicture}";
const PATH_SNIPPET_PREFIX = "\\begin{tikzpicture}\n\\path ";
const PATH_SNIPPET_SUFFIX = ";\n\\end{tikzpicture}";

export function flattenForeachInSource(
  source: string,
  target: FlattenForeachTarget,
  options: FlattenForeachOptions = {}
): FlattenForeachResult {
  const context = createFlattenContext(options);
  const result = flattenForeachInSourceWithContext(source, target, context);
  if (result.kind !== "success") {
    return result;
  }
  return {
    ...result,
    warnings: [...context.warnings]
  };
}

function flattenForeachInSourceWithContext(
  source: string,
  target: FlattenForeachTarget,
  context: FlattenContext
): FlattenForeachResult {
  const parsed = parseTikz(source, { recover: true });
  const parseError = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (parseError) {
    return {
      kind: "unsupported",
      reason: "Source must parse before a foreach loop can be flattened.",
      diagnostics: [{
        severity: "error",
        code: parseError.code ?? "parse-error",
        message: parseError.message,
        span: parseError.span
      }]
    };
  }

  const match = findFlattenTarget(parsed.figure.body, target);
  if (!match) {
    return {
      kind: "unsupported",
      reason: "No supported foreach loop matched the requested target.",
      diagnostics: []
    };
  }

  const flattened = flattenTarget(match, context);
  if (flattened.kind !== "success") {
    return flattened;
  }

  const oldSpan = match.span;
  const newSource = source.slice(0, oldSpan.from) + flattened.replacement + source.slice(oldSpan.to);
  const newSpan = {
    from: oldSpan.from,
    to: oldSpan.from + flattened.replacement.length
  };
  return {
    kind: "success",
    newSource,
    patches: [{
      oldSpan,
      newSpan,
      replacement: flattened.replacement
    }],
    flattenedLoopId: match.id,
    flattenedSpan: newSpan,
    warnings: []
  };
}

function createFlattenContext(options: FlattenForeachOptions): FlattenContext {
  return {
    recursive: options.recursive ?? false,
    maxExpansions: options.maxExpansions ?? DEFAULT_MAX_EXPANSIONS,
    expansionCount: 0,
    warnings: []
  };
}

type FlattenReplacementResult =
  | { kind: "success"; replacement: string }
  | { kind: "unsupported"; reason: string; diagnostics: ForeachExpansionDiagnostic[] }
  | { kind: "error"; message: string };

type FlattenFailure = Exclude<FlattenReplacementResult, { kind: "success" }>;
type FlattenFragmentResult = { kind: "output"; output: string } | FlattenFailure;

function flattenTarget(target: FlattenTargetNode, context: FlattenContext): FlattenReplacementResult {
  switch (target.kind) {
    case "statement":
      return flattenForeachStatement(target.loop, context);
    case "path":
      return flattenPathForeach(target.loop, context);
    case "node":
      return flattenNodeForeach(target.node, context);
    case "child":
      return flattenChildForeach(target.child, context);
  }
}

function flattenForeachStatement(statement: ForeachStatement, context: FlattenContext): FlattenReplacementResult {
  const iterations = resolveIterations({
    ...(statement.variablesRaw !== undefined ? { variablesRaw: statement.variablesRaw } : {}),
    ...(statement.listRaw !== undefined ? { listRaw: statement.listRaw } : {}),
    options: statement.options,
    loopSpan: statement.span,
    bodyRaw: statement.bodyRaw,
    context
  });
  if (iterations.kind !== "success") {
    return iterations;
  }

  const body = unwrapOptionalBraceGroup(statement.bodyRaw);
  const pieces: string[] = [];
  for (const iteration of iterations.iterations) {
    const substituted = substituteForeachBindings(body, iteration.bindings);
    const replacement = context.recursive
      ? flattenAllStatementForeachInFragment(substituted, context)
      : { kind: "output" as const, output: substituted };
    if (replacement.kind !== "output") {
      return replacement;
    }
    const trimmed = replacement.output.trim();
    if (trimmed.length > 0) {
      pieces.push(trimmed);
    }
  }

  return {
    kind: "success",
    replacement: formatStatementReplacement(statement, pieces)
  };
}

function flattenPathForeach(item: PathForeachItem, context: FlattenContext): FlattenReplacementResult {
  const iterations = resolveIterations({
    ...(item.variablesRaw !== undefined ? { variablesRaw: item.variablesRaw } : {}),
    ...(item.listRaw !== undefined ? { listRaw: item.listRaw } : {}),
    options: item.options,
    loopSpan: item.span,
    bodyRaw: item.bodyRaw,
    context
  });
  if (iterations.kind !== "success") {
    return iterations;
  }

  const body = unwrapOptionalBraceGroup(item.bodyRaw);
  const pieces: string[] = [];
  for (const iteration of iterations.iterations) {
    const substituted = substituteForeachBindings(body, iteration.bindings);
    const replacement = context.recursive
      ? flattenAllPathForeachInFragment(substituted, context)
      : { kind: "output" as const, output: substituted };
    if (replacement.kind !== "output") {
      return replacement;
    }
    const trimmed = replacement.output.trim();
    if (trimmed.length > 0) {
      pieces.push(trimmed);
    }
  }

  return {
    kind: "success",
    replacement: pieces.join(" ")
  };
}

function flattenNodeForeach(item: NodeItem, context: FlattenContext): FlattenReplacementResult {
  const variants = resolveClauseVariants(item.foreachClauses ?? [], item.templateRaw, context);
  if (variants.kind !== "success") {
    return variants;
  }

  const pieces: string[] = [];
  for (const variant of variants.variants) {
    const substituted = substituteForeachBindings(item.templateRaw, variant.bindings);
    const replacement = context.recursive
      ? flattenAllPathForeachInFragment(substituted, context)
      : { kind: "output" as const, output: substituted };
    if (replacement.kind !== "output") {
      return replacement;
    }
    const trimmed = replacement.output.trim();
    if (trimmed.length > 0) {
      pieces.push(trimmed);
    }
  }

  return {
    kind: "success",
    replacement: pieces.join(" ")
  };
}

function flattenChildForeach(item: ChildOperationItem, context: FlattenContext): FlattenReplacementResult {
  const variants = resolveClauseVariants(item.foreachClauses ?? [], item.templateRaw, context);
  if (variants.kind !== "success") {
    return variants;
  }

  const pieces: string[] = [];
  for (const variant of variants.variants) {
    const substituted = `child ${substituteForeachBindings(item.templateRaw, variant.bindings).trimStart()}`;
    const replacement = context.recursive
      ? flattenAllPathForeachInFragment(substituted, context)
      : { kind: "output" as const, output: substituted };
    if (replacement.kind !== "output") {
      return replacement;
    }
    const trimmed = replacement.output.trim();
    if (trimmed.length > 0) {
      pieces.push(trimmed);
    }
  }

  return {
    kind: "success",
    replacement: pieces.join(" ")
  };
}

function resolveIterations(params: {
  variablesRaw?: string;
  listRaw?: string;
  options: ForeachStatement["options"];
  loopSpan: Span;
  bodyRaw: string;
  context: FlattenContext;
}): FlattenFailure | { kind: "success"; iterations: Array<{ index: number; bindings: ForeachIterationBinding }> } {
  const variablesRaw = params.variablesRaw?.trim() ?? "";
  const listRaw = params.listRaw?.trim() ?? "";
  if (variablesRaw.length === 0 || listRaw.length === 0) {
    return unsupported("Could not parse foreach loop header.", [{
      severity: "warning",
      code: "invalid-foreach-header",
      message: "Could not parse foreach loop header.",
      span: params.loopSpan
    }]);
  }

  if (/\\breakforeach\b/.test(params.bodyRaw)) {
    return unsupported("\\breakforeach cannot be flattened safely.", [{
      severity: "warning",
      code: "unsupported-breakforeach",
      message: "\\breakforeach is not supported for foreach flattening.",
      span: params.loopSpan
    }]);
  }

  const { iterations, diagnostics } = buildForeachIterations({
    variablesRaw,
    listRaw,
    options: params.options,
    baseBindings: {},
    loopSpan: params.loopSpan
  });
  if (diagnostics.length > 0) {
    params.context.warnings.push(...diagnostics);
  }
  const fatalDiagnostic = diagnostics.find(isFatalForeachDiagnostic);
  if (fatalDiagnostic) {
    return unsupported(fatalDiagnostic.message, diagnostics);
  }
  if (iterations.length === 0) {
    return unsupported("Foreach loop has no iterations to flatten.", diagnostics);
  }
  if (!consumeExpansionBudget(params.context, iterations.length, params.loopSpan)) {
    const diagnostic = expansionLimitDiagnostic(params.context.maxExpansions, params.loopSpan);
    return unsupported(diagnostic.message, [diagnostic]);
  }

  return {
    kind: "success",
    iterations
  };
}

function resolveClauseVariants(
  clauses: readonly (NodeForeachClause | ChildForeachClause)[],
  bodyRaw: string,
  context: FlattenContext
): FlattenFailure | { kind: "success"; variants: Array<{ bindings: ForeachIterationBinding }> } {
  let variants: Array<{ bindings: ForeachIterationBinding }> = [{ bindings: {} }];

  for (const clause of clauses) {
    const nextVariants: Array<{ bindings: ForeachIterationBinding }> = [];
    for (const variant of variants) {
      const variablesRaw = clause.variablesRaw?.trim() ?? "";
      const listRaw = clause.listRaw?.trim() ?? "";
      if (variablesRaw.length === 0 || listRaw.length === 0) {
        return unsupported("Could not parse foreach loop header.", [{
          severity: "warning",
          code: "invalid-foreach-header",
          message: "Could not parse foreach loop header.",
          span: clause.span
        }]);
      }

      if (/\\breakforeach\b/.test(bodyRaw)) {
        return unsupported("\\breakforeach cannot be flattened safely.", [{
          severity: "warning",
          code: "unsupported-breakforeach",
          message: "\\breakforeach is not supported for foreach flattening.",
          span: clause.span
        }]);
      }

      const { iterations, diagnostics } = buildForeachIterations({
        variablesRaw,
        listRaw,
        options: clause.options,
        baseBindings: variant.bindings,
        loopSpan: clause.span
      });
      if (diagnostics.length > 0) {
        context.warnings.push(...diagnostics);
      }
      const fatalDiagnostic = diagnostics.find(isFatalForeachDiagnostic);
      if (fatalDiagnostic) {
        return unsupported(fatalDiagnostic.message, diagnostics);
      }
      if (iterations.length === 0) {
        return unsupported("Foreach loop has no iterations to flatten.", diagnostics);
      }
      if (!consumeExpansionBudget(context, iterations.length, clause.span)) {
        const diagnostic = expansionLimitDiagnostic(context.maxExpansions, clause.span);
        return unsupported(diagnostic.message, [diagnostic]);
      }

      for (const iteration of iterations) {
        nextVariants.push({
          bindings: {
            ...variant.bindings,
            ...iteration.bindings
          }
        });
      }
    }
    variants = nextVariants;
  }

  return {
    kind: "success",
    variants
  };
}

function flattenAllStatementForeachInFragment(
  fragment: string,
  context: FlattenContext
): FlattenFragmentResult {
  return flattenAllForeachInSyntheticSnippet({
    fragment,
    prefix: STATEMENT_SNIPPET_PREFIX,
    suffix: STATEMENT_SNIPPET_SUFFIX,
    context
  });
}

function flattenAllPathForeachInFragment(
  fragment: string,
  context: FlattenContext
): FlattenFragmentResult {
  return flattenAllForeachInSyntheticSnippet({
    fragment,
    prefix: PATH_SNIPPET_PREFIX,
    suffix: PATH_SNIPPET_SUFFIX,
    context
  });
}

function flattenAllForeachInSyntheticSnippet(params: {
  fragment: string;
  prefix: string;
  suffix: string;
  context: FlattenContext;
}): FlattenFragmentResult {
  let source = `${params.prefix}${params.fragment}${params.suffix}`;
  const contentStart = params.prefix.length;

  for (;;) {
    const contentEnd = source.length - params.suffix.length;
    const parsed = parseTikz(source, { recover: true });
    const parseError = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    if (parseError) {
      return unsupported("Flattened foreach body must parse cleanly.", [{
        severity: "error",
        code: parseError.code ?? "parse-error",
        message: parseError.message,
        span: parseError.span
      }]);
    }

    const target = findFirstFlattenTargetInContent(parsed.figure.body, { from: contentStart, to: contentEnd });
    if (!target) {
      return {
        kind: "output",
        output: source.slice(contentStart, contentEnd)
      };
    }

    const flattened = flattenTarget(target, params.context);
    if (flattened.kind !== "success") {
      return flattened;
    }
    source = source.slice(0, target.span.from) + flattened.replacement + source.slice(target.span.to);
  }
}

function findFlattenTarget(statements: readonly Statement[], target: FlattenForeachTarget): FlattenTargetNode | null {
  for (const candidate of collectFlattenTargets(statements)) {
    if (target.kind === "sourceId") {
      if (candidate.id === target.sourceId) {
        return candidate;
      }
      continue;
    }

    if (spansOverlap(candidate.span, target.span)) {
      return candidate;
    }
  }
  return null;
}

function findFirstFlattenTargetInContent(statements: readonly Statement[], contentSpan: Span): FlattenTargetNode | null {
  for (const candidate of collectFlattenTargets(statements)) {
    if (candidate.span.from >= contentSpan.from && candidate.span.to <= contentSpan.to) {
      return candidate;
    }
  }
  return null;
}

function collectFlattenTargets(statements: readonly Statement[]): FlattenTargetNode[] {
  const targets: FlattenTargetNode[] = [];
  const visitStatements = (entries: readonly Statement[]): void => {
    for (const statement of entries) {
      if (statement.kind === "Foreach") {
        targets.push({
          kind: "statement",
          loop: statement,
          span: statement.span,
          id: statement.id
        });
        continue;
      }
      if (statement.kind === "Scope") {
        visitStatements(statement.body);
        continue;
      }
      if (statement.kind === "Path") {
        visitPathItems(statement);
      }
    }
  };

  const visitPathItems = (statement: PathStatement): void => {
    const visitItems = (items: readonly PathItem[]): void => {
      for (const item of items) {
        if (item.kind === "PathForeach") {
          targets.push({
            kind: "path",
            loop: item,
            span: item.span,
            id: item.id
          });
          continue;
        }
        if (item.kind === "Node") {
          for (const clause of item.foreachClauses ?? []) {
            targets.push({
              kind: "node",
              node: item,
              clause,
              span: item.span,
              id: clause.id
            });
          }
          continue;
        }
        if (item.kind === "ChildOperation") {
          for (const clause of item.foreachClauses ?? []) {
            targets.push({
              kind: "child",
              child: item,
              clause,
              span: item.span,
              id: clause.id
            });
          }
          visitItems(item.body);
        }
      }
    };
    visitItems(statement.items);
  };

  visitStatements(statements);
  targets.sort((left, right) => {
    if (left.span.from !== right.span.from) {
      return left.span.from - right.span.from;
    }
    return right.span.to - left.span.to;
  });
  return targets;
}

function formatStatementReplacement(statement: ForeachStatement, pieces: readonly string[]): string {
  if (pieces.length === 0) {
    return "";
  }
  const indent = lineIndentAtOffset(statement.span.from);
  return pieces
    .map((piece) => reindentMultiline(piece, indent))
    .join("\n");

  function lineIndentAtOffset(offset: number): string {
    const raw = statement.prefixRaw;
    const prefixIndent = raw.match(/^[ \t]*/)?.[0];
    if (prefixIndent != null && prefixIndent.length > 0) {
      return prefixIndent;
    }
    void offset;
    return "";
  }
}

function reindentMultiline(raw: string, indent: string): string {
  const lines = raw.split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const minimumIndent = nonEmptyLines.reduce((minimum, line) => {
    const current = line.match(/^[ \t]*/)?.[0].length ?? 0;
    return Math.min(minimum, current);
  }, Number.POSITIVE_INFINITY);
  const removeIndent = Number.isFinite(minimumIndent) ? minimumIndent : 0;
  return lines
    .map((line) => `${indent}${line.slice(Math.min(removeIndent, line.length))}`)
    .join("\n");
}

function unwrapOptionalBraceGroup(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}") && isWrappedBySingleBracePair(trimmed)) {
    return trimmed.slice(1, -1);
  }
  return raw;
}

function consumeExpansionBudget(context: FlattenContext, count: number, span: Span): boolean {
  void span;
  if (context.expansionCount + count <= context.maxExpansions) {
    context.expansionCount += count;
    return true;
  }
  return false;
}

function expansionLimitDiagnostic(maxExpansions: number, span: Span): ForeachExpansionDiagnostic {
  return {
    severity: "warning",
    code: "foreach-expansion-limit",
    message: `Foreach expansion limit (${maxExpansions}) reached.`,
    span
  };
}

function isFatalForeachDiagnostic(diagnostic: ForeachExpansionDiagnostic): boolean {
  return (
    diagnostic.code === "invalid-foreach-header" ||
    diagnostic.code === "invalid-foreach-list" ||
    diagnostic.code.startsWith("foreach-unsupported-option:") ||
    diagnostic.code.startsWith("foreach-evaluate-failed:") ||
    diagnostic.code === "foreach-expansion-limit"
  );
}

function unsupported(reason: string, diagnostics: ForeachExpansionDiagnostic[]): FlattenFailure {
  return {
    kind: "unsupported",
    reason,
    diagnostics
  };
}

function spansOverlap(left: Span, right: Span): boolean {
  return left.from < right.to && right.from < left.to;
}
