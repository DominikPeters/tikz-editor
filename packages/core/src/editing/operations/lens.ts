import { caretContext } from "../position/context.js";
import { promotedOffsets } from "../position/selection.js";
import type { EditView } from "../position/view.js";
import type { BufferPatch } from "../transaction/transaction.js";
import type { Span } from "../tree/types.js";

/**
 * The source lens (R13): raw source edited in place, the escape hatch for
 * what the canvas does not show (optional arguments, overlay
 * specifications, comments, unknown macros, broken source). It edits a
 * span of the buffer; each edit is one patch, so positions outside the
 * span map through it as through any other edit.
 */

/**
 * The span ⌘E opens: the selection's (promoted, so a construct is whole),
 * else the innermost outlined construct around the caret (a style
 * wrapper, formula, overlay, block), else its item or paragraph.
 */
export function lensSpan(view: EditView, anchor: number, focus: number): Span {
  if (anchor !== focus) {
    const promoted = promotedOffsets(view, anchor, focus);
    return { from: Math.min(promoted.anchor, promoted.focus), to: Math.max(promoted.anchor, promoted.focus) };
  }
  const position = view.index.resolve(anchor, "before") ?? view.positionAt(anchor);
  const construct = caretContext(view, position).reverse().find((crumb) => crumb.outlined && crumb.slot == null);
  if (construct) {
    return construct.span;
  }
  // In prose: the item, with its `\item` and what it takes (`<2->`, `[label]`), else the paragraph.
  const { tree } = view;
  const innermost = (kind: string) => tree.nodes
    .filter((node) => node.kind === kind && node.span.from <= anchor && anchor <= node.span.to)
    .sort((left, right) => (left.span.to - left.span.from) - (right.span.to - right.span.from))[0];
  const run = innermost("item") ?? innermost("paragraph");
  return run ? trimmedSpan(tree.text, run.span) : { from: 0, to: tree.text.length };
}

/** A span without the line ends and spaces at its edges, which belong to the flow around it. */
function trimmedSpan(text: string, span: Span): Span {
  let { from, to } = span;
  while (from < to && /\s/u.test(text.charAt(from))) {
    from += 1;
  }
  while (to > from && /\s/u.test(text.charAt(to - 1))) {
    to -= 1;
  }
  return { from, to };
}

/**
 * The patch that makes the lens span read `next`: only the part that
 * changed, so the canvas caret and outlines elsewhere in the span keep
 * their place; and the span afterwards.
 */
export function lensEdit(text: string, span: Span, next: string): { patch: BufferPatch | null; span: Span } {
  const current = text.slice(span.from, span.to);
  const after = { from: span.from, to: span.from + next.length };
  if (current === next) {
    return { patch: null, span: after };
  }
  let prefix = 0;
  while (prefix < current.length && prefix < next.length && current[prefix] === next[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < current.length - prefix && suffix < next.length - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]) {
    suffix += 1;
  }
  return {
    patch: { from: span.from + prefix, to: span.to - suffix, insert: next.slice(prefix, next.length - suffix) },
    span: after,
  };
}
