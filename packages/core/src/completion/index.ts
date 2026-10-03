import type { NodeItem } from "../ast/types.js";
import type { OptionEntry } from "../options/types.js";
import type { ParseTikzResult } from "../parser/index.js";
import { parseOptionListRaw } from "../options/parse.js";
import { readBalancedBlock } from "../semantic/style/option-utils.js";
import { walkStatements } from "../ast/walk.js";
import {
  readTexBalancedDelimited,
  readTexControlSequence,
  skipTexComment,
  skipTexVerbatim,
  type TexControlSequence
} from "../parser/tex-lexical.js";

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
  const recovery = scanRecoverySource(parseResult.source);

  walkStatements(parseResult.figure.body, {
    onStatement: (statement) => {
      if ((statement.kind === "TikzSet" || statement.kind === "Pgfkeys") && isLivePosition(statement.span.from, recovery.inertSpans)) {
        collectStyleSymbolsFromOptions(statement.optionList.entries, styleNames);
      } else if (statement.kind === "TikzStyle" && isLivePosition(statement.span.from, recovery.inertSpans)) {
        addTrimmedSymbol(styleNames, normalizeStyleName(statement.styleNameRaw));
      }
    },
    onNode: (node) => {
      if (isLivePosition(node.span.from, recovery.inertSpans)) collectNodeIdentifiers(node, nodeNames);
    },
    onCoordinateOperation: (item) => {
      if (isLivePosition(item.span.from, recovery.inertSpans)) addTrimmedSymbol(coordinateNames, item.name);
    }
  });
  // Completion runs on in-progress source: parser recovery swallows every
  // statement after an unterminated brace group, so lexical recovery below keeps
  // symbols visible for the regions the recovered AST does not cover.
  collectRecoverySymbols(recovery, nodeNames, styleNames);

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

type RecoverySource = {
  source: string;
  commands: TexControlSequence[];
  inertSpans: Array<{ from: number; to: number }>;
};

/** Keep offsets and line endings intact while hiding inert recovery material. */
function scanRecoverySource(source: string): RecoverySource {
  const commands: TexControlSequence[] = [];
  const inertSpans: RecoverySource["inertSpans"] = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (source.charAt(cursor) === "%") {
      const to = skipTexComment(source, cursor);
      inertSpans.push({ from: cursor, to });
      cursor = to;
      continue;
    }
    const command = readTexControlSequence(source, cursor);
    if (!command) {
      cursor += 1;
      continue;
    }
    const verbatimEnd = skipTexVerbatim(source, command, true);
    if (verbatimEnd !== null) {
      inertSpans.push({ from: command.from, to: verbatimEnd });
      cursor = verbatimEnd;
      continue;
    }
    if (["\\node", "\\tikzset", "\\pgfkeys", "\\tikzstyle"].includes(command.raw)) commands.push(command);
    cursor = command.to;
  }
  const parts: string[] = [];
  cursor = 0;
  for (const span of inertSpans) {
    parts.push(source.slice(cursor, span.from), source.slice(span.from, span.to).replace(/[^\r\n]/gu, char => " ".repeat(char.length)));
    cursor = span.to;
  }
  parts.push(source.slice(cursor));
  return { source: parts.join(""), commands, inertSpans };
}

function isLivePosition(position: number, spans: RecoverySource["inertSpans"]): boolean {
  let from = 0;
  let to = spans.length;
  while (from < to) {
    const middle = (from + to) >>> 1;
    const span = spans[middle];
    if (position < span.from) to = middle;
    else if (position >= span.to) from = middle + 1;
    else return false;
  }
  return true;
}

function collectRecoverySymbols(recovery: RecoverySource, nodeNames: Set<string>, styleNames: Set<string>): void {
  const { source, commands } = recovery;
  // Preserve the previous per-command recovery boundary inside complete arguments.
  const consumedThrough = new Map<string, number>();
  for (const command of commands) {
    if (command.from < (consumedThrough.get(command.raw) ?? 0)) continue;
    let index = skipWhitespace(source, command.to);
    if (command.raw === "\\node") {
      const options = readTexBalancedDelimited(source, index, "[", "]");
      if (options) index = skipWhitespace(source, options.to);
      const name = readBalancedBlock(source, index, "(", ")");
      if (name) {
        addTrimmedSymbol(nodeNames, normalizeSimpleSymbolName(name.content));
        consumedThrough.set(command.raw, name.nextIndex);
      }
      continue;
    }
    const block = readTexBalancedDelimited(source, index, "{", "}");
    if (!block) continue;
    consumedThrough.set(command.raw, block.to);
    const content = source.slice(block.from + 1, block.to - 1);
    if (command.raw === "\\tikzstyle") {
      addTrimmedSymbol(styleNames, normalizeStyleName(content));
    } else {
      collectStyleSymbolsFromOptions(parseOptionListRaw(`[${content}]`, index).entries, styleNames);
    }
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
