import type { Span } from "../ast/types.js";
import type { BeamerCaretDomain } from "./caret-stops.js";
import type { BeamerObjectIndex, BeamerObjectNode } from "./object-index.js";
import type { BeamerListItemTopology, BeamerListTopology } from "./types.js";

/**
 * Structural key patches for canvas-focused Beamer editing
 * (design/beamer-canvas-editing.md, "Structural keys"). Every function is
 * pure over the caret-stop domain: patches are computed from the engine's
 * retained list topology, never from re-interpreting `\item` in raw source.
 *
 * Result contract:
 * - a patch: apply it and place the caret at `caretOffset`;
 * - `"swallow"`: the key is structural here but has no legal edit
 *   (e.g. Tab on a first item) — consume it without changing the source;
 * - `null`: the position is not structural for this key — the caller falls
 *   back to its plain behavior. This is the design's degradation path for
 *   chunks that failed to parse and published no topology.
 */
export type BeamerStructuralEdit = {
  readonly span: Span;
  readonly insert: string;
};

export type BeamerStructuralPatch = {
  /** Non-overlapping edits in document coordinates, sorted by `span.from`. */
  readonly edits: readonly BeamerStructuralEdit[];
  /** Collapsed caret position in post-edit document coordinates. */
  readonly caretOffset: number;
};

export type BeamerStructuralKeyResult = BeamerStructuralPatch | "swallow" | null;

export type BeamerListItemContext = {
  readonly list: BeamerListTopology;
  readonly item: BeamerListItemTopology;
  readonly index: number;
};

/** Roles whose flow text supports paragraph breaks and line breaks. */
const STRUCTURAL_BODY_ROLES: ReadonlySet<string> = new Set(["body", "block-body"]);

export function applyBeamerStructuralEdits(
  source: string,
  edits: readonly BeamerStructuralEdit[]
): string {
  let result = source;
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index];
    result = result.slice(0, edit.span.from) + edit.insert + result.slice(edit.span.to);
  }
  return result;
}

/**
 * Maps a pre-edit offset outside every edit span into post-edit
 * coordinates. An insertion exactly at the offset keeps the caret before
 * the inserted text.
 */
function mapOffsetAfterEdits(
  edits: readonly BeamerStructuralEdit[],
  offset: number
): number {
  let delta = 0;
  for (const edit of edits) {
    if (edit.span.to <= offset && edit.span.from < offset) {
      delta += edit.insert.length - (edit.span.to - edit.span.from);
    }
  }
  return offset + delta;
}

function lineStartAt(source: string, offset: number): number {
  return source.lastIndexOf("\n", offset - 1) + 1;
}

function lineEndAt(source: string, offset: number): number {
  const index = source.indexOf("\n", offset);
  return index < 0 ? source.length : index;
}

function lineIndentAt(source: string, offset: number): string {
  const start = lineStartAt(source, offset);
  let index = start;
  while (source[index] === " " || source[index] === "\t") {
    index += 1;
  }
  return source.slice(start, index);
}

function isBlank(source: string, from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    if (!/\s/u.test(source[index])) {
      return false;
    }
  }
  return true;
}

function skipHorizontalBack(source: string, offset: number, min: number): number {
  while (offset > min && (source[offset - 1] === " " || source[offset - 1] === "\t")) {
    offset -= 1;
  }
  return offset;
}

function skipHorizontalForward(source: string, offset: number, max: number): number {
  while (offset < max && (source[offset] === " " || source[offset] === "\t")) {
    offset += 1;
  }
  return offset;
}

function trimmedEnd(source: string, span: Span): number {
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
function tokenRemovalSpan(source: string, token: Span): Span {
  const lineFrom = lineStartAt(source, token.from);
  const lineTo = lineEndAt(source, token.to);
  if (isBlank(source, lineFrom, token.from) && isBlank(source, token.to, lineTo)) {
    return { from: lineFrom, to: Math.min(source.length, lineTo + 1) };
  }
  return { from: skipHorizontalBack(source, token.from, lineFrom), to: token.to };
}

/**
 * An insertion placing `lineText` (no trailing newline) on its own line
 * directly before the line holding `tokenFrom`; degrades to an inline
 * insertion when the token shares its line with earlier material.
 */
function insertBeforeToken(
  source: string,
  tokenFrom: number,
  lineText: string
): BeamerStructuralEdit {
  if (tokenStartsItsLine(source, tokenFrom)) {
    const lineFrom = lineStartAt(source, tokenFrom);
    return { span: { from: lineFrom, to: lineFrom }, insert: `${lineText}\n` };
  }
  return { span: { from: tokenFrom, to: tokenFrom }, insert: `${lineText.trim()} ` };
}

/**
 * First offset after an item's structural prefix (the `\item` word and a
 * closed `[label]`). The command span also swallows trailing whitespace up
 * to the content, so a caret parked right after `\item ` — where a fresh
 * item split leaves it — still belongs to the item.
 */
function itemInteriorStart(item: BeamerListItemTopology): number {
  return item.labelSpan
    ? item.labelSpan.to + 1
    : item.commandSpan.from + "\\item".length;
}

/**
 * The innermost list item whose interior contains `offset`: the content
 * span (inclusive at both ends) plus the whitespace tail of the `\item`
 * command. Callers clamp tail offsets to `contentSpan.from` before doing
 * position math.
 */
export function beamerListItemAt(
  domain: BeamerCaretDomain,
  offset: number
): BeamerListItemContext | null {
  let best: BeamerListItemContext | null = null;
  for (const list of domain.lists) {
    for (let index = 0; index < list.items.length; index += 1) {
      const item = list.items[index];
      if (itemInteriorStart(item) <= offset && offset <= item.contentSpan.to) {
        if (!best || list.beginSpan.from > best.list.beginSpan.from) {
          best = { list, item, index };
        }
      }
    }
  }
  return best;
}

/** Clamps an interior offset onto the item's content span. */
function clampToItemContent(offset: number, item: BeamerListItemTopology): number {
  return Math.min(Math.max(offset, item.contentSpan.from), item.contentSpan.to);
}

function isInsideMath(domain: BeamerCaretDomain, offset: number): boolean {
  return domain.mathSpans.some((span) => span.from < offset && offset < span.to);
}

function paragraphRoleAt(domain: BeamerCaretDomain, offset: number): string | null {
  const paragraph = domain.paragraphs.find(
    (candidate) => candidate.span.from <= offset && offset <= candidate.span.to
  );
  return paragraph?.role ?? null;
}

function itemIsEmpty(source: string, item: BeamerListItemTopology): boolean {
  return isBlank(source, item.contentSpan.from, item.contentSpan.to);
}

/**
 * Enter under canvas focus: split the item at the caret; on an empty last
 * item, delete it and exit the list (removing the environment when it
 * becomes empty); in ordinary body prose, break the paragraph with a blank
 * line. No-op inside math and in template areas (titles, labels).
 */
export function beamerStructuralEnterPatch(
  domain: BeamerCaretDomain,
  offset: number
): BeamerStructuralKeyResult {
  if (isInsideMath(domain, offset)) {
    return "swallow";
  }
  const source = domain.source;
  const context = beamerListItemAt(domain, offset);
  if (context) {
    const { list, item, index } = context;
    if (itemIsEmpty(source, item) && index === list.items.length - 1) {
      return emptyLastItemExitPatch(domain, context);
    }
    // Split: the caret's surrounding horizontal whitespace becomes the new
    // item boundary, indented like the current item's own line.
    const caret = clampToItemContent(offset, item);
    const from = skipHorizontalBack(source, caret, item.contentSpan.from);
    const to = skipHorizontalForward(source, caret, item.contentSpan.to);
    const insert = `\n${lineIndentAt(source, item.commandSpan.from)}\\item `;
    return {
      edits: [{ span: { from, to }, insert }],
      caretOffset: from + insert.length,
    };
  }
  const role = paragraphRoleAt(domain, offset);
  if (role == null) {
    return null;
  }
  if (!STRUCTURAL_BODY_ROLES.has(role)) {
    return "swallow";
  }
  const paragraph = domain.paragraphs.find(
    (candidate) => candidate.span.from <= offset && offset <= candidate.span.to
  );
  const from = skipHorizontalBack(source, offset, paragraph?.span.from ?? 0);
  const to = skipHorizontalForward(source, offset, paragraph?.span.to ?? source.length);
  return {
    edits: [{ span: { from, to }, insert: "\n\n" }],
    caretOffset: from + 2,
  };
}

function emptyLastItemExitPatch(
  domain: BeamerCaretDomain,
  context: BeamerListItemContext
): BeamerStructuralPatch {
  const source = domain.source;
  const { list, item } = context;
  if (list.items.length === 1) {
    // The environment would be left empty (invalid LaTeX): remove it whole.
    const from = tokenRemovalSpan(source, list.beginSpan).from;
    const to = tokenRemovalSpan(source, list.endSpan).to;
    return { edits: [{ span: { from, to }, insert: "" }], caretOffset: from };
  }
  // Delete the item, then exit onto a fresh line after the environment.
  const itemFrom = tokenStartsItsLine(source, item.commandSpan.from)
    ? lineStartAt(source, item.commandSpan.from)
    : skipHorizontalBack(
        source,
        item.commandSpan.from,
        lineStartAt(source, item.commandSpan.from)
      );
  const endLineFrom = tokenStartsItsLine(source, list.endSpan.from)
    ? lineStartAt(source, list.endSpan.from)
    : skipHorizontalBack(
        source,
        list.endSpan.from,
        lineStartAt(source, list.endSpan.from)
      );
  const deleteTo = Math.max(itemFrom, endLineFrom);
  const afterEndLine = lineEndAt(source, list.endSpan.to);
  const edits: BeamerStructuralEdit[] = [
    { span: { from: itemFrom, to: deleteTo }, insert: "" },
    { span: { from: afterEndLine, to: afterEndLine }, insert: "\n" },
  ];
  return {
    edits,
    caretOffset: mapOffsetAfterEdits(edits, afterEndLine) + 1,
  };
}

/**
 * Shift+Enter under canvas focus: an explicit `\\` line break in flow text.
 * No-op inside math and in template areas.
 */
export function beamerStructuralLineBreakPatch(
  domain: BeamerCaretDomain,
  offset: number
): BeamerStructuralKeyResult {
  if (isInsideMath(domain, offset)) {
    return "swallow";
  }
  const source = domain.source;
  const context = beamerListItemAt(domain, offset);
  let bounds: Span;
  if (context) {
    bounds = context.item.contentSpan;
    offset = clampToItemContent(offset, context.item);
  } else {
    const role = paragraphRoleAt(domain, offset);
    if (role == null) {
      return null;
    }
    if (!STRUCTURAL_BODY_ROLES.has(role)) {
      return "swallow";
    }
    const paragraph = domain.paragraphs.find(
      (candidate) => candidate.span.from <= offset && offset <= candidate.span.to
    );
    bounds = paragraph?.span ?? { from: 0, to: source.length };
  }
  const from = skipHorizontalBack(source, offset, bounds.from);
  const to = skipHorizontalForward(source, offset, bounds.to);
  const insert = " \\\\ ";
  return {
    edits: [{ span: { from, to }, insert }],
    caretOffset: from + insert.length,
  };
}

/**
 * Backspace at an item's content start: merge with the previous item —
 * remove the `\item` plus surrounding whitespace and join with a single
 * space. Swallowed on the first item (merging out of the environment is
 * object-layer work); `null` elsewhere so ordinary deletes stay native.
 */
export function beamerStructuralBackspacePatch(
  domain: BeamerCaretDomain,
  offset: number
): BeamerStructuralKeyResult {
  const context = beamerListItemAt(domain, offset);
  if (context == null) {
    return null;
  }
  if (clampToItemContent(offset, context.item) !== context.item.contentSpan.from) {
    return null;
  }
  const { list, index } = context;
  if (index === 0) {
    return "swallow";
  }
  const source = domain.source;
  const previous = list.items[index - 1];
  const mergeFrom = trimmedEnd(source, previous.contentSpan);
  const insert = mergeFrom === previous.contentSpan.from ? "" : " ";
  return {
    edits: [{ span: { from: mergeFrom, to: offset }, insert }],
    caretOffset: mergeFrom + insert.length,
  };
}

/**
 * Forward Delete at an item's rendered end: merge the next item into this
 * one (the mirror of the Backspace merge). Swallowed on the last item;
 * `null` elsewhere.
 */
export function beamerStructuralDeletePatch(
  domain: BeamerCaretDomain,
  offset: number
): BeamerStructuralKeyResult {
  const context = beamerListItemAt(domain, offset);
  if (!context) {
    return null;
  }
  const { list, item, index } = context;
  const source = domain.source;
  const caret = clampToItemContent(offset, item);
  if (!isBlank(source, caret, item.contentSpan.to)) {
    return null;
  }
  if (index === list.items.length - 1) {
    return "swallow";
  }
  const next = list.items[index + 1];
  const thisEmpty = trimmedEnd(source, item.contentSpan) === item.contentSpan.from;
  const insert = thisEmpty ? "" : " ";
  return {
    edits: [{ span: { from: caret, to: next.contentSpan.from }, insert }],
    caretOffset: caret,
  };
}

/**
 * Tab / Shift+Tab in an item: nest into (or unnest from) a same-kind list
 * environment one level down/up. Always at least swallowed — Tab never
 * types or moves focus under canvas focus.
 */
export function beamerStructuralTabPatch(
  domain: BeamerCaretDomain,
  offset: number,
  direction: "nest" | "unnest"
): BeamerStructuralKeyResult {
  const context = beamerListItemAt(domain, offset);
  if (!context) {
    return "swallow";
  }
  const caret = clampToItemContent(offset, context.item);
  return direction === "nest"
    ? nestItemPatch(domain, context, caret)
    : unnestItemPatch(domain, context, caret);
}

function nestItemPatch(
  domain: BeamerCaretDomain,
  context: BeamerListItemContext,
  offset: number
): BeamerStructuralKeyResult {
  const { list, item, index } = context;
  if (index === 0) {
    // LaTeX rejects an environment before the list's first `\item`
    // ("perhaps a missing \item"), so the first item cannot nest.
    return "swallow";
  }
  const source = domain.source;
  const previous = list.items[index - 1];
  const environment = list.environment;
  // Prefer extending a same-kind nested environment that already ends the
  // previous item's content: consecutive Tabs build one sub-list, not a
  // chain of sibling environments.
  const adjacent = domain.lists.find(
    (candidate) =>
      candidate !== list &&
      candidate.environment === environment &&
      candidate.depth === list.depth + 1 &&
      candidate.beginSpan.from >= previous.contentSpan.from &&
      candidate.endSpan.to <= previous.contentSpan.to &&
      isBlank(source, candidate.endSpan.to, item.commandSpan.from)
  );
  if (adjacent) {
    const removal = tokenRemovalSpan(source, adjacent.endSpan);
    const endIndent = lineIndentAt(source, adjacent.endSpan.from);
    const reinsert = insertBeforeToken(
      source,
      item.contentSpan.to,
      `${endIndent}\\end{${environment}}`
    );
    const edits = [{ span: removal, insert: "" }, reinsert].sort(
      (left, right) => left.span.from - right.span.from
    );
    return { edits, caretOffset: mapOffsetAfterEdits(edits, offset) };
  }
  const indent = lineIndentAt(source, item.commandSpan.from);
  const begin = insertBeforeToken(source, item.commandSpan.from, `${indent}\\begin{${environment}}`);
  const contentEnd = trimmedEnd(source, item.contentSpan);
  const boundaryLineStart = lineStartAt(source, item.contentSpan.to);
  const end: BeamerStructuralEdit =
    boundaryLineStart > contentEnd && tokenStartsItsLine(source, item.contentSpan.to)
      ? {
          span: { from: boundaryLineStart, to: boundaryLineStart },
          insert: `${indent}\\end{${environment}}\n`,
        }
      : {
          span: { from: contentEnd, to: contentEnd },
          insert: ` \\end{${environment}}`,
        };
  const edits = [begin, end];
  return { edits, caretOffset: mapOffsetAfterEdits(edits, offset) };
}

function unnestItemPatch(
  domain: BeamerCaretDomain,
  context: BeamerListItemContext,
  offset: number
): BeamerStructuralKeyResult {
  const { list, item, index } = context;
  // The parent item is the innermost item containing this environment's
  // `\begin` token; without one the list is top-level and cannot unnest.
  const parent = beamerListItemAt(domain, list.beginSpan.from);
  if (!parent || parent.list === list) {
    return "swallow";
  }
  const source = domain.source;
  const environment = list.environment;
  const beginIndent = lineIndentAt(source, list.beginSpan.from);
  const endIndent = lineIndentAt(source, list.endSpan.from);
  const edits: BeamerStructuralEdit[] = [];
  const single = list.items.length === 1;
  if (single) {
    edits.push({ span: tokenRemovalSpan(source, list.beginSpan), insert: "" });
    edits.push({ span: tokenRemovalSpan(source, list.endSpan), insert: "" });
  } else if (index === 0) {
    // First item moves out above: the environment re-opens before the
    // second item.
    edits.push({ span: tokenRemovalSpan(source, list.beginSpan), insert: "" });
    edits.push(
      insertBeforeToken(
        source,
        list.items[1].commandSpan.from,
        `${beginIndent}\\begin{${environment}}`
      )
    );
  } else if (index === list.items.length - 1) {
    // Last item moves out below: the environment closes before it.
    edits.push(
      insertBeforeToken(source, item.commandSpan.from, `${endIndent}\\end{${environment}}`)
    );
    edits.push({ span: tokenRemovalSpan(source, list.endSpan), insert: "" });
  } else {
    // Middle item: close the environment before it and reopen after it.
    edits.push(
      insertBeforeToken(source, item.commandSpan.from, `${endIndent}\\end{${environment}}`)
    );
    edits.push(
      insertBeforeToken(
        source,
        list.items[index + 1].commandSpan.from,
        `${beginIndent}\\begin{${environment}}`
      )
    );
  }
  edits.sort((left, right) => left.span.from - right.span.from);
  return { edits, caretOffset: mapOffsetAfterEdits(edits, offset) };
}

/**
 * Object-level edits (design doc "Object layer"): deleting or duplicating a
 * selected object node. Same purity contract as the structural key patches.
 */
export type BeamerObjectEditPatch = {
  /** Non-overlapping edits in document coordinates, sorted by `span.from`. */
  readonly edits: readonly BeamerStructuralEdit[];
  /**
   * Post-edit source range holding the created copy (duplication only);
   * the re-rendered object inside it is the one to select.
   */
  readonly selectSpan: Span | null;
  /** Post-edit caret anchor near the edit. */
  readonly caretOffset: number;
};

/**
 * The object's own source text without structural surroundings: items end at
 * their trimmed content (their topology span runs to the next `\item`/`\end`
 * token), every other kind is already tight.
 */
function objectTightSpan(source: string, node: BeamerObjectNode): Span {
  if (node.kind === "item" && node.listItem) {
    return {
      from: node.listItem.item.commandSpan.from,
      to: Math.max(
        trimmedEnd(source, node.listItem.item.contentSpan),
        node.listItem.item.commandSpan.from + 1
      ),
    };
  }
  return node.sourceSpan;
}

/**
 * Deleting an object removes its line extent. Removing the last `\item` of a
 * list or the last column of a `columns` environment would leave an invalid
 * or pointless empty environment, so the deletion promotes to the
 * environment itself.
 */
export function beamerObjectDeletionPatch(
  source: string,
  index: BeamerObjectIndex,
  node: BeamerObjectNode
): BeamerObjectEditPatch | null {
  let target = node;
  if (node.kind === "item" && node.listItem) {
    if (node.listItem.list.items.length === 1) {
      const { list } = node.listItem;
      const from = tokenRemovalSpan(source, list.beginSpan).from;
      const to = tokenRemovalSpan(source, list.endSpan).to;
      return {
        edits: [{ span: { from, to }, insert: "" }],
        selectSpan: null,
        caretOffset: from,
      };
    }
  } else if (node.kind === "column" && node.parentId) {
    const parent = index.byId.get(node.parentId);
    if (
      parent?.kind === "columns" &&
      parent.childIds.filter((id) => index.byId.get(id)?.kind === "column")
        .length === 1
    ) {
      target = parent;
    }
  }
  const removal = tokenRemovalSpan(source, objectTightSpan(source, target));
  return {
    edits: [{ span: removal, insert: "" }],
    selectSpan: null,
    caretOffset: removal.from,
  };
}

/**
 * Duplicating an object inserts a copy of its line extent directly below it
 * (inline objects get an inline ` copy`). The caller reselects the object
 * that re-renders inside `selectSpan`.
 */
export function beamerObjectDuplicationPatch(
  source: string,
  node: BeamerObjectNode
): BeamerObjectEditPatch | null {
  const span = objectTightSpan(source, node);
  const lineFrom = lineStartAt(source, span.from);
  const lineTo = lineEndAt(source, span.to);
  if (isBlank(source, lineFrom, span.from) && isBlank(source, span.to, lineTo)) {
    const hasNewline = lineTo < source.length;
    const blockTo = Math.min(source.length, lineTo + 1);
    const copy = source.slice(lineFrom, blockTo);
    const insert = hasNewline ? copy : `\n${copy}`;
    const edits = [{ span: { from: blockTo, to: blockTo }, insert }];
    const copyFrom = blockTo + (hasNewline ? 0 : 1);
    return {
      edits,
      selectSpan: { from: copyFrom, to: copyFrom + copy.length },
      caretOffset: copyFrom + (span.from - lineFrom),
    };
  }
  const copy = source.slice(span.from, span.to);
  const edits = [{ span: { from: span.to, to: span.to }, insert: ` ${copy}` }];
  return {
    edits,
    selectSpan: { from: span.to + 1, to: span.to + 1 + copy.length },
    caretOffset: span.to + 1,
  };
}
