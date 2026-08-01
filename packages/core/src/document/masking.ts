import type { Span } from "../ast/types.js";

/**
 * Replaces every character outside `span` with a space, preserving
 * newlines so all offsets and line/column positions survive. This is the
 * addressing backbone of nested TikZ figure editing
 * (design/beamer-canvas-editing.md): the TikZ pipeline runs over the
 * masked document at full length, so every span it produces is an
 * absolute offset into the real source.
 */
export function maskSourceOutsideSpan(source: string, span: Span): string {
  const blank = (text: string): string => text.replace(/[^\n]/gu, " ");
  return (
    blank(source.slice(0, span.from)) +
    source.slice(span.from, span.to) +
    blank(source.slice(span.to))
  );
}
