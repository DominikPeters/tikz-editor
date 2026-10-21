import { BEAMER_TIKZ_LAYER_DEFINITION } from "./overlay-pictures.js";
import { scanBeamerDocument } from "./scan.js";
import { createBeamerSyntaxContext } from "./syntax.js";

/**
 * What the preamble needs for a first drawing: TikZ, unless a package already
 * loads it, and with `definesLayer` the `tikzlayer` definition, on the line
 * after TikZ's.
 */
export function beamerTikzLayerPreambleInsertion(source: string, definesLayer: boolean): { at: number; text: string } | null {
  const context = createBeamerSyntaxContext(source);
  const document = scanBeamerDocument(source);
  if (!document.documentSpan) return null;
  const preamble = document.preamble.span;
  let loadedAt: number | null = null;
  for (const control of context.syntax.controlsIn(preamble)) {
    if (control.name !== "usepackage" && control.name !== "RequirePackage") continue;
    const optional = context.syntax.argumentAfter(control.span.to, "optional", preamble.to);
    const names = context.syntax.argumentAfter(optional?.span.to ?? control.span.to, "required", preamble.to);
    if (names?.complete === true && source.slice(names.contentSpan.from, names.contentSpan.to)
      .split(",").some(name => name.trim() === "tikz" || name.trim() === "pgfplots" || name.trim() === "tikz-cd")) {
      loadedAt = names.span.to;
    }
  }
  const definition = definesLayer ? BEAMER_TIKZ_LAYER_DEFINITION + "\n" : "";
  if (loadedAt != null) {
    if (!definition) return null;
    const lineEnd = source.indexOf("\n", loadedAt);
    return lineEnd >= 0 && lineEnd < preamble.to
      ? { at: lineEnd + 1, text: definition }
      : { at: preamble.to, text: (source[preamble.to - 1] === "\n" ? "" : "\n") + definition };
  }
  return { at: preamble.to, text: (source[preamble.to - 1] === "\n" ? "" : "\n") + "\\usepackage{tikz}\n" + definition };
}
