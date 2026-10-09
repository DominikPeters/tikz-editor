import type { CommandSchema, CommandTable } from "../commands/table.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import { GLUE } from "../tree/build.js";
import type { EditNode, EditValue, Span } from "../tree/types.js";
import type { CommitKey } from "./command.js";
import type { EditOutcome } from "./delete.js";
import { insideOptional } from "./insert.js";
import { specColumns, widestRow } from "./structure.js";

/**
 * Value arguments (O8): colours, URLs, lengths, keys and the like, which
 * the preview does not show as text. They are never written empty: a
 * command that needs one opens the value editor, which shows the
 * command's syntax with a field per value, and the command is written
 * whole once every field is filled. Values already written are edited
 * through the same fields.
 */
export type ValueKind = EditValue["role"];

/** One field of the value editor: an argument of the command, with its delimiters. */
export type ValueField = {
  /** Index into the command's arguments. */
  readonly argument: number;
  readonly kind: ValueKind;
  /** An optional argument (or overlay specification): left out when empty. */
  readonly optional: boolean;
  readonly open: string;
  readonly close: string;
};

/**
 * The fields a command commit asks for: every mandatory value, and the
 * optional argument or overlay specification the commit key opened
 * (`[` after `\textcolor` asks for its colour model, `<` for its slides).
 */
export function valueFields(schema: CommandSchema, key?: CommitKey): ValueField[] {
  const firstOptional = schema.args.findIndex((arg) => arg.kind !== "overlay");
  const required = REQUIRED_OPTIONAL[schema.name];
  return schema.args.flatMap((arg, argument): ValueField[] => {
    const kind = arg.role as ValueKind;
    if (arg.rendered) {
      return [];
    }
    if (required != null && arg.kind === required) {
      return [{ argument, kind, optional: false, open: arg.kind === "overlay" ? "<" : "[", close: arg.kind === "overlay" ? ">" : "]" }];
    }
    if (arg.kind === "mandatory") {
      return [{ argument, kind, optional: false, open: "{", close: "}" }];
    }
    if (arg.kind === "overlay" && key === "overlay") {
      return [{ argument, kind, optional: true, open: "<", close: ">" }];
    }
    if (arg.kind === "optional" && key === "bracket" && argument === firstOptional) {
      return [{ argument, kind, optional: true, open: "[", close: "]" }];
    }
    return [];
  });
}

/**
 * Arguments TeX marks optional that a command cannot do without:
 * `\temporal` needs its slides ("Use of \temporal doesn't match its
 * definition"), and `\setbeamertemplate{name}` without its option reads
 * what follows as the template.
 */
const REQUIRED_OPTIONAL: Readonly<Record<string, "overlay" | "optional">> = { temporal: "overlay", setbeamertemplate: "optional" };

/** Whether a command commit needs the value editor: it has a value no commit may leave empty. */
export function needsValues(schema: CommandSchema): boolean {
  return schema.name in REQUIRED_OPTIONAL || schema.args.some((arg) => !arg.rendered && arg.kind === "mandatory");
}

const COLOR_NAME = String.raw`(?:[A-Za-z][A-Za-z0-9]*|\.)`;
/** An xcolor expression: a name, mixes with percentages (`red!30!blue`), a leading `-` for the complement. */
const COLOR = new RegExp(String.raw`^-?${COLOR_NAME}(?:!\d+(?:\.\d+)?(?:!-?${COLOR_NAME})?)*$`, "u");
/** A TeX length or glue (`2em`, `-.5\textwidth`, `\fill`, `1em plus 1fil`), or `\stretch{2}`. */
const LENGTH = new RegExp(String.raw`^(?:${GLUE}|\s*\\stretch\s*\{\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*\})\s*$`, "u");
/** A beamer overlay specification's content (`2-`, `+-`, `1-3,5| alert@2`, `handout:0`). */
const OVERLAY = /^[A-Za-z0-9+\-,|@:.()* ]+$/u;
/** A `\label`/`\ref`/`\cite` key: no TeX specials. */
const KEY = /^[^{}\\%#~$^&]+$/u;

/**
 * Why a value cannot be written as typed, or null when it can. An empty
 * optional value is fine (it is left out). `model`: the colour is given
 * in a colour model (`\textcolor[rgb]{1,0,0}`), so it is not an xcolor
 * expression.
 */
export function valueProblem(kind: ValueKind, text: string, optional = false, model = false): string | null {
  const value = text.trim();
  if (value === "") {
    return optional ? null : "Needs a value";
  }
  if (!balancedBraces(value)) {
    return "Braces do not balance";
  }
  if (/\n[ \t]*\n/u.test(value)) {
    return "A blank line ends the argument";
  }
  if (kind !== "url" && /(?:^|[^\\])(?:\\\\)*[%#]/u.test(value)) {
    return "A % or # needs a backslash";
  }
  switch (kind) {
    case "color":
      return model || COLOR.test(value) ? null : "Not an xcolor colour (red, red!30, red!30!blue)";
    case "dimension":
      return LENGTH.test(value) ? null : "Not a TeX length (2em, 0.5\\textwidth, \\fill)";
    case "overlay":
      return OVERLAY.test(value) ? null : "Not an overlay specification (2-, +-, 1-3)";
    case "label-key":
      return KEY.test(value) ? null : "A key cannot hold TeX specials";
    case "url":
    case "options":
    case "spec":
    case "value":
      return null;
  }
}

/**
 * The source a value is written as: trimmed; in a URL, `%` and `#`
 * escaped, which a frame read as an argument would otherwise take as a
 * comment and a parameter; in brackets, a `]` braced, which would end the
 * argument early.
 */
export function valueSource(kind: ValueKind, text: string, open = "{"): string {
  let value = text.trim();
  if (kind === "url") {
    value = value.replace(/(?<!\\)(?:\\\\)*[%#]/gu, (match) => `${match.slice(0, -1)}\\${match.at(-1)}`);
  }
  if (open === "[" && closesBracket(value)) {
    value = `{${value}}`;
  }
  return value;
}

function balancedBraces(text: string): boolean {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

/** Whether a `]` stands outside braces. */
function closesBracket(text: string): boolean {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    } else if (char === "]" && depth === 0) {
      return true;
    }
  }
  return false;
}

/** Problems with a full set of field values, by field; null when all can be written. */
export function fieldProblems(fields: readonly ValueField[], values: readonly string[]): (string | null)[] | null {
  const model = fields.some((field) => field.open === "[" && (values[fields.indexOf(field)] ?? "").trim() !== "");
  const problems = fields.map((field, index) => valueProblem(field.kind, values[index] ?? "", field.optional, model && field.kind === "color"));
  return problems.some((problem) => problem != null) ? problems : null;
}

/**
 * Writes a command with its values filled in, at `at` or around the held
 * selection, which goes into its first rendered argument. The caret goes
 * into the first empty rendered argument (after the selection's, when
 * there is one), else the selection stays selected inside, else the caret
 * goes after the command. A command of the other mode goes into
 * `\text{…}` in math and `$…$` in prose, as the chip writes it.
 */
export function commitWithValues(
  view: EditView,
  table: CommandTable,
  caret: Position,
  at: number,
  name: string,
  held: Span | null,
  fields: readonly ValueField[],
  values: readonly string[]
): EditOutcome {
  const { tree } = view;
  const mode = tree.slots[caret.slot].mode === "math" ? "math" : "text";
  const own = table.command(name, mode);
  const schema = own ?? table.command(name, mode === "math" ? "text" : "math");
  if (!schema || fieldProblems(fields, values)) {
    return { kind: "none" };
  }
  const target = held ? schema.args.findIndex((arg) => arg.kind === "mandatory" && arg.rendered) : -1;
  const selected = held ? tree.text.slice(held.from, held.to) : "";
  let command = `\\${name}`;
  // (Set in the loop below; typed wide, as narrowing does not see into its callback.)
  let caretIn = null as number | null;
  let contentStart = null as number | null;
  schema.args.forEach((arg, argument) => {
    const index = fields.findIndex((field) => field.argument === argument);
    if (index >= 0) {
      const field = fields[index];
      const value = values[index].trim();
      if (value !== "" || !field.optional) {
        command += field.open + valueSource(field.kind, value, field.open) + field.close;
      }
      return;
    }
    if (arg.kind !== "mandatory") {
      return;
    }
    if (argument === target) {
      contentStart = command.length + 1;
      command += `{${selected}}`;
      return;
    }
    if (caretIn == null && arg.rendered && (target < 0 || argument > target)) {
      caretIn = command.length + 1;
    }
    command += "{}";
  });
  const [open, close] = own ? ["", ""] : mode === "math" ? ["\\text{", "}"] : ["$", "$"];
  const range = held ?? { from: at, to: at };
  // In an optional argument (an `\item` label), a `]` would end it: the whole goes in braces.
  const [before, after] = (open + command + close).includes("]") && insideOptional(view, caret.slot) ? ["{", "}"] : ["", ""];
  // (Before a `<`, beamer would read it as a specification after the command: `\url{x}{}<`.)
  const guard = mode === "text" && /^\s*</u.test(tree.text.slice(range.to)) ? "{}" : "";
  const insert = before + open + command + close + after + guard;
  const offset = range.from + before.length + open.length;
  const patches = [{ from: range.from, to: range.to, insert }];
  if (caretIn != null) {
    return { kind: "patch", patches, caret: offset + caretIn, run: null, exact: true };
  }
  if (contentStart != null) {
    return { kind: "patch", patches, caret: offset + contentStart, run: null, exact: true, selectionEnd: offset + contentStart + selected.length };
  }
  return { kind: "patch", patches, caret: range.from + insert.length - guard.length, run: null, exact: true };
}

/** A value already written: the node it belongs to, and its delimiters. */
export type WrittenValue = {
  readonly node: EditNode;
  readonly value: EditValue;
  readonly open: string;
  readonly optional: boolean;
};

/** The value whose content is exactly `span`, if any. */
export function writtenValueAt(view: EditView, span: Span): WrittenValue | null {
  for (const node of view.tree.nodes) {
    const value = node.values.find((candidate) => candidate.contentSpan.from === span.from && candidate.contentSpan.to === span.to);
    if (value) {
      // (An unbraced value, `\bigr)`, has no delimiter: its first character is its content.)
      const open = value.span.from < value.contentSpan.from ? view.tree.text[value.span.from] : "";
      return { node, value, open, optional: open === "[" || open === "<" };
    }
  }
  return null;
}

/**
 * Edits values already written, each named by its content span: in one
 * patch set. An optional value set empty is removed with its delimiters;
 * a mandatory one cannot be. Null when an edit names no value, or a value
 * cannot be written.
 */
export function editValues(view: EditView, edits: readonly { readonly span: Span; readonly text: string }[]): { from: number; to: number; insert: string }[] | null {
  const { text } = view.tree;
  const patches: { from: number; to: number; insert: string }[] = [];
  const touched = new Set<EditNode>();
  for (const edit of edits) {
    const written = writtenValueAt(view, edit.span);
    if (!written) {
      return null;
    }
    const { node, value, open, optional } = written;
    if (valueProblem(value.role, edit.text, optional, true) != null ||
      (optional && edit.text.trim() === "" && node.command != null && node.command in REQUIRED_OPTIONAL)) {
      return null;
    }
    touched.add(node);
    const source = valueSource(value.role, edit.text, open);
    patches.push(optional && edit.text.trim() === ""
      ? { from: value.span.from, to: value.span.to, insert: "" }
      // An unbraced value stays one token, or gets its braces (`\bigr)` to `\bigr{\rangle}`, not `\bigr\rangle x`).
      : open === "" && !/^(?:\\[A-Za-z@]+|\\.|[^\\{}\s])$/u.test(source)
        ? { from: value.span.from, to: value.span.to, insert: `{${source}}` }
        : { from: value.contentSpan.from, to: value.contentSpan.to, insert: source });
  }
  // A colour is an xcolor expression unless a model (`[rgb]`) stands before it, as the edits leave them.
  const final = (value: EditValue) => edits.find((edit) => edit.span.from === value.contentSpan.from && edit.span.to === value.contentSpan.to)?.text.trim() ??
    text.slice(value.contentSpan.from, value.contentSpan.to);
  for (const node of touched) {
    // A table's columns are fixed by its specification: fewer than a row takes is "Extra alignment tab".
    const spec = node.kind === "alignment" ? node.values.find((value) => value.role === "spec") : undefined;
    if (spec && (specColumns(final(spec)) ?? 0) < widestRow(view, node.id)) {
      return null;
    }
    const model = node.values.some((value) => text[value.span.from] === "[" && final(value) !== "");
    if (node.values.some((value) => value.role === "color" && valueProblem("color", final(value), false, model) != null)) {
      return null;
    }
  }
  return patches.sort((left, right) => left.from - right.from);
}

/** The command a value editor at `at` is open for, as the mode there reads it, and its fields. */
export function valueEditorFields(
  table: CommandTable,
  view: EditView,
  at: number,
  name: string,
  key: CommitKey
): { readonly schema: CommandSchema; readonly fields: readonly ValueField[] } | null {
  const slot = view.index.resolve(at, "after")?.slot ?? view.positionAt(at).slot;
  const mode = view.tree.slots[slot].mode === "math" ? "math" : "text";
  const schema = table.command(name, mode) ?? table.command(name, mode === "math" ? "text" : "math");
  return schema ? { schema, fields: valueFields(schema, key) } : null;
}

/** One value of a construct as its tag shows it: its delimiters and text, and where its text is. */
export type TaggedValue = {
  readonly kind: ValueKind;
  readonly open: string;
  readonly close: string;
  readonly text: string;
  /** The content span: what an edit of it names. */
  readonly span: Span;
  readonly optional: boolean;
};

/**
 * The values a construct has written, in source order, for its tag
 * (`\textcolor{red}`); null when it has none.
 */
export function taggedValues(view: EditView, node: EditNode): { readonly command: string; readonly values: readonly TaggedValue[] } | null {
  if (node.command == null || node.values.length === 0) {
    return null;
  }
  const { text } = view.tree;
  const values = [...node.values].sort((left, right) => left.span.from - right.span.from).map((value): TaggedValue => {
    const open = value.span.from < value.contentSpan.from ? text[value.span.from] : "";
    const close = value.contentSpan.to < value.span.to ? text[value.span.to - 1] : "";
    return { kind: value.role, open, close, text: text.slice(value.contentSpan.from, value.contentSpan.to), span: value.contentSpan, optional: open === "[" || open === "<" };
  });
  return { command: node.command, values };
}
