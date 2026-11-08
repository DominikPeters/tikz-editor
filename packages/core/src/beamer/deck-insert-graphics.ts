import { EMPTY_FRAGMENT, layout, plainNumber, tikz, userText, type TikzFragment } from "../edit/fragment.js";
import type { Span } from "../ast/types.js";
import type { BeamerStructuralEdit } from "./structural-edit.js";
import type { BeamerFrameLayout } from "./types.js";
import { scanBeamerDocument } from "./scan.js";

/**
 * Where an inserted image goes on the rendered frame: at a text caret, as
 * its own centred paragraph after a selected object, or at the end of the
 * frame body.
 */
export type BeamerGraphicsPlacement =
  | { readonly kind: "caret"; readonly offset: number }
  | { readonly kind: "after"; readonly span: Span }
  | { readonly kind: "end" };

/** A path `\includegraphics` reads literally. */
export function isLiteralGraphicsPath(path: string): boolean {
  return path.trim() !== "" && !/[\\{}%#$^&~\r\n]/u.test(path);
}

/**
 * `\includegraphics[width=<fraction>\linewidth]{path}` placed on the frame.
 * `widthFraction` null keeps the image's natural size.
 */
export function beamerGraphicsInsertionEdits(
  source: string,
  frameLayout: BeamerFrameLayout,
  path: string,
  widthFraction: number | null,
  placement: BeamerGraphicsPlacement,
): { edits: BeamerStructuralEdit[] } | { reason: string } {
  if (!isLiteralGraphicsPath(path)) return { reason: "The image path cannot be written literally in TeX." };
  const frame = scanBeamerDocument(source).frames.find((candidate) => candidate.id === frameLayout.frameId);
  if (!frame?.endSpan) return { reason: "The frame was not found." };
  const body = frame.bodySpan;
  const options = widthFraction === null ? EMPTY_FRAGMENT : tikz`[width=${plainNumber(widthFraction, "beamer-length")}\linewidth]`;
  const command = tikz`\includegraphics${options}{${userText(path, "inspector-value")}}`;

  if (placement.kind === "caret") {
    const offset = placement.offset;
    const editable = frameLayout.paragraphs.some((paragraph) => (paragraph.role === "body" || paragraph.role === "block-body")
      && paragraph.visibility !== "hidden"
      && paragraph.editableTextSpans.some(({ kind, span }) => kind === "text" && span.from <= offset && offset <= span.to));
    if (!editable || offset < body.from || offset > body.to) return { reason: "Images go in the text of the frame." };
    // Keep words apart: TeX would otherwise join them to the image.
    const before = offset > 0 && /\S/u.test(source[offset - 1] ?? "") && source[offset - 1] !== "{" ? " " : "";
    const after = /\S/u.test(source[offset] ?? "") && source[offset] !== "}" ? " " : "";
    return { edits: [{ span: { from: offset, to: offset }, insert: tikz`${layout(before)}${command}${layout(after)}` }] };
  }

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
  const empty = at === body.from;
  const lead = newline;
  const tail = empty && source[body.from] !== "\n" && source[body.from] !== "\r" ? newline : "";
  const block: TikzFragment = tikz`${layout(lead + indent)}\begin{center}${layout(`${newline}${indent}  `)}${command}${layout(newline + indent)}\end{center}${layout(tail)}`;
  return { edits: [{ span: { from: at, to: at }, insert: block }] };
}
