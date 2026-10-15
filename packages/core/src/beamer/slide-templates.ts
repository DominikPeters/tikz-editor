import type { Span } from "../ast/types.js";
import type { BeamerDocumentModel } from "./types.js";

export type BeamerSlideTemplateId =
  | "title" | "title-and-bullets" | "title-only" | "two-columns" | "block" | "theorem" | "statement" | "blank";

export type BeamerSlideTemplate = { id: BeamerSlideTemplateId; name: string };

/** A new frame's text, and the placeholder in it to select once it is shown. */
export type BeamerSlideTemplateFrame = { text: string; placeholder: Span | null };

export const BEAMER_SLIDE_TEMPLATES: readonly BeamerSlideTemplate[] = [
  { id: "title", name: "Title" },
  { id: "title-and-bullets", name: "Title & Bullets" },
  { id: "title-only", name: "Title Only" },
  { id: "two-columns", name: "Two Columns" },
  { id: "block", name: "Block" },
  { id: "theorem", name: "Theorem" },
  { id: "statement", name: "Statement" },
  { id: "blank", name: "Blank" },
];

/** The layouts a deck offers: a theorem only where the class defines one. */
export function beamerSlideTemplates(document: BeamerDocumentModel): BeamerSlideTemplate[] {
  const theorem = document.preamble.theoremDeclarations.some(declaration => declaration.name === "theorem");
  return BEAMER_SLIDE_TEMPLATES.filter(template => template.id !== "theorem" || theorem);
}

// A body line, or one holding the placeholder to select.
type Line = string | { text: string; select: string };

/**
 * A frame in the deck's own conventions: the title as `\begin{frame}{…}` or
 * as `\frametitle{…}`, whichever most frames use, and the body indented as
 * most frames indent theirs.
 */
export function beamerSlideTemplateFrame(document: BeamerDocumentModel, id: BeamerSlideTemplateId): BeamerSlideTemplateFrame {
  const { indent, titleCommand } = deckConventions(document);
  const title = "Slide title";
  const titled = (...body: Line[]): Line[] => titleCommand ? [{ text: `\\frametitle{${title}}`, select: title }, ...body] : body;
  const lines: Line[] = {
    "title": ["\\titlepage"],
    "title-and-bullets": titled("\\begin{itemize}", `${indent}\\item First point`, `${indent}\\item Second point`, "\\end{itemize}"),
    "title-only": titled(),
    "two-columns": titled("\\begin{columns}[T]",
      `${indent}\\begin{column}{0.48\\textwidth}`, `${indent}${indent}Left column`, `${indent}\\end{column}`,
      `${indent}\\begin{column}{0.48\\textwidth}`, `${indent}${indent}Right column`, `${indent}\\end{column}`,
      "\\end{columns}"),
    "block": titled("\\begin{block}{Block title}", `${indent}Block text`, "\\end{block}"),
    "theorem": titled("\\begin{theorem}", `${indent}Statement of the theorem.`, "\\end{theorem}"),
    "statement": ["\\begin{center}", { text: `${indent}\\Large Statement`, select: "Statement" }, "\\end{center}"],
    "blank": [],
  }[id];
  const header = !titleCommand && id !== "title" && id !== "statement" && id !== "blank";
  let text = "\\begin{frame}";
  let placeholder: Span | null = header ? { from: text.length + 1, to: text.length + 1 + title.length } : null;
  text += (header ? `{${title}}` : "") + "\n";
  for (const line of lines) {
    const content = typeof line === "string" ? line : line.text;
    if (typeof line !== "string" && !placeholder) {
      const from = text.length + indent.length + content.lastIndexOf(line.select);
      placeholder = { from, to: from + line.select.length };
    }
    text += `${indent}${content}\n`;
  }
  if (!lines.length) text += "\n";
  return { text: text + "\\end{frame}\n", placeholder };
}

function deckConventions(document: BeamerDocumentModel): { indent: string; titleCommand: boolean } {
  const indents = new Map<string, number>();
  let argument = 0, command = 0;
  for (const frame of document.frames) {
    const body = document.source.slice(frame.bodySpan.from, frame.bodySpan.to);
    if (frame.title) {
      if (frame.title.span.from < frame.bodySpan.from) argument++;
      else command++;
    }
    const line = /^[ \t]*\n(?:[ \t]*\n)*([ \t]*)\S/u.exec(body);
    if (line?.[1] !== undefined) indents.set(line[1], (indents.get(line[1]) ?? 0) + 1);
  }
  const indent = [...indents].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "  ";
  return { indent, titleCommand: command > argument };
}
