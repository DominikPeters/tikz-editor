/**
 * PGF plot marks as pure geometry.
 *
 * Ported from PGF 3.1.10: the basic marks `*`, `+`, `x` and the mark
 * machinery come from `pgflibraryplothandlers.code.tex` (loaded by
 * `pgfmoduleplot`), the rest from `pgflibraryplotmarks.code.tex`, and `ball`
 * from `tikz.code.tex`. Every constant below is PGF's.
 *
 * The module knows nothing about the TikZ path evaluator: given a mark name,
 * the mark size (`\pgfplotmarksize`, pt) and the colours in force, it returns
 * the paint operations PGF performs, in order, as path segments in
 * mark-local coordinates (pt, y up, origin at the plotted point). Callers map
 * them through the canvas transform in force at the point (TikZ `plot`, a
 * pgfplots axis, a legend image).
 *
 * Marks are painted with the current graphic state: line width, dash
 * pattern, caps, joins and opacity are whatever the caller has in force, so
 * they are not part of the result. PGF paints each mark with
 * `\pgfusepathqstroke`, `\pgfusepathqfill` or `\pgfusepathqfillstroke`, which
 * ignore TikZ's `draw`/`fill` modes: a mark is painted whether or not the
 * path that carries it is drawn.
 */

export type PlotMarkSegment =
  | { readonly op: "M"; readonly x: number; readonly y: number }
  | { readonly op: "L"; readonly x: number; readonly y: number }
  | {
      readonly op: "C";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly op: "Z" };

/** `stroke`: `\pgfusepathqstroke`; `fill`: `\pgfusepathqfill`; `fillstroke`: `\pgfusepathqfillstroke`. */
export type PlotMarkPaintMode = "stroke" | "fill" | "fillstroke";

/** Which colour a fill uses: the current fill colour, or `/pgf/mark color` (white when unset). */
export type PlotMarkFillSource = "current" | "mark-color";

export type PlotMarkPathPrimitive = {
  readonly kind: "path";
  readonly paint: PlotMarkPaintMode;
  readonly fillSource: PlotMarkFillSource;
  /** Resolved stroke colour, or null when this operation does not stroke. */
  readonly stroke: string | null;
  /** Resolved fill colour, or null when this operation does not fill. */
  readonly fill: string | null;
  readonly segments: readonly PlotMarkSegment[];
};

/** `ball`: `\shade (0pt,0pt) circle (\pgfplotmarksize)` with the `ball` shading. */
export type PlotMarkShadePrimitive = {
  readonly kind: "shade";
  readonly shading: "ball";
  readonly ballColor: string;
  readonly segments: readonly PlotMarkSegment[];
};

/** `text`: `\pgftext[<text mark style>]{<text mark>}` (or a TikZ node with `text mark as node`) at the origin. */
export type PlotMarkTextPrimitive = {
  readonly kind: "text";
  readonly text: string;
  readonly style: string;
  readonly asNode: boolean;
};

export type PlotMarkPrimitive = PlotMarkPathPrimitive | PlotMarkShadePrimitive | PlotMarkTextPrimitive;

export type PlotMarkOptions = {
  /** `\pgfplotmarksize` in pt (PGF default 2pt). */
  readonly size: number;
  /** Current stroke colour. */
  readonly strokeColor: string;
  /** Current fill colour. */
  readonly fillColor: string;
  /**
   * `/pgf/mark color`: null or undefined when unset (the half marks then fill
   * their second half white), `"none"` to leave the second half unfilled.
   */
  readonly markColor?: string | null;
  /** `ball color` for the `ball` mark (TikZ default blue). */
  readonly ballColor?: string;
  /** `/pgf/text mark`, `/pgf/text mark style`, `/pgf/text mark as node`. */
  readonly textMark?: string;
  readonly textMarkStyle?: string;
  readonly textMarkAsNode?: boolean;
  /**
   * Whether the linear part of the canvas transform at the mark is the
   * identity. `\pgfpathrectangle` emits its corners in a different order
   * otherwise (`\pgf@normalrect` vs `\pgf@specialrect`); only the `square`
   * marks depend on it. Defaults to true.
   */
  readonly linearIdentity?: boolean;
};

/** PGF's default `\pgfplotmarksize`. */
export const DEFAULT_PLOT_MARK_SIZE = 2;

/** The white `\pgf@set@mark@color` uses when `/pgf/mark color` is unset. */
export const DEFAULT_MARK_COLOR = "white";

/** Marks defined by PGF without the `plotmarks` library. */
const BASIC_PLOT_MARKS = new Set(["*", "+", "x", "ball"]);

export const PLOT_MARK_NAMES = [
  "*", "x", "+", "-", "|", "o", "asterisk", "star", "10-pointed star", "oplus", "oplus*", "otimes", "otimes*",
  "square", "square*", "triangle", "triangle*", "diamond", "diamond*", "halfdiamond*", "halfsquare*",
  "halfsquare right*", "halfsquare left*", "pentagon", "pentagon*", "Mercedes star", "Mercedes star flipped",
  "halfcircle", "halfcircle*", "heart", "text", "ball"
] as const;

export type PlotMarkName = (typeof PLOT_MARK_NAMES)[number];

const PLOT_MARK_NAME_SET: ReadonlySet<string> = new Set(PLOT_MARK_NAMES);

/** PGF mark names are case- and space-sensitive control-sequence names. */
export function isPlotMarkName(name: string): name is PlotMarkName {
  return PLOT_MARK_NAME_SET.has(name);
}

/** Whether TeX needs `\usetikzlibrary{plotmarks}` (or `\usepgflibrary{plotmarks}`) for this mark. */
export function plotMarkRequiresLibrary(name: PlotMarkName): boolean {
  return !BASIC_PLOT_MARKS.has(name);
}

/** The factor PGF uses for quarter-circle Bézier control points. */
const KAPPA = 0.55228475;
/** `.70710678\pgfplotmarksize` in the `x` and `otimes` marks. */
const DIAGONAL = 0.70710678;
/** `.75\pgfplotmarksize`: the diamond marks' half width. */
const DIAMOND_HALF_WIDTH = 0.75;

const DEG = Math.PI / 180;

type Builder = {
  segments: PlotMarkSegment[];
  x: number;
  y: number;
};

function builder(): Builder {
  return { segments: [], x: 0, y: 0 };
}

function moveTo(b: Builder, x: number, y: number): void {
  b.segments.push({ op: "M", x, y });
  b.x = x;
  b.y = y;
}

function lineTo(b: Builder, x: number, y: number): void {
  b.segments.push({ op: "L", x, y });
  b.x = x;
  b.y = y;
}

function curveTo(b: Builder, x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
  b.segments.push({ op: "C", x1, y1, x2, y2, x, y });
  b.x = x;
  b.y = y;
}

function close(b: Builder): void {
  b.segments.push({ op: "Z" });
}

function polar(angle: number, radius: number): { x: number; y: number } {
  return { x: radius * Math.cos(angle * DEG), y: radius * Math.sin(angle * DEG) };
}

function moveToPolar(b: Builder, angle: number, radius: number): void {
  const p = polar(angle, radius);
  moveTo(b, p.x, p.y);
}

function lineToPolar(b: Builder, angle: number, radius: number): void {
  const p = polar(angle, radius);
  lineTo(b, p.x, p.y);
}

/**
 * `\pgfpathcircle{\pgfpointorigin}{r}` = `\pgfpathellipse` with axes (r,0),
 * (0,r): four quarter Béziers counter-clockwise from (r,0), then a close. The
 * trailing `\pgfpathmoveto` to the centre paints nothing and is omitted.
 */
function circle(b: Builder, r: number): void {
  const k = KAPPA * r;
  moveTo(b, r, 0);
  curveTo(b, r, k, k, r, 0, r);
  curveTo(b, -k, r, -r, k, -r, 0);
  curveTo(b, -r, -k, -k, -r, 0, -r);
  curveTo(b, k, -r, r, -k, r, 0);
  close(b);
}

/** One `\pgf@arc` piece from the current point, from angle `a` to `b` on a circle of radius `r`. */
function arcPiece(bd: Builder, a: number, b: number, r: number): void {
  const span = Math.abs(b - a);
  const factor = span === 90 ? KAPPA : 1.333333333 * Math.tan(0.25 * span * DEG);
  const support = factor * r;
  const increasing = b > a;
  const c1 = polar(increasing ? a + 90 : a - 90, support);
  const startOffset = polar(a, r);
  const endOffset = polar(b, r);
  const endX = bd.x - startOffset.x + endOffset.x;
  const endY = bd.y - startOffset.y + endOffset.y;
  const c2 = polar(increasing ? b - 90 : b + 90, support);
  curveTo(bd, bd.x + c1.x, bd.y + c1.y, endX + c2.x, endY + c2.y, endX, endY);
}

/** `\pgfpatharc{a}{b}{r}`: split into 90 (or 60) degree pieces exactly as PGF does. */
function arc(bd: Builder, startAngle: number, endAngle: number, r: number): void {
  let a = startAngle;
  const b = endAngle;
  for (;;) {
    const span = Math.abs(a - b);
    if (!(span > 90)) break;
    const step = span > 115 ? 90 : 60;
    const next = b > a ? a + step : a - step;
    arcPiece(bd, a, next, r);
    a = next;
  }
  arcPiece(bd, a, b, r);
}

/** `\pgfpathrectangle{(-r,-r)}{(2r,2r)}` in either of PGF's corner orders. */
function square(b: Builder, r: number, linearIdentity: boolean): void {
  if (linearIdentity) {
    // \pgf@normalrect: `x y w h re`.
    moveTo(b, -r, -r);
    lineTo(b, r, -r);
    lineTo(b, r, r);
    lineTo(b, -r, r);
    close(b);
    return;
  }
  // \pgf@specialrect: starts at the far corner; the trailing moveto is omitted.
  moveTo(b, r, r);
  lineTo(b, -r, r);
  lineTo(b, -r, -r);
  lineTo(b, r, -r);
  close(b);
}

function path(
  paint: PlotMarkPaintMode,
  segments: PlotMarkSegment[],
  options: PlotMarkOptions,
  fillSource: PlotMarkFillSource = "current"
): PlotMarkPathPrimitive {
  const fillColor = fillSource === "mark-color" ? resolvedMarkColor(options) : options.fillColor;
  return {
    kind: "path",
    paint,
    fillSource,
    stroke: paint === "fill" ? null : options.strokeColor,
    fill: paint === "stroke" ? null : fillColor,
    segments
  };
}

function resolvedMarkColor(options: PlotMarkOptions): string {
  const color = options.markColor;
  return color == null || color.trim().length === 0 ? DEFAULT_MARK_COLOR : color;
}

function markColorIsNone(options: PlotMarkOptions): boolean {
  return options.markColor?.trim() === "none";
}

/** Lines from the origin-free list of (move, line) pairs. */
function strokes(pairs: ReadonlyArray<readonly [number, number, number, number]>): PlotMarkSegment[] {
  const b = builder();
  for (const [x1, y1, x2, y2] of pairs) {
    moveTo(b, x1, y1);
    lineTo(b, x2, y2);
  }
  return b.segments;
}

function plusLines(b: Builder, r: number): void {
  moveTo(b, -r, 0);
  lineTo(b, r, 0);
  moveTo(b, 0, r);
  lineTo(b, 0, -r);
}

function crossLines(b: Builder, r: number): void {
  const d = DIAGONAL * r;
  moveTo(b, -d, -d);
  lineTo(b, d, d);
  moveTo(b, -d, d);
  lineTo(b, d, -d);
}

/** The diamond outline shared by `halfdiamond*` (w = .75r) and the `halfsquare` marks (w = r). */
function diamondOutline(w: number, r: number): PlotMarkSegment[] {
  const b = builder();
  moveTo(b, w, 0);
  lineTo(b, 0, r);
  lineTo(b, -w, 0);
  lineTo(b, 0, -r);
  close(b);
  return b.segments;
}

function threeCorner(points: ReadonlyArray<readonly [number, number]>): PlotMarkSegment[] {
  const b = builder();
  points.forEach(([x, y], index) => {
    if (index === 0) moveTo(b, x, y);
    else lineTo(b, x, y);
  });
  return b.segments;
}

/** A half-filled outline: first half in the fill colour, second half in `mark color`, then the outline stroked. */
function halfFilled(
  first: ReadonlyArray<readonly [number, number]>,
  second: ReadonlyArray<readonly [number, number]>,
  outline: PlotMarkSegment[],
  options: PlotMarkOptions
): PlotMarkPrimitive[] {
  const result: PlotMarkPrimitive[] = [path("fill", threeCorner(first), options)];
  if (!markColorIsNone(options)) {
    result.push(path("fill", threeCorner(second), options, "mark-color"));
  }
  result.push(path("stroke", outline, options));
  return result;
}

/**
 * The paint operations of mark `name` in order, in mark-local pt
 * coordinates. Returns null for a name PGF does not define.
 */
export function plotMarkPrimitives(name: string, options: PlotMarkOptions): PlotMarkPrimitive[] | null {
  if (!isPlotMarkName(name)) return null;
  const r = options.size;
  const linearIdentity = options.linearIdentity ?? true;
  switch (name) {
    case "*": {
      const b = builder();
      circle(b, r);
      return [path("fillstroke", b.segments, options)];
    }
    case "o": {
      const b = builder();
      circle(b, r);
      return [path("stroke", b.segments, options)];
    }
    case "+": {
      const b = builder();
      plusLines(b, r);
      return [path("stroke", b.segments, options)];
    }
    case "x": {
      const b = builder();
      crossLines(b, r);
      return [path("stroke", b.segments, options)];
    }
    case "|":
      return [path("stroke", strokes([[0, r, 0, -r]]), options)];
    case "-":
      return [path("stroke", strokes([[r, 0, -r, 0]]), options)];
    case "Mercedes star":
    case "Mercedes star flipped": {
      const angles = name === "Mercedes star" ? [90, -30, -150] : [-90, 30, 150];
      const b = builder();
      for (const angle of angles) {
        moveToPolar(b, angle, r);
        lineTo(b, 0, 0);
      }
      return [path("stroke", b.segments, options)];
    }
    case "asterisk": {
      const b = builder();
      moveTo(b, 0, -r);
      lineTo(b, 0, r);
      moveToPolar(b, 30, r);
      lineToPolar(b, 210, r);
      moveToPolar(b, -30, r);
      lineToPolar(b, -210, r);
      return [path("stroke", b.segments, options)];
    }
    case "star": {
      const b = builder();
      moveTo(b, 0, 0);
      lineTo(b, 0, r);
      for (const angle of [18, -54, 234, 162]) {
        moveTo(b, 0, 0);
        lineToPolar(b, angle, r);
      }
      return [path("stroke", b.segments, options)];
    }
    case "10-pointed star": {
      const b = builder();
      moveTo(b, 0, -r);
      lineTo(b, 0, r);
      for (const angle of [18, -54, 234, 162]) {
        moveToPolar(b, angle, -r);
        lineToPolar(b, angle, r);
      }
      return [path("stroke", b.segments, options)];
    }
    case "oplus":
    case "oplus*": {
      const b = builder();
      circle(b, r);
      plusLines(b, r);
      return [path(name === "oplus" ? "stroke" : "fillstroke", b.segments, options)];
    }
    case "otimes":
    case "otimes*": {
      const b = builder();
      circle(b, r);
      crossLines(b, r);
      return [path(name === "otimes" ? "stroke" : "fillstroke", b.segments, options)];
    }
    case "square":
    case "square*": {
      const b = builder();
      square(b, r, linearIdentity);
      return [path(name === "square" ? "stroke" : "fillstroke", b.segments, options)];
    }
    case "triangle":
    case "triangle*": {
      const b = builder();
      moveTo(b, 0, r);
      lineToPolar(b, -30, r);
      lineToPolar(b, -150, r);
      close(b);
      return [path(name === "triangle" ? "stroke" : "fillstroke", b.segments, options)];
    }
    case "diamond":
    case "diamond*": {
      const w = DIAMOND_HALF_WIDTH * r;
      const b = builder();
      moveTo(b, 0, r);
      lineTo(b, w, 0);
      lineTo(b, 0, -r);
      lineTo(b, -w, 0);
      close(b);
      return [path(name === "diamond" ? "stroke" : "fillstroke", b.segments, options)];
    }
    case "pentagon":
    case "pentagon*": {
      const b = builder();
      moveTo(b, 0, r);
      for (const angle of [18, -54, 234, 162]) lineToPolar(b, angle, r);
      close(b);
      return [path(name === "pentagon" ? "stroke" : "fillstroke", b.segments, options)];
    }
    case "halfdiamond*": {
      const w = DIAMOND_HALF_WIDTH * r;
      return halfFilled([[-w, 0], [0, -r], [w, 0]], [[w, 0], [0, r], [-w, 0]], diamondOutline(w, r), options);
    }
    case "halfsquare*":
      return halfFilled([[-r, 0], [0, -r], [r, 0]], [[r, 0], [0, r], [-r, 0]], diamondOutline(r, r), options);
    case "halfsquare right*":
      return halfFilled([[0, -r], [r, 0], [0, r]], [[0, -r], [-r, 0], [0, r]], diamondOutline(r, r), options);
    case "halfsquare left*":
      return halfFilled([[0, -r], [-r, 0], [0, r]], [[0, -r], [r, 0], [0, r]], diamondOutline(r, r), options);
    case "halfcircle": {
      const result: PlotMarkPrimitive[] = [];
      if (!markColorIsNone(options)) {
        const lower = builder();
        moveTo(lower, -r, 0);
        arc(lower, 180, 360, r);
        result.push(path("fill", lower.segments, options, "mark-color"));
      }
      const outline = builder();
      moveTo(outline, -r, 0);
      lineTo(outline, r, 0);
      circle(outline, r);
      result.push(path("stroke", outline.segments, options));
      return result;
    }
    case "halfcircle*": {
      const upper = builder();
      moveTo(upper, r, 0);
      arc(upper, 0, 180, r);
      close(upper);
      const result: PlotMarkPrimitive[] = [path("fill", upper.segments, options)];
      if (!markColorIsNone(options)) {
        const lower = builder();
        moveTo(lower, -r, 0);
        arc(lower, 180, 360, r);
        result.push(path("fill", lower.segments, options, "mark-color"));
      }
      const outline = builder();
      circle(outline, r);
      result.push(path("stroke", outline.segments, options));
      return result;
    }
    case "heart": {
      const b = builder();
      const s = (value: number): number => value * r;
      moveTo(b, 0, s(-1.75));
      curveTo(b, 0, s(-1.75), 0, s(-1.66), s(-0.5), s(-1.165));
      curveTo(b, s(-0.5), s(-1.165), s(-1), s(-0.75), s(-1), 0);
      curveTo(b, s(-1), 0, s(-1), s(0.5825), s(-0.5825), s(0.5825));
      curveTo(b, s(-0.5825), s(0.5825), 0, s(0.5825), 0, 0);
      curveTo(b, 0, 0, 0, s(0.5825), s(0.5825), s(0.5825));
      curveTo(b, s(0.5825), s(0.5825), s(1), s(0.5825), s(1), 0);
      curveTo(b, s(1), 0, s(1), s(-0.75), s(0.5), s(-1.165));
      curveTo(b, s(0.5), s(-1.165), 0, s(-1.66), 0, s(-1.75));
      close(b);
      return [path("fillstroke", b.segments, options)];
    }
    case "ball": {
      const b = builder();
      circle(b, r);
      return [{ kind: "shade", shading: "ball", ballColor: options.ballColor ?? "blue", segments: b.segments }];
    }
    case "text":
      return [{
        kind: "text",
        text: options.textMark ?? "p",
        style: options.textMarkStyle ?? "",
        asNode: options.textMarkAsNode ?? false
      }];
  }
}

/**
 * PGF's mark selection for `\pgfplothandlermark` (with `mark repeat` and
 * `mark phase`) and `\pgfplothandlermarklisted` (`mark indices`): which of
 * `count` stream points (0-based) receive a mark.
 */
export function selectPlotMarkIndices(
  count: number,
  options: { readonly repeat?: number; readonly phase?: number; readonly indices?: readonly number[] | null }
): number[] {
  const repeat = options.repeat ?? 1;
  const phase = options.phase ?? 1;
  const listed = options.indices ? new Set(options.indices) : null;
  // \pgf@plot@mark@count = repeat - phase, advanced by one before each point.
  let markCount = repeat - phase;
  const selected: number[] = [];
  for (let index = 0; index < count; index += 1) {
    markCount += 1;
    if (listed) {
      if (listed.has(markCount)) selected.push(index);
      continue;
    }
    if (markCount < repeat) continue;
    markCount = 0;
    selected.push(index);
  }
  return selected;
}
