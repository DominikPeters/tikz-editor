import type { CommandSchema, CommandTable } from "../commands/table.js";
import { capabilityChain, decideOwner } from "../ownership/keys.js";
import type { InteractionState } from "../input/interaction.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import { texMathCommandFamily } from "../../text/tex/math/parser.js";
import type { EditMode, SlotId, Span } from "../tree/types.js";
import type { EditOutcome } from "./delete.js";
import { insideOptional, placeholderAt } from "./insert.js";
import { PatchSet } from "./source.js";
import { inkOnLine } from "./structure.js";

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
 * - `overlay` (`<`): the overlay specification, opened (`\only<‸>{}`), for
 *   a command that takes one.
 * - `typed`: just the name (another character ended the chip and is
 *   processed next).
 *
 * A selection held by the chip (R10) goes into the command's first
 * rendered argument (`\emph{⟦main idea⟧}`, `\frac{a}{‸}`); a command
 * without one replaces it.
 */
export type CommitKey = "space" | "structure" | "brace" | "bracket" | "overlay" | "typed";

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

  if (key === "overlay" && schema?.args.some((arg) => arg.kind === "overlay")) {
    // The specification goes right after the name; a held selection into the content, as for ␣.
    const rest = held && mandatory.length > 0 ? commitCommand(view, table, caret, at, name, "structure", state, held).outcome : null;
    const after = rest?.kind === "patch" && rest.patches.length === 1 ? rest.patches[0].insert.slice(command.length) : "{}".repeat(mandatory.length);
    const range = held ?? { from: at, to: at };
    return { outcome: edit(range, `${command}<>${after}`, range.from + command.length + 1) };
  }
  if (held && mandatory.length > 0) {
    // The selection goes into an argument of its own mode only (not math into `\emph{…}`).
    const target = schema!.args.find((arg) => arg.kind === "mandatory" && arg.rendered);
    if (target && (target.mode ?? (mode === "verbatim" ? "text" : mode)) !== mode) {
      return { outcome: { kind: "none" } };
    }
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
  // Committed as typed right before existing content, a command that takes
  // arguments would take that content (`\\frac` before `bc`): it gets its
  // braces instead, as for ␣.
  // (TeX skips spaces before an undelimited argument, but not a paragraph break.)
  const ahead = /^[ \t]*\n?[ \t]*(.)/u.exec(tree.text.slice(range.to))?.[1] ?? "";
  // (Even `&` would be taken, and break; in math a `$` closes, as `}` does.)
  const absorbs = key === "typed" && mandatory.length > 0 && ahead !== "" && ahead !== "}" && !(mode === "math" && ahead === "$");
  if (mandatory.length > 0 && (key !== "typed" || absorbs)) {
    // (Before a `<`, beamer would read it as a specification after the argument: `\emph{}{}<`.)
    const guard = mode === "text" && /^\s*</u.test(tree.text.slice(range.to)) ? "{}" : "";
    const insert = command + "{}".repeat(mandatory.length) + guard;
    return { outcome: edit(range, insert, range.from + command.length + 1) };
  }
  // The name alone, terminated as what follows needs (R5): after placeholder braces it replaces, what follows them.
  const followsAt = placeholder ? placeholder.open + 2 : range.to;
  const following = tree.text.slice(followsAt, followsAt + 1);
  // Even a name committed as typed must not absorb the letters after the caret (`\te` before `lpha`).
  const tail = key === "space" && mode !== "math" ? textSpaceTail(schema, following) : letterTerminator(following, mode);
  const text = command + tail;
  if (placeholder && tail.trim() === "" && (mandatory.length === 0 || key === "typed")) {
    // A symbol TeX reads as one token replaces the braces (M12: `\mu^\top`); anything else
    // (`\ldots`, `\sum`, `\bf`, a user macro) keeps them, the caret leaving them after a
    // command without arguments as after a single character (R6: `x^{\ldots}‸`).
    const span = { from: placeholder.open, to: placeholder.open + 2 };
    const bare = mandatory.length === 0 && schema?.category === "symbol" && !MULTI_TOKEN_SYMBOLS.has(name);
    const insert = bare ? text : `{${command}}`;
    const patches = new PatchSet().replace(span, insert).patches();
    const inside = span.from + (bare ? 0 : 1) + command.length;
    return {
      outcome: { kind: "patch", patches, caret: mandatory.length === 0 ? span.from + insert.length : inside, run: null },
      pending: optionalFirst ? inside : undefined,
    };
  }
  return {
    outcome: edit(range, text, range.from + text.length),
    pending: optionalFirst && key === "typed" ? range.from + command.length : undefined,
  };
}

/**
 * A command that only exists in the other mode. A math command committed
 * in prose starts a formula: `$\frac{‸}{}$`, `$\left(‸\right)$`, and
 * `$\alpha$ ` after ␣, which leaves it (any other key stays inside, where
 * the character typed with it goes). A text command in math goes into
 * `\text{…}` (`\text{\LaTeX}`); a declaration, break, vertical or overlay
 * command has no place in a formula and writes nothing ("refused"), as
 * `\right` and `\middle` without their `\left` in prose.
 *
 * Null when the command is known where it is typed, or nowhere (an
 * unknown command is committed as it is).
 */
export function commitAcrossModes(
  view: EditView,
  table: CommandTable,
  caret: Position,
  at: number,
  name: string,
  key: CommitKey,
  held: Span | null,
  delimiter = "("
): CommandCommit | "refused" | null {
  const { tree } = view;
  const mode = tree.slots[caret.slot].mode;
  if (mode === "verbatim" || table.command(name, mode)) {
    return null;
  }
  const schema = table.command(name, mode === "math" ? "text" : "math");
  if (!schema) {
    return null;
  }
  if (mode === "math" ? ["declaration", "vertical", "break", "overlay"].includes(schema.category) : name === "right" || name === "middle") {
    return "refused";
  }
  const mandatory = schema.args.filter((arg) => arg.kind === "mandatory").length;
  if (held && (mandatory > 0 || name === "left")) {
    // A selection of one mode does not go into an argument of the other.
    return "refused";
  }
  const range = held ?? { from: at, to: at };
  const [open, close] = mode === "math" ? ["\\text{", "}"] : ["$", "$"];
  const command = `\\${name}`;
  let inner = command;
  // Where the caret goes in `inner`; null: after the whole.
  let inside: number | null = null;
  if (name === "left") {
    inner = `\\left${delimiter}\\right${DELIMITER_PAIRS[delimiter] ?? ")"}`;
    inside = `\\left${delimiter}`.length;
  } else if (key === "bracket" && schema.args.find((arg) => arg.kind !== "overlay")?.kind === "optional") {
    inner = `${command}[]${"{}".repeat(mandatory)}`;
    inside = command.length + 1;
  } else if (mandatory > 0) {
    inner = command + "{}".repeat(mandatory);
    inside = command.length + 1;
  } else if (mode === "text" && key !== "space") {
    inside = command.length;
  }
  const following = tree.text.slice(range.to, range.to + 1);
  const tail = inside == null && mode === "text" && !/^[ \t]$/u.test(following) ? " " : "";
  // In an optional argument (an `\item` or `\bibitem` label), a `]` would end it: the whole goes in braces.
  const [before, after] = inner.includes("]") && insideOptional(view, caret.slot) ? ["{", "}"] : ["", ""];
  const insert = before + open + inner + close + after + tail;
  const caretAt = inside == null ? range.from + insert.length : range.from + before.length + open.length + inside;
  return { outcome: edit(range, insert, caretAt) };
}

/**
 * Whether a line break (`\\\\`, `\\newline`) may go at `at`: as ⇧⏎
 * (structure.ts), a row's own cell ends the row; elsewhere TeX needs a
 * line to end, which formulas, displays, titles and boxes do not have,
 * nor a line with nothing on it yet.
 */
export function lineEndable(view: EditView, caret: Position, at: number): boolean {
  const { tree } = view;
  if (tree.slots[caret.slot].role === "cell") {
    return true;
  }
  const decision = decideOwner(capabilityChain(tree, "line-break", caret.slot));
  return decision.kind !== "stop" && tree.nodes[decision.node].kind !== "row" && inkOnLine(view, caret.slot, at);
}

/** Text commands that survive bold math (`\bm`, `\boldsymbol`): LR boxes, and colour without beamer's overlays. */
const BOLD_MATH_TEXT = new Set(["text", "mbox", "textcolor", "colorbox", "underline"]);

/** Whether a slot is inside `\bm{…}` or `\boldsymbol{…}`. */
export function inBoldMath(view: EditView, slot: SlotId): boolean {
  const { tree } = view;
  for (let current: SlotId | null = slot; current != null; current = tree.nodes[tree.slots[current].node].parent) {
    const command = tree.nodes[tree.slots[current].node].command;
    if (command === "bm" || command === "boldsymbol") {
      return true;
    }
  }
  return false;
}

/**
 * Whether a command breaks bold math: `\bm` expands its argument, which
 * beamer's overlay-aware commands (its font commands, `\only`, `\color`),
 * links, labels and notes do not survive. LuaLaTeX loops on most of them.
 */
export function breaksBoldMath(table: CommandTable, name: string): boolean {
  if (BOLD_MATH_TEXT.has(name)) {
    return false;
  }
  if (name === "operatorname" || texMathCommandFamily(`\\${name}`) === "text") {
    return true;
  }
  const text = table.command(name, "text");
  // (A user macro is the author's: their deck says whether it works there.)
  return text != null && !text.userMacro && (text.args.some((arg) => arg.kind === "overlay") || ["link", "atom", "vertical", "overlay"].includes(text.category));
}

/**
 * The control symbols LaTeX (with amsmath) defines in each mode, besides
 * `\{`, `\}`, `\[`, `\(` and `\\`, which commit to pairs and breaks:
 * `\<` or `\?` is undefined, and the accents (`\'`, `\^`) are text-only.
 */
const CONTROL_SYMBOLS: Readonly<Record<"text" | "math", string>> = {
  text: "%$#&_ ,;:!'\"`^~=.-/@",
  math: "%$#&_ ,;:!>|-/@*",
};

/** Whether `\` and a character is a control symbol the mode defines. */
export function isControlSymbol(char: string, mode: EditMode): boolean {
  return "{}[(\\".includes(char) || CONTROL_SYMBOLS[mode === "math" ? "math" : "text"].includes(char);
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
    case "\\": {
      if (!lineEndable(view, caret, range.from)) {
        return null;
      }
      // Before an existing `[` or `*`, the break must not take it as its spacing or star (K9).
      if (/^\s*[[*]/u.test(tree.text.slice(range.to))) {
        return { outcome: edit(range, "\\\\{}", range.from + 4) };
      }
      return { outcome: edit(range, "\\\\", range.from + 2), pending: range.from + 2 };
    }
    default: {
      // A text accent takes the next character as its argument: given its
      // own braces, it never grabs the text after the caret (`\\^{}`, as R2).
      const insert = mode === "text" && TEXT_ACCENTS.has(char) ? `\\${char}{}` : `\\${char}`;
      return { outcome: edit(range, insert, range.from + insert.length) };
    }
  }
}

/**
 * `\left` and a delimiter: the pair, with its closer (R3, M14), around a
 * held selection, which stays selected inside.
 */
export function commitLeftDelimiter(text: string, at: number, held: Span | null, opener: string): EditOutcome | null {
  const closer = DELIMITER_PAIRS[opener];
  if (closer == null) {
    return null;
  }
  const range = held ?? { from: at, to: at };
  const open = `\\left${opener}`;
  const selected = text.slice(range.from, range.to);
  const caret = range.from + open.length;
  return {
    kind: "patch",
    patches: [{ from: range.from, to: range.to, insert: `${open}${selected}\\right${closer}` }],
    caret,
    run: null,
    exact: true,
    ...(selected ? { selectionEnd: caret + selected.length } : {}),
  };
}

/** Characters that are delimiters after `\left` and `\right`. */
export const DELIMITER_CHARACTERS = new Set(["(", ")", "[", "]", "|", ".", "/"]);

const TEXT_ACCENTS = new Set(["^", "'", "`", "\"", "~", "=", "."]);

/**
 * Math symbols that are macros of several tokens in LaTeX (with amsmath,
 * as beamer loads it), so a script cannot take one bare: `x^\ldots` is
 * "Missing { inserted". Found by compiling `x^\name` for every symbol;
 * test/editing/keystroke-tex-oracle.spec.ts checks the list against TeX.
 */
export const MULTI_TOKEN_SYMBOLS: ReadonlySet<string> = new Set([
  "ldots", "cdots", "vdots", "ddots", "dots", "pmod", "bmod", "mod", "notin", "iff", "impliedby", "implies",
  "longrightarrow", "Longrightarrow", "dasharrow", "dashleftarrow", "dashrightarrow", "Join", "colon",
]);

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
