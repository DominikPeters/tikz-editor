import type { NodeItem } from "../ast/types.js";
import type { OptionEntry } from "../options/types.js";
import type { ParseTikzResult } from "../parser/index.js";
import { parseOptionListRaw } from "../options/parse.js";
import { readBalancedBlock } from "../semantic/style/option-utils.js";
import { walkStatements } from "../ast/walk.js";

export type DocumentSymbols = {
  nodeNames: string[];
  styleNames: string[];
  coordinateNames: string[];
};

export type SymbolSnapshot = {
  parseResult: Pick<ParseTikzResult, "source" | "figure"> | null;
};

export function collectSymbols(snapshot: SymbolSnapshot): DocumentSymbols {
  const parseResult = snapshot.parseResult;
  if (!parseResult) {
    return {
      nodeNames: [],
      styleNames: [],
      coordinateNames: []
    };
  }

  const nodeNames = new Set<string>();
  const coordinateNames = new Set<string>();
  const styleNames = new Set<string>();

  walkStatements(parseResult.figure.body, {
    onStatement: (statement) => {
      if (statement.kind === "TikzSet" || statement.kind === "Pgfkeys") {
        collectStyleSymbolsFromOptions(statement.optionList.entries, styleNames);
      } else if (statement.kind === "TikzStyle") {
        addTrimmedSymbol(styleNames, normalizeStyleName(statement.styleNameRaw));
      }
    },
    onNode: (node) => {
      collectNodeIdentifiers(node, nodeNames);
    },
    onCoordinateOperation: (item) => {
      addTrimmedSymbol(coordinateNames, item.name);
    }
  });
  // Completion runs on in-progress source: parser recovery swallows every
  // statement after an unterminated brace group, so the raw scans below keep
  // symbols visible for the regions the recovered AST does not cover.
  collectStandaloneNodeCommandNamesFromSource(parseResult.source, nodeNames);
  collectStyleSymbolsFromSource(parseResult.source, styleNames);

  return {
    nodeNames: [...nodeNames].sort(compareSymbolName),
    styleNames: [...styleNames].sort(compareSymbolName),
    coordinateNames: [...coordinateNames].sort(compareSymbolName)
  };
}

function collectNodeIdentifiers(node: NodeItem, nodeNames: Set<string>): void {
  addTrimmedSymbol(nodeNames, node.name);
  if (!node.name) {
    const inferred = inferNodeNameFromTemplate(node.templateRaw, node.atRaw);
    addTrimmedSymbol(nodeNames, inferred);
  }
  for (const alias of node.aliases ?? []) {
    addTrimmedSymbol(nodeNames, alias);
  }
}

function collectStyleSymbolsFromOptions(entries: readonly OptionEntry[], styleNames: Set<string>): void {
  for (const entry of entries) {
    if (entry.kind !== "kv" && entry.kind !== "flag") {
      continue;
    }
    addTrimmedSymbol(styleNames, styleNameFromOptionKey(entry.key));
  }
}

function collectStyleSymbolsFromSource(source: string, styleNames: Set<string>): void {
  collectStyleSymbolsFromCommand(source, "\\tikzset", styleNames);
  collectStyleSymbolsFromCommand(source, "\\pgfkeys", styleNames);
  collectStyleSymbolsFromTikzstyle(source, styleNames);
}

function collectStandaloneNodeCommandNamesFromSource(source: string, nodeNames: Set<string>): void {
  const command = "\\node";
  let cursor = 0;

  while (cursor < source.length) {
    const commandIndex = source.indexOf(command, cursor);
    if (commandIndex < 0) {
      return;
    }

    let index = skipWhitespace(source, commandIndex + command.length);
    const optionBlock = readBalancedBlock(source, index, "[", "]");
    if (optionBlock) {
      index = skipWhitespace(source, optionBlock.nextIndex);
    }

    const nameBlock = readBalancedBlock(source, index, "(", ")");
    if (nameBlock) {
      addTrimmedSymbol(nodeNames, normalizeSimpleSymbolName(nameBlock.content));
      cursor = nameBlock.nextIndex;
      continue;
    }

    cursor = commandIndex + command.length;
  }
}

function collectStyleSymbolsFromCommand(source: string, command: string, styleNames: Set<string>): void {
  let cursor = 0;
  while (cursor < source.length) {
    const commandIndex = source.indexOf(command, cursor);
    if (commandIndex < 0) {
      return;
    }

    const openBraceIndex = skipWhitespace(source, commandIndex + command.length);
    const block = readBalancedBlock(source, openBraceIndex, "{", "}");
    if (!block) {
      cursor = commandIndex + command.length;
      continue;
    }

    const optionList = parseOptionListRaw(`[${block.content}]`, openBraceIndex);
    collectStyleSymbolsFromOptions(optionList.entries, styleNames);

    cursor = block.nextIndex;
  }
}

function collectStyleSymbolsFromTikzstyle(source: string, styleNames: Set<string>): void {
  const command = "\\tikzstyle";
  let cursor = 0;

  while (cursor < source.length) {
    const commandIndex = source.indexOf(command, cursor);
    if (commandIndex < 0) {
      return;
    }

    const openBraceIndex = skipWhitespace(source, commandIndex + command.length);
    const nameBlock = readBalancedBlock(source, openBraceIndex, "{", "}");
    if (!nameBlock) {
      cursor = commandIndex + command.length;
      continue;
    }

    addTrimmedSymbol(styleNames, normalizeStyleName(nameBlock.content));
    cursor = nameBlock.nextIndex;
  }
}

function normalizeSimpleSymbolName(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^[A-Za-z_][A-Za-z0-9:_-]*$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function skipWhitespace(input: string, index: number): number {
  let cursor = index;
  while (cursor < input.length && /\s/.test(input[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function styleNameFromOptionKey(key: string): string | null {
  const normalizedKey = key.trim().toLowerCase();
  const styleMatch = normalizedKey.match(/^(.*?)\/\.(style|append style|prefix style)$/);
  if (!styleMatch) {
    return null;
  }

  return normalizeStyleName(styleMatch[1] ?? "");
}

function normalizeStyleName(value: string): string {
  let normalized = value.trim().toLowerCase();
  if (normalized.startsWith("/tikz/")) {
    normalized = normalized.slice("/tikz/".length);
  } else if (normalized.startsWith("/pgf/")) {
    normalized = normalized.slice("/pgf/".length);
  }
  return normalized.trim();
}

function inferNodeNameFromTemplate(templateRaw: string, atRaw: string | undefined): string | null {
  const match = templateRaw.match(/\(\s*([A-Za-z_][A-Za-z0-9:_-]*)\s*\)/);
  if (!match) {
    return null;
  }

  const inferred = match[1]?.trim() ?? "";
  if (inferred.length === 0) {
    return null;
  }

  if (atRaw?.replace(/\s+/g, "") === `(${inferred})`) {
    return null;
  }

  return inferred;
}

function addTrimmedSymbol(target: Set<string>, value: string | null | undefined): void {
  if (!value) {
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return;
  }
  target.add(trimmed);
}

function compareSymbolName(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

export { resolveDocHoverTarget } from "./doc-hover.js";
export type { DocHoverTarget, DocHoverTargetKind, ResolveDocHoverTargetInput } from "./doc-hover.js";
