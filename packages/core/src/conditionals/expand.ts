/**
 * TeX conditional expansion.
 *
 * Expands \ifnum, \ifodd, \ifx, and \ifthenelse in text after variable
 * substitution, before parsing. Operates purely on strings.
 */

// Matches any \if-family command (used for nesting depth tracking).
const IF_FAMILY_REGEX = /\\if[a-z]*/g;

// Matches the specific conditionals we handle.
// Use a lookahead that stops at letters (not digits) to match TeX's control sequence rules.
const CONDITIONAL_REGEX = /\\(?:ifnum|ifodd|ifx|ifthenelse)(?![a-zA-Z])/g;

/**
 * Expand all TeX conditionals in the input string.
 * Returns the string with \ifnum/\ifodd/\ifx/\ifthenelse blocks resolved.
 */
export function expandTexConditionals(input: string, maxPasses = 50): string {
  let current = input;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const next = expandOneConditional(current);
    if (next === current) {
      return next;
    }
    current = next;
  }

  return current;
}

/**
 * Find and expand the first (outermost) conditional in the string.
 */
function expandOneConditional(input: string): string {
  CONDITIONAL_REGEX.lastIndex = 0;
  const match = CONDITIONAL_REGEX.exec(input);
  if (!match) {
    return input;
  }

  const command = match[0];
  const commandStart = match.index;
  const afterCommand = commandStart + command.length;

  if (command === "\\ifthenelse") {
    return expandIfthenelse(input, commandStart, afterCommand);
  }

  if (command === "\\ifnum") {
    return expandIfnum(input, commandStart, afterCommand);
  }

  if (command === "\\ifodd") {
    return expandIfodd(input, commandStart, afterCommand);
  }

  if (command === "\\ifx") {
    return expandIfx(input, commandStart, afterCommand);
  }

  return input;
}

// ---------------------------------------------------------------------------
// \ifnum
// ---------------------------------------------------------------------------

function expandIfnum(input: string, commandStart: number, afterCommand: number): string {
  let cursor = skipWhitespace(input, afterCommand);

  const lhs = parseInteger(input, cursor);
  if (lhs == null) {
    return input;
  }
  cursor = skipWhitespace(input, lhs.nextIndex);

  const op = input[cursor];
  if (op !== "<" && op !== ">" && op !== "=") {
    return input;
  }
  cursor = skipWhitespace(input, cursor + 1);

  const rhs = parseInteger(input, cursor);
  if (rhs == null) {
    return input;
  }
  cursor = rhs.nextIndex;

  // Skip optional \relax after condition
  cursor = skipRelax(input, cursor);

  let result: boolean;
  if (op === "<") result = lhs.value < rhs.value;
  else if (op === ">") result = lhs.value > rhs.value;
  else result = lhs.value === rhs.value;

  return resolveIfBlock(input, commandStart, cursor, result);
}

// ---------------------------------------------------------------------------
// \ifodd
// ---------------------------------------------------------------------------

function expandIfodd(input: string, commandStart: number, afterCommand: number): string {
  let cursor = skipWhitespace(input, afterCommand);

  const num = parseInteger(input, cursor);
  if (num == null) {
    return input;
  }
  cursor = num.nextIndex;

  cursor = skipRelax(input, cursor);

  return resolveIfBlock(input, commandStart, cursor, num.value % 2 !== 0);
}

// ---------------------------------------------------------------------------
// \ifx
// ---------------------------------------------------------------------------

function expandIfx(input: string, commandStart: number, afterCommand: number): string {
  let cursor = skipWhitespace(input, afterCommand);

  const tok1 = parseToken(input, cursor);
  if (tok1 == null) {
    return input;
  }
  cursor = tok1.nextIndex;

  const tok2 = parseToken(input, cursor);
  if (tok2 == null) {
    return input;
  }
  cursor = tok2.nextIndex;

  cursor = skipRelax(input, cursor);

  return resolveIfBlock(input, commandStart, cursor, tok1.value === tok2.value);
}

// ---------------------------------------------------------------------------
// \ifthenelse
// ---------------------------------------------------------------------------

function expandIfthenelse(input: string, commandStart: number, afterCommand: number): string {
  let cursor = skipWhitespace(input, afterCommand);

  const condGroup = readBracedContent(input, cursor);
  if (condGroup == null) {
    return input;
  }
  cursor = condGroup.nextIndex;

  cursor = skipWhitespace(input, cursor);
  const trueGroup = readBracedContent(input, cursor);
  if (trueGroup == null) {
    return input;
  }
  cursor = trueGroup.nextIndex;

  cursor = skipWhitespace(input, cursor);
  const falseGroup = readBracedContent(input, cursor);
  if (falseGroup == null) {
    return input;
  }
  cursor = falseGroup.nextIndex;

  const result = evaluateIfthenelseCondition(condGroup.value);

  const before = input.slice(0, commandStart);
  const chosen = result ? trueGroup.value : falseGroup.value;
  const after = input.slice(cursor);
  return before + chosen + after;
}

function evaluateIfthenelseCondition(condition: string): boolean {
  const trimmed = condition.trim();

  // \isodd{n}
  const isoddMatch = /^\\isodd\s*\{([^}]*)\}$/.exec(trimmed);
  if (isoddMatch?.[1] !== undefined) {
    const n = tryParseInt(isoddMatch[1].trim());
    return n != null && n % 2 !== 0;
  }

  // \equal{a}{b}
  const equalMatch = /^\\equal\s*\{([^}]*)\}\s*\{([^}]*)\}$/.exec(trimmed);
  if (equalMatch?.[1] !== undefined && equalMatch[2] !== undefined) {
    return equalMatch[1].trim() === equalMatch[2].trim();
  }

  // \NOT <cond>
  const notMatch = /^\\NOT\s+(.+)$/.exec(trimmed);
  if (notMatch?.[1] !== undefined) {
    return !evaluateIfthenelseCondition(notMatch[1]);
  }

  // <cond> \AND <cond>
  const andIndex = findTopLevelOperator(trimmed, "\\AND");
  if (andIndex >= 0) {
    const left = trimmed.slice(0, andIndex).trim();
    const right = trimmed.slice(andIndex + 4).trim();
    return evaluateIfthenelseCondition(left) && evaluateIfthenelseCondition(right);
  }

  // <cond> \OR <cond>
  const orIndex = findTopLevelOperator(trimmed, "\\OR");
  if (orIndex >= 0) {
    const left = trimmed.slice(0, orIndex).trim();
    const right = trimmed.slice(orIndex + 3).trim();
    return evaluateIfthenelseCondition(left) || evaluateIfthenelseCondition(right);
  }

  // numeric comparison: a < b, a > b, a = b
  const cmpMatch = /^(-?\d+)\s*([<>=])\s*(-?\d+)$/.exec(trimmed);
  if (cmpMatch?.[1] !== undefined && cmpMatch[3] !== undefined) {
    const a = Number.parseInt(cmpMatch[1], 10);
    const b = Number.parseInt(cmpMatch[3], 10);
    const op = cmpMatch[2];
    if (op === "<") return a < b;
    if (op === ">") return a > b;
    return a === b;
  }

  // Fallback: treat non-empty as true (like TeX \iftrue)
  return trimmed.length > 0;
}

function findTopLevelOperator(input: string, op: string): number {
  let depth = 0;
  for (let i = 0; i <= input.length - op.length; i += 1) {
    const ch = input[i];
    if (ch === "{") { depth += 1; continue; }
    if (ch === "}") { depth -= 1; continue; }
    if (depth === 0 && input.slice(i, i + op.length) === op) {
      // Check that the operator is not part of a longer control sequence
      const after = input[i + op.length];
      if (after == null || !/[a-zA-Z]/.test(after)) {
        return i;
      }
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Shared: resolve \if...\else...\fi block
// ---------------------------------------------------------------------------

function resolveIfBlock(input: string, commandStart: number, bodyStart: number, condition: boolean): string {
  const match = findElseAndFi(input, bodyStart);
  if (match == null) {
    return input;
  }

  const before = input.slice(0, commandStart);
  const after = input.slice(match.fiEnd);

  if (condition) {
    const trueBranch = input.slice(bodyStart, match.elseIndex ?? match.fiStart);
    return before + trueBranch + after;
  } else {
    if (match.elseIndex != null) {
      const falseStart = match.elseIndex + 5; // length of \else
      const falseBranch = input.slice(falseStart, match.fiStart);
      return before + falseBranch + after;
    }
    return before + after;
  }
}

/**
 * Find matching \else and \fi, tracking nested \if...\fi pairs.
 */
function findElseAndFi(
  input: string,
  startIndex: number
): { elseIndex: number | null; fiStart: number; fiEnd: number } | null {
  let depth = 0;
  let elseIndex: number | null = null;
  let cursor = startIndex;

  while (cursor < input.length) {
    const ch = input[cursor];

    if (ch !== "\\") {
      cursor += 1;
      continue;
    }

    // Check for \fi
    if (input.slice(cursor, cursor + 3) === "\\fi" && !isAlpha(input.charAt(cursor + 3))) {
      if (depth === 0) {
        return {
          elseIndex,
          fiStart: cursor,
          fiEnd: cursor + 3
        };
      }
      depth -= 1;
      cursor += 3;
      continue;
    }

    // Check for \else (only at depth 0)
    if (depth === 0 && input.slice(cursor, cursor + 5) === "\\else" && !isAlpha(input.charAt(cursor + 5))) {
      elseIndex = cursor;
      cursor += 5;
      continue;
    }

    // Check for any \if-family command (increment nesting depth)
    IF_FAMILY_REGEX.lastIndex = cursor;
    const ifMatch = IF_FAMILY_REGEX.exec(input);
    if (ifMatch?.index === cursor) {
      depth += 1;
      cursor += ifMatch[0].length;
      continue;
    }

    // Skip other control sequences
    cursor += 1;
    while (cursor < input.length && isAlpha(input.charAt(cursor))) {
      cursor += 1;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseInteger(input: string, startIndex: number): { value: number; nextIndex: number } | null {
  let cursor = startIndex;
  let sign = 1;

  if (input[cursor] === "-") {
    sign = -1;
    cursor += 1;
  } else if (input[cursor] === "+") {
    cursor += 1;
  }

  const digitStart = cursor;
  while (cursor < input.length && isDigit(input.charAt(cursor))) {
    cursor += 1;
  }

  if (cursor === digitStart) {
    return null;
  }

  const value = sign * Number.parseInt(input.slice(digitStart, cursor), 10);
  return { value, nextIndex: cursor };
}

function parseToken(input: string, startIndex: number): { value: string; nextIndex: number } | null {
  let cursor = startIndex;
  // Skip whitespace between tokens in \ifx
  while (cursor < input.length && input[cursor] === " ") {
    cursor += 1;
  }

  if (cursor >= input.length) {
    return null;
  }

  if (input[cursor] === "\\") {
    const tokenStart = cursor;
    cursor += 1;
    while (cursor < input.length && isAlpha(input.charAt(cursor))) {
      cursor += 1;
    }
    return { value: input.slice(tokenStart, cursor), nextIndex: cursor };
  }

  return { value: input.charAt(cursor), nextIndex: cursor + 1 };
}

function readBracedContent(input: string, startIndex: number): { value: string; nextIndex: number } | null {
  if (input[startIndex] !== "{") {
    return null;
  }

  let depth = 0;
  let cursor = startIndex;
  while (cursor < input.length) {
    const ch = input[cursor];
    if (ch === "\\") {
      cursor += 2;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: input.slice(startIndex + 1, cursor),
          nextIndex: cursor + 1
        };
      }
      cursor += 1;
      continue;
    }
    cursor += 1;
  }
  return null;
}

function skipWhitespace(input: string, index: number): number {
  while (index < input.length && /\s/.test(input.charAt(index))) {
    index += 1;
  }
  return index;
}

function skipRelax(input: string, index: number): number {
  const cursor = skipWhitespace(input, index);
  if (input.slice(cursor, cursor + 6) === "\\relax" && !isAlpha(input.charAt(cursor + 6))) {
    return cursor + 6;
  }
  return cursor;
}

function isAlpha(ch: string | undefined): boolean {
  if (ch == null) return false;
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function tryParseInt(s: string): number | null {
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}
