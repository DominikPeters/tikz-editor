import type { Span, Statement, PathStatement, PathItem, NodeItem, ChildOperationItem } from "../ast/types.js";
import type { ParseTikzResult } from "../parser/index.js";
import { parseStatementsFromBodyWithMapping } from "../foreach/snippet-parse.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { normalizeOptionKey } from "./option-key.js";
import type { OptionListAst } from "../options/types.js";
import { parseOptionListRaw } from "../options/parse.js";
import {
  extractNodeAdornmentPlan,
  makeNodeAdornmentTargetId,
  stripAdornmentInternalStyleOptions
} from "../semantic/path/label-quotes.js";
import { parseCustomStyleDefinition } from "../semantic/style/custom-styles.js";
import { readBalancedBlock } from "../semantic/style/option-utils.js";
import { resolveMatrixCellEditTarget, resolveMatrixMode } from "../semantic/nodes/matrix.js";
import { incrementProfilingCounter } from "../profiling.js";

export type PropertyTargetKind =
  | "figure"
  | "path-statement"
  | "matrix-statement"
  | "style-source"
  | "path-keyword"
  | "node-item"
  | "matrix-cell"
  | "tree-child"
  | "foreach-template"
  | "pic-template"
  | "node-adornment"
  | "to-operation"
  | "edge-operation"
  | "coordinate-operation"
  | "svg-operation";

export const TIKZPICTURE_GLOBAL_TARGET_ID = "__tikzpicture__";
export const STYLE_SOURCE_TARGET_PREFIX = "__style_source__:";
export const FOREACH_TEMPLATE_TARGET_PREFIX = "__foreach_template__:";
export const PIC_TEMPLATE_TARGET_PREFIX = "__pic_template__:";

export type PropertyTargetOptionsFormat = "bracketed" | "bare" | "braced";

export type PropertyTarget = {
  id: string;
  kind: PropertyTargetKind;
  pathCommand?: string;
  span: Span;
  options?: OptionListAst;
  optionsSpan?: Span;
  optionsFormat?: PropertyTargetOptionsFormat;
  insertOffset: number;
  optionSpan?: Span;
  valueSpan?: Span;
  textSpan?: Span;
  angleRaw?: string;
  angleSpan?: Span;
  distancePt?: number;
  defaultDistancePt?: number;
  distanceExplicit?: boolean;
  pinEdgeRaw?: string | null;
  ownerId?: string;
  ownerSourceId?: string;
  adornmentKind?: "label" | "pin";
  adornmentIndex?: number;
  matrixSourceId?: string;
  matrixKind?: "plain" | "nodes" | "math-nodes";
  matrixTextMode?: "text" | "math";
  matrixTextSpan?: Span;
  matrixBodyOpenOffset?: number;
  matrixOfNodes?: boolean;
  row?: number;
  column?: number;
  cellSpan?: Span;
  treeRootSourceId?: string;
  treeChildSourceId?: string;
  childOperationId?: string;
  treeChildOptions?: OptionListAst;
  treeChildOptionsSpan?: Span;
  treeChildBodySpan?: Span;
  treeChildInsertOffset?: number;
  treeNodeId?: string;
  treeNodeTextSpan?: Span;
  treeNodeOptions?: OptionListAst;
  treeNodeOptionsSpan?: Span;
  treeNodeInsertOffset?: number;
  treeChildForeach?: boolean;
  treeChildNodeSpanFallbackUsed?: boolean;
  foreachLoopId?: string;
  foreachLocalTargetId?: string;
  picCodeSpan?: Span;
  picLocalTargetId?: string;
};

export type PropertyTargetResolution =
  | { kind: "found"; target: PropertyTarget }
  | { kind: "not-found"; reason: string };

export function resolvePropertyTarget(source: string, elementId: string, parseOptions: EditParseOptions = {}): PropertyTargetResolution {
  incrementProfilingCounter("resolvePropertyTargetCalls");
  if (
    parseOptions.analysisView?.source === source &&
    parseOptions.analysisView.activeFigureId === parseOptions.activeFigureId
  ) {
    return parseOptions.analysisView.resolvePropertyTarget(elementId);
  }
  const normalizedId = elementId.trim();
  if (normalizedId.length === 0) {
    return { kind: "not-found", reason: "Missing element id" };
  }

  if (normalizedId === TIKZPICTURE_GLOBAL_TARGET_ID) {
    return resolveFigurePropertyTarget(source, parseOptions);
  }

  if (normalizedId.startsWith(STYLE_SOURCE_TARGET_PREFIX)) {
    return resolveStyleSourceTarget(source, normalizedId);
  }

  const parseResult = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const picTemplateTarget = resolvePicTemplateTargetFromParseResult(parseResult, normalizedId);
  if (picTemplateTarget) {
    return { kind: "found", target: picTemplateTarget };
  }
  const foreachTemplateTarget = resolveForeachTemplateTargetFromParseResult(parseResult, normalizedId);
  if (foreachTemplateTarget) {
    return { kind: "found", target: foreachTemplateTarget };
  }
  const matrixCellTarget = resolveMatrixCellTargetInStatements(parseResult.figure.body, source, normalizedId);
  if (matrixCellTarget) {
    return { kind: "found", target: matrixCellTarget };
  }
  const treeChildTarget = resolveTreeChildTargetInStatements(parseResult.figure.body, source, normalizedId);
  if (treeChildTarget) {
    return { kind: "found", target: treeChildTarget };
  }
  const target = findTargetInStatements(parseResult.figure.body, source, normalizedId);
  if (!target) {
    return { kind: "not-found", reason: `No editable source target found for ${normalizedId}` };
  }

  return { kind: "found", target };
}

export function resolvePropertyTargetFromParseResult(
  _source: string,
  parseResult: ParseTikzResult,
  elementId: string
): PropertyTargetResolution {
  const parseSource = parseResult.source;
  const normalizedId = elementId.trim();
  if (normalizedId.length === 0) {
    return { kind: "not-found", reason: "Missing element id" };
  }

  if (normalizedId === TIKZPICTURE_GLOBAL_TARGET_ID) {
    return resolveFigurePropertyTargetFromParseResult(parseSource, parseResult);
  }

  if (normalizedId.startsWith(STYLE_SOURCE_TARGET_PREFIX)) {
    return resolveStyleSourceTarget(parseSource, normalizedId);
  }

  const picTemplateTarget = resolvePicTemplateTargetFromParseResult(parseResult, normalizedId);
  if (picTemplateTarget) {
    return { kind: "found", target: picTemplateTarget };
  }

  const foreachTemplateTarget = resolveForeachTemplateTargetFromParseResult(parseResult, normalizedId);
  if (foreachTemplateTarget) {
    return { kind: "found", target: foreachTemplateTarget };
  }

  const matrixCellTarget = resolveMatrixCellTargetInStatements(parseResult.figure.body, parseSource, normalizedId);
  if (matrixCellTarget) {
    return { kind: "found", target: matrixCellTarget };
  }
  const treeChildTarget = resolveTreeChildTargetInStatements(parseResult.figure.body, parseSource, normalizedId);
  if (treeChildTarget) {
    return { kind: "found", target: treeChildTarget };
  }

  const target = findTargetInStatements(parseResult.figure.body, parseSource, normalizedId);
  if (!target) {
    return { kind: "not-found", reason: `No editable source target found for ${normalizedId}` };
  }
  return { kind: "found", target };
}

function resolveFigurePropertyTarget(source: string, parseOptions: EditParseOptions): PropertyTargetResolution {
  const parseResult = parseTikzForEdit(source, {
    ...parseOptions,
  });
  return resolveFigurePropertyTargetFromParseResult(source, parseResult);
}

export function resolveFigurePropertyTargetFromParseResult(
  source: string,
  parseResult: Pick<ParseTikzResult, "figure">
): PropertyTargetResolution {
  const figure = parseResult.figure;
  if (figure.span.from >= figure.span.to) {
    return { kind: "not-found", reason: "No editable tikzpicture target found." };
  }
  const insertOffset = resolveFigureInsertOffset(source, figure.span);
  if (insertOffset == null) {
    return { kind: "not-found", reason: "No editable tikzpicture target found." };
  }

  return {
      kind: "found",
      target: {
        id: TIKZPICTURE_GLOBAL_TARGET_ID,
        kind: "figure",
        span: figure.span,
        options: figure.options,
        optionsSpan: figure.options?.span,
        optionsFormat: "bracketed",
        insertOffset
      }
    };
}

function resolveStyleSourceTarget(source: string, targetId: string): PropertyTargetResolution {
  const parsed = parseStyleSourceTargetId(targetId);
  if (!parsed) {
    return { kind: "not-found", reason: `Invalid style source target id: ${targetId}` };
  }
  const span: Span = { from: parsed.from, to: parsed.to };
  if (span.from < 0 || span.to > source.length || span.from >= span.to) {
    return { kind: "not-found", reason: `Style source span out of bounds: ${targetId}` };
  }

  const raw = source.slice(span.from, span.to);
  const standalone = resolveStandaloneCommandTarget(targetId, raw, span);
  if (standalone) {
    return { kind: "found", target: standalone };
  }

  const styleDefinition = resolveStyleDefinitionEntryTarget(targetId, raw, span);
  if (styleDefinition) {
    return { kind: "found", target: styleDefinition };
  }

  return { kind: "not-found", reason: `No editable style source target found for ${targetId}` };
}

function resolveStandaloneCommandTarget(targetId: string, raw: string, span: Span): PropertyTarget | null {
  const tikzset = parseBracedCommandOptionTarget(raw, span.from, "\\tikzset");
  if (tikzset) {
    return {
      id: targetId,
      kind: "style-source",
      span,
      options: tikzset.options,
      optionsSpan: tikzset.optionsSpan,
      optionsFormat: "bare",
      insertOffset: tikzset.optionsSpan.to
    };
  }

  const pgfkeys = parseBracedCommandOptionTarget(raw, span.from, "\\pgfkeys");
  if (pgfkeys) {
    return {
      id: targetId,
      kind: "style-source",
      span,
      options: pgfkeys.options,
      optionsSpan: pgfkeys.optionsSpan,
      optionsFormat: "bare",
      insertOffset: pgfkeys.optionsSpan.to
    };
  }

  const legacy = parseLegacyTikzStyleTarget(raw, span.from);
  if (legacy) {
    return {
      id: targetId,
      kind: "style-source",
      span,
      options: legacy.options,
      optionsSpan: legacy.optionsSpan,
      optionsFormat: legacy.optionsFormat,
      insertOffset: legacy.optionsSpan.to
    };
  }

  return null;
}

function resolveStyleDefinitionEntryTarget(targetId: string, raw: string, span: Span): PropertyTarget | null {
  const parsedEntry = parseOptionListRaw(`[${raw}]`, span.from);
  const entry = parsedEntry.entries[0];
  if (entry?.kind !== "kv") {
    return null;
  }
  const definition = parseCustomStyleDefinition(entry.key) ?? parseReservedStyleDefinition(entry.key);
  if (!definition) {
    return null;
  }

  const valueOffset = entry.raw.lastIndexOf(entry.valueRaw);
  const absoluteValueFrom = valueOffset >= 0 ? entry.span.from + valueOffset - 1 : entry.span.to - entry.valueRaw.length;
  const trimmedValue = entry.valueRaw.trim();
  if (trimmedValue.length === 0) {
    return {
      id: targetId,
      kind: "style-source",
      span,
      options: parseOptionListRaw("", absoluteValueFrom),
      optionsSpan: { from: absoluteValueFrom, to: absoluteValueFrom },
      optionsFormat: "bare",
      insertOffset: absoluteValueFrom
    };
  }

  const wrapper = detectWrappedOptionValue(trimmedValue, absoluteValueFrom);
  if (!wrapper) {
    return {
      id: targetId,
      kind: "style-source",
      span,
      options: parseOptionListRaw(trimmedValue, absoluteValueFrom),
      optionsSpan: { from: absoluteValueFrom, to: absoluteValueFrom + entry.valueRaw.length },
      optionsFormat: "bare",
      insertOffset: absoluteValueFrom + entry.valueRaw.length
    };
  }

  return {
    id: targetId,
    kind: "style-source",
    span,
    options: wrapper.options,
    optionsSpan: wrapper.span,
    optionsFormat: wrapper.format,
    insertOffset: wrapper.span.to
  };
}

function parseBracedCommandOptionTarget(
  raw: string,
  absoluteFrom: number,
  command: "\\tikzset" | "\\pgfkeys"
): { options: OptionListAst; optionsSpan: Span } | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(command)) {
    return null;
  }

  const commandOffset = raw.indexOf(command);
  const openBraceOffset = raw.indexOf("{", commandOffset + command.length);
  if (openBraceOffset < 0) {
    return null;
  }
  const block = readBalancedBlock(raw, openBraceOffset, "{", "}");
  if (!block) {
    return null;
  }

  const contentFrom = absoluteFrom + openBraceOffset + 1;
  const contentTo = absoluteFrom + block.nextIndex - 1;
  return {
    options: parseOptionListRaw(block.content, contentFrom),
    optionsSpan: { from: contentFrom, to: contentTo }
  };
}

function parseLegacyTikzStyleTarget(
  raw: string,
  absoluteFrom: number
): { options: OptionListAst; optionsSpan: Span; optionsFormat: PropertyTargetOptionsFormat } | null {
  const stripped = raw.trim();
  if (!stripped.startsWith("\\tikzstyle")) {
    return null;
  }

  const eqIndex = raw.indexOf("=");
  if (eqIndex < 0) {
    return null;
  }
  let valueStart = eqIndex + 1;
  while (valueStart < raw.length && /\s/.test(raw[valueStart] ?? "")) {
    valueStart += 1;
  }
  let valueEnd = raw.length;
  while (valueEnd > valueStart && /\s|;/.test(raw[valueEnd - 1] ?? "")) {
    valueEnd -= 1;
  }
  if (valueStart >= valueEnd) {
    return null;
  }
  const valueRaw = raw.slice(valueStart, valueEnd);
  const wrapped = detectWrappedOptionValue(valueRaw, absoluteFrom + valueStart);
  if (wrapped) {
    return {
      options: wrapped.options,
      optionsSpan: wrapped.span,
      optionsFormat: wrapped.format
    };
  }
  return {
    options: parseOptionListRaw(valueRaw, absoluteFrom + valueStart),
    optionsSpan: { from: absoluteFrom + valueStart, to: absoluteFrom + valueEnd },
    optionsFormat: "bare"
  };
}

function detectWrappedOptionValue(
  rawValue: string,
  absoluteFrom: number
): { options: OptionListAst; span: Span; format: PropertyTargetOptionsFormat } | null {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const leading = rawValue.indexOf("{");
    const block = readBalancedBlock(rawValue, leading, "{", "}");
    if (block?.nextIndex === rawValue.trimEnd().length) {
      const span = { from: absoluteFrom + leading + 1, to: absoluteFrom + block.nextIndex - 1 };
      return {
        options: parseOptionListRaw(block.content, absoluteFrom + leading + 1),
        span,
        format: "bare"
      };
    }
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const leading = rawValue.indexOf("[");
    const block = readBalancedBlock(rawValue, leading, "[", "]");
    if (block?.nextIndex === rawValue.trimEnd().length) {
      const span = { from: absoluteFrom + leading, to: absoluteFrom + block.nextIndex };
      return {
        options: parseOptionListRaw(rawValue.slice(leading, block.nextIndex), absoluteFrom + leading),
        span,
        format: "bracketed"
      };
    }
  }
  return null;
}

function parseReservedStyleDefinition(key: string): { name: string } | null {
  const normalized = key.trim().toLowerCase();
  if (
    normalized.endsWith("/.style")
    || normalized.endsWith("/.append style")
    || normalized.endsWith("/.prefix style")
  ) {
    return { name: normalized };
  }
  return null;
}

function parseStyleSourceTargetId(targetId: string): { from: number; to: number } | null {
  const payload = targetId.slice(STYLE_SOURCE_TARGET_PREFIX.length);
  const [fromRaw, toRaw] = payload.split(":");
  const from = Number(fromRaw);
  const to = Number(toRaw);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }
  return { from, to };
}

export function makeStyleSourceTargetId(span: Span): string {
  return `${STYLE_SOURCE_TARGET_PREFIX}${span.from}:${span.to}`;
}

export function makeForeachTemplateTargetId(
  loopId: string,
  localTargetId: string,
  nestedLoopLocalIds: readonly string[] = []
): string {
  const loopPath = [loopId, ...nestedLoopLocalIds].join("/");
  return `${FOREACH_TEMPLATE_TARGET_PREFIX}${loopPath}::${localTargetId}`;
}

export function makePicTemplateTargetId(codeSpan: Span, localTargetId: string): string {
  return `${PIC_TEMPLATE_TARGET_PREFIX}${codeSpan.from}:${codeSpan.to}::${localTargetId}`;
}

function parsePicTemplateTargetId(
  targetId: string
): { codeSpan: Span; localTargetId: string } | null {
  if (!targetId.startsWith(PIC_TEMPLATE_TARGET_PREFIX)) {
    return null;
  }
  const payload = targetId.slice(PIC_TEMPLATE_TARGET_PREFIX.length);
  const separator = payload.indexOf("::");
  if (separator <= 0 || separator >= payload.length - 2) {
    return null;
  }
  const spanRaw = payload.slice(0, separator);
  const localTargetId = payload.slice(separator + 2).trim();
  const [fromRaw, toRaw] = spanRaw.split(":");
  const from = Number(fromRaw);
  const to = Number(toRaw);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || localTargetId.length === 0) {
    return null;
  }
  return {
    codeSpan: { from, to },
    localTargetId
  };
}

function resolvePicTemplateTargetFromParseResult(
  parseResult: ParseTikzResult,
  targetId: string
): PropertyTarget | null {
  const parsed = parsePicTemplateTargetId(targetId);
  if (!parsed) {
    return null;
  }
  const source = parseResult.source;
  if (parsed.codeSpan.to > source.length) {
    return null;
  }

  const codeRaw = source.slice(parsed.codeSpan.from, parsed.codeSpan.to);
  const reparsedBody = parseStatementsFromBodyWithMapping(codeRaw, parsed.codeSpan);
  const resolved = resolvePropertyTargetFromParseResult(
    reparsedBody.parseResult.source,
    reparsedBody.parseResult,
    parsed.localTargetId
  );
  if (resolved.kind !== "found") {
    return null;
  }

  const remapped = remapPropertyTargetToOriginalSource(resolved.target, reparsedBody.sourceMapper);
  if (!remapped) {
    return null;
  }
  const templateNodeTextSpan = resolvePathStatementNodeTextSpan(reparsedBody.parseResult.figure.body, parsed.localTargetId);
  const remappedTemplateNodeTextSpan = templateNodeTextSpan ? reparsedBody.sourceMapper.mapSpan(templateNodeTextSpan) : null;

  return {
    ...remapped,
    id: targetId,
    kind: "pic-template",
    textSpan: remapped.textSpan ?? remappedTemplateNodeTextSpan ?? undefined,
    picCodeSpan: parsed.codeSpan,
    picLocalTargetId: parsed.localTargetId
  };
}

function parseForeachTemplateTargetId(
  targetId: string
): { loopId: string; nestedLoopLocalIds: string[]; localTargetId: string } | null {
  if (!targetId.startsWith(FOREACH_TEMPLATE_TARGET_PREFIX)) {
    return null;
  }
  const payload = targetId.slice(FOREACH_TEMPLATE_TARGET_PREFIX.length);
  const separator = payload.indexOf("::");
  if (separator <= 0 || separator >= payload.length - 2) {
    return null;
  }
  const loopPathRaw = payload.slice(0, separator).trim();
  const localTargetId = payload.slice(separator + 2).trim();
  if (loopPathRaw.length === 0 || localTargetId.length === 0) {
    return null;
  }
  const loopPath = loopPathRaw
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (loopPath.length === 0) {
    return null;
  }
  const [loopId, ...nestedLoopLocalIds] = loopPath;
  return { loopId, nestedLoopLocalIds, localTargetId };
}

function resolveForeachTemplateTargetFromParseResult(
  parseResult: ParseTikzResult,
  targetId: string
): PropertyTarget | null {
  const parsed = parseForeachTemplateTargetId(targetId);
  if (!parsed) {
    return null;
  }
  const loop = findForeachStatementById(parseResult.figure.body, parsed.loopId);
  if (!loop?.bodySpan) {
    return null;
  }

  const loopBody = resolveNestedForeachBody(loop, parsed.nestedLoopLocalIds);
  if (!loopBody) {
    return null;
  }

  const reparsedBody = parseStatementsFromBodyWithMapping(loopBody.bodyRaw, loopBody.bodySpan);
  const resolved = resolvePropertyTargetFromParseResult(
    reparsedBody.parseResult.source,
    reparsedBody.parseResult,
    parsed.localTargetId
  );
  if (resolved.kind !== "found") {
    return null;
  }

  const remapped = remapPropertyTargetToOriginalSource(resolved.target, reparsedBody.sourceMapper);
  if (!remapped) {
    return null;
  }
  const templateNodeTextSpan = resolvePathStatementNodeTextSpan(reparsedBody.parseResult.figure.body, parsed.localTargetId);
  const remappedTemplateNodeTextSpan = templateNodeTextSpan ? reparsedBody.sourceMapper.mapSpan(templateNodeTextSpan) : null;

  return {
    ...remapped,
    id: targetId,
    kind: "foreach-template",
    textSpan: remapped.textSpan ?? remappedTemplateNodeTextSpan ?? undefined,
    foreachLoopId: parsed.loopId,
    foreachLocalTargetId: parsed.localTargetId
  };
}

function resolveNestedForeachBody(
  loop: Extract<Statement, { kind: "Foreach" }>,
  nestedLoopLocalIds: readonly string[]
): { bodyRaw: string; bodySpan: Span } | null {
  let currentLoop = loop;
  let currentBodySpan = loop.bodySpan;
  if (!currentBodySpan) {
    return null;
  }

  for (const nestedLoopLocalId of nestedLoopLocalIds) {
    const reparsedBody = parseStatementsFromBodyWithMapping(currentLoop.bodyRaw, currentBodySpan);
    const nestedLoop = findForeachStatementById(reparsedBody.parseResult.figure.body, nestedLoopLocalId);
    if (!nestedLoop?.bodySpan) {
      return null;
    }
    const mappedBodySpan = reparsedBody.sourceMapper.mapSpan(nestedLoop.bodySpan);
    if (!mappedBodySpan) {
      return null;
    }
    currentLoop = nestedLoop;
    currentBodySpan = mappedBodySpan;
  }

  return {
    bodyRaw: currentLoop.bodyRaw,
    bodySpan: currentBodySpan
  };
}

function resolvePathStatementNodeTextSpan(statements: readonly Statement[], statementId: string): Span | null {
  for (const statement of statements) {
    if (statement.kind === "Path" && statement.id === statementId) {
      const nodeItem = statement.items.find((item): item is NodeItem => item.kind === "Node");
      return nodeItem?.textSpan ?? null;
    }
    if (statement.kind === "Scope") {
      const nested = resolvePathStatementNodeTextSpan(statement.body, statementId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function findTargetInStatements(statements: Statement[], source: string, elementId: string): PropertyTarget | null {
  for (const statement of statements) {
    if (statement.kind === "Path") {
      if (statement.id === elementId) {
        return makePathStatementTarget(statement, source);
      }

      const fromItems = findTargetInPathItems(statement.items, source, elementId, statement.id, {
        statementCommand: statement.command,
        statementSpan: statement.span
      });
      if (fromItems) {
        return fromItems;
      }
      continue;
    }

    if (statement.kind === "Scope") {
      if (statement.id === elementId) {
        return makeScopeTarget(statement, source);
      }
      const nested = findTargetInStatements(statement.body, source, elementId);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function findTargetInPathItems(
  items: PathItem[],
  source: string,
  elementId: string,
  ownerSourceId: string,
  context: { statementCommand?: string; statementSpan?: Span } = {}
): PropertyTarget | null {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) {
      continue;
    }

    if (item.kind === "PathKeyword" && item.id === elementId) {
      return makePathKeywordTarget(item, items, index);
    }

    if (item.kind === "Node" && item.id === elementId) {
      return makeNodeTarget(item, source, ownerSourceId, context);
    }
    const nodeAdornment =
      item.kind === "Node"
        ? makeNodeAdornmentTarget(item, elementId, source, ownerSourceId)
        : null;
    if (nodeAdornment) {
      return nodeAdornment;
    }

    if (item.kind === "ToOperation") {
      if (item.id === elementId) {
        return makeToLikeOperationTarget("to-operation", item.id, item.span, item.options, item.optionsSpan, /\bto\b/, source);
      }
      const nestedNode = findTargetInNodeList(item.nodes, source, elementId, ownerSourceId);
      if (nestedNode) {
        return nestedNode;
      }
      continue;
    }

    if (item.kind === "EdgeOperation") {
      if (item.id === elementId) {
        return makeToLikeOperationTarget("edge-operation", item.id, item.span, item.options, item.optionsSpan, /\bedge\b/, source);
      }
      const nestedNode = findTargetInNodeList(item.nodes, source, elementId, ownerSourceId);
      if (nestedNode) {
        return nestedNode;
      }
      continue;
    }

    if (item.kind === "CoordinateOperation" && item.id === elementId) {
      return makeToLikeOperationTarget(
        "coordinate-operation",
        item.id,
        item.span,
        item.options,
        item.optionsSpan,
        /\bcoordinate\b/,
        source
      );
    }

    if (item.kind === "SvgOperation" && item.id === elementId) {
      return makeToLikeOperationTarget("svg-operation", item.id, item.span, item.options, item.optionsSpan, /\bsvg\b/, source);
    }

    if (item.kind === "ChildOperation") {
      const nested = findTargetInPathItems(item.body, source, elementId, ownerSourceId, context);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function findTargetInNodeList(
  nodes: NodeItem[] | undefined,
  source: string,
  elementId: string,
  ownerSourceId: string
): PropertyTarget | null {
  if (!nodes || nodes.length === 0) {
    return null;
  }

  for (const node of nodes) {
    if (node.id === elementId) {
      return makeNodeTarget(node, source, ownerSourceId);
    }
    const adornment = makeNodeAdornmentTarget(node, elementId, source, ownerSourceId);
    if (adornment) {
      return adornment;
    }
  }
  return null;
}

function makePathStatementTarget(statement: PathStatement, source: string): PropertyTarget {
  const matrixTarget = makeMatrixStatementTarget(statement, source);
  if (matrixTarget) {
    return matrixTarget;
  }
  const commandRegex =
    statement.command === "node"
      ? /\\?(?:node|matrix)\b/
      : new RegExp(String.raw`\\?${escapeRegex(statement.command)}\b`);
  const insertOffset = resolveInsertOffset(source, statement.span, commandRegex);

  return {
    id: statement.id,
    kind: "path-statement",
    pathCommand: statement.command,
    span: statement.span,
    options: statement.options,
    optionsSpan: statement.options?.span,
    insertOffset
  };
}

function makeMatrixStatementTarget(statement: PathStatement, source: string): PropertyTarget | null {
  const matrixNode = statement.items.find((item): item is NodeItem => item.kind === "Node");
  if (!matrixNode) {
    return null;
  }
  const matrixMode = resolveMatrixMode(matrixNode.options);
  if (!matrixMode.enabled) {
    return null;
  }
  const insertOffset = resolveInsertOffset(source, statement.span, /\\?(?:node|matrix)\b/);
  const bodyOpenOffset = resolveMatrixBodyOpenOffset(source, matrixNode.textSpan);
  return {
    id: statement.id,
    kind: "matrix-statement",
    pathCommand: statement.command,
    span: statement.span,
    options: normalizeMatrixStatementOptions(matrixNode.options),
    optionsSpan: matrixNode.options?.span,
    optionsFormat: "bracketed",
    insertOffset,
    matrixSourceId: statement.id,
    matrixKind: matrixMode.matrixKind,
    matrixTextMode: matrixMode.textMode,
    matrixOfNodes: matrixMode.matrixOfNodes,
    matrixTextSpan: matrixNode.textSpan,
    matrixBodyOpenOffset: bodyOpenOffset
  };
}

function normalizeMatrixStatementOptions(options: OptionListAst | undefined): OptionListAst | undefined {
  if (!options) {
    return options;
  }
  const hasSpecificMatrixKind = options.entries.some(
    (entry) => (entry.kind === "flag" || entry.kind === "kv")
      && (entry.key === "matrix of nodes" || entry.key === "matrix of math nodes")
  );
  if (!hasSpecificMatrixKind) {
    return options;
  }
  const entries = options.entries.filter(
    (entry) => !(entry.kind === "flag" || entry.kind === "kv") || normalizeOptionKey(entry.key) !== "matrix"
  );
  if (entries.length === options.entries.length) {
    return options;
  }
  return {
    ...options,
    entries
  };
}

function resolveMatrixCellTargetInStatements(
  statements: Statement[],
  source: string,
  elementId: string
): PropertyTarget | null {
  const parsedId = parseMatrixCellTargetId(elementId);
  if (!parsedId) {
    return null;
  }

  const ref = findNodeItemInStatements(statements, parsedId.matrixNodeSourceId);
  if (!ref) {
    return null;
  }

  const matrixMode = resolveMatrixMode(ref.node.options);
  if (!matrixMode.enabled) {
    return null;
  }

  const resolvedCell = resolveMatrixCellEditTarget(
    ref.node.text,
    ref.node.textSpan,
    matrixMode,
    parsedId.row,
    parsedId.column
  );
  if (!resolvedCell) {
    return null;
  }

  const matrixCellOptions = resolvedCell.optionSpan
    ? parseOptionListRaw(source.slice(resolvedCell.optionSpan.from, resolvedCell.optionSpan.to), resolvedCell.optionSpan.from)
    : undefined;

  const insertOffset = resolveInsertOffset(source, ref.statement.span, /\\?(?:node|matrix)\b/);
  return {
    id: elementId,
    kind: "matrix-cell",
    span: resolvedCell.cellSpan,
    options: matrixCellOptions,
    optionsSpan: resolvedCell.optionSpan,
    optionsFormat: "bracketed",
    textSpan: resolvedCell.textSpan,
    optionSpan: resolvedCell.optionSpan,
    insertOffset,
    matrixSourceId: ref.statement.id,
    matrixKind: matrixMode.matrixKind,
    matrixTextMode: resolvedCell.textMode,
    matrixOfNodes: matrixMode.matrixOfNodes,
    row: parsedId.row,
    column: parsedId.column,
    cellSpan: resolvedCell.cellSpan
  };
}

function findNodeItemInStatements(
  statements: Statement[],
  nodeId: string
): { statement: PathStatement; node: NodeItem } | null {
  for (const statement of statements) {
    if (statement.kind === "Scope") {
      const nested = findNodeItemInStatements(statement.body, nodeId);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (statement.kind !== "Path") {
      continue;
    }
    for (const item of statement.items) {
      if (item.kind === "Node" && item.id === nodeId) {
        return { statement, node: item };
      }
    }
  }
  return null;
}

function findPathStatementById(
  statements: Statement[],
  statementId: string
): PathStatement | null {
  for (const statement of statements) {
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, statementId);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (statement.kind === "Path" && statement.id === statementId) {
      return statement;
    }
  }
  return null;
}

function findForeachStatementById(
  statements: Statement[],
  statementId: string
): Extract<Statement, { kind: "Foreach" }> | null {
  for (const statement of statements) {
    if (statement.kind === "Scope") {
      const nested = findForeachStatementById(statement.body, statementId);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (statement.kind === "Foreach" && statement.id === statementId) {
      return statement;
    }
  }
  return null;
}

function remapPropertyTargetToOriginalSource(
  target: PropertyTarget,
  mapper: { mapSpan: (span: Span) => Span | null; mapOffset: (offset: number) => number | null }
): PropertyTarget | null {
  const span = mapper.mapSpan(target.span);
  const insertOffset = mapper.mapOffset(target.insertOffset);
  if (!span || insertOffset == null) {
    return null;
  }

  const remapped: PropertyTarget = {
    ...target,
    span,
    insertOffset
  };

  const spanKeys: Array<keyof PropertyTarget> = [
    "optionsSpan",
    "optionSpan",
    "valueSpan",
    "textSpan",
    "angleSpan",
    "matrixTextSpan",
    "cellSpan",
    "treeChildOptionsSpan",
    "treeChildBodySpan",
    "treeNodeTextSpan",
    "treeNodeOptionsSpan"
  ];
  for (const key of spanKeys) {
    const value = remapped[key];
    if (!value || typeof value !== "object" || !("from" in value) || !("to" in value)) {
      continue;
    }
    const mapped = mapper.mapSpan(value);
    if (!mapped) {
      return null;
    }
    (remapped as Record<string, unknown>)[key] = mapped;
  }

  const offsetKeys: Array<keyof PropertyTarget> = [
    "matrixBodyOpenOffset",
    "treeChildInsertOffset",
    "treeNodeInsertOffset"
  ];
  for (const key of offsetKeys) {
    const value = remapped[key];
    if (typeof value !== "number") {
      continue;
    }
    const mapped = mapper.mapOffset(value);
    if (mapped == null) {
      return null;
    }
    (remapped as Record<string, unknown>)[key] = mapped;
  }

  return remapped;
}

function resolveMatrixBodyOpenOffset(source: string, textSpan: Span): number | undefined {
  for (let cursor = textSpan.from - 1; cursor >= 0; cursor -= 1) {
    const char = source[cursor];
    if (char === "{") {
      return cursor;
    }
    if (!/\s/u.test(char ?? "")) {
      break;
    }
  }
  return undefined;
}

function parseMatrixCellTargetId(elementId: string): { matrixNodeSourceId: string; row: number; column: number } | null {
  const match = /^(.*):matrix-cell:(\d+):(\d+)$/.exec(elementId.trim());
  if (!match) {
    return null;
  }
  const matrixNodeSourceId = match[1]?.trim();
  const row = Number.parseInt(match[2] ?? "", 10);
  const column = Number.parseInt(match[3] ?? "", 10);
  if (!matrixNodeSourceId || !Number.isInteger(row) || !Number.isInteger(column) || row <= 0 || column <= 0) {
    return null;
  }
  return { matrixNodeSourceId, row, column };
}

function resolveTreeChildTargetInStatements(
  statements: Statement[],
  source: string,
  elementId: string
): PropertyTarget | null {
  const parsedId = parseTreeChildTargetId(elementId);
  if (!parsedId) {
    return null;
  }

  const child = resolveTreeChildOperationFromSegments(statements, source, parsedId);
  if (!child) {
    return null;
  }

  const node = resolveFirstEditableTreeNode(child.body);
  const nodeOptions = node?.options;
  const nodeSpanInfo = node ? resolveTreeChildNodeSpanInfo(source, child, node) : null;
  const nodeOptionsSpan = nodeSpanInfo?.optionsSpan;
  const nodeTextSpan = nodeSpanInfo?.textSpan;
  const treeChildInsertOffset = resolveInsertOffset(source, child.span, /\bchild\b/);
  const treeNodeInsertOffset = nodeSpanInfo?.insertOffset;

  return {
    id: elementId,
    kind: "tree-child",
    span: child.span,
    options: nodeOptions,
    optionsSpan: nodeOptionsSpan,
    optionSpan: nodeOptionsSpan,
    optionsFormat: "bracketed",
    textSpan: nodeTextSpan,
    insertOffset: treeNodeInsertOffset ?? treeChildInsertOffset,
    treeRootSourceId: parsedId.treeRootSourceId,
    treeChildSourceId: parsedId.treeChildSourceId,
    childOperationId: child.id,
    treeChildOptions: child.options,
    treeChildOptionsSpan: child.optionsSpan ?? child.options?.span,
    treeChildBodySpan: child.bodySpan,
    treeChildInsertOffset,
    treeNodeId: node?.id,
    treeNodeTextSpan: nodeTextSpan,
    treeNodeOptions: nodeOptions,
    treeNodeOptionsSpan: nodeOptionsSpan,
    treeNodeInsertOffset,
    treeChildForeach: (child.foreachClauses?.length ?? 0) > 0,
    treeChildNodeSpanFallbackUsed: nodeSpanInfo?.fallbackUsed ?? false
  };
}

function parseTreeChildTargetId(elementId: string): {
  treeRootSourceId: string;
  treeChildSourceId: string;
  segments: Array<{ childIndexOneBased: number; childOperationId: string }>;
} | null {
  const normalized = elementId.trim();
  if (normalized.length === 0) {
    return null;
  }
  const firstTreeChildMarker = normalized.indexOf(":tree-child:");
  if (firstTreeChildMarker < 0) {
    return null;
  }
  const treeRootSourceId = normalized.slice(0, firstTreeChildMarker).trim();
  if (treeRootSourceId.length === 0) {
    return null;
  }
  const segmentsRaw = normalized.slice(firstTreeChildMarker).split(":tree-child:");
  const segments: Array<{ childIndexOneBased: number; childOperationId: string }> = [];
  for (const rawSegment of segmentsRaw) {
    const segment = rawSegment.trim();
    if (segment.length === 0) {
      continue;
    }
    const firstColon = segment.indexOf(":");
    if (firstColon <= 0) {
      return null;
    }
    const indexRaw = segment.slice(0, firstColon).trim();
    const childOperationId = segment.slice(firstColon + 1).trim();
    if (!/^\d+$/u.test(indexRaw) || childOperationId.length === 0) {
      return null;
    }
    segments.push({
      childIndexOneBased: Number.parseInt(indexRaw, 10),
      childOperationId
    });
  }
  if (segments.length === 0) {
    return null;
  }
  return {
    treeRootSourceId,
    treeChildSourceId: normalized,
    segments
  };
}

function resolveTreeChildOperationFromSegments(
  statements: Statement[],
  source: string,
  parsedId: {
    treeRootSourceId: string;
    segments: Array<{ childIndexOneBased: number; childOperationId: string }>;
  }
): ChildOperationItem | null {
  const rootStatement = findPathStatementById(statements, parsedId.treeRootSourceId);
  if (!rootStatement) {
    return null;
  }
  let currentItems = rootStatement.items;
  let containerSpan: Span = rootStatement.span;
  let currentChild: ChildOperationItem | null = null;
  for (const segment of parsedId.segments) {
    const childOperations = currentItems.filter(
      (item): item is ChildOperationItem => item.kind === "ChildOperation"
    );
    if (childOperations.length === 0) {
      return null;
    }
    const index = segment.childIndexOneBased - 1;
    const indexed = index >= 0 && index < childOperations.length ? childOperations[index] ?? null : null;
    const matched = indexed?.id === segment.childOperationId
      ? indexed
      : childOperations.find((candidate) => candidate.id === segment.childOperationId) ?? indexed;
    if (!matched) {
      return null;
    }
    const absoluteChild = absolutizeChildOperationSpans(source, matched, containerSpan);
    currentChild = absoluteChild;
    currentItems = matched.body;
    containerSpan = absoluteChild.bodySpan ?? absoluteChild.span;
  }
  return currentChild;
}

function absolutizeChildOperationSpans(
  source: string,
  child: ChildOperationItem,
  containerSpan: Span
): ChildOperationItem {
  const absolutize = (
    span: Span | undefined,
    raw: string
  ): Span | undefined => {
    if (!span) {
      return undefined;
    }
    if (raw.length > 0 && source.slice(span.from, span.to) === raw) {
      return span;
    }
    if (raw.length > 0) {
      const containerSlice = source.slice(containerSpan.from, containerSpan.to);
      const rawOffset = containerSlice.indexOf(raw);
      if (rawOffset >= 0) {
        return {
          from: containerSpan.from + rawOffset,
          to: containerSpan.from + rawOffset + raw.length
        };
      }
    }
    return {
      from: containerSpan.from + span.from,
      to: containerSpan.from + span.to
    };
  };
  return {
    ...child,
    span: absolutize(child.span, child.raw)!,
    optionsSpan: absolutize(child.optionsSpan, child.options?.raw ?? ""),
    bodySpan: absolutize(child.bodySpan, child.bodyRaw)
  };
}

function resolveFirstEditableTreeNode(items: PathItem[]): NodeItem | null {
  let encounteredEdgeFromParent = false;
  for (const item of items) {
    if (item.kind === "PathComment" || item.kind === "PathOption") {
      continue;
    }
    if (item.kind === "EdgeFromParentOperation") {
      encounteredEdgeFromParent = true;
      continue;
    }
    if (item.kind === "Node") {
      if (encounteredEdgeFromParent) {
        continue;
      }
      return item;
    }
  }
  return null;
}

function resolveTreeChildNodeSpanInfo(
  source: string,
  child: ChildOperationItem,
  node: NodeItem
): {
  optionsSpan?: Span;
  textSpan?: Span;
  insertOffset: number;
  fallbackUsed: boolean;
} | null {
  let bodySpan = child.bodySpan;
  if (!bodySpan) {
    return null;
  }
  let fallbackUsed = false;
  let bodySlice = source.slice(bodySpan.from, bodySpan.to);
  let nodeOffsetInBody = bodySlice.indexOf(node.raw);
  if (nodeOffsetInBody < 0 && child.bodyRaw.length > 0) {
    const searchStart = Math.max(0, bodySpan.from - 256);
    const searchEnd = Math.min(source.length, bodySpan.to + 256);
    const searchSlice = source.slice(searchStart, searchEnd);
    const bodyOffset = searchSlice.indexOf(child.bodyRaw);
    if (bodyOffset >= 0) {
      const fallbackBodyFrom = searchStart + bodyOffset;
      bodySpan = {
        from: fallbackBodyFrom,
        to: fallbackBodyFrom + child.bodyRaw.length
      };
      fallbackUsed = true;
      bodySlice = source.slice(bodySpan.from, bodySpan.to);
      nodeOffsetInBody = bodySlice.indexOf(node.raw);
    }
  }
  if (nodeOffsetInBody < 0) {
    return null;
  }
  const nodeFrom = bodySpan.from + nodeOffsetInBody;
  const nodeTo = nodeFrom + node.raw.length;
  const nodeSlice = source.slice(nodeFrom, nodeTo);
  const nodeKeywordMatch = /\bnode\b/u.exec(nodeSlice);
  const insertOffset = nodeKeywordMatch
    ? nodeFrom + nodeKeywordMatch.index + nodeKeywordMatch[0].length
    : nodeFrom;

  let optionsSpan: Span | undefined;
  let textSpan: Span | undefined;
  let cursor = insertOffset - nodeFrom;
  while (cursor < nodeSlice.length && /\s/u.test(nodeSlice[cursor] ?? "")) {
    cursor += 1;
  }
  if (nodeSlice[cursor] === "[") {
    const optionsBlock = readBalancedBlock(nodeSlice, cursor, "[", "]");
    if (optionsBlock) {
      optionsSpan = {
        from: nodeFrom + cursor,
        to: nodeFrom + optionsBlock.nextIndex
      };
      cursor = optionsBlock.nextIndex;
    }
  }
  while (cursor < nodeSlice.length && /\s/u.test(nodeSlice[cursor] ?? "")) {
    cursor += 1;
  }
  if (nodeSlice[cursor] === "{") {
    const textBlock = readBalancedBlock(nodeSlice, cursor, "{", "}");
    if (textBlock) {
      textSpan = {
        from: nodeFrom + cursor + 1,
        to: nodeFrom + textBlock.nextIndex - 1
      };
    }
  }

  return {
    optionsSpan,
    textSpan,
    insertOffset,
    fallbackUsed
  };
}

function makeScopeTarget(statement: Extract<Statement, { kind: "Scope" }>, source: string): PropertyTarget {
  return {
    id: statement.id,
    kind: "style-source",
    span: statement.span,
    options: statement.options,
    optionsSpan: statement.options?.span,
    optionsFormat: "bracketed",
    insertOffset: resolveInsertOffset(source, statement.span, /\\begin\{scope\*?\}/)
  };
}

function makeNodeTarget(
  node: NodeItem,
  source: string,
  ownerSourceId: string,
  context: { statementCommand?: string; statementSpan?: Span } = {}
): PropertyTarget {
  return {
    id: node.id,
    kind: "node-item",
    span: node.span,
    options: node.options,
    optionsSpan: node.optionsSpan ?? node.options?.span,
    insertOffset: resolveNodeInsertOffset(source, node, context),
    ownerSourceId
  };
}

function resolveNodeInsertOffset(
  source: string,
  node: NodeItem,
  context: { statementCommand?: string; statementSpan?: Span }
): number {
  if (
    (context.statementCommand === "node" || context.statementCommand === "matrix")
    && context.statementSpan
    && context.statementSpan.from <= node.span.from
    && node.span.to <= context.statementSpan.to
  ) {
    const statementInsertOffset = resolveInsertOffset(source, context.statementSpan, /\\?(?:node|matrix)\b/);
    if (statementInsertOffset !== context.statementSpan.from) {
      return statementInsertOffset;
    }
  }

  return resolveInsertOffset(source, node.span, /\bnode\b/);
}

function makeNodeAdornmentTarget(
  node: NodeItem,
  elementId: string,
  source: string,
  ownerSourceId: string
): PropertyTarget | null {
  const plan = extractNodeAdornmentPlan(node.options);
  if (plan.adornments.length === 0) {
    return null;
  }

  for (let index = 0; index < plan.adornments.length; index += 1) {
    const adornment = plan.adornments[index];
    if (!adornment) {
      continue;
    }
    const expectedId = makeNodeAdornmentTargetId(node.id, index, adornment.kind);
    if (expectedId !== elementId) {
      continue;
    }

    return {
      id: elementId,
      kind: "node-adornment",
      span: adornment.span,
      options: stripAdornmentInternalStyleOptions(adornment.options),
      optionsSpan: adornment.valueSpan,
      optionSpan: adornment.span,
      valueSpan: adornment.valueSpan,
      textSpan: adornment.textSpan,
      angleRaw: adornment.angleRaw,
      angleSpan: adornment.angleSpan,
      distancePt: adornment.distancePt,
      defaultDistancePt: adornment.defaultDistancePt,
      distanceExplicit: adornment.distanceExplicit,
      pinEdgeRaw: adornment.pinEdgeRaw,
      insertOffset: adornment.valueSpan.to,
      ownerId: node.id,
      ownerSourceId,
      adornmentKind: adornment.kind,
      adornmentIndex: index
    };
  }

  return null;
}

function makePathKeywordTarget(item: Extract<PathItem, { kind: "PathKeyword" }>, items: PathItem[], index: number): PropertyTarget {
  const maybeOption = items[index + 1];
  const optionItem = maybeOption?.kind === "PathOption" ? maybeOption : null;
  return {
    id: item.id,
    kind: "path-keyword",
    span: item.span,
    options: optionItem?.options,
    optionsSpan: optionItem?.span ?? optionItem?.options?.span,
    insertOffset: item.span.to
  };
}

function makeToLikeOperationTarget(
  kind: Exclude<PropertyTargetKind, "path-statement" | "path-keyword" | "node-item">,
  id: string,
  span: Span,
  options: OptionListAst | undefined,
  optionsSpan: Span | undefined,
  keywordRegex: RegExp,
  source: string
): PropertyTarget {
  return {
    id,
    kind,
    span,
    options,
    optionsSpan: optionsSpan ?? options?.span,
    insertOffset: resolveInsertOffset(source, span, keywordRegex)
  };
}

function resolveInsertOffset(source: string, span: Span, tokenRegex: RegExp): number {
  const slice = source.slice(span.from, span.to);
  const match = tokenRegex.exec(slice);
  if (match?.index == null) {
    return span.from;
  }
  return span.from + match.index + match[0].length;
}

function resolveFigureInsertOffset(source: string, span: Span): number | null {
  const figureEnvOffset = resolveInsertOffset(source, span, /\\begin\{tikzpicture\*?\}/);
  if (figureEnvOffset !== span.from) {
    return figureEnvOffset;
  }

  const inlineOffset = resolveInsertOffset(source, span, /\\tikz\b/);
  if (inlineOffset !== span.from) {
    return inlineOffset;
  }

  return null;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
