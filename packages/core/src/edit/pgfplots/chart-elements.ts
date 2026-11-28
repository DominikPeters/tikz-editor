/**
 * Chart elements of a pgfplots axis that are added or removed in one step
 * (the inspector's Elements group, the canvas context menu): the title, the
 * axis labels, the legend; and the plot-level edits of the same menus
 * (insert a plot, reset a plot's style). Each is one source change, so one
 * undo step.
 *
 * - Title and labels are the `title`, `xlabel`, `ylabel` keys (manual,
 *   "Axis Descriptions"): adding writes a placeholder text the user edits in
 *   place, removing deletes the key, or writes an empty value when a style
 *   still supplies one (the key cannot be deleted where it is not written).
 * - The legend: pgfplots draws one exactly when the axis has legend entries
 *   (`\addlegendentry`, `\legend`, `legend entries`; manual "Legends").
 *   `legend style` only formats it (`draw=none` removes the frame, not the
 *   legend), and `legend to name` stores it for a `\ref` elsewhere instead of
 *   drawing it, which needs a second LaTeX run and a `\ref` in the document:
 *   neither hides it in place. So showing it adds an entry per legend image
 *   (`\addlegendentry{Series n}` after each), and removing it deletes the
 *   entries, wherever the renderer reads them (legend-edits.ts).
 */
import type { AddLegendImageStatement, AddPlotStatement, AxisStatement, Span } from "../../ast/types.js";
import type { OptionEntry } from "../../options/types.js";
import { getAxisEvaluations } from "../../pgfplots/evaluate-axis.js";
import type { LegendAssociation } from "../../pgfplots/legend.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import type { SceneElement } from "../../semantic/types.js";
import { EMPTY_FRAGMENT, joinFragments, layout, sourceSlice, tikz, unchangedSource, userText, type EditedSource, type TikzFragment } from "../fragment.js";
import { isLikelyBareColorOption, applyOptionMutationsToTarget, type OptionMutation } from "../option-mutations.js";
import { normalizeOptionKey } from "../option-key.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import { computeMinimalReplacementPatch } from "../patch.js";
import { resolvePropertyTarget, type PropertyTarget } from "../property-target.js";
import type { EditActionResultLike } from "../result-types.js";
import { findAxisStatement } from "./axis-actions.js";
import { applyReplacements, legendAssociationFor, readLegendAssociation, removeAllLegendEntries, setPlotLegendEntry, type Replacement } from "./legend-edits.js";

export type AxisElementKind = "title" | "xlabel" | "ylabel" | "legend";
export type AxisTextElementKind = Exclude<AxisElementKind, "legend">;

export const AXIS_ELEMENT_KINDS: readonly AxisElementKind[] = ["title", "xlabel", "ylabel", "legend"];

/** How the inspector, the context menu and the Objects panel name each element. */
export const AXIS_ELEMENT_LABELS: Record<AxisElementKind, string> = { title: "Title", xlabel: "X label", ylabel: "Y label", legend: "Legend" };

/** The text a new title or label starts with; the user edits it in place. */
export const AXIS_ELEMENT_PLACEHOLDER_TEXT: Record<AxisTextElementKind, string> = { title: "Title", xlabel: "$x$", ylabel: "$y$" };

/** The text of the n-th (1-based) legend entry the editor adds. */
export function placeholderLegendEntry(n: number): string {
  return `Series ${String(n)}`;
}

export type AxisElementState = {
  present: boolean;
  /** Whether the toggle can change it; `reason` says why not. */
  enabled: boolean;
  reason?: string;
};

export type AxisElementsState = Record<AxisElementKind, AxisElementState>;

function plainKey(key: string): string {
  return normalizeOptionKey(key).replace(/^\/pgfplots\//u, "");
}

function lastKv(entries: readonly OptionEntry[] | undefined, key: string): Extract<OptionEntry, { kind: "kv" | "flag" }> | null {
  let found: Extract<OptionEntry, { kind: "kv" | "flag" }> | null = null;
  for (const entry of entries ?? []) {
    if ((entry.kind === "kv" || entry.kind === "flag") && plainKey(entry.key) === key) found = entry;
  }
  return found;
}

function authoredText(entry: Extract<OptionEntry, { kind: "kv" | "flag" }> | null): string | null {
  if (entry?.kind !== "kv") return null;
  let text = entry.valueRaw.trim();
  while (text.startsWith("{") && text.endsWith("}")) text = text.slice(1, -1).trim();
  return text;
}

function isDrawn(elements: readonly SceneElement[], partId: string): boolean {
  return elements.some((element) => element.sourceRef.sourceId === partId);
}

function legendDrawn(association: LegendAssociation | null): boolean {
  return association?.pairing.some((pairing) => pairing.drawn) ?? false;
}

function sceneOf(source: string, parseOptions: EditParseOptions): readonly SceneElement[] {
  return evaluateTikzFigure(parseTikzForEdit(source, parseOptions).figure, source).scene.elements;
}

function resolveAxisTarget(source: string, axisId: string, parseOptions: EditParseOptions): PropertyTarget | null {
  const resolved = resolvePropertyTarget(source, axisId, parseOptions);
  return resolved.kind === "found" && resolved.target.kind === "pgfplots-axis" ? resolved.target : null;
}

/** Which elements an axis shows, and whether each toggle can act (for the inspector and menus). */
export function readAxisElements(
  source: string,
  axisId: string,
  elements: readonly SceneElement[],
  parseOptions: EditParseOptions = {}
): AxisElementsState | null {
  const axis = findAxisStatement(parseTikzForEdit(source, parseOptions).figure.body, axisId);
  if (!axis) return null;
  const text = (kind: AxisTextElementKind): AxisElementState => {
    const written = authoredText(lastKv(axis.options?.entries, kind));
    return { present: written !== null ? written.length > 0 : isDrawn(elements, `${axisId}:${kind}`), enabled: true };
  };
  const association = legendAssociationFor(source, axisId, parseOptions, elements);
  const present = legendDrawn(association);
  const images = association?.images.length ?? 0;
  const legend: AxisElementState = present
    ? { present, enabled: true }
    : images === 0
      ? { present, enabled: false, reason: "The axis has no plots." }
      : { present, enabled: true };
  return { title: text("title"), xlabel: text("xlabel"), ylabel: text("ylabel"), legend };
}

function result(source: string, newSource: EditedSource | null, axisId: string, selectedSourceIds?: string[]): EditActionResultLike {
  if (newSource === null || newSource === source) {
    return { kind: "success", newSource: unchangedSource(source), patches: [], changedSourceIds: [axisId], ...(selectedSourceIds ? { selectedSourceIds } : {}) };
  }
  return {
    kind: "success",
    newSource,
    patches: [computeMinimalReplacementPatch(source, newSource)],
    changedSourceIds: [axisId],
    ...(selectedSourceIds ? { selectedSourceIds } : {})
  };
}

/**
 * Shows or hides one element of an axis. `selectNew` selects a newly added
 * title or label (the context menu then edits its text in place).
 */
export function applySetAxisElementAction(
  source: string,
  axisId: string,
  element: AxisElementKind,
  visible: boolean,
  parseOptions: EditParseOptions = {},
  options: { selectNew?: boolean } = {}
): EditActionResultLike {
  const parsed = parseTikzForEdit(source, parseOptions);
  const axis = findAxisStatement(parsed.figure.body, axisId);
  if (!axis) return { kind: "unsupported", reason: "The axis was not found." };
  if (element === "legend") return visible ? showLegend(source, axis, parseOptions) : hideLegend(source, axis, parseOptions);
  const target = resolveAxisTarget(source, axisId, parseOptions);
  if (!target) return { kind: "unsupported", reason: "The axis was not found." };
  const existing = lastKv(axis.options?.entries, element);
  const writeKey = existing ? normalizeOptionKey(existing.key) : element;
  const partId = `${axisId}:${element}`;
  const write = (mutation: OptionMutation): EditedSource | null => applyOptionMutationsToTarget(source, target, new Map([[writeKey, mutation]]))?.source ?? null;
  if (visible) {
    const written = authoredText(existing);
    if (written !== null ? written.length > 0 : isDrawn(sceneOf(source, parseOptions), partId)) {
      return result(source, null, axisId, options.selectNew ? [partId] : undefined);
    }
    const next = write({ kind: "set", value: userText(`{${AXIS_ELEMENT_PLACEHOLDER_TEXT[element]}}`, "inspector-value") });
    return result(source, next, axisId, options.selectNew ? [partId] : undefined);
  }
  // Removing: delete the key; where a style still supplies the element, write it empty instead.
  if (existing) {
    const removed = write({ kind: "remove" });
    if (removed && !isDrawn(sceneOf(removed, parseOptions), partId)) return result(source, removed, axisId);
  } else if (!isDrawn(sceneOf(source, parseOptions), partId)) {
    return result(source, null, axisId);
  }
  return result(source, write({ kind: "set", value: userText("{}", "inspector-value") }), axisId);
}

/** The statements of an axis that are legend images, in body order (plots that are not `forget plot`, `\addlegendimage`). */
function legendImageStatements(axis: AxisStatement, association: LegendAssociation): Array<AddPlotStatement | AddLegendImageStatement> {
  const ids = new Set(association.images.map((image) => image.sourceId));
  return axis.body.filter((item): item is AddPlotStatement | AddLegendImageStatement => (item.kind === "AddPlot" || item.kind === "AddLegendImage") && ids.has(item.id));
}

function indentAt(source: string, at: number): string {
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/u.exec(source.slice(lineStart, at))?.[0] ?? "";
}

function showLegend(source: string, axis: AxisStatement, parseOptions: EditParseOptions): EditActionResultLike {
  const association = readLegendAssociation(source, axis.id, parseOptions);
  if (!association) return { kind: "unsupported", reason: "Legend entries could not be read." };
  if (legendDrawn(association)) return result(source, null, axis.id);
  if (association.images.length === 0) return { kind: "unsupported", reason: "The axis has no plots." };
  if (association.form !== "none") return { kind: "unsupported", reason: "The legend entries are empty." };
  // One `\addlegendentry` after each image, in the form the manual introduces first.
  const replacements: Replacement[] = legendImageStatements(axis, association).map((statement, index) => ({
    span: { from: statement.span.to, to: statement.span.to },
    fragment: tikz`${layout(`\n${indentAt(source, statement.span.from)}`)}\addlegendentry{${userText(placeholderLegendEntry(index + 1), "inspector-value")}}`
  }));
  const applied = applyReplacements(source, replacements);
  return { kind: "success", newSource: applied.source, patches: applied.patches, changedSourceIds: [axis.id] };
}

function hideLegend(source: string, axis: AxisStatement, parseOptions: EditParseOptions): EditActionResultLike {
  const association = readLegendAssociation(source, axis.id, parseOptions);
  if (!association) return { kind: "unsupported", reason: "Legend entries could not be read." };
  if (!legendDrawn(association) && association.form === "none") return result(source, null, axis.id);
  const edit = removeAllLegendEntries(source, axis, association);
  if ("unsupported" in edit) return { kind: "unsupported", reason: edit.unsupported };
  const applied = applyReplacements(source, edit.replacements);
  const after = readLegendAssociation(applied.source, axis.id, parseOptions);
  if (legendDrawn(after)) return { kind: "unsupported", reason: "The legend entries are set in a style." };
  return { kind: "success", newSource: applied.source, patches: applied.patches, changedSourceIds: [axis.id] };
}

/** Keys of a plot's own style that the plot inspector manages; Reset Plot Style removes them so the cycle list applies (behaviour G1/G2). */
const PLOT_STYLE_KEYS = new Set([
  "color", "draw", "line width", "ultra thin", "very thin", "thin", "semithick", "thick", "very thick", "ultra thick",
  "solid", "dashed", "densely dashed", "loosely dashed", "dotted", "densely dotted", "loosely dotted", "dash pattern",
  "mark", "mark size", "only marks", "no markers", "no marks", "smooth", "sharp plot"
]);

function isPlotStyleEntry(entry: OptionEntry): boolean {
  if (entry.kind !== "kv" && entry.kind !== "flag") return false;
  const key = plainKey(entry.key);
  return PLOT_STYLE_KEYS.has(key) || (entry.kind === "flag" && isLikelyBareColorOption(entry.raw.trim()));
}

/** Removes a plot's own style options (colour, line width, dash, marks, smooth); `\addplot[…]` left empty becomes `\addplot`. */
export function applyResetPlotStyleAction(source: string, plotId: string, parseOptions: EditParseOptions = {}): EditActionResultLike {
  const resolved = resolvePropertyTarget(source, plotId, parseOptions);
  if (resolved.kind !== "found" || resolved.target.kind !== "pgfplots-plot") return { kind: "unsupported", reason: "The plot was not found." };
  const target = resolved.target;
  const axisId = target.ownerSourceId ?? plotId;
  const axis = findAxisStatement(parseTikzForEdit(source, parseOptions).figure.body, axisId);
  const plot = axis?.body.find((item): item is AddPlotStatement => item.kind === "AddPlot" && item.id === plotId);
  if (!plot) return { kind: "unsupported", reason: "The plot was not found." };
  const entries = plot.options?.entries ?? [];
  const styled = entries.filter(isPlotStyleEntry);
  if (styled.length === 0) return { kind: "unsupported", reason: "The plot has no style options of its own." };
  const kept = entries.filter((entry) => !isPlotStyleEntry(entry) && entry.raw.trim().length > 0);
  if (kept.length === 0 && plot.optionsSpan) {
    // Nothing left: drop the list and the `+`, so the plot takes the cycle list as `\addplot` does.
    const span: Span = { from: plot.incrementSpan?.from ?? plot.optionsSpan.from, to: plot.optionsSpan.to };
    const applied = applyReplacements(source, [{ span, fragment: EMPTY_FRAGMENT }]);
    return { kind: "success", newSource: applied.source, patches: applied.patches, changedSourceIds: [axisId] };
  }
  const mutations = new Map<string, OptionMutation>(styled.map((entry) => [entry.kind === "kv" || entry.kind === "flag" ? normalizeOptionKey(entry.key) : entry.raw, { kind: "remove" }]));
  const rewritten = applyOptionMutationsToTarget(source, target, mutations);
  if (!rewritten) return { kind: "unsupported", reason: "The plot's style options could not be removed." };
  return { kind: "success", newSource: rewritten.source, patches: [rewritten.patch], changedSourceIds: [axisId] };
}

/** Placeholder data for a new plot: the last plot's x values, each y one more. */
function nextCoordinates(source: string, plot: AddPlotStatement): TikzFragment | null {
  if (plot.input.kind !== "coordinates" || plot.input.points.length === 0) return null;
  const points = plot.input.points.map((point) => {
    const [x, y] = point.components;
    if (!x || !y) return null;
    const value = Number(y.raw);
    const nextY = Number.isFinite(value) ? String(Number((value + 1).toPrecision(12))) : y.raw;
    return `(${x.raw},${nextY})`;
  });
  if (points.includes(null)) return null;
  return userText(`coordinates {${points.join(" ")}}`, "inspector-value");
}

/** Options a copied plot keeps: not its colour or mark (the cycle list gives the new plot its own), not `forget plot`. */
function copiedOptions(source: string, plot: AddPlotStatement): TikzFragment {
  const entries = plot.options?.entries ?? [];
  const kept = entries.filter((entry) => {
    if (entry.raw.trim().length === 0) return false;
    if (entry.kind !== "kv" && entry.kind !== "flag") return true;
    const key = plainKey(entry.key);
    if (key === "forget plot" || key === "color" || key === "draw" || key === "mark" || key === "mark options") return false;
    // `fill` alone fills with the plot's own colour (an area); `fill=<colour>` would repeat the last plot's colour.
    if (key === "fill" && entry.kind === "kv") return false;
    return !(entry.kind === "flag" && isLikelyBareColorOption(entry.raw.trim()));
  });
  if (kept.length === 0) return EMPTY_FRAGMENT;
  return tikz`+[${joinFragments(kept.map((entry) => sourceSlice(source, entry.span)), tikz`, `)}]`;
}

/**
 * Adds a plot after the last one, of the same input form with placeholder
 * data (coordinates: the same x values, y + 1; an expression: `x`), keeping
 * its non-style options; with a legend entry when the axis shows a legend.
 */
export function applyInsertAxisPlotAction(source: string, axisId: string, parseOptions: EditParseOptions = {}): EditActionResultLike {
  const axis = findAxisStatement(parseTikzForEdit(source, parseOptions).figure.body, axisId);
  if (!axis) return { kind: "unsupported", reason: "The axis was not found." };
  const plots = axis.body.filter((item): item is AddPlotStatement => item.kind === "AddPlot");
  const last = plots.at(-1);
  let statement: TikzFragment;
  let at: number;
  let indent: string;
  if (!last) {
    at = axis.bodySpan.from;
    indent = `${indentAt(source, axis.span.from)}  `;
    statement = tikz`\addplot coordinates {(0,0) (1,1) (2,4)};`;
  } else {
    let data: TikzFragment | null = null;
    if (last.input.kind === "coordinates") data = nextCoordinates(source, last);
    else if (last.input.kind === "expression") data = tikz`{x}`;
    if (!data) return { kind: "unsupported", reason: "The last plot must use coordinates or an expression." };
    const trailing = last.trailingPath ? tikz` ${sourceSlice(source, last.trailingPath.span)}` : EMPTY_FRAGMENT;
    const command = sourceSlice(source, last.commandSpan);
    statement = tikz`${command}${copiedOptions(source, last)} ${data}${trailing};`;
    // After the last plot, and after its `\addlegendentry` when that follows it.
    const index = axis.body.indexOf(last);
    const next = axis.body[index + 1];
    const anchor = next?.kind === "AddLegendEntry" ? next.span : last.span;
    at = anchor.to;
    indent = indentAt(source, last.span.from);
  }
  const inserted = applyReplacements(source, [{ span: { from: at, to: at }, fragment: tikz`${layout(`\n${indent}`)}${statement}` }]);
  let next: EditedSource = inserted.source;
  const newPlotId = `${axisId}:plot:${String(plots.length)}`;
  // A legend that is shown gets the new plot's entry too, in the form the axis uses.
  const before = readLegendAssociation(source, axisId, parseOptions);
  if (legendDrawn(before)) {
    const afterAxis = findAxisStatement(parseTikzForEdit(next, parseOptions).figure.body, axisId);
    const association = readLegendAssociation(next, axisId, parseOptions);
    if (afterAxis && association) {
      const count = association.images.length;
      const edit = setPlotLegendEntry(next, afterAxis, association, newPlotId, placeholderLegendEntry(count));
      if (!("unsupported" in edit) && edit.replacements.length > 0) next = applyReplacements(next, edit.replacements).source;
    }
  }
  return {
    kind: "success",
    newSource: next,
    patches: [computeMinimalReplacementPatch(source, next)],
    changedSourceIds: [axisId],
    selectedSourceIds: [newPlotId]
  };
}

/** For the scene `elements` came from: the axis evaluation's legend association (no re-evaluation). */
export function axisLegendAssociation(elements: readonly SceneElement[], axisId: string): LegendAssociation | null {
  return getAxisEvaluations(elements).find((axis) => axis.axisId === axisId)?.legend ?? null;
}
