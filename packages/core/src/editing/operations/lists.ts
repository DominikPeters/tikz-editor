import type { EditNode, EditTree, NodeId, Span } from "../tree/types.js";

/**
 * List structure for the structural keys (item split and exit, merge,
 * nest and unnest, the list toggle), read from the edit tree. Patches are
 * source edits around the boundary tokens, keeping the author's line
 * layout: a token that has its line to itself is removed with the line,
 * and new tokens go on lines of their own, indented like their neighbours.
 */

export type ItemShape = {
  readonly node: NodeId;
  /** `\item`, its overlay and `[label]`, up to the content. */
  readonly commandSpan: Span;
  readonly labelSpan?: Span;
  /** From the first content character through the next item's token or `\end` (whitespace included). */
  readonly contentSpan: Span;
};

export type ListShape = {
  readonly node: NodeId;
  readonly environment: string;
  /** The `\begin{…}` token. */
  readonly beginSpan: Span;
  /** `\begin{…}` with its arguments (`[<+->]`). */
  readonly openSpan: Span;
  /** The `\end{…}` token. */
  readonly endSpan: Span;
  /** 1 for a top-level list. */
  readonly depth: number;
  readonly items: readonly ItemShape[];
};

export type ListContext = { readonly list: ListShape; readonly item: ItemShape; readonly index: number };

export type SourceEdit = { readonly span: Span; readonly insert: string };

/** Edits (sorted, disjoint) and the caret, or a selection, after them. */
export type StructuralPatch = {
  readonly edits: readonly SourceEdit[];
  readonly caret: number;
  readonly selectionEnd?: number;
};

const shapes = new WeakMap<EditTree, readonly ListShape[]>();

/** The tree's closed `itemize`/`enumerate`/`description` lists, in source order. */
export function listShapes(tree: EditTree): readonly ListShape[] {
  let found = shapes.get(tree);
  if (!found) {
    found = tree.nodes.flatMap((node) => {
      if (node.kind !== "list" || !node.command || !LIST_ENVIRONMENTS.has(node.command)) {
        return [];
      }
      const begin = node.delimiters[0];
      const end = node.delimiters.at(-1);
      const flow = tree.slots[node.slots[0]];
      if (!begin || !end || !tree.text.startsWith("\\end", end.from)) {
        return [];
      }
      const items = flow.children.flatMap((child) => {
        const item = tree.nodes[child];
        if (item.kind !== "item") {
          return [];
        }
        const slots = item.slots.map((slot) => tree.slots[slot]);
        const label = slots.find((slot) => slot.role === "label");
        const content = slots.find((slot) => slot.role === "flow")!;
        return [{
          node: item.id,
          commandSpan: { from: item.span.from, to: content.contentSpan.from },
          labelSpan: label?.presence === "present" ? label.contentSpan : undefined,
          contentSpan: content.contentSpan,
        }];
      });
      let depth = 1;
      for (let parent = node.parent; parent != null; parent = tree.nodes[tree.slots[parent].node].parent) {
        if (tree.nodes[tree.slots[parent].node].kind === "list") {
          depth += 1;
        }
      }
      const openTo = trimmedEnd(tree.text, { from: begin.from, to: flow.contentSpan.from });
      return [{
        node: node.id,
        environment: node.command,
        beginSpan: begin,
        openSpan: { from: begin.from, to: openTo },
        endSpan: end,
        depth,
        items,
      }];
    });
    shapes.set(tree, found);
  }
  return found;
}

const LIST_ENVIRONMENTS = new Set(["itemize", "enumerate", "description"]);

/** The innermost list item holding a node, with its list. */
export function listItemOf(tree: EditTree, node: NodeId): ListContext | null {
  for (let current: NodeId | null = node; current != null;) {
    const record: EditNode = tree.nodes[current];
    if (record.kind === "item") {
      for (const list of listShapes(tree)) {
        const index = list.items.findIndex((item) => item.node === current);
        if (index >= 0) {
          return { list, item: list.items[index], index };
        }
      }
      return null;
    }
    current = record.parent == null ? null : tree.slots[record.parent].node;
  }
  return null;
}

export function lineStartAt(source: string, offset: number): number {
  return source.lastIndexOf("\n", offset - 1) + 1;
}

export function lineEndAt(source: string, offset: number): number {
  const index = source.indexOf("\n", offset);
  return index < 0 ? source.length : index;
}

export function lineIndentAt(source: string, offset: number): string {
  const start = lineStartAt(source, offset);
  let index = start;
  while (source[index] === " " || source[index] === "\t") {
    index += 1;
  }
  return source.slice(start, index);
}

export function isBlank(source: string, from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    if (!/\s/u.test(source[index])) {
      return false;
    }
  }
  return true;
}

export function skipHorizontalBack(source: string, offset: number, min: number): number {
  while (offset > min && (source[offset - 1] === " " || source[offset - 1] === "\t") && !escaped(source, offset - 1)) {
    offset -= 1;
  }
  return offset;
}

/** Whether the character at an offset is escaped (`\ ` is a control space, not whitespace). */
function escaped(source: string, offset: number): boolean {
  let slashes = 0;
  while (offset - slashes > 0 && source[offset - slashes - 1] === "\\") {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

export function skipHorizontalForward(source: string, offset: number, max: number): number {
  while (offset < max && (source[offset] === " " || source[offset] === "\t")) {
    offset += 1;
  }
  return offset;
}

/**
 * What joins two blocks at `end` (the first one's trimmed end): `fallback`,
 * unless the line there ends in a comment, which would take the joined text
 * in; then a line end, which the comment eats (F1: `% tail⏎‸Second`).
 */
export function joinSeparator(source: string, end: number, fallback: string): string {
  return /(?:^|[^\\])(?:\\\\)*%[^\n]*$/u.test(source.slice(lineStartAt(source, end), end)) ? "\n" : fallback;
}

export function trimmedEnd(source: string, span: Span): number {
  let end = span.to;
  while (end > span.from && /\s/u.test(source[end - 1])) {
    end -= 1;
  }
  return end;
}

function tokenStartsItsLine(source: string, tokenFrom: number): boolean {
  return isBlank(source, lineStartAt(source, tokenFrom), tokenFrom);
}

/**
 * The span deleting a boundary token removes: its whole line (including the
 * trailing newline) when the token has the line to itself, else just the
 * token and any horizontal whitespace before it.
 */
export function tokenRemovalSpan(source: string, token: Span): Span {
  const lineFrom = lineStartAt(source, token.from);
  const lineTo = lineEndAt(source, token.to);
  if (isBlank(source, lineFrom, token.from) && isBlank(source, token.to, lineTo)) {
    return { from: lineFrom, to: Math.min(source.length, lineTo + 1) };
  }
  return { from: skipHorizontalBack(source, token.from, lineFrom), to: token.to };
}

/**
 * An insertion placing `lineText` (no trailing newline) on its own line
 * directly before the line holding `tokenFrom`; inline when the token
 * shares its line with earlier material.
 */
function insertBeforeToken(source: string, tokenFrom: number, lineText: string): SourceEdit {
  if (tokenStartsItsLine(source, tokenFrom)) {
    const lineFrom = lineStartAt(source, tokenFrom);
    return { span: { from: lineFrom, to: lineFrom }, insert: `${lineText}\n` };
  }
  return { span: { from: tokenFrom, to: tokenFrom }, insert: `${lineText.trim()} ` };
}

/**
 * Maps a pre-edit offset outside every edit span into post-edit
 * coordinates. An insertion exactly at the offset keeps the caret before
 * the inserted text.
 */
export function mapAfterEdits(edits: readonly SourceEdit[], offset: number): number {
  let delta = 0;
  for (const edit of edits) {
    if (edit.span.to <= offset && edit.span.from < offset) {
      delta += edit.insert.length - (edit.span.to - edit.span.from);
    }
  }
  return offset + delta;
}

function sorted(edits: SourceEdit[]): SourceEdit[] {
  // A zero-width insert sharing `from` with a removal goes first.
  return edits.sort((left, right) =>
    left.span.from - right.span.from || (left.span.to - left.span.from) - (right.span.to - right.span.from));
}

function openText(source: string, list: ListShape): string {
  return source.slice(list.openSpan.from, list.openSpan.to);
}

/** Enter in an item: its surrounding horizontal whitespace becomes the new item boundary. */
export function splitItemPatch(source: string, context: ListContext, caret: number, closes = "", reopens = ""): StructuralPatch {
  const { item } = context;
  const collapse = closes === "";
  const from = collapse ? skipHorizontalBack(source, caret, item.contentSpan.from) : caret;
  const to = collapse ? skipHorizontalForward(source, caret, item.contentSpan.to) : caret;
  const insert = `${closes}\n${lineIndentAt(source, item.commandSpan.from)}\\item ${reopens}`;
  return { edits: [{ span: { from, to }, insert }], caret: from + insert.length };
}

/** Enter on an empty last item: delete it and continue on a fresh line after the list (or remove a list left empty). */
export function exitEmptyLastItemPatch(source: string, context: ListContext): StructuralPatch {
  const { list, item } = context;
  if (list.items.length === 1) {
    const from = tokenRemovalSpan(source, list.openSpan).from;
    const to = tokenRemovalSpan(source, list.endSpan).to;
    return { edits: [{ span: { from, to }, insert: "" }], caret: from };
  }
  const itemFrom = tokenStartsItsLine(source, item.commandSpan.from)
    ? lineStartAt(source, item.commandSpan.from)
    : skipHorizontalBack(source, item.commandSpan.from, lineStartAt(source, item.commandSpan.from));
  const endLineFrom = tokenStartsItsLine(source, list.endSpan.from)
    ? lineStartAt(source, list.endSpan.from)
    : skipHorizontalBack(source, list.endSpan.from, lineStartAt(source, list.endSpan.from));
  const afterEndLine = lineEndAt(source, list.endSpan.to);
  const edits: SourceEdit[] = [
    { span: { from: itemFrom, to: Math.max(itemFrom, endLineFrom) }, insert: "" },
    { span: { from: afterEndLine, to: afterEndLine }, insert: "\n" },
  ];
  return { edits, caret: mapAfterEdits(edits, afterEndLine) + 1 };
}

/** ⌫ at an item's content start: join it to the previous item with a space. Null on the first item. */
export function mergeWithPreviousItemPatch(source: string, context: ListContext, caret: number): StructuralPatch | null {
  const { list, index } = context;
  if (index === 0) {
    return null;
  }
  const previous = list.items[index - 1];
  const from = trimmedEnd(source, previous.contentSpan);
  const empty = from === previous.contentSpan.from || isBlank(source, caret, context.item.contentSpan.to);
  // An empty previous item ends in its `\item`: the joined text must not run into it (R5).
  const insert = joinSeparator(source, from, empty && !/\\[A-Za-z@]+$/u.test(source.slice(0, from)) ? "" : " ");
  return { edits: [{ span: { from, to: caret }, insert }], caret: from + insert.length };
}

/** ⌦ at an item's content end: join the next item to it. Null on the last item. */
export function mergeNextItemPatch(source: string, context: ListContext, caret: number): StructuralPatch | null {
  const { list, item, index } = context;
  if (index === list.items.length - 1) {
    return null;
  }
  const next = list.items[index + 1];
  const empty = trimmedEnd(source, item.contentSpan) === item.contentSpan.from;
  const insert = joinSeparator(source, caret, empty && !/\\[A-Za-z@]+$/u.test(source.slice(0, caret)) ? "" : " ");
  return { edits: [{ span: { from: caret, to: next.contentSpan.from }, insert }], caret };
}

/**
 * Tab / Shift+Tab: moves items `first..last` of one list one level down
 * (into a same-kind nested list, extending one that already ends the
 * previous item) or up. Null when they cannot move: the first item cannot
 * nest (LaTeX wants an `\item` before a nested list), and a top-level
 * list cannot unnest.
 */
export function nestItemsPatch(
  source: string,
  lists: readonly ListShape[],
  context: ListContext,
  lastIndex: number,
  direction: "nest" | "unnest",
  caret: number,
  selectionEnd: number
): StructuralPatch | null {
  const { list, index } = context;
  const group: ItemShape = {
    ...context.item,
    contentSpan: { from: context.item.contentSpan.from, to: list.items[lastIndex].contentSpan.to },
  };
  const items = [...list.items.slice(0, index), group, ...list.items.slice(lastIndex + 1)];
  const grouped: ListContext = { list: { ...list, items }, item: group, index };
  const edits = direction === "nest" ? nestEdits(source, lists, grouped) : unnestEdits(source, lists, grouped);
  if (!edits) {
    return null;
  }
  return {
    edits,
    caret: mapAfterEdits(edits, caret),
    selectionEnd: selectionEnd === caret ? undefined : mapAfterEdits(edits, selectionEnd),
  };
}

function nestEdits(source: string, lists: readonly ListShape[], context: ListContext): SourceEdit[] | null {
  const { list, item, index } = context;
  if (index === 0) {
    return null;
  }
  const previous = list.items[index - 1];
  const adjacent = lists.find((candidate) =>
    candidate.node !== list.node &&
    candidate.environment === list.environment &&
    candidate.depth === list.depth + 1 &&
    candidate.beginSpan.from >= previous.contentSpan.from &&
    candidate.endSpan.to <= previous.contentSpan.to &&
    isBlank(source, candidate.endSpan.to, item.commandSpan.from));
  if (adjacent) {
    const removal = tokenRemovalSpan(source, adjacent.endSpan);
    const endIndent = lineIndentAt(source, adjacent.endSpan.from);
    const reinsert = insertBeforeToken(source, item.contentSpan.to, `${endIndent}\\end{${list.environment}}`);
    return sorted([{ span: removal, insert: "" }, reinsert]);
  }
  const indent = lineIndentAt(source, item.commandSpan.from);
  const begin = insertBeforeToken(source, item.commandSpan.from, `${indent}\\begin{${list.environment}}`);
  const contentEnd = trimmedEnd(source, item.contentSpan);
  const boundaryLineStart = lineStartAt(source, item.contentSpan.to);
  const end: SourceEdit = boundaryLineStart > contentEnd && tokenStartsItsLine(source, item.contentSpan.to)
    ? { span: { from: boundaryLineStart, to: boundaryLineStart }, insert: `${indent}\\end{${list.environment}}\n` }
    : { span: { from: contentEnd, to: contentEnd }, insert: ` \\end{${list.environment}}` };
  return [begin, end];
}

function unnestEdits(source: string, lists: readonly ListShape[], context: ListContext): SourceEdit[] | null {
  const { list, item, index } = context;
  const parent = lists.find((candidate) => candidate.depth === list.depth - 1 && candidate.items.some((outer) =>
    outer.contentSpan.from <= list.beginSpan.from && list.endSpan.to <= outer.contentSpan.to));
  if (!parent) {
    return null;
  }
  const beginLine = `${lineIndentAt(source, list.beginSpan.from)}${openText(source, list)}`;
  const endLine = `${lineIndentAt(source, list.endSpan.from)}\\end{${list.environment}}`;
  const edits: SourceEdit[] = [];
  if (list.items.length === 1) {
    edits.push({ span: tokenRemovalSpan(source, list.openSpan), insert: "" });
    edits.push({ span: tokenRemovalSpan(source, list.endSpan), insert: "" });
  } else if (index === 0) {
    edits.push({ span: tokenRemovalSpan(source, list.openSpan), insert: "" });
    edits.push(insertBeforeToken(source, list.items[1].commandSpan.from, beginLine));
  } else if (index === list.items.length - 1) {
    edits.push(insertBeforeToken(source, item.commandSpan.from, endLine));
    edits.push({ span: tokenRemovalSpan(source, list.endSpan), insert: "" });
  } else {
    edits.push(insertBeforeToken(source, item.commandSpan.from, endLine));
    edits.push(insertBeforeToken(source, list.items[index + 1].commandSpan.from, beginLine));
  }
  return sorted(edits);
}

/**
 * The list toggle (toolbar bullets/numbers) in a list: renames the
 * innermost list to the other kind, or, for the same kind, dissolves the
 * caret's item back into prose.
 */
export function toggleListPatch(source: string, context: ListContext, environment: string, caret: number): StructuralPatch {
  const { list } = context;
  if (list.environment !== environment) {
    const edits: SourceEdit[] = [
      { span: list.beginSpan, insert: `\\begin{${environment}}` },
      { span: list.endSpan, insert: `\\end{${environment}}` },
    ];
    return { edits, caret: mapAfterEdits(edits, caret) };
  }
  const edits = dissolveItemEdits(source, context);
  return { edits, caret: mapAfterEdits(edits, caret) };
}

/**
 * Removes a list boundary token, keeping an empty line in its place when
 * the material beside it would otherwise join the dissolved item's text:
 * the environment's implicit paragraph break survives its removal.
 */
function boundaryRemovalEdit(source: string, token: Span, neighbour: "above" | "below"): SourceEdit {
  const span = tokenRemovalSpan(source, token);
  const joins = neighbour === "above"
    ? span.from > 0 && !isBlank(source, lineStartAt(source, span.from - 1), span.from - 1)
    : span.to < source.length && !isBlank(source, span.to, lineEndAt(source, span.to));
  return { span, insert: joins ? "\n" : "" };
}

function dissolveItemEdits(source: string, context: ListContext): SourceEdit[] {
  const { list, item, index } = context;
  const beginLine = `${lineIndentAt(source, list.beginSpan.from)}${openText(source, list)}`;
  const endLine = `${lineIndentAt(source, list.endSpan.from)}\\end{${list.environment}}`;
  // The `\item` token (with any label and the whitespace up to the content) goes.
  const edits: SourceEdit[] = [{ span: item.commandSpan, insert: "" }];
  if (list.items.length === 1) {
    edits.push(boundaryRemovalEdit(source, list.openSpan, "above"));
    edits.push(boundaryRemovalEdit(source, list.endSpan, "below"));
  } else if (index === 0) {
    edits.push(boundaryRemovalEdit(source, list.openSpan, "above"));
    edits.push(insertBeforeToken(source, list.items[1].commandSpan.from, beginLine));
  } else if (index === list.items.length - 1) {
    edits.push(insertBeforeToken(source, item.commandSpan.from, endLine));
    edits.push(boundaryRemovalEdit(source, list.endSpan, "below"));
  } else {
    edits.push(insertBeforeToken(source, item.commandSpan.from, endLine));
    edits.push(insertBeforeToken(source, list.items[index + 1].commandSpan.from, beginLine));
  }
  return sorted(edits);
}

/** The list toggle in prose: wraps a paragraph (or an empty flow) in a new one-item list. */
export function wrapInListPatch(source: string, content: Span, environment: string, caret: number): StructuralPatch {
  const indent = lineIndentAt(source, content.from);
  if (content.to <= content.from) {
    const insert = `\\begin{${environment}}\n${indent}\\item \n${indent}\\end{${environment}}`;
    return {
      edits: [{ span: content, insert }],
      caret: content.from + `\\begin{${environment}}\n${indent}\\item `.length,
    };
  }
  const begin = insertBeforeToken(source, content.from, `${indent}\\begin{${environment}}`);
  const edits: SourceEdit[] = [
    begin,
    { span: { from: content.from, to: content.from }, insert: "\\item " },
    { span: { from: content.to, to: content.to }, insert: `\n${indent}\\end{${environment}}` },
  ];
  // Both leading inserts land at or before the caret.
  return { edits, caret: Math.max(caret, content.from) + begin.insert.length + "\\item ".length };
}
