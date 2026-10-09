import type { CommandSchema, CommandTable } from "../commands/table.js";
import type { InteractionState } from "../input/interaction.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import type { EditMode, Span } from "../tree/types.js";
import type { EditOutcome } from "./delete.js";
import { placeholderAt } from "./insert.js";
import { PatchSet } from "./source.js";

/**
 * Committing a command from the chip (R4): what `\name` plus the key that
 * ended the chip writes.
 * - `space`: in text a visible word space as well (`\LaTeX{} `, P6), but
 *   a declaration's space only terminates it (`\bf `); in math, nothing
 *   visible (K7).
 * - `structure` (⏎, ⇥): the mandatory arguments as empty braces, the caret
 *   in the first.
 * - `brace` (`{`): as `structure`; a command without arguments is
 *   committed and the `{` opens a group after it.
 * - `bracket` (`[`): the optional first argument, opened (`\sqrt[‸]{}`, K9).
 * - `typed`: just the name (another character ended the chip and is
 *   processed next).
 *
 * A selection held by the chip (R10) goes into the command's first
 * rendered argument (`\emph{⟦main idea⟧}`, `\frac{a}{‸}`); a command
 * without one replaces it.
 */
export type CommitKey = "space" | "structure" | "brace" | "bracket" | "typed";

export type CommandCommit = {
  readonly outcome: EditOutcome;
  /** The command just written, when its optional argument may still be opened by `[` (O4). */
  readonly pending?: number;
};

export function commitCommand(
  view: EditView,
  table: CommandTable,
  caret: Position,
  at: number,
  name: string,
  key: CommitKey,
  state: InteractionState,
  held: Span | null
): CommandCommit {
  const { tree } = view;
  const mode = tree.slots[caret.slot].mode;
  const schema = table.command(name, mode === "verbatim" ? "text" : mode);
  const mandatory = schema?.args.filter((arg) => arg.kind === "mandatory") ?? [];
  const optionalFirst = schema?.args.find((arg) => arg.kind !== "overlay")?.kind === "optional";
  const command = `\\${name}`;

  if (held && mandatory.length > 0) {
    const wrapped = wrapSelection(tree.text, schema!, command, held);
    if (wrapped) {
      return { outcome: wrapped };
    }
  }
  const range = held ?? { from: at, to: at };
  // Placeholder braces (`x^{‸}`) take a single token in their place.
  const placeholder = state.placeholder != null && !held ? placeholderAt(view, state.placeholder, at) : null;

  if (key === "bracket" && optionalFirst) {
    const insert = `${command}[]${"{}".repeat(mandatory.length)}`;
    return { outcome: edit(range, insert, range.from + command.length + 1) };
  }
  if (mandatory.length > 0 && key !== "typed") {
    const insert = command + "{}".repeat(mandatory.length);
    return { outcome: edit(range, insert, range.from + command.length + 1) };
  }
  // The name alone, terminated as what follows needs (R5).
  const following = tree.text.slice(range.to, range.to + 1);
  let tail = "";
  if (key === "space") {
    tail = mode === "math" ? letterTerminator(following, "math") : textSpaceTail(schema, following);
  } else if (key !== "typed") {
    tail = letterTerminator(following, mode);
  }
  const text = command + tail;
  if (placeholder && tail.trim() === "" && (mandatory.length === 0 || key === "typed")) {
    const span = { from: placeholder.open, to: placeholder.open + 2 };
    const patches = new PatchSet().replace(span, text).patches();
    return {
      outcome: { kind: "patch", patches, caret: span.from + text.length, run: null },
      pending: optionalFirst ? span.from + command.length : undefined,
    };
  }
  return {
    outcome: edit(range, text, range.from + text.length),
    pending: optionalFirst && key === "typed" ? range.from + command.length : undefined,
  };
}

/** `\\`, `\%`, `\{`: a control symbol, committed as soon as its character is typed. */
export function commitControlSymbol(view: EditView, caret: Position, at: number, char: string, held: Span | null): CommandCommit | null {
  const { tree } = view;
  const mode = tree.slots[caret.slot].mode;
  const range = held ?? { from: at, to: at };
  switch (char) {
    case "{":
      // Set braces pair (K3).
      return { outcome: edit(range, "\\{\\}", range.from + 2) };
    case "}":
      if (!held && tree.text.startsWith("\\}", at)) {
        return { outcome: { kind: "patch", patches: [], caret: at + 2, run: null, exact: true } };
      }
      return { outcome: edit(range, "\\}", range.from + 2) };
    case "[":
      return mode === "math" ? null : { outcome: edit(range, "\\[\\]", range.from + 2) };
    case "(":
      return mode === "math" ? null : { outcome: edit(range, "\\(\\)", range.from + 2) };
    case "\\":
      return { outcome: edit(range, "\\\\", range.from + 2), pending: range.from + 2 };
    default:
      return { outcome: edit(range, `\\${char}`, range.from + 1 + char.length) };
  }
}

/** `\left` and a delimiter: the pair, with its closer (R3, M14). */
export function commitLeftDelimiter(at: number, held: Span | null, opener: string): EditOutcome | null {
  const closer = DELIMITER_PAIRS[opener];
  if (closer == null) {
    return null;
  }
  const range = held ?? { from: at, to: at };
  const open = `\\left${opener}`;
  return edit(range, `${open}\\right${closer}`, range.from + open.length);
}

const DELIMITER_PAIRS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "|": "|", ".": "." };

/**
 * Wraps a held selection into the command's first rendered argument:
 * other arguments get empty braces, and the caret goes into the next one
 * after it, else the first value before it (`\textcolor{‸}{risk}`), else
 * the selection stays selected inside (`\emph{⟦main idea⟧}`, F7).
 */
function wrapSelection(text: string, schema: CommandSchema, command: string, held: Span): EditOutcome | null {
  const args = schema.args.filter((arg) => arg.kind === "mandatory");
  const target = args.findIndex((arg) => arg.rendered);
  if (target < 0) {
    return null;
  }
  const selected = text.slice(held.from, held.to);
  let insert = command;
  const openings: number[] = [];
  args.forEach((_, index) => {
    openings.push(held.from + insert.length + 1);
    insert += index === target ? `{${selected}}` : "{}";
  });
  const after = openings[target + 1];
  const before = openings.slice(0, target)[0];
  const patches = [{ from: held.from, to: held.to, insert }];
  if (after != null || before != null) {
    return { kind: "patch", patches, caret: (after ?? before), run: null, exact: true };
  }
  const start = openings[target];
  return { kind: "patch", patches, caret: start, run: null, exact: true, selectionEnd: start + selected.length };
}

function edit(range: Span, insert: string, caret: number): EditOutcome {
  return { kind: "patch", patches: [{ from: range.from, to: range.to, insert }], caret, run: null, exact: true };
}

/** R5: what keeps a control word from absorbing the letter after it. */
function letterTerminator(following: string, mode: EditMode): string {
  if (!/^[A-Za-z@]$/u.test(following)) {
    return "";
  }
  return mode === "math" ? " " : "{}";
}

/**
 * A commit space in text: a declaration (`\bf`, `\small`) or a spacing
 * command takes it as its terminator; anything else renders, and is
 * followed by a visible space (`\LaTeX{} `), unless one is already there.
 */
function textSpaceTail(schema: CommandSchema | null, following: string): string {
  // A line end is no word space (TeX drops spaces at a paragraph's end).
  if (schema && ["declaration", "spacing", "vertical"].includes(schema.category)) {
    return /^[ \t]$/u.test(following) ? "" : " ";
  }
  return /^[ \t]$/u.test(following) ? "{}" : "{} ";
}
