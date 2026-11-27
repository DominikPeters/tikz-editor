/**
 * Stage 3 of the axis pipeline: final axis limits (behaviour H1–H5).
 */
import type { PlotPoint } from "./data.js";
import type { AxisDirectionModel, AxisModel, EnlargeSpec } from "./model.js";

export type AxisLimits = { xmin: number; xmax: number; ymin: number; ymax: number };

export type LimitsResult =
  /** `tickBase`: the lower limit before the degenerate-range widening (H2), where the automatic tick list starts. */
  | { kind: "ok"; limits: AxisLimits; tickBase: { x: number; y: number } }
  | { kind: "inverted"; axis: "x" | "y"; min: number; max: number };

/**
 * Data range of one direction: points count when they are inside the other
 * direction's explicitly given limits and on the free side of this
 * direction's own given limits (manual specifyrange.tex, "clip limits").
 */
function dataRange(points: readonly PlotPoint[], own: "x" | "y", model: AxisModel): { min: number; max: number } | null {
  const ownDir = model[own];
  const otherDir = own === "x" ? model.y : model.x;
  let min = Infinity;
  let max = -Infinity;
  // A sample computed onto a given limit (domain -3.8:1.4 in steps of 13/60 hits -1.2 up to float
  // noise) counts as on it (behaviour Z16, generator fuzz): tolerance 1e-9 of the limits' scale.
  const tol = (dir: AxisDirectionModel) => 1e-9 * Math.max(1e-300, Math.abs(dir.min ?? 0), Math.abs(dir.max ?? 0), dir.min !== undefined && dir.max !== undefined ? dir.max - dir.min : 0);
  const otherTol = tol(otherDir); const ownTol = tol(ownDir);
  for (const point of points) {
    const v = own === "x" ? point.x : point.y;
    const o = own === "x" ? point.y : point.x;
    if (!Number.isFinite(v) || !Number.isFinite(o)) continue;
    if (otherDir.min !== undefined && o < otherDir.min - otherTol) continue;
    if (otherDir.max !== undefined && o > otherDir.max + otherTol) continue;
    if (ownDir.min !== undefined && v < ownDir.min - ownTol) continue;
    if (ownDir.max !== undefined && v > ownDir.max + ownTol) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return min <= max ? { min, max } : null;
}

/** Enlargement of one direction; `boxLength` is needed only for `abs=<dimension>` (H4, approximate). */
function enlarge(dir: AxisDirectionModel, a: number, b: number, boxLength: number | null): { lo: number; hi: number } {
  const givenMin = dir.min !== undefined;
  const givenMax = dir.max !== undefined;
  const lo0 = dir.min ?? a;
  const hi0 = dir.max ?? b;
  const spec: EnlargeSpec = dir.enlarge;
  if (spec.kind === "auto") {
    const range = hi0 - lo0;
    return { lo: givenMin ? lo0 : lo0 - 0.1 * range, hi: givenMax ? hi0 : hi0 + 0.1 * range };
  }
  const range = hi0 - lo0;
  let amount: number;
  if (spec.kind === "rel") amount = spec.value * range;
  else if (spec.kind === "abs") amount = spec.value;
  else {
    // H4: the data range occupies about (L − 2d); exactness is OPEN in the behaviour log.
    const length = boxLength ?? 0;
    amount = length > 2 * spec.value ? (range * spec.value) / (length - 2 * spec.value) : 0;
  }
  return { lo: spec.lower ? lo0 - amount : lo0, hi: spec.upper ? hi0 + amount : hi0 };
}

function degenerate(lo: number, hi: number, spec: EnlargeSpec, mode: AxisDirectionModel["mode"]): { lo: number; hi: number } {
  if (lo !== hi) return { lo, hi };
  if (spec.kind === "abs") return { lo, hi };
  // AA (E22 s0-56, s0-73): on a log direction a single value v widens to
  // [v − 1, v + 1] in the internal coordinate (a factor e each way).
  if (mode === "log") return { lo: lo - 1, hi: hi + 1 };
  // H2: ±20 % of |v|, or [−1, 1] at zero.
  if (lo === 0) return { lo: -1, hi: 1 };
  const d = 0.2 * Math.abs(lo);
  return { lo: lo - d, hi: hi + d };
}

export function computeLimits(model: AxisModel, plots: ReadonlyArray<readonly PlotPoint[]>, boxLengths: { x: number | null; y: number | null }): LimitsResult {
  const all = plots.flat();
  const result: Partial<AxisLimits> = {};
  const tickBase = { x: 0, y: 0 };
  for (const axis of ["x", "y"] as const) {
    const dir = model[axis];
    if (dir.min !== undefined && dir.max !== undefined && dir.min > dir.max) return { kind: "inverted", axis, min: dir.min, max: dir.max };
    const range = dataRange(all, axis, model);
    // H3 (corrected on the empty-axis fixture): without data the range is
    // [0, 1], enlarged like data ([-0.1, 1.1] by default).
    const data = range ?? { min: 0, max: 1 };
    const enlarged = enlarge(dir, data.min, data.max, axis === "x" ? boxLengths.x : boxLengths.y);
    const { lo, hi } = degenerate(enlarged.lo, enlarged.hi, dir.enlarge, dir.mode);
    tickBase[axis] = enlarged.lo;
    if (lo > hi) return { kind: "inverted", axis, min: lo, max: hi };
    if (axis === "x") { result.xmin = lo; result.xmax = hi; } else { result.ymin = lo; result.ymax = hi; }
  }
  const { xmin, xmax, ymin, ymax } = result;
  if (xmin === undefined || xmax === undefined || ymin === undefined || ymax === undefined) throw new Error("limits incomplete");
  return { kind: "ok", limits: { xmin, xmax, ymin, ymax }, tickBase };
}
