import { beamerDocumentParser } from "@tikz-editor/lezer-tex";
import { getTexSyntaxIndex } from "../text/tex/syntax-index.js";

/**
 * graphics.sty's `\graphicspath{{dir1/}{dir2/}}`: prefixes tried, in order,
 * after the file name as written. Each is prepended verbatim, so a prefix
 * without its trailing slash names a different file, as in LaTeX. The last
 * declaration in the document wins; it is a preamble setting in practice.
 */
export function texGraphicsPathPrefixes(source: string): string[] {
  if (!source.includes("\\graphicspath")) return [];
  const syntax = getTexSyntaxIndex(source, beamerDocumentParser);
  let prefixes: string[] = [];
  for (const control of syntax.controls) {
    if (control.name !== "graphicspath") continue;
    let cursor = control.span.to;
    for (let trivia = syntax.triviaEndByStart.get(cursor); trivia !== undefined; trivia = syntax.triviaEndByStart.get(cursor)) cursor = trivia;
    const argument = syntax.groupByStart.get(cursor);
    if (!argument?.complete) continue;
    const entries: string[] = [];
    let at = argument.contentSpan.from;
    while (at < argument.contentSpan.to) {
      const trivia = syntax.triviaEndByStart.get(at);
      if (trivia !== undefined) { at = trivia; continue; }
      const group = syntax.groupByStart.get(at);
      if (!group?.complete) break;
      entries.push(source.slice(group.contentSpan.from, group.contentSpan.to).trim());
      at = group.span.to;
    }
    prefixes = entries;
  }
  return prefixes;
}
