import { isObjectRecord } from "../utils/records.js";
import type { PathItem, Span, Statement } from "../ast/types.js";
import { parseTikz, type ParseTikzResult } from "../parser/index.js";
import { isWrappedBySingleBracePair } from "../utils/braces.js";

export type ForeachSnippetParseResult<T> = {
  value: T;
  hasParseError: boolean;
};

export type ForeachSnippetSourceMapper = {
  mapSpan: (span: Span) => Span | null;
  mapOffset: (offset: number) => number | null;
};

export type ForeachStatementBodyParseResult = {
  parseResult: ParseTikzResult;
  hasParseError: boolean;
  sourceMapper: ForeachSnippetSourceMapper;
};

export type PathFragmentParseResult = {
  value: PathItem[];
  hasParseError: boolean;
  sourceMapper: ForeachSnippetSourceMapper;
};

export function parseStatementsFromBody(bodyRaw: string): ForeachSnippetParseResult<Statement[]> {
  const parsed = parseStatementsFromBodyWithMapping(bodyRaw, { from: 0, to: bodyRaw.length });
  return {
    value: parsed.parseResult.figure.body,
    hasParseError: parsed.hasParseError
  };
}

export function parseStatementsFromBodyWithMapping(
  bodyRaw: string,
  bodySpan: Span
): ForeachStatementBodyParseResult {
  const prepared = prepareForeachBodySnippet(bodyRaw, bodySpan);
  const parseResult = parseTikz(prepared.syntheticSource, { recover: true });
  const hasParseError = parseResult.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  return {
    parseResult,
    hasParseError,
    sourceMapper: {
      mapSpan: (span) => mapSyntheticSpanToOriginal(span, prepared),
      mapOffset: (offset) => mapSyntheticOffsetToOriginal(offset, prepared)
    }
  };
}

export function parsePathItemsFromFragment(pathFragmentRaw: string): ForeachSnippetParseResult<PathItem[]> {
  const parsed = parsePathItemsFromFragmentWithMapping(pathFragmentRaw, { from: 0, to: pathFragmentRaw.length });
  return {
    value: parsed.value,
    hasParseError: parsed.hasParseError
  };
}

export function parsePathItemsFromFragmentWithMapping(pathFragmentRaw: string, fragmentSpan: Span): PathFragmentParseResult {
  const parsed = parsePathItemsFromFragmentWithSyntheticMapping(pathFragmentRaw, fragmentSpan);
  return {
    value: remapSpansInPathItems(parsed.value, parsed.sourceMapper),
    hasParseError: parsed.hasParseError,
    sourceMapper: parsed.sourceMapper
  };
}

export function parsePathItemsFromFragmentWithSyntheticMapping(pathFragmentRaw: string, fragmentSpan: Span): PathFragmentParseResult {
  const prepared = preparePathFragmentSnippet(pathFragmentRaw, fragmentSpan);
  const parsed = parseTikz(prepared.syntheticSource, { recover: true });
  const statement = parsed.figure.body.find((entry) => entry.kind === "Path");
  const hasParseError = parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const sourceMapper: ForeachSnippetSourceMapper = {
    mapSpan: (span) => mapSyntheticSpanToOriginal(span, prepared),
    mapOffset: (offset) => mapSyntheticOffsetToOriginal(offset, prepared)
  };

  if (statement?.kind !== "Path") {
    return {
      value: [],
      hasParseError: true,
      sourceMapper
    };
  }

  return {
    value: statement.items,
    hasParseError,
    sourceMapper
  };
}

export function parseNodeItemsFromTemplate(nodeTemplateRaw: string): ForeachSnippetParseResult<PathItem[]> {
  const source = `\\begin{tikzpicture}\n\\path ${nodeTemplateRaw};\n\\end{tikzpicture}`;
  const parsed = parseTikz(source, { recover: true });
  const statement = parsed.figure.body.find((entry) => entry.kind === "Path");
  const hasParseError = parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (statement?.kind !== "Path") {
    return {
      value: [],
      hasParseError: true
    };
  }

  return {
    value: statement.items,
    hasParseError
  };
}

type PreparedForeachBodySnippet = {
  syntheticSource: string;
  syntheticContentFrom: number;
  syntheticContentTo: number;
  originalContentFrom: number;
  originalContentTo: number;
};

type PreparedPathFragmentSnippet = {
  syntheticSource: string;
  syntheticContentFrom: number;
  syntheticContentTo: number;
  originalContentFrom: number;
  originalContentTo: number;
};

function prepareForeachBodySnippet(bodyRaw: string, bodySpan: Span): PreparedForeachBodySnippet {
  const leftTrimmed = bodyRaw.trimStart();
  const leftTrim = bodyRaw.length - leftTrimmed.length;
  const rightTrimmed = leftTrimmed.trimEnd();
  const rightTrim = leftTrimmed.length - rightTrimmed.length;

  let working = rightTrimmed;
  let openingTrim = 0;
  let closingTrim = 0;
  if (working.startsWith("{") && working.endsWith("}") && isWrappedBySingleBracePair(working)) {
    working = working.slice(1, -1);
    openingTrim = 1;
    closingTrim = 1;
  }

  const contentLeftTrimmed = working.trimStart();
  const contentLeftTrim = working.length - contentLeftTrimmed.length;
  const content = contentLeftTrimmed.trimEnd();
  const contentRightTrim = contentLeftTrimmed.length - content.length;

  const syntheticPrefix = "\\begin{tikzpicture}\n";
  const syntheticSuffix = "\n\\end{tikzpicture}";
  return {
    syntheticSource: `${syntheticPrefix}${content}${syntheticSuffix}`,
    syntheticContentFrom: syntheticPrefix.length,
    syntheticContentTo: syntheticPrefix.length + content.length,
    originalContentFrom: bodySpan.from + leftTrim + openingTrim + contentLeftTrim,
    originalContentTo: bodySpan.to - rightTrim - closingTrim - contentRightTrim
  };
}

function mapSyntheticOffsetToOriginal(
  offset: number,
  prepared: PreparedForeachBodySnippet | PreparedPathFragmentSnippet
): number | null {
  if (offset < prepared.syntheticContentFrom || offset > prepared.syntheticContentTo) {
    return null;
  }
  return prepared.originalContentFrom + (offset - prepared.syntheticContentFrom);
}

function mapSyntheticSpanToOriginal(
  span: Span,
  prepared: PreparedForeachBodySnippet | PreparedPathFragmentSnippet
): Span | null {
  const from = mapSyntheticOffsetToOriginal(span.from, prepared);
  const to = mapSyntheticOffsetToOriginal(span.to, prepared);
  if (from == null || to == null || from > to) {
    return null;
  }
  return { from, to };
}

function preparePathFragmentSnippet(pathFragmentRaw: string, fragmentSpan: Span): PreparedPathFragmentSnippet {
  let contentFrom = fragmentSpan.from;
  let contentTo = fragmentSpan.to;
  let working = pathFragmentRaw;

  const leftTrimmed = working.trimStart();
  contentFrom += working.length - leftTrimmed.length;
  working = leftTrimmed;

  const rightTrimmed = working.trimEnd();
  contentTo -= working.length - rightTrimmed.length;
  working = rightTrimmed;

  if (working.startsWith("{") && working.endsWith("}") && isWrappedBySingleBracePair(working)) {
    working = working.slice(1, -1);
    contentFrom += 1;
    contentTo -= 1;
  }

  const contentLeftTrimmed = working.trimStart();
  contentFrom += working.length - contentLeftTrimmed.length;
  working = contentLeftTrimmed;

  const contentRightTrimmed = working.trimEnd();
  contentTo -= working.length - contentRightTrimmed.length;
  const content = contentRightTrimmed;

  const syntheticPrefix = "\\begin{tikzpicture}\n\\path ";
  const syntheticSuffix = ";\n\\end{tikzpicture}";
  return {
    syntheticSource: `${syntheticPrefix}${content}${syntheticSuffix}`,
    syntheticContentFrom: syntheticPrefix.length,
    syntheticContentTo: syntheticPrefix.length + content.length,
    originalContentFrom: contentFrom,
    originalContentTo: contentTo
  };
}

function remapSpansInPathItems(items: PathItem[], sourceMapper: ForeachSnippetSourceMapper): PathItem[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The internal mapper preserves AST node shapes and only maps numeric span endpoints to numbers.
  return remapSpansDeep(items, sourceMapper.mapOffset) as PathItem[];
}

function remapSpansDeep(value: unknown, mapOffset: (offset: number) => number | null): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => remapSpansDeep(entry, mapOffset));
  }
  if (!isObjectRecord(value)) {
    return value;
  }

  const record = value;
  let nextRecord: Record<string, unknown> | null = null;

  const fromCandidate = record.from;
  const toCandidate = record.to;
  if (typeof fromCandidate === "number" && typeof toCandidate === "number") {
    const mappedFrom = mapOffset(fromCandidate);
    const mappedTo = mapOffset(toCandidate);
    if (mappedFrom != null && mappedTo != null) {
      nextRecord = {
        ...record,
        from: mappedFrom,
        to: mappedTo
      };
    }
  }

  const sourceRecord = nextRecord ?? record;
  for (const [key, nested] of Object.entries(sourceRecord)) {
    const mapped = remapSpansDeep(nested, mapOffset);
    if (mapped !== nested) {
      nextRecord ??= { ...sourceRecord };
      nextRecord[key] = mapped;
    }
  }

  return nextRecord ?? value;
}
