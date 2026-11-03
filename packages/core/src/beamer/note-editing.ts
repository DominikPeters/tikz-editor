import { applyFragments, EMPTY_FRAGMENT, layout, tikz, userText, type EditedSource, type FragmentEdit, type TikzFragment } from "../edit/fragment.js";
import type { Span } from "../ast/types.js";
import type { SourcePatch } from "../edit/types.js";
import { computeMinimalReplacementPatch } from "../edit/patch.js";
import { scanBeamerDocument } from "./scan.js";
import { scanBeamerNoteCommands } from "./notes.js";
import { beamerDeckConventions, beamerFrameBodyIndent } from "./slide-templates.js";

/**
 * A speaker note of a frame, as written: `\note` inside the frame adds to
 * the note page after each of its builds (or those its overlay
 * specification names); `\note` between the frame and the next one is a
 * note page of its own, which a second screen shows with the last build.
 */
export type BeamerFrameNote = {
  placement: "frame" | "after";
  /** The overlay specification inside its angle brackets; empty when none. */
  overlay: string;
  /** `item` inside a frame; `itemize` or `enumerate` after one. */
  option: string;
  span: Span;
  bodySpan: Span;
  text: string;
  /** Whether the note has its braced text: an unfinished `\note` has none. */
  editable: boolean;
};

/** The notes of a frame, inside it and then after it, in source order; null when there is no such frame. */
export function beamerFrameNotes(source: string, frameId: string): BeamerFrameNote[] | null {
  const document = scanBeamerDocument(source);
  const index = document.frames.findIndex(frame => frame.id === frameId);
  const frame = document.frames[index];
  if (!frame) return null;
  const nextFrom = document.frames[index + 1]?.span.from ?? document.documentBodySpan.to;
  return scanBeamerNoteCommands(source).flatMap(note => {
    if (note.kind !== "note") return [];
    const placement = note.span.from >= frame.bodySpan.from && note.span.to <= frame.bodySpan.to ? "frame"
      : note.span.from >= frame.span.to && note.span.from < nextFrom ? "after" : null;
    if (!placement) return [];
    const editable = source[note.bodySpan.from - 1] === "{" && source[note.bodySpan.to] === "}";
    return [{ placement, overlay: note.overlay, option: note.option, span: note.span, bodySpan: note.bodySpan, text: note.text, editable }];
  });
}

export type BeamerNoteBodyProblem =
  /** A `}` closes the note early, or a `{` leaves it open. */
  | "unbalanced"
  /** A comment on the last line would hide the note's closing brace. */
  | "open-comment"
  /** A final backslash would escape the closing brace. */
  | "open-escape"
  /** Beamer ends a frame at the first `\end{frame}`, even inside a note. */
  | "frame-boundary";

/**
 * Whether a text can be a note's braced argument: braces balance (escaped
 * ones aside, and those in comments), the closing brace stays outside any
 * comment or control symbol, and no frame boundary ends the frame early.
 * `comment` reports a `%`, whose line TeX does not read.
 */
export function checkBeamerNoteBody(text: string): { problem: BeamerNoteBodyProblem | null; comment: boolean } {
  let depth = 0, comment = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") {
      if (index + 1 === text.length) return { problem: "open-escape", comment };
      index++;
    } else if (char === "%") {
      comment = true;
      const end = text.indexOf("\n", index);
      if (end < 0) return { problem: "open-comment", comment };
      index = end;
    } else if (char === "{") {
      depth++;
    } else if (char === "}" && --depth < 0) {
      return { problem: "unbalanced", comment };
    }
  }
  if (depth) return { problem: "unbalanced", comment };
  if (/\\(?:begin|end)[ \t]*\{frame\}/u.test(text)) return { problem: "frame-boundary", comment };
  return { problem: null, comment };
}

export type BeamerNoteEdit =
  /** Sets the text of the frame's note at that index; with no notes yet, index 0 writes the frame's first. */
  | { kind: "set"; frameId: string; index: number; text: string }
  | { kind: "remove"; frameId: string; index: number };

/**
 * Edits a frame's note. A new note goes at the end of the frame, without
 * an overlay specification, so that it shows with every build and moves
 * with the frame. Null when the frame or note is missing, or when the
 * text cannot be a note's argument (checkBeamerNoteBody).
 */
export function editBeamerFrameNote(source: string, edit: BeamerNoteEdit): { source: EditedSource; patch: SourcePatch } | null {
  const notes = beamerFrameNotes(source, edit.frameId);
  if (!notes) return null;
  const note = notes[edit.index];
  let change: FragmentEdit;
  if (edit.kind === "remove") {
    if (!note) return null;
    const lineFrom = source.lastIndexOf("\n", note.span.from - 1) + 1;
    const lineEnd = source.indexOf("\n", note.span.to);
    const lineTo = lineEnd < 0 ? source.length : lineEnd + 1;
    const alone = !source.slice(lineFrom, note.span.from).trim() && !source.slice(note.span.to, lineTo).trim();
    change = { span: alone ? { from: lineFrom, to: lineTo } : note.span, fragment: EMPTY_FRAGMENT };
  } else {
    if (checkBeamerNoteBody(edit.text).problem) return null;
    const text = userText(edit.text, "beamer-text");
    if (note) {
      if (!note.editable) return null;
      change = { span: note.bodySpan, fragment: text };
    } else {
      if (edit.index !== 0 || notes.length) return null;
      const added = newNote(source, edit.frameId, text);
      if (!added) return null;
      change = added;
    }
  }
  const edited = applyFragments(source, [change]);
  if (edited === source) return null;
  return { source: edited, patch: computeMinimalReplacementPatch(source, edited) };
}

/** The note on a line of its own before `\end{frame}`, indented as the frame's body; or, in a one-line frame, before `\end{frame}`. */
function newNote(source: string, frameId: string, text: TikzFragment): FragmentEdit | null {
  const document = scanBeamerDocument(source);
  const frame = document.frames.find(candidate => candidate.id === frameId);
  if (!frame) return null;
  const end = frame.bodySpan.to;
  const lineFrom = source.lastIndexOf("\n", end - 1) + 1;
  const note = tikz`\note{${text}}`;
  if (lineFrom <= frame.bodySpan.from || source.slice(lineFrom, end).trim()) return { span: { from: end, to: end }, fragment: note };
  const indent = layout(beamerFrameBodyIndent(source, frame) ?? beamerDeckConventions(document).indent);
  return { span: { from: lineFrom, to: lineFrom }, fragment: tikz`${indent}${note}${layout("\n")}` };
}
