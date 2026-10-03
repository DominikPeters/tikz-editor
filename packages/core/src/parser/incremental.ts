import type { Tree } from "@lezer/common";
import { parseSyntax } from "@tikz-editor/lezer-tikz";

import { FeatureFlags } from "../ast/features.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { NodeItem, PathItem, TikzFigure, TikzFigureInventoryItem, Span, Statement } from "../ast/types.js";
import type { ParseTikzOptions, ParseTikzResult } from "./index.js";
import type { SourcePatch } from "../edit/types.js";
import {
  getCachedContextDefinitions,
  resolveActiveFigureSpan,
  resolveParseWindowSource
} from "./shared.js";
import { parseTikz } from "./index.js";
import { collectContextDefinitions } from "../transform/cst-to-ast.js";
import { buildLineStarts, lineForOffset } from "../text/line-map.js";

export type IncrementalParseTrigger = "drag-element" | "drag-handle" | "other";

export type IncrementalParseFallbackReason =
  | "missing-patches"
  | "no-previous-cache"
  | "source-unchanged-active-figure-mismatch"
  | "active-figure-unresolved"
  | "active-figure-mismatch"
  | "global-diagnostics"
  | "patch-outside-active-figure"
  | "patch-touches-figure-delimiter"
  | "patch-source-id-mismatch"
  | "patch-overlaps-unknown-statement"
  | "statement-structure-changed"
  | "statement-parse-error"
  | "statement-global-diagnostics"
  | "runtime-error";

export type IncrementalParseStats = {
  strategy: "full" | "incremental" | "reused";
  fallbackReason?: IncrementalParseFallbackReason;
  patchApplication?: "direct" | "rebased" | "discarded";
  reparsedStatementCount: number;
  reusedStatementCount: number;
};

export type IncrementalParseEvaluateInput = {
  source: string;
  sourceRevision?: number | null;
  activeFigureId?: string | null;
  includeContextDefinitions?: boolean;
  patches?: readonly SourcePatch[] | null;
  patchBaseRevision?: number | null;
  changedSourceIds?: readonly string[];
  trigger?: IncrementalParseTrigger;
  /** Infer a source edit against the last evaluated revision, after coalescing. */
  inferChanges?: boolean;
  nodeTextValidator?: ParseTikzOptions["nodeTextValidator"];
};

export type IncrementalParseEvaluateResult = {
  parse: ParseTikzResult;
  stats: IncrementalParseStats;
  /** Changes relative to the cached parse, including any coalesced edits. */
  changes?: { patches: SourcePatch[]; changedSourceIds: string[] };
};

export type IncrementalParseSession = {
  evaluate: (input: IncrementalParseEvaluateInput) => IncrementalParseEvaluateResult;
  prime: (parse: ParseTikzResult, options?: Pick<ParseTikzOptions, "activeFigureId" | "includeContextDefinitions"> & { sourceRevision?: number | null }) => void;
  fork: () => IncrementalParseSession;
  reset: () => void;
};

type StatementRef = {
  sourceId: string;
  span: Span;
  parentPath: number[];
  index: number;
};

type ParseDiagnosticPartition = {
  localBySourceId: Map<string, Diagnostic[]>;
  global: Diagnostic[];
};

type CachedIncrementalParseState = {
  source: string;
  sourceRevision: number | null;
  activeFigureId: string | null;
  includeContextDefinitions: boolean;
  figures: TikzFigureInventoryItem[];
  activeFigureSpan: Span | null;
  contextDefinitions: Statement[];
  figure: TikzFigure;
  statementRefsBySourceId: Map<string, StatementRef>;
  diagnosticPartition: ParseDiagnosticPartition;
  tree: Tree;
  treeFresh: boolean;
};

const SNIPPET_PREFIX = "\\begin{tikzpicture}\n";
const SNIPPET_SUFFIX = "\n\\end{tikzpicture}";

export function createIncrementalParseSession(): IncrementalParseSession {
  return createSession(null);
}

function createSession(initial: CachedIncrementalParseState | null): IncrementalParseSession {
  let cached = initial;

  const prime = (
    parse: ParseTikzResult,
    options: Pick<ParseTikzOptions, "activeFigureId" | "includeContextDefinitions"> & { sourceRevision?: number | null } = {}
  ): void => {
    cached = buildCache(parse, {
      activeFigureId: options.activeFigureId ?? parse.activeFigureId,
      includeContextDefinitions: options.includeContextDefinitions ?? false,
      sourceRevision: options.sourceRevision ?? null,
      treeFresh: true
    });
  };

  const evaluate = (input: IncrementalParseEvaluateInput): IncrementalParseEvaluateResult => {
    const activeFigureId = input.activeFigureId;
    const includeContextDefinitions = input.includeContextDefinitions ?? false;
    let patches = normalizePatches(input.patches ?? []);
    let patchApplication: IncrementalParseStats["patchApplication"] =
      patches.length > 0 ? "direct" : undefined;
    let changedSourceIds = normalizeSourceIds(input.changedSourceIds ?? []);
    if (input.inferChanges && cached) {
      const currentCache = cached;
      patches = deriveSingleSourcePatch(currentCache.source, input.source);
      changedSourceIds = normalizeSourceIds(patches.flatMap((patch) => {
        const owner = findContainingStatementRef(currentCache.statementRefsBySourceId, patch.oldSpan);
        return owner ? [owner.sourceId] : [];
      }));
      // These patches already refer to the actual cached revision.
      patchApplication = patches.length > 0 ? "rebased" : undefined;
    }
    if (!input.inferChanges && cached && patches.length > 0) {
      const currentCache = cached;
      const patchBaseMatchesCache = revisionsMatch(input.patchBaseRevision, currentCache.sourceRevision);
      const patchesApplyToCached =
        applyPatchesToSource(currentCache.source, patches) === input.source ||
        patches.some((patch) => isWholeStatementPatch(currentCache, patch));
      const canUsePatchesDirectly = patchBaseMatchesCache
        ? patchesApplyToCached
        : input.patchBaseRevision == null && patchesApplyToCached;
      if (!canUsePatchesDirectly) {
        patches = deriveSingleSourcePatch(currentCache.source, input.source);
        patchApplication = patches.length > 0 ? "rebased" : "discarded";
      }
    }

    if (
      cached?.source === input.source &&
      cached.activeFigureId === (activeFigureId ?? cached.activeFigureId) &&
      cached.includeContextDefinitions === includeContextDefinitions &&
      patches.length === 0
    ) {
      cached = {
        ...cached,
        sourceRevision: input.sourceRevision ?? cached.sourceRevision
      };
      return {
        parse: createParseResultFromCache(cached, input.source),
        stats: {
          strategy: "reused",
          reparsedStatementCount: 0,
          reusedStatementCount: cached.statementRefsBySourceId.size
        }
      };
    }

    const fallbackToFull = (reason: IncrementalParseFallbackReason): IncrementalParseEvaluateResult => {
      const parse = parseTikz(input.source, {
        recover: true, activeFigureId, includeContextDefinitions,
        nodeTextValidator: input.nodeTextValidator
      });
      cached = buildCache(parse, {
        activeFigureId: activeFigureId ?? parse.activeFigureId,
        includeContextDefinitions, sourceRevision: input.sourceRevision ?? null,
        treeFresh: true
      });
      return { parse, stats: {
        strategy: "full", fallbackReason: reason, patchApplication,
        reparsedStatementCount: countStatements(parse.figure.body), reusedStatementCount: 0
      } };
    };

    const fallback = decideFallbackReason({
      cached,
      inputSource: input.source,
      activeFigureId,
      includeContextDefinitions,
      patches,
      changedSourceIds
    });
    if (fallback || !cached) {
      return fallbackToFull(fallback ?? "no-previous-cache");
    }

    try {
      const changedRefs = new Map<string, StatementRef>();
      for (const sourceId of changedSourceIds) {
        const ref = cached.statementRefsBySourceId.get(sourceId);
        if (!ref) {
          return fallbackToFull("patch-source-id-mismatch");
        }
        changedRefs.set(sourceId, ref);
      }

      for (const patch of patches) {
        const owner = findContainingStatementRef(cached.statementRefsBySourceId, patch.oldSpan);
        if (!owner) {
          return fallbackToFull("patch-overlaps-unknown-statement");
        }
        if (!changedRefs.has(owner.sourceId)) {
          return fallbackToFull("patch-source-id-mismatch");
        }
      }

      const nextFigures = shiftFigureInventory(cached.figures, patches, input.source);
      const nextActiveFigureSpan = resolveActiveFigureSpan(
        nextFigures.map((figure) => figure.span),
        activeFigureId ?? cached.activeFigureId
      );
      if (!nextActiveFigureSpan) {
        return fallbackToFull("active-figure-unresolved");
      }

      const nextFigure = shiftSpansDeep(structuredClone(cached.figure), patches);
      const changedSourceIdSet = new Set(changedSourceIds);
      const statementReplacementDiagnostics = new Map<string, Diagnostic[]>();

      for (const sourceId of changedSourceIds) {
        const previousRef = cached.statementRefsBySourceId.get(sourceId);
        if (!previousRef) {
          return fallbackToFull("patch-source-id-mismatch");
        }
        const nextSpan = shiftSpanThroughPatches(previousRef.span, patches);
        const snippet = input.source.slice(nextSpan.from, nextSpan.to);
        const parsedSnippet = parseStatementSnippet(snippet, input.nodeTextValidator);
        if (parsedSnippet.parse.figure.body.length !== 1) {
          return fallbackToFull("statement-structure-changed");
        }
        if (parsedSnippet.hasParseError) {
          return fallbackToFull("statement-parse-error");
        }

        const replacement = parsedSnippet.parse.figure.body.at(0);
        const previousStatement = getStatementAtPath(nextFigure, previousRef.parentPath, previousRef.index);
        if (!replacement || replacement.kind !== previousStatement?.kind) {
          return fallbackToFull("statement-structure-changed");
        }

        // New/deleted path items can change generated IDs in other statements.
        // Source edits must then rebuild ownership from the complete document.
        if (input.inferChanges && identityStructure(previousStatement) !== identityStructure(replacement)) {
          return fallbackToFull("statement-structure-changed");
        }

        const rebasedStatement = shiftSpansDeep(replacement, nextSpan.from - SNIPPET_PREFIX.length);
        alignStatementIds(previousStatement, rebasedStatement);
        setStatementAtPath(nextFigure, previousRef.parentPath, previousRef.index, rebasedStatement);

        const partition = partitionDiagnostics(parsedSnippet.parse.diagnostics, parsedSnippet.parse.figure.body);
        if (partition.global.length > 0) {
          return fallbackToFull("statement-global-diagnostics");
        }
        const localDiagnostics = partition.localBySourceId.get(replacement.id) ?? [];
        for (const diagnostic of localDiagnostics) {
          shiftDiagnosticInPlace(diagnostic, nextSpan.from - SNIPPET_PREFIX.length);
        }
        statementReplacementDiagnostics.set(sourceId, localDiagnostics);
      }

      nextFigure.span = nextActiveFigureSpan;
      const nextIndex = buildStatementIndex(nextFigure.body);
      const nextDiagnosticPartition = shiftDiagnosticPartition(
        cached.diagnosticPartition,
        patches,
        statementReplacementDiagnostics,
        changedSourceIdSet
      );

      const nextCache: CachedIncrementalParseState = {
        source: input.source,
        sourceRevision: input.sourceRevision ?? null,
        activeFigureId: activeFigureId ?? cached.activeFigureId,
        includeContextDefinitions,
        figures: nextFigures,
        activeFigureSpan: nextActiveFigureSpan,
        contextDefinitions: includeContextDefinitions
          ? getCachedContextDefinitions(input.source.slice(0, nextActiveFigureSpan.from), collectContextDefinitions)
          : [],
        figure: nextFigure,
        statementRefsBySourceId: nextIndex,
        diagnosticPartition: nextDiagnosticPartition,
        tree: cached.tree,
        treeFresh: false
      };
      cached = nextCache;
      return {
        parse: createParseResultFromCache(nextCache, input.source),
        changes: { patches, changedSourceIds },
        stats: {
          strategy: "incremental",
          patchApplication,
          reparsedStatementCount: changedSourceIds.length,
          reusedStatementCount: Math.max(0, nextIndex.size - changedSourceIds.length)
        }
      };
    } catch {
      return fallbackToFull("runtime-error");
    }
  };

  return {
    evaluate,
    prime,
    fork: () => createSession(cached),
    reset: () => { cached = null; }
  };
}


function identityStructure(statement: Statement): string {
  const items = (entries: readonly PathItem[]): string => entries.map((item) => {
    const clauses = "foreachClauses" in item ? item.foreachClauses?.map((clause) => clause.kind).join(",") ?? "" : "";
    if (item.kind === "ChildOperation") return `${item.kind}[${clauses}](${items(item.body)})`;
    if (item.kind === "ToOperation" || item.kind === "EdgeOperation" || item.kind === "EdgeFromParentOperation") {
      return `${item.kind}(${items(item.nodes ?? [])};${"pics" in item ? items(item.pics ?? []) : ""})`;
    }
    return `${item.kind}[${clauses}]`;
  }).join("|");
  if (statement.kind === "Scope") return `Scope(${statement.body.map(identityStructure).join("|")})`;
  if (statement.kind === "Path") return `Path(${items(statement.items)})`;
  return statement.kind;
}

function alignStatementIds(previous: Statement, next: Statement): void {
  next.id = previous.id;

  if (previous.kind === "Path" && next.kind === "Path") {
    alignPathItems(previous.items, next.items);
    return;
  }
  if (previous.kind === "Scope" && next.kind === "Scope") {
    alignStatements(previous.body, next.body);
    return;
  }
}

function alignStatements(previous: readonly Statement[], next: Statement[]): void {
  const limit = Math.min(previous.length, next.length);
  for (let index = 0; index < limit; index += 1) {
    const previousStatement = previous.at(index);
    const nextStatement = next.at(index);
    if (!previousStatement || !nextStatement) {
      continue;
    }
    if (previousStatement.kind !== nextStatement.kind) {
      continue;
    }
    alignStatementIds(previousStatement, nextStatement);
  }
}

function alignPathItems(previous: readonly PathItem[], next: PathItem[]): void {
  const limit = Math.min(previous.length, next.length);
  for (let index = 0; index < limit; index += 1) {
    const previousItem = previous.at(index);
    const nextItem = next.at(index);
    if (!previousItem || !nextItem) {
      continue;
    }
    if (previousItem.kind !== nextItem.kind) {
      continue;
    }

    nextItem.id = previousItem.id;
    if (previousItem.kind === "Node" && nextItem.kind === "Node") {
      alignNodeItem(previousItem, nextItem);
      continue;
    }
    if (previousItem.kind === "ChildOperation" && nextItem.kind === "ChildOperation") {
      alignClauseIds(previousItem.foreachClauses, nextItem.foreachClauses);
      alignPathItems(previousItem.body, nextItem.body);
      continue;
    }
    if (previousItem.kind === "PicOperation" && nextItem.kind === "PicOperation") {
      alignClauseIds(previousItem.foreachClauses, nextItem.foreachClauses);
      continue;
    }
    if (
      (previousItem.kind === "ToOperation" && nextItem.kind === "ToOperation") ||
      (previousItem.kind === "EdgeOperation" && nextItem.kind === "EdgeOperation") ||
      (previousItem.kind === "EdgeFromParentOperation" && nextItem.kind === "EdgeFromParentOperation")
    ) {
      alignNodeItems(previousItem.nodes, nextItem.nodes);
      if ("pics" in previousItem && "pics" in nextItem) {
        alignPathItems(previousItem.pics ?? [], nextItem.pics ?? []);
      }
    }
  }
}

function alignNodeItems(previous: readonly NodeItem[] | undefined, next: NodeItem[] | undefined): void {
  if (!previous || !next) {
    return;
  }
  const limit = Math.min(previous.length, next.length);
  for (let index = 0; index < limit; index += 1) {
    const previousNode = previous.at(index);
    const nextNode = next.at(index);
    if (!previousNode || !nextNode) {
      continue;
    }
    nextNode.id = previousNode.id;
    alignNodeItem(previousNode, nextNode);
  }
}

function alignNodeItem(previous: NodeItem, next: NodeItem): void {
  alignClauseIds(previous.foreachClauses, next.foreachClauses);
  if (previous.adornment && next.adornment) {
    next.adornment.ownerNodeId = previous.adornment.ownerNodeId;
    next.adornment.ownerSourceId = previous.adornment.ownerSourceId;
  }
}

function alignClauseIds(
  previous: readonly { id: string; kind: string }[] | undefined,
  next: Array<{ id: string; kind: string }> | undefined
): void {
  if (!previous || !next) {
    return;
  }
  const limit = Math.min(previous.length, next.length);
  for (let index = 0; index < limit; index += 1) {
    const previousClause = previous.at(index);
    const nextClause = next.at(index);
    if (!previousClause || !nextClause) {
      continue;
    }
    if (previousClause.kind !== nextClause.kind) {
      continue;
    }
    nextClause.id = previousClause.id;
  }
}

function decideFallbackReason(input: {
  cached: CachedIncrementalParseState | null;
  inputSource: string;
  activeFigureId: string | null | undefined;
  includeContextDefinitions: boolean;
  patches: SourcePatch[];
  changedSourceIds: string[];
}): IncrementalParseFallbackReason | null {
  if (!input.cached) {
    return "no-previous-cache";
  }
  if (input.activeFigureId === null) {
    return input.cached.figures.length > 1
      ? "active-figure-unresolved"
      : "active-figure-mismatch";
  }
  if ((input.activeFigureId ?? input.cached.activeFigureId) !== input.cached.activeFigureId) {
    return input.inputSource === input.cached.source
      ? "source-unchanged-active-figure-mismatch"
      : "active-figure-mismatch";
  }
  if (input.includeContextDefinitions !== input.cached.includeContextDefinitions) {
    return "active-figure-mismatch";
  }
  if (input.patches.length === 0) {
    return "missing-patches";
  }
  if (input.changedSourceIds.length === 0) {
    return "patch-source-id-mismatch";
  }
  if (input.cached.diagnosticPartition.global.length > 0) {
    return "global-diagnostics";
  }
  const activeFigureSpan = input.cached.activeFigureSpan;
  if (!activeFigureSpan) {
    return "active-figure-unresolved";
  }
  const delimiterSpans = resolveFigureDelimiterSpans(input.cached.figures, activeFigureSpan);
  for (const patch of input.patches) {
    if (
      patch.oldSpan.from < activeFigureSpan.from ||
      patch.oldSpan.to > activeFigureSpan.to
    ) {
      return "patch-outside-active-figure";
    }
    if (
      spansOverlap(patch.oldSpan, delimiterSpans.begin) ||
      spansOverlap(patch.oldSpan, delimiterSpans.end)
    ) {
      return "patch-touches-figure-delimiter";
    }
  }
  return null;
}

function parseStatementSnippet(snippet: string, nodeTextValidator?: ParseTikzOptions["nodeTextValidator"]): {
  parse: ParseTikzResult;
  hasParseError: boolean;
} {
  const source = `${SNIPPET_PREFIX}${snippet}\n${SNIPPET_SUFFIX.slice(1)}`;
  const parse = parseTikz(source, { recover: true, nodeTextValidator });
  return {
    parse,
    hasParseError: parse.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  };
}

function createParseResultFromCache(cache: CachedIncrementalParseState, source: string): ParseTikzResult {
  return {
    source,
    get tree() {
      if (!cache.treeFresh) {
        cache.tree = parseSyntax(resolveParseWindowSource(source, cache.activeFigureSpan));
        cache.treeFresh = true;
      }
      return cache.tree;
    },
    figure: cache.figure,
    figures: cache.figures,
    activeFigureId: cache.activeFigureId,
    diagnostics: collectDiagnostics(cache.diagnosticPartition),
    features: FeatureFlags
  };
}

function buildCache(
  parse: ParseTikzResult,
  options: {
    activeFigureId: string | null | undefined;
    includeContextDefinitions: boolean;
    sourceRevision: number | null;
    treeFresh: boolean;
  }
): CachedIncrementalParseState {
  const activeFigureSpan = resolveActiveFigureSpan(
    parse.figures.map((figure) => figure.span),
    options.activeFigureId ?? parse.activeFigureId
  );
  const partition = partitionDiagnostics(parse.diagnostics, parse.figure.body);
  return {
    source: parse.source,
    sourceRevision: options.sourceRevision,
    activeFigureId: options.activeFigureId ?? parse.activeFigureId,
    includeContextDefinitions: options.includeContextDefinitions,
    figures: structuredClone(parse.figures),
    activeFigureSpan,
    contextDefinitions:
      options.includeContextDefinitions && activeFigureSpan
        ? getCachedContextDefinitions(parse.source.slice(0, activeFigureSpan.from), collectContextDefinitions)
        : [],
    figure: structuredClone(parse.figure),
    statementRefsBySourceId: buildStatementIndex(parse.figure.body),
    diagnosticPartition: partition,
    tree: parse.tree,
    treeFresh: options.treeFresh
  };
}

function buildStatementIndex(statements: readonly Statement[], parentPath: number[] = []): Map<string, StatementRef> {
  const refs = new Map<string, StatementRef>();
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements.at(index);
    if (!statement) {
      continue;
    }
    refs.set(statement.id, {
      sourceId: statement.id,
      span: statement.span,
      parentPath,
      index
    });
    if (statement.kind === "Scope") {
      const nested = buildStatementIndex(statement.body, [...parentPath, index]);
      for (const [sourceId, ref] of nested) {
        refs.set(sourceId, ref);
      }
    }
  }
  return refs;
}

function partitionDiagnostics(
  diagnostics: readonly Diagnostic[],
  statements: readonly Statement[]
): ParseDiagnosticPartition {
  const refs = [...buildStatementIndex(statements).values()];
  const localBySourceId = new Map<string, Diagnostic[]>();
  const global: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    let bestRef: StatementRef | null = null;
    for (const ref of refs) {
      if (ref.span.from <= diagnostic.span.from && ref.span.to >= diagnostic.span.to) {
        if (!bestRef || width(ref.span) < width(bestRef.span)) {
          bestRef = ref;
        }
      }
    }
    if (!bestRef) {
      global.push(diagnostic);
      continue;
    }
    const existing = localBySourceId.get(bestRef.sourceId);
    if (existing) {
      existing.push(diagnostic);
    } else {
      localBySourceId.set(bestRef.sourceId, [diagnostic]);
    }
  }
  return {
    localBySourceId,
    global
  };
}

function shiftFigureInventory(
  figures: readonly TikzFigureInventoryItem[],
  patches: readonly SourcePatch[],
  source: string
): TikzFigureInventoryItem[] {
  const lineStarts = buildLineStarts(source);
  return figures.map((figure) => {
    const shifted = shiftSpansDeep(structuredClone(figure), patches);
    shifted.startLine = lineForOffset(shifted.span.from, lineStarts);
    shifted.endLine = lineForOffset(Math.max(shifted.span.from, shifted.span.to - 1), lineStarts);
    return shifted;
  });
}

function shiftDiagnosticPartition(
  partition: ParseDiagnosticPartition,
  patches: readonly SourcePatch[],
  replacements: ReadonlyMap<string, Diagnostic[]>,
  changedSourceIds: ReadonlySet<string>
): ParseDiagnosticPartition {
  const localBySourceId = new Map<string, Diagnostic[]>();
  for (const [sourceId, diagnostics] of partition.localBySourceId) {
    if (changedSourceIds.has(sourceId)) {
      localBySourceId.set(sourceId, structuredClone(replacements.get(sourceId) ?? []));
      continue;
    }
    const nextDiagnostics = structuredClone(diagnostics);
    for (const diagnostic of nextDiagnostics) {
      shiftDiagnosticThroughPatchesInPlace(diagnostic, patches);
    }
    localBySourceId.set(sourceId, nextDiagnostics);
  }
  for (const [sourceId, diagnostics] of replacements) {
    if (!localBySourceId.has(sourceId)) localBySourceId.set(sourceId, structuredClone(diagnostics));
  }
  const global = structuredClone(partition.global);
  for (const diagnostic of global) {
    shiftDiagnosticThroughPatchesInPlace(diagnostic, patches);
  }
  return {
    localBySourceId,
    global
  };
}

function collectDiagnostics(partition: ParseDiagnosticPartition): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const localDiagnostics of partition.localBySourceId.values()) {
    diagnostics.push(...localDiagnostics);
  }
  diagnostics.push(...partition.global);
  diagnostics.sort((left, right) => {
    if (left.span.from !== right.span.from) {
      return left.span.from - right.span.from;
    }
    return left.span.to - right.span.to;
  });
  return diagnostics;
}

function shiftSpansDeep<T>(value: T, patchesOrDelta: readonly SourcePatch[] | number): T {
  const patches = typeof patchesOrDelta === "number" ? null : patchesOrDelta;
  const delta = typeof patchesOrDelta === "number" ? patchesOrDelta : 0;
  const visited = new WeakSet<object>();
  const visit = (current: unknown): void => {
    if (!current || typeof current !== "object") {
      return;
    }
    if (visited.has(current)) {
      return;
    }
    visited.add(current);
    if (Array.isArray(current)) {
      for (const entry of current) {
        visit(entry);
      }
      return;
    }
    if (
      "from" in current &&
      "to" in current &&
      typeof (current as { from?: unknown }).from === "number" &&
      typeof (current as { to?: unknown }).to === "number"
    ) {
      const span = current as { from: number; to: number };
      const next = patches ? shiftSpanThroughPatches(span, patches) : shiftSpan(span, delta);
      span.from = next.from;
      span.to = next.to;
    }
    for (const child of Object.values(current)) {
      visit(child);
    }
  };
  visit(value);
  return value;
}

function shiftDiagnosticThroughPatchesInPlace(diagnostic: Diagnostic, patches: readonly SourcePatch[]): void {
  diagnostic.span = shiftSpanThroughPatches(diagnostic.span, patches);
}

function shiftDiagnosticInPlace(diagnostic: Diagnostic, delta: number): void {
  diagnostic.span = shiftSpan(diagnostic.span, delta);
}

function shiftSpan(span: Span, delta: number): Span {
  return {
    from: span.from + delta,
    to: span.to + delta
  };
}

function shiftSpanThroughPatches(span: Span, patches: readonly SourcePatch[]): Span {
  let next = { ...span };
  // All old spans refer to the same source. Apply right to left so a
  // replacement cannot shift a span into the range of a later patch.
  for (let index = patches.length - 1; index >= 0; index--) {
    const patch = patches[index];
    next = shiftSpanThroughSinglePatch(next, patch);
  }
  return next;
}

function shiftSpanThroughSinglePatch(span: Span, patch: SourcePatch): Span {
  const oldSpan = patch.oldSpan;
  const newSpan = { from: oldSpan.from, to: oldSpan.from + patch.replacement.length };
  const delta = width(newSpan) - width(oldSpan);
  if (span.to <= oldSpan.from) {
    return span;
  }
  if (span.from >= oldSpan.to) {
    return {
      from: span.from + delta,
      to: span.to + delta
    };
  }
  if (span.from >= oldSpan.from && span.to <= oldSpan.to) {
    if (span.from === oldSpan.from && span.to === oldSpan.to) {
      return { ...newSpan };
    }
    const relativeFrom = span.from - oldSpan.from;
    const relativeTo = span.to - oldSpan.from;
    return {
      from: newSpan.from + Math.min(relativeFrom, width(newSpan)),
      to: newSpan.from + Math.min(relativeTo, width(newSpan))
    };
  }
  return {
    from: span.from,
    to: span.to + delta
  };
}

function width(span: Span): number {
  return span.to - span.from;
}

function spansOverlap(left: Span, right: Span): boolean {
  return left.from < right.to && right.from < left.to;
}

function resolveFigureDelimiterSpans(figures: readonly TikzFigureInventoryItem[], figureSpan: Span): {
  begin: Span;
  end: Span;
} {
  const figure = figures.find((candidate) => candidate.span.from === figureSpan.from && candidate.span.to === figureSpan.to);
  if (!figure) {
    throw new Error("Active figure is missing from the inventory");
  }
  return {
    begin: figure.beginSpan,
    end: figure.endSpan
  };
}

function getStatementAtPath(figure: TikzFigure, parentPath: readonly number[], index: number): Statement | null {
  const body = getBodyAtPath(figure, parentPath);
  return body.at(index) ?? null;
}

function setStatementAtPath(figure: TikzFigure, parentPath: readonly number[], index: number, statement: Statement): void {
  const body = getBodyAtPath(figure, parentPath);
  body[index] = statement;
}

function getBodyAtPath(figure: TikzFigure, parentPath: readonly number[]): Statement[] {
  let body = figure.body;
  for (const scopeIndex of parentPath) {
    const statement = body.at(scopeIndex);
    if (statement?.kind !== "Scope") {
      throw new Error(`Expected scope at path ${parentPath.join("/")}`);
    }
    body = statement.body;
  }
  return body;
}

function findContainingStatementRef(
  refsBySourceId: ReadonlyMap<string, StatementRef>,
  span: Span
): StatementRef | null {
  let best: StatementRef | null = null;
  for (const ref of refsBySourceId.values()) {
    if (ref.span.from <= span.from && ref.span.to >= span.to) {
      if (!best || width(ref.span) < width(best.span)) {
        best = ref;
      }
    }
  }
  return best;
}

function normalizeSourceIds(sourceIds: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const sourceId of sourceIds) {
    const normalized = sourceId.trim();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
  }
  return [...unique];
}

function normalizePatches(patches: readonly SourcePatch[]): SourcePatch[] {
  return [...patches]
    .filter((patch) => patch.oldSpan.from <= patch.oldSpan.to && patch.newSpan.from <= patch.newSpan.to)
    .sort((left, right) => left.oldSpan.from - right.oldSpan.from);
}

function revisionsMatch(left: number | null | undefined, right: number | null | undefined): boolean {
  return left != null && right != null && left === right;
}

function applyPatchesToSource(source: string, patches: readonly SourcePatch[]): string | null {
  let cursor = 0;
  let output = "";
  for (const patch of patches) {
    if (patch.oldSpan.from < cursor || patch.oldSpan.to > source.length) {
      return null;
    }
    output += source.slice(cursor, patch.oldSpan.from);
    output += patch.replacement;
    cursor = patch.oldSpan.to;
  }
  output += source.slice(cursor);
  return output;
}

function deriveSingleSourcePatch(previous: string, next: string): SourcePatch[] {
  if (previous === next) {
    return [];
  }

  let prefix = 0;
  const limit = Math.min(previous.length, next.length);
  while (prefix < limit && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }

  let previousSuffix = previous.length;
  let nextSuffix = next.length;
  while (
    previousSuffix > prefix &&
    nextSuffix > prefix &&
    previous.charCodeAt(previousSuffix - 1) === next.charCodeAt(nextSuffix - 1)
  ) {
    previousSuffix -= 1;
    nextSuffix -= 1;
  }

  return [
    {
      oldSpan: { from: prefix, to: previousSuffix },
      newSpan: { from: prefix, to: nextSuffix },
      replacement: next.slice(prefix, nextSuffix)
    }
  ];
}

function isWholeStatementPatch(cache: CachedIncrementalParseState, patch: SourcePatch): boolean {
  for (const ref of cache.statementRefsBySourceId.values()) {
    if (ref.span.from === patch.oldSpan.from && ref.span.to === patch.oldSpan.to) {
      return true;
    }
  }
  return false;
}

function countStatements(statements: readonly Statement[]): number {
  let count = 0;
  for (const statement of statements) {
    count += 1;
    if (statement.kind === "Scope") {
      count += countStatements(statement.body);
    }
  }
  return count;
}
