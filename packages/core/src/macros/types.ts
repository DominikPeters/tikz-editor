import type { Span } from "../ast/types.js";

export type MacroDefinitionCommandRaw =
  | "\\def"
  | "\\let"
  | "\\newcommand"
  | "\\renewcommand"
  | "\\providecommand"
  | "\\DeclareRobustCommand"
  | "\\DeclareMathOperator";

export type MacroOriginFrame = {
  macroName: string;
  definitionId: string;
  definitionSpan: Span;
  commandRaw: MacroDefinitionCommandRaw;
};

export type TextMacroBinding = {
  kind: "text";
  value: string;
  provenance: MacroOriginFrame[];
  /**
   * Editor-internal state kept with the macro bindings so that it follows TeX
   * grouping (pgfplots settings, read tables, the number format). Its name is
   * not a control sequence: it is never expanded, never resolved or reported
   * as a symbol, and never shown as a user macro.
   */
  internal?: true;
};

export type CallableMacroBinding = {
  kind: "callable";
  parameterCount: number;
  optionalFirstArgDefault?: string;
  body: string;
  provenance: MacroOriginFrame[];
};

export type MacroBinding = TextMacroBinding | CallableMacroBinding;
