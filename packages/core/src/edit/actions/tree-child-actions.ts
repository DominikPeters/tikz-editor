import type { EditActionResultLike } from "../result-types.js";
import type { ChildOperationItem, PathStatement, Span } from "../../ast/types.js";
import { lineIndentAtOffset } from "../statement-ops.js";
import { replaceSpan } from "../patch.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import { resolvePropertyTarget } from "../property-target.js";
import { findPathStatementById } from "../statement-find.js";


type AddTreeChildAction = {
  parentSourceId: string;
  afterChildIndex?: number;
};

type RemoveTreeChildAction = {
  childSourceId: string;
};

type AddTreeSiblingAction = {
  siblingSourceId: string;
  position: "before" | "after";
};

const NEW_CHILD_SNIPPET = "child { node {New} }";

export function applyAddTreeChildAction(
  source: string,
  action: AddTreeChildAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const parentSourceId = action.parentSourceId.trim();
  if (parentSourceId.length === 0) {
    return { kind: "unsupported", reason: "addTreeChild requires a parent source id." };
  }

  const resolvedParent = resolvePropertyTarget(source, parentSourceId, parseOptions);
  if (resolvedParent.kind !== "found") {
    return { kind: "unsupported", reason: `Could not resolve tree parent ${parentSourceId}.` };
  }

  if (resolvedParent.target.kind === "tree-child") {
    if (resolvedParent.target.treeChildForeach) {
      return { kind: "unsupported", reason: "Tree child insertion is not supported for child foreach expansions." };
    }
    const childBodySpan = resolvedParent.target.treeChildBodySpan!;
    const insertOffset = resolveBodyCloseInsertOffset(source, childBodySpan);
    const newline = detectPreferredNewline(source, insertOffset);
    const parentIndent = lineIndentAtOffset(source, resolvedParent.target.span.from);
    const childIndent = `${parentIndent}  `;
    return applyInsertion(source, insertOffset, `${newline}${childIndent}${NEW_CHILD_SNIPPET}`, [parentSourceId]);
  }

  if (resolvedParent.target.kind !== "path-statement") {
    return { kind: "unsupported", reason: "Tree child insertion requires selecting a tree root or tree child." };
  }

  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const rootStatement = findPathStatementById(parsed.figure.body, parentSourceId)!;

  const hasNode = rootStatement.items.some((item) => item.kind === "Node");
  if (!hasNode) {
    return { kind: "unsupported", reason: "Tree root insertion requires a root node in the selected path statement." };
  }

  const rootChildren = collectDirectChildrenWithAbsoluteSpans(source, rootStatement);
  const insertionAnchor = resolveRootInsertionAnchor(source, rootStatement, rootChildren, action.afterChildIndex);

  const newline = detectPreferredNewline(source, insertionAnchor.offset);
  const childIndent = insertionAnchor.childIndent;
  return applyInsertion(source, insertionAnchor.offset, `${newline}${childIndent}${NEW_CHILD_SNIPPET}`, [parentSourceId]);
}

export function applyAddTreeSiblingAction(
  source: string,
  action: AddTreeSiblingAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const siblingSourceId = action.siblingSourceId.trim();
  if (siblingSourceId.length === 0) {
    return { kind: "unsupported", reason: "addTreeSibling requires a sibling source id." };
  }

  const resolvedSibling = resolvePropertyTarget(source, siblingSourceId, parseOptions);
  if (resolvedSibling.kind !== "found" || resolvedSibling.target.kind !== "tree-child") {
    return { kind: "unsupported", reason: `Could not resolve tree sibling ${siblingSourceId}.` };
  }
  if (resolvedSibling.target.treeChildForeach) {
    return { kind: "unsupported", reason: "Tree sibling insertion is not supported for child foreach expansions." };
  }

  const siblingSpan = resolvedSibling.target.span;
  const siblingIndent = lineIndentAtOffset(source, siblingSpan.from);
  const newline = detectPreferredNewline(source, siblingSpan.from);
  if (action.position === "before") {
    return applyInsertion(source, siblingSpan.from, `${siblingIndent}${NEW_CHILD_SNIPPET}${newline}`, [siblingSourceId]);
  }

  const insertOffset = skipHorizontalWhitespace(source, siblingSpan.to);
  return applyInsertion(source, insertOffset, `${newline}${siblingIndent}${NEW_CHILD_SNIPPET}`, [siblingSourceId]);
}

export function applyRemoveTreeChildAction(
  source: string,
  action: RemoveTreeChildAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const childSourceId = action.childSourceId.trim();
  if (childSourceId.length === 0) {
    return { kind: "unsupported", reason: "removeTreeChild requires a child source id." };
  }

  const resolvedChild = resolvePropertyTarget(source, childSourceId, parseOptions);
  if (resolvedChild.kind !== "found" || resolvedChild.target.kind !== "tree-child") {
    return { kind: "unsupported", reason: `Could not resolve tree child ${childSourceId}.` };
  }
  if (resolvedChild.target.treeChildForeach) {
    return { kind: "unsupported", reason: "Tree child removal is not supported for child foreach expansions." };
  }

  const deleteSpan = normalizeTreeChildDeleteSpan(source, resolvedChild.target.span);
  const updated = replaceSpan(source, deleteSpan, "");
  return {
    kind: "success",
    newSource: updated.source,
    patches: [
      {
        oldSpan: deleteSpan,
        newSpan: updated.changedSpan,
        replacement: ""
      }
    ],
    selectedSourceIds: [resolvedChild.target.treeRootSourceId!],
    changedSourceIds: [childSourceId]
  };
}

function applyInsertion(
  source: string,
  offset: number,
  insertion: string,
  changedSourceIds: string[]
): EditActionResultLike {
  const updated = replaceSpan(source, { from: offset, to: offset }, insertion);
  return {
    kind: "success",
    newSource: updated.source,
    patches: [
      {
        oldSpan: { from: offset, to: offset },
        newSpan: updated.changedSpan,
        replacement: insertion
      }
    ],
    changedSourceIds
  };
}

function resolveRootInsertionAnchor(
  source: string,
  statement: PathStatement,
  children: ReadonlyArray<{ child: ChildOperationItem; span: Span }>,
  afterChildIndexRaw: number | undefined
): { offset: number; childIndent?: string } {
  if (children.length === 0) {
    const statementTail = resolvePathStatementTailInsertOffset(source, statement.span);
    const indent = `${lineIndentAtOffset(source, statement.span.from)}  `;
    return { offset: statementTail, childIndent: indent };
  }

  if (Number.isInteger(afterChildIndexRaw)) {
    const afterChildIndex = Math.max(0, afterChildIndexRaw!);
    if (afterChildIndex < children.length) {
      const child = children[afterChildIndex];
      return {
        offset: skipHorizontalWhitespace(source, child.span.to),
        childIndent: lineIndentAtOffset(source, child.span.from)
      };
    }
  }

  const lastChild = children[children.length - 1];
  return {
    offset: skipHorizontalWhitespace(source, lastChild.span.to),
    childIndent: lineIndentAtOffset(source, lastChild.span.from)
  };
}

function resolvePathStatementTailInsertOffset(source: string, span: Span): number {
  let cursor = Math.max(span.from, Math.min(source.length, span.to)) - 1;
  while (cursor >= span.from && /\s/u.test(source[cursor] ?? "")) {
    cursor -= 1;
  }
  if (cursor >= span.from && source[cursor] === ";") {
    return cursor;
  }
  return Math.max(span.from, Math.min(source.length, span.to));
}

function resolveBodyCloseInsertOffset(source: string, bodySpan: Span): number {
  const from = Math.max(0, Math.min(source.length, bodySpan.from));
  const to = Math.max(from, Math.min(source.length, bodySpan.to));
  let cursor = to - 1;
  while (cursor >= from && /\s/u.test(source[cursor] ?? "")) {
    cursor -= 1;
  }
  return cursor;
}

function normalizeTreeChildDeleteSpan(source: string, span: Span): Span {
  let from = clampOffset(span.from, source.length);
  let to = clampOffset(span.to, source.length);

  while (from > 0 && (source[from - 1] === " " || source[from - 1] === "\t")) {
    from -= 1;
  }
  while (to < source.length && (source[to] === " " || source[to] === "\t")) {
    to += 1;
  }

  if (to < source.length && source[to] === "\r") {
    to += 1;
  }
  if (to < source.length && source[to] === "\n") {
    to += 1;
  } else if (from > 0 && source[from - 1] === "\n") {
    from -= 1;
    if (from > 0 && source[from - 1] === "\r") {
      from -= 1;
    }
  }

  return { from, to };
}

function collectDirectChildrenWithAbsoluteSpans(
  source: string,
  statement: PathStatement
): Array<{ child: ChildOperationItem; span: Span }> {
  const children = statement.items.filter((item): item is ChildOperationItem => item.kind === "ChildOperation");
  const collected: Array<{ child: ChildOperationItem; span: Span }> = [];
  for (const child of children) {
    collected.push({ child, span: child.span });
  }
  return collected;
}

function detectPreferredNewline(source: string, aroundOffset: number): string {
  const windowStart = Math.max(0, aroundOffset - 256);
  const windowEnd = Math.min(source.length, aroundOffset + 256);
  const window = source.slice(windowStart, windowEnd);
  if (window.includes("\r\n")) {
    return "\r\n";
  }
  return "\n";
}

function skipHorizontalWhitespace(source: string, offset: number): number {
  let cursor = clampOffset(offset, source.length);
  while (cursor < source.length && (source[cursor] === " " || source[cursor] === "\t")) {
    cursor += 1;
  }
  return cursor;
}

function clampOffset(value: number, length: number): number {
  return Math.max(0, Math.min(length, Math.trunc(value)));
}
