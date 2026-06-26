export {
  DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
  expandMacroBindings,
  expandMacroBindingsMapped,
  isControlSequenceToken
} from "./expand.js";
export type { MacroExpansionOptions, MacroExpansionTraceEvent } from "./expand.js";
export type {
  CallableMacroBinding,
  MacroBinding,
  MacroDefinitionCommandRaw,
  MacroOriginFrame,
  TextMacroBinding
} from "./types.js";
