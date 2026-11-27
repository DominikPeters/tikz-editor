/**
 * Bar plots and stacking (behaviour section U, experiment E19): stacked
 * coordinates, the automatic shifts of several bar plots, and the bar
 * rectangles in canvas coordinates. Pure.
 */
import type { PlotPoint } from "./data.js";
import type { BarKind, BarLength, PlotModel } from "./model.js";

/**
 * U6 — `stack plots=y` (or x): each plot adds its values to the plots
 * stacked before it, coordinate by coordinate (by index); positive and
 * negative values have their own running sums (compat ≥ 1.13, E19
 * `stacked-negative`). Returns the stacked points and, per point, where the
 * plot's previous stack level was (a bar's base).
 */
export function stackPlots(plots: ReadonlyArray<{ model: PlotModel; points: PlotPoint[] | null }>): Map<number, { points: PlotPoint[]; base: number[] }> {
  const out = new Map<number, { points: PlotPoint[]; base: number[] }>();
  const sums: Record<"x" | "y", { pos: number[]; neg: number[] }> = { x: { pos: [], neg: [] }, y: { pos: [], neg: [] } };
  plots.forEach((plot, index) => {
    const dir = plot.model.stack;
    if (!dir || !plot.points) return;
    const acc = sums[dir];
    const base: number[] = [];
    const points = plot.points.map((point, i) => {
      const v = dir === "y" ? point.y : point.x;
      const negative = v < 0;
      const from = (negative ? acc.neg[i] : acc.pos[i]) ?? 0;
      const to = from + v;
      if (negative) acc.neg[i] = to; else acc.pos[i] = to;
      base.push(from);
      return dir === "y" ? { ...point, y: to } : { ...point, x: to };
    });
    out.set(index, { points, base });
  });
  return out;
}

export type BarMap = {
  /** Data to canvas along each direction. */
  mapX: (x: number) => number;
  mapY: (y: number) => number;
  /** pt per data unit along x and y (for widths given in axis units). */
  unitX: number;
  unitY: number;
  limits: { xmin: number; xmax: number; ymin: number; ymax: number };
};

export type BarRect = { x0: number; y0: number; x1: number; y1: number; vertical: boolean };

/** U3: `bar width` initially 10pt; a plain number is in axis units along the bar's width direction. */
function lengthPt(length: BarLength | undefined, fallback: number, unit: number): number {
  if (!length) return fallback;
  return length.unit === "pt" ? length.value : length.value * Math.abs(unit);
}

export type BarGroup = { kind: BarKind; index: number; count: number; sep: number };

/**
 * U4 — `bar shift auto={sep}` (manual 2dplots.tex): plot k of n plots of
 * the same bar type is shifted by −(n·w + (n−1)·sep)/2 + (k + 0.5)·w + k·sep.
 */
export function autoBarShift(width: number, group: BarGroup): number {
  const { count: n, index: k, sep } = group;
  return -0.5 * (n * width + (n - 1) * sep) + (0.5 + k) * width + k * sep;
}

/**
 * The bars of one plot, canvas coordinates. U1: a bar starts at its base
 * (0, or the stack level below it), clamped into the axis limits (E19
 * `ybar-axis`: limits [0.8, 3.2] start the bars at 0.8; `ybar-clip-false`).
 * U2: one rectangle per point, centred at the point plus the shift.
 * U7: interval bars span [x_i, x_{i+1}] (the last point only closes the
 * last interval), each of n interval plots in its own slot of width
 * (x_{i+1} − x_i)/n, the bar `relative` of the slot wide and centred in it.
 */
export function barRects(
  points: readonly PlotPoint[],
  bar: NonNullable<PlotModel["bar"]>,
  map: BarMap,
  options: { base?: readonly number[]; group?: BarGroup }
): BarRect[] {
  const vertical = bar.kind.startsWith("y");
  const { limits } = map;
  const clampBase = (v: number): number => vertical
    ? Math.min(Math.max(v, limits.ymin), limits.ymax)
    : Math.min(Math.max(v, limits.xmin), limits.xmax);
  const rects: BarRect[] = [];
  if (bar.kind.endsWith("interval")) {
    // PGF's handler (pgflibraryplothandlers.code.tex): centre x_i + shift·Δ, width w·Δ
    // (`bar interval shift` 0.5, `bar interval width` 1); the axis style gives each plot a slot.
    const relative = bar.relative ?? 1;
    const slots = options.group?.count ?? 1;
    const slot = options.group?.index ?? 0;
    const centre = options.group ? (slot + 0.5) / slots : bar.intervalShift ?? 0.5;
    for (let i = 0; i + 1 < points.length; i += 1) {
      const p = points[i];
      const q = points[i + 1];
      if (!p || !q) continue;
      const a = vertical ? p.x : p.y;
      const b = vertical ? q.x : q.y;
      const width = (relative * (b - a)) / slots;
      const lo = a + centre * (b - a) - width / 2;
      const hi = lo + width;
      const value = vertical ? p.y : p.x;
      const base = clampBase(options.base?.[i] ?? 0);
      rects.push(vertical
        ? { x0: map.mapX(lo), x1: map.mapX(hi), y0: map.mapY(base), y1: map.mapY(value), vertical }
        : { y0: map.mapY(lo), y1: map.mapY(hi), x0: map.mapX(base), x1: map.mapX(value), vertical });
    }
    return rects;
  }
  const width = lengthPt(bar.width, 10, vertical ? map.unitX : map.unitY);
  const shift = bar.shift ? lengthPt(bar.shift, 0, vertical ? map.unitX : map.unitY) : options.group ? autoBarShift(width, options.group) : 0;
  points.forEach((point, i) => {
    const base = clampBase(options.base?.[i] ?? 0);
    if (vertical) {
      const center = map.mapX(point.x) + shift;
      rects.push({ x0: center - width / 2, x1: center + width / 2, y0: map.mapY(base), y1: map.mapY(point.y), vertical });
    } else {
      const center = map.mapY(point.y) + shift;
      rects.push({ y0: center - width / 2, y1: center + width / 2, x0: map.mapX(base), x1: map.mapX(point.x), vertical });
    }
  });
  return rects;
}

/** U2: the subpath of one bar as PGF draws it: from the base corner along the base, up, back, close. */
export function barCorners(rect: BarRect): Array<{ x: number; y: number }> {
  return rect.vertical
    ? [{ x: rect.x0, y: rect.y0 }, { x: rect.x1, y: rect.y0 }, { x: rect.x1, y: rect.y1 }, { x: rect.x0, y: rect.y1 }]
    : [{ x: rect.x0, y: rect.y0 }, { x: rect.x1, y: rect.y0 }, { x: rect.x1, y: rect.y1 }, { x: rect.x0, y: rect.y1 }];
}

/** The bar groups for automatic shifts and interval slots (U4, U7): plots of one bar kind, not stacked. */
export function barGroups(models: ReadonlyArray<PlotModel | null>, sep: number | undefined, intervalStyle = false): Map<number, BarGroup> {
  const groups = new Map<number, BarGroup>();
  const byKind = new Map<BarKind, number[]>();
  models.forEach((model, index) => {
    if (!model?.bar || model.stack) return;
    if (model.bar.kind.endsWith("interval") ? !intervalStyle : sep === undefined) return;
    const list = byKind.get(model.bar.kind) ?? [];
    list.push(index);
    byKind.set(model.bar.kind, list);
  });
  for (const [kind, list] of byKind) {
    list.forEach((plotIndex, k) => groups.set(plotIndex, { kind, index: k, count: list.length, sep: sep ?? 0 }));
  }
  return groups;
}
