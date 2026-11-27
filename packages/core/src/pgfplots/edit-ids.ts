/**
 * Ids and source spans the editor uses for the parts of an axis (design/pgfplots.md
 * section 8). The axis is one selectable object (`axis:N`); its plots
 * (`axis:N:plot:M`, the statement ids), descriptions and legend are
 * sub-selections. Tick labels, ticks, grid and the box belong to the axis.
 */
import type { AxisStatement, Span } from "../ast/types.js";
import type { LabelRole } from "./layout.js";
import type { AxisModel } from "./model.js";

export type AxisDescriptionPart = "xlabel" | "ylabel" | "title" | "legend";

export const AXIS_DESCRIPTION_PARTS: readonly AxisDescriptionPart[] = ["xlabel", "ylabel", "title", "legend"];

/** The scene source id of a label of the given role. */
export function axisSubSelectionId(axisId: string, role: LabelRole): string {
  switch (role) {
    case "xlabel":
    case "ylabel":
    case "title":
      return `${axisId}:${role}`;
    case "legend":
    case "legend-entry":
      return `${axisId}:legend`;
    default:
      return axisId;
  }
}

/** `axis:N:xlabel` → { axisId: "axis:N", part: "xlabel" }. */
export function parseAxisDescriptionId(id: string): { axisId: string; part: AxisDescriptionPart } | null {
  const match = /^(axis:\d+):(xlabel|ylabel|title|legend)$/u.exec(id);
  const part = AXIS_DESCRIPTION_PARTS.find((candidate) => candidate === match?.[2]);
  if (!match?.[1] || !part) return null;
  return { axisId: match[1], part };
}

/** `axis:N:plot:M` → { axisId, plotIndex }. */
export function parseAxisPlotId(id: string): { axisId: string; plotIndex: number } | null {
  const match = /^(axis:\d+):plot:(\d+)$/u.exec(id);
  if (!match?.[1] || !match[2]) return null;
  return { axisId: match[1], plotIndex: Number(match[2]) };
}

export function isAxisId(id: string): boolean {
  return /^axis:\d+$/u.test(id);
}

/** The axis an id belongs to (the axis itself, a plot or a description), or null. */
export function owningAxisId(id: string): string | null {
  const match = /^(axis:\d+)(?::|$)/u.exec(id);
  return match?.[1] ?? null;
}

/**
 * Where the text of `xlabel=`, `ylabel=` or `title=` is written in the axis
 * options: the value span, without one pair of braces. Undefined when the key
 * came from a style or the value is not in the document as written.
 */
export function axisDescriptionTextSpan(role: LabelRole, model: AxisModel, axis: AxisStatement, documentSource: string): Span | undefined {
  const described = role === "xlabel" ? model.x.label : role === "ylabel" ? model.y.label : role === "title" ? model.title : undefined;
  if (!described) return undefined;
  const entry = axis.options?.entries.find((e) => e.span.from === described.span.from && e.span.to === described.span.to);
  if (entry?.kind !== "kv" || !entry.valueSpan) return undefined;
  return unbracedSpan(documentSource, entry.valueSpan);
}

/** A span without one pair of enclosing braces (and surrounding blanks). */
export function unbracedSpan(source: string, span: Span): Span {
  let from = span.from;
  let to = span.to;
  while (from < to && /\s/u.test(source[from] ?? "")) from += 1;
  while (to > from && /\s/u.test(source[to - 1] ?? "")) to -= 1;
  if (source[from] === "{" && source[to - 1] === "}" && to - from >= 2) return { from: from + 1, to: to - 1 };
  return { from, to };
}
