import { requireArrayValue } from "../utils/collections.js";
import type { Span } from "../ast/types.js";
import {
  isBlank,
  lineEndAt,
  lineStartAt,
  tokenRemovalSpan,
  trimmedEnd,
} from "../editing/operations/lists.js";
import type { BeamerObjectIndex, BeamerObjectNode } from "./object-index.js";

/**
 * Source edits for the deck's object layer: deleting and duplicating a
 * selected object. Pure over the source and the object index. (The
 * structural keys of text editing live in editing/operations.)
 */
export type BeamerStructuralEdit = {
  readonly span: Span;
  readonly insert: string;
};

export function applyBeamerStructuralEdits(
  source: string,
  edits: readonly BeamerStructuralEdit[]
): string {
  let result = source;
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = requireArrayValue(edits, index);
    result = result.slice(0, edit.span.from) + edit.insert + result.slice(edit.span.to);
  }
  return result;
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
