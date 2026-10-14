export type FormatTikzSourceOptions = {
  indentUnit?: string;
  collapseBlankLines?: boolean;
  reflowLongOptionLists?: boolean;
  maxLineLength?: number;
};

const DEFAULT_INDENT_UNIT = "  ";
const DEFAULT_REFLOW_LONG_OPTION_LISTS = true;
const DEFAULT_MAX_LINE_LENGTH = 100;
const MIN_MAX_LINE_LENGTH = 40;
const MAX_MAX_LINE_LENGTH = 240;

const PATH_COMMAND_START_PATTERN = /^\\(?:path|draw|filldraw|fill|shadedraw|shade|clip|pattern|useasboundingbox|graph|node|coordinate|matrix)\b/;
const BEGIN_ENV_PATTERN = /\\begin\{(?:tikzpicture|tikzlayer|scope)\}/g;
const END_ENV_PATTERN = /\\end\{(?:tikzpicture|tikzlayer|scope)\}/g;

export function formatTikzSource(source: string, options: FormatTikzSourceOptions = {}): string {
  const indentUnit = options.indentUnit ?? DEFAULT_INDENT_UNIT;
  const collapseBlankLines = options.collapseBlankLines ?? true;
  const reflowLongOptionLists = options.reflowLongOptionLists ?? DEFAULT_REFLOW_LONG_OPTION_LISTS;
  const maxLineLength = clampMaxLineLength(options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH);

  const newline = preferredNewline(source);
  const hasTrailingNewline = source.endsWith("\n") || source.endsWith("\r");
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const optionListsProcessed = processOptionLists(normalized, {
    reflowLongOptionLists,
    maxLineLength
  });
  const lines = optionListsProcessed.split("\n");

  let envDepth = 0;
  let optionDepth = 0;
  let braceDepth = 0;
  let inPathContinuation = false;
  const formatted: string[] = [];

  for (const line of lines) {
    const trimmedRight = trimTrailingWhitespace(line);
    const commentStart = findCommentStart(trimmedRight);
    const code = commentStart >= 0 ? trimmedRight.slice(0, commentStart) : trimmedRight;
    const trimmedCode = code.trim();
    const trimmedLine = trimmedRight.trimStart();
    const isBlankLine = trimmedLine.length === 0;

    let pathContinuationDepth = 0;
    if (inPathContinuation && optionDepth === 0 && braceDepth === 0) {
      pathContinuationDepth = 1;
    }

    const leadingCloseInfo = resolveLeadingCloserInfo(trimmedCode);
    const dedentForClosers =
      (leadingCloseInfo.hasLeadingEnvClose ? 1 : 0) +
      (leadingCloseInfo.hasLeadingOptionClose ? 1 : 0) +
      (leadingCloseInfo.hasLeadingBraceClose ? 1 : 0);

    const indentDepth = Math.max(
      0,
      envDepth + optionDepth + braceDepth + pathContinuationDepth - dedentForClosers
    );

    if (isBlankLine) {
      formatted.push("");
    } else {
      formatted.push(`${indentUnit.repeat(indentDepth)}${trimmedLine}`);
    }

    const beginCount = countMatches(code, BEGIN_ENV_PATTERN);
    const endCount = countMatches(code, END_ENV_PATTERN);
    envDepth = Math.max(0, envDepth + beginCount - endCount);

    if (leadingCloseInfo.hasLeadingOptionClose) {
      optionDepth = Math.max(0, optionDepth - 1);
    }
    if (leadingCloseInfo.hasLeadingBraceClose) {
      braceDepth = Math.max(0, braceDepth - 1);
    }
    if (trimmedCode.endsWith("[")) {
      optionDepth += 1;
    }
    if (trimmedCode.endsWith("{")) {
      braceDepth += 1;
    }

    if (PATH_COMMAND_START_PATTERN.test(trimmedCode)) {
      inPathContinuation = true;
    }
    if (inPathContinuation && trimmedCode.includes(";")) {
      inPathContinuation = false;
    }
  }

  const finalized = collapseBlankLines ? collapseBlankLineRuns(formatted) : formatted;
  let output = finalized.join(newline);
  if (hasTrailingNewline) {
    output += newline;
  }
  return output;
}

function processOptionLists(
  source: string,
  options: { reflowLongOptionLists: boolean; maxLineLength: number }
): string {
  let output = "";
  let cursor = 0;
  let inComment = false;

  while (cursor < source.length) {
    const char = source[cursor];
    if (inComment) {
      output += char;
      if (char === "\n") {
        inComment = false;
      }
      cursor += 1;
      continue;
    }

    if (char === "%" && !isEscapedAt(source, cursor)) {
      inComment = true;
      output += char;
      cursor += 1;
      continue;
    }

    if (char === "[" && !isEscapedAt(source, cursor)) {
      const closeIndex = findClosingBracket(source, cursor);
      if (closeIndex < 0) {
        output += char;
        cursor += 1;
        continue;
      }

      const rewritten = rewriteOptionList(source, cursor, closeIndex, options);
      output += rewritten ?? source.slice(cursor, closeIndex + 1);
      cursor = closeIndex + 1;
      continue;
    }

    output += char;
    cursor += 1;
  }

  return output;
}

function rewriteOptionList(
  source: string,
  openIndex: number,
  closeIndex: number,
  options: { reflowLongOptionLists: boolean; maxLineLength: number }
): string | null {
  const raw = source.slice(openIndex, closeIndex + 1);
  if (containsUnescapedPercent(raw)) {
    return null;
  }

  const inner = raw.slice(1, -1);
  const entries = splitTopLevelByComma(inner)
    .map((entry) => normalizeOptionEntry(entry.trim()))
    .filter((entry) => entry.length > 0);
  if (entries.length < 2) {
    return null;
  }

  const normalizedInline = `[${entries.join(", ")}]`;
  const hasNewline = raw.includes("\n");

  const lineStart = source.lastIndexOf("\n", openIndex - 1) + 1;
  const lineEndRaw = source.indexOf("\n", closeIndex);
  const lineEnd = lineEndRaw >= 0 ? lineEndRaw : source.length;

  const before = source.slice(lineStart, openIndex).replace(/[ \t]+$/u, "");
  const after = source.slice(closeIndex + 1, lineEnd).replace(/^[ \t]+/u, "");
  const inlineCandidate = `${before}${normalizedInline}${after}`;
  if (options.reflowLongOptionLists && inlineCandidate.length > options.maxLineLength) {
    const lines = entries.map((entry, index) => (index < entries.length - 1 ? `${entry},` : entry));
    return `[\n${lines.join("\n")}\n]`;
  }

  if (!hasNewline && raw !== normalizedInline) {
    return normalizedInline;
  }

  return null;
}

function splitTopLevelByComma(input: string): string[] {
  const parts: string[] = [];
  let tokenStart = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === "," && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      parts.push(input.slice(tokenStart, index));
      tokenStart = index + 1;
    }
  }

  parts.push(input.slice(tokenStart));
  return parts;
}

function normalizeOptionEntry(entry: string): string {
  const separatorIndex = findTopLevelEquals(entry);
  if (separatorIndex < 0) {
    return entry;
  }

  const key = entry.slice(0, separatorIndex).trimEnd();
  const value = entry.slice(separatorIndex + 1).trimStart();
  return `${key}=${value}`;
}

function findTopLevelEquals(input: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === "=" && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return index;
    }
  }

  return -1;
}

function findClosingBracket(source: string, openIndex: number): number {
  let depth = 0;
  let inComment = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inComment) {
      if (char === "\n") {
        inComment = false;
      }
      continue;
    }

    if (char === "%" && !isEscapedAt(source, index)) {
      inComment = true;
      continue;
    }

    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function containsUnescapedPercent(input: string): boolean {
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === "%" && !isEscapedAt(input, index)) {
      return true;
    }
  }
  return false;
}

function clampMaxLineLength(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_LINE_LENGTH;
  }
  const rounded = Math.round(value);
  return Math.max(MIN_MAX_LINE_LENGTH, Math.min(MAX_MAX_LINE_LENGTH, rounded));
}

function preferredNewline(source: string): "\n" | "\r\n" {
  if (source.includes("\r\n")) {
    return "\r\n";
  }
  return "\n";
}

function trimTrailingWhitespace(input: string): string {
  return input.replace(/[ \t]+$/u, "");
}

function findCommentStart(line: string): number {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "%") {
      continue;
    }
    if (!isEscapedAt(line, index)) {
      return index;
    }
  }
  return -1;
}

function isEscapedAt(input: string, index: number): boolean {
  let backslashes = 0;
  let cursor = index - 1;
  while (cursor >= 0 && input[cursor] === "\\") {
    backslashes += 1;
    cursor -= 1;
  }
  return backslashes % 2 === 1;
}

function resolveLeadingCloserInfo(trimmedCode: string): {
  hasLeadingOptionClose: boolean;
  hasLeadingBraceClose: boolean;
  hasLeadingEnvClose: boolean;
} {
  const leadingClosers = trimmedCode.match(/^[\]}]*/)?.[0] ?? "";
  const afterLeadingClosers = trimmedCode.slice(leadingClosers.length).trimStart();
  return {
    hasLeadingOptionClose: leadingClosers.includes("]"),
    hasLeadingBraceClose: leadingClosers.includes("}"),
    hasLeadingEnvClose: /^\\end\{(?:tikzpicture|tikzlayer|scope)\}/.test(afterLeadingClosers)
  };
}

function countMatches(input: string, pattern: RegExp): number {
  const matcher = new RegExp(pattern.source, pattern.flags);
  let count = 0;
  let match = matcher.exec(input);
  while (match) {
    count += 1;
    match = matcher.exec(input);
  }
  return count;
}

function collapseBlankLineRuns(lines: readonly string[]): string[] {
  const collapsed: string[] = [];
  let sawContent = false;
  let pendingBlank = false;

  for (const line of lines) {
    if (line.trim().length === 0) {
      if (!sawContent) {
        continue;
      }
      pendingBlank = true;
      continue;
    }

    if (pendingBlank && collapsed.length > 0) {
      collapsed.push("");
    }
    collapsed.push(line);
    sawContent = true;
    pendingBlank = false;
  }

  return collapsed;
}
