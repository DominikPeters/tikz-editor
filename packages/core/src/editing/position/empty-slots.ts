import type { SlotId } from "../tree/types.js";
import type { EditView } from "./view.js";

/** An empty slot a placeholder box shows while editing (V3). */
export type EmptySlot = {
  readonly slot: SlotId;
  /** Its only position's offset (buffer-local). */
  readonly at: number;
  /** Laid out centred (a fraction's numerator), not from the left. */
  readonly centered: boolean;
};

const CENTERED_ROLES = new Set(["numerator", "denominator", "above", "below"]);

/**
 * The empty slots of math that would otherwise show nothing where their
 * content goes: a construct's argument or script (`\frac{}{}`, `x^{}`,
 * `\sqrt{}`), an empty formula (`${}$`, `\[ \]`), a `\left(\right)` with
 * nothing in it. Not a bare `{}` written as an empty atom (`&{}=`), nor
 * slots that are hidden or hold text.
 */
export function emptyMathSlots(view: EditView): EmptySlot[] {
  const { tree } = view;
  return tree.slots.flatMap((slot): EmptySlot[] => {
    const owner = tree.nodes[slot.node];
    if (slot.mode !== "math" || slot.presence !== "present" || slot.children.length > 0 ||
      view.hiddenSlots.has(slot.id) || view.hidden.has(owner.id) || slot.flow) {
      return [];
    }
    if (owner.kind === "group") {
      // Placeholder braces holding a whole formula (`${}$`) are its emptiness; elsewhere `{}` is an atom.
      const parent = owner.parent == null ? null : tree.slots[owner.parent];
      const holder = parent ? tree.nodes[parent.node] : null;
      if (parent?.children.length !== 1 || (holder?.kind !== "formula" && holder?.kind !== "display")) {
        return [];
      }
    }
    return [{ slot: slot.id, at: slot.contentSpan.from, centered: CENTERED_ROLES.has(slot.role) }];
  });
}
