import type { SyntaxNode } from "@lezer/common";

import {
  childForeachClauseId,
  childOperationItemId,
  coordinateOperationItemId,
  decorateOperationItemId,
  edgeOperationItemId,
  edgeFromParentOperationItemId,
  letOperationItemId,
  pathForeachItemId,
  picForeachClauseId,
  picOperationItemId,
  svgOperationItemId,
  toOperationItemId
} from "../../ast/ids.js";
import type {
  ChildForeachClause,
  ChildOperationItem,
  CoordinateOperationItem,
  DecorateOperationItem,
  EdgeOperationItem,
  EdgeFromParentOperationItem,
  LetOperationItem,
  NodeItem,
  PathForeachItem,
  PathItem,
  PicForeachClause,
  PicOperationItem,
  RelativeCoordinatePrefix,
  Span,
  SvgOperationItem,
  ToOperationTarget,
  ToOperationItem
} from "../../ast/types.js";
import { parseForeachHeaderRaw, stripForeachCommandPrefix } from "../../foreach/header.js";
import { parsePathItemsFromFragmentWithMapping } from "../../foreach/snippet-parse.js";
import { parseCoordinate } from "../coordinates/parse.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";
import { findFirstChildByName, firstNamedChild } from "../../syntax/cursor.js";
import { mapNodeItem } from "../nodes/parse.js";
import { stripWrappingBraces } from "../../utils/braces.js";

export function mapToOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): ToOperationItem {
  return mapToLikeOperationItem("ToOperation", toOperationItemId(statementIndex, itemIndex), node, source, statementIndex, itemIndex);
}

export function mapEdgeOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): EdgeOperationItem {
  return mapToLikeOperationItem("EdgeOperation", edgeOperationItemId(statementIndex, itemIndex), node, source, statementIndex, itemIndex);
}

export function mapChildOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): ChildOperationItem {
  const optionsNode = findFirstChildByName(node, "OptionList");
  const bodyNode = findFirstChildByName(node, "Group");
  const foreachClauses = mapChildForeachClauses(node, source, statementIndex, itemIndex);
  const bodyRaw = bodyNode ? source.slice(bodyNode.from, bodyNode.to) : "{}";
  const parsedBody = bodyNode
    ? parsePathItemsFromFragmentWithMapping(bodyRaw, { from: bodyNode.from, to: bodyNode.to })
    : { value: [] as PathItem[] };
  const templateRaw = buildChildTemplateRaw(node, source, foreachClauses);

  return {
    kind: "ChildOperation",
    id: childOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    templateRaw,
    optionsSpan: toSpan(optionsNode),
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    foreachClauses: foreachClauses.length > 0 ? foreachClauses : undefined,
    bodySpan: toSpan(bodyNode),
    bodyRaw,
    body: parsedBody.value
  };
}

export function mapEdgeFromParentOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): EdgeFromParentOperationItem {
  const optionsNode = findFirstChildByName(node, "OptionList");
  const nodes = mapToOperationNodes(node, source, statementIndex, itemIndex, "edge-from-parent-node");
  const raw = source.slice(node.from, node.to);
  const normalizedRaw = raw.toLowerCase();
  const alias: EdgeFromParentOperationItem["alias"] =
    normalizedRaw.includes("edge to parent") ? "edge to parent" : "edge from parent";

  return {
    kind: "EdgeFromParentOperation",
    id: edgeFromParentOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    optionsSpan: toSpan(optionsNode),
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    nodes: nodes.length > 0 ? nodes : undefined,
    alias,
    raw
  };
}

function mapToLikeOperationItem(
  kind: "ToOperation",
  id: string,
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): ToOperationItem;
function mapToLikeOperationItem(
  kind: "EdgeOperation",
  id: string,
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): EdgeOperationItem;
function mapToLikeOperationItem(
  kind: "ToOperation" | "EdgeOperation",
  id: string,
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): ToOperationItem | EdgeOperationItem {
  const optionsNode = findFirstChildByName(node, "OptionList");
  const target = mapToOperationTarget(node, source);
  const nodes = mapToOperationNodes(node, source, statementIndex, itemIndex, kind === "ToOperation" ? "to-node" : "edge-node");
  const pics = mapToOperationPics(node, source, statementIndex, itemIndex, kind === "ToOperation" ? "to-pic" : "edge-pic");

  return {
    kind,
    id,
    span: { from: node.from, to: node.to },
    optionsSpan: toSpan(optionsNode),
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    nodes: nodes.length > 0 ? nodes : undefined,
    pics: pics.length > 0 ? pics : undefined,
    target,
    raw: source.slice(node.from, node.to)
  };
}

export function mapSvgOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): SvgOperationItem {
  const optionsNode = findFirstChildByName(node, "OptionList");
  const payloadNode = findSvgPayloadNode(node);

  return {
    kind: "SvgOperation",
    id: svgOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    optionsSpan: toSpan(optionsNode),
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    dataSpan: toSpan(payloadNode),
    dataRaw: payloadNode ? source.slice(payloadNode.from, payloadNode.to) : ""
  };
}

export function mapLetOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): LetOperationItem {
  return {
    kind: "LetOperation",
    id: letOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to)
  };
}

export function mapCoordinateOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): CoordinateOperationItem {
  const optionsNode = findFirstChildByName(node, "OptionList");
  const nameNode = findFirstChildByName(node, "Coordinate");
  const name = parseCoordinateOperationName(nameNode, source);

  return {
    kind: "CoordinateOperation",
    id: coordinateOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    optionsSpan: toSpan(optionsNode),
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    name,
    nameSpan: toSpan(nameNode),
    placementSpan: undefined,
    raw: source.slice(node.from, node.to)
  };
}

export function mapDecorateOperationItem(
  keywordNode: SyntaxNode,
  optionsNode: SyntaxNode | null,
  subpathNode: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): DecorateOperationItem {
  return {
    kind: "DecorateOperation",
    id: decorateOperationItemId(statementIndex, itemIndex),
    span: { from: keywordNode.from, to: subpathNode.to },
    optionsSpan: toSpan(optionsNode),
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    subpathSpan: { from: subpathNode.from, to: subpathNode.to },
    subpathRaw: source.slice(subpathNode.from, subpathNode.to),
    raw: source.slice(keywordNode.from, subpathNode.to)
  };
}

export function mapDecorateOperationNode(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): DecorateOperationItem {
  const keywordNode = findFirstChildByName(node, "DecorateKw") ?? firstNamedChild(node) ?? node;
  const optionsNode = findFirstChildByName(node, "OptionList");
  const subpathNode = findFirstChildByName(node, "Group") ?? node;
  return mapDecorateOperationItem(keywordNode, optionsNode, subpathNode, source, statementIndex, itemIndex);
}

export function mapPathForeachOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): PathForeachItem {
  const commandNode = findFirstChildByName(node, "ForeachKw") ?? findFirstChildByName(node, "ForeachCmd");
  const listNode = findFirstChildByName(node, "ForeachList");
  const bodyNode = findFirstChildByName(node, "Group");

  const commandRaw = commandNode ? source.slice(commandNode.from, commandNode.to).trim() : "foreach";
  const headerFrom = commandNode ? commandNode.to : node.from;
  const headerTo = listNode ? listNode.to : (bodyNode?.from ?? node.to);
  const headerSlice = source.slice(headerFrom, Math.max(headerFrom, headerTo));
  const parsedHeader = parseForeachHeaderRaw(headerSlice);
  const headerStartOffset = headerSlice.indexOf(parsedHeader.headerRaw);
  const headerFromAbsolute = headerStartOffset >= 0 ? headerFrom + headerStartOffset : headerFrom;

  const options =
    parsedHeader.optionsRaw && parsedHeader.optionsSpan
      ? parseOptionListRaw(parsedHeader.optionsRaw, headerFromAbsolute + parsedHeader.optionsSpan.from)
      : undefined;
  const optionsSpan =
    parsedHeader.optionsSpan != null
      ? {
          from: headerFromAbsolute + parsedHeader.optionsSpan.from,
          to: headerFromAbsolute + parsedHeader.optionsSpan.to
        }
      : undefined;

  return {
    kind: "PathForeach",
    id: pathForeachItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw: commandRaw.startsWith("\\") ? "\\foreach" : "foreach",
    headerRaw: parsedHeader.headerRaw,
    variablesRaw: parsedHeader.variablesRaw,
    listRaw: parsedHeader.listRaw,
    options,
    optionsSpan,
    bodyRaw: bodyNode ? source.slice(bodyNode.from, bodyNode.to) : ""
  };
}

function mapToOperationTarget(node: SyntaxNode, source: string): ToOperationTarget | undefined {
  const targetNode = findFirstChildByName(node, "ToTarget");
  if (!targetNode) {
    return undefined;
  }

  const cycleNode = findFirstChildByName(targetNode, "CycleKw");
  if (cycleNode) {
    return {
      kind: "cycle",
      span: { from: cycleNode.from, to: cycleNode.to }
    };
  }

  const coordinateLike = findFirstChildByName(targetNode, "CoordinateLike");
  if (!coordinateLike) {
    return undefined;
  }

  const relative = findFirstChildByName(coordinateLike, "RelativeCoordinate");
  if (relative) {
    const coordinateNode = findFirstChildByName(relative, "Coordinate");
    if (!coordinateNode) {
      return undefined;
    }
    const prefixNode = findFirstChildByName(relative, "RelativePrefix");
    const prefixRaw = prefixNode ? source.slice(prefixNode.from, prefixNode.to) : "";
    const relativePrefix = prefixRaw === "++" ? "++" : prefixRaw === "+" ? "+" : undefined;
    return {
      kind: "coordinate",
      raw: source.slice(coordinateNode.from, coordinateNode.to),
      relativePrefix,
      span: { from: coordinateNode.from, to: coordinateNode.to }
    };
  }

  const coordinateNode = findFirstChildByName(coordinateLike, "Coordinate");
  if (!coordinateNode) {
    return undefined;
  }

  return {
    kind: "coordinate",
    raw: source.slice(coordinateNode.from, coordinateNode.to),
    span: { from: coordinateNode.from, to: coordinateNode.to }
  };
}

function mapToOperationNodes(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number,
  nodeIdPrefix: string
): NodeItem[] {
  const result: NodeItem[] = [];
  let nodeIndex = 0;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "NodeItem") {
      continue;
    }

    const mapped = mapNodeItem(child, source, statementIndex, itemIndex + nodeIndex + 1);
    result.push({
      ...mapped,
      id: `${nodeIdPrefix}:${statementIndex}:${itemIndex}:${nodeIndex}`
    });
    nodeIndex += 1;
  }

  return result;
}

function mapToOperationPics(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number,
  picIdPrefix: string
): PicOperationItem[] {
  const result: PicOperationItem[] = [];
  let picIndex = 0;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "PicOperation") {
      continue;
    }

    const mapped = mapPicOperationItem(child, source, statementIndex, itemIndex + picIndex + 1);
    result.push({
      ...mapped,
      id: `${picIdPrefix}:${statementIndex}:${itemIndex}:${picIndex}`
    });
    picIndex += 1;
  }

  return result;
}

function mapChildForeachClauses(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): ChildForeachClause[] {
  const clauses: ChildForeachClause[] = [];
  let clauseIndex = 0;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "ChildForeachClause") {
      continue;
    }

    const raw = source.slice(child.from, child.to);
    const parsed = parseForeachHeaderRaw(stripForeachCommandPrefix(raw));
    const headerStartInRaw = raw.indexOf(parsed.headerRaw);
    const headerFrom = child.from + (headerStartInRaw >= 0 ? headerStartInRaw : 0);

    const options =
      parsed.optionsRaw && parsed.optionsSpan
        ? parseOptionListRaw(parsed.optionsRaw, headerFrom + parsed.optionsSpan.from)
        : undefined;
    const optionsSpan =
      parsed.optionsSpan != null
        ? {
            from: headerFrom + parsed.optionsSpan.from,
            to: headerFrom + parsed.optionsSpan.to
          }
        : undefined;

    clauses.push({
      kind: "ChildForeachClause",
      id: childForeachClauseId(statementIndex, itemIndex, clauseIndex),
      span: { from: child.from, to: child.to },
      raw,
      headerRaw: parsed.headerRaw,
      variablesRaw: parsed.variablesRaw,
      listRaw: parsed.listRaw,
      options,
      optionsSpan
    });
    clauseIndex += 1;
  }

  return clauses;
}

function buildChildTemplateRaw(node: SyntaxNode, source: string, clauses: ChildForeachClause[]): string {
  if (clauses.length === 0) {
    return source.slice(node.from, node.to);
  }

  const firstClauseStart = clauses.reduce((min, clause) => Math.min(min, clause.span.from), clauses[0].span.from);
  const lastClauseEnd = clauses.reduce((max, clause) => Math.max(max, clause.span.to), clauses[0].span.to);
  return `${source.slice(node.from, firstClauseStart)}${source.slice(lastClauseEnd, node.to)}`;
}

function parseCoordinateOperationName(nameNode: SyntaxNode | null, source: string): string | undefined {
  if (!nameNode) {
    return undefined;
  }

  const parsed = parseCoordinate(source.slice(nameNode.from, nameNode.to));
  if (parsed.form === "named") {
    const normalized = parsed.x.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  const raw = source.slice(nameNode.from, nameNode.to).trim();
  if (raw.startsWith("(") && raw.endsWith(")")) {
    const inner = raw.slice(1, -1).trim();
    return inner.length > 0 ? inner : undefined;
  }
  return undefined;
}

export function mapPicOperationItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): PicOperationItem {
  const options = mergePicOptionLists(findPicOptionLists(node), source);
  const placement = extractPlacementFromPic(node, source) ?? extractPlacementFromOptions(options.options);
  const explicitName = extractExplicitPicName(node, source);
  const optionName = extractPicNameFromOptions(options.options);
  const groupNode = findFirstChildByName(node, "Group");
  const optionType = extractPicTypeFromOptions(options.options);
  const groupType = groupNode
    ? {
        source: "group" as const,
        raw: extractGroupInnerRaw(groupNode, source),
        span: toGroupInnerSpan(groupNode, source)
      }
    : null;
  const picType = optionType ?? groupType;
  const foreachClauses = mapPicForeachClauses(node, source, statementIndex, itemIndex);
  const templateRaw = buildPicTemplateRaw(node, source, foreachClauses);

  return {
    kind: "PicOperation",
    id: picOperationItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    templateRaw,
    optionsSpan: options.span,
    options: options.options,
    foreachClauses: foreachClauses.length > 0 ? foreachClauses : undefined,
    name: explicitName?.name ?? optionName?.name,
    nameSpan: explicitName?.span ?? optionName?.span,
    atSpan: placement?.span,
    atRaw: placement?.raw,
    atRelativePrefix: placement?.relativePrefix,
    typeSource: picType?.source ?? "group",
    typeSpan: picType?.span,
    typeRaw: picType?.raw ?? ""
  };
}

function mapPicForeachClauses(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): PicForeachClause[] {
  const clauses: PicForeachClause[] = [];
  let clauseIndex = 0;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "PicForeachClause") {
      continue;
    }

    const raw = source.slice(child.from, child.to);
    const stripped = stripForeachCommandPrefix(raw);
    const parsed = parseForeachHeaderRaw(stripped);
    const headerStartInRaw = raw.indexOf(parsed.headerRaw);
    const headerFrom = child.from + (headerStartInRaw >= 0 ? headerStartInRaw : 0);
    const options =
      parsed.optionsRaw && parsed.optionsSpan
        ? parseOptionListRaw(parsed.optionsRaw, headerFrom + parsed.optionsSpan.from)
        : undefined;
    const optionsSpan =
      parsed.optionsSpan != null
        ? {
            from: headerFrom + parsed.optionsSpan.from,
            to: headerFrom + parsed.optionsSpan.to
          }
        : undefined;

    clauses.push({
      kind: "PicForeachClause",
      id: picForeachClauseId(statementIndex, itemIndex, clauseIndex),
      span: { from: child.from, to: child.to },
      raw,
      headerRaw: parsed.headerRaw,
      variablesRaw: parsed.variablesRaw,
      listRaw: parsed.listRaw,
      optionsSpan,
      options
    });
    clauseIndex += 1;
  }

  return clauses;
}

function buildPicTemplateRaw(node: SyntaxNode, source: string, clauses: PicForeachClause[]): string {
  if (clauses.length === 0) {
    return source.slice(node.from, node.to);
  }

  const keywordNode = findFirstChildByName(node, "PicKw") ?? findFirstChildByName(node, "PicCmd");
  const prefixTo = keywordNode?.to ?? node.from;
  const clauseEnd = clauses.reduce((max, clause) => Math.max(max, clause.span.to), prefixTo);
  const prefix = source.slice(node.from, prefixTo);
  const suffix = source.slice(clauseEnd, node.to);
  return `${prefix}${suffix}`;
}

function findPicOptionLists(node: SyntaxNode): SyntaxNode[] {
  const lists: SyntaxNode[] = [];

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name === "OptionList") {
      lists.push(child);
      continue;
    }
    if (child.type.name !== "PicQualifier") {
      continue;
    }
    const actual = firstNamedChild(child);
    if (actual?.type.name === "OptionList") {
      lists.push(actual);
    }
  }

  return dedupeNodesBySpan(lists);
}

function mergePicOptionLists(
  optionNodes: SyntaxNode[],
  source: string
): {
  span?: Span;
  options?: OptionListAst;
} {
  if (optionNodes.length === 0) {
    return {};
  }

  const parsed = optionNodes.map((node) => parseOptionListRaw(source.slice(node.from, node.to), node.from));
  if (parsed.length === 1) {
    return {
      span: { from: optionNodes[0].from, to: optionNodes[0].to },
      options: parsed[0]
    };
  }

  const first = optionNodes[0];
  const last = optionNodes[optionNodes.length - 1];
  return {
    span: { from: first.from, to: last.to },
    options: {
      span: { from: first.from, to: last.to },
      raw: optionNodes.map((node) => source.slice(node.from, node.to)).join(" "),
      entries: parsed.flatMap((list) => list.entries)
    }
  };
}

function dedupeNodesBySpan(nodes: SyntaxNode[]): SyntaxNode[] {
  const seen = new Set<string>();
  const deduped: SyntaxNode[] = [];
  for (const node of nodes) {
    const key = `${node.from}:${node.to}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(node);
  }
  deduped.sort((left, right) => left.from - right.from || left.to - right.to);
  return deduped;
}

function extractPlacementFromPic(
  node: SyntaxNode,
  source: string
): { span: Span; raw: string; relativePrefix?: RelativeCoordinatePrefix } | undefined {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name === "PicPlacement") {
      return extractPlacementFromPlacementNode(child, source);
    }
    if (child.type.name !== "PicQualifier") {
      continue;
    }

    const actual = firstNamedChild(child);
    if (actual?.type.name !== "PicPlacement") {
      continue;
    }

    return extractPlacementFromPlacementNode(actual, source);
  }

  return undefined;
}

function extractPlacementFromPlacementNode(
  node: SyntaxNode,
  source: string
): { span: Span; raw: string; relativePrefix?: RelativeCoordinatePrefix } | undefined {
  const coordinateLike = findFirstChildByName(node, "CoordinateLike");
  if (!coordinateLike) {
    return undefined;
  }
  const relative = findFirstChildByName(coordinateLike, "RelativeCoordinate");
  if (relative) {
    const prefixRaw = source.slice(relative.from, findFirstChildByName(relative, "Coordinate")?.from ?? relative.from).trim();
    const coordinate = findFirstChildByName(relative, "Coordinate");
    if (!coordinate) {
      return undefined;
    }
    const prefix: RelativeCoordinatePrefix | undefined = prefixRaw.startsWith("++")
      ? "++"
      : prefixRaw.startsWith("+")
        ? "+"
        : undefined;
    return {
      span: { from: coordinate.from, to: coordinate.to },
      raw: source.slice(coordinate.from, coordinate.to),
      relativePrefix: prefix
    };
  }

  const coordinate = findFirstChildByName(coordinateLike, "Coordinate");
  if (!coordinate) {
    return undefined;
  }
  return {
    span: { from: coordinate.from, to: coordinate.to },
    raw: source.slice(coordinate.from, coordinate.to)
  };
}

function extractPlacementFromOptions(
  options: OptionListAst | undefined
): { span: Span; raw: string; relativePrefix?: RelativeCoordinatePrefix } | undefined {
  for (const entry of options?.entries ?? []) {
    if (entry.kind !== "kv" || entry.key !== "at") {
      continue;
    }
    const raw = stripWrappingBraces(entry.valueRaw);
    if (!raw.trim().startsWith("(")) {
      continue;
    }
    return {
      span: entry.valueSpan ?? entry.span,
      raw
    };
  }
  return undefined;
}

function extractExplicitPicName(node: SyntaxNode, source: string): { name: string; span: Span } | undefined {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "PicQualifier") {
      continue;
    }
    const actual = firstNamedChild(child);
    if (actual?.type.name !== "PicName") {
      continue;
    }
    const coordinate = findFirstChildByName(actual, "Coordinate");
    const parsed = coordinate ? parseCoordinate(source.slice(coordinate.from, coordinate.to)) : null;
    if (parsed?.form === "named" && parsed.x.trim().length > 0 && parsed.y.trim().length === 0) {
      return {
        name: parsed.x.trim(),
        span: { from: coordinate!.from, to: coordinate!.to }
      };
    }
  }
  return undefined;
}

function extractPicNameFromOptions(
  options: OptionListAst | undefined
): { name: string; span: Span } | undefined {
  for (const entry of options?.entries ?? []) {
    if (entry.kind !== "kv" || entry.key !== "name") {
      continue;
    }
    const name = stripWrappingBraces(entry.valueRaw).trim();
    if (name.length === 0) {
      continue;
    }
    return {
      name,
      span: entry.valueSpan ?? entry.span
    };
  }
  return undefined;
}

function extractPicTypeFromOptions(
  options: OptionListAst | undefined
): { source: "option"; raw: string; span: Span } | null {
  for (const entry of options?.entries ?? []) {
    if (entry.kind !== "kv" || entry.key !== "pic type") {
      continue;
    }
    return {
      source: "option",
      raw: stripWrappingBraces(entry.valueRaw).trim(),
      span: entry.valueSpan ?? entry.span
    };
  }
  return null;
}

function extractGroupInnerRaw(node: SyntaxNode, source: string): string {
  const raw = source.slice(node.from, node.to);
  return stripWrappingBraces(raw);
}

function toGroupInnerSpan(node: SyntaxNode, source: string): Span {
  const hasOpenBrace = source[node.from] === "{";
  const hasCloseBrace = source[node.to - 1] === "}";
  return {
    from: hasOpenBrace ? node.from + 1 : node.from,
    to: hasCloseBrace ? node.to - 1 : node.to
  };
}

function findSvgPayloadNode(node: SyntaxNode): SyntaxNode | null {
  const wrapper = findFirstChildByName(node, "SvgPayload");
  if (!wrapper) {
    return null;
  }

  return firstNamedChild(wrapper) ?? wrapper;
}

function toSpan(node: SyntaxNode | null): Span | undefined {
  if (!node) {
    return undefined;
  }

  return { from: node.from, to: node.to };
}
