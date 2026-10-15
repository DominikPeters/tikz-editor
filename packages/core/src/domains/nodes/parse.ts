import type { SyntaxNode } from "@lezer/common";

import { nodeForeachClauseId, nodeItemId } from "../../ast/ids.js";
import type { NodeForeachClause, NodeItem, RelativeCoordinatePrefix, Span } from "../../ast/types.js";
import { parseForeachHeaderRaw, stripForeachCommandPrefix } from "../../foreach/header.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";
import { findFirstChildByName, firstNamedChild, forEachChild } from "../../syntax/cursor.js";
import { stripWrappingBraces } from "../../utils/braces.js";

export function mapNodeItem(node: SyntaxNode, source: string, statementIndex: number, itemIndex: number): NodeItem {
  const raw = source.slice(node.from, node.to);
  const foreachClauses = mapNodeForeachClauses(node, source, statementIndex, itemIndex);
  const templateRaw = buildNodeTemplateRaw(node, source, foreachClauses);
  const groupNode = findFirstChildByName(node, "NodeTextGroup") ?? findFirstChildByName(node, "Group");
  const options = mergeNodeOptionLists(findNodeOptionLists(node), source);
  const placement = extractPlacementFromNode(node, source) ?? extractPlacementFromOptions(options.options);
  const mappedText = mapNodeText(groupNode, source, node.to, options.options);
  const explicitName = extractExplicitNodeName(node, source);
  const optionName = extractNodeNameFromOptions(options.options);
  const name = explicitName ?? optionName;
  const aliases = extractNodeAliasesFromOptions(options.options);

  return {
    kind: "Node",
    id: nodeItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    raw,
    templateRaw,
    ...(name !== undefined ? { name } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(options.span !== undefined ? { optionsSpan: options.span } : {}),
    ...(options.options !== undefined ? { options: options.options } : {}),
    ...(foreachClauses.length > 0 ? { foreachClauses } : {}),
    ...(placement?.span !== undefined ? { atSpan: placement.span } : {}),
    ...(placement?.raw !== undefined ? { atRaw: placement.raw } : {}),
    ...(placement?.relativePrefix !== undefined ? { atRelativePrefix: placement.relativePrefix } : {}),
    textSource: mappedText.textSource,
    textSpan: mappedText.textSpan,
    text: mappedText.text
  };
}

export function mapSyntheticNodeItem(
  groupNode: SyntaxNode | null,
  optionsNodes: SyntaxNode[],
  source: string,
  statementIndex: number,
  itemIndex: number,
  opts: { implicitFlags?: string[] } = {}
): NodeItem {
  const options = mergeNodeOptionLists(optionsNodes, source, opts.implicitFlags ?? []);
  const placement = extractPlacementFromOptions(options.options);
  const fallbackOffset = groupNode ? groupNode.to : options.span?.to ?? 0;
  const mappedText = mapNodeText(groupNode, source, fallbackOffset, options.options);
  const optionName = extractNodeNameFromOptions(options.options);
  const aliases = extractNodeAliasesFromOptions(options.options);
  const spanFromCandidates = [groupNode?.from, options.span?.from].filter((value): value is number => value != null);
  const spanToCandidates = [groupNode?.to, options.span?.to].filter((value): value is number => value != null);
  const spanFrom = spanFromCandidates.length > 0 ? Math.min(...spanFromCandidates) : fallbackOffset;
  const spanTo = spanToCandidates.length > 0 ? Math.max(...spanToCandidates) : fallbackOffset;

  return {
    kind: "Node",
    id: nodeItemId(statementIndex, itemIndex),
    span: { from: spanFrom, to: spanTo },
    raw: source.slice(spanFrom, spanTo),
    templateRaw: source.slice(spanFrom, spanTo),
    ...(optionName !== undefined ? { name: optionName } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(options.span !== undefined ? { optionsSpan: options.span } : {}),
    ...(options.options !== undefined ? { options: options.options } : {}),
    ...(placement?.span !== undefined ? { atSpan: placement.span } : {}),
    ...(placement?.raw !== undefined ? { atRaw: placement.raw } : {}),
    ...(placement?.relativePrefix !== undefined ? { atRelativePrefix: placement.relativePrefix } : {}),
    textSource: mappedText.textSource,
    textSpan: mappedText.textSpan,
    text: mappedText.text
  };
}

export function mapGroupText(
  groupNode: SyntaxNode | null,
  source: string,
  fallbackOffset: number
): { textSpan: Span; text: string } {
  if (!groupNode) {
    return {
      textSpan: { from: fallbackOffset, to: fallbackOffset },
      text: ""
    };
  }

  const hasOpenBrace = source[groupNode.from] === "{";
  const hasCloseBrace = source[groupNode.to - 1] === "}";

  const innerFrom = hasOpenBrace ? groupNode.from + 1 : groupNode.from;
  const innerTo = hasCloseBrace
    ? groupNode.to - 1
    : trimRecoveredNodeTextGroupEnd(source, innerFrom, groupNode.to);

  const textSpan = {
    from: innerFrom,
    to: Math.max(innerFrom, innerTo)
  };

  return {
    textSpan,
    text: source.slice(textSpan.from, textSpan.to)
  };
}

function trimRecoveredNodeTextGroupEnd(source: string, innerFrom: number, innerTo: number): number {
  const raw = source.slice(innerFrom, innerTo);
  const semicolonIndex = raw.lastIndexOf(";");
  if (semicolonIndex >= 0) {
    const structuralCloseBraceIndex = semicolonIndex - 1;
    if (
      raw[structuralCloseBraceIndex] === "}" &&
      hasOpenTextGroupBeforeFinalClose(raw.slice(0, structuralCloseBraceIndex))
    ) {
      return innerFrom + structuralCloseBraceIndex;
    }
    return innerFrom + semicolonIndex;
  }
  return innerTo;
}

function hasOpenTextGroupBeforeFinalClose(text: string): boolean {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\" && index + 1 < text.length) {
      index += 1;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  return depth > 0;
}

function mapNodeText(
  groupNode: SyntaxNode | null,
  source: string,
  fallbackOffset: number,
  options: OptionListAst | undefined
): { textSpan: Span; text: string; textSource: NodeItem["textSource"] } {
  if (groupNode) {
    const mapped = mapGroupText(groupNode, source, fallbackOffset);
    return { ...mapped, textSource: "group" };
  }

  const fromOptions = extractNodeContentsFromOptions(options);
  if (fromOptions) {
    return {
      textSpan: fromOptions.span,
      text: fromOptions.text,
      textSource: "option"
    };
  }

  return {
    textSpan: { from: fallbackOffset, to: fallbackOffset },
    text: "",
    textSource: "option"
  };
}

function mapNodeForeachClauses(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): NodeForeachClause[] {
  const clauses: NodeForeachClause[] = [];
  let clauseIndex = 0;

  forEachChild(node, (child) => {
    if (child.type.name !== "NodeForeachClause") {
      return;
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
      kind: "NodeForeachClause",
      id: nodeForeachClauseId(statementIndex, itemIndex, clauseIndex),
      span: { from: child.from, to: child.to },
      raw,
      headerRaw: parsed.headerRaw,
      variablesRaw: parsed.variablesRaw,
      listRaw: parsed.listRaw,
      ...(options !== undefined ? { options } : {}),
      ...(optionsSpan !== undefined ? { optionsSpan } : {})
    });
    clauseIndex += 1;
  });

  return clauses;
}

function buildNodeTemplateRaw(node: SyntaxNode, source: string, clauses: NodeForeachClause[]): string {
  if (clauses.length === 0) {
    return source.slice(node.from, node.to);
  }

  const nodeKeywordNode = findFirstChildByName(node, "NodeKw");
  const prefixTo = nodeKeywordNode?.to ?? node.from;
  const clauseEnd = clauses.reduce((max, clause) => Math.max(max, clause.span.to), prefixTo);
  const prefix = source.slice(node.from, prefixTo);
  const suffix = source.slice(clauseEnd, node.to);
  return `${prefix}${suffix}`;
}

function findNodeOptionLists(node: SyntaxNode): SyntaxNode[] {
  const lists: SyntaxNode[] = [];

  const direct = findFirstChildByName(node, "OptionList");
  if (direct) {
    lists.push(direct);
  }

  forEachChild(node, (child) => {
    if (child.type.name !== "NodeQualifier") {
      return;
    }
    const actual = firstNamedChild(child);
    if (actual?.type.name === "OptionList") {
      lists.push(actual);
    }
  });

  return dedupeNodesBySpan(lists);
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

function mergeNodeOptionLists(
  optionNodes: SyntaxNode[],
  source: string,
  implicitFlags: string[] = []
): {
  span?: Span;
  options?: OptionListAst;
} {
  const first = optionNodes[0];
  const last = optionNodes.at(-1);
  if (!first || !last) {
    return appendImplicitFlags({}, implicitFlags);
  }

  const parsed = optionNodes.map((node) => parseOptionListRaw(source.slice(node.from, node.to), node.from));
  const onlyOptions = parsed[0];
  if (parsed.length === 1 && onlyOptions) {
    return appendImplicitFlags(
      {
        span: { from: first.from, to: first.to },
        options: onlyOptions
      },
      implicitFlags
    );
  }

  return appendImplicitFlags(
    {
      span: { from: first.from, to: last.to },
      options: {
        span: { from: first.from, to: last.to },
        raw: optionNodes.map((node) => source.slice(node.from, node.to)).join(" "),
        entries: parsed.flatMap((list) => list.entries)
      }
    },
    implicitFlags
  );
}

function appendImplicitFlags(
  merged: {
    span?: Span;
    options?: OptionListAst;
  },
  implicitFlags: string[]
): {
  span?: Span;
  options?: OptionListAst;
} {
  if (implicitFlags.length === 0) {
    return merged;
  }

  const existing = new Set(
    (merged.options?.entries ?? [])
      .filter((entry): entry is Extract<OptionListAst["entries"][number], { kind: "flag" }> => entry.kind === "flag")
      .map((entry) => entry.key)
  );
  const flagsToAdd = implicitFlags.filter((flag) => !existing.has(flag));
  if (flagsToAdd.length === 0) {
    return merged;
  }

  const anchor = merged.options?.span.from ?? merged.span?.from ?? 0;
  const flagEntries = flagsToAdd.map((flag) => ({
    kind: "flag" as const,
    key: flag,
    span: { from: anchor, to: anchor + flag.length },
    raw: flag
  }));

  if (!merged.options) {
    const span = merged.span ?? { from: anchor, to: anchor + 1 };
    return {
      span,
      options: {
        span,
        raw: `[${flagsToAdd.join(", ")}]`,
        entries: flagEntries
      }
    };
  }

  return {
    ...(merged.span !== undefined ? { span: merged.span } : {}),
    options: {
      span: merged.options.span,
      raw: `${merged.options.raw}, ${flagsToAdd.join(", ")}`,
      entries: [...merged.options.entries, ...flagEntries]
    }
  };
}

function extractExplicitNodeName(node: SyntaxNode, source: string): string | undefined {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "NodeQualifier") {
      continue;
    }

    const actual = firstNamedChild(child);
    if (actual?.type.name !== "NodeName") {
      continue;
    }

    const coordinate = findFirstChildByName(actual, "Coordinate");
    if (!coordinate) {
      continue;
    }

    const trimmed = trimCoordinateShell(source.slice(coordinate.from, coordinate.to));
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

function extractNodeNameFromOptions(options: OptionListAst | undefined): string | undefined {
  if (!options) {
    return undefined;
  }

  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "name") {
      continue;
    }
    const parsed = normalizeNodeName(entry.valueRaw);
    if (parsed) {
      return parsed;
    }
  }

  return undefined;
}

function extractNodeAliasesFromOptions(options: OptionListAst | undefined): string[] {
  if (!options) {
    return [];
  }

  const aliases: string[] = [];
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "alias") {
      continue;
    }
    const parsed = normalizeNodeName(entry.valueRaw);
    if (parsed) {
      aliases.push(parsed);
    }
  }

  return aliases;
}

function extractNodeContentsFromOptions(options: OptionListAst | undefined): { text: string; span: Span } | undefined {
  if (!options) {
    return undefined;
  }

  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "node contents") {
      continue;
    }
    return {
      text: stripWrappingBraces(entry.valueRaw),
      span: entry.span
    };
  }

  return undefined;
}

function extractPlacementFromNode(
  node: SyntaxNode,
  source: string
): { span: Span; raw: string; relativePrefix?: RelativeCoordinatePrefix } | undefined {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.name !== "NodeQualifier") {
      continue;
    }

    const actual = firstNamedChild(child);
    if (actual?.type.name !== "NodePlacement") {
      continue;
    }

    const coordinateLike = findFirstChildByName(actual, "CoordinateLike");
    if (!coordinateLike) {
      continue;
    }

    const relative = findFirstChildByName(coordinateLike, "RelativeCoordinate");
    if (relative) {
      const prefixRaw = source.slice(relative.from, findFirstChildByName(relative, "Coordinate")?.from ?? relative.from).trim();
      const coordinate = findFirstChildByName(relative, "Coordinate");
      if (!coordinate) {
        continue;
      }
      const prefix: RelativeCoordinatePrefix | undefined = prefixRaw.startsWith("++")
        ? "++"
        : prefixRaw.startsWith("+")
          ? "+"
          : undefined;
      return {
        span: { from: coordinate.from, to: coordinate.to },
        raw: source.slice(coordinate.from, coordinate.to),
        ...(prefix !== undefined ? { relativePrefix: prefix } : {})
      };
    }

    const coordinate = findFirstChildByName(coordinateLike, "Coordinate");
    if (!coordinate) {
      continue;
    }

    return {
      span: { from: coordinate.from, to: coordinate.to },
      raw: source.slice(coordinate.from, coordinate.to)
    };
  }

  return undefined;
}

function extractPlacementFromOptions(
  options: OptionListAst | undefined
): { span: Span; raw: string; relativePrefix?: RelativeCoordinatePrefix } | undefined {
  if (!options) {
    return undefined;
  }

  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "at") {
      continue;
    }

    let value = stripWrappingBraces(entry.valueRaw).trim();
    let relativePrefix: RelativeCoordinatePrefix | undefined;
    if (value.startsWith("++")) {
      relativePrefix = "++";
      value = value.slice(2).trim();
    } else if (value.startsWith("+")) {
      relativePrefix = "+";
      value = value.slice(1).trim();
    }

    if (!value.startsWith("(") || !value.endsWith(")")) {
      continue;
    }

    return {
      span: entry.span,
      raw: value,
      ...(relativePrefix !== undefined ? { relativePrefix } : {})
    };
  }

  return undefined;
}

function normalizeNodeName(valueRaw: string): string | undefined {
  const unwrapped = stripWrappingBraces(valueRaw).trim();
  if (unwrapped.length === 0) {
    return undefined;
  }
  return trimCoordinateShell(unwrapped) || undefined;
}

function trimCoordinateShell(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}
