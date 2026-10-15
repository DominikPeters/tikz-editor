import { expandMacroBindings, type MacroBinding, type MacroExpansionTraceEvent } from "../../macros/index.js";

export function expandPathMacroBindings(
  raw: string,
  macroBindings?: ReadonlyMap<string, MacroBinding>,
  macroTraceCollector?: MacroExpansionTraceEvent[]
): string {
  if (!macroBindings || macroBindings.size === 0) {
    return raw;
  }

  return expandMacroBindings(raw, macroBindings, { ...(macroTraceCollector === undefined ? {} : { trace: macroTraceCollector }) });
}
