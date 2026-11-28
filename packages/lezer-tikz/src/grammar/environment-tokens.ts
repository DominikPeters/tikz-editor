import { ExternalTokenizer, type InputStream } from "@lezer/lr";

import { PGF_ENVIRONMENT_NAMES } from "./pgf-environment-tokens.js";
import { AXIS_ENVIRONMENT_NAMES } from "./pgfplots-tokens.js";
import { UnknownEnvironment, UnterminatedUnknownEnvironment } from "./tikz-parser.terms.js";

/**
 * Environments the grammar has its own rules for. The generic fallback leaves
 * them to those rules; an environment that gains a rule (pgfplots' `axis`,
 * say) joins this set so its `\begin` reaches the specific tokens.
 */
export const ENVIRONMENTS_WITH_RULES: ReadonlySet<string> = new Set([
  "scope",
  "tikzpicture",
  "tikzpicture*",
  "tikzlayer",
  ...AXIS_ENVIRONMENT_NAMES,
  ...PGF_ENVIRONMENT_NAMES
]);

const BACKSLASH = 92;
const PERCENT = 37;
const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;
const NEWLINE = 10;
const RETURN = 13;

type EnvironmentDelimiter = { kind: "begin" | "end"; name: string; length: number };

/**
 * Any other `\begin{x}…\end{x}` in a picture body, read as one token so an
 * environment the editor does not understand is skipped as a unit rather than
 * swallowing the statements after it. The body is not tokenized; only
 * comments (a `%` hides an `\end{x}` from LaTeX too), control sequences
 * (`\%` is not a comment) and nested environment delimiters are read.
 *
 * Nested environments of any name, the same name included, are matched like
 * LaTeX's environment stack. An `\end{y}` naming none of the open
 * environments closes something around this one (`\end{scope}`,
 * `\end{tikzpicture}`), so the environment is unterminated and the token
 * stops before it, as it does at the end of the input.
 */
export const unknownEnvironmentTokens = new ExternalTokenizer(
  (input, stack) => {
    if (input.next !== BACKSLASH) {
      return;
    }
    const begin = readEnvironmentDelimiter(input, 0);
    if (begin?.kind !== "begin" || ENVIRONMENTS_WITH_RULES.has(begin.name)) {
      return;
    }
    const canComplete = stack.canShift(UnknownEnvironment);
    const canRecover = stack.canShift(UnterminatedUnknownEnvironment);
    if (!canComplete && !canRecover) {
      return;
    }

    const open: string[] = [begin.name];
    let offset = begin.length;
    for (;;) {
      const char = input.peek(offset);
      if (char < 0) {
        break;
      }
      if (char === PERCENT) {
        offset = skipComment(input, offset);
        continue;
      }
      if (char !== BACKSLASH) {
        offset += 1;
        continue;
      }
      const delimiter = readEnvironmentDelimiter(input, offset);
      if (!delimiter) {
        offset = skipControlSequence(input, offset);
        continue;
      }
      if (delimiter.kind === "begin") {
        open.push(delimiter.name);
        offset += delimiter.length;
        continue;
      }
      const depth = open.lastIndexOf(delimiter.name);
      if (depth < 0) {
        break;
      }
      open.length = depth;
      offset += delimiter.length;
      if (open.length === 0) {
        if (canComplete) {
          input.acceptToken(UnknownEnvironment, offset);
        }
        return;
      }
    }

    if (canRecover) {
      // Leave the whitespace before the delimiter that stopped the scan to
      // the enclosing body, so the statement ends where its text does.
      while (offset > begin.length && isSpace(input.peek(offset - 1))) {
        offset -= 1;
      }
      input.acceptToken(UnterminatedUnknownEnvironment, offset);
    }
  },
  { contextual: true }
);

/** `\begin{name}` or `\end{name}` at `offset`, with optional space before the brace. */
function readEnvironmentDelimiter(input: InputStream, offset: number): EnvironmentDelimiter | null {
  if (input.peek(offset) !== BACKSLASH) {
    return null;
  }
  let kind: EnvironmentDelimiter["kind"];
  let cursor = offset + 1;
  if (matches(input, cursor, "begin")) {
    kind = "begin";
    cursor += 5;
  } else if (matches(input, cursor, "end")) {
    kind = "end";
    cursor += 3;
  } else {
    return null;
  }
  if (isLetter(input.peek(cursor))) {
    return null;
  }
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
  if (name.length === 0) {
    return null;
  }
  return { kind, name, length: cursor + 1 - offset };
}

function skipComment(input: InputStream, offset: number): number {
  let cursor = offset;
  for (;;) {
    const char = input.peek(cursor);
    if (char < 0 || char === NEWLINE || char === RETURN) {
      return cursor;
    }
    cursor += 1;
  }
}

function skipControlSequence(input: InputStream, offset: number): number {
  let cursor = offset + 1;
  if (!isLetter(input.peek(cursor))) {
    // A control symbol: `\%`, `\\`, `\{`. At the end of input, just the backslash.
    return input.peek(cursor) < 0 ? cursor : cursor + 1;
  }
  while (isLetter(input.peek(cursor))) {
    cursor += 1;
  }
  return cursor;
}

function matches(input: InputStream, offset: number, text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (input.peek(offset + index) !== text.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function isLetter(char: number): boolean {
  return (char >= 65 && char <= 90) || (char >= 97 && char <= 122) || char === 64;
}

function isSpace(char: number): boolean {
  return char === 32 || char === 9 || char === NEWLINE || char === RETURN;
}
