import { slotChain } from "../tree/navigate.js";
import type { EditNode, NodeId, SlotId, Span } from "../tree/types.js";
import type { Position } from "./position.js";
import type { EditView } from "./view.js";

/**
 * One step of the caret's context path (V11 breadcrumb, R8 outlines):
 * a construct around the caret, or the slot of one it sits in (`sub`,
 * `numerator`).
 */
export type ContextCrumb = {
  readonly label: string;
  /** The construct the crumb names (for a slot crumb, the slot's owner). */
  readonly node: NodeId;
  readonly slot?: SlotId;
  /** What clicking the crumb selects: the construct, or the slot's content. */
  readonly span: Span;
  /** Whether an outline is drawn around it when it is the focus or its parent (R8). */
  readonly outlined: boolean;
};

/** Slots worth naming in the path. */
const NAMED_SLOTS = new Set(["sup", "sub", "numerator", "denominator", "index", "title", "label", "above", "below"]);

const KIND_LABELS: Partial<Record<EditNode["kind"], string>> = {
  formula: "math",
  item: "item",
  display: "display",
};

/**
 * The caret's context path, outermost first: lists, items, blocks,
 * formulas, style wrappers and the named slots (`math › sub`). Paragraphs,
 * bare groups and script bases are left out. The innermost outlined crumb
 * is the focus, the next one out its parent.
 */
export function caretContext(view: EditView, position: Position): ContextCrumb[] {
  const { tree } = view;
  const crumbs: ContextCrumb[] = [];
  for (const slotId of slotChain(tree, position.slot)) {
    const slot = tree.slots[slotId];
    const node = tree.nodes[slot.node];
    if (NAMED_SLOTS.has(slot.role)) {
      const outlined = slot.contentSpan.to > slot.contentSpan.from;
      crumbs.push({ label: slot.role, node: node.id, slot: slotId, span: slot.contentSpan, outlined });
    }
    const label = nodeLabel(view, node);
    if (label != null) {
      crumbs.push({ label, node: node.id, span: node.span, outlined: isOutlined(view, node) });
    }
  }
  return crumbs.reverse();
}

/** Nodes the path leaves out: the scope itself, paragraphs, bare groups, and scripted atoms (their slots are named). */
const UNNAMED_KINDS = new Set<EditNode["kind"]>(["scope", "paragraph", "group", "scripted", "row"]);

function nodeLabel(view: EditView, node: EditNode): string | null {
  if (UNNAMED_KINDS.has(node.kind)) {
    return null;
  }
  return node.command ?? KIND_LABELS[node.kind] ?? (view.role(node.id) === "flow" ? null : node.kind);
}

function isOutlined(view: EditView, node: EditNode): boolean {
  if (node.kind === "display") {
    return true;
  }
  const role = view.role(node.id);
  return role === "construct" || role === "transparent";
}
