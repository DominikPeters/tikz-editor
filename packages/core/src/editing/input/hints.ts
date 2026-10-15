import { editSlotAt, editNodeAt } from "../tree/lookup.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import { slotChain } from "../tree/navigate.js";
import type { InteractionState } from "./interaction.js";

/**
 * The hint line (V7): what the keys do where the caret is, for the status
 * bar beside the breadcrumb. `id` names the situation, so a hint seen a
 * few times can stop showing.
 */
export type EditingHint = { readonly id: string; readonly text: string };

const SLOT_HINTS: Readonly<Record<string, string>> = {
  sup: "superscript · → to leave",
  sub: "subscript · → to leave",
  numerator: "numerator · ⇥ to the denominator",
  denominator: "denominator · ⇥ to leave",
  index: "root index · ⇥ to the radicand",
  cell: "cell · ⇥ next cell · ⏎ new row",
};

/**
 * The hint for the caret at `caret` with the interaction state, most
 * pressing first: what is open (lens, value editor, chip, a pending
 * `\right`), a paste read as TeX, a selection promoted to a whole construct, an empty
 * placeholder, then the slot the caret is in.
 */
export function editingHint(view: EditView, caret: Position, interaction: InteractionState, promoted: boolean): EditingHint | null {
  if (interaction.lens) {
    return { id: "lens", text: "source · esc to keep it · ⏎ to close when balanced" };
  }
  if (interaction.picker) {
    return { id: "picker", text: "values · ⏎ to write · esc to cancel" };
  }
  if (interaction.chip) {
    return { id: "chip", text: "command · ⇥ to accept · ␣ as typed · esc to cancel" };
  }
  if (interaction.pendingCloser != null) {
    return { id: "pending-closer", text: "\\right pending · ⇥ to accept · → to take it along" };
  }
  if (interaction.pastedTex != null) {
    return { id: "pasted-tex", text: "pasted as TeX · ⌘Z to paste as text" };
  }
  if (promoted) {
    return { id: "promoted", text: "selection extended to the whole construct" };
  }
  const { tree } = view;
  if (interaction.placeholder != null) {
    const role = editSlotAt(tree.slots, caret.slot).role;
    return role === "sup" || role === "sub"
      ? { id: "placeholder-script", text: "empty script · type its content · → leaves it out" }
      : { id: "placeholder", text: "empty · type to fill · → leaves it out" };
  }
  for (const slot of slotChain(tree, caret.slot)) {
    const { role } = editSlotAt(tree.slots, slot);
    const text = SLOT_HINTS[role];
    if (text) {
      return { id: `slot-${role}`, text };
    }
    if (editNodeAt(tree.nodes, editSlotAt(tree.slots, slot).node).kind === "text-in-math") {
      return { id: "text-in-math", text: "text in math · prose rules apply" };
    }
  }
  return null;
}
