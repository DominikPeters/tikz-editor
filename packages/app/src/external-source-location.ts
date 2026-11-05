import { scanTikzFigures } from "@tikz-editor/core/parser/figure-scan";
import { formatDocumentRootId } from "@tikz-editor/core/document/root-id";
import { detectDocumentKind } from "@tikz-editor/core/document/kind";
import { scanBeamerDocument } from "@tikz-editor/core/beamer/index";

/** Resolve an external one-based source line using the same root inventory as
 * rendering. A missing/ambiguous location never selects a different figure. */
export function rootAtSourceLine(source: string, line: number | undefined): string | null {
  if (line === undefined || !Number.isSafeInteger(line) || line < 1) return null;
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = source.indexOf("\n", offset);
    if (next < 0) return null;
    offset = next + 1;
  }
  const end = source.indexOf("\n", offset);
  const lineEnd = end < 0 ? source.length : end;
  if (detectDocumentKind(source) === "beamer") {
    const candidates = scanBeamerDocument(source).frames.flatMap(frame => frame.children)
      .filter(figure => figure.beginSpan.from >= offset && figure.beginSpan.from <= lineEnd);
    return candidates.length === 1 ? candidates[0]?.id ?? null : null;
  }
  const figures = scanTikzFigures(source).filter(figure => !figure.isTemplate);
  const candidates = figures.map((figure, index) => ({ figure, index }))
    .filter(({ figure }) => figure.beginSpan.from >= offset && figure.beginSpan.from <= lineEnd);
  const candidate = candidates.length === 1 ? candidates[0] : undefined;
  return candidate ? formatDocumentRootId({ kind: "tikz-figure", index: candidate.index }) : null;
}
