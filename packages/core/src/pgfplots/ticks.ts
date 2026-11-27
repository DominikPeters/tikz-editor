/**
 * Stage 4 of the axis pipeline: tick positions (behaviour I1–I4, D3) and
 * tick label texts (J1–J4) for linear axes.
 */
import { expandForeachList } from "../foreach/list.js";
import { DEFAULT_PGF_NUMBER_FORMAT, formatPgfNumber, type PgfNumberFormat } from "../semantic/pgfmath/number-format.js";
import type { PlotPoint } from "./data.js";
import { readPgfNumber, type AxisDirectionModel, type TickListSpec } from "./model.js";
import { displayFactor, toInternal } from "./scale.js";

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
  /** `extra x ticks` (drawn after the major ticks, with `every extra x tick`). */
  extra?: Tick[];
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
  // pgfplots switches ~6e-6 relatively early (I1); at an exact tie (range 0.6 over 4 intervals: m = 1.5
  // up to float noise) it takes the larger step, so the comparison carries that margin (behaviour Z7).
  const early = 1 - 5e-6;
  let step = 10 ** k * (m < 1.5 * early ? 1 : m < 3.5 * early ? 2 : m < 7.5 * early ? 5 : 10);
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

// ---------------------------------------------------------------------------
// Log axes (behaviour Q3, Q4)

/** The range pgfplots compares with its step thresholds is 0.001 internal units larger than the limits (Q3, bisected). */
const LOG_RANGE_SLACK = 0.001;

/** An exact decade nudged away from zero, as pgfplots' stored logarithms behave (Q3: 1e-3 as below -3, 1e2 as at or above 2). */
function nudged(v: number): number {
  return v * (1 + 1e-9);
}

function niceStep(raw: number): number {
  const k = Math.floor(Math.log10(raw) + 1e-12);
  const m = raw / 10 ** k;
  return 10 ** k * (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10);
}

function cleanExponent(e: number): number {
  const rounded = Math.round(e);
  if (Math.abs(e - rounded) < 1e-9) return rounded;
  return Number(e.toPrecision(12));
}

/** `$10^{e}$` (manual numberformatting.tex, `log number format basis`), or a fixed-point number with `log ticks with fixed point`. */
export function logTickLabel(dir: AxisDirectionModel, internal: number, format: PgfNumberFormat): string {
  const exponent = cleanExponent(internal * displayFactor(dir));
  if (dir.logTicksFixedPoint) {
    const value = (dir.logBasis ?? 10) ** exponent;
    return `$${formatPgfNumber(Number(value.toPrecision(12)), { ...format, printer: "fixed" }).tex}$`;
  }
  return `$${dir.logBasisText ?? "10"}^{${formatPgfNumber(exponent, format).tex}}$`;
}

/**
 * `log identify minor tick positions=true`, set by the initial `every extra x
 * tick` style (manual styleoptions.tex): a value m·10^k (m = 2…9) prints as
 * `$m \cdot 10^{k}$` (log-extra-ticks).
 */
function identifiedLogLabel(dir: AxisDirectionModel, internal: number, format: PgfNumberFormat): string | null {
  if (dir.logBasis !== undefined && dir.logBasis !== 10) return null;
  const d = internal * displayFactor(dir);
  const k = Math.floor(d + 1e-9);
  const m = 10 ** (d - k);
  const rounded = Math.round(m);
  if (rounded < 2 || rounded > 9 || Math.abs(m - rounded) > 1e-6 * rounded) return null;
  return `$${String(rounded)}\\cdot 10^{${formatPgfNumber(k, format).tex}}$`;
}

/** A tick list of a log direction as internal coordinates (values without a logarithm dropped), numbered in list order. */
function logListValues(dir: AxisDirectionModel, spec: TickListSpec, data: readonly number[]): Array<{ value: number; index: number }> | null {
  if (spec.kind === "data") return [...new Set(data)].sort((a, b) => a - b).map((value, index) => ({ value, index }));
  if (spec.kind === "ten") {
    const exponents = listValues(spec.raw);
    return exponents ? exponents.map((e, index) => ({ value: e / displayFactor(dir), index })) : null;
  }
  if (spec.kind !== "list") return [];
  const values = listValues(spec.raw);
  if (!values) return null;
  return values.map((v, index) => ({ value: toInternal(dir, v), index })).filter((t) => Number.isFinite(t.value));
}

/**
 * Ticks of a log direction. `lo`, `hi` and the tick values are internal
 * coordinates; the automatic rule (Q3) works on exponents in the display basis.
 */
export function computeLogTicks(input: TickInput): TickResult {
  const { dir, lo, hi, length } = input;
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi) || !(length > 0)) return { kind: "invalid", what: "limits" };
  const f = displayFactor(dir);
  const tol = (TICK_PLACEMENT_TOLERANCE_PT * (hi - lo)) / length;
  const inside = (v: number) => v >= lo - tol && v <= hi + tol;
  const format = input.numberFormat ?? DEFAULT_PGF_NUMBER_FORMAT;
  let major: Tick[] = [];
  let minor: number[] = [];
  const spec = dir.ticks;
  if (spec.kind === "empty") major = [];
  else if (spec.kind !== "auto") {
    const values = logListValues(dir, spec, input.data);
    if (!values) return { kind: "invalid", what: "raw" in spec ? spec.raw : "data" };
    major = values.filter((t) => inside(t.value));
    // A list one decade apart keeps the minor log ticks (manual: minor ticks need a uniform list,
    // log(10) apart on log axes; log-extra-ticks).
    const ds = values.map((t) => t.value * f);
    const uniform = ds.length >= 2 && ds.every((d, i) => i === 0 || Math.abs(d - (ds[i - 1] ?? 0) - 1) < 1e-6);
    if (uniform && (dir.logBasis === undefined || dir.logBasis === 10)) {
      const slack = LOG_RANGE_SLACK * f;
      for (let i = Math.floor(nudged(lo * f)); i < Math.floor(hi * f + slack + 0.5); i += 1) {
        for (let m = 1; m <= 9; m += 1) {
          const v = (i + Math.log10(m)) / f;
          if (inside(v)) minor.push(v);
        }
      }
    }
  } else if (dir.tickDistance !== undefined) {
    return { kind: "invalid", what: "xtick distance on a log axis" };
  } else {
    const dlo = lo * f; const dhi = hi * f; const dtol = tol * f;
    const slack = LOG_RANGE_SLACK * f;
    const R = dhi - dlo + slack;
    const fit = Math.floor(length / dir.maxSpaceBetweenTicks + 1e-9);
    // Decade candidates: every k-th decade from the first one above lo.
    const k = Math.max(1, Math.floor(R / Math.max(fit, 2)));
    const start = Math.floor(nudged(dlo)) + 1;
    let count = 0;
    while (start + count * k <= dhi + slack && count < MAX_TICKS) count += 1;
    const decades = count >= (k === 1 ? 2 : 3);
    if (decades && k >= 2) {
      for (let j = 0; start + j * k <= dhi + dtol; j += 1) major.push({ value: (start + j * k) / f, index: j });
    } else {
      let step = decades ? 1 : niceStep(R / Math.max(fit - 1, 2));
      if (!(step > 0) || R / step > MAX_TICKS) return { kind: "invalid", what: "automatic ticks" };
      if (!decades) {
        // Fewer than two grid points from trunc(lo/step) up to hi: the next smaller step (as I1b).
        for (let guard = 0; guard < 8; guard += 1) {
          if (Math.floor(dhi / step + 1e-9) - Math.trunc(dlo / step) + 1 >= 2) break;
          step = niceStepBelow(step);
        }
      }
      const base = Math.floor(nudged(dlo) / step + 1e-9);
      for (let j = Math.floor((dlo - dtol) / step); j * step <= dhi + dtol; j += 1) {
        const d = step >= 1 ? j * step : cleanMultiple(j, step);
        if (d >= dlo - dtol) major.push({ value: d / f, index: j - base });
      }
      // Q4: minor ticks at m·10^i (m = 1…9) in decade mode, base-10 display only.
      if (decades && (dir.logBasis === undefined || dir.logBasis === 10)) {
        for (let i = Math.floor(nudged(dlo)); i < Math.floor(dhi + slack + 0.5); i += 1) {
          for (let m = 1; m <= 9; m += 1) {
            const v = (i + Math.log10(m)) / f;
            if (inside(v)) minor.push(v);
          }
        }
      }
    }
  }
  if (dir.minorTicks && dir.minorTicks.kind !== "auto") {
    const values = logListValues(dir, dir.minorTicks, input.data);
    if (!values) return { kind: "invalid", what: "minor ticks" };
    minor = values.map((t) => t.value).filter(inside);
  }
  for (const tick of major) tick.label = dir.tickLabels ? dir.tickLabels[tick.index] ?? "" : logTickLabel(dir, tick.value, format);
  return { kind: "ok", ticks: { major, minor, scaleExponent: 0, labelled: spec.kind !== "empty" } };
}

/**
 * `extra x ticks` (manual tickoptions.tex): the listed values inside the
 * limits (logarithms on a log axis), numbered in list order, labelled like
 * major ticks unless `extra x tick labels` gives the texts.
 */
export function computeExtraTicks(input: TickInput, scaleExponent: number): Tick[] | null {
  const { dir, lo, hi, length } = input;
  const spec = dir.extraTicks;
  if (!spec || spec.kind === "auto" || spec.kind === "empty") return [];
  const tol = (TICK_PLACEMENT_TOLERANCE_PT * (hi - lo)) / length;
  const format = input.numberFormat ?? DEFAULT_PGF_NUMBER_FORMAT;
  const values = dir.mode === "log" ? logListValues(dir, spec, input.data)
    : spec.kind === "list" ? listValues(spec.raw)?.map((value, index) => ({ value, index })) ?? null
      : spec.kind === "data" ? [...new Set(input.data)].sort((a, b) => a - b).map((value, index) => ({ value, index })) : null;
  if (!values) return null;
  const ticks = values.filter((t) => t.value >= lo - tol && t.value <= hi + tol).map((t): Tick => ({ value: t.value, index: t.index }));
  for (const tick of ticks) {
    if (dir.extraTickLabels) tick.label = dir.extraTickLabels[tick.index] ?? "";
    else if (dir.mode === "log") tick.label = identifiedLogLabel(dir, tick.value, format) ?? logTickLabel(dir, tick.value, format);
    else {
      const scaled = scaleExponent === 0 ? tick.value : Number((tick.value / 10 ** scaleExponent).toPrecision(15));
      tick.label = `$${formatPgfNumber(scaled, format).tex}$`;
    }
  }
  return ticks;
}
