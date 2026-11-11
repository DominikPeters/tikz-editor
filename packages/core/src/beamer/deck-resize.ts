import { plainNumber, sourceSlice, tikz, type TikzFragment } from "../edit/fragment.js";
import { requireArrayValue } from "../utils/collections.js";
import type { Span } from "../ast/types.js";
import type { SourcePatch } from "../edit/types.js";
import { POINTER_TOLERANCE_PT, shortestDecimal } from "../edit/format.js";
import { parseTexDimensionExpression } from "../text/tex/dimensions.js";
import { environmentBoundariesOf, readOptionList } from "./deck-edit-actions.js";
import { buildBeamerObjectIndex, type BeamerObjectIndex, type BeamerObjectNode } from "./object-index.js";
import { beamerOptionalArgumentAfter, beamerOverlayArgumentAfter, beamerRequiredArgumentAfter, createBeamerSyntaxContext } from "./syntax.js";
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
  insertScale?: { at: number; prefix: TikzFragment; suffix: TikzFragment };
};

/** Keep whitespace, braces, units, comments, and unrelated options outside the patch. */
function numericValue(source: string, span: Span, scalar = false): NumericValue | null {
  const raw = source.slice(span.from, span.to);
  const match = /^(\s*\{?\s*)([+]?(?:\d+(?:\.\d*)?|\.\d+))(\s*(?:\\[a-zA-Z]+|[a-zA-Z]+)?)(\s*\}?\s*)$/u.exec(raw);
  if (!match || (raw.includes("{") !== raw.includes("}"))) return null;
  const value = Number(match[2]);
  const suffix = requireArrayValue(match, 3).trim();
  if (!(value > 0) || !Number.isFinite(value)) return null;
  if (scalar ? suffix !== "" || Number(raw) !== value : !parseTexDimensionExpression(raw)) return null;
  const from = span.from + requireArrayValue(match, 1).length;
  return { span: { from, to: from + requireArrayValue(match, 2).length }, value };
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
      const a = requireArrayValue(columns, i - 1);
      const b = requireArrayValue(columns, i);
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
  // Options follow a star and an overlay specification: `\includegraphics<2->[…]{…}`.
  const commandEnd = command.starSpan?.to ?? command.span.to;
  const afterOverlay = beamerOverlayArgumentAfter(context, commandEnd, graphic.sourceSpan.to)?.span.to ?? commandEnd;
  const optional = beamerOptionalArgumentAfter(context, afterOverlay, graphic.sourceSpan.to);
  // The two-bracket corner form is not a graphicx key list. Inserting scale
  // into its lower-left coordinates would corrupt a valid image command.
  if (optional && beamerOptionalArgumentAfter(context, optional.span.to, graphic.sourceSpan.to)) return null;
  const list = optional ? readOptionList(source, optional) : null;
  const entries = list?.entries ?? [];
  // pdftex and LuaTeX reject these; the preview does not draw them.
  if (entries.some((entry) => ["natwidth", "natheight", "bbllx", "bblly", "bburx", "bbury"].includes(entry.key ?? ""))) return null;
  // A uniform factor commutes with rotation and cropping, so every size key scales.
  const dimensions = entries.filter((entry) => entry.key === "width" || entry.key === "height" || entry.key === "totalheight");
  const sizes = dimensions.length ? dimensions : entries.filter((entry) => entry.key === "scale");
  const values: NumericValue[] = [];
  for (const entry of sizes) {
    const value = entry.valueSpan && numericValue(source, entry.valueSpan, entry.key === "scale");
    if (!value || sizes.filter((other) => other.key === entry.key).length !== 1) return null;
    values.push(value);
  }
  return { objectId, bounds: graphic.bounds, values,
    ...(values.length ? {} : { insertScale: list
      ? { at: list.contentSpan.to, prefix: entries.length ? tikz`, scale=` : tikz`scale=`, suffix: tikz`` }
      : { at: afterOverlay, prefix: tikz`[scale=`, suffix: tikz`]` } }) };
}

function numericPatches(source: string, edits: { span: Span; replacement: TikzFragment }[]): SourcePatch[] {
  let delta = 0;
  return edits.filter((edit) => source.slice(edit.span.from, edit.span.to) !== edit.replacement)
    .sort((a, b) => a.span.from - b.span.from).map((edit) => {
      const from = edit.span.from + delta;
      delta += edit.replacement.length - (edit.span.to - edit.span.from);
      return { oldSpan: edit.span, newSpan: { from, to: from + edit.replacement.length }, replacement: edit.replacement };
    });
}
function formatValue(source: string, numeric: NumericValue, value: number): TikzFragment {
  if (Math.abs(value - numeric.value) < 1e-9) return sourceSlice(source, numeric.span);
  return plainNumber(Number(value.toFixed(6)), "beamer-length", source[numeric.span.from] === ".");
}

/**
 * The divider moved by `deltaPt`. The left width is the shortest decimal that
 * puts the divider within `tolerancePt` of the pointer; the right one takes
 * up the rest, so widths in the same unit keep their exact sum.
 */
export function beamerColumnResizePatches(source: string, divider: BeamerColumnDivider, deltaPt: number, tolerancePt = POINTER_TOLERANCE_PT): SourcePatch[] {
  if (!Number.isFinite(deltaPt)) return [];
  const minimum = Math.min(12, divider.leftWidth, divider.rightWidth);
  const delta = Math.max(minimum - divider.leftWidth, Math.min(divider.rightWidth - minimum, deltaPt));
  const leftPerPt = divider.left.value / divider.leftWidth;
  const rightPerPt = divider.right.value / divider.rightWidth;
  if (Math.abs(delta) <= tolerancePt) return [];
  const left = Number(shortestDecimal(divider.left.value + delta * leftPerPt, tolerancePt * leftPerPt));
  const sameUnit = Math.abs(leftPerPt - rightPerPt) <= 1e-9 * Math.max(leftPerPt, rightPerPt);
  const digits = (value: number) => (String(value).split(".")[1] ?? "").length;
  const right = sameUnit
    ? Number((divider.left.value + divider.right.value - left).toFixed(Math.max(digits(left), digits(divider.left.value), digits(divider.right.value))))
    : Number(shortestDecimal(divider.right.value - delta * rightPerPt, tolerancePt * rightPerPt));
  return numericPatches(source, [
    { span: divider.left.span, replacement: formatValue(source, divider.left, left) },
    { span: divider.right.span, replacement: formatValue(source, divider.right, right) },
  ]);
}

/**
 * `factor` scales the image about its opposite corner; each number is the
 * shortest decimal that keeps the dragged corner within `tolerancePt` (half
 * a screen pixel at 100% by default).
 */
export function beamerImageResizePatches(source: string, target: BeamerImageResizeTarget, factor: number, tolerancePt = POINTER_TOLERANCE_PT): SourcePatch[] {
  if (!Number.isFinite(factor)) return [];
  const scale = Math.max(Math.min(1, 8 / Math.min(target.bounds.width, target.bounds.height)), Math.min(100, factor));
  const factorTolerance = tolerancePt / Math.hypot(target.bounds.width, target.bounds.height);
  if (Math.abs(scale - 1) <= factorTolerance) return [];
  const edits = target.values.map((value) => ({ span: value.span, replacement: formatScaled(source, value, scale, factorTolerance) }));
  if (target.insertScale) {
    const { at, prefix, suffix } = target.insertScale;
    edits.push({ span: { from: at, to: at }, replacement: tikz`${prefix}${plainNumber(Number(shortestDecimal(scale, factorTolerance)), "beamer-scale")}${suffix}` });
  }
  return numericPatches(source, edits);
}

function formatScaled(source: string, numeric: NumericValue, factor: number, factorTolerance: number): TikzFragment {
  const next = Number(shortestDecimal(numeric.value * factor, numeric.value * factorTolerance));
  if (next === numeric.value) return sourceSlice(source, numeric.span);
  return plainNumber(next, "beamer-length", source[numeric.span.from] === ".");
}
