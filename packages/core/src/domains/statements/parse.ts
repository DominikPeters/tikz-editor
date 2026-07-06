import type { SyntaxNode } from "@lezer/common";

import {
  colorletStatementId,
  defineColorStatementId,
  foreachStatementId,
  macroAliasStatementId,
  macroCommandDefinitionStatementId,
  macroDefinitionStatementId,
  pgfMathStatementId,
  pgfkeysStatementId,
  scopeStatementId,
  tikzLibraryStatementId,
  tikzSetStatementId,
  tikzStyleStatementId
} from "../../ast/ids.js";
import type {
  ColorletStatement,
  DefineColorStatement,
  ForeachStatement,
  MacroAliasStatement,
  MacroCommandDefinitionStatement,
  MacroDefinitionStatement,
  PgfMathStatement,
  PgfkeysStatement,
  ScopeStatement,
  Span,
  Statement,
  TikzLibraryStatement,
  TikzSetStatement,
  TikzStyleStatement
} from "../../ast/types.js";
import { mapPathStatement } from "../paths/parse.js";
import { mapUnknownStatement } from "../../transform/unknown.js";
import { parseOptionListRaw } from "../../options/parse.js";
import { parseForeachHeaderRaw } from "../../foreach/header.js";
import { parseStyleValueAsOptionList } from "../../semantic/style/option-utils.js";
import { findFirstChildByName, findFirstNodeByName, firstNamedChild, forEachChild } from "../../syntax/cursor.js";

export type StatementMappingState = {
  nextStatementIndex: number;
};

export function mapBodyStatements(node: SyntaxNode, source: string, state: StatementMappingState): Statement[] {
  const statements: Statement[] = [];

  forEachChild(node, (child) => {
    const maybeStatement = unwrapStatementLikeNode(child);

    const mapped = mapStatementNode(maybeStatement, source, state);
    if (mapped) {
      statements.push(mapped);
    }
  });

  return statements;
}

export function unwrapStatementLikeNode(node: SyntaxNode): SyntaxNode {
  const actualBodyItem = node.type.name === "BodyItem" ? (firstNamedChild(node) ?? node) : node;
  return actualBodyItem.type.name === "Statement" ? (firstNamedChild(actualBodyItem) ?? actualBodyItem) : actualBodyItem;
}

export function mapStatementNode(node: SyntaxNode, source: string, state: StatementMappingState): Statement | null {
  if (node.type.name === "PathStatement") {
    return mapPathStatement(node, source, allocateStatementIndex(state));
  }

  if (node.type.name === "UnknownStatement") {
    return mapUnknownStatement(node, source, allocateStatementIndex(state));
  }

  if (node.type.name === "StyleDefinitionStatement") {
    return mapStyleDefinitionStatement(node, source, state);
  }

  if (node.type.name === "ColorletStatement") {
    return mapColorletStatement(node, source, state);
  }

  if (node.type.name === "DefineColorStatement") {
    return mapDefineColorStatement(node, source, state);
  }

  if (node.type.name === "TikzLibraryStatement") {
    return mapTikzLibraryStatement(node, source, state);
  }

  if (node.type.name === "MacroDefinitionStatement") {
    return mapMacroDefinitionStatement(node, source, state);
  }

  if (node.type.name === "MacroAliasStatement") {
    return mapMacroAliasStatement(node, source, state);
  }

  if (node.type.name === "MacroCommandDefinitionStatement") {
    return mapMacroCommandDefinitionStatement(node, source, state);
  }

  if (node.type.name === "PgfMathStatement") {
    return mapPgfMathStatement(node, source, state);
  }

  if (node.type.name === "TikzSetStatement" || node.type.name === "TikzStyleStatement" || node.type.name === "PgfkeysStatement") {
    return mapStyleDefinitionStatement(node, source, state);
  }

  if (node.type.name === "FontSizeStatement") {
    return mapUnknownStatement(node, source, allocateStatementIndex(state));
  }

  if (node.type.name === "ScopeStatement") {
    return mapScopeStatement(node, source, state);
  }

  if (node.type.name === "ForeachStatement") {
    return mapForeachStatement(node, source, state);
  }

  return null;
}

function mapScopeStatement(node: SyntaxNode, source: string, state: StatementMappingState): ScopeStatement {
  const statementIndex = allocateStatementIndex(state);
  const optionsNode = findFirstChildByName(node, "OptionList");

  return {
    kind: "Scope",
    id: scopeStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    options: optionsNode ? parseOptionListRaw(source.slice(optionsNode.from, optionsNode.to), optionsNode.from) : undefined,
    body: mapBodyStatements(node, source, state)
  };
}

function mapForeachStatement(node: SyntaxNode, source: string, state: StatementMappingState): ForeachStatement {
  const statementIndex = allocateStatementIndex(state);
  const foreachCmdNode = findFirstChildByName(node, "ForeachCmd");
  const foreachBodyNode = findFirstChildByName(node, "ForeachBody");

  const prefixFrom = foreachCmdNode ? foreachCmdNode.to : node.from;
  const prefixTo = foreachBodyNode ? foreachBodyNode.from : node.to;
  const prefixSlice = source.slice(prefixFrom, Math.max(prefixFrom, prefixTo));
  const parsedHeader = parseForeachHeaderRaw(prefixSlice);
  const headerStartOffset = prefixSlice.indexOf(parsedHeader.headerRaw);
  const headerFrom = headerStartOffset >= 0 ? prefixFrom + headerStartOffset : prefixFrom;
  const bodyRaw = foreachBodyNode ? source.slice(foreachBodyNode.from, foreachBodyNode.to) : "";
  const bodySpan = foreachBodyNode ? { from: foreachBodyNode.from, to: foreachBodyNode.to } : undefined;

  const options =
    parsedHeader.optionsRaw && parsedHeader.optionsSpan
      ? parseOptionListRaw(parsedHeader.optionsRaw, headerFrom + parsedHeader.optionsSpan.from)
      : undefined;
  const optionsSpan =
    parsedHeader.optionsSpan != null
      ? {
          from: headerFrom + parsedHeader.optionsSpan.from,
          to: headerFrom + parsedHeader.optionsSpan.to
        }
      : undefined;
  const headerSpan =
    parsedHeader.headerRaw.length > 0
      ? {
          from: headerFrom,
          to: headerFrom + parsedHeader.headerRaw.length
        }
      : undefined;

  return {
    kind: "Foreach",
    id: foreachStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    options,
    optionsSpan,
    headerSpan,
    headerRaw: parsedHeader.headerRaw,
    variablesRaw: parsedHeader.variablesRaw,
    listRaw: parsedHeader.listRaw,
    prefixRaw: parsedHeader.headerRaw,
    bodyRaw,
    bodySpan
  };
}

function mapMacroDefinitionStatement(node: SyntaxNode, source: string, state: StatementMappingState): MacroDefinitionStatement {
  const statementIndex = allocateStatementIndex(state);
  const nameNode = findFirstChildByName(node, "CommandName");
  const valueNode = findFirstChildByName(node, "Group");

  return {
    kind: "MacroDefinition",
    id: macroDefinitionStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw: "\\def",
    nameRaw: nameNode ? source.slice(nameNode.from, nameNode.to) : "",
    nameSpan: toSpan(nameNode),
    valueRaw: valueNode ? extractGroupInnerRaw(valueNode, source) : "",
    valueSpan: valueNode ? toGroupInnerSpan(valueNode, source) : undefined
  };
}

function mapMacroAliasStatement(node: SyntaxNode, source: string, state: StatementMappingState): MacroAliasStatement {
  const statementIndex = allocateStatementIndex(state);
  const nameNode = findFirstChildByName(node, "CommandName");
  const targetNode = findFirstChildByName(node, "LetAliasTarget");
  const targetCommandNode = targetNode ? findFirstChildByName(targetNode, "CommandName") : null;
  const targetGroupNode = targetNode ? findFirstChildByName(targetNode, "Group") : null;

  return {
    kind: "MacroAlias",
    id: macroAliasStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw: "\\let",
    nameRaw: nameNode ? source.slice(nameNode.from, nameNode.to) : "",
    nameSpan: toSpan(nameNode),
    targetRaw: targetCommandNode
      ? source.slice(targetCommandNode.from, targetCommandNode.to)
      : targetGroupNode
        ? extractGroupInnerRaw(targetGroupNode, source)
        : "",
    targetSpan: targetCommandNode
      ? toSpan(targetCommandNode)
      : targetGroupNode
        ? toGroupInnerSpan(targetGroupNode, source)
        : undefined
  };
}

function mapMacroCommandDefinitionStatement(
  node: SyntaxNode,
  source: string,
  state: StatementMappingState
): MacroCommandDefinitionStatement {
  const statementIndex = allocateStatementIndex(state);
  const newCommandNode = findFirstChildByName(node, "NewCommandCmd");
  const renewCommandNode = findFirstChildByName(node, "RenewCommandCmd");
  const provideCommandNode = findFirstChildByName(node, "ProvideCommandCmd");
  const declareRobustCommandNode = findFirstChildByName(node, "DeclareRobustCommandCmd");
  const declareMathOperatorNode = findFirstChildByName(node, "DeclareMathOperatorCmd");
  const commandNode = newCommandNode
    ?? renewCommandNode
    ?? provideCommandNode
    ?? declareRobustCommandNode
    ?? declareMathOperatorNode;
  const commandRaw = resolveMacroCommandRaw({
    declareMathOperatorNode,
    declareRobustCommandNode,
    provideCommandNode,
    renewCommandNode
  });
  const commandNameNode = findFirstChildByName(node, "MacroCommandName");
  const commandNameTokenNode = commandNameNode ? findFirstChildByName(commandNameNode, "CommandName") : null;
  const commandNameGroupNode = commandNameNode ? findFirstChildByName(commandNameNode, "Group") : null;
  const bodyNode = resolveMacroCommandBodyNode(node);
  const arityNode = findFirstNodeByName(node, "MacroCommandArity");
  const arityNumberNode = arityNode ? findFirstChildByName(arityNode, "Number") : null;
  const defaultArgNode = findFirstNodeByName(node, "MacroCommandDefaultArg");

  const parsedNameFromGroup = commandNameGroupNode ? parseCommandNameFromGroup(commandNameGroupNode, source) : null;
  const nameRaw = commandNameTokenNode
    ? source.slice(commandNameTokenNode.from, commandNameTokenNode.to)
    : parsedNameFromGroup?.nameRaw ?? "";
  const nameSpan = commandNameTokenNode ? toSpan(commandNameTokenNode) : parsedNameFromGroup?.nameSpan;

  const arityRaw = arityNumberNode ? source.slice(arityNumberNode.from, arityNumberNode.to) : "";
  const parsedArity = Number.parseInt(arityRaw, 10);
  const arity = Number.isFinite(parsedArity) ? Math.max(0, parsedArity) : 0;

  const starred =
    commandNode != null && commandNameNode != null
      ? source.slice(commandNode.to, commandNameNode.from).includes("*")
      : false;

  return {
    kind: "MacroCommandDefinition",
    id: macroCommandDefinitionStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw,
    nameRaw,
    nameSpan,
    arity,
    aritySpan: toSpan(arityNumberNode),
    optionalDefaultRaw: defaultArgNode ? extractBracketInnerRaw(defaultArgNode, source) : undefined,
    optionalDefaultSpan: defaultArgNode ? toBracketInnerSpan(defaultArgNode, source) : undefined,
    bodyRaw: commandRaw === "\\DeclareMathOperator"
      ? toDeclareMathOperatorBody(bodyNode ? extractGroupInnerRaw(bodyNode, source) : "", starred)
      : bodyNode ? extractGroupInnerRaw(bodyNode, source) : "",
    bodySpan: bodyNode ? toGroupInnerSpan(bodyNode, source) : undefined,
    starred
  };
}

function resolveMacroCommandRaw(nodes: {
  declareMathOperatorNode: SyntaxNode | null;
  declareRobustCommandNode: SyntaxNode | null;
  provideCommandNode: SyntaxNode | null;
  renewCommandNode: SyntaxNode | null;
}): MacroCommandDefinitionStatement["commandRaw"] {
  if (nodes.declareMathOperatorNode) {
    return "\\DeclareMathOperator";
  }
  if (nodes.declareRobustCommandNode) {
    return "\\DeclareRobustCommand";
  }
  if (nodes.provideCommandNode) {
    return "\\providecommand";
  }
  if (nodes.renewCommandNode) {
    return "\\renewcommand";
  }
  return "\\newcommand";
}

function toDeclareMathOperatorBody(operatorNameRaw: string, starred: boolean): string {
  return `${starred ? "\\operatorname*" : "\\operatorname"}{${operatorNameRaw}}`;
}

function mapPgfMathStatement(node: SyntaxNode, source: string, state: StatementMappingState): PgfMathStatement {
  const statementIndex = allocateStatementIndex(state);
  const setMacroNode = findFirstChildByName(node, "PgfMathSetMacroCmd");
  const parseNode = findFirstChildByName(node, "PgfMathParseCmd");
  const commandNode = setMacroNode
    ?? parseNode
    ?? findFirstChildByName(node, "PgfMathSetSeedCmd");
  const groups = findChildrenByName(node, "Group");
  const commandRaw = commandNode
    ? source.slice(commandNode.from, commandNode.to) as PgfMathStatement["commandRaw"]
    : "\\pgfmathparse";

  return {
    kind: "PgfMath",
    id: pgfMathStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw,
    argsRaw: groups.map((group) => extractGroupInnerRaw(group, source)),
    argsSpan: groups.map((group) => toGroupInnerSpan(group, source))
  };
}

function mapStyleDefinitionStatement(node: SyntaxNode, source: string, state: StatementMappingState): Statement | null {
  if (node.type.name === "StyleDefinitionStatement") {
    const actual = firstNamedChild(node);
    if (!actual) {
      return null;
    }
    return mapStyleDefinitionStatement(actual, source, state);
  }

  if (node.type.name === "TikzSetStatement") {
    return mapTikzSetStatement(node, source, state);
  }
  if (node.type.name === "TikzStyleStatement") {
    return mapTikzStyleStatement(node, source, state);
  }
  if (node.type.name === "PgfkeysStatement") {
    return mapPgfkeysStatement(node, source, state);
  }
  return null;
}

function mapTikzSetStatement(node: SyntaxNode, source: string, state: StatementMappingState): TikzSetStatement {
  const statementIndex = allocateStatementIndex(state);
  const payloadNode = findFirstChildByName(node, "StylePayload");
  const payloadRaw = payloadNode ? source.slice(payloadNode.from, payloadNode.to) : "";
  const optionList = parseStyleValueAsOptionList(payloadRaw, payloadNode?.from ?? node.from) ?? parseOptionListRaw("[]", node.from);

  return {
    kind: "TikzSet",
    id: tikzSetStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw: "\\tikzset",
    payloadRaw,
    payloadSpan: toSpan(payloadNode),
    optionList
  };
}

function mapTikzStyleStatement(node: SyntaxNode, source: string, state: StatementMappingState): TikzStyleStatement {
  const statementIndex = allocateStatementIndex(state);
  const cmdNode = findFirstChildByName(node, "TikzStyleCmd");
  const styleNameGroup = findFirstChildByName(node, "Group");
  const styleNameIdentifier = findFirstChildByName(node, "IdentifierLike");
  const styleNameNode = styleNameGroup ?? styleNameIdentifier;
  const styleNameRaw =
    styleNameNode == null
      ? ""
      : styleNameNode.type.name === "Group"
        ? extractGroupInnerRaw(styleNameNode, source)
        : source.slice(styleNameNode.from, styleNameNode.to);

  const payloadNode =
    findFirstChildByName(node, "OptionList") ??
    findFirstChildByName(node, "StylePayload");
  const payloadRaw = payloadNode ? source.slice(payloadNode.from, payloadNode.to) : "";
  const optionList =
    payloadNode?.type.name === "OptionList"
      ? parseOptionListRaw(payloadRaw, payloadNode.from)
      : parseStyleValueAsOptionList(payloadRaw, payloadNode?.from ?? node.from) ?? parseOptionListRaw("[]", node.from);
  const betweenRaw =
    cmdNode && styleNameNode && payloadNode
      ? source.slice(styleNameNode.to, payloadNode.from)
      : "";

  return {
    kind: "TikzStyle",
    id: tikzStyleStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw: "\\tikzstyle",
    styleNameRaw: styleNameRaw.trim(),
    styleNameSpan: styleNameNode?.type.name === "Group" ? toGroupInnerSpan(styleNameNode, source) : toSpan(styleNameNode),
    definitionKind: betweenRaw.includes("+") ? "append" : "style",
    payloadRaw,
    payloadSpan: toSpan(payloadNode),
    optionList
  };
}

function mapPgfkeysStatement(node: SyntaxNode, source: string, state: StatementMappingState): PgfkeysStatement {
  const statementIndex = allocateStatementIndex(state);
  const payloadNode = findFirstChildByName(node, "StylePayload");
  const payloadRaw = payloadNode ? source.slice(payloadNode.from, payloadNode.to) : "";
  const optionList = parseStyleValueAsOptionList(payloadRaw, payloadNode?.from ?? node.from) ?? parseOptionListRaw("[]", node.from);

  return {
    kind: "Pgfkeys",
    id: pgfkeysStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw: "\\pgfkeys",
    payloadRaw,
    payloadSpan: toSpan(payloadNode),
    optionList
  };
}

function mapTikzLibraryStatement(node: SyntaxNode, source: string, state: StatementMappingState): TikzLibraryStatement {
  const statementIndex = allocateStatementIndex(state);
  const groupNode = findFirstChildByName(node, "Group");
  const librariesRaw = groupNode ? extractGroupInnerRaw(groupNode, source) : "";
  const libraries = librariesRaw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return {
    kind: "TikzLibrary",
    id: tikzLibraryStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw: "\\usetikzlibrary",
    librariesRaw,
    librariesSpan: groupNode ? toGroupInnerSpan(groupNode, source) : undefined,
    libraries
  };
}

function mapColorletStatement(node: SyntaxNode, source: string, state: StatementMappingState): ColorletStatement {
  const statementIndex = allocateStatementIndex(state);
  const groups = findChildrenByName(node, "Group");
  const nameGroup = groups.at(0) ?? null;
  const valueGroup = groups.at(1) ?? null;
  return {
    kind: "Colorlet",
    id: colorletStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw: "\\colorlet",
    nameRaw: nameGroup ? extractGroupInnerRaw(nameGroup, source) : "",
    nameSpan: nameGroup ? toGroupInnerSpan(nameGroup, source) : undefined,
    valueRaw: valueGroup ? extractGroupInnerRaw(valueGroup, source) : "",
    valueSpan: valueGroup ? toGroupInnerSpan(valueGroup, source) : undefined
  };
}

function mapDefineColorStatement(node: SyntaxNode, source: string, state: StatementMappingState): DefineColorStatement {
  const statementIndex = allocateStatementIndex(state);
  const groups = findChildrenByName(node, "Group");
  const nameGroup = groups.at(0) ?? null;
  const modelGroup = groups.at(1) ?? null;
  const specificationGroup = groups.at(2) ?? null;

  return {
    kind: "DefineColor",
    id: defineColorStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to),
    commandRaw: "\\definecolor",
    nameRaw: nameGroup ? extractGroupInnerRaw(nameGroup, source) : "",
    nameSpan: nameGroup ? toGroupInnerSpan(nameGroup, source) : undefined,
    modelRaw: modelGroup ? extractGroupInnerRaw(modelGroup, source) : "",
    modelSpan: modelGroup ? toGroupInnerSpan(modelGroup, source) : undefined,
    specificationRaw: specificationGroup ? extractGroupInnerRaw(specificationGroup, source) : "",
    specificationSpan: specificationGroup ? toGroupInnerSpan(specificationGroup, source) : undefined
  };
}

function resolveMacroCommandBodyNode(node: SyntaxNode): SyntaxNode | null {
  const groups: SyntaxNode[] = [];
  forEachChild(node, (child) => {
    if (child.type.name === "Group") {
      groups.push(child);
    }
  });

  if (groups.length === 0) {
    return null;
  }
  return groups[groups.length - 1];
}

function parseCommandNameFromGroup(
  groupNode: SyntaxNode,
  source: string
): { nameRaw: string; nameSpan?: Span } | null {
  const inner = toGroupInnerSpan(groupNode, source);
  const innerRaw = source.slice(inner.from, inner.to);
  const match = /\\[A-Za-z@]+/.exec(innerRaw);
  if (!match) {
    return null;
  }

  const from = inner.from + match.index;
  const to = from + match[0].length;
  return {
    nameRaw: match[0],
    nameSpan: { from, to }
  };
}

function toGroupInnerSpan(node: SyntaxNode, source: string): Span {
  const hasOpen = source[node.from] === "{";
  const hasClose = source[node.to - 1] === "}";
  const from = hasOpen ? node.from + 1 : node.from;
  const to = hasClose ? node.to - 1 : node.to;
  return {
    from,
    to: Math.max(from, to)
  };
}

function extractGroupInnerRaw(node: SyntaxNode, source: string): string {
  const span = toGroupInnerSpan(node, source);
  return source.slice(span.from, span.to);
}

function toBracketInnerSpan(node: SyntaxNode, source: string): Span {
  const hasOpen = source[node.from] === "[";
  const hasClose = source[node.to - 1] === "]";
  const from = hasOpen ? node.from + 1 : node.from;
  const to = hasClose ? node.to - 1 : node.to;
  return {
    from,
    to: Math.max(from, to)
  };
}

function extractBracketInnerRaw(node: SyntaxNode, source: string): string {
  const span = toBracketInnerSpan(node, source);
  return source.slice(span.from, span.to);
}

function toSpan(node: SyntaxNode | null): Span | undefined {
  if (!node) {
    return undefined;
  }
  return { from: node.from, to: node.to };
}

function findChildrenByName(node: SyntaxNode, childName: string): SyntaxNode[] {
  const matches: SyntaxNode[] = [];
  forEachChild(node, (child) => {
    if (child.type.name === childName) {
      matches.push(child);
    }
  });
  return matches;
}

function allocateStatementIndex(state: StatementMappingState): number {
  const statementIndex = state.nextStatementIndex;
  state.nextStatementIndex += 1;
  return statementIndex;
}
