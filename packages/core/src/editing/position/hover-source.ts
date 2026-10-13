import type { EditNode } from "../tree/types.js";
import type { EditView } from "./view.js";

/** What hovering reveals (V5): the source of the item under the pointer. */
export type HoverSource = { readonly text: string; readonly span: { readonly from: number; readonly to: number } };

const ITEM_KINDS = new Set<EditNode["kind"]>(["symbol", "operator", "atom", "char"]);
const WRAPPER_KINDS = new Set<EditNode["kind"]>(["style", "overlay", "link", "accent", "radical", "fraction", "overset"]);
const MAX_LENGTH = 60;

/**
 * The source an item shows as (V5), for an offset at or just before it:
 * a symbol or atom written as a command (`\setminus`, `\R`) as written;
 * otherwise the command around it (`\textbf{…}`, `\frac{…}{…}`) with its
 * arguments elided. Null for plain characters with no command around.
 */
export function hoverSource(view: EditView, offset: number): HoverSource | null {
  const { tree } = view;
  const at = (point: number) => tree.nodes
    .filter((node) => node.parent != null && node.span.from <= point && point < node.span.to && !view.hidden.has(node.id))
    .sort((left, right) => (left.span.to - left.span.from) - (right.span.to - right.span.from));
  const around = at(offset).length > 0 ? at(offset) : at(offset - 1);
  for (const node of around) {
    const source = tree.text.slice(node.span.from, node.span.to);
    if (ITEM_KINDS.has(node.kind)) {
      if (source.startsWith("\\") && source.length > 1) {
        return { text: shorten(source), span: node.span };
      }
      continue;
    }
    if (WRAPPER_KINDS.has(node.kind) && node.command != null && source.startsWith(`\\${node.command}`)) {
      const slots = node.slots.map((id) => tree.slots[id]).filter((slot) => slot.presence === "present");
      let text = "";
      let cursor = node.span.from;
      for (const slot of slots) {
        text += tree.text.slice(cursor, slot.contentSpan.from) + "…";
        cursor = slot.contentSpan.to;
      }
      text += tree.text.slice(cursor, node.span.to);
      return { text: shorten(text), span: node.span };
    }
  }
  return null;
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/gu, " ");
  return flat.length > MAX_LENGTH ? `${flat.slice(0, MAX_LENGTH - 1)}…` : flat;
}
