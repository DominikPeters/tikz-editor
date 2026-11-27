/**
 * Stage 1 of the axis pipeline (design/pgfplots.md 4.2): resolve the
 * `\pgfplotsset` settings, `every axis` styles and the environment's own
 * options into a typed `AxisModel`, and each `\addplot`'s options (with the
 * cycle list) into a `PlotModel`. Pure: no scene, no text engine.
 */
import type { AddPlotStatement, AxisStatement, Span } from "../ast/types.js";
import { parseOptionListRaw } from "../options/parse.js";
import type { OptionEntry, OptionListAst } from "../options/types.js";
import { parseLength } from "../semantic/coords/parse-length.js";
import { evaluatePgfMathExpression } from "../semantic/pgfmath/evaluator.js";
import { DOCUMENTED_PGFPLOTS_KEYS } from "./documented-keys.generated.js";
import {
  cloneStyleRegistry,
  createInitialStyleRegistry,
  expandPgfplotsOptions,
  type PgfplotsKeyUse,
  type PgfplotsStyleRegistry
} from "./keys.js";

/** `enlarge x limits` (behaviour H1, H4). */
export type EnlargeSpec =
  | { kind: "auto" }
  | { kind: "rel"; value: number; lower: boolean; upper: boolean }
  | { kind: "abs"; value: number; lower: boolean; upper: boolean }
  | { kind: "dimension"; value: number; lower: boolean; upper: boolean };

/** What a `xtick=…` says (behaviour I4). */
export type TickListSpec =
  | { kind: "auto" }
  | { kind: "empty" }
  | { kind: "data" }
  | { kind: "list"; raw: string };

export type AxisDirectionModel = {
  min?: number;
  max?: number;
  enlarge: EnlargeSpec;
  ticks: TickListSpec;
  /** `xticklabels={…}`: entries by tick index. */
  tickLabels?: string[];
  tickDistance?: number;
  minorTickNum: number;
  minorTicks?: TickListSpec;
  majorGrids: boolean;
  minorGrids: boolean;
  tickAlign: "inside" | "outside" | "center";
  tickPos: "both" | "lower" | "upper";
  tickLabelPos: "default" | "lower" | "upper";
  scaledTicks: boolean;
  label?: { text: string; span: Span };
  labelShift: number;
  /** `max space between ticks`, `try min ticks` (behaviour I1). */
  maxSpaceBetweenTicks: number;
  tryMinTicks: number;
  /** `x=<length>`: the unit vector length (behaviour A3). */
  unit?: number;
};

export type AxisModel = {
  environment: AxisStatement["environment"];
  width?: number;
  height?: number;
  scaleOnlyAxis: boolean;
  scale: number;
  x: AxisDirectionModel;
  y: AxisDirectionModel;
  majorTickLength: number;
  minorTickLength: number;
  title?: { text: string; span: Span };
  titleShift: number;
  clip: boolean;
  axisOnTop: boolean;
  at?: string;
  anchor: string;
  name?: string;
  /** Styles in effect after the axis options (element styles read from here). */
  styles: PgfplotsStyleRegistry;
  /** Keys that fall through to TikZ for the axis' scope (`thick`, `font=…`). */
  tikzOptions: PgfplotsKeyUse[];
  cycleList: string[];
  /** Keys this evaluator does not implement, by name, with where they were written. */
  unsupported: Array<{ key: string; span: Span }>;
  /** Keys whose value could not be read. */
  invalid: Array<{ key: string; value: string; span: Span }>;
  /** Plot-level keys given at axis level (`mark=*`, `only marks`), applied to every plot after `every axis plot`. */
  plotDefaults: PgfplotsKeyUse[];
  /** `table/…` keys from the settings and the axis options, in order (behaviour V). */
  tableKeys: OptionEntry[];
};

export const PT_PER_CM = 72.27 / 2.54;

/** The default cycle list, `cycle list name=color` (behaviour G1, measured; the dashed entries draw solid marks, fixture cycle-list). */
export const COLOR_CYCLE_LIST: readonly string[] = [
  "blue,every mark/.append style={fill=blue!80!black},mark=*",
  "red,every mark/.append style={fill=red!80!black},mark=square*",
  "brown!60!black,every mark/.append style={fill=brown!80!black},mark=otimes*",
  "black,mark=star",
  "blue,every mark/.append style={fill=blue!80!black},mark=diamond*",
  "red,densely dashed,every mark/.append style={solid,fill=red!80!black},mark=*",
  "brown!60!black,densely dashed,every mark/.append style={solid,fill=brown!80!black},mark=square*",
  "black,densely dashed,every mark/.append style={solid,fill=gray},mark=otimes*",
  "blue,densely dashed,mark=star,every mark/.append style=solid",
  "red,densely dashed,every mark/.append style={solid,fill=red!80!black},mark=diamond*"
];

/** Named cycle lists whose entries have been measured (the manual shows them only as pictures). */
const NAMED_CYCLE_LISTS: Record<string, readonly string[]> = {
  color: COLOR_CYCLE_LIST
};

function direction(): AxisDirectionModel {
  return {
    enlarge: { kind: "auto" },
    ticks: { kind: "auto" },
    minorTickNum: 0,
    majorGrids: false,
    minorGrids: false,
    tickAlign: "inside",
    tickPos: "both",
    tickLabelPos: "default",
    scaledTicks: true,
    labelShift: 0,
    maxSpaceBetweenTicks: 35,
    tryMinTicks: 4
  };
}

/** A pgfmath number (`xmin=-pi`, `xtick distance=0.5`). */
export function readPgfNumber(raw: string): number | null {
  const text = stripBraces(raw);
  if (text.length === 0) return null;
  const direct = Number(text);
  if (Number.isFinite(direct) && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/u.test(text)) return direct;
  const result = evaluatePgfMathExpression(text);
  return result.ok ? result.quantity.value : null;
}

export function readLength(raw: string): number | null {
  const value = parseLength(stripBraces(raw), "pt");
  return value ?? null;
}

export function stripBraces(raw: string): string {
  let text = raw.trim();
  while (text.startsWith("{") && text.endsWith("}") && balancedOuter(text)) text = text.slice(1, -1).trim();
  return text;
}

function balancedOuter(text: string): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\\") { i += 1; continue; }
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0 && i < text.length - 1) return false; }
  }
  return depth === 0;
}

function readBoolean(value: string | null): boolean | null {
  if (value === null) return true;
  const text = stripBraces(value).toLowerCase();
  if (text === "true" || text === "") return true;
  if (text === "false") return false;
  return null;
}

/** Splits a `\foreach`-style list at top-level commas (braces group). */
export function splitTopLevelList(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charAt(i);
    if (c === "\\") { current += c + raw.charAt(i + 1); i += 1; continue; }
    if (c === "{") depth += 1;
    if (c === "}") depth -= 1;
    if (c === "," && depth === 0) { out.push(current); current = ""; continue; }
    current += c;
  }
  out.push(current);
  return out.map((item) => item.trim());
}

function readEnlarge(value: string | null): EnlargeSpec | null {
  const text = stripBraces(value ?? "true").trim();
  const lower = text.toLowerCase();
  if (lower === "auto") return { kind: "auto" };
  if (lower === "true") return { kind: "rel", value: 0.1, lower: true, upper: true };
  if (lower === "false") return { kind: "rel", value: 0, lower: true, upper: true };
  if (lower === "upper") return { kind: "rel", value: 0.1, lower: false, upper: true };
  if (lower === "lower") return { kind: "rel", value: 0.1, lower: true, upper: false };
  const plain = readPgfNumber(text);
  if (plain !== null && !text.includes("=")) return { kind: "rel", value: plain, lower: true, upper: true };
  let spec: EnlargeSpec = { kind: "rel", value: 0.1, lower: true, upper: true };
  let sides: { lower: boolean; upper: boolean } = { lower: true, upper: true };
  for (const part of splitTopLevelList(text)) {
    const [k = "", v = ""] = part.split("=").map((s) => s.trim());
    const key = k.toLowerCase();
    if (key === "upper") sides = { lower: false, upper: true };
    else if (key === "lower") sides = { lower: true, upper: false };
    else if (key === "value" || key === "rel") {
      const n = readPgfNumber(v);
      if (n === null) return null;
      spec = { kind: "rel", value: n, lower: true, upper: true };
    } else if (key === "abs") {
      const length = /[a-z]/iu.test(v.replace(/e[-+]?\d/iu, "")) ? readLength(v) : null;
      if (length !== null) spec = { kind: "dimension", value: length, lower: true, upper: true };
      else {
        const n = readPgfNumber(v);
        if (n === null) return null;
        spec = { kind: "abs", value: n, lower: true, upper: true };
      }
    } else return null;
  }
  return { ...spec, lower: sides.lower, upper: sides.upper };
}

function readTickList(value: string | null): TickListSpec {
  const text = stripBraces(value ?? "").trim();
  if (text === "\\empty") return { kind: "empty" };
  if (text === "") return { kind: "auto" };
  if (text === "data") return { kind: "data" };
  return { kind: "list", raw: text };
}

type Ctx = { model: AxisModel };

type KeyHandler = (ctx: Ctx, value: string | null, use: PgfplotsKeyUse) => boolean;

function forAxes(letters: string, apply: (d: AxisDirectionModel, value: string | null) => boolean): KeyHandler {
  return (ctx, value) => {
    let ok = true;
    for (const letter of letters) {
      const d = letter === "x" ? ctx.model.x : ctx.model.y;
      ok = apply(d, value) && ok;
    }
    return ok;
  };
}

const AXIS_KEYS: Record<string, KeyHandler> = {};
function defineAxisKey(names: string | string[], handler: KeyHandler): void {
  for (const name of Array.isArray(names) ? names : [names]) AXIS_KEYS[name] = handler;
}

defineAxisKey("width", (ctx, v) => { const n = v === null ? null : readLength(v); if (n === null) return false; ctx.model.width = n; return true; });
defineAxisKey("height", (ctx, v) => { const n = v === null ? null : readLength(v); if (n === null) return false; ctx.model.height = n; return true; });
defineAxisKey("scale only axis", (ctx, v) => { const b = readBoolean(v); if (b === null) return false; ctx.model.scaleOnlyAxis = b; return true; });
defineAxisKey("scale", (ctx, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null) return false; ctx.model.scale = n; return true; });
defineAxisKey("at", (ctx, v) => { if (v === null) return false; ctx.model.at = stripBraces(v); return true; });
defineAxisKey("anchor", (ctx, v) => { if (v === null) return false; ctx.model.anchor = stripBraces(v); return true; });
defineAxisKey("name", (ctx, v) => { if (v === null) return false; ctx.model.name = stripBraces(v); return true; });
defineAxisKey("clip", (ctx, v) => { const b = readBoolean(v); if (b === null) return false; ctx.model.clip = b; return true; });
defineAxisKey("axis on top", (ctx, v) => { const b = readBoolean(v); if (b === null) return false; ctx.model.axisOnTop = b; return true; });
defineAxisKey("title", (ctx, v, use) => { ctx.model.title = { text: stripBraces(v ?? ""), span: use.origin.span }; return true; });
defineAxisKey("every axis title shift", (ctx, v) => { const n = v === null ? null : readLength(v); if (n === null) return false; ctx.model.titleShift = n; return true; });
defineAxisKey("major tick length", (ctx, v) => { const n = v === null ? null : readLength(v); if (n === null) return false; ctx.model.majorTickLength = n; return true; });
defineAxisKey("minor tick length", (ctx, v) => { const n = v === null ? null : readLength(v); if (n === null) return false; ctx.model.minorTickLength = n; return true; });
defineAxisKey("compat", () => true);
// The compat 1.18 default placement (behaviour E1/E2); naming it changes nothing.
defineAxisKey(["xlabel near ticks", "ylabel near ticks"], (_ctx, v) => v === null);
defineAxisKey("cycle list name", (ctx, v) => {
  const list = NAMED_CYCLE_LISTS[stripBraces(v ?? "")];
  if (!list) return false;
  ctx.model.cycleList = [...list];
  return true;
});
defineAxisKey("cycle list", (ctx, v) => {
  const text = stripBraces(v ?? "");
  // `{red,mark=*\\blue\\}`: entries end with `\\`; otherwise each top-level entry is one.
  const entries = text.includes("\\\\")
    ? text.split("\\\\").map((s) => s.trim()).filter((s) => s.length > 0)
    : splitTopLevelList(text).map((s) => stripBraces(s)).filter((s) => s.length > 0);
  if (entries.length === 0) return false;
  ctx.model.cycleList = entries;
  return true;
});
defineAxisKey("grid", (ctx, v) => {
  const text = stripBraces(v ?? "major").toLowerCase();
  const major = text === "major" || text === "both" || text === "true";
  const minor = text === "minor" || text === "both";
  if (!major && !minor && text !== "none" && text !== "false") return false;
  for (const d of [ctx.model.x, ctx.model.y]) { d.majorGrids = major; d.minorGrids = minor; }
  return true;
});
for (const letter of ["x", "y"] as const) {
  const dir = (ctx: Ctx) => ctx.model[letter];
  defineAxisKey(`${letter}min`, (ctx, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null) return false; dir(ctx).min = n; return true; });
  defineAxisKey(`${letter}max`, (ctx, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null) return false; dir(ctx).max = n; return true; });
  defineAxisKey(`enlarge ${letter} limits`, (ctx, v) => { const e = readEnlarge(v); if (!e) return false; dir(ctx).enlarge = e; return true; });
  defineAxisKey(`${letter}tick`, (ctx, v) => { dir(ctx).ticks = readTickList(v); return true; });
  defineAxisKey(`minor ${letter}tick`, (ctx, v) => { dir(ctx).minorTicks = readTickList(v); return true; });
  defineAxisKey(`${letter}ticklabels`, (ctx, v) => { dir(ctx).tickLabels = splitTopLevelList(stripBraces(v ?? "")).map(stripBraces); return true; });
  defineAxisKey(`${letter}tick distance`, (ctx, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null || n <= 0) return false; dir(ctx).tickDistance = n; return true; });
  defineAxisKey(`minor ${letter} tick num`, (ctx, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null || n < 0) return false; dir(ctx).minorTickNum = Math.round(n); return true; });
  defineAxisKey(`${letter}majorgrids`, (ctx, v) => { const b = readBoolean(v); if (b === null) return false; dir(ctx).majorGrids = b; return true; });
  defineAxisKey(`${letter}minorgrids`, (ctx, v) => { const b = readBoolean(v); if (b === null) return false; dir(ctx).minorGrids = b; return true; });
  defineAxisKey(`${letter}label`, (ctx, v, use) => { dir(ctx).label = { text: stripBraces(v ?? ""), span: use.origin.span }; return true; });
  defineAxisKey(`${letter}label shift`, (ctx, v) => { const n = v === null ? null : readLength(v); if (n === null) return false; dir(ctx).labelShift = n; return true; });
  defineAxisKey(`${letter}tick align`, forAxes(letter, (d, v) => setTickAlign(d, v)));
  defineAxisKey(`${letter}tick pos`, forAxes(letter, (d, v) => setTickPos(d, letter, v)));
  defineAxisKey(`${letter}ticklabel pos`, forAxes(letter, (d, v) => setTickLabelPos(d, letter, v)));
  defineAxisKey(`scaled ${letter} ticks`, forAxes(letter, (d, v) => setScaledTicks(d, v)));
  defineAxisKey(letter, (ctx, v) => { const n = v === null ? null : readLength(v); if (n === null) return false; dir(ctx).unit = n; return true; });
}
defineAxisKey("enlargelimits", forAxes("xy", (d, v) => { const e = readEnlarge(v); if (!e) return false; d.enlarge = e; return true; }));
defineAxisKey("minor tick num", forAxes("xy", (d, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null || n < 0) return false; d.minorTickNum = Math.round(n); return true; }));
defineAxisKey("tick align", forAxes("xy", (d, v) => setTickAlign(d, v)));
defineAxisKey("tick pos", forAxes("xy", (d, v) => setTickPos(d, "", v)));
defineAxisKey("tickpos", forAxes("xy", (d, v) => setTickPos(d, "", v)));
defineAxisKey("ticklabel pos", forAxes("xy", (d, v) => setTickLabelPos(d, "", v)));
defineAxisKey("scaled ticks", forAxes("xy", (d, v) => setScaledTicks(d, v)));
defineAxisKey("label shift", forAxes("xy", (d, v) => { const n = v === null ? null : readLength(v); if (n === null) return false; d.labelShift = n; return true; }));
defineAxisKey("max space between ticks", forAxes("xy", (d, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null || n <= 0) return false; d.maxSpaceBetweenTicks = n; return true; }));
defineAxisKey("try min ticks", forAxes("xy", (d, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null) return false; d.tryMinTicks = Math.round(n); return true; }));

function setTickAlign(d: AxisDirectionModel, v: string | null): boolean {
  const text = stripBraces(v ?? "");
  if (text !== "inside" && text !== "outside" && text !== "center") return false;
  d.tickAlign = text;
  return true;
}

function sideOf(letter: string, text: string): "lower" | "upper" | "both" | "default" | null {
  if (text === "both") return "both";
  if (text === "default") return "default";
  if (text === "lower" || text === "left" || text === "bottom") return "lower";
  if (text === "upper" || text === "right" || text === "top") return "upper";
  void letter;
  return null;
}

function setTickPos(d: AxisDirectionModel, letter: string, v: string | null): boolean {
  const side = sideOf(letter, stripBraces(v ?? ""));
  if (side === null || side === "default") return false;
  d.tickPos = side;
  return true;
}

function setTickLabelPos(d: AxisDirectionModel, letter: string, v: string | null): boolean {
  const side = sideOf(letter, stripBraces(v ?? ""));
  if (side === null || side === "both") return false;
  d.tickLabelPos = side;
  return true;
}

function setScaledTicks(d: AxisDirectionModel, v: string | null): boolean {
  const text = stripBraces(v ?? "true");
  if (text === "true") { d.scaledTicks = true; return true; }
  if (text === "false") { d.scaledTicks = false; return true; }
  return false;
}

/**
 * Keys that belong to a plot (`\addplot`) but may also be given to the
 * axis, where they apply to every plot (pgfplots puts unknown axis keys in
 * a scope around the plots, so a TikZ plot key reaches them all).
 */
export const PLOT_LEVEL_KEYS = new Set([
  "mark", "only marks", "no marks", "no markers", "mark size", "mark options", "sharp plot",
  "every mark", "domain", "samples", "forget plot",
  "unbounded coords", "each nth point", "skip coords between index", "filter discard warning",
  "restrict x to domain", "restrict y to domain", "restrict x to domain*", "restrict y to domain*",
  "restrict expr to domain", "restrict expr to domain*"
]);

/** Keys of a plot that this evaluator understands, beyond the TikZ path keys. */
const PLOT_KEYS = new Set([
  ...PLOT_LEVEL_KEYS, "mark repeat", "mark phase", "unbounded coords", "x filter/.code"
]);

export type AxisModelInput = {
  axis: AxisStatement;
  /** `\pgfplotsset` payloads in effect (preamble, picture, enclosing scopes), in order. */
  settings: readonly OptionListAst[];
  /** `\pgfplotsset` statements inside the axis body, in order. */
  bodySettings: readonly OptionListAst[];
};

export function resolveAxisModel(input: AxisModelInput): AxisModel {
  const styles = createInitialStyleRegistry();
  const model: AxisModel = {
    environment: input.axis.environment,
    scaleOnlyAxis: false,
    scale: 1,
    x: direction(),
    y: direction(),
    majorTickLength: 0.15 * PT_PER_CM,
    minorTickLength: 0.1 * PT_PER_CM,
    titleShift: 6,
    clip: true,
    axisOnTop: false,
    anchor: "south west",
    styles,
    tikzOptions: [],
    cycleList: [...COLOR_CYCLE_LIST],
    unsupported: [],
    invalid: [],
    plotDefaults: [],
    tableKeys: []
  };
  const ctx: Ctx = { model };
  const sink = (use: PgfplotsKeyUse): void => {
    const handler = AXIS_KEYS[use.key];
    if (handler) {
      if (!handler(ctx, use.value, use)) model.invalid.push({ key: use.key, value: use.value ?? "", span: use.origin.span });
      return;
    }
    if (use.key.startsWith("table/")) {
      model.tableKeys.push(useToEntry(use));
      return;
    }
    if (use.key.startsWith("/pgf/number format/") || use.key.startsWith("/pgf/")) {
      model.tikzOptions.push(use);
      return;
    }
    if (PLOT_LEVEL_KEYS.has(use.key) || use.key.startsWith("every mark")) {
      model.plotDefaults.push(use);
      return;
    }
    if (DOCUMENTED_PGFPLOTS_KEYS.has(use.key)) {
      model.unsupported.push({ key: use.key, span: use.origin.span });
      return;
    }
    model.tikzOptions.push(use);
  };
  const problems = (problem: { key: string; span: Span }) => model.unsupported.push({ key: problem.key, span: problem.span });
  expandPgfplotsOptions(input.settings, styles, (use) => {
    // Settings outside an axis only define defaults: axis keys there apply to every axis.
    sink(use);
  }, { onProblem: problems });
  // `every axis` (and its variants) is applied at the start of each axis.
  const environmentStyle = input.axis.environment === "axis" ? "every linear axis"
    : input.axis.environment === "semilogxaxis" ? "every semilogx axis"
      : input.axis.environment === "semilogyaxis" ? "every semilogy axis" : "every loglog axis";
  const startStyles = [...(styles.get("every axis") ?? []), ...(styles.get(environmentStyle) ?? [])];
  expandPgfplotsOptions(startStyles, cloneStyleRegistry(styles), sink, { onProblem: problems });
  expandPgfplotsOptions(input.axis.options ? [input.axis.options] : [], styles, sink, { onProblem: problems });
  expandPgfplotsOptions(input.bodySettings, styles, sink, { onProblem: problems });
  expandPgfplotsOptions(styles.get("every axis post") ?? [], cloneStyleRegistry(styles), sink, { onProblem: problems });
  return model;
}

/** A key use as an option entry (its span is where it was written). */
export function useToEntry(use: PgfplotsKeyUse): OptionEntry {
  return use.value === null
    ? { kind: "flag", key: use.key, span: use.origin.span, raw: use.key }
    : { kind: "kv", key: use.key, valueRaw: use.value, span: use.origin.span, raw: `${use.key}=${use.value}` };
}

// ---------------------------------------------------------------------------
// Plots

/** The documented coordinate filters (manual coordfiltering.tex), in the order given. */
export type PlotFilter =
  | { kind: "each nth point"; n: number; span: Span }
  | { kind: "skip coords between index"; from: number; to: number; span: Span }
  | { kind: "restrict"; axis: "x" | "y"; min: number; max: number; clamp: boolean; span: Span }
  | { kind: "restrict expr"; expr: string; min: number; max: number; clamp: boolean; span: Span };

export type PlotModel = {
  statement: AddPlotStatement;
  /** Index in the cycle list (position among the axis' plots, behaviour G1). */
  cycleIndex: number;
  /** TikZ-level key uses for the plot path, in application order. */
  pathKeys: PgfplotsKeyUse[];
  /** `null` for no marks. */
  mark: string | null;
  markSize?: number;
  /** `every mark` / `mark options` lists after the path style, in order. */
  markKeys: PgfplotsKeyUse[];
  onlyMarks: boolean;
  domain?: { from: number; to: number };
  samples?: number;
  forget: boolean;
  /** `unbounded coords` (initially discard; the non-starred `restrict … to domain` keys set jump). */
  unboundedCoords: "discard" | "jump";
  filters: PlotFilter[];
  /** `table/…` keys given to the plot, in order. */
  tableKeys: OptionEntry[];
  unsupported: Array<{ key: string; span: Span }>;
  invalid: Array<{ key: string; value: string; span: Span }>;
};

/**
 * `\addplot[opts]`: `every axis plot`, then opts (no cycle list);
 * `\addplot+[opts]` and `\addplot`: `every axis plot`, the cycle entry,
 * then opts (behaviour G2). `every axis plot post` comes last.
 */
export function resolvePlotModel(axis: AxisModel, statement: AddPlotStatement, cycleIndex: number): PlotModel {
  const styles = cloneStyleRegistry(axis.styles);
  const plot: PlotModel = {
    statement,
    cycleIndex,
    pathKeys: [],
    mark: null,
    markKeys: [],
    onlyMarks: false,
    forget: false,
    unboundedCoords: "discard",
    filters: [],
    tableKeys: [],
    unsupported: [],
    invalid: []
  };
  const useCycle = statement.increment || !statement.options;
  const lists: OptionListAst[] = [];
  lists.push(...(styles.get("every axis plot") ?? []));
  if (axis.plotDefaults.length > 0) lists.push(parseOptionListRaw(`[${axis.plotDefaults.map((u) => u.value === null ? u.key : `${u.key}=${u.value}`).join(",")}]`));
  if (useCycle && axis.cycleList.length > 0) {
    const entry = axis.cycleList[cycleIndex % axis.cycleList.length] ?? "";
    lists.push(parseOptionListRaw(`[${entry}]`));
  }
  if (statement.options) lists.push(statement.options);
  for (const extra of statement.extraOptions ?? []) lists.push(extra.options);
  if (statement.legacyPlot?.options) lists.push(statement.legacyPlot.options);
  // `no markers` given to the axis goes to `every axis plot post`, so it beats the cycle list (manual markers-meta.tex).
  if (axis.plotDefaults.some((use) => use.key === "no marks" || use.key === "no markers")) lists.push(parseOptionListRaw("[no markers]"));
  lists.push(...(styles.get("every axis plot post") ?? []));
  // `every mark` is a TikZ style: it accumulates through definitions, and is read at the end.
  styles.set("every mark", []);
  expandPgfplotsOptions(lists, styles, (use) => {
    const { key, value } = use;
    if (key === "mark") {
      const name = stripBraces(value ?? "");
      plot.mark = name === "none" || name === "" ? null : name;
      return;
    }
    if (key === "no marks" || key === "no markers") { plot.mark = null; return; }
    if (key === "only marks") { plot.onlyMarks = readBoolean(value) ?? true; return; }
    if (key === "sharp plot") return;
    if (key === "mark size") {
      const n = value === null ? null : readLength(value);
      if (n === null) plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      else plot.markSize = n;
      return;
    }
    if (key === "mark options") {
      styles.set("every mark", value ? [parseOptionListRaw(`[${stripBraces(value)}]`)] : []);
      return;
    }
    if (key === "domain") {
      const parts = stripBraces(value ?? "").split(":");
      const from = readPgfNumber(parts[0] ?? "");
      const to = readPgfNumber(parts[1] ?? "");
      if (from === null || to === null) plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      else plot.domain = { from, to };
      return;
    }
    if (key === "samples") {
      const n = value === null ? null : readPgfNumber(value);
      if (n === null || n < 2) plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      else plot.samples = Math.round(n);
      return;
    }
    if (key === "forget plot") { plot.forget = readBoolean(value) ?? true; return; }
    if (key.startsWith("table/")) { plot.tableKeys.push(useToEntry(use)); return; }
    if (key === "unbounded coords") {
      const mode = stripBraces(value ?? "");
      if (mode === "discard" || mode === "jump") plot.unboundedCoords = mode;
      else plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      return;
    }
    if (key === "filter discard warning") return;
    if (key === "each nth point") {
      const n = value === null ? null : readPgfNumber(value);
      if (n === null || n < 1) plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      else plot.filters.push({ kind: "each nth point", n: Math.round(n), span: use.origin.span });
      return;
    }
    if (key === "skip coords between index") {
      const args = readBraceArguments(value ?? "");
      const from = args[0] === undefined ? null : readPgfNumber(args[0]);
      const to = args[1] === undefined ? null : readPgfNumber(args[1]);
      if (from === null || to === null) plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      else plot.filters.push({ kind: "skip coords between index", from, to, span: use.origin.span });
      return;
    }
    const restrict = /^restrict (x|y|expr) to domain(\*?)$/u.exec(key);
    if (restrict) {
      const clamp = restrict[2] === "*";
      let domain: string | undefined;
      let expr: string | undefined;
      if (restrict[1] === "expr") {
        const args = readBraceArguments(value ?? "");
        expr = args[0];
        domain = args[1];
      } else domain = stripBraces(value ?? "");
      const [lo, hi] = (domain ?? "").split(":");
      const min = lo === undefined ? null : readPgfNumber(lo);
      const max = hi === undefined ? null : readPgfNumber(hi);
      if (min === null || max === null || (restrict[1] === "expr" && expr === undefined)) {
        plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
        return;
      }
      plot.filters.push(restrict[1] === "expr"
        ? { kind: "restrict expr", expr: expr ?? "", min, max, clamp, span: use.origin.span }
        : { kind: "restrict", axis: restrict[1] === "x" ? "x" : "y", min, max, clamp, span: use.origin.span });
      if (!clamp) plot.unboundedCoords = "jump";
      return;
    }
    if (PLOT_KEYS.has(key)) return;
    if (DOCUMENTED_PGFPLOTS_KEYS.has(key) && !TIKZ_ALSO.has(key)) {
      plot.unsupported.push({ key, span: use.origin.span });
      return;
    }
    plot.pathKeys.push(use);
  }, { onProblem: (problem) => plot.unsupported.push({ key: problem.key, span: problem.span }) });
  plot.markKeys = (styles.get("every mark") ?? []).flatMap((list) => list.entries.map((entry): PgfplotsKeyUse => ({
    key: entry.kind === "unknown" ? entry.raw : entry.key,
    value: entry.kind === "kv" ? entry.valueRaw : null,
    origin: entry
  })));
  return plot;
}

/** `{a}{b}` → ["a", "b"] (TeX arguments of a key value). */
export function readBraceArguments(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charAt(i);
    if (c === "\\") { if (depth > 0) current += c + raw.charAt(i + 1); i += 1; continue; }
    if (c === "{") { if (depth > 0) current += c; depth += 1; continue; }
    if (c === "}") {
      depth -= 1;
      if (depth === 0) { out.push(current.trim()); current = ""; } else current += c;
      continue;
    }
    if (depth > 0) current += c;
  }
  return out;
}

/** Documented pgfplots keys that are also plain TikZ keys and mean the same on a plot path. */
const TIKZ_ALSO = new Set(["color", "draw", "fill", "line width", "opacity", "smooth", "const plot", "thick", "thin"]);
