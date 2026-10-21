import { ExternalTokenizer, type InputStream } from "@lezer/lr";
import { Dialect_beamer, OverlayClose, OverlayOpen } from "./tex-parser.terms.js";

// A Beamer overlay specification can only stand where the grammar accepts
// one. Elsewhere, in math above all (`x^Td<0`), `<` and `>` are ordinary
// text, rather than the start of a specification that swallows what follows.
//
// Where the grammar accepts one, `<` still opens a specification only where
// Beamer reads one: behind a command (`\item<2>`, `\only<1>{x}<2>`,
// `\item[label]<2>`, `\begin{block}<2>`) or first in a default overlay
// argument (`[<+->]`). And only if what follows up to `>` is written in the
// specification language (slide numbers, ranges, `+`/`.` with offsets, modes
// and actions: `<2-3,5>`, `<+(1)->`, `<1|handout:0>`, `<alert@2>`, `<>`), so
// that `a < b`, `\texttt{<tag>}` and listings' `escapeinside={<@}{@>}` stay text.
export const overlayTokens = new ExternalTokenizer((input, stack) => {
  if (!stack.dialectEnabled(Dialect_beamer)) return;
  if (input.next === LESS && stack.canShift(OverlayOpen) && followsOverlayTaker(input) && specificationFollows(input)) {
    input.advance();
    input.acceptToken(OverlayOpen);
  } else if (input.next === GREATER && stack.canShift(OverlayClose)) {
    input.advance();
    input.acceptToken(OverlayClose);
  }
}, { contextual: true });

const LESS = 60;
const GREATER = 62;
const BACKSLASH = 92;
const NEWLINE = 10;
const PERCENT = 37;
const MAX_SPECIFICATION_LENGTH = 200;

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

// Digits, letters, and `+ - . , ( ) | @ : * !`, with spaces between.
function isSpecificationCharacter(code: number): boolean {
  return isLetter(code) || (code >= 48 && code <= 57) ||
    code === 43 || code === 45 || code === 46 || code === 44 || code === 40 || code === 41 ||
    code === 124 || code === 64 || code === 58 || code === 42 || code === 33 ||
    code === 32 || code === 9;
}

/** Whether `<` stands behind a command, one of its arguments, or `[`. */
function followsOverlayTaker(input: InputStream): boolean {
  let offset = -1;
  // Spaces, comments, and one line break, which TeX skips looking for the
  // `<`. A comment ends with its line, so that line break does not count.
  let newlines = 0;
  for (;;) {
    const code = input.peek(offset);
    if (code === 32 || code === 9) {
      offset -= 1;
    } else if (code === NEWLINE) {
      const comment = commentBefore(input, offset);
      if (comment != null) offset = comment - 1;
      else if (newlines++ === 0) offset -= 1;
      else break;
    } else {
      break;
    }
  }
  const before = input.peek(offset);
  if (before === 125 || before === 93 || before === 91) return true; // } ] [
  if (before === 42 || before === 43) offset -= 1; // `\onslide*<3>`, `\onslide+<2->`
  if (!isLetter(input.peek(offset))) return false;
  while (isLetter(input.peek(offset))) offset -= 1;
  // A control word: its backslash is not itself escaped (`\\item` is text).
  let backslashes = 0;
  while (input.peek(offset - backslashes) === BACKSLASH) backslashes += 1;
  return backslashes % 2 === 1;
}

const MAX_LINE_LENGTH = 500;

/** Where the comment on the line ending at `lineEnd` starts, if it has one. */
function commentBefore(input: InputStream, lineEnd: number): number | null {
  let start = lineEnd - 1;
  while (start > lineEnd - MAX_LINE_LENGTH && input.peek(start) !== NEWLINE && input.peek(start) !== -1) start -= 1;
  for (let offset = start + 1; offset < lineEnd; offset += 1) {
    const code = input.peek(offset);
    if (code === BACKSLASH) offset += 1;
    else if (code === PERCENT) return offset;
  }
  return null;
}

function specificationFollows(input: InputStream): boolean {
  for (let offset = 1; offset <= MAX_SPECIFICATION_LENGTH; offset += 1) {
    const code = input.peek(offset);
    if (code === GREATER) return true;
    if (!isSpecificationCharacter(code)) return false;
  }
  return false;
}
