import type { AddonEngine, AddonParseResult, HostParseContext } from "@tikz-editor/addon-api";

import type { AddonCommandStatement, Span, Statement } from "../ast/types.js";
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

/**
 * Run an engine's parseCommand hook over a freshly built AddonCommand
 * statement and fold the result into it. Returns null when the engine
 * reports the statement as unsupported (callers fall back to
 * UnknownStatement); engine exceptions become error diagnostics.
 */
export function runAddonCommandParse(
  statement: AddonCommandStatement,
  engine: AddonEngine,
  mapping: AddonStatementMapping
): AddonCommandStatement | null {
  if (!engine.parseCommand) {
    return statement;
  }
  let result: AddonParseResult;
  try {
    result = engine.parseCommand(statement, createHostParseContext(mapping));
  } catch (error) {
    result = { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
  if (result.kind === "unsupported") {
    return null;
  }
  if (result.kind === "error") {
    mapping.diagnostics.push({
      severity: "error",
      message: `Add-on "${statement.addonId}" failed to parse ${statement.commandName}: ${result.message}`,
      span: statement.span,
      code: "addon-parse-error"
    });
    return statement;
  }
  statement.payload = result.payload;
  return statement;
}

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
