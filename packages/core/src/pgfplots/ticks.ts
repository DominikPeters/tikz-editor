/**
 * Stage 4 of the axis pipeline: tick positions (behaviour I1–I4, D3) and
 * tick label texts (J1–J4) for linear axes.
 */
import { expandForeachList } from "../foreach/list.js";
import { DEFAULT_PGF_NUMBER_FORMAT, formatPgfNumber, type PgfNumberFormat } from "../semantic/pgfmath/number-format.js";
import type { PlotPoint } from "./data.js";
import { readPgfNumber, type AxisDirectionModel, type TickListSpec } from "./model.js";

export type Tick = {
  /** Data value. */
  value: number;
  /** `\ticknum`. */
  index: number;
  /** Label text (TeX), absent for no label. */
  label?: string;
};

export type DirectionTicks = {
  major: Tick[];
  minor: number[];
  /** The common factor exponent e of scaled ticks (J1), or 0. */
  scaleExponent: number;
  /** Whether labels are drawn at all (`xtick=\empty` draws none). */
  labelled: boolean;
};

/** `x tick placement tolerance` (manual tickoptions.tex), D3. */
export const TICK_PLACEMENT_TOLERANCE_PT = 0.05;

const NICE = [1, 2, 5];

function niceStepBelow(step: number): number {
  const k = Math.floor(Math.log10(step) + 1e-12);
  const m = Math.round(step / 10 ** k);
  const i = NICE.indexOf(m);
  if (i > 0) return (NICE[i - 1] ?? 1) * 10 ** k;
  return 5 * 10 ** (k - 1);
}

/** I1 step and I1b fallback. */
export function automaticTickStep(lo: number, hi: number, length: number, dir: Pick<AxisDirectionModel, "maxSpaceBetweenTicks" | "tryMinTicks">): number {
  const n = Math.max(Math.floor(length / dir.maxSpaceBetweenTicks + 1e-9), dir.tryMinTicks - 1, 1);
  const raw = (hi - lo) / n;
  const k = Math.floor(Math.log10(raw));
  const m = raw / 10 ** k;
  let step = 10 ** k * (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10);
  for (let guard = 0; guard < 8; guard += 1) {
    const count = Math.floor(hi / step + 1e-9) - Math.trunc(lo / step) + 1;
    if (count >= 2) break;
    step = niceStepBelow(step);
  }
  return step;
}

function cleanMultiple(j: number, step: number): number {
  // j * step in decimal: avoid 0.30000000000000004 so labels and \tick read as TeX's.
  const value = j * step;
  const digits = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Number(value.toFixed(Math.min(20, digits)));
}

function listValues(raw: string): number[] | null {
  let entries: string[];
  try {
    entries = expandForeachList(raw, { parseExpressions: true });
  } catch {
    return null;
  }
  const values: number[] = [];
  for (const entry of entries) {
    const n = readPgfNumber(entry);
    if (n === null) return null;
    values.push(n);
  }
  return values;
}

export type TickInput = {
  dir: AxisDirectionModel;
  lo: number;
  hi: number;
  /** Axis length on the canvas (pt). */
  length: number;
  /** `xtick=data`: the coordinates of the plots in this direction. */
  data: readonly number[];
  numberFormat?: PgfNumberFormat;
  /** Where the automatic tick list starts counting (`\ticknum`); `lo` unless the range was degenerate (H2). */
  listBase?: number;
};

export type TickResult = { kind: "ok"; ticks: DirectionTicks } | { kind: "invalid"; what: string };

/** More ticks than this on one axis means the input is degenerate (TeX would fail); none are drawn. */
const MAX_TICKS = 2000;

export function computeTicks(input: TickInput): TickResult {
  const { dir, lo, hi, length } = input;
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi) || !(length > 0)) return { kind: "invalid", what: "limits" };
  const tooMany = (step: number) => !(step > 0) || (hi - lo) / step > MAX_TICKS;
  const tol = (TICK_PLACEMENT_TOLERANCE_PT * (hi - lo)) / length;
  const inside = (v: number) => v >= lo - tol && v <= hi + tol;
  let major: Tick[] = [];
  let step: number | null = null;
  const spec: TickListSpec = dir.ticks;
  if (spec.kind === "empty") {
    major = [];
  } else if (spec.kind === "list" || spec.kind === "data") {
    const values = spec.kind === "data" ? [...new Set(input.data)].sort((a, b) => a - b) : listValues(spec.raw);
    if (!values) return { kind: "invalid", what: spec.kind === "list" ? spec.raw : "data" };
    values.forEach((value, index) => { if (inside(value)) major.push({ value, index }); });
  } else if (dir.tickDistance !== undefined) {
    step = dir.tickDistance;
    if (tooMany(step)) return { kind: "invalid", what: `xtick distance=${String(step)}` };
    const start = Math.trunc(Math.round(((input.listBase ?? lo) / step) * 1e9) / 1e9) - 1;
    for (let j = start; j * step <= hi + tol; j += 1) {
      const value = cleanMultiple(j, step);
      if (inside(value)) major.push({ value, index: j - start });
    }
  } else {
    step = automaticTickStep(lo, hi, length, dir);
    if (tooMany(step)) return { kind: "invalid", what: "automatic ticks" };
    // \ticknum counts from the grid point one below trunc(lo/step) (measured on the fixtures).
    const start = Math.trunc(Math.round(((input.listBase ?? lo) / step) * 1e9) / 1e9) - 1;
    for (let j = start; j * step <= hi + tol; j += 1) {
      const value = cleanMultiple(j, step);
      if (inside(value)) major.push({ value, index: j - start });
    }
  }

  // Minor ticks (I2).
  let minor: number[] = [];
  if (dir.minorTicks && dir.minorTicks.kind !== "auto") {
    if (dir.minorTicks.kind === "list") {
      const values = listValues(dir.minorTicks.raw);
      if (!values) return { kind: "invalid", what: dir.minorTicks.raw };
      minor = values.filter(inside);
    } else if (dir.minorTicks.kind === "data") minor = [...new Set(input.data)].filter(inside);
  } else if (dir.minorTickNum > 0 && major.length > 0) {
    const majorValues = major.map((t) => t.value);
    const interval = step ?? (majorValues.length >= 2 ? (majorValues[1] ?? 0) - (majorValues[0] ?? 0) : null);
    if (interval !== null && interval > 0 && (hi - lo) / interval * dir.minorTickNum < MAX_TICKS) {
      const sub = interval / (dir.minorTickNum + 1);
      const firstMajor = majorValues[0] ?? lo;
      const startJ = Math.floor((lo - firstMajor) / interval) - 1;
      const endJ = Math.ceil((hi - firstMajor) / interval) + 1;
      for (let j = startJ; j <= endJ; j += 1) {
        for (let k = 1; k <= dir.minorTickNum; k += 1) {
          const v = firstMajor + j * interval + k * sub;
          if (inside(v)) minor.push(v);
        }
      }
    }
  }

  // Labels (J1–J2).
  const magnitude = Math.max(Math.abs(lo), Math.abs(hi));
  const e = magnitude > 0 ? Math.floor(Math.log10(magnitude) + 1e-12) : 0;
  const scaleExponent = dir.scaledTicks && !dir.tickLabels && (e >= 4 || e <= -2) ? e : 0;
  const format = input.numberFormat ?? DEFAULT_PGF_NUMBER_FORMAT;
  for (const tick of major) {
    if (dir.tickLabels) {
      const text = dir.tickLabels[tick.index];
      if (text !== undefined) tick.label = text;
      else tick.label = "";
    } else {
      const scaled = scaleExponent === 0 ? tick.value : Number((tick.value / 10 ** scaleExponent).toPrecision(15));
      tick.label = `$${formatPgfNumber(scaled, format).tex}$`;
    }
  }
  return { kind: "ok", ticks: { major, minor, scaleExponent, labelled: spec.kind !== "empty" } };
}

/** `xtick=data`: the x coordinates of the first plot (one plot measured; I4). */
export function dataTickValues(plots: ReadonlyArray<readonly PlotPoint[]>, axis: "x" | "y"): number[] {
  const first = plots.find((points) => points.length > 0) ?? [];
  return first.map((p) => (axis === "x" ? p.x : p.y)).filter((v) => Number.isFinite(v));
}
