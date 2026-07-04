import type { Span } from "../ast/types.js";
import type { OptionEntry, OptionListAst } from "../options/types.js";
import { NAMED_COLORS } from "../semantic/style/constants.js";
import { replaceSpan } from "./patch.js";
import type { PropertyTarget, PropertyTargetOptionsFormat } from "./property-target.js";
import type { SourcePatch } from "./types.js";
import { normalizeOptionKey as normalizeSharedOptionKey } from "./option-key.js";

export type OptionMutation =
  | { kind: "set"; value: string }
  | { kind: "remove" };

export type OptionMutationApplyResult = {
  source: string;
  patch: SourcePatch;
};

type OptionSerializationContext = {
  bareColorKey: "draw" | "fill" | null;
};

type RelativeReplacement = {
  from: number;
  to: number;
  text: string;
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
    const replacement = rewriteOptionListMutationsPreservingSource(
      source,
      target.optionsSpan,
      target.options,
      mutations,
      serializationContext,
      format
    );
    if (replacement.length === 0) {
      const oldSpan = target.optionsSpan;
      const updated = replaceSpan(source, oldSpan, "");
      if (updated.source === source) {
        return null;
      }
      return {
        source: updated.source,
        patch: {
          oldSpan,
          newSpan: updated.changedSpan,
          replacement: ""
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

  const entriesToInsert: string[] = [];
  for (const [key, mutation] of mutations.entries()) {
    if (mutation.kind === "set") {
      entriesToInsert.push(serializeOptionEntry(key, mutation.value, serializationContext));
    }
  }
  if (entriesToInsert.length === 0) {
    return null;
  }

  const replacement = wrapSerializedOptions(entriesToInsert.join(", "), target.optionsFormat ?? "bracketed");
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
): string {
  const parts: string[] = [];
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
    return format === "bracketed" ? "" : wrapSerializedOptions("", format);
  }

  return wrapSerializedOptions(parts.join(", "), format);
}

export const normalizeOptionKey = normalizeSharedOptionKey;

function rewriteOptionListMutationsPreservingSource(
  source: string,
  optionsSpan: Span,
  options: OptionListAst,
  mutations: ReadonlyMap<string, OptionMutation>,
  serializationContext: OptionSerializationContext,
  format: PropertyTargetOptionsFormat
): string {
  const original = source.slice(optionsSpan.from, optionsSpan.to);
  const emitted = new Set<string>();
  const replacements: Array<{ from: number; to: number; text: string; removesEntry: boolean }> = [];
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
      text: "",
      removesEntry: true
    });
  }

  const entriesToInsert: string[] = [];
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
    replacements.filter((replacement) => replacement.removesEntry).length === sortedEntries.length
  ) {
    return format === "bracketed" || format === "bare" ? "" : wrapSerializedOptions("", format);
  }

  const rewritten = normalizeTopLevelCommaSpacing(applyRelativeReplacements(original, replacements), format);
  if (entriesToInsert.length === 0) {
    return rewritten;
  }

  return insertSerializedOptionEntries(rewritten, entriesToInsert, format);
}

function normalizeTopLevelCommaSpacing(source: string, format: PropertyTargetOptionsFormat): string {
  if (source.includes("\n") || source.includes("\r")) {
    return source;
  }

  let squareDepth = 0;
  let curlyDepth = 0;
  let parenDepth = 0;
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (char === "," && isTopLevelComma(format, squareDepth, curlyDepth, parenDepth)) {
      let nextIndex = index + 1;
      while (source[nextIndex] === " " || source[nextIndex] === "\t") {
        nextIndex += 1;
      }
      const next = source[nextIndex];
      if (next !== undefined && next !== "]" && next !== "}") {
        result += ", ";
      }
      index = nextIndex - 1;
      continue;
    }

    result += char;
    if (char === "[") {
      squareDepth += 1;
    } else if (char === "]") {
      squareDepth = Math.max(0, squareDepth - 1);
    } else if (char === "{") {
      curlyDepth += 1;
    } else if (char === "}") {
      curlyDepth = Math.max(0, curlyDepth - 1);
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    }
  }
  return result;
}

function isTopLevelComma(
  format: PropertyTargetOptionsFormat,
  squareDepth: number,
  curlyDepth: number,
  parenDepth: number
): boolean {
  if (parenDepth !== 0) {
    return false;
  }
  if (format === "bracketed") {
    return squareDepth === 1 && curlyDepth === 0;
  }
  if (format === "braced") {
    return squareDepth === 0 && curlyDepth === 1;
  }
  return squareDepth === 0 && curlyDepth === 0;
}

function applyRelativeReplacements(
  source: string,
  replacements: ReadonlyArray<RelativeReplacement>
): string {
  if (replacements.length === 0) {
    return source;
  }
  let current = source;
  const sorted = normalizeRelativeReplacements(source, replacements)
    .sort((left, right) => right.from - left.from || right.to - left.to);
  for (const replacement of sorted) {
    current = `${current.slice(0, replacement.from)}${replacement.text}${current.slice(replacement.to)}`;
  }
  return current;
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
    pieces.push({ from: removal.from, to: overlapFrom, text: "" });
  }
  if (overlapTo < removal.to) {
    pieces.push({ from: overlapTo, to: removal.to, text: "" });
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
  while (right < source.length && (source[right] === " " || source[right] === "\t")) {
    right += 1;
  }
  if (right < source.length && source[right] !== "]" && source[right] !== "}") {
    return removal;
  }

  let left = removal.from;
  while (left > 0 && (source[left - 1] === " " || source[left - 1] === "\t")) {
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
  source: string,
  entries: readonly string[],
  format: PropertyTargetOptionsFormat
): string {
  const content = entries.join(", ");
  if (format === "bare") {
    return source.trim().length === 0 ? content : `${source}, ${content}`;
  }

  const closeChar = format === "braced" ? "}" : "]";
  const closeIndex = source.lastIndexOf(closeChar);
  if (closeIndex < 0) {
    return source.trim().length === 0 ? wrapSerializedOptions(content, format) : `${source}, ${content}`;
  }

  if (!source.includes("\n")) {
    const prefix = hasOptionContent(source.slice(0, closeIndex), format) ? `, ${content}` : content;
    return `${source.slice(0, closeIndex)}${prefix}${source.slice(closeIndex)}`;
  }

  const insertion = multilineInsertion(source, closeIndex, content, format);
  return `${source.slice(0, insertion.index)}${insertion.text}${source.slice(insertion.index)}`;
}

function multilineInsertion(
  source: string,
  closeIndex: number,
  content: string,
  format: PropertyTargetOptionsFormat
): { index: number; text: string } {
  const closeLineStart = source.lastIndexOf("\n", closeIndex - 1);
  const closingLineIsWhitespaceOnly =
    closeLineStart >= 0 && source.slice(closeLineStart + 1, closeIndex).trim().length === 0;
  const insertIndex = closingLineIsWhitespaceOnly ? closeLineStart : closeIndex;
  const beforeInsertion = source.slice(0, insertIndex);
  const indent = inferOptionEntryIndent(source, closeIndex);
  const needsComma = hasOptionContent(beforeInsertion, format) && !/,\s*$/u.test(beforeInsertion);
  const separator = needsComma ? "," : "";
  return {
    index: insertIndex,
    text: `${separator}\n${indent}${content}`
  };
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

export function serializeOptionEntry(
  key: string,
  value: string,
  serializationContext: OptionSerializationContext = DEFAULT_OPTION_SERIALIZATION_CONTEXT
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === "true") {
    return key;
  }
  if (shouldSerializeAsBareColorOption(key, trimmed, serializationContext)) {
    return trimmed;
  }
  return `${key}=${trimmed}`;
}

function optionEntryKey(entry: OptionEntry): string | null {
  if (entry.kind === "kv" || entry.kind === "flag") {
    return normalizeOptionKey(entry.key);
  }
  return null;
}

function normalizeOptionEntryRaw(entry: OptionEntry): string {
  const raw = entry.raw.trim();
  if (raw.length > 0) {
    return raw;
  }
  if (entry.kind === "kv") {
    return `${entry.key}=${entry.valueRaw}`;
  }
  if (entry.kind === "flag") {
    return entry.key;
  }
  return "";
}

function resolveOptionSerializationContext(target: PropertyTarget): OptionSerializationContext {
  if (!target.pathCommand) {
    return DEFAULT_OPTION_SERIALIZATION_CONTEXT;
  }

  const normalizedPathCommand = target.pathCommand?.trim().toLowerCase();
  if (normalizedPathCommand === "draw" || normalizedPathCommand === "fill") {
    return {
      bareColorKey: normalizedPathCommand
    };
  }

  return DEFAULT_OPTION_SERIALIZATION_CONTEXT;
}

function wrapSerializedOptions(
  content: string,
  format: PropertyTargetOptionsFormat
): string {
  switch (format) {
    case "bare":
      return content;
    case "braced":
      return `{${content}}`;
    case "bracketed":
    default:
      return `[${content}]`;
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
