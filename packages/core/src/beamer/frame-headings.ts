import { createBeamerSyntaxContext } from "./syntax.js";
import type { BeamerDelimitedSourceValue } from "./types.js";

/** \ifblank tests tokens after TeX has discarded source comments. */
export function isBlankBeamerFrameHeading(
  source: string,
  value: BeamerDelimitedSourceValue
): boolean {
  if (value.value.trim() === "") return true;
  if (!value.value.includes("%")) return false;
  const comments = createBeamerSyntaxContext(source).syntax.comments;
  let cursor = value.contentSpan.from;
  let visible = "";
  for (const comment of comments) {
    if (comment.to <= cursor || comment.from >= value.contentSpan.to) continue;
    visible += source.slice(cursor, Math.max(cursor, comment.from));
    cursor = Math.min(value.contentSpan.to, comment.to);
  }
  visible += source.slice(cursor, value.contentSpan.to);
  return visible.trim() === "";
}
