import type { SyntaxNode } from "@lezer/common";

import type { Diagnostic } from "./types.js";
import { walk } from "../syntax/cursor.js";
import { collectCoordinateDiagnostics } from "../domains/coordinates/diagnostics.js";

const PATH_COMMANDS = new Set([
  "DrawCmd", "PathCmd", "FillCmd", "FillDrawCmd", "ClipCmd",
  "ShadeCmd", "ShadeDrawCmd", "PatternCmd", "UseAsBoundingBoxCmd",
  "GraphCmd", "MatrixCmd", "NodeCmd", "CoordinateCmd"
]);

const COMMAND_DISPLAY: Record<string, string> = {
  DrawCmd: "\\draw", PathCmd: "\\path", FillCmd: "\\fill",
  FillDrawCmd: "\\filldraw", ClipCmd: "\\clip", ShadeCmd: "\\shade",
  ShadeDrawCmd: "\\shadedraw", PatternCmd: "\\pattern",
  UseAsBoundingBoxCmd: "\\useasboundingbox", GraphCmd: "\\graph",
  MatrixCmd: "\\matrix", NodeCmd: "\\node", CoordinateCmd: "\\coordinate"
};

const MAX_SOURCE_PREVIEW_LENGTH = 40;

function describeParseError(errorNode: SyntaxNode, source: string): string {
  const parent = errorNode.parent;
  const parentName = parent?.type.name ?? "";

  // Error inside a path statement → likely missing semicolon
  if (parent?.type.name === "PathStatement") {
    // Find the path command for context
    let cmdChild = parent.firstChild;
    while (cmdChild && !cmdChild.type.name.startsWith("PathCommand")) {
      cmdChild = cmdChild.nextSibling;
    }
    const pathCmd = cmdChild?.firstChild;
    const cmdName = pathCmd && COMMAND_DISPLAY[pathCmd.type.name];
    if (cmdName) {
      return `Syntax error in ${cmdName} statement. Check for a missing semicolon or malformed path.`;
    }
    return "Syntax error in path statement. Check for a missing semicolon or malformed path.";
  }

  // Error inside a scope
  if (parentName === "ScopeStatement") {
    return "Syntax error inside scope. Check for a missing \\end{scope}, unclosed groups, or missing semicolons.";
  }

  // Error inside a foreach
  if (parentName === "ForeachStatement" || parentName === "ForeachBody") {
    return "Syntax error in \\foreach statement. Check the variable list and body syntax.";
  }

  // Error inside option list
  if (parentName === "OptionList" || parentName === "OptionPart") {
    return "Syntax error in option list. Check for missing commas or unmatched brackets.";
  }

  // Error inside a group
  if (parentName === "Group" || parentName === "GroupPart") {
    return "Syntax error inside braces. Check for unmatched { } or invalid content.";
  }

  if (parentName === "NodeTextGroup" || parentName === "NodeTextPart") {
    return "Unclosed node text; add a closing `}` before the end of the node statement.";
  }

  // Error inside a coordinate
  if (parentName === "Coordinate" || parentName === "CoordPart") {
    return "Syntax error in coordinate. Check parentheses and coordinate format.";
  }

  // Error inside macro/newcommand definitions
  if (parentName === "MacroDefinitionStatement") {
    return "Syntax error in \\def. Expected \\def\\commandname{body}.";
  }
  if (parentName === "MacroCommandDefinitionStatement" || hasAncestor(errorNode, "MacroCommandDefinitionStatement")) {
    return "Syntax error in \\newcommand definition. Expected \\newcommand{\\name}[argCount]{body}.";
  }
  if (parentName === "MacroAliasStatement") {
    return "Syntax error in \\let statement.";
  }

  // Error inside style definitions
  if (parentName === "TikzSetStatement" || parentName === "PgfkeysStatement") {
    return "Syntax error in style definition.";
  }

  // Error at top level (TikzEnvironment or TikzFile)
  if (parentName === "TikzEnvironment" || parentName === "TikzFile" || parentName === "TikzInline") {
    // Check what the error token looks like
    const errorText = source.slice(errorNode.from, errorNode.to).trim();
    if (errorText.length > 0 && errorText.length <= 30) {
      return `Unexpected \`${errorText}\` at top level. Statements must start with a command like \\draw or \\node.`;
    }
    return "Syntax error at top level. Statements must start with a command like \\draw or \\node.";
  }

  // Error inside a BodyItem → probably stray token context
  if (parentName === "BodyItem") {
    const errorText = source.slice(errorNode.from, errorNode.to).trim();
    if (errorText === ";") {
      return "Unexpected semicolon. Check for a missing command before this point.";
    }
    return "Unexpected token. Check for missing semicolons or commands.";
  }

  // Error inside UnknownStatement
  if (parentName === "UnknownStatement") {
    return "Syntax error in command statement. Check for a missing semicolon.";
  }

  return "Syntax error while parsing TikZ input.";
}

export function collectParseErrorDiagnostics(node: SyntaxNode, source: string, diagnostics: Diagnostic[]): void {
  const seen = new Set<string>();

  walk(node, (current) => {
    if (current.type.isError || current.type.name === "⚠") {
      const key = `${current.from}:${current.to}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);

      diagnostics.push({
        severity: "error",
        message: describeParseError(current, source),
        span: spanForParseError(current),
        code: "parse-error"
      });
    }
  });
}

function spanForParseError(errorNode: SyntaxNode): Diagnostic["span"] {
  const nodeTextGroup = findAncestor(errorNode, "NodeTextGroup");
  if (nodeTextGroup) {
    return { from: nodeTextGroup.from, to: nodeTextGroup.to };
  }
  return { from: errorNode.from, to: errorNode.to };
}

export function collectStructuralDiagnostics(envNode: SyntaxNode, source: string, diagnostics: Diagnostic[]): void {
  let previousStrayTokenEnd: number | null = null;

  walk(envNode, (node) => {
    if (node.type.name === "OptionList" && source[node.to - 1] !== "]") {
      diagnostics.push({
        severity: "warning",
        message: "Unclosed option list; add a closing `]` before the statement continues.",
        span: { from: node.from, to: node.to },
        code: "missing-option-close"
      });
    }

    if ((node.type.name === "Group" || node.type.name === "NodeTextGroup") && source[node.to - 1] !== "}") {
      const isNodeTextGroup = node.type.name === "NodeTextGroup";
      diagnostics.push({
        severity: "warning",
        message: isNodeTextGroup
          ? "Unclosed node text; add a closing `}` before the end of the node statement."
          : "Unclosed group; add a closing `}`.",
        span: { from: node.from, to: node.to },
        code: "missing-group-close"
      });
    }

    if (node.type.name === "ForeachList") {
      collectForeachRangeEllipsisDiagnostics(node, source, diagnostics);
    }

    if ((node.type.name === "PathStatement" || node.type.name === "UnknownStatement") && source[node.to - 1] !== ";") {
      diagnostics.push({
        severity: "warning",
        message: "Statement is missing a trailing semicolon; add `;` at the end of this TikZ command.",
        span: { from: node.to - 1, to: node.to },
        code: "missing-semicolon"
      });
    }

    // Detect path-starting commands embedded as UnknownPathItem inside a PathStatement.
    // This happens when the parser recovers from a missing semicolon by absorbing the
    // next statement into the current one.
    // Detect path-starting commands embedded as UnknownPathItem inside a PathStatement.
    // Tree structure: PathStatement > PathItem > UnknownPathItem > KnownCommand > NodeCmd/DrawCmd/etc.
    if (node.type.name === "UnknownPathItem" && hasAncestor(node, "PathStatement")) {
      const knownCmd = node.firstChild;
      const actualCmd = knownCmd?.type.name === "KnownCommand" ? knownCmd.firstChild : knownCmd;
      if (actualCmd && PATH_COMMANDS.has(actualCmd.type.name)) {
        const cmdDisplay = COMMAND_DISPLAY[actualCmd.type.name] ?? actualCmd.type.name;
        diagnostics.push({
          severity: "warning",
          message: `${cmdDisplay} starts before the previous statement ended; add a semicolon before ${cmdDisplay}.`,
          span: { from: actualCmd.from, to: actualCmd.to },
          code: "missing-semicolon"
        });
      }
    }

    if (node.type.name === "StrayToken") {
      if (
        previousStrayTokenEnd != null &&
        source.slice(previousStrayTokenEnd, node.from).trim().length === 0
      ) {
        previousStrayTokenEnd = node.to;
        return;
      }
      previousStrayTokenEnd = node.to;
      const preview = formatSourcePreview(source.slice(node.from, node.to));
      diagnostics.push({
        severity: "error",
        message: preview === ";"
          ? "Unexpected semicolon; remove it or put it after a TikZ command."
          : `Unexpected text \`${preview}\` in tikzpicture; start statements with a TikZ command such as \\draw, \\node, or \\path.`,
        span: { from: node.from, to: node.to },
        code: "stray-token"
      });
    }
  });

  collectCoordinateDiagnostics(envNode, source, diagnostics);
}

function hasAncestor(node: SyntaxNode, name: string): boolean {
  return findAncestor(node, name) != null;
}

function findAncestor(node: SyntaxNode, name: string): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (current.type.name === name) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function formatSourcePreview(raw: string): string {
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (normalized.length <= MAX_SOURCE_PREVIEW_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_SOURCE_PREVIEW_LENGTH - 1)}...`;
}

function collectForeachRangeEllipsisDiagnostics(node: SyntaxNode, source: string, diagnostics: Diagnostic[]): void {
  const listRaw = source.slice(node.from, node.to);
  const invalidEllipsisPattern = /(^|[\s,{])\.\.(?=[\s,}])/g;

  let match = invalidEllipsisPattern.exec(listRaw);
  while (match) {
    const prefix = match[1] ?? "";
    const dotDotStart = node.from + match.index + prefix.length;
    diagnostics.push({
      severity: "error",
      message: "Invalid foreach range token `..`; use `...` (three dots), for example `{0,...,10}`.",
      span: { from: dotDotStart, to: dotDotStart + 2 },
      code: "invalid-foreach-range-ellipsis"
    });
    match = invalidEllipsisPattern.exec(listRaw);
  }
}
