import type { Span } from "../ast/types.js";
import { matchTexSyntaxEnvironments, type TexSyntaxIndex } from "../text/tex/syntax-index.js";
import { createBeamerSyntaxContext } from "./syntax.js";
import type { BeamerDocumentModel, BeamerFrameModel } from "./types.js";
import type { BeamerSlideDestination } from "./slide-manager.js";

/** A complete authored frame, outside command arguments and local TeX groups. */
export function beamerSlideIsEditable(source: string, frame: BeamerFrameModel): boolean {
  return !!frame.endSpan && isDocumentLevelSpan(source, frame.span);
}

// Per index, environments other than `document` by start, with the furthest
// end among those starting so far: the slides panel asks this of every frame.
const enclosingEnvironmentIndex = new WeakMap<TexSyntaxIndex, { starts: number[]; furthestEnd: number[] }>();

function enclosedByEnvironment(syntax: TexSyntaxIndex, span: Span): boolean {
  let index = enclosingEnvironmentIndex.get(syntax);
  if (!index) {
    const environments = [...matchTexSyntaxEnvironments(syntax).values()]
      .filter(env => env.name !== "document").sort((a, b) => a.span.from - b.span.from);
    const furthestEnd: number[] = [];
    for (const env of environments) furthestEnd.push(Math.max(furthestEnd.at(-1) ?? -1, env.span.to));
    index = { starts: environments.map(env => env.span.from), furthestEnd };
    enclosingEnvironmentIndex.set(syntax, index);
  }
  // Environments starting strictly before the span; one of them encloses it
  // when it ends strictly after it.
  let low = 0, high = index.starts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (index.starts[middle] < span.from) low = middle + 1; else high = middle;
  }
  return low > 0 && index.furthestEnd[low - 1] > span.to;
}

export function isDocumentLevelSpan(source: string, span: Span): boolean {
  const syntax = createBeamerSyntaxContext(source).syntax;
  if (enclosedByEnvironment(syntax, span)) return false;
  let node = syntax.tree.resolveInner(span.from + 1, 1).parent;
  while (node) {
    if (["Group", "MacroDefinition", "OptionalArgument"].includes(node.name)) return false;
    node = node.parent;
  }
  return true;
}

/** Whole frame lines and directly preceding comment lines travel together. */
export function beamerSlideSourceSpan(source: string, frame: Pick<BeamerFrameModel, "span">): Span {
  let from = frame.span.from;
  const start = source.lastIndexOf("\n", from - 1) + 1;
  if (!source.slice(start, from).trim()) {
    from = start;
    while (from > 0) {
      const previous = source.lastIndexOf("\n", from - 2) + 1;
      if (!/^[\t ]*%/u.test(source.slice(previous, from))) break;
      from = previous;
    }
  }
  let to = frame.span.to;
  const end = source.indexOf("\n", to);
  const suffix = source.slice(to, end < 0 ? source.length : end);
  if (/^[\t \r]*(?:%[^\n]*)?$/u.test(suffix)) to = end < 0 ? source.length : end + 1;
  return { from, to };
}

export function beamerSlideInsertionPoint(document: BeamerDocumentModel, destination: BeamerSlideDestination): number | null {
  if (destination.kind === "end") return document.documentBodySpan.to;
  if (destination.kind === "section") {
    const section = document.sections.find(section => section.id === destination.sectionId);
    if (!section || !isDocumentLevelSpan(document.source, section.span)) return null;
    if (destination.edge === "before") return section.span.from;
    // Include the command's trailing comment, so the inserted frame cannot be commented out.
    const end = document.source.indexOf("\n", section.span.to);
    return /^[\t \r]*(?:%[^\n]*)?$/u.test(document.source.slice(section.span.to, end < 0 ? undefined : end))
      ? end < 0 ? document.source.length : end + 1 : section.span.to;
  }
  const frame = document.frames.find(frame => frame.id === destination.frameId);
  if (!frame || !beamerSlideIsEditable(document.source, frame)) return null;
  const span = beamerSlideSourceSpan(document.source, frame);
  return destination.kind === "before" ? span.from : span.to;
}
