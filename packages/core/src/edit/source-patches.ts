import type { SourcePatch } from "./types.js";
import { applyFragments, joinFragments, sliceFragment, sourceSlice, unchangedSource, type EditedSource, type TikzFragment } from "./fragment.js";

type PatchValidationFailure =
  | "invalid-span-order"
  | "out-of-bounds"
  | "overlapping";

export type ApplySourcePatchesResult =
  | { kind: "success"; source: EditedSource }
  | { kind: "invalid"; reason: PatchValidationFailure };

/**
 * Applies source patches whose old spans are interpreted against the same
 * original source document.
 */
export function applySourcePatches(source: string, patches: readonly SourcePatch[]): ApplySourcePatchesResult {
  if (patches.length === 0) {
    return { kind: "success", source: unchangedSource(source) };
  }

  const sorted = [...patches].sort((left, right) => {
    if (left.oldSpan.from !== right.oldSpan.from) {
      return left.oldSpan.from - right.oldSpan.from;
    }
    return left.oldSpan.to - right.oldSpan.to;
  });

  let cursor = 0;
  for (const patch of sorted) {
    const from = patch.oldSpan.from;
    const to = patch.oldSpan.to;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
      return { kind: "invalid", reason: "invalid-span-order" };
    }
    if (from < 0 || to > source.length) {
      return { kind: "invalid", reason: "out-of-bounds" };
    }
    if (from < cursor) {
      return { kind: "invalid", reason: "overlapping" };
    }
    cursor = to;
  }
  return { kind: "success", source: applyFragments(source, sorted.map(patch => ({ span: patch.oldSpan, fragment: patch.replacement }))) };
}

/**
 * Validates that a patch list represents the transition `previous -> next`
 * when all old spans are interpreted against `previous`.
 */
export function patchesMatchSourceTransition(
  previous: string,
  next: string,
  patches: readonly SourcePatch[]
): boolean {
  const applied = applySourcePatches(previous, patches);
  return applied.kind === "success" && applied.source === next;
}

/** The patches that undo `patches`, which were applied to `previous`. */
export function invertSourcePatches(previous: string, patches: readonly SourcePatch[]): SourcePatch[] {
  return patches.map(patch => ({ oldSpan: patch.newSpan, newSpan: patch.oldSpan, replacement: sourceSlice(previous, patch.oldSpan) }));
}

/** Compose sequential edit steps without turning separate changes into one broad replacement. */
export function composeSourcePatches(source: string, steps: readonly (readonly SourcePatch[])[]): SourcePatch[] {
  type Piece = { from: number; to: number } | { text: TikzFragment };
  const pieces: Piece[] = [{ from: 0, to: source.length }];
  const length = (piece: Piece) => "text" in piece ? piece.text.length : piece.to - piece.from;
  const split = (offset: number): number => {
    let position = 0;
    for (const [index, piece] of pieces.entries()) {

      if (offset === position) return index;
      const size = length(piece);
      if (offset < position + size) {
        const cut = offset - position;
        pieces.splice(index, 1, ...("text" in piece
          ? [{ text: sliceFragment(piece.text, 0, cut) }, { text: sliceFragment(piece.text, cut) }]
          : [{ from: piece.from, to: piece.from + cut }, { from: piece.from + cut, to: piece.to }]));
        return index + 1;
      }
      position += size;
    }
    if (offset !== position) throw new Error("Patch offset is outside the current source.");
    return pieces.length;
  };
  for (const patches of steps) {
    // Each step's old spans share one source; replacing from the end keeps them valid.
    for (const patch of [...patches].reverse().sort((a, b) => b.oldSpan.from - a.oldSpan.from || b.oldSpan.to - a.oldSpan.to)) {
      const from = split(patch.oldSpan.from);
      const to = split(patch.oldSpan.to);
      pieces.splice(from, to - from, { text: patch.replacement });
    }
  }
  const result: SourcePatch[] = [];
  let oldFrom = 0;
  let newFrom = 0;
  let replacementParts: TikzFragment[] = [];
  const flush = (oldTo: number) => {
    const replacement = joinFragments(replacementParts);
    if (source.slice(oldFrom, oldTo) !== replacement) {
      result.push({ oldSpan: { from: oldFrom, to: oldTo },
        newSpan: { from: newFrom, to: newFrom + replacement.length }, replacement });
    }
    newFrom += replacement.length;
    replacementParts = [];
  };
  for (const piece of pieces) {
    if ("text" in piece) replacementParts.push(piece.text);
    else {
      flush(piece.from);
      oldFrom = piece.to;
      newFrom += length(piece);
    }
  }
  flush(source.length);
  return result;
}
