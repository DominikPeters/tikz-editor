/**
 * Stage 5 of the axis pipeline: the size model, the data-to-canvas map,
 * tick and grid geometry, description placement, the axis' bounding box,
 * anchors and its final position (behaviour A–F, D, E, J3).
 *
 * Coordinates are those of the frame the axis is written in (pt, y up),
 * before that frame's own transform. Text is measured through the
 * `LabelMeasurer` the caller supplies, so this stage stays pure.
 */
import type { OptionListAst } from "../options/types.js";
import type { AxisLimits } from "./limits.js";
import type { AxisModel } from "./model.js";
import type { DirectionTicks } from "./ticks.js";

export type Point = { x: number; y: number };
export type Box = { minX: number; minY: number; maxX: number; maxY: number };
export type Segment = { from: Point; to: Point };

export type LabelRole = "xtick" | "ytick" | "xscale" | "yscale" | "xlabel" | "ylabel" | "title" | "legend" | "legend-entry";

export type LabelRequest = {
  role: LabelRole;
  /** For tick labels: the tick's position in `ticks.major`. */
  tickPosition?: number;
  text: string;
  /** Style lists in application order (pgfplots styles, then placement). */
  styles: OptionListAst[];
  /** Placement keys this stage decides (`anchor=north`, `rotate=90`, `inner sep=0pt`). */
  placement: string;
  /** Where the anchor goes (local coordinates). */
  at: Point;
};

export type LabelGeometry = {
  /** Node anchors (local coordinates), at least the 9 compass anchors, `base`, `mid`. */
  anchors: Record<string, Point>;
  /** The node's border box without outer sep (local coordinates, axis-aligned hull). */
  border: Box;
};

export type LabelMeasurer = (request: LabelRequest) => LabelGeometry | null;

export type PlacedLabel = { request: LabelRequest; geometry: LabelGeometry | null };

export type AxisLayout = {
  limits: AxisLimits;
  /** The axis rectangle, after the `at`/`anchor` translation. */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Translation applied by `at`/`anchor` (A6). */
  translation: Point;
  /** Canvas image of data (0,0) and the displacement per data unit (B1). */
  map: { origin: Point; xUnit: Point; yUnit: Point };
  ticks: { x: DirectionTicks; y: DirectionTicks };
  tickMarks: { x: { major: Segment[]; minor: Segment[] }; y: { major: Segment[]; minor: Segment[] } };
  grid: { x: { major: Segment[]; minor: Segment[] }; y: { major: Segment[]; minor: Segment[] } };
  /** In paint order: x tick labels, y tick labels, scale labels, then descriptions. */
  labels: PlacedLabel[];
  /** Axis line width (the box stroke; F1 outsets the box by half of it). */
  lineWidth: number;
  /** Which directions clamp the `origin` anchor into the box (linear ones, Q5). */
  originClamp: { x: boolean; y: boolean };
  /** Outer bounding box (F1). */
  bbox: Box;
  /** `current axis` anchors (A7). */
  anchors: Record<string, Point>;
};

export type LayoutInput = {
  model: AxisModel;
  limits: AxisLimits;
  ticks: { x: DirectionTicks; y: DirectionTicks };
  /** Style lists for the label roles, from the model's registry. */
  labelStyles: Record<LabelRole, OptionListAst[]>;
  /** Line width of the axis box (`every axis` TikZ options). */
  lineWidth: number;
  /** Line width of the tick marks of one kind; their paths count for F1 with half of it (tick-styles fixture). */
  tickLineWidth: (axis: "x" | "y", kind: "major" | "minor") => number;
  /** Mark extents in local, untranslated coordinates (F1 counts markers). */
  markBounds: (map: (x: number, y: number) => Point) => Box | null;
  /** `at=` evaluated in the enclosing frame, or null for the origin. */
  at: Point | null;
  measure: LabelMeasurer;
};

export const DEFAULT_WIDTH = 240;
export const DEFAULT_HEIGHT = 207;
/** A2: the constant the size model subtracts for descriptions. */
export const DESCRIPTION_ALLOWANCE = 45;

/** A2–A4: box size. */
export function boxSize(model: AxisModel, limits: AxisLimits): { width: number; height: number } {
  const wTarget = model.width ?? (model.height !== undefined ? (model.height * DEFAULT_WIDTH) / DEFAULT_HEIGHT : DEFAULT_WIDTH);
  const hTarget = model.height ?? (model.width !== undefined ? (model.width * DEFAULT_HEIGHT) / DEFAULT_WIDTH : DEFAULT_HEIGHT);
  const allowance = model.scaleOnlyAxis ? 0 : DESCRIPTION_ALLOWANCE;
  const width = model.x.unit !== undefined ? model.x.unit * (limits.xmax - limits.xmin) : wTarget - allowance;
  const height = model.y.unit !== undefined ? model.y.unit * (limits.ymax - limits.ymin) : hTarget - allowance;
  return { width: width * model.scale, height: height * model.scale };
}

/** The box size when it does not depend on the limits (unit vectors not given), for enlargement by a dimension. */
export function boxSizeWithoutLimits(model: AxisModel): { x: number | null; y: number | null } {
  const { unit: _xUnit, ...x } = model.x;
  const { unit: _yUnit, ...y } = model.y;
  void _xUnit; void _yUnit;
  const size = boxSize({ ...model, x, y }, { xmin: 0, xmax: 1, ymin: 0, ymax: 1 });
  return { x: model.x.unit === undefined ? size.width : null, y: model.y.unit === undefined ? size.height : null };
}

function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

function tickShift(align: "inside" | "outside" | "center", length: number): number {
  return align === "inside" ? 0 : align === "outside" ? length : length / 2;
}

/** Tick segment across an edge (C4). `inward` is the unit normal pointing into the box. */
function tickSegment(edge: Point, inward: Point, length: number, align: "inside" | "outside" | "center"): Segment {
  const start = align === "inside" ? 0 : align === "outside" ? -length : -length / 2;
  const end = start + length;
  return {
    from: { x: edge.x + inward.x * start, y: edge.y + inward.y * start },
    to: { x: edge.x + inward.x * end, y: edge.y + inward.y * end }
  };
}

export function computeAxisLayout(input: LayoutInput): AxisLayout {
  const { model, limits, ticks } = input;
  const size = boxSize(model, limits);
  const x0 = 0; const y0 = 0; const x1 = size.width; const y1 = size.height;
  const sx = (x1 - x0) / (limits.xmax - limits.xmin);
  const sy = (y1 - y0) / (limits.ymax - limits.ymin);
  const mapX = (x: number) => x0 + sx * (x - limits.xmin);
  const mapY = (y: number) => y0 + sy * (y - limits.ymin);

  const tickMarks: AxisLayout["tickMarks"] = { x: { major: [], minor: [] }, y: { major: [], minor: [] } };
  const grid: AxisLayout["grid"] = { x: { major: [], minor: [] }, y: { major: [], minor: [] } };
  for (const axis of ["x", "y"] as const) {
    const dir = model[axis];
    const t = ticks[axis];
    for (const kind of ["minor", "major"] as const) {
      const values = kind === "major" ? t.major.map((tick) => tick.value) : t.minor;
      const length = kind === "major" ? model.majorTickLength : model.minorTickLength;
      const lower: Segment[] = []; const upper: Segment[] = [];
      for (const v of values) {
        if (axis === "x") {
          const X = mapX(v);
          lower.push(tickSegment({ x: X, y: y0 }, { x: 0, y: 1 }, length, dir.tickAlign));
          upper.push(tickSegment({ x: X, y: y1 }, { x: 0, y: -1 }, length, dir.tickAlign));
          grid.x[kind].push({ from: { x: X, y: y0 }, to: { x: X, y: y1 } });
        } else {
          const Y = mapY(v);
          lower.push(tickSegment({ x: x0, y: Y }, { x: 1, y: 0 }, length, dir.tickAlign));
          upper.push(tickSegment({ x: x1, y: Y }, { x: -1, y: 0 }, length, dir.tickAlign));
          grid.y[kind].push({ from: { x: x0, y: Y }, to: { x: x1, y: Y } });
        }
      }
      tickMarks[axis][kind] = [...(dir.tickPos !== "upper" ? lower : []), ...(dir.tickPos !== "lower" ? upper : [])];
      if (!(kind === "major" ? dir.majorGrids : dir.minorGrids)) grid[axis][kind] = [];
    }
  }

  // Tick labels (D1).
  const labels: PlacedLabel[] = [];
  const place = (request: LabelRequest): PlacedLabel => {
    const placed = { request, geometry: input.measure(request) };
    labels.push(placed);
    return placed;
  };
  const tickLabelSide = (axis: "x" | "y"): "lower" | "upper" => {
    const dir = model[axis];
    if (dir.tickLabelPos !== "default") return dir.tickLabelPos;
    return dir.tickPos === "upper" ? "upper" : "lower";
  };
  const xSide = tickLabelSide("x");
  const ySide = tickLabelSide("y");
  const xs = tickShift(model.x.tickAlign, model.majorTickLength);
  const ys = tickShift(model.y.tickAlign, model.majorTickLength);
  const xTickLabels: PlacedLabel[] = [];
  const yTickLabels: PlacedLabel[] = [];
  ticks.x.major.forEach((tick, position) => {
    if (tick.label === undefined || !ticks.x.labelled) return;
    xTickLabels.push(place({
      role: "xtick", tickPosition: position, text: tick.label, styles: input.labelStyles.xtick,
      placement: xSide === "lower" ? "anchor=north" : "anchor=south",
      at: { x: mapX(tick.value), y: xSide === "lower" ? y0 - xs : y1 + xs }
    }));
  });
  ticks.y.major.forEach((tick, position) => {
    if (tick.label === undefined || !ticks.y.labelled) return;
    yTickLabels.push(place({
      role: "ytick", tickPosition: position, text: tick.label, styles: input.labelStyles.ytick,
      placement: ySide === "lower" ? "anchor=east" : "anchor=west",
      at: { x: ySide === "lower" ? x0 - ys : x1 + ys, y: mapY(tick.value) }
    }));
  });

  // E1/E2: the edge of the tick label boxes, or the axis edge shifted by the tick.
  const xLabelsEdge = xTickLabels.reduce((b, l) => (l.geometry ? Math.min(b, l.geometry.border.minY) : b), Infinity);
  const yLabelsEdge = yTickLabels.reduce((b, l) => (l.geometry ? Math.min(b, l.geometry.border.minX) : b), Infinity);
  const bottom = xSide === "lower" && Number.isFinite(xLabelsEdge) ? xLabelsEdge : y0 - xs;
  const left = ySide === "lower" && Number.isFinite(yLabelsEdge) ? yLabelsEdge : x0 - ys;

  // J3: scale labels.
  const W = x1 - x0; const H = y1 - y0;
  if (ticks.x.scaleExponent !== 0 && ticks.x.major.length > 0) {
    place({ role: "xscale", text: `$\\cdot 10^{${String(ticks.x.scaleExponent)}}$`, styles: input.labelStyles.xscale,
      placement: "anchor=north,inner sep=0pt", at: { x: x0 + 0.9 * W, y: bottom - 5 } });
  }
  if (ticks.y.scaleExponent !== 0 && ticks.y.major.length > 0) {
    place({ role: "yscale", text: `$\\cdot 10^{${String(ticks.y.scaleExponent)}}$`, styles: input.labelStyles.yscale,
      placement: "anchor=south west,inner sep=0pt", at: { x: x0 + 3, y: y0 + 1.03 * H } });
  }

  // E1–E3.
  if (model.x.label) {
    place({ role: "xlabel", text: model.x.label.text, styles: input.labelStyles.xlabel, placement: "anchor=north",
      at: { x: (x0 + x1) / 2, y: bottom - model.x.labelShift } });
  }
  if (model.y.label) {
    place({ role: "ylabel", text: model.y.label.text, styles: input.labelStyles.ylabel, placement: "rotate=90,anchor=south",
      at: { x: left - model.y.labelShift, y: (y0 + y1) / 2 } });
  }
  if (model.title) {
    place({ role: "title", text: model.title.text, styles: input.labelStyles.title, placement: "anchor=south",
      at: { x: (x0 + x1) / 2, y: y1 + model.titleShift } });
  }

  // F1.
  const half = input.lineWidth / 2;
  let bbox: Box = { minX: x0 - half, minY: y0 - half, maxX: x1 + half, maxY: y1 + half };
  for (const label of labels) bbox = union(bbox, label.geometry?.border ?? null) ?? bbox;
  for (const axis of ["x", "y"] as const) for (const kind of ["major", "minor"] as const) {
    const h = input.tickLineWidth(axis, kind) / 2;
    for (const s of tickMarks[axis][kind]) {
      bbox = union(bbox, { minX: Math.min(s.from.x, s.to.x) - h, minY: Math.min(s.from.y, s.to.y) - h, maxX: Math.max(s.from.x, s.to.x) + h, maxY: Math.max(s.from.y, s.to.y) + h }) ?? bbox;
    }
  }
  bbox = union(bbox, input.markBounds((x, y) => ({ x: mapX(x), y: mapY(y) }))) ?? bbox;

  const originClamp = { x: model.x.mode !== "log", y: model.y.mode !== "log" };
  const localAnchors = axisAnchors({ x0, y0, x1, y1 }, bbox, { x: mapX(0), y: mapY(0) }, originClamp);
  // A6: `current axis.<anchor>` lands on `at`.
  const target = input.at ?? { x: 0, y: 0 };
  const anchorPoint = localAnchors[model.anchor] ?? localAnchors["south west"] ?? { x: 0, y: 0 };
  const dx = target.x - anchorPoint.x;
  const dy = target.y - anchorPoint.y;
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const shiftSeg = (s: Segment): Segment => ({ from: shift(s.from), to: shift(s.to) });
  const shiftBox = (b: Box): Box => ({ minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy });
  for (const axis of ["x", "y"] as const) for (const kind of ["major", "minor"] as const) {
    tickMarks[axis][kind] = tickMarks[axis][kind].map(shiftSeg);
    grid[axis][kind] = grid[axis][kind].map(shiftSeg);
  }
  const shiftedLabels = labels.map((label): PlacedLabel => ({
    request: { ...label.request, at: shift(label.request.at) },
    geometry: label.geometry && {
      anchors: Object.fromEntries(Object.entries(label.geometry.anchors).map(([k, p]) => [k, shift(p)])),
      border: shiftBox(label.geometry.border)
    }
  }));
  return {
    limits,
    box: { x0: x0 + dx, y0: y0 + dy, x1: x1 + dx, y1: y1 + dy },
    translation: { x: dx, y: dy },
    map: { origin: shift({ x: mapX(0), y: mapY(0) }), xUnit: { x: sx, y: 0 }, yUnit: { x: 0, y: sy } },
    ticks,
    tickMarks,
    grid,
    labels: shiftedLabels,
    lineWidth: input.lineWidth,
    originClamp,
    bbox: shiftBox(bbox),
    anchors: Object.fromEntries(Object.entries(localAnchors).map(([k, p]) => [k, shift(p)]))
  };
}

/** A7: the documented `current axis` anchors of a boxed 2-D axis. */
export function axisAnchors(box: { x0: number; y0: number; x1: number; y1: number }, outer: Box, origin: Point, clamp: { x: boolean; y: boolean } = { x: true, y: true }): Record<string, Point> {
  const { x0, y0, x1, y1 } = box;
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
  const ox = (outer.minX + outer.maxX) / 2; const oy = (outer.minY + outer.maxY) / 2;
  // A log direction's origin is internal 0 (data 1), not clamped into the box (behaviour Q5).
  const clamped = { x: clamp.x ? Math.min(Math.max(origin.x, x0), x1) : origin.x, y: clamp.y ? Math.min(Math.max(origin.y, y0), y1) : origin.y };
  return {
    center: { x: cx, y: cy }, north: { x: cx, y: y1 }, south: { x: cx, y: y0 }, east: { x: x1, y: cy }, west: { x: x0, y: cy },
    "north east": { x: x1, y: y1 }, "north west": { x: x0, y: y1 }, "south east": { x: x1, y: y0 }, "south west": { x: x0, y: y0 },
    "outer center": { x: ox, y: oy }, "outer north": { x: ox, y: outer.maxY }, "outer south": { x: ox, y: outer.minY },
    "outer east": { x: outer.maxX, y: oy }, "outer west": { x: outer.minX, y: oy },
    "outer north east": { x: outer.maxX, y: outer.maxY }, "outer north west": { x: outer.minX, y: outer.maxY },
    "outer south east": { x: outer.maxX, y: outer.minY }, "outer south west": { x: outer.minX, y: outer.minY },
    "above north": { x: cx, y: outer.maxY }, "above north east": { x: x1, y: outer.maxY }, "right of north east": { x: outer.maxX, y: y1 },
    "right of east": { x: outer.maxX, y: cy }, "right of south east": { x: outer.maxX, y: y0 }, "below south east": { x: x1, y: outer.minY },
    "below south": { x: cx, y: outer.minY }, "below south west": { x: x0, y: outer.minY }, "left of south west": { x: outer.minX, y: y0 },
    "left of west": { x: outer.minX, y: cy }, "left of north west": { x: outer.minX, y: y1 }, "above north west": { x: x0, y: outer.maxY },
    // The origin anchors stay on the box: data (0,0) clamped into it, and its
    // projections onto the box edges (measured on the fixtures, behaviour A7).
    origin: clamped, "above origin": { x: clamped.x, y: y1 }, "right of origin": { x: x1, y: clamped.y },
    "below origin": { x: clamped.x, y: y0 }, "left of origin": { x: x0, y: clamped.y }
  };
}

/** F1 for content known only after the layout (unclipped plots and TikZ with `clip=false`): grows the box and the outer anchors. */
export function extendAxisLayout(layout: AxisLayout, extra: Box | null): AxisLayout {
  if (!extra) return layout;
  const bbox = union(layout.bbox, extra) ?? layout.bbox;
  const origin = { x: layout.map.origin.x, y: layout.map.origin.y };
  return { ...layout, bbox, anchors: axisAnchors(layout.box, bbox, origin, layout.originClamp) };
}
