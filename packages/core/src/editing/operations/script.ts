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
 * from the end of the base. Null when there is no such script.
 */
export function enterExistingScript(view: EditView, caret: Position, marker: "^" | "_"): EditOutcome | null {
  const { tree } = view;
  const slot = tree.slots[caret.slot];
  if (slot.mode !== "math") {
    return null;
  }
  let scripted: NodeId | null = null;
  const owner = tree.nodes[slot.node];
  if (owner.kind === "scripted" && slot.role === "base" && caret.index === slot.children.length) {
    scripted = owner.id;
  } else {
    let at = caret.index;
    while (at > 0 && view.role(slot.children[at - 1]) === "invisible") {
      at -= 1;
    }
    const previous = at > 0 ? slot.children[at - 1] : null;
    if (previous != null && tree.nodes[previous].kind === "scripted") {
      scripted = previous;
    }
  }
  if (scripted == null) {
    return null;
  }
  const script = presentSlots(tree, scripted).find((candidate) => candidate.role === (marker === "^" ? "sup" : "sub"));
  return script ? { kind: "move", to: { slot: script.id, index: script.children.length } } : null;
}

/**
 * R6: typing into a single-token unbraced argument (`x^2`, `\frac1n`)
 * adds the braces, so the typed text stays in the argument: `x^{23}`.
 * Null when the caret's slot is not such an argument.
 */
export function insertIntoUnbracedArgument(view: EditView, caret: Position, text: string): EditOutcome | null {
  const { tree } = view;
  const slot = tree.slots[caret.slot];
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
