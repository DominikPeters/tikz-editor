import type { Span } from "../ast/types.js";
import { joinFragments, layout, sourceSlice, tikz, type TikzFragment } from "../edit/fragment.js";
import { parseOptionListRaw } from "../options/parse.js";
import type { OptionEntry } from "../options/types.js";
import type { BeamerDelimitedSourceValue } from "./types.js";
import type { BeamerStructuralEdit } from "./structural-edit.js";
import { createBeamerSyntaxContext } from "./syntax.js";

/** Replace/remove entries, keeping comments and untouched option tokens verbatim. */
export function rewriteBeamerOptions(
  source: string,
  argument: Pick<BeamerDelimitedSourceValue, "span" | "contentSpan">,
  keep: (entry: OptionEntry, index: number) => boolean,
  replacement?: { index: number; text: TikzFragment },
  append?: TikzFragment
): BeamerStructuralEdit[] {
  const entries = parseOptionListRaw(`[${source.slice(argument.contentSpan.from, argument.contentSpan.to)}]`, argument.contentSpan.from - 1).entries;
  const comments = createBeamerSyntaxContext(source).syntax.comments.filter(comment =>
    comment.from >= argument.contentSpan.from && comment.to <= argument.contentSpan.to);
  const kept = entries.map((entry, index) => keep(entry, index));
  const last = kept.lastIndexOf(true);
  if (last < 0 && append === undefined && comments.length === 0) return [{ span: argument.span, insert: tikz`` }];
  const parts: TikzFragment[] = [];
  const trivia = (span: Span, comma: boolean): void => {
    let from = span.from;
    for (let at = span.from; at < span.to; at += 1) {
      if (source[at] !== "," || comments.some(comment => comment.from <= at && at < comment.to)) continue;
      if (comma) { comma = false; continue; }
      parts.push(sourceSlice(source, { from, to: at }));
      from = at + 1;
    }
    parts.push(sourceSlice(source, { from, to: span.to }));
  };
  if (last < 0 && append !== undefined) parts.push(append);
  let cursor = argument.contentSpan.from;
  entries.forEach((entry, index) => {
    trivia({ from: cursor, to: entry.span.from }, index > 0 && kept[index - 1] === true && index <= last);
    if (kept[index]) {
      parts.push(replacement?.index === index ? replacement.text : sourceSlice(source, entry.span));
      if (replacement?.index === index) for (const comment of comments.filter(comment => entry.span.from <= comment.from && comment.to <= entry.span.to)) {
        parts.push(sourceSlice(source, comment), layout(source.includes("\r\n") ? "\r\n" : "\n"));
      }
      if (index === last && append !== undefined) parts.push(tikz`, ${append}`);
    } else {
      // A comment inside a removed value still belongs to the user's source.
      for (const comment of comments.filter(comment => entry.span.from <= comment.from && comment.to <= entry.span.to)) {
        parts.push(sourceSlice(source, comment), layout(source.includes("\r\n") ? "\r\n" : "\n"));
      }
    }
    cursor = entry.span.to;
  });
  trivia({ from: cursor, to: argument.contentSpan.to }, false);
  return [{ span: argument.contentSpan, insert: joinFragments(parts, tikz``) }];
}
