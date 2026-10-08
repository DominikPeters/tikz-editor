import { createPositionIndex } from "../position/position.js";
import type { EditTree } from "./types.js";

/**
 * EditTree invariants (design/canvas-editing-architecture.md): spans nest,
 * every source offset is covered by exactly one leaf, delimiter or slot
 * gap, children sit in their slot in order and in the slot's mode, and
 * positions in document order never go backwards in the source.
 * Returns human-readable violations; empty means the tree is sound.
 */
export function checkEditTree(tree: EditTree): string[] {
  const violations: string[] = [];
  const { text, nodes, slots } = tree;
  const coverage = new Uint16Array(text.length);
  const cover = (from: number, to: number) => {
    for (let offset = from; offset < to; offset += 1) {
      coverage[offset] += 1;
    }
  };
  const within = (inner: { from: number; to: number }, outer: { from: number; to: number }) =>
    inner.from >= outer.from && inner.to <= outer.to && inner.from <= inner.to;

  for (const node of nodes) {
    if (!within(node.span, { from: 0, to: text.length })) {
      violations.push(`node ${node.id} (${node.kind}) span ${node.span.from}-${node.span.to} is outside the scope`);
    }
    const present = node.slots.map((id) => slots[id]).filter((slot) => slot.presence === "present");
    if (present.length === 0) {
      if (node.delimiters.length > 0) {
        violations.push(`leaf ${node.id} (${node.kind}) has delimiters`);
      }
      cover(node.span.from, node.span.to);
    }
    for (const delimiter of node.delimiters) {
      if (!within(delimiter, node.span)) {
        violations.push(`node ${node.id} (${node.kind}) delimiter ${delimiter.from}-${delimiter.to} is outside its span`);
      }
      cover(delimiter.from, delimiter.to);
    }
    for (const slot of present) {
      if (!within(slot.contentSpan, node.span)) {
        violations.push(`slot ${slot.id} (${slot.role}) of node ${node.id} (${node.kind}) is outside the node`);
      }
    }
  }

  for (const slot of slots) {
    if (slot.presence === "absent") {
      if (slot.children.length > 0 || slot.contentSpan.from !== slot.contentSpan.to) {
        violations.push(`absent slot ${slot.id} has content`);
      }
      continue;
    }
    let cursor = slot.contentSpan.from;
    for (const childId of slot.children) {
      const child = nodes[childId];
      if (child.parent !== slot.id) {
        violations.push(`node ${child.id} (${child.kind}) does not point back to slot ${slot.id}`);
      }
      if (child.mode !== slot.mode) {
        violations.push(`node ${child.id} (${child.kind}) is in ${child.mode} mode inside a ${slot.mode} slot`);
      }
      if (child.span.from < cursor || child.span.to > slot.contentSpan.to) {
        violations.push(
          `node ${child.id} (${child.kind}) ${child.span.from}-${child.span.to} overlaps a sibling or leaves slot ${slot.id} (${slot.role}) ${slot.contentSpan.from}-${slot.contentSpan.to}`
        );
      }
      // The gap before this child.
      cover(cursor, Math.max(cursor, Math.min(child.span.from, slot.contentSpan.to)));
      cursor = Math.max(cursor, child.span.to);
    }
    cover(cursor, slot.contentSpan.to);
  }

  let reported = 0;
  for (let offset = 0; offset < text.length && reported < 5; offset += 1) {
    if (coverage[offset] !== 1) {
      violations.push(
        `offset ${offset} (${JSON.stringify(text.slice(offset, offset + 12))}) is covered ${coverage[offset]} times`
      );
      reported += 1;
    }
  }

  const index = createPositionIndex(tree);
  for (let position = 1; position < index.offsets.length; position += 1) {
    if (index.offsets[position] < index.offsets[position - 1]) {
      const { slot, index: at } = index.positions[position];
      violations.push(
        `position ${slot}:${at} at offset ${index.offsets[position]} comes after offset ${index.offsets[position - 1]}`
      );
      break;
    }
  }
  return violations;
}
