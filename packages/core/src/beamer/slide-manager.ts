import { applyFragments, EMPTY_FRAGMENT, joinFragments, layout, plainNumber, sourceSlice, tikz, type TikzFragment } from "../edit/fragment.js";
import { requireDefined } from "../utils/invariants.js";
import { requireArrayValue } from "../utils/collections.js";
import type { Span } from "../ast/types.js";
import type { SourcePatch } from "../edit/types.js";
import { analyzeBeamerSlideMove } from "./slide-move-analysis.js";
import { beamerSlideIsEditable, beamerSlideSourceSpan, beamerSlideInsertionPoint } from "./slide-source.js";
import { BEAMER_TIKZ_LAYER_DEFINITION, BEAMER_TIKZ_LAYER_OPTIONS, beamerOverlayPicturesIn, beamerTikzLayerState, isBeamerTikzLayerDefinition } from "./overlay-pictures.js";
import { beamerTikzLayerPreambleInsertion } from "./tikz-layer-preamble.js";
export { beamerSlideIsEditable, beamerSlideSourceSpan } from "./slide-source.js";
import { scanBeamerDocument } from "./scan.js";
import { beamerSlideTemplateFrame, type BeamerSlideTemplateId } from "./slide-templates.js";
import { beamerEnvironmentBoundariesIn, beamerOptionalArgumentAfter, createBeamerSyntaxContext } from "./syntax.js";
import type { BeamerDocumentModel, BeamerFrameModel } from "./types.js";

export type BeamerSlideDestination =
  | { kind: "before" | "after"; frameId: string }
  | { kind: "section"; sectionId: string; edge?: "before" | "after" }
  | { kind: "end" };
export type BeamerSlideEdit =
  | { kind: "move"; frameIds: readonly string[]; destination: BeamerSlideDestination }
  | { kind: "duplicate"; frameIds: readonly string[] }
  | { kind: "delete"; frameIds: readonly string[] }
  /** A new frame laid out as the template (by default blank). */
  | { kind: "insert"; destination: BeamerSlideDestination; template?: BeamerSlideTemplateId }
  | { kind: "paste"; source: string; destination: BeamerSlideDestination };
export type BeamerSlideEditResult = {
  source: string;
  patches: SourcePatch[];
  /** Existing frames retain their identity even though their indexed IDs change. */
  frameIds: Partial<Record<string, string>>;
  selectedFrameIds: string[];
  /** The placeholder to select in a new frame, or the title it adds to the preamble. */
  placeholder?: Span;
};

type Replacement = { span: Span; text: TikzFragment };
const PRESENTATION_TITLE = tikz`Presentation title`;
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

/** The text of `span` as written, with the replacements, which lie inside it, in place. */
function rewrittenSlice(source: string, span: Span, replacements: readonly Replacement[]): TikzFragment {
  const pieces: TikzFragment[] = [];
  let cursor = span.from;
  for (const replacement of [...replacements].sort((a, b) => a.span.from - b.span.from)) {
    pieces.push(sourceSlice(source, { from: cursor, to: replacement.span.from }), replacement.text);
    cursor = replacement.span.to;
  }
  pieces.push(sourceSlice(source, { from: cursor, to: span.to }));
  return joinFragments(pieces);
}

function duplicateReplacements(document: BeamerDocumentModel, frames: readonly BeamerFrameModel[], reserved?: ReadonlySet<string>): Replacement[] | null {
  const { source } = document;
  const syntax = createBeamerSyntaxContext(source).syntax;
  const labels = labelSpans(document);
  const inside = (span: Span) => frames.some(frame => frame.span.from <= span.from && span.to <= frame.span.to);
  const occupied = new Set([...labels.map(label => label.name), ...(reserved ?? [])]);
  const renamed = new Map<string, TikzFragment>();
  const replacements: Replacement[] = [];
  for (const label of labels.filter(label => inside(label.span))) {
    // Computed label names cannot be renamed by a literal source edit.
    if (!label.name || /[\\{}%]/u.test(label.name)) return null;
    if (reserved && !reserved.has(label.name)) continue;
    const key = `${label.kind}:${label.name}`;
    let fresh = renamed.get(key);
    if (!fresh) {
      // The label as written, with the suffix that makes it a name no label has.
      const written = sourceSlice(source, label.span);
      let name = `${label.name}-copy`;
      fresh = tikz`${written}-copy`;
      let suffix = 2;
      while (occupied.has(name)) {
        name = `${label.name}-copy-${suffix}`;
        fresh = tikz`${written}-copy-${plainNumber(suffix, "label-counter")}`;
        suffix++;
      }
      occupied.add(name); renamed.set(key, fresh);
      if (label.kind === "citation") renamed.set(`target:beamerbib${label.name}`, tikz`beamerbib${fresh}`);
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
      // The argument as written, with each renamed name in place of its own.
      const renames: Replacement[] = [];
      for (const match of original.matchAll(/[^,\s]+/gu)) {
        const name = match[0], from = argument.contentSpan.from + match.index, to = from + name.length;
        const alias = /^(.*)(<\d+>)$/u.exec(name);
        const base = alias && renamed.get(`${kind}:${alias[1]}`);
        const text = renamed.get(`${kind}:${name}`) ?? (alias && base ? tikz`${base}${sourceSlice(source, { from: to - requireArrayValue(alias, 2).length, to })}` : null);
        if (!text) continue;
        renames.push({ span: { from, to }, text });
      }
      if (renames.length) replacements.push({ span: argument.contentSpan, text: rewrittenSlice(source, argument.contentSpan, renames) });
    }
  }
  return replacements;
}

/**
 * Copy authored frames as ordinary LaTeX, preserving their attached comments.
 * Frames drawn on with the editor's `tikzlayer` come with its definition.
 */
export function copyBeamerSlides(source: string, frameIds: readonly string[]): string | null {
  const document = scanBeamerDocument(source), wanted = new Set(frameIds);
  const frames = document.frames.filter(frame => wanted.has(frame.id));
  if (!frames.length || frames.length !== wanted.size || frames.some(frame => !beamerSlideIsEditable(source, frame))) return null;
  const text = frames.map(frame => {
    const span = beamerSlideSourceSpan(source, frame), text = source.slice(span.from, span.to);
    return text + (text.endsWith("\n") ? "" : "\n");
  }).join("");
  const context = createBeamerSyntaxContext(source);
  const layered = frames.some(frame => beamerOverlayPicturesIn(context, frame.span).some(picture => picture.tikzLayer));
  return layered ? BEAMER_TIKZ_LAYER_DEFINITION + "\n" + text : text;
}

/**
 * The editor's `tikzlayer` in pasted frames, where the destination does not
 * define it the same way: the definition for a deck without one, else (the
 * author's own `tikzlayer`) each layer as the plain picture it stands for.
 */
function pastedTikzLayers(source: string, origin: BeamerDocumentModel, frames: readonly BeamerFrameModel[]): { preamble: Replacement | null; replacements: Replacement[] } {
  const none = { preamble: null, replacements: [] };
  const state = beamerTikzLayerState(source);
  if (state === "ours") return none;
  const context = createBeamerSyntaxContext(origin.source);
  const layers = frames.flatMap(frame => beamerOverlayPicturesIn(context, frame.span).filter(picture => picture.tikzLayer));
  if (!layers.length) return none;
  if (state === "none") {
    const insertion = beamerTikzLayerPreambleInsertion(source, true);
    return { preamble: insertion && { span: { from: insertion.at, to: insertion.at }, text: insertion.text }, replacements: [] };
  }
  return { preamble: null, replacements: layers.flatMap(({ span }) => {
    const boundaries = beamerEnvironmentBoundariesIn(context, span);
    const begin = requireArrayValue(boundaries, 0), end = requireDefined(boundaries.at(-1), "Expected an internal slide-manager value").span;
    const options = beamerOptionalArgumentAfter(context, begin.span.to, span.to);
    const written = options ? origin.source.slice(options.contentSpan.from, options.contentSpan.to) : "";
    const from = options ? options.contentSpan.from + written.length - written.trimStart().length : 0;
    const own = options && written.trim() ? tikz`, ${sourceSlice(origin.source, { from, to: from + written.trim().length })}` : EMPTY_FRAGMENT;
    return [
      { span: { from: begin.span.from, to: options?.span.to ?? begin.span.to },
        text: tikz`\par\nointerlineskip\begin{tikzpicture}[${BEAMER_TIKZ_LAYER_OPTIONS}${own}]` },
      { span: end, text: tikz`\end{tikzpicture}` },
    ];
  }) };
}

function clipboardDocument(source: string): BeamerDocumentModel | null {
  const prefix = "\\documentclass{beamer}\n\\begin{document}\n";
  const document = scanBeamerDocument(prefix + source + "\n\\end{document}");
  if (!document.frames.length || document.frames.some(frame => !beamerSlideIsEditable(document.source, frame) ||
    frame.span.from < prefix.length || frame.span.to > prefix.length + source.length)) return null;
  // A slide paste accepts complete frame fragments, not an entire document or
  // unrelated commands whose scope would change when inserted at the destination.
  let remainder = source;
  for (const frame of [...document.frames].reverse()) remainder = remainder.slice(0, frame.span.from - prefix.length) + remainder.slice(frame.span.to - prefix.length);
  // Besides frames, only the editor's tikzlayer definition, which copying adds.
  const rest = remainder.replace(/%[^\n]*/gu, "").trim();
  if (rest && !isBeamerTikzLayerDefinition(rest)) return null;
  return document;
}

export function editBeamerSlides(source: string, edit: BeamerSlideEdit, options: { allowWarnings?: boolean } = {}): BeamerSlideEditResult | null {
  const document = scanBeamerDocument(source);
  if (!document.documentSpan) return null;
  const pasted = edit.kind === "paste" ? clipboardDocument(edit.source) : null;
  if (edit.kind === "paste" && !pasted) return null;
  const origin = pasted ?? document;
  const wanted = new Set(edit.kind === "insert" ? [] : edit.kind === "paste" ? origin.frames.map(frame => frame.id) : edit.frameIds);
  const frames = origin.frames.filter(frame => wanted.has(frame.id));
  if (edit.kind !== "insert" && (!frames.length || frames.length !== wanted.size || frames.some(frame => !beamerSlideIsEditable(origin.source, frame)))) return null;
  if (edit.kind === "move" && frames.length === 1 && "frameId" in edit.destination && edit.destination.frameId === requireArrayValue(frames, 0).id) return null;
  const analysis = edit.kind === "move" ? analyzeBeamerSlideMove(source, edit) : null;
  if (analysis && (analysis.status === "blocked" || (analysis.status === "review" && !options.allowWarnings))) return null;
  const spans = frames.map(frame => beamerSlideSourceSpan(origin.source, frame));
  const dependencies = analysis?.dependencies ?? [];
  let at = edit.kind === "delete" ? null : beamerSlideInsertionPoint(document, edit.kind === "duplicate"
    ? { kind: "after", frameId: requireDefined(frames.at(-1), "Expected an internal slide-manager value").id } : edit.destination);
  if (edit.kind !== "delete" && at == null) return null;
  const removals = edit.kind === "move" || edit.kind === "delete" ? [...spans, ...dependencies.map(item => item.span)] : [];
  if (at != null) {
    const containing = removals.find(span => span.from <= requireDefined(at, "Expected an internal slide-manager value") && requireDefined(at, "Expected an internal slide-manager value") < span.to);
    if (containing) at = containing.from;
  }
  const renamed = edit.kind === "duplicate" ? duplicateReplacements(document, frames) : edit.kind === "paste"
    ? duplicateReplacements(origin, frames, new Set(labelSpans(document).map(label => label.name))) : [];
  if (!renamed) return null;
  const layers = edit.kind === "paste" ? pastedTikzLayers(source, origin, frames) : null;
  const rename = [...renamed, ...layers?.replacements ?? []];
  let payload = EMPTY_FRAGMENT;
  const inserted: { oldId: string | null; offset: number }[] = [];
  let framePlaceholder: Span | null = null;
  if (at != null) {
    if (at > 0 && source[at - 1] !== "\n") payload = layout("\n");
    if (edit.kind === "insert") {
      const frame = beamerSlideTemplateFrame(document, edit.template ?? "blank");
      inserted.push({ oldId: null, offset: payload.length });
      if (frame.placeholder) framePlaceholder = { from: payload.length + frame.placeholder.from, to: payload.length + frame.placeholder.to };
      payload = tikz`${payload}${frame.text}`;
    } else {
      frames.forEach((frame, i) => {
        for (const dependency of dependencies.filter(item => item.frameId === frame.id)) {
          const text = sourceSlice(source, dependency.span);
          payload = tikz`${payload}${text}${layout(text.endsWith("\n") ? "" : "\n")}`;
        }
        const span = requireArrayValue(spans, i);
        // The frame as written in the deck or the clipboard, with its labels and references renamed.
        const text = rewrittenSlice(origin.source, span, rename.filter(item => span.from <= item.span.from && item.span.to <= span.to));
        inserted.push({ oldId: edit.kind === "paste" ? null : frame.id, offset: payload.length + frame.span.from - span.from });
        payload = tikz`${payload}${text}${layout(text.endsWith("\n") ? "" : "\n")}`;
      });
    }
  }
  // A title page shows the deck's title, so a deck without one gets it.
  const title = edit.kind === "insert" && edit.template === "title" && !document.preamble.metadata.title
    ? { span: { from: document.documentSpan.from, to: document.documentSpan.from }, text: tikz`${layout(document.source[document.documentSpan.from - 1] === "\n" || !document.documentSpan.from ? "" : "\n")}\title{${PRESENTATION_TITLE}}${layout("\n")}` } : null;
  const edits: Replacement[] = [...removals.map(span => ({ span, text: EMPTY_FRAGMENT })), ...layers?.preamble ? [layers.preamble] : [], ...title ? [title] : []];
  if (at != null) {
    const same = edits.find(edit => edit.span.from === at);
    if (same) same.text = payload;
    else edits.push({ span: { from: at, to: at }, text: payload });
  }
  edits.sort((a, b) => a.span.from - b.span.from);
  let delta = 0, insertedAt = 0, titleAt = 0;
  const patches: SourcePatch[] = edits.map(item => {
    const from = item.span.from + delta;
    if (item.text === payload && at === item.span.from) insertedAt = from;
    if (item === title) titleAt = from + item.text.indexOf("{") + 1;
    delta += item.text.length - (item.span.to - item.span.from);
    return { oldSpan: item.span, newSpan: { from, to: from + item.text.length }, replacement: item.text };
  });
  if (edits.some((item, i) => i > 0 && item.span.from < requireArrayValue(edits, i - 1).span.to)) return null;
  const next = applyFragments(source, edits.map(item => ({ span: item.span, fragment: item.text })));
  if (next === source) return null;
  const updated = scanBeamerDocument(next);
  if (updated.frames.length !== document.frames.length + (edit.kind === "insert" ? 1 : (edit.kind === "duplicate" || edit.kind === "paste") ? frames.length : edit.kind === "delete" ? -frames.length : 0)) return null;
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
  if (edit.kind === "delete" && updated.frames.length) selectedFrameIds.push(requireArrayValue(updated.frames, Math.min(document.frames.indexOf(requireArrayValue(frames, 0)), updated.frames.length - 1)).id);
  const placeholder = title ? { from: titleAt, to: titleAt + PRESENTATION_TITLE.length }
    : framePlaceholder && { from: insertedAt + framePlaceholder.from, to: insertedAt + framePlaceholder.to };
  return { source: next, patches, frameIds, selectedFrameIds, ...placeholder ? { placeholder } : {} };
}
