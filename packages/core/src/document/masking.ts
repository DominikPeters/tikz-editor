import type { Span } from "../ast/types.js";
import { collectContextDefinitions } from "../transform/cst-to-ast.js";

function blankSource(source: string): string {
  // Parser spans address UTF-16 code units; keep both halves of astral symbols.
  return source.replace(/[^\n]/g, " ");
}

/**
 * Replaces every character outside `span` with a space, preserving
 * newlines so all offsets and line/column positions survive. This is the
 * addressing backbone of nested TikZ figure editing
 * (design/beamer-canvas-editing.md): the TikZ pipeline runs over the
 * masked document at full length, so every span it produces is an
 * absolute offset into the real source.
 */
export function maskSourceOutsideSpan(source: string, span: Span): string {
  return (
    blankSource(source.slice(0, span.from)) +
    source.slice(span.from, span.to) +
    blankSource(source.slice(span.to))
  );
}

let pictureContext: { prefix: string; masked: string } | null = null;

/** One editable picture plus the definitions visible before it, at their absolute spans. */
export function maskTikzPictureSource(source: string, span: Span): string {
  const prefix = source.slice(0, span.from);
  if (pictureContext?.prefix !== prefix) {
    // The parser already handles TeX group lifetimes, including definitions
    // inside previous pictures/frames. Flatten only the surviving declarations.
    const definitions = collectContextDefinitions(prefix);
    const parts: string[] = [];
    let cursor = 0;
    for (const definition of definitions) {
      if (definition.span.from < cursor) continue;
      parts.push(blankSource(prefix.slice(cursor, definition.span.from)),
        prefix.slice(definition.span.from, definition.span.to));
      cursor = definition.span.to;
    }
    parts.push(blankSource(prefix.slice(cursor)));
    pictureContext = { prefix, masked: parts.join("") };
  }
  return pictureContext.masked + source.slice(span.from, span.to) + blankSource(source.slice(span.to));
}
