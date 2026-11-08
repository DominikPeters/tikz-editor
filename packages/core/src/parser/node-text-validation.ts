import type { TikzFigure } from "../ast/types.js";
import { walkStatements } from "../ast/walk.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { ParseTikzOptions, ParseTikzResult } from "./index.js";

// Validation belongs to the current document and validator, not the syntax
// cache. Track provenance without treating caller-chosen diagnostic codes as
// syntax codes, or retaining old parses through their diagnostics.
const textDiagnostics = new WeakSet<Diagnostic>();
const parseValidators = new WeakMap<ParseTikzResult, ParseTikzOptions["nodeTextValidator"]>();

export function rememberNodeTextValidator(parse: ParseTikzResult, validator: ParseTikzOptions["nodeTextValidator"]): ParseTikzResult {
  parseValidators.set(parse, validator);
  return parse;
}

export function nodeTextValidatorForParse(parse: ParseTikzResult): ParseTikzOptions["nodeTextValidator"] {
  return parseValidators.get(parse);
}

export function syntaxDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(diagnostic => !textDiagnostics.has(diagnostic));
}

export function validateNodeText(
  figure: TikzFigure, source: string, validator: ParseTikzOptions["nodeTextValidator"]
): Diagnostic[] {
  if (!validator) return [];
  const diagnostics: Diagnostic[] = [];
  walkStatements(figure.body, {
    onNode: node => {
      const issue = validator({ node, source });
      if (!issue) return;
      const diagnostic: Diagnostic = {
        severity: "error", code: issue.code ?? "invalid-node-tex", message: issue.message, span: node.textSpan
      };
      textDiagnostics.add(diagnostic);
      diagnostics.push(diagnostic);
    }
  });
  return diagnostics;
}
