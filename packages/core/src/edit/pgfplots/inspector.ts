/**
 * Inspector sections for pgfplots axes and plots (design/pgfplots.md section 8).
 * Controls read the authored value, or show the effective one (computed limits,
 * the cycle list's styling) as their default; writes are single option edits
 * through `setProperty`, with a few pgfplots-specific keys handled by
 * `applyPgfplotsSetProperty` (legend entry text, the expression).
 */
import type { AddPlotStatement, AxisStatement } from "../../ast/types.js";
import type { OptionEntry } from "../../options/types.js";
import { isPlotMarkName, PLOT_MARK_NAMES } from "../../semantic/path/plot-marks.js";
import type { SceneElement } from "../../semantic/types.js";
import { owningAxisId, parseAxisPlotId } from "../../pgfplots/edit-ids.js";
import { COLOR_CYCLE_LIST } from "../../pgfplots/model.js";
import { userText } from "../fragment.js";
import { normalizeOptionKey } from "../option-key.js";
import { applySetPropertyActionRaw } from "../actions/set-property.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import { replaceSpan } from "../patch.js";
import { resolvePropertyTarget } from "../property-target.js";
import type { EditActionResultLike } from "../result-types.js";
import { colorOptionsForValue, normalizeInspectorColorValue } from "../inspector/color-syntax.js";
import { DASH_STYLE_OPTIONS } from "../inspector/presets.js";
import { dashStylePresetFromStyle, lineWidthPresetLabel } from "../inspector/preset-values.js";
import type { InspectorDescriptor, InspectorProperty, InspectorSection, SetPropertyWriteTarget } from "../inspector/types.js";
import { findAxisStatement, readAxisEditInfo } from "./axis-actions.js";
import { applyReplacements, legendAssociationFor, readLegendAssociation, setPlotLegendEntry } from "./legend-edits.js";
import { legendEntryOf } from "../../pgfplots/legend.js";

/** Keys the pgfplots inspector writes that are not option keys. */
export const PGFPLOTS_LEGEND_ENTRY_KEY = "__pgfplots_legend_entry__";
export const PGFPLOTS_EXPRESSION_KEY = "__pgfplots_expression__";

const TEXT_KEYS = new Set(["xlabel", "ylabel", "title"]);
const AUTO_KEYS = new Set(["xmin", "xmax", "ymin", "ymax", "width", "height", "xtick distance", "ytick distance", "domain", "samples", "mark size"]);
const DEFAULT_REMOVES: Record<string, string> = { grid: "none", "legend pos": "default", xmode: "linear", ymode: "linear", "axis lines": "box", mark: "default" };

function plainKey(key: string): string {
  return normalizeOptionKey(key).replace(/^\/pgfplots\//u, "");
}

function lastEntry(entries: readonly OptionEntry[] | undefined, key: string): OptionEntry | null {
  let found: OptionEntry | null = null;
  for (const entry of entries ?? []) {
    if ((entry.kind === "kv" || entry.kind === "flag") && plainKey(entry.key) === key) found = entry;
  }
  return found;
}

function authored(entries: readonly OptionEntry[] | undefined, key: string): string | null {
  const entry = lastEntry(entries, key);
  if (!entry) return null;
  if (entry.kind === "flag") return "true";
  if (entry.kind !== "kv") return null;
  return stripBraces(entry.valueRaw);
}

function stripBraces(raw: string): string {
  let text = raw.trim();
  while (text.startsWith("{") && text.endsWith("}")) text = text.slice(1, -1).trim();
  return text;
}

function write(elementId: string, key: string, writable = true, reason?: string): SetPropertyWriteTarget {
  return { mode: "setProperty", elementId, level: "command", key, writable, ...(reason === undefined ? {} : { reason }) };
}

function formatAuto(value: number): string {
  if (!Number.isFinite(value)) return "?";
  return String(Number(value.toPrecision(6)));
}

/** The inspector for an axis (or one of its descriptions) or a plot; null for other ids. */
export function buildPgfplotsInspectorDescriptor(
  source: string,
  elementId: string,
  elements: readonly SceneElement[],
  parseOptions: EditParseOptions = {}
): InspectorDescriptor | null {
  const axisId = owningAxisId(elementId);
  if (!axisId) return null;
  const parsed = parseTikzForEdit(source, parseOptions);
  const axis = findAxisStatement(parsed.figure.body, axisId);
  if (!axis) return null;
  const plotRef = parseAxisPlotId(elementId);
  if (plotRef) {
    const plot = axis.body.find((item): item is AddPlotStatement => item.kind === "AddPlot" && item.id === elementId);
    return plot ? buildPlotDescriptor(source, axis, plot, elements, parseOptions) : null;
  }
  return buildAxisDescriptor(axis, elementId, elements);
}

function buildAxisDescriptor(axis: AxisStatement, elementId: string, elements: readonly SceneElement[]): InspectorDescriptor {
  const entries = axis.options?.entries;
  const info = readAxisEditInfo(elements, axis.id);
  const id = axis.id;
  const text = (key: string, label: string, auto?: string): InspectorProperty => ({
    kind: "text", id: `pgfplots-${key.replace(/\s+/gu, "-")}`, label: auto !== undefined && authored(entries, key) === null ? `${label} (auto: ${auto})` : label,
    value: authored(entries, key) ?? "", write: write(id, key)
  });
  const enumOf = (key: string, label: string, values: readonly string[], fallback: string): InspectorProperty => {
    const value = authored(entries, key) ?? fallback;
    const options = values.map((v) => ({ value: v, label: v }));
    if (!values.includes(value)) options.unshift({ value, label: value });
    return { kind: "enum", id: `pgfplots-${key.replace(/\s+/gu, "-")}`, label, value, options, write: write(id, key) };
  };
  const limits = info?.limits;
  const boxWidth = info ? info.box.x1 - info.box.x0 : null;
  const boxHeight = info ? info.box.y1 - info.box.y0 : null;
  const sections: InspectorSection[] = [
    {
      id: "pgfplots-size", title: "Size", sourceLevel: "command",
      properties: [
        text("width", "Width", boxWidth === null ? undefined : `box ${formatAuto(boxWidth)}pt`),
        text("height", "Height", boxHeight === null ? undefined : `box ${formatAuto(boxHeight)}pt`),
        { kind: "boolean", id: "pgfplots-scale-only-axis", label: "Scale only axis", value: authored(entries, "scale only axis") === "true", trueValue: "true", falseValue: "", write: write(id, "scale only axis") }
      ]
    },
    {
      id: "pgfplots-limits", title: "Limits", sourceLevel: "command",
      properties: [
        text("xmin", "X min", limits ? formatAuto(limits.xmin) : undefined),
        text("xmax", "X max", limits ? formatAuto(limits.xmax) : undefined),
        text("ymin", "Y min", limits ? formatAuto(limits.ymin) : undefined),
        text("ymax", "Y max", limits ? formatAuto(limits.ymax) : undefined)
      ]
    },
    {
      id: "pgfplots-labels", title: "Labels", sourceLevel: "command",
      properties: [text("xlabel", "X label"), text("ylabel", "Y label"), text("title", "Title")]
    },
    {
      id: "pgfplots-axes", title: "Axes", sourceLevel: "command",
      properties: [
        enumOf("grid", "Grid", ["none", "major", "minor", "both"], "none"),
        enumOf("axis lines", "Axis lines", ["box", "left", "middle", "center", "right", "none"], "box"),
        enumOf("xmode", "X scale", ["linear", "log"], axis.environment === "semilogxaxis" || axis.environment === "loglogaxis" ? "log" : "linear"),
        enumOf("ymode", "Y scale", ["linear", "log"], axis.environment === "semilogyaxis" || axis.environment === "loglogaxis" ? "log" : "linear"),
        text("xtick distance", "X tick distance", "auto"),
        text("ytick distance", "Y tick distance", "auto")
      ]
    },
    {
      id: "pgfplots-legend", title: "Legend", sourceLevel: "command",
      properties: [
        enumOf("legend pos", "Position", ["default", "north east", "north west", "south east", "south west", "outer north east"], "default")
      ]
    }
  ];
  // A selected description puts its own section first.
  const part = elementId.slice(axis.id.length + 1);
  if (part === "legend") sections.sort((a, b) => (a.id === "pgfplots-legend" ? -1 : b.id === "pgfplots-legend" ? 1 : 0));
  else if (part === "xlabel" || part === "ylabel" || part === "title") sections.sort((a, b) => (a.id === "pgfplots-labels" ? -1 : b.id === "pgfplots-labels" ? 1 : 0));
  return { elementKind: "axis", elementId, writeTargetId: elementId, sections };
}

/** G1: the mark the default cycle list gives plot i. */
function cycleMark(index: number): string {
  const entry = COLOR_CYCLE_LIST[index % COLOR_CYCLE_LIST.length] ?? "";
  return /mark=([^,]+)/u.exec(entry)?.[1]?.trim() ?? "none";
}

function buildPlotDescriptor(source: string, axis: AxisStatement, plot: AddPlotStatement, elements: readonly SceneElement[], parseOptions: EditParseOptions): InspectorDescriptor {
  const entries = plot.options?.entries;
  const id = plot.id;
  const line = elements.find((e) => e.sourceRef.sourceId === id && e.id.endsWith(":line"))
    ?? elements.find((e) => e.sourceRef.sourceId === id);
  const usesCycle = plot.increment || !plot.options;
  const stroke = normalizeInspectorColorValue(line?.style.stroke ?? null);
  const lineWidth = line?.style.lineWidth ?? 0.4;
  const plots = axis.body.filter((item) => item.kind === "AddPlot");
  const defaultMark = usesCycle ? cycleMark(plots.indexOf(plot)) : "none";
  const markValue = authored(entries, "mark") ?? (lastEntry(entries, "only marks") && usesCycle ? defaultMark : "default");
  const markOptions = [
    { value: "default", label: usesCycle ? `Default (cycle: ${defaultMark})` : "Default (none)" },
    { value: "none", label: "none" },
    ...PLOT_MARK_NAMES.filter((name) => name !== "text" && name !== "ball").map((name) => ({ value: name, label: name }))
  ];
  if (markValue !== "default" && !markOptions.some((o) => o.value === markValue)) markOptions.unshift({ value: markValue, label: markValue });
  const flag = (key: string, label: string): InspectorProperty => ({
    kind: "boolean", id: `pgfplots-${key.replace(/\s+/gu, "-")}`, label, value: lastEntry(entries, key) !== null && authored(entries, key) !== "false",
    trueValue: "true", falseValue: "", write: write(id, key)
  });
  // The entry the renderer pairs with this plot, wherever it is written (L4).
  const association = legendAssociationFor(source, axis.id, parseOptions, elements);
  const legendEntry = association ? legendEntryOf(association, plot.id) : null;
  const style: InspectorSection = {
    id: "pgfplots-plot-style", title: "Plot", sourceLevel: "command",
    properties: [
      { kind: "color", id: "pgfplots-plot-color", label: usesCycle && !authored(entries, "color") ? "Color (cycle list)" : "Color", value: stroke, syntaxValue: authored(entries, "color") ?? authored(entries, "draw"), options: colorOptionsForValue(stroke), write: write(id, "color") },
      { kind: "lineWidth", id: "pgfplots-plot-line-width", label: "Line width", value: lineWidth, min: 0.1, max: 6, step: 0.1, presetLabel: lineWidthPresetLabel(lineWidth), write: write(id, "line width") },
      { kind: "dashStyle", id: "pgfplots-plot-dash", label: "Line style", value: dashStylePresetFromStyle(line?.style.dashArray ?? null, lineWidth), options: DASH_STYLE_OPTIONS, previewLineWidth: lineWidth, write: write(id, "solid") },
      { kind: "enum", id: "pgfplots-plot-mark", label: "Mark", value: isPlotMarkName(markValue) || markValue === "none" || markValue === "default" ? markValue : markValue, options: markOptions, write: write(id, "mark") },
      { kind: "text", id: "pgfplots-plot-mark-size", label: "Mark size", value: authored(entries, "mark size") ?? "", write: write(id, "mark size") },
      flag("only marks", "Only marks"),
      flag("no markers", "No markers"),
      flag("smooth", "Smooth")
    ]
  };
  const data: InspectorSection = {
    id: "pgfplots-plot-data", title: "Data", sourceLevel: "command",
    properties: [
      { kind: "text", id: "pgfplots-plot-legend-entry", label: "Legend entry", value: legendEntry?.text?.text ?? "", write: write(id, PGFPLOTS_LEGEND_ENTRY_KEY, legendEntry !== null, legendEntry === null ? "A `forget plot` has no legend entry." : undefined) }
    ]
  };
  if (plot.input.kind === "expression") {
    data.properties.push(
      { kind: "text", id: "pgfplots-plot-expression", label: "Expression", value: plot.input.expression, write: write(id, PGFPLOTS_EXPRESSION_KEY) },
      { kind: "text", id: "pgfplots-plot-domain", label: "Domain (auto: -5:5)", value: authored(entries, "domain") ?? "", write: write(id, "domain") },
      { kind: "text", id: "pgfplots-plot-samples", label: "Samples (auto: 25)", value: authored(entries, "samples") ?? "", write: write(id, "samples") }
    );
  }
  return { elementKind: "plot", elementId: id, writeTargetId: id, sections: [style, data] };
}

function needsBraces(value: string): boolean {
  if (value.startsWith("{") && value.endsWith("}")) return false;
  return /[,=[\]]/u.test(value) || /^\s|\s$/u.test(value);
}

/**
 * `setProperty` on an axis, a description or a plot: option keys become
 * minimal option edits (text values braced when TeX needs it, empty and
 * default values remove the key); the legend entry and the expression edit
 * the statements. Null when the id is not a pgfplots one.
 */
export function applyPgfplotsSetProperty(
  source: string,
  action: { elementId: string; key: string; value: string; clearKeys?: string[] },
  parseOptions: EditParseOptions = {}
): EditActionResultLike | null {
  const elementId = action.elementId.trim();
  if (!owningAxisId(elementId)) return null;
  const resolved = resolvePropertyTarget(source, elementId, parseOptions);
  if (resolved.kind !== "found" || (resolved.target.kind !== "pgfplots-axis" && resolved.target.kind !== "pgfplots-plot")) return null;
  const axisId = resolved.target.ownerSourceId ?? owningAxisId(elementId) ?? elementId;
  if (action.key === PGFPLOTS_LEGEND_ENTRY_KEY || action.key === PGFPLOTS_EXPRESSION_KEY) {
    const parsed = parseTikzForEdit(source, parseOptions);
    const axis = findAxisStatement(parsed.figure.body, axisId);
    const plot = axis?.body.find((item): item is AddPlotStatement => item.kind === "AddPlot" && item.id === elementId);
    if (!axis || !plot) return { kind: "unsupported", reason: "The plot was not found." };
    if (action.key === PGFPLOTS_EXPRESSION_KEY) {
      if (plot.input.kind !== "expression") return { kind: "unsupported", reason: "Only expression plots have an expression." };
      const text = action.value.trim();
      if (text.length === 0) return { kind: "unsupported", reason: "An expression cannot be empty." };
      const fragment = userText(text, "inspector-value");
      const updated = replaceSpan(source, plot.input.expressionSpan, fragment);
      return { kind: "success", newSource: updated.source, patches: [{ oldSpan: plot.input.expressionSpan, newSpan: updated.changedSpan, replacement: fragment }], changedSourceIds: [axisId] };
    }
    const association = readLegendAssociation(source, axis.id, parseOptions);
    if (!association) return { kind: "unsupported", reason: "The axis could not be evaluated to find its legend entries." };
    const edit = setPlotLegendEntry(source, axis, association, plot.id, action.value);
    if ("unsupported" in edit) return { kind: "unsupported", reason: edit.unsupported };
    if (edit.replacements.length === 0) return { kind: "unsupported", reason: "setProperty would not change the source." };
    const applied = applyReplacements(source, edit.replacements);
    if (edit.notes.length > 0) return { kind: "partial", newSource: applied.source, patches: applied.patches, changedSourceIds: [axisId], skippedHandles: [], reason: edit.notes.join(" ") };
    return { kind: "success", newSource: applied.source, patches: applied.patches, changedSourceIds: [axisId] };
  }
  const key = plainKey(action.key);
  let value = action.value.trim();
  if (value === "auto" && AUTO_KEYS.has(key)) value = "";
  if (DEFAULT_REMOVES[key] === value) value = "";
  if (value.length > 0 && TEXT_KEYS.has(key) && needsBraces(value)) value = `{${value}}`;
  // Write to the key as authored (`/pgfplots/xmin`), else the plain key.
  const existing = lastEntry(resolved.target.options?.entries, key);
  const writeKey = existing && existing.kind !== "unknown" ? existing.key : key;
  const result = applySetPropertyActionRaw(source, { elementId, key: writeKey, value, ...(action.clearKeys ? { clearKeys: action.clearKeys } : {}) }, parseOptions);
  if (result.kind === "success" || result.kind === "partial") return { ...result, changedSourceIds: [axisId] };
  return result;
}
