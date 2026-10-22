import type { Span } from "../ast/types.js";
import { EMPTY_FRAGMENT, layout, tikz, type TikzFragment } from "../edit/fragment.js";
import type { BeamerDocumentModel, BeamerFrameModel } from "./types.js";

export type BeamerSlideTemplateId =
  | "title" | "title-and-bullets" | "title-only" | "two-columns" | "block" | "theorem" | "statement" | "blank";

export type BeamerSlideTemplate = { id: BeamerSlideTemplateId; name: string };

/** A new frame's text, and the placeholder in it to select once it is shown. */
export type BeamerSlideTemplateFrame = { text: TikzFragment; placeholder: Span | null };

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
type Line = TikzFragment | { text: TikzFragment; select: string };

/**
 * A frame in the deck's own conventions: the title as `\begin{frame}{…}` or
 * as `\frametitle{…}`, whichever most frames use, and the body indented as
 * most frames indent theirs.
 */
export function beamerSlideTemplateFrame(document: BeamerDocumentModel, id: BeamerSlideTemplateId): BeamerSlideTemplateFrame {
  const conventions = beamerDeckConventions(document);
  const { titleCommand } = conventions;
  const indent = layout(conventions.indent);
  const title = tikz`Slide title`;
  const titled = (...body: Line[]): Line[] => titleCommand ? [{ text: tikz`\frametitle{${title}}`, select: title }, ...body] : body;
  const lines: Line[] = {
    "title": [tikz`\titlepage`],
    "title-and-bullets": titled(tikz`\begin{itemize}`, tikz`${indent}\item First point`, tikz`${indent}\item Second point`, tikz`\end{itemize}`),
    "title-only": titled(),
    "two-columns": titled(tikz`\begin{columns}[T]`,
      tikz`${indent}\begin{column}{0.48\textwidth}`, tikz`${indent}${indent}Left column`, tikz`${indent}\end{column}`,
      tikz`${indent}\begin{column}{0.48\textwidth}`, tikz`${indent}${indent}Right column`, tikz`${indent}\end{column}`,
      tikz`\end{columns}`),
    "block": titled(tikz`\begin{block}{Block title}`, tikz`${indent}Block text`, tikz`\end{block}`),
    "theorem": titled(tikz`\begin{theorem}`, tikz`${indent}Statement of the theorem.`, tikz`\end{theorem}`),
    "statement": [tikz`\begin{center}`, { text: tikz`${indent}\Large Statement`, select: "Statement" }, tikz`\end{center}`],
    "blank": [],
  }[id];
  const header = !titleCommand && id !== "title" && id !== "statement" && id !== "blank";
  let text = tikz`\begin{frame}`;
  let placeholder: Span | null = header ? { from: text.length + 1, to: text.length + 1 + title.length } : null;
  text = tikz`${text}${header ? tikz`{${title}}` : EMPTY_FRAGMENT}${layout("\n")}`;
  for (const line of lines) {
    const content = typeof line === "string" ? line : line.text;
    if (typeof line !== "string" && !placeholder) {
      const from = text.length + indent.length + content.lastIndexOf(line.select);
      placeholder = { from, to: from + line.select.length };
    }
    text = tikz`${text}${indent}${content}${layout("\n")}`;
  }
  if (!lines.length) text = tikz`${text}${layout("\n")}`;
  return { text: tikz`${text}\end{frame}${layout("\n")}`, placeholder };
}

/** How most of the deck's frames are written: their body indentation and title form. */
export function beamerDeckConventions(document: BeamerDocumentModel): { indent: string; titleCommand: boolean } {
  const indents = new Map<string, number>();
  let argument = 0, command = 0;
  for (const frame of document.frames) {
    if (frame.title) {
      if (frame.title.span.from < frame.bodySpan.from) argument++;
      else command++;
    }
    const indent = beamerFrameBodyIndent(document.source, frame);
    if (indent !== null) indents.set(indent, (indents.get(indent) ?? 0) + 1);
  }
  const indent = [...indents].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "  ";
  return { indent, titleCommand: command > argument };
}

/** The indentation of a frame's first body line, or null when its body starts on the `\begin{frame}` line. */
export function beamerFrameBodyIndent(source: string, frame: Pick<BeamerFrameModel, "bodySpan">): string | null {
  return /^[ \t]*\n(?:[ \t]*\n)*([ \t]*)\S/u.exec(source.slice(frame.bodySpan.from, frame.bodySpan.to))?.[1] ?? null;
}
