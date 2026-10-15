import { requireArrayValue } from "../../utils/collections.js";
import { editSlotAt, editNodeAt } from "../tree/lookup.js";
import { ARGUMENT_ROLES } from "../ownership/kinds.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import { childIndex, presentSlots } from "../tree/navigate.js";
import type { EditMode, NodeId, SlotId, Span } from "../tree/types.js";
import type { BufferPatch } from "../transaction/transaction.js";
import { mapThrough, PatchSet, slotOuterSpan, withBracketGuard, withTerminator } from "./source.js";
import { joinRows } from "./structure.js";

/**
 * Deletion (R9, O2, O3, F5). Operations return what should happen; the
 * resolver turns it into a transaction.
 */
export type EditOutcome =
  /**
   * Source patches; `caret` is a post-edit offset. `run` names the typing
   * run the edit joins. `placeholder`: the post-edit offset of
   * editor-created braces the caret is put in (R6). `exact`: the caret
   * stays at that offset, not snapped to a stop (a fresh line after a
   * list). `selectionEnd`: the edit keeps a selection from `caret` to it.
   */
  | {
      readonly kind: "patch";
      readonly patches: readonly BufferPatch[];
      readonly caret: number;
      readonly run: string | null;
      readonly placeholder?: number;
      readonly exact?: boolean;
      readonly selectionEnd?: number;
      /** R12: the edit transforms a keystroke; this is the keystroke as typed, its own undo state. */
      readonly literal?: { readonly patches: readonly BufferPatch[]; readonly caret: number };
    }
  /** Select a construct first (R9: never delete more than one visible item unseen). */
  | { readonly kind: "select"; readonly anchor: Position; readonly focus: Position }
  /** `consumeOpen`: the caret moved to an argument's start by `}`, so a `{` typed next is consumed (R3). */
  | { readonly kind: "move"; readonly to: Position; readonly consumeOpen?: boolean }
  | { readonly kind: "none" }
  /** A flow edge (paragraph or item start/end): the structural keys decide. */
  | { readonly kind: "structural" };

const NONE: EditOutcome = { kind: "none" };
const STRUCTURAL: EditOutcome = { kind: "structural" };

/** Blocks with begin and end tokens: a range may not cut through them. */
const BOUNDED_BLOCKS = new Set(["list", "container", "display", "alignment"]);

/** Slots whose emptying removes them, rather than leaving a placeholder (O2 rule 3). */
const REMOVABLE_ROLES = new Set(["sup", "sub", "index"]);

/** ⌫ with a caret (O2 rules 2–6). */
export function deleteBackward(view: EditView, caret: Position): EditOutcome {
  const { tree } = view;
  let slot = caret.slot;
  let at = caret.index;
  let throughScript = false;
  for (;;) {
    const record = editSlotAt(tree.slots, slot);
    const owner = record.node;
    while (at > 0 && view.role(requireArrayValue(record.children, at - 1)) === "invisible") {
      at -= 1;
    }
    if (at === 0) {
      const edge = slotEdge(view, slot, "start");
      if (edge.kind !== "walk-out") {
        return edge.outcome;
      }
      slot = editNodeAt(tree.nodes, owner).parent!;
      at = childIndex(tree, owner);
      continue;
    }
    const child = requireArrayValue(record.children, at - 1);
    switch (view.role(child)) {
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
        at = editSlotAt(tree.slots, script).children.length;
        throughScript = true;
        continue;
      }
      case "unit": {
        // O3: a base that has scripts is not emptied from under them (they
        // would re-attach to whatever precedes it); the scripted atom is
        // selected first, as ⌦ does from before it.
        if (record.role === "base" && record.children.every((other) => other === child || view.role(other) === "invisible")) {
          const scripted = editNodeAt(tree.nodes, owner);
          const parent = scripted.parent!;
          const index = childIndex(tree, owner);
          return { kind: "select", anchor: { slot: parent, index: index + 1 }, focus: { slot: parent, index } };
        }
        return deleteItem(view, child, "backward", throughScript);
      }
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
    const record = editSlotAt(tree.slots, slot);
    const owner = record.node;
    while (at < record.children.length && view.role(requireArrayValue(record.children, at)) === "invisible") {
      at += 1;
    }
    if (at === record.children.length) {
      const edge = slotEdge(view, slot, "end");
      if (edge.kind !== "walk-out") {
        return edge.outcome;
      }
      slot = editNodeAt(tree.nodes, owner).parent!;
      at = childIndex(tree, owner) + 1;
      continue;
    }
    const child = requireArrayValue(record.children, at);
    switch (view.role(child)) {
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
  const record = editSlotAt(tree.slots, slot);
  const owner = record.node;
  const role = view.role(owner);
  const outcome = (value: EditOutcome): EdgeDecision => ({ kind: "outcome", outcome: value });
  if (role === "flow") {
    // Paragraph and item edges are structural; the edges of a display or
    // a block title stop the key rather than eat the block's delimiters.
    // An item's label edges are not block edges: ⌦ at its end goes into the item's text.
    const kind = editNodeAt(tree.nodes, owner).kind;
    if (kind === "item" && record.role === "label") {
      const flow = presentSlots(tree, owner).find((candidate) => candidate.role === "flow");
      return outcome(edge === "end" && flow ? { kind: "move", to: { slot: flow.id, index: 0 } } : NONE);
    }
    return outcome(kind === "paragraph" || kind === "item" ? STRUCTURAL : NONE);
  }
  if (role === "transparent") {
    return isEmptySlot(view, slot)
      ? outcome(removeNode(view, owner))
      : { kind: "walk-out" };
  }
  const allSlots = presentSlots(tree, owner);
  const slots = allSlots.filter((candidate) => !view.hiddenSlots.has(candidate.id));
  if (editNodeAt(tree.nodes, owner).kind === "row" && slots[edge === "start" ? 0 : slots.length - 1]?.id === slot) {
    // A row's edges are its breaks (D3), empty or not.
    return outcome(neighbouringRow(view, owner, edge));
  }
  const hiddenContent = allSlots.some((candidate) => view.hiddenSlots.has(candidate.id) && candidate.children.length > 0);
  if (!hiddenContent && slots.every((candidate) => isEmptySlot(view, candidate.id))) {
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
  const node = editNodeAt(tree.nodes, owner);
  if (node.kind === "row") {
    return outcome(neighbouringRow(view, owner, edge));
  }
  if (node.parent == null || editNodeAt(tree.nodes, editSlotAt(tree.slots, node.parent).node).kind === "alignment") {
    return outcome(NONE);
  }
  const index = childIndex(tree, owner);
  return outcome({ kind: "move", to: { slot: node.parent, index: edge === "start" ? index : index + 1 } });
}

/**
 * At a row's first cell start: the row joins the previous one (D3), or,
 * where it cannot, the caret moves to the previous row's last cell end
 * (and the mirror).
 */
function neighbouringRow(view: EditView, row: NodeId, edge: "start" | "end"): EditOutcome {
  const joined = joinRows(view, row, edge === "start" ? "backward" : "forward");
  if (joined) {
    return joined;
  }
  const { tree } = view;
  const parent = editSlotAt(tree.slots, editNodeAt(tree.nodes, row).parent!);
  const rows = parent.children.filter((child) => editNodeAt(tree.nodes, child).kind === "row");
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
  return editSlotAt(view.tree.slots, slot).children.every((child) => view.role(child) === "invisible");
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
  const record = editNodeAt(tree.nodes, node);
  let span: Span = record.span;
  const slot = editSlotAt(tree.slots, record.parent!);
  if (slot.mode === "math" && /^\\[A-Za-z@]+$/u.test(tree.text.slice(span.from, span.to))) {
    span = { from: span.from, to: gapEnd(view, slot.id, span.to) };
  }
  const cleanup = slot.children.length === 1 ? emptiedSlotCleanup(view, slot.id, throughScript) : null;
  return removeWithCleanup(view, span, cleanup, slot.mode, direction === "backward" ? "delete-backward" : "delete-forward");
}

/**
 * Removes a whole node (an empty construct or wrapper), cleaning up its
 * slot as for an item. An inline formula left with nothing visible goes
 * with it: `${‸}$` is removed whole, never left as `$$` (display math).
 */
function removeNode(view: EditView, node: NodeId): EditOutcome {
  const { tree } = view;
  const record = editNodeAt(tree.nodes, node);
  const parent = record.parent == null ? null : editSlotAt(tree.slots, record.parent);
  if (parent && isDollarFormula(view, parent.node) && parent.children.every((child) => child === node || view.role(child) === "invisible")) {
    return removeNode(view, parent.node);
  }
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
  const placeholder = mapThrough(raw, cleanup.span.from);
  return { kind: "patch", patches: raw, caret: placeholder + 1, run: null, placeholder };
}

/** An inline formula delimited by `$`: empty, it would read as `$$` (display math), so it holds `{}` instead. */
export function isDollarFormula(view: EditView, node: NodeId): boolean {
  const record = editNodeAt(view.tree.nodes, node);
  return record.kind === "formula" && view.tree.text[record.span.from] === "$";
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
  const record = editSlotAt(tree.slots, slot);
  const owner = record.node;
  if (view.role(owner) === "transparent" && presentSlots(tree, owner).length === 1) {
    const parent = editNodeAt(tree.nodes, owner).parent;
    if (parent != null && editSlotAt(tree.slots, parent).children.length === 1) {
      const outer = emptiedSlotCleanup(view, parent, throughScript);
      if (outer) {
        return outer;
      }
    }
    return { span: editNodeAt(tree.nodes, owner).span };
  }
  if (throughScript && (record.role === "sup" || record.role === "sub")) {
    // A formula that was only this script (`$_a$`) keeps placeholder braces, as for an item.
    const parent = editNodeAt(tree.nodes, owner).parent;
    const alone = parent != null && isDollarFormula(view, editSlotAt(tree.slots, parent).node) &&
      editSlotAt(tree.slots, parent).children.every((child) => child === owner || view.role(child) === "invisible") &&
      presentSlots(tree, owner).every((candidate) => candidate.id === slot || isEmptySlot(view, candidate.id));
    return alone ? { span: editSlotAt(tree.slots, parent).contentSpan, insert: "{}" } : { span: slotOuterSpan(tree, slot) };
  }
  if ((!record.braced && ARGUMENT_ROLES.has(record.role)) || isDollarFormula(view, owner)) {
    return { span: record.contentSpan, insert: "{}" };
  }
  return null;
}

/** The end of the insignificant whitespace after an offset inside a slot. */
function gapEnd(view: EditView, slot: SlotId, from: number): number {
  const record = editSlotAt(view.tree.slots, slot);
  const next = record.children.map((child) => editNodeAt(view.tree.nodes, child).span.from).find((start) => start >= from);
  const limit = next ?? record.contentSpan.to;
  let end = from;
  while (end < limit && /\s/u.test(view.tree.text.charAt(end))) {
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
  const patches = withBracketGuard(view.tree.text, withTerminator(view.tree.text, raw, caret, mode), caret);
  const single = raw.length === 1 && requireArrayValue(raw, 0).insert === "" && requireArrayValue(raw, 0).to - requireArrayValue(raw, 0).from === 1;
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
  // Half a list, display or environment cannot go; items starting inside
  // the range join the item the range starts in (their `\item` goes).
  if (partial.some((node) => BOUNDED_BLOCKS.has(node.kind) && node.delimiters.some((span) => span.from < to && span.to > from))) {
    return NONE;
  }
  // Nor can an item's `\item[label]{key}` prefix be cut in half.
  const cutsPrefix = partial.some((node) => {
    if (node.kind !== "item") {
      return false;
    }
    const flow = node.slots.map((slot) => editSlotAt(tree.slots, slot)).find((slot) => slot.role === "flow");
    const prefixEnd = flow?.contentSpan.from ?? node.span.to;
    return [from, to].some((offset) => offset > node.span.from && offset < prefixEnd);
  });
  if (cutsPrefix) {
    return NONE;
  }
  const kept: Span[] = partial
    .filter((node) => !(node.kind === "item" && node.span.from >= from))
    .flatMap((node) => node.delimiters.filter((span) => span.from < to && span.to > from));
  // Partly covered wrappers and slots that the range empties, innermost first.
  const removals: { span: Span; insert?: string }[] = [];
  for (const node of [...partial].sort((left, right) => (left.span.to - left.span.from) - (right.span.to - right.span.from))) {
    for (const slot of presentSlots(tree, node.id)) {
      const emptied = slot.contentSpan.from >= from && slot.contentSpan.to <= to && slot.children.length > 0;
      if (!emptied) {
        continue;
      }
      if (view.role(node.id) === "transparent") {
        // A wrapper goes when the range leaves it empty: all of its text
        // slots (both branches of `\alt<2>{…}{…}`), not just one.
        const empty = presentSlots(tree, node.id).every((other) =>
          other.children.length === 0 || (other.contentSpan.from >= from && other.contentSpan.to <= to));
        if (empty) {
          removals.push({ span: node.span });
        }
      } else if (((!slot.braced && ARGUMENT_ROLES.has(slot.role)) || isDollarFormula(view, node.id)) && !insert) {
        // Typed text refills the slot; otherwise it holds placeholder braces.
        removals.push({ span: slot.contentSpan, insert: "{}" });
      }
    }
  }
  // An inline formula left with nothing visible holds placeholder braces,
  // never `$$` (which reads as display math).
  const covered = (span: Span) =>
    (span.from >= from && span.to <= to) || removals.some((removal) => span.from >= removal.span.from && span.to <= removal.span.to);
  for (const node of partial) {
    const slot = isDollarFormula(view, node.id) ? editSlotAt(tree.slots, requireArrayValue(node.slots, 0)) : null;
    if (slot && !insert && slot.children.length > 0 &&
      slot.children.every((child) => view.role(child) === "invisible" && editNodeAt(tree.nodes, child).kind !== "group" || covered(editNodeAt(tree.nodes, child).span))) {
      for (let index = removals.length - 1; index >= 0; index -= 1) {
        if (requireArrayValue(removals, index).span.from >= slot.contentSpan.from && requireArrayValue(removals, index).span.to <= slot.contentSpan.to) {
          removals.splice(index, 1);
        }
      }
      removals.push({ span: slot.contentSpan, insert: "{}" });
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
  const braces = removals.find((removal) => removal.insert != null && removal.span.from === seam);
  if (braces) {
    const patches = set.patches();
    const placeholder = mapThrough(patches, seam);
    return { kind: "patch", patches, caret: placeholder + 1, run: null, placeholder };
  }
  return finishDeletion(view, set, seam, editSlotAt(tree.slots, start.slot).mode, null);
}
