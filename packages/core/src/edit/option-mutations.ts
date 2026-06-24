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
    const replacement = rewriteOptionListMutations(target.options, mutations, serializationContext, format);
    if (replacement.length === 0) {
      if (format !== "bracketed") {
        return null;
      }
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
