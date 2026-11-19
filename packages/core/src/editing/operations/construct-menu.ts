import { requireDefined } from "../../utils/invariants.js";
import { requireArrayValue } from "../../utils/collections.js";
import { editSlotAt, editNodeAt } from "../tree/lookup.js";
import type { CommandTable } from "../commands/table.js";
import type { EditView } from "../position/view.js";
import { presentSlots } from "../tree/navigate.js";
import type { EditNode, NodeId } from "../tree/types.js";
import type { EditOutcome } from "./delete.js";
import { controlWordTerminator, mapThrough, PatchSet, protectPatchEnds } from "./source.js";

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
    const parent = editSlotAt(tree.slots, requireDefined(record.parent, "Missing required record.parent"));
    const scripted = parent.role === "base" && editNodeAt(tree.nodes, parent.node).kind === "scripted";
    const prefix = scripted ? "{" : controlWordTerminator(tree.text.slice(0, record.span.from), content, parent.mode);
    const suffix = scripted ? "}" : "";
    const patches = protectPatchEnds(tree.text,
      [{ from: record.span.from, to: record.span.to, insert: prefix + content + suffix }], parent.mode);
    // The caret stays in the content it was in.
    const inside = Math.max(0, Math.min(caret - slot.contentSpan.from, content.length));
    const after = caret >= record.span.to ? mapThrough(patches, caret) : record.span.from + prefix.length + inside;
    return { kind: "patch", patches, caret: after, run: null };
  }
  if (id === "variant:display" || id === "variant:inline") {
    const content = presentSlots(tree, node).find((slot) => slot.role === "content");
    if (!content) {
      return null;
    }
    const [open, close] = id === "variant:display" ? ["\\[", "\\]"] : ["$", "$"];
    const emptyInline = id === "variant:inline" && tree.text.slice(content.contentSpan.from, content.contentSpan.to).trim() === "";
    const set = new PatchSet().replace({ from: record.span.from, to: content.contentSpan.from }, open);
    if (emptyInline) set.replace(content.contentSpan, "{}");
    const patches = set.replace({ from: content.contentSpan.to, to: record.span.to }, close).patches();
    return { kind: "patch", patches, caret: emptyInline ? record.span.from + 2 : mapThrough(patches, caret), run: null,
      ...(emptyInline ? { placeholder: record.span.from + 1 } : {}) };

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
  const parent = editSlotAt(view.tree.slots, record.parent);
  if (record.kind === "group" && parent.role === "base" && editNodeAt(view.tree.nodes, parent.node).kind === "scripted") return null;
  const slots = presentSlots(view.tree, record.id);
  const slot = slots.length === 1 ? requireArrayValue(slots, 0) : null;
  // With nothing to keep, deleting it is the way (an empty formula's `$$` would be display math).
  if (!slot || view.tree.text.slice(slot.contentSpan.from, slot.contentSpan.to).trim() === "") return null;
  const parentMode = editSlotAt(view.tree.slots, record.parent).mode;
  // Plain characters can change mode. Structured content cannot: removing
  // \text around $...$ would expose nested formula delimiters in math,
  // and text-only commands would lose the context that makes them valid.
  if (slot.mode !== parentMode && slot.children.some(child => !["char", "space"].includes(editNodeAt(view.tree.nodes, child).kind))) return null;
  return slot;
}
