import { requireArrayValue } from "../utils/collections.js";
import type { PathItem, Statement } from "../ast/types.js";
import type { OptionListAst } from "../options/types.js";
import { parseTikzForEdit, type EditParseOptions } from "./parse-options.js";
import { isWrappedBySingleBracePair } from "../utils/braces.js";

const DECLARATION_OPTION_KEY_REGEX = /(\b(?:name|alias|name\s+path(?:\s+(?:global|local))?)\s*=\s*)(\{[^{}]*\}|\([^()]*\)|[^,\]\s]+)/giu;
const DECLARATION_OPTION_KEYS = new Set([
  "name",
  "alias",
  "name path",
  "name path global",
  "name path local"
]);

export function renameSnippetDeclaredNames(
  source: string,
  snippets: readonly string[],
  parseOptions: EditParseOptions = {}
): string[] {
  if (snippets.length === 0) {
    return [];
  }

  const existingNames = collectDeclaredNamesFromSource(source, parseOptions);
  const declaredNames = collectDeclaredNamesFromSnippets(snippets);
  if (declaredNames.length === 0) {
    return [...snippets];
  }

  const reservedNames = new Set(existingNames);
  const mapping = new Map<string, string>();
  for (const name of declaredNames) {
    if (!existingNames.has(name)) {
      reservedNames.add(name);
      continue;
    }

    const replacement = nextAvailableName(name, reservedNames);
    mapping.set(name, replacement);
    reservedNames.add(replacement);
  }

  if (mapping.size === 0) {
    return [...snippets];
  }

  return snippets.map((snippet) => applyNameMappingToSnippet(snippet, mapping));
}

function collectDeclaredNamesFromSource(source: string, parseOptions: EditParseOptions): Set<string> {
  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const names = new Set<string>();
  collectDeclaredNamesFromStatements(parsed.figure.body, names);
  return names;
}

function collectDeclaredNamesFromSnippets(snippets: readonly string[]): string[] {
  const orderedNames: string[] = [];
  const seen = new Set<string>();

  for (const snippet of snippets) {
    const normalizedSnippet = snippet.replace(/\r\n?/g, "\n").trim();
    if (normalizedSnippet.length === 0) {
      continue;
    }

    const wrapped = wrapSnippetInFigure(normalizedSnippet);
    const parsed = parseTikzForEdit(wrapped);
    const names = new Set<string>();
    collectDeclaredNamesFromStatements(parsed.figure.body, names);

    for (const name of names) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      orderedNames.push(name);
    }
  }

  return orderedNames;
}

function collectDeclaredNamesFromStatements(
  statements: readonly Statement[],
  target: Set<string>
): void {
  for (const statement of statements) {
    if ("options" in statement) {
      collectDeclaredNamesFromOptions(statement.options, target);
    }

    if (statement.kind === "Scope") {
      collectDeclaredNamesFromStatements(statement.body, target);
      continue;
    }

    if (statement.kind !== "Path") {
      continue;
    }

    collectDeclaredNamesFromPathStatement(statement, target);
  }
}

function collectDeclaredNamesFromPathStatement(
  statement: Extract<Statement, { kind: "Path" }>,
  target: Set<string>
): void {
  collectDeclaredNamesFromPathItems(statement.items, target);

  if (statement.command === "coordinate") {
    for (const item of statement.items) {
      if (item.kind === "Coordinate" && item.form === "named") {
        addName(item.x, target);
      }
    }
    return;
  }

  if (statement.command !== "node") {
    return;
  }

  const nodeItemIndex = statement.items.findIndex((item) => item.kind === "Node");
  if (nodeItemIndex <= 0) {
    return;
  }

  for (let index = 0; index < nodeItemIndex; index += 1) {
    const item = statement.items[index];
    if (item?.kind !== "Coordinate" || item.form !== "named") {
      continue;
    }
    addName(item.x, target);
  }
}

function collectDeclaredNamesFromPathItems(
  items: readonly PathItem[],
  target: Set<string>
): void {
  for (const item of items) {
    if ("options" in item) {
      collectDeclaredNamesFromOptions(item.options, target);
    }

    if (item.kind === "Node") {
      addName(item.name, target);
      for (const alias of item.aliases ?? []) {
        addName(alias, target);
      }
      continue;
    }

    if (item.kind === "CoordinateOperation") {
      addName(item.name, target);
      continue;
    }

    if (item.kind === "ToOperation" || item.kind === "EdgeOperation") {
      for (const node of item.nodes ?? []) {
        addName(node.name, target);
        for (const alias of node.aliases ?? []) {
          addName(alias, target);
        }
        collectDeclaredNamesFromOptions(node.options, target);
      }
      continue;
    }

    if (item.kind === "EdgeFromParentOperation") {
      for (const node of item.nodes ?? []) {
        addName(node.name, target);
        for (const alias of node.aliases ?? []) {
          addName(alias, target);
        }
        collectDeclaredNamesFromOptions(node.options, target);
      }
      continue;
    }

    if (item.kind === "ChildOperation") {
      collectDeclaredNamesFromPathItems(item.body, target);
    }
  }
}

function collectDeclaredNamesFromOptions(
  options: OptionListAst | undefined,
  target: Set<string>
): void {
  if (!options) {
    return;
  }

  for (const entry of options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (!DECLARATION_OPTION_KEYS.has(entry.key)) {
      continue;
    }
    addName(normalizeNameToken(entry.valueRaw), target);
  }
}

function addName(name: string | undefined, target: Set<string>): void {
  if (!name) {
    return;
  }
  const normalized = normalizeNameToken(name);
  if (normalized.length === 0) {
    return;
  }
  target.add(normalized);
}

function wrapSnippetInFigure(snippet: string): string {
  return `\\begin{tikzpicture}\n${snippet}\n\\end{tikzpicture}`;
}

function nextAvailableName(baseName: string, usedNames: ReadonlySet<string>): string {
  const normalized = baseName.trim();
  if (/\s/u.test(normalized)) {
    const spacedSuffix = /^(.*\S)\s+(\d+)$/u.exec(normalized);
    const stem = spacedSuffix?.[1] ?? normalized;
    let counter = spacedSuffix ? Number.parseInt(requireArrayValue(spacedSuffix, 2), 10) + 1 : 2;
    if (!Number.isFinite(counter) || counter < 2) {
      counter = 2;
    }

    let candidate = `${stem} ${counter}`;
    while (usedNames.has(candidate)) {
      counter += 1;
      candidate = `${stem} ${counter}`;
    }
    return candidate;
  }

  const digitSuffix = /^(.*?)(\d+)$/u.exec(normalized);
  const stem = digitSuffix && requireArrayValue(digitSuffix, 1).length > 0 ? digitSuffix[1] : normalized;
  let counter = digitSuffix ? Number.parseInt(requireArrayValue(digitSuffix, 2), 10) + 1 : 2;
  if (!Number.isFinite(counter) || counter < 2) {
    counter = 2;
  }

  let candidate = `${stem}${counter}`;
  while (usedNames.has(candidate)) {
    counter += 1;
    candidate = `${stem}${counter}`;
  }
  return candidate;
}

function applyNameMappingToSnippet(
  snippet: string,
  mapping: ReadonlyMap<string, string>
): string {
  const ordered = [...mapping.entries()].sort((left, right) => right[0].length - left[0].length);
  let rewritten = snippet;
  for (const [oldName, newName] of ordered) {
    rewritten = rewriteSingleName(rewritten, oldName, newName);
  }
  return rewritten;
}

function rewriteSingleName(
  snippet: string,
  oldName: string,
  newName: string
): string {
  const escapedOld = escapeRegExp(oldName);
  const coordinatePattern = new RegExp(`\\((\\s*)${escapedOld}(?=(?:\\s*\\)|\\.[^)]*))`, "gu");
  const ofAssignmentPattern = new RegExp(`(\\bof\\s*=\\s*)${escapedOld}(\\b)`, "gu");
  const ofReferencePattern = new RegExp(`(\\bof\\s+)${escapedOld}(\\b)`, "gu");

  let rewritten = replaceOptionNameAssignments(snippet, oldName, newName);
  rewritten = rewritten.replace(coordinatePattern, `($1${newName}`);
  rewritten = rewritten.replace(ofAssignmentPattern, `$1${newName}$2`);
  rewritten = rewritten.replace(ofReferencePattern, `$1${newName}$2`);
  return rewritten;
}

function replaceOptionNameAssignments(
  source: string,
  oldName: string,
  newName: string
): string {
  return source.replace(DECLARATION_OPTION_KEY_REGEX, (match, prefix: string, rawValue: string) => {
    const parsed = normalizeNameToken(rawValue);
    if (parsed !== oldName) {
      return match;
    }

    return `${prefix}${rewriteOptionValue(rawValue, newName)}`;
  });
}

function rewriteOptionValue(rawValue: string, newName: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}") && isWrappedBySingleBracePair(trimmed)) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.startsWith("(") && inner.endsWith(")")) {
      return `{(${newName})}`;
    }
    return `{${newName}}`;
  }

  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return `(${newName})`;
  }

  return newName;
}

function normalizeNameToken(raw: string): string {
  let value = raw.trim();
  while (value.startsWith("{") && value.endsWith("}") && isWrappedBySingleBracePair(value)) {
    value = value.slice(1, -1).trim();
  }
  if (value.startsWith("(") && value.endsWith(")")) {
    value = value.slice(1, -1).trim();
  }
  return value.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
