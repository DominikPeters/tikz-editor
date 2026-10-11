import type { PathStatement, Statement } from "../ast/types.js";
import { parseTikz, type ParseTikzResult } from "../parser/index.js";
import { createIncrementalParseSession, type IncrementalParseSession } from "../parser/incremental.js";
import {
  resolveFigurePropertyTargetFromParseResult,
  resolvePropertyTargetFromParseResult,
  type PropertyTargetResolution
} from "./property-target.js";
import {
  buildStatementSnapshotFromStatements,
  type StatementSnapshot
} from "./statement-ops.js";

export type EditAnalysisOptions = {
  activeFigureId?: string | null;
};

export type EditAnalysisView = {
  source: string;
  activeFigureId: string | null | undefined;
  parseResult: ParseTikzResult;
  statementSnapshot: StatementSnapshot;
  resolvePropertyTarget: (elementId: string) => PropertyTargetResolution;
  resolveFigurePropertyTarget: () => PropertyTargetResolution;
  findPathStatement: (sourceId: string) => PathStatement | null;
};

type EditAnalysisCache = {
  source: string;
  activeFigureId: string | null | undefined;
  parseResult: ParseTikzResult;
  statementSnapshot: StatementSnapshot;
  propertyTargetCache: Map<string, PropertyTargetResolution>;
  pathStatementCache: Map<string, PathStatement | null>;
  figureTargetCache: PropertyTargetResolution | null;
  view: EditAnalysisView;
  incremental?: IncrementalParseSession;
};

export type EditAnalysisSession = {
  primeFromParse: (
    parse: ParseTikzResult,
    source: string,
    options?: EditAnalysisOptions
  ) => EditAnalysisView;
  ensure: (source: string, options?: EditAnalysisOptions) => EditAnalysisView;
  reset: () => void;
};

/**
 * Keeps the last `capacity` parses, most recent first. Two by default, so
 * that callers with a slightly stale source (e.g. snapshot.source that hasn't
 * caught up to the latest edit) still get a cache hit instead of triggering
 * a redundant full parse. With `incremental`, a new source is parsed from the
 * most recent parse, reparsing only the statement its change falls in (the
 * parser falls back to a full parse when the change does not fit one).
 */
export function createEditAnalysisSession(capacity = 2, sessionOptions: { incremental?: boolean } = {}): EditAnalysisSession {
  let entries: EditAnalysisCache[] = [];

  const lookup = (source: string, activeFigureId: string | null | undefined): EditAnalysisCache | null =>
    entries.find((entry) => entry.source === source && entry.activeFigureId === activeFigureId) ?? null;

  const store = (entry: EditAnalysisCache): void => {
    entries = [entry, ...entries.filter((candidate) => candidate !== entry)].slice(0, capacity);
  };

  const ensure = (source: string, options: EditAnalysisOptions = {}): EditAnalysisView => {
    const activeFigureId = options.activeFigureId;
    const hit = lookup(source, activeFigureId);
    if (hit) {
      return hit.view;
    }
    const base = sessionOptions.incremental ? entries.find((entry) => entry.activeFigureId === activeFigureId) : undefined;
    const parseResult = base ? parseFrom(base, source, activeFigureId) : parseTikz(source, {
      recover: true,
      activeFigureId,
      includeContextDefinitions: true
    });
    const entry = createCache(source, parseResult, activeFigureId);
    store(entry);
    return entry.view;
  };

  return {
    primeFromParse(parse, _source, options = {}) {
      const activeFigureId = options.activeFigureId ?? parse.activeFigureId;
      const source = parse.source;
      const hit = lookup(source, activeFigureId);
      if (hit?.parseResult === parse) {
        return hit.view;
      }
      const entry = createCache(source, parse, activeFigureId);
      store(entry);
      return entry.view;
    },
    ensure,
    reset() {
      entries = [];
    }
  };
}

function parseFrom(base: EditAnalysisCache, source: string, activeFigureId: string | null | undefined): ParseTikzResult {
  if (!base.incremental) {
    base.incremental = createIncrementalParseSession();
    base.incremental.prime(base.parseResult, { activeFigureId, includeContextDefinitions: true });
  }
  return base.incremental.fork().evaluate({ source, activeFigureId, includeContextDefinitions: true, inferChanges: true }).parse;
}

function createCache(
  source: string,
  parseResult: ParseTikzResult,
  activeFigureId: string | null | undefined
): EditAnalysisCache {
  const statementSnapshot = buildStatementSnapshotFromStatements(source, parseResult.figure.body);
  const propertyTargetCache = new Map<string, PropertyTargetResolution>();
  const pathStatementCache = new Map<string, PathStatement | null>();

  const cache: EditAnalysisCache = {
    source,
    activeFigureId,
    parseResult,
    statementSnapshot,
    propertyTargetCache,
    pathStatementCache,
    figureTargetCache: null,
    view: null as unknown as EditAnalysisView
  };

  cache.view = {
    source,
    activeFigureId,
    parseResult,
    statementSnapshot,
    resolvePropertyTarget(elementId: string): PropertyTargetResolution {
      const cachedResolution = propertyTargetCache.get(elementId);
      if (cachedResolution) {
        return cachedResolution;
      }
      const resolution = resolvePropertyTargetFromParseResult(source, parseResult, elementId);
      propertyTargetCache.set(elementId, resolution);
      return resolution;
    },
    resolveFigurePropertyTarget(): PropertyTargetResolution {
      if (cache.figureTargetCache) {
        return cache.figureTargetCache;
      }
      const resolution = resolveFigurePropertyTargetFromParseResult(source, parseResult);
      cache.figureTargetCache = resolution;
      return resolution;
    },
    findPathStatement(sourceId: string): PathStatement | null {
      if (pathStatementCache.has(sourceId)) {
        return pathStatementCache.get(sourceId) ?? null;
      }
      const statement = findPathStatementInStatements(parseResult.figure.body, sourceId);
      pathStatementCache.set(sourceId, statement);
      return statement;
    }
  };

  return cache;
}

function findPathStatementInStatements(
  statements: readonly Statement[],
  sourceId: string
): PathStatement | null {
  for (const statement of statements) {
    if (statement.kind === "Path" && statement.id === sourceId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested = findPathStatementInStatements(statement.body, sourceId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}
