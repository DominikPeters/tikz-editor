import type { EditActionResultLike } from "../result-types.js";
import type { CoordinateItem, NodeItem, PathItem, PathStatement, Span, Statement } from "../../ast/types.js";
import { walkPathItems } from "../../ast/walk.js";
import { parseCoordinate } from "../../domains/coordinates/parse.js";
import { CM_PER_PT, formatNumber } from "../format.js";
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

  const first = refs[0];
  const last = refs[refs.length - 1];
  for (let index = 1; index < refs.length; index += 1) {
    if (refs[index].index !== refs[index - 1].index + 1) {
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

  const replacement = buildRepeatReplacement(source, eligibility.refs, {
    columns,
    rows,
    horizontalStep: action.horizontalStep,
    verticalStep: action.verticalStep,
    parseOptions
  });

  const preferredNewline = detectPreferredNewline(source, eligibility.replaceSpan.from);
  const replacementText = indentFollowingLines(
    preferredNewline === "\n" ? replacement.text : replacement.text.replace(/\n/g, preferredNewline),
    eligibility.indent
  );
  const applied = applyTextReplacements(source, [
    {
      span: eligibility.replaceSpan,
      text: replacementText
    }
  ]);
  const inserted = applied.applied[0];

  const replacementSpan = inserted.newSpan;
  const nextSnapshot = parseStatementSnapshot(applied.source, parseOptions);
  const insertedRefs = nextSnapshot.all.filter(
    (ref) => ref.span.from >= replacementSpan.from && ref.span.to <= replacementSpan.to
  );
  const outerRef = insertedRefs.find((ref) => ref.parentKey === eligibility.refs[0].parentKey) ?? insertedRefs[0];
  const insertedStatementIds = insertedRefs.map((ref) => ref.id);
  const loopIds = insertedStatementIds.filter((id) => id.startsWith("foreach:"));

  return {
    kind: "success",
    newSource: applied.source,
    patches: applied.patches,
    selectedSourceIds: outerRef ? [outerRef.id] : undefined,
    changedSourceIds: uniqueStrings([...action.elementIds, ...loopIds])
  };
}

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
    ? statementSnippet(source, refs[0])
    : source.slice(refs[0].span.from, refs[refs.length - 1].span.to);
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
  const body = refs.length === 1
    ? translateSingleStatementSnippet(source, refs[0], xLoop, yLoop, options.parseOptions)
    : wrapRepeatedBlockInScope(source, refs, xLoop, yLoop);

  return {
    text: buildForeachChain(
      [yLoop, xLoop]
        .filter((loop): loop is RepeatLoop => loop != null)
        .map((loop) => `\\foreach ${loop.variable} in {${buildIndexList(loop.count)}}`),
      body
    )
  };
}

function translateSingleStatementSnippet(
  source: string,
  ref: StatementRef,
  xLoop: RepeatLoop | null,
  yLoop: RepeatLoop | null,
  parseOptions: EditParseOptions
): string {
  const snippet = statementSnippet(source, ref);
  const wrapped = wrapSnippetInFigure(snippet);
  const wrappedParseOptions = withoutActiveFigure(parseOptions);
  const wrappedParsed = parseTikzForEdit(wrapped, wrappedParseOptions);
  const rootStatement = wrappedParsed.figure.body[0];

  if (rootStatement.kind === "Path") {
    const rewritten = rewritePathStatementCoordinates(wrapped, rootStatement, xLoop, yLoop);
    if (rewritten && !hasParseErrors(rewritten, wrappedParseOptions)) {
      const movedSnapshot = parseStatementSnapshot(rewritten, wrappedParseOptions);
      const movedRootRef = movedSnapshot.byParentKey.get("root")?.[0];
      if (movedRootRef) {
        return statementSnippet(rewritten, movedRootRef);
      }
    }
  }

  if (rootStatement.kind === "Scope") {
    const shifted = applyInlineScopeShift(wrapped, rootStatement, xLoop, yLoop, wrappedParseOptions);
    if (shifted && !hasParseErrors(shifted, wrappedParseOptions)) {
      const movedSnapshot = parseStatementSnapshot(shifted, wrappedParseOptions);
      const movedRootRef = movedSnapshot.byParentKey.get("root")?.[0];
      if (movedRootRef) {
        return statementSnippet(shifted, movedRootRef);
      }
    }
  }

  return wrapRepeatedBlockInScope(source, [ref], xLoop, yLoop);
}

function wrapRepeatedBlockInScope(
  source: string,
  refs: readonly StatementRef[],
  xLoop: RepeatLoop | null,
  yLoop: RepeatLoop | null
): string {
  const first = refs[0];
  const last = refs[refs.length - 1];
  const block = source.slice(first.span.from, last.span.to);
  const shiftTuple = buildShiftTuple(xLoop, yLoop)!;
  return `\\begin{scope}[shift={${shiftTuple}}]\n${reindentSnippet(block, "  ")}\n\\end{scope}`;
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

function buildShiftTuple(xLoop: RepeatLoop | null, yLoop: RepeatLoop | null): string | null {
  if (!xLoop && !yLoop) {
    return null;
  }
  return `(${buildLoopOffsetExpression(xLoop) ?? "0"},${buildLoopOffsetExpression(yLoop) ?? "0"})`;
}

function rewritePathStatementCoordinates(
  source: string,
  statement: PathStatement,
  xLoop: RepeatLoop | null,
  yLoop: RepeatLoop | null
): string | null {
  const replacements: Array<{ span: Span; text: string }> = [];
  let failed = false;
  const nodeNameCoordinateIds = collectNodeNameCoordinateIds(statement.items);

  walkPathItems(statement.items, {
    onPathItem: (item) => {
      if (failed) {
        return;
      }

      if (item.kind === "Coordinate") {
        if (nodeNameCoordinateIds.has(item.id)) {
          return;
        }
        const translated = buildTranslatedCoordinateItemRaw(item, source, xLoop, yLoop);
        if (!translated) {
          failed = true;
          return;
        }
        replacements.push({ span: item.span, text: translated });
        return;
      }

      if ((item.kind === "ToOperation" || item.kind === "EdgeOperation") && item.target?.kind === "coordinate" && item.target.span) {
        const translated = buildTranslatedCoordinateTextFromRaw(
          item.target.raw,
          item.target.relativePrefix,
          xLoop,
          yLoop
        );
        if (!translated) {
          failed = true;
          return;
        }
        replacements.push({ span: item.target.span, text: translated });
      }
    },
    onNode: (node) => {
      if (failed || !node.atSpan || !node.atRaw) {
        return;
      }
      const translated = buildTranslatedNodePlacementRaw(node, source, xLoop, yLoop);
      if (!translated) {
        failed = true;
        return;
      }
      replacements.push({ span: node.atSpan, text: translated });
    }
  });

  if (failed || replacements.length === 0) {
    return null;
  }

  return applyTextReplacements(source, replacements).source;
}

function collectNodeNameCoordinateIds(items: readonly PathItem[]): Set<string> {
  const ids = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const current = items[index];
    if (current?.kind !== "Coordinate" || current.form !== "named") {
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

function buildTranslatedCoordinateItemRaw(
  item: CoordinateItem,
  source: string,
  xLoop: RepeatLoop | null,
  yLoop: RepeatLoop | null
): string | null {
  if (item.relativePrefix) {
    return null;
  }

  return buildTranslatedCoordinateText(
    item.form,
    item.x,
    item.y,
    item.z,
    item.optionsSpan ? source.slice(item.optionsSpan.from, item.optionsSpan.to).trim() : "",
    xLoop,
    yLoop
  );
}

function buildTranslatedNodePlacementRaw(
  node: NodeItem,
  source: string,
  xLoop: RepeatLoop | null,
  yLoop: RepeatLoop | null
): string | null {
  const translated = buildTranslatedCoordinateTextFromRaw(node.atRaw ?? "", node.atRelativePrefix, xLoop, yLoop);
  if (!translated || !node.atSpan) {
    return null;
  }

  const current = source.slice(node.atSpan.from, node.atSpan.to).trim();
  if (current.startsWith("(")) {
    return translated;
  }

  const relativePrefix = node.atRelativePrefix ?? "";
  return `at={${relativePrefix}${translated}}`;
}

function buildTranslatedCoordinateTextFromRaw(
  raw: string,
  relativePrefix: string | undefined,
  xLoop: RepeatLoop | null,
  yLoop: RepeatLoop | null
): string | null {
  if (relativePrefix) {
    return null;
  }

  const parsed = parseCoordinate(raw);
  return buildTranslatedCoordinateText(parsed.form, parsed.x, parsed.y, parsed.z, parsed.optionsRaw ?? "", xLoop, yLoop);
}

function buildTranslatedCoordinateText(
  form: string,
  x: string,
  y: string,
  z: string | undefined,
  optionsRaw: string,
  xLoop: RepeatLoop | null,
  yLoop: RepeatLoop | null
): string | null {
  if (form !== "cartesian" && form !== "xyz") {
    return null;
  }

  const translatedX = translateCoordinateComponent(x, xLoop);
  const translatedY = translateCoordinateComponent(y, yLoop);
  if (!translatedX || !translatedY) {
    return null;
  }

  const parts = [translatedX, translatedY];
  if (form === "xyz" && z != null) {
    parts.push(z.trim());
  }
  const optionsPrefix = optionsRaw.trim().length > 0 ? `${optionsRaw.trim()} ` : "";
  return `(${optionsPrefix}${parts.join(",")})`;
}

function translateCoordinateComponent(raw: string, loop: RepeatLoop | null): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!loop) {
    return trimmed;
  }
  const offsetExpression = buildLoopOffsetExpression(loop);
  if (!offsetExpression || offsetExpression === "0") {
    return isBareNumber(trimmed) ? `${trimmed}cm` : trimmed;
  }
  if (trimmed === "0") {
    return offsetExpression;
  }
  const baseExpression = isBareNumber(trimmed) ? `${trimmed}cm` : trimmed;
  return offsetExpression.startsWith("-")
    ? `${baseExpression}${offsetExpression}`
    : `${baseExpression}+${offsetExpression}`;
}

function buildLoopOffsetExpression(loop: RepeatLoop | null): string | null {
  if (!loop) {
    return null;
  }
  const stepCm = Math.abs(loop.stepPt * CM_PER_PT);
  if (stepCm <= 1e-9) {
    return "0";
  }
  const magnitude = `${formatNumber(stepCm)}cm`;
  return loop.stepPt < 0
    ? `-${loop.variable}*${magnitude}`
    : `${loop.variable}*${magnitude}`;
}

function isBareNumber(raw: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw.trim());
}

function applyInlineScopeShift(
  source: string,
  statement: Statement,
  xLoop: RepeatLoop | null,
  yLoop: RepeatLoop | null,
  parseOptions: EditParseOptions
): string | null {
  const shiftTuple = buildShiftTuple(xLoop, yLoop)!;

  const result = applySetPropertyAction(
    source,
    {
      elementId: statement.id,
      key: "shift",
      value: `{${shiftTuple}}`
    },
    parseOptions
  );
  if (result.kind !== "success" && result.kind !== "partial") {
    return null;
  }
  return result.newSource;
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
