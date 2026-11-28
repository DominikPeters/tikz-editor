import type { SyntaxNode } from "@lezer/common";

import {
  addLegendEntryId,
  addLegendImageId,
  addPlotId,
  axisScopeBeginId,
  axisScopeEndId,
  axisStatementId,
  foreachStatementId,
  legendStatementId,
  pgfplotsExtraId,
  pgfplotsLibraryStatementId,
  pgfplotsSetStatementId,
  pgfplotsTableReadStatementId
} from "../../ast/ids.js";
import type {
  AddLegendEntryStatement,
  AddLegendImageStatement,
  AddPlotStatement,
  AxisBodyItem,
  AxisScopeBegin,
  AxisEnvironmentName,
  AxisStatement,
  ForeachStatement,
  LegendStatement,
  PgfplotsExtraStatement,
  PgfplotsLibraryStatement,
  PgfplotsSetStatement,
  PgfplotsTableReadStatement,
  PlotInput,
  PlotSourceText,
  PlotTableSource,
  Span
} from "../../ast/types.js";
import { parseOptionListRaw, parseStyleValueAsOptionList } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";
import { readCoordinateList } from "../../pgfplots/coordinate-list.js";
import { findFirstChildByName, forEachChild } from "../../syntax/cursor.js";
import { mapUnknownStatement } from "../../transform/unknown.js";
import { mapPathStatement } from "../paths/parse.js";

const AXIS_ENVIRONMENTS: readonly AxisEnvironmentName[] = ["axis", "semilogxaxis", "semilogyaxis", "loglogaxis"];

const ENVIRONMENT_DELIMITER = /^\\(?:begin|end)[ \t\r\n]*\{([^{}]*)\}/u;

export type AxisMappingState = { nextStatementIndex: number };

/**
 * An `AxisStatement` node. `mapBodyItem` maps one ordinary child of the body
 * (a statement, a comment, an overlay group) as a picture body would.
 */
export function mapAxisStatement(
  node: SyntaxNode,
  source: string,
  state: AxisMappingState,
  // `mapAxisMember` maps an item of an overlay body inside the axis as an axis item.
  mapBodyItem: (child: SyntaxNode, mapAxisMember: (member: SyntaxNode) => AxisBodyItem[]) => AxisBodyItem[]
): AxisStatement {
  const statementIndex = allocate(state);
  const id = axisStatementId(statementIndex);
  const beginNode = findFirstChildByName(node, "BeginAxis");
  const endNode = findFirstChildByName(node, "EndAxis");
  const optionsNode = findFirstChildByName(node, "OptionList");
  const beginSpan = beginNode ? toSpan(beginNode) : { from: node.from, to: node.from };
  const environment = readAxisEnvironmentName(beginNode ? source.slice(beginNode.from, beginNode.to) : "") ?? "axis";
  const endEnvironment = endNode ? readAxisEnvironmentName(source.slice(endNode.from, endNode.to)) : null;
  const bodyFrom = optionsNode?.to ?? beginSpan.to;
  const counters = { plot: 0, legendEntry: 0, legendImage: 0, legend: 0, extra: 0, scope: 0 };

  const body: AxisBodyItem[] = [];
  const visit = (child: SyntaxNode): void => {
    switch (child.type.name) {
      case "BeginAxis":
      case "EndAxis":
      case "OptionList":
      case "Comment":
      case "BeginAxisFontEnv":
      case "EndAxisFontEnv":
        return;
      // A font size environment changes the font of the text inside it; its items belong to the axis.
      case "AxisFontEnvironment":
        forEachChild(child, visit);
        return;
      // A scope's items belong to the axis; the body stays flat between its markers (AC5).
      case "AxisScopeStatement": {
        const index = counters.scope++;
        const begin = findFirstChildByName(child, "BeginAxisScope");
        const end = findFirstChildByName(child, "EndScope");
        const options = findFirstChildByName(child, "OptionList");
        const marker: AxisScopeBegin = {
          kind: "AxisScopeBegin",
          id: axisScopeBeginId(id, index),
          axisId: id,
          span: { from: child.from, to: options?.to ?? begin?.to ?? child.from },
          scopeSpan: toSpan(child),
          ...(options ? { optionsSpan: toSpan(options), options: parseOptionListRaw(source.slice(options.from, options.to), options.from) } : {}),
          ...(end ? { endId: axisScopeEndId(id, index) } : {})
        };
        body.push(marker);
        forEachChild(child, (inner) => {
          if (inner.type.name === "BeginAxisScope" || inner.type.name === "EndScope" || (options !== null && inner.from === options.from && inner.type.name === "OptionList")) return;
          visit(inner);
        });
        if (end) body.push({ kind: "AxisScopeEnd", id: axisScopeEndId(id, index), axisId: id, span: toSpan(end), beginId: marker.id });
        return;
      }
      case "AxisLabelStatement":
        body.push(mapUnknownStatement(child, source, allocate(state)));
        return;
      case "PgfplotsInvokeForeachStatement":
        body.push(mapInvokeForeachStatement(child, source, state));
        return;
      case "AddPlotStatement":
        body.push(mapAddPlotStatement(child, source, state, id, counters.plot++));
        return;
      case "AddLegendEntryStatement":
        body.push(mapAddLegendEntryStatement(child, source, id, counters.legendEntry++));
        return;
      case "AddLegendImageStatement":
        body.push(mapAddLegendImageStatement(child, source, id, counters.legendImage++));
        return;
      case "LegendStatement":
        body.push(mapLegendStatement(child, source, id, counters.legend++));
        return;
      case "PgfplotsExtraStatement":
        body.push(mapPgfplotsExtraStatement(child, source, id, counters.extra++));
        return;
      default:
        body.push(...mapBodyItem(child, mapAxisMember));
    }
  };
  const mapAxisMember = (member: SyntaxNode): AxisBodyItem[] => {
    const start = body.length;
    visit(member);
    return body.splice(start);
  };
  forEachChild(node, visit);

  return {
    kind: "Axis",
    id,
    span: toSpan(node),
    environment,
    beginSpan,
    ...(endNode ? { endSpan: toSpan(endNode) } : {}),
    ...(endEnvironment && endEnvironment !== environment ? { endEnvironment } : {}),
    terminated: endNode !== null,
    ...(optionsNode
      ? {
          optionsSpan: toSpan(optionsNode),
          options: parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from)
        }
      : {}),
    bodySpan: { from: bodyFrom, to: endNode?.from ?? node.to },
    body
  };
}

function readAxisEnvironmentName(delimiter: string): AxisEnvironmentName | null {
  const name = ENVIRONMENT_DELIMITER.exec(delimiter)?.[1];
  return AXIS_ENVIRONMENTS.find((candidate) => candidate === name) ?? null;
}

function mapAddPlotStatement(
  node: SyntaxNode,
  source: string,
  state: AxisMappingState,
  axisId: string,
  plotIndex: number
): AddPlotStatement {
  const commandNode = findFirstChildByName(node, "AddPlotCmd") ?? findFirstChildByName(node, "AddPlot3Cmd");
  const incrementNode = findFirstChildByName(node, "AddPlotIncrement");
  const optionNodes: SyntaxNode[] = [];
  forEachChild(node, (child) => {
    if (child.type.name === "OptionList") optionNodes.push(child);
  });
  const [optionsNode = null, ...extraOptionNodes] = optionNodes;
  const trailingNode = findFirstChildByName(node, "AddPlotTrailingPath");
  const legacyNode = findFirstChildByName(node, "AddPlotLegacyPlot");
  const legacyKeyword = legacyNode ? findFirstChildByName(legacyNode, "PlotKw") : null;
  const legacyOptions = legacyNode ? findFirstChildByName(legacyNode, "OptionList") : null;
  const input = mapPlotInput(node, source);
  // The trailing path is a `\path` of its own: its items get ids from a statement index.
  const trailingPath = trailingNode ? { ...mapPathStatement(trailingNode, source, allocate(state)), command: "path" as const } : undefined;
  return {
    kind: "AddPlot",
    id: addPlotId(axisId, plotIndex),
    axisId,
    plotIndex,
    span: toSpan(node),
    commandSpan: commandNode ? toSpan(commandNode) : { from: node.from, to: node.from },
    dimension: commandNode?.type.name === "AddPlot3Cmd" ? 3 : 2,
    increment: incrementNode !== null,
    ...(incrementNode ? { incrementSpan: toSpan(incrementNode) } : {}),
    ...(optionsNode
      ? {
          optionsSpan: toSpan(optionsNode),
          options: parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from)
        }
      : {}),
    ...(extraOptionNodes.length > 0
      ? { extraOptions: extraOptionNodes.map((extra) => ({ span: toSpan(extra), options: parseOptionListRaw(source.slice(extra.from, extra.to), extra.from) })) }
      : {}),
    ...(legacyNode
      ? {
          legacyPlot: {
            keywordSpan: legacyKeyword ? toSpan(legacyKeyword) : toSpan(legacyNode),
            ...(legacyOptions
              ? { optionsSpan: toSpan(legacyOptions), options: parseOptionListRaw(source.slice(legacyOptions.from, legacyOptions.to), legacyOptions.from) }
              : {})
          }
        }
      : {}),
    input,
    ...(trailingPath ? { trailingPath } : {}),
    terminated: source[node.to - 1] === ";"
  };
}

function mapPlotInput(node: SyntaxNode, source: string): PlotInput {
  const coordinates = findFirstChildByName(node, "PlotCoordinates");
  if (coordinates) {
    const keyword = findFirstChildByName(coordinates, "CoordinatesKw");
    const group = findFirstChildByName(coordinates, "Group");
    const brace = group ? braceInner(group, source) : { span: { from: coordinates.to, to: coordinates.to }, terminated: false };
    const reading = readCoordinateList(source, brace.span.from, brace.span.to);
    return {
      kind: "coordinates",
      span: toSpan(coordinates),
      keywordSpan: keyword ? toSpan(keyword) : { from: coordinates.from, to: coordinates.from },
      bodySpan: brace.span,
      bodyRaw: source.slice(brace.span.from, brace.span.to),
      points: reading.points,
      unparsed: reading.unparsed,
      terminated: brace.terminated
    };
  }
  const expression = findFirstChildByName(node, "PlotExpression");
  if (expression) {
    const group = findFirstChildByName(expression, "PlotExpressionData") ?? findFirstChildByName(expression, "Group");
    const inner = group ? braceInner(group, source).span : toSpan(expression);
    return { kind: "expression", span: toSpan(expression), expression: source.slice(inner.from, inner.to), expressionSpan: inner };
  }
  const parametric = findFirstChildByName(node, "PlotParametric");
  if (parametric) {
    return { kind: "parametric", span: toSpan(parametric), components: splitTopLevel(source, parametric.from + 1, closeOf(parametric, source, ")"), ",") };
  }
  const table = findFirstChildByName(node, "PlotTable");
  if (table) {
    const keyword = findFirstChildByName(table, "TableKw");
    const options = findFirstChildByName(table, "OptionList");
    const from = findFirstChildByName(table, "FromKw");
    return {
      kind: "table",
      span: toSpan(table),
      keywordSpan: keyword ? toSpan(keyword) : { from: table.from, to: table.from },
      ...(options
        ? { optionsSpan: toSpan(options), options: parseOptionListRaw(source.slice(options.from, options.to), options.from) }
        : {}),
      ...(from ? { fromSpan: toSpan(from) } : {}),
      source: mapTableSource(table, source)
    };
  }
  const keywordInput = findFirstChildByName(node, "PlotKeywordInput");
  const names: SyntaxNode[] = [];
  if (keywordInput) {
    forEachChild(keywordInput, (child) => {
      if (child.type.name === "PlotInputName") names.push(child);
    });
  }
  const span = keywordInput ? toSpan(keywordInput) : { from: node.to, to: node.to };
  const nameSpan = names.length > 0 ? { from: names[0]?.from ?? span.from, to: names.at(-1)?.to ?? span.from } : { from: span.from, to: span.from };
  const name = names.map((child) => source.slice(child.from, child.to)).join(" ");
  const options = keywordInput ? findFirstChildByName(keywordInput, "OptionList") : null;
  const group = keywordInput ? findFirstChildByName(keywordInput, "Group") : null;
  const argument = group ? braceInner(group, source).span : null;
  // `expression {…}` is the long form of `{…}`.
  if (name === "expression" && argument && !options) {
    return { kind: "expression", span, keywordSpan: nameSpan, expression: source.slice(argument.from, argument.to), expressionSpan: argument };
  }
  return {
    kind: "other",
    span,
    name,
    nameSpan,
    ...(options ? { optionsSpan: toSpan(options), options: parseOptionListRaw(source.slice(options.from, options.to), options.from) } : {}),
    ...(argument ? { argumentRaw: source.slice(argument.from, argument.to), argumentSpan: argument } : {}),
    raw: source.slice(span.from, span.to)
  };
}

/**
 * Inline rows, a file name or a loaded table. The manual reads data with
 * newlines (or `\\` row separators) as an inline table and a single name as a
 * file, and `\macro` (braced or not) as a table read before.
 */
function mapTableSource(table: SyntaxNode, source: string): PlotTableSource {
  const macro = findFirstChildByName(table, "CommandName");
  if (macro) {
    return { kind: "macro", name: source.slice(macro.from, macro.to), span: toSpan(macro) };
  }
  const data = findFirstChildByName(table, "TableData");
  if (!data) {
    return { kind: "inline", raw: "", span: { from: table.to, to: table.to }, braceSpan: { from: table.to, to: table.to }, terminated: false };
  }
  const brace = braceInner(data, source);
  const raw = source.slice(brace.span.from, brace.span.to);
  const trimmed = trimmedSpan(source, brace.span);
  const trimmedRaw = source.slice(trimmed.from, trimmed.to);
  if (/^\\[A-Za-z@]+$/u.test(trimmedRaw)) {
    return { kind: "macro", name: trimmedRaw, span: trimmed, braceSpan: toSpan(data) };
  }
  if (brace.terminated && !/[\n\r]|\\\\/u.test(raw) && trimmedRaw.length > 0) {
    return { kind: "file", name: trimmedRaw, span: trimmed, braceSpan: toSpan(data) };
  }
  return { kind: "inline", raw, span: brace.span, braceSpan: toSpan(data), terminated: brace.terminated };
}

/**
 * `\pgfplotsinvokeforeach{list}{body}`: a loop whose body names the element
 * `#1` (manual, utility commands), mapped as a `\foreach` over `#1`.
 */
function mapInvokeForeachStatement(node: SyntaxNode, source: string, state: AxisMappingState): ForeachStatement {
  const groups: SyntaxNode[] = [];
  forEachChild(node, (child) => {
    if (child.type.name === "Group") groups.push(child);
  });
  const [list, bodyNode] = groups;
  const listRaw = list ? source.slice(braceInner(list, source).span.from, braceInner(list, source).span.to) : "";
  return {
    kind: "Foreach",
    id: foreachStatementId(allocate(state)),
    span: toSpan(node),
    ...(list ? { headerSpan: toSpan(list) } : {}),
    headerRaw: list ? source.slice(list.from, list.to) : "",
    variablesRaw: "#1",
    listRaw: list ? `{${listRaw}}` : "",
    prefixRaw: list ? source.slice(list.from, list.to) : "",
    bodyRaw: bodyNode ? source.slice(bodyNode.from, bodyNode.to) : "",
    ...(bodyNode ? { bodySpan: toSpan(bodyNode) } : {}),
    pgfplots: "invoke"
  };
}

function mapAddLegendEntryStatement(node: SyntaxNode, source: string, axisId: string, index: number): AddLegendEntryStatement {
  const command = findFirstChildByName(node, "AddLegendEntryCmd");
  const options = findFirstChildByName(node, "OptionList");
  const text = findFirstChildByName(node, "NodeTextGroup");
  const textSpan = text ? braceInner(text, source).span : { from: node.to, to: node.to };
  return {
    kind: "AddLegendEntry",
    id: addLegendEntryId(axisId, index),
    axisId,
    span: toSpan(node),
    expanded: command ? source.slice(command.from, command.to) === "\\addlegendentryexpanded" : false,
    ...(options ? { optionsSpan: toSpan(options), options: parseOptionListRaw(source.slice(options.from, options.to), options.from) } : {}),
    text: source.slice(textSpan.from, textSpan.to),
    textSpan
  };
}

function mapAddLegendImageStatement(node: SyntaxNode, source: string, axisId: string, index: number): AddLegendImageStatement {
  const payload = findFirstChildByName(node, "StylePayload");
  const payloadSpan = payload ? toSpan(payload) : { from: node.to, to: node.to };
  const payloadRaw = source.slice(payloadSpan.from, payloadSpan.to);
  return {
    kind: "AddLegendImage",
    id: addLegendImageId(axisId, index),
    axisId,
    span: toSpan(node),
    payloadSpan,
    options: parseStyleValueAsOptionList(payloadRaw, payloadSpan.from) ?? parseOptionListRaw("[]", payloadSpan.from)
  };
}

function mapLegendStatement(node: SyntaxNode, source: string, axisId: string, index: number): LegendStatement {
  const group = findFirstChildByName(node, "Group");
  const listSpan = group ? braceInner(group, source).span : { from: node.to, to: node.to };
  const listRaw = source.slice(listSpan.from, listSpan.to);
  const backslashDelimited = splitTopLevel(source, listSpan.from, listSpan.to, "\\\\");
  // `\\`-delimited when the list holds a top-level `\\` (each entry, the last too, ends with one).
  const delimiter = backslashDelimited.length > 1 ? "\\\\" : ",";
  const entries = delimiter === "\\\\"
    ? backslashDelimited.filter((entry, position) => position < backslashDelimited.length - 1 || entry.raw.length > 0)
    : splitTopLevel(source, listSpan.from, listSpan.to, ",");
  return {
    kind: "Legend",
    id: legendStatementId(axisId, index),
    axisId,
    span: toSpan(node),
    listRaw,
    listSpan,
    delimiter,
    entries: listRaw.trim().length === 0 ? [] : entries
  };
}

function mapPgfplotsExtraStatement(node: SyntaxNode, source: string, axisId: string, index: number): PgfplotsExtraStatement {
  const group = findFirstChildByName(node, "Group");
  const bodySpan = group ? braceInner(group, source).span : { from: node.to, to: node.to };
  return {
    kind: "PgfplotsExtra",
    id: pgfplotsExtraId(axisId, index),
    axisId,
    span: toSpan(node),
    bodyRaw: source.slice(bodySpan.from, bodySpan.to),
    bodySpan
  };
}

export function mapPgfplotsSetStatement(node: SyntaxNode, source: string, state: AxisMappingState): PgfplotsSetStatement {
  const statementIndex = allocate(state);
  const payload = findFirstChildByName(node, "StylePayload");
  const payloadRaw = payload ? source.slice(payload.from, payload.to) : "";
  const parsedList = parseStyleValueAsOptionList(payloadRaw, payload?.from ?? node.from) ?? parseOptionListRaw("[]", node.from);
  // `\pgfplotstableset{col sep=comma}` is `\pgfplotsset{table/col sep=comma}` (manual: pgfplotstable).
  const optionList = source.startsWith("\\pgfplotstableset", node.from) ? prefixTableKeys(parsedList) : parsedList;
  const compatEntry = optionList.entries.filter((entry) => entry.kind === "kv" && entry.key.trim() === "compat").at(-1);
  const compat: PlotSourceText | undefined = compatEntry?.kind === "kv" && compatEntry.valueSpan
    ? { raw: compatEntry.valueRaw.trim(), span: compatEntry.valueSpan }
    : compatEntry?.kind === "kv"
      ? { raw: compatEntry.valueRaw.trim(), span: compatEntry.span }
      : undefined;
  return {
    kind: "PgfplotsSet",
    id: pgfplotsSetStatementId(statementIndex),
    span: toSpan(node),
    raw: source.slice(node.from, node.to),
    commandRaw: "\\pgfplotsset",
    payloadRaw,
    ...(payload ? { payloadSpan: toSpan(payload) } : {}),
    optionList,
    ...(compat ? { compat } : {})
  };
}

function prefixTableKeys(list: OptionListAst): OptionListAst {
  const entries = list.entries.map((entry) => {
    if (entry.kind === "unknown" || /^\/?pgfplots\//u.test(entry.key)) return entry;
    return { ...entry, key: `table/${entry.key.trim()}`, raw: `table/${entry.raw.trim()}` };
  });
  return { ...list, entries, raw: `[${entries.map((entry) => entry.raw).join(",")}]` };
}

export function mapPgfplotsTableReadStatement(node: SyntaxNode, source: string, state: AxisMappingState): PgfplotsTableReadStatement {
  const statementIndex = allocate(state);
  const options = findFirstChildByName(node, "OptionList");
  const data = findFirstChildByName(node, "TableData");
  const macro = findFirstChildByName(node, "CommandName");
  const inner = data ? braceInner(data, source).span : { from: node.to, to: node.to };
  return {
    kind: "PgfplotsTableRead",
    id: pgfplotsTableReadStatementId(statementIndex),
    span: toSpan(node),
    raw: source.slice(node.from, node.to),
    ...(options ? { optionsSpan: toSpan(options), options: parseOptionListRaw(source.slice(options.from, options.to), options.from) } : {}),
    dataRaw: source.slice(inner.from, inner.to),
    dataSpan: inner,
    macroName: macro ? source.slice(macro.from, macro.to) : "",
    macroSpan: macro ? toSpan(macro) : { from: node.to, to: node.to }
  };
}

export function mapPgfplotsLibraryStatement(node: SyntaxNode, source: string, state: AxisMappingState): PgfplotsLibraryStatement {
  const statementIndex = allocate(state);
  const group = findFirstChildByName(node, "Group");
  const librariesSpan = group ? braceInner(group, source).span : undefined;
  const librariesRaw = librariesSpan ? source.slice(librariesSpan.from, librariesSpan.to) : "";
  return {
    kind: "PgfplotsLibrary",
    id: pgfplotsLibraryStatementId(statementIndex),
    span: toSpan(node),
    raw: source.slice(node.from, node.to),
    commandRaw: "\\usepgfplotslibrary",
    librariesRaw,
    ...(librariesSpan ? { librariesSpan } : {}),
    libraries: librariesRaw.split(",").map((entry) => entry.replace(/%[^\n]*/gu, "").trim()).filter((entry) => entry.length > 0)
  };
}

/** The content of a `{…}` node and whether its closing brace is there. */
function braceInner(node: SyntaxNode, source: string): { span: Span; terminated: boolean } {
  const from = source[node.from] === "{" ? node.from + 1 : node.from;
  const terminated = node.to - node.from >= 2 && source[node.to - 1] === "}";
  return { span: { from, to: Math.max(from, terminated ? node.to - 1 : node.to) }, terminated };
}

function closeOf(node: SyntaxNode, source: string, close: string): number {
  return source[node.to - 1] === close ? node.to - 1 : node.to;
}

/**
 * Splits `source[from, to)` at `separator` outside braces and parentheses,
 * trimming each part (a part keeps an outer `{…}`).
 */
function splitTopLevel(source: string, from: number, to: number, separator: string): PlotSourceText[] {
  const parts: PlotSourceText[] = [];
  let depth = 0;
  let partFrom = from;
  const push = (end: number): void => {
    const span = trimmedSpan(source, { from: partFrom, to: end });
    parts.push({ raw: source.slice(span.from, span.to), span });
  };
  for (let cursor = from; cursor < to; cursor += 1) {
    const char = source[cursor];
    if (depth === 0 && source.startsWith(separator, cursor)) {
      push(cursor);
      cursor += separator.length - 1;
      partFrom = cursor + 1;
      continue;
    }
    if (char === "\\") {
      cursor += 1;
    } else if (char === "%") {
      while (cursor + 1 < to && source[cursor + 1] !== "\n") cursor += 1;
    } else if (char === "{" || char === "(") {
      depth += 1;
    } else if ((char === "}" || char === ")") && depth > 0) {
      depth -= 1;
    }
  }
  push(to);
  return parts;
}

function trimmedSpan(source: string, span: Span): Span {
  let { from, to } = span;
  while (from < to && /\s/u.test(source[from] ?? "")) from += 1;
  while (to > from && /\s/u.test(source[to - 1] ?? "")) to -= 1;
  return { from, to };
}

function toSpan(node: SyntaxNode): Span {
  return { from: node.from, to: node.to };
}

function allocate(state: AxisMappingState): number {
  const index = state.nextStatementIndex;
  state.nextStatementIndex += 1;
  return index;
}
