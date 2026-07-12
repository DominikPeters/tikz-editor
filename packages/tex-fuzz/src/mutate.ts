import type { TexFuzzCase, TexFuzzMutation, TexFuzzSourceSpan } from "./model.js";
import { applyTexFuzzMutations } from "./print.js";

function clipSourceMap(sourceMap: readonly TexFuzzSourceSpan[], length: number): readonly TexFuzzSourceSpan[] {
  return sourceMap
    .filter((span) => span.start <= length)
    .map((span) => ({ ...span, end: Math.min(span.end, length) }));
}

function remapPoint(point: number, start: number, end: number, insertedLength: number): number {
  if (point <= start) return point;
  if (point >= end) return point + insertedLength - (end - start);
  return start + insertedLength;
}

function mutateSourceMap(
  sourceMap: readonly TexFuzzSourceSpan[],
  mutation: TexFuzzMutation,
  currentLength: number,
  resultLength: number
): readonly TexFuzzSourceSpan[] {
  if (mutation.kind === "truncate") {
    return clipSourceMap(sourceMap, resultLength);
  }
  const clamp = (offset: number): number => Math.max(0, Math.min(currentLength, offset));
  const start = mutation.kind === "insert"
    ? clamp(mutation.offset)
    : clamp(Math.min(mutation.start, mutation.end));
  const end = mutation.kind === "insert"
    ? clamp(mutation.offset)
    : clamp(Math.max(mutation.start, mutation.end));
  const insertedLength = mutation.kind === "delete" ? 0 : mutation.text.length;
  return clipSourceMap(sourceMap.map((span) => ({
    ...span,
    start: remapPoint(span.start, start, end, insertedLength),
    end: remapPoint(span.end, start, end, insertedLength),
  })), resultLength);
}

/** Apply and record a raw mutation without pretending that the resulting source still prints from the AST. */
export function mutateTexFuzzCase(caseData: TexFuzzCase, mutation: TexFuzzMutation): TexFuzzCase {
  const source = applyTexFuzzMutations(caseData.source, [mutation]);
  return {
    ...caseData,
    source,
    sourceMap: mutateSourceMap(caseData.sourceMap, mutation, caseData.source.length, source.length),
    mutations: [...caseData.mutations, mutation],
  };
}

export type TexFuzzPrefixBoundaryKind =
  | "byte"
  | "command"
  | "delimiter-before"
  | "delimiter-after";

export interface TexFuzzPrefixDamage {
  readonly boundaryKind: TexFuzzPrefixBoundaryKind;
  readonly offset: number;
  readonly case: TexFuzzCase;
}

/**
 * Return every typing prefix, with additional labels for syntactically interesting
 * command and delimiter/argument boundaries. One offset can carry several labels.
 */
export function texFuzzPrefixDamage(caseData: TexFuzzCase): readonly TexFuzzPrefixDamage[] {
  const labels = new Map<number, Set<TexFuzzPrefixBoundaryKind>>();
  const add = (offset: number, kind: TexFuzzPrefixBoundaryKind): void => {
    const kinds = labels.get(offset) ?? new Set<TexFuzzPrefixBoundaryKind>();
    kinds.add(kind);
    labels.set(offset, kinds);
  };

  for (let offset = 0; offset < caseData.source.length; offset += 1) {
    add(offset, "byte");
  }
  for (let index = 0; index < caseData.source.length; index += 1) {
    const character = caseData.source[index];
    if ("{}[]$".includes(character)) {
      add(index, "delimiter-before");
      add(index + 1, "delimiter-after");
    }
    if (character === "\\") {
      let end = index + 1;
      while (end < caseData.source.length && /[A-Za-z@]/u.test(caseData.source[end])) {
        end += 1;
      }
      for (let offset = index + 1; offset <= end; offset += 1) {
        add(offset, "command");
      }
    }
  }

  return [...labels.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([offset, kinds]) => [...kinds].sort().map((boundaryKind) => ({
      boundaryKind,
      offset,
      case: mutateTexFuzzCase(caseData, { kind: "truncate", offset }),
    })));
}

export function texFuzzPrefixDamageCases(caseData: TexFuzzCase): readonly TexFuzzCase[] {
  const bySource = new Map<string, TexFuzzCase>();
  for (const damage of texFuzzPrefixDamage(caseData)) {
    bySource.set(damage.case.source, damage.case);
  }
  return [...bySource.values()];
}

export type TexFuzzMalformedMutationKind =
  | "delimiter-duplicate"
  | "delimiter-remove"
  | "delimiter-swap"
  | "control-word-corrupt"
  | "script-duplicate"
  | "environment-end-mismatch"
  | "alignment-insert"
  | "row-break-insert"
  | "grapheme-split"
  | "whitespace-insert"
  | "comment-insert"
  | "unsupported-command-splice";

export interface TexFuzzMalformedMutation {
  readonly mutationKind: TexFuzzMalformedMutationKind;
  readonly mutation: TexFuzzMutation;
  readonly case: TexFuzzCase;
}

function delimiterSwaps(character: string): readonly string[] {
  switch (character) {
    case "{": return ["}", "["];
    case "}": return ["{", "]"];
    case "[": return ["]", "{"];
    case "]": return ["[", "}"];
    default: return [];
  }
}

/**
 * Deterministically enumerate high-value malformed edits. The returned operation,
 * category, and resulting case are all recorded so every finding can be replayed.
 */
export function texFuzzMalformedMutations(caseData: TexFuzzCase): readonly TexFuzzMalformedMutation[] {
  const candidates: Array<{ mutationKind: TexFuzzMalformedMutationKind; mutation: TexFuzzMutation }> = [];
  const add = (mutationKind: TexFuzzMalformedMutationKind, mutation: TexFuzzMutation): void => {
    candidates.push({ mutationKind, mutation });
  };
  const source = caseData.source;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const swaps = delimiterSwaps(character);
    if (swaps.length > 0) {
      add("delimiter-duplicate", { kind: "insert", offset: index, text: character });
      add("delimiter-remove", { kind: "delete", start: index, end: index + 1 });
      for (const swapped of swaps) {
        add("delimiter-swap", { kind: "replace", start: index, end: index + 1, text: swapped });
      }
    }
    if (character === "^" || character === "_") {
      add("script-duplicate", { kind: "insert", offset: index, text: character });
    }
  }

  const controlWord = /\\[A-Za-z@]+/gu;
  for (const match of source.matchAll(controlWord)) {
    const start = (match.index ?? 0) + 1;
    const end = start + match[0].length - 1;
    const offset = start + Math.floor((end - start) / 2);
    add("control-word-corrupt", { kind: "replace", start: offset, end: offset + 1, text: "?" });
  }

  const environmentEnd = /\\end\{([^}]*)\}/gu;
  for (const match of source.matchAll(environmentEnd)) {
    const nameStart = (match.index ?? 0) + "\\end{".length;
    add("environment-end-mismatch", {
      kind: "replace",
      start: nameStart,
      end: nameStart + (match[1]?.length ?? 0),
      text: `${match[1] ?? "unknown"}-mismatch`,
    });
  }

  const strategicOffsets = [...new Set([0, Math.floor(source.length / 2), source.length])];
  for (const offset of strategicOffsets) {
    add("alignment-insert", { kind: "insert", offset, text: "&" });
    add("row-break-insert", { kind: "insert", offset, text: "\\\\" });
    add("whitespace-insert", { kind: "insert", offset, text: " \t\n" });
    add("comment-insert", { kind: "insert", offset, text: "% tex-fuzz\n" });
    add("unsupported-command-splice", { kind: "insert", offset, text: "\\tikzEditorUnsupported{}" });
  }

  for (let offset = 1; offset < source.length; offset += 1) {
    const previous = source.charCodeAt(offset - 1);
    const current = source.charCodeAt(offset);
    const splitsSurrogate = previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff;
    const splitsCombiningSequence = /\p{Mark}/u.test(source[offset]);
    if (splitsSurrogate || splitsCombiningSequence) {
      add("grapheme-split", { kind: "insert", offset, text: "{}" });
    }
  }

  const unique = new Map<string, { mutationKind: TexFuzzMalformedMutationKind; mutation: TexFuzzMutation }>();
  for (const candidate of candidates) {
    unique.set(`${candidate.mutationKind}:${JSON.stringify(candidate.mutation)}`, candidate);
  }
  return [...unique.values()].map(({ mutationKind, mutation }) => ({
    mutationKind,
    mutation,
    case: mutateTexFuzzCase(caseData, mutation),
  }));
}
