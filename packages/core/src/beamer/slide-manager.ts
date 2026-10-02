import type { Span } from "../ast/types.js";
import type { SourcePatch } from "../edit/types.js";
import { analyzeBeamerSlideMove } from "./slide-move-analysis.js";
import { beamerSlideIsEditable, beamerSlideSourceSpan, beamerSlideInsertionPoint } from "./slide-source.js";
export { beamerSlideIsEditable, beamerSlideSourceSpan } from "./slide-source.js";
import { scanBeamerDocument } from "./scan.js";
import { createBeamerSyntaxContext } from "./syntax.js";
import type { BeamerDocumentModel, BeamerFrameModel } from "./types.js";

export type BeamerSlideDestination =
  | { kind: "before" | "after"; frameId: string }
  | { kind: "section"; sectionId: string; edge?: "before" | "after" }
  | { kind: "end" };
export type BeamerSlideEdit =
  | { kind: "move"; frameIds: readonly string[]; destination: BeamerSlideDestination }
  | { kind: "duplicate"; frameIds: readonly string[] }
  | { kind: "delete"; frameIds: readonly string[] }
  | { kind: "insert"; destination: BeamerSlideDestination };
export type BeamerSlideEditResult = {
  source: string;
  patches: SourcePatch[];
  /** Existing frames retain their identity even though their indexed IDs change. */
  frameIds: Partial<Record<string, string>>;
  selectedFrameIds: string[];
};

type Replacement = { span: Span; text: string };
type NamedSpan = { span: Span; name: string; kind: "target" | "citation" };

function labelSpans(document: BeamerDocumentModel): NamedSpan[] {
  const { source } = document;
  const syntax = createBeamerSyntaxContext(source).syntax;
  const result: NamedSpan[] = [];
  const add = (span: Span, kind: NamedSpan["kind"]) => {
    let from = span.from, to = span.to;
    while (/\s/u.test(source[from] ?? "") && from < to) from++;
    while (/\s/u.test(source[to - 1] ?? "") && from < to) to--;
    if (source[from] === "{" && source[to - 1] === "}") { from++; to--; }
    result.push({ span: { from, to }, name: source.slice(from, to), kind });
  };
  for (const frame of document.frames) {
    for (const option of frame.options?.entries ?? []) {
      if (option.key === "label" && option.valueSpan) add(option.valueSpan, "target");
    }
  }
  for (const command of syntax.controlsIn({ from: 0, to: source.length })) {
    if (!["label", "hypertarget", "bibitem"].includes(command.name)) continue;
    let cursor = syntax.argumentAfter(command.span.to, "overlay", source.length)?.span.to ?? command.span.to;
    if (command.name === "bibitem") cursor = syntax.argumentAfter(cursor, "optional", source.length)?.span.to ?? cursor;
    const argument = syntax.argumentAfter(cursor, "required", source.length);
    if (argument?.complete) add(argument.contentSpan, command.name === "bibitem" ? "citation" : "target");
  }
  return result;
}

function duplicateReplacements(document: BeamerDocumentModel, frames: readonly BeamerFrameModel[]): Replacement[] | null {
  const { source } = document;
  const syntax = createBeamerSyntaxContext(source).syntax;
  const labels = labelSpans(document);
  const inside = (span: Span) => frames.some(frame => frame.span.from <= span.from && span.to <= frame.span.to);
  const occupied = new Set(labels.map(label => label.name));
  const renamed = new Map<string, string>();
  const replacements: Replacement[] = [];
  for (const label of labels.filter(label => inside(label.span))) {
    // Computed label names cannot be renamed by a literal source edit.
    if (!label.name || /[\\{}%]/u.test(label.name)) return null;
    const key = `${label.kind}:${label.name}`;
    let fresh = renamed.get(key);
    if (!fresh) {
      fresh = `${label.name}-copy`;
      let suffix = 2;
      while (occupied.has(fresh)) fresh = `${label.name}-copy-${suffix++}`;
      occupied.add(fresh); renamed.set(key, fresh);
      if (label.kind === "citation") renamed.set(`target:beamerbib${label.name}`, `beamerbib${fresh}`);
    }
    replacements.push({ span: label.span, text: fresh });
  }
  for (const frame of frames) {
    for (const command of syntax.controlsIn(frame.bodySpan)) {
      if (!["ref", "pageref", "autoref", "eqref", "hyperref", "hyperlink", "againframe", "cite", "nocite"].includes(command.name)) continue;
      let cursor = syntax.argumentAfter(command.span.to, "overlay", frame.bodySpan.to)?.span.to ?? command.span.to;
      const optional = syntax.argumentAfter(cursor, "optional", frame.bodySpan.to);
      cursor = optional?.span.to ?? cursor;
      const argument = command.name === "hyperref" ? optional : syntax.argumentAfter(cursor, "required", frame.bodySpan.to);
      if (!argument?.complete) continue;
      const kind = command.name === "cite" || command.name === "nocite" ? "citation" : "target";
      const original = source.slice(argument.contentSpan.from, argument.contentSpan.to);
      const replacement = original.replace(/[^,\s]+/gu, name => {
        const alias = /^(.*)(<\d+>)$/u.exec(name);
        return renamed.get(`${kind}:${name}`) ?? (alias && renamed.has(`${kind}:${alias[1]}`) ? renamed.get(`${kind}:${alias[1]}`)! + alias[2] : name);
      });
      if (replacement !== original) replacements.push({ span: argument.contentSpan, text: replacement });
    }
  }
  return replacements;
}

export function editBeamerSlides(source: string, edit: BeamerSlideEdit, options: { allowWarnings?: boolean } = {}): BeamerSlideEditResult | null {
  const document = scanBeamerDocument(source);
  if (!document.documentSpan) return null;
  const wanted = new Set(edit.kind === "insert" ? [] : edit.frameIds);
  const frames = document.frames.filter(frame => wanted.has(frame.id));
  if (edit.kind !== "insert" && (!frames.length || frames.length !== wanted.size || frames.some(frame => !beamerSlideIsEditable(source, frame)))) return null;
  if (edit.kind === "move" && frames.length === 1 && "frameId" in edit.destination && edit.destination.frameId === frames[0].id) return null;
  const analysis = edit.kind === "move" ? analyzeBeamerSlideMove(source, edit) : null;
  if (analysis && (analysis.status === "blocked" || (analysis.status === "review" && !options.allowWarnings))) return null;
  const spans = frames.map(frame => beamerSlideSourceSpan(source, frame));
  const dependencies = analysis?.dependencies ?? [];
  let at = edit.kind === "delete" ? null : beamerSlideInsertionPoint(document, edit.kind === "duplicate"
    ? { kind: "after", frameId: frames.at(-1)!.id } : edit.destination);
  if (edit.kind !== "delete" && at == null) return null;
  const removals = edit.kind === "move" || edit.kind === "delete" ? [...spans, ...dependencies.map(item => item.span)] : [];
  if (at != null) {
    const containing = removals.find(span => span.from <= at! && at! < span.to);
    if (containing) at = containing.from;
  }
  const rename = edit.kind === "duplicate" ? duplicateReplacements(document, frames) : [];
  if (!rename) return null;
  let payload = "";
  const inserted: { oldId: string | null; offset: number }[] = [];
  if (at != null) {
    if (at > 0 && source[at - 1] !== "\n") payload += "\n";
    if (edit.kind === "insert") {
      inserted.push({ oldId: null, offset: payload.length });
      payload += "\\begin{frame}\n\n\\end{frame}\n";
    } else {
      frames.forEach((frame, i) => {
        for (const dependency of dependencies.filter(item => item.frameId === frame.id)) {
          const text = source.slice(dependency.span.from, dependency.span.to);
          payload += text + (text.endsWith("\n") ? "" : "\n");
        }
        const span = spans[i];
        let text = source.slice(span.from, span.to);
        for (const replacement of rename.filter(item => span.from <= item.span.from && item.span.to <= span.to).sort((a, b) => b.span.from - a.span.from)) {
          text = text.slice(0, replacement.span.from - span.from) + replacement.text + text.slice(replacement.span.to - span.from);
        }
        inserted.push({ oldId: frame.id, offset: payload.length + frame.span.from - span.from });
        payload += text + (text.endsWith("\n") ? "" : "\n");
      });
    }
  }
  const edits: Replacement[] = removals.map(span => ({ span, text: "" }));
  if (at != null) {
    const same = edits.find(edit => edit.span.from === at);
    if (same) same.text = payload;
    else edits.push({ span: { from: at, to: at }, text: payload });
  }
  edits.sort((a, b) => a.span.from - b.span.from);
  let delta = 0, insertedAt = 0;
  const patches: SourcePatch[] = edits.map(item => {
    const from = item.span.from + delta;
    if (item.text === payload && at === item.span.from) insertedAt = from;
    delta += item.text.length - (item.span.to - item.span.from);
    return { oldSpan: item.span, newSpan: { from, to: from + item.text.length }, replacement: item.text };
  });
  const next = [...edits].reverse().reduce((text, item) => text.slice(0, item.span.from) + item.text + text.slice(item.span.to), source);
  if (next === source) return null;
  const updated = scanBeamerDocument(next);
  if (updated.frames.length !== document.frames.length + (edit.kind === "insert" ? 1 : edit.kind === "duplicate" ? frames.length : edit.kind === "delete" ? -frames.length : 0)) return null;
  const byStart = new Map(updated.frames.map(frame => [frame.span.from, frame.id]));
  const frameIds: Record<string, string> = {};
  for (const frame of document.frames) {
    if (removals.some(span => span.from <= frame.span.from && frame.span.from < span.to)) continue;
    const shift = edits.filter(item => item.span.to <= frame.span.from).reduce((sum, item) => sum + item.text.length - (item.span.to - item.span.from), 0);
    const id = byStart.get(frame.span.from + shift);
    if (id) frameIds[frame.id] = id;
  }
  const selectedFrameIds: string[] = [];
  for (const item of inserted) {
    const id = byStart.get(insertedAt + item.offset);
    if (!id) return null;
    selectedFrameIds.push(id);
    if (edit.kind === "move" && item.oldId) frameIds[item.oldId] = id;
  }
  if (edit.kind === "delete" && updated.frames.length) selectedFrameIds.push(updated.frames[Math.min(document.frames.indexOf(frames[0]), updated.frames.length - 1)].id);
  return { source: next, patches, frameIds, selectedFrameIds };
}
