import { requireArrayValue } from "../../utils/collections.js";
import { editSlotAt, editNodeAt } from "../tree/lookup.js";
import { ARGUMENT_ROLES } from "../ownership/kinds.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import { childIndex, presentSlots } from "../tree/navigate.js";
import type { NodeId } from "../tree/types.js";
import type { EditOutcome } from "./delete.js";
import { PatchSet } from "./source.js";

/**
 * K4: `^` (or `_`) right after an atom that already has that script moves
 * into the script, at its end, instead of writing a double script. Also
 * from the end of the base, and from right before a script with no base
 * left. Null when there is no such script.
 */
export function enterExistingScript(view: EditView, caret: Position, marker: "^" | "_"): EditOutcome | null {
  const { tree } = view;
  const slot = editSlotAt(tree.slots, caret.slot);
  if (slot.mode !== "math") {
    return null;
  }
  let scripted: NodeId | null = null;
  const owner = editNodeAt(tree.nodes, slot.node);
  if (owner.kind === "scripted" && slot.role === "base" && caret.index === slot.children.length) {
    scripted = owner.id;
  } else {
    // An offset before a scripted atom may resolve into its base's first stop.
    // A marker here still attaches to the previous sibling, across math spaces.
    if (owner.kind === "scripted" && slot.role === "base" && caret.index === 0 && owner.parent != null) {
      return enterExistingScript(view, { slot: owner.parent, index: childIndex(tree, owner.id) }, marker);
    }
    let at = caret.index;
    while (at > 0 && view.role(requireArrayValue(slot.children, at - 1)) === "invisible") {
      at -= 1;
    }
    const previous = at > 0 ? slot.children[at - 1] : null;
    if (previous != null && editNodeAt(tree.nodes, previous).kind === "scripted") {
      scripted = previous;
    }
  }
  // Right before a script whose base is gone (`\(‸^n\)`, its `\mathbb R` deleted): into it, at its start.
  let atStart = false;
  const next = caret.index < slot.children.length ? slot.children[caret.index] : null;
  if (scripted == null && next != null && editNodeAt(tree.nodes, next).kind === "scripted") {
    const base = presentSlots(tree, next).find((candidate) => candidate.role === "base");
    if (!base || base.children.length === 0) {
      scripted = next;
      atStart = true;
    }
  }
  if (scripted == null) {
    return null;
  }
  const script = presentSlots(tree, scripted).find((candidate) => candidate.role === (marker === "^" ? "sup" : "sub"));
  return script ? { kind: "move", to: { slot: script.id, index: atStart ? 0 : script.children.length } } : null;
}

/** Commands whose content is an argument (`\textbf x`, `\href{u} x`, `\only<2> x`). */
const COMMAND_WRAPPERS: ReadonlySet<string> = new Set(["style", "link", "overlay", "text-in-math", "accent"]);

/**
 * R6 for any edit at a caret in a single-token unbraced argument (`x_‸i`):
 * the argument gets its braces around the edit, so a command written
 * there (`x_{\left(\right)i}`) stays inside it. Paste also protects a
 * scripted base: scripts within the pasted fragment stay distinct from
 * those attached to the base. Other outcomes pass.
 */
export function braceUnbracedArgument(view: EditView, caret: Position, outcome: EditOutcome, includeBase = false): EditOutcome {
  outcome = braceWaitingArgument(view, outcome);
  const slot = editSlotAt(view.tree.slots, caret.slot);
  // (Also a text command's content: `\textbf(` typed into gives `\textbf{…(}`, F7.)
  const argument = ARGUMENT_ROLES.has(slot.role) || (includeBase && slot.role === "base") || (slot.role === "content" && COMMAND_WRAPPERS.has(editNodeAt(view.tree.nodes, slot.node).kind));
  if (outcome.kind !== "patch" || slot.braced || !argument || slot.children.length === 0) {
    return outcome;
  }
  const { from, to } = slot.contentSpan;
  if (outcome.patches.some((patch) => patch.from < from || patch.to > to)) {
    return outcome;
  }
  const set = new PatchSet().replace({ from, to: from }, "{");
  for (const patch of outcome.patches) {
    set.replace({ from: patch.from, to: patch.to }, patch.insert);
  }
  const patches = set.replace({ from: to, to }, "}").patches();
  const adjusted = { ...outcome, patches, caret: outcome.caret + 1 };
  delete adjusted.placeholder;
  if (outcome.selectionEnd == null) delete adjusted.selectionEnd;
  else adjusted.selectionEnd = outcome.selectionEnd + 1;
  return adjusted;
}

/** A missing argument takes one token; keep a multi-token insertion whole. */
function braceWaitingArgument(view: EditView, outcome: EditOutcome): EditOutcome {
  if (outcome.kind !== "patch" || outcome.patches.length !== 1) {
    return outcome;
  }
  const patch = requireArrayValue(outcome.patches, 0);
  if (patch.from !== patch.to || /^(?:\\[A-Za-z]+|\\.|[^\\{}~'])$/u.test(patch.insert) || /^[{ ]/u.test(patch.insert)) {
    return outcome;
  }
  const waiting = view.tree.diagnostics.some(diagnostic => {
    if (diagnostic.code !== "missing-argument" || diagnostic.span.from !== diagnostic.span.to || diagnostic.span.from > patch.from) return false;
    const gap = view.tree.text.slice(diagnostic.span.from, patch.from);
    // Argument scanning skips whitespace and comments, but a blank line ends
    // the paragraph rather than extending the waiting argument into it.
    return /^(?:[ \t\r\n]|%[^\r\n]*(?:\r\n?|\n|$))*$/u.test(gap) && !/\n[ \t\r]*\n/u.test(gap);
  });
  if (!waiting) return outcome;
  return {
    ...outcome,
    patches: [{ ...patch, insert: `{${patch.insert}}` }],
    caret: outcome.caret + 1,
    ...(outcome.placeholder === undefined ? {} : { placeholder: outcome.placeholder + 1 }),
    ...(outcome.selectionEnd === undefined ? {} : { selectionEnd: outcome.selectionEnd + 1 }),
  };
}

/**
 * R6: typing into a single-token unbraced argument (`x^2`, `\frac1n`)
 * adds the braces, so the typed text stays in the argument: `x^{23}`.
 * Null when the caret's slot is not such an argument.
 */
export function insertIntoUnbracedArgument(view: EditView, caret: Position, text: string): EditOutcome | null {
  const { tree } = view;
  const slot = editSlotAt(tree.slots, caret.slot);
  if (slot.braced || !ARGUMENT_ROLES.has(slot.role) || slot.children.length === 0) {
    return null;
  }
  const at = view.offset(caret);
  const { from, to } = slot.contentSpan;
  const patches = new PatchSet()
    .replace({ from, to: from }, "{")
    .replace({ from: at, to: at }, text)
    .replace({ from: to, to }, "}")
    .patches();
  return { kind: "patch", patches, caret: at + 1 + text.length, run: null };
}
