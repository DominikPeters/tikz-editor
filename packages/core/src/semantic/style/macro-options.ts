import type { MacroBinding, MacroExpansionTraceEvent } from "../../macros/index.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings } from "../../macros/index.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";

export function expandOptionListMacros(
  optionLists: OptionListAst[],
  macroBindings: ReadonlyMap<string, MacroBinding>,
  trace: MacroExpansionTraceEvent[] | undefined
): OptionListAst[] {
  if (optionLists.length === 0 || macroBindings.size === 0) {
    return optionLists;
  }

  return optionLists.map((list) => {
    const entries = list.entries.map(entry => expandOptionEntryMacro(entry, macroBindings, trace));
    if (entries.every((entry, index) => entry === list.entries[index])) {
      return list;
    }

    return {
      ...list,
      entries,
      raw: entries.map((entry) => entry.raw).join(", ")
    };
  });
}

function expandOptionEntryMacro(
  entry: OptionEntry,
  macroBindings: ReadonlyMap<string, MacroBinding>,
  trace: MacroExpansionTraceEvent[] | undefined
): OptionEntry {
  if (entry.kind === "kv") {
    const valueRaw = expandMacroBindings(entry.valueRaw, macroBindings, {
      maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
      ...(trace === undefined ? {} : { trace: trace })
    });
    if (valueRaw === entry.valueRaw) {
      return entry;
    }
    return {
      ...entry,
      valueRaw,
      raw: `${entry.key}=${valueRaw}`
    };
  }

  if (entry.kind === "unknown") {
    const raw = expandMacroBindings(entry.raw, macroBindings, {
      maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
      ...(trace === undefined ? {} : { trace: trace })
    });
    if (raw === entry.raw) {
      return entry;
    }
    return {
      ...entry,
      raw
    };
  }

  return entry;
}
