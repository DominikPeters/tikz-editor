import type { PicOperationItem, Span } from "../../ast/types.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import { stripWrappingBraces } from "../../utils/braces.js";
import type { StyleSourceRef } from "../style-chain.js";
import { cloneStyleSourceRef } from "../style-chain.js";
import { parseStyleValueAsOptionList } from "../style/option-utils.js";
import { PersistentMap } from "../persistent-map.js";

type PicCodeLayer = "normal" | "background" | "foreground";

type PicCodeBody = {
  codeRaw: string;
  codeSpan?: Span;
  sourceRef: StyleSourceRef;
  parameterized: boolean;
  codeLayer: PicCodeLayer;
};

export type PicDefinition = { name: string; codes: PicCodeBody[] };

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
  return new PersistentMap();
}

export function clonePicDefinitionRegistry(registry: PicDefinitionRegistry): PicDefinitionRegistry {
  if (registry instanceof PersistentMap) {
    return registry.fork();
  }
  const imported = new PersistentMap<string, PicDefinition>();
  for (const [name, definition] of registry) {
    imported.set(name, definition);
  }
  return imported;
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
        if (nested) {
          registry.set(styleName, {
            name: styleName,
            codes: findPicCodeEntries(nested.entries).map(({ entry: codeEntry, layer }) =>
              makePicCodeBody(codeEntry.valueRaw, codeEntry.valueSpan ?? codeEntry.span, sourceRef, layer)
            )
          });
        }
      }
    }
  }
}

export function resolvePicCode(item: PicOperationItem, registry: PicDefinitionRegistry): ResolvedPicCode[] {
  const codes = new Map<PicCodeLayer, Extract<ResolvedPicCode, { kind: "found" }>>();
  const assignInline = (entry: Extract<OptionEntry, { kind: "kv" }>): void => {
    const layer = picCodeLayerForKey(entry.key);
    const code = makePicCodeBody(entry.valueRaw, entry.valueSpan ?? entry.span, {
      sourceId: item.id,
      sourceKind: "pic-inline-code",
      label: entry.key
    }, layer);
    codes.set(layer, { kind: "found", ...code, source: "inline", unresolvedParameters: code.parameterized });
  };
  for (const { entry } of findPicCodeEntries(item.options?.entries ?? [])) assignInline(entry);

  // Pic options execute first; the type body may assign or replace individual
  // stored keys afterwards. Each code key keeps its own final assignment.
  const typeRaw = item.typeRaw.trim();
  const typeOptions = parseStyleValueAsOptionList(typeRaw, item.typeSpan?.from ?? item.span.from);
  let foundDefinition = false;
  for (const entry of typeOptions?.entries ?? []) {
    if (entry.kind === "unknown") continue;
    if (entry.kind === "kv" && isPicCodeOptionKey(entry.key)) {
      assignInline(entry);
      continue;
    }
    const definition = registry.get(normalizePicName(entry.key));
    if (!definition) continue;
    foundDefinition = true;
    for (const code of definition.codes) {
      const substitutedCode = code.parameterized && entry.kind === "kv"
        ? substitutePicParameter(code.codeRaw, stripWrappingBraces(entry.valueRaw.trim()))
        : code.codeRaw;
      codes.set(code.codeLayer, {
        kind: "found", ...code,
        codeRaw: substitutedCode,
        codeSpan: substitutedCode === code.codeRaw ? code.codeSpan : undefined,
        source: "definition",
        unresolvedParameters: containsParameterPlaceholder(substitutedCode)
      });
    }
  }
  if (codes.size === 0 && !foundDefinition) {
    return [{ kind: "not-found", reason: typeRaw.length === 0 ? "Pic type is empty." : `Unknown pic type '${typeRaw}'.` }];
  }
  return PIC_CODE_EXECUTION_ORDER.flatMap((layer) => codes.has(layer) ? [codes.get(layer)!] : []);
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
  registry.set(name, { name, codes: [makePicCodeBody(rawCode, codeSpan, sourceRef, codeLayer)] });
}

function makePicCodeBody(
  rawCode: string,
  codeSpan: Span | null | undefined,
  sourceRef: StyleSourceRef,
  codeLayer: PicCodeLayer
): PicCodeBody {
  const code = normalizePicCodeRawAndSpan(rawCode, codeSpan);
  return {
    codeRaw: code.raw,
    codeSpan: code.span,
    sourceRef: { ...cloneStyleSourceRef(sourceRef)!, sourceSpan: code.span ?? sourceRef.sourceSpan },
    parameterized: containsParameterPlaceholder(code.raw),
    codeLayer
  };
}

function parsePicsStyleDefinitionName(normalizedKey: string): string | null {
  if (!normalizedKey.startsWith("pics/") || !normalizedKey.endsWith("/.style")) {
    return null;
  }
  const name = normalizePicName(normalizedKey.slice("pics/".length, -"/.style".length));
  return name.length > 0 ? name : null;
}

const PIC_CODE_EXECUTION_ORDER = ["normal", "foreground", "background"] as const;

function findPicCodeEntries(entries: readonly OptionEntry[]): Array<{ entry: Extract<OptionEntry, { kind: "kv" }>; layer: PicCodeLayer }> {
  const byLayer = new Map<PicCodeLayer, Extract<OptionEntry, { kind: "kv" }>>();
  for (const entry of entries) {
    if (entry.kind === "kv" && isPicCodeOptionKey(entry.key)) byLayer.set(picCodeLayerForKey(entry.key), entry);
  }
  return PIC_CODE_EXECUTION_ORDER.flatMap((layer) => byLayer.has(layer) ? [{ entry: byLayer.get(layer)!, layer }] : []);
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
