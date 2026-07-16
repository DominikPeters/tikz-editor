import type { HostParseContext } from "@tikz-editor/addon-api";

import type { Span, Statement } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { OptionListAst } from "../options/types.js";
import type { AddonRuntime } from "./runtime.js";

/**
 * Parse services the CST->AST layer provides to add-on parse hooks. Supplied
 * as closures by the caller that owns the parse (transform/cst-to-ast), so
 * this module needs no parser imports of its own.
 */
export type AddonStatementMappingServices = {
  parseStatements(span: Span): Statement[];
  parseOptionList(raw: string, from: number): OptionListAst;
  readBalancedGroup(from: number): Span | null;
};

/**
 * Add-on routing state threaded through statement mapping. Present on
 * StatementMappingState only when an add-on runtime is active for the parse.
 */
export type AddonStatementMapping = {
  runtime: AddonRuntime;
  /** The source the CST spans refer to (the parse-window source). */
  source: string;
  diagnostics: Diagnostic[];
  services: AddonStatementMappingServices;
};

export function createHostParseContext(mapping: AddonStatementMapping): HostParseContext {
  return {
    source: mapping.source,
    slice: (span) => mapping.source.slice(span.from, span.to),
    parseOptionList: (raw, from = 0) => mapping.services.parseOptionList(raw, from),
    parseTikzStatements: (span) => mapping.services.parseStatements(span),
    readBalancedGroup: (from) => mapping.services.readBalancedGroup(from),
    pushDiagnostic: (diagnostic) =>
      mapping.diagnostics.push({
        severity: diagnostic.severity,
        message: diagnostic.message,
        span: diagnostic.span,
        code: diagnostic.code
      })
  };
}
