import { requireArrayValue } from "../../utils/collections.js";
import { editSlotAt, editNodeAt } from "../tree/lookup.js";
import type { InteractionState } from "../input/interaction.js";
import { ARGUMENT_ROLES, isCaretSlot } from "../ownership/kinds.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import { childIndex, presentSlots } from "../tree/navigate.js";
import type { EditMode, EditNode, EditSlot, NodeId, SlotId } from "../tree/types.js";
import { isDollarFormula, type EditOutcome } from "./delete.js";
import { braceUnbracedArgument, enterExistingScript } from "./script.js";
import { OPTION_READER_BEFORE, PatchSet, SPEC_READER_BEFORE, slotOuterSpan, withTerminator } from "./source.js";
import { rowIsFull } from "./structure.js";

/**
 * Input rules for a typed character (R2, R3, R5, R6, K3, K9): what one
 * keystroke writes, given where the caret is. The table is by the caret
 * slot's mode; each rule names an operation, and the operations know the
 * structure (whether a script exists, where a slot ends).
 *
 * Typing joins the `insert` typing run. Characters outside the table are
 * inserted as typed.
 */
export function typeCharacter(
  view: EditView,
  caret: Position,
  char: string,
  state: InteractionState,
  at = view.offset(caret),
  title = false
): EditOutcome {
  const { tree } = view;
  const slot = editSlotAt(tree.slots, caret.slot);
  if (slot.mode === "verbatim") {
    return insert(at, char);
  }
  if (beforeMulticolumn(view, caret)) {
    // `\multicolumn` must open its cell ("Misplaced \omit"): nothing goes before it.
    return { kind: "none" };
  }
  if (char === "{" && state.consumeOpen === at) {
    return { kind: "move", to: caret };
  }
  if (char === ">") {
    const closed = closeOverlay(view, at);
    if (closed) {
      return closed;
    }
  }
  if (char === "]") {
    const closed = closeOptional(view, at);
    if (closed) {
      return closed;
    }
    // Inside an optional argument, at any depth short of braces, a bare `]`
    // would end it (LaTeX takes the first one, even inside `$…$`).
    const open = state.placeholder != null ? placeholderAt(view, state.placeholder, at) : null;
    // Placeholder braces are replaced, so they protect nothing: look from what holds them.
    const from = open ? editNodeAt(tree.nodes, open.formula ?? editSlotAt(tree.slots, open.slot!).node).parent : caret.slot;
    // A frame title is read as an optional argument too, on the continuation frames of `allowframebreaks`.
    if (from != null && (title || insideOptional(view, from))) {
      return open
        ? { kind: "patch", patches: [{ from: open.open, to: open.open + 2, insert: "{]}" }], caret: open.open + 3, run: "insert" }
        : insert(at, "{]}");
    }
  }
  const placeholder = state.placeholder != null ? placeholderAt(view, state.placeholder, at) : null;
  if (placeholder) {
    const filled = fillPlaceholder(view, placeholder, char);
    if (filled) {
      return filled;
    }
  }
  if (char === "}") {
    return closeSlot(view, caret);
  }

  if (char === "{") {
    return { kind: "patch", patches: [{ from: at, to: at, insert: "{}" }], caret: at + 1, run: "insert" };
  }
  const typed = slot.mode === "math" ? typeInMath(view, caret, at, char, state) : typeInText(view, caret, at, char, state);
  return placeInsertion(view, caret, at, typed);
}

/**
 * What any insertion at the caret needs from the structure around it:
 * between an alignment's rows it starts a row, and an argument it goes
 * into gets braces (R6, K2).
 */
export function placeInsertion(view: EditView, caret: Position, at: number, typed: EditOutcome): EditOutcome {
  const slot = editSlotAt(view.tree.slots, caret.slot);
  if (editNodeAt(view.tree.nodes, slot.node).kind === "alignment") {
    return newRowFor(view, typed, at, slot.contentSpan.to);
  }
  // R6: whatever is typed into an unbraced argument (`\frac‸12`, then `^`) brings its braces.
  return braceUnbracedArgument(view, caret, braceWaitingArgument(view, at, typed));
}

/**
 * Right after a command still waiting for its argument, TeX takes one
 * token (K2: `\frac1n`); an insertion of more (`\^{}` after the accent
 * `\t`) goes in braces, as R6 has it, so that it is the argument whole.
 */
function braceWaitingArgument(view: EditView, at: number, typed: EditOutcome): EditOutcome {
  if (typed.kind !== "patch" || typed.patches.length !== 1) {
    return typed;
  }
  const patch = requireArrayValue(typed.patches, 0);
  // One token, or a terminator that ends the command's name (R5). (`~` and `'` are macros, not one token.)
  if (patch.from !== at || patch.to !== at || /^(?:\\[A-Za-z]+|\\.|[^\\{}~'])$/u.test(patch.insert) || /^[{ ]/u.test(patch.insert)) {
    return typed;
  }
  if (!view.tree.diagnostics.some((diagnostic) => diagnostic.code === "missing-argument" && diagnostic.span.from === at && diagnostic.span.to === at)) {
    return typed;
  }
  return { ...typed, patches: [{ from: at, to: at, insert: `{${patch.insert}}` }], caret: typed.caret + 1, ...(typed.placeholder === undefined ? {} : { placeholder: typed.placeholder + 1 }) };
}

/**
 * Text typed between an alignment's rows (where deleted rows were) starts
 * a row of its own: it ends with `\\` when rows or rules follow, so that
 * a following `\hline` stays at a row's start (TeX rejects it elsewhere).
 */
function newRowFor(view: EditView, typed: EditOutcome, at: number, end: number): EditOutcome {
  const rest = view.tree.text.slice(at, end);
  if (typed.kind !== "patch" || typed.patches.length !== 1 || requireArrayValue(typed.patches, 0).from !== at || requireArrayValue(typed.patches, 0).to !== at ||
    !/\S/u.test(rest) || /^\s*\\\\/u.test(rest)) {
    return typed;
  }
  return { ...typed, patches: [{ ...requireArrayValue(typed.patches, 0), insert: `${requireArrayValue(typed.patches, 0).insert} \\\\ ` }] };
}

/** Whether the caret is in a cell before its `\multicolumn`, with only spaces before. */
export function beforeMulticolumn(view: EditView, caret: Position): boolean {
  const { tree } = view;
  const slot = editSlotAt(tree.slots, caret.slot);
  if (slot.role !== "cell") {
    return false;
  }
  const spaces = (child: NodeId) => editNodeAt(tree.nodes, child).kind === "space" || view.role(child) === "invisible";
  const next = slot.children.slice(caret.index).find((child) => !spaces(child));
  return next != null && editNodeAt(tree.nodes, next).command === "multicolumn" && slot.children.slice(0, caret.index).every(spaces);
}

/** Whether the caret is right after an atom with a superscript (`x^2‸`). */
export function afterSuperscript(view: EditView, caret: Position): boolean {
  const { tree } = view;
  const slot = editSlotAt(tree.slots, caret.slot);
  let at = caret.index;
  while (at > 0 && view.role(requireArrayValue(slot.children, at - 1)) === "invisible") {
    at -= 1;
  }
  const previous = at > 0 ? editNodeAt(tree.nodes, requireArrayValue(slot.children, at - 1)) : null;
  return previous?.kind === "scripted" && presentSlots(tree, previous.id).some((candidate) => candidate.role === "sup");
}

/** Specials that destroy or break content when typed literally (R2): `%` comments out the line. */
const ESCAPED: Readonly<Record<string, string>> = { "%": "\\%", "#": "\\#", "&": "\\&" };
const ESCAPED_IN_TEXT: Readonly<Record<string, string>> = { ...ESCAPED, _: "\\_", "^": "\\^{}" };

function typeInText(view: EditView, caret: Position, at: number, char: string, state: InteractionState): EditOutcome {
  if (char === "&" && inAlignmentCell(view, caret.slot)) {
    // A cell beyond the column count would be a TeX error (as D2 for ⇥).
    return rowIsFull(view, caret.slot) ? { kind: "none" } : insert(at, char);
  }
  const escaped = ESCAPED_IN_TEXT[char];
  if (escaped) {
    return insert(at, escaped);
  }
  if (char === "$") {
    // `$$` would read as display math: the empty formula holds braces.
    return { kind: "patch", patches: [{ from: at, to: at, insert: "${}$" }], caret: at + 2, run: "insert", placeholder: at + 1 };
  }
  if (char === "[" && state.pending === at) {
    // O4: the command just committed takes its optional argument.
    return { kind: "patch", patches: [{ from: at, to: at, insert: "[]" }], caret: at + 1, run: "insert" };
  }
  // In prose any command may look for a `[` after it, past spaces (`\titlepage [`).
  // (And an environment's opening, or `\item`, past its overlay specification.)
  if (char === "[" && (optionalArgumentAhead(view, at) || endsWithControlWord(view.tree.text, skipSpacesBack(view.tree.text, at)) ||
    OPTION_READER_BEFORE.test(view.tree.text.slice(0, skipSpacesBack(view.tree.text, at))))) {
    return insert(at, "{}[");
  }
  // Beamer's `\item` and environments read a `<` after them, past spaces, as an overlay specification (F4).
  if (char === "<" && SPEC_READER_BEFORE.test(view.tree.text.slice(0, skipSpacesBack(view.tree.text, at)))) {
    return insert(at, "{}<");
  }
  return insert(at, terminated(view, at, char, "text") + char);
}

function typeInMath(view: EditView, caret: Position, at: number, char: string, state: InteractionState): EditOutcome {
  if (char === "'" && afterSuperscript(view, caret)) {
    // A prime is a superscript (`^\prime`): after `\lambda^\star` it would be a second one.
    return insert(at, "{}'");
  }
  if (char === "&" && inAlignmentCell(view, caret.slot)) {
    // A cell beyond the column count would be a TeX error (as D2 for ⇥).
    return rowIsFull(view, caret.slot) ? { kind: "none" } : insert(at, char);
  }
  const escaped = ESCAPED[char];
  if (escaped) {
    return insert(at, escaped);
  }
  if (char === "^" || char === "_") {
    return enterExistingScript(view, caret, char) ?? {
      kind: "patch",
      patches: [{ from: at, to: at, insert: `${char}{}` }],
      caret: at + 2,
      run: "insert",
      placeholder: at + 1,
    };
  }
  if (char === "$") {
    return stepOverDollar(view, caret);
  }
  if (char === "[" && state.pending === at) {
    return { kind: "patch", patches: [{ from: at, to: at, insert: "[]" }], caret: at + 1, run: "insert" };
  }
  // A row's `\\` reads a `[` after it as its spacing, also in math (K9).
  if (char === "[" && optionalArgumentAhead(view, at)) {
    return insert(at, "{}[");
  }
  return insert(at, terminated(view, at, char, "math") + char);
}

function insert(at: number, text: string): EditOutcome {
  return { kind: "patch", patches: [{ from: at, to: at, insert: text }], caret: at + text.length, run: "insert" };
}

/**
 * R5: the terminator a control word right before the caret needs when a
 * letter follows (or, in text, a space): `\cup B`, `\LaTeX{} is`,
 * `\mu^\top x`.
 */
function terminated(view: EditView, at: number, char: string, mode: EditMode): string {
  const needs = mode === "math" ? /^[A-Za-z@]$/u.test(char) : /^[A-Za-z@ ]$/u.test(char);
  if (!needs || !endsWithControlWord(view.tree.text, at)) {
    return "";
  }
  return mode === "math" ? " " : "{}";
}

export function skipSpacesBack(text: string, at: number): number {
  let end = at;
  while (end > 0 && /\s/u.test(text.charAt(end - 1))) {
    end -= 1;
  }
  return end;
}

/** Whether the source before an offset ends with a control word (`\alpha`, not the text after `\\`). */
export function endsWithControlWord(text: string, at: number): boolean {
  let start = at;
  while (start > 0 && /[A-Za-z@]/u.test(text.charAt(start - 1))) {
    start -= 1;
  }
  if (start === at) {
    return false;
  }
  let slashes = 0;
  while (start - slashes > 0 && text[start - slashes - 1] === "\\") {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

/** Whether a slot is an alignment cell, where `&` separates cells. */
function inAlignmentCell(view: EditView, slot: SlotId): boolean {
  return editSlotAt(view.tree.slots, slot).role === "cell";
}

/**
 * K9: whether TeX would read a `[` typed here as the optional argument of
 * the command before it: right after `\item` without a label, or after
 * `\\` (both skip spaces before looking for `[`).
 */
export function optionalArgumentAhead(view: EditView, at: number): boolean {
  const { tree } = view;
  let end = at;
  while (end > 0 && /\s/u.test(tree.text.charAt(end - 1))) {
    end -= 1;
  }
  // `\begin{figure}[`: environments read a following `[` as their options;
  // a row's `\\` takes `[` as its spacing as a line break does.
  const before = tree.text.slice(Math.max(0, end - 40), end);
  if (/\\begin\{[^{}]*\}$/u.test(before) || /(?:^|[^\\])(?:\\\\)*\\\\\*?$/u.test(before)) {
    return true;
  }
  return tree.nodes.some((node) => {
    if (node.kind === "item") {
      const label = node.slots.map((slot) => editSlotAt(tree.slots, slot)).find((slot) => slot.role === "label");
      return label?.presence === "absent" && node.delimiters.some((span) => span.to === end);
    }
    return node.kind === "break" && node.span.to === end && /^\\\\\*?$/u.test(tree.text.slice(node.span.from, node.span.to));
  });
}

/**
 * `}` (R3): at the end of a braced slot, leaves it: into the next
 * argument when it follows directly (`\frac{n}‸{}`), else out of the
 * construct. Anywhere else a lone `}` would unbalance the source, so it
 * does nothing.
 */
function closeSlot(view: EditView, caret: Position): EditOutcome {
  const { tree } = view;
  const slot = editSlotAt(tree.slots, caret.slot);
  const rest = slot.children.slice(caret.index);
  if (rest.some((child) => view.role(child) !== "invisible")) {
    return { kind: "none" };
  }
  const outer = slotOuterSpan(tree, slot.id);
  const owner = editNodeAt(tree.nodes, slot.node);
  const braced = slot.braced || (owner.kind === "group" && tree.text[outer.to - 1] === "}") || tree.text[slot.contentSpan.to] === "}";
  if (!braced || owner.parent == null || !isCaretSlot(tree, owner.parent)) {
    return { kind: "none" };
  }
  const next = presentSlots(tree, owner.id)
    .filter((candidate) => !view.hiddenSlots.has(candidate.id) && candidate.contentSpan.from > slot.contentSpan.to)
    .sort((left, right) => left.contentSpan.from - right.contentSpan.from)[0];
  if (next && ARGUMENT_ROLES.has(next.role) && next.braced) {
    const nextOuter = slotOuterSpan(tree, next.id);
    if (/^\s*$/u.test(tree.text.slice(outer.to, nextOuter.from))) {
      return { kind: "move", to: { slot: next.id, index: 0 }, consumeOpen: true };
    }
  }
  return { kind: "move", to: { slot: owner.parent, index: childIndex(tree, owner.id) + 1 } };
}

/**
 * `>` at the end of an overlay specification being typed (`\only<2-‸>{}`)
 * steps over its `>`, into the argument after it, whose `{` a `{` typed
 * next is then (as `}` does between arguments, R3). Null elsewhere.
 */
function closeOverlay(view: EditView, at: number): EditOutcome | null {
  const { tree } = view;
  if (tree.text[at] !== ">") {
    return null;
  }
  const node = tree.nodes.find((candidate) => candidate.values.some((value) => value.role === "overlay" && value.contentSpan.to === at));
  if (!node) {
    return null;
  }
  const next = presentSlots(tree, node.id)
    .filter((candidate) => candidate.contentSpan.from > at)
    .sort((left, right) => left.contentSpan.from - right.contentSpan.from)[0];
  if (next?.braced && /^\s*$/u.test(tree.text.slice(at + 1, slotOuterSpan(tree, next.id).from))) {
    return { kind: "move", to: { slot: next.id, index: 0 }, consumeOpen: true };
  }
  return node.parent == null ? null : { kind: "move", to: { slot: node.parent, index: childIndex(tree, node.id) + 1 } };
}

/** Whether a slot lies inside an optional argument with no braces in between. */
export function insideOptional(view: EditView, slot: SlotId): boolean {
  const { tree } = view;
  for (let current: SlotId | null = slot; current != null;) {
    const record: EditSlot = editSlotAt(tree.slots, current);
    const closer = tree.text[record.contentSpan.to];
    const owner: EditNode = editNodeAt(tree.nodes, record.node);
    if (closer === "]" && owner.delimiters.some((span) => span.from === record.contentSpan.to)) {
      return true;
    }
    if (closer === "}" && (record.braced || owner.kind === "group")) {
      return false;
    }
    current = owner.parent;
  }
  return false;
}

/**
 * `]` at the end of an optional argument (`\\\\[5pt‸]`, `\\sqrt[3‸]{x}`)
 * steps over its closing bracket, into the next argument when one
 * follows. Null elsewhere: `]` is then an ordinary character.
 */
function closeOptional(view: EditView, at: number): EditOutcome | null {
  const { tree } = view;
  if (tree.text[at] !== "]") {
    return null;
  }
  const leaf = tree.nodes.find((node) => node.span.to === at + 1 && node.slots.length === 0 &&
    /^\\[^[]*\[/u.test(tree.text.slice(node.span.from, node.span.to)));
  if (leaf) {
    // A command whose optional argument is part of it (`\\[5pt]`).
    return { kind: "patch", patches: [], caret: at + 1, run: null, exact: true };
  }
  for (const node of tree.nodes) {
    // The bracket is a delimiter of its own, or ends a value argument (`[5pt]`).
    if (!node.delimiters.some((span) => span.to === at + 1)) {
      continue;
    }
    const value = node.values.find((candidate) => candidate.span.to === at + 1);
    const slot = node.slots.map((id) => editSlotAt(tree.slots, id)).find((candidate) => candidate.contentSpan.to === at && candidate.presence === "present");
    if (!value && !slot) {
      continue;
    }
    const next = presentSlots(tree, node.id)
      .filter((candidate) => candidate.contentSpan.from > at)
      .sort((left, right) => left.contentSpan.from - right.contentSpan.from)[0];
    if (next?.braced && /^\s*\{$/u.test(tree.text.slice(at + 1, next.contentSpan.from))) {
      return { kind: "move", to: { slot: next.id, index: 0 }, consumeOpen: true };
    }
    return { kind: "patch", patches: [], caret: at + 1, run: null, exact: true };
  }
  return null;
}

/** `$` in math (R3): at the end of an inline formula, steps over its closing `$`; elsewhere nothing. */
function stepOverDollar(view: EditView, caret: Position): EditOutcome {
  const { tree } = view;
  let slot = caret.slot;
  let index = caret.index;
  for (;;) {
    const record = editSlotAt(tree.slots, slot);
    if (record.children.slice(index).some((child) => view.role(child) !== "invisible")) {
      return { kind: "none" };
    }
    const owner = editNodeAt(tree.nodes, record.node);
    if (owner.parent == null) {
      return { kind: "none" };
    }
    // Walk out of wrappers and groups that end where the formula does.
    if (isDollarFormula(view, owner.id) || view.role(owner.id) === "transparent" || owner.kind === "group") {
      slot = owner.parent;
      index = childIndex(tree, owner.id) + 1;
      if (isDollarFormula(view, owner.id)) {
        return { kind: "move", to: { slot, index } };
      }
      continue;
    }
    return { kind: "none" };
  }
}

export type Placeholder = {
  /** Offset of the `{`. */
  readonly open: number;
  /** A script or argument (left after one token), or an inline formula's content (`${}$`). */
  readonly kind: "argument" | "formula";
  /** The slot the braces hold (an argument), or the formula. */
  readonly slot: SlotId | null;
  readonly formula: NodeId | null;
};

/** The placeholder braces recorded at `open`, if they are still empty and the caret is at them. */
export function placeholderAt(view: EditView, open: number, at: number): Placeholder | null {
  const { tree } = view;
  if (tree.text.slice(open, open + 2) !== "{}" || at < open || at > open + 2) {
    return null;
  }
  for (const slot of tree.slots) {
    if (slot.braced && slot.contentSpan.from === open + 1 && slot.contentSpan.to === open + 1 && ARGUMENT_ROLES.has(slot.role)) {
      return { open, kind: "argument", slot: slot.id, formula: null };
    }
  }
  const group = tree.nodes.find((node) => node.kind === "group" && node.span.from === open && node.span.to === open + 2);
  const parent = group?.parent == null ? null : editSlotAt(tree.slots, group.parent);
  if (group && parent && isDollarFormula(view, parent.node)) {
    return { open, kind: "formula", slot: null, formula: parent.node };
  }
  return null;
}

/**
 * The first keystroke into placeholder braces (R6): `{` makes them the
 * user's (nothing is written), and a character replaces them. In a script
 * or argument the caret then leaves (`x^2‸`, TeX's single-token rule); in
 * a formula it stays (`$x‸$`). Other keys (`}`, `^`, `\`) are handled as
 * usual, and the braces stay.
 */
function fillPlaceholder(view: EditView, placeholder: Placeholder, char: string): EditOutcome | null {
  if (char === "{") {
    return { kind: "move", to: view.positionAt(placeholder.open + 1) };
  }
  if (/^[\s{}^_$\\]$/u.test(char)) {
    return null;
  }
  // `'` (a `^\prime`) and `~` are macros, not one token: a script or argument keeps its braces for them.
  if (placeholder.formula == null && /^['~]$/u.test(char)) {
    return null;
  }
  const text = ESCAPED[char] ?? char;
  const patches = new PatchSet().replace({ from: placeholder.open, to: placeholder.open + 2 }, text).patches();
  return { kind: "patch", patches, caret: placeholder.open + text.length, run: "insert" };
}

/**
 * What leaving placeholder braces still empty removes (M13, F1): an empty
 * script with its marker (`x^{}`), an empty inline formula (`${}$`).
 * Argument braces stay: the argument is required.
 */
export function abandonPlaceholder(view: EditView, placeholder: Placeholder): EditOutcome | null {
  const { tree } = view;
  let span;
  if (placeholder.formula != null) {
    span = editNodeAt(tree.nodes, placeholder.formula).span;
  } else {
    const role = editSlotAt(tree.slots, placeholder.slot!).role;
    if (role !== "sup" && role !== "sub") {
      return null;
    }
    span = slotOuterSpan(tree, placeholder.slot!);
  }
  // R5 at the seam: `\gamma_{}w` leaves `\gamma w`, not `\gammaw`.
  const patches = withTerminator(tree.text, new PatchSet().delete(span).patches(), span.from, "math");
  return { kind: "patch", patches, caret: span.from, run: null };
}
