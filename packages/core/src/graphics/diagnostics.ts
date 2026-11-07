import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { analyzeSimpleTexResources, type SimpleTexGraphicsIgnoredKey } from "../text/tex/index.js";

function message(key: SimpleTexGraphicsIgnoredKey): string {
  switch (key.reason) {
    case "unknown": return key.key ? `graphicx has no \`${key.key}\` key; LaTeX stops with an error.` : `graphicx cannot read \`${key.raw}\`; LaTeX stops with an error.`;
    case "driver": return `pdfTeX and LuaTeX reject \`${key.key}\`; use viewport instead.`;
    case "invalid": return `The preview cannot read \`${key.raw.trim()}\`, so it is not applied.`;
    case "undrawn": return `The preview does not apply \`${key.key}\`.`;
  }
}

/** \includegraphics keys that change LaTeX's output but not the preview's. */
export function includeGraphicsDiagnostics(source: string, span?: Span): Diagnostic[] {
  const from = span?.from ?? 0;
  const text = span ? source.slice(span.from, span.to) : source;
  if (!text.includes("\\includegraphics")) return [];
  return analyzeSimpleTexResources(text).graphics.flatMap((graphic) => (graphic.options.ignored ?? []).map((key): Diagnostic => ({
    severity: "warning",
    code: `includegraphics-${key.reason}-key`,
    message: message(key),
    span: { from: from + key.span.from, to: from + key.span.to },
  })));
}
