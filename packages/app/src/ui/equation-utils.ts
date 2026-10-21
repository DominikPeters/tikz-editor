import type { Span, Statement } from "@tikz-editor/core/ast/types";
import { parseTikzForEdit, type EditParseOptions } from "@tikz-editor/core/edit/parse-options";

export type EquationDelimiter = "inline-dollar" | "inline-paren" | "display-dollar";

export type EquationNodeTarget = {
  sourceId: string;
  textSpan: Span;
  latex: string;
  delimiter: EquationDelimiter;
};

type NodeTextTarget = {
  sourceId: string;
  textSpan: Span;
  text: string;
};

export function resolveEquationNodeTargetFromSelection(
  source: string,
  selectedElementIds: ReadonlySet<string>,
  parseOptions: EditParseOptions = {}
): EquationNodeTarget | null {
  if (selectedElementIds.size !== 1) {
    return null;
  }
  const sourceId = [...selectedElementIds][0];
  if (!sourceId) {
    return null;
  }
  return resolveEquationNodeTarget(source, sourceId, {
    ...parseOptions,
  });
}

export function resolveEquationNodeTarget(
  source: string,
  sourceId: string,
  parseOptions: EditParseOptions = {}
): EquationNodeTarget | null {
  const resolvedTextTarget = resolveNodeTextTarget(source, sourceId, {
    ...parseOptions,
  });
  if (!resolvedTextTarget) {
    return null;
  }
  const parsed = parseMathOnlyNodeText(resolvedTextTarget.text);
  if (!parsed) {
    return null;
  }
  return {
    sourceId: resolvedTextTarget.sourceId,
    textSpan: resolvedTextTarget.textSpan,
    latex: parsed.latex,
    delimiter: parsed.delimiter
  };
}

export function isMathOnlyNodeText(text: string): boolean {
  return parseMathOnlyNodeText(text) != null;
}

export function parseMathOnlyNodeText(
  text: string
): { latex: string; delimiter: EquationDelimiter } | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length >= 4) {
    return {
      latex: trimmed.slice(2, -2),
      delimiter: "display-dollar"
    };
  }
  if (trimmed.startsWith("\\(") && trimmed.endsWith("\\)") && trimmed.length >= 4) {
    return {
      latex: trimmed.slice(2, -2),
      delimiter: "inline-paren"
    };
  }
  if (trimmed.startsWith("$") && trimmed.endsWith("$") && !trimmed.startsWith("$$") && !trimmed.endsWith("$$") && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1);
    if (hasUnescapedDollar(inner)) {
      return null;
    }
    return {
      latex: inner,
      delimiter: "inline-dollar"
    };
  }
  return null;
}

export function formatEquationText(latex: string, delimiter: EquationDelimiter): string {
  if (delimiter === "display-dollar") {
    return `$$${latex}$$`;
  }
  if (delimiter === "inline-paren") {
    return `\\(${latex}\\)`;
  }
  return `$${latex}$`;
}

function resolveNodeTextTarget(
  source: string,
  sourceId: string,
  parseOptions: EditParseOptions
): NodeTextTarget | null {
  const normalizedId = sourceId.trim();
  if (normalizedId.length === 0) {
    return null;
  }

  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const stack: Statement[] = [...parsed.figure.body];
  while (stack.length > 0) {
    const statement = stack.shift();
    if (!statement) {
      continue;
    }
    if (statement.kind === "Scope") {
      stack.unshift(...statement.body);
      continue;
    }
    if (statement.kind !== "Path") {
      continue;
    }

    if (statement.command === "node" && statement.id === normalizedId) {
      const statementNode = statement.items.find((item) => item.kind === "Node");
      if (statementNode?.kind === "Node") {
        return {
          sourceId: statement.id,
          textSpan: statementNode.textSpan,
          text: statementNode.text
        };
      }
    }

    for (const item of statement.items) {
      if (item.kind === "Node" && item.id === normalizedId) {
        return {
          sourceId: statement.id,
          textSpan: item.textSpan,
          text: item.text
        };
      }
    }
  }

  return null;
}

function hasUnescapedDollar(text: string): boolean {
  let escaped = false;
  for (const char of text) {
    if (char === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (char === "$" && !escaped) {
      return true;
    }
    escaped = false;
  }
  return false;
}
