import { requireArrayValue } from "../../utils/collections.js";
import { editSlotAt, editNodeAt } from "../tree/lookup.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import type { EditOutcome } from "./delete.js";
import { lineIndentAt } from "./lists.js";

/**
 * Input rules that transform a keystroke after the fact (R12): the
 * literal keystroke is an undo state of its own, so that ⌘Z right after
 * gives back what was typed. Each takes the literal outcome of the key,
 * as the other input rules wrote it, and returns the transformed one
 * carrying it, or null.
 */

export type QuoteStyle = "tex" | "unicode";

/** Opens a quotation: at a slot's start, after a space or an opening bracket (P3). */
const OPENS_QUOTE = /[\s([{~`‘“]/u;

/**
 * P3: `"` in prose is a quotation mark, opening or closing by what is
 * before it, in the document's convention (``` `` ``` and `''`, or “ ”).
 */
export function smartQuote(view: EditView, caret: Position, at: number, literal: EditOutcome, style: QuoteStyle): EditOutcome | null {
  const { tree } = view;
  const slot = editSlotAt(tree.slots, caret.slot);
  if (slot.mode !== "text" || literal.kind !== "patch" || literal.patches.length !== 1) {
    return null;
  }
  const patch = requireArrayValue(literal.patches, 0);
  if (patch.from !== at || patch.to !== at || !patch.insert.endsWith("\"")) {
    return null;
  }
  const opening = at <= slot.contentSpan.from || OPENS_QUOTE.test(tree.text.charAt(at - 1));
  const quote = style === "unicode" ? (opening ? "“" : "”") : opening ? "``" : "''";
  const insert = patch.insert.slice(0, -1) + quote;
  return {
    ...literal,
    patches: [{ ...patch, insert }],
    caret: literal.caret + quote.length - 1,
    literal: { patches: literal.patches, caret: literal.caret },
  };
}

/** Flows a typed `- ` makes a list in: a frame's body, a column, a block (P10). */
const LIST_FLOWS = new Set(["scope", "container"]);

/**
 * P10: `- ` typed as the first two characters of an empty paragraph in
 * body or column prose starts an itemize, its first item at the caret.
 * Never mid-paragraph, in math, in an item or in a title (whose buffer
 * has no paragraphs).
 */
export function listAutoformat(view: EditView, caret: Position, at: number, literal: EditOutcome): EditOutcome | null {
  const { tree } = view;
  const slot = editSlotAt(tree.slots, caret.slot);
  const paragraph = editNodeAt(tree.nodes, slot.node);
  if (literal.kind !== "patch" || paragraph.kind !== "paragraph" || paragraph.parent == null) {
    return null;
  }
  const flow = editSlotAt(tree.slots, paragraph.parent);
  if (!flow.flow || !LIST_FLOWS.has(editNodeAt(tree.nodes, flow.node).kind)) {
    return null;
  }
  const end = paragraph.span.to;
  if (tree.text.slice(paragraph.span.from, at) !== "-" || tree.text.slice(at, end).trim() !== "") {
    return null;
  }
  const indent = lineIndentAt(tree.text, paragraph.span.from);
  const head = `\\begin{itemize}\n${indent}\\item `;
  return {
    kind: "patch",
    patches: [{ from: paragraph.span.from, to: at, insert: `${head}\n${indent}\\end{itemize}` }],
    caret: paragraph.span.from + head.length,
    run: literal.run,
    exact: true,
    literal: { patches: literal.patches, caret: literal.caret },
  };
}
