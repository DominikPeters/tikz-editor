import { requireDefined } from "../../utils/invariants.js";
import { requireArrayValue } from "../../utils/collections.js";
import { editSlotAt, editNodeAt } from "../tree/lookup.js";
import type { CommandTable } from "../commands/table.js";
import type { EditView } from "../position/view.js";
import { presentSlots } from "../tree/navigate.js";
import type { EditNode, NodeId } from "../tree/types.js";
import type { EditOutcome } from "./delete.js";
import { mapThrough, PatchSet } from "./source.js";

/**
 * The focus tag's menu (V4): the variants of the construct the caret is
 * in, and what can be done to it whole. Selecting it and editing its
 * source are the resolver's (they are no edits); the variants and Unwrap
 * are edits, here.
 */
export type ConstructMenuEntry = {
  /** `variant:<command>`, `variant:display`, `variant:inline`, `unwrap`, `select`, `lens`. */
  readonly id: string;
  readonly label: string;
  readonly group: "variant" | "action";
};

/** Text styles that stand for one another (textbf ↔ textit ↔ emph …), the document's style macros after them. */
const TEXT_STYLES = ["textbf", "textit", "emph", "underline", "texttt", "textsc", "textsf", "alert"];
const MATH_ALPHABETS = ["mathbf", "mathit", "mathrm", "mathsf", "mathtt", "mathcal", "mathbb", "mathfrak", "boldsymbol"];
const FRACTIONS = ["frac", "dfrac", "tfrac"];
/** Constructs whose content may stand without them (R9's Unwrap). */
const UNWRAPPABLE = new Set<EditNode["kind"]>(["style", "overlay", "link", "group", "radical", "accent", "overset", "delimited", "text-in-math"]);

/** `title`: the buffer is a title, one line, where no display can stand. */
export function constructMenu(view: EditView, node: NodeId, commands: CommandTable, title = false): ConstructMenuEntry[] {
  const record = editNodeAt(view.tree.nodes, node);
  const variants = variantNames(view, record, commands)
    .filter((name) => name !== record.command)
    .map((name): ConstructMenuEntry => ({ id: `variant:${name}`, label: `\\${name}`, group: "variant" }));
  const shape = mathShape(view, record);
  if (shape === "inline" && !title && inFlowParagraph(view, record)) {
    variants.push({ id: "variant:display", label: "display \\[ … \\]", group: "variant" });
  } else if (shape === "display") {
    variants.push({ id: "variant:inline", label: "inline $ … $", group: "variant" });
  }
  const actions: ConstructMenuEntry[] = [];
  if (unwrapSlot(view, record) != null) {
    actions.push({ id: "unwrap", label: "Unwrap", group: "action" });
  }
  actions.push({ id: "select", label: "Select", group: "action" }, { id: "lens", label: "Edit source", group: "action" });
  return [...variants, ...actions];
}

/** The edit a variant or Unwrap makes, or null (stale, or not offered for this construct). */
export function constructMenuEdit(view: EditView, node: NodeId, id: string, commands: CommandTable, caret: number, title = false): EditOutcome | null {
  const { tree } = view;
  const record = editNodeAt(tree.nodes, node);
  const offered = constructMenu(view, node, commands, title).some((entry) => entry.id === id);
  if (!offered) {
    return null;
  }
  if (id === "unwrap") {
    const slot = requireDefined(unwrapSlot(view, record), "Missing required unwrapSlot(view, record)");
    const content = tree.text.slice(slot.contentSpan.from, slot.contentSpan.to);
    // R5: a control word before the construct stays one (`\alpha\sqrt{x}` is `\alpha x`).
    const terminated = /\\[A-Za-z@]+$/u.test(tree.text.slice(0, record.span.from)) && /^[A-Za-z@]/u.test(content);
    const word = editSlotAt(tree.slots, requireDefined(record.parent, "Missing required record.parent")).mode === "math" ? " " : "{}";
    const terminator = terminated ? word : "";
    // And one the content ends with (`\textbf{\LaTeX}x`).
    const closing = /\\[A-Za-z@]+$/u.test(content) && /^[A-Za-z@]/u.test(tree.text.slice(record.span.to)) ? word : "";
    const patches = [{ from: record.span.from, to: record.span.to, insert: terminator + content + closing }];
    // The caret stays in the content it was in.
    const inside = Math.max(0, Math.min(caret - slot.contentSpan.from, content.length));
    const after = caret >= record.span.to ? mapThrough(patches, caret) : record.span.from + terminator.length + inside;
    return { kind: "patch", patches, caret: after, run: null };
  }
  if (id === "variant:display" || id === "variant:inline") {
    const content = presentSlots(tree, node).find((slot) => slot.role === "content");
    if (!content) {
      return null;
    }
    const [open, close] = id === "variant:display" ? ["\\[", "\\]"] : ["$", "$"];
    const patches = new PatchSet()
      .replace({ from: record.span.from, to: content.contentSpan.from }, open)
      .replace({ from: content.contentSpan.to, to: record.span.to }, close)
      .patches();
    return { kind: "patch", patches, caret: mapThrough(patches, caret), run: null };
  }
  const name = id.slice("variant:".length);
  if (record.command == null || !tree.text.startsWith(`\\${record.command}`, record.span.from)) {
    return null;
  }
  const from = record.span.from + 1;
  const to = from + record.command.length;
  const patches = [{ from, to, insert: name }];
  return { kind: "patch", patches, caret: mapThrough(patches, caret), run: null };
}

function variantNames(view: EditView, record: EditNode, commands: CommandTable): string[] {
  const command = record.command;
  if (command == null || !view.tree.text.startsWith(`\\${command}`, record.span.from)) {
    return [];
  }
  const mode = record.parent == null ? "text" : editSlotAt(view.tree.slots, record.parent).mode;
  for (const family of [FRACTIONS, MATH_ALPHABETS]) {
    if (family.includes(command)) {
      return family;
    }
  }
  const userStyles = commands.names("text").filter((name) => {
    const schema = commands.command(name, "text");
    return schema?.userMacro === true && schema.category === "style";
  });
  return mode === "text" && (TEXT_STYLES.includes(command) || userStyles.includes(command)) ? [...TEXT_STYLES, ...userStyles] : [];
}

/**
 * Whether a construct stands in a paragraph of flowing text (a frame body,
 * an item, a block, a column), where TeX takes a display: not in a table
 * cell, a box or a title.
 */
function inFlowParagraph(view: EditView, record: EditNode): boolean {
  const { tree } = view;
  const holder = record.parent == null ? null : editNodeAt(tree.nodes, editSlotAt(tree.slots, record.parent).node);
  const flow = holder?.kind === "paragraph" && holder.parent != null ? editSlotAt(tree.slots, holder.parent) : null;
  return flow?.flow === true;
}

/** Whether a formula is written inline (`$…$`, `\(…\)`) or as a `\[…\]` display. */
function mathShape(view: EditView, record: EditNode): "inline" | "display" | null {
  const { text } = view.tree;
  if (record.kind === "formula" && (text[record.span.from] === "$" || text.startsWith("\\(", record.span.from)) && text[record.span.from + 1] !== "$") {
    return "inline";
  }
  return record.kind === "display" && text.startsWith("\\[", record.span.from) ? "display" : null;
}

/** The one slot whose content stays when the construct goes, or null. */
function unwrapSlot(view: EditView, record: EditNode) {
  if (!UNWRAPPABLE.has(record.kind) || record.parent == null) {
    return null;
  }
  const slots = presentSlots(view.tree, record.id);
  // With nothing to keep, deleting it is the way (an empty formula's `$$` would be display math).
  return slots.length === 1 && view.tree.text.slice(requireArrayValue(slots, 0).contentSpan.from, requireArrayValue(slots, 0).contentSpan.to).trim() !== "" ? requireArrayValue(slots, 0) : null;
}
