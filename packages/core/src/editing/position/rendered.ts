import type { EditTree, NodeId, SlotId, Span } from "../tree/types.js";
import type { EditViewOptions } from "./view.js";

/** What the rendered layout of a scope publishes about caret stops (document offsets). */
export type RenderedStops = {
  /** The document source the layout was rendered from. */
  readonly source: string;
  /** Rendered caret-stop offsets, sorted. */
  readonly offsets: readonly number[];
  /** Overlay visibility published by the renderer; empty arguments have no caret offsets. */
  readonly overlayBranches?: readonly { readonly span: Span; readonly visible: boolean }[];
};

/** Kinds whose content can be hidden on a step: overlays, and paragraphs or displays after `\pause`. */
const HIDEABLE = new Set(["overlay", "paragraph", "display"]);

/**
 * Visibility in the scope's tree on the current step. Overlay arguments
 * use the renderer's branch facts, including empty branches. Missing
 * facts, and paragraphs or displays after a pause, fall back to rendered
 * caret stops. Null for an older buffer: stale spans cannot identify what
 * the current source hides.
 */
export function renderedVisibility(tree: EditTree, rendered: RenderedStops, bufferFrom: number): Required<EditViewOptions> | null {
  if (rendered.source.slice(bufferFrom, bufferFrom + tree.text.length) !== tree.text) {
    return null;
  }
  const hidden = new Set<NodeId>();
  const hiddenSlots = new Set<SlotId>();
  const branches = new Map(rendered.overlayBranches?.map((branch) => [`${branch.span.from}:${branch.span.to}`, branch.visible]));
  for (const node of tree.nodes) {
    if (!HIDEABLE.has(node.kind) || !/\S/u.test(tree.text.slice(node.span.from, node.span.to))) {
      continue;
    }
    // Test arguments separately: a visible branch does not make its siblings visible.
    // With no renderer fact yet, a newly typed empty argument remains editable.
    if (node.kind === "overlay") {
      const slots = node.slots.map((slot) => tree.slots[slot]).filter((slot) => slot.presence === "present");
      for (const slot of slots) {
        const { from, to } = slot.contentSpan;
        const visible = branches.get(`${bufferFrom + from}:${bufferFrom + to}`);
        if (visible === false || (visible == null && /\S/u.test(tree.text.slice(from, to)) &&
          !hasOffsetIn(rendered.offsets, bufferFrom + from, bufferFrom + to))) {
          hiddenSlots.add(slot.id);
        }
      }
      if (slots.length > 0 && slots.every((slot) => hiddenSlots.has(slot.id))) hidden.add(node.id);
    } else if (!hasOffsetIn(rendered.offsets, bufferFrom + node.span.from, bufferFrom + node.span.to)) {
      hidden.add(node.id);
    }
  }
  return { hidden, hiddenSlots };
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
