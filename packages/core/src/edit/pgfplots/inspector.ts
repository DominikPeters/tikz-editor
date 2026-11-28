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
import type { PgfplotsAxisEditInfo, SceneElement } from "../../semantic/types.js";
import { owningAxisId, parseAxisPlotId } from "../../pgfplots/edit-ids.js";
import { COLOR_CYCLE_LIST } from "../../pgfplots/model.js";
import { DEFAULT_HEIGHT, DEFAULT_WIDTH } from "../../pgfplots/layout.js";
import { userText } from "../fragment.js";
import { normalizeOptionKey } from "../option-key.js";
import { applySetPropertyActionRaw } from "../actions/set-property.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import { replaceSpan } from "../patch.js";
import { resolvePropertyTarget } from "../property-target.js";
import type { EditActionResultLike } from "../result-types.js";
import { colorOptionsForValue, normalizeInspectorColorValue } from "../inspector/color-syntax.js";
import { DASH_STYLE_OPTIONS } from "../inspector/presets.js";
import { parseOptionListRaw } from "../../options/parse.js";
import { isLikelyBareColorOption } from "../option-mutations.js";
import { EMPTY_FRAGMENT, unchangedSource } from "../fragment.js";
import { dashStylePresetFromStyle, lineWidthPresetLabel } from "../inspector/preset-values.js";
import type { InspectorDescriptor, InspectorProperty, InspectorSection, SetPropertyWriteTarget } from "../inspector/types.js";
import { findAxisStatement, readAxisEditInfo } from "./axis-actions.js";
import { applyReplacements, legendAssociationFor, readLegendAssociation, setPlotLegendEntry } from "./legend-edits.js";
import { legendEntryOf } from "../../pgfplots/legend.js";
import { applySetAxisElementAction, AXIS_ELEMENT_KINDS, AXIS_ELEMENT_LABELS, readAxisElements, type AxisElementKind } from "./chart-elements.js";
import { applyChangeChartTypeAction, readChartTypeConversions, type ChartTypeConversion } from "./chart-type.js";

/**
 * The Chart type / Plot type field: every type, the current one selected, the
 * ones the switch does not offer for this chart greyed out with the reason.
 * Null when the chart is none of the types (mixed, or a type the switch does not know).
 */
function chartTypeProperty(source: string, elementId: string, elements: readonly SceneElement[], parseOptions: EditParseOptions, label: string): InspectorProperty | null {
  const list = readChartTypeConversions(source, elementId, elements, parseOptions);
  if (!list) return null;
  const options = list.options as Array<ChartTypeConversion<string>>;
  const current = options.find((option) => option.current);
  const anyAvailable = options.some((option) => option.available);
  const reason = options.flatMap((option) => (!option.available && !option.current ? [option.reason] : []))[0];
  return {
    kind: "enum", id: `pgfplots-${list.scope === "axis" ? "chart" : "plot"}-type`, label,
    value: current?.kind ?? "",
    options: [
      ...(current ? [] : [{ value: "", label: "Mixed", disabled: true, reason: "The chart is not one of these types (its plots differ, or it uses a type the switch does not change)." }]),
      ...options.map((option) => (option.available || option.current ? { value: option.kind, label: option.label } : { value: option.kind, label: option.label, disabled: true, reason: option.reason }))
    ],
    write: write(elementId, PGFPLOTS_CHART_TYPE_KEY, anyAvailable, anyAvailable ? undefined : reason)
  };
}

/** Keys the pgfplots inspector writes that are not option keys. */
export const PGFPLOTS_LEGEND_ENTRY_KEY = "__pgfplots_legend_entry__";
export const PGFPLOTS_EXPRESSION_KEY = "__pgfplots_expression__";
/** Change Chart Type (chart-type.ts): the value is a chart kind on an axis, a plot type on a plot. */
export const PGFPLOTS_CHART_TYPE_KEY = "__pgfplots_chart_type__";

const TEXT_KEYS = new Set(["xlabel", "ylabel", "title"]);
/** List values the inspector writes in braces (`xtick={0,1,2}`). */
const LIST_KEYS = new Set(["xtick", "ytick", "xticklabels", "yticklabels"]);

/**
 * A setting inside a style-valued axis key (`tick label style={font=\small}`):
 * the write key is `__pgfplots_substyle__|<style key>|<setting>`, and the edit
 * rewrites only that setting of the style's list (behaviour E27: each offered
 * setting checked against LuaLaTeX).
 */
const SUBSTYLE_PREFIX = "__pgfplots_substyle__|";
type SubstyleSetting = "font" | "color" | "rotate" | "dash";
export function pgfplotsSubstyleKey(style: string, setting: SubstyleSetting): string {
  return `${SUBSTYLE_PREFIX}${style}|${setting}`;
}
const NUMBER_FORMAT_FIXED = "/pgf/number format/fixed";

/** A flag written with its key path (`/pgf/number format/fixed`); the option reader keeps such an entry raw. */
function hasPathFlag(entries: readonly OptionEntry[] | undefined, key: string): boolean {
  return (entries ?? []).some((entry) => entry.raw.trim().toLowerCase() === key || (entry.kind === "flag" && normalizeOptionKey(entry.key) === key));
}

const DASH_FLAGS = new Set(["solid", "dashed", "densely dashed", "loosely dashed", "dotted", "densely dotted", "loosely dotted"]);

function substyleMatches(entry: OptionEntry, setting: SubstyleSetting): boolean {
  if (entry.kind === "unknown") return false;
  const key = normalizeOptionKey(entry.key);
  if (setting === "dash") return entry.kind === "flag" && DASH_FLAGS.has(key);
  if (setting === "color") return key === "color" || key === "text" || (entry.kind === "flag" && isLikelyBareColorOption(entry.raw.trim()) && !DASH_FLAGS.has(key));
  return entry.kind === "kv" && key === setting;
}

function substyleEntries(raw: string | null): OptionEntry[] {
  if (raw === null) return [];
  return parseOptionListRaw(`[${stripBraces(raw)}]`).entries.filter((entry) => entry.raw.trim().length > 0);
}

/** The current value of one setting in a style value, as the inspector shows it. */
function readSubstyle(raw: string | null, setting: SubstyleSetting): string | null {
  const entry = substyleEntries(raw).filter((candidate) => substyleMatches(candidate, setting)).at(-1);
  if (!entry || entry.kind === "unknown") return null;
  if (setting === "dash" || (setting === "color" && entry.kind === "flag")) return entry.raw.trim();
  return entry.kind === "kv" ? stripBraces(entry.valueRaw) : null;
}

/** The style value with one setting replaced (empty: removed); null when nothing is left. */
function writeSubstyle(raw: string | null, setting: SubstyleSetting, value: string): string | null {
  const kept = substyleEntries(raw).filter((entry) => !substyleMatches(entry, setting)).map((entry) => entry.raw.trim());
  const text = value.trim();
  if (text.length > 0) kept.push(setting === "dash" ? text : `${setting}=${text}`);
  return kept.length > 0 ? `{${kept.join(", ")}}` : null;
}
const AUTO_KEYS = new Set(["xmin", "xmax", "ymin", "ymax", "width", "height", "xtick distance", "ytick distance", "domain", "samples", "mark size"]);
/** Documented initial values (manual; design/pgfplots-behaviour.md M2, mark size 2pt) shown in the empty fields. */
const PLOT_PLACEHOLDERS = { domain: "-5:5", samples: "25", markSize: "2pt" } as const;
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
  return buildAxisDescriptor(axis, elementId, elements, source, parseOptions);
}

/** The inspector key of an Elements toggle (not an option key: the write goes through `applySetAxisElementAction`). */
export function pgfplotsElementKey(element: AxisElementKind): string {
  return `__pgfplots_element_${element}__`;
}

function elementOfKey(key: string): AxisElementKind | null {
  const match = /^__pgfplots_element_(title|xlabel|ylabel|legend)__$/u.exec(key);
  return AXIS_ELEMENT_KINDS.find((kind) => kind === match?.[1]) ?? null;
}

const ELEMENT_NOTES: Partial<Record<AxisElementKind, string>> = {
  legend: "pgfplots draws a legend when the axis has legend entries: showing it adds one per plot, hiding it removes them (Undo brings them back)."
};

/** One-click add/remove of the title, the axis labels and the legend, with the grid choice. */
function buildElementsSection(source: string, axis: AxisStatement, elements: readonly SceneElement[], parseOptions: EditParseOptions, grid: InspectorProperty, chartType: InspectorProperty | null): InspectorSection {
  const state = readAxisElements(source, axis.id, elements, parseOptions);
  const toggles = AXIS_ELEMENT_KINDS.map((kind): InspectorProperty => {
    const entry = state?.[kind];
    const note = ELEMENT_NOTES[kind];
    return {
      kind: "boolean", id: `pgfplots-element-${kind}`, label: AXIS_ELEMENT_LABELS[kind], value: entry?.present ?? false, trueValue: "true", falseValue: "",
      ...(note === undefined ? {} : { tooltip: note }),
      write: write(axis.id, pgfplotsElementKey(kind), entry?.enabled ?? false, entry?.enabled === false ? entry.reason : undefined)
    };
  });
  return { id: "pgfplots-elements", title: "Elements", sourceLevel: "command", properties: [...(chartType ? [chartType] : []), ...toggles, grid] };
}

/** Enum choices: the TeX value, shown in sentence case like the other inspector choices. */
function choice(value: string, label = sentenceCase(value)): { value: string; label: string } {
  return { value, label };
}

function sentenceCase(text: string): string {
  return text.length > 0 ? `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}` : text;
}

/** What an unset field shows when its value is chosen as the axis is drawn (the deck inspector's word for it). */
const AUTO_PLACEHOLDER = "Auto";
export const GRID_CHOICES: ReadonlyArray<{ value: string; label: string }> = ["none", "major", "minor", "both"].map((value) => choice(value));
const SCALE_CHOICES: ReadonlyArray<{ value: string; label: string }> = [choice("linear"), choice("log")];
const AXIS_LINES_CHOICES: ReadonlyArray<{ value: string; label: string }> = ["box", "left", "middle", "center", "right", "none"].map((value) => choice(value));
const LEGEND_POS_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  choice("default", "Default (north east)"),
  ...["north east", "north west", "south east", "south west", "outer north east"].map((value) => choice(value))
];

/** The `width`/`height` the size model applies while none is written: pgfplots' 240pt by 207pt, or the other one's ratio (behaviour A2). */
function effectiveSizePlaceholders(info: PgfplotsAxisEditInfo | null): { width: string; height: string } {
  const size = info?.size;
  const width = size?.width ?? (size?.height !== undefined ? (size.height * DEFAULT_WIDTH) / DEFAULT_HEIGHT : DEFAULT_WIDTH);
  const height = size?.height ?? (size?.width !== undefined ? (size.width * DEFAULT_HEIGHT) / DEFAULT_WIDTH : DEFAULT_HEIGHT);
  return { width: `${formatAuto(width)}pt`, height: `${formatAuto(height)}pt` };
}

function buildAxisDescriptor(axis: AxisStatement, elementId: string, elements: readonly SceneElement[], source: string, parseOptions: EditParseOptions): InspectorDescriptor {
  const entries = axis.options?.entries;
  const info = readAxisEditInfo(elements, axis.id);
  const id = axis.id;
  // An unset field shows the value that applies instead as its placeholder (computed limits, the default size).
  const text = (key: string, label: string, placeholder?: string): InspectorProperty => ({
    kind: "text", id: `pgfplots-${key.replace(/\s+/gu, "-")}`, label,
    value: authored(entries, key) ?? "", ...(placeholder === undefined ? {} : { placeholder }), write: write(id, key)
  });
  const enumOf = (key: string, label: string, values: ReadonlyArray<{ value: string; label: string }>, fallback: string): InspectorProperty => {
    const value = authored(entries, key) ?? fallback;
    const options = [...values];
    if (!values.some((option) => option.value === value)) options.unshift(choice(value, value));
    return { kind: "enum", id: `pgfplots-${key.replace(/\s+/gu, "-")}`, label, value, options, write: write(id, key) };
  };
  const limits = info?.limits;
  const size = effectiveSizePlaceholders(info);
  const sections: InspectorSection[] = [
    buildElementsSection(source, axis, elements, parseOptions, enumOf("grid", "Grid", GRID_CHOICES, "none"), elementId === axis.id ? chartTypeProperty(source, axis.id, elements, parseOptions, "Chart type") : null),
    {
      id: "pgfplots-labels", title: "Labels", sourceLevel: "command",
      properties: [text("title", "Title"), text("xlabel", "X label"), text("ylabel", "Y label")]
    },
    {
      id: "pgfplots-size", title: "Size", sourceLevel: "command",
      properties: [
        text("width", "Width", size.width),
        text("height", "Height", size.height),
        { kind: "boolean", id: "pgfplots-scale-only-axis", label: "Scale only axis", value: authored(entries, "scale only axis") === "true", trueValue: "true", falseValue: "", write: write(id, "scale only axis") }
      ]
    },
    {
      id: "pgfplots-limits", title: "Limits", sourceLevel: "command",
      properties: [
        text("xmin", "X min", limits ? formatAuto(limits.xmin) : AUTO_PLACEHOLDER),
        text("xmax", "X max", limits ? formatAuto(limits.xmax) : AUTO_PLACEHOLDER),
        text("ymin", "Y min", limits ? formatAuto(limits.ymin) : AUTO_PLACEHOLDER),
        text("ymax", "Y max", limits ? formatAuto(limits.ymax) : AUTO_PLACEHOLDER)
      ]
    },
    {
      id: "pgfplots-axes", title: "Axes", sourceLevel: "command",
      properties: [
        enumOf("axis lines", "Axis lines", AXIS_LINES_CHOICES, "box"),
        enumOf("xmode", "X scale", SCALE_CHOICES, axis.environment === "semilogxaxis" || axis.environment === "loglogaxis" ? "log" : "linear"),
        enumOf("ymode", "Y scale", SCALE_CHOICES, axis.environment === "semilogyaxis" || axis.environment === "loglogaxis" ? "log" : "linear")
      ]
    },
    buildTicksSection(axis, id, text),
    buildGridStyleSection(axis, id),
    {
      id: "pgfplots-legend", title: "Legend", sourceLevel: "command",
      properties: [
        enumOf("legend pos", "Position", LEGEND_POS_CHOICES, "default")
      ]
    }
  ];
  // A selected description puts its own section first.
  const part = elementId.slice(axis.id.length + 1);
  if (part === "legend") sections.sort((a, b) => (a.id === "pgfplots-legend" ? -1 : b.id === "pgfplots-legend" ? 1 : 0));
  else if (part === "xlabel" || part === "ylabel" || part === "title") sections.sort((a, b) => (a.id === "pgfplots-labels" ? -1 : b.id === "pgfplots-labels" ? 1 : 0));
  return { elementKind: "axis", elementId, writeTargetId: elementId, sections };
}

type TextField = (key: string, label: string, placeholder?: string) => InspectorProperty;

const TICK_FONT_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  choice("", "Default"), choice("\\tiny", "Tiny"), choice("\\scriptsize", "Script"), choice("\\footnotesize", "Footnote"),
  choice("\\small", "Small"), choice("\\normalsize", "Normal"), choice("\\large", "Large")
];
const ROTATION_CHOICES: ReadonlyArray<{ value: string; label: string }> = [choice("", "None"), choice("45", "45°"), choice("90", "90°")];
const NUMBER_FORMAT_CHOICES: ReadonlyArray<{ value: string; label: string }> = [choice("", "Auto"), choice("fixed", "Fixed point")];

/**
 * Tick positions, labels and their look (behaviour T, D; E27 checked each
 * written form against LuaLaTeX). Each control is one key, or one setting
 * inside `tick label style` / `xticklabel style`.
 */
function buildTicksSection(axis: AxisStatement, id: string, text: TextField): InspectorSection {
  const entries = axis.options?.entries;
  const styleValue = (key: string) => {
    const entry = lastEntry(entries, key);
    return entry?.kind === "kv" ? entry.valueRaw : null;
  };
  const sub = (style: string, setting: SubstyleSetting) => readSubstyle(styleValue(style), setting);
  const enumField = (idSuffix: string, label: string, value: string, options: ReadonlyArray<{ value: string; label: string }>, key: string): InspectorProperty => {
    const list = [...options];
    if (!list.some((option) => option.value === value)) list.push(choice(value, value));
    return { kind: "enum", id: `pgfplots-${idSuffix}`, label, value, options: list, write: write(id, key) };
  };
  const tickColor = sub("tick label style", "color");
  const fixed = hasPathFlag(entries, NUMBER_FORMAT_FIXED) ? "fixed" : "";
  return {
    id: "pgfplots-ticks", title: "Ticks", sourceLevel: "command",
    properties: [
      text("xtick distance", "X tick step", AUTO_PLACEHOLDER),
      text("ytick distance", "Y tick step", AUTO_PLACEHOLDER),
      text("xtick", "X ticks", AUTO_PLACEHOLDER),
      text("ytick", "Y ticks", AUTO_PLACEHOLDER),
      text("xticklabels", "X tick labels", AUTO_PLACEHOLDER),
      enumField("tick-label-size", "Label size", sub("tick label style", "font") ?? "", TICK_FONT_CHOICES, pgfplotsSubstyleKey("tick label style", "font")),
      { kind: "color", id: "pgfplots-tick-label-color", label: "Label color", value: normalizeInspectorColorValue(tickColor), syntaxValue: tickColor, options: colorOptionsForValue(tickColor), write: write(id, pgfplotsSubstyleKey("tick label style", "color")) },
      enumField("xtick-label-rotation", "X rotation", sub("xticklabel style", "rotate") ?? "", ROTATION_CHOICES, pgfplotsSubstyleKey("xticklabel style", "rotate")),
      enumField("number-format", "Numbers", fixed, NUMBER_FORMAT_CHOICES, "/pgf/number format/fixed"),
      text("/pgf/number format/precision", "Precision", "2")
    ]
  };
}

/** The grid lines' colour and dash, for both kinds and for the minor ones (E27). */
function buildGridStyleSection(axis: AxisStatement, id: string): InspectorSection {
  const entries = axis.options?.entries;
  const styleValue = (key: string) => {
    const entry = lastEntry(entries, key);
    return entry?.kind === "kv" ? entry.valueRaw : null;
  };
  const color = (style: string, label: string, idSuffix: string): InspectorProperty => {
    const value = readSubstyle(styleValue(style), "color");
    return { kind: "color", id: `pgfplots-${idSuffix}`, label, value: normalizeInspectorColorValue(value), syntaxValue: value, options: colorOptionsForValue(value), write: write(id, pgfplotsSubstyleKey(style, "color")) };
  };
  const dash = readSubstyle(styleValue("grid style"), "dash") ?? "solid";
  return {
    id: "pgfplots-grid", title: "Grid lines", sourceLevel: "command",
    properties: [
      color("grid style", "Color", "grid-color"),
      { kind: "dashStyle", id: "pgfplots-grid-dash", label: "Dash style", value: DASH_STYLE_OPTIONS.find((option) => option.value === dash)?.value ?? "solid", options: DASH_STYLE_OPTIONS, previewLineWidth: 0.4, write: write(id, pgfplotsSubstyleKey("grid style", "dash")) },
      color("minor grid style", "Minor color", "minor-grid-color")
    ]
  };
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
    { value: "default", label: usesCycle ? `Default (${defaultMark})` : "Default (none)" },
    { value: "none", label: "None" },
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
  const plotType = chartTypeProperty(source, plot.id, elements, parseOptions, "Type");
  const style: InspectorSection = {
    id: "pgfplots-plot-style", title: "Plot", sourceLevel: "command",
    properties: [
      ...(plotType ? [plotType] : []),
      { kind: "color", id: "pgfplots-plot-color", label: "Color", value: stroke, syntaxValue: authored(entries, "color") ?? authored(entries, "draw"), options: colorOptionsForValue(stroke), write: write(id, "color") },
      { kind: "lineWidth", id: "pgfplots-plot-line-width", label: "Line width", value: lineWidth, min: 0.1, max: 6, step: 0.1, presetLabel: lineWidthPresetLabel(lineWidth), write: write(id, "line width") },
      { kind: "dashStyle", id: "pgfplots-plot-dash", label: "Dash style", value: dashStylePresetFromStyle(line?.style.dashArray ?? null, lineWidth), options: DASH_STYLE_OPTIONS, previewLineWidth: lineWidth, write: write(id, "solid") },
      { kind: "enum", id: "pgfplots-plot-mark", label: "Mark", value: isPlotMarkName(markValue) || markValue === "none" || markValue === "default" ? markValue : markValue, options: markOptions, write: write(id, "mark") },
      { kind: "text", id: "pgfplots-plot-mark-size", label: "Mark size", value: authored(entries, "mark size") ?? "", placeholder: PLOT_PLACEHOLDERS.markSize, write: write(id, "mark size") },
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
      { kind: "text", id: "pgfplots-plot-domain", label: "Domain", value: authored(entries, "domain") ?? "", placeholder: PLOT_PLACEHOLDERS.domain, write: write(id, "domain") },
      { kind: "text", id: "pgfplots-plot-samples", label: "Samples", value: authored(entries, "samples") ?? "", placeholder: PLOT_PLACEHOLDERS.samples, write: write(id, "samples") }
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
  const element = elementOfKey(action.key);
  if (element) return applySetAxisElementAction(source, axisId, element, action.value.trim().length > 0 && action.value.trim() !== "false", parseOptions);
  if (action.key === PGFPLOTS_CHART_TYPE_KEY) return applyChangeChartTypeAction(source, elementId, action.value.trim(), parseOptions);
  if (action.key.startsWith(SUBSTYLE_PREFIX)) {
    const [style = "", setting = ""] = action.key.slice(SUBSTYLE_PREFIX.length).split("|");
    const known: SubstyleSetting | undefined = (["font", "color", "rotate", "dash"] as const).find((candidate) => candidate === setting);
    if (!known) return { kind: "unsupported", reason: `Unknown style setting ${setting}.` };
    const existing = lastEntry(resolved.target.options?.entries, style);
    const raw = existing?.kind === "kv" ? existing.valueRaw : null;
    let value = action.value.trim();
    if (known === "dash" && value === "solid" && raw === null) value = "";
    const next = writeSubstyle(raw, known, value);
    const writeKey = existing && existing.kind !== "unknown" ? existing.key : style;
    const result = applySetPropertyActionRaw(source, { elementId, key: writeKey, value: next ?? "" }, parseOptions);
    if (result.kind === "success" || result.kind === "partial") return { ...result, changedSourceIds: [axisId] };
    return result;
  }
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
  if (value.length > 0 && LIST_KEYS.has(key) && !(value.startsWith("{") && value.endsWith("}"))) value = `{${value}}`;
  if (key === NUMBER_FORMAT_FIXED) {
    // A flag: written bare, removed with its separator.
    const present = hasPathFlag(resolved.target.options?.entries, NUMBER_FORMAT_FIXED);
    if ((value.length > 0) === present) return { kind: "success", newSource: unchangedSource(source), patches: [], changedSourceIds: [axisId] };
    if (value.length > 0) {
      const added = applySetPropertyActionRaw(source, { elementId, key: NUMBER_FORMAT_FIXED, value: "true" }, parseOptions);
      return added.kind === "success" || added.kind === "partial" ? { ...added, changedSourceIds: [axisId] } : added;
    }
    const listed = (resolved.target.options?.entries ?? []).filter((candidate) => candidate.raw.trim().length > 0);
    const index = listed.findIndex((candidate) => candidate.raw.trim().toLowerCase() === NUMBER_FORMAT_FIXED);
    const entry = listed[index];
    if (!entry) return { kind: "unsupported", reason: "The number format is set in a way this field cannot change; edit it in the source." };
    const next = listed[index + 1];
    const previous = listed[index - 1];
    // The entry with one separating comma (a comment between entries stays).
    const span = next && !source.slice(entry.span.to, next.span.from).includes("%")
      ? { from: entry.span.from, to: next.span.from }
      : previous ? { from: previous.span.to + source.slice(previous.span.to, entry.span.from).indexOf(","), to: entry.span.to } : entry.span;
    const applied = applyReplacements(source, [{ span, fragment: EMPTY_FRAGMENT }]);
    return { kind: "success", newSource: applied.source, patches: applied.patches, changedSourceIds: [axisId] };
  }
  // Write to the key as authored (`/pgfplots/xmin`), else the plain key.
  const existing = lastEntry(resolved.target.options?.entries, key);
  const writeKey = existing && existing.kind !== "unknown" ? existing.key : key;
  const result = applySetPropertyActionRaw(source, { elementId, key: writeKey, value, ...(action.clearKeys ? { clearKeys: action.clearKeys } : {}) }, parseOptions);
  if (result.kind === "success" || result.kind === "partial") return { ...result, changedSourceIds: [axisId] };
  return result;
}
