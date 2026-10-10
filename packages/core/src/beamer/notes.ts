import type { Span } from "../ast/types.js";
import { concatMappedText, sliceMappedText, type MappedText } from "../text/source-map.js";
import type { TexSyntaxIndex } from "../text/tex/syntax-index.js";
import { beamerSyntaxContext } from "./syntax.js";
import { beamerOverlaySpecContains, resolveBeamerOverlaySpanVisibility, type BeamerOverlayModel } from "./overlay.js";
import type { BeamerDocumentModel } from "./types.js";

export type BeamerNoteCommand = {
  kind: "note" | "AtBeginNote" | "AtEndNote";
  span: Span;
  bodySpan: Span;
  text: string;
  option: string;
};

/** Literal standard Beamer notes, including both orders of [] and <>. */
export function scanBeamerNoteCommands(source: string, syntax?: TexSyntaxIndex): BeamerNoteCommand[] {
  const context = beamerSyntaxContext(source, syntax);
  const result: BeamerNoteCommand[] = [];
  let consumed = -1;
  for (const command of context.syntax.controls) {
    if (command.span.from < consumed || !["note", "AtBeginNote", "AtEndNote"].includes(command.name)) continue;
    const limit = source.length;
    const overlay = context.syntax.argumentAfter(command.span.to, "overlay", limit);
    const optional = context.syntax.argumentAfter(overlay?.span.to ?? command.span.to, "optional", limit);
    const trailingOverlay = !overlay && optional ? context.syntax.argumentAfter(optional.span.to, "overlay", limit) : null;
    const start = trailingOverlay?.span.to ?? optional?.span.to ?? overlay?.span.to ?? command.span.to;
    const body = context.syntax.argumentAfter(start, "required", limit);
    // An unfinished note is private too. Never expose its partial body on a slide.
    consumed = body?.span.to ?? start;
    result.push({ kind: command.name as BeamerNoteCommand["kind"],
      span: { from: command.span.from, to: consumed },
      bodySpan: body?.contentSpan ?? { from: start, to: start },
      text: body ? source.slice(body.contentSpan.from, body.contentSpan.to) : "",
      option: optional ? source.slice(optional.contentSpan.from, optional.contentSpan.to).trim() : "" });
  }
  return result;
}

/** Note text never participates in audience layout, even for show-notes source options. */
export function projectBeamerSpeakerNotes(mapped: MappedText): MappedText {
  const notes = scanBeamerNoteCommands(mapped.text);
  if (!notes.length) return mapped;
  const parts: MappedText[] = [];
  let cursor = 0;
  for (const note of notes) {
    parts.push(sliceMappedText(mapped, cursor, note.span.from));
    cursor = note.span.to;
  }
  parts.push(sliceMappedText(mapped, cursor, mapped.text.length));
  return concatMappedText(parts);
}

/**
 * beamerbasenotes.sty: in-frame text accumulates; [item] entries follow it
 * in an enumerate list. On second-screen output the last outside note
 * following the final build replaces that build's in-frame note page.
 */
export function beamerSpeakerNotes(document: BeamerDocumentModel, commands: readonly BeamerNoteCommand[], frameIndex: number, step: number, overlays: BeamerOverlayModel): string {
  const frame = document.frames[frameIndex];
  if (!frame) return "";
  const nextFrameStart = document.frames[frameIndex + 1]?.span.from ?? document.source.length;
  const inside = commands.filter(note => note.kind === "note" && note.span.from >= frame.bodySpan.from && note.span.to <= frame.bodySpan.to &&
    resolveBeamerOverlaySpanVisibility(overlays, note.span, step) !== "removed" &&
    (!overlays.referenceSpecs.some(ref => ref.sourceStart === note.span.from) ||
      overlays.referenceSpecs.some(ref => ref.sourceStart === note.span.from && beamerOverlaySpecContains(ref.spec, step))));
  const outside = step === overlays.stepCount ? commands.filter(note => note.kind === "note" && note.span.from >= frame.span.to && note.span.from < nextFrameStart).at(-1) : undefined;
  const selected = outside ? [outside] : inside;
  if (!selected.length) return "";
  const before = commands.filter(note => note.kind === "AtBeginNote" && note.span.from < selected.at(-1)!.span.from).at(-1)?.text ?? "";
  const after = commands.filter(note => note.kind === "AtEndNote" && note.span.from < selected.at(-1)!.span.from).at(-1)?.text ?? "";
  const prose = selected.filter(note => note.option !== "item").map(note => {
    const environment = outside && ["enumerate", "itemize"].includes(note.option) ? note.option : null;
    return environment ? `\\begin{${environment}}${note.text}\\end{${environment}}` : note.text;
  }).join("");
  const items = selected.filter(note => note.option === "item").map(note => `\\item ${note.text}`).join("\n");
  return [before, prose, items ? `\\begin{enumerate}${items}\\end{enumerate}` : "", after].filter(Boolean).join("");
}
