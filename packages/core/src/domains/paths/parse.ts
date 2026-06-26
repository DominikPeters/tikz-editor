import type { SyntaxNode } from "@lezer/common";

import { graphOperationItemId, pathCommentItemId, pathStatementId, plotOperationItemId } from "../../ast/ids.js";
import type { ChildForeachClause, PathCommand, PathItem, PathStatement } from "../../ast/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";
import { parsePathItemsFromFragment } from "../../foreach/snippet-parse.js";
import { mapCoordinateItem, mapRelativeCoordinateItem } from "../coordinates/parse.js";
import { mapNodeItem, mapSyntheticNodeItem } from "../nodes/parse.js";
import { mapPathOptionItem } from "../options/parse.js";
import { maybeMapPathKeywordItem } from "./keywords.js";
import { mapUnknownPathItem } from "../../transform/unknown.js";
import { parseGraphSpec } from "./graph-spec.js";
import { findFirstChildByName, firstNamedChild, forEachChild } from "../../syntax/cursor.js";
import {
  mapChildOperationItem,
  mapCoordinateOperationItem,
  mapDecorateOperationItem,
  mapDecorateOperationNode,
  mapEdgeOperationItem,
  mapEdgeFromParentOperationItem,
  mapLetOperationItem,
  mapPathForeachOperationItem,
  mapPicOperationItem,
  mapSvgOperationItem,
  mapToOperationItem
} from "./operations.js";

type PathItemContext = {
  command: PathCommand;
  syntheticNodeEmitted: boolean;
  pendingNodeOptions: SyntaxNode[];
  syntheticNodeImplicitFlags: string[];
  graphCommandConsumed: boolean;
};

export function mapPathStatement(node: SyntaxNode, source: string, statementIndex: number): PathStatement {
  const picPathStatement = findFirstChildByName(node, "PicPathStatement");
  if (picPathStatement) {
    const picItem = mapPicOperationItem(picPathStatement, source, statementIndex, 0);
    return {
      kind: "Path",
      id: pathStatementId(statementIndex),
      span: { from: node.from, to: node.to },
      command: "path",
      options: undefined,
      items: [picItem]
    };
  }

  const nodePathStatement = findFirstChildByName(node, "NodePathStatement");
  const commandNode = nodePathStatement
    ? findFirstChildByName(nodePathStatement, "NodeCmd")
    : findFirstChildByName(node, "PathCommand");
  const commandText = commandNode ? source.slice(commandNode.from, commandNode.to) : "\\path";
  const syntheticNodeImplicitFlags = isMatrixCommand(commandText) ? ["matrix"] : [];
  const command = normalizePathCommand(commandText);

  const context: PathItemContext = {
    command,
    syntheticNodeEmitted: false,
    pendingNodeOptions: [],
    syntheticNodeImplicitFlags,
    graphCommandConsumed: false
  };

  const items: PathItem[] = [];
  let itemIndex = 0;
  const pathItemNodes = collectPathItemNodes(node);
  let nodeIndex = 0;
  while (nodeIndex < pathItemNodes.length) {
    const mappedGraph = tryMapGraphOperation(pathItemNodes, nodeIndex, source, statementIndex, itemIndex, context);
    if (mappedGraph) {
      if (context.pendingNodeOptions.length > 0) {
        for (const optionNode of context.pendingNodeOptions) {
          items.push(mapPathOptionItem(optionNode, source, statementIndex, itemIndex));
          itemIndex += 1;
        }
        context.pendingNodeOptions = [];
      }
      items.push(mappedGraph.item);
      itemIndex += 1;
      nodeIndex += mappedGraph.consumed;
      continue;
    }

    const mappedDecorate = tryMapDecorateOperation(pathItemNodes, nodeIndex, source, statementIndex, itemIndex);
    if (mappedDecorate) {
      if (context.pendingNodeOptions.length > 0) {
        for (const optionNode of context.pendingNodeOptions) {
          items.push(mapPathOptionItem(optionNode, source, statementIndex, itemIndex));
          itemIndex += 1;
        }
        context.pendingNodeOptions = [];
      }
      items.push(mappedDecorate.item);
      itemIndex += 1;
      nodeIndex += mappedDecorate.consumed;
      continue;
    }

    const mappedPlot = tryMapPlotOperation(pathItemNodes, nodeIndex, source, statementIndex, itemIndex);
    if (mappedPlot) {
      if (context.pendingNodeOptions.length > 0) {
        for (const optionNode of context.pendingNodeOptions) {
          items.push(mapPathOptionItem(optionNode, source, statementIndex, itemIndex));
          itemIndex += 1;
        }
        context.pendingNodeOptions = [];
      }
      items.push(mappedPlot.item);
      itemIndex += 1;
      nodeIndex += mappedPlot.consumed;
      continue;
    }

    const mapped = mapPathItem(pathItemNodes[nodeIndex], source, statementIndex, itemIndex, context);
    if (mapped) {
      items.push(mapped);
      itemIndex += 1;
    }
    nodeIndex += 1;
  }

  if (context.command === "node" && !context.syntheticNodeEmitted && context.pendingNodeOptions.length > 0) {
    if (pendingNodeOptionsContainNodeContents(context.pendingNodeOptions, source)) {
      items.push(
        mapSyntheticNodeItem(null, context.pendingNodeOptions, source, statementIndex, itemIndex, {
          implicitFlags: context.syntheticNodeImplicitFlags
        })
      );
      itemIndex += 1;
      context.syntheticNodeEmitted = true;
      context.pendingNodeOptions = [];
    }
  }

  if (context.pendingNodeOptions.length > 0) {
    for (const optionNode of context.pendingNodeOptions) {
      items.push(mapPathOptionItem(optionNode, source, statementIndex, itemIndex));
      itemIndex += 1;
    }
  }

  const normalizedItems = normalizeChildOperationItems(items);
  const finalizedItems = command === "node" ? withInferredStandaloneNodeName(normalizedItems) : normalizedItems;

  return {
    kind: "Path",
    id: pathStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    command,
    options: findStatementOptions(finalizedItems),
    items: finalizedItems
  };
}

function withInferredStandaloneNodeName(items: PathItem[]): PathItem[] {
  const nodeIndex = items.findIndex((item) => item.kind === "Node");
  if (nodeIndex < 0) {
    return items;
  }

  const node = items[nodeIndex];
  if (node.kind !== "Node" || node.name) {
    return items;
  }

  const inferredName = inferStandaloneNodeName(items, nodeIndex);
  if (!inferredName) {
    return items;
  }

  const next = [...items];
  next[nodeIndex] = { ...node, name: inferredName };
  return next;
}

function inferStandaloneNodeName(items: PathItem[], limit: number): string | undefined {
  let awaitingAtCoordinate = false;

  for (let index = 0; index < limit; index += 1) {
    const item = items[index];

    if (item.kind === "PathKeyword" && item.keyword === "at") {
      awaitingAtCoordinate = true;
      continue;
    }

    if (item.kind === "Coordinate") {
      if (!awaitingAtCoordinate && item.form === "named" && item.y.trim().length === 0) {
        return item.x.trim();
      }
      awaitingAtCoordinate = false;
      continue;
    }

    if (item.kind !== "PathComment") {
      awaitingAtCoordinate = false;
    }
  }

  return undefined;
}

function normalizeChildOperationItems(items: PathItem[]): PathItem[] {
  const normalized: PathItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== "ChildOperation") {
      normalized.push(item);
      continue;
    }

    let nextIndex = index + 1;
    let normalizedChild = item;

    const bodyCandidate = items.at(nextIndex);
    if (
      bodyCandidate?.kind === "UnknownPathItem" &&
      normalizedChild.body.length === 0 &&
      isLikelyGroupFragment(bodyCandidate.raw)
    ) {
      const parsedBody = parsePathItemsFromFragment(bodyCandidate.raw);
      normalizedChild = {
        ...normalizedChild,
        raw: `${normalizedChild.raw} ${bodyCandidate.raw}`.trim(),
        templateRaw: withChildTemplateBody(normalizedChild, bodyCandidate.raw),
        bodySpan: bodyCandidate.span,
        bodyRaw: bodyCandidate.raw,
        body: parsedBody.value
      };
      nextIndex += 1;
    }

    const foreachCandidate = items.at(nextIndex);
    if (foreachCandidate?.kind === "PathForeach" && normalizedChild.body.length === 0) {
      const clause: ChildForeachClause = {
        kind: "ChildForeachClause",
        id: `${normalizedChild.id}:foreach:0`,
        span: foreachCandidate.span,
        raw: foreachCandidate.raw,
        headerRaw: foreachCandidate.headerRaw,
        variablesRaw: foreachCandidate.variablesRaw,
        listRaw: foreachCandidate.listRaw,
        optionsSpan: foreachCandidate.optionsSpan,
        options: foreachCandidate.options
      };
      const parsedBody = parsePathItemsFromFragment(foreachCandidate.bodyRaw);
      normalizedChild = {
        ...normalizedChild,
        raw: `${normalizedChild.raw} ${foreachCandidate.raw}`.trim(),
        templateRaw: withChildTemplateBody(normalizedChild, foreachCandidate.bodyRaw),
        foreachClauses: [clause],
        bodySpan: {
          from: foreachCandidate.span.from,
          to: foreachCandidate.span.to
        },
        bodyRaw: foreachCandidate.bodyRaw,
        body: parsedBody.value
      };
      nextIndex += 1;
    }

    normalized.push(normalizedChild);
    index = nextIndex - 1;
  }
  return normalized;
}

function withChildTemplateBody(item: Extract<PathItem, { kind: "ChildOperation" }>, bodyRaw: string): string {
  const prefix = [];
  if (item.options) {
    prefix.push(item.options.raw);
  }
  return [...prefix, bodyRaw].join(" ").trim();
}

function isLikelyGroupFragment(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

function mapPathItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number,
  context: PathItemContext
): PathItem | null {
  const actual = unwrapPathItemNode(node);

  if (actual.type.name === "Coordinate") {
    return mapCoordinateItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "RelativeCoordinate") {
    return mapRelativeCoordinateItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "ToOperation") {
    return mapToOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "EdgeOperation") {
    return mapEdgeOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "ChildOperation") {
    return mapChildOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "EdgeFromParentOperation") {
    return mapEdgeFromParentOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "PathForeachOperation") {
    return mapPathForeachOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "SvgOperation") {
    return mapSvgOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "LetOperation") {
    return mapLetOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "CoordinateOperation") {
    return mapCoordinateOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "DecorateOperation") {
    return mapDecorateOperationNode(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "PicOperation") {
    return mapPicOperationItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "NodeItem") {
    context.syntheticNodeEmitted = true;
    context.pendingNodeOptions = [];
    return mapNodeItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "OptionList") {
    if (context.command === "node" && !context.syntheticNodeEmitted) {
      context.pendingNodeOptions.push(actual);
      return null;
    }

    return mapPathOptionItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "Comment") {
    return mapPathCommentItem(actual, source, statementIndex, itemIndex);
  }

  if (actual.type.name === "Group" && context.command === "node" && !context.syntheticNodeEmitted) {
    const synthetic = mapSyntheticNodeItem(actual, context.pendingNodeOptions, source, statementIndex, itemIndex, {
      implicitFlags: context.syntheticNodeImplicitFlags
    });
    context.syntheticNodeEmitted = true;
    context.pendingNodeOptions = [];
    return synthetic;
  }

  if (actual.type.name === "NodeTextGroup" && context.command === "node" && !context.syntheticNodeEmitted) {
    const synthetic = mapSyntheticNodeItem(actual, context.pendingNodeOptions, source, statementIndex, itemIndex, {
      implicitFlags: context.syntheticNodeImplicitFlags
    });
    context.syntheticNodeEmitted = true;
    context.pendingNodeOptions = [];
    return synthetic;
  }

  const keywordItem = maybeMapPathKeywordItem(actual, source, statementIndex, itemIndex);
  if (keywordItem) {
    return keywordItem;
  }

  return mapUnknownPathItem(actual, source, statementIndex, itemIndex);
}

function normalizePathCommand(commandText: string): PathCommand {
  const normalized = commandText.trim().replace(/^\\/, "").toLowerCase();

  switch (normalized) {
    case "graph":
    case "draw":
    case "path":
    case "fill":
    case "filldraw":
    case "pattern":
    case "clip":
    case "shade":
    case "shadedraw":
    case "useasboundingbox":
    case "node":
    case "matrix":
    case "coordinate":
      return normalized === "matrix" ? "node" : normalized;
    default:
      return "path";
  }
}

function isMatrixCommand(commandText: string): boolean {
  return commandText.trim().replace(/^\\/, "").toLowerCase() === "matrix";
}

function isDirectPathItemNode(name: string): boolean {
  return (
    name === "Coordinate" ||
    name === "RelativeCoordinate" ||
    name === "ToOperation" ||
    name === "EdgeOperation" ||
    name === "ChildOperation" ||
    name === "EdgeFromParentOperation" ||
    name === "PathForeachOperation" ||
    name === "SvgOperation" ||
    name === "LetOperation" ||
    name === "CoordinateOperation" ||
    name === "DecorateOperation" ||
    name === "PicOperation" ||
    name === "Comment" ||
    name === "NodeItem" ||
    name === "UnknownPathItem" ||
    name === "OptionList" ||
    name === "PathOperator" ||
    name === "Group" ||
    name === "NodeTextGroup" ||
    name === "Identifier" ||
    name === "CommandName" ||
    name === "Number"
  );
}

function mapPathCommentItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): PathItem {
  return {
    kind: "PathComment",
    id: pathCommentItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to)
  };
}

function collectPathItemNodes(node: SyntaxNode): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  forEachChild(node, (child) => {
    if (child.type.name === "NodePathStatement") {
      forEachChild(child, (nodeChild) => {
        if (nodeChild.type.name === "NodeCommandItem") {
          nodes.push(firstNamedChild(nodeChild) ?? nodeChild);
          return;
        }
        if (isDirectPathItemNode(nodeChild.type.name)) {
          nodes.push(nodeChild);
        }
      });
      return;
    }
    if (child.type.name === "PathItem") {
      nodes.push(firstNamedChild(child) ?? child);
      return;
    }
    if (isDirectPathItemNode(child.type.name)) {
      nodes.push(child);
    }
  });
  return nodes;
}

function tryMapGraphOperation(
  nodes: SyntaxNode[],
  startIndex: number,
  source: string,
  statementIndex: number,
  itemIndex: number,
  context: PathItemContext
): { item: PathItem; consumed: number } | null {
  const firstNode = unwrapPathItemNode(nodes[startIndex]);
  const firstRaw = source.slice(firstNode.from, firstNode.to).trim().toLowerCase();

  // `\graph [..] { ... };` command form where the keyword is encoded in PathCommand.
  if (context.command === "graph" && !context.graphCommandConsumed) {
    let consumeCount = 0;
    let optionsNode: SyntaxNode | null = null;
    let specNode: SyntaxNode | null = null;

    if (firstNode.type.name === "OptionList") {
      optionsNode = firstNode;
      consumeCount += 1;
      const maybeSpecNode = nodes[startIndex + consumeCount] ? unwrapPathItemNode(nodes[startIndex + consumeCount]) : null;
      if (maybeSpecNode && isGraphSpecNode(maybeSpecNode, source)) {
        specNode = maybeSpecNode;
        consumeCount += 1;
      }
    } else if (isGraphSpecNode(firstNode, source)) {
      specNode = firstNode;
      consumeCount += 1;
    }

    if (!specNode) {
      return null;
    }

    context.graphCommandConsumed = true;
    const from = optionsNode?.from ?? specNode.from;
    const to = specNode.to;
    return {
      item: {
        kind: "GraphOperation",
        id: graphOperationItemId(statementIndex, itemIndex),
        span: { from, to },
        raw: source.slice(from, to),
        optionsSpan: toSpan(optionsNode),
        options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
        specSpan: { from: specNode.from, to: specNode.to },
        specRaw: source.slice(specNode.from, specNode.to),
        spec: parseGraphSpec(source.slice(specNode.from, specNode.to), specNode.from)
      },
      consumed: consumeCount
    };
  }

  // `\path graph [..] { ... };` operation form where `graph` appears as a path item token.
  if (firstRaw !== "graph") {
    return null;
  }

  let consumeCount = 1;
  let optionsNode: SyntaxNode | null = null;
  const maybeOptionsNode = nodes.at(startIndex + consumeCount);
  if (maybeOptionsNode) {
    const unwrapped = unwrapPathItemNode(maybeOptionsNode);
    if (unwrapped.type.name === "OptionList") {
      optionsNode = unwrapped;
      consumeCount += 1;
    }
  }

  const specNodeCandidate = nodes.at(startIndex + consumeCount);
  const specNode = specNodeCandidate ? unwrapPathItemNode(specNodeCandidate) : null;
  if (!specNode || !isGraphSpecNode(specNode, source)) {
    return null;
  }

  consumeCount += 1;
  const from = firstNode.from;
  const to = specNode.to;
  return {
    item: {
      kind: "GraphOperation",
      id: graphOperationItemId(statementIndex, itemIndex),
      span: { from, to },
      raw: source.slice(from, to),
      optionsSpan: toSpan(optionsNode),
      options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
      specSpan: { from: specNode.from, to: specNode.to },
      specRaw: source.slice(specNode.from, specNode.to),
      spec: parseGraphSpec(source.slice(specNode.from, specNode.to), specNode.from)
    },
    consumed: consumeCount
  };
}

function tryMapDecorateOperation(
  nodes: SyntaxNode[],
  startIndex: number,
  source: string,
  statementIndex: number,
  itemIndex: number
): { item: PathItem; consumed: number } | null {
  const keywordNode = unwrapPathItemNode(nodes[startIndex]);
  if (!isDecorateKeywordNode(keywordNode, source)) {
    return null;
  }

  let consumeCount = 1;
  let optionsNode: SyntaxNode | null = null;
  const nextNode = nodes.at(startIndex + consumeCount);
  if (nextNode) {
    const unwrapped = unwrapPathItemNode(nextNode);
    if (unwrapped.type.name === "OptionList") {
      optionsNode = unwrapped;
      consumeCount += 1;
    }
  }

  const subpathCandidate = nodes.at(startIndex + consumeCount);
  if (!subpathCandidate) {
    return null;
  }
  const subpathNode = unwrapPathItemNode(subpathCandidate);
  if (!isDecorationSubpathNode(subpathNode, source)) {
    return null;
  }

  return {
    item: mapDecorateOperationItem(keywordNode, optionsNode, subpathNode, source, statementIndex, itemIndex),
    consumed: consumeCount + 1
  };
}

function tryMapPlotOperation(
  nodes: SyntaxNode[],
  startIndex: number,
  source: string,
  statementIndex: number,
  itemIndex: number
): { item: PathItem; consumed: number } | null {
  const keywordNode = unwrapPathItemNode(nodes[startIndex]);
  if (!isPlotKeywordNode(keywordNode, source)) {
    return null;
  }

  let consumeCount = 1;
  let optionsNode: SyntaxNode | null = null;
  const maybeOptionsNode = nodes.at(startIndex + consumeCount);
  if (maybeOptionsNode) {
    const unwrapped = unwrapPathItemNode(maybeOptionsNode);
    if (unwrapped.type.name === "OptionList") {
      optionsNode = unwrapped;
      consumeCount += 1;
    }
  }

  let mode: "coordinates" | "expression" | "function" | "file" | "unknown" = "unknown";
  let dataNode: SyntaxNode | null = null;
  const payloadCandidate = nodes.at(startIndex + consumeCount);
  const payloadNode = payloadCandidate ? unwrapPathItemNode(payloadCandidate) : null;

  if (payloadNode) {
    const payloadRaw = source.slice(payloadNode.from, payloadNode.to).trim().toLowerCase();

    if (payloadRaw === "coordinates") {
      const maybeDataCandidate = nodes.at(startIndex + consumeCount + 1);
      const maybeDataNode = maybeDataCandidate ? unwrapPathItemNode(maybeDataCandidate) : null;
      if (maybeDataNode && isPlotDataGroupNode(maybeDataNode, source)) {
        mode = "coordinates";
        dataNode = maybeDataNode;
        consumeCount += 2;
      } else {
        mode = "unknown";
        consumeCount += 1;
      }
    } else if (payloadNode.type.name === "Coordinate") {
      mode = "expression";
      dataNode = payloadNode;
      consumeCount += 1;
    } else if (payloadRaw === "function" || payloadRaw === "file") {
      mode = payloadRaw;
      const maybeDataCandidate = nodes.at(startIndex + consumeCount + 1);
      const maybeDataNode = maybeDataCandidate ? unwrapPathItemNode(maybeDataCandidate) : null;
      if (maybeDataNode && isPlotDataGroupNode(maybeDataNode, source)) {
        dataNode = maybeDataNode;
        consumeCount += 2;
      } else {
        consumeCount += 1;
      }
    }
  }

  const from = keywordNode.from;
  const to = dataNode?.to ?? optionsNode?.to ?? payloadNode?.to ?? keywordNode.to;
  return {
    item: {
      kind: "PlotOperation",
      id: plotOperationItemId(statementIndex, itemIndex),
      span: { from, to },
      raw: source.slice(from, to),
      optionsSpan: toSpan(optionsNode),
      options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
      mode,
      dataSpan: toSpan(dataNode),
      dataRaw: dataNode ? source.slice(dataNode.from, dataNode.to) : undefined
    },
    consumed: consumeCount
  };
}

function isDecorateKeywordNode(node: SyntaxNode, source: string): boolean {
  const raw = source.slice(node.from, node.to).trim().toLowerCase();
  return raw === "decorate";
}

function isPlotKeywordNode(node: SyntaxNode, source: string): boolean {
  const raw = source.slice(node.from, node.to).trim().toLowerCase();
  return raw === "plot";
}

function isGraphSpecNode(node: SyntaxNode, source: string): boolean {
  if (node.type.name === "Group") {
    return true;
  }
  const raw = source.slice(node.from, node.to).trim();
  return raw.startsWith("{") && raw.endsWith("}");
}

function isPlotDataGroupNode(node: SyntaxNode, source: string): boolean {
  if (node.type.name === "Group") {
    return true;
  }
  const raw = source.slice(node.from, node.to).trim();
  return raw.startsWith("{") && raw.endsWith("}");
}

function isDecorationSubpathNode(node: SyntaxNode, source: string): boolean {
  const raw = source.slice(node.from, node.to).trim();
  return raw.startsWith("{") && raw.endsWith("}");
}

function unwrapPathItemNode(node: SyntaxNode): SyntaxNode {
  if (node.type.name === "UnknownPathItem") {
    return firstNamedChild(node) ?? node;
  }
  return node;
}

function toSpan(node: SyntaxNode | null): { from: number; to: number } | undefined {
  if (!node) {
    return undefined;
  }
  return {
    from: node.from,
    to: node.to
  };
}

function findStatementOptions(items: PathItem[]) {
  const leadingOptions: OptionListAst[] = [];
  let seenNonComment = false;

  for (const item of items) {
    if (item.kind === "PathComment") {
      continue;
    }

    if (item.kind !== "PathOption") {
      return leadingOptions.length > 0 ? mergeOptionLists(leadingOptions) : undefined;
    }

    seenNonComment = true;
    leadingOptions.push(item.options);
  }

  if (!seenNonComment) {
    return;
  }
  return leadingOptions.length > 0 ? mergeOptionLists(leadingOptions) : undefined;
}

function mergeOptionLists(optionLists: OptionListAst[]): OptionListAst {
  if (optionLists.length === 1) {
    return optionLists[0];
  }

  const first = optionLists[0];
  const last = optionLists[optionLists.length - 1];
  return {
    span: {
      from: first.span.from,
      to: last.span.to
    },
    raw: `[${optionLists.map((entry) => stripOptionListBrackets(entry.raw)).join(",")}]`,
    entries: optionLists.flatMap((entry) => entry.entries)
  };
}

function stripOptionListBrackets(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]") && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function pendingNodeOptionsContainNodeContents(optionNodes: SyntaxNode[], source: string): boolean {
  return optionNodes.some((node) => /\bnode\s+contents\s*=/.test(source.slice(node.from, node.to).toLowerCase()));
}
