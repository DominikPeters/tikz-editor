import type { Span } from "../ast/types.js";
import { applyFragments, plainNumber, sourceSlice, tikz, type EditedSource, type FragmentEdit, type TikzFragment } from "./fragment.js";

/**
 * A node whose text is a single `\includegraphics`, as inserted images are:
 * resizing it scales the image's size keys rather than setting the node's
 * minimum size, which would only pad the picture.
 */
export type NodeGraphicsSize = {
  /** The numbers of the size keys graphicx reads (width, height, totalheight; else scale). */
  readonly values: readonly { readonly span: Span; readonly value: number }[];
  /** Where a natural-size image gets a `scale` key. */
  readonly insertScale?: { readonly at: number; readonly prefix: TikzFragment; readonly suffix: TikzFragment };
};

const COMMAND = /^(\s*\\includegraphics\*?\s*)(?:\[([^[\]]*)\])?(\s*\{[^{}]*\}\s*)$/u;
const NUMBER = /^(\s*\{?\s*)([+]?(?:\d+(?:\.\d*)?|\.\d+))(\s*(?:\\[a-zA-Z]+|[a-zA-Z]+)?)(\s*\}?\s*)$/u;
// pdftex and LuaTeX reject these; better leave such a node to the generic resize.
const REJECTED = new Set(["natwidth", "natheight", "bbllx", "bblly", "bburx", "bbury"]);

export function nodeGraphicsSize(source: string, textSpan: Span): NodeGraphicsSize | null {
  const match = COMMAND.exec(source.slice(textSpan.from, textSpan.to));
  if (!match) return null;
  const head = match[1] ?? "";
  const optional = match[2];
  if (optional === undefined) {
    return { values: [], insertScale: { at: textSpan.from + head.length, prefix: tikz`[scale=`, suffix: tikz`]` } };
  }
  const contentFrom = textSpan.from + head.length + 1;
  const entries = splitEntries(optional, contentFrom);
  if (entries.some((entry) => REJECTED.has(entry.key))) return null;
  const dimensions = entries.filter((entry) => entry.key === "width" || entry.key === "height" || entry.key === "totalheight");
  const sizes = dimensions.length > 0 ? dimensions : entries.filter((entry) => entry.key === "scale");
  const values: { span: Span; value: number }[] = [];
  for (const entry of sizes) {
    if (!entry.value || sizes.filter((other) => other.key === entry.key).length !== 1) return null;
    const number = NUMBER.exec(source.slice(entry.value.from, entry.value.to));
    if (!number) return null;
    const value = Number(number[2]);
    const unit = (number[3] ?? "").trim();
    // A dimension needs its unit; a scale is a bare number.
    if (!(value > 0) || !Number.isFinite(value) || (entry.key === "scale") !== (unit === "")) return null;
    const from = entry.value.from + (number[1] ?? "").length;
    values.push({ span: { from, to: from + (number[2] ?? "").length }, value });
  }
  if (values.length > 0) return { values };
  const contentTo = contentFrom + optional.length;
  return { values: [], insertScale: { at: contentTo, prefix: optional.trim() === "" ? tikz`scale=` : tikz`, scale=`, suffix: tikz`` } };
}

/** The source with the image scaled by `factor` (both axes). */
export function scaleNodeGraphics(source: string, size: NodeGraphicsSize, factor: number): EditedSource | null {
  if (!(factor > 0) || !Number.isFinite(factor) || Math.abs(factor - 1) < 1e-9) return null;
  const edits: FragmentEdit[] = size.values.map((value) => ({ span: value.span, fragment: formatScaled(source, value, factor) }));
  if (size.insertScale) {
    const { at, prefix, suffix } = size.insertScale;
    edits.push({ span: { from: at, to: at }, fragment: tikz`${prefix}${plainNumber(round(factor), "graphics-scale")}${suffix}` });
  }
  return applyFragments(source, edits);
}

function formatScaled(source: string, value: { span: Span; value: number }, factor: number): TikzFragment {
  const next = round(value.value * factor);
  if (next === value.value) return sourceSlice(source, value.span);
  return plainNumber(next, "graphics-length", source[value.span.from] === ".");
}

function round(value: number): number {
  return Number(value.toFixed(value >= 10 ? 2 : 3));
}

type Entry = { key: string; value: Span | null };

/** Comma-separated `key=value` entries at brace depth 0, with absolute value spans. */
function splitEntries(text: string, offset: number): Entry[] {
  const entries: Entry[] = [];
  let depth = 0;
  let start = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const equals = raw.indexOf("=");
    const key = (equals < 0 ? raw : raw.slice(0, equals)).trim();
    if (key) entries.push({ key, value: equals < 0 ? null : { from: offset + start + equals + 1, to: offset + end } });
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === "," && depth === 0) { push(index); start = index + 1; }
  }
  push(text.length);
  return entries;
}
