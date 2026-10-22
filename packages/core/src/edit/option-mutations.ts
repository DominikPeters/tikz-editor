import {
  EMPTY_FRAGMENT,
  joinFragments,
  layout,
  optionEntry,
  sliceFragment,
  sourceSlice,
  tikz,
  userText,
  type EditedSource,
  type OptionValueText,
  type TikzFragment
} from "./fragment.js";
import type { Span } from "../ast/types.js";
import type { OptionEntry, OptionListAst } from "../options/types.js";
import { NAMED_COLORS } from "../semantic/style/constants.js";
import { replaceSpan } from "./patch.js";
import type { PropertyTarget, PropertyTargetOptionsFormat } from "./property-target.js";
import type { SourcePatch } from "./types.js";
import { normalizeOptionKey as normalizeSharedOptionKey } from "./option-key.js";

/** A value to write: user text or another fragment, or an option value checked against its key by `optionValueFor`. */
export type OptionMutation =
  | { kind: "set"; value: TikzFragment | OptionValueText }
  | { kind: "remove" };

export type OptionMutationApplyResult = {
  source: EditedSource;
  patch: SourcePatch;
};

type OptionSerializationContext = {
  bareColorKey: "draw" | "fill" | null;
};

type RelativeReplacement = {
  from: number;
  to: number;
  text: TikzFragment;
};

const DEFAULT_OPTION_SERIALIZATION_CONTEXT: OptionSerializationContext = {
  bareColorKey: null
};

export function applyOptionMutationsToTarget(
  source: string,
  target: PropertyTarget,
  mutations: ReadonlyMap<string, OptionMutation>
): OptionMutationApplyResult | null {
  if (mutations.size === 0) {
    return null;
  }
  const serializationContext = resolveOptionSerializationContext(target);

  if (target.options && target.optionsSpan) {
    const format = target.optionsFormat ?? "bracketed";
    const replacement = rewriteOptionListMutationsPreservingSourceInternal(
      source,
      target.optionsSpan,
      target.options,
      mutations,
      serializationContext,
      format
    );
    if (replacement.length === 0) {
      const oldSpan = target.optionsSpan;
      const updated = replaceSpan(source, oldSpan, EMPTY_FRAGMENT);
      if (updated.source === source) {
        return null;
      }
      return {
        source: updated.source,
        patch: {
          oldSpan,
          newSpan: updated.changedSpan,
          replacement: EMPTY_FRAGMENT
        }
      };
    }

    const oldSpan = target.optionsSpan;
    const previous = source.slice(oldSpan.from, oldSpan.to);
    if (previous === replacement) {
      return null;
    }

    const updated = replaceSpan(source, oldSpan, replacement);
    return {
      source: updated.source,
      patch: {
        oldSpan,
        newSpan: updated.changedSpan,
        replacement
      }
    };
  }

  const entriesToInsert: TikzFragment[] = [];
  for (const [key, mutation] of mutations.entries()) {
    if (mutation.kind === "set") {
      entriesToInsert.push(serializeOptionEntry(key, mutation.value, serializationContext));
    }
  }
  if (entriesToInsert.length === 0) {
    return null;
  }

  const replacement = wrapSerializedOptions(joinFragments(entriesToInsert, tikz`, `), target.optionsFormat ?? "bracketed");
  const oldSpan: Span = {
    from: target.insertOffset,
    to: target.insertOffset
  };
  const updated = replaceSpan(source, oldSpan, replacement);
  if (updated.source === source) {
    return null;
  }
  return {
    source: updated.source,
    patch: {
      oldSpan,
      newSpan: updated.changedSpan,
      replacement
    }
  };
}

export function rewriteOptionListMutations(
  options: OptionListAst,
  mutations: ReadonlyMap<string, OptionMutation>,
  serializationContext: OptionSerializationContext = DEFAULT_OPTION_SERIALIZATION_CONTEXT,
  format: PropertyTargetOptionsFormat = "bracketed"
): TikzFragment {
  const parts: TikzFragment[] = [];
  const emitted = new Set<string>();

  for (const entry of options.entries) {
    const entryKey = optionEntryKey(entry);
    const directMutation = entryKey ? mutations.get(entryKey) : undefined;
    const aliasKey =
      entry.kind === "flag" && !directMutation
        ? resolveFlagAliasKey(entry, mutations, serializationContext)
        : null;
    const mutationKey = directMutation ? entryKey : aliasKey;
    const mutation = directMutation ?? (aliasKey ? mutations.get(aliasKey) : undefined);
    if (mutationKey && mutation) {
      if (mutation.kind === "set" && !emitted.has(mutationKey)) {
        parts.push(serializeOptionEntry(mutationKey, mutation.value, serializationContext));
        emitted.add(mutationKey);
      }
      continue;
    }

    const normalized = normalizeOptionEntryRaw(entry);
    if (normalized.length > 0) {
      parts.push(normalized);
    }
  }

  for (const [key, mutation] of mutations.entries()) {
    if (mutation.kind !== "set" || emitted.has(key)) {
      continue;
    }
    parts.push(serializeOptionEntry(key, mutation.value, serializationContext));
    emitted.add(key);
  }

  if (parts.length === 0) {
    return format === "bracketed" ? EMPTY_FRAGMENT : wrapSerializedOptions(EMPTY_FRAGMENT, format);
  }

  return wrapSerializedOptions(joinFragments(parts, tikz`, `), format);
}

/**
 * Rewrites an option list that is backed by an existing source span without
 * normalizing unrelated entries or interstitial trivia. Use
 * `rewriteOptionListMutations` only for synthesized/isolated option fragments.
 */
export function rewriteSourceBackedOptionListMutations(
  source: string,
  optionsSpan: Span,
  options: OptionListAst,
  mutations: ReadonlyMap<string, OptionMutation>,
  format: PropertyTargetOptionsFormat = "bracketed",
  insert: { beforeKey: string } | null = null
): TikzFragment {
  return rewriteOptionListMutationsPreservingSourceInternal(
    source,
    optionsSpan,
    options,
    mutations,
    DEFAULT_OPTION_SERIALIZATION_CONTEXT,
    format,
    insert?.beforeKey ?? null
  );
}

export const normalizeOptionKey = normalizeSharedOptionKey;

function rewriteOptionListMutationsPreservingSourceInternal(
  source: string,
  optionsSpan: Span,
  options: OptionListAst,
  mutations: ReadonlyMap<string, OptionMutation>,
  serializationContext: OptionSerializationContext,
  format: PropertyTargetOptionsFormat,
  insertBeforeKey: string | null = null
): TikzFragment {
  const original = sourceSlice(source, optionsSpan);
  const emitted = new Set<string>();
  const replacements: Array<RelativeReplacement & { removesEntry: boolean }> = [];
  const sortedEntries = [...options.entries].sort((left, right) => left.span.from - right.span.from);

  for (const entry of sortedEntries) {
    const entryKey = optionEntryKey(entry);
    const directMutation = entryKey ? mutations.get(entryKey) : undefined;
    const aliasKey =
      entry.kind === "flag" && !directMutation
        ? resolveFlagAliasKey(entry, mutations, serializationContext)
        : null;
    const mutationKey = directMutation ? entryKey : aliasKey;
    const mutation = directMutation ?? (aliasKey ? mutations.get(aliasKey) : undefined);
    if (!mutationKey || !mutation) {
      continue;
    }

    const entryFrom = Math.max(0, entry.span.from - optionsSpan.from);
    const entryTo = Math.max(entryFrom, entry.span.to - optionsSpan.from);
    if (mutation.kind === "set" && !emitted.has(mutationKey)) {
      replacements.push({
        from: entryFrom,
        to: entryTo,
        text: serializeOptionEntry(mutationKey, mutation.value, serializationContext),
        removesEntry: false
      });
      emitted.add(mutationKey);
      continue;
    }

    replacements.push({
      ...resolveEntryRemovalRange(original, entryFrom, entryTo),
      text: EMPTY_FRAGMENT,
      removesEntry: true
    });
  }

  const entriesToInsert: TikzFragment[] = [];
  for (const [key, mutation] of mutations.entries()) {
    if (mutation.kind !== "set" || emitted.has(key)) {
      continue;
    }
    entriesToInsert.push(serializeOptionEntry(key, mutation.value, serializationContext));
    emitted.add(key);
  }

  if (entriesToInsert.length === 0 && replacements.length === 0) {
    return original;
  }

  if (
    entriesToInsert.length === 0 &&
    sortedEntries.length > 0 &&
    replacements.filter((replacement) => replacement.removesEntry).length === sortedEntries.length &&
    !containsLiveComment(original)
  ) {
    return format === "bracketed" || format === "bare" ? EMPTY_FRAGMENT : wrapSerializedOptions(EMPTY_FRAGMENT, format);
  }

  if (entriesToInsert.length > 0 && insertBeforeKey) {
    const insertionAnchor = findInsertionAnchorEntry(sortedEntries, mutations, insertBeforeKey);
    if (insertionAnchor) {
      const anchorFrom = Math.max(0, insertionAnchor.span.from - optionsSpan.from);
      replacements.push({
        from: anchorFrom,
        to: anchorFrom,
        text: tikz`${joinFragments(entriesToInsert, tikz`, `)}, `,
        removesEntry: false
      });
      entriesToInsert.length = 0;
    }
  }

  const rewritten = applyRelativeReplacements(original, replacements);
  if (entriesToInsert.length === 0) {
    return rewritten;
  }

  return insertSerializedOptionEntries(rewritten, entriesToInsert, format);
}

function findInsertionAnchorEntry(
  sortedEntries: readonly OptionEntry[],
  mutations: ReadonlyMap<string, OptionMutation>,
  beforeKey: string
): OptionEntry | null {
  const normalizedBeforeKey = normalizeOptionKey(beforeKey);
  for (const entry of sortedEntries) {
    const entryKey = optionEntryKey(entry);
    if (entryKey === normalizedBeforeKey && !mutations.has(entryKey)) {
      return entry;
    }
  }
  return null;
}

function containsLiveComment(source: string): boolean {
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);

    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "%") {
      return true;
    }
  }
  return false;
}

function applyRelativeReplacements(
  source: TikzFragment,
  replacements: ReadonlyArray<RelativeReplacement>
): TikzFragment {
  if (replacements.length === 0) {
    return source;
  }
  let current = source;
  const sorted = normalizeRelativeReplacements(source, replacements)
    .sort((left, right) => right.from - left.from || right.to - left.to);
  for (const replacement of sorted) {
    current = joinFragments([cut(current, 0, replacement.from), replacement.text, cut(current, replacement.to)]);
  }
  return current;
}

/** Part of an option list fragment is still the text its constructors produced. */
function cut(fragment: TikzFragment, from: number, to?: number): TikzFragment {
  return sliceFragment(fragment, from, to);
}

function normalizeRelativeReplacements(
  source: string,
  replacements: ReadonlyArray<RelativeReplacement>
): RelativeReplacement[] {
  const replacementsWithMergedRemovals = mergeEmptyRemovals(replacements);
  const setReplacements = replacementsWithMergedRemovals.filter((replacement) => replacement.text.length > 0);
  const removalReplacements = replacementsWithMergedRemovals
    .filter((replacement) => replacement.text.length === 0)
    .flatMap((replacement) => subtractSetReplacementRanges(replacement, setReplacements));
  return mergeEmptyRemovals([
    ...setReplacements,
    ...extendTerminalEmptyRemovals(source, removalReplacements, setReplacements)
  ]);
}

function mergeEmptyRemovals(replacements: ReadonlyArray<RelativeReplacement>): RelativeReplacement[] {
  const sorted = [...replacements].sort((left, right) => left.from - right.from || left.to - right.to);
  const normalized: RelativeReplacement[] = [];
  for (const replacement of sorted) {
    const previous = normalized[normalized.length - 1];
    if (previous?.text.length === 0 && replacement.text.length === 0 && replacement.from <= previous.to) {
      previous.to = Math.max(previous.to, replacement.to);
      continue;
    }
    normalized.push({ ...replacement });
  }
  return normalized;
}

function subtractSetReplacementRanges(
  removal: RelativeReplacement,
  setReplacements: readonly RelativeReplacement[]
): RelativeReplacement[] {
  let pieces: RelativeReplacement[] = [{ ...removal }];
  for (const setReplacement of setReplacements) {
    if (setReplacement.from >= setReplacement.to) {
      continue;
    }
    pieces = pieces.flatMap((piece) => subtractRange(piece, setReplacement));
  }
  return pieces;
}

function subtractRange(removal: RelativeReplacement, protectedRange: RelativeReplacement): RelativeReplacement[] {
  const overlapFrom = Math.max(removal.from, protectedRange.from);
  const overlapTo = Math.min(removal.to, protectedRange.to);
  if (overlapFrom >= overlapTo) {
    return [removal];
  }

  const pieces: RelativeReplacement[] = [];
  if (removal.from < overlapFrom) {
    pieces.push({ from: removal.from, to: overlapFrom, text: EMPTY_FRAGMENT });
  }
  if (overlapTo < removal.to) {
    pieces.push({ from: overlapTo, to: removal.to, text: EMPTY_FRAGMENT });
  }
  return pieces;
}

function extendTerminalEmptyRemovals(
  source: string,
  removals: readonly RelativeReplacement[],
  protectedReplacements: readonly RelativeReplacement[]
): RelativeReplacement[] {
  return removals.map((removal) => extendTerminalEmptyRemoval(source, removal, protectedReplacements));
}

function extendTerminalEmptyRemoval(
  source: string,
  removal: RelativeReplacement,
  protectedReplacements: readonly RelativeReplacement[]
): RelativeReplacement {
  let right = removal.to;
  while (right < source.length && isOptionListWhitespace(source[right])) {
    right += 1;
  }
  if (right < source.length && source[right] !== "]" && source[right] !== "}") {
    return removal;
  }

  let left = removal.from;
  while (left > 0 && isOptionListWhitespace(source[left - 1])) {
    left -= 1;
  }
  if (source[left - 1] !== ",") {
    return removal;
  }

  const commaRange = { from: left - 1, to: removal.from };
  if (protectedReplacements.some((replacement) => rangesOverlap(commaRange, replacement))) {
    return removal;
  }

  left -= 1;
  while (left > 0 && (source[left - 1] === " " || source[left - 1] === "\t")) {
    left -= 1;
  }
  return {
    ...removal,
    from: left
  };
}

function isOptionListWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function rangesOverlap(left: { from: number; to: number }, right: { from: number; to: number }): boolean {
  return left.from < right.to && right.from < left.to;
}

function resolveEntryRemovalRange(source: string, from: number, to: number): { from: number; to: number } {
  let right = to;
  while (right < source.length && (source[right] === " " || source[right] === "\t")) {
    right += 1;
  }
  if (source[right] === ",") {
    right += 1;
    if (source[right] === " ") {
      right += 1;
    }
    return { from, to: right };
  }

  let left = from;
  while (left > 0 && (source[left - 1] === " " || source[left - 1] === "\t")) {
    left -= 1;
  }
  if (source[left - 1] === ",") {
    left -= 1;
    while (left > 0 && (source[left - 1] === " " || source[left - 1] === "\t")) {
      left -= 1;
    }
    return { from: left, to };
  }

  return { from, to };
}

function insertSerializedOptionEntries(
  source: TikzFragment,
  entries: readonly TikzFragment[],
  format: PropertyTargetOptionsFormat
): TikzFragment {
  const content = joinFragments(entries, tikz`, `);
  if (format === "bare") {
    if (source.trim().length === 0) {
      return content;
    }
    const insertIndex = trailingHorizontalWhitespaceStart(source, source.length);
    const beforeInsertion = cut(source, 0, insertIndex);
    const separator = endsWithLiveComma(beforeInsertion) ? tikz` ` : tikz`, `;
    return joinFragments([beforeInsertion, separator, content, cut(source, insertIndex)]);
  }

  const closeChar = format === "braced" ? "}" : "]";
  const closeIndex = source.lastIndexOf(closeChar);
  if (closeIndex < 0) {
    return source.trim().length === 0 ? wrapSerializedOptions(content, format) : tikz`${source}, ${content}`;
  }

  if (source.includes("\n") && !hasOptionContent(source.slice(0, closeIndex), format)) {
    return wrapSerializedOptions(content, format);
  }

  if (!source.includes("\n")) {
    const insertIndex = trailingHorizontalWhitespaceStart(source, closeIndex);
    const beforeInsertion = cut(source, 0, insertIndex);
    const prefix = hasOptionContent(beforeInsertion, format)
      ? endsWithLiveComma(beforeInsertion)
        ? tikz` ${content}`
        : tikz`, ${content}`
      : content;
    return joinFragments([beforeInsertion, prefix, cut(source, insertIndex)]);
  }

  const insertion = multilineInsertion(source, closeIndex, content, format);
  return joinFragments([cut(source, 0, insertion.index), insertion.text, cut(source, insertion.index)]);
}

function trailingHorizontalWhitespaceStart(source: string, end: number): number {
  let index = end;
  while (index > 0 && (source[index - 1] === " " || source[index - 1] === "\t")) {
    index -= 1;
  }
  return index;
}

function multilineInsertion(
  source: string,
  closeIndex: number,
  content: TikzFragment,
  format: PropertyTargetOptionsFormat
): { index: number; text: TikzFragment } {
  const closeLineStart = source.lastIndexOf("\n", closeIndex - 1);
  const closingLineIsWhitespaceOnly =
    closeLineStart >= 0 && source.slice(closeLineStart + 1, closeIndex).trim().length === 0;
  const insertIndex = closingLineIsWhitespaceOnly ? closeLineStart : closeIndex;
  const beforeInsertion = source.slice(0, insertIndex);
  const indent = inferOptionEntryIndent(source, closeIndex);
  const needsComma = hasOptionContent(beforeInsertion, format) && !endsWithLiveComma(beforeInsertion);
  const commaStartsInsertedLine = needsComma && trailingLineHasComment(beforeInsertion);
  const lineStart = layout(`\n${indent}`);
  return {
    index: insertIndex,
    text: commaStartsInsertedLine
      ? tikz`${lineStart}, ${content}`
      : tikz`${needsComma ? tikz`,` : EMPTY_FRAGMENT}${lineStart}${content}`
  };
}

function endsWithLiveComma(source: string): boolean {
  let inComment = false;
  let lastLiveCharacter = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (inComment) {
      if (char === "\n" || char === "\r") {
        inComment = false;
      }
      continue;
    }
    if (char === "\\") {
      // An escaped comma (for example `\,`) is TeX content, not an option
      // delimiter. Treat the escape as one live token without interpreting the
      // escaped character structurally.
      lastLiveCharacter = "\\";
      index += 1;
      continue;
    }
    if (char === "%") {
      inComment = true;
      continue;
    }
    if (!/\s/u.test(char)) {
      lastLiveCharacter = char;
    }
  }
  return lastLiveCharacter === ",";
}

function trailingLineHasComment(source: string): boolean {
  const lineStart = Math.max(source.lastIndexOf("\n"), source.lastIndexOf("\r")) + 1;
  for (let index = lineStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "%") {
      return true;
    }
  }
  return false;
}

function inferOptionEntryIndent(source: string, closeIndex: number): string {
  const beforeClose = source.slice(0, closeIndex);
  const lines = beforeClose.split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0 || line.trim() === "[" || line.trim() === "{") {
      continue;
    }
    return line.match(/^[ \t]*/u)?.[0] ?? "";
  }
  const closeLine = source.slice(source.lastIndexOf("\n", closeIndex - 1) + 1, closeIndex);
  return `${closeLine.match(/^[ \t]*/u)?.[0] ?? ""}  `;
}

function hasOptionContent(source: string, format: PropertyTargetOptionsFormat): boolean {
  const trimmed = source
    .replace(format === "braced" ? /^\s*\{/u : /^\s*\[/u, "")
    .trim();
  return trimmed.length > 0;
}

/**
 * One option entry: the key alone, the bare color, or `key=value`. The key is
 * a literal of the calling action or the inspector's normalized key; the
 * value is user text, a fragment, or an `OptionValueText` checked against its
 * key. This is the one place a key meets its value, so it is the one place
 * the entry text is trusted.
 */
export function serializeOptionEntry(
  key: string,
  value: TikzFragment | OptionValueText,
  serializationContext: OptionSerializationContext = DEFAULT_OPTION_SERIALIZATION_CONTEXT
): TikzFragment {
  const trimmed = value.trim();
  // `draw=red` is written `red` on a `\draw`: the color alone, as an entry.
  if (trimmed.length > 0 && shouldSerializeAsBareColorOption(key, trimmed, serializationContext)) {
    return optionEntry(trimmed, null);
  }
  return optionEntry(key, value);
}

function optionEntryKey(entry: OptionEntry): string | null {
  if (entry.kind === "kv" || entry.kind === "flag") {
    return normalizeOptionKey(entry.key);
  }
  return null;
}

/** An entry of an option list parsed from the document: text the user authored there. */
function normalizeOptionEntryRaw(entry: OptionEntry): TikzFragment {
  const raw = entry.raw.trim();
  if (raw.length > 0) {
    return userText(raw, "source-editor");
  }
  if (entry.kind === "kv") {
    return userText(`${entry.key}=${entry.valueRaw}`, "source-editor");
  }
  if (entry.kind === "flag") {
    return userText(entry.key, "source-editor");
  }
  return EMPTY_FRAGMENT;
}

function resolveOptionSerializationContext(target: PropertyTarget): OptionSerializationContext {
  if (!target.pathCommand) {
    return DEFAULT_OPTION_SERIALIZATION_CONTEXT;
  }

  const normalizedPathCommand = target.pathCommand.trim().toLowerCase();
  if (normalizedPathCommand === "draw" || normalizedPathCommand === "fill") {
    return {
      bareColorKey: normalizedPathCommand
    };
  }

  return DEFAULT_OPTION_SERIALIZATION_CONTEXT;
}

function wrapSerializedOptions(
  content: TikzFragment,
  format: PropertyTargetOptionsFormat
): TikzFragment {
  switch (format) {
    case "bare":
      return content;
    case "braced":
      return tikz`{${content}}`;
    case "bracketed":
    default:
      return tikz`[${content}]`;
  }
}

function shouldSerializeAsBareColorOption(
  key: string,
  value: string,
  serializationContext: OptionSerializationContext
): boolean {
  const normalizedValue = value.toLowerCase();
  return (
    serializationContext.bareColorKey === key &&
    normalizedValue !== "false" &&
    normalizedValue !== "none" &&
    isLikelyBareColorOption(value)
  );
}

function resolveFlagAliasKey(
  entry: Extract<OptionEntry, { kind: "flag" }>,
  mutations: ReadonlyMap<string, OptionMutation>,
  serializationContext: OptionSerializationContext
): string | null {
  const bareColorKey = serializationContext.bareColorKey;
  if (!bareColorKey || !mutations.has(bareColorKey)) {
    return null;
  }

  return isLikelyBareColorOption(entry.key) ? bareColorKey : null;
}

function isLikelyBareColorOption(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed === "none" || trimmed === "." || NAMED_COLORS.has(trimmed)) {
    return true;
  }
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
    return true;
  }
  if (/^\{?\s*rgb(?:\s*,\s*255)?\s*:/i.test(trimmed)) {
    return true;
  }

  if (!trimmed.includes("!")) {
    return false;
  }

  return /^[a-z][a-z0-9._:@-]*\s*!\s*\d+(?:\.\d+)?(?:\s*!\s*[a-z][a-z0-9._:@-]*)?(?:\s*!\s*\d+(?:\.\d+)?(?:\s*!\s*[a-z][a-z0-9._:@-]*)?)*$/i.test(
    trimmed
  );
}
