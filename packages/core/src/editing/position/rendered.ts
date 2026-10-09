import type { EditTree, NodeId } from "../tree/types.js";

/** What the rendered layout of a scope publishes about caret stops (document offsets). */
export type RenderedStops = {
  /** The document source the layout was rendered from. */
  readonly source: string;
  /** Rendered caret-stop offsets, sorted. */
  readonly offsets: readonly number[];
};

/** Kinds whose content can be hidden on a step: overlays, and paragraphs or displays after `\pause`. */
const HIDEABLE = new Set(["overlay", "paragraph", "display"]);

/**
 * The nodes of a scope's tree that the layout does not show on the current
 * step: an overlay or a block with visible content but not a single
 * rendered caret stop inside it. Null when the layout was rendered from
 * other source than the buffer (it would misplace them): callers then show
 * everything, as a stale layout cannot say what is hidden.
 */
export function hiddenNodes(tree: EditTree, rendered: RenderedStops, bufferFrom: number): ReadonlySet<NodeId> | null {
  if (rendered.source.slice(bufferFrom, bufferFrom + tree.text.length) !== tree.text) {
    return null;
  }
  const hidden = new Set<NodeId>();
  for (const node of tree.nodes) {
    if (!HIDEABLE.has(node.kind) || !/\S/u.test(tree.text.slice(node.span.from, node.span.to))) {
      continue;
    }
    // An overlay is judged by its argument: the stop just before `\only`
    // sits at the overlay's own start.
    // (Arguments still empty, `\only<2->{‸}` just typed, have nothing to hide nor any stop to show.)
    const spans = node.kind === "overlay"
      ? node.slots.map((slot) => tree.slots[slot]).filter((slot) => slot.presence === "present").map((slot) => slot.contentSpan)
        .filter((span) => /\S/u.test(tree.text.slice(span.from, span.to)))
      : [node.span];
    if (spans.length > 0 && spans.every((span) => !hasOffsetIn(rendered.offsets, bufferFrom + span.from, bufferFrom + span.to))) {
      hidden.add(node.id);
    }
  }
  return hidden;
}

/** Whether a sorted offset list has an entry in [from, to]. */
function hasOffsetIn(offsets: readonly number[], from: number, to: number): boolean {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle] < from) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low < offsets.length && offsets[low] <= to;
}
