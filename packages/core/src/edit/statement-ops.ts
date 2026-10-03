import type { Statement, Span, TikzFigureInventoryItem } from "../ast/types.js";
import type { SourcePatch } from "./types.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";

export type StatementRef = {
  id: string;
  span: Span;
  statement: Statement;
  parentKey: string;
  depth: number;
  index: number;
};

export type StatementSnapshot = {
  source: string;
  all: StatementRef[];
  byId: Map<string, StatementRef>;
  byParentKey: Map<string, StatementRef[]>;
};

export type StatementParentGroup = {
  parentKey: string;
  depth: number;
  refs: StatementRef[];
};

export type TextReplacement = {
  span: Span;
  text: string;
};

export type AppliedTextReplacement = {
  oldSpan: Span;
  newSpan: Span;
};

export function buildStatementSnapshotFromStatements(
  source: string,
  statements: readonly Statement[]
): StatementSnapshot {
  const all: StatementRef[] = [];
  const byId = new Map<string, StatementRef>();
  const byParentKey = new Map<string, StatementRef[]>();

  const visitStatements = (
    nestedStatements: readonly Statement[],
    parentKey: string,
    depth: number
  ): void => {
    const refs: StatementRef[] = [];
    for (let index = 0; index < nestedStatements.length; index += 1) {
      const statement = nestedStatements[index];
      if (!statement) {
        continue;
      }

      const ref: StatementRef = {
        id: statement.id,
        span: statement.span,
        statement,
        parentKey,
        depth,
        index
      };
      refs.push(ref);
      all.push(ref);
      byId.set(ref.id, ref);

      if (statement.kind === "Scope") {
        visitStatements(statement.body, `${parentKey}/${index}`, depth + 1);
      }
    }
    byParentKey.set(parentKey, refs);
  };

  visitStatements(statements, "root", 0);

  return {
    source,
    all,
    byId,
    byParentKey
  };
}

export function parseStatementSnapshot(source: string, parseOptions: EditParseOptions = {}): StatementSnapshot {
  if (
    parseOptions.analysisView?.source === source &&
    parseOptions.analysisView.activeFigureId === parseOptions.activeFigureId
  ) {
    return parseOptions.analysisView.statementSnapshot;
  }
  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  return buildStatementSnapshotFromStatements(source, parsed.figure.body);
}

export function resolveStatementRefs(
  snapshot: StatementSnapshot,
  elementIds: readonly string[]
): StatementRef[] {
  const seen = new Set<string>();
  const refs: StatementRef[] = [];
  for (const rawId of elementIds) {
    const id = rawId.trim();
    if (id.length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const ref = snapshot.byId.get(id);
    if (ref) {
      refs.push(ref);
    }
  }
  return refs;
}

export function groupStatementRefsByParent(refs: readonly StatementRef[]): StatementParentGroup[] {
  const groups = new Map<string, StatementParentGroup>();
  for (const ref of refs) {
    const existing = groups.get(ref.parentKey);
    if (!existing) {
      groups.set(ref.parentKey, {
        parentKey: ref.parentKey,
        depth: ref.depth,
        refs: [ref]
      });
      continue;
    }
    existing.refs.push(ref);
    existing.depth = Math.max(existing.depth, ref.depth);
  }

  const list = [...groups.values()];
  for (const group of list) {
    group.refs.sort((left, right) => left.index - right.index);
  }
  list.sort((left, right) => {
    if (left.depth !== right.depth) {
      return right.depth - left.depth;
    }
    return left.parentKey.localeCompare(right.parentKey);
  });
  return list;
}

export function lineIndentAtOffset(source: string, offset: number): string {
  const clamped = clampOffset(offset, source.length);
  const lineStart = source.lastIndexOf("\n", Math.max(0, clamped - 1)) + 1;
  const prefix = source.slice(lineStart, clamped);
  return prefix.match(/^[ \t]*/)?.[0] ?? "";
}

export function resolveRootInsertionPoint(source: string, figure?: TikzFigureInventoryItem): { offset: number; indent: string } {
  const endToken = "\\end{tikzpicture}";
  const endIndex = figure?.endSpan.from ?? source.lastIndexOf(endToken);
  if (endIndex < 0) {
    return {
      offset: source.length,
      indent: ""
    };
  }

  const endLineStart = source.lastIndexOf("\n", Math.max(0, endIndex - 1)) + 1;
  const endIndent = source.slice(endLineStart, endIndex).match(/^[ \t]*/)?.[0] ?? "";
  return {
    offset: endIndex,
    indent: `${endIndent}  `
  };
}

export function formatSnippetsForInsertion(
  snippets: readonly string[],
  indent: string,
  options?: { trailingNewline?: boolean; newline?: string }
): { text: string; snippetSpans: Span[] } {
  const normalized = snippets
    .map((snippet) => snippet.replace(/\r\n?/g, "\n").trimEnd())
    .filter((snippet) => snippet.trim().length > 0);

  if (normalized.length === 0) {
    return {
      text: "",
      snippetSpans: []
    };
  }

  let text = "";
  const snippetSpans: Span[] = [];
  let cursor = 0;

  for (const snippet of normalized) {
    text += "\n";
    cursor += 1;

    const start = cursor;
    const formatted = reindentSnippet(snippet, indent);
    text += formatted;
    cursor += formatted.length;

    snippetSpans.push({ from: start, to: cursor });
  }

  if (options?.trailingNewline) {
    const newline = options.newline ?? "\n";
    text += newline;
  }

  return {
    text,
    snippetSpans
  };
}

function reindentSnippet(snippet: string, indent: string): string {
  const lines = snippet.split("\n");
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  const minIndent = nonEmpty.reduce((minimum, line) => {
    const current = line.match(/^[ \t]*/)?.[0].length ?? 0;
    return Math.min(minimum, current);
  }, Number.POSITIVE_INFINITY);
  const trimIndent = Number.isFinite(minIndent) ? minIndent : 0;
  return lines
    .map((line) => {
      const stripped = trimIndent > 0 ? line.slice(Math.min(trimIndent, line.length)) : line;
      return `${indent}${stripped}`;
    })
    .join("\n");
}

export function applyTextReplacements(
  source: string,
  replacements: readonly TextReplacement[]
): {
  source: string;
  patches: SourcePatch[];
  applied: AppliedTextReplacement[];
} {
  if (replacements.length === 0) {
    return {
      source,
      patches: [],
      applied: []
    };
  }

  const sorted = [...replacements].sort((left, right) => {
    if (left.span.from !== right.span.from) {
      return left.span.from - right.span.from;
    }
    return left.span.to - right.span.to;
  });

  const patches: SourcePatch[] = [];
  const applied: AppliedTextReplacement[] = [];
  let cursor = 0;
  let delta = 0;
  let output = "";

  for (const replacement of sorted) {
    const oldFrom = clampOffset(replacement.span.from, source.length);
    const oldTo = clampOffset(replacement.span.to, source.length);
    if (oldFrom < cursor) {
      throw new Error("Overlapping replacements are not allowed");
    }

    output += source.slice(cursor, oldFrom);
    output += replacement.text;

    const newFrom = oldFrom + delta;
    const newTo = newFrom + replacement.text.length;
    const oldSpan = { from: oldFrom, to: oldTo };
    const newSpan = { from: newFrom, to: newTo };
    patches.push({
      oldSpan,
      newSpan,
      replacement: replacement.text
    });
    applied.push({ oldSpan, newSpan });

    delta += replacement.text.length - (oldTo - oldFrom);
    cursor = oldTo;
  }

  output += source.slice(cursor);
  return {
    source: output,
    patches,
    applied
  };
}

export function shiftSpansAfterReplacement(
  spans: readonly Span[],
  oldSpan: Span,
  newSpan: Span
): Span[] {
  if (spans.length === 0) {
    return [];
  }

  const delta = (newSpan.to - newSpan.from) - (oldSpan.to - oldSpan.from);
  return spans.map((span) => {
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
      const relativeFrom = span.from - oldSpan.from;
      const relativeTo = span.to - oldSpan.from;
      const newLength = newSpan.to - newSpan.from;
      return {
        from: newSpan.from + Math.min(relativeFrom, newLength),
        to: newSpan.from + Math.min(relativeTo, newLength)
      };
    }
    return span;
  });
}

export function mapSpansToStatementIds(source: string, spans: readonly Span[]): string[] {
  if (spans.length === 0) {
    return [];
  }

  const snapshot = parseStatementSnapshot(source);
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const span of spans) {
    const exact = snapshot.all.find(
      (ref) => ref.span.from === span.from && ref.span.to === span.to
    );
    if (exact && !seen.has(exact.id)) {
      seen.add(exact.id);
      ids.push(exact.id);
      continue;
    }

    let bestContained: StatementRef | null = null;
    for (const ref of snapshot.all) {
      if (ref.span.from <= span.from && ref.span.to >= span.to) {
        if (!bestContained || (ref.span.to - ref.span.from) < (bestContained.span.to - bestContained.span.from)) {
          bestContained = ref;
        }
      }
    }
    if (bestContained && !seen.has(bestContained.id)) {
      seen.add(bestContained.id);
      ids.push(bestContained.id);
      continue;
    }

    let bestOverlap: { ref: StatementRef; overlap: number } | null = null;
    for (const ref of snapshot.all) {
      const overlap = overlapWidth(span, ref.span);
      if (overlap <= 0) {
        continue;
      }
      if (!bestOverlap || overlap > bestOverlap.overlap) {
        bestOverlap = { ref, overlap };
      }
    }
    if (bestOverlap && !seen.has(bestOverlap.ref.id)) {
      seen.add(bestOverlap.ref.id);
      ids.push(bestOverlap.ref.id);
    }
  }

  return ids;
}

export function statementSnippet(source: string, ref: StatementRef): string {
  return source.slice(ref.span.from, ref.span.to);
}

function overlapWidth(left: Span, right: Span): number {
  const from = Math.max(left.from, right.from);
  const to = Math.min(left.to, right.to);
  return Math.max(0, to - from);
}

function clampOffset(value: number, sourceLength: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(sourceLength, Math.trunc(value)));
}
