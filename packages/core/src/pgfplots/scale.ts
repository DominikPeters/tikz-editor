/**
 * Log axes (behaviour Q1): a log direction works in pgfplots' internal
 * coordinate, the logarithm of the data value — natural log unless
 * `log basis x` is set. Limits, the data-to-canvas map and `\tick` are in
 * that coordinate; tick labels show the exponent in the display basis (10
 * unless `log basis x` is set).
 */
import type { AxisDirectionModel, AxisModel } from "./model.js";

/** The logarithm base of the internal coordinate. */
export function internalBase(dir: Pick<AxisDirectionModel, "logBasis">): number {
  return dir.logBasis ?? Math.E;
}

/** Data value → internal coordinate; NaN for a value without a logarithm (pgfplots discards it). */
export function toInternal(dir: Pick<AxisDirectionModel, "mode" | "logBasis">, value: number): number {
  if (dir.mode !== "log") return value;
  if (!(value > 0)) return Number.NaN;
  return Math.log(value) / Math.log(internalBase(dir));
}

/** Internal coordinate → data value. */
export function fromInternal(dir: Pick<AxisDirectionModel, "mode" | "logBasis">, value: number): number {
  if (dir.mode !== "log") return value;
  return internalBase(dir) ** value;
}

/** Internal coordinate → exponent in the display basis (log10 by default). */
export function displayFactor(dir: Pick<AxisDirectionModel, "logBasis">): number {
  return dir.logBasis === undefined ? 1 / Math.LN10 : 1;
}

/**
 * The model with the limits of log directions as internal coordinates
 * (`xmin=1` → 0) and `abs` enlargement as a factor (manual specifyrange.tex:
 * "applied multiplicatively for logarithmic axes"). Limits without a
 * logarithm are dropped and reported.
 */
export function internalLimitsModel(model: AxisModel): { model: AxisModel; invalid: Array<{ key: string; value: number }> } {
  const invalid: Array<{ key: string; value: number }> = [];
  const convert = (letter: "x" | "y"): AxisDirectionModel => {
    const dir = model[letter];
    if (dir.mode !== "log") return dir;
    const out: AxisDirectionModel = { ...dir };
    for (const key of ["min", "max"] as const) {
      const v = dir[key];
      if (v === undefined) continue;
      const internal = toInternal(dir, v);
      if (Number.isFinite(internal)) out[key] = internal;
      else { delete out[key]; invalid.push({ key: `${letter}${key}`, value: v }); }
    }
    if (dir.enlarge.kind === "abs") out.enlarge = { ...dir.enlarge, value: dir.enlarge.value > 0 ? Math.log(dir.enlarge.value) / Math.log(internalBase(dir)) : 0 };
    return out;
  };
  return { model: { ...model, x: convert("x"), y: convert("y") }, invalid };
}
