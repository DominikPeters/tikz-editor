import { joinFragments, layout, sourceSlice, tikz, userText, type TikzFragment } from "../edit/fragment.js";
import { enumerateTemplateText } from "../text/tex/enumerate-template.js";
import { beamerOptionalArgumentAfter, beamerSourceValueTokens, type BeamerSyntaxContext } from "./syntax.js";
import type { BeamerDelimitedSourceValue } from "./types.js";
import type { BeamerStructuralEdit } from "./structural-edit.js";

export function readBeamerListHead(context: BeamerSyntaxContext, at: number, limit: number, environment: string) {
  const arguments_: BeamerDelimitedSourceValue[] = [];
  let overlay: BeamerDelimitedSourceValue | null = null;
  let label: BeamerDelimitedSourceValue | null = null;
  let problem: string | null = null;
  let cursor = at;
  for (let index = 0; index < 3; index++) {
    const argument = beamerOptionalArgumentAfter(context, cursor, limit);
    if (!argument) break;
    arguments_.push(argument);
    cursor = argument.span.to;
    const value = beamerSourceValueTokens(context, argument);
    if (value.startsWith("<") && value.endsWith(">")) {
      if (overlay) problem = "This list has repeated reveal arguments. Edit them in Source.";
      overlay = { ...argument, value: value.slice(1, -1).trim() };
    } else {
      if (label || environment !== "enumerate") problem = "This list uses custom optional arguments. Edit them in Source.";
      label = { ...argument, value };
    }
  }
  if (arguments_.length > 2) problem = "This list has extra optional arguments. Edit them in Source.";
  return { overlay, label, arguments: arguments_, end: cursor, problem };
}

/** Canonical Beamer order is [<overlay>][labels]. Preserve the other argument
 * verbatim, including when repairing a reversed authored header. */
export function planBeamerListHeadEdit(context: BeamerSyntaxContext, at: number, limit: number, environment: string,
  change: { kind: "overlay" | "label"; value: string | null }): { edits: BeamerStructuralEdit[] } | { reason: string } {
  const head = readBeamerListHead(context, at, limit, environment);
  if (head.problem) return { reason: head.problem };
  if (change.kind === "label" && environment !== "enumerate") return { reason: "Only numbered lists take a label template." };
  let value = change.value;
  if (change.kind === "overlay" && value !== null) {
    value = value.trim().replace(/^<(.*)>$/u, "$1");
    if (!value || /[\\<>[\]{}%\r\n]/u.test(value)) return { reason: "Enter a single-line reveal specification without delimiters." };
  }
  if (change.kind === "label" && value !== null && enumerateTemplateText(value, 1) === null) return { reason: "Use a label mini template such as 1., (a), A., i. or I. Group literal text in braces." };
  const desired: TikzFragment[] = [];
  const retained = new Set<BeamerDelimitedSourceValue>();
  for (const kind of ["overlay", "label"] as const) {
    const existing = kind === "overlay" ? head.overlay : head.label;
    if (kind === change.kind) {
      if (value !== null) desired.push(kind === "overlay" ? tikz`[<${userText(value, "inspector-value")}>]` : tikz`[${userText(value, "inspector-value")}]`);
    } else if (existing) {
      desired.push(sourceSlice(context.source, existing.span));
      // Head values are normalized copies; compare source spans below.
      retained.add(existing);
    }
  }
  const comments = context.syntax.comments.filter(comment => at <= comment.from && comment.to <= head.end &&
    ![...retained].some(argument => argument.span.from <= comment.from && comment.to <= argument.span.to));
  const newline = layout(context.source.includes("\r\n") ? "\r\n" : "\n");
  const trivia = comments.map(comment => tikz`${newline}${sourceSlice(context.source, comment)}${newline}`);
  return { edits: [{ span: { from: at, to: head.end }, insert: joinFragments([...desired, ...trivia], tikz``) }] };
}
