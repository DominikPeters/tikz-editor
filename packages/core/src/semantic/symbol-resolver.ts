import type { Span } from "../ast/types.js";

export type SemanticSymbolKind = "macro" | "color" | "style" | "key" | "library";

export type SemanticSymbolDefinition = {
  kind: SemanticSymbolKind;
  name: string;
  statementId: string;
  span: Span;
};

export type SemanticSymbolDependencyEdge = {
  consumerStatementId: string;
  providerStatementId: string;
  kind: SemanticSymbolKind;
  name: string;
};

export type SemanticUnresolvedSymbol = {
  consumerStatementId: string;
  kind: SemanticSymbolKind;
  name: string;
};

type SemanticSymbolScopeFrame = {
  macro: Map<string, SemanticSymbolDefinition>;
  color: Map<string, SemanticSymbolDefinition>;
  style: Map<string, SemanticSymbolDefinition>;
  key: Map<string, SemanticSymbolDefinition>;
  library: Map<string, SemanticSymbolDefinition>;
};

export type SemanticSymbolResolverState = {
  scopes: SemanticSymbolScopeFrame[];
  dependencyEdges: SemanticSymbolDependencyEdge[];
  unresolvedSymbols: SemanticUnresolvedSymbol[];
  requiredLibraries: string[];
};

export type SemanticSymbolResolver = {
  scopes: SemanticSymbolScopeFrame[];
  dependencyEdges: Map<string, SemanticSymbolDependencyEdge>;
  unresolvedSymbols: Map<string, SemanticUnresolvedSymbol>;
  requiredLibraries: Set<string>;
};

function createScopeFrame(): SemanticSymbolScopeFrame {
  return {
    macro: new Map(),
    color: new Map(),
    style: new Map(),
    key: new Map(),
    library: new Map()
  };
}

function normalizeSymbolName(kind: SemanticSymbolKind, name: string): string {
  const trimmed = name.trim();
  if (kind === "library") {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function mapForKind(frame: SemanticSymbolScopeFrame, kind: SemanticSymbolKind): Map<string, SemanticSymbolDefinition> {
  if (kind === "macro") {
    return frame.macro;
  }
  if (kind === "color") {
    return frame.color;
  }
  if (kind === "style") {
    return frame.style;
  }
  if (kind === "key") {
    return frame.key;
  }
  return frame.library;
}

export function createSemanticSymbolResolver(): SemanticSymbolResolver {
  return {
    scopes: [createScopeFrame()],
    dependencyEdges: new Map(),
    unresolvedSymbols: new Map(),
    requiredLibraries: new Set()
  };
}

export function pushSemanticSymbolScope(resolver: SemanticSymbolResolver): void {
  resolver.scopes.push(createScopeFrame());
}

export function popSemanticSymbolScope(resolver: SemanticSymbolResolver): void {
  if (resolver.scopes.length > 1) {
    resolver.scopes.pop();
  }
}

export function defineSemanticSymbol(
  resolver: SemanticSymbolResolver,
  definition: SemanticSymbolDefinition
): void {
  const normalizedName = normalizeSymbolName(definition.kind, definition.name);
  if (normalizedName.length === 0) {
    return;
  }
  const top = resolver.scopes[resolver.scopes.length - 1];
  if (!top) {
    return;
  }
  mapForKind(top, definition.kind).set(normalizedName, {
    ...definition,
    name: normalizedName
  });
}

export function resolveSemanticSymbol(
  resolver: SemanticSymbolResolver,
  kind: SemanticSymbolKind,
  name: string,
  consumerStatementId: string | null
): SemanticSymbolDefinition | null {
  const normalizedName = normalizeSymbolName(kind, name);
  if (normalizedName.length === 0) {
    return null;
  }

  let resolved: SemanticSymbolDefinition | null = null;
  for (let index = resolver.scopes.length - 1; index >= 0; index -= 1) {
    const frame = resolver.scopes[index];
    if (!frame) {
      continue;
    }
    const candidate = mapForKind(frame, kind).get(normalizedName);
    if (candidate) {
      resolved = candidate;
      break;
    }
  }

  if (!consumerStatementId) {
    return resolved;
  }

  if (resolved) {
    const edge: SemanticSymbolDependencyEdge = {
      consumerStatementId,
      providerStatementId: resolved.statementId,
      kind,
      name: normalizedName
    };
    const key = `${edge.consumerStatementId}\u0000${edge.providerStatementId}\u0000${edge.kind}\u0000${edge.name}`;
    resolver.dependencyEdges.set(key, edge);
  } else {
    const unresolved: SemanticUnresolvedSymbol = {
      consumerStatementId,
      kind,
      name: normalizedName
    };
    const key = `${unresolved.consumerStatementId}\u0000${unresolved.kind}\u0000${unresolved.name}`;
    resolver.unresolvedSymbols.set(key, unresolved);
  }

  return resolved;
}

export function requireSemanticLibrary(
  resolver: SemanticSymbolResolver,
  libraryName: string,
  consumerStatementId: string | null
): void {
  const normalized = normalizeSymbolName("library", libraryName);
  if (normalized.length === 0) {
    return;
  }
  resolver.requiredLibraries.add(normalized);
  void resolveSemanticSymbol(resolver, "library", normalized, consumerStatementId);
}

export function exportSemanticSymbolResolverState(resolver: SemanticSymbolResolver): SemanticSymbolResolverState {
  return {
    scopes: resolver.scopes.map((scope) => ({
      macro: new Map(scope.macro),
      color: new Map(scope.color),
      style: new Map(scope.style),
      key: new Map(scope.key),
      library: new Map(scope.library)
    })),
    dependencyEdges: [...resolver.dependencyEdges.values()],
    unresolvedSymbols: [...resolver.unresolvedSymbols.values()],
    requiredLibraries: [...resolver.requiredLibraries].sort((left, right) => left.localeCompare(right))
  };
}

/**
 * Records again what `consumers` looked up in an earlier run, from that run's
 * final state: their dependency edges, the names they could not resolve, and
 * the libraries they required (each recorded as one or the other). For
 * statements a run reuses instead of evaluating.
 */
export function restoreSemanticSymbolUses(
  resolver: SemanticSymbolResolver,
  state: SemanticSymbolResolverState,
  consumers: ReadonlySet<string>
): void {
  for (const edge of state.dependencyEdges) {
    if (!consumers.has(edge.consumerStatementId)) continue;
    resolver.dependencyEdges.set(`${edge.consumerStatementId}\u0000${edge.providerStatementId}\u0000${edge.kind}\u0000${edge.name}`, edge);
    if (edge.kind === "library") resolver.requiredLibraries.add(edge.name);
  }
  for (const entry of state.unresolvedSymbols) {
    if (!consumers.has(entry.consumerStatementId)) continue;
    resolver.unresolvedSymbols.set(`${entry.consumerStatementId}\u0000${entry.kind}\u0000${entry.name}`, entry);
    if (entry.kind === "library") resolver.requiredLibraries.add(entry.name);
  }
}

export function importSemanticSymbolResolverState(
  resolver: SemanticSymbolResolver,
  state: SemanticSymbolResolverState
): void {
  resolver.scopes = state.scopes.map((scope) => ({
    macro: new Map(scope.macro),
    color: new Map(scope.color),
    style: new Map(scope.style),
    key: new Map(scope.key),
    library: new Map(scope.library)
  }));
  if (resolver.scopes.length === 0) {
    resolver.scopes = [createScopeFrame()];
  }

  resolver.dependencyEdges = new Map(
    state.dependencyEdges.map((edge) => [
      `${edge.consumerStatementId}\u0000${edge.providerStatementId}\u0000${edge.kind}\u0000${edge.name}`,
      edge
    ])
  );
  resolver.unresolvedSymbols = new Map(
    state.unresolvedSymbols.map((entry) => [
      `${entry.consumerStatementId}\u0000${entry.kind}\u0000${entry.name}`,
      entry
    ])
  );
  resolver.requiredLibraries = new Set(state.requiredLibraries);
}

