/**
 * Change Chart Type: which type switches are offered for one axis or one
 * plot, and the source edits of each (the inspector's Chart type / Plot type
 * fields and the canvas context menu read this list).
 *
 * The owner's rule: offer only switches that are not risky given pgfplots'
 * architecture and what this chart's options do. So a switch is a small,
 * explicit set of "type keys" added and removed, and it is available only
 * when everything else that decides the plot's look is visible to the edit
 * and known to mean the same after it:
 *
 * - The plot's own options hold only type keys, style keys the target keeps
 *   meaningfully (colour, width, dash, marks) and data keys (domain,
 *   samples, `forget plot`, ...). Anything else (a user style, `nodes near
 *   coords`, error bars, `tension`, `fill=<colour>`, ...) refuses with its
 *   name: its interaction with the new type was not measured.
 * - Nothing outside the plot sets the type: no plot-level keys in the axis
 *   options, no `every axis plot`/`every axis plot post` additions, no cycle
 *   list that carries type keys (all read from the evaluated axis, so the
 *   preamble and `\pgfplotsset` before the picture count), no settings in the
 *   axis body except known-safe keys (behaviour AB1/AB2: `smooth`, `only
 *   marks`, `mark` set in the body reach plots at `\end{axis}`), and no
 *   axis scope with options around the plot (AC5: they are appended to the
 *   plot's own).
 * - The plot's input fits the target: `\closedcycle` needs y over ordered x
 *   (not a parametric curve or an unordered list); bars need distinct x and
 *   few enough points that 10pt bars (U3) do not pile up; step and comb plots
 *   are for data points, not samples of an expression.
 * - Bars and areas start at y = 0 (U1, W1): not offered on a log y axis.
 *
 * Axis-level switches (the `CHART_KINDS` list of the insert gallery):
 * Data/Function Plot (lines), Scatter Plot (`only marks` on every plot), Bar
 * Chart (`ybar` on the axis: bar cycle list, ticks, legend images, U5), Stacked
 * Bar Chart (`ybar stacked`, U6: the plots must share their x values), Area
 * Plot (every plot filled to the axis with `\closedcycle`, W1). Log-Scale Plot
 * is the Y scale field of the inspector's Axes section and is not duplicated.
 * Horizontal bars and stacked areas are not offered in this version.
 *
 * Reversibility: each switch only inserts keys at the front of an option
 * list, removes keys the type owns, and adds or removes `\closedcycle`, so
 * A → B → A gives back the exact source for the insert templates
 * (test/pgfplots-chart-type.spec.ts). Elsewhere the result is semantically
 * equal: keys come back at the front of the list, and the companions
 * `fill opacity=0.3` (written with an area) and `mark=none` (kept: marks are
 * the Mark field's business, not the type's) follow the rules below.
 */
import type { AddPlotStatement, AxisBodyItem, AxisStatement, Span } from "../../ast/types.js";
import { axisScopePaths } from "../../ast/walk.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import { getAxisEvaluations, type AxisEvaluation } from "../../pgfplots/evaluate-axis.js";
import { readInlineTable, type InlineTableColumnSeparator } from "../../pgfplots/inline-table.js";
import { BAR_CYCLE_LIST, COLOR_CYCLE_LIST } from "../../pgfplots/model.js";
import { owningAxisId, parseAxisPlotId } from "../../pgfplots/edit-ids.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import type { SceneElement } from "../../semantic/types.js";
import { EMPTY_FRAGMENT, userText } from "../fragment.js";
import { isLikelyBareColorOption } from "../option-mutations.js";
import { normalizeOptionKey } from "../option-key.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import type { EditActionResultLike } from "../result-types.js";
import { findAxisStatement } from "./axis-actions.js";
import { CHART_KINDS, type ChartKindId } from "./chart-kinds.js";
import { applyReplacements, type Replacement } from "./legend-edits.js";

export type PlotTypeId = "line" | "scatter" | "smooth" | "step" | "comb" | "bar" | "area";

/** The per-plot types, in the order the Plot type field lists them. */
export const PLOT_TYPES: ReadonlyArray<{ id: PlotTypeId; label: string }> = [
  { id: "line", label: "Line" },
  { id: "scatter", label: "Scatter" },
  { id: "smooth", label: "Smooth" },
  { id: "step", label: "Step" },
  { id: "comb", label: "Comb" },
  { id: "bar", label: "Bar" },
  { id: "area", label: "Area" }
];

/** One text edit against the source the conversion was computed for. */
export type ChartTypeEdit = { span: Span; text: string };

export type ChartTypeConversion<K extends string> =
  | { kind: K; label: string; current: boolean; available: true; edits: ChartTypeEdit[] }
  | { kind: K; label: string; current: boolean; available: false; reason: string };

/** The key that makes each per-plot type (flags; `area` is `fill` plus `\closedcycle`). */
const TYPE_FLAG: Record<Exclude<PlotTypeId, "line" | "area">, string> = {
  scatter: "only marks",
  smooth: "smooth",
  step: "const plot",
  comb: "ycomb",
  bar: "ybar"
};

/** Keys that change how a plot is drawn which the switch does not manage: a plot with one is left alone. */
const OTHER_TYPE_KEYS = new Set([
  "sharp plot", "const plot mark left", "const plot mark right", "const plot mark mid", "jump mark left", "jump mark right", "jump mark mid",
  "xcomb", "xbar", "ybar interval", "xbar interval", "ybar stacked", "xbar stacked", "stack plots", "area legend", "bar shift", "bar width",
  "line legend", "ybar legend", "xbar legend", "ybar interval legend", "xbar interval legend", "fill between"
]);

/** Style keys every target keeps with the same meaning (colour, stroke, marks). */
const STYLE_KEYS = new Set([
  "color", "draw", "line width", "ultra thin", "very thin", "thin", "semithick", "thick", "very thick", "ultra thick",
  "solid", "dashed", "densely dashed", "loosely dashed", "dotted", "densely dotted", "loosely dotted", "dash dot", "densely dash dot", "loosely dash dot",
  "dash pattern", "dashdotted", "mark", "mark size", "mark options", "mark repeat", "mark phase", "mark indices", "opacity", "draw opacity",
  "no markers", "no marks"
]);

/** Data keys: they choose the points, not how they are drawn. */
const DATA_KEYS = new Set(["domain", "samples", "samples at", "variable", "forget plot", "each nth point", "unbounded coords"]);

/** Keys of an `\addplot table [...]` the switch can see through. */
const TABLE_KEYS = new Set(["x", "y", "x index", "y index", "x expr", "y expr", "header", "col sep", "row sep"]);

/**
 * Axis options a switch leaves meaningful and that do not set a plot's type
 * (descriptions, limits, size, ticks, grid, legend placement, scales).
 */
const SAFE_AXIS_KEYS = new Set([
  "xlabel", "ylabel", "title", "xmin", "xmax", "ymin", "ymax", "width", "height", "scale only axis", "grid", "axis lines",
  "axis x line", "axis y line", "xmode", "ymode", "domain", "samples", "legend pos", "legend style", "legend cell align", "legend columns",
  "symbolic x coords", "xtick", "ytick", "xticklabels", "yticklabels", "xtick distance", "ytick distance", "minor tick num",
  "minor x tick num", "minor y tick num", "enlargelimits", "enlarge x limits", "enlarge y limits", "at", "anchor", "name", "clip",
  "tick label style", "xticklabel style", "yticklabel style", "x tick label style", "y tick label style", "label style", "grid style",
  "major grid style", "minor grid style", "xmajorgrids", "ymajorgrids", "xminorgrids", "yminorgrids", "scale", "compat",
  "xtick align", "ytick align", "tick align", "x tick label as interval", "title style", "xlabel style", "ylabel style",
  "/pgf/number format/precision", "/pgf/number format/fixed", "/pgf/number format/sci", "/pgf/number format/fixed zerofill",
  "/pgf/number format/1000 sep", "log basis x", "log basis y", "bar width"
]);

/** Axis keys that make the plots bars; the axis-level switch writes `ybar` and `ybar stacked` only. */
const AXIS_BAR_KEYS = new Set(["ybar", "ybar stacked", "xbar", "xbar stacked", "ybar interval", "xbar interval", "stack plots", "area style"]);

/** The most points a bar plot gets: 10pt bars (U3) on the default 240pt axis start to overlap beyond this. */
const MAX_BAR_POINTS = 30;

function plain(key: string): string {
  return normalizeOptionKey(key).replace(/^\/pgfplots\//u, "").replace(/^\/tikz\//u, "");
}

type KeyedEntry = Extract<OptionEntry, { kind: "kv" | "flag" }>;

function keyed(entry: OptionEntry): KeyedEntry | null {
  return entry.kind === "kv" || entry.kind === "flag" ? entry : null;
}

function valueOf(entry: KeyedEntry): string | null {
  if (entry.kind === "flag") return null;
  let text = entry.valueRaw.trim();
  while (text.startsWith("{") && text.endsWith("}")) text = text.slice(1, -1).trim();
  return text;
}

/** A flag written as `key` or `key=true`. */
function isOnFlag(entry: KeyedEntry): boolean {
  return entry.kind === "flag" || valueOf(entry) === "true";
}

const code = (text: string) => `\`${text}\``;

// ---------------------------------------------------------------------------
// Reading the plot's type.

type PlotReading =
  | { kind: "type"; type: PlotTypeId; entries: OptionEntry[] }
  | { kind: "refused"; reason: string };

/** The type a plot's own options and trailing path give it, or why the switch leaves it alone. */
function readPlotType(source: string, plot: AddPlotStatement): PlotReading {
  if (plot.dimension === 3) return { kind: "refused", reason: "Type switching is for 2D plots; this is an `\\addplot3`." };
  if (plot.extraOptions?.length || plot.legacyPlot) return { kind: "refused", reason: "The plot has more than one option list; edit its type in the source." };
  const entries = plot.options?.entries ?? [];
  const found = new Set<PlotTypeId>();
  let fillFlag = false;
  for (const entry of entries) {
    if (entry.raw.trim().length === 0) continue;
    const kv = keyed(entry);
    if (!kv) return { kind: "refused", reason: `The plot option ${code(entry.raw.trim())} is not one the type switch knows.` };
    const key = plain(kv.key);
    const typeOf = (Object.entries(TYPE_FLAG) as Array<[PlotTypeId, string]>).find(([, flag]) => flag === key)?.[0];
    if (typeOf) {
      if (!isOnFlag(kv)) return { kind: "refused", reason: `The plot option ${code(kv.raw.trim())} is not one the type switch knows.` };
      found.add(typeOf);
      continue;
    }
    if (key === "fill") {
      if (kv.kind === "kv") return { kind: "refused", reason: `The plot has its own fill colour (${code(kv.raw.trim())}); a type switch would drop or misuse it.` };
      fillFlag = true;
      continue;
    }
    if (key === "fill opacity") continue;
    if (OTHER_TYPE_KEYS.has(key)) return { kind: "refused", reason: `The plot is drawn with ${code(kv.raw.trim())}, a type the switch does not change.` };
    if (STYLE_KEYS.has(key) || DATA_KEYS.has(key)) continue;
    if (kv.kind === "flag" && isLikelyBareColorOption(kv.raw.trim())) continue;
    return { kind: "refused", reason: `The plot option ${code(kv.raw.trim())} is not one the type switch knows; its effect on another type was not checked.` };
  }
  const trailing = plot.trailingPath ? source.slice(plot.trailingPath.span.from, plot.trailingPath.span.to).trim() : "";
  if (trailing.length > 0 && trailing !== "\\closedcycle") return { kind: "refused", reason: "The plot continues with a path after its data; edit its type in the source." };
  if (trailing === "\\closedcycle" || fillFlag) {
    if (!(trailing === "\\closedcycle" && fillFlag) || found.size > 0) return { kind: "refused", reason: "The plot is filled or closed in a way the type switch does not recognise (an area is `fill` with `\\closedcycle`)." };
    return { kind: "type", type: "area", entries };
  }
  if (found.size > 1) return { kind: "refused", reason: `The plot combines ${[...found].map((type) => code(TYPE_FLAG[type as keyof typeof TYPE_FLAG])).join(" and ")}; edit its type in the source.` };
  const [type = "line"] = [...found];
  return { kind: "type", type, entries };
}

// ---------------------------------------------------------------------------
// The axis context.

type AxisContext = {
  source: string;
  axis: AxisStatement;
  evaluation: AxisEvaluation | null;
  /** Why no plot of this axis can switch (settings the edit cannot see through), if any. */
  blocked: string | null;
  /** The axis bar style (`ybar`, ...) written in the axis options, if any. */
  barKey: KeyedEntry | null;
  logY: boolean;
  /** Plots inside an axis scope with options: their type is partly the scope's. */
  scopedPlots: Set<string>;
  /** The cycle list the plots get once an axis bar style is removed (the bar cycle list goes with it, U5). */
  cycleWithoutBars: readonly string[];
  /** Each plot's data, read once (a large inline table is read for every target type otherwise). */
  dataCache: Map<string, PlotData>;
};

function axisEntries(axis: AxisStatement): OptionEntry[] {
  return (axis.options?.entries ?? []).filter((entry) => entry.raw.trim().length > 0);
}

function readAxisContext(source: string, axis: AxisStatement, evaluation: AxisEvaluation | null): AxisContext {
  let blocked: string | null = null;
  let barKey: KeyedEntry | null = null;
  for (const entry of axisEntries(axis)) {
    const kv = keyed(entry);
    const key = kv ? plain(kv.key) : "";
    if (kv && AXIS_BAR_KEYS.has(key)) {
      if (barKey) blocked ??= "The axis has more than one bar style; edit its type in the source.";
      barKey = kv;
      if ((key === "ybar" || key === "ybar stacked") && kv.kind === "kv") blocked ??= `The axis option ${code(kv.raw.trim())} sets a bar gap; the switch writes only plain ${code(key)}.`;
      if (key !== "ybar" && key !== "ybar stacked") blocked ??= `The axis is drawn with ${code(kv.raw.trim())}, a type the switch does not change.`;
      continue;
    }
    if (!kv || !SAFE_AXIS_KEYS.has(key)) blocked ??= `The axis option ${code(entry.raw.trim())} is not one the type switch knows; it may set the plots' type.`;
  }
  // Settings in the body reach plots when the axis ends (AB2): only known-safe keys are allowed there.
  for (const item of axis.body) {
    const list = settingsList(item);
    if (!list) continue;
    for (const entry of list.entries) {
      if (entry.raw.trim().length === 0) continue;
      const kv = keyed(entry);
      const key = kv ? plain(kv.key) : "";
      if (!kv || !(SAFE_AXIS_KEYS.has(key) || DATA_KEYS.has(key)) || AXIS_BAR_KEYS.has(key)) {
        blocked ??= `The axis body sets ${code(entry.raw.trim())} (behaviour: such settings reach the plots when the axis ends); edit the type in the source.`;
      }
    }
  }
  if (!evaluation) blocked ??= "The axis has not been drawn yet.";
  else {
    const model = evaluation.model;
    // Plot keys given to the whole axis, the plot styles and the cycle list: read from the evaluated
    // axis, so styles from the preamble or a `\pgfplotsset` before the picture count too.
    const plotDefault = model.plotDefaults.find((use) => use.key.trim().length > 0 && !DATA_KEYS.has(plain(use.key)));
    if (plotDefault) blocked ??= `The axis gives every plot ${code(plotDefault.key)}; change the type in the source.`;
    for (const style of ["every axis plot", "every axis plot post"]) {
      const lists = model.styles.get(style) ?? [];
      const touched = lists.some((list) => list.entries.some((entry) => entry.raw.trim().length > 0));
      if (touched) blocked ??= `${code(style)} is set for this axis; its keys may set the plots' type.`;
    }
    const cycleIsDefault = model.cycleList.length === COLOR_CYCLE_LIST.length && model.cycleList.every((entry, index) => entry === COLOR_CYCLE_LIST[index]);
    if (!cycleIsDefault && !barKey) {
      const typed = model.cycleList.find((entry) => /only marks|smooth|const plot|comb|bar|fill|stack/u.test(entry));
      if (typed !== undefined) blocked ??= `The cycle list sets ${code(typed)}; a type switch would fight it.`;
    }
  }
  const logY = evaluation ? evaluation.model.y.mode === "log" : axis.environment === "semilogyaxis" || axis.environment === "loglogaxis";
  const scopedPlots = new Set<string>();
  const scopes = axisScopePaths(axis);
  const scopeOptions = new Map(axis.body.flatMap((item) => (item.kind === "AxisScopeBegin" ? [[item.id, item.options?.entries.some((entry) => entry.raw.trim().length > 0) ?? false] as const] : [])));
  for (const item of axis.body) {
    if (item.kind !== "AddPlot") continue;
    const ids = (scopes.get(item.id) ?? "").split("/").filter((id) => id.length > 0);
    if (ids.some((id) => scopeOptions.get(id))) scopedPlots.add(item.id);
  }
  const cycle = evaluation?.model.cycleList ?? [];
  const isBarCycle = cycle.length === BAR_CYCLE_LIST.length && cycle.every((entry, index) => entry === BAR_CYCLE_LIST[index]);
  const cycleWithoutBars = barKey && isBarCycle ? COLOR_CYCLE_LIST : cycle;
  return { source, axis, evaluation, blocked, barKey, logY, scopedPlots, cycleWithoutBars, dataCache: new Map() };
}

function settingsList(item: AxisBodyItem): OptionListAst | null {
  if (item.kind === "PgfplotsSet" || item.kind === "TikzSet" || item.kind === "Pgfkeys") return item.optionList;
  return null;
}

// ---------------------------------------------------------------------------
// The data a plot draws, as far as the source shows it.

type PlotData = { xs: string[] | null; count: number | null; ordered: boolean | null };

function tableSeparator(raw: string | null): InlineTableColumnSeparator | null {
  if (raw === null) return "space";
  const known: Record<string, InlineTableColumnSeparator> = { space: "space", tab: "tab", comma: "comma", colon: "colon", semicolon: "semicolon", "&": "ampersand", ampersand: "ampersand" };
  return known[raw] ?? null;
}

function readPlotData(context: AxisContext, plot: AddPlotStatement): PlotData {
  const cached = context.dataCache.get(plot.id);
  if (cached) return cached;
  const data = readPlotDataUncached(context, plot);
  context.dataCache.set(plot.id, data);
  return data;
}

function readPlotDataUncached(context: AxisContext, plot: AddPlotStatement): PlotData {
  const { source } = context;
  const input = plot.input;
  if (input.kind === "coordinates") {
    const xs = input.points.map((point) => point.components[0]?.raw.trim() ?? "");
    return { xs, count: xs.length, ordered: isOrdered(context, xs) };
  }
  if (input.kind === "expression") {
    const own = (plot.options?.entries ?? []).map(keyed).find((entry) => entry && plain(entry.key) === "samples");
    const axisSamples = axisEntries(context.axis).map(keyed).find((entry) => entry && plain(entry.key) === "samples");
    const samples = Number((own && valueOf(own)) ?? (axisSamples && valueOf(axisSamples)) ?? "25");
    return { xs: null, count: Number.isFinite(samples) ? samples : null, ordered: true };
  }
  if (input.kind === "table" && input.source.kind === "inline") {
    const options = new Map((input.options?.entries ?? []).flatMap((entry) => { const kv = keyed(entry); return kv ? [[plain(kv.key), valueOf(kv)] as const] : []; }));
    if ([...options.keys()].some((key) => !TABLE_KEYS.has(key))) return { xs: null, count: null, ordered: null };
    if (options.has("x expr") || options.has("y expr")) return { xs: null, count: null, ordered: null };
    const separator = tableSeparator(options.get("col sep") ?? null);
    const rowSep = options.get("row sep");
    if (!separator || (rowSep !== undefined && rowSep !== "\\\\" && rowSep !== "crcr" && rowSep !== "newline")) return { xs: null, count: null, ordered: null };
    const reading = readInlineTable(source, input.source.span.from, input.source.span.to, { columnSeparator: separator, rowSeparator: rowSep === undefined || rowSep === "newline" ? "newline" : "\\\\" });
    const xName = options.get("x");
    let column = Number(options.get("x index") ?? "0");
    if (xName !== undefined && xName !== null) column = reading.header?.cells.findIndex((cell) => cell.raw.trim() === xName) ?? -1;
    if (!(column >= 0)) return { xs: null, count: null, ordered: null };
    const xs = reading.rows.map((row) => row.cells[column]?.raw.trim() ?? "");
    return { xs, count: xs.length, ordered: isOrdered(context, xs) };
  }
  return { xs: null, count: null, ordered: null };
}

/** Whether x values are non-decreasing (numbers, or names in `symbolic x coords` order). */
function isOrdered(context: AxisContext, xs: readonly string[]): boolean | null {
  const numbers = xs.map((x) => Number(x));
  if (numbers.every((value) => Number.isFinite(value))) return numbers.every((value, index) => index === 0 || value >= (numbers[index - 1] ?? value));
  const symbolic = axisEntries(context.axis).map(keyed).find((entry) => entry && plain(entry.key) === "symbolic x coords");
  if (!symbolic) return null;
  const names = (valueOf(symbolic) ?? "").split(",").map((name) => name.trim());
  const positions = xs.map((x) => names.indexOf(x));
  if (positions.some((position) => position < 0)) return null;
  return positions.every((value, index) => index === 0 || value >= (positions[index - 1] ?? value));
}

// ---------------------------------------------------------------------------
// Edits.

/**
 * Edits of one option list: remove entries (with one separating comma, never
 * a comment), insert keys at the front. `empty` says what an emptied list
 * becomes: removed with the `+` of `\addplot+`, or removed alone (an axis), or
 * kept as `[]` (`\addplot[]` ignores the cycle list, unlike `\addplot`).
 */
function listEdits(source: string, list: OptionListAst | undefined, remove: readonly OptionEntry[], insert: readonly string[], at: { whenMissing: number; prefix: string; emptySpan: Span | null }): ChartTypeEdit[] {
  if (!list) return insert.length > 0 ? [{ span: { from: at.whenMissing, to: at.whenMissing }, text: `${at.prefix}[${insert.join(", ")}]` }] : [];
  const entries = list.entries.filter((entry) => entry.raw.trim().length > 0);
  const removed = new Set(remove);
  const kept = entries.filter((entry) => !removed.has(entry));
  if (kept.length === 0) {
    if (insert.length > 0) return [{ span: { from: list.span.from + 1, to: list.span.to - 1 }, text: insert.join(", ") }];
    return at.emptySpan ? [{ span: at.emptySpan, text: "" }] : [{ span: { from: list.span.from + 1, to: list.span.to - 1 }, text: "" }];
  }
  const edits: ChartTypeEdit[] = [];
  // Runs of consecutive removed entries: `a, b, ` up to the next entry, or `, a, b` back to the previous one at the end.
  let index = 0;
  while (index < entries.length) {
    const first = entries[index];
    if (!first || !removed.has(first)) { index += 1; continue; }
    let last = index;
    while (last + 1 < entries.length && removed.has(entries[last + 1] as OptionEntry)) last += 1;
    const lastEntry = entries[last] as OptionEntry;
    const following = entries[last + 1];
    const previous = entries[index - 1];
    if (following) {
      const span = { from: first.span.from, to: following.span.from };
      if (!source.slice(span.from, span.to).includes("%")) edits.push({ span, text: "" });
      else {
        // A comment in the way stays: remove each entry with the comma after it.
        for (const entry of entries.slice(index, last + 1)) {
          const after = source.indexOf(",", entry.span.to);
          let to = after >= 0 ? after + 1 : entry.span.to;
          while (source[to] === " " || source[to] === "\t") to += 1;
          edits.push({ span: { from: entry.span.from, to }, text: "" });
        }
      }
    } else if (previous) {
      const comma = source.lastIndexOf(",", first.span.from);
      const span = { from: comma >= previous.span.to ? comma : previous.span.to, to: lastEntry.span.to };
      if (!source.slice(span.from, span.to).includes("%")) edits.push({ span, text: "" });
      else {
        for (const entry of entries.slice(index, last + 1)) {
          const before = source.lastIndexOf(",", entry.span.from);
          edits.push({ span: { from: before, to: before + 1 }, text: "" }, { span: entry.span, text: "" });
        }
      }
    }
    index = last + 1;
  }
  if (insert.length > 0) edits.push({ span: { from: list.span.from + 1, to: list.span.from + 1 }, text: `${insert.join(", ")}, ` });
  return mergeAdjacentRemovals(edits);
}

/** Consecutive removed entries produce touching spans; keep them as one edit each, without overlaps. */
function mergeAdjacentRemovals(edits: ChartTypeEdit[]): ChartTypeEdit[] {
  const sorted = [...edits].sort((a, b) => a.span.from - b.span.from || a.span.to - b.span.to);
  const out: ChartTypeEdit[] = [];
  for (const edit of sorted) {
    const last = out.at(-1);
    if (last && last.text === "" && edit.text === "" && edit.span.from < last.span.to) {
      last.span = { from: last.span.from, to: Math.max(last.span.to, edit.span.to) };
      continue;
    }
    out.push({ span: { ...edit.span }, text: edit.text });
  }
  return out;
}

function plotListEdits(source: string, plot: AddPlotStatement, remove: readonly OptionEntry[], insert: readonly string[]): ChartTypeEdit[] {
  const emptySpan = plot.increment && plot.optionsSpan ? { from: plot.incrementSpan?.from ?? plot.optionsSpan.from, to: plot.optionsSpan.to } : null;
  // A plot without options takes the cycle list; `+[…]` keeps it (behaviour G2).
  return listEdits(source, plot.options, remove, insert, { whenMissing: plot.commandSpan.to, prefix: "+", emptySpan });
}

/** The keys the switch writes for each target (after removing the current type's keys). */
const TARGET_KEYS: Record<PlotTypeId, string[]> = {
  line: [],
  scatter: ["only marks"],
  smooth: ["smooth"],
  step: ["const plot"],
  comb: ["ycomb"],
  bar: ["ybar"],
  // W1/W5: filled to the axis with a light fill; the editor's area template writes the same.
  area: ["fill", "fill opacity=0.3"]
};

function typeEntries(type: PlotTypeId, entries: readonly OptionEntry[]): OptionEntry[] {
  return entries.filter((entry) => {
    const kv = keyed(entry);
    if (!kv) return false;
    const key = plain(kv.key);
    if (type === "area") return key === "fill" || (key === "fill opacity" && valueOf(kv) === "0.3");
    return type !== "line" && key === TYPE_FLAG[type];
  });
}

/** Whether the plot draws marks after the switch to scatter (else `only marks` would draw nothing). */
function scatterMarks(context: AxisContext, plot: AddPlotStatement, entries: readonly OptionEntry[]): string | null {
  for (const entry of entries) {
    const kv = keyed(entry);
    if (!kv) continue;
    const key = plain(kv.key);
    if (key === "no markers" || key === "no marks" || (key === "mark" && valueOf(kv) === "none")) {
      return `The plot has ${code(kv.raw.trim())}: as a scatter plot it would draw nothing. Choose a Mark first.`;
    }
  }
  if (entries.some((entry) => { const kv = keyed(entry); return kv && plain(kv.key) === "mark"; })) return null;
  if (!plot.increment && plot.options) return "`\\addplot[…]` without `+` ignores the cycle list and has no marks: as a scatter plot it would draw nothing. Choose a Mark first.";
  const cycle = context.cycleWithoutBars;
  const index = context.axis.body.filter((item) => item.kind === "AddPlot").indexOf(plot);
  const entry = cycle.length > 0 ? cycle[(index + (context.evaluation?.model.cycleListShift ?? 0)) % cycle.length] ?? "" : "";
  if (!/mark=(?!none)/u.test(entry)) return "The cycle list gives this plot no marks: as a scatter plot it would draw nothing. Choose a Mark first.";
  return null;
}

/** Whether the plot draws marks now: its own `mark=`, else the cycle list's (behaviour G1/G2). */
function drawsMarks(context: AxisContext, plot: AddPlotStatement, entries: readonly OptionEntry[], cycle: readonly string[]): boolean {
  let own: string | null = null;
  for (const entry of entries) {
    const kv = keyed(entry);
    if (!kv) continue;
    const key = plain(kv.key);
    if (key === "no markers" || key === "no marks") return false;
    if (key === "mark") own = valueOf(kv);
  }
  if (own !== null) return own !== "none";
  if (!plot.increment && plot.options) return false;
  const index = context.axis.body.filter((item) => item.kind === "AddPlot").indexOf(plot);
  const entry = cycle.length > 0 ? cycle[(index + (context.evaluation?.model.cycleListShift ?? 0)) % cycle.length] ?? "" : "";
  return /mark=(?!none)/u.test(entry);
}

function legendDrawn(context: AxisContext): boolean {
  return context.evaluation?.legend.pairing.some((pairing) => pairing.drawn) ?? false;
}

type PlotPlan = { edits: ChartTypeEdit[] } | { reason: string };

/** The edits that turn one plot into `target`, or why not. `axisLevel`: the axis switch handles an axis bar style. */
function planPlot(context: AxisContext, plot: AddPlotStatement, target: PlotTypeId, axisLevel: boolean): PlotPlan {
  if (context.blocked) return { reason: context.blocked };
  if (context.scopedPlots.has(plot.id)) return { reason: "The plot is inside a `scope` whose options apply to it (behaviour AC5); edit its type in the source." };
  if (!axisLevel && context.barKey) return { reason: `The axis makes its plots bars (${code(context.barKey.raw.trim())}): change the Chart type of the axis.` };
  const reading = readPlotType(context.source, plot);
  if (reading.kind === "refused") return { reason: reading.reason };
  const input = plot.input.kind;
  if (input === "other") return { reason: "The plot's input is not coordinates, a table or an expression." };
  if (input === "table" && plot.input.kind === "table" && (plot.input.options?.entries ?? []).some((entry) => { const kv = keyed(entry); return !kv || !TABLE_KEYS.has(plain(kv.key)); })) {
    return { reason: "The table has options the type switch does not know." };
  }
  if (reading.type === target) return { edits: [] };
  const data = readPlotData(context, plot);
  if (target === "step" || target === "comb") {
    if (input === "expression" || input === "parametric") return { reason: `${target === "step" ? "Step" : "Comb"} plots draw data points; this plot samples ${input === "expression" ? "an expression" : "a curve"}.` };
  }
  if (target === "comb" && !context.logY) {
    // Checked against LuaLaTeX (E26): with 0 outside the y range TeX starts the comb lines at the
    // axis' internal origin, which the editor does not reproduce; with 0 inside they match.
    const limits = context.evaluation?.layout.limits;
    if (!limits || !(limits.ymin <= 0 && limits.ymax >= 0)) return { reason: "The y range does not include 0: TeX starts comb lines elsewhere than the editor draws them there. Set Y min to 0 or below first." };
  }
  if (target === "bar" && !axisLevel && legendDrawn(context)) {
    // E26: a `ybar` plot in a line chart with a legend: TeX lays out its legend row differently
    // from the editor (1.5pt to 3pt), so it is not offered there.
    return { reason: "In a chart with a legend TeX lays out a single bar plot (its legend entry and bar) differently from the editor; not offered here. Bar Chart on the axis is." };
  }
  if (target === "scatter") {
    if (input === "expression") return { reason: "A scatter of an expression's samples is not offered: make it a data plot first." };
    const marks = scatterMarks(context, plot, reading.entries);
    if (marks) return { reason: marks };
  }
  if (target === "area" || target === "bar") {
    if (context.logY) return { reason: `${target === "area" ? "Areas" : "Bars"} start at y = 0, which a log axis does not have.` };
    if (input === "parametric") return { reason: `A parametric curve has no y over ordered x to ${target === "area" ? "fill down to the axis" : "draw as bars"}.` };
  }
  if (target === "area" && data.ordered !== true) {
    return { reason: data.ordered === false ? "The x values are not in order: `\\closedcycle` would fill a tangle." : "The editor cannot see this plot's x values to check their order." };
  }
  if (target === "bar") {
    if (data.count === null) return { reason: "The editor cannot see this plot's points to check they fit as bars." };
    if (data.count > MAX_BAR_POINTS) return { reason: `${String(data.count)} points: bars 10pt wide would overlap. Use fewer points (at most ${String(MAX_BAR_POINTS)}).` };
    if (data.xs && new Set(data.xs).size !== data.xs.length) return { reason: "Some x values repeat: their bars would be drawn over each other." };
  }
  const remove = typeEntries(reading.type, reading.entries);
  const has = (key: string) => reading.entries.some((entry) => { const kv = keyed(entry); return kv !== null && plain(kv.key) === plain(key.split("=")[0] ?? key); });
  const insert = TARGET_KEYS[target].filter((key) => !has(key) || remove.some((entry) => { const kv = keyed(entry); return kv && plain(kv.key) === plain(key.split("=")[0] ?? key); }));
  const edits = plotListEdits(context.source, plot, remove, insert);
  if (reading.type === "area" && plot.trailingPath) edits.push({ span: { from: plot.input.span.to, to: plot.trailingPath.span.to }, text: "" });
  if (target === "area") edits.push({ span: { from: plot.input.span.to, to: plot.input.span.to }, text: " \\closedcycle" });
  return { edits };
}

// ---------------------------------------------------------------------------
// Public API.

function plotsOf(axis: AxisStatement): AddPlotStatement[] {
  return axis.body.filter((item): item is AddPlotStatement => item.kind === "AddPlot");
}

/** The per-plot switches of one plot: every type with its edits or the reason it is not offered. */
export function plotTypeConversions(source: string, axis: AxisStatement, plot: AddPlotStatement, evaluation: AxisEvaluation | null): Array<ChartTypeConversion<PlotTypeId>> {
  const context = readAxisContext(source, axis, evaluation);
  const reading = readPlotType(source, plot);
  const current = reading.kind === "type" && !context.barKey ? reading.type : null;
  return PLOT_TYPES.map(({ id, label }) => {
    if (current === id) return { kind: id, label, current: true, available: false, reason: "This is the plot's type." };
    const plan = planPlot(context, plot, id, false);
    return "reason" in plan ? { kind: id, label, current: false, available: false, reason: plan.reason } : { kind: id, label, current: false, available: true, edits: plan.edits };
  });
}

/** What kind of chart an axis is, by the same type keys (null: mixed or not one of the kinds). */
function currentAxisKind(context: AxisContext): ChartKindId | null {
  const plots = plotsOf(context.axis);
  const barKey = context.barKey ? plain(context.barKey.key) : null;
  const types = plots.map((plot) => readPlotType(context.source, plot));
  if (barKey === "ybar stacked") return "stacked-bar";
  if (barKey === "ybar") return "bar";
  if (barKey !== null || plots.length === 0) return null;
  const all = (type: PlotTypeId) => types.every((reading) => reading.kind === "type" && reading.type === type);
  if (all("scatter")) return "scatter";
  if (all("area")) return "area";
  if (!all("line")) return null;
  if (context.logY) return "semilogy";
  return plots.every((plot) => plot.input.kind === "expression") ? "function" : "data";
}

/** Edits of the axis' own bar key: add, replace or remove `ybar`/`ybar stacked`. */
function axisBarEdits(context: AxisContext, target: "ybar" | "ybar stacked" | null): ChartTypeEdit[] {
  const { axis, barKey } = context;
  if (barKey && target) return plain(barKey.key) === target ? [] : [{ span: barKey.span, text: target }];
  if (barKey) return listEdits(context.source, axis.options, [barKey], [], { whenMissing: axis.beginSpan.to, prefix: "", emptySpan: axis.optionsSpan ?? null });
  if (target) return listEdits(context.source, axis.options, [], [target], { whenMissing: axis.beginSpan.to, prefix: "", emptySpan: null });
  return [];
}

/**
 * The axis-level switches (the insert gallery's `CHART_KINDS`): each
 * available kind with its edits, the others with the reason. With `plotId`,
 * the per-plot list is `plotTypeConversions`.
 */
export function chartTypeConversions(source: string, axis: AxisStatement, evaluation: AxisEvaluation | null): Array<ChartTypeConversion<ChartKindId>> {
  const context = readAxisContext(source, axis, evaluation);
  const current = currentAxisKind(context);
  const plots = plotsOf(axis);
  return CHART_KINDS.map(({ id, label }): ChartTypeConversion<ChartKindId> => {
    const refuse = (reason: string): ChartTypeConversion<ChartKindId> => ({ kind: id, label, current: false, available: false, reason });
    if (current === id) return { kind: id, label, current: true, available: false, reason: "This is the chart's type." };
    if (id === "semilogy") return refuse("Log scales are set with X scale and Y scale in the Axes section.");
    if (plots.length === 0) return refuse("The axis has no plots.");
    if (context.blocked) return refuse(context.blocked);
    const expressions = plots.filter((plot) => plot.input.kind === "expression").length;
    if (id === "function" && expressions < plots.length) return refuse("Function Plot is the line chart of expression plots; this chart plots data, so its line chart is Data Plot.");
    if (id === "data" && expressions === plots.length) return refuse("Data Plot is the line chart of data; this chart plots expressions, so its line chart is Function Plot.");
    if ((id === "function" || id === "data") && context.logY) return refuse("This is a line chart on a log axis; the scale is the Y scale field in the Axes section.");
    // The static part of the rule (CHART_KINDS `convertibleFrom`).
    const kind = CHART_KINDS.find((candidate) => candidate.id === id);
    if (current !== null && kind?.convertibleFrom && !kind.convertibleFrom(current)) {
      return refuse(`A ${CHART_KINDS.find((candidate) => candidate.id === current)?.label ?? current} does not switch to ${label}.`);
    }
    const plotTarget: PlotTypeId = id === "scatter" ? "scatter" : id === "area" ? "area" : "line";
    const edits: ChartTypeEdit[] = [];
    for (const plot of plots) {
      const plan = planPlot(context, plot, plotTarget, true);
      if ("reason" in plan) return refuse(plots.length > 1 ? `Plot ${String(plots.indexOf(plot) + 1)}: ${plan.reason}` : plan.reason);
      // Bars: the plot's data must suit bars too (checked as a per-plot bar switch would).
      if (id === "bar" || id === "stacked-bar") {
        // E26: plots with their own marks in a bar chart with a legend: TeX sizes the legend rows
        // differently from the editor (up to 3.3pt), so not offered.
        const reading = readPlotType(source, plot);
        if (legendDrawn(context) && reading.kind === "type" && drawsMarks(context, plot, reading.entries, [])) {
          return refuse(`${plots.length > 1 ? `Plot ${String(plots.indexOf(plot) + 1)} has` : "The plot has"} its own mark: TeX lays out the legend of a bar chart with marks differently from the editor. Set its Mark to None first.`);
        }
        const check = planPlot({ ...context, barKey: null }, plot, "bar", true);
        if ("reason" in check) return refuse(plots.length > 1 ? `Plot ${String(plots.indexOf(plot) + 1)}: ${check.reason}` : check.reason);
      }
      edits.push(...plan.edits);
    }
    if (id === "stacked-bar") {
      // U6: stacking adds coordinate by coordinate; plots with different x values do not stack as bars.
      const xs = plots.map((plot) => readPlotData(context, plot).xs?.join("\u0000") ?? null);
      if (xs.some((value) => value === null) || new Set(xs).size > 1) return refuse("Stacked bars need every plot to have the same x values.");
    }
    edits.push(...axisBarEdits(context, id === "bar" ? "ybar" : id === "stacked-bar" ? "ybar stacked" : null));
    return { kind: id, label, current: false, available: true, edits };
  });
}

/** For the inspector and the menus: the switches of the selected axis or plot, from a drawn scene. */
export function readChartTypeConversions(
  source: string,
  elementId: string,
  elements: readonly SceneElement[],
  parseOptions: EditParseOptions = {}
): { scope: "axis"; options: Array<ChartTypeConversion<ChartKindId>> } | { scope: "plot"; options: Array<ChartTypeConversion<PlotTypeId>> } | null {
  const axisId = owningAxisId(elementId);
  if (!axisId) return null;
  const parsed = parseTikzForEdit(source, parseOptions);
  const axis = findAxisStatement(parsed.figure.body, axisId);
  if (!axis) return null;
  // A scene from an incremental update may not carry the axis evaluation; evaluate then.
  const evaluation = getAxisEvaluations(elements).find((candidate) => candidate.axisId === axisId)
    ?? getAxisEvaluations(evaluateTikzFigure(parsed.figure, source).scene.elements).find((candidate) => candidate.axisId === axisId)
    ?? null;
  if (parseAxisPlotId(elementId)) {
    const plot = plotsOf(axis).find((candidate) => candidate.id === elementId);
    return plot ? { scope: "plot", options: plotTypeConversions(source, axis, plot, evaluation) } : null;
  }
  return elementId === axisId ? { scope: "axis", options: chartTypeConversions(source, axis, evaluation) } : null;
}

export function isPlotTypeId(value: string): value is PlotTypeId {
  return PLOT_TYPES.some((type) => type.id === value);
}

/**
 * Applies one switch: `elementId` is an axis (`kind` a chart kind) or a plot
 * (`kind` a plot type). Re-evaluates the source, so the answer is the one the
 * menus showed for it. One source change, so one undo step.
 */
export function applyChangeChartTypeAction(source: string, elementId: string, kind: string, parseOptions: EditParseOptions = {}): EditActionResultLike {
  const parsed = parseTikzForEdit(source, parseOptions);
  const elements = evaluateTikzFigure(parsed.figure, source).scene.elements;
  const conversions = readChartTypeConversions(source, elementId, elements, parseOptions);
  if (!conversions) return { kind: "unsupported", reason: "Select an axis or a plot to change its type." };
  const option = (conversions.options as Array<ChartTypeConversion<string>>).find((candidate) => candidate.kind === kind);
  if (!option) return { kind: "unsupported", reason: `Unknown chart type ${kind}.` };
  if (!option.available) return { kind: "unsupported", reason: option.reason };
  const axisId = owningAxisId(elementId) ?? elementId;
  const replacements: Replacement[] = option.edits.map((edit) => ({ span: edit.span, fragment: edit.text.length > 0 ? userText(edit.text, "inspector-value") : EMPTY_FRAGMENT }));
  const applied = applyReplacements(source, replacements);
  return { kind: "success", newSource: applied.source, patches: applied.patches, changedSourceIds: [axisId], selectedSourceIds: [elementId] };
}
