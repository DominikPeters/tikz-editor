/**
 * Stage 1 of the axis pipeline (design/pgfplots.md 4.2): resolve the
 * `\pgfplotsset` settings, `every axis` styles and the environment's own
 * options into a typed `AxisModel`, and each `\addplot`'s options (with the
 * cycle list) into a `PlotModel`. Pure: no scene, no text engine.
 */
import type { AddPlotStatement, AxisStatement, Span } from "../ast/types.js";
import { parseOptionListRaw } from "../options/parse.js";
import type { OptionListAst } from "../options/types.js";
import { parseLength } from "../semantic/coords/parse-length.js";
import { expandForeachList } from "../foreach/list.js";
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
  /** `cycle list shift` (initially empty: 0). */
  cycleListShift: number;
  /** Keys this evaluator does not implement, by name, with where they were written. */
  unsupported: Array<{ key: string; span: Span }>;
  /** Keys whose value could not be read. */
  invalid: Array<{ key: string; value: string; span: Span }>;
  /** Plot-level keys given at axis level (`mark=*`, `only marks`), applied to every plot after `every axis plot`. */
  plotDefaults: PgfplotsKeyUse[];
  /** Legend keys (behaviour L); the legend's TikZ style is `every axis legend` in `styles`. */
  legend: LegendModel;
};

/** One legend text: `\addlegendentry[opts]{text}`, a `\legend` item or a `legend entries` item (`[opts]text`). */
export type LegendEntryText = { text: string; options: string; span: Span };

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
    scaledTicks: true,
    labelShift: 0,
    maxSpaceBetweenTicks: 35,
    tryMinTicks: 4
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
  ctx.model.legend.entries = splitTopLevelList(stripBraces(v ?? "")).map((item) => legendEntryText(item, use.origin.span));
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
  "smooth", "tension", "const plot", "const plot mark left", "const plot mark right", "const plot mark mid",
  "jump mark left", "jump mark right", "jump mark mid", "ycomb", "xcomb", "mark repeat", "mark phase", "mark indices",
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
    legend: { columns: 1, plotPos: "left", reverse: false, transpose: false }
  };
  const ctx: Ctx = { model };
  const sink = (use: PgfplotsKeyUse): void => {
    const handler = AXIS_KEYS[use.key];
    if (handler) {
      if (!handler(ctx, use.value, use)) model.invalid.push({ key: use.key, value: use.value ?? "", span: use.origin.span });
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

// ---------------------------------------------------------------------------
// Plots

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
    unsupported: [],
    invalid: []
  };
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
  if (statement.legacyPlot?.options) lists.push(statement.legacyPlot.options);
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
    if (key === "unbounded coords") {
      const text = stripBraces(value ?? "");
      if (text === "discard" || text === "jump") plot.unboundedCoords = text;
      else plot.invalid.push({ key, value: value ?? "", span: use.origin.span });
      return;
    }
    const restrict = /^restrict ([xy]) to domain(\*?)$/u.exec(key);
    if (restrict) {
      const parts = splitDomain(stripBraces(value ?? ""));
      const min = parts ? readPgfNumber(parts[0]) : null;
      const max = parts ? readPgfNumber(parts[1]) : null;
      if (min === null || max === null) { plot.invalid.push({ key, value: value ?? "", span: use.origin.span }); return; }
      const truncate = restrict[2] === "*";
      plot.restrict.push({ axis: restrict[1] === "y" ? "y" : "x", min, max, truncate });
      // Manual coordfiltering.tex: the non-starred versions also set unbounded coords=jump.
      if (!truncate) plot.unboundedCoords = "jump";
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
  plot.markKeys = (styles.get("every mark") ?? []).flatMap((list) => list.entries.map((entry): PgfplotsKeyUse => ({
    key: entry.kind === "unknown" ? entry.raw : entry.key,
    value: entry.kind === "kv" ? entry.valueRaw : null,
    origin: entry
  })));
  return plot;
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
