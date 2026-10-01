import type { SourcePatch } from "./types.js";

type PatchValidationFailure =
  | "invalid-span-order"
  | "out-of-bounds"
  | "overlapping";

export type ApplySourcePatchesResult =
  | { kind: "success"; source: string }
  | { kind: "invalid"; reason: PatchValidationFailure };

/**
 * Applies source patches whose old spans are interpreted against the same
 * original source document.
 */
export function applySourcePatches(source: string, patches: readonly SourcePatch[]): ApplySourcePatchesResult {
  if (patches.length === 0) {
    return { kind: "success", source };
  }

  const sorted = [...patches].sort((left, right) => {
    if (left.oldSpan.from !== right.oldSpan.from) {
      return left.oldSpan.from - right.oldSpan.from;
    }
    return left.oldSpan.to - right.oldSpan.to;
  });

  let cursor = 0;
  let output = "";
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
    output += source.slice(cursor, from);
    output += patch.replacement;
    cursor = to;
  }
  output += source.slice(cursor);
  return { kind: "success", source: output };
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

/** Compose sequential edit steps without turning separate changes into one broad replacement. */
export function composeSourcePatches(source: string, steps: readonly (readonly SourcePatch[])[]): SourcePatch[] {
  type Piece = { from: number; to: number } | { text: string };
  const pieces: Piece[] = [{ from: 0, to: source.length }];
  const length = (piece: Piece) => "text" in piece ? piece.text.length : piece.to - piece.from;
  const split = (offset: number): number => {
    let position = 0;
    for (let index = 0; index < pieces.length; index++) {
      const piece = pieces[index];
      if (offset === position) return index;
      const size = length(piece);
      if (offset < position + size) {
        const cut = offset - position;
        pieces.splice(index, 1, ...("text" in piece
          ? [{ text: piece.text.slice(0, cut) }, { text: piece.text.slice(cut) }]
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
  let replacement = "";
  const flush = (oldTo: number) => {
    if (source.slice(oldFrom, oldTo) !== replacement) {
      result.push({ oldSpan: { from: oldFrom, to: oldTo },
        newSpan: { from: newFrom, to: newFrom + replacement.length }, replacement });
    }
    newFrom += replacement.length;
    replacement = "";
  };
  for (const piece of pieces) {
    if ("text" in piece) replacement += piece.text;
    else {
      flush(piece.from);
      oldFrom = piece.to;
      newFrom += length(piece);
    }
  }
  flush(source.length);
  return result;
}
