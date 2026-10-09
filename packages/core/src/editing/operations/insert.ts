import type { InteractionState } from "../input/interaction.js";
import { ARGUMENT_ROLES, isCaretSlot } from "../ownership/kinds.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import { childIndex, presentSlots } from "../tree/navigate.js";
import type { EditMode, NodeId, SlotId } from "../tree/types.js";
import { isDollarFormula, type EditOutcome } from "./delete.js";
import { enterExistingScript, insertIntoUnbracedArgument } from "./script.js";
import { PatchSet, slotOuterSpan } from "./source.js";

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
  at = view.offset(caret)
): EditOutcome {
  const { tree } = view;
  const slot = tree.slots[caret.slot];
  if (slot.mode === "verbatim") {
    return insert(at, char);
  }
  if (char === "{" && state.consumeOpen === at) {
    return { kind: "move", to: caret };
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
  return slot.mode === "math" ? typeInMath(view, caret, at, char) : typeInText(view, caret, at, char);
}

/** Specials that destroy or break content when typed literally (R2): `%` comments out the line. */
const ESCAPED: Readonly<Record<string, string>> = { "%": "\\%", "#": "\\#", "&": "\\&" };
const ESCAPED_IN_TEXT: Readonly<Record<string, string>> = { ...ESCAPED, _: "\\_", "^": "\\^{}" };

function typeInText(view: EditView, caret: Position, at: number, char: string): EditOutcome {
  if (char === "&" && inAlignmentCell(view, caret.slot)) {
    return insert(at, char);
  }
  const escaped = ESCAPED_IN_TEXT[char];
  if (escaped) {
    return insert(at, escaped);
  }
  if (char === "$") {
    // `$$` would read as display math: the empty formula holds braces.
    return { kind: "patch", patches: [{ from: at, to: at, insert: "${}$" }], caret: at + 2, run: "insert", placeholder: at + 1 };
  }
  if (char === "[" && optionalArgumentAhead(view, at)) {
    return insert(at, "{}[");
  }
  return insert(at, terminated(view, caret, at, char, "text") + char);
}

function typeInMath(view: EditView, caret: Position, at: number, char: string): EditOutcome {
  if (char === "&" && inAlignmentCell(view, caret.slot)) {
    return insert(at, char);
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
  return insertIntoUnbracedArgument(view, caret, char) ?? insert(at, terminated(view, caret, at, char, "math") + char);
}

function insert(at: number, text: string): EditOutcome {
  return { kind: "patch", patches: [{ from: at, to: at, insert: text }], caret: at + text.length, run: "insert" };
}

/**
 * R5: the terminator a control word right before the caret needs when a
 * letter follows (or, in text, a space): `\cup B`, `\LaTeX{} is`.
 */
function terminated(view: EditView, caret: Position, at: number, char: string, mode: EditMode): string {
  const needs = mode === "math" ? /^[A-Za-z@]$/u.test(char) : /^[A-Za-z@ ]$/u.test(char);
  if (!needs || caret.index === 0) {
    return "";
  }
  const { tree } = view;
  const previous = tree.nodes[tree.slots[caret.slot].children[caret.index - 1]];
  const source = tree.text.slice(previous.span.from, previous.span.to);
  return previous.span.to === at && /^\\[A-Za-z@]+$/u.test(source) ? (mode === "math" ? " " : "{}") : "";
}

/** Whether a slot is an alignment cell, where `&` separates cells. */
function inAlignmentCell(view: EditView, slot: SlotId): boolean {
  return view.tree.slots[slot].role === "cell";
}

/**
 * K9: whether TeX would read a `[` typed here as the optional argument of
 * the command before it: right after `\item` without a label, or after
 * `\\` (both skip spaces before looking for `[`).
 */
function optionalArgumentAhead(view: EditView, at: number): boolean {
  const { tree } = view;
  let end = at;
  while (end > 0 && /\s/u.test(tree.text[end - 1])) {
    end -= 1;
  }
  return tree.nodes.some((node) => {
    if (node.kind === "item") {
      const label = node.slots.map((slot) => tree.slots[slot]).find((slot) => slot.role === "label");
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
  const slot = tree.slots[caret.slot];
  const rest = slot.children.slice(caret.index);
  if (rest.some((child) => view.role(child) !== "invisible")) {
    return { kind: "none" };
  }
  const outer = slotOuterSpan(tree, slot.id);
  const owner = tree.nodes[slot.node];
  const braced = slot.braced || (owner.kind === "group" && tree.text[outer.to - 1] === "}") || tree.text[slot.contentSpan.to] === "}";
  if (!braced || owner.parent == null || !isCaretSlot(tree, owner.parent)) {
    return { kind: "none" };
  }
  const next = presentSlots(tree, owner.id)
    .filter((candidate) => candidate.contentSpan.from > slot.contentSpan.to)
    .sort((left, right) => left.contentSpan.from - right.contentSpan.from)[0];
  if (next && ARGUMENT_ROLES.has(next.role) && next.braced) {
    const nextOuter = slotOuterSpan(tree, next.id);
    if (/^\s*$/u.test(tree.text.slice(outer.to, nextOuter.from))) {
      return { kind: "move", to: { slot: next.id, index: 0 }, consumeOpen: true };
    }
  }
  return { kind: "move", to: { slot: owner.parent, index: childIndex(tree, owner.id) + 1 } };
}

/** `$` in math (R3): at the end of an inline formula, steps over its closing `$`; elsewhere nothing. */
function stepOverDollar(view: EditView, caret: Position): EditOutcome {
  const { tree } = view;
  let slot = caret.slot;
  let index = caret.index;
  for (;;) {
    const record = tree.slots[slot];
    if (record.children.slice(index).some((child) => view.role(child) !== "invisible")) {
      return { kind: "none" };
    }
    const owner = tree.nodes[record.node];
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
  const parent = group?.parent == null ? null : tree.slots[group.parent];
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
    span = tree.nodes[placeholder.formula].span;
  } else {
    const role = tree.slots[placeholder.slot!].role;
    if (role !== "sup" && role !== "sub") {
      return null;
    }
    span = slotOuterSpan(tree, placeholder.slot!);
  }
  const patches = new PatchSet().delete(span).patches();
  return { kind: "patch", patches, caret: span.from, run: null };
}
