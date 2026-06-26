import type { PicOperationItem, Span } from "../../ast/types.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import { stripWrappingBraces } from "../../utils/braces.js";
import type { StyleSourceRef } from "../style-chain.js";
import { cloneStyleSourceRef } from "../style-chain.js";
import { parseStyleValueAsOptionList } from "../style/option-utils.js";

type PicCodeLayer = "normal" | "background" | "foreground";

export type PicDefinition = {
  name: string;
  codeRaw: string;
  codeSpan?: Span;
  sourceRef: StyleSourceRef;
  parameterized: boolean;
  codeLayer: PicCodeLayer;
};

export type PicDefinitionRegistry = Map<string, PicDefinition>;

export type ResolvedPicCode =
  | {
      kind: "found";
      codeRaw: string;
      codeSpan?: Span;
      sourceRef: StyleSourceRef;
      source: "definition" | "inline";
      parameterized: boolean;
      unresolvedParameters: boolean;
      codeLayer: PicCodeLayer;
    }
  | {
      kind: "not-found";
      reason: string;
    };

export function createDefaultPicDefinitionRegistry(): PicDefinitionRegistry {
  return new Map();
}

export function clonePicDefinitionRegistry(registry: PicDefinitionRegistry): PicDefinitionRegistry {
  const cloned: PicDefinitionRegistry = new Map();
  for (const [name, definition] of registry) {
    cloned.set(name, clonePicDefinition(definition));
  }
  return cloned;
}

export function applyPicDefinitionsFromOptionLists(
  registry: PicDefinitionRegistry,
  optionLists: readonly OptionListAst[],
  sourceRef: StyleSourceRef
): void {
  for (const optionList of optionLists) {
    for (const entry of optionList.entries) {
      if (entry.kind !== "kv") {
        continue;
      }
      const normalizedKey = normalizePicKey(entry.key);
      if (normalizedKey.endsWith("/.pic")) {
        const name = normalizePicName(normalizedKey.slice(0, -"/.pic".length));
        if (name.length > 0) {
          registerPicDefinition(registry, name, entry.valueRaw, entry.valueSpan ?? entry.span, sourceRef);
        }
        continue;
      }

      const styleName = parsePicsStyleDefinitionName(normalizedKey);
      if (styleName) {
        const valueStart = resolveValueStartOffset(entry);
        const nested = parseStyleValueAsOptionList(entry.valueRaw, valueStart);
        const codeEntry = nested ? findPicCodeEntry(nested.entries) : null;
        if (codeEntry) {
          registerPicDefinition(
            registry,
            styleName,
            codeEntry.entry.valueRaw,
            codeEntry.entry.valueSpan ?? codeEntry.entry.span,
            sourceRef,
            codeEntry.layer
          );
        }
      }
    }
  }
}

export function resolvePicCode(item: PicOperationItem, registry: PicDefinitionRegistry): ResolvedPicCode {
  const inlineFromOptions = item.options ? findPicCodeEntry(item.options.entries) : null;
  if (inlineFromOptions) {
    const code = normalizePicCodeRawAndSpan(inlineFromOptions.entry.valueRaw, inlineFromOptions.entry.valueSpan ?? inlineFromOptions.entry.span);
    const parameterized = containsParameterPlaceholder(inlineFromOptions.entry.valueRaw);
    return {
      kind: "found",
      codeRaw: code.raw,
      codeSpan: code.span,
      sourceRef: {
        sourceId: item.id,
        sourceSpan: code.span,
        sourceKind: "pic-inline-code",
        label: "pics/code"
      },
      source: "inline",
      parameterized,
      unresolvedParameters: parameterized,
      codeLayer: inlineFromOptions.layer
    };
  }

  const typeRaw = item.typeRaw.trim();
  if (typeRaw.length === 0) {
    return { kind: "not-found", reason: "Pic type is empty." };
  }

  const typeOptionList = parseStyleValueAsOptionList(typeRaw, item.typeSpan?.from ?? item.span.from);
  const inlineFromType = typeOptionList ? findPicCodeEntry(typeOptionList.entries) : null;
  if (inlineFromType) {
    const code = normalizePicCodeRawAndSpan(inlineFromType.entry.valueRaw, inlineFromType.entry.valueSpan ?? inlineFromType.entry.span);
    const parameterized = containsParameterPlaceholder(inlineFromType.entry.valueRaw);
    return {
      kind: "found",
      codeRaw: code.raw,
      codeSpan: code.span,
      sourceRef: {
        sourceId: item.id,
        sourceSpan: code.span,
        sourceKind: "pic-inline-code",
        label: "pic code"
      },
      source: "inline",
      parameterized,
      unresolvedParameters: parameterized,
      codeLayer: inlineFromType.layer
    };
  }

  const lookup = resolveDefinitionLookup(typeRaw, typeOptionList, registry);
  const definition = lookup?.definition ?? null;
  if (!definition) {
    return { kind: "not-found", reason: `Unknown pic type '${typeRaw}'.` };
  }

  const substitutedCode =
    definition.parameterized && lookup?.parameterRaw != null
      ? substitutePicParameter(definition.codeRaw, lookup.parameterRaw)
      : definition.codeRaw;
  const unresolvedParameters = containsParameterPlaceholder(substitutedCode);

  return {
    kind: "found",
    codeRaw: substitutedCode,
    codeSpan: substitutedCode === definition.codeRaw ? definition.codeSpan : undefined,
    sourceRef: definition.sourceRef,
    source: "definition",
    parameterized: definition.parameterized,
    unresolvedParameters,
    codeLayer: definition.codeLayer
  };
}

export function isPicDefinitionOptionKey(key: string): boolean {
  const normalized = normalizePicKey(key);
  return normalized.endsWith("/.pic") || parsePicsStyleDefinitionName(normalized) != null;
}

export function isPicCodeOptionKey(key: string): boolean {
  const normalized = normalizePicKey(key);
  return (
    normalized === "code" ||
    normalized === "pics/code" ||
    normalized === "background code" ||
    normalized === "pics/background code" ||
    normalized === "foreground code" ||
    normalized === "pics/foreground code"
  );
}

export function normalizePicName(raw: string): string {
  let normalized = normalizePicKey(raw);
  if (normalized.startsWith("pics/")) {
    normalized = normalized.slice("pics/".length);
  }
  return normalized.trim();
}

function registerPicDefinition(
  registry: PicDefinitionRegistry,
  name: string,
  rawCode: string,
  codeSpan: Span | null | undefined,
  sourceRef: StyleSourceRef,
  codeLayer: PicCodeLayer = "normal"
): void {
  const code = normalizePicCodeRawAndSpan(rawCode, codeSpan);
  registry.set(name, {
    name,
    codeRaw: code.raw,
    codeSpan: code.span,
    sourceRef:
      cloneStyleSourceRef(sourceRef) ??
      ({
        sourceId: `pic-definition:${name}:unknown`,
        sourceKind: "pic-definition",
        label: name
      } satisfies StyleSourceRef),
    parameterized: containsParameterPlaceholder(code.raw),
    codeLayer
  });
}

function clonePicDefinition(definition: PicDefinition): PicDefinition {
  return {
    ...definition,
    codeSpan: definition.codeSpan ? { ...definition.codeSpan } : undefined,
    sourceRef:
      cloneStyleSourceRef(definition.sourceRef) ??
      ({
        sourceId: `pic-definition:${definition.name}:unknown`,
        sourceKind: "pic-definition",
        label: definition.name
      } satisfies StyleSourceRef)
  };
}

function parsePicsStyleDefinitionName(normalizedKey: string): string | null {
  if (!normalizedKey.startsWith("pics/") || !normalizedKey.endsWith("/.style")) {
    return null;
  }
  const name = normalizePicName(normalizedKey.slice("pics/".length, -"/.style".length));
  return name.length > 0 ? name : null;
}

function findPicCodeEntry(entries: readonly OptionEntry[]): { entry: Extract<OptionEntry, { kind: "kv" }>; layer: PicCodeLayer } | null {
  for (const entry of entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (isPicCodeOptionKey(entry.key)) {
      return { entry, layer: picCodeLayerForKey(entry.key) };
    }
  }
  return null;
}

function picCodeLayerForKey(key: string): PicCodeLayer {
  const normalized = normalizePicKey(key);
  if (normalized === "background code" || normalized === "pics/background code") {
    return "background";
  }
  if (normalized === "foreground code" || normalized === "pics/foreground code") {
    return "foreground";
  }
  return "normal";
}

function resolveDefinitionLookup(
  typeRaw: string,
  typeOptionList: OptionListAst | null,
  registry: PicDefinitionRegistry
): { definition: PicDefinition; parameterRaw?: string } | null {
  const direct = registry.get(normalizePicName(typeRaw));
  if (direct) {
    return { definition: direct };
  }

  for (const entry of typeOptionList?.entries ?? []) {
    if (entry.kind !== "kv") {
      continue;
    }

    const definition = registry.get(normalizePicName(entry.key));
    if (definition) {
      return {
        definition,
        parameterRaw: stripWrappingBraces(entry.valueRaw.trim())
      };
    }
  }

  return null;
}

function substitutePicParameter(raw: string, parameterRaw: string): string {
  return raw.replace(/(^|[^\\])#1/g, `$1${parameterRaw}`);
}

function resolveValueStartOffset(entry: Extract<OptionEntry, { kind: "kv" }>): number {
  const rawIndex = entry.raw.indexOf(entry.valueRaw);
  if (rawIndex >= 0) {
    return entry.span.from + rawIndex;
  }
  return entry.span.from;
}

function containsParameterPlaceholder(raw: string): boolean {
  return /(^|[^\\])#\d/.test(raw);
}

function normalizePicCodeRawAndSpan(rawCode: string, span?: Span | null): { raw: string; span?: Span } {
  const raw = stripWrappingBraces(rawCode);
  if (!span) {
    return { raw };
  }
  const trimmedStart = rawCode.search(/\S/u);
  if (trimmedStart < 0) {
    return {
      raw,
      span: {
        from: span.from,
        to: span.from
      }
    };
  }
  let trimmedEnd = rawCode.length;
  while (trimmedEnd > trimmedStart && /\s/u.test(rawCode[trimmedEnd - 1] ?? "")) {
    trimmedEnd -= 1;
  }
  if (rawCode[trimmedStart] === "{" && rawCode[trimmedEnd - 1] === "}") {
    return {
      raw,
      span: {
        from: span.from + trimmedStart + 1,
        to: span.from + trimmedEnd - 1
      }
    };
  }
  return {
    raw,
    span: {
      from: span.from + trimmedStart,
      to: span.from + trimmedEnd
    }
  };
}

function normalizePicKey(raw: string): string {
  let normalized = raw.trim().toLowerCase();
  if (normalized.startsWith("/tikz/")) {
    normalized = normalized.slice("/tikz/".length);
  }
  while (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }
  return normalized.trim();
}
