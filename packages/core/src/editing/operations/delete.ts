import { ARGUMENT_ROLES, itemRole } from "../ownership/kinds.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import { childIndex, presentSlots } from "../tree/navigate.js";
import type { EditMode, NodeId, SlotId, Span } from "../tree/types.js";
import type { BufferPatch } from "../transaction/transaction.js";
import { mapThrough, PatchSet, slotOuterSpan, withTerminator } from "./source.js";

/**
 * Deletion (R9, O2, O3, F5). Operations return what should happen; the
 * resolver turns it into a transaction.
 */
export type EditOutcome =
  /** Source patches; `caret` is a post-edit offset. `run` names the typing run a one-character deletion joins. */
  | { readonly kind: "patch"; readonly patches: readonly BufferPatch[]; readonly caret: number; readonly run: string | null }
  /** Select a construct first (R9: never delete more than one visible item unseen). */
  | { readonly kind: "select"; readonly anchor: Position; readonly focus: Position }
  | { readonly kind: "move"; readonly to: Position }
  | { readonly kind: "none" }
  /** A flow edge (paragraph or item start/end): the structural keys decide. */
  | { readonly kind: "structural" };

const NONE: EditOutcome = { kind: "none" };
const STRUCTURAL: EditOutcome = { kind: "structural" };

/** Slots whose emptying removes them, rather than leaving a placeholder (O2 rule 3). */
const REMOVABLE_ROLES = new Set(["sup", "sub", "index"]);

/** ⌫ with a caret (O2 rules 2–6). */
export function deleteBackward(view: EditView, caret: Position): EditOutcome {
  const { tree } = view;
  let slot = caret.slot;
  let at = caret.index;
  let throughScript = false;
  for (;;) {
    const record = tree.slots[slot];
    const owner = record.node;
    while (at > 0 && itemRole(tree, record.children[at - 1]) === "invisible") {
      at -= 1;
    }
    if (at === 0) {
      const edge = slotEdge(view, slot, "start");
      if (edge.kind !== "walk-out") {
        return edge.outcome;
      }
      slot = tree.nodes[owner].parent!;
      at = childIndex(tree, owner);
      continue;
    }
    const child = record.children[at - 1];
    switch (itemRole(tree, child)) {
      case "transparent": {
        const content = presentSlots(tree, child).at(-1);
        if (!content || isEmptySlot(view, content.id)) {
          return removeNode(view, child);
        }
        slot = content.id;
        at = content.children.length;
        continue;
      }
      case "scripted": {
        const script = lastScript(view, child);
        if (!script) {
          return { kind: "select", anchor: { slot, index: at }, focus: { slot, index: at - 1 } };
        }
        slot = script;
        at = tree.slots[script].children.length;
        throughScript = true;
        continue;
      }
      case "unit":
        return deleteItem(view, child, "backward", throughScript);
      case "construct":
        return { kind: "select", anchor: { slot, index: at }, focus: { slot, index: at - 1 } };
      case "invisible":
      case "flow":
        return NONE;
    }
  }
}

/** ⌦ with a caret: the mirror of ⌫, except that a scripted base is selected whole (O3). */
export function deleteForward(view: EditView, caret: Position): EditOutcome {
  const { tree } = view;
  let slot = caret.slot;
  let at = caret.index;
  for (;;) {
    const record = tree.slots[slot];
    const owner = record.node;
    while (at < record.children.length && itemRole(tree, record.children[at]) === "invisible") {
      at += 1;
    }
    if (at === record.children.length) {
      const edge = slotEdge(view, slot, "end");
      if (edge.kind !== "walk-out") {
        return edge.outcome;
      }
      slot = tree.nodes[owner].parent!;
      at = childIndex(tree, owner) + 1;
      continue;
    }
    const child = record.children[at];
    switch (itemRole(tree, child)) {
      case "transparent": {
        const content = presentSlots(tree, child)[0];
        if (!content || isEmptySlot(view, content.id)) {
          return removeNode(view, child);
        }
        slot = content.id;
        at = 0;
        continue;
      }
      case "unit":
        return deleteItem(view, child, "forward", false);
      case "scripted":
      case "construct":
        return { kind: "select", anchor: { slot, index: at }, focus: { slot, index: at + 1 } };
      case "invisible":
      case "flow":
        return NONE;
    }
  }
}

type EdgeDecision = { kind: "walk-out" } | { kind: "outcome"; outcome: EditOutcome };

/**
 * ⌫ at a slot's start or ⌦ at its end (O2 rules 2–5): delete an empty
 * construct, remove an empty removable slot, move to the neighbouring
 * slot, or step out. Style wrappers are walked out of, so that the
 * actual neighbouring item is found (R9).
 */
function slotEdge(view: EditView, slot: SlotId, edge: "start" | "end"): EdgeDecision {
  const { tree } = view;
  const record = tree.slots[slot];
  const owner = record.node;
  const role = itemRole(tree, owner);
  const outcome = (value: EditOutcome): EdgeDecision => ({ kind: "outcome", outcome: value });
  if (role === "flow") {
    // Paragraph and item edges are structural; the edges of a display or
    // a block title stop the key rather than eat the block's delimiters.
    return outcome(tree.nodes[owner].kind === "paragraph" ? STRUCTURAL : NONE);
  }
  if (role === "transparent") {
    return isEmptySlot(view, slot)
      ? outcome(removeNode(view, owner))
      : { kind: "walk-out" };
  }
  const slots = presentSlots(tree, owner);
  if (slots.every((candidate) => isEmptySlot(view, candidate.id))) {
    return outcome(removeNode(view, owner));
  }
  if (isEmptySlot(view, slot) && REMOVABLE_ROLES.has(record.role)) {
    const span = slotOuterSpan(tree, slot);
    const patches = new PatchSet().delete(span).patches();
    return outcome({ kind: "patch", patches, caret: mapThrough(patches, span.from), run: null });
  }
  const at = slots.findIndex((candidate) => candidate.id === slot);
  const neighbour = slots[edge === "start" ? at - 1 : at + 1];
  if (neighbour) {
    return outcome({
      kind: "move",
      to: { slot: neighbour.id, index: edge === "start" ? neighbour.children.length : 0 },
    });
  }
  const node = tree.nodes[owner];
  if (node.kind === "row") {
    return outcome(neighbouringRow(view, owner, edge));
  }
  if (node.parent == null || tree.nodes[tree.slots[node.parent].node].kind === "alignment") {
    return outcome(NONE);
  }
  const index = childIndex(tree, owner);
  return outcome({ kind: "move", to: { slot: node.parent, index: edge === "start" ? index : index + 1 } });
}

/** From a row's first cell start to the previous row's last cell end (and the mirror). */
function neighbouringRow(view: EditView, row: NodeId, edge: "start" | "end"): EditOutcome {
  const { tree } = view;
  const parent = tree.slots[tree.nodes[row].parent!];
  const rows = parent.children.filter((child) => tree.nodes[child].kind === "row");
  const neighbour = rows[rows.indexOf(row) + (edge === "start" ? -1 : 1)];
  if (neighbour == null) {
    return NONE;
  }
  const cells = presentSlots(tree, neighbour);
  const cell = edge === "start" ? cells.at(-1) : cells[0];
  return cell ? { kind: "move", to: { slot: cell.id, index: edge === "start" ? cell.children.length : 0 } } : NONE;
}

/** A slot with nothing visible in it. */
function isEmptySlot(view: EditView, slot: SlotId): boolean {
  return view.tree.slots[slot].children.every((child) => itemRole(view.tree, child) === "invisible");
}

/** The script slot last in source (the one ⌫ reaches first), or null. */
function lastScript(view: EditView, scripted: NodeId): SlotId | null {
  const scripts = presentSlots(view.tree, scripted).filter((slot) => slot.role === "sup" || slot.role === "sub");
  scripts.sort((left, right) => left.contentSpan.from - right.contentSpan.from);
  return scripts.at(-1)?.id ?? null;
}

/**
 * Deletes one item, then cleans up what that leaves: an emptied style
 * wrapper disappears, a script emptied from outside is removed with its
 * `^` (O3), and an emptied unbraced argument gets braces (`\frac1n`).
 * Deleting a control word in math takes its terminator space along (M7).
 */
function deleteItem(view: EditView, node: NodeId, direction: "backward" | "forward", throughScript: boolean): EditOutcome {
  const { tree } = view;
  const record = tree.nodes[node];
  let span: Span = record.span;
  const slot = tree.slots[record.parent!];
  if (slot.mode === "math" && /^\\[A-Za-z@]+$/u.test(tree.text.slice(span.from, span.to))) {
    span = { from: span.from, to: gapEnd(view, slot.id, span.to) };
  }
  const cleanup = slot.children.length === 1 ? emptiedSlotCleanup(view, slot.id, throughScript) : null;
  return removeWithCleanup(view, span, cleanup, slot.mode, direction === "backward" ? "delete-backward" : "delete-forward");
}

/** Removes a whole node (an empty construct or wrapper), cleaning up its slot as for an item. */
function removeNode(view: EditView, node: NodeId): EditOutcome {
  const { tree } = view;
  const record = tree.nodes[node];
  const parent = record.parent == null ? null : tree.slots[record.parent];
  const cleanup = parent?.children.length === 1 ? emptiedSlotCleanup(view, parent.id, false) : null;
  return removeWithCleanup(view, record.span, cleanup, parent?.mode ?? "text", null);
}

/** Deletes a span, or what its slot's cleanup says instead; the caret goes inside braces put back. */
function removeWithCleanup(
  view: EditView,
  span: Span,
  cleanup: { span: Span; insert?: string } | null,
  mode: EditMode,
  run: string | null
): EditOutcome {
  const patches = new PatchSet();
  if (!cleanup) {
    return finishDeletion(view, patches.delete(span), span.from, mode, run);
  }
  if (cleanup.insert == null) {
    return finishDeletion(view, patches.delete(cleanup.span), cleanup.span.from, mode, run);
  }
  const raw = patches.replace(cleanup.span, cleanup.insert).patches();
  return { kind: "patch", patches: raw, caret: mapThrough(raw, cleanup.span.from) + 1, run: null };
}

/**
 * What to remove when a slot loses its last item: the wrapper around it
 * (recursively, for nested wrappers), the script with its marker, or the
 * item replaced by braces in an unbraced argument. Null: just the item.
 */
function emptiedSlotCleanup(
  view: EditView,
  slot: SlotId,
  throughScript: boolean
): { span: Span; insert?: string } | null {
  const { tree } = view;
  const record = tree.slots[slot];
  const owner = record.node;
  if (itemRole(tree, owner) === "transparent" && presentSlots(tree, owner).length === 1) {
    const parent = tree.nodes[owner].parent;
    if (parent != null && tree.slots[parent].children.length === 1) {
      const outer = emptiedSlotCleanup(view, parent, throughScript);
      if (outer) {
        return outer;
      }
    }
    return { span: tree.nodes[owner].span };
  }
  if (throughScript && (record.role === "sup" || record.role === "sub")) {
    return { span: slotOuterSpan(tree, slot) };
  }
  if (!record.braced && ARGUMENT_ROLES.has(record.role)) {
    return { span: record.contentSpan, insert: "{}" };
  }
  return null;
}

/** The end of the insignificant whitespace after an offset inside a slot. */
function gapEnd(view: EditView, slot: SlotId, from: number): number {
  const record = view.tree.slots[slot];
  const next = record.children.map((child) => view.tree.nodes[child].span.from).find((start) => start >= from);
  const limit = next ?? record.contentSpan.to;
  let end = from;
  while (end < limit && /\s/u.test(view.tree.text[end])) {
    end += 1;
  }
  return end;
}

/**
 * Assembles the patches, restores a control word's terminator at the seam
 * (R5), and places the caret there. A one-character deletion joins the
 * typing run named by `run`.
 */
function finishDeletion(view: EditView, set: PatchSet, seam: number, mode: EditMode, run: string | null): EditOutcome {
  const raw = set.patches();
  const caret = mapThrough(raw, seam);
  const patches = withTerminator(view.tree.text, raw, caret, mode);
  const single = raw.length === 1 && raw[0].insert === "" && raw[0].to - raw[0].from === 1;
  return { kind: "patch", patches, caret, run: single ? run : null };
}

/**
 * Deletes a promoted selection (R9 range rule, F5): everything between the
 * ends except the delimiters of constructs the range only partly covers
 * (they can only be style wrappers or the common slot's ancestors after
 * promotion). Wrappers left empty disappear; emptied unbraced arguments
 * get braces. The caret collapses to the start, where `insert` (typing
 * over the selection, F6) goes.
 */
export function deleteRange(view: EditView, start: Position, end: Position, insert = ""): EditOutcome {
  const { tree } = view;
  const from = view.offset(start);
  const to = view.offset(end);
  if (to <= from) {
    return NONE;
  }
  const partial = tree.nodes.filter((node) =>
    node.span.from < to && node.span.to > from && !(node.span.from >= from && node.span.to <= to)
  );
  const kept: Span[] = partial.flatMap((node) => node.delimiters.filter((span) => span.from < to && span.to > from));
  // Partly covered wrappers and slots that the range empties, innermost first.
  const removals: { span: Span; insert?: string }[] = [];
  for (const node of [...partial].sort((left, right) => (left.span.to - left.span.from) - (right.span.to - right.span.from))) {
    for (const slot of presentSlots(tree, node.id)) {
      const emptied = slot.contentSpan.from >= from && slot.contentSpan.to <= to && slot.children.length > 0;
      if (!emptied) {
        continue;
      }
      if (itemRole(tree, node.id) === "transparent") {
        removals.push({ span: node.span });
      } else if (!slot.braced && ARGUMENT_ROLES.has(slot.role)) {
        removals.push({ span: slot.contentSpan, insert: "{}" });
      }
    }
  }
  const set = new PatchSet();
  let cursor = from;
  for (const span of [...kept].sort((left, right) => left.from - right.from)) {
    set.delete({ from: cursor, to: Math.max(cursor, span.from) });
    cursor = Math.max(cursor, span.to);
  }
  set.delete({ from: cursor, to });
  for (const removal of removals) {
    if (removal.insert != null) {
      set.replace(removal.span, removal.insert);
    } else {
      set.delete(removal.span);
    }
  }
  const seam = Math.min(from, ...removals.map((removal) => removal.span.from));
  if (insert) {
    const patches = set.replace({ from: seam, to: seam }, insert).patches();
    return { kind: "patch", patches, caret: mapThrough(patches, seam) + insert.length, run: null };
  }
  return finishDeletion(view, set, seam, tree.slots[start.slot].mode, null);
}
