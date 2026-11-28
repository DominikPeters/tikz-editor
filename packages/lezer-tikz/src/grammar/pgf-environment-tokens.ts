import type { InputStream } from "@lezer/lr";

/**
 * PGF's basic-layer environments that may stand in a TikZ picture body, and
 * the arguments `\begin{…}` reads (pgfcorelayers, pgfcorescopes,
 * pgfcoretransformations, pgfcoretransparency): `m` a mandatory brace group,
 * `o` an optional bracket group. The grammar's `PgfEnvironmentStatement`
 * reads their bodies as picture statements.
 */
export const PGF_ENVIRONMENT_ARGUMENTS: ReadonlyMap<string, readonly ("m" | "o")[]> = new Map([
  ["pgfonlayer", ["m"]],
  ["pgfscope", []],
  ["pgfinterruptboundingbox", []],
  ["pgftransparencygroup", ["o"]],
  ["pgflowlevelscope", ["m"]],
  ["pgfviewboxscope", ["m", "m", "m", "m", "m"]]
] as const);

export const PGF_ENVIRONMENT_NAMES: readonly string[] = [...PGF_ENVIRONMENT_ARGUMENTS.keys()];

const BACKSLASH = 92;
const PERCENT = 37;
const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const NEWLINE = 10;
const RETURN = 13;

export type PgfEnvironmentDelimiter = { kind: "begin" | "end"; name: string; length: number };

/**
 * A PGF environment's begin or end at the input, whose control word (after
 * the backslash) is `word` and ends at `offset`: `\begin{pgfonlayer}{name}`
 * and `\end{pgfonlayer}`, the plain forms `\pgfonlayer{name}` and
 * `\endpgfonlayer`, and ConTeXt's `\startpgfonlayer{name}` and
 * `\stoppgfonlayer`. A begin's length covers its arguments, read like TeX
 * reads them (spaces and comments before an argument are skipped); a
 * missing mandatory argument ends the delimiter, and the mapper reports it.
 */
export function readPgfEnvironmentDelimiter(input: InputStream, word: string, offset: number): PgfEnvironmentDelimiter | null {
  if (word === "begin" || word === "end") {
    const environment = readBracedName(input, offset);
    if (!environment || !PGF_ENVIRONMENT_ARGUMENTS.has(environment.name)) {
      return null;
    }
    return word === "begin"
      ? { kind: "begin", name: environment.name, length: readArguments(input, environment.name, environment.length) }
      : { kind: "end", name: environment.name, length: environment.length };
  }
  for (const [prefix, kind] of [["end", "end"], ["stop", "end"], ["start", "begin"], ["", "begin"]] as const) {
    if (!word.startsWith(prefix)) {
      continue;
    }
    const name = word.slice(prefix.length);
    if (!PGF_ENVIRONMENT_ARGUMENTS.has(name)) {
      continue;
    }
    return kind === "begin" ? { kind, name, length: readArguments(input, name, offset) } : { kind, name, length: offset };
  }
  return null;
}

function readArguments(input: InputStream, name: string, offset: number): number {
  let end = offset;
  for (const argument of PGF_ENVIRONMENT_ARGUMENTS.get(name) ?? []) {
    const start = skipSpaceAndComments(input, end);
    const open = argument === "m" ? OPEN_BRACE : OPEN_BRACKET;
    if (input.peek(start) !== open) {
      if (argument === "m") {
        break;
      }
      continue;
    }
    const close = readGroup(input, start, open, argument === "m" ? CLOSE_BRACE : CLOSE_BRACKET);
    if (close === null) {
      break;
    }
    end = close;
  }
  return end;
}

/** The end of the group opening at `offset`, or null when it is not closed. */
function readGroup(input: InputStream, offset: number, open: number, close: number): number | null {
  let depth = 0;
  let cursor = offset;
  for (;;) {
    const char = input.peek(cursor);
    if (char < 0) {
      return null;
    }
    if (char === BACKSLASH) {
      cursor += input.peek(cursor + 1) < 0 ? 1 : 2;
      continue;
    }
    if (char === PERCENT) {
      cursor = skipComment(input, cursor);
      continue;
    }
    cursor += 1;
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return cursor;
      }
    } else if (open === OPEN_BRACKET && char === OPEN_BRACE) {
      // Braces hide a `]` inside an optional argument.
      const inner = readGroup(input, cursor - 1, OPEN_BRACE, CLOSE_BRACE);
      if (inner === null) {
        return null;
      }
      cursor = inner;
    }
  }
}

function readBracedName(input: InputStream, offset: number): { name: string; length: number } | null {
  let cursor = offset;
  while (isSpace(input.peek(cursor))) {
    cursor += 1;
  }
  if (input.peek(cursor) !== OPEN_BRACE) {
    return null;
  }
  cursor += 1;
  let name = "";
  for (;;) {
    const char = input.peek(cursor);
    if (char === CLOSE_BRACE) {
      break;
    }
    if (char < 0 || char === OPEN_BRACE || char === BACKSLASH || char === PERCENT || char === NEWLINE || char === RETURN) {
      return null;
    }
    name += String.fromCharCode(char);
    cursor += 1;
  }
  return { name, length: cursor + 1 };
}

function skipSpaceAndComments(input: InputStream, offset: number): number {
  let cursor = offset;
  for (;;) {
    const char = input.peek(cursor);
    if (isSpace(char)) {
      cursor += 1;
    } else if (char === PERCENT) {
      cursor = skipComment(input, cursor);
    } else {
      return cursor;
    }
  }
}

function skipComment(input: InputStream, offset: number): number {
  let cursor = offset;
  while (input.peek(cursor) >= 0 && input.peek(cursor) !== NEWLINE && input.peek(cursor) !== RETURN) {
    cursor += 1;
  }
  return cursor;
}

function isSpace(char: number): boolean {
  return char === 32 || char === 9 || char === NEWLINE || char === RETURN;
}
