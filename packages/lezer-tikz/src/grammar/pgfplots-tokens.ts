import { ExternalTokenizer, type InputStream } from "@lezer/lr";

import {
  AddLegendEntryCmd,
  AddLegendImageCmd,
  AddPlot3Cmd,
  AddPlotCmd,
  BeginAxis,
  EndAxis,
  LegendCmd,
  PgfplotsExtraCmd,
  PgfplotsSetCmd,
  TableData,
  UsePgfplotsLibraryCmd,
  insertPlotSemicolon,
  insertSemicolon
} from "./tikz-parser.terms.js";

/**
 * The pgfplots axis environments the grammar's `AxisStatement` reads. A later
 * environment (`groupplot`, `polaraxis`) joins this list and the axis rule
 * stays the same; the AST records which name it was.
 */
export const AXIS_ENVIRONMENT_NAMES: readonly string[] = ["axis", "semilogxaxis", "semilogyaxis", "loglogaxis"];

const AXIS_ENVIRONMENTS: ReadonlySet<string> = new Set(AXIS_ENVIRONMENT_NAMES);

/**
 * pgfplots commands with a rule of their own. Each is a token only where the
 * grammar can take it (an axis body, or a statement position for
 * `\pgfplotsset`), so elsewhere, in a macro body or a node's text, it stays an
 * ordinary command name.
 */
const COMMAND_TERMS: ReadonlyMap<string, number> = new Map([
  ["addplot", AddPlotCmd],
  ["addlegendentry", AddLegendEntryCmd],
  ["addlegendentryexpanded", AddLegendEntryCmd],
  ["addlegendimage", AddLegendImageCmd],
  ["legend", LegendCmd],
  ["pgfplotsset", PgfplotsSetCmd],
  ["pgfplotsextra", PgfplotsExtraCmd],
  ["usepgfplotslibrary", UsePgfplotsLibraryCmd]
]);

const BACKSLASH = 92;
const PERCENT = 37;
const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;
const NEWLINE = 10;
const RETURN = 13;
const DIGIT_THREE = 51;

/**
 * Axis commands, before which an unknown command (`\pgfplotsinvokeforeach{…}{…}`)
 * or path still waiting for its `;` ends, as it does before `\end{axis}`.
 */
const AXIS_COMMANDS: ReadonlySet<string> = new Set([
  "addplot",
  "addlegendentry",
  "addlegendentryexpanded",
  "addlegendimage",
  "legend",
  "pgfplotsextra"
]);

/** Commands that cannot continue an `\addplot`'s trailing path: one before them means its `;` is missing. */
const PLOT_TERMINATING_COMMANDS: ReadonlySet<string> = new Set([
  "end",
  "addplot",
  "addlegendentry",
  "addlegendentryexpanded",
  "addlegendimage",
  "legend"
]);

export const pgfplotsTokens = new ExternalTokenizer(
  (input, stack) => {
    if (input.next === OPEN_BRACE) {
      if (stack.canShift(TableData)) {
        input.acceptToken(TableData, readBalancedBraces(input));
      }
      return;
    }
    if (input.next !== BACKSLASH) {
      return;
    }
    let length = 1;
    let name = "";
    while (isLetter(input.peek(length))) {
      name += String.fromCharCode(input.peek(length));
      length += 1;
    }
    // A missing `;` must not swallow the rest of the picture: an `\addplot`
    // waiting for it ends before any `\end{…}` or the next axis command, and
    // a path or unknown command waiting for it before `\end{axis}`. These
    // zero-length tokens close the statement; the diagnostics report it.
    if (PLOT_TERMINATING_COMMANDS.has(name) && stack.canShift(insertPlotSemicolon)) {
      input.acceptToken(insertPlotSemicolon);
      return;
    }
    if (stack.canShift(insertSemicolon) && (name === "end"
      ? AXIS_ENVIRONMENTS.has(readEnvironmentName(input, length)?.name ?? "")
      : AXIS_COMMANDS.has(name) && !stack.canShift(insertPlotSemicolon))) {
      input.acceptToken(insertSemicolon);
      return;
    }
    if (name === "begin" || name === "end") {
      const environment = readEnvironmentName(input, length);
      if (!environment || !AXIS_ENVIRONMENTS.has(environment.name)) {
        return;
      }
      if (name === "begin") {
        if (stack.canShift(BeginAxis)) {
          input.acceptToken(BeginAxis, environment.length);
        }
        return;
      }
      if (stack.canShift(EndAxis)) {
        input.acceptToken(EndAxis, environment.length);
      }
      return;
    }
    if (name === "addplot" && input.peek(length) === DIGIT_THREE) {
      if (stack.canShift(AddPlot3Cmd)) {
        input.acceptToken(AddPlot3Cmd, length + 1);
      }
      return;
    }
    const term = COMMAND_TERMS.get(name);
    if (term === undefined) {
      return;
    }
    if (stack.canShift(term)) {
      input.acceptToken(term, length);
      return;
    }
    // Like `\tikzset`, these start a statement of their own wherever one can
    // start, so in a preamble the command before them (`\usepackage{…}`,
    // read as an unknown statement) ends there instead of swallowing them.
    if ((term === PgfplotsSetCmd || term === UsePgfplotsLibraryCmd) && stack.canShift(insertSemicolon)) {
      input.acceptToken(insertSemicolon);
    }
  },
  { contextual: true }
);

/** `{name}` after `\begin`/`\end` at `offset`, with optional space before the brace. */
function readEnvironmentName(input: InputStream, offset: number): { name: string; length: number } | null {
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

/**
 * The length of a brace group at the input, raw: inline table data keeps its
 * newlines and spacing for the table reader. Braces nest; `\{`, `\}` are
 * escaped and a `%` comment hides a brace, as when TeX reads the argument.
 * An unclosed group runs to the end of the input.
 */
function readBalancedBraces(input: InputStream): number {
  let depth = 0;
  let offset = 0;
  for (;;) {
    const char = input.peek(offset);
    if (char < 0) {
      return offset;
    }
    if (char === BACKSLASH) {
      offset += input.peek(offset + 1) < 0 ? 1 : 2;
      continue;
    }
    if (char === PERCENT) {
      while (input.peek(offset) >= 0 && input.peek(offset) !== NEWLINE && input.peek(offset) !== RETURN) {
        offset += 1;
      }
      continue;
    }
    offset += 1;
    if (char === OPEN_BRACE) {
      depth += 1;
    } else if (char === CLOSE_BRACE) {
      depth -= 1;
      if (depth === 0) {
        return offset;
      }
    }
  }
}

function isLetter(char: number): boolean {
  return (char >= 65 && char <= 90) || (char >= 97 && char <= 122) || char === 64;
}

function isSpace(char: number): boolean {
  return char === 32 || char === 9 || char === NEWLINE || char === RETURN;
}
