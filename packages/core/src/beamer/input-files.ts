import type { Span } from "../ast/types.js";
import { requireArrayValue } from "../utils/collections.js";
import { svgRect } from "../coords/index.js";
import { collectMacroBindings } from "../macros/bindings.js";
import { collectContextDefinitions } from "../transform/cst-to-ast.js";
import {
  concatMappedText, createGeneratedMappedText, createIdentityMappedText, projectInputRange, type MappedText,
} from "../text/source-map.js";
import type { TexSyntaxIndex } from "../text/tex/syntax-index.js";
import { expandBeamerLocalMacros } from "./local-macros.js";
import type { BeamerProjectFiles } from "./project-files.js";
import type { BeamerDocumentModel, BeamerFrameLayout } from "./types.js";
import type { MacroBinding } from "../macros/types.js";

/**
 * Text TeX would read from other places than the document's own source
 * position: `\input` and `\include` files, and user macros that expand to a
 * column. The preamble reads them as one stream (the effective preamble,
 * below). Frame bodies keep the document's offsets unchanged: the text sits
 * after the end of the source, in a virtual tail, and the frame parser
 * splices it in where the use is. Everything beyond the source's length is
 * therefore not the document's text: layout results point such objects at the
 * use instead (`rehomeBeamerVirtualSpans`), so that no edit lands in an
 * included file.
 */
export type BeamerVirtualSegment = {
  readonly kind: "input" | "macro";
  /** The use, in the document or in an earlier segment's text. */
  readonly invocation: Span;
  /** Where the text sits: past the end of the document's source. */
  readonly span: Span;
  /** The project file (`input`), or the macro's control sequence (`macro`). */
  readonly name: string;
};

export type BeamerVirtualSource = {
  /** The document's source followed by the segments' text. */
  readonly source: string;
  readonly mainLength: number;
  readonly segments: readonly BeamerVirtualSegment[];
};

const INPUT_DEPTH = 4;
const INPUT_PATTERN = /\\(?:input|include)\s*\{\s*([^{}\s][^{}]*?)\s*\}/gu;

/** Names TeX tries for `\input{name}` and `\include{name}`: with `.tex` first. */
export function beamerInputFileCandidates(name: string): string[] {
  const trimmed = name.trim();
  if (trimmed === "" || /[\\{}$#%^&~]/u.test(trimmed)) return [];
  return /\.tex$/iu.test(trimmed) ? [trimmed] : [`${trimmed}.tex`, trimmed];
}

/** `\input{name}` and `\include{name}` uses in a span of text, outside comments. */
export function findBeamerInputUses(text: string, from = 0, to = text.length): { span: Span; name: string }[] {
  const uses: { span: Span; name: string }[] = [];
  for (const match of text.slice(from, to).matchAll(INPUT_PATTERN)) {
    const start = from + match.index;
    if (inLineComment(text, start)) continue;
    uses.push({ span: { from: start, to: start + match[0].length }, name: match[1] ?? "" });
  }
  return uses;
}

function inLineComment(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  for (let cursor = lineStart; cursor < index; cursor += 1) {
    const char = text[cursor];
    if (char === "\\") { cursor += 1; continue; }
    if (char === "%") return true;
  }
  return false;
}

/** The file's text under the first candidate name the project has. */
export function readBeamerInputFile(files: BeamerProjectFiles | undefined, name: string): { file: string; text: string } | null {
  if (!files) return null;
  for (const candidate of beamerInputFileCandidates(name)) {
    const text = files.readText(candidate);
    if (text !== null) return { file: candidate, text };
  }
  return null;
}

const virtualSegmentsBySyntax = new WeakMap<TexSyntaxIndex, BeamerVirtualSource>();

export function registerBeamerVirtualSource(syntax: TexSyntaxIndex, virtual: BeamerVirtualSource): void {
  virtualSegmentsBySyntax.set(syntax, virtual);
}

export function beamerVirtualSource(syntax: TexSyntaxIndex): BeamerVirtualSource | undefined {
  return virtualSegmentsBySyntax.get(syntax);
}

const COLUMN_MACRO_BODY = /^\s*\\begin\s*\{column\}[\s\S]*\\end\s*\{column\}\s*$/u;

/** Argument-free macros whose body is one complete `column` environment, by control sequence. */
export function beamerColumnMacros(bindings: ReadonlyMap<string, MacroBinding>): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const [name, binding] of bindings) {
    const body = binding.kind === "text" ? binding.value : binding.parameterCount === 0 ? binding.body : null;
    if (body === null || !COLUMN_MACRO_BODY.test(body)) continue;
    if ((body.match(/\\begin\s*\{column\}/gu)?.length ?? 0) !== 1 || (body.match(/\\end\s*\{column\}/gu)?.length ?? 0) !== 1) continue;
    result.set(name, body.trim());
  }
  return result;
}

/**
 * The document's source followed by the text of the `\input` files and
 * column macros its frame bodies use, or null when there are none.
 */
export function buildBeamerVirtualSource(
  source: string,
  document: BeamerDocumentModel,
  files: BeamerProjectFiles | undefined,
  columnMacros: ReadonlyMap<string, string>
): BeamerVirtualSource | null {
  if (!files && columnMacros.size === 0) return null;
  const segments: BeamerVirtualSegment[] = [];
  let virtual = source;
  const regions: { span: Span; depth: number }[] = document.frames.map(frame => ({ span: frame.bodySpan, depth: 0 }));
  const macroPattern = columnMacros.size
    ? new RegExp(String.raw`\\(${[...columnMacros.keys()].map(name => name.slice(1).replace(/[.*+?^${}()|[\]\\@]/gu, "\\$&")).join("|")})(?![A-Za-z@])`, "gu")
    : null;
  for (let index = 0; index < regions.length; index += 1) {
    const { span, depth } = requireArrayValue(regions, index);
    const uses: { span: Span; kind: "input" | "macro"; name: string; text: string }[] = [];
    for (const use of findBeamerInputUses(virtual, span.from, span.to)) {
      const file = depth < INPUT_DEPTH ? readBeamerInputFile(files, use.name) : null;
      if (file) uses.push({ span: use.span, kind: "input", name: file.file, text: file.text });
    }
    if (macroPattern) {
      for (const match of virtual.slice(span.from, span.to).matchAll(macroPattern)) {
        const start = span.from + match.index;
        const name = `\\${match[1]}`;
        if (inLineComment(virtual, start)) continue;
        uses.push({ span: { from: start, to: start + match[0].length }, kind: "macro", name, text: columnMacros.get(name) ?? "" });
      }
    }
    for (const use of uses) {
      // Each text starts on its own line, so that a trailing comment cannot reach the next.
      const from = virtual.length + 1;
      virtual += `\n${use.text}\n`;
      const segment: BeamerVirtualSegment = { kind: use.kind, invocation: use.span, span: { from, to: from + use.text.length }, name: use.name };
      segments.push(segment);
      if (use.kind === "input") regions.push({ span: segment.span, depth: depth + 1 });
    }
  }
  if (segments.length === 0) return null;
  return { source: virtual, mainLength: source.length, segments };
}

/** The use in the document that a span in the virtual tail comes from. */
export function beamerVirtualRoot(virtual: BeamerVirtualSource, span: Span): Span {
  let current = span;
  for (let guard = 0; guard <= INPUT_DEPTH + 1 && current.from >= virtual.mainLength; guard += 1) {
    const segment = virtual.segments.find(candidate => candidate.span.from <= current.from && current.from <= candidate.span.to);
    if (!segment) break;
    current = segment.invocation;
  }
  return current;
}

/**
 * Uses that sit directly in a span's own flow (not inside an environment or
 * group within it), in order. A use inside text stays text for the text
 * engine.
 */
export function directBeamerVirtualUses(
  syntax: TexSyntaxIndex,
  span: Span,
  kind: BeamerVirtualSegment["kind"]
): BeamerVirtualSegment[] {
  const virtual = virtualSegmentsBySyntax.get(syntax);
  if (!virtual) return [];
  return virtual.segments.filter(segment => segment.kind === kind && segment.invocation.from >= span.from && segment.invocation.to <= span.to
    && isDirect(syntax, segment.invocation.from, span)).sort((a, b) => a.invocation.from - b.invocation.from);
}

function isDirect(syntax: TexSyntaxIndex, offset: number, span: Span): boolean {
  let node = syntax.tree.resolveInner(offset + 1, 1);
  while (node.parent) {
    node = node.parent;
    if (node.from < span.from) break;
    if ((node.name === "Environment" || node.name === "Group") && node.from < offset && node.to > offset) return false;
  }
  return true;
}

/** Layout items and spans that came from a virtual tail, pointed at their use. */
export function rehomeBeamerVirtualSpans<T extends { layout: BeamerFrameLayout }>(result: T, virtual: BeamerVirtualSource | undefined): T {
  if (!virtual) return result;
  const home = (span: Span): Span => span.from >= virtual.mainLength ? beamerVirtualRoot(virtual, span) : span;
  const away = (span: Span): boolean => span.from >= virtual.mainLength;
  const { layout } = result;
  for (const item of layout.items) if (away(item.sourceSpan)) item.sourceSpan = home(item.sourceSpan);
  for (const paragraph of layout.paragraphs) {
    if (away(paragraph.sourceSpan)) {
      const root = home(paragraph.sourceSpan);
      paragraph.sourceSpan = root;
      paragraph.atomicRenderSpans = [...paragraph.atomicRenderSpans.filter(atom => !away(atom.span)),
        { id: `${paragraph.paragraphId}:input`, span: root, hitBounds: [svgRect(paragraph.bounds.x, paragraph.bounds.y, paragraph.bounds.width, paragraph.bounds.height)] }];
      paragraph.editableTextSpans = [];
      delete paragraph.listStructure;
    } else {
      paragraph.editableTextSpans = paragraph.editableTextSpans.filter(entry => !away(entry.span));
      paragraph.atomicRenderSpans = paragraph.atomicRenderSpans.filter(atom => !away(atom.span));
    }
    if (paragraph.readOnlySourceSpans) paragraph.readOnlySourceSpans = paragraph.readOnlySourceSpans.map(home);
    if (paragraph.hiddenSourceSpans) paragraph.hiddenSourceSpans = paragraph.hiddenSourceSpans.map(home);
    if (paragraph.macroArgumentRuns) paragraph.macroArgumentRuns = paragraph.macroArgumentRuns.filter(run => !away(run.span) && !away(run.invocationSpan));
  }
  for (const graphic of layout.graphics) {
    if (away(graphic.sourceSpan)) { graphic.sourceSpan = home(graphic.sourceSpan); graphic.filenameSpan = home(graphic.filenameSpan); }
  }
  for (const spacing of layout.spacing) if (away(spacing.sourceSpan)) spacing.sourceSpan = home(spacing.sourceSpan);
  for (const picture of layout.embeddedTikz) if (away(picture.sourceSpan)) picture.sourceSpan = home(picture.sourceSpan);
  layout.editScopes = layout.editScopes.filter(scope => !away(scope.span) && !virtual.segments.some(segment => segment.kind === "macro"
    && segment.invocation.from === scope.span.from && segment.invocation.to === scope.span.to));
  return result;
}

/**
 * The preamble as TeX reads it: `\input` files in place, and uses of macros
 * that load packages, set lengths or load themes expanded, so that the
 * scanners that read literal declarations see them. `source` is the
 * document's source with that preamble; `toDocument` maps a span in it back
 * to the document (a span inside generated text becomes its use).
 */
export type BeamerEffectivePreamble = {
  readonly source: string;
  readonly toDocument: (span: Span) => Span;
  /** The document's source with `\input` files in place and every definition kept, up to an offset of the document (after its preamble). */
  readonly definitionsBefore: (offset: number) => string;
  /** Macro bindings at the end of that preamble. */
  readonly bindings: ReadonlyMap<string, MacroBinding>;
};

const PREAMBLE_ACTION = /\\(?:usepackage|RequirePackage|setlength|addtolength|use(?:color|font|inner|outer)?theme|input|include)(?![A-Za-z@])/u;

export function buildBeamerEffectivePreamble(
  source: string,
  document: BeamerDocumentModel,
  files: BeamerProjectFiles | undefined
): BeamerEffectivePreamble | null {
  const preambleEnd = document.preamble.span.to;
  const preamble = source.slice(0, preambleEnd);
  const hasInputs = files !== undefined && findBeamerInputUses(preamble).some(use => readBeamerInputFile(files, use.name) !== null);
  let mapped: MappedText = createIdentityMappedText(preamble);
  if (hasInputs) mapped = expandInputs(preamble, 0, files, 0);
  const bindings = collectMacroBindings(collectContextDefinitions(mapped.text));
  const acting = [...bindings.entries()].some(([name, binding]) => PREAMBLE_ACTION.test(binding.kind === "text" ? binding.value : binding.body) && macroUsedOutsideDefinition(mapped.text, name));
  if (!hasInputs && !acting) return null;
  const withInputs = mapped.text;
  if (acting) mapped = expandBeamerLocalMacros(mapped, new Map(), true).mapped;
  const combined = concatMappedText([mapped, createIdentityMappedText(source.slice(preambleEnd), preambleEnd)]);
  return {
    source: combined.text,
    bindings,
    toDocument: span => {
      const hit = projectInputRange(combined.sourceMap, span.from, span.to);
      return hit.kind === "source-range" ? { from: hit.from, to: hit.to } : { from: Math.min(span.from, preambleEnd), to: Math.min(span.to, preambleEnd) };
    },
    definitionsBefore: offset => withInputs + source.slice(preambleEnd, Math.max(preambleEnd, offset)),
  };
}

function macroUsedOutsideDefinition(text: string, name: string): boolean {
  const pattern = new RegExp(`${name.replace(/[\\@]/gu, "\\$&")}(?![A-Za-z@])`, "gu");
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(Math.max(0, match.index - 40), match.index);
    if (inLineComment(text, match.index)) continue;
    if (/\\(?:newcommand|renewcommand|providecommand|def|let)\s*\{?\s*$/u.test(before)) continue;
    return true;
  }
  return false;
}

function expandInputs(text: string, offset: number, files: BeamerProjectFiles | undefined, depth: number): MappedText {
  const owner = (span: Span) => ({ from: span.from + offset, to: span.to + offset });
  const parts: MappedText[] = [];
  let cursor = 0;
  for (const use of findBeamerInputUses(text)) {
    const file = depth < INPUT_DEPTH ? readBeamerInputFile(files, use.name) : null;
    if (!file) continue;
    parts.push(createIdentityMappedText(text.slice(cursor, use.span.from), offset + cursor));
    // Lines of the file end like TeX's: a trailing end of line is a space.
    const inner = expandInputs(file.text.replace(/\n$/u, ""), 0, files, depth + 1);
    parts.push(depth === 0 ? ownMapped(inner, owner(use.span)) : inner, createGeneratedMappedText("\n", "input file", owner(use.span)));
    cursor = use.span.to;
  }
  parts.push(createIdentityMappedText(text.slice(cursor), offset + cursor));
  return concatMappedText(parts);
}

/** Text whose every character stands for the use that brought it in. */
function ownMapped(mapped: MappedText, owner: Span): MappedText {
  return createGeneratedMappedText(mapped.text, "input file", owner);
}
