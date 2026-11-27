import type { SyntaxNode } from "@lezer/common";

import { unknownPathItemId, unknownStatementId } from "../ast/ids.js";
import type { UnknownEnvironmentInfo, UnknownPathItem, UnknownStatement } from "../ast/types.js";

export function mapUnknownPathItem(
  node: SyntaxNode,
  source: string,
  statementIndex: number,
  itemIndex: number
): UnknownPathItem {
  return {
    kind: "UnknownPathItem",
    id: unknownPathItemId(statementIndex, itemIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to)
  };
}

export function mapUnknownStatement(node: SyntaxNode, source: string, statementIndex: number): UnknownStatement {
  return {
    kind: "UnknownStatement",
    id: unknownStatementId(statementIndex),
    span: { from: node.from, to: node.to },
    raw: source.slice(node.from, node.to)
  };
}

const ENVIRONMENT_BEGIN = /^\\begin[ \t\r\n]*\{([^{}\\%\r\n]+)\}/u;

/**
 * An `UnknownEnvironmentStatement`: an environment without a rule of its own,
 * skipped as one unit (see the grammar's environment fallback).
 */
export function mapUnknownEnvironmentStatement(node: SyntaxNode, source: string, statementIndex: number): UnknownStatement {
  const statement = mapUnknownStatement(node, source, statementIndex);
  const environment = readUnknownEnvironment(statement.raw, node.from, node.firstChild?.type.name !== "UnterminatedUnknownEnvironment");
  return environment ? { ...statement, environment } : statement;
}

function readUnknownEnvironment(raw: string, from: number, terminated: boolean): UnknownEnvironmentInfo | null {
  const begin = ENVIRONMENT_BEGIN.exec(raw);
  const name = begin?.[1];
  if (!begin || name === undefined) {
    return null;
  }
  const beginSpan = { from, to: from + begin[0].length };
  const end = terminated ? new RegExp(`\\\\end[ \\t\\r\\n]*\\{${escapeRegExp(name)}\\}$`, "u").exec(raw) : null;
  const endSpan = end ? { from: from + end.index, to: from + raw.length } : undefined;
  return {
    name,
    beginSpan,
    bodySpan: { from: beginSpan.to, to: endSpan?.from ?? from + raw.length },
    ...(endSpan ? { endSpan } : {}),
    terminated: endSpan !== undefined
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
