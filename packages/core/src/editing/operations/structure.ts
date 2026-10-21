import { requireDefined } from "../../utils/invariants.js";
import { requireArrayValue } from "../../utils/collections.js";
import { editNodeAt, editSlotAt } from "../tree/lookup.js";
import { capabilityChain, decideOwner, inTitle, type ChainLink } from "../ownership/keys.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import { childIndex, presentSlots } from "../tree/navigate.js";
import type { EditNode, NodeId, SlotId, Span } from "../tree/types.js";
import type { EditOutcome } from "./delete.js";
import {
  exitEmptyLastItemPatch,
  isBlank,
  joinSeparator,
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
  if (inValue(view, at) || tree.nodes.some((node) => node.slots.length === 0 && node.span.from < at && at < node.span.to)) {
    // A file name, colour or URL edited in place has no lines or paragraphs, nor has a command's own source (`\\[2pt]`).
    return { kind: "none" };
  }
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
    const owner = editNodeAt(tree.nodes, decision.node);
    if (key === "line-break") {
      if (owner.kind === "row") {
        return rowBreak(view, position.slot, decision.node, offset);
      }
      // TeX has no empty line to end: a break needs ink on its line ("There's no line here to end").
      return inkOnLine(view, decision.slot, offset) ? breakAt(view, offset, decision.slot, " \\\\ ") : { kind: "none" };
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
    return owner.kind === "row" ? rowBreak(view, position.slot, owner.id, offset) : { kind: "none" };
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
  const bounds = editSlotAt(tree.slots, slot).contentSpan;
  const { closes, reopens } = carried(view, transparent);
  const collapse = transparent.length === 0;
  const from = collapse ? skipHorizontalBack(tree.text, at, bounds.from) : at;
  const to = collapse ? skipHorizontalForward(tree.text, at, bounds.to) : at;
  const insert = closes + protectBreak(text, tree.text, to) + reopens;
  return patchOutcome({ edits: [{ span: { from, to }, insert }], caret: from + insert.length });
}

/** The source closing the transparent wrappers (innermost first) and reopening them (outermost first). */
function carried(view: EditView, transparent: readonly ChainLink[]): { closes: string; reopens: string } {
  const { tree } = view;
  let closes = "";
  let reopens = "";
  for (const link of transparent) {
    const node = editNodeAt(tree.nodes, link.node);
    const slot = editSlotAt(tree.slots, link.slot);
    closes += tree.text.slice(slot.contentSpan.to, node.span.to);
    let open = tree.text.slice(node.span.from, slot.contentSpan.from);
    if (node.kind === "group") {
      // `{\bf ` reopens with its declarations.
      const first = slot.children.find((child) => editNodeAt(tree.nodes, child).kind !== "declaration");
      open += tree.text.slice(slot.contentSpan.from, first == null ? slot.contentSpan.to : editNodeAt(tree.nodes, first).span.from);
    }
    reopens = open + reopens;
  }
  return { closes, reopens };
}

/** Where a break goes instead of splitting a wrapper with nothing on one side of the caret, or null. */
function wrapperEdge(view: EditView, link: ChainLink, at: number): { position: Position; offset: number } | null {
  const { tree } = view;
  const node = editNodeAt(tree.nodes, link.node);
  const visible = visibleOffsets(view, link.slot);
  const before = visible.some((span) => span.from < at);
  const after = visible.some((span) => span.to > at);
  if (before && after) {
    return null;
  }
  const index = childIndex(tree, node.id);
  return before
    ? { position: { slot: requireDefined(node.parent, "Missing required node.parent"), index: index + 1 }, offset: node.span.to }
    : { position: { slot: requireDefined(node.parent, "Missing required node.parent"), index }, offset: node.span.from };
}

function visibleOffsets(view: EditView, slot: SlotId): Span[] {
  return editSlotAt(view.tree.slots, slot).children.filter((child) => view.role(child) !== "invisible").map((child) => editNodeAt(view.tree.nodes, child).span);
}

/** Whether something visible stands between the previous line break (or the start of the block) and `at`. */
export function inkOnLine(view: EditView, slot: SlotId, at: number): boolean {
  const { tree } = view;
  // From the block the caret's line is in, so that ink before a wrapper around the caret counts.
  let from = slot;
  for (let node = editSlotAt(tree.slots, from).node; !LINE_STARTS.has(editNodeAt(tree.nodes, node).kind) && editNodeAt(tree.nodes, node).parent != null; node = editSlotAt(tree.slots, from).node) {
    from = requireDefined(editNodeAt(tree.nodes, node).parent, "Missing required editNodeAt(tree.nodes, node).parent");
  }
  return lineBefore(view, from, at) === "ink";
}

/** The `\\` line breaks of prose with nothing visible before them on their line, which TeX rejects. */
export function deadBreaks(view: EditView): Span[] {
  const { tree } = view;
  return tree.nodes
    .filter((node) => {
      if (node.kind !== "break" || node.parent == null) {
        return false;
      }
      const slot = editSlotAt(tree.slots, node.parent);
      return slot.mode === "text" && slot.role !== "cell" && !inkOnLine(view, node.parent, node.span.from);
    })
    .map((node) => node.span);
}

/** Whether `at` is inside a value argument (a file name, colour, URL). */
export function inValue(view: EditView, at: number): boolean {
  return view.tree.nodes.some((node) => node.values.some((value) => value.contentSpan.from <= at && at <= value.contentSpan.to));
}

/** Commands after which TeX is between paragraphs. */
const ENDS_PARAGRAPH = new Set(["caption", "frametitle", "framesubtitle"]);

/** Blocks that start a line. */
const LINE_STARTS = new Set(["paragraph", "item", "list", "row", "display", "container", "alignment"]);

/** What comes first going back from `at` in `slot`: ink, a line end, or the slot's start. */
function lineBefore(view: EditView, slot: SlotId, at: number): "ink" | "line" | "start" {
  const { tree } = view;
  const before = editSlotAt(tree.slots, slot).children.filter((child) => editNodeAt(tree.nodes, child).span.from < at);
  let gapEnd = at;
  for (const child of before.reverse()) {
    const node = editNodeAt(tree.nodes, child);
    // A blank line between it and the caret starts a paragraph (the caret's position may still be in the one before).
    if (/\n[ \t]*\n/u.test(tree.text.slice(node.span.to, gapEnd))) {
      return "line";
    }
    gapEnd = node.span.from;
    // (A caption or frame title ends its paragraph: TeX is back between lines after it.)
    if (node.kind === "break" || node.kind === "vertical" || (node.command != null && ENDS_PARAGRAPH.has(node.command))) {
      return "line";
    }
    // (In `overprint`, each `\onslide` starts a box of its own.)
    if (node.command === "onslide" && inOverprint(view, child)) {
      return "line";
    }
    // The node around the caret: its own line so far, then (unless it starts a line) what is before it.
    const inner = node.slots.find((id) => editSlotAt(tree.slots, id).contentSpan.from <= at && at <= editSlotAt(tree.slots, id).contentSpan.to);
    if (inner != null) {
      const found = lineBefore(view, inner, at);
      if (found !== "start") {
        return found;
      }
      if (LINE_STARTS.has(node.kind)) {
        return "line";
      }
      continue;
    }
    // Its own end decides: ink, or a line it ends (`\textbf{a \\ }`).
    const tail = trailing(view, child);
    if (tail) {
      return tail;
    }
  }
  return "start";
}

/** What a node ends with, looking from its end: ink, a line break, or nothing visible (null). */
function trailing(view: EditView, id: NodeId): "ink" | "line" | null {
  const node = editNodeAt(view.tree.nodes, id);
  if (node.kind === "break" || node.kind === "vertical") {
    return "line";
  }
  if (view.role(id) === "invisible" || node.kind === "space" || node.kind === "declaration") {
    return null;
  }
  if (node.slots.length === 0 || (node.kind === "overlay" && node.command != null && OVERLAY_ABSENT.has(node.command))) {
    return inked(view, id) ? "ink" : null;
  }
  const slots = node.slots.map((slot) => editSlotAt(view.tree.slots, slot)).filter((slot) => slot.presence === "present")
    .sort((left, right) => right.contentSpan.from - left.contentSpan.from);
  for (const slot of slots) {
    for (const child of [...slot.children].reverse()) {
      const found = trailing(view, child);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/** Whether a node is inside an `overprint` environment. */
function inOverprint(view: EditView, id: NodeId): boolean {
  const { tree } = view;
  const { from, to } = editNodeAt(tree.nodes, id).span;
  return tree.nodes.some((node) => node.span.from < from && node.span.to > to &&
    (node.command === "overprint" || tree.text.startsWith("\\begin{overprint}", node.span.from)));
}

/** Whether a node puts anything on the page: a visible leaf, or a node with one inside. */
function inked(view: EditView, id: NodeId): boolean {
  const node = editNodeAt(view.tree.nodes, id);
  if (view.role(id) === "invisible" || ["space", "break", "vertical", "declaration"].includes(node.kind)) {
    return false;
  }
  const inSlot = (slot: SlotId) => editSlotAt(view.tree.slots, slot).children.some((child) => inked(view, child));
  if (node.kind === "overlay" && node.command != null && OVERLAY_ABSENT.has(node.command)) {
    // Gone on the other slides (`\only`), or ink on every slide only if each branch has some (`\alt`).
    return node.command !== "only" && node.slots.every((slot) => editSlotAt(view.tree.slots, slot).presence !== "present" || inSlot(slot));
  }
  return node.slots.length === 0 || node.slots.some(inSlot);
}

/** Overlay commands whose content is absent, not just hidden, on some slides. */
const OVERLAY_ABSENT = new Set(["only", "alt", "temporal"]);

/** K9: a `\\` the break writes must not take a `[` after it as its optional argument. */
function protectBreak(insert: string, text: string, after: number): string {
  const rest = text.slice(after).replace(/^\s*/u, "");
  return insert.includes("\\\\") && rest.startsWith("[") ? insert.replace("\\\\", "\\\\{}") : insert;
}

/** ⏎ in a display (D1): to the text after it, or a fresh line below. */
function leaveDisplay(view: EditView, display: NodeId): EditOutcome {
  const { tree } = view;
  const node = editNodeAt(tree.nodes, display);
  const siblings = editSlotAt(tree.slots, requireDefined(node.parent, "Missing required node.parent")).children;
  const next = siblings[siblings.indexOf(display) + 1];
  if (next != null && editNodeAt(tree.nodes, next).kind === "paragraph") {
    return { kind: "move", to: { slot: requireArrayValue(editNodeAt(tree.nodes, next).slots, 0), index: 0 } };
  }
  return patchOutcome({ edits: [{ span: { from: node.span.to, to: node.span.to }, insert: "\n" }], caret: node.span.to + 1 });
}

/**
 * A row break from the caret's slot: the wrappers and formula around the
 * caret in its cell are closed and reopened, as an item split carries
 * them (`$a$ \\\\ $b$`); with one that cannot be (a fraction), nothing.
 */
function rowBreak(view: EditView, slot: SlotId, row: NodeId, at: number): EditOutcome {
  const chain = capabilityChain(view.tree, "enter", slot);
  const inside = chain.slice(0, chain.findIndex((link) => link.node === row));
  if (inside.some((link) => link.capability.kind !== "transparent")) {
    return { kind: "none" };
  }
  return newRow(view, row, at, inside);
}

/** ⏎ in an alignment row (D2): a row break, the rest of the row moving to a new line with the same indent. */
function newRow(view: EditView, row: NodeId, at: number, transparent: readonly ChainLink[] = []): EditOutcome {
  const { tree } = view;
  const span = editNodeAt(tree.nodes, row).span;
  const { closes, reopens } = carried(view, transparent);
  const collapse = transparent.length === 0;
  const from = collapse ? skipHorizontalBack(tree.text, at, span.from) : at;
  const to = collapse ? skipHorizontalForward(tree.text, at, span.to) : at;
  const lineBreak = ` \\\\\n${lineIndentAt(tree.text, span.from)}`;
  // (What is reopened after the break never starts with `[`.)
  const insert = closes + (reopens ? lineBreak : protectBreak(lineBreak, tree.text, to)) + reopens;
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
    if (node.kind !== "alignment" || node.parent == null || editSlotAt(tree.slots, node.parent).mode === "math") {
      continue;
    }
    const content = editSlotAt(tree.slots, requireArrayValue(node.slots, 0));
    const last = content.children.filter((child) => editNodeAt(tree.nodes, child).kind === "row").at(-1);
    if (last == null || at < editNodeAt(tree.nodes, last).span.to || at > content.contentSpan.to) {
      continue;
    }
    const row = editNodeAt(tree.nodes, last);
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
  const owner = editNodeAt(tree.nodes, decision.node);
  if (owner.kind === "item") {
    return indentItems(view, caret, selectionEnd ?? caret, back ? "unnest" : "nest");
  }
  return owner.kind === "row" ? nextCell(view, owner.id, decision.slot, back) : nextSlot(view, owner.id, decision.slot, back);
}

function nextSlot(view: EditView, owner: NodeId, slot: SlotId, back: boolean): EditOutcome {
  const { tree } = view;
  const slots = presentSlots(tree, owner).filter((candidate) => !view.hiddenSlots.has(candidate.id))
    .sort((left, right) => left.contentSpan.from - right.contentSpan.from);
  const target = slots[slots.findIndex((candidate) => candidate.id === slot) + (back ? -1 : 1)];
  if (target) {
    return { kind: "move", to: { slot: target.id, index: back ? target.children.length : 0 } };
  }
  const node = editNodeAt(tree.nodes, owner);
  const index = childIndex(tree, owner);
  return { kind: "move", to: { slot: requireDefined(node.parent, "Missing required node.parent"), index: back ? index : index + 1 } };
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
  const rows = editSlotAt(tree.slots, requireDefined(editNodeAt(tree.nodes, row).parent, "Missing required editNodeAt(tree.nodes, row).parent")).children.filter((child) => editNodeAt(tree.nodes, child).kind === "row");
  const neighbour = rows[rows.indexOf(row) + (back ? -1 : 1)];
  if (back || rowIsFull(view, cell)) {
    if (neighbour == null) {
      return { kind: "none" };
    }
    const neighbourCells = presentSlots(tree, neighbour);
    const goal = back ? neighbourCells.at(-1) : neighbourCells[0];
    return goal ? { kind: "move", to: { slot: goal.id, index: back ? goal.children.length : 0 } } : { kind: "none" };
  }
  const end = trimmedEnd(tree.text, requireArrayValue(cells, at).contentSpan);
  const insert = end > requireArrayValue(cells, at).contentSpan.from ? " & " : "& ";
  return patchOutcome({ edits: [{ span: { from: end, to: end }, insert }], caret: end + insert.length });
}

/**
 * ⌫ at a row's start or ⌦ at its end (D3): the row joins its neighbour
 * by removing the row break between them, the two cells at the join
 * becoming one. Null when a rule or comment stands between the rows, or
 * when the joined row would have more columns than the alignment fixes
 * (`a&b\\c&d` in a two-column array); the key then moves instead.
 */
export function joinRows(view: EditView, row: NodeId, direction: "backward" | "forward"): EditOutcome | null {
  const { tree } = view;
  const parent = editNodeAt(tree.nodes, row).parent;
  if (parent == null) {
    return null;
  }
  const siblings = editSlotAt(tree.slots, parent).children;
  const at = siblings.indexOf(row);
  const [first, second] = direction === "backward" ? [siblings[at - 1], row] : [row, siblings[at + 1]];
  if (first == null || second == null || editNodeAt(tree.nodes, first).kind !== "row" || editNodeAt(tree.nodes, second).kind !== "row") {
    return null;
  }
  const upper = editNodeAt(tree.nodes, first);
  const breakToken = upper.delimiters.find((span) => span.to === upper.span.to && tree.text[span.from] === "\\");
  if (!breakToken || !isBlank(tree.text, upper.span.to, editNodeAt(tree.nodes, second).span.from)) {
    return null;
  }
  const limit = columnLimit(view, editSlotAt(tree.slots, parent).node);
  if (limit != null && columnsUsed(view, first) + columnsUsed(view, second) - 1 > limit) {
    return null;
  }
  const lastCell = presentSlots(tree, first).at(-1);
  const firstCell = presentSlots(tree, second)[0];
  if (!lastCell || !firstCell) {
    return null;
  }
  const from = trimmedEnd(tree.text, { from: lastCell.contentSpan.from, to: breakToken.from });
  const to = skipHorizontalForward(tree.text, firstCell.contentSpan.from, firstCell.contentSpan.to);
  const insert = from === upper.span.from ? "" : joinSeparator(tree.text, from, " ");
  return patchOutcome({ edits: [{ span: { from, to }, insert }], caret: direction === "backward" ? from + insert.length : from });
}

/** Whether the row of `cell` has all the columns its alignment fixes (`\multicolumn{n}` counting n), so `&` cannot add one. */
export function rowIsFull(view: EditView, cell: SlotId): boolean {
  const { tree } = view;
  const row = editSlotAt(tree.slots, cell).node;
  const parent = editNodeAt(tree.nodes, row).parent;
  const columns = parent == null ? null : columnLimit(view, editSlotAt(tree.slots, parent).node);
  if (columns == null) {
    return false;
  }
  return columnsUsed(view, row) >= columns;
}

/** The columns a row takes, `\multicolumn{n}` counting n. */
function columnsUsed(view: EditView, row: NodeId): number {
  const { tree } = view;
  return presentSlots(tree, row).reduce((sum, slot) => {
    const spans = /^\s*\\multicolumn\s*\{\s*(\d+)\s*\}/u.exec(tree.text.slice(slot.contentSpan.from, slot.contentSpan.to));
    return sum + (spans ? Number(spans[1]) : 1);
  }, 0);
}

/** The most columns a row of an alignment takes. */
export function widestRow(view: EditView, alignment: NodeId): number {
  const { tree } = view;
  return Math.max(0, ...tree.nodes
    .filter((node) => node.kind === "row" && node.parent != null && editSlotAt(tree.slots, node.parent).node === alignment)
    .map((row) => columnsUsed(view, row.id)));
}

/** The fixed column count of an alignment (`array`/`tabular` specification, `alignat{n}`), or null. */
function columnLimit(view: EditView, alignment: NodeId): number | null {
  const { tree } = view;
  const node = editNodeAt(tree.nodes, alignment);
  const spec = node.values.find((value) => value.role === "spec");
  if (spec) {
    return specColumns(tree.text.slice(spec.contentSpan.from, spec.contentSpan.to));
  }
  if (node.command?.startsWith("alignat")) {
    const count = Number.parseInt(tree.text.slice(node.values[0]?.contentSpan.from ?? 0, node.values[0]?.contentSpan.to ?? 0), 10);
    return Number.isFinite(count) ? 2 * count : null;
  }
  return node.command == null ? null : FIXED_COLUMNS.get(node.command.replace(/\*$/u, "")) ?? null;
}

/** The columns a column specification makes (`lr`, `*{2}{lr}`, `|p{3cm}|c|`), or null when it names none. */
export function specColumns(spec: string): number | null {
  const text = expandRepeats(spec).replace(/[@!>]\{[^}]*\}|<\{[^}]*\}|\{[^}]*\}/gu, "");
  return (text.match(/[lcrpmbXS]/gu) ?? []).length || null;
}

/** A column spec with its repetitions written out: `*{2}{lr}` is `lrlr`. */
function expandRepeats(spec: string): string {
  const repeat = /\*\s*\{\s*(\d+)\s*\}\s*\{/u.exec(spec);
  if (!repeat) {
    return spec;
  }
  const open = repeat.index + repeat[0].length;
  let depth = 1;
  let close = open;
  while (close < spec.length && depth > 0) {
    depth += spec[close] === "{" ? 1 : spec[close] === "}" ? -1 : 0;
    close += 1;
  }
  const body = spec.slice(open, close - 1);
  return spec.slice(0, repeat.index) + expandRepeats(body.repeat(Math.min(Number(repeat[1]), 64))) + expandRepeats(spec.slice(close));
}

/** Alignments whose column count amsmath fixes (matrices: MaxMatrixCols). */
const FIXED_COLUMNS: ReadonlyMap<string, number> = new Map([
  ...["cases", "dcases", "rcases", "split"].map((name) => [name, 2] as const),
  ...["gather", "gathered", "multline"].map((name) => [name, 1] as const),
  ...["matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "smallmatrix"].map((name) => [name, 10] as const),
]);

/** ⇥ / ⇧⇥ on the items from `start` to `end` (one list), or the toolbar indent buttons. */
export function indentItems(view: EditView, start: Position, end: Position, direction: "nest" | "unnest"): EditOutcome {
  const { tree } = view;
  const first = listItemOf(tree, editSlotAt(tree.slots, start.slot).node);
  const last = listItemOf(tree, editSlotAt(tree.slots, end.slot).node);
  if (!first || first.list.node !== last?.list.node || last.index < first.index) {
    return { kind: "none" };
  }
  const moved = { from: first.item.commandSpan.from, to: requireArrayValue(last.list.items, last.index).contentSpan.to };
  if (direction === "nest" && !nestable(view, first.list.node, moved.from, moved.to)) {
    return { kind: "none" };
  }
  const caret = view.offset(start);
  const patch = nestItemsPatch(tree.text, listShapes(tree), first, last.index, direction, caret, view.offset(end));
  return patch ? patchOutcome(patch) : { kind: "none" };
}

/**
 * Whether items of `list` from `from` to `to` may go one level deeper:
 * beamer nests three lists, of any kinds ("Too deeply nested"), counting
 * the lists inside the items, which go deeper too.
 */
function nestable(view: EditView, list: NodeId, from: number, to: number): boolean {
  const { tree } = view;
  const depth = (id: NodeId) => {
    let lists = 0;
    for (let node: NodeId | null = id; node != null; node = editNodeAt(tree.nodes, node).parent == null ? null : editSlotAt(tree.slots, requireDefined(editNodeAt(tree.nodes, node).parent, "Missing required editNodeAt(tree.nodes, node).parent")).node) {
      lists += editNodeAt(tree.nodes, node).kind === "list" ? 1 : 0;
    }
    return lists;
  };
  const inner = tree.nodes.filter((node) => node.kind === "list" && node.span.from >= from && node.span.to <= to);
  return [list, ...inner.map((node) => node.id)].every((id) => depth(id) + 1 <= BEAMER_LIST_DEPTH);
}

const BEAMER_LIST_DEPTH = 3;

/** The toolbar list buttons: rename, dissolve or create a list at the caret. */
export function toggleList(view: EditView, caret: Position, environment: "itemize" | "enumerate"): EditOutcome {
  const { tree } = view;
  if (inTitle(tree, caret.slot)) {
    return { kind: "none" };
  }
  const chain = capabilityChain(tree, "enter", caret.slot);
  const at = view.offset(caret);
  const context = listItemOf(tree, editSlotAt(tree.slots, caret.slot).node);
  if (context) {
    return patchOutcome(toggleListPatch(tree.text, context, environment, at));
  }
  const paragraph = chain.map((link) => editNodeAt(tree.nodes, link.node)).find((node) => node.kind === "paragraph");
  if (paragraph) {
    const content = editSlotAt(tree.slots, requireArrayValue(paragraph.slots, 0)).contentSpan;
    const span = { from: content.from, to: trimmedEnd(tree.text, content) };
    return patchOutcome(wrapInListPatch(tree.text, span, environment, at));
  }
  const slot = editSlotAt(tree.slots, caret.slot);
  return slot.flow && slot.children.length === 0
    ? patchOutcome(wrapInListPatch(tree.text, slot.contentSpan, environment, at))
    : { kind: "none" };
}

/**
 * ⌫ at the start of a paragraph or an empty item: an item joins the
 * previous one; a paragraph joins the paragraph before it. After another
 * block (a list, a display) the caret moves to its end.
 */
export function joinBackward(view: EditView, caret: Position): EditOutcome {
  const { tree } = view;
  const block = blockAt(view, caret.slot);
  if (block == null) {
    return { kind: "none" };
  }
  const context = itemOfBlock(view, block);
  if (context && firstBlockOf(view, block)) {
    // A labelled item is not merged away with its label: the caret goes into the label.
    const label = itemLabel(view, context.item.node);
    if (label) {
      return { kind: "move", to: { slot: label.id, index: label.children.length } };
    }
    // From the item's start, even with the caret inside a wrapper there (`\item \textbf{‸x}`).
    const patch = mergeWithPreviousItemPatch(tree.text, context, context.item.contentSpan.from);
    return patch ? patchOutcome(patch) : { kind: "none" };
  }
  const node = editNodeAt(tree.nodes, block);
  const siblings = editSlotAt(tree.slots, requireDefined(node.parent, "Missing required node.parent")).children;
  const previous = siblings[siblings.indexOf(block) - 1];
  if (previous != null && editNodeAt(tree.nodes, previous).kind === "paragraph" && node.kind === "paragraph") {
    const from = trimmedEnd(tree.text, editNodeAt(tree.nodes, previous).span);
    const insert = joinSeparator(tree.text, from, " ");
    return patchOutcome({ edits: [{ span: { from, to: node.span.from }, insert }], caret: from + insert.length });
  }
  const step = view.step(caret, -1);
  return step ? { kind: "move", to: step } : { kind: "none" };
}

/** ⌦ at the end of a paragraph or an empty item: the mirror of joinBackward. */
export function joinForward(view: EditView, caret: Position): EditOutcome {
  const { tree } = view;
  const block = blockAt(view, caret.slot);
  if (block == null) {
    return { kind: "none" };
  }
  const context = itemOfBlock(view, block);
  if (context && lastBlockOf(view, block)) {
    const next = context.list.items[context.index + 1];
    if (next && itemLabel(view, next.node)) {
      return { kind: "none" };
    }
    // From the item's end, even with the caret inside a wrapper there (`\textit{+‸}`).
    const patch = mergeNextItemPatch(tree.text, context, trimmedEnd(tree.text, context.item.contentSpan));
    return patch ? patchOutcome(patch) : { kind: "none" };
  }
  const node = editNodeAt(tree.nodes, block);
  const siblings = editSlotAt(tree.slots, requireDefined(node.parent, "Missing required node.parent")).children;
  const next = siblings[siblings.indexOf(block) + 1];
  if (next != null && editNodeAt(tree.nodes, next).kind === "paragraph" && node.kind === "paragraph") {
    const from = trimmedEnd(tree.text, node.span);
    return patchOutcome({ edits: [{ span: { from, to: editNodeAt(tree.nodes, next).span.from }, insert: joinSeparator(tree.text, from, " ") }], caret: from });
  }
  const step = view.step(caret, 1);
  return step ? { kind: "move", to: step } : { kind: "none" };
}

/** The list item a block belongs to directly (the item itself, or a paragraph in its flow). */
function itemOfBlock(view: EditView, block: NodeId) {
  const { tree } = view;
  const node = editNodeAt(tree.nodes, block);
  const owner = node.kind === "item" ? node : node.parent == null ? null : editNodeAt(tree.nodes, editSlotAt(tree.slots, node.parent).node);
  return owner?.kind === "item" ? listItemOf(tree, owner.id) : null;
}

/** An item's present, non-empty label slot (`\item[Hessian]`), or null. */
function itemLabel(view: EditView, item: NodeId) {
  const label = presentSlots(view.tree, item).find((slot) => slot.role === "label");
  return label && label.children.length > 0 ? label : null;
}

/** The paragraph, or the empty item, a caret slot belongs to. */
function blockAt(view: EditView, slot: SlotId): NodeId | null {
  const { tree } = view;
  for (let current: SlotId | null = slot; current != null;) {
    const node: EditNode = editNodeAt(tree.nodes, editSlotAt(tree.slots, current).node);
    if (node.kind === "paragraph" || node.kind === "item") {
      return node.id;
    }
    current = node.parent;
  }
  return null;
}

function firstBlockOf(view: EditView, block: NodeId): boolean {
  const node = editNodeAt(view.tree.nodes, block);
  return node.kind === "item" || editSlotAt(view.tree.slots, requireDefined(node.parent, "Missing required node.parent")).children[0] === block;
}

function lastBlockOf(view: EditView, block: NodeId): boolean {
  const node = editNodeAt(view.tree.nodes, block);
  return node.kind === "item" || editSlotAt(view.tree.slots, requireDefined(node.parent, "Missing required node.parent")).children.at(-1) === block;
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
    ...(patch.selectionEnd === undefined ? {} : { selectionEnd: patch.selectionEnd }),
  };
}

/** Whether a slot is in an alignment's rows (a cell, at any depth short of a formula). */
export function inAlignment(view: EditView, slot: SlotId): boolean {
  const { tree } = view;
  for (let current: SlotId | null = slot; current != null; current = editNodeAt(tree.nodes, editSlotAt(tree.slots, current).node).parent) {
    if (editSlotAt(tree.slots, current).role === "cell" || editNodeAt(tree.nodes, editSlotAt(tree.slots, current).node).kind === "alignment") {
      return true;
    }
    if (editNodeAt(tree.nodes, editSlotAt(tree.slots, current).node).kind === "formula") {
      return false;
    }
  }
  return false;
}

/** Whether a slot is a list item's flow, or a paragraph in one. */
export function inListFlow(view: EditView, slot: SlotId): boolean {
  const { tree } = view;
  const paragraph = editNodeAt(tree.nodes, editSlotAt(tree.slots, slot).node);
  const flow = paragraph.kind === "paragraph" && paragraph.parent != null ? paragraph.parent : slot;
  const kind = editNodeAt(tree.nodes, editSlotAt(tree.slots, flow).node).kind;
  return (kind === "item" && editSlotAt(tree.slots, flow).role === "flow") || kind === "list";
}
