import type { PathStatement, Span, Statement, TikzFigure } from "../ast/types.js";
import { CM_PER_PT, formatNumber } from "./format.js";
import { replaceSpan } from "./patch.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { parseLength } from "../semantic/coords/parse-length.js";
import { normalizeOptionKey } from "./option-key.js";
import type { EditActionResult } from "./actions.js";

export type FigureBoundsState =
  | { mode: "auto" }
  | {
      mode: "fixed";
      x: number;
      y: number;
      width: number;
      height: number;
      sourceId: string;
      span: Span;
    };

export type SetFigureBoundsAction =
  | { kind: "setFigureBounds"; mode: "auto" }
  | { kind: "setFigureBounds"; mode: "fixed"; x: number; y: number; width: number; height: number };

export function resolveFigureBoundsState(source: string, parseOptions: EditParseOptions = {}): FigureBoundsState {
  const parsed = parseTikzForEdit(source, parseOptions);
  const statement = firstGeometryStatement(parsed.figure.body);
  if (statement?.kind !== "Path") {
    return { mode: "auto" };
  }
  return resolveSimpleBoundingBoxStatement(statement) ?? { mode: "auto" };
}

export function applySetFigureBoundsAction(
  source: string,
  action: SetFigureBoundsAction,
  parseOptions: EditParseOptions = {}
): EditActionResult {
  const parsed = parseTikzForEdit(source, parseOptions);
  const current = resolveFigureBoundsState(source, parseOptions);

  if (action.mode === "auto") {
    if (current.mode !== "fixed") {
      return { kind: "unsupported", reason: "Figure bounds are already automatic." };
    }
    const removed = removeBoundingBoxStatement(source, current.span);
    return successResult(source, removed.source, current.span, removed.changedSpan, "", [current.sourceId]);
  }

  const replacement = formatUseAsBoundingBoxStatement(action);
  if (current.mode === "fixed") {
    const updated = replaceSpan(source, current.span, replacement);
    return successResult(source, updated.source, current.span, updated.changedSpan, replacement, [current.sourceId]);
  }

  const insertOffset = resolveFigureBoundsInsertOffset(source, parsed.figure);
  const prefix = source.slice(0, insertOffset);
  const suffix = source.slice(insertOffset);
  const indent = resolveFigureBodyIndent(source, parsed.figure);
  const needsLeadingNewline = prefix.length > 0 && !prefix.endsWith("\n");
  const needsTrailingNewline = suffix.length > 0 && !suffix.startsWith("\n");
  const insertion = `${needsLeadingNewline ? "\n" : ""}${indent}${replacement}${needsTrailingNewline ? "\n" : ""}`;
  const inserted = replaceSpan(source, { from: insertOffset, to: insertOffset }, insertion);
  return successResult(source, inserted.source, { from: insertOffset, to: insertOffset }, inserted.changedSpan, insertion);
}

function firstGeometryStatement(statements: readonly Statement[]): Statement | null {
  for (const statement of statements) {
    if (statement.kind === "Path" || statement.kind === "Scope" || statement.kind === "Foreach") {
      return statement;
    }
  }
  return null;
}

function resolveSimpleBoundingBoxStatement(statement: PathStatement): FigureBoundsState | null {
  if (!isBoundingBoxCommand(statement) && !isPathUseAsBoundingBox(statement)) {
    return null;
  }
  const items = statement.items.filter((item) => item.kind !== "PathComment" && item.kind !== "PathOption");
  if (items.length !== 3) {
    return null;
  }
  const [start, keyword, end] = items;
  if (start?.kind !== "Coordinate" || keyword?.kind !== "PathKeyword" || end?.kind !== "Coordinate") {
    return null;
  }
  if (normalizeOptionKey(keyword.keyword) !== "rectangle") {
    return null;
  }
  const startX = parseCoordinateComponentCm(start.x);
  const startY = parseCoordinateComponentCm(start.y);
  const endX = parseCoordinateComponentCm(end.x);
  const endY = parseCoordinateComponentCm(end.y);
  if (startX == null || startY == null || endX == null || endY == null) {
    return null;
  }
  const minX = Math.min(startX, endX);
  const minY = Math.min(startY, endY);
  return {
    mode: "fixed",
    x: minX,
    y: minY,
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
    sourceId: statement.id,
    span: statement.span
  };
}

function isBoundingBoxCommand(statement: PathStatement): boolean {
  return statement.command === "useasboundingbox" && !statement.options;
}

function isPathUseAsBoundingBox(statement: PathStatement): boolean {
  if (statement.command !== "path") {
    return false;
  }
  const optionLists = [
    statement.options,
    ...statement.items
      .filter((item) => item.kind === "PathOption")
      .map((item) => item.options)
  ];
  return optionLists.some((options) => options?.raw.trim() === "use as bounding box" || (options?.entries ?? []).some(
    (entry) =>
      (entry.kind === "flag" || entry.kind === "kv") &&
      normalizeOptionKey(entry.key) === "use as bounding box"
  ));
}

function parseCoordinateComponentCm(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
    return Number(trimmed);
  }
  const pt = parseLength(trimmed, "pt");
  return pt == null ? null : pt * CM_PER_PT;
}

function resolveFigureBoundsInsertOffset(source: string, figure: TikzFigure): number {
  if (figure.body[0]) {
    return source.lastIndexOf("\n", figure.body[0].span.from - 1) + 1;
  }
  const slice = source.slice(figure.span.from, figure.span.to);
  const endMatch = /\\end\{tikzpicture\*?\}/g;
  let lastMatch: RegExpExecArray | null = null;
  for (let match = endMatch.exec(slice); match !== null; match = endMatch.exec(slice)) {
    lastMatch = match;
  }
  return lastMatch ? figure.span.from + lastMatch.index : figure.span.to;
}

function resolveFigureBodyIndent(source: string, figure: TikzFigure): string {
  const firstStatement = figure.body[0];
  if (firstStatement) {
    const lineStart = source.lastIndexOf("\n", firstStatement.span.from - 1) + 1;
    return source.slice(lineStart, firstStatement.span.from).match(/^[ \t]*/)?.[0] ?? "  ";
  }
  return "  ";
}

function formatUseAsBoundingBoxStatement(bounds: Extract<SetFigureBoundsAction, { mode: "fixed" }>): string {
  const x1 = bounds.x;
  const y1 = bounds.y;
  const x2 = bounds.x + Math.max(0, bounds.width);
  const y2 = bounds.y + Math.max(0, bounds.height);
  return `\\useasboundingbox (${formatNumber(x1)},${formatNumber(y1)}) rectangle (${formatNumber(x2)},${formatNumber(y2)});`;
}

function removeBoundingBoxStatement(source: string, span: Span): { source: string; changedSpan: Span } {
  const lineStart = source.lastIndexOf("\n", span.from - 1) + 1;
  const leading = source.slice(lineStart, span.from);
  let from = /^[ \t]*$/.test(leading) ? lineStart : span.from;
  let to = span.to;
  if (source[to] === "\n") {
    to += 1;
  } else {
    while (from > 0 && (source[from - 1] === " " || source[from - 1] === "\t")) {
      from -= 1;
    }
  }
  return replaceSpan(source, { from, to }, "");
}

function successResult(
  oldSource: string,
  newSource: string,
  oldSpan: Span,
  newSpan: Span,
  replacement: string,
  changedSourceIds?: string[]
): EditActionResult {
  if (oldSource === newSource) {
    return { kind: "unsupported", reason: "Figure bounds update would not change the source." };
  }
  return {
    kind: "success",
    newSource,
    patches: [{ oldSpan, newSpan, replacement }],
    changedSourceIds
  };
}
