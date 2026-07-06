import type { Span } from "../../ast/types.js";

export type StyleDiagnostic = {
  code: string;
  span?: Span;
};

export type StyleDiagnosticInput = string | StyleDiagnostic;

export function styleDiagnosticCode(diagnostic: StyleDiagnosticInput): string {
  return typeof diagnostic === "string" ? diagnostic : diagnostic.code;
}

export function normalizeStyleDiagnostic(
  diagnostic: StyleDiagnosticInput,
  fallbackSpan?: Span
): StyleDiagnostic {
  if (typeof diagnostic === "string") {
    return fallbackSpan ? { code: diagnostic, span: cloneSpan(fallbackSpan) } : { code: diagnostic };
  }

  const span = diagnostic.span ? cloneSpan(diagnostic.span) : fallbackSpan ? cloneSpan(fallbackSpan) : undefined;
  if (!span) {
    return { code: diagnostic.code };
  }
  return {
    code: diagnostic.code,
    span
  };
}

export function styleDiagnosticSpan(diagnostic: StyleDiagnostic, fallbackSpan: Span): Span {
  return diagnostic.span ?? fallbackSpan;
}

function cloneSpan(span: Span): Span {
  return { from: span.from, to: span.to };
}
