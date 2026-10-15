import type { PropertyTargetResolution } from "../property-target.js";
import { normalizeOptionKey } from "../option-key.js";
import type { OptionListAst } from "../../options/types.js";
import type { StyleChainEntry } from "../../semantic/style-chain.js";
import { normalizeColor, resolveDefineColorModel } from "../../semantic/style/colors.js";
import { readBalancedBlock, stripEnclosingBraces } from "../../semantic/style/option-utils.js";
import { incrementProfilingCounter } from "../../profiling.js";

const COLOR_OPTIONS = [
  "none",
  "black",
  "darkgray",
  "gray",
  "lightgray",
  "white",
  "red",
  "green",
  "blue",
  "cyan",
  "magenta",
  "yellow",
  "lime",
  "olive",
  "orange",
  "pink",
  "violet",
  "purple",
  "teal",
  "brown"
];

const HEX_TO_NAMED_COLOR: Record<string, string> = {
  "#000000": "black",
  "#404040": "darkgray",
  "#808080": "gray",
  "#bfbfbf": "lightgray",
  "#ffffff": "white",
  "#ff0000": "red",
  "#00ff00": "green",
  "#0000ff": "blue",
  "#00ffff": "cyan",
  "#ff00ff": "magenta",
  "#ffff00": "yellow",
  "#bfff00": "lime",
  "#808000": "olive",
  "#ff8000": "orange",
  "#ffbfbf": "pink",
  "#800080": "violet",
  "#bf0040": "purple",
  "#008080": "teal",
  "#bf8040": "brown"
};

export function normalizeInspectorColorValue(value: string | null): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized in HEX_TO_NAMED_COLOR) {
    return HEX_TO_NAMED_COLOR[normalized] ?? null;
  }
  return normalized;
}

export function resolveColorSyntaxValue(
  resolvedTarget: PropertyTargetResolution | null,
  keys: readonly string[],
  currentValue: string | null,
  colorAliases: ReadonlyMap<string, string>,
  styleChain: readonly StyleChainEntry[] = []
): string | null {
  incrementProfilingCounter("resolveColorSyntaxValueCalls");
  const normalizedKeys = new Set(keys.map((key) => normalizeOptionKey(key)));
  if (normalizedKeys.size === 0) {
    return null;
  }

  const normalizedCurrentValue = normalizeInspectorColorValue(currentValue);

  if (resolvedTarget?.kind === "found" && resolvedTarget.target.options) {
    const directMatch = resolveColorSyntaxFromOptionLists(
      [resolvedTarget.target.options],
      normalizedKeys,
      normalizedCurrentValue,
      colorAliases
    );
    if (directMatch != null) {
      return directMatch;
    }
  }

  for (let index = styleChain.length - 1; index >= 0; index -= 1) {
    const chainEntry = styleChain[index];
    if (!chainEntry) {
      continue;
    }
    const chainMatch = resolveColorSyntaxFromOptionLists(
      chainEntry.rawOptions,
      normalizedKeys,
      normalizedCurrentValue,
      colorAliases
    );
    if (chainMatch != null) {
      return chainMatch;
    }
  }

  return null;
}

function resolveColorSyntaxFromOptionLists(
  optionLists: readonly OptionListAst[],
  normalizedKeys: ReadonlySet<string>,
  normalizedCurrentValue: string | null,
  colorAliases: ReadonlyMap<string, string>
): string | null {
  if (optionLists.length === 0) {
    return null;
  }

  let colorValue: string | null = null;

  const resolveAlias = (rawColorName: string): string | null => {
    const normalized = rawColorName.trim().toLowerCase();
    if (normalized.length === 0) {
      return null;
    }
    return colorAliases.get(normalized) ?? null;
  };

  for (const optionList of optionLists) {
    for (const entry of optionList.entries) {
      if (entry.kind === "kv") {
        const entryKey = normalizeOptionKey(entry.key);
        if (!normalizedKeys.has(entryKey)) {
          continue;
        }
        const rawValue = stripEnclosingBraces(entry.valueRaw.trim());
        if (rawValue.length === 0) {
          continue;
        }
        colorValue = rawValue;
        continue;
      }

      if (entry.kind !== "flag" || !normalizedCurrentValue) {
        continue;
      }

      const rawToken = stripEnclosingBraces(entry.raw.trim());
      if (rawToken.length === 0) {
        continue;
      }

      const normalizedRawToken = rawToken.toLowerCase();
      const resolvedToken = normalizeColor(normalizedRawToken, {
        resolveAlias
      });
      const normalizedResolved = normalizeInspectorColorValue(resolvedToken);
      if (normalizedResolved === normalizedCurrentValue) {
        colorValue = rawToken;
      }
    }
  }

  return colorValue;
}

export function collectInspectorColorAliases(source: string): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  let cursor = 0;

  while (cursor < source.length) {
    const colorletIndex = source.indexOf("\\colorlet", cursor);
    const defineColorIndex = source.indexOf("\\definecolor", cursor);
    const nextColorlet = colorletIndex >= 0 ? colorletIndex : Number.POSITIVE_INFINITY;
    const nextDefineColor = defineColorIndex >= 0 ? defineColorIndex : Number.POSITIVE_INFINITY;
    const nextIndex = Math.min(nextColorlet, nextDefineColor);

    if (!Number.isFinite(nextIndex)) {
      break;
    }

    if (nextIndex === nextColorlet) {
      const parsed = parseInspectorColorletStatement(source, nextIndex);
      if (parsed) {
        aliases.set(parsed.name, parsed.value);
        cursor = parsed.nextIndex;
        continue;
      }
      cursor = nextIndex + 1;
      continue;
    }

    const parsed = parseInspectorDefineColorStatement(source, nextIndex);
    if (parsed) {
      aliases.set(parsed.name, parsed.value);
      cursor = parsed.nextIndex;
      continue;
    }
    cursor = nextIndex + 1;
  }

  return aliases;
}

export function parseInspectorColorletStatement(
  source: string,
  startIndex: number
): { name: string; value: string; nextIndex: number } | null {
  let cursor = startIndex + "\\colorlet".length;
  const nameGroup = readInspectorBraceGroup(source, cursor);
  if (!nameGroup) {
    return null;
  }
  cursor = nameGroup.nextIndex;

  const valueGroup = readInspectorBraceGroup(source, cursor);
  if (!valueGroup) {
    return null;
  }
  cursor = valueGroup.nextIndex;

  const normalizedName = normalizeInspectorDeclaredColorName(nameGroup.value);
  if (!normalizedName) {
    return null;
  }
  if (valueGroup.value.length === 0) {
    return null;
  }

  return {
    name: normalizedName,
    value: valueGroup.value,
    nextIndex: cursor
  };
}

export function parseInspectorDefineColorStatement(
  source: string,
  startIndex: number
): { name: string; value: string; nextIndex: number } | null {
  let cursor = startIndex + "\\definecolor".length;
  const nameGroup = readInspectorBraceGroup(source, cursor);
  if (!nameGroup) {
    return null;
  }
  cursor = nameGroup.nextIndex;

  const modelGroup = readInspectorBraceGroup(source, cursor);
  if (!modelGroup) {
    return null;
  }
  cursor = modelGroup.nextIndex;

  const specificationGroup = readInspectorBraceGroup(source, cursor);
  if (!specificationGroup) {
    return null;
  }
  cursor = specificationGroup.nextIndex;

  const normalizedName = normalizeInspectorDeclaredColorName(nameGroup.value);
  if (!normalizedName) {
    return null;
  }

  const resolved = resolveDefineColorModel(modelGroup.value, specificationGroup.value);
  if (!resolved) {
    return null;
  }

  return {
    name: normalizedName,
    value: resolved.toLowerCase(),
    nextIndex: cursor
  };
}

export function readInspectorBraceGroup(
  source: string,
  startIndex: number
): { value: string; nextIndex: number } | null {
  const cursor = skipInspectorWhitespace(source, startIndex);
  if (cursor >= source.length || source[cursor] !== "{") {
    return null;
  }

  const block = readBalancedBlock(source, cursor, "{", "}");
  if (!block) {
    return null;
  }

  return {
    value: block.content.trim(),
    nextIndex: block.nextIndex
  };
}

export function normalizeInspectorDeclaredColorName(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._:@-]*$/u.test(normalized)) {
    return null;
  }
  return normalized;
}

export function skipInspectorWhitespace(source: string, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < source.length && /\s/u.test(source.charAt(cursor))) {
    cursor += 1;
  }
  return cursor;
}

export function colorOptionsForValue(value: string | null): string[] {
  if (!value) {
    return COLOR_OPTIONS;
  }
  if (COLOR_OPTIONS.includes(value)) {
    return COLOR_OPTIONS;
  }
  return [value, ...COLOR_OPTIONS];
}
