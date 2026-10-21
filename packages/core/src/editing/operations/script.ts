import { requireArrayValue } from "../../utils/collections.js";
import { editSlotAt, editNodeAt } from "../tree/lookup.js";
import { ARGUMENT_ROLES } from "../ownership/kinds.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import { presentSlots } from "../tree/navigate.js";
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
 * there (`x_{\left(\right)i}`) stays inside it. Other outcomes pass.
 */
export function braceUnbracedArgument(view: EditView, caret: Position, outcome: EditOutcome): EditOutcome {
  const slot = editSlotAt(view.tree.slots, caret.slot);
  // (Also a text command's content: `\textbf(` typed into gives `\textbf{…(}`, F7.)
  const argument = ARGUMENT_ROLES.has(slot.role) || (slot.role === "content" && COMMAND_WRAPPERS.has(editNodeAt(view.tree.nodes, slot.node).kind));
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
