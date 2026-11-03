import { EMPTY_FRAGMENT, layout, tikz, type EditedSource, type TikzFragment } from "./fragment.js";
import type { PathItem, PathStatement, Span, Statement, TikzFigure } from "../ast/types.js";
import { worldBounds, type WorldBounds } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import { PT_PER_CM } from "./format.js";
import { replaceSpan } from "./patch.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { normalizeOptionKey } from "./option-key.js";
import type { EditActionResult } from "./actions.js";
import type { EditGeometrySnapshot } from "./geometry-session.js";
import { prepareInsertion, type InsertionGap } from "./insertion-context.js";
import { createCoordinateWriter } from "./writer/index.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import type { EditHandle, EvaluateOptions } from "../semantic/types.js";

/**
 * Whether the picture's first statement fixes its bounding box: a
 * `\useasboundingbox` (or `use as bounding box` path) that is a rectangle, or
 * the four corners and `cycle` the writer uses under a rotated frame.
 */
export type FigureBoundsState =
  | { mode: "auto" }
  | { mode: "fixed"; sourceId: string; span: Span };

/** Bounds in world centimetres, as the inspector shows the rendered picture. */
export type SetFigureBoundsAction =
  | { kind: "setFigureBounds"; mode: "auto" }
  | { kind: "setFigureBounds"; mode: "fixed"; x: number; y: number; width: number; height: number };

export function resolveFigureBoundsState(source: string, parseOptions: EditParseOptions = {}): FigureBoundsState {
  const parsed = parseTikzForEdit(source, parseOptions);
  return resolveFigureBoundsFromFigure(parsed.figure);
}

export function resolveFigureBoundsFromFigure(figure: TikzFigure): FigureBoundsState {
  const statement = firstGeometryStatement(figure.body);
  if (statement?.kind !== "Path") {
    return { mode: "auto" };
  }
  return resolveSimpleBoundingBoxStatement(statement) ?? { mode: "auto" };
}

/**
 * The world box a fixed bounding-box statement makes, as the evaluator places
 * its coordinates: the hull of the statement's points.
 */
export function resolveFigureBoundsWorld(state: FigureBoundsState, editHandles: readonly EditHandle[]): WorldBounds | null {
  if (state.mode !== "fixed") return null;
  const points = editHandles.filter(handle => handle.sourceRef.sourceId === state.sourceId).map(handle => handle.world);
  if (points.length < 2) return null;
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  return worldBounds(pt(Math.min(...xs)), pt(Math.min(...ys)), pt(Math.max(...xs)), pt(Math.max(...ys)));
}

export function applySetFigureBoundsAction(
  source: string,
  action: SetFigureBoundsAction,
  parseOptions: EditParseOptions = {},
  evaluateOptions: EvaluateOptions = {},
  geometry?: EditGeometrySnapshot
): EditActionResult {
  const parsed = parseTikzForEdit(source, parseOptions);
  const current = resolveFigureBoundsFromFigure(parsed.figure);

  if (action.mode === "auto") {
    if (current.mode !== "fixed") {
      return { kind: "unsupported", reason: "Figure bounds are already automatic." };
    }
    const removed = removeBoundingBoxStatement(source, current.span);
    return successResult(source, removed.source, current.span, removed.changedSpan, EMPTY_FRAGMENT, [current.sourceId]);
  }

  // The statement is read where it stands (or will stand), with the styles
  // a `\useasboundingbox` path picks up there.
  const snapshot = geometry?.source === source ? geometry : { source, parsed, semantic: evaluateTikzFigure(parsed.figure, source, evaluateOptions) };
  const existingIndex = current.mode === "fixed"
    ? snapshot.semantic.siteContexts.statementEntries.findIndex(entry => entry.statementId === current.sourceId)
    : -1;
  const gap: InsertionGap = existingIndex >= 0 ? { kind: "before", statementIndex: existingIndex }
    : parsed.figure.body.length > 0 ? { kind: "before", statementIndex: 0 } : { kind: "end" };
  const context = prepareInsertion(snapshot, gap, { kind: "path", command: "useasboundingbox" }, evaluateOptions);
  const box = worldBounds(pt(action.x * PT_PER_CM), pt(action.y * PT_PER_CM),
    pt((action.x + Math.max(0, action.width)) * PT_PER_CM), pt((action.y + Math.max(0, action.height)) * PT_PER_CM));
  const body = createCoordinateWriter(source).bounds(context, box);
  if (body.kind !== "ok") return { kind: "unsupported", reason: `Cannot fix the figure bounds here: ${body.reason}.` };
  const replacement = tikz`\useasboundingbox ${body.fragment};`;
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
  const insertion = tikz`${layout(`${needsLeadingNewline ? "\n" : ""}${indent}`)}${replacement}${layout(needsTrailingNewline ? "\n" : "")}`;
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
  return isRectangle(items) || isClosedQuadrilateral(items) ? { mode: "fixed", sourceId: statement.id, span: statement.span } : null;
}

function isRectangle(items: readonly PathItem[]): boolean {
  const [start, keyword, end] = items;
  return items.length === 3 && start?.kind === "Coordinate" && keyword?.kind === "PathKeyword" &&
    normalizeOptionKey(keyword.keyword) === "rectangle" && end?.kind === "Coordinate";
}

/** `(p1) -- (p2) -- (p3) -- (p4) -- cycle`. */
function isClosedQuadrilateral(items: readonly PathItem[]): boolean {
  if (items.length !== 9) return false;
  return items.every((item, index) => index % 2 === 0
    ? index === 8 ? item.kind === "PathKeyword" && item.keyword === "cycle" : item.kind === "Coordinate"
    : item.kind === "PathKeyword" && item.keyword === "--");
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

function resolveFigureBoundsInsertOffset(source: string, figure: TikzFigure): number {
  if (figure.body[0]) {
    return source.lastIndexOf("\n", figure.body[0].span.from - 1) + 1;
  }
  const slice = source.slice(figure.span.from, figure.span.to);
  const endMatch = /\\end\{(?:tikzpicture\*?|tikzlayer)\}/g;
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

function removeBoundingBoxStatement(source: string, span: Span): { source: EditedSource; changedSpan: Span } {
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
  return replaceSpan(source, { from, to }, EMPTY_FRAGMENT);
}

function successResult(
  oldSource: string,
  newSource: EditedSource,
  oldSpan: Span,
  newSpan: Span,
  replacement: TikzFragment,
  changedSourceIds?: string[]
): EditActionResult {
  if (oldSource === newSource) {
    return { kind: "unsupported", reason: "Figure bounds update would not change the source." };
  }
  return {
    kind: "success",
    newSource,
    patches: [{ oldSpan, newSpan, replacement }],
    ...(changedSourceIds === undefined ? {} : { changedSourceIds })
  };
}
