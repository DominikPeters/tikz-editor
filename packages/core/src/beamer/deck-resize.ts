import type { Span } from "../ast/types.js";
import type { SourcePatch } from "../edit/types.js";
import { parseTexDimensionExpression } from "../text/tex/dimensions.js";
import { environmentBoundariesOf, readOptionList } from "./deck-edit-actions.js";
import { buildBeamerObjectIndex, type BeamerObjectIndex, type BeamerObjectNode } from "./object-index.js";
import { beamerOptionalArgumentAfter, beamerRequiredArgumentAfter, createBeamerSyntaxContext } from "./syntax.js";
import { resolveBeamerColumnWidth } from "./column-dimensions.js";
import type { BeamerFrameLayout, BeamerRect } from "./types.js";

type NumericValue = { span: Span; value: number };
export type BeamerColumnDivider = {
  id: string;
  parentId: string;
  leftId: string;
  rightId: string;
  x: number;
  y: number;
  height: number;
  leftWidth: number;
  rightWidth: number;
  left: NumericValue;
  right: NumericValue;
};
export type BeamerImageResizeTarget = {
  objectId: string;
  bounds: BeamerRect;
  values: NumericValue[];
  /** A natural-size image gets a scale option; no pixel dimension is baked in. */
  insertScale?: { at: number; prefix: string; suffix: string };
};

/** Keep whitespace, braces, units, comments, and unrelated options outside the patch. */
function numericValue(source: string, span: Span, scalar = false): NumericValue | null {
  const raw = source.slice(span.from, span.to);
  const match = /^(\s*\{?\s*)([+]?(?:\d+(?:\.\d*)?|\.\d+))(\s*(?:\\[a-zA-Z]+|[a-zA-Z]+)?)(\s*\}?\s*)$/u.exec(raw);
  if (!match || (raw.includes("{") !== raw.includes("}"))) return null;
  const value = Number(match[2]);
  const suffix = match[3].trim();
  if (!(value > 0) || !Number.isFinite(value)) return null;
  if (scalar ? suffix !== "" || Number(raw) !== value : !parseTexDimensionExpression(raw)) return null;
  const from = span.from + match[1].length;
  return { span: { from, to: from + match[2].length }, value };
}

export function beamerColumnDividers(source: string, layout: BeamerFrameLayout, index?: BeamerObjectIndex): BeamerColumnDivider[] {
  const objects = index ?? buildBeamerObjectIndex({ ...layout, source });
  const context = createBeamerSyntaxContext(source);
  const readWidth = (node: BeamerObjectNode) => {
    const pair = environmentBoundariesOf(context, node);
    if (!pair) return null;
    const optional = beamerOptionalArgumentAfter(context, pair.begin.span.to, node.sourceSpan.to);
    const width = beamerRequiredArgumentAfter(context, optional?.span.to ?? pair.begin.span.to, node.sourceSpan.to);
    if (!width || resolveBeamerColumnWidth(width.value, 1, 1) == null) return null;
    return numericValue(source, width.contentSpan);
  };
  const dividers: BeamerColumnDivider[] = [];
  for (const parent of objects.nodes.filter((node) => node.kind === "columns")) {
    const columns = objects.nodes.filter((node) => node.kind === "column" && node.parentId === parent.id)
      .sort((a, b) => a.sourceSpan.from - b.sourceSpan.from);
    for (let i = 1; i < columns.length; i += 1) {
      const a = columns[i - 1];
      const b = columns[i];
      const left = readWidth(a);
      const right = readWidth(b);
      if (!left || !right || a.bounds.width <= 0 || b.bounds.width <= 0) continue;
      dividers.push({ id: `${a.id}/${b.id}`, parentId: parent.id, leftId: a.id, rightId: b.id,
        x: (a.bounds.x + a.bounds.width + b.bounds.x) / 2,
        y: parent.bounds.y, height: Math.max(12, parent.bounds.height),
        leftWidth: a.bounds.width, rightWidth: b.bounds.width, left, right });
    }
  }
  return dividers;
}

export function beamerImageResizeTarget(source: string, layout: BeamerFrameLayout, objectId: string): BeamerImageResizeTarget | null {
  const graphic = layout.graphics.find((item) => item.itemId === objectId && item.visibility === "visible");
  // An unresolved image with only one dimension has no known aspect ratio.
  if (graphic?.asset.status !== "resolved" || graphic.bounds.width <= 0 || graphic.bounds.height <= 0) return null;
  const context = createBeamerSyntaxContext(source);
  const command = context.syntax.controlsIn(graphic.sourceSpan).find((item) => item.name === "includegraphics");
  if (!command) return null;
  const optional = beamerOptionalArgumentAfter(context, command.span.to, graphic.sourceSpan.to);
  const list = optional ? readOptionList(source, optional) : null;
  const entries = list?.entries ?? [];
  // These options change sizing/rotation in TeX but are not rendered here yet.
  if (entries.some((entry) => ["angle", "totalheight", "natwidth", "natheight", "bb"].includes(entry.key ?? ""))) return null;
  const dimensions = entries.filter((entry) => entry.key === "width" || entry.key === "height");
  const sizes = dimensions.length ? dimensions : entries.filter((entry) => entry.key === "scale");
  const values: NumericValue[] = [];
  for (const entry of sizes) {
    const value = entry.valueSpan && numericValue(source, entry.valueSpan, entry.key === "scale");
    if (!value || sizes.filter((other) => other.key === entry.key).length !== 1) return null;
    values.push(value);
  }
  return { objectId, bounds: graphic.bounds, values,
    ...(values.length ? {} : { insertScale: list
      ? { at: list.contentSpan.to, prefix: entries.length ? ", scale=" : "scale=", suffix: "" }
      : { at: command.span.to, prefix: "[scale=", suffix: "]" } }) };
}

function numericPatches(source: string, edits: { span: Span; replacement: string }[]): SourcePatch[] {
  let delta = 0;
  return edits.filter((edit) => source.slice(edit.span.from, edit.span.to) !== edit.replacement)
    .sort((a, b) => a.span.from - b.span.from).map((edit) => {
      const from = edit.span.from + delta;
      delta += edit.replacement.length - (edit.span.to - edit.span.from);
      return { oldSpan: edit.span, newSpan: { from, to: from + edit.replacement.length }, replacement: edit.replacement };
    });
}
function formatValue(source: string, numeric: NumericValue, value: number): string {
  if (Math.abs(value - numeric.value) < 1e-9) return source.slice(numeric.span.from, numeric.span.to);
  const formatted = String(Number(value.toFixed(6)));
  return source[numeric.span.from] === "." && formatted.startsWith("0.") ? formatted.slice(1) : formatted;
}

export function beamerColumnResizePatches(source: string, divider: BeamerColumnDivider, deltaPt: number): SourcePatch[] {
  if (!Number.isFinite(deltaPt)) return [];
  const minimum = Math.min(12, divider.leftWidth, divider.rightWidth);
  const delta = Math.max(minimum - divider.leftWidth, Math.min(divider.rightWidth - minimum, deltaPt));
  return numericPatches(source, [
    { span: divider.left.span, replacement: formatValue(source, divider.left, divider.left.value * (divider.leftWidth + delta) / divider.leftWidth) },
    { span: divider.right.span, replacement: formatValue(source, divider.right, divider.right.value * (divider.rightWidth - delta) / divider.rightWidth) },
  ]);
}

export function beamerImageResizePatches(source: string, target: BeamerImageResizeTarget, factor: number): SourcePatch[] {
  if (!Number.isFinite(factor)) return [];
  const scale = Math.max(Math.min(1, 8 / Math.min(target.bounds.width, target.bounds.height)), Math.min(100, factor));
  if (Math.abs(scale - 1) < 1e-9) return [];
  const edits = target.values.map((value) => ({ span: value.span, replacement: formatValue(source, value, value.value * scale) }));
  if (target.insertScale) {
    const { at, prefix, suffix } = target.insertScale;
    edits.push({ span: { from: at, to: at }, replacement: `${prefix}${Number(scale.toFixed(6))}${suffix}` });
  }
  return numericPatches(source, edits);
}
