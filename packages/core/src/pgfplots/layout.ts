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
import type { DirectionTicks, Tick } from "./ticks.js";

export type Point = { x: number; y: number };
export type Box = { minX: number; minY: number; maxX: number; maxY: number };
export type Segment = { from: Point; to: Point };

export type LabelRole = "xtick" | "ytick" | "xextra" | "yextra" | "xscale" | "yscale" | "xlabel" | "ylabel" | "title" | "legend" | "legend-entry" | "node near coord";

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
  /** Where the label text is written in the document (editing only; no effect on layout). */
  textSpan?: { from: number; to: number };
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
  /** Extra tick marks (`extra x ticks`), drawn after the major ticks. */
  extraTickMarks: { x: Segment[]; y: Segment[] };
  /**
   * The axis lines in paint order (C2, R2): a closed box, one box path with
   * the hidden direction skipped, or one path per line. `style` names the
   * `every outer/inner x/y axis line` style that applies.
   */
  axisLines: AxisLinePath[];
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

export type AxisLinePath = {
  letter: "x" | "y" | "both";
  inner: boolean;
  commands: Array<{ op: "M" | "L"; p: Point } | { op: "Z" }>;
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

/**
 * AA1: `unit vector ratio` (and `axis equal`) through `scale mode=scale
 * uniformly`. From the limits after enlargement and the A2 box W×H (before
 * `scale`), one common factor s gives e_x = r s, e_y = s (r = rx/ry) with
 * s = min(W / (r Δx), H / Δy): the direction that already fits keeps its
 * limits and box length; the other one gets more room, as wider limits (box
 * length kept) when it may change them, else as a shorter box. Changing a
 * direction's limits: `unit rescale keep size=false` never; `unless limits
 * declared` unless both its limits are given; `true` always. With one limit
 * given only the other moves; with none (or `true` overriding both) the
 * range grows about its centre. Returns the unit vector lengths (pt per
 * internal unit, before `scale`) and the new limits.
 */
export function applyUnitVectorRatio(model: AxisModel, limits: AxisLimits): { limits: AxisLimits; unitX: number; unitY: number } | null {
  const ratio = model.unitVectorRatio;
  if (!ratio || model.x.unit !== undefined || model.y.unit !== undefined) return null;
  const base = boxSize({ ...model, scale: 1 }, limits);
  const r = ratio.x / ratio.y;
  const dx = limits.xmax - limits.xmin;
  const dy = limits.ymax - limits.ymin;
  if (!(dx > 0) || !(dy > 0)) return null;
  const s = Math.min(base.width / (r * dx), base.height / dy);
  const unitX = r * s;
  const unitY = s;
  const out = { ...limits };
  const widen = (letter: "x" | "y", length: number, unit: number): void => {
    const dir = model[letter];
    const lo = letter === "x" ? limits.xmin : limits.ymin;
    const hi = letter === "x" ? limits.xmax : limits.ymax;
    const range = length / unit;
    if (!(range > hi - lo)) return;
    const minGiven = dir.min !== undefined;
    const maxGiven = dir.max !== undefined;
    const keep = model.unitRescaleKeepSize;
    if (keep === "false" || (keep === "unless limits declared" && minGiven && maxGiven)) return;
    let nlo: number;
    let nhi: number;
    if (minGiven && !maxGiven) { nlo = lo; nhi = lo + range; }
    else if (maxGiven && !minGiven) { nhi = hi; nlo = hi - range; }
    else { const c = (lo + hi) / 2; nlo = c - range / 2; nhi = c + range / 2; }
    if (letter === "x") { out.xmin = nlo; out.xmax = nhi; } else { out.ymin = nlo; out.ymax = nhi; }
  };
  widen("x", base.width, unitX);
  widen("y", base.height, unitY);
  return { limits: out, unitX, unitY };
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

/**
 * R2: where the line of direction `letter` lies, as a coordinate of the other
 * direction: its lower or upper limit, or 0 for `middle` (the lower limit
 * when 0 is outside the limits; manual axisdescription.tex). Box and none
 * give the lower limit.
 */
export function axisLineCoordinate(model: AxisModel, limits: AxisLimits, letter: "x" | "y"): number {
  const line = model[letter].axisLine;
  const lo = letter === "x" ? limits.ymin : limits.xmin;
  const hi = letter === "x" ? limits.ymax : limits.xmax;
  if (line === "upper") return hi;
  if (line === "middle") return lo <= 0 && 0 <= hi ? 0 : lo;
  return lo;
}

export function computeAxisLayout(input: LayoutInput): AxisLayout {
  const { model, limits, ticks } = input;
  const size = boxSize(model, limits);
  const x0 = 0; const y0 = 0; const x1 = size.width; const y1 = size.height;
  const sx = (x1 - x0) / (limits.xmax - limits.xmin);
  const sy = (y1 - y0) / (limits.ymax - limits.ymin);
  // S1: `x dir=reverse` runs the direction from the upper limit at the lower box edge.
  const mapX = model.x.reverse ? (x: number) => x1 - sx * (x - limits.xmin) : (x: number) => x0 + sx * (x - limits.xmin);
  const mapY = model.y.reverse ? (y: number) => y1 - sy * (y - limits.ymin) : (y: number) => y0 + sy * (y - limits.ymin);

  // R2: the canvas position of each direction's line (a y for the x line).
  const lineAt = {
    x: mapY(axisLineCoordinate(model, limits, "x")),
    y: mapX(axisLineCoordinate(model, limits, "y"))
  };
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
      if (dir.axisLine === "box") tickMarks[axis][kind] = [...(dir.tickPos !== "upper" ? lower : []), ...(dir.tickPos !== "lower" ? upper : [])];
      else if (dir.axisLine === "none") tickMarks[axis][kind] = [];
      else {
        // R3: ticks only on the drawn line, pointing into the box (upward/rightward for middle).
        const at = lineAt[axis];
        const inward = dir.axisLine === "upper" ? -1 : 1;
        tickMarks[axis][kind] = values.map((v) => (axis === "x"
          ? tickSegment({ x: mapX(v), y: at }, { x: 0, y: inward }, length, dir.tickAlign)
          : tickSegment({ x: at, y: mapY(v) }, { x: inward, y: 0 }, length, dir.tickAlign)));
      }
      if (!(kind === "major" ? dir.majorGrids : dir.minorGrids)) grid[axis][kind] = [];
      // `xmajorticks=false` / `ticks=none` remove the tick lines only (T1).
      if (!(kind === "major" ? dir.majorTickMarks : dir.minorTickMarks)) tickMarks[axis][kind] = [];
    }
  }

  // Extra ticks: on the same edges as the major ticks, as major-length marks.
  const extraTickMarks: AxisLayout["extraTickMarks"] = { x: [], y: [] };
  for (const axis of ["x", "y"] as const) {
    const dir = model[axis];
    const values = (ticks[axis].extra ?? []).map((t) => t.value);
    const length = model.majorTickLength;
    if (dir.axisLine === "none") continue;
    const edges: Array<{ at: number; inward: number }> = dir.axisLine === "box"
      ? [...(dir.tickPos !== "upper" ? [{ at: axis === "x" ? y0 : x0, inward: 1 }] : []), ...(dir.tickPos !== "lower" ? [{ at: axis === "x" ? y1 : x1, inward: -1 }] : [])]
      : [{ at: lineAt[axis], inward: dir.axisLine === "upper" ? -1 : 1 }];
    for (const edge of edges) for (const v of values) {
      extraTickMarks[axis].push(axis === "x"
        ? tickSegment({ x: mapX(v), y: edge.at }, { x: 0, y: edge.inward }, length, dir.tickAlign)
        : tickSegment({ x: edge.at, y: mapY(v) }, { x: edge.inward, y: 0 }, length, dir.tickAlign));
    }
  }

  // Axis lines (C2, R2).
  const axisLines: AxisLinePath[] = [];
  {
    const xl = model.x.axisLine; const yl = model.y.axisLine;
    const corners = [{ x: x0, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y0 }];
    if (xl === "box" && yl === "box") {
      axisLines.push({ letter: "both", inner: false, commands: [...corners.map((p, i) => ({ op: i === 0 ? "M" as const : "L" as const, p })), { op: "L", p: corners[0] ?? { x: x0, y: y0 } }, { op: "Z" }] });
    } else if ((xl === "box" && yl === "none") || (xl === "none" && yl === "box")) {
      // One box path, the hidden direction's sides skipped by moves (hide x axis, E21).
      const drawY = yl === "box";
      const commands: AxisLinePath["commands"] = [{ op: "M", p: corners[0] ?? { x: x0, y: y0 } }];
      [1, 2, 3, 0].forEach((index, side) => {
        const isY = side === 0 || side === 2;
        commands.push({ op: isY === drawY ? "L" : "M", p: corners[index] ?? { x: x0, y: y0 } });
      });
      commands.push({ op: "Z" });
      axisLines.push({ letter: drawY ? "y" : "x", inner: false, commands });
    } else {
      for (const letter of ["x", "y"] as const) {
        const line = model[letter].axisLine;
        if (line === "none") continue;
        const positions = line === "box" ? (letter === "x" ? [y0, y1] : [x0, x1]) : [lineAt[letter]];
        for (const at of positions) {
          axisLines.push({ letter, inner: line === "middle", commands: letter === "x"
            ? [{ op: "M", p: { x: x0, y: at } }, { op: "L", p: { x: x1, y: at } }]
            : [{ op: "M", p: { x: at, y: y0 } }, { op: "L", p: { x: at, y: y1 } }] });
        }
      }
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
    // R5: tick labels go with a single line (lower and middle lines label below/left).
    if (dir.axisLine === "lower" || dir.axisLine === "middle") return "lower";
    if (dir.axisLine === "upper") return "upper";
    if (dir.tickLabelPos !== "default") return dir.tickLabelPos;
    return dir.tickPos === "upper" ? "upper" : "lower";
  };
  const xSide = tickLabelSide("x");
  const ySide = tickLabelSide("y");
  const xs = tickShift(model.x.tickAlign, model.majorTickLength);
  const ys = tickShift(model.y.tickAlign, model.majorTickLength);
  // The edge the tick labels hang on: a box edge, or the line (R5).
  const xEdge = model.x.axisLine === "box" || model.x.axisLine === "none" ? (xSide === "lower" ? y0 : y1) : lineAt.x;
  const yEdge = model.y.axisLine === "box" || model.y.axisLine === "none" ? (ySide === "lower" ? x0 : x1) : lineAt.y;
  const xTickLabels: PlacedLabel[] = [];
  const yTickLabels: PlacedLabel[] = [];
  const tickLabelsOf = (letter: "x" | "y", list: readonly Tick[], role: LabelRole, into: PlacedLabel[]) => {
    if (model[letter].axisLine === "none") return;
    list.forEach((tick, position) => {
      if (tick.label === undefined || !ticks[letter].labelled) return;
      into.push(place(letter === "x"
        ? { role, tickPosition: position, text: tick.label, styles: input.labelStyles[role],
          placement: xSide === "lower" ? "anchor=north" : "anchor=south",
          at: { x: mapX(tick.value), y: xSide === "lower" ? xEdge - xs : xEdge + xs } }
        : { role, tickPosition: position, text: tick.label, styles: input.labelStyles[role],
          placement: ySide === "lower" ? "anchor=east" : "anchor=west",
          at: { x: ySide === "lower" ? yEdge - ys : yEdge + ys, y: mapY(tick.value) } }));
    });
  };
  tickLabelsOf("x", ticks.x.major, "xtick", xTickLabels);
  tickLabelsOf("y", ticks.y.major, "ytick", yTickLabels);
  tickLabelsOf("x", ticks.x.extra ?? [], "xextra", xTickLabels);
  tickLabelsOf("y", ticks.y.extra ?? [], "yextra", yTickLabels);

  // E1/E2: the edge of the tick label boxes, or the axis edge shifted by the tick.
  const xLabelsEdge = xTickLabels.reduce((b, l) => (l.geometry ? Math.min(b, l.geometry.border.minY) : b), Infinity);
  const yLabelsEdge = yTickLabels.reduce((b, l) => (l.geometry ? Math.min(b, l.geometry.border.minX) : b), Infinity);
  const xLabelsTop = xTickLabels.reduce((b, l) => (l.geometry ? Math.max(b, l.geometry.border.maxY) : b), -Infinity);
  const yLabelsRight = yTickLabels.reduce((b, l) => (l.geometry ? Math.max(b, l.geometry.border.maxX) : b), -Infinity);
  const bottom = xSide === "lower" && Number.isFinite(xLabelsEdge) ? xLabelsEdge : (xSide === "lower" ? xEdge : y0) - xs;
  const left = ySide === "lower" && Number.isFinite(yLabelsEdge) ? yLabelsEdge : (ySide === "lower" ? yEdge : x0) - ys;
  const top = Number.isFinite(xLabelsTop) ? xLabelsTop : xEdge + xs;
  const right = Number.isFinite(yLabelsRight) ? yLabelsRight : yEdge + ys;

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
  // R6: single axis lines move the axis labels.
  const originX = Math.min(Math.max(mapX(0), x0), x1); const originY = Math.min(Math.max(mapY(0), y0), y1);
  if (model.x.label && model.x.axisLine !== "none") {
    if (model.x.axisLine === "middle" && model.x.axisLineMovesLabel) {
      // Manual: right of origin, anchor south east; left of origin, south west, when the y line is on the right.
      const yRight = model.y.axisLine === "upper";
      place({ role: "xlabel", text: model.x.label.text, styles: input.labelStyles.xlabel, placement: yRight ? "anchor=south west" : "anchor=south east",
        at: { x: yRight ? x0 : x1, y: originY } });
    } else if (xSide === "upper") {
      place({ role: "xlabel", text: model.x.label.text, styles: input.labelStyles.xlabel, placement: "anchor=south",
        at: { x: (x0 + x1) / 2, y: top + model.x.labelShift } });
    } else {
      place({ role: "xlabel", text: model.x.label.text, styles: input.labelStyles.xlabel, placement: "anchor=north",
        at: { x: (x0 + x1) / 2, y: bottom - model.x.labelShift } });
    }
  }
  if (model.y.label && model.y.axisLine !== "none") {
    if (model.y.axisLine === "middle" && model.y.axisLineMovesLabel) {
      // Measured (R6): above origin, anchor north west, not rotated.
      place({ role: "ylabel", text: model.y.label.text, styles: input.labelStyles.ylabel, placement: "anchor=north west",
        at: { x: originX, y: y1 } });
    } else if (ySide === "upper") {
      place({ role: "ylabel", text: model.y.label.text, styles: input.labelStyles.ylabel, placement: "rotate=90,anchor=north",
        at: { x: right + model.y.labelShift, y: (y0 + y1) / 2 } });
    } else {
      place({ role: "ylabel", text: model.y.label.text, styles: input.labelStyles.ylabel, placement: "rotate=90,anchor=south",
        at: { x: left - model.y.labelShift, y: (y0 + y1) / 2 } });
    }
  }
  if (model.title) {
    place({ role: "title", text: model.title.text, styles: input.labelStyles.title, placement: "anchor=south",
      at: { x: (x0 + x1) / 2, y: y1 + model.titleShift } });
  }

  // F1.
  const half = input.lineWidth / 2;
  // The drawn axis lines (the whole box by default), outset by half their width.
  let grown: Box | null = null;
  for (const line of axisLines) for (const c of line.commands) {
    if (c.op === "L" || line.commands.some((d) => d.op === "L")) {
      if (c.op !== "Z") grown = union(grown, { minX: c.p.x - half, minY: c.p.y - half, maxX: c.p.x + half, maxY: c.p.y + half });
    }
  }
  for (const axis of ["x", "y"] as const) for (const s2 of extraTickMarks[axis]) {
    const h = input.tickLineWidth(axis, "major") / 2;
    grown = union(grown, { minX: Math.min(s2.from.x, s2.to.x) - h, minY: Math.min(s2.from.y, s2.to.y) - h, maxX: Math.max(s2.from.x, s2.to.x) + h, maxY: Math.max(s2.from.y, s2.to.y) + h });
  }
  let bbox: Box = grown ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const label of labels) bbox = union(bbox, label.geometry?.border ?? null) ?? bbox;
  for (const axis of ["x", "y"] as const) for (const kind of ["major", "minor"] as const) {
    const h = input.tickLineWidth(axis, kind) / 2;
    for (const s of tickMarks[axis][kind]) {
      bbox = union(bbox, { minX: Math.min(s.from.x, s.to.x) - h, minY: Math.min(s.from.y, s.to.y) - h, maxX: Math.max(s.from.x, s.to.x) + h, maxY: Math.max(s.from.y, s.to.y) + h }) ?? bbox;
    }
  }
  bbox = union(bbox, input.markBounds((x, y) => ({ x: mapX(x), y: mapY(y) }))) ?? bbox;
  // Nothing drawn at all (hide axis without marks): the box itself.
  if (!Number.isFinite(bbox.minX)) bbox = { minX: x0, minY: y0, maxX: x1, maxY: y1 };

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
  for (const axis of ["x", "y"] as const) extraTickMarks[axis] = extraTickMarks[axis].map(shiftSeg);
  for (const line of axisLines) {
    line.commands = line.commands.map((c) => (c.op === "Z" ? c : { op: c.op, p: shift(c.p) }));
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
    map: { origin: shift({ x: mapX(0), y: mapY(0) }), xUnit: { x: model.x.reverse ? -sx : sx, y: 0 }, yUnit: { x: 0, y: model.y.reverse ? -sy : sy } },
    ticks,
    tickMarks,
    grid,
    extraTickMarks,
    axisLines,
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
