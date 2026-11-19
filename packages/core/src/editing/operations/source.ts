import { editSlotAt, editNodeAt } from "../tree/lookup.js";
import { applyPatches, mapOffset, type BufferPatch } from "../transaction/transaction.js";
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
  const record = editSlotAt(tree.slots, slot);
  const delimiters = editNodeAt(tree.nodes, record.node).delimiters;
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
  return mapOffset(patches, offset, -1);
}

/** Whether source ends with a control word, rather than text after an escaped slash. */
export function endsWithControlWord(text: string, at = text.length): boolean {
  let start = at;
  while (start > 0 && /[A-Za-z@]/u.test(text.charAt(start - 1))) start -= 1;
  if (start === at) return false;
  let slashes = 0;
  while (start > 0 && text[--start] === "\\") slashes += 1;
  return slashes % 2 === 1;
}

/** Preserve a control word when an edit puts letters, or a visible space, after it. */
export function controlWordTerminator(
  before: string, after: string, mode: EditMode, preserveSpace = false
): string {
  const needs = preserveSpace && mode !== "math" ? /^[A-Za-z@ ]/u : /^[A-Za-z@]/u;
  if (!needs.test(after) || !endsWithControlWord(before)) return "";
  return mode === "math" ? " " : "{}";
}

/**
 * What reads a `<` after it as an overlay specification, ending the text
 * before: `\item` (with its label if any), `\begin{…}` (beamer's
 * environments: `\begin{proposition}<2->`, and blocks after their title,
 * `\begin{block}{Title}<2->`), `\\`, a closing brace, as beamer's text
 * commands take one after their argument too (`\emph{x}<2>`), and the
 * commands beamer gives a specification without arguments: page and frame
 * breaks, `\onslide`, the slide transitions (checked with LuaLaTeX).
 */
export const SPEC_READER_BEFORE =
  /(?:\\item(?:\[[^\]]*\])?|\\begin\{[^}]*\}(?:\{[^{}]*\})?|\\\\\*?(?:\[[^\]]*\])?|\}|\\(?:no)?(?:frame|page)break|\\onslide[*+]?|\\trans[a-z]+|\\framezoom|\\animate)$/u;

/**
 * What reads a `[` after it as an optional argument, besides a command
 * name: an environment's opening (`\begin{lemma}[Name]`), also after its
 * overlay specification (`\begin{lemma}<2->[Name]`), and `\item` after
 * its specification (`\item<2->[label]`).
 */
export const OPTION_READER_BEFORE = /(?:\\begin\{[^}]*\}|\\item)(?:<[^<>]*>)?$/u;

/** Protect a bracket that would otherwise become an option or overlay. */
function bracketGuard(before: string, after: string): string {
  const head = before.trimEnd();
  if (/^\s*\[/u.test(after) &&
    (/(?:^|[^\\])(?:\\\\)*(?:\\\\\*?|\\item)$/u.test(head) || OPTION_READER_BEFORE.test(head))) return "{}";
  if (/^\s*</u.test(after) && SPEC_READER_BEFORE.test(head)) return "{}";
  return "";
}

/**
 * Finish sorted source patches at the seams they created. The caller
 * identifies the argument's mode and opts into bracket protection when
 * the following bracket is meant to remain literal.
 */
export function protectPatchEnds(
  source: string,
  patches: BufferPatch[],
  mode: EditMode | ((patch: BufferPatch) => EditMode),
  protectBrackets = false
): BufferPatch[] {
  const after = applyPatches(source, patches);
  let delta = 0;
  let cursor = 0;
  let before = "";
  return patches.map(patch => {
    const seam = patch.from + delta + patch.insert.length;
    delta += patch.insert.length - (patch.to - patch.from);
    before += after.slice(cursor, seam);
    const following = after.slice(seam);
    const guard = controlWordTerminator(before, following, typeof mode === "function" ? mode(patch) : mode)
      || (protectBrackets ? bracketGuard(before, following) : "");
    before += guard;
    cursor = seam;
    return guard ? { ...patch, insert: patch.insert + guard } : patch;
  });
}

/** Table rules, which may only start a row. */
const RULE_COMMAND = /^\\(?:hline|cline|toprule|midrule|bottomrule|cmidrule|specialrule|addlinespace)(?![A-Za-z@])/u;

/**
 * Where an edit left a table rule inside a row's cell (`x\\hline`, typed
 * or committed right before the rule): TeX only accepts rules at a row's
 * start, so the row must end before it. The offsets of those rules.
 */
export function rulesInsideRows(tree: EditTree): number[] {
  const offsets: number[] = [];
  for (const node of tree.nodes) {
    if (node.kind !== "row") {
      continue;
    }
    for (const slot of node.slots) {
      for (const child of editSlotAt(tree.slots, slot).children) {
        const span = editNodeAt(tree.nodes, child).span;
        if (RULE_COMMAND.test(tree.text.slice(span.from, span.to + 16))) {
          offsets.push(span.from);
        }
      }
    }
  }
  return offsets;
}
