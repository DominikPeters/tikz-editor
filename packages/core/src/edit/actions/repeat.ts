import { applyFragments, editedSlice, legacyText, type FragmentEdit } from "../fragment.js";
import { requireArrayValue } from "../../utils/collections.js";
import type { EditActionResultLike } from "../result-types.js";
import type { PathItem, PathStatement, Span } from "../../ast/types.js";
import { walkPathItems } from "../../ast/walk.js";
import { worldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { ParseTikzResult } from "../../parser/index.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import { entryContextsForSource, sameSiteContext, type SiteContext } from "../../semantic/site-context.js";
import { isCoordinateEditHandle, type CoordinateEditHandle } from "../../semantic/types.js";
import { CoordinateWriteRefused } from "../new-statement.js";
import { createCoordinateWriter, type CoordinateWriter, type LoopStep } from "../writer/index.js";
import {
  applyTextReplacements,
  lineIndentAtOffset,
  parseStatementSnapshot,
  resolveStatementRefs,
  statementSnippet,
  type StatementRef,
  type StatementSnapshot
} from "../statement-ops.js";
import { applySetPropertyAction } from "./set-property.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import { normalizeElementIds, uniqueStrings } from "../statement-find.js";

export type RepeatElementsAction = {
  elementIds: string[];
  columns: number;
  rows: number;
  horizontalStep: number;
  verticalStep: number;
};


type RepeatLoop = {
  variable: string;
  count: number;
  stepPt: number;
};

export type RepeatSelectionEligibility =
  | {
      kind: "eligible";
      snapshot: StatementSnapshot;
      refs: StatementRef[];
      replaceSpan: Span;
      indent: string;
    }
  | {
      kind: "ineligible";
      reason: string;
    };

export function getRepeatSelectionEligibility(
  source: string,
  elementIds: readonly string[],
  parseOptions: EditParseOptions = {}
): RepeatSelectionEligibility {
  const normalizedIds = normalizeElementIds(elementIds);
  if (normalizedIds.length === 0) {
    return { kind: "ineligible", reason: "Select at least one authored element to repeat." };
  }
  if (normalizedIds.some((id) => id.startsWith("foreach:"))) {
    return { kind: "ineligible", reason: "Repeat is not available for foreach-generated instances." };
  }

  const snapshot = parseStatementSnapshot(source, parseOptions);
  const refs = resolveStatementRefs(snapshot, normalizedIds)
    .sort((left, right) => left.index - right.index);

  if (refs.length !== normalizedIds.length) {
    return { kind: "ineligible", reason: "Repeat currently requires a direct authored statement selection." };
  }
  const parentKeys = new Set(refs.map((ref) => ref.parentKey));
  if (parentKeys.size !== 1) {
    return { kind: "ineligible", reason: "Repeat currently requires statements from the same parent scope." };
  }

  const first = requireArrayValue(refs, 0);
  const last = requireArrayValue(refs, refs.length - 1);
  for (let index = 1; index < refs.length; index += 1) {
    if (requireArrayValue(refs, index).index !== requireArrayValue(refs, index - 1).index + 1) {
      return { kind: "ineligible", reason: "Repeat currently requires one contiguous authored block." };
    }
  }

  return {
    kind: "eligible",
    snapshot,
    refs,
    replaceSpan: { from: first.span.from, to: last.span.to },
    indent: lineIndentAtOffset(source, first.span.from)
  };
}

export function applyRepeatElementsAction(
  source: string,
  action: RepeatElementsAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const columns = normalizeRepeatCount(action.columns);
  const rows = normalizeRepeatCount(action.rows);
  if (columns === 1 && rows === 1) {
    return { kind: "unsupported", reason: "Repeat needs more than one row or column." };
  }
  if (!Number.isFinite(action.horizontalStep) || !Number.isFinite(action.verticalStep)) {
    return { kind: "error", message: "Repeat step values must be finite numbers." };
  }

  const eligibility = getRepeatSelectionEligibility(source, action.elementIds, parseOptions);
  if (eligibility.kind !== "eligible") {
    return { kind: "unsupported", reason: eligibility.reason };
  }

  let replacement: { text: string };
  try {
    replacement = buildRepeatReplacement(source, eligibility.refs, {
      columns,
      rows,
      horizontalStep: action.horizontalStep,
      verticalStep: action.verticalStep,
      parseOptions
    });
  } catch (error) {
    if (error instanceof CoordinateWriteRefused) return { kind: "unsupported", reason: `Cannot repeat here: ${error.message}.` };
    throw error;
  }

  const preferredNewline = detectPreferredNewline(source, eligibility.replaceSpan.from);
  const replacementText = indentFollowingLines(
    preferredNewline === "\n" ? replacement.text : replacement.text.replace(/\n/g, preferredNewline),
    eligibility.indent
  );
  const applied = applyTextReplacements(source, [
    {
      span: eligibility.replaceSpan,
      text: legacyText(replacementText)
    }
  ]);
  const inserted = requireArrayValue(applied.applied, 0);

  const replacementSpan = inserted.newSpan;
  const nextSnapshot = parseStatementSnapshot(applied.source, parseOptions);
  const insertedRefs = nextSnapshot.all.filter(
    (ref) => ref.span.from >= replacementSpan.from && ref.span.to <= replacementSpan.to
  );
  const outerRef = insertedRefs.find((ref) => ref.parentKey === requireArrayValue(eligibility.refs, 0).parentKey) ?? insertedRefs[0];
  const insertedStatementIds = insertedRefs.map((ref) => ref.id);
  const loopIds = insertedStatementIds.filter((id) => id.startsWith("foreach:"));

  return {
    kind: "success",
    newSource: applied.source,
    patches: applied.patches,
    ...(outerRef ? { selectedSourceIds: [outerRef.id] } : {}),
    changedSourceIds: uniqueStrings([...action.elementIds, ...loopIds])
  };
}

/**
 * What the copies are written against: the document as the evaluator reads
 * it, so every coordinate moves in the frame it is read in. A step of a loop
 * is a world vector; the writer turns it into the coordinate's own units.
 */
type RepeatGeometry = {
  source: string;
  parsed: ParseTikzResult;
  semantic: ReturnType<typeof evaluateTikzFigure>;
  writer: CoordinateWriter;
};

function buildRepeatReplacement(
  source: string,
  refs: readonly StatementRef[],
  options: {
    columns: number;
    rows: number;
    horizontalStep: number;
    verticalStep: number;
    parseOptions: EditParseOptions;
  }
): { text: string } {
  const snippet = refs.length === 1
    ? statementSnippet(source, requireArrayValue(refs, 0))
    : source.slice(requireArrayValue(refs, 0).span.from, requireArrayValue(refs, refs.length - 1).span.to);
  const usedLoopVars = new Set<string>();
  const xLoop = options.columns > 1
    ? {
        variable: chooseLoopVariable(snippet, ["\\i", "\\col", "\\x", "\\dx", "\\xx"], usedLoopVars),
        count: options.columns,
        stepPt: options.horizontalStep
      }
    : null;
  const yLoop = options.rows > 1
    ? {
        variable: chooseLoopVariable(snippet, ["\\j", "\\row", "\\y", "\\dy", "\\yy"], usedLoopVars),
        count: options.rows,
        stepPt: -options.verticalStep
      }
    : null;
  const parsed = parseTikzForEdit(source, options.parseOptions);
  const geometry: RepeatGeometry = {
    source,
    parsed,
    semantic: evaluateTikzFigure(parsed.figure, source),
    writer: createCoordinateWriter(source)
  };
  const steps = loopSteps(xLoop, yLoop);
  const body = refs.length === 1
    ? translateSingleStatementSnippet(geometry, requireArrayValue(refs, 0), steps, options.parseOptions)
    : wrapRepeatedBlockInScope(geometry, refs, steps);

  return {
    text: buildForeachChain(
      [yLoop, xLoop]
        .filter((loop): loop is RepeatLoop => loop != null)
        .map((loop) => `\\foreach ${loop.variable} in {${buildIndexList(loop.count)}}`),
      body
    )
  };
}

/** Each loop moves a copy by its step along the page: the first to the right, the second down. */
function loopSteps(xLoop: RepeatLoop | null, yLoop: RepeatLoop | null): LoopStep[] {
  return [
    ...(xLoop ? [{ variable: xLoop.variable, world: worldVector(pt(xLoop.stepPt), pt(0)) }] : []),
    ...(yLoop ? [{ variable: yLoop.variable, world: worldVector(pt(0), pt(yLoop.stepPt)) }] : [])
  ];
}

/** The frame a statement starts in. Refused where the document does not tell one frame. */
function statementEntryContext(geometry: RepeatGeometry, statementId: string): SiteContext {
  const contexts = entryContextsForSource(geometry.semantic.siteContexts, statementId);
  const [first] = contexts;
  if (!first) throw new CoordinateWriteRefused("the frame of the selection is unknown");
  if (contexts.some((context) => !sameSiteContext(first, context))) {
    throw new CoordinateWriteRefused("the selection is read in a different frame on each pass of an enclosing loop");
  }
  return first;
}

function translateSingleStatementSnippet(
  geometry: RepeatGeometry,
  ref: StatementRef,
  steps: readonly LoopStep[],
  parseOptions: EditParseOptions
): string {
  const { source } = geometry;
  const wrappedParseOptions = withoutActiveFigure(parseOptions);
  const statement = ref.statement;

  if (statement.kind === "Path") {
    const rewritten = rewritePathStatementCoordinates(geometry, statement, steps);
    if (rewritten && !hasParseErrors(wrapSnippetInFigure(rewritten), wrappedParseOptions)) {
      return rewritten;
    }
  }

  // A scope without options of its own is shifted in place: nothing in it reads the shift.
  if (statement.kind === "Scope" && (statement.options?.entries.length ?? 0) === 0) {
    const shift = geometry.writer.translated({ kind: "context", context: statementEntryContext(geometry, ref.id) }, steps);
    if (shift.kind !== "ok") throw new CoordinateWriteRefused(shift.reason);
    const result = applySetPropertyAction(source, { elementId: statement.id, key: "shift", value: `{${shift.fragment}}` }, parseOptions);
    if (result.kind === "success" || result.kind === "partial") {
      const movedRef = parseStatementSnapshot(result.newSource, parseOptions).byId.get(ref.id);
      if (movedRef && !hasParseErrors(wrapSnippetInFigure(statementSnippet(result.newSource, movedRef)), wrappedParseOptions)) {
        return statementSnippet(result.newSource, movedRef);
      }
    }
  }

  return wrapRepeatedBlockInScope(geometry, [ref], steps);
}

/** The block inside a scope whose `shift` is the loops' step, read in the frame the block starts in. */
function wrapRepeatedBlockInScope(
  geometry: RepeatGeometry,
  refs: readonly StatementRef[],
  steps: readonly LoopStep[]
): string {
  const first = requireArrayValue(refs, 0);
  const last = requireArrayValue(refs, refs.length - 1);
  const block = geometry.source.slice(first.span.from, last.span.to);
  const shift = geometry.writer.translated({ kind: "context", context: statementEntryContext(geometry, first.id) }, steps);
  if (shift.kind !== "ok") throw new CoordinateWriteRefused(shift.reason);
  return `\\begin{scope}[shift={${shift.fragment}}]\n${reindentSnippet(block, "  ")}\n\\end{scope}`;
}

function buildForeachChain(headers: readonly string[], body: string): string {
  let output = body;
  for (let index = headers.length - 1; index >= 0; index -= 1) {
    output = `${headers[index]} {\n${indentEveryLine(output, "  ")}\n}`;
  }
  return output;
}

function chooseLoopVariable(snippet: string, candidates: readonly string[], used: Set<string>): string {
  for (const candidate of candidates) {
    if (!used.has(candidate) && !snippet.includes(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }

  let index = 1;
  while (used.has(`\\v${index}`) || snippet.includes(`\\v${index}`)) {
    index += 1;
  }
  const fallback = `\\v${index}`;
  used.add(fallback);
  return fallback;
}

function buildIndexList(count: number): string {
  if (count <= 1) {
    return "0";
  }
  return `0, ..., ${count - 1}`;
}

function collectNodeNameCoordinateIds(items: readonly PathItem[]): Set<string> {
  const ids = new Set<string>();
  for (const [index, current] of items.entries()) {

    if (current.kind !== "Coordinate" || current.form !== "named") {
      continue;
    }
    const next = items[index + 1];
    const afterNext = items[index + 2];
    const node = items[index + 3];
    if (
      next?.kind === "PathKeyword" &&
      next.keyword === "at" &&
      afterNext?.kind === "Coordinate" &&
      node?.kind === "Node" &&
      node.name === current.x.trim()
    ) {
      ids.add(current.id);
    }
  }
  return ids;
}

/**
 * The statement's text with every coordinate moved by the loops' steps, each
 * in the frame its own handle was read in. Null where one cannot be moved
 * (relative, polar, named, or none recorded), and the caller wraps the
 * statement in a shifted scope instead.
 */
function rewritePathStatementCoordinates(
  geometry: RepeatGeometry,
  statement: PathStatement,
  steps: readonly LoopStep[]
): string | null {
  const { source, writer } = geometry;
  const handles = geometry.semantic.editHandles.filter(
    (handle): handle is CoordinateEditHandle => handle.sourceRef.sourceId === statement.id && isCoordinateEditHandle(handle)
  );
  const edits: FragmentEdit[] = [];
  const status = { failed: false };
  const nodeNameCoordinateIds = collectNodeNameCoordinateIds(statement.items);

  const translate = (span: Span, within = false): void => {
    // Each pass of a loop around the statement has its own handle; they must agree.
    const found = handles.filter(({ sourceRef: { sourceSpan } }) =>
      within ? sourceSpan.from >= span.from && sourceSpan.to <= span.to : sourceSpan.from === span.from && sourceSpan.to === span.to);
    const [first] = found;
    const at = first?.sourceRef.sourceSpan;
    if (!first || !at || found.some((handle) => !sameSiteContext(first.siteContext, handle.siteContext) || handle.sourceRef.sourceSpan.from !== at.from || handle.sourceRef.sourceSpan.to !== at.to)) {
      status.failed = true;
      return;
    }
    if (edits.some((edit) => edit.span.from === at.from && edit.span.to === at.to)) return;
    const written = writer.translated({ kind: "coordinate", handle: first }, steps);
    if (written.kind !== "ok") {
      status.failed = true;
      return;
    }
    edits.push({ span: at, fragment: written.fragment });
  };

  walkPathItems(statement.items, {
    onPathItem: (item) => {
      if (status.failed) {
        return;
      }

      if (item.kind === "Coordinate") {
        if (nodeNameCoordinateIds.has(item.id)) {
          return;
        }
        translate(item.span);
        return;
      }

      if ((item.kind === "ToOperation" || item.kind === "EdgeOperation") && item.target?.kind === "coordinate" && item.target.span) {
        translate(item.target.span);
      }
    },
    onNode: (node) => {
      if (status.failed || !node.atSpan || !node.atRaw) {
        return;
      }
      // `at={(x,y)}` has its handle on the inner coordinate; `at (x,y)` on the whole.
      translate(node.atSpan, true);
    }
  });

  if (status.failed || edits.length === 0) {
    return null;
  }

  const rewritten = applyFragments(source, edits);
  return editedSlice(rewritten, statement.span.from, statement.span.to + (rewritten.length - source.length));
}

function wrapSnippetInFigure(snippet: string): string {
  return `\\begin{tikzpicture}\n${reindentSnippet(snippet, "  ")}\n\\end{tikzpicture}`;
}

function indentFollowingLines(text: string, indent: string): string {
  if (indent.length === 0 || text.length === 0) {
    return text;
  }
  return text.replace(/\n/g, `\n${indent}`);
}

function indentEveryLine(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
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

function normalizeRepeatCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function detectPreferredNewline(source: string, aroundOffset: number): string {
  const windowStart = Math.max(0, aroundOffset - 256);
  const windowEnd = Math.min(source.length, aroundOffset + 256);
  const window = source.slice(windowStart, windowEnd);
  return window.includes("\r\n") ? "\r\n" : "\n";
}

function withoutActiveFigure(parseOptions: EditParseOptions): EditParseOptions {
  const { activeFigureId, ...rest } = parseOptions;
  void activeFigureId;
  return rest;
}

function hasParseErrors(source: string, parseOptions: EditParseOptions): boolean {
  const parsed = parseTikzForEdit(source, parseOptions);
  return parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
