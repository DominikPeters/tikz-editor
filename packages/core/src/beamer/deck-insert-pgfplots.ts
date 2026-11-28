import { layout, tikz, userText, type TikzFragment } from "../edit/fragment.js";
import { PGFPLOTS_TEMPLATES, pgfplotsPreambleInsertions, type PgfplotsTemplateKind } from "../edit/pgfplots/templates.js";
import type { BeamerGraphicsPlacement } from "./deck-insert-graphics.js";
import { scanBeamerDocument } from "./scan.js";
import type { BeamerStructuralEdit } from "./structural-edit.js";
import type { BeamerFrameLayout } from "./types.js";

/**
 * Insert → Function Plot / Data Plot / Bar Chart on a slide: a centred
 * `tikzpicture` holding the template's axis, sized to the slide's text
 * (`width=0.8\linewidth, height=0.6\textheight`), after the selected object or
 * at the end of the frame body (a text caret puts it at the end too: an axis
 * is a figure, not a word). The preamble gains `\usepackage{pgfplots}` and
 * `\pgfplotsset{compat=1.18}` when it has none.
 */
export function beamerPgfplotsInsertionEdits(
  source: string,
  frameLayout: BeamerFrameLayout,
  template: PgfplotsTemplateKind,
  placement: BeamerGraphicsPlacement,
): { edits: BeamerStructuralEdit[] } | { reason: string } {
  const frame = scanBeamerDocument(source).frames.find((candidate) => candidate.id === frameLayout.frameId);
  if (!frame?.endSpan) return { reason: "The frame was not found." };
  const body = frame.bodySpan;
  let at: number;
  if (placement.kind === "after") {
    if (placement.span.from < body.from || placement.span.to > body.to) return { reason: "The object is not on this frame." };
    at = placement.span.to;
  } else {
    at = body.to;
    while (at > body.from && /\s/u.test(source[at - 1] ?? "")) at--;
  }
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  const indent = at > body.from ? /^[ \t]*/u.exec(source.slice(lineStart, at))?.[0] ?? "" : "";
  const axis = PGFPLOTS_TEMPLATES[template].text
    .replace("\\begin{axis}[", "\\begin{axis}[width=0.8\\linewidth, height=0.6\\textheight, ")
    .replace(/\n/gu, `${newline}${indent}    `);
  const tail = at === body.from && source[body.from] !== "\n" && source[body.from] !== "\r" ? newline : "";
  const block: TikzFragment = userText(`${newline}${indent}\\begin{center}${newline}${indent}  \\begin{tikzpicture}${newline}${indent}    ${axis}${newline}${indent}  \\end{tikzpicture}${newline}${indent}\\end{center}`, "pasted-tikz");
  const edits: BeamerStructuralEdit[] = pgfplotsPreambleInsertions(source).map((insertion) => ({
    span: { from: insertion.at, to: insertion.at }, insert: insertion.text,
  }));
  edits.push({ span: { from: at, to: at }, insert: tikz`${block}${layout(tail)}` });
  return { edits };
}
