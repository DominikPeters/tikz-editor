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
import { expandForeachList } from "../foreach/list.js";
import { convertQuantityToLength, evaluatePgfMathExpression } from "../semantic/pgfmath/evaluator.js";
import { DOCUMENTED_PGFPLOTS_KEYS } from "./documented-keys.generated.js";
import {
  cloneStyleRegistry,
  createInitialStyleRegistry,
  expandPgfplotsOptions,
  flattenStyleEntries,
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
  | { kind: "list"; raw: string }
  /** `xtickten`: exponents. */
  | { kind: "ten"; raw: string };

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
  /** `scaled x ticks` (manual tickoptions.tex, initially true; behaviour J1, T6). */
  scaledTicks: ScaledTicksSpec;
  /** `scale ticks above exponent` / `below exponent` (initially 3 / -1; J1, T6). */
  scaleTicksAbove: number;
  scaleTicksBelow: number;
  label?: { text: string; span: Span };
  labelShift: number;
  /** `max space between ticks`, `try min ticks` (behaviour I1). */
  maxSpaceBetweenTicks: number;
  tryMinTicks: number;
  /** `x=<length>`: the unit vector length (behaviour A3). */
  unit?: number;
  /** `xmode` (behaviour Q1): `log` from the environment or the key. */
  mode: "linear" | "log";
  /** `log basis x`: undefined = natural log internally, base 10 for display (manual tickoptions.tex). */
  logBasis?: number;
  /** The `log basis x` text as written, for labels (`2^{3}`). */
  logBasisText?: string;
  /** `log ticks with fixed point` (manual numberformatting.tex). */
  logTicksFixedPoint: boolean;
  /**
   * `axis x line` (manual axisdescription.tex): where the line of this
   * direction is drawn — both box edges, the lower (bottom/left) or upper
   * (top/right) edge, through the other direction's 0 (`middle`/`center`),
   * or not at all (`none`, `hide x axis`). Behaviour R1.
   */
  axisLine: "box" | "lower" | "upper" | "middle" | "none";
  /** The unstarred key moves the axis label (R6); `axis x line*` does not. */
  axisLineMovesLabel: boolean;
  /** `xmajorticks`, `xminorticks`, `ticks=` (manual tickoptions.tex, initially true): draw the tick marks. */
  majorTickMarks: boolean;
  minorTickMarks: boolean;
  /** `x dir=reverse` (manual specifyrange.tex, S1). */
  reverse: boolean;
  /** `hide obscured x ticks` (initially true, R4). */
  hideObscuredTicks: boolean;
  /** `extra x ticks`, `extra x tick labels` (manual tickoptions.tex). */
  extraTicks?: TickListSpec;
  extraTickLabels?: string[];
  /** `symbolic x coords={a,b,c}`: the names, mapped to 0, 1, 2 (behaviour X1). */
  symbolic?: string[];
};

/** `scaled x ticks=true|false|base 10:e|real:num|manual:{label}{code}`. */
export type ScaledTicksSpec =
  | { kind: "auto" }
  | { kind: "none" }
  | { kind: "base10"; exponent: number }
  | { kind: "real"; divisor: number }
  /** `code` is `\pgfmathparse{<expression in #1>}`, kept as the expression. */
  | { kind: "manual"; label: string; expression: string };

/** One direction of `error bars/…` (manual errorbars.tex, behaviour X2). */
export type ErrorBarDirection = {
  dir: "none" | "plus" | "minus" | "both";
  mode: "explicit" | "explicit relative" | "fixed" | "fixed relative";
  value: number;
};

export type ErrorBarsModel = {
  x: ErrorBarDirection;
  y: ErrorBarDirection;
  /** `error mark` (initially `-`), null for `none`. */
  mark: string | null;
  /** `error mark options` (initially `rotate=90`), as written. */
  markOptions: string;
  /** `error bar style` keys, in order. */
  barStyle: PgfplotsKeyUse[];
};

export type AxisModel = {
  environment: AxisStatement["environment"];
  width?: number;
  height?: number;
  scaleOnlyAxis: boolean;
  scale: number;
  /**
   * `unit vector ratio=rx ry` (`axis equal`: 1 1): |e_x| / |e_y| = rx / ry,
   * through `scale mode=scale uniformly` (behaviour AA). Absent: no ratio.
   */
  unitVectorRatio?: { x: number; y: number };
  /** `unit rescale keep size` (initially `unless limits declared`). */
  unitRescaleKeepSize: "true" | "false" | "unless limits declared";
  /** Set by the evaluator when x/y `unit` came from the ratio, not from `x=`/`y=`. */
  unitsFromRatio?: boolean;
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
  /** `cycle list shift` (initially empty: 0). */
  cycleListShift: number;
  /** Keys this evaluator does not implement, by name, with where they were written. */
  unsupported: Array<{ key: string; span: Span }>;
  /** Keys whose value could not be read. */
  invalid: Array<{ key: string; value: string; span: Span }>;
  /** Plot-level keys given at axis level (`mark=*`, `only marks`), applied to every plot after `every axis plot`. */
  plotDefaults: PgfplotsKeyUse[];
  /** `table/…` keys from the settings and the axis options, in order (behaviour V). */
  tableKeys: OptionEntry[];
  /** The axis-wide bar style (`ybar`, `xbar stacked`, `ybar interval`, …; behaviour U). */
  bar?: AxisBarStyle;
  /** `bar shift auto={sep}` given without a bar style (U4). */
  barShiftAuto?: number;
  /** Legend keys (behaviour L); the legend's TikZ style is `every axis legend` in `styles`. */
  legend: LegendModel;
};

/** One legend text: `\addlegendentry[opts]{text}`, a `\legend` item or a `legend entries` item (`[opts]text`). */
/** `keep`: an `\addlegendentry{}` keeps its pair even when empty (behaviour Z8); empty `\legend` items do not. */
export type LegendEntryText = { text: string; options: string; span: Span; /** Where the entry text is written, for canvas text editing (editing only). */ textSpan?: Span; keep?: boolean };

export type LegendModel = {
  /** `legend entries={…}`: used only when the axis has no legend command (manual). */
  entries?: LegendEntryText[];
  /** `legend columns` (initially 1; −1: one row). */
  columns: number;
  plotPos: "left" | "right" | "none";
  reverse: boolean;
  transpose: boolean;
  /** `legend to name`: the legend is stored, not drawn. */
  toName?: string;
};

export type BarKind = "ybar" | "xbar" | "ybar interval" | "xbar interval";

/** `ybar=<sep>` and friends given to the axis (manual 2dplots.tex `/pgfplots/ybar`). */
export type AxisBarStyle = {
  kind: BarKind;
  stacked: boolean;
  /** `bar shift auto={sep}` (pt): the gap between adjacent bars of several plots (U4). */
  sep?: number;
  /** `ybar interval=<relative width>` (U7). */
  relative?: number;
};

/** A bar dimension: `10pt`, or a number in axis units (compat ≥ 1.7, manual `bar width`). */
export type BarLength = { value: number; unit: "pt" | "axis" };

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

/** `bar cycle list` (manual 2dplots.tex, colours confirmed in E19). */
export const BAR_CYCLE_LIST: readonly string[] = [
  "blue,fill=blue!30!white,mark=none",
  "red,fill=red!30!white,mark=none",
  "brown!60!black,fill=brown!30!white,mark=none",
  "black,fill=gray,mark=none"
];

/** Named cycle lists whose entries have been measured (the manual shows them only as pictures). */
/**
 * The predefined cycle lists: the manual prints their definitions
 * (markers-meta.tex, "The definitions of all predefined cycle lists
 * follow"); `color` was also measured (G1), the others are checked by
 * Tier 2 (behaviour P2). `\pgfplotsmarklistfill` is `mark list fill`,
 * initially `.!80!black`.
 */
const MARK_LIST_FILL = ".!80!black";
const NAMED_CYCLE_LISTS: Record<string, readonly string[]> = {
  color: COLOR_CYCLE_LIST,
  "black white": [
    "every mark/.append style={fill=gray},mark=*",
    "every mark/.append style={fill=gray},mark=square*",
    "every mark/.append style={fill=gray},mark=otimes*",
    "mark=star",
    "every mark/.append style={fill=gray},mark=diamond*",
    "densely dashed,every mark/.append style={solid,fill=gray},mark=*",
    "densely dashed,every mark/.append style={solid,fill=gray},mark=square*",
    "densely dashed,every mark/.append style={solid,fill=gray},mark=otimes*",
    "densely dashed,every mark/.append style={solid},mark=star",
    "densely dashed,every mark/.append style={solid,fill=gray},mark=diamond*"
  ],
  exotic: [
    "teal,every mark/.append style={fill=teal!80!black},mark=*",
    "orange,every mark/.append style={fill=orange!80!black},mark=square*",
    "cyan!60!black,every mark/.append style={fill=cyan!80!black},mark=otimes*",
    "red!70!white,mark=star",
    "lime!80!black,every mark/.append style={fill=lime},mark=diamond*",
    "red,densely dashed,every mark/.append style={solid,fill=red!80!black},mark=*",
    "yellow!60!black,densely dashed,every mark/.append style={solid,fill=yellow!80!black},mark=square*",
    "black,every mark/.append style={solid,fill=gray},mark=otimes*",
    "blue,densely dashed,mark=star,every mark/.append style=solid",
    "red,densely dashed,every mark/.append style={solid,fill=red!80!black},mark=diamond*"
  ],
  "mark list": [
    `every mark/.append style={solid,fill=${MARK_LIST_FILL}},mark=*`,
    `every mark/.append style={solid,fill=${MARK_LIST_FILL}},mark=square*`,
    `every mark/.append style={solid,fill=${MARK_LIST_FILL}},mark=triangle*`,
    "every mark/.append style={solid},mark=star",
    `every mark/.append style={solid,fill=${MARK_LIST_FILL}},mark=diamond*`,
    `every mark/.append style={solid,fill=${MARK_LIST_FILL}!40},mark=otimes*`,
    "every mark/.append style={solid},mark=|",
    `every mark/.append style={solid,fill=${MARK_LIST_FILL}},mark=pentagon*`,
    "every mark/.append style={solid},mark=text,text mark=p",
    "every mark/.append style={solid},mark=text,text mark=a"
  ],
  "color list": ["red", "blue", "black", "yellow", "brown", "teal", "orange", "violet", "cyan", "green!70!black", "magenta", "gray"],
  linestyles: ["solid", "dashed", "dotted"],
  "linestyles*": ["solid", "dashed", "dotted", "dashdotted", "dashdotdotted"]
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
    scaledTicks: { kind: "auto" },
    scaleTicksAbove: 3,
    scaleTicksBelow: -1,
    labelShift: 0,
    maxSpaceBetweenTicks: 35,
    tryMinTicks: 4,
    mode: "linear",
    logTicksFixedPoint: false,
    axisLine: "box",
    reverse: false,
    majorTickMarks: true,
    minorTickMarks: true,
    axisLineMovesLabel: false,
    hideObscuredTicks: true
  };
}

/**
 * A pgfmath number (`xmin=-pi`, `xtick distance=0.5`, `xmin=1e5`), finite.
 * pgfplots parses its numeric options with the fpu (manual
 * pgfplots.reference.axis-addplot.tex, "About the precision and number
 * range"), so values beyond TeX's ±16384 are fine: float mode.
 */
export function readPgfNumber(raw: string): number | null {
  const value = readPgfFloat(raw);
  return value !== null && Number.isFinite(value) ? value : null;
}

/** Like `readPgfNumber`, but `inf`/`nan` (and fpu's results of errors such as 1/0) come back as ±Infinity/NaN. */
export function readPgfFloat(raw: string): number | null {
  const text = stripBraces(raw);
  if (text.length === 0) return null;
  const direct = Number(text);
  if (Number.isFinite(direct) && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/u.test(text)) return direct;
  if (/^[-+]?(?:inf|infty)$/iu.test(text)) return text.startsWith("-") ? -Infinity : Infinity;
  if (/^[-+]?nan$/iu.test(text)) return Number.NaN;
  const result = evaluatePgfMathExpression(text, { mode: "float" });
  return result.ok ? result.quantity.value : null;
}

export function readLength(raw: string): number | null {
  const text = stripBraces(raw);
  const value = parseLength(text, "pt");
  if (value !== null) return value;
  // pgfplots reads dimensions with pgfmath (`width=345pt/2.3`, `2*\columnwidth` once substituted).
  const result = evaluatePgfMathExpression(text);
  return result.ok ? convertQuantityToLength(result.quantity, "pt") : null;
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

type Ctx = { model: AxisModel; expandStyle: (name: string) => void; use?: PgfplotsKeyUse };

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
// Manual scaling.tex: `axis equal` is `unit vector ratio=1 1 1, unit rescale
// keep size=true`; `axis equal image` the same with `false`; the starred
// ratio implies `false`. Trailing ratios of 1 may be omitted; an empty
// value disables the ratio. For 2D axes only rx and ry count.
function readUnitVectorRatio(value: string | null): { x: number; y: number } | null | undefined {
  const text = stripBraces(value ?? "").trim();
  if (text === "") return undefined;
  const parts: number[] = [];
  for (const part of text.split(/\s+/u)) {
    const n = readPgfNumber(part);
    if (n === null || !(n > 0)) return null;
    parts.push(n);
  }
  const [x = 1, y = 1] = parts;
  return { x, y };
}
defineAxisKey(["axis equal", "axis equal image"], (ctx, v, use) => {
  const b = readBoolean(v);
  if (b === null) return false;
  if (b) { ctx.model.unitVectorRatio = { x: 1, y: 1 }; ctx.model.unitRescaleKeepSize = use.key === "axis equal" ? "true" : "false"; }
  else delete ctx.model.unitVectorRatio;
  return true;
});
defineAxisKey(["unit vector ratio", "unit vector ratio*"], (ctx, v, use) => {
  const ratio = readUnitVectorRatio(v);
  if (ratio === null) return false;
  if (ratio) ctx.model.unitVectorRatio = ratio; else delete ctx.model.unitVectorRatio;
  if (use.key === "unit vector ratio*") ctx.model.unitRescaleKeepSize = "false";
  return true;
});
defineAxisKey("unit rescale keep size", (ctx, v) => {
  const text = v === null ? "true" : stripBraces(v).trim();
  if (text !== "true" && text !== "false" && text !== "unless limits declared") return false;
  ctx.model.unitRescaleKeepSize = text;
  return true;
});
defineAxisKey("scale", (ctx, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null) return false; ctx.model.scale = n; return true; });
defineAxisKey("at", (ctx, v) => { if (v === null) return false; ctx.model.at = stripBraces(v); return true; });
defineAxisKey("anchor", (ctx, v) => { if (v === null) return false; ctx.model.anchor = stripBraces(v); return true; });
defineAxisKey("name", (ctx, v) => { if (v === null) return false; ctx.model.name = stripBraces(v); return true; });
defineAxisKey("clip", (ctx, v) => { const b = readBoolean(v); if (b === null) return false; ctx.model.clip = b; return true; });
defineAxisKey("axis on top", (ctx, v) => { const b = readBoolean(v); if (b === null) return false; ctx.model.axisOnTop = b; return true; });
defineAxisKey("title", (ctx, v, use) => { ctx.model.title = { text: stripBraces(v ?? ""), span: use.origin.span }; return true; });
defineAxisKey("every axis title shift", (ctx, v) => { const n = v === null ? null : readLength(v); if (n === null) return false; ctx.model.titleShift = n; return true; });
defineAxisKey("tickwidth", (ctx, v) => { const n = v === null ? null : readLength(v); if (n === null) return false; ctx.model.majorTickLength = n; return true; });
defineAxisKey("subtickwidth", (ctx, v) => { const n = v === null ? null : readLength(v); if (n === null) return false; ctx.model.minorTickLength = n; return true; });
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
defineAxisKey("cycle list shift", (ctx, v) => { const text = stripBraces(v ?? ""); const n = text === "" ? 0 : readPgfNumber(text); if (n === null || !Number.isInteger(n)) return false; ctx.model.cycleListShift = n; return true; });
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
// U: the axis styles `ybar`, `xbar` (bar cycle list, ticks outside across the
// bars, automatic shifts), `ybar stacked`, `ybar interval` (manual 2dplots.tex).
for (const kind of ["ybar", "xbar"] as const) {
  const across = kind === "ybar" ? "x" : "y";
  defineAxisKey(kind, (ctx, v) => {
    const sep = v === null ? 2 : readLength(v);
    if (sep === null) return false;
    ctx.model.bar = { kind, stacked: false, sep };
    ctx.model.cycleList = [...BAR_CYCLE_LIST];
    ctx.model[across].tickAlign = "outside";
    return true;
  });
  defineAxisKey(`${kind} stacked`, (ctx, v) => {
    if (v !== null && !["plus", "minus"].includes(stripBraces(v))) return false;
    // Unlike `ybar`, the stacked style leaves the ticks inside (E19 fixture bars-stacked).
    ctx.model.bar = { kind, stacked: true };
    ctx.model.cycleList = [...BAR_CYCLE_LIST];
    return true;
  });
  defineAxisKey(`${kind} interval`, (ctx, v) => {
    const relative = v === null ? 1 : readPgfNumber(v);
    if (relative === null) return false;
    ctx.model.bar = { kind: `${kind} interval`, stacked: false, relative };
    ctx.model.cycleList = [...BAR_CYCLE_LIST];
    ctx.model[across].ticks = { kind: "data" };
    ctx.model[across].majorGrids = true;
    return true;
  });
}
// W3: `area style` = area cycle list, area legend, axis on top (manual 2dplots.tex). The
// first entry of the area cycle list measured (E20 `closed-area-style`) equals the bar list's.
defineAxisKey("area style", (ctx, v) => { if (v !== null) return false; ctx.model.cycleList = [...BAR_CYCLE_LIST]; ctx.model.axisOnTop = true; return true; });
defineAxisKey("area cycle list", (ctx, v) => { if (v !== null) return false; ctx.model.cycleList = [...BAR_CYCLE_LIST]; return true; });
defineAxisKey("bar cycle list", (ctx, v) => { if (v !== null) return false; ctx.model.cycleList = [...BAR_CYCLE_LIST]; return true; });
defineAxisKey("bar shift auto", (ctx, v) => {
  const sep = v === null ? 2 : readLength(v);
  if (sep === null) return false;
  // Without a bar style it still installs the shift formula for the bar plots (matlab2tikz writes it alone).
  if (ctx.model.bar) ctx.model.bar = { ...ctx.model.bar, sep };
  else ctx.model.barShiftAuto = sep;
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
  defineAxisKey(`symbolic ${letter} coords`, (ctx, v) => {
    const names = splitTopLevelList(stripBraces(v ?? "")).map(stripBraces).filter((name) => name.length > 0);
    if (names.length === 0) return false;
    dir(ctx).symbolic = names;
    return true;
  });
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
  defineAxisKey(`${letter}mode`, (ctx, v) => {
    const text = stripBraces(v ?? "");
    if (text === "log") dir(ctx).mode = "log";
    else if (text === "normal" || text === "linear") dir(ctx).mode = "linear";
    else return false;
    return true;
  });
  defineAxisKey(`log basis ${letter}`, (ctx, v) => {
    const text = stripBraces(v ?? "");
    if (text === "") { delete dir(ctx).logBasis; delete dir(ctx).logBasisText; return true; }
    const n = readPgfNumber(text);
    if (n === null || !(n > 0) || n === 1) return false;
    dir(ctx).logBasis = n; dir(ctx).logBasisText = text;
    return true;
  });
  // `xtickten={1,2}` = `xtick={1e1,1e2}` (in the log basis when one is set; manual tickoptions.tex).
  defineAxisKey(`${letter}tickten`, (ctx, v) => { dir(ctx).ticks = { kind: "ten", raw: stripBraces(v ?? "") }; return true; });
  defineAxisKey(`extra ${letter} ticks`, (ctx, v) => { dir(ctx).extraTicks = readTickList(v); return true; });
  defineAxisKey(`extra ${letter} tick labels`, (ctx, v) => { dir(ctx).extraTickLabels = splitTopLevelList(stripBraces(v ?? "")).map(stripBraces); return true; });
}
/** `axis x line(*)=…` (R1): `bottom`/`left` → lower, `top`/`right` → upper. */
function readAxisLine(letter: "x" | "y", v: string | null): AxisDirectionModel["axisLine"] | null {
  const text = stripBraces(v ?? "");
  if (text === "box") return "box";
  if (text === "middle" || text === "center") return "middle";
  if (text === "none") return "none";
  if (letter === "x" ? text === "bottom" : text === "left") return "lower";
  if (letter === "x" ? text === "top" : text === "right") return "upper";
  return null;
}
function setAxisLine(ctx: Ctx, letter: "x" | "y", line: AxisDirectionModel["axisLine"], starred: boolean): void {
  const dir = ctx.model[letter];
  dir.axisLine = line;
  dir.axisLineMovesLabel = !starred && line !== "box";
  // The unstarred key is a style: it also installs `every (non) boxed x axis` (manual).
  if (!starred && line !== "none") ctx.expandStyle(line === "box" ? `every boxed ${letter} axis` : `every non boxed ${letter} axis`);
}
for (const letter of ["x", "y"] as const) {
  for (const starred of [false, true]) {
    defineAxisKey(`axis ${letter} line${starred ? "*" : ""}`, (ctx, v) => { const line = readAxisLine(letter, v); if (!line) return false; setAxisLine(ctx, letter, line, starred); return true; });
  }
  defineAxisKey(`hide ${letter} axis`, (ctx, v) => { const b = readBoolean(v); if (b === null) return false; if (b) setAxisLine(ctx, letter, "none", true); return true; });
  defineAxisKey(`hide obscured ${letter} ticks`, (ctx, v) => { const b = readBoolean(v); if (b === null) return false; ctx.model[letter].hideObscuredTicks = b; return true; });
}
for (const starred of [false, true]) {
  defineAxisKey(`axis lines${starred ? "*" : ""}`, (ctx, v) => {
    const text = stripBraces(v ?? "");
    const x = readAxisLine("x", text === "left" ? "bottom" : text === "right" ? "top" : text);
    const y = readAxisLine("y", text);
    if (!x || !y) return false;
    setAxisLine(ctx, "x", x, starred);
    setAxisLine(ctx, "y", y, starred);
    return true;
  });
}
for (const letter of ["x", "y"] as const) {
  defineAxisKey(`${letter}majorticks`, (ctx, v) => { const b = readBoolean(v); if (b === null) return false; ctx.model[letter].majorTickMarks = b; return true; });
  // Measured (T1): `yminorticks=false` left the minor ticks of `minor tick num` drawn; not understood, so diagnosed.
  defineAxisKey(`${letter}minorticks`, (ctx, v, use) => { const b = readBoolean(v); if (b === null) return false; if (!b) ctx.model.unsupported.push({ key: `${letter}minorticks`, span: use.origin.span }); return true; });
}
for (const letter of ["x", "y"] as const) {
  defineAxisKey(`${letter} dir`, (ctx, v) => {
    const text = stripBraces(v ?? "");
    if (text !== "normal" && text !== "reverse") return false;
    ctx.model[letter].reverse = text === "reverse";
    return true;
  });
}
defineAxisKey("ticks", (ctx, v) => {
  const text = stripBraces(v ?? "");
  const major = text === "major" || text === "both"; const minor = text === "minor" || text === "both";
  if (!major && !minor && text !== "none") return false;
  // Only the major part is measured (T1); `minor`/`none` leave minor ticks as they are.
  for (const d of [ctx.model.x, ctx.model.y]) d.majorTickMarks = major;
  return true;
});
defineAxisKey("hide axis", (ctx, v) => { const b = readBoolean(v); if (b === null) return false; if (b) { setAxisLine(ctx, "x", "none", true); setAxisLine(ctx, "y", "none", true); } return true; });
// `separate axis lines` (initially false): only the closed-box default is implemented.
defineAxisKey("separate axis lines", (ctx, v, use) => { const b = readBoolean(v); if (b === null) return false; if (b) ctx.model.unsupported.push({ key: "separate axis lines", span: use.origin.span }); return true; });
defineAxisKey("log ticks with fixed point", (ctx, v) => { if (v !== null) return false; ctx.model.x.logTicksFixedPoint = true; ctx.model.y.logTicksFixedPoint = true; return true; });
// Only the documented initial value is implemented (behaviour Q3: its effect on the step rule is OPEN).
defineAxisKey("try min ticks log", (_ctx, v) => v !== null && readPgfNumber(v) === 3);
defineAxisKey("enlargelimits", forAxes("xy", (d, v) => { const e = readEnlarge(v); if (!e) return false; d.enlarge = e; return true; }));
defineAxisKey("minor tick num", forAxes("xy", (d, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null || n < 0) return false; d.minorTickNum = Math.round(n); return true; }));
defineAxisKey("tick align", forAxes("xy", (d, v) => setTickAlign(d, v)));
defineAxisKey("tick pos", forAxes("xy", (d, v) => setTickPos(d, "", v)));
defineAxisKey("tickpos", forAxes("xy", (d, v) => setTickPos(d, "", v)));
defineAxisKey("ticklabel pos", forAxes("xy", (d, v) => setTickLabelPos(d, "", v)));
defineAxisKey("scaled ticks", forAxes("xy", (d, v) => setScaledTicks(d, v)));
defineAxisKey("scale ticks above exponent", forAxes("xy", (d, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null) return false; d.scaleTicksAbove = n; return true; }));
defineAxisKey("scale ticks below exponent", forAxes("xy", (d, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null) return false; d.scaleTicksBelow = n; return true; }));
defineAxisKey("label shift", forAxes("xy", (d, v) => { const n = v === null ? null : readLength(v); if (n === null) return false; d.labelShift = n; return true; }));
defineAxisKey("max space between ticks", forAxes("xy", (d, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null || n <= 0) return false; d.maxSpaceBetweenTicks = n; return true; }));
defineAxisKey("try min ticks", forAxes("xy", (d, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null) return false; d.tryMinTicks = Math.round(n); return true; }));

// Legends (manual axisdescription.tex "Legends", "Legend Appearance"; behaviour L).
/**
 * `legend pos` values: `at` and `anchor` appended to `every axis legend`
 * (L2, measured: the four inner positions sit 3 % in from the box, while the
 * initial `every axis legend` uses `at={(0.98,0.98)}`).
 */
export const LEGEND_POSITIONS: Record<string, string> = {
  "south west": "at={(0.03,0.03)},anchor=south west",
  "south east": "at={(0.97,0.03)},anchor=south east",
  "north west": "at={(0.03,0.97)},anchor=north west",
  "north east": "at={(0.97,0.97)},anchor=north east",
  "outer north east": "at={(1.03,1)},anchor=north west"
};
const LEGEND_CELL_ANCHORS: Record<string, string> = { left: "west", right: "east", center: "center" };
function appendLegendStyle(ctx: Ctx, raw: string): void {
  ctx.model.styles.set("every axis legend", [...(ctx.model.styles.get("every axis legend") ?? []), parseOptionListRaw(`[${raw}]`)]);
}
defineAxisKey("legend pos", (ctx, v) => { const at = LEGEND_POSITIONS[stripBraces(v ?? "")]; if (!at) return false; appendLegendStyle(ctx, at); return true; });
defineAxisKey("legend cell align", (ctx, v) => { const anchor = LEGEND_CELL_ANCHORS[stripBraces(v ?? "")]; if (!anchor) return false; appendLegendStyle(ctx, `cells={anchor=${anchor}}`); return true; });
defineAxisKey("legend columns", (ctx, v) => { const n = v === null ? null : readPgfNumber(v); if (n === null || !Number.isInteger(n) || n === 0 || n < -1) return false; ctx.model.legend.columns = n; return true; });
defineAxisKey("legend plot pos", (ctx, v) => { const text = stripBraces(v ?? ""); if (text !== "left" && text !== "right" && text !== "none") return false; ctx.model.legend.plotPos = text; return true; });
defineAxisKey(["reverse legend", "legend reversed"], (ctx, v) => { const b = readBoolean(v); if (b === null) return false; ctx.model.legend.reverse = b; return true; });
defineAxisKey(["transpose legend", "legend transposed"], (ctx, v) => { const b = readBoolean(v); if (b === null) return false; ctx.model.legend.transpose = b; return true; });
defineAxisKey("legend to name", (ctx, v) => { const name = stripBraces(v ?? ""); if (name === "") delete ctx.model.legend.toName; else ctx.model.legend.toName = name; return true; });
defineAxisKey("legend entries", (ctx, v, use) => {
  const entries = splitTopLevelList(stripBraces(v ?? "")).map((item) => legendEntryText(item, use.origin.span));
  // Editing: where each item's text is written, when the value is the one in the document (the evaluator checks it).
  const origin = use.origin;
  const base = origin.kind === "kv" && origin.valueSpan && v !== null && v === origin.valueRaw ? origin.valueSpan.from : null;
  let cursor = 0;
  ctx.model.legend.entries = entries.map((entry) => {
    if (base === null || v === null || entry.text.length === 0) return entry;
    const at = v.indexOf(entry.text, cursor);
    if (at < 0) return entry;
    cursor = at + entry.text.length;
    return { ...entry, textSpan: { from: base + at, to: base + at + entry.text.length } };
  });
  return true;
});

/** `[opts]text` or `{[opts]text}` → options and text (manual `legend entries`). */
export function legendEntryText(raw: string, span: Span): LegendEntryText {
  const item = stripBraces(raw.trim());
  if (item.startsWith("[")) {
    let depth = 0;
    for (let i = 0; i < item.length; i += 1) {
      const c = item[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === "]" && depth === 0) return { options: item.slice(1, i), text: item.slice(i + 1).trim(), span };
    }
  }
  return { options: "", text: item, span };
}

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

/** Splits `{a}{b}` (two balanced groups, whitespace between) into their contents. */
function twoGroups(text: string): [string, string] | null {
  const groups: string[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/u.test(text[i] ?? "")) i += 1;
    if (i >= text.length) break;
    if (text[i] !== "{") return null;
    let depth = 0;
    const start = i;
    for (; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") { depth -= 1; if (depth === 0) break; }
    }
    if (depth !== 0) return null;
    groups.push(text.slice(start + 1, i));
    i += 1;
  }
  return groups.length === 2 ? [groups[0] ?? "", groups[1] ?? ""] : null;
}

function setScaledTicks(d: AxisDirectionModel, v: string | null): boolean {
  const text = stripBraces(v ?? "true");
  if (text === "true") { d.scaledTicks = { kind: "auto" }; return true; }
  if (text === "false") { d.scaledTicks = { kind: "none" }; return true; }
  const colon = text.indexOf(":");
  if (colon < 0) return false;
  const mode = text.slice(0, colon).trim();
  const arg = text.slice(colon + 1).trim();
  if (mode === "base 10") {
    const e = readPgfNumber(arg);
    if (e === null || !Number.isInteger(e)) return false;
    d.scaledTicks = { kind: "base10", exponent: e };
    return true;
  }
  if (mode === "real") {
    const n = readPgfNumber(arg);
    if (n === null || n === 0) return false;
    d.scaledTicks = { kind: "real", divisor: n };
    return true;
  }
  if (mode === "manual") {
    const groups = twoGroups(arg);
    if (!groups) return false;
    // The documented form only: code that assigns \pgfmathresult with \pgfmathparse.
    const code = /^\\pgfmathparse\s*\{([\s\S]*)\}\s*%?\s*$/u.exec(groups[1].trim());
    if (!code) return false;
    const expression = code[1] ?? "";
    if (!evaluatePgfMathExpression(expression.replaceAll("#1", "(1)"), { mode: "float" }).ok) return false;
    d.scaledTicks = { kind: "manual", label: groups[0], expression };
    return true;
  }
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
  "restrict expr to domain", "restrict expr to domain*",
  "bar width", "bar shift", "stack plots", "stack dir", "reverse stacked plots",
  "nodes near coords", "every node near coord", "nodes near coords align", "point meta", "bar direction",
  "bar interval width", "bar interval shift",
  "smooth", "tension", "const plot", "const plot mark left", "const plot mark right", "const plot mark mid",
  "jump mark left", "jump mark right", "jump mark mid", "ycomb", "xcomb", "mark repeat", "mark phase", "mark indices",
  // Numbers read the same either way; it only matters for symbolic coordinates, which are diagnosed.
  "plot coordinates/math parser",
  "every mark", "domain", "samples", "forget plot", "samples at", "variable", "trig format plots",
  "unbounded coords", "restrict x to domain", "restrict y to domain", "restrict x to domain*", "restrict y to domain*",
  "line legend", "area legend", "empty legend", "xbar legend", "ybar legend", "zbar legend",
  "xbar interval legend", "ybar interval legend", "zbar interval legend",
  "single xbar legend", "single ybar legend", "single zbar legend", "mesh legend"
]);

/** Keys of a plot that this evaluator understands, beyond the TikZ path keys. */
const PLOT_KEYS = new Set(PLOT_LEVEL_KEYS);

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
    unitRescaleKeepSize: "unless limits declared",
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
    cycleListShift: 0,
    unsupported: [],
    invalid: [],
    plotDefaults: [],
    tableKeys: [],
    legend: { columns: 1, plotPos: "left", reverse: false, transpose: false }
  };
  const ctx: Ctx = { model, expandStyle: () => { /* replaced below, once the sink exists */ } };
  const sink = (use: PgfplotsKeyUse): void => {
    const handler = AXIS_KEYS[use.key];
    if (handler) {
      if (!handler(ctx, use.value, use)) model.invalid.push({ key: use.key, value: use.value ?? "", span: use.origin.span });
      return;
    }
    if (use.key.startsWith("table/")) {
      model.tableKeys.push(keyUseToEntry(use));
      return;
    }
    if (use.key.startsWith("error bars/")) {
      model.plotDefaults.push(use);
      return;
    }
    if (use.key.startsWith("/pgf/number format/") || use.key.startsWith("/pgf/")) {
      model.tikzOptions.push(use);
      return;
    }
    // Manual markers-meta.tex `no markers`: given to an axis it is appended to `every axis plot post`, so it wins over the cycle list.
    if (use.key === "no markers" || use.key === "no marks") {
      model.styles.set("every axis plot post", [...(model.styles.get("every axis plot post") ?? []), parseOptionListRaw("[mark=none]")]);
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
  // Styles a key installs immediately (`axis x line` → `every non boxed x axis`), expanded in place.
  ctx.expandStyle = (name) => { expandPgfplotsOptions(styles.get(name) ?? [], styles, sink, { onProblem: problems }); };
  expandPgfplotsOptions(input.settings, styles, (use) => {
    // Settings outside an axis only define defaults: axis keys there apply to every axis.
    sink(use);
  }, { onProblem: problems });
  // Every axis environment sets both modes at its start (manual
  // axis-addplot.tex: the log environments are `xmode=log`/`ymode=log`), after
  // the `\pgfplotsset` defaults: a bare `\pgfplotsset{xmode=log}` before an
  // `axis` changes nothing (behaviour Q1); `every axis` styles and options can.
  model.x.mode = input.axis.environment === "semilogxaxis" || input.axis.environment === "loglogaxis" ? "log" : "linear";
  model.y.mode = input.axis.environment === "semilogyaxis" || input.axis.environment === "loglogaxis" ? "log" : "linear";
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
export function keyUseToEntry(use: PgfplotsKeyUse): OptionEntry {
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
  /** The plot handler (behaviour P1): `sharp plot` initially. */
  handler: PlotHandlerName;
  tension: number;
  /** `mark repeat`, `mark phase` (TikZ, initially 1) and `mark indices` (1-based). */
  markRepeat: number;
  markPhase: number;
  markIndices?: number[];
  domain?: { from: number; to: number };
  samples?: number;
  /** `samples at={…}` (a `\foreach` list); overrides domain and samples. Empty clears it. */
  samplesAt?: string;
  /** `variable=t` or `variable=\t` (initially x): the name without the backslash. */
  variable: string;
  /** `trig format plots` (initially default: the enclosing `trig format`). */
  trigFormatPlots?: "deg" | "rad";
  /** `unbounded coords` (initially discard; the non-starred restrict keys set jump). */
  unboundedCoords: "discard" | "jump";
  /** `restrict x to domain[*]=min:max` filters, in order (manual coordfiltering.tex). */
  restrict: Array<{ axis: "x" | "y"; min: number; max: number; truncate: boolean }>;
  /** `declare function`/`trig format` given to the plot: they apply to its expressions. */
  pgfmathKeys: PgfplotsKeyUse[];
  /** The legend image kind (`line legend` initially; `area legend`, `empty legend`, …; L5). */
  legendImage: string;
  forget: boolean;
  filters: PlotFilter[];
  /** `table/…` keys given to the plot, in order. */
  tableKeys: OptionEntry[];
  /** The bar handler of the plot (`/tikz/ybar`, …; behaviour U), with its width and shift. */
  bar?: { kind: BarKind; width?: BarLength; shift?: BarLength; relative?: number; intervalShift?: number };
  /** `stack plots=y|x` (U6). */
  stack?: "x" | "y";
  /** `nodes near coords[=text]`: the text template, or null when off (X3). */
  nodesNearCoords: string | null;
  /** `nodes near coords align`, and the `every node near coord` keys in order. */
  nodesNearCoordsAlign: "auto" | "vertical" | "horizontal";
  nodeNearCoordKeys: PgfplotsKeyUse[];
  /** `point meta` (`explicit symbolic`, `explicit`, `x`, `y`, …), when given. */
  pointMeta?: string;
  /** `error bars/…` (X2); undefined when the plot sets none. */
  errorBars?: ErrorBarsModel;
  unsupported: Array<{ key: string; span: Span }>;
  invalid: Array<{ key: string; value: string; span: Span }>;
};

/**
 * `\addplot[opts]`: `every axis plot`, then opts (no cycle list);
 * `\addplot+[opts]` and `\addplot`: `every axis plot`, the cycle entry,
 * then opts (behaviour G2). `every axis plot post` comes last.
 */
export function resolvePlotModel(axis: AxisModel, statement: AddPlotStatement, cycleIndex: number, extraLists: readonly OptionListAst[] = []): PlotModel {
  const styles = cloneStyleRegistry(axis.styles);
  const plot: PlotModel = {
    statement,
    cycleIndex,
    pathKeys: [],
    mark: null,
    markKeys: [],
    onlyMarks: false,
    handler: "sharp",
    tension: 0.5,
    markRepeat: 1,
    markPhase: 1,
    variable: "x",
    unboundedCoords: "discard",
    restrict: [],
    pgfmathKeys: [],
    legendImage: "line legend",
    forget: false,
    filters: [],
    tableKeys: [],
    ...(axis.bar ? {
      bar: { kind: axis.bar.kind, ...(axis.bar.relative !== undefined ? { relative: axis.bar.relative } : {}) },
      ...(axis.bar.stacked ? { stack: axis.bar.kind.startsWith("y") ? "y" as const : "x" as const } : {})
    } : {}),
    nodesNearCoords: null,
    nodesNearCoordsAlign: "auto",
    nodeNearCoordKeys: [],
    unsupported: [],
    invalid: []
  };
  // `bar width`/`bar shift` may come before the bar handler that uses them.
  const pendingBar: { width?: BarLength; shift?: BarLength; relative?: number; intervalShift?: number } = {};
  // The axis styles `ybar`/`xbar` (and stacked) also set `ybar legend`/`xbar legend` (manual 2dplots.tex).
  if (axis.bar && !axis.bar.kind.endsWith("interval")) plot.legendImage = `${axis.bar.kind} legend`;
  const useCycle = statement.increment || !statement.options;
  const lists: OptionListAst[] = [];
  lists.push(...(styles.get("every axis plot") ?? []));
  if (axis.plotDefaults.length > 0) lists.push(parseOptionListRaw(`[${axis.plotDefaults.map((u) => u.value === null ? u.key : `${u.key}=${u.value}`).join(",")}]`));
  // `every axis plot no <i>` comes before the cycle list entry and the options (manual styleoptions.tex).
  lists.push(...(styles.get(`every axis plot no ${String(cycleIndex)}`) ?? []));
  if (useCycle && axis.cycleList.length > 0) {
    const n = axis.cycleList.length;
    const entry = axis.cycleList[(((cycleIndex + axis.cycleListShift) % n) + n) % n] ?? "";
    lists.push(parseOptionListRaw(`[${entry}]`));
  }
  if (statement.options) lists.push(statement.options);
  for (const extra of statement.extraOptions ?? []) lists.push(extra.options);
  if (statement.legacyPlot?.options) lists.push(statement.legacyPlot.options);
  // `no markers` given to the axis goes to `every axis plot post`, so it beats the cycle list (manual markers-meta.tex).
  if (axis.plotDefaults.some((use) => use.key === "no marks" || use.key === "no markers")) lists.push(parseOptionListRaw("[no markers]"));
  lists.push(...(styles.get("every axis plot post") ?? []));
  lists.push(...extraLists);
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
    if (key === "sharp plot") delete plot.bar;
    const handler = PLOT_HANDLER_KEYS[key];
    if (handler) { plot.handler = handler; return; }
    if (key === "tension") {
      const n = value === null ? null : readPgfNumber(value);
      if (n === null) plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      else plot.tension = n;
      return;
    }
    if (key === "mark repeat" || key === "mark phase") {
      const text = stripBraces(value ?? "");
      const n = text === "" ? 1 : readPgfNumber(text);
      if (n === null || !Number.isInteger(n) || n < 1) plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      else if (key === "mark repeat") plot.markRepeat = n; else plot.markPhase = n;
      return;
    }
    if (key === "mark indices") {
      const text = stripBraces(value ?? "");
      if (text === "") { delete plot.markIndices; return; }
      let entries: string[];
      try { entries = expandForeachList(text, { parseExpressions: true }); } catch { entries = []; }
      const values = entries.map((entry) => readPgfNumber(entry));
      if (values.length === 0 || values.includes(null)) plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      else plot.markIndices = values.map((n) => Math.round(n ?? 0));
      return;
    }
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
      const parts = splitDomain(stripBraces(value ?? ""));
      const from = parts ? readPgfNumber(parts[0]) : null;
      const to = parts ? readPgfNumber(parts[1]) : null;
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
    if (key.startsWith("table/")) { plot.tableKeys.push(keyUseToEntry(use)); return; }
    if (key === "ybar" || key === "xbar" || key === "ybar interval" || key === "xbar interval") {
      // The plot handler takes no value (tikz.code.tex); its width is `bar interval width` (E19 `bars-interval`).
      plot.bar = { ...plot.bar, kind: key };
      if (key.endsWith("interval")) delete plot.bar.relative;
      return;
    }
    if (key === "bar interval width" || key === "bar interval shift") {
      const n = value === null ? null : readPgfNumber(value);
      if (n === null) { plot.invalid.push({ key, value: value ?? "", span: use.origin.span }); return; }
      if (key === "bar interval width") pendingBar.relative = n; else pendingBar.intervalShift = n;
      if (plot.bar) plot.bar = { ...plot.bar, ...pendingBar };
      return;
    }
    if (key === "ybar stacked" || key === "xbar stacked") {
      plot.bar = { ...plot.bar, kind: key === "ybar stacked" ? "ybar" : "xbar" };
      plot.stack = key === "ybar stacked" ? "y" : "x";
      return;
    }
    if (key === "bar width" || key === "bar shift") {
      const length = readBarLength(value ?? "");
      if (length === null) { plot.invalid.push({ key, value: value ?? "", span: use.origin.span }); return; }
      const field = key === "bar width" ? "width" : "shift";
      if (plot.bar) plot.bar[field] = length;
      else pendingBar[field] = length;
      return;
    }
    if (key === "stack plots") {
      const dir = stripBraces(value ?? "y");
      if (dir === "x" || dir === "y") plot.stack = dir;
      else if (dir === "false") delete plot.stack;
      else plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      return;
    }
    if (key === "stack dir" || key === "reverse stacked plots" || key === "bar direction") return;
    if (key === "nodes near coords") {
      plot.nodesNearCoords = value === null || stripBraces(value) === "" ? "\\pgfmathprintnumber{\\pgfplotspointmeta}" : stripBraces(value);
      return;
    }
    if (key === "nodes near coords align") {
      const align = stripBraces(value ?? "");
      if (align === "vertical" || align === "horizontal" || align === "auto") plot.nodesNearCoordsAlign = align;
      else plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      return;
    }
    if (key === "every node near coord") return;
    if (key === "point meta") { plot.pointMeta = stripBraces(value ?? ""); return; }
    // `error bars/.cd, y dir=both, y explicit`: the key names are unambiguous with or without the path.
    const errorKey = key.replace(/^error bars\//u, "");
    if (key === "error bars/.cd") return;
    const errorDir = /^(x|y) (dir|explicit|explicit relative|fixed|fixed relative)$/u.exec(errorKey);
    if (errorDir || errorKey === "error mark" || errorKey === "error mark options" || errorKey === "error bar style") {
      plot.errorBars ??= {
        x: { dir: "none", mode: "fixed", value: 0 }, y: { dir: "none", mode: "fixed", value: 0 },
        mark: "-", markOptions: "rotate=90", barStyle: []
      };
      const bars = plot.errorBars;
      if (errorDir) {
        const d = bars[errorDir[1] === "x" ? "x" : "y"];
        const what = errorDir[2] ?? "";
        if (what === "dir") {
          const v = stripBraces(value ?? "");
          if (v === "none" || v === "plus" || v === "minus" || v === "both") d.dir = v;
          else plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
        } else if (what === "explicit" || what === "explicit relative") d.mode = what;
        else {
          const n = value === null ? 0 : readPgfNumber(value);
          if (n === null) plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
          else { d.mode = what === "fixed" ? "fixed" : "fixed relative"; d.value = n; }
        }
      } else if (errorKey === "error mark") {
        const name = stripBraces(value ?? "");
        bars.mark = name === "none" || name === "" ? null : name;
      } else if (errorKey === "error mark options") bars.markOptions = stripBraces(value ?? "");
      else if (value !== null) {
        const list = parseOptionListRaw(`[${stripBraces(value)}]`);
        bars.barStyle.push(...flattenStyleEntries([list], styles));
      }
      return;
    }
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
    if (LEGEND_IMAGE_KEYS.has(key)) { plot.legendImage = key; return; }
    if (key === "legend image code") { plot.legendImage = "legend image code"; return; }
    if (key === "samples at") {
      const text = stripBraces(value ?? "");
      if (text === "") delete plot.samplesAt;
      else plot.samplesAt = text;
      return;
    }
    if (key === "variable") {
      const name = stripBraces(value ?? "").replace(/^\\/u, "");
      if (!/^[A-Za-z]+$/u.test(name)) plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      else plot.variable = name;
      return;
    }
    if (key === "trig format plots") {
      const text = stripBraces(value ?? "");
      if (text === "default") delete plot.trigFormatPlots;
      else if (text === "deg" || text === "rad") plot.trigFormatPlots = text;
      else plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      return;
    }
    if (key === "declare function" || key === "/pgf/declare function" || key === "trig format" || key === "/pgf/trig format") {
      plot.pgfmathKeys.push({ ...use, key: key.replace(/^\/pgf\//u, "") });
      return;
    }
    if (PLOT_KEYS.has(key)) return;
    if (DOCUMENTED_PGFPLOTS_KEYS.has(key) && !TIKZ_ALSO.has(key)) {
      plot.unsupported.push({ key, span: use.origin.span });
      return;
    }
    plot.pathKeys.push(use);
  }, { onProblem: (problem) => plot.unsupported.push({ key: problem.key, span: problem.span }) });
  if (plot.bar) plot.bar = { ...pendingBar, ...plot.bar };
  plot.nodeNearCoordKeys = flattenStyleEntries(styles.get("every node near coord") ?? [], styles);
  plot.markKeys = (styles.get("every mark") ?? []).flatMap((list) => list.entries.map((entry): PgfplotsKeyUse => ({
    key: entry.kind === "unknown" ? entry.raw : entry.key,
    value: entry.kind === "kv" ? entry.valueRaw : null,
    origin: entry
  })));
  return plot;
}

/** `10pt` (a dimension) or `0.5` (axis units). */
export function readBarLength(raw: string): BarLength | null {
  const text = stripBraces(raw);
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/u.test(text)) return { value: Number(text), unit: "axis" };
  const length = readLength(text);
  return length === null ? null : { value: length, unit: "pt" };
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

export type PlotHandlerName = "sharp" | "smooth" | "const-left" | "const-right" | "const-mid" | "jump-left" | "jump-right" | "jump-mid" | "ycomb" | "xcomb";

/** Plot handler keys (manual 2dplots.tex "Linear", "Smooth", "Constant", "Comb Plots"). */
export const PLOT_HANDLER_KEYS: Record<string, PlotHandlerName> = {
  "sharp plot": "sharp", smooth: "smooth", "const plot": "const-left", "const plot mark left": "const-left",
  "const plot mark right": "const-right", "const plot mark mid": "const-mid", "jump mark left": "jump-left",
  "jump mark right": "jump-right", "jump mark mid": "jump-mid", ycomb: "ycomb", xcomb: "xcomb"
};

/** Styles that set `legend image code` (manual "Legend Appearance"). */
export const LEGEND_IMAGE_KEYS = new Set([
  "line legend", "area legend", "empty legend", "xbar legend", "ybar legend", "zbar legend",
  "xbar interval legend", "ybar interval legend", "zbar interval legend",
  "single xbar legend", "single ybar legend", "single zbar legend", "mesh legend"
]);

/** `a:b` at the top-level colon (`domain=-2*pi:{f(1:2)}` keeps the braced colon). */
export function splitDomain(text: string): [string, string] | null {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "{" || c === "(") depth += 1;
    else if (c === "}" || c === ")") depth -= 1;
    else if (c === ":" && depth === 0) return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
  }
  return null;
}

/** Documented pgfplots keys that are also plain TikZ keys and mean the same on a plot path. */
const TIKZ_ALSO = new Set(["color", "draw", "fill", "line width", "opacity", "smooth", "const plot", "thick", "thin"]);
