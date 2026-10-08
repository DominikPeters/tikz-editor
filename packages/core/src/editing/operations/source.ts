import type { BufferPatch } from "../transaction/transaction.js";
import type { EditMode, EditTree, SlotId, Span } from "../tree/types.js";

/**
 * Source-level helpers shared by the operations: the full source of a
 * slot (with its own delimiters), and patch assembly with control-word
 * hygiene at the seams an edit creates.
 */

/**
 * A slot's source including its own delimiters: the braces or brackets
 * around it and, for a script, the `^`/`_` before it. Used to remove an
 * optional slot or a script entirely.
 */
export function slotOuterSpan(tree: EditTree, slot: SlotId): Span {
  const record = tree.slots[slot];
  const delimiters = tree.nodes[record.node].delimiters;
  const text = tree.text;
  let from = record.contentSpan.from;
  let to = record.contentSpan.to;
  const closer = delimiters.find((span) => span.from === to && /^[}\]]$/u.test(text.slice(span.from, span.to)));
  if (closer && (record.braced || text[closer.from] === "]")) {
    to = closer.to;
  }
  for (;;) {
    const opener = delimiters.find((span) => span.to === from);
    if (!opener) {
      break;
    }
    const source = text.slice(opener.from, opener.to);
    if (/^[{[]$/u.test(source)) {
      from = opener.from;
      continue;
    }
    if (/^[\^_]$/u.test(source) && (record.role === "sup" || record.role === "sub")) {
      from = opener.from;
    }
    break;
  }
  return { from, to };
}

/** A pending edit: deleted spans plus insertions, assembled into sorted patches. */
export class PatchSet {
  private readonly edits: { from: number; to: number; insert: string }[] = [];

  delete(span: Span): this {
    if (span.to > span.from) {
      this.edits.push({ from: span.from, to: span.to, insert: "" });
    }
    return this;
  }

  replace(span: Span, insert: string): this {
    this.edits.push({ from: span.from, to: span.to, insert });
    return this;
  }

  /** Whether an offset falls inside a deleted span. */
  covers(offset: number): boolean {
    return this.edits.some((edit) => edit.from <= offset && offset < edit.to);
  }

  /**
   * Sorted, merged patches. Overlapping or touching deletions merge;
   * insertions at the same place keep their order of addition.
   */
  patches(): BufferPatch[] {
    const sorted = [...this.edits].sort((left, right) => left.from - right.from || left.to - right.to);
    const result: { from: number; to: number; insert: string }[] = [];
    for (const edit of sorted) {
      const last = result.at(-1);
      if (last && edit.from <= last.to) {
        last.to = Math.max(last.to, edit.to);
        last.insert += edit.insert;
      } else {
        result.push({ ...edit });
      }
    }
    return result;
  }
}

/** The post-edit offset of a pre-edit offset that no patch covers (or the start of a covered one). */
export function mapThrough(patches: readonly BufferPatch[], offset: number): number {
  let delta = 0;
  for (const patch of patches) {
    if (patch.from >= offset) {
      break;
    }
    if (patch.to <= offset) {
      delta += patch.insert.length - (patch.to - patch.from);
    } else {
      return patch.from + delta;
    }
  }
  return offset + delta;
}

/**
 * R5 at a seam: when an edit leaves a control word directly before a
 * letter (`\alpha` + `b`), the terminator goes back in: a space in math,
 * `{}` in text. Returns the patches with the terminator added at `seam`
 * (a post-edit offset) when needed.
 */
export function withTerminator(
  original: string,
  patches: BufferPatch[],
  seam: number,
  mode: EditMode
): BufferPatch[] {
  let after = "";
  let cursor = 0;
  for (const patch of patches) {
    after += original.slice(cursor, patch.from) + patch.insert;
    cursor = patch.to;
  }
  after += original.slice(cursor);
  const before = after.slice(0, seam);
  if (!/\\[A-Za-z@]+$/u.test(before) || !/^[A-Za-z@]/u.test(after.slice(seam))) {
    return patches;
  }
  // Put the terminator into the patch that ends at the seam.
  const terminator = mode === "math" ? " " : "{}";
  let delta = 0;
  return patches.map((patch) => {
    const end = patch.from + delta + patch.insert.length;
    delta += patch.insert.length - (patch.to - patch.from);
    return end === seam ? { ...patch, insert: patch.insert + terminator } : patch;
  });
}
