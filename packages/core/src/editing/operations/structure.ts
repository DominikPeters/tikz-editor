import { capabilityChain, decideOwner, inTitle, type ChainLink } from "../ownership/keys.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import { childIndex, presentSlots } from "../tree/navigate.js";
import type { EditNode, NodeId, SlotId, Span } from "../tree/types.js";
import type { EditOutcome } from "./delete.js";
import {
  exitEmptyLastItemPatch,
  isBlank,
  lineIndentAt,
  listItemOf,
  listShapes,
  mergeNextItemPatch,
  mergeWithPreviousItemPatch,
  nestItemsPatch,
  skipHorizontalBack,
  skipHorizontalForward,
  splitItemPatch,
  toggleListPatch,
  trimmedEnd,
  wrapInListPatch,
  type StructuralPatch,
} from "./lists.js";
import { mapThrough, PatchSet } from "./source.js";

/**
 * The structural keys on the tree: ⏎, ⇧⏎, ⇥/⇧⇥, ⌫/⌦ at paragraph and
 * item edges, and the list toolbar. The owner of a key comes from the
 * ownership table (ownership/keys.ts); the edits from lists.ts and the
 * splits below. None of this reads the rendered layout.
 *
 * Edits put the caret exactly where they say (`exact`): on a fresh line
 * after a list, the caret is at an offset no stop names yet.
 */

/** ⏎ (or ⇧⏎ as `line-break`) at a caret. */
export function enter(view: EditView, caret: Position, at: number, key: "enter" | "line-break"): EditOutcome {
  const { tree } = view;
  const tail = key === "enter" ? leaveAlignment(view, at) : null;
  if (tail) {
    return tail;
  }
  let position = caret;
  let offset = at;
  for (let guard = 0; guard < 16; guard += 1) {
    const decision = decideOwner(capabilityChain(tree, key, position.slot));
    if (decision.kind === "stop") {
      return { kind: "none" };
    }
    // A wrapper with nothing on one side of the caret is not split: the
    // break goes before or after it instead (Z1: "act at its end").
    const edge = decision.transparent.map((link) => wrapperEdge(view, link, offset)).find((found) => found != null);
    if (edge) {
      position = edge.position;
      offset = edge.offset;
      continue;
    }
    const owner = tree.nodes[decision.node];
    if (key === "line-break") {
      return owner.kind === "row" ? newRow(view, decision.node, offset) : breakAt(view, offset, decision.slot, " \\\\ ");
    }
    if (owner.kind === "item") {
      const context = listItemOf(tree, owner.id);
      if (!context) {
        return { kind: "none" };
      }
      if (context.index === context.list.items.length - 1 && isBlank(tree.text, context.item.contentSpan.from, context.item.contentSpan.to)) {
        return patchOutcome(exitEmptyLastItemPatch(tree.text, context));
      }
      const { closes, reopens } = carried(view, decision.transparent);
      return patchOutcome(splitItemPatch(tree.text, context, offset, closes, reopens));
    }
    if (owner.kind === "paragraph") {
      return breakAt(view, offset, decision.slot, "\n\n", decision.transparent);
    }
    if (owner.kind === "display") {
      return leaveDisplay(view, owner.id);
    }
    return owner.kind === "row" ? newRow(view, owner.id, offset) : { kind: "none" };
  }
  return { kind: "none" };
}

/**
 * A break at the caret, closing the transparent wrappers before it and
 * reopening them after (`\textbf{one}` ⏎ `\textbf{ two}`). With no
 * wrapper, the whitespace around the caret becomes the break.
 */
function breakAt(view: EditView, at: number, slot: SlotId, text: string, transparent: readonly ChainLink[] = []): EditOutcome {
  const { tree } = view;
  const bounds = tree.slots[slot].contentSpan;
  const { closes, reopens } = carried(view, transparent);
  const collapse = transparent.length === 0;
  const from = collapse ? skipHorizontalBack(tree.text, at, bounds.from) : at;
  const to = collapse ? skipHorizontalForward(tree.text, at, bounds.to) : at;
  const insert = closes + text + reopens;
  return patchOutcome({ edits: [{ span: { from, to }, insert }], caret: from + insert.length });
}

/** The source closing the transparent wrappers (innermost first) and reopening them (outermost first). */
function carried(view: EditView, transparent: readonly ChainLink[]): { closes: string; reopens: string } {
  const { tree } = view;
  let closes = "";
  let reopens = "";
  for (const link of transparent) {
    const node = tree.nodes[link.node];
    const slot = tree.slots[link.slot];
    closes += tree.text.slice(slot.contentSpan.to, node.span.to);
    let open = tree.text.slice(node.span.from, slot.contentSpan.from);
    if (node.kind === "group") {
      // `{\bf ` reopens with its declarations.
      const first = slot.children.find((child) => tree.nodes[child].kind !== "declaration");
      open += tree.text.slice(slot.contentSpan.from, first == null ? slot.contentSpan.to : tree.nodes[first].span.from);
    }
    reopens = open + reopens;
  }
  return { closes, reopens };
}

/** Where a break goes instead of splitting a wrapper with nothing on one side of the caret, or null. */
function wrapperEdge(view: EditView, link: ChainLink, at: number): { position: Position; offset: number } | null {
  const { tree } = view;
  const node = tree.nodes[link.node];
  const visible = visibleOffsets(view, link.slot);
  const before = visible.some((span) => span.from < at);
  const after = visible.some((span) => span.to > at);
  if (before && after) {
    return null;
  }
  const index = childIndex(tree, node.id);
  return before
    ? { position: { slot: node.parent!, index: index + 1 }, offset: node.span.to }
    : { position: { slot: node.parent!, index }, offset: node.span.from };
}

function visibleOffsets(view: EditView, slot: SlotId): Span[] {
  return view.tree.slots[slot].children.filter((child) => view.role(child) !== "invisible").map((child) => view.tree.nodes[child].span);
}

/** ⏎ in a display (D1): to the text after it, or a fresh line below. */
function leaveDisplay(view: EditView, display: NodeId): EditOutcome {
  const { tree } = view;
  const node = tree.nodes[display];
  const siblings = tree.slots[node.parent!].children;
  const next = siblings[siblings.indexOf(display) + 1];
  if (next != null && tree.nodes[next].kind === "paragraph") {
    return { kind: "move", to: { slot: tree.nodes[next].slots[0], index: 0 } };
  }
  return patchOutcome({ edits: [{ span: { from: node.span.to, to: node.span.to }, insert: "\n" }], caret: node.span.to + 1 });
}

/** ⏎ in an alignment row (D2): a row break, the rest of the row moving to a new line with the same indent. */
function newRow(view: EditView, row: NodeId, at: number): EditOutcome {
  const { tree } = view;
  const span = tree.nodes[row].span;
  const from = skipHorizontalBack(tree.text, at, span.from);
  const to = skipHorizontalForward(tree.text, at, span.to);
  const insert = ` \\\\\n${lineIndentAt(tree.text, span.from)}`;
  return patchOutcome({ edits: [{ span: { from, to }, insert }], caret: from + insert.length });
}

/**
 * ⏎ on the empty line after an alignment's last row (D3): the row break
 * before it goes, and the caret continues on a fresh line after the
 * environment.
 */
function leaveAlignment(view: EditView, at: number): EditOutcome | null {
  const { tree } = view;
  for (const node of tree.nodes) {
    if (node.kind !== "alignment" || node.parent == null || tree.slots[node.parent].mode === "math") {
      continue;
    }
    const content = tree.slots[node.slots[0]];
    const last = content.children.filter((child) => tree.nodes[child].kind === "row").at(-1);
    if (last == null || at < tree.nodes[last].span.to || at > content.contentSpan.to) {
      continue;
    }
    const row = tree.nodes[last];
    const breakToken = row.delimiters.find((span) => span.to === row.span.to && tree.text.startsWith("\\\\", span.from));
    if (!breakToken || !isBlank(tree.text, row.span.to, content.contentSpan.to)) {
      return null;
    }
    const lineEnd = tree.text.indexOf("\n", node.span.to);
    const after = lineEnd < 0 ? tree.text.length : lineEnd;
    const patches = new PatchSet()
      .delete({ from: skipHorizontalBack(tree.text, breakToken.from, row.span.from), to: breakToken.to })
      .replace({ from: after, to: after }, "\n")
      .patches();
    return { kind: "patch", patches, caret: mapThrough(patches, after) + 1, run: null, exact: true };
  }
  return null;
}

/** ⇥ / ⇧⇥: the next slot of a construct, the next cell, or nesting an item (O1, D2, M8). */
export function tab(view: EditView, caret: Position, back: boolean, selectionEnd?: Position): EditOutcome {
  const { tree } = view;
  const decision = decideOwner(capabilityChain(tree, "tab", caret.slot));
  if (decision.kind === "stop") {
    return { kind: "none" };
  }
  const owner = tree.nodes[decision.node];
  if (owner.kind === "item") {
    return indentItems(view, caret, selectionEnd ?? caret, back ? "unnest" : "nest");
  }
  return owner.kind === "row" ? nextCell(view, owner.id, decision.slot, back) : nextSlot(view, owner.id, decision.slot, back);
}

function nextSlot(view: EditView, owner: NodeId, slot: SlotId, back: boolean): EditOutcome {
  const { tree } = view;
  const slots = presentSlots(tree, owner).sort((left, right) => left.contentSpan.from - right.contentSpan.from);
  const target = slots[slots.findIndex((candidate) => candidate.id === slot) + (back ? -1 : 1)];
  if (target) {
    return { kind: "move", to: { slot: target.id, index: back ? target.children.length : 0 } };
  }
  const node = tree.nodes[owner];
  const index = childIndex(tree, owner);
  return { kind: "move", to: { slot: node.parent!, index: back ? index : index + 1 } };
}

/** The next cell (adding one with `&` at a row's end, unless the column count is fixed), or the previous. */
function nextCell(view: EditView, row: NodeId, cell: SlotId, back: boolean): EditOutcome {
  const { tree } = view;
  const cells = presentSlots(tree, row);
  const at = cells.findIndex((candidate) => candidate.id === cell);
  const target = cells[at + (back ? -1 : 1)];
  if (target) {
    return { kind: "move", to: { slot: target.id, index: back ? target.children.length : 0 } };
  }
  const rows = tree.slots[tree.nodes[row].parent!].children.filter((child) => tree.nodes[child].kind === "row");
  const neighbour = rows[rows.indexOf(row) + (back ? -1 : 1)];
  const columns = columnLimit(view, tree.slots[tree.nodes[row].parent!].node);
  if (back || (columns != null && cells.length >= columns)) {
    if (neighbour == null) {
      return { kind: "none" };
    }
    const neighbourCells = presentSlots(tree, neighbour);
    const goal = back ? neighbourCells.at(-1) : neighbourCells[0];
    return goal ? { kind: "move", to: { slot: goal.id, index: back ? goal.children.length : 0 } } : { kind: "none" };
  }
  const end = trimmedEnd(tree.text, cells[at].contentSpan);
  const insert = end > cells[at].contentSpan.from ? " & " : "& ";
  return patchOutcome({ edits: [{ span: { from: end, to: end }, insert }], caret: end + insert.length });
}

/** The fixed column count of an alignment (`array`/`tabular` specification, `alignat{n}`), or null. */
function columnLimit(view: EditView, alignment: NodeId): number | null {
  const { tree } = view;
  const node = tree.nodes[alignment];
  const spec = node.values.find((value) => value.role === "spec");
  if (spec) {
    const text = tree.text.slice(spec.contentSpan.from, spec.contentSpan.to).replace(/[@!>]\{[^}]*\}|<\{[^}]*\}|\{[^}]*\}/gu, "");
    return (text.match(/[lcrpmbXS]/gu) ?? []).length || null;
  }
  if (node.command?.startsWith("alignat")) {
    const count = Number.parseInt(tree.text.slice(node.values[0]?.contentSpan.from ?? 0, node.values[0]?.contentSpan.to ?? 0), 10);
    return Number.isFinite(count) ? 2 * count : null;
  }
  return null;
}

/** ⇥ / ⇧⇥ on the items from `start` to `end` (one list), or the toolbar indent buttons. */
export function indentItems(view: EditView, start: Position, end: Position, direction: "nest" | "unnest"): EditOutcome {
  const { tree } = view;
  const first = listItemOf(tree, tree.slots[start.slot].node);
  const last = listItemOf(tree, tree.slots[end.slot].node);
  if (!first || first.list.node !== last?.list.node || last.index < first.index) {
    return { kind: "none" };
  }
  const caret = view.offset(start);
  const patch = nestItemsPatch(tree.text, listShapes(tree), first, last.index, direction, caret, view.offset(end));
  return patch ? patchOutcome(patch) : { kind: "none" };
}

/** The toolbar list buttons: rename, dissolve or create a list at the caret. */
export function toggleList(view: EditView, caret: Position, environment: "itemize" | "enumerate"): EditOutcome {
  const { tree } = view;
  if (inTitle(tree, caret.slot)) {
    return { kind: "none" };
  }
  const chain = capabilityChain(tree, "enter", caret.slot);
  const at = view.offset(caret);
  const context = listItemOf(tree, tree.slots[caret.slot].node);
  if (context) {
    return patchOutcome(toggleListPatch(tree.text, context, environment, at));
  }
  const paragraph = chain.map((link) => tree.nodes[link.node]).find((node) => node.kind === "paragraph");
  if (paragraph) {
    const content = tree.slots[paragraph.slots[0]].contentSpan;
    const span = { from: content.from, to: trimmedEnd(tree.text, content) };
    return patchOutcome(wrapInListPatch(tree.text, span, environment, at));
  }
  const slot = tree.slots[caret.slot];
  return slot.flow && slot.children.length === 0
    ? patchOutcome(wrapInListPatch(tree.text, slot.contentSpan, environment, at))
    : { kind: "none" };
}

/**
 * ⌫ at the start of a paragraph or an empty item: an item joins the
 * previous one; a paragraph joins the paragraph before it. After another
 * block (a list, a display) the caret moves to its end.
 */
export function joinBackward(view: EditView, caret: Position, at: number): EditOutcome {
  const { tree } = view;
  const block = blockAt(view, caret.slot);
  if (block == null) {
    return { kind: "none" };
  }
  const context = listItemOf(tree, block);
  if (context && firstBlockOf(view, block)) {
    const patch = mergeWithPreviousItemPatch(tree.text, context, Math.max(at, context.item.contentSpan.from));
    return patch ? patchOutcome(patch) : { kind: "none" };
  }
  const node = tree.nodes[block];
  const siblings = tree.slots[node.parent!].children;
  const previous = siblings[siblings.indexOf(block) - 1];
  if (previous != null && tree.nodes[previous].kind === "paragraph" && node.kind === "paragraph") {
    const from = trimmedEnd(tree.text, tree.nodes[previous].span);
    return patchOutcome({ edits: [{ span: { from, to: node.span.from }, insert: " " }], caret: from + 1 });
  }
  const step = view.step(caret, -1);
  return step ? { kind: "move", to: step } : { kind: "none" };
}

/** ⌦ at the end of a paragraph or an empty item: the mirror of joinBackward. */
export function joinForward(view: EditView, caret: Position, at: number): EditOutcome {
  const { tree } = view;
  const block = blockAt(view, caret.slot);
  if (block == null) {
    return { kind: "none" };
  }
  const context = listItemOf(tree, block);
  if (context && lastBlockOf(view, block)) {
    const end = trimmedEnd(tree.text, { from: context.item.contentSpan.from, to: Math.max(at, context.item.contentSpan.from) });
    const patch = mergeNextItemPatch(tree.text, context, Math.max(end, Math.min(at, context.item.contentSpan.to)));
    return patch ? patchOutcome(patch) : { kind: "none" };
  }
  const node = tree.nodes[block];
  const siblings = tree.slots[node.parent!].children;
  const next = siblings[siblings.indexOf(block) + 1];
  if (next != null && tree.nodes[next].kind === "paragraph" && node.kind === "paragraph") {
    const from = trimmedEnd(tree.text, node.span);
    return patchOutcome({ edits: [{ span: { from, to: tree.nodes[next].span.from }, insert: " " }], caret: from });
  }
  const step = view.step(caret, 1);
  return step ? { kind: "move", to: step } : { kind: "none" };
}

/** The paragraph, or the empty item, a caret slot belongs to. */
function blockAt(view: EditView, slot: SlotId): NodeId | null {
  const { tree } = view;
  for (let current: SlotId | null = slot; current != null;) {
    const node: EditNode = tree.nodes[tree.slots[current].node];
    if (node.kind === "paragraph" || node.kind === "item") {
      return node.id;
    }
    current = node.parent;
  }
  return null;
}

function firstBlockOf(view: EditView, block: NodeId): boolean {
  const node = view.tree.nodes[block];
  return node.kind === "item" || view.tree.slots[node.parent!].children[0] === block;
}

function lastBlockOf(view: EditView, block: NodeId): boolean {
  const node = view.tree.nodes[block];
  return node.kind === "item" || view.tree.slots[node.parent!].children.at(-1) === block;
}

function patchOutcome(patch: StructuralPatch): EditOutcome {
  const set = new PatchSet();
  for (const edit of patch.edits) {
    set.replace(edit.span, edit.insert);
  }
  return {
    kind: "patch",
    patches: set.patches(),
    caret: patch.caret,
    run: null,
    exact: true,
    selectionEnd: patch.selectionEnd,
  };
}
